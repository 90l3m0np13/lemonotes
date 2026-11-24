import type { Settings, TrackKind } from '@shared/types'

export type AudioLevels = {
  mic: number
  system: number
  mixed: number
}

export type PcmCallback = (track: TrackKind, samples: Int16Array, sampleRate: number) => void
export type LevelCallback = (levels: AudioLevels) => void

function toInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length)
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0))
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return output
}

function rms(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer)
  let sum = 0
  for (let index = 0; index < buffer.length; index += 1) {
    const value = buffer[index] ?? 0
    sum += value * value
  }
  const value = Math.sqrt(sum / buffer.length)
  return Math.min(1, Math.pow(value * 4.2, 0.7))
}

export class AudioEngine {
  private context: AudioContext | null = null
  private streams: MediaStream[] = []
  private micStream: MediaStream | null = null
  private systemStream: MediaStream | null = null
  private nodes: AudioNode[] = []
  private worklets: AudioWorkletNode[] = []
  private analysers: { mic?: AnalyserNode; system?: AnalyserNode; mixed?: AnalyserNode } = {}
  private levelTimer: number | null = null
  private buffer: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(1024 * 4))
  private onPcm: PcmCallback
  private onLevels: LevelCallback
  private muted = false
  private active = false

  constructor(options: { onPcm: PcmCallback; onLevels: LevelCallback }) {
    this.onPcm = options.onPcm
    this.onLevels = options.onLevels
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 16000
  }

  get isActive(): boolean {
    return this.active
  }

  get hasSystemAudio(): boolean {
    return Boolean(this.systemStream?.getAudioTracks().length)
  }

  get hasMicrophone(): boolean {
    return Boolean(this.micStream?.getAudioTracks().length)
  }

  async prepare(settings: Settings): Promise<{ warning: string | null }> {
    if (this.context) await this.stop()
    const contextOptions: AudioContextOptions = {
      latencyHint: 'interactive',
      sampleRate: 16000
    }
    let context: AudioContext
    try {
      context = new AudioContext(contextOptions)
    } catch {
      context = new AudioContext({ latencyHint: 'interactive' })
    }
    this.context = context
    await context.audioWorklet.addModule(new URL('pcm-worklet.js', document.baseURI).toString())
    this.mixedBus = context.createGain()
    this.mixedBus.gain.value = 1
    this.nodes.push(this.mixedBus)

    const micConstraints: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
    if (settings.micDeviceId) {
      micConstraints.deviceId = { exact: settings.micDeviceId }
    }
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints, video: false })
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        })
      } else {
        await this.stop()
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          throw new Error(
            'El micrófono no tiene permiso. Windows lo ha cerrado con llave. Actívalo en Privacidad y seguridad → Micrófono y vuelve a intentarlo.'
          )
        }
        throw new Error(
          'No encuentro un micrófono que funcione. Conecta uno y dale otra oportunidad al limón.'
        )
      }
    }
    this.streams.push(this.micStream)

    let warning: string | null = null
    if (settings.includeSystemAudio) {
      try {
        // En algunos equipos Windows Graphics Capture falla al iniciar la
        // pantalla (NotReadableError) y se lleva por delante el loopback.
        // Solo necesitamos la pista de audio, así que no pedimos vídeo.
        try {
          this.systemStream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: false
          })
        } catch {
          this.systemStream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 1 },
            audio: true
          })
        }
        const audioTracks = this.systemStream.getAudioTracks()
        if (!audioTracks.length) {
          for (const track of this.systemStream.getTracks()) track.stop()
          this.systemStream = null
          warning =
            'Windows no ha entregado el audio del equipo. Sigo con el micrófono; si querías capturar la reunión, revisa la fuente de pantalla y el volumen del sistema.'
        } else {
          for (const track of this.systemStream.getVideoTracks()) {
            track.enabled = false
          }
          this.streams.push(this.systemStream)
        }
      } catch {
        this.systemStream = null
        warning =
          'No he podido escuchar el audio del equipo. La nota sigue con el micrófono; si lo necesitas, elige otra pantalla en la fuente del sistema.'
      }
    }

    if (this.micStream) {
      const micSource = context.createMediaStreamSource(this.micStream)
      const micGain = context.createGain()
      micGain.gain.value = settings.micGain
      micSource.connect(micGain)
      this.nodes.push(micSource, micGain)

      const micAnalyser = context.createAnalyser()
      micAnalyser.fftSize = 1024
      micAnalyser.smoothingTimeConstant = 0.65
      micGain.connect(micAnalyser)
      this.analysers.mic = micAnalyser

      const micWorklet = this.makeWorklet(context, 'mic')
      micGain.connect(micWorklet)
      if (settings.preserveTracks) this.worklets.push(micWorklet)

      this.addMixedSource(context, micGain, settings.micGain, 'micGain')
    }

    if (this.systemStream) {
      const systemSource = context.createMediaStreamSource(this.systemStream)
      const systemGain = context.createGain()
      systemGain.gain.value = settings.systemGain
      systemSource.connect(systemGain)
      this.nodes.push(systemSource, systemGain)

      const systemAnalyser = context.createAnalyser()
      systemAnalyser.fftSize = 1024
      systemAnalyser.smoothingTimeConstant = 0.65
      systemGain.connect(systemAnalyser)
      this.analysers.system = systemAnalyser

      const systemWorklet = this.makeWorklet(context, 'system')
      systemGain.connect(systemWorklet)
      if (settings.preserveTracks) this.worklets.push(systemWorklet)

      this.addMixedSource(context, systemGain, settings.systemGain, 'systemGain')
    }

    const mixedWorklet = this.makeWorklet(context, 'mixed')
    this.mixedBus.connect(mixedWorklet)
    this.worklets.push(mixedWorklet)
    const mixedAnalyser = context.createAnalyser()
    mixedAnalyser.fftSize = 1024
    mixedAnalyser.smoothingTimeConstant = 0.65
    this.mixedBus.connect(mixedAnalyser)
    this.analysers.mixed = mixedAnalyser

    const sink = context.createGain()
    sink.gain.value = 0
    for (const worklet of this.worklets) worklet.connect(sink)
    sink.connect(context.destination)
    this.nodes.push(sink)

    if (context.state === 'suspended') await context.resume()
    this.startLevels()
    return { warning }
  }

  private mixedBus: GainNode | null = null

  private addMixedSource(
    _context: AudioContext,
    source: AudioNode,
    _gain: number,
    _kind: 'micGain' | 'systemGain'
  ): void {
    if (!this.mixedBus) return
    source.connect(this.mixedBus)
  }

  private makeWorklet(context: AudioContext, track: TrackKind): AudioWorkletNode {
    const node = new AudioWorkletNode(context, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit'
    })
    node.port.onmessage = (event: MessageEvent<{ type: string; samples: Float32Array; sampleRate: number }>) => {
      if (event.data?.type !== 'pcm') return
      if (this.muted) return
      const samples = event.data.samples
      this.onPcm(track, toInt16(samples), Math.round(event.data.sampleRate))
    }
    return node
  }

  private startLevels(): void {
    if (this.levelTimer) window.clearInterval(this.levelTimer)
    this.levelTimer = window.setInterval(() => {
      const mic = this.analysers.mic ? rms(this.analysers.mic, this.buffer) : 0
      const system = this.analysers.system ? rms(this.analysers.system, this.buffer) : 0
      const mixed = this.analysers.mixed ? rms(this.analysers.mixed, this.buffer) : Math.max(mic, system)
      this.onLevels({ mic, system, mixed })
    }, 90)
  }

  setGain(kind: 'mic' | 'system' | 'master', value: number): void {
    // Los gains se fijan al preparar. Este método queda para ajustes en caliente sencillos.
    if (kind === 'master' && this.mixedBus) this.mixedBus.gain.value = Math.min(2, Math.max(0, value))
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  async start(): Promise<void> {
    this.active = true
    this.muted = false
    if (this.context?.state === 'suspended') await this.context.resume()
  }

  async pause(): Promise<void> {
    // Seguimos leyendo los analizadores para poder reanudar automáticamente por voz.
    this.muted = true
  }

  async resume(): Promise<void> {
    this.muted = false
    if (this.context?.state === 'suspended') await this.context.resume()
  }

  async stop(): Promise<void> {
    this.active = false
    this.muted = true
    if (this.levelTimer) window.clearInterval(this.levelTimer)
    this.levelTimer = null
    for (const worklet of this.worklets) {
      try {
        worklet.disconnect()
        worklet.port.close()
      } catch {
        // ya desconectado
      }
    }
    this.worklets = []
    for (const node of this.nodes) {
      try {
        node.disconnect()
      } catch {
        // ya desconectado
      }
    }
    this.nodes = []
    for (const stream of this.streams) {
      for (const track of stream.getTracks()) track.stop()
    }
    this.streams = []
    this.micStream = null
    this.systemStream = null
    this.analysers = {}
    this.mixedBus = null
    if (this.context) {
      try {
        await this.context.close()
      } catch {
        // el contexto ya estaba cerrado
      }
      this.context = null
    }
  }

  async listMicrophones(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((device) => device.kind === 'audioinput')
  }
}
