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

function Join-CsvArg {
  param(
    [string[]]$Values
  )

  if (-not $Values) {
    return $null
  }

  $items = @($Values | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() })
  if (-not $items.Count) {
    return $null
  }

  return ($items -join ",")
}

function New-RemoteTab {
  param(
    [int]$Port,
    [string]$Url = "about:blank"
  )

  return Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/json/new?{1}" -f $Port, $Url) -Method Put
}

function Get-RemoteTabs {
  param(
    [int]$Port
  )

  return @(Invoke-RestMethod "http://127.0.0.1:$Port/json/list" | Where-Object { $_.type -eq "page" })
}

function Get-TabHost {
  param(
    [string]$Url
  )

  try {
    return ([Uri]$Url).Host
  } catch {
    return ""
  }
}

function Select-TargetTab {
  param(
    [array]$Tabs,
    [string]$TargetId,
    [string]$HostContains,
    [string]$UrlContains,
    [string]$TitleContains,
    [int]$TabIndex,
    [switch]$Interactive
  )

  if ($TargetId) {
    return $Tabs | Where-Object { $_.id -eq $TargetId } | Select-Object -First 1
  }

  $matches = @($Tabs)

  if ($HostContains) {
    $needle = $HostContains.ToLowerInvariant()
    $matches = @($matches | Where-Object { (Get-TabHost -Url $_.url).ToLowerInvariant().Contains($needle) })
  }
  if ($UrlContains) {
    $needle = $UrlContains.ToLowerInvariant()
    $matches = @($matches | Where-Object { ([string]$_.url).ToLowerInvariant().Contains($needle) })
  }
  if ($TitleContains) {
    $needle = $TitleContains.ToLowerInvariant()
    $matches = @($matches | Where-Object { ([string]$_.title).ToLowerInvariant().Contains($needle) })
  }

  if ($matches.Count -eq 1) {
    return $matches[0]
  }

  if ($matches.Count -gt 1 -and $TabIndex -gt 0) {
    if ($TabIndex -le $matches.Count) {
      return $matches[$TabIndex - 1]
    }
    throw "TabIndex $TabIndex is out of range. Matching tabs: $($matches.Count)."
  }

  if ($matches.Count -gt 1 -and $Interactive) {
    Write-Host "Matched tabs:"
    for ($i = 0; $i -lt $matches.Count; $i++) {
      $tab = $matches[$i]
      $tabHost = Get-TabHost -Url $tab.url
      $title = if ([string]::IsNullOrWhiteSpace([string]$tab.title)) { "(no title)" } else { [string]$tab.title }
      Write-Host ("[{0}] {1} | {2} | {3}" -f ($i + 1), $tabHost, $title, $tab.url)
    }
    $picked = Read-Host "Choose tab index"
    $parsedIndex = 0
    if (-not [int]::TryParse($picked, [ref]$parsedIndex)) {
      throw "Invalid tab index: $picked"
    }
    if ($parsedIndex -lt 1 -or $parsedIndex -gt $matches.Count) {
      throw "Tab index out of range: $parsedIndex"
    }
    return $matches[$parsedIndex - 1]
  }

  if ($matches.Count -eq 0) {
    throw "No tab matched the given filters."
  }

  $preview = @()
  for ($i = 0; $i -lt [Math]::Min($matches.Count, 8); $i++) {
    $tab = $matches[$i]
    $tabHost = Get-TabHost -Url $tab.url
    $title = if ([string]::IsNullOrWhiteSpace([string]$tab.title)) { "(no title)" } else { [string]$tab.title }
    $preview += ("[{0}] {1} | {2} | {3}" -f ($i + 1), $tabHost, $title, $tab.url)
  }
  throw ("Multiple tabs matched. Use -TabIndex, -Interactive, or add narrower filters such as -HostContains, -UrlContains, or -TitleContains.`n" + ($preview -join "`n"))
}

function Resolve-TargetId {
  param(
    [int]$Port,
    [string]$TargetId,
    [string]$HostContains,
    [string]$UrlContains,
    [string]$TitleContains,
    [int]$TabIndex,
    [switch]$Interactive,
    [string]$NavigateUrl,
    [switch]$OpenBlankTab
  )

  if ($OpenBlankTab -or $NavigateUrl) {
    $tabUrl = "about:blank"
    if ($NavigateUrl) {
      $tabUrl = $NavigateUrl
    }
    return (New-RemoteTab -Port $Port -Url $tabUrl).id
  }

  if ($TargetId) {
    return $TargetId
  }

  $tabs = Get-RemoteTabs -Port $Port
  $selectedTab = Select-TargetTab -Tabs $tabs -TargetId $TargetId -HostContains $HostContains -UrlContains $UrlContains -TitleContains $TitleContains -TabIndex $TabIndex -Interactive:$Interactive
  $selectedTitle = if ([string]::IsNullOrWhiteSpace([string]$selectedTab.title)) { "(no title)" } else { [string]$selectedTab.title }
  Write-Host ("Selected tab: {0} | {1}" -f $selectedTitle, $selectedTab.url)
  return $selectedTab.id
}
