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
$destination = [IO.Path]::GetFullPath((Join-Path $customRoot 'ComfyUI-Adachi-Workbench'))
if (-not $destination.StartsWith($customRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Install destination must stay within the selected custom_nodes directory.'
}
if ($destination.TrimEnd('\') -eq $packageRoot.TrimEnd('\')) {
    Write-Host 'This package is already in the selected ComfyUI custom_nodes directory. 喵'
    exit 0
}
if (Test-Path -LiteralPath $destination) {
    $existing = Get-Item -LiteralPath $destination
    if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Refusing to overwrite a junction or symbolic-link installation. Use a normal folder.'
    }
    $backupRoot = Join-Path $comfyRoot 'user\adachi-workbench-backups'
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $backupFile = Join-Path $backupRoot ('ComfyUI-Adachi-Workbench-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.zip')
    Compress-Archive -LiteralPath $destination -DestinationPath $backupFile
    Write-Host "Previous installation backed up: $backupFile 喵"
} else {
    New-Item -ItemType Directory -Path $destination | Out-Null
}
Get-ChildItem -LiteralPath $packageRoot -Force | Where-Object {
    $_.Name -ne '__pycache__' -and $_.Name -ne '.git' -and $_.Extension -ne '.pyc'
} | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
}
Write-Host "Installed Adachi Workbench: $destination 喵"
Write-Host 'Restart ComfyUI, then refresh the browser with Ctrl+F5. 喵'
