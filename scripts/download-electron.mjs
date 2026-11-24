import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import AdmZip from 'adm-zip'

const version = '45.4.1'
const destRoot = path.resolve('node_modules/electron')
const zipPath = path.resolve('.electron-download', `electron-v${version}-win32-x64.zip`)
const url = `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-win32-x64.zip`

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('Demasiadas redirecciones'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    https
      .get(url, { headers: { 'User-Agent': 'LemoNotes-build' } }, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume()
          resolve(download(new URL(response.headers.location, url).toString(), destination, redirects + 1))
          return
        }
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode ?? '?'} al descargar Electron`))
          response.resume()
          return
        }
        const total = Number(response.headers['content-length'] || 0)
        let received = 0
        let last = 0
        const output = fs.createWriteStream(destination)
        response.on('data', (chunk) => {
          received += chunk.length
          if (total && Date.now() - last > 1500) {
            last = Date.now()
            process.stdout.write(`\rElectron ${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`)
          }
        })
        response.pipe(output)
        output.on('finish', () => {
          process.stdout.write('\n')
          output.close(() => resolve())
        })
        output.on('error', reject)
      })
      .on('error', reject)
  })
}

if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size < 50_000_000) {
  await download(url, zipPath)
}
console.log('Extrayendo Electron…')
const zip = new AdmZip(zipPath)
zip.extractAllTo(destRoot + '/dist', true)
fs.writeFileSync(path.join(destRoot, 'path.txt'), 'electron.exe')
console.log('Electron listo:', path.join(destRoot, 'dist', 'electron.exe'))
