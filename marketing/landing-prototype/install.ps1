$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ReleaseApi = "https://api.github.com/repos/mxrsv/spacevibe-deck/releases/latest"
$ReleasesPage = "https://github.com/mxrsv/spacevibe-deck/releases"
$RepositoryPath = "/mxrsv/spacevibe-deck/releases/download"
$ReleaseAssetPath = "/github-production-release-asset/1287332937/"
$Headers = @{ Accept = "application/vnd.github+json" }
$TempDirectory = $null

function Stop-Install([string]$Message) {
  throw "${Message} Download manually: $ReleasesPage"
}

function Get-TrustedReleaseUri(
  [object]$Asset,
  [string]$Tag,
  [string]$ExpectedName
) {
  if ($null -eq $Asset -or $Asset.name -isnot [string] -or $Asset.name -ne $ExpectedName) {
    Stop-Install "Release asset metadata is malformed."
  }

  if ($Asset.browser_download_url -isnot [string]) {
    Stop-Install "Release asset URL is missing."
  }

  $Uri = $null

  if (-not [Uri]::TryCreate($Asset.browser_download_url, [UriKind]::Absolute, [ref]$Uri)) {
    Stop-Install "Release asset URL is malformed."
  }

  $DecodedPath = [Uri]::UnescapeDataString($Uri.AbsolutePath)
  $ExpectedPath = "$RepositoryPath/$Tag/$ExpectedName"

  if (
    $Uri.Scheme -ne "https" -or
    $Uri.Host -ne "github.com" -or
    $DecodedPath -ne $ExpectedPath
  ) {
    Stop-Install "Release asset is outside the trusted GitHub release origin."
  }

  return $Uri
}

function Test-TrustedFinalUri(
  [Uri]$Uri,
  [string]$ExpectedPath,
  [string]$ExpectedName
) {
  if ($Uri.Scheme -ne "https") {
    return $false
  }

  if (
    $Uri.Host -eq "github.com" -and
    [Uri]::UnescapeDataString($Uri.AbsolutePath) -eq $ExpectedPath
  ) {
    return $true
  }

  if (
    $Uri.Host -ne "release-assets.githubusercontent.com" -or
    -not $Uri.AbsolutePath.StartsWith($ReleaseAssetPath, [StringComparison]::Ordinal)
  ) {
    return $false
  }

  $DecodedQuery = [Uri]::UnescapeDataString($Uri.Query)
  return $DecodedQuery -match ("filename=" + [regex]::Escape($ExpectedName) + "(?:&|$)")
}

function Receive-TrustedAsset(
  [Uri]$Uri,
  [string]$Tag,
  [string]$Name,
  [string]$OutFile
) {
  Add-Type -AssemblyName System.Net.Http
  $Handler = [Net.Http.HttpClientHandler]::new()
  $Handler.AllowAutoRedirect = $true
  $Handler.MaxAutomaticRedirections = 5
  $Client = [Net.Http.HttpClient]::new($Handler)
  $Response = $null
  $InputStream = $null
  $OutputStream = $null

  try {
    $Client.DefaultRequestHeaders.UserAgent.ParseAdd("SpaceVibe-Deck-Installer/1")
    $Response = $Client.GetAsync(
      $Uri.AbsoluteUri,
      [Net.Http.HttpCompletionOption]::ResponseHeadersRead
    ).GetAwaiter().GetResult()
    $Response.EnsureSuccessStatusCode() | Out-Null
    $FinalUri = $Response.RequestMessage.RequestUri
    $ExpectedPath = "$RepositoryPath/$Tag/$Name"

    if (-not (Test-TrustedFinalUri $FinalUri $ExpectedPath $Name)) {
      Stop-Install "Download redirected outside the trusted GitHub release asset."
    }

    $InputStream = $Response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $OutputStream = [IO.File]::Create($OutFile)
    $InputStream.CopyTo($OutputStream)
  } finally {
    if ($null -ne $OutputStream) {
      $OutputStream.Dispose()
    }

    if ($null -ne $InputStream) {
      $InputStream.Dispose()
    }

    if ($null -ne $Response) {
      $Response.Dispose()
    }

    $Client.Dispose()
    $Handler.Dispose()
  }
}

try {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Stop-Install "64-bit Windows is required."
  }

  $ProcessorArchitecture = if ($env:PROCESSOR_ARCHITEW6432) {
    $env:PROCESSOR_ARCHITEW6432
  } else {
    $env:PROCESSOR_ARCHITECTURE
  }

  if (-not [Environment]::Is64BitOperatingSystem -or $ProcessorArchitecture -ne "AMD64") {
    Stop-Install "Windows x64 is required; Windows ARM is not supported."
  }

  $Release = Invoke-RestMethod -Uri $ReleaseApi -Headers $Headers -MaximumRedirection 5

  if (
    $null -eq $Release -or
    $Release.draft -ne $false -or
    $Release.prerelease -ne $false -or
    $Release.tag_name -isnot [string] -or
    $Release.tag_name -notmatch '^v?\d+\.\d+\.\d+$' -or
    $null -eq $Release.assets
  ) {
    Stop-Install "GitHub did not return a published stable release."
  }

  $InstallerAssets = @(
    $Release.assets | Where-Object {
      $_.name -is [string] -and $_.name -match '^[A-Za-z0-9._-]+-win-x64-setup\.exe$'
    }
  )
  $ManifestAssets = @(
    $Release.assets | Where-Object { $_.name -eq "latest.yml" }
  )

  if ($InstallerAssets.Count -ne 1) {
    Stop-Install "The stable release must contain exactly one Windows x64 installer."
  }

  if ($ManifestAssets.Count -ne 1) {
    Stop-Install "The stable release must contain exactly one latest.yml manifest."
  }

  $InstallerName = [string]$InstallerAssets[0].name
  $Tag = [string]$Release.tag_name
  $InstallerUri = Get-TrustedReleaseUri $InstallerAssets[0] $Tag $InstallerName
  $ManifestUri = Get-TrustedReleaseUri $ManifestAssets[0] $Tag "latest.yml"

  $TempDirectory = Join-Path ([IO.Path]::GetTempPath()) ("spacevibe-deck-" + [Guid]::NewGuid())
  [IO.Directory]::CreateDirectory($TempDirectory) | Out-Null
  $ManifestPath = Join-Path $TempDirectory "latest.yml"
  $InstallerPath = Join-Path $TempDirectory $InstallerName

  Write-Host "Installing SpaceVibe Deck $Tag for Windows x64..."
  Receive-TrustedAsset $ManifestUri $Tag "latest.yml" $ManifestPath

  $Manifest = [IO.File]::ReadAllText($ManifestPath)
  $PathMatch = [regex]::Match($Manifest, '(?m)^path:\s*([^\r\n]+)\s*$')
  $HashMatch = [regex]::Match($Manifest, '(?m)^sha512:\s*([^\r\n]+)\s*$')

  if (-not $PathMatch.Success -or $PathMatch.Groups[1].Value.Trim() -ne $InstallerName) {
    Stop-Install "latest.yml does not name the resolved installer."
  }

  if (-not $HashMatch.Success) {
    Stop-Install "latest.yml does not contain a SHA-512 value."
  }

  try {
    $ExpectedHashBytes = [Convert]::FromBase64String($HashMatch.Groups[1].Value.Trim())
  } catch {
    Stop-Install "latest.yml contains an invalid SHA-512 value."
  }

  if ($ExpectedHashBytes.Length -ne 64) {
    Stop-Install "latest.yml SHA-512 value has the wrong length."
  }

  Receive-TrustedAsset $InstallerUri $Tag $InstallerName $InstallerPath
  $ExpectedHash = [BitConverter]::ToString($ExpectedHashBytes).Replace("-", "")
  $ActualHash = (Get-FileHash -Algorithm SHA512 -LiteralPath $InstallerPath).Hash

  if (-not [string]::Equals($ExpectedHash, $ActualHash, [StringComparison]::OrdinalIgnoreCase)) {
    Stop-Install "Installer SHA-512 verification failed."
  }

  $Process = Start-Process -FilePath $InstallerPath -Wait -PassThru

  if ($Process.ExitCode -ne 0) {
    Stop-Install "The installer was cancelled or exited with code $($Process.ExitCode)."
  }

  Write-Host "SpaceVibe Deck $Tag installation completed."
} catch {
  throw "SpaceVibe Deck install failed: $($_.Exception.Message)"
} finally {
  if ($null -ne $TempDirectory -and [IO.Directory]::Exists($TempDirectory)) {
    Remove-Item -LiteralPath $TempDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
}
