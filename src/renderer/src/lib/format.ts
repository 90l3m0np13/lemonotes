import type { SessionStatus } from '@shared/types'
import { formatClock, formatDurationWords } from '@shared/format'

export { formatClock, formatDurationWords }

export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatDateLong(timestamp: number): string {
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date(timestamp))
}

export function formatDateShort(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return `Hoy, ${new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(date)}`
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return `Ayer, ${new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(date)}`
  }
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(date)
}

export function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return 'Buenas noches'
  if (hour < 13) return 'Buenos días'
  if (hour < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

export const STATUS_META: Record<SessionStatus, { label: string; tone: 'idle' | 'active' | 'paused' | 'work' | 'done' | 'error' }> = {
  inactive: { label: 'En calma', tone: 'idle' },
  permission: { label: 'Pidiendo permiso', tone: 'work' },
  preparing: { label: 'Preparando orejas', tone: 'work' },
  recording: { label: 'Grabando', tone: 'active' },
  paused: { label: 'En pausa', tone: 'paused' },
  transcribing: { label: 'Transcribiendo', tone: 'work' },
  review: { label: 'Revisión', tone: 'done' },
  saving: { label: 'Guardando', tone: 'work' },
  syncing: { label: 'Sincronizando', tone: 'work' },
  offline: { label: 'Sin conexión', tone: 'paused' },
  error: { label: 'Algo se torció', tone: 'error' }
}

export function formatSyncState(state: 'local' | 'pending' | 'synced' | 'offline'): string {
  if (state === 'pending') return 'Copia pendiente'
  if (state === 'offline') return 'Sin conexión'
  if (state === 'local') return 'Guardado local'
  return 'Copia al día'
}

export function cleanErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/^Uncaught Error:\s*/i, '')
    .trim()
}

export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
}

export function initialsForTitle(title: string): string {
  const clean = title.replace(/[^\p{Letter}\p{Number} ]/gu, '').trim()
  if (!clean) return 'LE'
  const words = clean.split(/\s+/).filter(Boolean)
  return (words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : clean.slice(0, 2)).toUpperCase()
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm
}

export function shortRelative(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'ahora mismo'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `hace ${days} d`
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(timestamp))
}

export function defaultTitle(kind: 'meeting' | 'personal'): string {
  const now = new Date()
  const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(now)
  if (kind === 'meeting') {
    return `Reunión del ${new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(now)} · ${time}`
  }
  return `Nota de voz · ${time}`
}

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

