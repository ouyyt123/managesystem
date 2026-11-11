$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'Research Material Hub'

$node = $null
$command = Get-Command node -ErrorAction SilentlyContinue
if ($command) { $node = $command.Source }
if (-not $node) {
  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
    "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { $node = $candidate; break }
  }
}
if (-not $node) {
  Write-Host ''
  Write-Host '[错误] 未找到 Node.js 20 及以上版本，请先安装：https://nodejs.org/' -ForegroundColor Red
  Write-Host ''
  Read-Host '按回车退出'
  exit 1
}

& $node 'tools\launch.mjs' @args
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host ''
  Write-Host "启动失败，退出码 $code。" -ForegroundColor Red
  Write-Host '若提示端口被占用，请先运行 stop.cmd，或设置 PORT 环境变量后重试。'
  Read-Host '按回车关闭窗口'
}
exit $code
