param(
  [string]$MenuGroup,
  [string]$MenuName,
  [string]$OutputDir = "F:\work\skill factory\数据\ops",
  [int]$Port = 9222,
  [string]$TargetId,
  [string]$UrlContains,
  [string]$TitleContains,
  [string]$NavigateUrl,
  [switch]$AutoMenu,
  [switch]$OpenChrome,
  [switch]$OpenBlankTab,
  [switch]$IncludeBase64,
  [ValidateSet("flat", "nested")]
  [string]$RouteLayout = "flat"
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

function Sanitize-PathSegment {
  param(
    [string]$Value
  )

  $invalidPattern = '[<>:"/\\|?*\x00-\x1F]'
  $sanitized = ($Value -replace $invalidPattern, '_').Trim().TrimEnd('.', ' ')
  if ([string]::IsNullOrWhiteSpace($sanitized)) {
    return "_"
  }
  return $sanitized
}

function New-RemoteTab {
  param(
    [int]$Port,
    [string]$Url = "about:blank"
  )

  $target = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/json/new?{1}" -f $Port, $Url) -Method Put
  return $target
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ((-not $AutoMenu) -and ([string]::IsNullOrWhiteSpace($MenuGroup) -or [string]::IsNullOrWhiteSpace($MenuName))) {
  throw "Manual mode requires both -MenuGroup and -MenuName. Use -AutoMenu to detect menu changes automatically."
}

if (-not (Test-DebugEndpoint -Port $Port)) {
  if (-not $OpenChrome) {
    throw "No Chrome remote debugging endpoint found on port $Port. Re-run with -OpenChrome, or manually start Chrome with --remote-debugging-port=$Port."
  }

  & (Join-Path $scriptDir "start-chrome-remote-debug.ps1") -Port $Port
}

$effectiveTargetId = $TargetId

if ($OpenBlankTab -or $NavigateUrl) {
  $tabUrl = "about:blank"
  if ($NavigateUrl) {
    $tabUrl = $NavigateUrl
  }
  $target = New-RemoteTab -Port $Port -Url $tabUrl
  $effectiveTargetId = $target.id
}

$splitDir = $null
$safeMenuGroup = $null
$safeMenuName = $null

if (-not $AutoMenu) {
  $safeMenuGroup = Sanitize-PathSegment -Value $MenuGroup
  $safeMenuName = Sanitize-PathSegment -Value $MenuName
  $splitDir = Join-Path (Join-Path $OutputDir $safeMenuGroup) $safeMenuName
}

$arguments = @(
  (Join-Path $scriptDir "capture-chrome-network.mjs"),
  "--port", $Port,
  "--split-only",
  "--route-layout", $RouteLayout
)

if ($AutoMenu) {
  $arguments += @("--auto-menu", "--menu-root-dir", $OutputDir)
  if (-not [string]::IsNullOrWhiteSpace($MenuGroup)) {
    $arguments += @("--menu-group", $MenuGroup)
  }
  if (-not [string]::IsNullOrWhiteSpace($MenuName)) {
    $arguments += @("--menu-name", $MenuName)
  }
} else {
  $arguments += @("--split-dir", $splitDir, "--menu-group", $MenuGroup, "--menu-name", $MenuName)
}

if ($effectiveTargetId) {
  $arguments += @("--target-id", $effectiveTargetId)
} elseif ($TitleContains) {
  $arguments += @("--title-contains", $TitleContains)
} elseif ($UrlContains) {
  $arguments += @("--url-contains", $UrlContains)
} else {
  $arguments += @("--title-contains", $MenuName)
}

if ($IncludeBase64) {
  $arguments += "--include-base64"
}

if ($AutoMenu) {
  Write-Host "Menu mode: auto"
  Write-Host "Menu root: $OutputDir"
  if ($MenuGroup) {
    Write-Host "Fallback group: $MenuGroup"
  }
  if ($MenuName) {
    Write-Host "Fallback name: $MenuName"
  }
} else {
  Write-Host "Menu mode: manual"
  Write-Host "Menu group: $MenuGroup"
  Write-Host "Menu name: $MenuName"
  Write-Host "Split dir: $splitDir"
}
Write-Host "Route layout: $RouteLayout"
Write-Host "Starting capture..."

& node @arguments
