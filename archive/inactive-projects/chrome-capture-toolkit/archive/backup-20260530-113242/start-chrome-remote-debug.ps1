param(
  [int]$Port = 9222,
  [string]$ProfileDir = "$env:TEMP\chrome-remote-debug-profile",
  [switch]$ForceNew
)

function Test-DebugEndpoint {
  param(
    [int]$Port
  )

  try {
    Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Wait-DebugEndpoint {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-DebugEndpoint -Port $Port) {
      return $true
    }
    Start-Sleep -Milliseconds 300
  }

  return $false
}

if ((-not $ForceNew) -and (Test-DebugEndpoint -Port $Port)) {
  Write-Host "Chrome remote debugging already available on port $Port"
  Write-Host "Profile: existing"
  return
}

$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)

$chromePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chromePath) {
  throw "chrome.exe not found. Install Chrome or update the script path list."
}

New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

Start-Process -FilePath $chromePath -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$ProfileDir"
)

if (-not (Wait-DebugEndpoint -Port $Port)) {
  throw "Chrome started, but the remote debugging endpoint on port $Port did not become available."
}

Write-Host "Chrome started with remote debugging on port $Port"
Write-Host "Profile: $ProfileDir"
