let mediaRecorder = null;
let recorders = [null, null];
let currentRecorderIndex = 0;
// Wall-clock run length of each recorder's current segment, stamped at swap time.
let recorderDurations = [0, 0];
let activeIntervalId = null;
let audioStream = null;
let audioCtx = null;
let intervalId = null;
let webSpeechRec = null;
let chunkSeq = 0;
// Loudness stats, per recorder. These used to be single shared values reset
// inside ondataavailable, which fires asynchronously AFTER the swap has already
// started the next recorder — so frames belonging to the new segment were folded
// into the old segment's numbers and then zeroed along with them. The new
// segment lost its opening frames, which is exactly when a short utterance needs
// them to clear the VAD threshold.
let maxRmsInSegment = [0, 0];
let sumRmsInSegment = [0, 0];
let rmsCount = [0, 0];

let currentRecorderStartTime = 0;
let silenceFrameCount = 0;

async function sendMessageWithRetry(message, retries = 5, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        });
      });
    } catch (err) {
      console.warn(`🎙️ [Offscreen] sendMessage failed (attempt ${i + 1}/${retries}):`, err.message);
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.action === 'ping') {
    // `capturing` matters as much as `alive`: the panels pre-create this document
    // on load purely to shave startup latency, so its mere existence proves
    // nothing about whether audio is actually being recorded.
    if (sendResponse) sendResponse({ alive: true, capturing: !!audioStream });
    return true; // Keep message channel open to preserve offscreen lifetime in MV3
  } else if (message.action === 'start_capture') {
    startCapture(message.streamId, message.config);
  } else if (message.action === 'stop_capture') {
    stopCapture();
  } else if (message.action === 'setplaybackvolume') {
    // Independently control playback volume without affecting capture
    if (window._playbackGainNode && audioCtx) {
      const vol = typeof message.volume === 'number' ? message.volume : 1;
      // Smooth 50ms fade to avoid clicks
      window._playbackGainNode.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.05);
      console.log(`🎙️ [Offscreen] Playback volume → ${vol}`);
    }
    if (sendResponse) sendResponse({ success: true });
  }
});

// How loud the stream's own audio stays. Muting used to be hard-wired to "TTS
// is on", which left no way to follow along with the original speaker.
const TTS_ORIGINAL_AUDIO_GAIN = { mute: 0.0, low: 0.15, keep: 1.0 };

function resolvePlaybackGain(isMuted, isTtsEnabled, originalAudioMode) {
  if (isMuted) return 0.0;                    // explicit Mute tab always wins
  if (!isTtsEnabled) return 1.0;
  const gain = TTS_ORIGINAL_AUDIO_GAIN[originalAudioMode];
  return gain === undefined ? 0.0 : gain;     // default stays the old behaviour
}

async function startCapture(streamId, config) {
  stopCapture(); // Ensure previous capture is fully cleaned up
  chunkSeq = 0;
  maxRmsInSegment = [0, 0];
  sumRmsInSegment = [0, 0];
  rmsCount = [0, 0];
  recorderDurations = [0, 0];

  console.log('🎙️ [Offscreen] Beginning parallel setup with streamId:', streamId);

  const constraints = {
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    },
    video: false
  };

  // Parallel setup of stream and AudioContext
  const audioCtxPromise = Promise.resolve(new (window.AudioContext || window.webkitAudioContext)());
  const streamPromise = navigator.mediaDevices.getUserMedia(constraints);

  let stream, context;
  try {
    [stream, context] = await Promise.all([streamPromise, audioCtxPromise]);
  } catch (err) {
    console.error('❌ [Offscreen] Parallel setup failed:', err);
    sendMessageWithRetry({
      action: 'lt_error',
      error: 'Capture failed: ' + err.message
    }).catch(() => {});
    return;
  }

  // A stream with no audio track would record silence forever. Fail loudly.
  if (stream.getAudioTracks().length === 0) {
    console.error('❌ [Offscreen] Stream has no audio track.');
    stream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
    try { context.close(); } catch (_) {}
    sendMessageWithRetry({
      action: 'lt_error',
      error: 'The captured tab produced no audio track.'
    }).catch(() => {});
    return;
  }

  audioStream = stream;
  audioCtx = context;
  console.log('🎙️ [Offscreen] Parallel setup completed. Active tracks:', stream.getAudioTracks().length);

  // Resume AudioContext immediately if suspended
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(e => console.warn('🎙️ [Offscreen] AudioContext resume warning:', e));
  }

  // Create a silent oscillator loop connected to destination to prevent Chrome from throttling or suspending the offscreen page
  try {
    const silentOsc = audioCtx.createOscillator();
    const silentGain = audioCtx.createGain();
    silentGain.gain.setValueAtTime(0, audioCtx.currentTime); // 0 volume = completely silent
    silentOsc.connect(silentGain);
    silentGain.connect(audioCtx.destination);
    silentOsc.start();
    console.log("🎙️ [Offscreen] Silent oscillator keep-alive started to prevent background throttling.");
  } catch (err) {
    console.warn("🎙️ [Offscreen] Failed to start silent oscillator:", err);
  }

  // Register onended listener on tracks to handle tab navigation, close, or reload
  stream.getAudioTracks().forEach(track => {
    track.onended = () => {
      console.warn('🎙️ [Offscreen] Audio track ended (tab navigated, reloaded, or closed).');
      stopCapture();
      sendMessageWithRetry({ action: 'lt_tab_stop' }).catch(() => {});
    };
  });

  const source = audioCtx.createMediaStreamSource(stream);

  // ─── GainNode 1: CAPTURE path — NEVER modified ───────────────────────
  // Always gain = 1.0 so Whisper always receives full audio regardless
  // of whether the user mutes playback or TTS is enabled.
  const captureGain = audioCtx.createGain();
  captureGain.gain.value = 1.0;

  // Add Dynamics Compressor to automatically normalize volume levels (AGC)
  // This boosts quiet speech and prevents clipping, making Whisper inputs loud and clear.
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-24, audioCtx.currentTime);
  compressor.knee.setValueAtTime(30, audioCtx.currentTime);
  compressor.ratio.setValueAtTime(12, audioCtx.currentTime);
  compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
  compressor.release.setValueAtTime(0.25, audioCtx.currentTime);

  source.connect(compressor);
  compressor.connect(captureGain);

  const captureDestination = audioCtx.createMediaStreamDestination();
  captureGain.connect(captureDestination);

  // ─── GainNode 2: PLAYBACK path — user-controlled ─────────────────────
  // This is what the user hears. Setting to 0 mutes the tab without
  // disrupting the capture pipeline.
  const playbackGain = audioCtx.createGain();
  source.connect(playbackGain);
  playbackGain.connect(audioCtx.destination);
  window._playbackGainNode = playbackGain;

  // Set initial playback volume based on config passed from background script.
  // A tabCapture stream takes the tab's audio away from the speakers, so we owe
  // the user a re-play here.
  const isTtsEnabled = !!config.ltTtsEnabled;
  const isMuted = !!config.ltMuteTab;
  playbackGain.gain.value = resolvePlaybackGain(isMuted, isTtsEnabled, config.ltTtsOriginalAudio);
  console.log(`🎙️ [Offscreen] Initial playback gain: ${playbackGain.gain.value} (TTS:${isTtsEnabled} Muted:${isMuted} Original:${config.ltTtsOriginalAudio || 'mute'})`);

  // ─── VAD: AnalyserNode on CAPTURE path ───────────────────────────────
  // Highly sensitive VAD settings to prevent missing quiet or short speech segments.
  const VAD_THRESHOLD = 0.016; // Increased to prevent capturing background hum/music/noise
  // 3 frames on the 75ms poll grid = 225ms of speech (the old comment's "300ms"
  // was wrong — 4 frames is 225ms of *gaps*, 300ms wall-clock at best). Each poll
  // reads an instantaneous ~10.7ms window, so an unvoiced consonant landing on a
  // probe used to reset the run and lose the whole segment.
  const VAD_MIN_FRAMES = 3;

  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  const vadBuffer = new Float32Array(analyser.fftSize);
  // Tap the CAPTURE path (post-compressor) so VAD measures the exact signal
  // Whisper receives. Tapping the raw source under-reports quiet streams that
  // the compressor's makeup gain makes perfectly audible, causing false skips.
  captureGain.connect(analyser);

  // ─── Streaming ASR takes over from here ──────────────────────────────────
  // The recorder/VAD machinery below exists to cut audio into files for a batch
  // transcriber. A streaming recogniser does its own endpointing on a continuous
  // sample stream, so none of it applies — and running both would transcribe
  // every second of audio twice.
  if (config.ltAsrEngine === 'deepgram') {
    console.log('🎙️ [Offscreen] Streaming ASR mode — MediaRecorder chunking disabled.');
    startStreamingAsr(config, captureGain);
    sendMessageWithRetry({ action: 'lt_capture_ready' }).catch(() => {});
    return;
  }

  // Per recorder, for the same reason as the RMS accumulators above.
  let hasSoundInSegment = [false, false];
  // NOT per recorder, and deliberately not reset at a swap: this is the running
  // count toward VAD_MIN_FRAMES, and speech does not stop just because the
  // recorders changed over. Carrying it means a segment that begins mid-sentence
  // registers as speech immediately instead of having to re-earn three frames.
  let soundFrameCount = 0;

  // ─── Dual alternating MediaRecorders for valid WebM chunk containers ───
  let recorderA = null;
  let recorderB = null;
  try {
    recorderA = new MediaRecorder(captureDestination.stream, { mimeType: 'audio/webm' });
    recorderB = new MediaRecorder(captureDestination.stream, { mimeType: 'audio/webm' });
  } catch (err) {
    console.error('🎙️ [Offscreen] Failed to create MediaRecorders:', err);
    return;
  }

  recorders = [recorderA, recorderB];
  currentRecorderIndex = 0;

  const handleRecorderData = async (event, index) => {
    if (event.data && event.data.size > 0) {
      const hasSound = hasSoundInSegment[index];
      hasSoundInSegment[index] = false; // Reset THIS slot only
      const blob = event.data;
      // How much wall-clock audio this blob actually covers. Nothing downstream
      // knew this, so the overlay had to guess a caption's on-screen time from
      // its character count alone — the one number that has no relation to how
      // long the speaker took to say it.
      const durationMs = recorderDurations[index] || 0;
      recorderDurations[index] = 0;

      // Read and clear THIS recorder's slot only. The other slot is already
      // accumulating for the segment now in progress and must not be touched.
      const avgRms = rmsCount[index] > 0 ? sumRmsInSegment[index] / rmsCount[index] : 0;
      const maxRms = maxRmsInSegment[index];
      maxRmsInSegment[index] = 0;
      sumRmsInSegment[index] = 0;
      rmsCount[index] = 0;

      console.log(`🎙️ [Offscreen] Recorder ${index} WebM blob emitted. Size: ${blob.size} bytes. VAD sound: ${hasSound} | Max RMS: ${maxRms.toFixed(5)} | Avg RMS: ${avgRms.toFixed(5)}`);

      if (blob.size < 1000) {
        console.warn(`🎙️ [Offscreen] Skipping extremely small audio segment (${blob.size} bytes).`);
        return;
      }

      await processAudioBlob(blob, config, hasSound, maxRms, avgRms, durationMs);
    }
  };

  recorderA.ondataavailable = (event) => handleRecorderData(event, 0);
  recorderB.ondataavailable = (event) => handleRecorderData(event, 1);

  const swapRecorders = () => {
    const nextIndex = 1 - currentRecorderIndex;
    const elapsed = Date.now() - currentRecorderStartTime;
    console.log(`🎙️ [Offscreen] Swapping recorders: ${currentRecorderIndex} -> ${nextIndex} (Elapsed: ${elapsed}ms)`);
    // Stamp the outgoing recorder's run length so handleRecorderData, which fires
    // asynchronously once stop() flushes the blob, can report it.
    recorderDurations[currentRecorderIndex] = elapsed;

    try {
      // 1. Verify and start/resume the next recorder first to maintain continuous gapless capture
      if (recorders[nextIndex]) {
        const state = recorders[nextIndex].state;
        if (state === 'inactive') {
          recorders[nextIndex].start();
        } else if (state === 'paused') {
          recorders[nextIndex].resume();
        }
      } else {
        console.error('🎙️ [Offscreen] Recorder destroyed, stopping capture.');
        stopCapture();
        sendMessageWithRetry({ action: 'lt_tab_stop' }).catch(() => {});
        return;
      }
      
      // 2. Stop the current recorder to trigger ondataavailable and generate a valid WebM chunk
      const currentRec = recorders[currentRecorderIndex];
      currentRecorderIndex = nextIndex;
      currentRecorderStartTime = Date.now();
      silenceFrameCount = 0; // Reset silence counter on swap
      
      if (currentRec) {
        if (currentRec.state === 'recording') {
          currentRec.stop();
        } else if (currentRec.state === 'paused') {
          currentRec.resume();
          setTimeout(() => {
            try { currentRec.stop(); } catch (_) {}
          }, 50);
        }
      }
    } catch (err) {
      console.error('🎙️ [Offscreen] Error swapping MediaRecorders:', err);
    }
  };

  // Poll volume every 75ms — optimal CPU-performance compromise
  const vadInterval = setInterval(() => {
    if (!audioStream) return;
    analyser.getFloatTimeDomainData(vadBuffer);
    let sum = 0;
    for (let i = 0; i < vadBuffer.length; i++) {
      sum += vadBuffer[i] * vadBuffer[i];
    }
    const rms = Math.sqrt(sum / vadBuffer.length);

    // swapRecorders advances currentRecorderIndex before it stops the outgoing
    // recorder, so from the swap onward these land in the incoming segment's slot.
    const slot = currentRecorderIndex;
    if (rms > maxRmsInSegment[slot]) {
      maxRmsInSegment[slot] = rms;
    }
    sumRmsInSegment[slot] += rms;
    rmsCount[slot]++;

    if (rms > VAD_THRESHOLD) {
      soundFrameCount++;
      silenceFrameCount = 0; // Reset silence frames when there is sound
      if (soundFrameCount >= VAD_MIN_FRAMES) {
        hasSoundInSegment[slot] = true; // Only flag real speech after sustained signal
      }
    } else {
      // Leaky integrator, not a hard reset. Speech is not continuously above
      // threshold — stop consonants and unvoiced fricatives dip below it
      // mid-word — so zeroing the counter on a single quiet probe meant a short
      // utterance ("No.", "Đúng rồi.") never reached VAD_MIN_FRAMES and the whole
      // segment was discarded without ever being sent for transcription.
      soundFrameCount = Math.max(0, soundFrameCount - 1);
      silenceFrameCount++; // Increment silence frames
    }

    // Check for VAD-based dynamic chunk swap
    const elapsed = Date.now() - currentRecorderStartTime;
    const minDuration = (chunkSeq === 0) ? 800 : 1200; // First chunk swaps fast to show text quickly

    // Swap on silence (~225ms / 3 frames) after min duration, or at a hard maximum of 4.5s.
    // Tuned on a 151-WPM narration (Arc "Core Primitives"): fast speakers almost
    // never pause 375ms mid-flow, so the old 5-frame rule meant every segment hit
    // the hard cap and cut MID-WORD (~60 blind cuts in a 3.6-min video). 225ms
    // still clears inter-sentence gaps in fast speech, so most swaps now land on
    // real boundaries; the higher cap halves the remaining blind cuts and gives
    // Whisper more context per call. Latency stays fine — ASR cost per call is
    // dominated by network, not audio length.
    const shouldSwap = (elapsed >= minDuration && silenceFrameCount >= 3) || (elapsed >= 4500);
    if (shouldSwap) {
      swapRecorders();
    }
  }, 75);

  window._vadInterval = vadInterval;

  try {
    // Start the first recorder
    if (recorders[0] && recorders[0].state === 'inactive') {
      currentRecorderStartTime = Date.now();
      silenceFrameCount = 0;
      recorders[0].start();
      console.log(`🎙️ [Offscreen] Recorder 0 started.`);
      // Broadcast ready signal to background script immediately
      sendMessageWithRetry({ action: 'lt_capture_ready' }).catch(() => {});
    }
  } catch (err) {
    console.error('🎙️ [Offscreen] Error starting first MediaRecorder:', err);
    stopCapture();
  }
}

// ─── Streaming ASR ("dịch cabin") ────────────────────────────────────────────
// Batch ASR cannot start until a chunk is closed, so the earliest any text can
// appear is chunk length + upload + inference. A streaming recogniser instead
// returns hypotheses while the person is still talking, which is what lets the
// caption run 2-3s behind live rather than 8.
//
// The socket lives here, not in the service worker: this is where the audio
// already is, and an MV3 worker can be evicted mid-sentence.

const DG_ENDPOINT = 'wss://api.deepgram.com/v1/listen';

let dgSocket = null;
let dgWorkletNode = null;
let dgKeepAlive = null;
let dgReconnectTimer = null;
let dgReconnectAttempt = 0;
let dgClosingIntentionally = false;
let dgConfig = null;
let dgSampleRate = 48000;
// Audio recorded while the socket is down. Bounded, because holding more than a
// couple of seconds would just replay stale speech after a reconnect.
let dgPending = [];
let dgPendingBytes = 0;
const DG_PENDING_MAX_BYTES = 2 * 48000 * 2; // ~2s of linear16 at 48kHz

function dgUrl(config) {
  const p = new URLSearchParams({
    model: config.dgModel || 'nova-2',
    encoding: 'linear16',
    sample_rate: String(dgSampleRate),
    channels: '1',
    interim_results: 'true',   // the whole point — partial text as it is spoken
    punctuate: 'true',
    smart_format: 'true',
    // Endpointing decides when a pause means "sentence over". 300ms clears an
    // ordinary mid-clause pause without waiting out a full stop.
    endpointing: String(config.dgEndpointing || 300)
  });
  const lang = config.sourceLang && config.sourceLang !== 'auto' ? config.sourceLang : null;
  if (lang) p.set('language', lang);
  else p.set('detect_language', 'true');
  return `${DG_ENDPOINT}?${p.toString()}`;
}

function startStreamingAsr(config, sourceNode) {
  dgConfig = config;
  dgClosingIntentionally = false;
  dgSampleRate = (audioCtx && audioCtx.sampleRate) || 48000;
  openDeepgramSocket();
  attachPcmTap(sourceNode);
}

function openDeepgramSocket() {
  const key = dgConfig && dgConfig.dgApiKey;
  if (!key) {
    console.error('🎙️ [Offscreen] Streaming ASR selected but no Deepgram key configured.');
    sendMessageWithRetry({ action: 'lt_error', error: 'Streaming ASR needs a Deepgram API key (Options → Speech engine).' }).catch(() => {});
    return;
  }

  try {
    // Browsers forbid custom headers on WebSocket, so the key rides in the
    // Sec-WebSocket-Protocol handshake instead. Deepgram documents exactly this
    // pair for client-side connections.
    dgSocket = new WebSocket(dgUrl(dgConfig), ['token', key]);
  } catch (err) {
    console.error('🎙️ [Offscreen] Could not open Deepgram socket:', err);
    scheduleDgReconnect();
    return;
  }

  dgSocket.binaryType = 'arraybuffer';

  dgSocket.onopen = () => {
    console.log('🎙️ [Offscreen] Streaming ASR connected.');
    dgReconnectAttempt = 0;
    sendMessageWithRetry({ action: 'lt_stream_state', state: 'connected' }).catch(() => {});
    // Flush whatever was captured while we were down.
    for (const buf of dgPending) {
      try { dgSocket.send(buf); } catch (_) {}
    }
    dgPending = [];
    dgPendingBytes = 0;
    // Deepgram closes an idle socket; a muted tab sends silence, not nothing.
    dgKeepAlive = setInterval(() => {
      if (dgSocket && dgSocket.readyState === WebSocket.OPEN) {
        try { dgSocket.send(JSON.stringify({ type: 'KeepAlive' })); } catch (_) {}
      }
    }, 8000);
  };

  dgSocket.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(typeof evt.data === 'string' ? evt.data : ''); } catch (_) { return; }
    if (!msg) return;

    if (msg.type === 'Results' || msg.channel) {
      const alt = msg.channel && msg.channel.alternatives && msg.channel.alternatives[0];
      const transcript = (alt && alt.transcript || '').trim();
      if (!transcript) return;

      // is_final: this wording is settled and will not be revised.
      // speech_final: the speaker also paused, so it is a sentence boundary.
      if (msg.is_final || msg.speech_final) {
        sendMessageWithRetry({
          action: 'lt_stream_final',
          text: transcript,
          speechFinal: !!msg.speech_final,
          config: dgConfig
        }).catch(() => {});
      } else {
        sendMessageWithRetry({
          action: 'lt_stream_interim',
          text: transcript,
          config: dgConfig
        }).catch(() => {});
      }
    } else if (msg.type === 'Metadata') {
      console.log('🎙️ [Offscreen] Deepgram metadata:', msg.request_id || '');
    }
  };

  dgSocket.onerror = (err) => {
    console.warn('🎙️ [Offscreen] Streaming ASR socket error:', err && err.message);
  };

  dgSocket.onclose = (evt) => {
    if (dgKeepAlive) { clearInterval(dgKeepAlive); dgKeepAlive = null; }
    if (dgClosingIntentionally) {
      console.log('🎙️ [Offscreen] Streaming ASR closed.');
      return;
    }
    // 1008/4001-4009 are Deepgram auth/param rejections: reconnecting with the
    // same bad key or bad params just loops, so surface it instead.
    const fatal = evt && (evt.code === 1008 || (evt.code >= 4000 && evt.code <= 4099));
    console.warn(`🎙️ [Offscreen] Streaming ASR closed (code ${evt && evt.code}).`);
    if (fatal) {
      sendMessageWithRetry({
        action: 'lt_error',
        error: `Streaming ASR rejected the connection (code ${evt.code}). Check the Deepgram key and language setting.`
      }).catch(() => {});
      return;
    }
    scheduleDgReconnect();
  };
}

function scheduleDgReconnect() {
  if (dgClosingIntentionally || dgReconnectTimer) return;
  dgReconnectAttempt = Math.min(dgReconnectAttempt + 1, 6);
  const delay = Math.min(500 * Math.pow(2, dgReconnectAttempt - 1), 15000);
  console.log(`🎙️ [Offscreen] Reconnecting streaming ASR in ${delay}ms (attempt ${dgReconnectAttempt}).`);
  sendMessageWithRetry({ action: 'lt_stream_state', state: 'reconnecting' }).catch(() => {});
  dgReconnectTimer = setTimeout(() => {
    dgReconnectTimer = null;
    if (!dgClosingIntentionally && audioStream) openDeepgramSocket();
  }, delay);
}

async function attachPcmTap(sourceNode) {
  try {
    await audioCtx.audioWorklet.addModule('./pcm-worklet.js');
  } catch (err) {
    console.error('🎙️ [Offscreen] Failed to load PCM worklet:', err);
    sendMessageWithRetry({ action: 'lt_error', error: 'Could not start the audio tap for streaming ASR.' }).catch(() => {});
    return;
  }

  dgWorkletNode = new AudioWorkletNode(audioCtx, 'pcm-tap', {
    numberOfInputs: 1,
    numberOfOutputs: 0
  });

  dgWorkletNode.port.onmessage = (e) => {
    const pcm = e.data;
    if (!pcm || !pcm.buffer) return;
    if (dgSocket && dgSocket.readyState === WebSocket.OPEN) {
      try { dgSocket.send(pcm.buffer); } catch (_) {}
      return;
    }
    // Socket is down — keep a short tail so a quick reconnect loses nothing.
    dgPending.push(pcm.buffer);
    dgPendingBytes += pcm.buffer.byteLength;
    while (dgPendingBytes > DG_PENDING_MAX_BYTES && dgPending.length) {
      dgPendingBytes -= dgPending.shift().byteLength;
    }
  };

  sourceNode.connect(dgWorkletNode);
  console.log(`🎙️ [Offscreen] PCM tap attached at ${dgSampleRate}Hz.`);
}

function stopStreamingAsr() {
  dgClosingIntentionally = true;

  if (dgReconnectTimer) { clearTimeout(dgReconnectTimer); dgReconnectTimer = null; }
  if (dgKeepAlive) { clearInterval(dgKeepAlive); dgKeepAlive = null; }

  if (dgWorkletNode) {
    try { dgWorkletNode.port.postMessage({ type: 'stop' }); } catch (_) {}
    try { dgWorkletNode.disconnect(); } catch (_) {}
    dgWorkletNode = null;
  }

  if (dgSocket) {
    try {
      if (dgSocket.readyState === WebSocket.OPEN) {
        // Ask for the tail of the transcript before dropping the connection.
        dgSocket.send(JSON.stringify({ type: 'CloseStream' }));
      }
      dgSocket.close();
    } catch (_) {}
    dgSocket = null;
  }

  dgPending = [];
  dgPendingBytes = 0;
  dgReconnectAttempt = 0;
  dgConfig = null;
}

async function processAudioBlob(blob, config, hasSound, maxRms, avgRms, durationMs) {
  const currentSeq = chunkSeq++;
  console.log(`🎙️ [Offscreen] Segment ${currentSeq} confirmed (${durationMs}ms) — sending to background.`);

  const reader = new FileReader();
  reader.onloadend = () => {
    const base64Data = reader.result.split(',')[1];
    sendMessageWithRetry({
      action: 'lt_process_audio',
      audioBase64: base64Data,
      config: config,
      seq: currentSeq,
      hasSound: hasSound,
      maxRms: maxRms,
      avgRms: avgRms,
      durationMs: durationMs
    }).catch((e) => console.error('🎙️ [Offscreen] Failed to send process_audio:', e));
  };
  reader.readAsDataURL(blob);
}

function stopCapture() {
  console.log('🎙️ [Offscreen] Stopping tab capture...');

  try {
    stopStreamingAsr();
  } catch (_) {}

  try {
    stopTtsAudio();
  } catch (_) {}

  window._playbackGainNode = null;

  if (window._vadInterval) {
    clearInterval(window._vadInterval);
    window._vadInterval = null;
  }

  if (activeIntervalId) {
    clearInterval(activeIntervalId);
    activeIntervalId = null;
  }

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  if (recorders) {
    recorders.forEach((rec, idx) => {
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch (_) {}
      }
    });
    recorders = [null, null];
  }
  mediaRecorder = null; // Legacy compatibility

  if (audioStream) {
    audioStream.getTracks().forEach(track => {
      track.onended = null; // Prevent programmatic stop from triggering onended listener recursively
      try {
        track.stop();
      } catch (_) {}
    });
    audioStream = null;
  }

  if (audioCtx) {
    try {
      audioCtx.close();
    } catch (_) {}
    audioCtx = null;
  }
}


