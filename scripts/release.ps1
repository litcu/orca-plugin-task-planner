[CmdletBinding()]
param(
  [ValidateSet("patch", "minor", "major")]
  [string]$Type = "patch",
  [string]$Branch = "main",
  [switch]$SkipBuild,
  [switch]$SkipPush,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location $repoRoot

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function New-LocalReleaseZip {
  param([string]$Version)

  $pluginDirName = "orca-task-planner"
  $releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "release"))
  $pluginRoot = Join-Path $releaseRoot $pluginDirName
  $archiveName = "$pluginDirName-v$Version.zip"
  $archivePath = Join-Path $releaseRoot $archiveName

  New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
  if (Test-Path $pluginRoot) {
    Remove-Item -Path $pluginRoot -Recurse -Force
  }
  if (Test-Path $archivePath) {
    Remove-Item -Path $archivePath -Force
  }

  New-Item -ItemType Directory -Path (Join-Path $pluginRoot "dist") -Force | Out-Null
  Copy-Item -Path "dist/index.js" -Destination (Join-Path $pluginRoot "dist/index.js")
  Copy-Item -Path "package.json" -Destination (Join-Path $pluginRoot "package.json")
  Copy-Item -Path "README.md" -Destination (Join-Path $pluginRoot "README.md")

  if (Test-Path "README_zh.md") {
    Copy-Item -Path "README_zh.md" -Destination (Join-Path $pluginRoot "README_zh.md")
  }

  if (Test-Path "icon.png") {
    Copy-Item -Path "icon.png" -Destination (Join-Path $pluginRoot "icon.png")
  } else {
    Write-Host "Warning: icon.png not found at repository root. Packaging without icon." -ForegroundColor Yellow
  }

  Compress-Archive -Path $pluginRoot -DestinationPath $archivePath -Force
  return $archivePath
}

if (-not $DryRun) {
  Write-Step "Checking git working tree"
  $gitStatus = git status --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "git status failed. Ensure this is a git repository and git is installed."
  }
  if ($gitStatus) {
    throw "Working tree is not clean. Please commit or stash changes first."
  }

  $currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to detect current git branch."
  }
  if ($currentBranch -ne $Branch) {
    throw "Current branch is '$currentBranch'. Please switch to '$Branch' or pass -Branch."
  }
} else {
  Write-Step "Running dry-run mode"
}

if (-not $SkipBuild) {
  Write-Step "Building plugin"
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed."
  }
}

if ($DryRun) {
  $packageVersion = (node -p "require('./package.json').version").Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($packageVersion)) {
    throw "Failed to read package.json version."
  }

  Write-Step "Packaging local release zip"
  $archivePath = New-LocalReleaseZip -Version $packageVersion

  Write-Host ""
  Write-Host "Dry run completed: v$packageVersion" -ForegroundColor Green
  Write-Host "Local archive: $archivePath" -ForegroundColor Green
  exit 0
}

Write-Step "Bumping version ($Type)"
$tag = (npm version $Type --tag-version-prefix v).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "npm version failed."
}
if (-not $tag.StartsWith("v")) {
  throw "Unexpected tag '$tag'. Expected a tag prefixed with 'v'."
}

if (-not $SkipPush) {
  Write-Step "Pushing commit to origin/$Branch"
  git push origin $Branch
  if ($LASTEXITCODE -ne 0) {
    throw "Push branch failed."
  }

  Write-Step "Pushing tag $tag"
  git push origin $tag
  if ($LASTEXITCODE -ne 0) {
    throw "Push tag failed."
  }
}

Write-Host ""
Write-Host "Release prepared: $tag" -ForegroundColor Green
if ($SkipPush) {
  Write-Host "Tag created locally. Push manually with:" -ForegroundColor Yellow
  Write-Host "git push origin $Branch" -ForegroundColor Yellow
  Write-Host "git push origin $tag" -ForegroundColor Yellow
} else {
  Write-Host "GitHub Actions will now build and create the Release for $tag." -ForegroundColor Green
}
