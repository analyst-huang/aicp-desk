param(
  [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw 'Node.js was not found. Install Node.js 22 or newer first.'
}
$major = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) {
  throw "Node.js $major is too old. Version 22 or newer is required."
}

$source = $PSScriptRoot
$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData\Local' }
$root = Join-Path $localAppData 'aicp-cli'
$app = Join-Path $root 'app'
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force -Path $root, $app, $bin | Out-Null

Get-ChildItem -LiteralPath $app -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
$distributionItems = @(
  'bin', 'lib', 'web', 'docs', 'examples', 'package.json', 'README.md',
  'install.ps1', 'uninstall.ps1', 'install.sh', 'uninstall.sh',
  'aicp', 'aicp.cmd', 'start-gui.sh', 'start-gui.cmd'
)
foreach ($item in $distributionItems) {
  $itemPath = Join-Path $source $item
  if (Test-Path -LiteralPath $itemPath) {
    Copy-Item -LiteralPath $itemPath -Destination $app -Recurse -Force
  }
}

$cmd = @"
@echo off
node "$app\bin\aicp.mjs" %*
"@
Set-Content -LiteralPath (Join-Path $bin 'aicp.cmd') -Value $cmd -Encoding Ascii

$currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($currentPath -split ';' | Where-Object { $_ })
if ($parts -notcontains $bin) {
  [Environment]::SetEnvironmentVariable('Path', (($parts + $bin) -join ';'), 'User')
}

if (-not $NoShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $shortcutPath = Join-Path $desktop 'AICP Desk.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $env:ComSpec
  $shortcut.Arguments = "/c `"`"$bin\aicp.cmd`" gui`""
  $shortcut.WorkingDirectory = $bin
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'AICP local dashboard'
  $shortcut.Save()
}

Write-Host ''
Write-Host 'AICP Desk installed successfully.' -ForegroundColor Green
$version = (Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
Write-Host "Version: $version"
Write-Host "Application: $app"
Write-Host "Local data: $root"
Write-Host 'Open a new terminal and run: aicp login'
Write-Host 'Run the dashboard with: aicp gui'
