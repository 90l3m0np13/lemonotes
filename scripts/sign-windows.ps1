param(
  [Parameter(Mandatory = $true)]
  [string]$PfxPath,
  [string]$Password = $env:LEMONOTES_PFX_PASSWORD,
  [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $PfxPath)) {
  throw "No encuentro el certificado: $PfxPath"
}

$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1

if (-not $signtool) {
  throw "No encuentro signtool.exe. Instala Windows SDK (Signing Tools) o usa el certificado desde tu proveedor."
}

$files = @(
  (Join-Path $PSScriptRoot "..\dist\win-unpacked\LemoNotes.exe"),
  (Join-Path $PSScriptRoot "..\dist\win-unpacked\LemoNotesCore.exe")
)

foreach ($file in $files) {
  if (-not (Test-Path $file)) {
    throw "Falta el binario a firmar: $file"
  }

  Write-Host "Firmando $file..."
  $arguments = @(
    "sign",
    "/fd", "SHA256",
    "/f", (Resolve-Path $PfxPath).Path,
    "/tr", $TimestampUrl,
    "/td", "SHA256"
  )
  if ($Password) {
    $arguments += @("/p", $Password)
  }
  $arguments += $file

  & $signtool.FullName @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "signtool falló al firmar $file (código $LASTEXITCODE)."
  }

  & $signtool.FullName verify /pa /v $file
  if ($LASTEXITCODE -ne 0) {
    throw "La firma de $file no supera la verificación."
  }
}

$version = (Get-Content (Join-Path $PSScriptRoot "..\package.json") -Raw | ConvertFrom-Json).version
$distDir = (Resolve-Path (Join-Path $PSScriptRoot "..\dist")).Path
$appDir = (Resolve-Path (Join-Path $PSScriptRoot "..\dist\win-unpacked")).Path

$manifestPath = Join-Path $appDir "PERMISO-IT.txt"
if (Test-Path $manifestPath) {
  $manifest = Get-Content $manifestPath -Raw
  $launcherHash = (Get-FileHash (Join-Path $appDir "LemoNotes.exe") -Algorithm SHA256).Hash.ToLower()
  $coreHash = (Get-FileHash (Join-Path $appDir "LemoNotesCore.exe") -Algorithm SHA256).Hash.ToLower()
  $manifest = $manifest -replace '(?m)^  LemoNotes\.exe\s+[0-9a-f]{64}', "  LemoNotes.exe      $launcherHash"
  $manifest = $manifest -replace '(?m)^  LemoNotesCore\.exe\s+[0-9a-f]{64}', "  LemoNotesCore.exe  $coreHash"
  Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8 -NoNewline
}
$zipPath = Join-Path $distDir "LemoNotes-$version-win-x64.zip"
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}
& tar.exe -a -c -f $zipPath -C $appDir .
if ($LASTEXITCODE -ne 0) {
  throw "No he podido regenerar el ZIP después de firmar."
}
$hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
Set-Content -Path "$zipPath.sha256" -Value "$hash  LemoNotes-$version-win-x64.zip" -Encoding ASCII
Write-Host "Firma, verificación y ZIP completados: $zipPath"
Write-Host "SHA-256: $hash"
