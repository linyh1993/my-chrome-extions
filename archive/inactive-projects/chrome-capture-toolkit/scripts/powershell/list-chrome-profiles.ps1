param(
  [string]$UserDataDir,
  [switch]$AsJson
)

function Resolve-DefaultUserDataDir {
  return Join-Path $env:LocalAppData "Google\Chrome\User Data"
}

function Read-JsonFile {
  param(
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Convert-ActiveTime {
  param(
    $Value
  )

  if ($null -eq $Value) {
    return $null
  }

  try {
    $seconds = [long][Math]::Floor([double]$Value)
    return ([DateTimeOffset]::FromUnixTimeSeconds($seconds)).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss")
  } catch {
    return $null
  }
}

function Get-ProfileNameFromPreferences {
  param(
    [string]$ProfileDir
  )

  $preferencesPath = Join-Path $ProfileDir "Preferences"
  $preferences = Read-JsonFile -Path $preferencesPath
  if ($null -eq $preferences) {
    return $null
  }

  if ($preferences.profile -and $preferences.profile.name) {
    return [string]$preferences.profile.name
  }

  return $null
}

function New-ProfileRecord {
  param(
    [string]$BaseDir,
    [string]$ProfileDirectory,
    $ProfileInfo,
    [string]$Source
  )

  $profilePath = Join-Path $BaseDir $ProfileDirectory
  $profileName = $null
  $userName = $null
  $gaiaName = $null
  $lastActiveTime = $null
  $isUsingDefaultName = $null

  if ($ProfileInfo) {
    if ($ProfileInfo.name) {
      $profileName = [string]$ProfileInfo.name
    }
    if ($ProfileInfo.user_name) {
      $userName = [string]$ProfileInfo.user_name
    }
    if ($ProfileInfo.gaia_name) {
      $gaiaName = [string]$ProfileInfo.gaia_name
    }
    if ($null -ne $ProfileInfo.active_time) {
      $lastActiveTime = Convert-ActiveTime -Value $ProfileInfo.active_time
    }
    if ($null -ne $ProfileInfo.is_using_default_name) {
      $isUsingDefaultName = [bool]$ProfileInfo.is_using_default_name
    }
  }

  if ([string]::IsNullOrWhiteSpace($profileName)) {
    $profileName = Get-ProfileNameFromPreferences -ProfileDir $profilePath
  }
  if ([string]::IsNullOrWhiteSpace($profileName)) {
    $profileName = $ProfileDirectory
  }

  [pscustomobject]@{
    ProfileDirectory   = $ProfileDirectory
    ProfileName        = $profileName
    UserName           = $userName
    GaiaName           = $gaiaName
    LastActiveTime     = $lastActiveTime
    IsUsingDefaultName = $isUsingDefaultName
    Path               = $profilePath
    Source             = $Source
  }
}

function Get-ProfilesFromLocalState {
  param(
    [string]$BaseDir
  )

  $localStatePath = Join-Path $BaseDir "Local State"
  $localState = Read-JsonFile -Path $localStatePath
  if ($null -eq $localState -or $null -eq $localState.profile -or $null -eq $localState.profile.info_cache) {
    return @()
  }

  $result = @()
  foreach ($property in $localState.profile.info_cache.PSObject.Properties) {
    $profileDirectory = [string]$property.Name
    $profilePath = Join-Path $BaseDir $profileDirectory
    if (-not (Test-Path -LiteralPath $profilePath)) {
      continue
    }
    $result += New-ProfileRecord -BaseDir $BaseDir -ProfileDirectory $profileDirectory -ProfileInfo $property.Value -Source "local-state"
  }

  return $result
}

function Get-ProfilesByDirectoryScan {
  param(
    [string]$BaseDir
  )

  $result = @()
  $directories = Get-ChildItem -LiteralPath $BaseDir -Directory | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName "Preferences")
  }

  foreach ($directory in $directories) {
    $result += New-ProfileRecord -BaseDir $BaseDir -ProfileDirectory $directory.Name -ProfileInfo $null -Source "directory-scan"
  }

  return $result
}

if ([string]::IsNullOrWhiteSpace($UserDataDir)) {
  $UserDataDir = Resolve-DefaultUserDataDir
}

$resolvedUserDataDir = [System.IO.Path]::GetFullPath($UserDataDir)

if (-not (Test-Path -LiteralPath $resolvedUserDataDir)) {
  throw "Chrome user data dir not found: $resolvedUserDataDir"
}

$profiles = @(Get-ProfilesFromLocalState -BaseDir $resolvedUserDataDir)
if (-not $profiles.Count) {
  $profiles = @(Get-ProfilesByDirectoryScan -BaseDir $resolvedUserDataDir)
}

if (-not $profiles.Count) {
  throw "No Chrome profiles found under: $resolvedUserDataDir"
}

$profiles = $profiles | Sort-Object ProfileDirectory

if ($AsJson) {
  $profiles | ConvertTo-Json -Depth 10
  return
}

Write-Host ("User data dir: {0}" -f $resolvedUserDataDir)
$profiles | Format-Table ProfileDirectory, ProfileName, UserName, GaiaName, LastActiveTime, Path -AutoSize
