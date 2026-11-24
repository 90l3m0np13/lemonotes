export type AppView =
  | { name: 'home' }
  | { name: 'notes' }
  | { name: 'note'; id: string }
  | { name: 'capture'; kind: 'meeting' | 'personal'; sessionId?: string }
  | { name: 'settings' }

export type NavView = 'home' | 'notes' | 'settings'
