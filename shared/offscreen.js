let mediaRecorder = null;
let recorders = [null, null];
let currentRecorderIndex = 0;
let activeIntervalId = null;
let audioStream = null;
let audioCtx = null;
let intervalId = null;
let webSpeechRec = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.action === 'ping') {
    if (sendResponse) sendResponse({ alive: true });
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

async function startCapture(streamId, config) {
  stopCapture(); // Ensure previous capture is fully cleaned up

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
    chrome.runtime.sendMessage({
      action: 'lt_error',
      error: 'Capture failed: ' + err.message
    });
    return;
  }

  audioStream = stream;
  audioCtx = context;
  console.log('🎙️ [Offscreen] Parallel setup completed. Active tracks:', stream.getAudioTracks().length);

  // Resume AudioContext immediately if suspended
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(e => console.warn('🎙️ [Offscreen] AudioContext resume warning:', e));
  }

  // Register onended listener on tracks to handle tab navigation, close, or reload
  stream.getAudioTracks().forEach(track => {
    track.onended = () => {
      console.warn('🎙️ [Offscreen] Audio track ended (tab navigated, reloaded, or closed).');
      stopCapture();
      chrome.runtime.sendMessage({ action: 'lt_tab_stop' }).catch(() => {});
    };
  });

  const source = audioCtx.createMediaStreamSource(stream);

  // ─── GainNode 1: CAPTURE path — NEVER modified ───────────────────────
  // Always gain = 1.0 so Whisper always receives full audio regardless
  // of whether the user mutes playback or TTS is enabled.
  const captureGain = audioCtx.createGain();
  captureGain.gain.value = 1.0;
  source.connect(captureGain);
  const captureDestination = audioCtx.createMediaStreamDestination();
  captureGain.connect(captureDestination);

  // ─── GainNode 2: PLAYBACK path — user-controlled ─────────────────────
  // This is what the user hears. Setting to 0 mutes the tab without
  // disrupting the capture pipeline.
  const playbackGain = audioCtx.createGain();
  source.connect(playbackGain);
  playbackGain.connect(audioCtx.destination);
  window._playbackGainNode = playbackGain;

  // Set initial playback volume based on config passed from background script
  const isTtsEnabled = !!config.ltTtsEnabled;
  const isMuted = !!config.ltMuteTab;
  playbackGain.gain.value = (isTtsEnabled || isMuted) ? 0.0 : 1.0;
  console.log(`🎙️ [Offscreen] Initial playback gain: ${playbackGain.gain.value} (TTS:${isTtsEnabled} Muted:${isMuted})`);

  // ─── VAD: AnalyserNode on CAPTURE path ───────────────────────────────
  // Highly sensitive VAD settings to prevent missing quiet or short speech segments.
  const VAD_THRESHOLD = 0.012; // Highly sensitive threshold
  const VAD_MIN_FRAMES = 1;    // Frame threshold to prevent clip start consonant sounds

  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  const vadBuffer = new Float32Array(analyser.fftSize);
  source.connect(analyser);

  let hasSoundInSegment = false;
  let soundFrameCount = 0;

  // Poll volume every 75ms — optimal CPU-performance compromise
  const vadInterval = setInterval(() => {
    if (!audioStream) return;
    analyser.getFloatTimeDomainData(vadBuffer);
    let sum = 0;
    for (let i = 0; i < vadBuffer.length; i++) {
      sum += vadBuffer[i] * vadBuffer[i];
    }
    const rms = Math.sqrt(sum / vadBuffer.length);

    if (rms > VAD_THRESHOLD) {
      soundFrameCount++;
      if (soundFrameCount >= VAD_MIN_FRAMES) {
        hasSoundInSegment = true; // Only flag real speech after sustained signal
      }
    } else {
      soundFrameCount = 0; // Reset counter on silence
    }
  }, 75);

  window._vadInterval = vadInterval;

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
      const hasSound = hasSoundInSegment;
      hasSoundInSegment = false; // Reset immediately for next segment
      soundFrameCount = 0;
      const blob = event.data;

      console.log(`🎙️ [Offscreen] Recorder ${index} WebM blob emitted. Size: ${blob.size} bytes. VAD sound: ${hasSound}`);

      if (blob.size < 1000) {
        console.warn(`🎙️ [Offscreen] Skipping extremely small audio segment (${blob.size} bytes).`);
        return;
      }

      await processAudioBlob(blob, config, hasSound);
    }
  };

  recorderA.ondataavailable = (event) => handleRecorderData(event, 0);
  recorderB.ondataavailable = (event) => handleRecorderData(event, 1);

  const sliceInterval = typeof config.segmentDuration === 'number' ? config.segmentDuration : 2500;
  console.log(`🎙️ [Offscreen] Setting Ping-Pong recording interval to ${sliceInterval}ms`);

  try {
    // Start the first recorder
    if (recorders[0] && recorders[0].state === 'inactive') {
      recorders[0].start();
      console.log(`🎙️ [Offscreen] Recorder 0 started.`);
      // Broadcast ready signal to background script immediately
      chrome.runtime.sendMessage({ action: 'lt_capture_ready' }).catch(() => {});
    }

    // Set up the swapping interval
    activeIntervalId = setInterval(() => {
      const nextIndex = 1 - currentRecorderIndex;
      console.log(`🎙️ [Offscreen] Swapping recorders: ${currentRecorderIndex} -> ${nextIndex}`);

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
          console.error('🎙️ [Offscreen] Recorder destroyed, stopping interval.');
          clearInterval(activeIntervalId);
          activeIntervalId = null;
          chrome.runtime.sendMessage({ action: 'lt_tab_stop' }).catch(() => {});
          return;
        }
        
        // 2. Stop the current recorder to trigger ondataavailable and generate a valid WebM chunk
        const currentRec = recorders[currentRecorderIndex];
        currentRecorderIndex = nextIndex;
        
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
    }, sliceInterval);
  } catch (err) {
    console.error('🎙️ [Offscreen] Error starting first MediaRecorder:', err);
    stopCapture();
  }
}

async function processAudioBlob(blob, config, hasSound) {
  // Direct tab audio capturing has zero microphone ambient/room noise.
  // We bypass VAD entirely for tab capture.
  console.log(`🎙️ [Offscreen] Segment confirmed — sending segment to background.`);

  const reader = new FileReader();
  reader.onloadend = () => {
    const base64Data = reader.result.split(',')[1];
    chrome.runtime.sendMessage({
      action: 'lt_process_audio',
      audioBase64: base64Data,
      config: config
    });
  };
  reader.readAsDataURL(blob);
}

function stopCapture() {
  console.log('🎙️ [Offscreen] Stopping tab capture...');

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


