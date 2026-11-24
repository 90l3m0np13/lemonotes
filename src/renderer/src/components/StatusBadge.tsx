import type { SessionStatus } from '@shared/types'
import { STATUS_META } from '../lib/format'

export function StatusBadge({ status, compact = false }: { status: SessionStatus; compact?: boolean }): React.JSX.Element {
  const meta = STATUS_META[status]
  return (
    <span className={`status-badge status-${meta.tone} ${compact ? 'is-compact' : ''}`}>
      <span className="status-dot" />
      {meta.label}
    </span>
  )
}
