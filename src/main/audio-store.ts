import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { AudioBeginInput, AudioMeta, TrackKind, TrackMeta } from '../shared/types'
import type { Vault } from './vault'

interface OpenTrack {
  fd: number
  wavPath: string
  bytes: number
}

interface OpenSession {
  sessionId: string
  sampleRate: number
  tracks: Map<TrackKind, OpenTrack>
  startedAt: number
}

function wavHeader(sampleRate: number, dataBytes = 0): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return header
}

function patchWavHeader(wavPath: string): number {
  const stat = fs.statSync(wavPath)
  const dataBytes = Math.max(0, stat.size - 44)
  const fd = fs.openSync(wavPath, 'r+')
  try {
    const probe = Buffer.alloc(8)
    fs.readSync(fd, probe, 0, 8, 24)
    const sampleRate = probe.readUInt32LE(0) || 16000
    fs.writeSync(fd, wavHeader(sampleRate, dataBytes), 0, 44, 0)
  } finally {
    fs.closeSync(fd)
  }
  return dataBytes
}

export class AudioStore {
  private readonly dataDir: string
  private readonly vault: Vault
  private readonly getSessionAudio: (id: string) => AudioMeta | null
  private readonly setSessionAudio: (id: string, meta: AudioMeta | null) => void
  private readonly open = new Map<string, OpenSession>()
  private readonly cacheDir: string
  private readonly audioDir: string
  private readonly tempDir: string

  constructor(options: {
    dataDir: string
    vault: Vault
    getSessionAudio: (id: string) => AudioMeta | null
    setSessionAudio: (id: string, meta: AudioMeta | null) => void
  }) {
    this.dataDir = options.dataDir
    this.vault = options.vault
    this.getSessionAudio = options.getSessionAudio
    this.setSessionAudio = options.setSessionAudio
    this.cacheDir = path.join(this.dataDir, 'cache', 'audio')
    this.audioDir = path.join(this.dataDir, 'audio')
    this.tempDir = path.join(this.dataDir, 'tmp', 'recording')
    fs.mkdirSync(this.cacheDir, { recursive: true })
    fs.mkdirSync(this.audioDir, { recursive: true })
    fs.mkdirSync(this.tempDir, { recursive: true })
  }

  async begin(input: AudioBeginInput): Promise<{ ok: boolean; sampleRate: number }> {
    const sessionId = input.sessionId
    if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new Error('Sesión de audio no válida.')
    if (!Number.isFinite(input.sampleRate) || input.sampleRate < 8000 || input.sampleRate > 96000) {
      throw new Error('Frecuencia de muestreo no válida.')
    }
    await this.finish(sessionId, { discard: true }).catch(() => undefined)
    const sessionDir = path.join(this.tempDir, sessionId)
    await fsp.rm(sessionDir, { recursive: true, force: true })
    await fsp.mkdir(sessionDir, { recursive: true })
    const tracks = new Map<TrackKind, OpenTrack>()
    for (const track of input.tracks) {
      if (!['mixed', 'mic', 'system'].includes(track)) continue
      const wavPath = path.join(sessionDir, `${track}.wav`)
      const fd = fs.openSync(wavPath, 'w+')
      fs.writeSync(fd, wavHeader(input.sampleRate, 0))
      tracks.set(track, { fd, wavPath, bytes: 0 })
    }
    this.open.set(sessionId, {
      sessionId,
      sampleRate: input.sampleRate,
      tracks,
      startedAt: Date.now()
    })
    return { ok: true, sampleRate: input.sampleRate }
  }

  append(sessionId: string, track: TrackKind, data: ArrayBuffer): number {
    const session = this.open.get(sessionId)
    if (!session) throw new Error('La captura de audio no está abierta.')
    const target = session.tracks.get(track)
    if (!target) return 0
    const buffer = Buffer.from(data)
    const even = buffer.byteLength - (buffer.byteLength % 2)
    if (even <= 0) return 0
    fs.writeSync(target.fd, buffer, 0, even)
    target.bytes += even
    return even
  }

  hasSession(sessionId: string): boolean {
    return this.open.has(sessionId)
  }

  async finish(sessionId: string, options: { discard?: boolean } = {}): Promise<AudioMeta | null> {
    const session = this.open.get(sessionId)
    if (!session) return this.getSessionAudio(sessionId) ?? null
    this.open.delete(sessionId)
    const tracks: Partial<Record<TrackKind, TrackMeta>> = {}
    for (const [kind, track] of session.tracks) {
      try {
        fs.fsyncSync(track.fd)
      } catch {
        // El fsync es una garantía adicional; el cierre sigue siendo necesario.
      }
      fs.closeSync(track.fd)
      patchWavHeader(track.wavPath)
      const dataBytes = Math.max(0, fs.statSync(track.wavPath).size - 44)
      if (dataBytes < 3200 || options.discard) continue
      const destination = path.join(this.audioDir, sessionId, `${kind}.lemonaudio`)
      const originalBytes = await this.vault.encryptFile(track.wavPath, destination)
      tracks[kind] = {
        fileName: `${sessionId}/${kind}.lemonaudio`,
        bytes: originalBytes,
        durationMs: Math.round((dataBytes / 2 / session.sampleRate) * 1000)
      }
    }
    await fsp.rm(path.join(this.tempDir, sessionId), { recursive: true, force: true })
    if (options.discard || Object.keys(tracks).length === 0) {
      this.setSessionAudio(sessionId, null)
      if (options.discard) await this.deleteFiles(sessionId)
      return null
    }
    const meta: AudioMeta = {
      sampleRate: session.sampleRate,
      tracks,
      savedAt: Date.now()
    }
    this.setSessionAudio(sessionId, meta)
    return meta
  }

  async extractRangeWav(sessionId: string, startMs: number, endMs: number, destination: string): Promise<boolean> {
    const session = this.open.get(sessionId)
    if (!session) return false
    const mixed = session.tracks.get('mixed')
    if (!mixed) return false
    const startBytes = Math.max(0, Math.round((startMs / 1000) * session.sampleRate) * 2)
    const endBytes = Math.max(startBytes, Math.round((endMs / 1000) * session.sampleRate) * 2)
    const dataBytes = Math.max(0, Math.min(endBytes, mixed.bytes) - startBytes)
    if (dataBytes < 3200) return false
    const buffer = Buffer.alloc(dataBytes)
    const read = fs.readSync(mixed.fd, buffer, 0, dataBytes, 44 + startBytes)
    if (read <= 0) return false
    await fsp.mkdir(path.dirname(destination), { recursive: true })
    await fsp.writeFile(destination, Buffer.concat([wavHeader(session.sampleRate, read), buffer.subarray(0, read)]))
    return true
  }

  readTempWav(sessionId: string, track: TrackKind): string | null {
    const session = this.open.get(sessionId)
    return session?.tracks.get(track)?.wavPath ?? null
  }

  async deleteAudio(sessionId: string): Promise<void> {
    const openSession = this.open.get(sessionId)
    if (openSession) {
      this.open.delete(sessionId)
      for (const track of openSession.tracks.values()) {
        try {
          fs.closeSync(track.fd)
        } catch {
          // ya estaba cerrado
        }
      }
    }
    await this.deleteFiles(sessionId)
  }

  private async deleteFiles(sessionId: string): Promise<void> {
    await fsp.rm(path.join(this.audioDir, sessionId), { recursive: true, force: true })
    await fsp.rm(path.join(this.tempDir, sessionId), { recursive: true, force: true })
    for (const track of ['mixed', 'mic', 'system'] as TrackKind[]) {
      await fsp.rm(path.join(this.cacheDir, `${sessionId}-${track}.wav`), { force: true })
    }
    this.setSessionAudio(sessionId, null)
  }

  async playbackFile(sessionId: string, track: TrackKind): Promise<string | null> {
    const meta = this.getSessionAudio(sessionId)
    const trackMeta = meta?.tracks[track]
    if (!trackMeta) return null
    const cache = path.join(this.cacheDir, `${sessionId}-${track}.wav`)
    try {
      const stat = await fsp.stat(cache)
      if (stat.size > 44) return cache
    } catch {
      // se descifra a continuación
    }
    const encrypted = path.join(this.audioDir, trackMeta.fileName)
    await this.vault.decryptFile(encrypted, cache)
    return cache
  }

  async clearCache(): Promise<void> {
    await fsp.rm(this.cacheDir, { recursive: true, force: true })
    await fsp.mkdir(this.cacheDir, { recursive: true })
  }

  async recoverInterrupted(): Promise<string[]> {
    const recovered: string[] = []
    let entries: fs.Dirent[] = []
    try {
      entries = await fsp.readdir(this.tempDir, { withFileTypes: true })
    } catch {
      return recovered
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sessionId = entry.name
      const mixedPath = path.join(this.tempDir, sessionId, 'mixed.wav')
      if (!fs.existsSync(mixedPath)) continue
      const dataBytes = patchWavHeader(mixedPath)
      if (dataBytes < 3200) continue
      const header = Buffer.alloc(44)
      const fd = fs.openSync(mixedPath, 'r')
      fs.readSync(fd, header, 0, 44, 0)
      fs.closeSync(fd)
      const sampleRate = header.readUInt32LE(24) || 16000
      const tracks: Partial<Record<TrackKind, TrackMeta>> = {}
      for (const kind of ['mixed', 'mic', 'system'] as TrackKind[]) {
        const wavPath = path.join(this.tempDir, sessionId, `${kind}.wav`)
        if (!fs.existsSync(wavPath)) continue
        patchWavHeader(wavPath)
        const bytes = Math.max(0, fs.statSync(wavPath).size - 44)
        if (bytes < 3200) continue
        const destination = path.join(this.audioDir, sessionId, `${kind}.lemonaudio`)
        const originalBytes = await this.vault.encryptFile(wavPath, destination)
        tracks[kind] = {
          fileName: `${sessionId}/${kind}.lemonaudio`,
          bytes: originalBytes,
          durationMs: Math.round((bytes / 2 / sampleRate) * 1000)
        }
      }
      if (Object.keys(tracks).length) {
        this.setSessionAudio(sessionId, { sampleRate, tracks, savedAt: Date.now() })
      }
      await fsp.rm(path.join(this.tempDir, sessionId), { recursive: true, force: true })
      recovered.push(sessionId)
    }
    return recovered
  }
}
