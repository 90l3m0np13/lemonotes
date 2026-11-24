import { useEffect, useState } from 'react'
import { ArrowRight, Headphones, Mic2, Sparkles } from 'lucide-react'
import { Modal } from './UI'

export function NewNoteModal({
  open,
  onClose,
  onChoose
}: {
  open: boolean
  onClose: () => void
  onChoose: (kind: 'meeting' | 'personal') => void
}): React.JSX.Element {
  const [hover, setHover] = useState<'meeting' | 'personal'>('meeting')
  useEffect(() => {
    if (open) setHover('meeting')
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="¿Qué vamos a exprimir?"
      eyebrow="Nueva nota"
      width="700px"
      footer={
        <p className="modal-footnote">
          <Sparkles size={15} /> Después podrás cambiar fuentes, pausar o añadir notas con el teclado.
        </p>
      }
    >
      <div className="mode-choice-grid">
        <button
          className={`mode-choice ${hover === 'meeting' ? 'is-hot' : ''}`}
          onMouseEnter={() => setHover('meeting')}
          onClick={() => onChoose('meeting')}
        >
          <span className="mode-choice-icon">
            <Headphones size={28} />
          </span>
          <span className="mode-choice-kicker">Para tus llamadas</span>
          <strong>Reunión</strong>
          <p>Escucho tu micrófono y el audio del equipo. Ideal para videollamadas, clases y podcasts.</p>
          <span className="mode-choice-action">
            Preparar reunión <ArrowRight size={17} />
          </span>
        </button>
        <button
          className={`mode-choice mode-choice-alt ${hover === 'personal' ? 'is-hot' : ''}`}
          onMouseEnter={() => setHover('personal')}
          onClick={() => onChoose('personal')}
        >
          <span className="mode-choice-icon">
            <Mic2 size={28} />
          </span>
          <span className="mode-choice-kicker">Para pensar en voz alta</span>
          <strong>Mi voz</strong>
          <p>Solo micrófono. Perfecto para una idea fugaz, un diario o una nota antes de que se escape.</p>
          <span className="mode-choice-action">
            Hablar sin más <ArrowRight size={17} />
          </span>
        </button>
      </div>
    </Modal>
  )
}
