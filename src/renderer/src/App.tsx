import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, RotateCcw, ShieldAlert, X } from 'lucide-react'
import type { Bootstrap, SessionSummary } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { NewNoteModal } from './components/NewNoteModal'
import { ToastProvider, useToast } from './components/Toast'
import { Button, Modal } from './components/UI'
import { LemonMark } from './components/Brand'
import { api } from './lib/api'
import { cleanErrorMessage, formatDateShort } from './lib/format'
import type { AppView, NavView } from './navigation'
import { HomePage } from './pages/HomePage'
import { NotesPage } from './pages/NotesPage'
import { CapturePage } from './pages/CapturePage'
import { NotePage } from './pages/NotePage'
import { SettingsPage } from './pages/SettingsPage'

function AppInner(): React.JSX.Element {
  const toast = useToast()
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [view, setView] = useState<AppView>({ name: 'home' })
  const [loading, setLoading] = useState(true)
  const [fatal, setFatal] = useState<string | null>(null)
  const [showNewNote, setShowNewNote] = useState(false)
  const [recordingActive, setRecordingActive] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)

  const loadBootstrap = useCallback(async () => {
    try {
      const data = await api().bootstrap()
      setBoot(data)
      setSessions(data.sessions)
      setRecoveryOpen(data.interrupted.length > 0)
      setFatal(null)
    } catch (error) {
      setFatal(cleanErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      const data = await api().listSessions()
      setSessions(data)
      setBoot((current) => (current ? { ...current, sessions: data } : current))
    } catch {
      // La lista se refrescará al volver a entrar.
    }
  }, [])

  useEffect(() => {
    void loadBootstrap()
  }, [loadBootstrap])

  useEffect(() => {
    const offNavigate = api().onNavigate((target) => {
      if (recordingActive) return
      if (target === 'home') setView({ name: 'home' })
      else if (target === 'notes') setView({ name: 'notes' })
      else setView({ name: 'settings' })
    })
    return offNavigate
  }, [recordingActive])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n' && !recordingActive) {
        event.preventDefault()
        setShowNewNote(true)
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',' && !recordingActive) {
        event.preventDefault()
        setView({ name: 'settings' })
      }
      if (event.key === 'Escape' && !recordingActive) setShowNewNote(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recordingActive])

  const navigate = useCallback(
    (next: NavView) => {
      if (recordingActive) {
        toast.show('Termina o pausa la grabación antes de cambiar de habitación.', 'info')
        return
      }
      if (next === 'home') setView({ name: 'home' })
      else if (next === 'notes') setView({ name: 'notes' })
      else setView({ name: 'settings' })
    },
    [recordingActive, toast]
  )

  const startCapture = useCallback(
    (kind: 'meeting' | 'personal') => {
      setShowNewNote(false)
      setView({ name: 'capture', kind })
    },
    []
  )

  const openNote = useCallback((id: string) => {
    setView({ name: 'note', id })
    void refreshSessions()
  }, [refreshSessions])

  const handleCaptureFinished = useCallback(
    (id: string) => {
      setRecordingActive(false)
      setView({ name: 'note', id })
      void refreshSessions()
    },
    [refreshSessions]
  )

  const handleDeleteSession = useCallback(
    (id: string) => {
      setSessions((current) => current.filter((session) => session.id !== id))
      setBoot((current) => (current ? { ...current, sessions: current.sessions.filter((s) => s.id !== id) } : current))
      setView({ name: 'notes' })
      void refreshSessions()
    },
    [refreshSessions]
  )

  if (loading) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">
          <LemonMark size={64} />
        </div>
        <h1>Exprimimiendo ideas…</h1>
        <p>Preparando la libreta, las orejas y un poco de zumo.</p>
        <div className="boot-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    )
  }

  if (fatal || !boot) {
    return (
      <div className="boot-screen boot-error">
        <ShieldAlert size={56} />
        <h1>La libreta no ha querido abrirse</h1>
        <p>{fatal || 'No he podido cargar el estado de LemoNotes.'}</p>
        <Button
          variant="primary"
          icon={<RotateCcw size={18} />}
          onClick={() => {
            setLoading(true)
            void loadBootstrap()
          }}
        >
          Intentarlo otra vez
        </Button>
      </div>
    )
  }

  const content = (() => {
    if (view.name === 'home') {
      return (
        <HomePage
          boot={boot}
          sessions={sessions}
          onCapture={startCapture}
          onOpenNote={openNote}
          onOpenNotes={() => setView({ name: 'notes' })}
          onNewNote={() => setShowNewNote(true)}
        />
      )
    }
    if (view.name === 'notes') {
      return (
        <NotesPage
          sessions={sessions}
          onOpenNote={openNote}
          onNewNote={() => setShowNewNote(true)}
          onCapture={startCapture}
        />
      )
    }
    if (view.name === 'capture') {
      return (
        <CapturePage
          boot={boot}
          kind={view.kind}
          sessionId={view.sessionId}
          onFinished={handleCaptureFinished}
          onCancel={() => {
            setRecordingActive(false)
            setView({ name: 'home' })
            void refreshSessions()
          }}
          onRecordingChange={setRecordingActive}
          onBootRefresh={loadBootstrap}
          onSettings={() => setView({ name: 'settings' })}
        />
      )
    }
    if (view.name === 'note') {
      return (
        <NotePage
          key={view.id}
          sessionId={view.id}
          boot={boot}
          onBack={() => {
            void refreshSessions()
            setView({ name: 'notes' })
          }}
          onOpenSettings={() => setView({ name: 'settings' })}
          onDeleted={handleDeleteSession}
          onUpdated={() => void refreshSessions()}
          onNewNote={() => setShowNewNote(true)}
        />
      )
    }
    return (
      <SettingsPage
        boot={boot}
        onBootChange={(next) => {
          setBoot(next)
          setSessions(next.sessions)
        }}
        onBack={() => setView({ name: 'home' })}
      />
    )
  })()

  return (
    <div className="app-shell">
      <Sidebar
        boot={boot}
        current={view.name === 'home' || view.name === 'notes' || view.name === 'settings' ? view.name : null}
        recordingActive={recordingActive}
        onNavigate={navigate}
        onNewNote={() => (recordingActive ? toast.show('Estás grabando. Guarda o para primero.', 'info') : setShowNewNote(true))}
      />
      <main className="main-area">{content}</main>
      <NewNoteModal open={showNewNote} onClose={() => setShowNewNote(false)} onChoose={startCapture} />

      <Modal
        open={recoveryOpen && boot.interrupted.length > 0}
        onClose={() => setRecoveryOpen(false)}
        title="Encontré una sesión a medio exprimir"
        eyebrow="Recuperación"
        width="620px"
        footer={
          <Button variant="ghost" onClick={() => setRecoveryOpen(false)}>
            Ahora no
          </Button>
        }
      >
        <div className="recovery-list">
          <p className="recovery-intro">
            La app se cerró antes de terminar, pero guardé lo que pude. Nada se borra sin preguntarte.
          </p>
          {boot.interrupted.map((item) => (
            <div key={item.session.id} className="recovery-item">
              <div>
                <strong>{item.session.title}</strong>
                <span>
                  {formatDateShort(item.interruptedAt)} · {item.session.segmentCount} fragmentos y{' '}
                  {item.session.noteCount} notas a salvo
                </span>
              </div>
              <Button
                variant="purple"
                size="sm"
                icon={<ArrowRight size={15} />}
                onClick={async () => {
                  try {
                    await api().markRecovered(item.session.id)
                    setRecoveryOpen(false)
                    setView({ name: 'note', id: item.session.id })
                    await refreshSessions()
                    toast.show('Sesión recuperada. Lo que había sigue aquí.', 'success')
                  } catch (error) {
                    toast.show(cleanErrorMessage(error), 'error')
                  }
                }}
              >
                Recuperar
              </Button>
            </div>
          ))}
          <p className="recovery-note">
            <AlertTriangle size={15} /> Si el audio no llegó a guardarse, conservaré el texto y las notas manuales.
          </p>
        </div>
      </Modal>
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  )
}
