import fs from 'node:fs'
import path from 'node:path'
import * as PELibrary from 'pe-library'
import * as ResEdit from 'resedit'

const exePath = path.resolve(process.argv[2] || 'dist/win-unpacked/LemoNotes.exe')
const icoPath = path.resolve('build/icon.ico')
const workPath = exePath + '.patched'
const version = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version
const [major, minor, patch] = version.split('.').map((value) => Number(value) || 0)
if (!fs.existsSync(exePath)) throw new Error('No existe ' + exePath)

const data = fs.readFileSync(exePath)
const exe = PELibrary.NtExecutable.from(data, { ignoreCert: true })
const res = PELibrary.NtExecutableResource.from(exe)

const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)
console.log(
  'Grupos de iconos:',
  groups.map((group) => ({ id: group.id, lang: group.lang, icons: group.icons.length }))
)
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath))
const target = groups[0]
if (target) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    target.id,
    target.lang,
    iconFile.icons.map((icon) => icon.data)
  )
}

const versionInfos = ResEdit.Resource.VersionInfo.fromEntries(res.entries)
for (const versionInfo of versionInfos) {
  for (const lang of versionInfo.getAllLanguagesForStringValues()) {
    versionInfo.setStringValues(lang, {
      FileDescription: 'LemoNotes',
      ProductName: 'LemoNotes',
      CompanyName: 'LemoNotes',
      LegalCopyright: 'Copyright © 2026 LemoNotes',
      OriginalFilename: 'LemoNotes.exe',
      InternalName: 'LemoNotes'
    })
  }
  versionInfo.setFileVersion(major, minor, patch, 0, 1033)
  versionInfo.setProductVersion(major, minor, patch, 0, 1033)
  versionInfo.outputToResourceEntries(res.entries)
}

res.outputResource(exe)
const patched = Buffer.from(exe.generate())
fs.writeFileSync(workPath, patched)
console.log('Parcheado:', workPath, patched.length)

// Windows puede mantener bloqueado el ejecutable original para escritura.
// Renombrarlo primero permite apartarlo sin tocarlo y colocar el parcheado.
const backupPath = exePath + '.old'
if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true })
fs.renameSync(exePath, backupPath)
fs.renameSync(workPath, exePath)
try {
  fs.rmSync(backupPath, { force: true })
} catch {
  console.warn('El ejecutable anterior sigue bloqueado; se puede borrar más tarde:', backupPath)
}
console.log('Icono y versión aplicados a', exePath)
