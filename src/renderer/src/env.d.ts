/// <reference types="vite/client" />
import type { LemoNotesApi } from '../../shared/types'

declare global {
  interface Window {
    lemonotes: LemoNotesApi
  }
}

export {}
