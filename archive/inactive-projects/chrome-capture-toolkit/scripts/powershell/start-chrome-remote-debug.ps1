param(
  [int]$Port = 9222,
  [ValidateSet("reuse", "new")]
  [string]$LaunchMode = "reuse",
  [string]$ChromePath,
  [string]$UserDataDir = "$env:TEMP\chrome-remote-debug-profile",
  [string]$ProfileDirectory
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

if ($LaunchMode -eq "reuse" -and (Test-DebugEndpoint -Port $Port)) {
  Write-Host "Chrome remote debugging already available on port $Port"
  Write-Host "Profile: existing"
  return
}

if (-not $ChromePath) {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  )
  $ChromePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $ChromePath) {
  throw "chrome.exe not found. Install Chrome or update the script path list."
}

$arguments = @("--remote-debugging-port=$Port")

if ($UserDataDir) {
  New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null
  $arguments += "--user-data-dir=$UserDataDir"
}
if ($ProfileDirectory) {
  $arguments += "--profile-directory=$ProfileDirectory"
}

Start-Process -FilePath $ChromePath -ArgumentList $arguments

if (-not (Wait-DebugEndpoint -Port $Port)) {
  throw "Chrome started, but the remote debugging endpoint on port $Port did not become available."
}

Write-Host "Chrome started with remote debugging on port $Port"
Write-Host ("Chrome path: {0}" -f $ChromePath)
Write-Host ("User data dir: {0}" -f ($(if ($UserDataDir) { $UserDataDir } else { "default" })))
Write-Host ("Profile directory: {0}" -f ($(if ($ProfileDirectory) { $ProfileDirectory } else { "default" })))
