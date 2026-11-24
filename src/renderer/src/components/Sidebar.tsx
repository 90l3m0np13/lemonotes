import { Home, NotebookPen, Plus, Settings, ShieldCheck, Sparkles, Mic2, LockKeyhole } from 'lucide-react'
import type { Bootstrap } from '@shared/types'
import type { NavView } from '../navigation'
import { classNames } from '../lib/format'
import { Logo } from './Brand'

export function Sidebar({
  boot,
  current,
  recordingActive,
  onNavigate,
  onNewNote
}: {
  boot: Bootstrap
  current: NavView | null
  recordingActive: boolean
  onNavigate: (view: NavView) => void
  onNewNote: () => void
}): React.JSX.Element {
  const items: Array<{ id: NavView; label: string; icon: typeof Home; count?: number }> = [
    { id: 'home', label: 'Inicio', icon: Home },
    { id: 'notes', label: 'Mis notas', icon: NotebookPen, count: boot.sessions.length },
    { id: 'settings', label: 'Ajustes', icon: Settings }
  ]

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Logo />
      </div>

      <button className="new-note-fab" onClick={onNewNote} disabled={recordingActive}>
        <span className="fab-plus">
          <Plus size={20} strokeWidth={2.6} />
        </span>
        <span>Nueva nota</span>
        <span className="fab-shortcut">Ctrl N</span>
      </button>

      <nav className="sidebar-nav" aria-label="Principal">
        <p className="nav-heading">Tu limonero</p>
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              className={classNames('nav-item', current === item.id && 'is-active')}
              onClick={() => onNavigate(item.id)}
              disabled={recordingActive}
              title={recordingActive ? 'Termina o pausa la grabación para moverte' : undefined}
            >
              <Icon size={19} strokeWidth={2.1} />
              <span>{item.label}</span>
              {typeof item.count === 'number' && item.count > 0 && <em>{item.count}</em>}
            </button>
          )
        })}
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-status-stack">
        <div className={classNames('mini-status', boot.whisper.binaryReady && boot.whisper.modelReady ? 'is-ok' : 'is-warn')}>
          <span className="mini-status-icon">
            <Mic2 size={16} />
          </span>
          <div>
            <strong>Whisper local</strong>
            <span>{boot.whisper.binaryReady && boot.whisper.modelReady ? 'Orejas listas' : 'Le falta un tornillo'}</span>
          </div>
        </div>
        <div className={classNames('mini-status', boot.ai.configured ? 'is-purple' : 'is-muted')}>
          <span className="mini-status-icon">
            <Sparkles size={16} />
          </span>
          <div>
            <strong>DeepSeek Flash</strong>
            <span>{boot.ai.configured ? 'Limo tiene chispa' : 'Sin clave en .env'}</span>
          </div>
        </div>
      </div>

      <div className="privacy-card">
        <div className="privacy-card-icon">
          <LockKeyhole size={17} />
        </div>
        <p>
          <strong>Privado de verdad.</strong> Tus notas se cifran y viven en este equipo. Ni las regamos con anuncios.
        </p>
        <span className="privacy-badge">
          <ShieldCheck size={13} /> Local primero
        </span>
      </div>
      <p className="sidebar-version">LemoNotes v{boot.version} · hecho con zumo</p>
    </aside>
  )
}
