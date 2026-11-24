import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const whisperVersion = 'v1.9.1'
const whisperZipUrl = `https://github.com/ggml-org/whisper.cpp/releases/download/${whisperVersion}/whisper-bin-x64.zip`
const model = process.argv[2] || 'base'
const modelSizes = { base: 147951465, small: 487601967, tiny: 77704715 }
const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`
const downloadDir = path.join(root, '.whisper-download')
const whisperDir = path.join(root, 'resources', 'whisper')
const modelsDir = path.join(root, 'resources', 'models')
const zipPath = path.join(downloadDir, 'whisper-bin-x64.zip')
const modelPath = path.join(modelsDir, `ggml-${model}.bin`)

function download(url, destination, label, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Demasiadas redirecciones'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    https
      .get(url, { headers: { 'User-Agent': 'LemoNotes-build' } }, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume()
          resolve(download(new URL(response.headers.location, url).toString(), destination, label, redirects + 1))
          return
        }
        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`HTTP ${response.statusCode ?? '?'} al descargar ${label}`))
          return
        }
        const total = Number(response.headers['content-length'] || 0)
        let received = 0
        let last = 0
        const temp = destination + '.part'
        const output = fs.createWriteStream(temp)
        response.on('data', (chunk) => {
          received += chunk.length
          if (Date.now() - last > 1200) {
            last = Date.now()
            const pct = total ? ` (${((received / total) * 100).toFixed(0)}%)` : ''
            process.stdout.write(`\r${label}: ${(received / 1048576).toFixed(1)} MB${pct}`)
          }
        })
        response.pipe(output)
        output.on('finish', () => {
          process.stdout.write('\n')
          output.close(() => {
            fs.renameSync(temp, destination)
            resolve()
          })
        })
        output.on('error', reject)
      })
      .on('error', reject)
  })
}

if (!fs.existsSync(path.join(whisperDir, 'whisper-cli.exe'))) {
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size < 1_000_000) {
    await download(whisperZipUrl, zipPath, 'Whisper.cpp')
  }
  console.log('Extrayendo Whisper.cpp…')
  const zip = new AdmZip(zipPath)
  const tempDir = path.join(downloadDir, 'extracted')
  fs.rmSync(tempDir, { recursive: true, force: true })
  zip.extractAllTo(tempDir, true)
  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.toLowerCase() === 'whisper-cli.exe') found.push(full)
    }
  }
  walk(tempDir)
  if (!found.length) throw new Error('No encontré whisper-cli.exe dentro del zip.')
  const sourceDir = path.dirname(found[0])
  fs.rmSync(whisperDir, { recursive: true, force: true })
  fs.mkdirSync(whisperDir, { recursive: true })
  fs.cpSync(sourceDir, whisperDir, { recursive: true })
  console.log('Whisper.cpp listo en', whisperDir)
} else {
  console.log('Whisper.cpp ya estaba listo.')
}

if (!fs.existsSync(modelPath) || fs.statSync(modelPath).size < (modelSizes[model] ?? 1) * 0.95) {
  await download(modelUrl, modelPath, `Modelo ${model}`)
} else {
  console.log(`El modelo ${model} ya estaba listo.`)
}
console.log('Modelo listo:', modelPath, `${(fs.statSync(modelPath).size / 1048576).toFixed(1)} MB`)
