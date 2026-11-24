import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { classNames } from '../lib/format'

type ToastTone = 'success' | 'info' | 'error'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([])

  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random()
    setItems((current) => [...current.slice(-3), { id, message, tone }])
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id))
    }, 5200)
  }, [])

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={classNames('toast', `toast-${item.tone}`)}>
            {item.tone === 'success' ? (
              <CheckCircle2 size={20} />
            ) : item.tone === 'error' ? (
              <TriangleAlert size={20} />
            ) : (
              <Info size={20} />
            )}
            <p>{item.message}</p>
            <button
              aria-label="Cerrar aviso"
              onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast necesita ToastProvider')
  return context
}
