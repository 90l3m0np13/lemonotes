import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Gauge, Pause, Play, RotateCcw, Volume2 } from 'lucide-react'
import type { TrackKind } from '@shared/types'
import { api } from '../lib/api'
import { formatTimer } from '../lib/format'
import { IconButton } from './UI'

export interface AudioPlayerHandle {
  seek: (ms: number, autoplay?: boolean) => void
}

export const AudioPlayer = forwardRef<
  AudioPlayerHandle,
  {
    sessionId: string
    track?: TrackKind
    durationMs: number
    className?: string
    onTimeUpdate?: (ms: number) => void
  }
>(function AudioPlayer({ sessionId, track = 'mixed', durationMs, className, onTimeUpdate }, ref) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [rate, setRate] = useState(1)
  const [error, setError] = useState(false)
  const total = Math.max(durationMs, 1000)

  useEffect(() => {
    let cancelled = false
    api()
      .getMediaUrl(sessionId, track)
      .then((value) => {
        if (cancelled) return
        setUrl(value)
        setError(!value)
      })
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [sessionId, track])

  useImperativeHandle(ref, () => ({
    seek: (ms: number, autoplay = true) => {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = Math.max(0, ms / 1000)
      setCurrent(ms)
      if (autoplay) {
        void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
      }
    }
  }))

  if (error || !url) {
    return (
      <div className={`audio-player audio-player-empty ${className ?? ''}`}>
        <Volume2 size={18} />
        <span>El audio no se guardó para esta nota. La transcripción y tus palabras siguen aquí.</span>
      </div>
    )
  }

  return (
    <div className={`audio-player ${className ?? ''}`}>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onTimeUpdate={(event) => {
          const ms = event.currentTarget.currentTime * 1000
          setCurrent(ms)
          onTimeUpdate?.(ms)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setError(true)}
      />
      <IconButton
        label={playing ? 'Pausar audio' : 'Reproducir audio'}
        className="audio-play"
        onClick={() => {
          const audio = audioRef.current
          if (!audio) return
          if (playing) audio.pause()
          else void audio.play().catch(() => setError(true))
        }}
      >
        {playing ? <Pause size={19} /> : <Play size={19} fill="currentColor" />}
      </IconButton>
      <div className="audio-main">
        <div className="audio-meta">
          <span className="audio-label">
            <Volume2 size={14} /> Escuchar la nota
          </span>
          <span className="audio-time">
            {formatTimer(current)} <span>/</span> {formatTimer(total)}
          </span>
        </div>
        <input
          className="audio-range"
          type="range"
          min={0}
          max={total}
          step={250}
          value={Math.min(current, total)}
          aria-label="Posición del audio"
          onChange={(event) => {
            const value = Number(event.target.value)
            if (audioRef.current) audioRef.current.currentTime = value / 1000
            setCurrent(value)
          }}
          style={{ ['--progress' as string]: `${Math.min(100, (current / total) * 100)}%` }}
        />
      </div>
      <button
        className="audio-rate"
        title="Velocidad de reproducción"
        onClick={() => {
          const next = rate === 1 ? 1.25 : rate === 1.25 ? 1.5 : rate === 1.5 ? 0.75 : 1
          setRate(next)
          if (audioRef.current) audioRef.current.playbackRate = next
        }}
      >
        <Gauge size={15} /> {rate}×
      </button>
      <IconButton
        label="Volver al inicio"
        onClick={() => {
          if (audioRef.current) audioRef.current.currentTime = 0
          setCurrent(0)
        }}
      >
        <RotateCcw size={16} />
      </IconButton>
    </div>
  )
})
