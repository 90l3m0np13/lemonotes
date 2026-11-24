import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { classNames } from '../lib/format'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'purple' | 'danger' | 'yellow'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}): React.JSX.Element {
  return (
    <button
      className={classNames('btn', `btn-${variant}`, `btn-${size}`, className)}
      disabled={props.disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle className="spin" size={18} /> : icon}
      <span>{children}</span>
    </button>
  )
}

export function IconButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <button className={classNames('icon-btn', className)} title={label} aria-label={label} {...props}>
      {children}
    </button>
  )
}

export function Modal({
  open,
  title,
  eyebrow,
  children,
  footer,
  onClose,
  width = '520px',
  dismissable = true
}: {
  open: boolean
  title: string
  eyebrow?: string
  children: ReactNode
  footer?: ReactNode
  onClose?: () => void
  width?: string
  dismissable?: boolean
}): React.JSX.Element | null {
  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissable) onClose?.()
      }}
    >
      <div className="modal-card" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          {dismissable && onClose && (
            <IconButton label="Cerrar" onClick={onClose}>
              <X size={20} />
            </IconButton>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }): React.JSX.Element {
  return (
    <span className="spinner-inline">
      <LoaderCircle className="spin" size={20} />
      {label && <span>{label}</span>}
    </span>
  )
}

export function Field({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <label className={classNames('field', className)}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className={classNames('toggle-row', disabled && 'is-disabled')}>
      <div className="toggle-copy">
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-description">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={classNames('toggle', checked && 'is-on')}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  )
}
