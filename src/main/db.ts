import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  Acta,
  ActaOrigins,
  AiProposal,
  AudioMeta,
  CreateSessionInput,
  HumanNote,
  NoteKind,
  SessionDetail,
  SessionPatch,
  SessionStatus,
  SessionSummary,
  Settings,
  TranscriptSegment
} from '../shared/types'
import { emptyActa, emptyOrigins } from '../shared/types'
import type { Vault } from './vault'

const SCHEMA_VERSION = 1

interface SessionRow {
  id: string
  kind: NoteKind
  status: SessionStatus
  created_at: number
  updated_at: number
  started_at: number | null
  ended_at: number | null
  duration_ms: number
  title_enc: Uint8Array
  acta_enc: Uint8Array | null
  origins_enc: Uint8Array | null
  ai_proposal_enc: Uint8Array | null
  ai_original_enc: Uint8Array | null
  acta_history_enc: Uint8Array | null
  audio_enc: Uint8Array | null
  language: string
  recovered: number
  error_enc: Uint8Array | null
  deleted: number
  pending_sync?: number
}

interface SegmentRow {
  id: string
  session_id: string
  seq: number
  start_ms: number
  end_ms: number
  text_enc: Uint8Array
  speaker: string
  source: 'whisper' | 'human'
  confidence: number
  edited: number
}

interface NoteRow {
  id: string
  session_id: string
  at_ms: number
  body_enc: Uint8Array
  created_at: number
  updated_at: number
}

interface SettingRow {
  key: string
  value: string
}

export const DEFAULT_SETTINGS: Settings = {
  micDeviceId: '',
  includeSystemAudio: true,
  systemSourceId: '',
  micGain: 1,
  systemGain: 0.85,
  preserveTracks: false,
  saveAudio: true,
  liveTranscription: true,
  vadAutoPause: false,
  vadSilenceSeconds: 8,
  language: 'es',
  selectedWhisperModel: 'base',
  backupDir: '',
  backupEnabled: true
}

export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
}

function shortText(value: string, max = 150): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean
}

export class Database {
  private db: DatabaseSync | null = null
  private readonly file: string
  private readonly vault: Vault

  constructor(dataDir: string, vault: Vault) {
    this.file = path.join(dataDir, 'lemonotes.db')
    this.vault = vault
  }

  get databasePath(): string {
    return this.file
  }

  async open(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    this.db = new DatabaseSync(this.file)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA synchronous = FULL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.db.exec('PRAGMA busy_timeout = 5000;')
    this.migrate()
    this.ensureSettings()
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  private get conn(): DatabaseSync {
    if (!this.db) throw new Error('La base de datos no está abierta.')
    return this.db
  }

  private migrate(): void {
    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        title_enc BLOB NOT NULL,
        acta_enc BLOB,
        origins_enc BLOB,
        ai_proposal_enc BLOB,
        ai_original_enc BLOB,
        acta_history_enc BLOB,
        audio_enc BLOB,
        language TEXT NOT NULL DEFAULT 'es',
        recovered INTEGER NOT NULL DEFAULT 0,
        error_enc BLOB,
        deleted INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS segments (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        text_enc BLOB NOT NULL,
        speaker TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'whisper',
        confidence REAL NOT NULL DEFAULT 0,
        edited INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(session_id, seq);

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        at_ms INTEGER NOT NULL,
        body_enc BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id, at_ms);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(session_id, operation)
      );
    `)
    this.conn.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION)
    )
  }

  private ensureSettings(): void {
    const existing = new Set(
      (this.conn.prepare('SELECT key FROM settings').all() as unknown as SettingRow[]).map((r) => r.key)
    )
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!existing.has(key)) {
        this.conn.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value))
      }
    }
  }

  getSettings(): Settings {
    const rows = this.conn.prepare('SELECT key, value FROM settings').all() as unknown as SettingRow[]
    const settings = { ...DEFAULT_SETTINGS }
    for (const row of rows) {
      if (!(row.key in settings)) continue
      try {
        const parsed = JSON.parse(row.value) as unknown
        ;(settings as unknown as Record<string, unknown>)[row.key] = parsed
      } catch {
        // Conserva el valor por defecto si una preferencia quedó corrupta.
      }
    }
    return settings
  }

  saveSettings(patch: Partial<Settings>): Settings {
    const allowed = new Set(Object.keys(DEFAULT_SETTINGS))
    for (const [key, value] of Object.entries(patch)) {
      if (!allowed.has(key)) continue
      this.conn
        .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run(key, JSON.stringify(value))
    }
    return this.getSettings()
  }

  createSession(input: CreateSessionInput): SessionDetail {
    const id = randomUUID()
    const now = Date.now()
    const title = input.title.trim() || (input.kind === 'meeting' ? 'Reunión sin título' : 'Nota de voz')
    this.conn
      .prepare(
        `INSERT INTO sessions (id, kind, status, created_at, updated_at, duration_ms, title_enc, acta_enc, origins_enc, language)
         VALUES (?, ?, 'inactive', ?, ?, 0, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.kind,
        now,
        now,
        this.vault.encryptText(title),
        this.vault.encryptJson(emptyActa()),
        this.vault.encryptJson(emptyOrigins()),
        input.language || 'es'
      )
    this.queueSync(id)
    const detail = this.getSession(id)
    if (!detail) throw new Error('No he podido crear la nota.')
    return detail
  }

  private rowToSummary(row: SessionRow): SessionSummary {
    const acta = row.acta_enc ? this.vault.decryptJson<Acta>(row.acta_enc, emptyActa()) : emptyActa()
    const segments = this.conn
      .prepare('SELECT text_enc FROM segments WHERE session_id = ? ORDER BY seq DESC LIMIT 1')
      .all(row.id) as unknown as Array<{ text_enc: Uint8Array }>
    const lastSegment = segments[0]
      ? this.vault.decryptText(segments[0].text_enc)
      : ''
    const noteCountRow = this.conn
      .prepare('SELECT COUNT(*) AS count FROM notes WHERE session_id = ?')
      .get(row.id) as unknown as { count: number } | undefined
    const segmentCountRow = this.conn
      .prepare('SELECT COUNT(*) AS count FROM segments WHERE session_id = ?')
      .get(row.id) as unknown as { count: number } | undefined
    const preview = acta.summary.trim() || lastSegment || 'Aún no hay palabras. El limón está expectante.'
    return {
      id: row.id,
      title: this.vault.decryptText(row.title_enc),
      kind: row.kind,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationMs: row.duration_ms,
      preview: shortText(preview),
      noteCount: Number(noteCountRow?.count ?? 0),
      segmentCount: Number(segmentCountRow?.count ?? 0),
      hasAudio: Boolean(row.audio_enc),
      recovered: Boolean(row.recovered),
      error: row.error_enc ? this.vault.decryptText(row.error_enc) : null,
      syncState: row.pending_sync && row.pending_sync > 0 ? 'pending' : 'synced'
    }
  }

  listSessions(): SessionSummary[] {
    const rows = this.conn
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM sync_queue q WHERE q.session_id = s.id) AS pending_sync
         FROM sessions s WHERE s.deleted = 0 ORDER BY s.updated_at DESC`
      )
      .all() as unknown as SessionRow[]
    return rows.map((row) => this.rowToSummary(row))
  }

  searchSessions(query: string): SessionSummary[] {
    const needle = normalizeForSearch(query.trim())
    if (!needle) return this.listSessions()
    const all = this.listSessions()
    return all.filter((item) => {
      const detail = this.getSession(item.id)
      if (!detail) return false
      const haystack = normalizeForSearch(
        [
          detail.title,
          detail.acta.summary,
          ...detail.acta.decisions,
          ...detail.acta.tasks.map((task) => `${task.text} ${task.owner} ${task.due}`),
          ...detail.acta.nextSteps,
          ...detail.notes.map((note) => note.body),
          ...detail.transcript.map((segment) => segment.text)
        ].join(' ')
      )
      return haystack.includes(needle)
    })
  }

  getSession(id: string): SessionDetail | null {
    const row = this.conn
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM sync_queue q WHERE q.session_id = s.id) AS pending_sync
         FROM sessions s WHERE s.id = ? AND s.deleted = 0`
      )
      .get(id) as unknown as SessionRow | undefined
    if (!row) return null
    const summary = this.rowToSummary(row)
    const segments = (
      this.conn.prepare('SELECT * FROM segments WHERE session_id = ? ORDER BY seq ASC').all(id) as unknown as SegmentRow[]
    ).map((segment) => this.rowToSegment(segment))
    const notes = (
      this.conn.prepare('SELECT * FROM notes WHERE session_id = ? ORDER BY at_ms ASC, created_at ASC').all(id) as unknown as NoteRow[]
    ).map((note) => this.rowToNote(note))
    const aiProposal = row.ai_proposal_enc
      ? this.vault.decryptJson<AiProposal | null>(row.ai_proposal_enc, null)
      : null
    return {
      ...summary,
      acta: row.acta_enc ? this.vault.decryptJson<Acta>(row.acta_enc, emptyActa()) : emptyActa(),
      origins: row.origins_enc ? this.vault.decryptJson<ActaOrigins>(row.origins_enc, emptyOrigins()) : emptyOrigins(),
      transcript: segments,
      notes,
      aiProposal,
      aiOriginal: row.ai_original_enc ? this.vault.decryptJson<Acta | null>(row.ai_original_enc, null) : null,
      audio: row.audio_enc ? this.vault.decryptJson<AudioMeta | null>(row.audio_enc, null) : null,
      language: row.language
    }
  }

  private rowToSegment(row: SegmentRow): TranscriptSegment {
    return {
      id: row.id,
      sessionId: row.session_id,
      seq: row.seq,
      startMs: row.start_ms,
      endMs: row.end_ms,
      text: this.vault.decryptText(row.text_enc),
      speaker: row.speaker,
      source: row.source,
      confidence: row.confidence,
      edited: Boolean(row.edited)
    }
  }

  private rowToNote(row: NoteRow): HumanNote {
    return {
      id: row.id,
      sessionId: row.session_id,
      atMs: row.at_ms,
      body: this.vault.decryptText(row.body_enc),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  updateSession(id: string, patch: SessionPatch): SessionSummary | null {
    const session = this.getSession(id)
    if (!session) return null
    const fields: string[] = []
    const values: Array<string | number | null | Uint8Array> = []
    const map: Array<[keyof SessionPatch, string]> = [
      ['title', 'title_enc'],
      ['kind', 'kind'],
      ['status', 'status'],
      ['startedAt', 'started_at'],
      ['endedAt', 'ended_at'],
      ['durationMs', 'duration_ms'],
      ['error', 'error_enc'],
      ['language', 'language'],
      ['recovered', 'recovered']
    ]
    for (const [key, column] of map) {
      if (!(key in patch)) continue
      const value = patch[key]
      fields.push(`${column} = ?`)
      if (key === 'title') values.push(this.vault.encryptText(String(value ?? '')))
      else if (key === 'error') values.push(value ? this.vault.encryptText(String(value)) : null)
      else if (key === 'recovered') values.push(value ? 1 : 0)
      else values.push((value as string | number | null) ?? null)
    }
    fields.push('updated_at = ?')
    values.push(Date.now(), id)
    this.conn.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    this.queueSync(id)
    return this.getSession(id)
  }

  setAudioMeta(id: string, meta: AudioMeta | null): void {
    this.conn
      .prepare('UPDATE sessions SET audio_enc = ?, updated_at = ? WHERE id = ?')
      .run(meta ? this.vault.encryptJson(meta) : null, Date.now(), id)
    this.queueSync(id)
  }

  addSegment(
    sessionId: string,
    input: Partial<TranscriptSegment> & { text: string; startMs: number; endMs: number }
  ): TranscriptSegment {
    const max = this.conn
      .prepare('SELECT COALESCE(MAX(seq), -1) AS seq FROM segments WHERE session_id = ?')
      .get(sessionId) as unknown as { seq: number }
    const id = randomUUID()
    const now = Date.now()
    const text = input.text.trim()
    this.conn
      .prepare(
        `INSERT INTO segments (id, session_id, seq, start_ms, end_ms, text_enc, speaker, source, confidence, edited, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        id,
        sessionId,
        Number(max.seq) + 1,
        Math.max(0, Math.round(input.startMs)),
        Math.max(0, Math.round(input.endMs)),
        this.vault.encryptText(text),
        input.speaker ?? '',
        input.source ?? 'whisper',
        input.confidence ?? 0.8,
        now
      )
    this.conn.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
    this.queueSync(sessionId)
    return {
      id,
      sessionId,
      seq: Number(max.seq) + 1,
      startMs: Math.max(0, Math.round(input.startMs)),
      endMs: Math.max(0, Math.round(input.endMs)),
      text,
      speaker: input.speaker ?? '',
      source: input.source ?? 'whisper',
      confidence: input.confidence ?? 0.8,
      edited: false
    }
  }

  updateSegment(id: string, patch: { text?: string; speaker?: string }): TranscriptSegment | null {
    const row = this.conn.prepare('SELECT * FROM segments WHERE id = ?').get(id) as unknown as SegmentRow | undefined
    if (!row) return null
    if (typeof patch.text === 'string') {
      this.conn
        .prepare('UPDATE segments SET text_enc = ?, edited = 1 WHERE id = ?')
        .run(this.vault.encryptText(patch.text), id)
    }
    if (typeof patch.speaker === 'string') {
      this.conn.prepare('UPDATE segments SET speaker = ? WHERE id = ?').run(patch.speaker, id)
    }
    this.conn.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), row.session_id)
    this.queueSync(row.session_id)
    const updated = this.conn.prepare('SELECT * FROM segments WHERE id = ?').get(id) as unknown as SegmentRow
    return this.rowToSegment(updated)
  }

  deleteSegments(sessionId: string): void {
    this.conn.prepare('DELETE FROM segments WHERE session_id = ?').run(sessionId)
    this.conn.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId)
    this.queueSync(sessionId)
  }

  lastSegment(sessionId: string): TranscriptSegment | null {
    const row = this.conn
      .prepare('SELECT * FROM segments WHERE session_id = ? ORDER BY seq DESC LIMIT 1')
      .get(sessionId) as unknown as SegmentRow | undefined
    return row ? this.rowToSegment(row) : null
  }

  addNote(sessionId: string, atMs: number, body: string): HumanNote {
    const id = randomUUID()
    const now = Date.now()
    const clean = body.trim()
    this.conn
      .prepare('INSERT INTO notes (id, session_id, at_ms, body_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, sessionId, Math.max(0, Math.round(atMs)), this.vault.encryptText(clean), now, now)
    this.conn.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
    this.queueSync(sessionId)
    return {
      id,
      sessionId,
      atMs: Math.max(0, Math.round(atMs)),
      body: clean,
      createdAt: now,
      updatedAt: now
    }
  }

  updateNote(noteId: string, body: string): HumanNote | null {
    const row = this.conn.prepare('SELECT * FROM notes WHERE id = ?').get(noteId) as unknown as NoteRow | undefined
    if (!row) return null
    const now = Date.now()
    this.conn
      .prepare('UPDATE notes SET body_enc = ?, updated_at = ? WHERE id = ?')
      .run(this.vault.encryptText(body.trim()), now, noteId)
    this.conn.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, row.session_id)
    this.queueSync(row.session_id)
    const updated = this.conn.prepare('SELECT * FROM notes WHERE id = ?').get(noteId) as unknown as NoteRow
    return this.rowToNote(updated)
  }

  deleteNote(noteId: string): boolean {
    const row = this.conn.prepare('SELECT session_id FROM notes WHERE id = ?').get(noteId) as
      | { session_id: string }
      | undefined
    if (!row) return false
    this.conn.prepare('DELETE FROM notes WHERE id = ?').run(noteId)
    this.conn.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), row.session_id)
    this.queueSync(row.session_id)
    return true
  }

  saveActa(sessionId: string, acta: Acta, originsPatch?: Partial<ActaOrigins>): SessionDetail {
    const current = this.getSession(sessionId)
    if (!current) throw new Error('La nota ya no existe.')
    const origins: ActaOrigins = { ...current.origins, ...(originsPatch ?? {}) }
    if (!originsPatch?.summary) origins.summary = current.acta.summary === acta.summary ? current.origins.summary : 'human'
    if (!originsPatch?.decisions)
      origins.decisions =
        JSON.stringify(current.acta.decisions) === JSON.stringify(acta.decisions)
          ? current.origins.decisions
          : 'human'
    if (!originsPatch?.tasks)
      origins.tasks =
        JSON.stringify(current.acta.tasks) === JSON.stringify(acta.tasks) ? current.origins.tasks : 'human'
    if (!originsPatch?.nextSteps)
      origins.nextSteps =
        JSON.stringify(current.acta.nextSteps) === JSON.stringify(acta.nextSteps)
          ? current.origins.nextSteps
          : 'human'
    this.conn
      .prepare('UPDATE sessions SET acta_enc = ?, origins_enc = ?, updated_at = ? WHERE id = ?')
      .run(this.vault.encryptJson(acta), this.vault.encryptJson(origins), Date.now(), sessionId)
    this.queueSync(sessionId)
    const detail = this.getSession(sessionId)
    if (!detail) throw new Error('La nota ya no existe.')
    return detail
  }

  setAiProposal(sessionId: string, proposal: AiProposal, original: Acta): boolean {
    const current = this.getSession(sessionId)
    if (!current) throw new Error('La nota ya no existe.')
    this.conn
      .prepare(
        'UPDATE sessions SET ai_proposal_enc = ?, ai_original_enc = ?, updated_at = ? WHERE id = ?'
      )
      .run(this.vault.encryptJson(proposal), this.vault.encryptJson(original), Date.now(), sessionId)
    const empty =
      !current.acta.summary.trim() &&
      current.acta.decisions.length === 0 &&
      current.acta.tasks.length === 0 &&
      current.acta.nextSteps.length === 0
    if (empty) {
      const origins: ActaOrigins = {
        summary: proposal.acta.summary.trim() ? 'ai' : 'empty',
        decisions: proposal.acta.decisions.length ? 'ai' : 'empty',
        tasks: proposal.acta.tasks.length ? 'ai' : 'empty',
        nextSteps: proposal.acta.nextSteps.length ? 'ai' : 'empty'
      }
      this.conn
        .prepare('UPDATE sessions SET acta_enc = ?, origins_enc = ?, updated_at = ? WHERE id = ?')
        .run(this.vault.encryptJson(proposal.acta), this.vault.encryptJson(origins), Date.now(), sessionId)
      this.queueSync(sessionId)
      return true
    }
    this.queueSync(sessionId)
    return false
  }

  applyAiProposal(sessionId: string, mode: 'fill-empty' | 'replace'): SessionDetail {
    const current = this.getSession(sessionId)
    if (!current || !current.aiProposal) throw new Error('No hay propuesta de IA pendiente.')
    const proposal = current.aiProposal.acta
    const next: Acta = mode === 'replace' ? structuredClone(proposal) : structuredClone(current.acta)
    const origins: ActaOrigins = { ...current.origins }
    if (mode === 'fill-empty') {
      if (!next.summary.trim() && proposal.summary.trim()) {
        next.summary = proposal.summary
        origins.summary = 'ai'
      }
      if (next.decisions.length === 0 && proposal.decisions.length) {
        next.decisions = structuredClone(proposal.decisions)
        origins.decisions = 'ai'
      }
      if (next.tasks.length === 0 && proposal.tasks.length) {
        next.tasks = structuredClone(proposal.tasks)
        origins.tasks = 'ai'
      }
      if (next.nextSteps.length === 0 && proposal.nextSteps.length) {
        next.nextSteps = structuredClone(proposal.nextSteps)
        origins.nextSteps = 'ai'
      }
    } else {
      origins.summary = proposal.summary.trim() ? 'ai' : 'empty'
      origins.decisions = proposal.decisions.length ? 'ai' : 'empty'
      origins.tasks = proposal.tasks.length ? 'ai' : 'empty'
      origins.nextSteps = proposal.nextSteps.length ? 'ai' : 'empty'
      const history = current.aiOriginal ? [current.aiOriginal] : []
      history.push(current.acta)
      this.conn
        .prepare('UPDATE sessions SET acta_history_enc = ?, ai_original_enc = ? WHERE id = ?')
        .run(this.vault.encryptJson(history), this.vault.encryptJson(current.acta), sessionId)
    }
    this.conn
      .prepare(
        'UPDATE sessions SET acta_enc = ?, origins_enc = ?, ai_proposal_enc = NULL, updated_at = ? WHERE id = ?'
      )
      .run(this.vault.encryptJson(next), this.vault.encryptJson(origins), Date.now(), sessionId)
    this.queueSync(sessionId)
    const detail = this.getSession(sessionId)
    if (!detail) throw new Error('La nota ya no existe.')
    return detail
  }

  discardAiProposal(sessionId: string): SessionDetail {
    this.conn
      .prepare('UPDATE sessions SET ai_proposal_enc = NULL, updated_at = ? WHERE id = ?')
      .run(Date.now(), sessionId)
    this.queueSync(sessionId)
    const detail = this.getSession(sessionId)
    if (!detail) throw new Error('La nota ya no existe.')
    return detail
  }

  markRecovered(id: string): SessionDetail | null {
    this.conn
      .prepare("UPDATE sessions SET recovered = 1, status = 'review', updated_at = ? WHERE id = ?")
      .run(Date.now(), id)
    return this.getSession(id)
  }

  getInterrupted(): SessionSummary[] {
    const rows = this.conn
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM sync_queue q WHERE q.session_id = s.id) AS pending_sync
         FROM sessions s
         WHERE s.deleted = 0 AND s.status IN ('permission','preparing','recording','paused','transcribing','saving')
         ORDER BY s.updated_at DESC`
      )
      .all() as unknown as SessionRow[]
    return rows.map((row) => this.rowToSummary(row))
  }

  softDeleteSession(id: string): void {
    this.conn.prepare('UPDATE sessions SET deleted = 1, updated_at = ? WHERE id = ?').run(Date.now(), id)
    this.conn.prepare('DELETE FROM sync_queue WHERE session_id = ?').run(id)
  }

  queueSync(sessionId: string): void {
    const now = Date.now()
    this.conn
      .prepare(
        `INSERT INTO sync_queue (id, session_id, operation, attempts, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, 'backup', 0, 0, ?, ?)
         ON CONFLICT(session_id, operation) DO UPDATE SET updated_at = excluded.updated_at,
           next_attempt_at = 0, last_error = NULL`
      )
      .run(randomUUID(), sessionId, now, now)
  }

  pendingSyncCount(): number {
    const row = this.conn.prepare('SELECT COUNT(*) AS count FROM sync_queue').get() as unknown as {
      count: number
    }
    return Number(row.count)
  }

  dueSyncJobs(limit = 10): Array<{ id: string; sessionId: string; attempts: number }> {
    const rows = this.conn
      .prepare(
        'SELECT id, session_id, attempts FROM sync_queue WHERE next_attempt_at <= ? ORDER BY updated_at ASC LIMIT ?'
      )
      .all(Date.now(), limit) as unknown as Array<{ id: string; session_id: string; attempts: number }>
    return rows.map((row) => ({ id: row.id, sessionId: row.session_id, attempts: row.attempts }))
  }

  completeSyncJob(id: string): void {
    this.conn.prepare('DELETE FROM sync_queue WHERE id = ?').run(id)
  }

  failSyncJob(id: string, error: string, attempts: number): void {
    const delay = Math.min(300_000, 2_000 * Math.pow(2, Math.min(attempts, 7)))
    this.conn
      .prepare('UPDATE sync_queue SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?')
      .run(attempts + 1, Date.now() + delay, error.slice(0, 500), Date.now(), id)
  }

  resetStaleSessions(): void {
    // Las sesiones que quedaron abiertas se ofrecen para recuperar, no se borran jamás.
    this.conn
      .prepare(
        `UPDATE sessions SET status = 'error', error_enc = ?
         WHERE deleted = 0 AND status IN ('preparing','saving')`
      )
      .run(this.vault.encryptText('La app se cerró antes de terminar de preparar esta nota.'))
  }
}
