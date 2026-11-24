import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileKey2,
  FolderOpen,
  HardDrive,
  Info,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mic2,
  MonitorSpeaker,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Wifi
} from 'lucide-react'
import type { Bootstrap, DownloadProgress, Settings, WhisperModelInfo } from '@shared/types'
import { Button, Field, Toggle } from '../components/UI'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { classNames, cleanErrorMessage } from '../lib/format'

export function SettingsPage({
  boot,
  onBootChange,
  onBack
}: {
  boot: Bootstrap
  onBootChange: (next: Bootstrap) => void
  onBack: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [settings, setSettings] = useState<Settings>(boot.settings)
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const off = api().onDownloadProgress((progress) => {
      const key = progress.modelId ?? progress.target
      setDownloads((current) => ({ ...current, [key]: progress }))
    })
    return off
  }, [])

  const refreshBoot = async (): Promise<void> => {
    setRefreshing(true)
    try {
      const next = await api().bootstrap()
      onBootChange(next)
      setSettings(next.settings)
    } catch (error) {
      toast.show(cleanErrorMessage(error), 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const persist = async (patch: Partial<Settings>): Promise<void> => {
    try {
      const saved = await api().saveSettings(patch)
      setSettings(saved)
      onBootChange({ ...boot, settings: saved })
    } catch (error) {
      toast.show(cleanErrorMessage(error), 'error')
    }
  }

  const selectModel = async (model: WhisperModelInfo): Promise<void> => {
    const available = model.downloaded || model.bundled
    if (!available) {
      toast.show('Ese modelo aún no está descargado. Dale a descargar primero.', 'info')
      return
    }
    await persist({ selectedWhisperModel: model.id })
    toast.show(`Modelo ${model.label} seleccionado.`, 'success')
  }

  const downloadModel = async (model: WhisperModelInfo): Promise<void> => {
    setBusy(model.id)
    try {
      const result = await api().downloadWhisper('model', model.id)
      if (!result.ok) {
        toast.show(result.message || 'La descarga no ha terminado.', 'error')
      } else {
        await persist({ selectedWhisperModel: model.id })
        toast.show(`Modelo ${model.label} listo para escuchar.`, 'success')
        await refreshBoot()
      }
    } catch (error) {
      toast.show(cleanErrorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const downloadRuntime = async (): Promise<void> => {
    setBusy('runtime')
    try {
      const result = await api().downloadWhisper('whisper')
      if (!result.ok) toast.show(result.message || 'No he podido descargar Whisper.', 'error')
      else {
        toast.show('whisper.cpp está listo.', 'success')
        await refreshBoot()
      }
    } catch (error) {
      toast.show(cleanErrorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const chooseBinary = async (): Promise<void> => {
    try {
      const status = await api().chooseWhisperBinary()
      toast.show(status.binaryReady ? 'whisper-cli encontrado.' : 'Ese archivo no parece whisper-cli.exe.', status.binaryReady ? 'success' : 'error')
      await refreshBoot()
    } catch (error) {
      toast.show(cleanErrorMessage(error), 'error')
    }
  }

  const chooseBackup = async (): Promise<void> => {
    try {
      const dir = await api().chooseBackupDir()
      if (dir) {
        setSettings((current) => ({ ...current, backupDir: dir }))
        toast.show('Carpeta de copias actualizada.', 'success')
        await refreshBoot()
      }
    } catch (error) {
      toast.show(cleanErrorMessage(error), 'error')
    }
  }

  const renderProgress = (key: string): React.JSX.Element | null => {
    const progress = downloads[key]
    if (!progress || progress.phase === 'done') return null
    const percent = progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0
    return (
      <div className="download-progress">
        <div className="download-progress-bar">
          <span style={{ width: `${percent}%` }} />
        </div>
        <span>{progress.phase === 'error' ? progress.message : progress.message || `${percent}%`}</span>
      </div>
    )
  }

  const whisperReady = boot.whisper.binaryReady && boot.whisper.modelReady

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">La cocina</p>
          <h1 className="display-title">Ajustes con zumo.</h1>
          <p className="page-subtitle">
            Aquí se afinan las orejas, la chispa de Limo y el cajón donde duermen tus notas. Sin menús escondidos.
          </p>
        </div>
        <div className="header-actions">
          <Button variant="secondary" icon={<ArrowLeft size={17} />} onClick={onBack}>
            Volver
          </Button>
          <Button variant="ghost" icon={<RefreshCw size={17} className={refreshing ? 'spin' : ''} />} onClick={() => void refreshBoot()}>
            Actualizar
          </Button>
        </div>
      </header>

      <div className="settings-grid">
        <section className="settings-card settings-ai">
          <div className="settings-card-head">
            <span className="settings-icon purple">
              <Sparkles size={21} />
            </span>
            <div>
              <h2>Limo, la chispa de DeepSeek</h2>
              <p>Convierte la transcripción en acta. Sin clave, el resto de la libreta sigue funcionando.</p>
            </div>
            <span className={classNames('settings-state', boot.ai.configured ? 'is-ok' : 'is-warn')}>
              {boot.ai.configured ? (
                <>
                  <CheckCircle2 size={14} /> Configurado
                </>
              ) : (
                <>
                  <TriangleAlert size={14} /> Sin clave
                </>
              )}
            </span>
          </div>

          <div className="settings-rows">
            <div className="settings-row">
              <span className="settings-row-icon">
                <KeyRound size={17} />
              </span>
              <div>
                <strong>Clave de API</strong>
                <span>
                  {boot.ai.configured
                    ? 'Detectada en el entorno. Nunca se envía al renderer ni se escribe en las notas.'
                    : 'Añade DEEPSEEK_API_KEY a tu archivo .env y reinicia la app.'}
                </span>
              </div>
              <span className="code-chip">{boot.ai.configured ? '••••••••••••' : 'DEEPSEEK_API_KEY'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row-icon">
                <Sparkles size={17} />
              </span>
              <div>
                <strong>Modelo</strong>
                <span>La ruta flash, rápida y con buena memoria para actas largas.</span>
              </div>
              <span className="code-chip">{boot.ai.model}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row-icon">
                <Wifi size={17} />
              </span>
              <div>
                <strong>Endpoint</strong>
                <span>Solo se usa cuando pulsas un botón de IA. Nunca en segundo plano.</span>
              </div>
              <span className="code-chip">{boot.ai.baseUrl}</span>
            </div>
          </div>

          <div className="settings-note">
            <FileKey2 size={18} />
            <div>
              <strong>¿Dónde pongo el .env?</strong>
              <p>
                En desarrollo, junto a <code>package.json</code>. En la app instalada, junto al ejecutable o en{' '}
                <code>%APPDATA%\LemoNotes\.env</code>. El archivo se lee al arrancar. El audio y las transcripciones no
                salen del equipo; solo el texto que decidas enviar a Limo.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void api().openPath('data')}>
              Abrir carpeta
            </Button>
          </div>
        </section>

        <section className="settings-card settings-whisper">
          <div className="settings-card-head">
            <span className="settings-icon green">
              <Mic2 size={21} />
            </span>
            <div>
              <h2>Whisper.cpp, las orejas locales</h2>
              <p>Transcripción gratuita, sin cuotas y sin mandar audio a ninguna parte.</p>
            </div>
            <span className={classNames('settings-state', whisperReady ? 'is-ok' : 'is-warn')}>
              {whisperReady ? (
                <>
                  <CheckCircle2 size={14} /> Listo
                </>
              ) : (
                <>
                  <TriangleAlert size={14} /> Falta un paso
                </>
              )}
            </span>
          </div>

          <div className="whisper-runtime">
            <div>
              <strong>Motor</strong>
              <span className="code-chip">{boot.whisper.version ?? 'sin instalar'}</span>
              <small>{boot.whisper.binaryPath ?? 'Descarga el ejecutable oficial de whisper.cpp'}</small>
            </div>
            <div className="whisper-runtime-actions">
              <Button variant="secondary" size="sm" icon={<FolderOpen size={15} />} onClick={() => void chooseBinary()}>
                Elegir ejecutable
              </Button>
              {!boot.whisper.binaryReady && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Download size={15} />}
                  loading={busy === 'runtime'}
                  onClick={() => void downloadRuntime()}
                >
                  Descargar motor
                </Button>
              )}
            </div>
            {renderProgress('runtime')}
          </div>

          <div className="model-grid">
            {boot.whisper.models.map((model) => {
              const available = model.downloaded || model.bundled
              const selected = boot.whisper.selectedModel === model.id
              return (
                <div key={model.id} className={classNames('model-card', selected && 'is-selected')}>
                  <div className="model-card-top">
                    <span className="model-name">{model.label}</span>
                    {model.bundled && <span className="model-badge">Incluido</span>}
                    {selected && (
                      <span className="model-selected">
                        <Check size={13} /> En uso
                      </span>
                    )}
                  </div>
                  <p>{model.description}</p>
                  <div className="model-card-foot">
                    <span>{model.sizeMb} MB</span>
                    {available ? (
                      <Button variant={selected ? 'ghost' : 'secondary'} size="sm" onClick={() => void selectModel(model)} disabled={selected}>
                        {selected ? 'Seleccionado' : 'Usar este'}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download size={14} />}
                        loading={busy === model.id}
                        onClick={() => void downloadModel(model)}
                      >
                        Descargar
                      </Button>
                    )}
                  </div>
                  {renderProgress(model.id)}
                </div>
              )
            })}
          </div>
          <p className="settings-footnote">
            <Info size={14} /> La primera transcripción de cada bloque tarda unos segundos. Cuanto más grande el modelo,
            mejor entiende acentos y ruido, pero más CPU pide.
          </p>
        </section>

        <section className="settings-card settings-audio">
          <div className="settings-card-head">
            <span className="settings-icon yellow">
              <MonitorSpeaker size={21} />
            </span>
            <div>
              <h2>Audio y grabación</h2>
              <p>Elige qué orejas están abiertas por defecto y cómo se guarda la mezcla.</p>
            </div>
          </div>
          <div className="settings-rows">
            <Toggle
              checked={settings.includeSystemAudio}
              onChange={(value) => void persist({ includeSystemAudio: value })}
              label="Escuchar también el audio del equipo"
              description="Videollamadas, navegador y reproductores. En Windows se pide una pantalla como llave técnica; el vídeo no se guarda."
            />
            <Toggle
              checked={settings.preserveTracks}
              onChange={(value) => void persist({ preserveTracks: value })}
              label="Guardar pistas separadas"
              description="Micrófono y equipo en archivos independientes, además de la mezcla."
            />
            <Toggle
              checked={settings.saveAudio}
              onChange={(value) => void persist({ saveAudio: value })}
              label="Guardar el audio cifrado"
              description="Si lo desactivas, solo quedarán el texto y tus notas. El audio temporal se borra al terminar."
            />
            <Toggle
              checked={settings.liveTranscription}
              onChange={(value) => void persist({ liveTranscription: value })}
              label="Transcripción en directo"
              description="Texto provisional mientras hablas. Si lo apagas, Whisper trabajará igualmente por bloques."
            />
            <Toggle
              checked={settings.vadAutoPause}
              onChange={(value) => void persist({ vadAutoPause: value })}
              label="Pausa automática en silencios"
              description="Si nadie habla durante un rato, la captura se pausa y vuelve cuando detecta voz."
            />
            <Field label="Silencio antes de pausar" hint="Entre 3 y 60 segundos. El silencio también descansa.">
              <select
                value={settings.vadSilenceSeconds}
                onChange={(event) => void persist({ vadSilenceSeconds: Number(event.target.value) })}
              >
                {[4, 6, 8, 10, 15, 20, 30, 45, 60].map((value) => (
                  <option key={value} value={value}>
                    {value} segundos
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Idioma por defecto" hint="Whisper entiende bastantes idiomas; el acta se escribe en español.">
              <select value={settings.language} onChange={(event) => void persist({ language: event.target.value })}>
                <option value="es">Español</option>
                <option value="en">Inglés</option>
                <option value="auto">Detectar automáticamente</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="settings-card settings-backup">
          <div className="settings-card-head">
            <span className="settings-icon blue">
              <HardDrive size={21} />
            </span>
            <div>
              <h2>Copia de seguridad</h2>
              <p>Una segunda casa local para tus actas. Sin nube obligatoria ni cuentas.</p>
            </div>
            <span className={classNames('settings-state', settings.backupEnabled ? 'is-ok' : 'is-muted')}>
              {settings.backupEnabled ? 'Activa' : 'Pausada'}
            </span>
          </div>
          <Toggle
            checked={settings.backupEnabled}
            onChange={(value) => void persist({ backupEnabled: value })}
            label="Guardar copia en segundo plano"
            description="Cada cambio se encola y se reintenta con espera creciente. La nota local nunca espera a la copia."
          />
          <div className="backup-path">
            <div>
              <span>Carpeta de copias</span>
              <code>{settings.backupDir || 'Sin carpeta elegida'}</code>
            </div>
            <div className="backup-actions">
              <Button variant="secondary" size="sm" icon={<FolderOpen size={15} />} onClick={() => void chooseBackup()}>
                Elegir carpeta
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void api().openPath('backups')}>
                Abrir
              </Button>
            </div>
          </div>
          <p className="settings-footnote">
            <LockKeyhole size={14} /> Se guarda un <code>.lemonote</code> cifrado y una versión Markdown legible en{' '}
            <code>actas-legibles</code>. Si no quieres texto plano ahí, elige una carpeta cifrada por el sistema.
          </p>
        </section>

        <section className="settings-card settings-privacy">
          <div className="settings-card-head">
            <span className="settings-icon red">
              <ShieldCheck size={21} />
            </span>
            <div>
              <h2>Privacidad y datos</h2>
              <p>La letra pequeña, escrita en grande.</p>
            </div>
          </div>
          <div className="privacy-facts">
            <div>
              <LockKeyhole size={18} />
              <strong>Notas cifradas</strong>
              <span>{boot.protection === 'dpapi' ? 'Llave protegida con DPAPI de Windows.' : 'Llavero local básico.'}</span>
            </div>
            <div>
              <Mic2 size={18} />
              <strong>Audio local</strong>
              <span>Se cifra al terminar y nunca se sube.</span>
            </div>
            <div>
              <Sparkles size={18} />
              <strong>IA bajo demanda</strong>
              <span>Solo envía texto si pulsas un botón de Limo.</span>
            </div>
          </div>
          <div className="settings-row data-dir-row">
            <span className="settings-row-icon">
              <HardDrive size={17} />
            </span>
            <div>
              <strong>Carpeta de datos</strong>
              <span className="data-path">{boot.dataDir}</span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void api().openPath('data')}>
              Abrir
            </Button>
          </div>
          <p className="settings-footnote">
            <Info size={14} /> Para borrar una nota y su audio, ábrela y usa «Eliminar». No hay copia remota que borrar.
          </p>
        </section>

        <section className="settings-card settings-shortcuts">
          <div className="settings-card-head">
            <span className="settings-icon purple">
              <KeyRound size={21} />
            </span>
            <div>
              <h2>Atajos de la casa</h2>
              <p>Para no soltar el hilo mientras hablas.</p>
            </div>
          </div>
          <dl className="shortcut-list">
            <div>
              <dt>Nueva nota</dt>
              <dd>
                <kbd>Ctrl</kbd> + <kbd>N</kbd>
              </dd>
            </div>
            <div>
              <dt>Cuaderno rápido mientras grabas</dt>
              <dd>
                <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>N</kbd>
              </dd>
            </div>
            <div>
              <dt>Guardar nota manual</dt>
              <dd>
                <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
              </dd>
            </div>
            <div>
              <dt>Abrir Ajustes</dt>
              <dd>
                <kbd>Ctrl</kbd> + <kbd>,</kbd>
              </dd>
            </div>
          </dl>
          <div className="settings-note compact">
            <ArrowRight size={16} />
            <p>
              El atajo global de nota rápida funciona aunque la ventana esté minimizada, siempre que la grabación esté
              activa.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
