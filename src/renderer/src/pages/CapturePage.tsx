import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleStop,
  Clock3,
  FileAudio,
  Gauge,
  Headphones,
  Languages,
  LoaderCircle,
  Mic2,
  MonitorSpeaker,
  NotebookPen,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  Volume2,
  WifiOff,
  Zap
} from 'lucide-react'
import type {
  Bootstrap,
  HumanNote,
  ScreenSource,
  SessionDetail,
  Settings,
  TrackKind,
  TranscriptSegment
} from '@shared/types'
import { AudioEngine, type AudioLevels } from '../audio/engine'
import { LevelMeter, SourcePill } from '../components/Meters'
import { StatusBadge } from '../components/StatusBadge'
import { Button, IconButton, Modal } from '../components/UI'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import {
  classNames,
  cleanErrorMessage,
  defaultTitle,
  formatTimer,
  plural
} from '../lib/format'

type Phase = 'idle' | 'permission' | 'preparing' | 'recording' | 'paused' | 'transcribing' | 'error'

const EMPTY_LEVELS: AudioLevels = { mic: 0, system: 0, mixed: 0 }
const SAMPLE_RATE = 16000
const CHUNK_SAMPLES = SAMPLE_RATE
const TRANSCRIPT_WINDOW_MS = 10_000
const TRANSCRIPT_OVERLAP_MS = 1_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function CapturePage({
  boot,
  kind,
  sessionId: initialSessionId,
  onFinished,
  onCancel,
  onRecordingChange,
  onBootRefresh,
  onSettings
}: {
  boot: Bootstrap
  kind: 'meeting' | 'personal'
  sessionId?: string
  onFinished: (id: string) => void
  onCancel: () => void
  onRecordingChange: (active: boolean) => void
  onBootRefresh: () => void
  onSettings: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [settings, setSettings] = useState<Settings>({
    ...boot.settings,
    includeSystemAudio: kind === 'meeting' ? boot.settings.includeSystemAudio : false
  })
  const [phase, setPhase] = useState<Phase>('idle')
  const [title, setTitle] = useState(() => defaultTitle(kind))
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [screens, setScreens] = useState<ScreenSource[]>([])
  const [screensLoading, setScreensLoading] = useState(false)
  const [levels, setLevels] = useState<AudioLevels>(EMPTY_LEVELS)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [manualNote, setManualNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [quitPrompt, setQuitPrompt] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [whisperState, setWhisperState] = useState(boot.whisper)

  const phaseRef = useRef<Phase>('idle')
  const pausedRef = useRef(false)
  const autoPausedRef = useRef(false)
  const engineRef = useRef<AudioEngine | null>(null)
  const sessionRef = useRef<SessionDetail | null>(null)
  const activeStartRef = useRef(0)
  const accumulatedRef = useRef(0)
  const lastVoiceAtRef = useRef(Date.now())
  const titleRef = useRef(title)
  const needTracksRef = useRef<Set<TrackKind>>(new Set(['mixed']))
  const pendingRef = useRef<Record<TrackKind, Int16Array[]>>({ mixed: [], mic: [], system: [] })
  const pendingSamplesRef = useRef<Record<TrackKind, number>>({ mixed: 0, mic: 0, system: 0 })
  const totalSamplesRef = useRef<Record<TrackKind, number>>({ mixed: 0, mic: 0, system: 0 })
  const writeChainRef = useRef<Promise<void>>(Promise.resolve())
  const transcriptCursorRef = useRef(0)
  const lastTranscriptEndRef = useRef(0)
  const transcriptWarningShownRef = useRef(false)
  const manualNoteRef = useRef<HTMLTextAreaElement | null>(null)
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null)
  const stoppedRef = useRef(false)
  const finishingRef = useRef(false)
  const quitAfterFinishRef = useRef(false)
  const settingsRef = useRef(settings)
  const titleSaveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    titleRef.current = title
  }, [title])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    phaseRef.current = phase
    phaseRef.current = phase
    onRecordingChange(phase === 'recording' || phase === 'paused' || phase === 'transcribing')
    return () => {
      // El padre también apaga el bloqueo cuando cambia de vista.
    }
  }, [phase, onRecordingChange])

  const refreshWhisper = useCallback(async () => {
    try {
      setWhisperState(await api().getWhisperStatus())
    } catch {
      // conserva el último estado conocido
    }
  }, [])

  useEffect(() => {
    void api()
      .listScreens()
      .then((list) => {
        setScreens(list)
        if (list[0] && !settingsRef.current.systemSourceId) {
          // Solo es una selección visual por defecto; no cambia las preferencias de audio.
          const next = { ...settingsRef.current, systemSourceId: list[0].displayId }
          settingsRef.current = next
          setSettings(next)
        }
      })
      .catch(() => setScreens([]))
    void refreshMicrophones()
    const onOnline = (): void => setOnline(true)
    const onOffline = (): void => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const offQuickNote = api().onQuickNote(() => {
      manualNoteRef.current?.focus()
      toast.show('Cuaderno rápido abierto. Apunta antes de que se escape.', 'info')
    })
    const offBeforeQuit = api().onBeforeQuit(() => setQuitPrompt(true))
    const offTranscription = api().onTranscription((event) => {
      if (event.sessionId !== sessionRef.current?.id) return
      setSession((current) => {
        if (!current || current.transcript.some((segment) => segment.id === event.segment.id)) return current
        return {
          ...current,
          transcript: [...current.transcript, event.segment].sort((a, b) => a.seq - b.seq),
          segmentCount: current.segmentCount + 1
        }
      })
    })
    const offTranscriptionError = api().onTranscriptionError((event) => {
      if (event.sessionId !== sessionRef.current?.id) return
      setWarning(event.message)
    })
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      offQuickNote()
      offBeforeQuit()
      offTranscription()
      offTranscriptionError()
      if (titleSaveTimerRef.current) window.clearTimeout(titleSaveTimerRef.current)
      if (engineRef.current) void engineRef.current.stop()
      void api().setRecordingState({ active: false, paused: false, sessionId: null, title: '' })
    }
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!initialSessionId) return
    void api()
      .getSession(initialSessionId)
      .then((detail) => {
        if (!detail) return
        setSession(detail)
        setTitle(detail.title)
        setSettings((current) => ({ ...current, language: detail.language }))
      })
      .catch(() => undefined)
  }, [initialSessionId])

  useEffect(() => {
    if (phase !== 'recording') return
    const timer = window.setInterval(() => {
      const current = accumulatedRef.current + (Date.now() - activeStartRef.current)
      setElapsedMs(current)
    }, 250)
    return () => window.clearInterval(timer)
  }, [phase])

  useEffect(() => {
    const box = transcriptBoxRef.current
    if (!box) return
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
  }, [session?.transcript.length])

  const currentElapsed = useCallback((): number => {
    if (phaseRef.current === 'recording') {
      return accumulatedRef.current + (Date.now() - activeStartRef.current)
    }
    return accumulatedRef.current
  }, [])

  const refreshMicrophones = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setMicrophones(devices.filter((device) => device.kind === 'audioinput'))
    } catch {
      setMicrophones([])
    }
  }, [])

  const updateSetting = useCallback(
    async (patch: Partial<Settings>) => {
      setSettings((current) => ({ ...current, ...patch }))
      try {
        await api().saveSettings(patch)
        const next = { ...settingsRef.current, ...patch }
        settingsRef.current = next
        setSettings(next)
      } catch (saveError) {
        toast.show(cleanErrorMessage(saveError), 'error')
      }
    },
    [toast]
  )

  const refreshScreens = useCallback(async () => {
    setScreensLoading(true)
    try {
      const list = await api().listScreens()
      setScreens(list)
      if (!list.length) toast.show('No veo pantallas que capturar. El micrófono sí funcionará.', 'info')
    } catch (screenError) {
      toast.show(cleanErrorMessage(screenError), 'error')
    } finally {
      setScreensLoading(false)
    }
  }, [toast])

  const ensureSession = useCallback(async (): Promise<SessionDetail> => {
    if (sessionRef.current) {
      if (sessionRef.current.title !== titleRef.current.trim()) {
        const updated = await api().updateSession(sessionRef.current.id, { title: titleRef.current.trim() })
        if (updated) {
          const detail = await api().getSession(updated.id)
          if (detail) {
            setSession(detail)
            sessionRef.current = detail
            return detail
          }
        }
      }
      return sessionRef.current
    }
    const created = await api().createSession({
      title: titleRef.current.trim() || defaultTitle(kind),
      kind,
      language: settingsRef.current.language
    })
    setSession(created)
    sessionRef.current = created
    return created
  }, [kind])

  const scheduleTitleSave = useCallback(
    (value: string) => {
      setTitle(value)
      titleRef.current = value
      if (titleSaveTimerRef.current) window.clearTimeout(titleSaveTimerRef.current)
      titleSaveTimerRef.current = window.setTimeout(async () => {
        const current = sessionRef.current
        if (!current || !value.trim()) return
        try {
          await api().updateSession(current.id, { title: value.trim() })
        } catch {
          // se reintenta al parar
        }
      }, 650)
    },
    []
  )

  const enqueueAudio = useCallback(
    (track: TrackKind, samples: Int16Array) => {
      if (!needTracksRef.current.has(track)) return
      pendingRef.current[track].push(samples)
      pendingSamplesRef.current[track] += samples.length
      totalSamplesRef.current[track] += samples.length
      if (pendingSamplesRef.current[track] < CHUNK_SAMPLES) return
      const chunks = pendingRef.current[track].splice(0)
      pendingSamplesRef.current[track] = 0
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const merged = new Int16Array(total)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      const copy = merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength)
      const id = sessionRef.current?.id
      if (!id) return
      writeChainRef.current = writeChainRef.current
        .then(async () => {
          await api().audioAppend(id, track, copy)
        })
        .catch((appendError) => {
          setWarning(`El audio ha tenido un tropiezo: ${cleanErrorMessage(appendError)}`)
        })
        .then(() => {
          if (track === 'mixed') void maybeTranscribe()
        })
    },
    // maybeTranscribe se define abajo mediante ref para evitar bucles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const maybeTranscribe = useCallback(async () => {
    const id = sessionRef.current?.id
    if (!id) return
    if (stoppedRef.current) return
    const totalMs = (totalSamplesRef.current.mixed / SAMPLE_RATE) * 1000
    if (totalMs - transcriptCursorRef.current < TRANSCRIPT_WINDOW_MS) return
    const start = transcriptCursorRef.current
    const end = start + TRANSCRIPT_WINDOW_MS
    transcriptCursorRef.current = end - TRANSCRIPT_OVERLAP_MS
    lastTranscriptEndRef.current = Math.max(lastTranscriptEndRef.current, end)
    try {
      const result = await api().transcribeRange({ sessionId: id, startMs: start, endMs: end })
      if (!result.queued && result.message && !transcriptWarningShownRef.current) {
        transcriptWarningShownRef.current = true
        setWarning(result.message)
      }
    } catch (transcriptionError) {
      if (!transcriptWarningShownRef.current) {
        transcriptWarningShownRef.current = true
        setWarning(cleanErrorMessage(transcriptionError))
      }
    }
  }, [])

  const handlePcm = useCallback(
    (track: TrackKind, samples: Int16Array) => {
      if (pausedRef.current || stoppedRef.current) return
      enqueueAudio(track, samples)
    },
    [enqueueAudio]
  )

  const handleLevels = useCallback((next: AudioLevels) => {
    setLevels(next)
  }, [])

  const handlePcmRef = useRef(handlePcm)
  const handleLevelsRef = useRef(handleLevels)
  const maybeTranscribeRef = useRef(maybeTranscribe)
  useEffect(() => {
    handlePcmRef.current = handlePcm
    handleLevelsRef.current = handleLevels
    maybeTranscribeRef.current = maybeTranscribe
  }, [handlePcm, handleLevels, maybeTranscribe])

  const updateSessionStatus = useCallback(
    async (status: SessionDetail['status'], extra: Record<string, unknown> = {}) => {
      const id = sessionRef.current?.id
      if (!id) return
      try {
        await api().updateSession(id, { status, ...extra })
      } catch {
        // El autosave de la nota sigue siendo la fuente de verdad.
      }
    },
    []
  )

  const pauseInternal = useCallback(
    async (auto: boolean) => {
      if (phaseRef.current !== 'recording') return
      const engine = engineRef.current
      if (!engine) return
      accumulatedRef.current += Date.now() - activeStartRef.current
      pausedRef.current = true
      autoPausedRef.current = auto
      phaseRef.current = 'paused'
      setPhase('paused')
      setElapsedMs(accumulatedRef.current)
      await engine.pause()
      await updateSessionStatus('paused', { durationMs: Math.round(accumulatedRef.current) })
      void api().setRecordingState({
        active: true,
        paused: true,
        sessionId: sessionRef.current?.id ?? null,
        title: titleRef.current
      })
      if (auto) toast.show('Silencio detectado: he puesto la grabación en pausa. Vuelvo cuando hables.', 'info')
    },
    [toast, updateSessionStatus]
  )

  const resumeInternal = useCallback(
    async (auto: boolean) => {
      if (phaseRef.current !== 'paused') return
      const engine = engineRef.current
      if (!engine) return
      activeStartRef.current = Date.now()
      pausedRef.current = false
      autoPausedRef.current = false
      lastVoiceAtRef.current = Date.now()
      phaseRef.current = 'recording'
      setPhase('recording')
      await engine.resume()
      await updateSessionStatus('recording')
      void api().setRecordingState({
        active: true,
        paused: false,
        sessionId: sessionRef.current?.id ?? null,
        title: titleRef.current
      })
      if (auto) toast.show('Te he oído. Seguimos grabando.', 'success')
    },
    [toast, updateSessionStatus]
  )

  useEffect(() => {
    if (!settings.vadAutoPause || phase !== 'recording') return
    const now = Date.now()
    if (levels.mixed > 0.035) {
      lastVoiceAtRef.current = now
      return
    }
    if (levels.mixed < 0.012 && now - lastVoiceAtRef.current > settings.vadSilenceSeconds * 1000) {
      void pauseInternal(true)
    }
  }, [levels, phase, settings.vadAutoPause, settings.vadSilenceSeconds, pauseInternal])

  useEffect(() => {
    if (!settings.vadAutoPause || phase !== 'paused' || !autoPausedRef.current) return
    if (levels.mixed > 0.045) {
      void resumeInternal(true)
    }
  }, [levels, phase, settings.vadAutoPause, resumeInternal])

  const startRecording = useCallback(async () => {
    if (phaseRef.current === 'recording' || phaseRef.current === 'preparing' || phaseRef.current === 'permission') return
    setError(null)
    setWarning(null)
    stoppedRef.current = false
    transcriptCursorRef.current = 0
    lastTranscriptEndRef.current = 0
    transcriptWarningShownRef.current = false
    totalSamplesRef.current = { mixed: 0, mic: 0, system: 0 }
    pendingRef.current = { mixed: [], mic: [], system: [] }
    pendingSamplesRef.current = { mixed: 0, mic: 0, system: 0 }
    accumulatedRef.current = 0
    setElapsedMs(0)
    phaseRef.current = 'permission'
    setPhase('permission')

    let created: SessionDetail
    try {
      created = await ensureSession()
    } catch (createError) {
      phaseRef.current = 'error'
      setPhase('error')
      setError(cleanErrorMessage(createError))
      return
    }

    await updateSessionStatus('permission')
    await api().updateSession(created.id, { startedAt: Date.now(), status: 'permission' })

    const engine = new AudioEngine({
      onPcm: (track, samples) => handlePcmRef.current(track, samples),
      onLevels: (next) => handleLevelsRef.current(next)
    })
    engineRef.current = engine
    phaseRef.current = 'preparing'
    setPhase('preparing')
    await updateSessionStatus('preparing')

    try {
      const prepared = await engine.prepare(settingsRef.current)
      if (prepared.warning) {
        setWarning(prepared.warning)
        toast.show(prepared.warning, 'info')
      }
    } catch (prepareError) {
      phaseRef.current = 'error'
      setPhase('error')
      setError(cleanErrorMessage(prepareError))
      await updateSessionStatus('error', { error: cleanErrorMessage(prepareError) })
      await engine.stop()
      engineRef.current = null
      return
    }

    const tracks: TrackKind[] = ['mixed']
    needTracksRef.current = new Set(['mixed'])
    if (settingsRef.current.preserveTracks) {
      if (engine.hasMicrophone) {
        tracks.push('mic')
        needTracksRef.current.add('mic')
      }
      if (engine.hasSystemAudio) {
        tracks.push('system')
        needTracksRef.current.add('system')
      }
    }

    try {
      await api().audioBegin({
        sessionId: created.id,
        sampleRate: SAMPLE_RATE,
        tracks
      })
    } catch (audioError) {
      phaseRef.current = 'error'
      setPhase('error')
      setError(cleanErrorMessage(audioError))
      await updateSessionStatus('error', { error: cleanErrorMessage(audioError) })
      await engine.stop()
      engineRef.current = null
      return
    }

    await engine.start()
    void refreshMicrophones()
    activeStartRef.current = Date.now()
    lastVoiceAtRef.current = Date.now()
    accumulatedRef.current = 0
    pausedRef.current = false
    autoPausedRef.current = false
    phaseRef.current = 'recording'
    setPhase('recording')
    setElapsedMs(0)
    await updateSessionStatus('recording', { startedAt: Date.now(), durationMs: 0 })
    void api().setRecordingState({
      active: true,
      paused: false,
      sessionId: created.id,
      title: titleRef.current
    })
    toast.show(
      settingsRef.current.includeSystemAudio && engine.hasSystemAudio
        ? 'Micrófono y audio del equipo activos. Esta reunión se está transcribiendo.'
        : 'Micrófono activo. Esta nota se está transcribiendo en local.',
      'success'
    )
  }, [ensureSession, refreshMicrophones, toast, updateSessionStatus])

  const flushPendingAudio = useCallback(async () => {
    const id = sessionRef.current?.id
    if (!id) return
    for (const track of ['mixed', 'mic', 'system'] as TrackKind[]) {
      const chunks = pendingRef.current[track].splice(0)
      pendingSamplesRef.current[track] = 0
      if (!chunks.length) continue
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const merged = new Int16Array(total)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      const copy = merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength)
      writeChainRef.current = writeChainRef.current.then(async () => {
        await api().audioAppend(id, track, copy)
      })
    }
    await writeChainRef.current
  }, [])

  const finishRecording = useCallback(
    async (options: { quitAfter?: boolean } = {}) => {
      if (finishingRef.current) return
      const id = sessionRef.current?.id
      if (!id) return
      finishingRef.current = true
      const engine = engineRef.current
      setFinishing(true)
      const finalElapsed = currentElapsed()
      accumulatedRef.current = finalElapsed
      pausedRef.current = true
      stoppedRef.current = true
      phaseRef.current = 'transcribing'
      setPhase('transcribing')
      setElapsedMs(finalElapsed)
      if (engine) await engine.pause()
      await delay(320)
      await flushPendingAudio()

      await updateSessionStatus('transcribing', { durationMs: Math.round(finalElapsed), endedAt: Date.now() })
      void api().setRecordingState({
        active: true,
        paused: true,
        sessionId: id,
        title: titleRef.current
      })

      const totalMs = (totalSamplesRef.current.mixed / SAMPLE_RATE) * 1000
      let finalized = false
      if (totalMs > 800) {
        try {
          const finalResult = await api().finalizeTranscription(id, totalMs)
          finalized = finalResult.ok
        } catch (finalError) {
          setWarning(cleanErrorMessage(finalError))
        }
      }

      if (!finalized && totalMs > 800) {
        const start = Math.max(0, Math.min(transcriptCursorRef.current, totalMs - 800))
        try {
          const result = await api().transcribeRange({
            sessionId: id,
            startMs: start,
            endMs: totalMs
          })
          if (!result.queued && result.message) setWarning(result.message)
        } catch (transcribeError) {
          setWarning(cleanErrorMessage(transcribeError))
        }
      }

      try {
        await api().waitForTranscription(id)
      } catch {
        // la nota sigue siendo válida aunque Whisper se atragante
      }

      if (engine) await engine.stop()
      engineRef.current = null

      try {
        await api().audioFinish(id)
      } catch (audioError) {
        setWarning(`No he podido cerrar el audio con limpieza: ${cleanErrorMessage(audioError)}`)
      }

      await api().updateSession(id, {
        status: 'review',
        title: titleRef.current.trim() || defaultTitle(kind),
        durationMs: Math.round(finalElapsed),
        endedAt: Date.now(),
        error: null
      })
      await api().setRecordingState({ active: false, paused: false, sessionId: null, title: '' })
      onRecordingChange(false)
      void onBootRefresh()
      toast.show(
        options.quitAfter
          ? 'Grabación guardada. Cerrando el limonero…'
          : 'Grabación guardada. El acta ya está lista para revisar.',
        'success'
      )
      if (options.quitAfter || quitAfterFinishRef.current) {
        quitAfterFinishRef.current = false
        await api().requestQuit()
      } else {
        onFinished(id)
      }
      setFinishing(false)
      finishingRef.current = false
    },
    [
      currentElapsed,
      flushPendingAudio,
      kind,
      onBootRefresh,
      onFinished,
      onRecordingChange,
      toast,
      updateSessionStatus
    ]
  )

  const addManualNote = useCallback(async () => {
    if (!manualNote.trim() || savingNote) return
    setSavingNote(true)
    try {
      const current = await ensureSession()
      const note = await api().addNote(current.id, currentElapsed(), manualNote)
      setSession((existing) => {
        if (!existing) return existing
        return {
          ...existing,
          notes: [...existing.notes, note].sort((a, b) => a.atMs - b.atMs),
          noteCount: existing.noteCount + 1
        }
      })
      setManualNote('')
      toast.show('Nota apuntada con zumo.', 'success')
    } catch (noteError) {
      toast.show(cleanErrorMessage(noteError), 'error')
    } finally {
      setSavingNote(false)
    }
  }, [currentElapsed, ensureSession, manualNote, savingNote, toast])

  const deleteManualNote = useCallback(
    async (note: HumanNote) => {
      try {
        await api().deleteNote(note.id)
        setSession((current) =>
          current
            ? {
                ...current,
                notes: current.notes.filter((item) => item.id !== note.id),
                noteCount: Math.max(0, current.noteCount - 1)
              }
            : current
        )
        toast.show('Nota fuera. El resto sigue intacto.', 'success')
      } catch (noteError) {
        toast.show(cleanErrorMessage(noteError), 'error')
      }
    },
    [toast]
  )

  const seekPreview = (ms: number): void => {
    if (phase === 'recording' || phase === 'paused') {
      toast.show(`Esa nota está anclada en ${formatTimer(ms)}. La escucharás al terminar.`, 'info')
    }
  }

  const active = phase === 'recording' || phase === 'paused' || phase === 'transcribing'
  const isPaused = phase === 'paused'
  const whisperReady = whisperState.binaryReady && whisperState.modelReady
  const systemAvailable = screens.length > 0
  const selectedScreen = screens.find(
    (screen) => screen.displayId === settings.systemSourceId || screen.id === settings.systemSourceId
  ) ?? screens[0]

  return (
    <div className={classNames('page capture-page', active && 'is-recording')}>
      <header className="capture-header">
        <div className="capture-header-left">
          <IconButton
            label="Volver"
            onClick={() => {
              if (active) {
                toast.show('Para salir, detén la grabación primero.', 'info')
                return
              }
              onCancel()
            }}
            className={active ? 'is-disabled' : ''}
          >
            <ArrowLeft size={20} />
          </IconButton>
          <div className="capture-title-wrap">
            <p className="eyebrow">{kind === 'meeting' ? 'Nueva reunión' : 'Nota de mi voz'}</p>
            <input
              className="capture-title-input"
              value={title}
              maxLength={200}
              onChange={(event) => scheduleTitleSave(event.target.value)}
              onBlur={() => {
                if (sessionRef.current && title.trim()) {
                  void api().updateSession(sessionRef.current.id, { title: title.trim() })
                }
              }}
              aria-label="Título de la nota"
              disabled={phase === 'transcribing'}
            />
          </div>
        </div>
        <div className="capture-header-right">
          {!online && (
            <span className="offline-pill">
              <WifiOff size={14} /> Sin conexión
            </span>
          )}
          <StatusBadge
            status={
              phase === 'idle'
                ? 'inactive'
                : phase === 'permission'
                  ? 'permission'
                  : phase === 'preparing'
                    ? 'preparing'
                    : phase === 'recording'
                      ? 'recording'
                      : phase === 'paused'
                        ? 'paused'
                        : phase === 'transcribing'
                          ? 'transcribing'
                          : 'error'
            }
          />
        </div>
      </header>

      {(phase === 'recording' || isPaused || phase === 'transcribing') && (
        <div className={classNames('live-notice', isPaused && 'is-paused', phase === 'transcribing' && 'is-working')}>
          <span className="live-notice-pulse" />
          <div>
            <strong>
              {phase === 'recording'
                ? kind === 'meeting'
                  ? 'Esta reunión se está transcribiendo'
                  : 'Esta nota se está transcribiendo'
                : phase === 'paused'
                  ? 'Grabación en pausa: el micro está callado'
                  : 'Estoy ordenando las últimas palabras'}
            </strong>
            <span>
              {phase === 'transcribing'
                ? 'No cierres la app. Tus notas humanas ya están guardadas.'
                : 'El audio se queda en tu equipo. La bandeja y el título de la ventana también lo avisan.'}
            </span>
          </div>
          <span className="live-notice-time">{formatTimer(elapsedMs)}</span>
        </div>
      )}

      {error && (
        <div className="inline-alert alert-error">
          <TriangleAlert size={19} />
          <div>
            <strong>Algo se ha atascado.</strong>
            <span>{error}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void startRecording()}>
            Reintentar
          </Button>
        </div>
      )}
      {warning && (
        <div className="inline-alert alert-warning">
          <AlertTriangle size={19} />
          <div>
            <strong>Aviso con cáscara.</strong>
            <span>{warning}</span>
          </div>
          <button className="alert-close" onClick={() => setWarning(null)}>
            Cerrar
          </button>
        </div>
      )}

      <div className="capture-layout">
        <div className="capture-main">
          {active ? (
            <section className="recorder-card">
              <div className="recorder-topline">
                <span className={classNames('recorder-status', isPaused && 'is-paused', phase === 'transcribing' && 'is-working')}>
                  <span className="recorder-dot" />
                  {phase === 'recording' ? (settings.vadAutoPause ? 'Grabando · pausa por voz activa' : 'Grabando') : isPaused ? 'En pausa' : 'Transcribiendo'}
                </span>
                <span className="recorder-quality">
                  <ShieldCheck size={14} /> Local · cifrado al guardar
                </span>
              </div>

              <div className={classNames('recorder-visual', isPaused && 'is-paused')}>
                <span className="recorder-ring ring-one" />
                <span className="recorder-ring ring-two" />
                <span className="recorder-ring ring-three" />
                <div className="recorder-time">{formatTimer(elapsedMs)}</div>
                <div className="recorder-wave" aria-hidden="true">
                  {Array.from({ length: 38 }, (_, index) => {
                    const wave = Math.abs(Math.sin(index * 0.62 + elapsedMs / 900))
                    const height = isPaused ? 5 : Math.max(4, wave * levels.mixed * 105 + (index % 5) * 2)
                    return <span key={index} style={{ height: `${height}px` }} />
                  })}
                </div>
              </div>

              <div className="recorder-levels">
                <LevelMeter level={levels.mic} label="Tu micrófono" tone="green" active={!isPaused} />
                {settings.includeSystemAudio && (
                  <LevelMeter
                    level={levels.system}
                    label="Audio del equipo"
                    tone="purple"
                    active={!isPaused && Boolean(engineRef.current?.hasSystemAudio)}
                  />
                )}
              </div>

              <div className="recorder-actions">
                {phase === 'transcribing' ? (
                  <div className="finishing-state">
                    <LoaderCircle className="spin" size={22} />
                    <div>
                      <strong>Whisper está escuchando lo último.</strong>
                      <span>En cuanto termine, te dejo el acta en revisión.</span>
                    </div>
                  </div>
                ) : isPaused ? (
                  <>
                    <Button variant="purple" size="lg" icon={<Play size={20} />} onClick={() => void resumeInternal(false)}>
                      Reanudar
                    </Button>
                    <Button variant="primary" size="lg" icon={<Square size={17} />} onClick={() => void finishRecording()}>
                      Terminar y guardar
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" size="lg" icon={<Pause size={20} />} onClick={() => void pauseInternal(false)}>
                      Pausar
                    </Button>
                    <Button variant="primary" size="lg" icon={<CircleStop size={20} />} onClick={() => void finishRecording()}>
                      Terminar y guardar
                    </Button>
                  </>
                )}
              </div>

              <div className="recorder-hints">
                <span>
                  <Zap size={14} /> Ctrl + Alt + N abre el cuaderno rápido
                </span>
                <span>
                  <NotebookPen size={14} /> Ctrl + Enter guarda una nota manual
                </span>
              </div>
            </section>
          ) : (
            <section className="setup-card">
              <div className="setup-heading">
                <div>
                  <p className="eyebrow">Antes de dar al rojo</p>
                  <h2>Prepara las orejas</h2>
                </div>
                <span className="setup-sticker">
                  <Sparkles size={14} /> Se pide permiso al empezar
                </span>
              </div>

              <div className="source-block">
                <div className="source-row">
                  <span className="source-row-icon mic">
                    <Mic2 size={20} />
                  </span>
                  <div className="source-row-copy">
                    <strong>Tu micrófono</strong>
                    <span>Tu voz, siempre en primera fila.</span>
                  </div>
                  <select
                    className="source-select"
                    value={settings.micDeviceId}
                    onChange={(event) => void updateSetting({ micDeviceId: event.target.value })}
                    disabled={active}
                    aria-label="Elegir micrófono"
                  >
                    <option value="">Micrófono del sistema</option>
                    {microphones.map((device, index) => (
                      <option key={device.deviceId || index} value={device.deviceId}>
                        {device.label || `Micrófono ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="source-row source-row-system">
                  <span className="source-row-icon system">
                    <MonitorSpeaker size={20} />
                  </span>
                  <div className="source-row-copy">
                    <strong>Audio del equipo</strong>
                    <span>Videollamadas, navegador, reproductores… todo lo que suene.</span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={settings.includeSystemAudio}
                    aria-label="Capturar audio del equipo"
                    className={classNames('toggle', settings.includeSystemAudio && 'is-on')}
                    onClick={() => void updateSetting({ includeSystemAudio: !settings.includeSystemAudio })}
                  >
                    <span className="toggle-thumb" />
                  </button>
                </div>

                {settings.includeSystemAudio && (
                  <div className="screen-picker">
                    <div className="screen-picker-head">
                      <span>
                        <MonitorSpeaker size={15} /> Fuente del sistema
                      </span>
                      <button className="text-link mini" onClick={() => void refreshScreens()} disabled={screensLoading}>
                        <RefreshCw size={13} className={screensLoading ? 'spin' : ''} /> Actualizar
                      </button>
                    </div>
                    {screens.length ? (
                      <div className="screen-options">
                        {screens.map((screen) => (
                          <button
                            key={screen.id}
                            className={classNames(
                              'screen-option',
                              selectedScreen?.id === screen.id && 'is-selected'
                            )}
                            onClick={() => void updateSetting({ systemSourceId: screen.displayId || screen.id })}
                          >
                            <img src={screen.thumbnail} alt="" />
                            <span>{screen.name}</span>
                            {selectedScreen?.id === screen.id && (
                              <em>
                                <Check size={12} /> Elegida
                              </em>
                            )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="screen-empty">
                        {screensLoading ? 'Buscando pantallas…' : 'No encuentro una pantalla para tomar el audio.'}
                      </p>
                    )}
                    <p className="technical-hint">
                      El audio del equipo se toma del <strong>dispositivo de salida predeterminado de Windows</strong>.
                      Si la reunión suena en unos cascos u otro altavoz, ponlo como predeterminado antes de grabar. La
                      pantalla no se graba; solo se usa como llave técnica.
                    </p>
                  </div>
                )}
              </div>

              <button className="advanced-toggle" onClick={() => setAdvancedOpen((open) => !open)}>
                <Settings2 size={15} /> Mezcla fina y voz
                <ChevronDown size={15} className={advancedOpen ? 'rotate-180' : ''} />
              </button>
              {advancedOpen && (
                <div className="advanced-panel">
                  <label className="slider-field">
                    <span>
                      Volumen del micrófono <strong>{Math.round(settings.micGain * 100)}%</strong>
                    </span>
                    <input
                      type="range"
                      min={0.2}
                      max={1.6}
                      step={0.05}
                      value={settings.micGain}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        setSettings((current) => ({ ...current, micGain: value }))
                      }}
                      onMouseUp={() => void updateSetting({ micGain: settingsRef.current.micGain })}
                    />
                  </label>
                  <label className="slider-field">
                    <span>
                      Volumen del equipo <strong>{Math.round(settings.systemGain * 100)}%</strong>
                    </span>
                    <input
                      type="range"
                      min={0.2}
                      max={1.6}
                      step={0.05}
                      value={settings.systemGain}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        setSettings((current) => ({ ...current, systemGain: value }))
                      }}
                      onMouseUp={() => void updateSetting({ systemGain: settingsRef.current.systemGain })}
                    />
                  </label>
                  <div className="advanced-switches">
                    <label className="mini-check">
                      <input
                        type="checkbox"
                        checked={settings.preserveTracks}
                        onChange={(event) => void updateSetting({ preserveTracks: event.target.checked })}
                      />
                      Guardar pistas separadas (micrófono y equipo)
                    </label>
                    <label className="mini-check">
                      <input
                        type="checkbox"
                        checked={settings.vadAutoPause}
                        onChange={(event) => void updateSetting({ vadAutoPause: event.target.checked })}
                      />
                      Pausar solo en silencios largos
                    </label>
                    <label className="mini-check">
                      <input
                        type="checkbox"
                        checked={settings.liveTranscription}
                        onChange={(event) => void updateSetting({ liveTranscription: event.target.checked })}
                      />
                      Ver la transcripción en directo
                    </label>
                  </div>
                </div>
              )}

              <div className="setup-status-grid">
                <div className={classNames('setup-status', whisperReady ? 'is-ok' : 'is-warn')}>
                  <span className="setup-status-icon">
                    <Mic2 size={18} />
                  </span>
                  <div>
                    <strong>Whisper.cpp local</strong>
                    <span>{whisperReady ? 'Orejas listas, sin cuotas' : whisperState.error || 'Falta preparar el modelo'}</span>
                  </div>
                  {!whisperReady && (
                    <button className="text-link mini" onClick={onSettings}>
                      Preparar
                    </button>
                  )}
                </div>
                <div className={classNames('setup-status', boot.ai.configured ? 'is-purple' : 'is-muted')}>
                  <span className="setup-status-icon">
                    <Sparkles size={18} />
                  </span>
                  <div>
                    <strong>DeepSeek Flash</strong>
                    <span>{boot.ai.configured ? 'Limo puede ordenar el acta' : 'Falta DEEPSEEK_API_KEY en .env'}</span>
                  </div>
                  {!boot.ai.configured && (
                    <button className="text-link mini" onClick={onSettings}>
                      Ver clave
                    </button>
                  )}
                </div>
                <div className="setup-status is-neutral">
                  <span className="setup-status-icon">
                    <Languages size={18} />
                  </span>
                  <div>
                    <strong>Idioma</strong>
                    <select
                      value={settings.language}
                      onChange={(event) => void updateSetting({ language: event.target.value })}
                      aria-label="Idioma de la transcripción"
                    >
                      <option value="es">Español</option>
                      <option value="en">Inglés</option>
                      <option value="auto">Detectar solo</option>
                    </select>
                  </div>
                </div>
                <div className="setup-status is-neutral">
                  <span className="setup-status-icon">
                    <FileAudio size={18} />
                  </span>
                  <div>
                    <strong>Guardar audio</strong>
                    <span>{settings.saveAudio ? 'Sí, cifrado en local' : 'No, solo texto'}</span>
                  </div>
                  <button className="text-link mini" onClick={onSettings}>
                    Cambiar
                  </button>
                </div>
              </div>

              <div className="setup-cta-row">
                <Button
                  variant="primary"
                  size="lg"
                  icon={<Mic2 size={21} />}
                  onClick={() => void startRecording()}
                  className="start-recording-btn"
                >
                  {kind === 'meeting' ? 'Empezar la reunión' : 'Empezar a hablar'}
                </Button>
                <p>
                  <ShieldCheck size={15} /> Al empezar verás el aviso de grabación. Nada se sube a ninguna nube.
                </p>
              </div>
            </section>
          )}

          {active && (
            <section className="sources-live-card">
              <div className="mini-section-heading">
                <div>
                  <p className="eyebrow">Fuentes en directo</p>
                  <h3>{settings.includeSystemAudio ? 'Tú + lo que suena' : 'Tu voz, sin acompañamiento'}</h3>
                </div>
                <div className="source-pills">
                  <SourcePill icon="mic" label="Micrófono" />
                  {settings.includeSystemAudio && (
                    <SourcePill
                      icon="system"
                      label={engineRef.current?.hasSystemAudio ? 'Equipo' : 'Equipo sin señal'}
                    />
                  )}
                  <SourcePill icon="mixed" label="Mezcla" />
                </div>
              </div>
              <LevelMeter level={levels.mixed} label="Mezcla final" tone="red" active={!isPaused} />
              <p className="sources-note">
                <ShieldCheck size={14} /> {settings.preserveTracks ? 'Se guardarán también las pistas separadas.' : 'Se guarda una mezcla limpia en local.'}
              </p>
            </section>
          )}
        </div>

        <aside className="capture-side">
          <section className="live-panel">
            <div className="live-panel-head">
              <div>
                <p className="eyebrow">Lo que se dice</p>
                <h3>Transcripción</h3>
              </div>
              <span className={classNames('live-chip', active && phase !== 'transcribing' && 'is-live')}>
                <Radio size={13} /> {phase === 'recording' ? 'En directo' : phase === 'paused' ? 'En pausa' : phase === 'transcribing' ? 'Cerrando' : 'Esperando'}
              </span>
            </div>

            {!active && (
              <div className="transcript-empty">
                <span className="transcript-empty-icon">
                  <Volume2 size={28} />
                </span>
                <h4>Aquí aparecerá la conversación.</h4>
                <p>
                  Whisper la escucha en tu equipo y la va escribiendo por bloques. Tú puedes apuntar lo importante a la
                  derecha mientras tanto.
                </p>
              </div>
            )}

            {active && (
              <div className="transcript-box" ref={transcriptBoxRef}>
                {session?.transcript.length ? (
                  session.transcript.map((segment) => (
                    <div key={segment.id} className="transcript-line">
                      <span className="transcript-time">{formatTimer(segment.startMs)}</span>
                      <div>
                        <span className="transcript-speaker">{segment.speaker || 'Voz'}</span>
                        <p>{segment.text}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="transcript-waiting">
                    <span className="waiting-dots">
                      <span />
                      <span />
                      <span />
                    </span>
                    <p>{phase === 'transcribing' ? 'Recogiendo las últimas palabras…' : 'Escuchando. Habla con naturalidad.'}</p>
                    <small>La primera transcripción tarda unos segundos en cocerse.</small>
                  </div>
                )}
                {phase === 'recording' && session?.transcript.length && (
                  <div className="transcript-live-cursor">
                    <span /> escuchando…
                  </div>
                )}
              </div>
            )}

            <div className="live-panel-foot">
              <span>
                <LockCheck /> {settings.liveTranscription ? 'Texto local en tiempo real' : 'Transcripción al terminar'}
              </span>
              <span>{session?.transcript.length ?? 0} bloques</span>
            </div>
          </section>

          <section className="quick-notes-panel">
            <div className="quick-notes-head">
              <div>
                <p className="eyebrow">Tu capa</p>
                <h3>Notas con ancla</h3>
              </div>
              <span className="anchor-badge">
                <Clock3 size={13} /> {formatTimer(currentElapsed())}
              </span>
            </div>
            <div className="quick-note-composer">
              <textarea
                ref={manualNoteRef}
                value={manualNote}
                onChange={(event) => setManualNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.ctrlKey && event.key === 'Enter') {
                    event.preventDefault()
                    void addManualNote()
                  }
                }}
                placeholder="Apunta lo que no quieres que se pierda…"
                rows={3}
                maxLength={20000}
                aria-label="Nota manual"
              />
              <div className="quick-note-actions">
                <span>Ctrl + Enter para guardar</span>
                <Button
                  variant="purple"
                  size="sm"
                  icon={<Plus size={16} />}
                  onClick={() => void addManualNote()}
                  loading={savingNote}
                  disabled={!manualNote.trim()}
                >
                  Añadir nota
                </Button>
              </div>
            </div>

            <div className="quick-note-list">
              {session?.notes.length ? (
                session.notes.map((note) => (
                  <div key={note.id} className="quick-note-item">
                    <button className="note-anchor" onClick={() => seekPreview(note.atMs)}>
                      {formatTimer(note.atMs)}
                    </button>
                    <p>{note.body}</p>
                    <IconButton label="Borrar nota" onClick={() => void deleteManualNote(note)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                ))
              ) : (
                <p className="quick-note-empty">Aún no has apuntado nada. Esa primera nota puede ser una palabra.</p>
              )}
            </div>
          </section>
        </aside>
      </div>

      <Modal
        open={quitPrompt}
        onClose={() => setQuitPrompt(false)}
        title="La grabación sigue viva"
        eyebrow="Antes de cerrar"
        dismissable={false}
        footer={
          <div className="modal-button-row">
            <Button variant="ghost" onClick={() => setQuitPrompt(false)}>
              {phase === 'transcribing' ? 'Seguir esperando' : 'Seguir grabando'}
            </Button>
            {phase === 'transcribing' ? (
              <Button
                variant="primary"
                onClick={() => {
                  quitAfterFinishRef.current = true
                  setQuitPrompt(false)
                  toast.show('Cerraré en cuanto Whisper termine el acta. No se perderá nada.', 'info')
                }}
              >
                Salir cuando termine
              </Button>
            ) : (
              <Button variant="primary" loading={finishing} onClick={() => void finishRecording({ quitAfter: true })}>
                Detener, guardar y salir
              </Button>
            )}
          </div>
        }
      >
        <p>
          Si cierras ahora, perderías la última parte del audio. Puedo detener la captura, guardar lo que hay y cerrar
          con la conciencia tranquila.
        </p>
        <div className="modal-warning">
          <AlertTriangle size={18} /> El aviso de grabación seguirá visible hasta que esto termine.
        </div>
      </Modal>
    </div>
  )
}

function LockCheck(): React.JSX.Element {
  return <ShieldCheck size={13} />
}
