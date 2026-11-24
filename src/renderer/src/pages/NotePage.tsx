import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  Edit3,
  FileJson,
  FileText,
  Headphones,
  Layers,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  Mic2,
  MoreHorizontal,
  NotebookPen,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  SquareStack,
  Target,
  Trash2,
  TriangleAlert,
  WandSparkles,
  X
} from 'lucide-react'
import type {
  Acta,
  ActaOrigins,
  ActaSection,
  AiProposal,
  Bootstrap,
  ChatTurn,
  ExportFormat,
  HumanNote,
  SessionDetail,
  TaskItem,
  TranscriptSegment
} from '@shared/types'
import { ACTA_SECTION_LABELS, emptyActa } from '@shared/types'
import { AudioPlayer, type AudioPlayerHandle } from '../components/AudioPlayer'
import { LemonMark } from '../components/Brand'
import { StatusBadge } from '../components/StatusBadge'
import { Button, IconButton, Modal } from '../components/UI'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import {
  classNames,
  cleanErrorMessage,
  formatClock,
  formatDateLong,
  formatDurationWords,
  formatTimer,
  plural,
  shortRelative
} from '../lib/format'

type Tab = 'acta' | 'transcript' | 'layers' | 'ask'
type Layer = 'all' | 'mine' | 'ai'
type SaveState = 'saved' | 'saving' | 'error'

function newTask(): TaskItem {
  return { id: crypto.randomUUID(), text: '', owner: '', due: '', done: false }
}

function sectionHasContent(acta: Acta, section: ActaSection): boolean {
  if (section === 'summary') return Boolean(acta.summary.trim())
  return acta[section].length > 0
}

export function NotePage({
  sessionId,
  boot,
  onBack,
  onOpenSettings,
  onDeleted,
  onUpdated,
  onNewNote
}: {
  sessionId: string
  boot: Bootstrap
  onBack: () => void
  onOpenSettings: () => void
  onDeleted: (id: string) => void
  onUpdated: () => void
  onNewNote: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('acta')
  const [layer, setLayer] = useState<Layer>('all')
  const [title, setTitle] = useState('')
  const [acta, setActa] = useState<Acta>(emptyActa())
  const [origins, setOrigins] = useState<ActaOrigins>({
    summary: 'empty',
    decisions: 'empty',
    tasks: 'empty',
    nextSteps: 'empty'
  })
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [aiBusy, setAiBusy] = useState<'deepseek' | 'local' | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [proposalBusy, setProposalBusy] = useState<string | null>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteAudioOpen, setDeleteAudioOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteAnchorMs, setNoteAnchorMs] = useState(0)
  const [savingNote, setSavingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteBody, setEditingNoteBody] = useState('')
  const [transcriptQuery, setTranscriptQuery] = useState('')
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null)
  const [editingSegmentBody, setEditingSegmentBody] = useState('')
  const [chat, setChat] = useState<ChatTurn[]>([])
  const [chatQuestion, setChatQuestion] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const audioPlayerRef = useRef<AudioPlayerHandle | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const latestActaRef = useRef<Acta>(emptyActa())
  const titleTimerRef = useRef<number | null>(null)
  const savingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api()
      .getSession(sessionId)
      .then((detail) => {
        if (cancelled) return
        if (!detail) {
          setError('Esta nota ya no existe en la despensa.')
          return
        }
        setSession(detail)
        setTitle(detail.title)
        setActa(detail.acta)
        latestActaRef.current = detail.acta
        setOrigins(detail.origins)
      })
      .catch((loadError) => !cancelled && setError(cleanErrorMessage(loadError)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current)
    }
  }, [])

  const refreshSession = useCallback(async () => {
    const detail = await api().getSession(sessionId)
    if (!detail) return null
    setSession(detail)
    setOrigins(detail.origins)
    return detail
  }, [sessionId])

  const persistActa = useCallback(
    async (next: Acta) => {
      if (savingRef.current) {
        saveTimerRef.current = window.setTimeout(() => void persistActa(latestActaRef.current), 500)
        return
      }
      savingRef.current = true
      setSaveState('saving')
      try {
        const detail = await api().saveActa({ sessionId, acta: next })
        setSession(detail)
        setOrigins(detail.origins)
        setSaveState('saved')
        onUpdated()
      } catch (saveError) {
        setSaveState('error')
        setAiError(cleanErrorMessage(saveError))
      } finally {
        savingRef.current = false
      }
    },
    [onUpdated, sessionId]
  )

  const patchActa = useCallback(
    (updater: (current: Acta) => Acta) => {
      setActa((current) => {
        const next = updater(current)
        latestActaRef.current = next
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = window.setTimeout(() => void persistActa(next), 700)
        return next
      })
      setSaveState('saving')
    },
    [persistActa]
  )

  const updateTitle = useCallback(
    (value: string) => {
      setTitle(value)
      if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current)
      titleTimerRef.current = window.setTimeout(async () => {
        try {
          const summary = await api().updateSession(sessionId, { title: value.trim() || 'Nota sin título' })
          if (summary) {
            setSession((current) => (current ? { ...current, title: summary.title } : current))
            onUpdated()
          }
        } catch (titleError) {
          toast.show(cleanErrorMessage(titleError), 'error')
        }
      }, 650)
    },
    [onUpdated, sessionId, toast]
  )

  const addDecision = (): void => {
    patchActa((current) => ({ ...current, decisions: [...current.decisions, ''] }))
  }

  const updateDecision = (index: number, value: string): void => {
    patchActa((current) => ({
      ...current,
      decisions: current.decisions.map((item, itemIndex) => (itemIndex === index ? value : item))
    }))
  }

  const removeDecision = (index: number): void => {
    patchActa((current) => ({ ...current, decisions: current.decisions.filter((_, itemIndex) => itemIndex !== index) }))
  }

  const addNextStep = (): void => {
    patchActa((current) => ({ ...current, nextSteps: [...current.nextSteps, ''] }))
  }

  const updateNextStep = (index: number, value: string): void => {
    patchActa((current) => ({
      ...current,
      nextSteps: current.nextSteps.map((item, itemIndex) => (itemIndex === index ? value : item))
    }))
  }

  const removeNextStep = (index: number): void => {
    patchActa((current) => ({ ...current, nextSteps: current.nextSteps.filter((_, itemIndex) => itemIndex !== index) }))
  }

  const addTask = (): void => {
    patchActa((current) => ({ ...current, tasks: [...current.tasks, newTask()] }))
  }

  const updateTask = (index: number, patch: Partial<TaskItem>): void => {
    patchActa((current) => ({
      ...current,
      tasks: current.tasks.map((task, itemIndex) => (itemIndex === index ? { ...task, ...patch } : task))
    }))
  }

  const removeTask = (index: number): void => {
    patchActa((current) => ({ ...current, tasks: current.tasks.filter((_, itemIndex) => itemIndex !== index) }))
  }

  const generate = useCallback(
    async (mode: 'deepseek' | 'local') => {
      setAiBusy(mode)
      setAiError(null)
      try {
        const result =
          mode === 'deepseek' ? await api().generateActa(sessionId) : await api().generateLocalActa(sessionId)
        setSession(result.detail)
        setActa(result.detail.acta)
        latestActaRef.current = result.detail.acta
        setOrigins(result.detail.origins)
        setSaveState('saved')
        toast.show(
          result.applied
            ? mode === 'deepseek'
              ? 'Limo ha cocinado el acta y ha rellenado los huecos. Revísala con cariño.'
              : 'Borrador local listo. Sin nube, sin chispa artificial.'
            : 'Propuesta lista. No he tocado tu acta; decide tú qué entra.',
          'success'
        )
        onUpdated()
      } catch (generationError) {
        setAiError(cleanErrorMessage(generationError))
      } finally {
        setAiBusy(null)
      }
    },
    [onUpdated, sessionId, toast]
  )

  const applyProposal = useCallback(
    async (mode: 'fill-empty' | 'replace') => {
      setProposalBusy(mode)
      try {
        const detail = await api().applyAiProposal(sessionId, mode)
        setSession(detail)
        setActa(detail.acta)
        latestActaRef.current = detail.acta
        setOrigins(detail.origins)
        setReplaceOpen(false)
        toast.show(
          mode === 'replace'
            ? 'Propuesta aplicada. Tu versión anterior queda archivada por si acaso.'
            : 'He rellenado solo los huecos. Lo tuyo sigue mandando.',
          'success'
        )
        onUpdated()
      } catch (applyError) {
        toast.show(cleanErrorMessage(applyError), 'error')
      } finally {
        setProposalBusy(null)
      }
    },
    [onUpdated, sessionId, toast]
  )

  const discardProposal = useCallback(async () => {
    try {
      const detail = await api().discardAiProposal(sessionId)
      setSession(detail)
      toast.show('Propuesta descartada. El limón no se ofende.', 'success')
    } catch (discardError) {
      toast.show(cleanErrorMessage(discardError), 'error')
    }
  }, [sessionId, toast])

  const addNote = useCallback(async () => {
    if (!noteDraft.trim() || savingNote) return
    setSavingNote(true)
    try {
      const note = await api().addNote(sessionId, noteAnchorMs, noteDraft)
      setSession((current) =>
        current
          ? { ...current, notes: [...current.notes, note].sort((a, b) => a.atMs - b.atMs), noteCount: current.noteCount + 1 }
          : current
      )
      setNoteDraft('')
      toast.show('Nota añadida a la capa humana.', 'success')
      onUpdated()
    } catch (noteError) {
      toast.show(cleanErrorMessage(noteError), 'error')
    } finally {
      setSavingNote(false)
    }
  }, [noteAnchorMs, noteDraft, onUpdated, savingNote, sessionId, toast])

  const saveEditedNote = useCallback(
    async (note: HumanNote) => {
      try {
        const updated = await api().updateNote(note.id, editingNoteBody)
        if (updated) {
          setSession((current) =>
            current
              ? { ...current, notes: current.notes.map((item) => (item.id === note.id ? updated : item)) }
              : current
          )
        }
        setEditingNoteId(null)
        toast.show('Nota corregida sin perder el original de la IA.', 'success')
      } catch (noteError) {
        toast.show(cleanErrorMessage(noteError), 'error')
      }
    },
    [editingNoteBody, toast]
  )

  const deleteNote = useCallback(
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
        onUpdated()
      } catch (noteError) {
        toast.show(cleanErrorMessage(noteError), 'error')
      }
    },
    [onUpdated, toast]
  )

  const saveSegment = useCallback(
    async (segment: TranscriptSegment) => {
      if (editingSegmentBody === segment.text) {
        setEditingSegmentId(null)
        return
      }
      try {
        const updated = await api().updateSegment(segment.id, { text: editingSegmentBody })
        if (updated) {
          setSession((current) =>
            current
              ? {
                  ...current,
                  transcript: current.transcript.map((item) => (item.id === updated.id ? updated : item))
                }
              : current
          )
        }
        setEditingSegmentId(null)
      } catch (segmentError) {
        toast.show(cleanErrorMessage(segmentError), 'error')
      }
    },
    [editingSegmentBody, toast]
  )

  const saveSpeaker = useCallback(
    async (segment: TranscriptSegment, speaker: string) => {
      if (speaker === segment.speaker) return
      try {
        const updated = await api().updateSegment(segment.id, { speaker })
        if (updated) {
          setSession((current) =>
            current
              ? {
                  ...current,
                  transcript: current.transcript.map((item) => (item.id === updated.id ? updated : item))
                }
              : current
          )
        }
      } catch (segmentError) {
        toast.show(cleanErrorMessage(segmentError), 'error')
      }
    },
    [toast]
  )

  const exportNote = async (format: ExportFormat): Promise<void> => {
    setExportOpen(false)
    try {
      const result = await api().exportSession(sessionId, format)
      if (result.saved) toast.show('Acta exportada y lista para compartir.', 'success')
    } catch (exportError) {
      toast.show(cleanErrorMessage(exportError), 'error')
    }
  }

  const copyTranscript = async (): Promise<void> => {
    if (!session) return
    const text = session.transcript
      .map((segment) => `[${formatTimer(segment.startMs)}] ${segment.speaker || 'Voz'}: ${segment.text}`)
      .join('\n')
    await navigator.clipboard.writeText(text)
    toast.show('Transcripción copiada con su cronología.', 'success')
  }

  const deleteSession = async (): Promise<void> => {
    try {
      await api().deleteSession(sessionId)
      setDeleteOpen(false)
      toast.show('Nota eliminada. El limonero respira.', 'success')
      onDeleted(sessionId)
    } catch (deleteError) {
      toast.show(cleanErrorMessage(deleteError), 'error')
    }
  }

  const deleteAudio = async (): Promise<void> => {
    try {
      const detail = await api().deleteAudio(sessionId)
      if (detail) setSession(detail)
      setDeleteAudioOpen(false)
      toast.show('Audio eliminado del equipo. El texto sigue contigo.', 'success')
    } catch (deleteError) {
      toast.show(cleanErrorMessage(deleteError), 'error')
    }
  }

  const ask = useCallback(
    async (question: string) => {
      if (!question.trim() || chatBusy) return
      const clean = question.trim()
      setChatQuestion('')
      const nextHistory = [...chat, { role: 'user' as const, content: clean }]
      setChat(nextHistory)
      setChatBusy(true)
      try {
        const response = await api().chat({
          sessionId,
          question: clean,
          history: chat.slice(-8)
        })
        setChat([...nextHistory, { role: 'assistant', content: response.answer }])
      } catch (chatError) {
        setChat([
          ...nextHistory,
          {
            role: 'assistant',
            content: `No he podido responder: ${cleanErrorMessage(chatError)}`
          }
        ])
      } finally {
        setChatBusy(false)
      }
    },
    [chat, chatBusy, sessionId]
  )

  const filteredTranscript = useMemo(() => {
    if (!session) return []
    const query = transcriptQuery.trim().toLocaleLowerCase('es')
    if (!query) return session.transcript
    return session.transcript.filter((segment) =>
      `${segment.text} ${segment.speaker}`.toLocaleLowerCase('es').includes(query)
    )
  }, [session, transcriptQuery])

  const pendingTasks = acta.tasks.filter((task) => !task.done).length

  if (loading) {
    return (
      <div className="page loading-page">
        <LoaderCircle className="spin" size={32} />
        <p>Abriendo la nota y sacando brillo…</p>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="page loading-page">
        <TriangleAlert size={36} />
        <h1>No encuentro esta nota</h1>
        <p>{error || 'Puede que se haya ido al compost.'}</p>
        <Button variant="primary" onClick={onBack}>
          Volver a la despensa
        </Button>
      </div>
    )
  }

  const visibleSection = (section: ActaSection): boolean => {
    if (layer === 'all') return true
    if (layer === 'mine') return origins[section] === 'human'
    return origins[section] === 'ai'
  }

  const proposal = session.aiProposal
  const aiLayerActa = proposal?.acta ?? acta

  return (
    <div className="page note-page">
      <header className="note-header">
        <div className="note-header-top">
          <button className="back-link" onClick={onBack}>
            <ArrowLeft size={17} /> Mis notas
          </button>
          <div className="note-header-actions">
            <div className="export-wrap">
              <Button
                variant="secondary"
                size="sm"
                icon={<Download size={16} />}
                onClick={() => setExportOpen((open) => !open)}
              >
                Exportar <ChevronDown size={14} />
              </Button>
              {exportOpen && (
                <div className="dropdown-menu export-menu">
                  <button onClick={() => void exportNote('md')}>
                    <FileText size={17} />
                    <span>
                      <strong>Markdown</strong>
                      <small>Bonito para Notion o GitHub</small>
                    </span>
                  </button>
                  <button onClick={() => void exportNote('txt')}>
                    <FileText size={17} />
                    <span>
                      <strong>Texto plano</strong>
                      <small>Universal y sin distracciones</small>
                    </span>
                  </button>
                  <button onClick={() => void exportNote('json')}>
                    <FileJson size={17} />
                    <span>
                      <strong>JSON completo</strong>
                      <small>Con capas y metadatos</small>
                    </span>
                  </button>
                </div>
              )}
            </div>
            <div className="more-wrap">
              <IconButton label="Más opciones" onClick={() => setMoreOpen((open) => !open)}>
                <MoreHorizontal size={20} />
              </IconButton>
              {moreOpen && (
                <div className="dropdown-menu more-menu">
                  <button
                    onClick={() => {
                      setMoreOpen(false)
                      setDeleteAudioOpen(true)
                    }}
                    disabled={!session.audio}
                  >
                    <Headphones size={16} /> Borrar solo el audio
                  </button>
                  <button
                    className="danger-item"
                    onClick={() => {
                      setMoreOpen(false)
                      setDeleteOpen(true)
                    }}
                  >
                    <Trash2 size={16} /> Eliminar la nota
                  </button>
                </div>
              )}
            </div>
            <Button
              variant="primary"
              icon={<WandSparkles size={17} />}
              loading={aiBusy === (boot.ai.configured ? 'deepseek' : 'local')}
              onClick={() => void generate(boot.ai.configured ? 'deepseek' : 'local')}
            >
              {proposal ? 'Volver a pedir acta' : boot.ai.configured ? 'Pasar a acta' : 'Borrador local'}
            </Button>
          </div>
        </div>

        <div className="note-title-row">
          <div className="note-title-block">
            <div className="note-title-kicker">
              <StatusBadge status={session.status} />
              <span className="kind-tag">
                {session.kind === 'meeting' ? <Headphones size={14} /> : <Mic2 size={14} />}
                {session.kind === 'meeting' ? 'Reunión' : 'Mi voz'}
              </span>
              <span className="note-date">{formatDateLong(session.createdAt)}</span>
              {session.recovered && <span className="tiny-tag">Rescatada</span>}
            </div>
            <input
              className="note-title-input"
              value={title}
              onChange={(event) => updateTitle(event.target.value)}
              aria-label="Título de la nota"
            />
            <div className="note-meta-line">
              <span>
                <Clock3 size={14} /> {formatDurationWords(session.durationMs)}
              </span>
              <span>
                <Mic2 size={14} /> {session.transcript.length} bloques de voz
              </span>
              <span>
                <NotebookPen size={14} /> {session.notes.length} notas tuyas
              </span>
              <span>
                {saveState === 'saving' ? (
                  <>
                    <LoaderCircle size={14} className="spin" /> Guardando…
                  </>
                ) : saveState === 'error' ? (
                  <>
                    <TriangleAlert size={14} /> Sin guardar
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} /> Guardado
                  </>
                )}
              </span>
            </div>
          </div>
          <div className="note-score">
            <span className="score-number">{pendingTasks}</span>
            <span>{plural(pendingTasks, 'tarea viva', 'tareas vivas')}</span>
          </div>
        </div>
      </header>

      {aiError && (
        <div className="inline-alert alert-warning">
          <TriangleAlert size={19} />
          <div>
            <strong>Limo se ha quedado pensando.</strong>
            <span>{aiError}</span>
          </div>
          <button className="alert-close" onClick={() => setAiError(null)}>
            Cerrar
          </button>
        </div>
      )}

      <div className="note-layout">
        <div className="note-main">
          <div className="note-tabs" role="tablist">
            <button
              className={classNames('note-tab', tab === 'acta' && 'is-active')}
              onClick={() => setTab('acta')}
              role="tab"
              aria-selected={tab === 'acta'}
            >
              <ListChecks size={17} /> Acta
            </button>
            <button
              className={classNames('note-tab', tab === 'transcript' && 'is-active')}
              onClick={() => setTab('transcript')}
              role="tab"
              aria-selected={tab === 'transcript'}
            >
              <MessageCircle size={17} /> Transcripción <span>{session.transcript.length}</span>
            </button>
            <button
              className={classNames('note-tab', tab === 'layers' && 'is-active')}
              onClick={() => setTab('layers')}
              role="tab"
              aria-selected={tab === 'layers'}
            >
              <Layers size={17} /> Capas
            </button>
            <button
              className={classNames('note-tab', tab === 'ask' && 'is-active')}
              onClick={() => setTab('ask')}
              role="tab"
              aria-selected={tab === 'ask'}
            >
              <Sparkles size={17} /> Preguntar a Limo
            </button>
          </div>

          {tab === 'acta' && (
            <div className="acta-tab">
              <div className="acta-toolbar">
                <div>
                  <p className="eyebrow">El acta, en cuatro bocados</p>
                  <h2>Resumen · Decisiones · Tareas · Próximos pasos</h2>
                </div>
                <div className="layer-switch" role="group" aria-label="Capa del acta">
                  <button className={layer === 'all' ? 'is-active' : ''} onClick={() => setLayer('all')}>
                    Todo
                  </button>
                  <button className={layer === 'mine' ? 'is-active' : ''} onClick={() => setLayer('mine')}>
                    Lo mío
                  </button>
                  <button className={layer === 'ai' ? 'is-active' : ''} onClick={() => setLayer('ai')}>
                    IA
                  </button>
                </div>
              </div>

              {proposal && (
                <div className="proposal-card">
                  <span className="proposal-icon">
                    <Sparkles size={20} />
                  </span>
                  <div className="proposal-copy">
                    <div className="proposal-heading">
                      <strong>Limo ha dejado una propuesta</strong>
                      <span>{shortRelative(proposal.createdAt)} · {proposal.model}</span>
                    </div>
                    <p>{proposal.acta.summary || 'Una propuesta con decisiones, tareas y próximos pasos.'}</p>
                    <div className="proposal-chips">
                      <span>{proposal.acta.decisions.length} decisiones</span>
                      <span>{proposal.acta.tasks.length} tareas</span>
                      <span>{proposal.acta.nextSteps.length} próximos pasos</span>
                    </div>
                  </div>
                  <div className="proposal-actions">
                    <Button
                      variant="purple"
                      size="sm"
                      loading={proposalBusy === 'fill-empty'}
                      onClick={() => void applyProposal('fill-empty')}
                    >
                      Rellenar huecos
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setReplaceOpen(true)}>
                      Reemplazar
                    </Button>
                    <IconButton label="Descartar propuesta" onClick={() => void discardProposal()}>
                      <X size={17} />
                    </IconButton>
                  </div>
                </div>
              )}

              <div className="acta-grid">
                {visibleSection('summary') && (
                  <section className={classNames('acta-section acta-summary', origins.summary === 'ai' && 'is-ai')}>
                    <SectionHeading icon={<FileText size={18} />} label={ACTA_SECTION_LABELS.summary} origin={origins.summary} />
                    <textarea
                      className="acta-textarea"
                      value={acta.summary}
                      placeholder="¿De qué se habló, en dos o tres frases? Si te da pereza, que Limo lo intente."
                      onChange={(event) => patchActa((current) => ({ ...current, summary: event.target.value }))}
                      rows={5}
                      disabled={layer === 'ai'}
                    />
                  </section>
                )}

                {visibleSection('decisions') && (
                  <section className={classNames('acta-section', origins.decisions === 'ai' && 'is-ai')}>
                    <SectionHeading
                      icon={<Target size={18} />}
                      label={ACTA_SECTION_LABELS.decisions}
                      origin={origins.decisions}
                      count={acta.decisions.length}
                    />
                    <div className="editable-list">
                      {acta.decisions.map((decision, index) => (
                        <div key={index} className="editable-row">
                          <span className="list-bullet">{String(index + 1).padStart(2, '0')}</span>
                          <input
                            value={decision}
                            placeholder="Se acordó que…"
                            onChange={(event) => updateDecision(index, event.target.value)}
                            disabled={layer === 'ai'}
                          />
                          <IconButton label="Quitar decisión" onClick={() => removeDecision(index)} disabled={layer === 'ai'}>
                            <X size={15} />
                          </IconButton>
                        </div>
                      ))}
                      {!acta.decisions.length && <p className="section-placeholder">Sin decisiones. A veces la mejor decisión es no decidir.</p>}
                      {layer !== 'ai' && (
                        <button className="add-line" onClick={addDecision}>
                          <Plus size={15} /> Añadir decisión
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {visibleSection('tasks') && (
                  <section className={classNames('acta-section acta-tasks', origins.tasks === 'ai' && 'is-ai')}>
                    <SectionHeading
                      icon={<CheckCircle2 size={18} />}
                      label={ACTA_SECTION_LABELS.tasks}
                      origin={origins.tasks}
                      count={acta.tasks.length}
                    />
                    <div className="task-list">
                      {acta.tasks.map((task, index) => (
                        <div key={task.id} className={classNames('task-row', task.done && 'is-done')}>
                          <button
                            className={classNames('task-check', task.done && 'is-checked')}
                            onClick={() => updateTask(index, { done: !task.done })}
                            aria-label={task.done ? 'Marcar como pendiente' : 'Marcar como hecha'}
                            disabled={layer === 'ai'}
                          >
                            {task.done && <Check size={14} />}
                          </button>
                          <div className="task-fields">
                            <input
                              className="task-text-input"
                              value={task.text}
                              placeholder="¿Qué hay que hacer?"
                              onChange={(event) => updateTask(index, { text: event.target.value })}
                              disabled={layer === 'ai'}
                            />
                            <div className="task-meta-row">
                              <input
                                value={task.owner}
                                placeholder="Quién"
                                onChange={(event) => updateTask(index, { owner: event.target.value })}
                                disabled={layer === 'ai'}
                              />
                              <input
                                value={task.due}
                                placeholder="Para cuándo"
                                onChange={(event) => updateTask(index, { due: event.target.value })}
                                disabled={layer === 'ai'}
                              />
                            </div>
                          </div>
                          <IconButton label="Quitar tarea" onClick={() => removeTask(index)} disabled={layer === 'ai'}>
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      ))}
                      {!acta.tasks.length && <p className="section-placeholder">Cero tareas. Disfruta el momento.</p>}
                      {layer !== 'ai' && (
                        <button className="add-line" onClick={addTask}>
                          <Plus size={15} /> Añadir tarea
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {visibleSection('nextSteps') && (
                  <section className={classNames('acta-section', origins.nextSteps === 'ai' && 'is-ai')}>
                    <SectionHeading
                      icon={<ArrowRight size={18} />}
                      label={ACTA_SECTION_LABELS.nextSteps}
                      origin={origins.nextSteps}
                      count={acta.nextSteps.length}
                    />
                    <div className="editable-list">
                      {acta.nextSteps.map((step, index) => (
                        <div key={index} className="editable-row next-step-row">
                          <span className="step-arrow">
                            <ArrowRight size={14} />
                          </span>
                          <input
                            value={step}
                            placeholder="Lo siguiente será…"
                            onChange={(event) => updateNextStep(index, event.target.value)}
                            disabled={layer === 'ai'}
                          />
                          <IconButton label="Quitar paso" onClick={() => removeNextStep(index)} disabled={layer === 'ai'}>
                            <X size={15} />
                          </IconButton>
                        </div>
                      ))}
                      {!acta.nextSteps.length && <p className="section-placeholder">Sin próximos pasos todavía.</p>}
                      {layer !== 'ai' && (
                        <button className="add-line" onClick={addNextStep}>
                          <Plus size={15} /> Añadir próximo paso
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {layer === 'mine' && !Object.values(origins).some((origin) => origin === 'human') && (
                  <div className="layer-empty">
                    <NotebookPen size={26} />
                    <h3>Aún no has escrito nada en el acta.</h3>
                    <p>Puedes añadir notas humanas en la columna derecha o pasar a «Todo» para editar.</p>
                    <Button variant="secondary" onClick={() => setLayer('all')}>
                      Ver todo
                    </Button>
                  </div>
                )}
                {layer === 'ai' && !Object.values(origins).some((origin) => origin === 'ai') && (
                  <div className="layer-empty">
                    <Sparkles size={26} />
                    <h3>La capa IA está en blanco.</h3>
                    <p>Pide un acta a Limo o crea un borrador local. Tu texto no se tocará.</p>
                    <Button variant="purple" onClick={() => void generate('deepseek')} loading={aiBusy === 'deepseek'}>
                      Pedir acta a Limo
                    </Button>
                  </div>
                )}
              </div>

              <div className="acta-footer">
                <p>
                  <LockKeyhole size={14} /> La IA propone; tus palabras son la autoridad. Cada edición tuya queda marcada
                  como capa humana.
                </p>
                <div className="acta-footer-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Bot size={16} />}
                    loading={aiBusy === 'local'}
                    onClick={() => void generate('local')}
                  >
                    Borrador local
                  </Button>
                  <Button
                    variant="purple"
                    size="sm"
                    icon={<WandSparkles size={16} />}
                    loading={aiBusy === 'deepseek'}
                    onClick={() => void generate('deepseek')}
                  >
                    Que Limo lo ordene
                  </Button>
                </div>
              </div>
            </div>
          )}

          {tab === 'transcript' && (
            <div className="transcript-tab">
              <div className="transcript-toolbar">
                <div className="search-box">
                  <Search size={17} />
                  <input
                    value={transcriptQuery}
                    onChange={(event) => setTranscriptQuery(event.target.value)}
                    placeholder="Buscar dentro de la transcripción…"
                    aria-label="Buscar transcripción"
                  />
                  {transcriptQuery && (
                    <button className="search-clear" onClick={() => setTranscriptQuery('')} aria-label="Limpiar">
                      <X size={15} />
                    </button>
                  )}
                </div>
                <Button variant="secondary" size="sm" icon={<Copy size={15} />} onClick={() => void copyTranscript()}>
                  Copiar todo
                </Button>
              </div>

              {filteredTranscript.length === 0 ? (
                <div className="transcript-tab-empty">
                  <MessageCircle size={36} />
                  <h3>{transcriptQuery ? 'No hay coincidencias.' : 'La transcripción está en blanco.'}</h3>
                  <p>
                    {transcriptQuery
                      ? 'Prueba con otra palabra. El limón no es adivino.'
                      : session.audio
                        ? 'Puede que Whisper no estuviera listo al grabar. El audio sigue aquí para intentarlo de nuevo.'
                        : 'No hay audio guardado y no se generaron bloques de texto.'}
                  </p>
                  {!session.audio && (
                    <Button variant="secondary" onClick={onOpenSettings}>
                      Revisar Whisper
                    </Button>
                  )}
                </div>
              ) : (
                <div className="transcript-full">
                  {filteredTranscript.map((segment) => (
                    <article key={segment.id} className="transcript-block">
                      <button
                        className="transcript-stamp"
                        onClick={() => audioPlayerRef.current?.seek(segment.startMs)}
                        title="Escuchar desde aquí"
                      >
                        <Play size={12} fill="currentColor" /> {formatTimer(segment.startMs)}
                      </button>
                      <div className="transcript-content">
                        <div className="transcript-speaker-row">
                          <input
                            defaultValue={segment.speaker}
                            key={segment.id + segment.speaker}
                            className="speaker-field"
                            placeholder="Hablante"
                            onBlur={(event) => void saveSpeaker(segment, event.target.value || 'Hablante 1')}
                            aria-label="Hablante"
                          />
                          {segment.edited && <span className="edited-tag">Editado</span>}
                          <button
                            className="edit-transcript-btn"
                            onClick={() => {
                              setEditingSegmentId(segment.id)
                              setEditingSegmentBody(segment.text)
                            }}
                          >
                            <Edit3 size={13} /> Corregir
                          </button>
                        </div>
                        {editingSegmentId === segment.id ? (
                          <div className="segment-editor">
                            <textarea
                              value={editingSegmentBody}
                              onChange={(event) => setEditingSegmentBody(event.target.value)}
                              rows={4}
                              autoFocus
                            />
                            <div className="segment-editor-actions">
                              <Button variant="ghost" size="sm" onClick={() => setEditingSegmentId(null)}>
                                Cancelar
                              </Button>
                              <Button variant="purple" size="sm" onClick={() => void saveSegment(segment)}>
                                Guardar corrección
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p>{segment.text}</p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'layers' && (
            <div className="layers-tab">
              <div className="layers-intro">
                <div>
                  <p className="eyebrow">Fusión no destructiva</p>
                  <h2>Dos capas, una conversación</h2>
                </div>
                <p>
                  Lo que escribes y lo que genera la IA se guardan por separado. La IA puede proponer, pero nunca borra
                  tu voz. Si hay conflicto, se ven los dos y decides.
                </p>
              </div>
              <div className="layers-grid">
                <section className="layer-column human-layer">
                  <div className="layer-column-head">
                    <span className="layer-column-icon">
                      <NotebookPen size={19} />
                    </span>
                    <div>
                      <strong>Lo que escribí</strong>
                      <span>{session.notes.length} notas humanas</span>
                    </div>
                    <span className="layer-badge human">Autoridad</span>
                  </div>
                  {session.notes.length ? (
                    <div className="layer-notes">
                      {session.notes.map((note) => (
                        <button
                          key={note.id}
                          className="layer-note"
                          onClick={() => audioPlayerRef.current?.seek(note.atMs)}
                        >
                          <span>{formatTimer(note.atMs)}</span>
                          <p>{note.body}</p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="layer-empty-copy">Aún no hay notas tuyas. La columna derecha te espera.</p>
                  )}
                  <div className="layer-human-sections">
                    {(['summary', 'decisions', 'tasks', 'nextSteps'] as ActaSection[])
                      .filter((section) => origins[section] === 'human')
                      .map((section) => (
                        <span key={section} className="layer-chip">
                          {ACTA_SECTION_LABELS[section]}
                        </span>
                      ))}
                  </div>
                </section>

                <section className="layer-column ai-layer">
                  <div className="layer-column-head">
                    <span className="layer-column-icon">
                      <Sparkles size={19} />
                    </span>
                    <div>
                      <strong>Lo que generó la IA</strong>
                      <span>{proposal ? proposal.model : 'Todavía sin propuesta'}</span>
                    </div>
                    <span className="layer-badge ai">Propuesta</span>
                  </div>
                  {proposal ? (
                    <div className="ai-proposal-mini">
                      <span className="ai-proposal-label">Resumen</span>
                      <p>{proposal.acta.summary || 'Sin resumen.'}</p>
                      {proposal.acta.decisions.length > 0 && (
                        <>
                          <span className="ai-proposal-label">Decisiones</span>
                          <ul>
                            {proposal.acta.decisions.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        </>
                      )}
                      {proposal.acta.tasks.length > 0 && (
                        <>
                          <span className="ai-proposal-label">Tareas</span>
                          <ul>
                            {proposal.acta.tasks.map((task) => (
                              <li key={task.id}>{task.text}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="layer-empty-copy">Pide un acta a Limo y verás su propuesta aquí, sin tocar nada.</p>
                  )}
                  <div className="layer-ai-actions">
                    <Button
                      variant="purple"
                      size="sm"
                      icon={<WandSparkles size={15} />}
                      loading={aiBusy === 'deepseek'}
                      onClick={() => void generate('deepseek')}
                    >
                      Generar propuesta
                    </Button>
                  </div>
                  <div className="layer-transcript-note">
                    <strong>Transcripción</strong>
                    <span>{session.transcript.length} bloques generados por Whisper en local.</span>
                    <button className="text-link mini" onClick={() => setTab('transcript')}>
                      Ver la transcripción <ArrowRight size={13} />
                    </button>
                  </div>
                </section>
              </div>
              <div className="layers-footer">
                <LockKeyhole size={15} /> Una corrección del texto generado conserva el original para auditoría.
              </div>
            </div>
          )}

          {tab === 'ask' && (
            <div className="ask-tab">
              <div className="ask-head">
                <div className="ask-avatar">
                  <Sparkles size={22} />
                </div>
                <div>
                  <p className="eyebrow">Pregúntale al limón</p>
                  <h2>Limo ha leído esta nota.</h2>
                  <p>
                    Puede buscar una decisión, resumir una parte o decirte quién se comprometió a qué. Solo ve el texto
                    de esta nota, nunca el audio.
                  </p>
                </div>
                <span className="ask-model">DeepSeek Flash · {boot.ai.configured ? 'conectado' : 'sin clave'}</span>
              </div>

              {!boot.ai.configured ? (
                <div className="ask-disabled">
                  <Bot size={36} />
                  <h3>Limo está en pausa hasta que haya clave.</h3>
                  <p>
                    Añade <code>DEEPSEEK_API_KEY</code> a tu archivo <code>.env</code> y reinicia LemoNotes. Mientras
                    tanto, el borrador local del acta funciona sin conexión.
                  </p>
                  <Button variant="secondary" onClick={onOpenSettings}>
                    Ver instrucciones
                  </Button>
                </div>
              ) : (
                <>
                  <div className="chat-box">
                    {chat.length === 0 ? (
                      <div className="chat-empty">
                        <span className="chat-empty-mark">
                          <MessageCircle size={30} />
                        </span>
                        <h3>¿Qué quieres saber de la reunión?</h3>
                        <p>Pregunta sin rodeos. Limo responde con lo que hay en la nota, sin inventarse el resto.</p>
                        <div className="suggestion-chips">
                          {[
                            '¿Qué se decidió al final?',
                            'Resume las tareas pendientes',
                            '¿Quién se encarga de cada cosa?',
                            'Hazme un resumen de 30 segundos'
                          ].map((suggestion) => (
                            <button key={suggestion} onClick={() => void ask(suggestion)}>
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="chat-messages">
                        {chat.map((turn, index) => (
                          <div key={index} className={classNames('chat-message', turn.role === 'user' ? 'is-user' : 'is-assistant')}>
                            <span className="chat-role">
                              {turn.role === 'user' ? 'Tú' : <Sparkles size={15} />}
                            </span>
                            <p>{turn.content}</p>
                          </div>
                        ))}
                        {chatBusy && (
                          <div className="chat-message is-assistant">
                            <span className="chat-role">
                              <Sparkles size={15} />
                            </span>
                            <p className="chat-thinking">
                              <span />
                              <span />
                              <span /> Limo está pensando…
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="chat-composer">
                    <textarea
                      value={chatQuestion}
                      onChange={(event) => setChatQuestion(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          void ask(chatQuestion)
                        }
                      }}
                      placeholder="Pregunta lo que quieras sobre esta nota…"
                      rows={2}
                      disabled={chatBusy}
                    />
                    <Button
                      variant="primary"
                      icon={<Send size={17} />}
                      loading={chatBusy}
                      disabled={!chatQuestion.trim()}
                      onClick={() => void ask(chatQuestion)}
                    >
                      Preguntar
                    </Button>
                  </div>
                  <p className="chat-disclaimer">
                    <LockKeyhole size={13} /> Solo se envía el texto de esta nota a DeepSeek. El audio no se mueve del
                    equipo.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <aside className="note-rail">
          <div className="rail-card audio-rail">
            <div className="rail-heading">
              <span>
                <Headphones size={16} /> Audio de la nota
              </span>
              {session.audio && <span className="tiny-tag">Cifrado</span>}
            </div>
            <AudioPlayer
              ref={audioPlayerRef}
              sessionId={session.id}
              durationMs={session.durationMs}
              onTimeUpdate={(ms) => setNoteAnchorMs(Math.round(ms))}
            />
            <div className="rail-audio-meta">
              <span>{session.audio?.tracks.mixed ? 'Mezcla guardada' : 'Sin mezcla guardada'}</span>
              <span>{session.audio ? `${Math.round((session.audio.tracks.mixed?.bytes ?? 0) / 1048576)} MB` : '0 MB'}</span>
            </div>
          </div>

          <div className="rail-card notes-rail">
            <div className="rail-heading">
              <span>
                <NotebookPen size={16} /> Notas humanas
              </span>
              <span className="count-badge">{session.notes.length}</span>
            </div>
            <div className="rail-note-composer">
              <div className="anchor-row">
                <span>
                  <Clock3 size={13} /> Anclar en {formatTimer(noteAnchorMs)}
                </span>
                <button className="text-link mini" onClick={() => setNoteAnchorMs(0)}>
                  Al inicio
                </button>
              </div>
              <textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.ctrlKey && event.key === 'Enter') {
                    event.preventDefault()
                    void addNote()
                  }
                }}
                placeholder="Apunta algo que la IA no debería decidir por ti…"
                rows={3}
              />
              <Button
                variant="purple"
                size="sm"
                icon={<Plus size={15} />}
                onClick={() => void addNote()}
                loading={savingNote}
                disabled={!noteDraft.trim()}
                className="full-width"
              >
                Añadir nota anclada
              </Button>
            </div>

            <div className="rail-notes-list">
              {session.notes.length ? (
                session.notes.map((note) => (
                  <div key={note.id} className="rail-note">
                    <button className="rail-note-time" onClick={() => audioPlayerRef.current?.seek(note.atMs)}>
                      {formatTimer(note.atMs)}
                    </button>
                    {editingNoteId === note.id ? (
                      <div className="rail-note-edit">
                        <textarea
                          value={editingNoteBody}
                          onChange={(event) => setEditingNoteBody(event.target.value)}
                          rows={3}
                          autoFocus
                        />
                        <div>
                          <button onClick={() => setEditingNoteId(null)}>Cancelar</button>
                          <button className="save" onClick={() => void saveEditedNote(note)}>
                            Guardar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p>{note.body}</p>
                        <div className="rail-note-actions">
                          <button
                            onClick={() => {
                              setEditingNoteId(note.id)
                              setEditingNoteBody(note.body)
                            }}
                            aria-label="Editar nota"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button onClick={() => void deleteNote(note)} aria-label="Borrar nota">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              ) : (
                <p className="rail-empty">Tus palabras también cuentan. Añade la primera nota.</p>
              )}
            </div>
          </div>

          <div className="rail-card details-rail">
            <div className="rail-heading">
              <span>
                <SquareStack size={16} /> Detalles
              </span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Fecha</dt>
                <dd>{formatDateLong(session.createdAt)}</dd>
              </div>
              <div>
                <dt>Duración</dt>
                <dd>{formatDurationWords(session.durationMs)}</dd>
              </div>
              <div>
                <dt>Whisper</dt>
                <dd>{boot.whisper.models.find((model) => model.id === boot.whisper.selectedModel)?.label ?? 'Local'}</dd>
              </div>
              <div>
                <dt>Idioma</dt>
                <dd>{session.language === 'auto' ? 'Detección automática' : session.language === 'en' ? 'Inglés' : 'Español'}</dd>
              </div>
              <div>
                <dt>Capa IA</dt>
                <dd>{proposal ? proposal.model : 'Sin generar'}</dd>
              </div>
              <div>
                <dt>Protección</dt>
                <dd>{boot.protection === 'dpapi' ? 'DPAPI de Windows' : 'Llavero local'}</dd>
              </div>
            </dl>
            <button className="text-link mini open-folder" onClick={() => void api().openPath('data')}>
              Abrir carpeta de datos <ArrowRight size={13} />
            </button>
          </div>
        </aside>
      </div>

      {!session.audio && (
        <div className="note-no-audio">
          <AlertTriangle size={16} /> Esta nota no tiene audio guardado. Puedes seguir trabajando con el texto y las
          notas humanas.
        </div>
      )}

      <Modal
        open={replaceOpen}
        onClose={() => setReplaceOpen(false)}
        title="¿Reemplazar tu acta?"
        eyebrow="La IA propone"
        width="520px"
        footer={
          <div className="modal-button-row">
            <Button variant="ghost" onClick={() => setReplaceOpen(false)}>
              Me quedo con la mía
            </Button>
            <Button variant="purple" loading={proposalBusy === 'replace'} onClick={() => void applyProposal('replace')}>
              Reemplazar y archivar la anterior
            </Button>
          </div>
        }
      >
        <p>
          Tu versión actual se guardará en el historial de la nota antes de aplicar la propuesta. No se borrará nada de
          forma silenciosa.
        </p>
        <div className="modal-warning purple">
          <Sparkles size={18} /> Si solo quieres completar lo que falta, usa «Rellenar huecos».
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="¿Tirar esta nota al compost?"
        eyebrow="Eliminar"
        width="500px"
        footer={
          <div className="modal-button-row">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Conservar
            </Button>
            <Button variant="primary" onClick={() => void deleteSession()}>
              Eliminar la nota entera
            </Button>
          </div>
        }
      >
        <p>
          Se borrarán el acta, la transcripción, tus notas y el audio local de <strong>{session.title}</strong>. No hay
          papelera secreta ni copia remota.
        </p>
      </Modal>

      <Modal
        open={deleteAudioOpen}
        onClose={() => setDeleteAudioOpen(false)}
        title="Borrar solo el audio"
        eyebrow="Privacidad"
        width="500px"
        footer={
          <div className="modal-button-row">
            <Button variant="ghost" onClick={() => setDeleteAudioOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void deleteAudio()}>
              Borrar el audio
            </Button>
          </div>
        }
      >
        <p>
          La transcripción y tus notas se quedan. Solo desaparece la grabación cifrada. Esta acción no se puede deshacer.
        </p>
      </Modal>
    </div>
  )
}

function SectionHeading({
  icon,
  label,
  origin,
  count
}: {
  icon: React.ReactNode
  label: string
  origin: 'human' | 'ai' | 'empty'
  count?: number
}): React.JSX.Element {
  return (
    <div className="acta-section-heading">
      <span className="acta-section-icon">{icon}</span>
      <h3>{label}</h3>
      {typeof count === 'number' && count > 0 && <span className="section-count">{count}</span>}
      <span className={`origin-tag origin-${origin}`}>
        {origin === 'human' ? 'Mío' : origin === 'ai' ? 'IA' : 'Vacío'}
      </span>
    </div>
  )
}
