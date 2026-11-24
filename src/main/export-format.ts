import type { SessionDetail } from '../shared/types'

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function dateLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(new Date(timestamp))
}

function taskLine(task: { text: string; owner: string; due: string; done: boolean }): string {
  const extras = [task.owner ? `responsable: ${task.owner}` : '', task.due ? `para: ${task.due}` : '']
    .filter(Boolean)
    .join(' · ')
  return `- [${task.done ? 'x' : ' '}] ${task.text}${extras ? ` _(${extras})_` : ''}`
}

export function renderMarkdown(detail: SessionDetail): string {
  const lines: string[] = []
  lines.push(`# ${detail.title}`)
  lines.push('')
  lines.push(
    `_${detail.kind === 'meeting' ? 'Reunión' : 'Nota personal'} · ${dateLabel(detail.createdAt)} · ${clock(detail.durationMs)}_`
  )
  lines.push('')
  lines.push('## Resumen')
  lines.push(detail.acta.summary.trim() || '_Sin resumen todavía._')
  lines.push('')
  lines.push('## Decisiones')
  lines.push(
    detail.acta.decisions.length
      ? detail.acta.decisions.map((item) => `- ${item}`).join('\n')
      : '_Sin decisiones registradas._'
  )
  lines.push('')
  lines.push('## Tareas')
  lines.push(
    detail.acta.tasks.length ? detail.acta.tasks.map(taskLine).join('\n') : '_Sin tareas registradas._'
  )
  lines.push('')
  lines.push('## Próximos pasos')
  lines.push(
    detail.acta.nextSteps.length
      ? detail.acta.nextSteps.map((item) => `- ${item}`).join('\n')
      : '_Sin próximos pasos._'
  )
  lines.push('')
  if (detail.aiProposal) {
    lines.push('---')
    lines.push('')
    lines.push('## Propuesta de IA pendiente (no aplicada)')
    lines.push(`_Generada con ${detail.aiProposal.model}._`)
    lines.push('')
    lines.push(detail.aiProposal.acta.summary || '_Sin resumen._')
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push('## Lo que escribí (capa humana)')
  if (detail.notes.length) {
    for (const note of detail.notes) {
      lines.push(`- **${clock(note.atMs)}** — ${note.body}`)
    }
  } else {
    lines.push('_No hay notas manuales._')
  }
  lines.push('')
  lines.push('## Transcripción')
  if (detail.transcript.length) {
    for (const segment of detail.transcript) {
      lines.push(`**[${clock(segment.startMs)}] ${segment.speaker || 'Voz'}:** ${segment.text}`)
      lines.push('')
    }
  } else {
    lines.push('_Sin transcripción._')
  }
  lines.push('')
  lines.push('> Exportado desde LemoNotes. Tus palabras mandan; la IA solo propone.')
  return lines.join('\n')
}

export function renderText(detail: SessionDetail): string {
  return renderMarkdown(detail)
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/_/g, '')
    .replace(/^> /gm, '')
}
