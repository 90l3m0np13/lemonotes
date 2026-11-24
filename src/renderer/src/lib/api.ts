import type { LemoNotesApi } from '@shared/types'

export function api(): LemoNotesApi {
  if (!window.lemonotes) {
    throw new Error('El puente de LemoNotes no está disponible. Reinicia la app.')
  }
  return window.lemonotes
}
