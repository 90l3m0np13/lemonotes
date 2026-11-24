import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Clock3, Headphones, Mic2, NotebookText, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import type { SessionSummary } from '@shared/types'
import { StatusBadge } from '../components/StatusBadge'
import { Button } from '../components/UI'
import { api } from '../lib/api'
import {
  formatDateLong,
  formatDurationWords,
  formatSyncState,
  initialsForTitle,
  normalizeForSearch,
  shortRelative
} from '../lib/format'

type KindFilter = 'all' | 'meeting' | 'personal'
type DateFilter = 'all' | 'today' | 'week' | 'month'

export function NotesPage({
  sessions,
  onOpenNote,
  onNewNote,
  onCapture
}: {
  sessions: SessionSummary[]
  onOpenNote: (id: string) => void
  onNewNote: () => void
  onCapture: (kind: 'meeting' | 'personal') => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SessionSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [kind, setKind] = useState<KindFilter>('all')
  const [date, setDate] = useState<DateFilter>('all')

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(async () => {
      try {
        const found = await api().searchSessions(trimmed)
        if (!cancelled) setResults(found)
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  const filtered = useMemo(() => {
    const base = results ?? sessions
    const now = new Date()
    return base.filter((session) => {
      if (kind !== 'all' && session.kind !== kind) return false
      if (date !== 'all') {
        const created = new Date(session.createdAt)
        if (date === 'today' && created.toDateString() !== now.toDateString()) return false
        if (date === 'week' && now.getTime() - created.getTime() > 7 * 86400000) return false
        if (date === 'month' && (created.getMonth() !== now.getMonth() || created.getFullYear() !== now.getFullYear()))
          return false
      }
      if (!results && query.trim()) {
        return normalizeForSearch(`${session.title} ${session.preview}`).includes(normalizeForSearch(query))
      }
      return true
    })
  }, [results, sessions, kind, date, query])

  const totalMinutes = Math.round(filtered.reduce((sum, session) => sum + session.durationMs, 0) / 60000)

  return (
    <div className="page notes-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">La despensa</p>
          <h1 className="display-title">Todas tus ideas, bien colocadas.</h1>
          <p className="page-subtitle">
            Busca por lo que se dijo, lo que apuntaste o ese título que juraste recordar. Todo está aquí.
          </p>
        </div>
        <Button variant="primary" icon={<Plus size={18} />} onClick={onNewNote}>
          Nueva nota
        </Button>
      </header>

      <div className="notes-toolbar">
        <div className="search-box search-box-large">
          <Search size={19} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar en títulos, actas, notas y transcripciones…"
            aria-label="Buscar notas"
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">
              <X size={16} />
            </button>
          )}
          {searching && <span className="search-spinner" />}
        </div>
        <label className="select-wrap compact">
          <SlidersHorizontal size={16} />
          <select value={date} onChange={(event) => setDate(event.target.value as DateFilter)} aria-label="Filtrar por fecha">
            <option value="all">Cualquier fecha</option>
            <option value="today">Hoy</option>
            <option value="week">Últimos 7 días</option>
            <option value="month">Este mes</option>
          </select>
        </label>
      </div>

      <div className="filter-row">
        <div className="filter-chips" role="group" aria-label="Filtrar por tipo">
          <button className={`filter-chip ${kind === 'all' ? 'is-active' : ''}`} onClick={() => setKind('all')}>
            Todas <span>{results?.length ?? sessions.length}</span>
          </button>
          <button className={`filter-chip ${kind === 'meeting' ? 'is-active' : ''}`} onClick={() => setKind('meeting')}>
            <Headphones size={15} /> Reuniones
          </button>
          <button className={`filter-chip ${kind === 'personal' ? 'is-active' : ''}`} onClick={() => setKind('personal')}>
            <Mic2 size={15} /> Mi voz
          </button>
        </div>
        <p className="filter-summary">
          {filtered.length} {filtered.length === 1 ? 'nota' : 'notas'} · {formatDurationWords(totalMinutes * 60000)} de
          escucha
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-search">
          <div className="empty-search-icon">
            <Search size={32} />
          </div>
          <h2>{query ? 'Ni un limón por aquí.' : 'La despensa está vacía.'}</h2>
          <p>
            {query
              ? `No encuentro «${query}». Prueba con otra palabra o quita los filtros.`
              : 'Graba tu primera reunión o una nota de voz y empieza a llenar esto de ideas.'}
          </p>
          <div className="empty-actions">
            <Button variant="primary" onClick={() => onCapture('meeting')} icon={<Headphones size={18} />}>
              Grabar una reunión
            </Button>
            <Button variant="secondary" onClick={() => onCapture('personal')} icon={<Mic2 size={18} />}>
              Nota de mi voz
            </Button>
          </div>
        </div>
      ) : (
        <div className="notes-list">
          {filtered.map((session, index) => (
            <button
              key={session.id}
              className="note-row"
              style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
              onClick={() => onOpenNote(session.id)}
            >
              <span className={`note-row-icon ${session.kind === 'meeting' ? 'is-meeting' : 'is-personal'}`}>
                {session.kind === 'meeting' ? <Headphones size={22} /> : <Mic2 size={22} />}
              </span>
              <div className="note-row-body">
                <div className="note-row-heading">
                  <h3>{session.title}</h3>
                  <StatusBadge status={session.status} compact />
                  {session.recovered && <span className="tiny-tag">Rescatada</span>}
                </div>
                <p>{session.preview}</p>
                <div className="note-row-meta">
                  <span>
                    <Clock3 size={14} /> {formatDurationWords(session.durationMs)}
                  </span>
                  <span>
                    <NotebookText size={14} /> {session.noteCount} notas
                  </span>
                  <span>{formatDateLong(session.createdAt)}</span>
                  <span className={`sync-inline sync-${session.syncState}`}>{formatSyncState(session.syncState)}</span>
                </div>
              </div>
              <div className="note-row-side">
                <span className="row-avatar">{initialsForTitle(session.title)}</span>
                <span className="row-updated">{shortRelative(session.updatedAt)}</span>
                <span className="row-arrow">
                  <ArrowRight size={18} />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
