[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ComfyUIPath
)

$ErrorActionPreference = 'Stop'
$packageRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$comfyRoot = (Resolve-Path -LiteralPath $ComfyUIPath).ProviderPath
if (-not (Test-Path -LiteralPath (Join-Path $comfyRoot 'main.py') -PathType Leaf)) {
    throw 'Please pass the ComfyUI directory containing main.py.'
}
$customRoot = Join-Path $comfyRoot 'custom_nodes'
if (-not (Test-Path -LiteralPath $customRoot)) {
    New-Item -ItemType Directory -Path $customRoot | Out-Null
}
$customRoot = (Resolve-Path -LiteralPath $customRoot).ProviderPath
$destination = [IO.Path]::GetFullPath((Join-Path $customRoot 'Adachi-Inpaint-Workbench'))
$legacyPath = [IO.Path]::GetFullPath((Join-Path $customRoot 'ComfyUI-Adachi-Workbench'))
if (-not $destination.StartsWith($customRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Install destination must stay within the selected custom_nodes directory.'
}
if ($destination.TrimEnd('\') -eq $packageRoot.TrimEnd('\')) {
    Write-Host 'This package is already in the selected ComfyUI custom_nodes directory.'
    exit 0
}
if ((Test-Path -LiteralPath $destination) -and (Test-Path -LiteralPath $legacyPath)) {
    throw 'Both current and legacy plugin folders exist. Keep one installation to avoid duplicate node registrations.'
}
$existingPath = if (Test-Path -LiteralPath $destination) { $destination } elseif (Test-Path -LiteralPath $legacyPath) { $legacyPath } else { $null }
if ($existingPath) {
    $existing = Get-Item -LiteralPath $existingPath
    if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Refusing to overwrite a junction or symbolic-link installation. Use a normal folder.'
    }
    $backupRoot = Join-Path $comfyRoot 'user\adachi-workbench-backups'
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $backupFile = Join-Path $backupRoot ('Adachi-Inpaint-Workbench-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.zip')
    Compress-Archive -LiteralPath $existingPath -DestinationPath $backupFile
    Write-Host "Previous installation backed up: $backupFile"
    if ($existingPath -ne $destination) {
        # Verify both resolved absolute paths before moving the legacy folder.
        if ([IO.Path]::GetDirectoryName($existingPath) -ne $customRoot -or [IO.Path]::GetDirectoryName($destination) -ne $customRoot) {
            throw 'Migration paths must remain directly inside the selected custom_nodes directory.'
        }
        Move-Item -LiteralPath $existingPath -Destination $destination
    }
} else {
    New-Item -ItemType Directory -Path $destination | Out-Null
}
Get-ChildItem -LiteralPath $packageRoot -Force | Where-Object {
    $_.Name -ne '__pycache__' -and $_.Name -ne '.git' -and $_.Extension -ne '.pyc'
} | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
}
# These tracked files were retired in 0.6.2. The previous installation ZIP above
# retains them for rollback; remove them from an overwritten installation too.
foreach ($retiredRelative in @('web\magic_wand.js', 'web\magic_wand_worker.js', 'web\wand_selection.js', 'tests\test_magic_wand.mjs')) {
    $retiredPath = [IO.Path]::GetFullPath((Join-Path $destination $retiredRelative))
    if (-not $retiredPath.StartsWith($destination.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Retired plugin file must stay within the install directory.'
    }
    if (Test-Path -LiteralPath $retiredPath -PathType Leaf) { Remove-Item -LiteralPath $retiredPath -Force }
}
Write-Host "Installed Adachi-Inpaint-Workbench: $destination"
Write-Host 'Restart ComfyUI, then refresh the browser with Ctrl+F5.'
