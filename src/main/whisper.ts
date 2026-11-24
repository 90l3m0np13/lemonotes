import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import https from 'node:https'
import os from 'node:os'
import { spawn } from 'node:child_process'
import AdmZip from 'adm-zip'
import type { DownloadProgress, TranscriptSegment, WhisperModelInfo, WhisperStatus } from '../shared/types'
import type { Database } from './db'

const WHISPER_VERSION = 'v1.9.1'
const WHISPER_ZIP_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

const MODEL_CATALOG: Array<Omit<WhisperModelInfo, 'downloaded' | 'bundled'>> = [
  {
    id: 'tiny',
    label: 'Tiny',
    fileName: 'ggml-tiny.bin',
    sizeMb: 75,
    description: 'Muy rápido, ideal para notas cortas. Entiende español, pero se le escapan los matices.'
  },
  {
    id: 'base',
    label: 'Base',
    fileName: 'ggml-base.bin',
    sizeMb: 142,
    description: 'El equilibrio de la casa: rápido y bastante bueno para reuniones normales.'
  },
  {
    id: 'small',
    label: 'Small',
    fileName: 'ggml-small.bin',
    sizeMb: 466,
    description: 'Más orejas para acentos y ruido. Necesita más CPU y una descarga más larga.'
  }
]

interface QueuedJob {
  id: string
  sessionId: string
  wavPath: string
  startMs: number
  endMs: number
  language: string
  attempts: number
}

interface JobResult {
  text: string
  segments: Array<{ startMs: number; endMs: number; text: string }>
}

export interface WhisperCallbacks {
  onSegment: (sessionId: string, segment: TranscriptSegment) => void
  onError: (sessionId: string, message: string) => void
  onProgress: (progress: DownloadProgress) => void
}

export class WhisperService {
  private readonly dataDir: string
  private readonly appPath: string
  private readonly resourcesPath: string
  private readonly db: Database
  private readonly callbacks: WhisperCallbacks
  private readonly runtimeDir: string
  private readonly userModelsDir: string
  private readonly downloadsDir: string
  private readonly customBinFile: string
  private customBinPath = ''
  private readonly jobs: QueuedJob[] = []
  private running = false
  private waiters = new Map<string, Array<() => void>>()
  private activeJob: QueuedJob | null = null
  private readonly modelSizes = new Map([
    ['tiny', 77704715],
    ['base', 147951465],
    ['small', 487601967]
  ])

  constructor(options: {
    dataDir: string
    appPath: string
    resourcesPath: string
    db: Database
    callbacks: WhisperCallbacks
  }) {
    this.dataDir = options.dataDir
    this.appPath = options.appPath
    this.resourcesPath = options.resourcesPath
    this.db = options.db
    this.callbacks = options.callbacks
    this.runtimeDir = path.join(this.dataDir, 'whisper', 'runtime')
    this.userModelsDir = path.join(this.dataDir, 'whisper', 'models')
    this.downloadsDir = path.join(this.dataDir, 'whisper', 'downloads')
    this.customBinFile = path.join(this.dataDir, 'whisper', 'custom-bin.txt')
    fs.mkdirSync(this.runtimeDir, { recursive: true })
    fs.mkdirSync(this.userModelsDir, { recursive: true })
    fs.mkdirSync(this.downloadsDir, { recursive: true })
    try {
      const saved = fs.readFileSync(this.customBinFile, 'utf8').trim()
      if (saved && fs.existsSync(saved)) this.customBinPath = saved
    } catch {
      // sin binario personalizado
    }
  }

  setCustomBinary(binPath: string): WhisperStatus {
    if (!fs.existsSync(binPath)) throw new Error('Ese whisper-cli.exe no existe.')
    this.customBinPath = binPath
    fs.mkdirSync(path.dirname(this.customBinFile), { recursive: true })
    fs.writeFileSync(this.customBinFile, binPath, 'utf8')
    return this.status()
  }

  private bundledRuntimeDir(): string {
    if (process.env.WHISPER_BIN) return path.dirname(process.env.WHISPER_BIN)
    const packaged = path.join(this.resourcesPath, 'whisper')
    if (fs.existsSync(path.join(packaged, 'whisper-cli.exe'))) return packaged
    const dev = path.join(this.appPath, 'resources', 'whisper')
    if (fs.existsSync(path.join(dev, 'whisper-cli.exe'))) return dev
    const unpacked = path.join(this.resourcesPath, 'app.asar.unpacked', 'resources', 'whisper')
    if (fs.existsSync(path.join(unpacked, 'whisper-cli.exe'))) return unpacked
    return ''
  }

  private bundledModelPath(fileName: string): string {
    const packaged = path.join(this.resourcesPath, 'models', fileName)
    if (fs.existsSync(packaged)) return packaged
    const dev = path.join(this.appPath, 'resources', 'models', fileName)
    if (fs.existsSync(dev)) return dev
    const unpacked = path.join(this.resourcesPath, 'app.asar.unpacked', 'resources', 'models', fileName)
    if (fs.existsSync(unpacked)) return unpacked
    return ''
  }

  resolveBinary(): { path: string; source: 'bundled' | 'downloaded' | 'custom' | 'missing' } {
    if (process.env.WHISPER_BIN && fs.existsSync(process.env.WHISPER_BIN)) {
      return { path: process.env.WHISPER_BIN, source: 'custom' }
    }
    if (this.customBinPath && fs.existsSync(this.customBinPath)) {
      return { path: this.customBinPath, source: 'custom' }
    }
    const downloaded = path.join(this.runtimeDir, 'whisper-cli.exe')
    if (fs.existsSync(downloaded)) return { path: downloaded, source: 'downloaded' }
    const bundled = this.bundledRuntimeDir()
    if (bundled && fs.existsSync(path.join(bundled, 'whisper-cli.exe'))) {
      return { path: path.join(bundled, 'whisper-cli.exe'), source: 'bundled' }
    }
    return { path: '', source: 'missing' }
  }

  resolveModel(selectedId: string): { path: string; id: string } {
    if (process.env.WHISPER_MODEL && fs.existsSync(process.env.WHISPER_MODEL)) {
      return { path: process.env.WHISPER_MODEL, id: path.basename(process.env.WHISPER_MODEL) }
    }
    const ordered = [selectedId, 'base', 'small', 'tiny'].filter(Boolean)
    for (const id of [...new Set(ordered)]) {
      const model = MODEL_CATALOG.find((item) => item.id === id)
      if (!model) continue
      const user = path.join(this.userModelsDir, model.fileName)
      if (fs.existsSync(user)) return { path: user, id: model.id }
      const bundled = this.bundledModelPath(model.fileName)
      if (bundled) return { path: bundled, id: model.id }
    }
    return { path: '', id: '' }
  }

  status(): WhisperStatus {
    const binary = this.resolveBinary()
    const selected = this.db.getSettings().selectedWhisperModel
    const model = this.resolveModel(selected)
    const models = MODEL_CATALOG.map((item) => {
      const userPath = path.join(this.userModelsDir, item.fileName)
      const bundled = this.bundledModelPath(item.fileName)
      return {
        ...item,
        downloaded: fs.existsSync(userPath),
        bundled: Boolean(bundled)
      }
    })
    let error: string | null = null
    if (!binary.path) error = 'Falta whisper-cli.exe. Puedes descargarlo desde Ajustes.'
    else if (!model.path) error = 'Falta un modelo de Whisper. Descarga uno desde Ajustes.'
    return {
      binaryReady: Boolean(binary.path),
      modelReady: Boolean(model.path),
      binaryPath: binary.path || null,
      modelPath: model.path || null,
      runtimeSource: binary.source,
      version: binary.path ? WHISPER_VERSION : null,
      models,
      selectedModel: selected,
      error
    }
  }

  async downloadBinary(): Promise<WhisperStatus> {
    const zipPath = path.join(this.downloadsDir, 'whisper-bin-x64.zip')
    this.callbacks.onProgress({
      target: 'whisper',
      received: 0,
      total: 0,
      phase: 'downloading',
      message: 'Llamando a la puerta de whisper.cpp…'
    })
    try {
      await this.downloadFile(WHISPER_ZIP_URL, zipPath, 'whisper', undefined, 0)
      this.callbacks.onProgress({
        target: 'whisper',
        received: 1,
        total: 1,
        phase: 'extracting',
        message: 'Descomprimiendo las orejas de Whisper…'
      })
      const zip = new AdmZip(zipPath)
      const tempDir = path.join(this.downloadsDir, 'extract-runtime')
      await fsp.rm(tempDir, { recursive: true, force: true })
      zip.extractAllTo(tempDir, true)
      const candidates = this.findFiles(tempDir, 'whisper-cli.exe')
      if (!candidates.length) throw new Error('El paquete no trae whisper-cli.exe.')
      const sourceDir = path.dirname(candidates[0]!)
      await fsp.rm(this.runtimeDir, { recursive: true, force: true })
      await fsp.mkdir(this.runtimeDir, { recursive: true })
      await fsp.cp(sourceDir, this.runtimeDir, { recursive: true })
      await fsp.rm(tempDir, { recursive: true, force: true })
      await fsp.rm(zipPath, { force: true })
      this.callbacks.onProgress({
        target: 'whisper',
        received: 1,
        total: 1,
        phase: 'done',
        message: 'Whisper.cpp está listo para escuchar en local.'
      })
      return this.status()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.callbacks.onProgress({
        target: 'whisper',
        received: 0,
        total: 0,
        phase: 'error',
        message
      })
      throw error
    }
  }

  async downloadModel(modelId: string): Promise<WhisperStatus> {
    const model = MODEL_CATALOG.find((item) => item.id === modelId)
    if (!model) throw new Error('Ese modelo no existe en la despensa.')
    const target = path.join(this.userModelsDir, model.fileName)
    const expected = this.modelSizes.get(model.id) ?? 0
    if (fs.existsSync(target) && fs.statSync(target).size >= expected * 0.95) {
      return this.status()
    }
    try {
      await this.downloadFile(
        `${MODEL_BASE_URL}/${model.fileName}`,
        target,
        'model',
        model.id,
        expected
      )
      this.callbacks.onProgress({
        target: 'model',
        modelId: model.id,
        received: 1,
        total: 1,
        phase: 'done',
        message: `Modelo ${model.label} listo.`
      })
      return this.status()
    } catch (error) {
      this.callbacks.onProgress({
        target: 'model',
        modelId: model.id,
        received: 0,
        total: 0,
        phase: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  private findFiles(dir: string, name: string): string[] {
    const found: string[] = []
    const walk = (current: string): void => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.toLowerCase() === name.toLowerCase()) found.push(full)
      }
    }
    walk(dir)
    return found
  }

  private downloadFile(
    url: string,
    destination: string,
    target: 'whisper' | 'model',
    modelId?: string,
    expected = 0,
    redirects = 0
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (redirects > 8) {
        reject(new Error('La descarga dio demasiadas vueltas.'))
        return
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      const req = https.get(
        url,
        { headers: { 'User-Agent': 'LemoNotes/1.0 (+local app)' }, timeout: 30_000 },
        (response) => {
          const status = response.statusCode ?? 0
          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume()
            this.downloadFile(
              new URL(response.headers.location, url).toString(),
              destination,
              target,
              modelId,
              expected,
              redirects + 1
            ).then(resolve, reject)
            return
          }
          if (status !== 200) {
            response.resume()
            reject(new Error(`La descarga respondió ${status}.`))
            return
          }
          const total = Number(response.headers['content-length'] || expected || 0)
          let received = 0
          let lastEmit = 0
          const temp = `${destination}.part`
          const stream = fs.createWriteStream(temp)
          response.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (Date.now() - lastEmit > 250) {
              lastEmit = Date.now()
              this.callbacks.onProgress({
                target,
                modelId,
                received,
                total,
                phase: 'downloading',
                message:
                  total > 0
                    ? `Descargando ${(received / 1048576).toFixed(1)} de ${(total / 1048576).toFixed(1)} MB`
                    : 'Descargando…'
              })
            }
          })
          response.pipe(stream)
          stream.on('finish', () => {
            stream.close(() => {
              try {
                if (expected > 0 && fs.statSync(temp).size < expected * 0.9) {
                  throw new Error('La descarga quedó incompleta. Prueba otra vez.')
                }
                fs.renameSync(temp, destination)
                resolve()
              } catch (error) {
                reject(error)
              }
            })
          })
          stream.on('error', reject)
        }
      )
      req.on('timeout', () => {
        req.destroy(new Error('La descarga tardó demasiado. Revisa tu conexión.'))
      })
      req.on('error', reject)
    })
  }

  async transcribeRange(options: {
    sessionId: string
    wavPath: string
    startMs: number
    endMs: number
    language: string
  }): Promise<{ queued: boolean; message?: string }> {
    const status = this.status()
    if (!status.binaryReady || !status.modelReady) {
      this.safeRemove(options.wavPath)
      return {
        queued: false,
        message: status.error ?? 'Whisper todavía no está listo. La nota se guarda igualmente.'
      }
    }
    if (!hasAudibleSpeech(options.wavPath)) {
      this.safeRemove(options.wavPath)
      return { queued: false }
    }
    const job: QueuedJob = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sessionId: options.sessionId,
      wavPath: options.wavPath,
      startMs: options.startMs,
      endMs: options.endMs,
      language: options.language,
      attempts: 0
    }
    this.jobs.push(job)
    void this.pump()
    return { queued: true }
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift()
        if (!job) break
        this.activeJob = job
        try {
          const result = await this.runWhisper(job)
          this.persistResult(job, result)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (job.attempts < 1 && !message.includes('Falta')) {
            job.attempts += 1
            this.jobs.unshift(job)
            await new Promise((resolve) => setTimeout(resolve, 600))
          } else {
            this.callbacks.onError(job.sessionId, `Whisper se atragantó: ${message}`)
          }
        } finally {
          this.safeRemove(job.wavPath)
          this.activeJob = null
        }
      }
    } finally {
      this.running = false
      this.resolveWaiters()
    }
  }

  private persistResult(job: QueuedJob, result: JobResult): void {
    if (!result.segments.length && !result.text.trim()) return
    const last = this.db.lastSegment(job.sessionId)
    let pieces = result.segments.length
      ? result.segments
      : [{ startMs: job.startMs, endMs: job.endMs, text: result.text }]
    if (last) {
      const deduped = removeWordOverlap(last.text, pieces[0]?.text ?? '')
      if (!deduped.trim()) {
        pieces = pieces.slice(1)
      } else if (pieces[0]) {
        pieces = [{ ...pieces[0], text: deduped }, ...pieces.slice(1)]
      }
    }
    pieces = pieces.filter((piece) => piece.text.trim().length > 0)
    if (!pieces.length) return
    for (const piece of pieces) {
      const segment = this.db.addSegment(job.sessionId, {
        startMs: piece.startMs,
        endMs: piece.endMs,
        text: cleanWhisperText(piece.text),
        speaker: 'Hablante 1',
        source: 'whisper',
        confidence: 0.82
      })
      this.callbacks.onSegment(job.sessionId, segment)
    }
  }

  private runWhisper(job: QueuedJob): Promise<JobResult> {
    const status = this.status()
    if (!status.binaryPath || !status.modelPath) {
      return Promise.reject(new Error('Falta el binario o el modelo de Whisper.'))
    }
    const outBase = path.join(
      this.dataDir,
      'tmp',
      'whisper',
      `${job.sessionId}-${job.id}`
    )
    fs.mkdirSync(path.dirname(outBase), { recursive: true })
    const threads = Math.max(2, Math.min(8, (os.cpus()?.length ?? 4) - 1))
    const args = [
      '-m',
      status.modelPath,
      '-f',
      job.wavPath,
      '-l',
      job.language || 'es',
      '-t',
      String(threads),
      '-oj',
      '-of',
      outBase,
      '-np'
    ]
    return new Promise((resolve, reject) => {
      const child = spawn(status.binaryPath as string, args, {
        cwd: path.dirname(status.binaryPath as string),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stderr = ''
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error('La transcripción local tardó demasiado.'))
      }, 180_000)
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8')
        if (stderr.length > 20_000) stderr = stderr.slice(-20_000)
      })
      child.stdout?.resume()
      child.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timeout)
        if (code !== 0) {
          reject(new Error(stderr.trim().split('\n').at(-1) || `whisper-cli terminó con código ${code}`))
          return
        }
        try {
          const jsonPath = `${outBase}.json`
          if (fs.existsSync(jsonPath)) {
            const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
              transcription?: Array<{
                offsets?: { from?: number; to?: number }
                timestamps?: { from?: string; to?: string }
                text?: string
              }>
            }
            const segments = (raw.transcription ?? [])
              .map((item) => {
                const start = Number(item.offsets?.from ?? parseWhisperTimestamp(item.timestamps?.from))
                const end = Number(item.offsets?.to ?? parseWhisperTimestamp(item.timestamps?.to))
                return {
                  startMs: job.startMs + Math.max(0, start),
                  endMs: job.startMs + Math.max(start + 250, end),
                  text: cleanWhisperText(item.text ?? '')
                }
              })
              .filter((item) => item.text.length > 0)
            resolve({ text: segments.map((item) => item.text).join(' '), segments })
            fs.rmSync(jsonPath, { force: true })
            return
          }
          const txtPath = `${outBase}.txt`
          if (fs.existsSync(txtPath)) {
            const text = fs.readFileSync(txtPath, 'utf8').trim()
            resolve({ text, segments: text ? [{ startMs: job.startMs, endMs: job.endMs, text }] : [] })
            fs.rmSync(txtPath, { force: true })
            return
          }
          resolve({ text: '', segments: [] })
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  waitForIdle(sessionId: string): Promise<void> {
    const hasPending =
      this.jobs.some((job) => job.sessionId === sessionId) ||
      (this.activeJob?.sessionId === sessionId && this.running)
    if (!hasPending) return Promise.resolve()
    return new Promise((resolve) => {
      const list = this.waiters.get(sessionId) ?? []
      list.push(resolve)
      this.waiters.set(sessionId, list)
    })
  }

  private resolveWaiters(): void {
    for (const [sessionId, list] of this.waiters) {
      const pending =
        this.jobs.some((job) => job.sessionId === sessionId) ||
        (this.activeJob?.sessionId === sessionId && this.running)
      if (!pending) {
        this.waiters.delete(sessionId)
        for (const resolve of list) resolve()
      }
    }
  }

  private safeRemove(filePath: string): void {
    try {
      fs.rmSync(filePath, { force: true })
    } catch {
      // El archivo temporal se limpiará en el siguiente arranque.
    }
  }

  async cleanupTemps(): Promise<void> {
    await fsp.rm(path.join(this.dataDir, 'tmp', 'whisper'), { recursive: true, force: true })
    await fsp.mkdir(path.join(this.dataDir, 'tmp', 'whisper'), { recursive: true })
  }
}

function cleanWhisperText(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim()
}

function parseWhisperTimestamp(value?: string): number {
  if (!value) return 0
  const match = value.match(/(\d+):(\d+):(\d+)[,.](\d+)/)
  if (!match) return 0
  const [, h, m, s, ms] = match
  return Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms)
}

function normalizeWords(text: string): string[] {
  return text
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export function removeWordOverlap(previous: string, next: string): string {
  const previousWords = normalizeWords(previous)
  const rawNext = next.trim()
  const nextWords = rawNext.split(/\s+/).filter(Boolean)
  const max = Math.min(18, previousWords.length, nextWords.length)
  for (let size = max; size >= 2; size -= 1) {
    const tail = previousWords.slice(-size).join(' ')
    const head = normalizeWords(nextWords.slice(0, size).join(' ')).join(' ')
    if (tail && tail === head) {
      return nextWords.slice(size).join(' ')
    }
  }
  return rawNext
}

function hasAudibleSpeech(wavPath: string): boolean {
  try {
    const fd = fs.openSync(wavPath, 'r')
    const stat = fs.statSync(wavPath)
    const length = Math.min(stat.size - 44, 16_000 * 2 * 30)
    const buffer = Buffer.alloc(Math.max(0, length))
    fs.readSync(fd, buffer, 0, buffer.length, 44)
    fs.closeSync(fd)
    let sum = 0
    let count = 0
    for (let i = 0; i + 1 < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i) / 32768
      sum += sample * sample
      count += 1
      if (count > 16000 * 4 && sum / count > 0.00004) return true
    }
    return count > 0 && sum / count > 0.00004
  } catch {
    return true
  }
}
