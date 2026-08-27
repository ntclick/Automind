// PCM tap for streaming ASR ("dịch cabin").
//
// The batch path records WebM/Opus through MediaRecorder, which cannot produce a
// continuous sample stream — a chunk only exists once it is closed, which is the
// floor on how early any text can appear. Streaming ASR instead wants raw PCM
// pushed continuously, so this taps the same post-compressor signal the batch
// path used and emits linear16 frames.
//
// Runs on the audio thread. A ScriptProcessorNode would do the same job on the
// main thread, where a busy page can starve it and drop audio mid-word.

const OUT_FRAMES = 2048; // ~43ms at 48kHz — small enough to stay responsive,
                         // large enough that we are not posting every 2.6ms.

class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(OUT_FRAMES);
    this._n = 0;
    this._running = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'stop') this._running = false;
    };
  }

  process(inputs) {
    if (!this._running) return false; // let the node be collected

    const input = inputs[0];
    // No input connected yet, or a silent render quantum: keep the node alive.
    if (!input || input.length === 0 || !input[0]) return true;

    const ch = input[0]; // mono — the capture graph is already summed
    for (let i = 0; i < ch.length; i++) {
      this._buf[this._n++] = ch[i];
      if (this._n === OUT_FRAMES) {
        this.port.postMessage(this._toInt16(this._buf), []);
        this._n = 0;
      }
    }
    return true;
  }

  /** Float32 [-1,1] -> Int16 little-endian, which is Deepgram's `linear16`. */
  _toInt16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      // Clamp before scaling: values slightly outside [-1,1] wrap around to the
      // opposite sign as Int16 and are heard as a loud click.
      const s = f32[i] < -1 ? -1 : f32[i] > 1 ? 1 : f32[i];
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
}

registerProcessor('pcm-tap', PcmTap);
