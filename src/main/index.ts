import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerSaveBlocker,
  protocol,
  screen,
  session,
  shell
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { Readable } from 'node:stream'
import os from 'node:os'
import dotenv from 'dotenv'
import type {
  ActaSaveInput,
  AiChatRequest,
  AudioBeginInput,
  CreateSessionInput,
  ExportFormat,
  RecordingStatePayload,
  ScreenSource,
  SessionPatch,
  Settings,
  TrackKind,
  TranscribeRangeInput
} from '../shared/types'
import { Vault } from './vault'
import { Database } from './db'
import { AudioStore } from './audio-store'
import { WhisperService } from './whisper'
import { AiService, describeAiError } from './ai'
import { BackupService } from './backup'
import { exportSession } from './export-session'

app.setName('LemoNotes')

function resolveDataDir(): string {
  const override = process.env.LEMONOTES_DATA_DIR?.trim()
  if (override) return override

  if (app.isPackaged) {
    // En equipos con Panda/ZTAS, la app puede ejecutarse pero no escribir en
    // %APPDATA% ni %LOCALAPPDATA%. Guardar junto al ejecutable permite usar
    // una carpeta normal sin pelear con esa protección.
    const portable = path.join(path.dirname(app.getPath('exe')), 'LemoNotesData')
    try {
      fs.mkdirSync(portable, { recursive: true })
      fs.accessSync(portable, fs.constants.W_OK)
      return portable
    } catch {
      // Si la carpeta de la app es de solo lectura (Program Files), usamos
      // el perfil clásico como último recurso.
    }
  }

  return path.join(app.getPath('appData'), 'LemoNotes')
}

app.setPath('userData', resolveDataDir())
app.setAppUserModelId('com.lemonotes.desktop')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lemon-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

const APP_ROOT = path.join(__dirname, '..', '..')
const isDev = !app.isPackaged && !process.env.LEMONOTES_E2E
const DATA_DIR = app.getPath('userData')
const RESOURCES_PATH = isDev ? path.join(app.getAppPath(), 'resources') : process.resourcesPath

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let vault: Vault
let db: Database
let audioStore: AudioStore
let whisper: WhisperService
let ai: AiService
let backup: BackupService
let quitting = false
let forceQuit = false
let powerBlockerId: number | null = null
let globalShortcutRegistered = false
let recordingState: RecordingStatePayload = {
  active: false,
  paused: false,
  sessionId: null,
  title: ''
}

function loadEnvironment(): void {
  const candidates = [
    path.join(DATA_DIR, '.env'),
    path.join(path.dirname(app.getPath('exe')), '.env'),
    path.join(process.cwd(), '.env'),
    path.join(app.getAppPath(), '.env'),
    path.join(app.getAppPath(), '..', '.env')
  ]
  for (const candidate of [...new Set(candidates)]) {
    try {
      if (fs.existsSync(candidate)) dotenv.config({ path: candidate, override: false, quiet: true })
    } catch {
      // Un .env ilegible no debe impedir usar la libreta.
    }
  }
}

function iconPath(name = 'icon.png'): string {
  const candidates = isDev
    ? [path.join(app.getAppPath(), 'build', name), path.join(APP_ROOT, 'build', name)]
    : [path.join(process.resourcesPath, name), path.join(process.resourcesPath, 'build', name)]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? ''
}

function resourcePath(name: string): string {
  return path.join(RESOURCES_PATH, name)
}

function ensureTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  if (isDev) {
    if (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')) return
  }
  if (url.startsWith('file://')) return
  throw new Error('Origen no autorizado.')
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, '')
  return String(error)
}

function handle<T extends unknown[]>(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: T) => unknown | Promise<unknown>
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    ensureTrustedSender(event)
    try {
      return await listener(event, ...(args as T))
    } catch (error) {
      throw new Error(safeError(error))
    }
  })
}

function validId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value)) {
    throw new Error('Identificador no válido.')
  }
  return value
}

function sanitizeSettingsPatch(patch: Partial<Settings>): Partial<Settings> {
  const clean: Partial<Settings> = {}
  if (typeof patch.micDeviceId === 'string') clean.micDeviceId = patch.micDeviceId.slice(0, 300)
  if (typeof patch.includeSystemAudio === 'boolean') clean.includeSystemAudio = patch.includeSystemAudio
  if (typeof patch.systemSourceId === 'string') clean.systemSourceId = patch.systemSourceId.slice(0, 300)
  if (typeof patch.micGain === 'number') clean.micGain = Math.min(2, Math.max(0, patch.micGain))
  if (typeof patch.systemGain === 'number') clean.systemGain = Math.min(2, Math.max(0, patch.systemGain))
  if (typeof patch.preserveTracks === 'boolean') clean.preserveTracks = patch.preserveTracks
  if (typeof patch.saveAudio === 'boolean') clean.saveAudio = patch.saveAudio
  if (typeof patch.liveTranscription === 'boolean') clean.liveTranscription = patch.liveTranscription
  if (typeof patch.vadAutoPause === 'boolean') clean.vadAutoPause = patch.vadAutoPause
  if (typeof patch.vadSilenceSeconds === 'number')
    clean.vadSilenceSeconds = Math.min(60, Math.max(3, Math.round(patch.vadSilenceSeconds)))
  if (typeof patch.language === 'string' && ['es', 'en', 'auto'].includes(patch.language))
    clean.language = patch.language
  if (typeof patch.selectedWhisperModel === 'string' && ['tiny', 'base', 'small'].includes(patch.selectedWhisperModel))
    clean.selectedWhisperModel = patch.selectedWhisperModel
  if (typeof patch.backupDir === 'string') clean.backupDir = patch.backupDir.slice(0, 1000)
  if (typeof patch.backupEnabled === 'boolean') clean.backupEnabled = patch.backupEnabled
  return clean
}

async function bootstrapServices(): Promise<void> {
  const dataDir = DATA_DIR
  await fsp.mkdir(dataDir, { recursive: true })
  vault = new Vault(dataDir)
  await vault.init()
  db = new Database(dataDir, vault)
  await db.open()
  const settings = db.getSettings()
  if (!settings.backupDir) {
    const dir = path.join(dataDir, 'backups')
    await fsp.mkdir(dir, { recursive: true })
    db.saveSettings({ backupDir: dir })
  }
  audioStore = new AudioStore({
    dataDir,
    vault,
    getSessionAudio: (id) => db.getSession(id)?.audio ?? null,
    setSessionAudio: (id, meta) => db.setAudioMeta(id, meta)
  })
  await audioStore.clearCache()
  await audioStore.recoverInterrupted()
  whisper = new WhisperService({
    dataDir,
    appPath: app.getAppPath(),
    resourcesPath: RESOURCES_PATH,
    db,
    callbacks: {
      onSegment: (sessionId, segment) => {
        mainWindow?.webContents.send('event:transcription', { sessionId, segment })
      },
      onError: (sessionId, message) => {
        mainWindow?.webContents.send('event:transcription-error', { sessionId, message })
      },
      onProgress: (progress) => {
        mainWindow?.webContents.send('event:download', progress)
      }
    }
  })
  await whisper.cleanupTemps()
  ai = new AiService({
    db,
    key: process.env.DEEPSEEK_API_KEY?.trim() ?? '',
    model: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash',
    baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com'
  })
  backup = new BackupService({
    db,
    vault,
    emit: (state) => mainWindow?.webContents.send('event:sync', state)
  })
  backup.start()
}

function createWindow(): void {
  const icon = iconPath('icon.png')
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: '#FFFDF5',
    title: 'LemoNotes',
    icon: icon || undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      backgroundThrottling: false
    }
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (isDev) mainWindow?.webContents.openDevTools({ mode: 'detach' })
  })

  mainWindow.on('close', (event) => {
    if (forceQuit) return
    if (recordingState.active) {
      event.preventDefault()
      mainWindow?.webContents.send('event:before-quit')
      shell.beep()
      return
    }
    forceQuit = true
    app.quit()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:') : url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  mainWindow.webContents.on('render-process-gone', () => {
    if (recordingState.sessionId) {
      try {
        db.updateSession(recordingState.sessionId, {
          status: 'error',
          error: 'La ventana se cerró de golpe. He guardado lo que había hasta ese instante.'
        })
      } catch {
        // La base de datos puede estar cerrándose.
      }
    }
    if (!quitting) {
      dialog.showErrorBox(
        'LemoNotes se ha mareado',
        'La ventana se ha cerrado de golpe. Vuelve a abrir la app: intentaré recuperar lo que hubiera guardado.'
      )
    }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'LemoNotes',
      submenu: [
        { role: 'about', label: 'Acerca de LemoNotes' },
        { type: 'separator' },
        {
          label: 'Ajustes',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('event:navigate', 'settings')
        },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        ...(isDev ? [{ role: 'toggleDevTools' as const, label: 'Herramientas de desarrollo' }] : []),
        { type: 'separator' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { role: 'resetZoom', label: 'Tamaño normal' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Abrir la carpeta de datos',
          click: () => void shell.openPath(DATA_DIR)
        },
        {
          label: 'Atajos de teclado',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'Atajos de LemoNotes',
              message: 'Atajos con zumo',
              detail:
                'Ctrl + Enter: guardar una nota mientras grabas.\nCtrl + Alt + N: abrir el cuaderno rápido durante una grabación.\nCtrl + ,: abrir Ajustes.'
            })
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createTray(): void {
  const icon = iconPath('tray.png') || iconPath('icon.png')
  if (!icon) return
  const image = nativeImage.createFromPath(icon)
  tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('LemoNotes')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Abrir LemoNotes',
        click: () => {
          mainWindow?.show()
          mainWindow?.focus()
        }
      },
      {
        label: 'Nueva nota rápida',
        click: () => mainWindow?.webContents.send('event:quick-note')
      },
      { type: 'separator' },
      {
        label: 'Salir',
        click: () => {
          if (recordingState.active) {
            mainWindow?.show()
            mainWindow?.webContents.send('event:before-quit')
          } else {
            forceQuit = true
            app.quit()
          }
        }
      }
    ])
  )
  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

function updateRecordingChrome(state: RecordingStatePayload): void {
  recordingState = state
  if (!mainWindow) return
  if (state.active) {
    const prefix = state.paused ? '⏸ Pausado' : '● Grabando'
    mainWindow.setTitle(`${prefix} — LemoNotes${state.title ? ` · ${state.title}` : ''}`)
    if (tray) tray.setToolTip(state.paused ? 'LemoNotes · grabación pausada' : 'LemoNotes · grabando y transcribiendo')
    if (!powerBlockerId && !state.paused) {
      powerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    }
    if (state.paused && powerBlockerId) {
      powerSaveBlocker.stop(powerBlockerId)
      powerBlockerId = null
    }
    if (!globalShortcutRegistered) {
      try {
        globalShortcutRegistered = globalShortcut.register('CommandOrControl+Alt+N', () => {
          mainWindow?.webContents.send('event:quick-note')
        })
      } catch {
        globalShortcutRegistered = false
      }
    }
  } else {
    mainWindow.setTitle('LemoNotes')
    if (tray) tray.setToolTip('LemoNotes')
    if (powerBlockerId) {
      powerSaveBlocker.stop(powerBlockerId)
      powerBlockerId = null
    }
    if (globalShortcutRegistered) {
      globalShortcut.unregister('CommandOrControl+Alt+N')
      globalShortcutRegistered = false
    }
  }
}

function notifyRecording(state: RecordingStatePayload): void {
  if (!state.active || state.paused) return
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: 'LemoNotes está grabando',
    body: 'Esta reunión se está transcribiendo en tu equipo. Lo verás también en la ventana y en la bandeja.',
    silent: false,
    timeoutType: 'default'
  })
  notification.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  notification.show()
}

function registerProtocol(): void {
  protocol.handle('lemon-media', async (request) => {
    try {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean)
      if (url.hostname !== 'audio' || parts.length !== 2) return new Response('No encontrado', { status: 404 })
      const sessionId = validId(decodeURIComponent(parts[0] ?? ''))
      const track = decodeURIComponent(parts[1] ?? '') as TrackKind
      if (!['mixed', 'mic', 'system'].includes(track)) return new Response('No encontrado', { status: 404 })
      const filePath = await audioStore.playbackFile(sessionId, track)
      if (!filePath) return new Response('Sin audio', { status: 404 })
      const stat = await fsp.stat(filePath)
      const range = request.headers.get('range')
      const headers: Record<string, string> = {
        'Content-Type': 'audio/wav',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      }
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range)
        if (match) {
          const start = match[1] ? Number(match[1]) : 0
          const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1
          if (start >= stat.size || start > end) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` }
            })
          }
          headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`
          headers['Content-Length'] = String(end - start + 1)
          const stream = Readable.toWeb(
            fs.createReadStream(filePath, { start, end })
          ) as unknown as ReadableStream
          return new Response(stream, { status: 206, headers })
        }
      }
      headers['Content-Length'] = String(stat.size)
      const stream = Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream
      return new Response(stream, { status: 200, headers })
    } catch {
      return new Response('No encontrado', { status: 404 })
    }
  })
}

function configureSessionPermissions(): void {
  const defaultSession = session.defaultSession
  defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission === 'media') {
      const types = (details as { mediaTypes?: string[] }).mediaTypes ?? []
      callback(types.includes('audio') || types.length === 0)
      return
    }
    if (permission === 'display-capture' || permission === 'notifications') {
      callback(true)
      return
    }
    callback(false)
  })
  defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media' || permission === 'display-capture' || permission === 'notifications'
  })
  defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const settings = db.getSettings()
        const sources = await require('electron').desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 320, height: 180 }
        })
        if (!sources.length) {
          callback({})
          return
        }
        const selected =
          sources.find(
            (source: Electron.DesktopCapturerSource) =>
              source.display_id === settings.systemSourceId || source.id === settings.systemSourceId
          ) ?? sources[0]
        callback({ video: selected, audio: 'loopback' })
      } catch {
        callback({})
      }
    },
    { useSystemPicker: false }
  )
}

function registerIpc(): void {
  handle('bootstrap', async () => {
    const sessions = db.listSessions()
    return {
      version: app.getVersion(),
      platform: process.platform,
      dataDir: DATA_DIR,
      protection: vault.protectionMode,
      settings: db.getSettings(),
      whisper: whisper.status(),
      ai: ai.status(),
      sessions,
      interrupted: db.getInterrupted().map((item) => ({ session: item, interruptedAt: item.updatedAt }))
    }
  })

  handle('sessions:list', () => db.listSessions())
  handle('sessions:search', (_event, query: string) =>
    db.searchSessions(typeof query === 'string' ? query.slice(0, 200) : '')
  )
  handle('sessions:get', (_event, id: string) => db.getSession(validId(id)))
  handle('sessions:create', (_event, input: CreateSessionInput) => {
    if (!input || (input.kind !== 'meeting' && input.kind !== 'personal')) throw new Error('Tipo de nota no válido.')
    return db.createSession({
      title: String(input.title ?? '').slice(0, 200),
      kind: input.kind,
      language: input.language ?? db.getSettings().language
    })
  })
  handle('sessions:update', (_event, id: string, patch: SessionPatch) => {
    validId(id)
    const allowed: SessionPatch = {}
    if (typeof patch.title === 'string') allowed.title = patch.title.slice(0, 200)
    if (patch.kind === 'meeting' || patch.kind === 'personal') allowed.kind = patch.kind
    if (typeof patch.status === 'string') allowed.status = patch.status
    if (typeof patch.startedAt === 'number' || patch.startedAt === null) allowed.startedAt = patch.startedAt
    if (typeof patch.endedAt === 'number' || patch.endedAt === null) allowed.endedAt = patch.endedAt
    if (typeof patch.durationMs === 'number') allowed.durationMs = Math.max(0, Math.round(patch.durationMs))
    if (typeof patch.error === 'string' || patch.error === null) allowed.error = patch.error
    if (typeof patch.language === 'string') allowed.language = patch.language
    if (typeof patch.recovered === 'boolean') allowed.recovered = patch.recovered
    return db.updateSession(id, allowed)
  })
  handle('sessions:delete', async (_event, id: string) => {
    validId(id)
    await audioStore.deleteAudio(id)
    db.softDeleteSession(id)
    return { ok: true }
  })
  handle('sessions:recover', (_event, id: string) => db.markRecovered(validId(id)))
  handle('sessions:saveActa', (_event, input: ActaSaveInput) => {
    if (!input || typeof input !== 'object') throw new Error('Acta no válida.')
    validId(input.sessionId)
    return db.saveActa(input.sessionId, input.acta, input.origins)
  })
  handle('sessions:applyProposal', (_event, sessionId: string, mode: 'fill-empty' | 'replace') => {
    if (mode !== 'fill-empty' && mode !== 'replace') throw new Error('Modo no válido.')
    return db.applyAiProposal(validId(sessionId), mode)
  })
  handle('sessions:discardProposal', (_event, sessionId: string) => db.discardAiProposal(validId(sessionId)))

  handle('notes:add', (_event, sessionId: string, atMs: number, body: string) => {
    validId(sessionId)
    if (typeof body !== 'string' || !body.trim()) throw new Error('La nota está vacía.')
    if (body.length > 20_000) throw new Error('La nota es demasiado larga.')
    return db.addNote(sessionId, Math.max(0, Number(atMs) || 0), body)
  })
  handle('notes:update', (_event, noteId: string, body: string) => {
    validId(noteId)
    if (typeof body !== 'string' || body.length > 20_000) throw new Error('Nota no válida.')
    return db.updateNote(noteId, body)
  })
  handle('notes:delete', (_event, noteId: string) => ({ ok: db.deleteNote(validId(noteId)) }))
  handle('segments:add', (_event, sessionId: string, input: { text: string; startMs: number; endMs: number }) => {
    validId(sessionId)
    if (!input || typeof input.text !== 'string') throw new Error('Segmento no válido.')
    return db.addSegment(sessionId, {
      text: input.text.slice(0, 10_000),
      startMs: Math.max(0, Number(input.startMs) || 0),
      endMs: Math.max(0, Number(input.endMs) || 0),
      source: 'human'
    })
  })
  handle('segments:update', (_event, segmentId: string, patch: { text?: string; speaker?: string }) => {
    validId(segmentId)
    return db.updateSegment(segmentId, {
      text: typeof patch.text === 'string' ? patch.text.slice(0, 10_000) : undefined,
      speaker: typeof patch.speaker === 'string' ? patch.speaker.slice(0, 80) : undefined
    })
  })

  handle('ai:generate', async (_event, sessionId: string) => {
    try {
      return await ai.generateActa(validId(sessionId))
    } catch (error) {
      throw new Error(describeAiError(error))
    }
  })
  handle('ai:local', (_event, sessionId: string) => ai.generateLocalActa(validId(sessionId)))
  handle('ai:chat', async (_event, request: AiChatRequest) => {
    try {
      return await ai.chat(request)
    } catch (error) {
      throw new Error(describeAiError(error))
    }
  })
  handle('ai:status', () => ai.status())

  handle('whisper:status', () => whisper.status())
  handle('whisper:download', async (_event, target: 'whisper' | 'model', modelId?: string) => {
    try {
      const status = target === 'whisper' ? await whisper.downloadBinary() : await whisper.downloadModel(modelId ?? 'base')
      return { ok: true, status }
    } catch (error) {
      return { ok: false, message: safeError(error), status: whisper.status() }
    }
  })

  handle('settings:get', () => db.getSettings())
  handle('settings:save', async (_event, patch: Partial<Settings>) => {
    const clean = sanitizeSettingsPatch(patch)
    if (clean.backupDir) await fsp.mkdir(clean.backupDir, { recursive: true })
    return db.saveSettings(clean)
  })
  handle('settings:chooseBackup', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: 'Elige la carpeta para tus copias de LemoNotes',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    db.saveSettings({ backupDir: result.filePaths[0] })
    return result.filePaths[0]
  })
  handle('settings:chooseWhisper', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Elige whisper-cli.exe',
      properties: ['openFile'],
      filters: [{ name: 'whisper.cpp', extensions: ['exe'] }]
    })
    if (!result.canceled && result.filePaths[0]) {
      return whisper.setCustomBinary(result.filePaths[0])
    }
    return whisper.status()
  })

  handle('app:openPath', async (_event, target: 'data' | 'backups' | 'models') => {
    const settings = db.getSettings()
    const dir =
      target === 'data' ? DATA_DIR : target === 'backups' ? settings.backupDir : path.join(DATA_DIR, 'whisper', 'models')
    await fsp.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })
  handle('app:export', async (_event, sessionId: string, format: ExportFormat) => {
    const detail = db.getSession(validId(sessionId))
    if (!detail) throw new Error('La nota no existe.')
    return exportSession(detail, format)
  })
  handle('app:screens', async (): Promise<ScreenSource[]> => {
    const sources = await require('electron').desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 320, height: 180 }
    })
    return sources.map((source: Electron.DesktopCapturerSource) => ({
      id: source.id,
      name: source.name || 'Pantalla',
      displayId: source.display_id || source.id,
      thumbnail: source.thumbnail.toDataURL()
    }))
  })
  handle('app:recording', (_event, state: RecordingStatePayload) => {
    const active = Boolean(state?.active)
    const paused = Boolean(state?.paused)
    const sessionId = state?.sessionId ? validId(state.sessionId) : null
    const previous = recordingState
    updateRecordingChrome({
      active,
      paused,
      sessionId,
      title: String(state?.title ?? '').slice(0, 200)
    })
    if (active && !previous.active) notifyRecording(recordingState)
  })
  handle('app:requestQuit', () => {
    forceQuit = true
    quitting = true
    app.quit()
    return { ok: true }
  })

  handle('audio:begin', async (_event, input: AudioBeginInput) => {
    validId(input.sessionId)
    return audioStore.begin(input)
  })
  handle('audio:append', async (_event, sessionId: string, track: TrackKind, data: ArrayBuffer) => {
    validId(sessionId)
    if (!['mixed', 'mic', 'system'].includes(track)) throw new Error('Pista no válida.')
    if (!data || data.byteLength > 8 * 1024 * 1024) throw new Error('Bloque de audio no válido.')
    const bytes = audioStore.append(sessionId, track, data)
    return { ok: true, bytes }
  })
  handle('audio:finish', async (_event, sessionId: string) => {
    validId(sessionId)
    const settings = db.getSettings()
    return audioStore.finish(sessionId, { discard: !settings.saveAudio })
  })
  handle('audio:delete', async (_event, sessionId: string) => {
    validId(sessionId)
    await audioStore.deleteAudio(sessionId)
    return db.getSession(sessionId)
  })
  handle('audio:url', async (_event, sessionId: string, track: TrackKind) => {
    validId(sessionId)
    if (!['mixed', 'mic', 'system'].includes(track)) return null
    const detail = db.getSession(sessionId)
    if (!detail?.audio?.tracks[track]) return null
    return `lemon-media://audio/${encodeURIComponent(sessionId)}/${track}`
  })
  handle('transcription:range', async (_event, input: TranscribeRangeInput) => {
    validId(input.sessionId)
    const startMs = Math.max(0, Number(input.startMs) || 0)
    const endMs = Math.max(startMs + 500, Number(input.endMs) || 0)
    const destination = path.join(
      DATA_DIR,
      'tmp',
      'whisper',
      `chunk-${input.sessionId}-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`
    )
    const extracted = await audioStore.extractRangeWav(input.sessionId, startMs, endMs, destination)
    if (!extracted) return { queued: false, message: 'Todavía no hay voz suficiente en este tramo.' }
    const language = input.sessionId ? db.getSession(input.sessionId)?.language ?? 'es' : 'es'
    return whisper.transcribeRange({
      sessionId: input.sessionId,
      wavPath: destination,
      startMs,
      endMs,
      language
    })
  })
  handle('transcription:finalize', async (_event, sessionId: string, durationMs: number) => {
    validId(sessionId)
    const status = whisper.status()
    if (!status.binaryReady || !status.modelReady) {
      return { ok: false, reason: 'whisper-missing' }
    }
    const total = Math.max(0, Math.min(Number(durationMs) || 0, 240_000))
    if (total < 600) return { ok: true }
    // En grabaciones cortas rehacemos la transcripción completa para quitar
    // solapamientos de los bloques en directo. En grabaciones largas se conserva
    // la transcripción incremental para no multiplicar el tiempo de espera.
    if (total > 180_000) return { ok: false, reason: 'too-long' }
    await whisper.waitForIdle(sessionId)
    const destination = path.join(
      DATA_DIR,
      'tmp',
      'whisper',
      `final-${sessionId}-${Date.now()}.wav`
    )
    const extracted = await audioStore.extractRangeWav(sessionId, 0, total, destination)
    if (!extracted) return { ok: false, reason: 'no-audio' }
    db.deleteSegments(sessionId)
    const language = db.getSession(sessionId)?.language ?? 'es'
    const queued = await whisper.transcribeRange({
      sessionId,
      wavPath: destination,
      startMs: 0,
      endMs: total,
      language
    })
    if (!queued.queued) return { ok: false, reason: 'not-transcribed' }
    await whisper.waitForIdle(sessionId)
    return { ok: true }
  })
  handle('transcription:wait', async (_event, sessionId: string) => {
    validId(sessionId)
    await whisper.waitForIdle(sessionId)
    return { ok: true }
  })
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  try {
    loadEnvironment()
    Menu.setApplicationMenu(null)
    await bootstrapServices()
    configureSessionPermissions()
    registerProtocol()
    registerIpc()
    createMenu()
    createWindow()
    createTray()
    if (process.platform === 'win32') {
      // La app usa el icono propio también en la barra de tareas.
      const icon = iconPath('icon.png')
      if (icon && mainWindow) mainWindow.setIcon(nativeImage.createFromPath(icon))
    }
    screen.on('display-added', () => {
      mainWindow?.webContents.send('event:displays-changed')
    })
  } catch (error) {
    dialog.showErrorBox(
      'LemoNotes no ha podido abrir su libreta',
      safeError(error) + '\n\nNo se ha borrado nada. Revisa los permisos de la carpeta de datos.'
    )
    app.quit()
  }
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
  else mainWindow.show()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    forceQuit = true
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  backup?.stop()
  if (powerBlockerId) {
    try {
      powerSaveBlocker.stop(powerBlockerId)
    } catch {
      // ya estaba parado
    }
  }
  try {
    void audioStore?.clearCache()
  } catch {
    // la caché se limpia al arrancar
  }
  try {
    db?.close()
  } catch {
    // SQLite ya puede estar cerrado
  }
  quitting = true
})

process.on('uncaughtException', (error) => {
  try {
    fs.appendFileSync(
      path.join(DATA_DIR, 'lemonotes-error.log'),
      `${new Date().toISOString()} ${error.stack ?? error.message}\n`
    )
  } catch {
    // sin espacio o sin permisos
  }
})
