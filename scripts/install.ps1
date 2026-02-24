param(
  [string]$Repo = $env:BB_REPO
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Repo)) {
  $Repo = "supSugam/beautiful-batches"
}

$ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"
Write-Host "Resolving latest release from $Repo..."
$Release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ "User-Agent" = "beautiful-batches-installer" }

$Arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64") { "arm64" } else { "x64" }
$ArchTokens = if ($Arch -eq "arm64") { @("arm64", "aarch64") } else { @("x64", "x86_64", "amd64") }
$OtherTokens = if ($Arch -eq "arm64") { @("x64", "x86_64", "amd64") } else { @("arm64", "aarch64") }

$Candidates = @()
foreach ($Asset in $Release.assets) {
  $Name = $Asset.name
  $Lower = $Name.ToLowerInvariant()
  if (-not $Lower.EndsWith(".exe")) { continue }
  if ($Lower.EndsWith(".sig") -or $Lower.EndsWith(".asc") -or $Lower.EndsWith(".sha256") -or $Lower.EndsWith(".sha512")) { continue }
  if ($Lower.Contains("updater") -or $Lower.Contains("symbol")) { continue }

  $Score = 100
  if ($Lower.Contains("setup") -or $Lower.Contains("installer") -or $Lower.Contains("nsis")) {
    $Score += 20
  }

  foreach ($Token in $ArchTokens) {
    if ($Lower.Contains($Token)) {
      $Score += 30
      break
    }
  }

  foreach ($Token in $OtherTokens) {
    if ($Lower.Contains($Token)) {
      $Score -= 35
    }
  }

  $Candidates += [PSCustomObject]@{
    Score = $Score
    Name = $Asset.name
    Url = $Asset.browser_download_url
  }
}

if ($Candidates.Count -eq 0) {
  $Available = ($Release.assets | ForEach-Object { $_.name }) -join "`n- "
  throw "No compatible Windows installer asset found.`nAvailable assets:`n- $Available"
}

$Best = $Candidates | Sort-Object -Property Score -Descending | Select-Object -First 1
$TmpPath = Join-Path $env:TEMP $Best.Name

Write-Host "Downloading $($Best.Name)..."
Invoke-WebRequest -Uri $Best.Url -OutFile $TmpPath

Write-Host "Launching installer..."
Start-Process -FilePath $TmpPath -Wait

Write-Host "Installation finished."
