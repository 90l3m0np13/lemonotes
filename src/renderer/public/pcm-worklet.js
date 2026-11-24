const TARGET_RATE = 16000

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.nextSourcePosition = 0
    this.chunk = []
    this.chunkLength = 0
    this.chunkTarget = 2048
  }

  pushSample(sample) {
    this.chunk.push(sample)
    this.chunkLength += 1
    if (this.chunkLength >= this.chunkTarget) {
      const out = new Float32Array(this.chunkLength)
      for (let i = 0; i < this.chunkLength; i += 1) out[i] = this.chunk[i]
      this.port.postMessage({ type: 'pcm', samples: out, sampleRate: TARGET_RATE }, [out.buffer])
      this.chunk = []
      this.chunkLength = 0
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const frameLength = input[0].length
    if (!frameLength) return true

    const mixed = new Float32Array(frameLength)
    for (let channel = 0; channel < input.length; channel += 1) {
      const data = input[channel]
      for (let i = 0; i < frameLength; i += 1) {
        mixed[i] += data[i] / input.length
      }
    }

    if (Math.abs(sampleRate - TARGET_RATE) < 1) {
      for (let i = 0; i < mixed.length; i += 1) this.pushSample(mixed[i])
      return true
    }

    const ratio = sampleRate / TARGET_RATE
    while (this.nextSourcePosition < mixed.length) {
      const index = Math.floor(this.nextSourcePosition)
      const fraction = this.nextSourcePosition - index
      const a = mixed[index] ?? 0
      const b = mixed[index + 1] ?? a
      this.pushSample(a + (b - a) * fraction)
      this.nextSourcePosition += ratio
    }
    this.nextSourcePosition -= mixed.length
    return true
  }
}

registerProcessor('pcm-capture', PCMCaptureProcessor)
