export type NoteKind = 'meeting' | 'personal'

export type SessionStatus =
  | 'inactive'
  | 'permission'
  | 'preparing'
  | 'recording'
  | 'paused'
  | 'transcribing'
  | 'review'
  | 'saving'
  | 'syncing'
  | 'offline'
  | 'error'

export type TrackKind = 'mixed' | 'mic' | 'system'

export type SourceMode = 'mic' | 'system' | 'both'

export type ActaOrigin = 'human' | 'ai' | 'empty'

export type ActaSection = 'summary' | 'decisions' | 'tasks' | 'nextSteps'

export interface TaskItem {
  id: string
  text: string
  owner: string
  due: string
  done: boolean
}

export interface Acta {
  summary: string
  decisions: string[]
  tasks: TaskItem[]
  nextSteps: string[]
}

export interface ActaOrigins {
  summary: ActaOrigin
  decisions: ActaOrigin
  tasks: ActaOrigin
  nextSteps: ActaOrigin
}

export interface TranscriptSegment {
  id: string
  sessionId: string
  seq: number
  startMs: number
  endMs: number
  text: string
  speaker: string
  source: 'whisper' | 'human'
  confidence: number
  edited: boolean
}

export interface HumanNote {
  id: string
  sessionId: string
  atMs: number
  body: string
  createdAt: number
  updatedAt: number
}

export interface TrackMeta {
  fileName: string
  bytes: number
  durationMs: number
}

export interface AudioMeta {
  sampleRate: number
  tracks: Partial<Record<TrackKind, TrackMeta>>
  savedAt: number
}

export interface AiProposal {
  acta: Acta
  createdAt: number
  model: string
  summarySource: 'deepseek' | 'local'
}

export interface SessionSummary {
  id: string
  title: string
  kind: NoteKind
  status: SessionStatus
  createdAt: number
  updatedAt: number
  startedAt: number | null
  endedAt: number | null
  durationMs: number
  preview: string
  noteCount: number
  segmentCount: number
  hasAudio: boolean
  recovered: boolean
  error: string | null
  syncState: 'local' | 'pending' | 'synced' | 'offline'
}

export interface SessionDetail extends SessionSummary {
  acta: Acta
  origins: ActaOrigins
  transcript: TranscriptSegment[]
  notes: HumanNote[]
  aiProposal: AiProposal | null
  aiOriginal: Acta | null
  audio: AudioMeta | null
  language: string
}

export interface Settings {
  micDeviceId: string
  includeSystemAudio: boolean
  systemSourceId: string
  micGain: number
  systemGain: number
  preserveTracks: boolean
  saveAudio: boolean
  liveTranscription: boolean
  vadAutoPause: boolean
  vadSilenceSeconds: number
  language: string
  selectedWhisperModel: string
  backupDir: string
  backupEnabled: boolean
}

export interface ScreenSource {
  id: string
  name: string
  displayId: string
  thumbnail: string
}

export interface WhisperModelInfo {
  id: string
  label: string
  fileName: string
  sizeMb: number
  description: string
  downloaded: boolean
  bundled: boolean
}

export interface WhisperStatus {
  binaryReady: boolean
  modelReady: boolean
  binaryPath: string | null
  modelPath: string | null
  runtimeSource: 'bundled' | 'downloaded' | 'custom' | 'missing'
  version: string | null
  models: WhisperModelInfo[]
  selectedModel: string
  error: string | null
}

export interface AiStatus {
  configured: boolean
  model: string
  keySource: 'env' | 'process' | 'none'
  baseUrl: string
}

export interface RecoveryItem {
  session: SessionSummary
  interruptedAt: number
}

export interface Bootstrap {
  version: string
  platform: string
  dataDir: string
  protection: 'dpapi' | 'basic'
  settings: Settings
  whisper: WhisperStatus
  ai: AiStatus
  sessions: SessionSummary[]
  interrupted: RecoveryItem[]
}

export interface CreateSessionInput {
  title: string
  kind: NoteKind
  language?: string
}

export interface SessionPatch {
  title?: string
  kind?: NoteKind
  status?: SessionStatus
  startedAt?: number | null
  endedAt?: number | null
  durationMs?: number
  error?: string | null
  language?: string
  recovered?: boolean
}

export interface ActaSaveInput {
  sessionId: string
  acta: Acta
  origins?: Partial<ActaOrigins>
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AiChatRequest {
  sessionId: string
  question: string
  history: ChatTurn[]
}

export interface AiChatReply {
  answer: string
  model: string
}

export interface TranscriptionEvent {
  sessionId: string
  segment: TranscriptSegment
}

export interface TranscriptionErrorEvent {
  sessionId: string
  message: string
}

export interface DownloadProgress {
  target: 'whisper' | 'model'
  modelId?: string
  received: number
  total: number
  phase: 'downloading' | 'extracting' | 'done' | 'error'
  message?: string
}

export interface RecordingStatePayload {
  active: boolean
  paused: boolean
  sessionId: string | null
  title: string
}

export interface ExportResult {
  saved: boolean
  filePath?: string
}

export type ExportFormat = 'md' | 'txt' | 'json'

export interface AudioBeginInput {
  sessionId: string
  sampleRate: number
  tracks: TrackKind[]
}

export interface AudioBeginResult {
  ok: boolean
  sampleRate: number
}

export interface TranscribeRangeInput {
  sessionId: string
  startMs: number
  endMs: number
}

export interface TranscribeRangeResult {
  queued: boolean
  message?: string
}

export const ACTA_SECTION_LABELS: Record<ActaSection, string> = {
  summary: 'Resumen',
  decisions: 'Decisiones',
  tasks: 'Tareas',
  nextSteps: 'Próximos pasos'
}

export function emptyActa(): Acta {
  return { summary: '', decisions: [], tasks: [], nextSteps: [] }
}

export function emptyOrigins(): ActaOrigins {
  return { summary: 'empty', decisions: 'empty', tasks: 'empty', nextSteps: 'empty' }
}

export interface LemoNotesApi {
  bootstrap: () => Promise<Bootstrap>
  listSessions: () => Promise<SessionSummary[]>
  searchSessions: (query: string) => Promise<SessionSummary[]>
  getSession: (id: string) => Promise<SessionDetail | null>
  createSession: (input: CreateSessionInput) => Promise<SessionDetail>
  updateSession: (id: string, patch: SessionPatch) => Promise<SessionSummary | null>
  deleteSession: (id: string) => Promise<{ ok: boolean }>
  markRecovered: (id: string) => Promise<SessionDetail | null>
  saveActa: (input: ActaSaveInput) => Promise<SessionDetail>
  applyAiProposal: (sessionId: string, mode: 'fill-empty' | 'replace') => Promise<SessionDetail>
  discardAiProposal: (sessionId: string) => Promise<SessionDetail>
  addNote: (sessionId: string, atMs: number, body: string) => Promise<HumanNote>
  updateNote: (noteId: string, body: string) => Promise<HumanNote | null>
  deleteNote: (noteId: string) => Promise<{ ok: boolean }>
  addSegment: (sessionId: string, segment: Partial<TranscriptSegment> & { text: string; startMs: number; endMs: number }) => Promise<TranscriptSegment>
  updateSegment: (segmentId: string, patch: { text?: string; speaker?: string }) => Promise<TranscriptSegment | null>
  generateActa: (sessionId: string) => Promise<{ proposal: AiProposal; applied: boolean; detail: SessionDetail }>
  generateLocalActa: (sessionId: string) => Promise<{ proposal: AiProposal; applied: boolean; detail: SessionDetail }>
  chat: (request: AiChatRequest) => Promise<AiChatReply>
  getAiStatus: () => Promise<AiStatus>
  getWhisperStatus: () => Promise<WhisperStatus>
  downloadWhisper: (target: 'whisper' | 'model', modelId?: string) => Promise<{ ok: boolean; message?: string; status: WhisperStatus }>
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  chooseBackupDir: () => Promise<string | null>
  chooseWhisperBinary: () => Promise<WhisperStatus>
  openPath: (target: 'data' | 'backups' | 'models') => Promise<void>
  exportSession: (sessionId: string, format: ExportFormat) => Promise<ExportResult>
  listScreens: () => Promise<ScreenSource[]>
  audioBegin: (input: AudioBeginInput) => Promise<AudioBeginResult>
  audioAppend: (sessionId: string, track: TrackKind, data: ArrayBuffer) => Promise<{ ok: boolean; bytes: number }>
  audioFinish: (sessionId: string) => Promise<AudioMeta | null>
  deleteAudio: (sessionId: string) => Promise<SessionDetail | null>
  getMediaUrl: (sessionId: string, track: TrackKind) => Promise<string | null>
  transcribeRange: (input: TranscribeRangeInput) => Promise<TranscribeRangeResult>
  finalizeTranscription: (sessionId: string, durationMs: number) => Promise<{ ok: boolean; reason?: string }>
  waitForTranscription: (sessionId: string) => Promise<{ ok: boolean }>
  setRecordingState: (state: RecordingStatePayload) => Promise<void>
  requestQuit: () => Promise<{ ok: boolean }>
  onTranscription: (callback: (event: TranscriptionEvent) => void) => () => void
  onTranscriptionError: (callback: (event: TranscriptionErrorEvent) => void) => () => void
  onDownloadProgress: (callback: (event: DownloadProgress) => void) => () => void
  onQuickNote: (callback: () => void) => () => void
  onNavigate: (callback: (view: 'home' | 'notes' | 'settings') => void) => () => void
  onSyncState: (callback: (state: { pending: number; online: boolean; message: string }) => void) => () => void
  onBeforeQuit: (callback: () => void) => () => void
}
