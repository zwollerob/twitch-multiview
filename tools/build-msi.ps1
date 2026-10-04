# Builds the MSI installer (dist\Twitch-MultiView-Setup-<version>.msi).
# The build itself runs in a local temp folder: the project lives on a NAS,
# and Electron's files don't work well from a network share.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$work = Join-Path $env:TEMP 'twitch-multiview-build'
$dist = Join-Path $root 'dist'

# Set by VS Code; would make Electron run as plain Node.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

if (Test-Path $work) { Remove-Item $work -Recurse -Force }

Push-Location $root
try {
    npx electron-builder --win msi --x64 --publish never "--config.directories.output=$work"
    if ($LASTEXITCODE -ne 0) { throw "Bouwen mislukt (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force $dist | Out-Null
$msi = Get-ChildItem $work -Filter '*.msi' | Select-Object -First 1
if (-not $msi) { throw 'Geen MSI gevonden in de build-uitvoer.' }
Copy-Item $msi.FullName $dist -Force
Write-Host "MSI klaar: $(Join-Path $dist $msi.Name) ($([math]::Round($msi.Length / 1MB)) MB)"
