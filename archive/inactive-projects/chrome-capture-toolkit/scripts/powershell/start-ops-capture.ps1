param(
  [ValidateSet("auto", "manual")]
  [string]$Mode = "auto",
  [string]$MenuGroup,
  [string]$MenuName,
  [string]$OutputDir,
  [int]$Port = 9222,
  [string]$TargetId,
  [string]$HostContains,
  [string]$UrlContains,
  [string]$TitleContains,
  [int]$TabIndex,
  [switch]$Interactive,
  [string]$NavigateUrl,
  [switch]$OpenChrome,
  [switch]$OpenBlankTab,
  [ValidateSet("reuse", "new")]
  [string]$LaunchMode = "reuse",
  [string]$ChromePath,
  [string]$ChromeUserDataDir,
  [string]$ChromeProfileDirectory,
  [switch]$IncludeBase64,
  [ValidateSet("flat", "nested")]
  [string]$RouteLayout = "flat",
  [string[]]$DomainInclude,
  [string[]]$DomainExclude,
  [string[]]$UrlInclude,
  [string[]]$UrlExclude,
  [string[]]$MethodInclude,
  [string[]]$ResourceTypeInclude,
  [string[]]$MimeInclude
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$nodeScript = (Resolve-Path (Join-Path $scriptDir "..\..\src\capture\cli\capture-ops-network.mjs")).Path
. (Join-Path $scriptDir "lib\bootstrap.ps1")

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $projectRoot "output"
}

if ($Mode -eq "manual" -and ([string]::IsNullOrWhiteSpace($MenuGroup) -or [string]::IsNullOrWhiteSpace($MenuName))) {
  throw "Mode 'manual' requires both -MenuGroup and -MenuName."
}

if (-not (Test-DebugEndpoint -Port $Port)) {
  if (-not $OpenChrome) {
    throw "No Chrome remote debugging endpoint found on port $Port. Re-run with -OpenChrome, or manually start Chrome with --remote-debugging-port=$Port."
  }
  $chromeArgs = @("-Port", $Port, "-LaunchMode", $LaunchMode)
  if ($ChromePath) {
    $chromeArgs += @("-ChromePath", $ChromePath)
  }
  if ($PSBoundParameters.ContainsKey("ChromeUserDataDir")) {
    $chromeArgs += @("-UserDataDir", $ChromeUserDataDir)
  }
  if ($ChromeProfileDirectory) {
    $chromeArgs += @("-ProfileDirectory", $ChromeProfileDirectory)
  }
  & (Join-Path $scriptDir "start-chrome-remote-debug.ps1") @chromeArgs
}

$effectiveTargetId = Resolve-TargetId -Port $Port -TargetId $TargetId -HostContains $HostContains -UrlContains $UrlContains -TitleContains $TitleContains -TabIndex $TabIndex -Interactive:$Interactive -NavigateUrl $NavigateUrl -OpenBlankTab:$OpenBlankTab

$arguments = @(
  $nodeScript,
  "--port", $Port,
  "--target-id", $effectiveTargetId,
  "--split-only",
  "--menu-root-dir", $OutputDir,
  "--route-layout", $RouteLayout
)

if ($Mode -eq "auto") {
  $arguments += "--auto-menu"
} else {
  $arguments += @("--menu-group", $MenuGroup, "--menu-name", $MenuName)
}

if ($IncludeBase64) {
  $arguments += "--include-base64"
}

$filterMap = @(
  @{ Name = "domain-include"; Value = (Join-CsvArg -Values $DomainInclude) },
  @{ Name = "domain-exclude"; Value = (Join-CsvArg -Values $DomainExclude) },
  @{ Name = "url-include"; Value = (Join-CsvArg -Values $UrlInclude) },
  @{ Name = "url-exclude"; Value = (Join-CsvArg -Values $UrlExclude) },
  @{ Name = "method-include"; Value = (Join-CsvArg -Values $MethodInclude) },
  @{ Name = "resource-type-include"; Value = (Join-CsvArg -Values $ResourceTypeInclude) },
  @{ Name = "mime-include"; Value = (Join-CsvArg -Values $MimeInclude) }
)

foreach ($filter in $filterMap) {
  if ($filter.Value) {
    $arguments += @("--$($filter.Name)", $filter.Value)
  }
}

Write-Host "Mode: ops-$Mode"
Write-Host "Output dir: $OutputDir"
Write-Host "Target id: $effectiveTargetId"
if ($Mode -eq "manual") {
  Write-Host "Menu group: $MenuGroup"
  Write-Host "Menu name: $MenuName"
}
Write-Host "Route layout: $RouteLayout"
Write-Host "Starting capture..."

& node @arguments
