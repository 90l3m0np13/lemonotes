import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActaSaveInput,
  AiChatRequest,
  AudioBeginInput,
  CreateSessionInput,
  ExportFormat,
  LemoNotesApi,
  RecordingStatePayload,
  SessionPatch,
  Settings,
  TrackKind,
  TranscribeRangeInput,
  TranscriptionEvent,
  TranscriptionErrorEvent,
  DownloadProgress
} from '../shared/types'

function on<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: LemoNotesApi = {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  searchSessions: (query) => ipcRenderer.invoke('sessions:search', query),
  getSession: (id) => ipcRenderer.invoke('sessions:get', id),
  createSession: (input: CreateSessionInput) => ipcRenderer.invoke('sessions:create', input),
  updateSession: (id: string, patch: SessionPatch) => ipcRenderer.invoke('sessions:update', id, patch),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  markRecovered: (id) => ipcRenderer.invoke('sessions:recover', id),
  saveActa: (input: ActaSaveInput) => ipcRenderer.invoke('sessions:saveActa', input),
  applyAiProposal: (sessionId, mode) => ipcRenderer.invoke('sessions:applyProposal', sessionId, mode),
  discardAiProposal: (sessionId) => ipcRenderer.invoke('sessions:discardProposal', sessionId),
  addNote: (sessionId, atMs, body) => ipcRenderer.invoke('notes:add', sessionId, atMs, body),
  updateNote: (noteId, body) => ipcRenderer.invoke('notes:update', noteId, body),
  deleteNote: (noteId) => ipcRenderer.invoke('notes:delete', noteId),
  addSegment: (sessionId, segment) => ipcRenderer.invoke('segments:add', sessionId, segment),
  updateSegment: (segmentId, patch) => ipcRenderer.invoke('segments:update', segmentId, patch),
  generateActa: (sessionId) => ipcRenderer.invoke('ai:generate', sessionId),
  generateLocalActa: (sessionId) => ipcRenderer.invoke('ai:local', sessionId),
  chat: (request: AiChatRequest) => ipcRenderer.invoke('ai:chat', request),
  getAiStatus: () => ipcRenderer.invoke('ai:status'),
  getWhisperStatus: () => ipcRenderer.invoke('whisper:status'),
  downloadWhisper: (target, modelId) => ipcRenderer.invoke('whisper:download', target, modelId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:save', patch),
  chooseBackupDir: () => ipcRenderer.invoke('settings:chooseBackup'),
  chooseWhisperBinary: () => ipcRenderer.invoke('settings:chooseWhisper'),
  openPath: (target) => ipcRenderer.invoke('app:openPath', target),
  exportSession: (sessionId, format: ExportFormat) => ipcRenderer.invoke('app:export', sessionId, format),
  listScreens: () => ipcRenderer.invoke('app:screens'),
  audioBegin: (input: AudioBeginInput) => ipcRenderer.invoke('audio:begin', input),
  audioAppend: (sessionId, track: TrackKind, data: ArrayBuffer) =>
    ipcRenderer.invoke('audio:append', sessionId, track, data),
  audioFinish: (sessionId) => ipcRenderer.invoke('audio:finish', sessionId),
  deleteAudio: (sessionId) => ipcRenderer.invoke('audio:delete', sessionId),
  getMediaUrl: (sessionId, track) => ipcRenderer.invoke('audio:url', sessionId, track),
  transcribeRange: (input: TranscribeRangeInput) => ipcRenderer.invoke('transcription:range', input),
  finalizeTranscription: (sessionId, durationMs) =>
    ipcRenderer.invoke('transcription:finalize', sessionId, durationMs),
  waitForTranscription: (sessionId) => ipcRenderer.invoke('transcription:wait', sessionId),
  setRecordingState: (state: RecordingStatePayload) => ipcRenderer.invoke('app:recording', state),
  requestQuit: () => ipcRenderer.invoke('app:requestQuit'),
  onTranscription: (callback) => on<TranscriptionEvent>('event:transcription', callback),
  onTranscriptionError: (callback) => on<TranscriptionErrorEvent>('event:transcription-error', callback),
  onDownloadProgress: (callback) => on<DownloadProgress>('event:download', callback),
  onQuickNote: (callback) => on('event:quick-note', () => callback()),
  onNavigate: (callback) => on('event:navigate', callback),
  onSyncState: (callback) => on('event:sync', callback),
  onBeforeQuit: (callback) => on('event:before-quit', () => callback())
}

contextBridge.exposeInMainWorld('lemonotes', api)
