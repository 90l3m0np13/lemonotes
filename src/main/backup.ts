import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { SessionDetail } from '../shared/types'
import type { Database } from './db'
import type { Vault } from './vault'

export interface BackupState {
  pending: number
  online: boolean
  message: string
}

export class BackupService {
  private readonly db: Database
  private readonly vault: Vault
  private readonly emit: (state: BackupState) => void
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private lastMessage = 'Copia local al día.'

  constructor(options: { db: Database; vault: Vault; emit: (state: BackupState) => void }) {
    this.db = options.db
    this.vault = options.vault
    this.emit = options.emit
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick()
    }, 8_000)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const settings = this.db.getSettings()
      const pending = this.db.pendingSyncCount()
      if (!settings.backupEnabled || !settings.backupDir) {
        if (pending > 0) {
          this.lastMessage = 'Copia pendiente: elige una carpeta de respaldo en Ajustes.'
          this.emit({ pending, online: true, message: this.lastMessage })
        }
        return
      }
      const jobs = this.db.dueSyncJobs(5)
      if (!jobs.length) {
        this.emit({ pending, online: true, message: this.lastMessage })
        return
      }
      await fsp.mkdir(settings.backupDir, { recursive: true })
      this.lastMessage = 'Sincronizando copia cifrada…'
      this.emit({ pending, online: true, message: this.lastMessage })
      let failure: string | null = null
      for (const job of jobs) {
        const detail = this.db.getSession(job.sessionId)
        if (!detail) {
          this.db.completeSyncJob(job.id)
          continue
        }
        try {
          await this.writeBundle(settings.backupDir, detail)
          this.db.completeSyncJob(job.id)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.db.failSyncJob(job.id, message, job.attempts)
          failure = message
          this.lastMessage = `La copia esperará: ${message}`
        }
      }
      const remaining = this.db.pendingSyncCount()
      if (remaining) {
        this.lastMessage = failure
          ? `La copia esperará: ${failure}`
          : 'Quedan copias en la cola.'
      } else {
        this.lastMessage = 'Copia local al día.'
      }
      this.emit({ pending: remaining, online: true, message: this.lastMessage })
    } finally {
      this.busy = false
    }
  }

  private async writeBundle(directory: string, detail: SessionDetail): Promise<void> {
    const payload = this.vault.encryptBuffer(
      Buffer.from(
        JSON.stringify({
          format: 'lemonotes-session-v1',
          detail
        }),
        'utf8'
      )
    )
    const envelope = {
      format: 'lemonotes-backup-v1',
      sessionId: detail.id,
      title: detail.title,
      updatedAt: detail.updatedAt,
      encrypted: true,
      algorithm: 'aes-256-gcm',
      payload: payload.toString('base64')
    }
    const file = path.join(directory, `${detail.id}.lemonote`)
    const temp = `${file}.${process.pid}.tmp`
    await fsp.writeFile(temp, JSON.stringify(envelope, null, 2), 'utf8')
    await fsp.rename(temp, file)
    await this.writeReadableActa(directory, detail)
  }

  private async writeReadableActa(directory: string, detail: SessionDetail): Promise<void> {
    const folder = path.join(directory, 'actas-legibles')
    await fsp.mkdir(folder, { recursive: true })
    const safe = detail.title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70)
    const file = path.join(folder, `${detail.createdAt ? new Date(detail.createdAt).toISOString().slice(0, 10) : 'nota'} - ${safe || 'Sin título'}.md`)
    const lines = [
      `# ${detail.title}`,
      '',
      `_${new Date(detail.createdAt).toLocaleString('es-ES')} · ${Math.round(detail.durationMs / 60000)} min_`,
      '',
      '## Resumen',
      detail.acta.summary || '',
      '',
      '## Decisiones',
      ...(detail.acta.decisions.length ? detail.acta.decisions.map((item) => `- ${item}`) : ['- Sin decisiones.']),
      '',
      '## Tareas',
      ...(detail.acta.tasks.length
        ? detail.acta.tasks.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`)
        : ['- Sin tareas.']),
      '',
      '## Próximos pasos',
      ...(detail.acta.nextSteps.length ? detail.acta.nextSteps.map((item) => `- ${item}`) : ['- Sin pasos.']),
      '',
      '## Notas humanas',
      ...(detail.notes.length
        ? detail.notes.map((note) => `- [${Math.round(note.atMs / 1000)}s] ${note.body}`)
        : ['- Sin notas.']),
      '',
      '## Transcripción',
      ...detail.transcript.map(
        (segment) =>
          `- [${Math.round(segment.startMs / 1000)}s] ${segment.speaker || 'Voz'}: ${segment.text}`
      ),
      '',
      '> Copia legible generada por LemoNotes. La copia cifrada completa está en el archivo .lemonote.'
    ]
    await fsp.writeFile(file, lines.join('\n'), 'utf8')
  }

  getState(): BackupState {
    return {
      pending: this.db.pendingSyncCount(),
      online: true,
      message: this.lastMessage
    }
  }
}

export function ensureBackupDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}
