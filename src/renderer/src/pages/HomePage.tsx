import {
  ArrowRight,
  Clock3,
  FileAudio,
  Headphones,
  Mic2,
  NotebookText,
  Plus,
  ShieldCheck,
  Sparkles,
  WandSparkles
} from 'lucide-react'
import type { Bootstrap, SessionSummary } from '@shared/types'
import { LemonHeroArt, LemonMark } from '../components/Brand'
import { StatusBadge } from '../components/StatusBadge'
import { Button } from '../components/UI'
import {
  formatDateShort,
  formatDurationWords,
  greeting,
  initialsForTitle,
  plural,
  shortRelative
} from '../lib/format'

export function HomePage({
  boot,
  sessions,
  onCapture,
  onOpenNote,
  onOpenNotes,
  onNewNote
}: {
  boot: Bootstrap
  sessions: SessionSummary[]
  onCapture: (kind: 'meeting' | 'personal') => void
  onOpenNote: (id: string) => void
  onOpenNotes: () => void
  onNewNote: () => void
}): React.JSX.Element {
  const totalMinutes = Math.round(sessions.reduce((sum, session) => sum + session.durationMs, 0) / 60000)
  const pending = sessions.filter((session) => session.syncState === 'pending').length
  const recent = sessions.slice(0, 3)
  const whisperReady = boot.whisper.binaryReady && boot.whisper.modelReady

  return (
    <div className="page home-page">
      <header className="page-header home-header">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-dot" /> Tu mesa de trabajo
          </p>
          <h1 className="display-title">
            {greeting()}, <span className="marker">mente inquieta</span>.
          </h1>
          <p className="page-subtitle">
            Habla, escucha y deja que el limón ordene. Tus reuniones se convierten en actas sin que se te escape
            ninguna idea por la ventana.
          </p>
        </div>
        <div className="header-actions">
          <button className="quick-chip" onClick={onNewNote}>
            <Plus size={16} /> Nota exprés <kbd>Ctrl N</kbd>
          </button>
        </div>
      </header>

      <section className="hero-card">
        <div className="hero-grain" />
        <div className="hero-copy">
          <span className="hero-kicker">
            <Sparkles size={15} /> Reuniones con zumo
          </span>
          <h2>
            Tu reunión habla.
            <br />
            <em>LemoNotes toma nota.</em>
          </h2>
          <p>
            Escucho tu micrófono y también lo que suena en el equipo. Whisper transcribe en local y Limo lo convierte
            en un acta con <strong>Resumen · Decisiones · Tareas · Próximos pasos</strong>.
          </p>
          <div className="hero-actions">
            <Button variant="primary" size="lg" icon={<Headphones size={20} />} onClick={() => onCapture('meeting')}>
              Empezar una reunión
            </Button>
            <Button variant="secondary" size="lg" icon={<Mic2 size={20} />} onClick={() => onCapture('personal')}>
              Hablar a mi ritmo
            </Button>
          </div>
          <div className="hero-trust">
            <span>
              <ShieldCheck size={15} /> Audio cifrado en tu equipo
            </span>
            <span>
              <WandSparkles size={15} /> {boot.ai.configured ? 'Limo está despierto' : 'Limo espera su clave .env'}
            </span>
            <span>
              <FileAudio size={15} /> {whisperReady ? 'Whisper listo' : 'Whisper pide descarga'}
            </span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-bubble hero-bubble-one">«Esto lo apunto yo»</div>
          <LemonHeroArt />
          <div className="hero-bubble hero-bubble-two">
            <span className="pulse-dot" /> 100% local
          </div>
        </div>
      </section>

      <section className="stats-row" aria-label="Resumen de tu limonero">
        <div className="stat-card stat-green">
          <span className="stat-icon">
            <NotebookText size={20} />
          </span>
          <div>
            <strong>{sessions.length}</strong>
            <span>{plural(sessions.length, 'nota guardada', 'notas guardadas')}</span>
          </div>
          <LemonMark size={42} className="stat-watermark" />
        </div>
        <div className="stat-card stat-yellow">
          <span className="stat-icon">
            <Clock3 size={20} />
          </span>
          <div>
            <strong>{sessions.length === 0 ? '0' : totalMinutes < 1 ? '<1' : totalMinutes}</strong>
            <span>{plural(totalMinutes, 'minuto escuchado', 'minutos escuchados')}</span>
          </div>
        </div>
        <div className="stat-card stat-purple">
          <span className="stat-icon">
            <Sparkles size={20} />
          </span>
          <div>
            <strong>{pending}</strong>
            <span>{plural(pending, 'copia en cola', 'copias en cola')}</span>
          </div>
        </div>
        <div className="stat-card stat-white">
          <span className="stat-icon">
            <Headphones size={20} />
          </span>
          <div>
            <strong>{whisperReady ? 'Sí' : 'Casi'}</strong>
            <span>{whisperReady ? 'orejas locales listas' : 'Whisper pide un paso'}</span>
          </div>
        </div>
      </section>

      <section className="recent-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recién exprimido</p>
            <h2>Tus últimas notas</h2>
          </div>
          {sessions.length > 0 && (
            <button className="text-link" onClick={onOpenNotes}>
              Ver toda la despensa <ArrowRight size={16} />
            </button>
          )}
        </div>

        {recent.length === 0 ? (
          <div className="empty-notes">
            <div className="empty-notes-art">
              <LemonMark size={58} />
              <span className="empty-note-line" />
              <span className="empty-note-line short" />
            </div>
            <div>
              <h3>Tu primera nota está a una conversación de distancia.</h3>
              <p>
                No hace falta escribir un discurso. Pulsa grabar, habla con naturalidad y deja que LemoNotes haga el
                trabajo sucio de ordenar.
              </p>
            </div>
            <Button variant="primary" icon={<Plus size={18} />} onClick={onNewNote}>
              Crear mi primera nota
            </Button>
          </div>
        ) : (
          <div className="note-grid">
            {recent.map((session) => (
              <button key={session.id} className="note-card" onClick={() => onOpenNote(session.id)}>
                <div className="note-card-top">
                  <span className={`note-avatar ${session.kind === 'meeting' ? 'is-meeting' : 'is-personal'}`}>
                    {initialsForTitle(session.title)}
                  </span>
                  <span className="note-card-time">{shortRelative(session.updatedAt)}</span>
                </div>
                <div className="note-card-title-row">
                  <h3>{session.title}</h3>
                  <StatusBadge status={session.status} compact />
                </div>
                <p className="note-card-preview">{session.preview}</p>
                <div className="note-card-meta">
                  <span>
                    <Clock3 size={14} /> {formatDurationWords(session.durationMs)}
                  </span>
                  <span>
                    <NotebookText size={14} /> {session.noteCount} {plural(session.noteCount, 'nota', 'notas')}
                  </span>
                  <span>{formatDateShort(session.createdAt)}</span>
                </div>
                <span className="note-card-arrow">
                  <ArrowRight size={18} />
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="how-strip">
        <div className="how-title">
          <span className="how-sticker">3 pasos</span>
          <h2>Del «hola» al acta, sin sudar.</h2>
        </div>
        <div className="how-steps">
          <div className="how-step">
            <span className="how-number">01</span>
            <div>
              <strong>Habla y deja sonar</strong>
              <p>Micrófono y audio del equipo, con medidor para ver que entra voz.</p>
            </div>
          </div>
          <div className="how-step">
            <span className="how-number">02</span>
            <div>
              <strong>Whisper escucha en local</strong>
              <p>Sin cuotas ni nube. Tu audio no tiene que salir de casa.</p>
            </div>
          </div>
          <div className="how-step">
            <span className="how-number">03</span>
            <div>
              <strong>Limo aliña el acta</strong>
              <p>Resumen, decisiones, tareas y próximos pasos. Tú siempre tienes la última palabra.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
