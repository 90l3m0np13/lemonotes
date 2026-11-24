# Compilar y empaquetar

## Requisitos

- Windows 10/11 x64.
- Node.js 22 o superior.
- pnpm 10/11 (`corepack enable`).
- Para el lanzador `.NET`: `csc.exe` de .NET Framework 4 (viene con Windows).
- Para firmar: `signtool.exe` del Windows SDK y un certificado `.pfx` (opcional).

## Puesta en marcha

```bash
pnpm install
copy .env.example .env
pnpm setup:whisper base
pnpm dev
```

`pnpm setup:whisper base` descarga el runtime de `whisper.cpp` y el modelo `ggml-base` en `resources/`; esas carpetas no se versionan por tamaño.

## Calidad

```bash
pnpm typecheck
pnpm test
```

Los scripts de humo de `scripts/` lanzan Electron con audio falso y comprueban grabación, transcripción, reproducción, IA con servidor mock, copias y recuperación.

## Distribución Windows

```bash
pnpm build:win
```

El script:

1. ejecuta el typecheck;
2. compila main, preload y renderer con `electron-vite`;
3. empaqueta `win-unpacked` con `electron-builder`;
4. aplica icono y metadatos al `.exe`;
5. compila el lanzador `.NET`;
6. genera `dist/LemoNotes-<version>-win-x64.zip` y su `.sha256`.

El ZIP no incluye `LemoNotesData`, `.env` ni datos de usuario.

También existe:

```bash
pnpm build:installer
```

para intentar un instalador NSIS. En algunos entornos CI el desinstalador de NSIS requiere permisos que pueden no estar disponibles; el ZIP portable no tiene esa dependencia.

## Estructura del paquete

```text
LemoNotes.exe          lanzador .NET
LemoNotesCore.exe      núcleo Electron
resources/             app.asar, iconos, whisper y modelo
README.md
```

No muevas solo un `.exe`: el núcleo necesita `resources`.

## Firma de código

El proyecto no incluye una firma de confianza. Una firma autofirmada no resuelve SmartScreen ni una política WDAC.

Con un `.pfx`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sign-windows.ps1 `
  -PfxPath "C:\ruta\certificado.pfx" `
  -Password "tu-contraseña"
```

El script firma `LemoNotes.exe` y `LemoNotesCore.exe`, verifica las firmas y regenera el ZIP. Requiere `signtool.exe`.

Para distribución pública, las vías habituales son un certificado OV/EV de una CA, Certum Open Source, SignPath Foundation o Azure Trusted Signing. Todas exigen verificar identidad.

## Notas

- No commitees `.env`, `LemoNotesData`, `dist/`, `node_modules/` ni `resources/whisper`/`resources/models`.
- El repo usa `.gitignore` para evitarlo.
- Si el lanzador `.NET` falla en un equipo gestionado, el núcleo se puede abrir con `--no-sandbox`; consulta [INSTALACION.md](INSTALACION.md).
