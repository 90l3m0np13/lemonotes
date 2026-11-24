import { describe, expect, it } from 'vitest'
import { normalizeActa } from '../src/main/ai'
import { removeWordOverlap } from '../src/main/whisper'
import { normalizeForSearch } from '../src/main/db'
import { formatClock, formatDurationWords } from '../src/shared/format'
import { renderMarkdown, renderText } from '../src/main/export-format'
import type { SessionDetail } from '../src/shared/types'

describe('normalizeActa', () => {
  it('normaliza la respuesta de DeepSeek y genera ids de tarea', () => {
    const acta = normalizeActa({
      summary: '  Un resumen  ',
      decisions: ['Decisión A', { text: 'Decisión B' }, '', null],
      tasks: [{ text: 'Enviar propuesta', owner: 'Lucía', due: 'viernes' }, 'Llamar a Marta', { nope: true }],
      nextSteps: ['Cerrar el proyecto']
    })
    expect(acta.summary).toBe('Un resumen')
    expect(acta.decisions).toEqual(['Decisión A', 'Decisión B'])
    expect(acta.tasks).toHaveLength(2)
    expect(acta.tasks[0]?.id).toMatch(/[a-f0-9-]{36}/)
    expect(acta.tasks[1]?.owner).toBe('')
    expect(acta.nextSteps).toEqual(['Cerrar el proyecto'])
  })

  it('devuelve un acta vacía si la entrada no es válida', () => {
    expect(normalizeActa('no soy un objeto')).toEqual({
      summary: '',
      decisions: [],
      tasks: [],
      nextSteps: []
    })
  })
})

describe('removeWordOverlap', () => {
  it('quita la repetición entre bloques solapados', () => {
    expect(
      removeWordOverlap(
        'Quedamos en revisar el presupuesto antes del viernes',
        'antes del viernes y compartir la propuesta'
      )
    ).toBe('y compartir la propuesta')
  })

  it('no toca texto que no se solapa', () => {
    expect(removeWordOverlap('Hola equipo', 'Empezamos la reunión')).toBe('Empezamos la reunión')
  })

  it('tolera acentos y mayúsculas', () => {
    expect(removeWordOverlap('Revisión del presupuesto', 'REVISIÓN del presupuesto final')).toBe('final')
  })
})

describe('búsqueda y formato', () => {
  it('normaliza acentos para buscar', () => {
    expect(normalizeForSearch('Reunión de Diseño')).toBe('reunion de diseno')
  })

  it('formatea tiempos con y sin horas', () => {
    expect(formatClock(65_000)).toBe('01:05')
    expect(formatClock(3_665_000)).toBe('01:01:05')
    expect(formatDurationWords(0)).toBe('un suspiro')
    expect(formatDurationWords(120_000)).toBe('2 minutos')
  })
})

describe('exportación del acta', () => {
  const detail = {
    id: '00000000-0000-4000-8000-000000000000',
    title: 'Reunión de prueba',
    kind: 'meeting',
    status: 'review',
    createdAt: Date.UTC(2026, 10, 20, 10, 0, 0),
    updatedAt: Date.UTC(2026, 10, 20, 10, 30, 0),
    startedAt: Date.UTC(2026, 10, 20, 10, 0, 0),
    endedAt: Date.UTC(2026, 10, 20, 10, 30, 0),
    durationMs: 1_800_000,
    preview: '',
    noteCount: 1,
    segmentCount: 1,
    hasAudio: true,
    recovered: false,
    error: null,
    syncState: 'synced',
    language: 'es',
    audio: null,
    aiProposal: null,
    aiOriginal: null,
    origins: { summary: 'human', decisions: 'human', tasks: 'human', nextSteps: 'human' },
    acta: {
      summary: 'Resumen de prueba.',
      decisions: ['Decisión uno.'],
      tasks: [{ id: 't1', text: 'Enviar propuesta', owner: 'Lucía', due: 'viernes', done: false }],
      nextSteps: ['Cerrar el proyecto.']
    },
    notes: [
      { id: 'n1', sessionId: 's1', atMs: 65_000, body: 'Nota humana importante.', createdAt: 1, updatedAt: 1 }
    ],
    transcript: [
      {
        id: 'seg1',
        sessionId: 's1',
        seq: 0,
        startMs: 12_000,
        endMs: 15_000,
        text: 'Esto se dijo en la reunión.',
        speaker: 'Hablante 1',
        source: 'whisper' as const,
        confidence: 0.8,
        edited: false
      }
    ]
  } as unknown as SessionDetail

  it('conserva las cuatro secciones, las tareas y la capa humana', () => {
    const markdown = renderMarkdown(detail)
    expect(markdown).toContain('## Resumen')
    expect(markdown).toContain('## Decisiones')
    expect(markdown).toContain('## Tareas')
    expect(markdown).toContain('## Próximos pasos')
    expect(markdown).toContain('- [ ] Enviar propuesta')
    expect(markdown).toContain('Nota humana importante.')
    expect(markdown).toContain('Esto se dijo en la reunión.')
    expect(markdown).toContain('LemoNotes')
  })

  it('genera texto plano sin marcas de Markdown', () => {
    const text = renderText(detail)
    expect(text).not.toContain('##')
    expect(text).not.toContain('**')
    expect(text).toContain('Resumen de prueba.')
  })
})
