#!/usr/bin/env pwsh
# WorkOS CLI installer for Windows
#
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/workos/cli/main/install.ps1 | iex
#
# Pin a version:
#   $env:WORKOS_VERSION = 'v0.11.0'; irm https://raw.githubusercontent.com/workos/cli/main/install.ps1 | iex
#
# Environment variables:
#   WORKOS_INSTALL  - Custom install directory (default: $HOME\.workos)
#   WORKOS_VERSION  - Version to install (default: latest)

param(
  [string]$Version = $env:WORKOS_VERSION
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Helpers -----------------------------------------------------------------

function Write-Info { param($msg) Write-Host "  $msg" -ForegroundColor DarkGray }
function Write-Ok   { param($msg) Write-Host "  $msg" -ForegroundColor Green }

function Write-Fail {
  param($msg)
  Write-Host "  error: $msg" -ForegroundColor Red
}

# --- Architecture detection --------------------------------------------------

if ($env:PROCESSOR_ARCHITECTURE -notin @('AMD64', 'EM64T')) {
  Write-Fail "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE`n`n  WorkOS CLI currently supports Windows x64 only."
  throw "Installation failed."
}

# --- Version + Download URL --------------------------------------------------

$repo = 'https://github.com/workos/cli'
$target = 'windows-x64'

if ($Version) {
  $Version = $Version.TrimStart('v')
  if ($Version -notmatch '^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$') {
    Write-Fail "Invalid version format: $Version`n`n  Expected: semantic version like 0.11.0 or 1.0.0-beta.1`n  Usage:    `$env:WORKOS_VERSION = 'v0.11.0'; irm https://raw.githubusercontent.com/workos/cli/main/install.ps1 | iex"
    throw "Installation failed."
  }
  $url = "$repo/releases/download/v$Version/workos-$target.zip"
} else {
  $url = "$repo/releases/latest/download/workos-$target.zip"
}

# --- Install directory -------------------------------------------------------

if ($env:WORKOS_INSTALL) { $installDir = $env:WORKOS_INSTALL } else { $installDir = Join-Path $HOME '.workos' }
$binDir     = Join-Path $installDir 'bin'
$exe        = Join-Path $binDir 'workos.exe'

if (-not (Test-Path $binDir)) {
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}

# --- Download + Extract ------------------------------------------------------

Write-Host ""
Write-Host "  Installing WorkOS CLI..." -ForegroundColor White
Write-Host ""
Write-Info "Downloading from $url"
Write-Host ""

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "workos-$([System.Guid]::NewGuid())"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
$tmpZip = Join-Path $tmpDir 'workos.zip'

try {
  try {
    # Force TLS 1.2 for Windows PowerShell 5.1 (no-op on PowerShell 7+ where it is the default)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'  # Invoke-WebRequest is ~10x faster without progress bar
    Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing
  } catch {
    if ($Version) { $ver = $Version } else { $ver = 'latest' }
    Write-Fail "Download failed.`n`n  Possible causes:`n    - No internet connection`n    - The version does not exist: $ver`n    - GitHub is unreachable`n`n  URL: $url"
    throw "Installation failed."
  }

  try {
    Expand-Archive -Path $tmpZip -DestinationPath $binDir -Force
  } catch {
    Write-Fail "Failed to extract archive: $_"
    throw "Installation failed."
  }
} finally {
  Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}

if (-not (Test-Path $exe)) {
  Write-Fail "Binary not found after extraction. The download may be corrupted -- try again."
  throw "Installation failed."
}

# --- Verify installation -----------------------------------------------------

try {
  $installedVersion = (& $exe --version 2>$null).Trim()
} catch {
  $installedVersion = 'unknown'
}

Write-Host ""
Write-Ok "WorkOS CLI $installedVersion installed successfully!"
Write-Host ""
Write-Info "Binary:  $exe"

# --- PATH setup --------------------------------------------------------------

$userPath    = [Environment]::GetEnvironmentVariable('PATH', 'User')
if (-not $userPath) { $userPath = '' }
$pathEntries = $userPath -split ';' | Where-Object { $_ -ne '' }

if ($pathEntries -contains $binDir) {
  # Already on PATH -- just print the getting-started line
  Write-Host ""
  Write-Host "  Run " -NoNewline
  Write-Host "workos --help" -ForegroundColor Cyan -NoNewline
  Write-Host " to get started"
  Write-Host ""
  return
}

# Add to user PATH (persists across sessions -- no admin rights needed)
$newPath = ($pathEntries + $binDir) -join ';'
[Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
$env:PATH = "$env:PATH;$binDir"  # Also update the current session

Write-Info "Added $binDir to PATH (User scope)"
Write-Host ""
Write-Info "Restart your terminal, then:"
Write-Host ""
Write-Info "Next steps:"
Write-Host ""
Write-Host "    workos auth login" -ForegroundColor Cyan
Write-Host "    workos --help" -ForegroundColor Cyan
Write-Host ""
return
