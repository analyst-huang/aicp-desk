param(
  [switch]$KeepData,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData\Local' }
$root = Join-Path $localAppData 'aicp-cli'
$bin = Join-Path $root 'bin'
if (-not $Yes) {
  $answer = Read-Host 'Uninstall AICP Desk? Type yes to continue'
  if ($answer -ne 'yes') { Write-Host 'Cancelled'; exit 0 }
}

$currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($currentPath -split ';' | Where-Object { $_ -and $_ -ne $bin })
[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')

$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AICP Desk.lnk'
Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue

if ($KeepData) {
  Remove-Item -LiteralPath (Join-Path $root 'app') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $bin -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Application removed. Templates and session data remain in: $root"
} else {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Application, templates, and the dedicated login session were removed.'
}
