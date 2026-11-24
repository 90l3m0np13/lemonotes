import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const dataDir = path.join(root, '.e2e-final-shots')
fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true })
const childEnv = { ...process.env, LEMONOTES_E2E: '1', LEMONOTES_DATA_DIR: dataDir, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete childEnv.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: ['.', '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(root, '.e2e-test.wav')}`],
  cwd: root,
  env: childEnv,
  timeout: 60000
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.waitForSelector('.app-shell')
await page.getByRole('button', { name: /Hablar a mi ritmo/ }).click()
await page.waitForSelector('.capture-page')
await page.locator('select[aria-label="Idioma de la transcripción"]').selectOption('en')
await page.getByRole('button', { name: 'Empezar a hablar' }).click()
await page.waitForSelector('.recorder-card')
await page.waitForTimeout(12000)
await page.screenshot({ path: 'screenshots/final-recording.png' })
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('.recorder-actions button')]
  buttons[1]?.click()
})
await page.waitForSelector('.note-page', { timeout: 120000 })
await page.waitForTimeout(1200)
await page.locator('.note-title-input').fill('Weekly de producto · lanzamiento')
await page.locator('.note-title-input').press('Tab')
await page.waitForTimeout(900)
await page.locator('.rail-note-composer textarea').fill('Hablar con Marta sobre la fecha de la demo y el presupuesto final.')
await page.getByRole('button', { name: 'Añadir nota anclada' }).click()
await page.waitForTimeout(900)
await page.getByRole('button', { name: 'Borrador local' }).first().click()
await page.waitForTimeout(5800)
await page.screenshot({ path: 'screenshots/final-note.png' })
await page.getByRole('button', { name: 'Mis notas' }).first().click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Inicio' }).first().click()
await page.waitForTimeout(800)
await page.screenshot({ path: 'screenshots/final-home.png' })
await page.getByRole('button', { name: 'Ajustes' }).first().click()
await page.waitForSelector('.settings-page')
await page.waitForTimeout(600)
await page.screenshot({ path: 'screenshots/final-settings.png' })
console.log('ERRORS', JSON.stringify(errors))
console.log('SESSIONS', await page.evaluate(() => window.lemonotes.listSessions().then((list) => list.length)))
await app.close()
