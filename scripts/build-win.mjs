import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

function run(command, args, extraEnv = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} terminó con código ${result.status}`)
}

run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.node.json'])
run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.web.json'])
run(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build'])
run(process.execPath, ['node_modules/electron-builder/cli.js', '--dir', '--win'])
run(process.execPath, ['scripts/patch-exe.mjs'])

const appDir = path.join(root, 'dist', 'win-unpacked')
const corePath = path.join(appDir, 'LemoNotesCore.exe')
const launcherPath = path.join(appDir, 'LemoNotes.exe')
const builtElectron = path.join(appDir, 'LemoNotes.exe')

// El lanzador pasa --no-sandbox antes de arrancar Electron. En equipos con
// antivirus que inyecta hooks (Panda/WAC, por ejemplo), Chromium sin ese flag
// termina con una excepción 0x80000003. El núcleo conserva contextIsolation,
// nodeIntegration desactivado y solo carga contenido local.
if (fs.existsSync(corePath)) fs.rmSync(corePath, { force: true })
fs.renameSync(builtElectron, corePath)

const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'
if (!fs.existsSync(csc)) {
  throw new Error('No encuentro csc.exe de .NET Framework 4.8 para compilar el lanzador.')
}
run(csc, [
  '/nologo',
  '/target:winexe',
  '/platform:x64',
  '/optimize+',
  `/win32icon:${path.join(root, 'build', 'icon.ico')}`,
  `/out:${launcherPath}`,
  '/reference:System.dll',
  '/reference:System.Windows.Forms.dll',
  path.join(root, 'launcher', 'LemoNotesLauncher.cs')
])

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
fs.writeFileSync(
  path.join(appDir, 'PERMISO-IT.txt'),
  [
    'LemoNotes · solicitud de permiso local',
    '=====================================',
    '',
    'Esta app es una libreta local de notas por voz. No se ejecuta desde una',
    'red, no instala servicios y no se actualiza sola. Si una política de',
    'integridad de código (WDAC / Smart App Control / AppLocker) o un antivirus',
    'bloquea los ejecutables sin firma, pide a la persona administradora que',
    'permita la carpeta donde descomprimiste el ZIP (la que contiene',
    'LemoNotes.exe):',
    '',
    '  [ruta completa de la carpeta en este equipo]',
    '',
    'Hashes SHA-256 de esta build:',
    `  LemoNotes.exe      ${sha256(launcherPath)}`,
    `  LemoNotesCore.exe  ${sha256(corePath)}`,
    '',
    'También conviene excluir la carpeta en Panda Security/WAC si el equipo lo',
    'usa, porque su hook de sandbox hace fallar a Chromium sin --no-sandbox.',
    '',
    'El lanzador LemoNotes.exe arranca LemoNotesCore.exe con --no-sandbox.',
    'El núcleo conserva contextIsolation, nodeIntegration desactivado y CSP;',
    'solo carga la interfaz local de resources/app.asar.',
    '',
    'La IA solo sale a api.deepseek.com cuando la persona pulsa una acción de',
    'IA y configura su propia clave en .env. El audio nunca se envía.',
    ''
  ].join('\r\n')
)

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
const zipPath = path.join(root, 'dist', `LemoNotes-${version}-win-x64.zip`)
if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true })
run('tar.exe', ['-a', '-c', '-f', zipPath, '-C', path.join(root, 'dist', 'win-unpacked'), '.'])
const digest = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex')
fs.writeFileSync(`${zipPath}.sha256`, `${digest}  ${path.basename(zipPath)}\n`)
console.log(`\nListo: ${zipPath}`)
console.log(`SHA-256: ${digest}`)
