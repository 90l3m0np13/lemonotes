import { Mic, MonitorSpeaker, AudioLines } from 'lucide-react'
import { classNames } from '../lib/format'

export function LevelMeter({
  level,
  label,
  tone = 'green',
  active = true
}: {
  level: number
  label: string
  tone?: 'green' | 'red' | 'purple'
  active?: boolean
}): React.JSX.Element {
  const bars = 21
  return (
    <div className={classNames('level-meter', `level-${tone}`, !active && 'is-idle')}>
      <div className="level-label">
        <span>{label}</span>
        <span className="level-value">{Math.round(level * 100)}%</span>
      </div>
      <div className="level-bars" aria-hidden="true">
        {Array.from({ length: bars }, (_, index) => {
          const center = 1 - Math.abs(index - (bars - 1) / 2) / ((bars - 1) / 2)
          const wobble = 0.45 + 0.55 * Math.abs(Math.sin(index * 1.7))
          const height = Math.max(8, Math.min(100, level * 128 * (0.35 + center * 0.8) * wobble))
          return <span key={index} style={{ height: `${height}%` }} />
        })}
      </div>
    </div>
  )
}

export function SourcePill({
  icon,
  label,
  detail
}: {
  icon: 'mic' | 'system' | 'mixed'
  label: string
  detail?: string
}): React.JSX.Element {
  const Icon = icon === 'mic' ? Mic : icon === 'system' ? MonitorSpeaker : AudioLines
  return (
    <span className="source-pill">
      <Icon size={15} />
      <span>{label}</span>
      {detail && <em>{detail}</em>}
    </span>
  )
}
