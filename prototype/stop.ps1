$ErrorActionPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

$port = if ($env:PORT) { [int]$env:PORT } else { 8088 }
$hits = Get-NetTCPConnection -LocalPort $port -State Listen

if (-not $hits) {
  Write-Host ''
  Write-Host "端口 $port 上没有运行中的服务，无需停止。"
  Write-Host ''
  exit 0
}

$killed = 0
foreach ($hit in $hits) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($hit.OwningProcess)"
  if ($process -and $process.CommandLine -match 'server[\\/]index\.mjs') {
    Stop-Process -Id $hit.OwningProcess -Force
    $killed += 1
    Write-Host ''
    Write-Host "已停止科研材料原型服务（PID $($hit.OwningProcess)）。"
  }
}

if ($killed -eq 0) {
  Write-Host ''
  Write-Host "端口 $port 被其他程序占用，未结束该进程。请确认后再手动处理。"
}
Write-Host ''
