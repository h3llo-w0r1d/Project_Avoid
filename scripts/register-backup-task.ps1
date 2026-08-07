# 백업 끌어오기를 매일 자동으로 돌게 등록한다. 한 번만 실행하면 된다.
#
#   .\scripts\register-backup-task.ps1
#
# 컴퓨터가 꺼져 있어 못 돌면, 켜진 뒤에 알아서 한 번 돈다.
# 그만두려면:  .\scripts\register-backup-task.ps1 -Remove

param(
  [switch]$Remove,
  # 매일 몇 시에 돌릴지. 서버가 새벽 4시에 백업을 뜨므로 그 뒤가 좋다.
  [string]$At = '13:00'
)

$ErrorActionPreference = 'Stop'
$NAME = 'AvoidArc 백업 받아오기'
$script = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\pull-backup.ps1'

if ($Remove) {
  if (Get-ScheduledTask -TaskName $NAME -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $NAME -Confirm:$false
    Write-Host "등록을 해제했습니다." -ForegroundColor Yellow
  } else {
    Write-Host "등록되어 있지 않습니다." -ForegroundColor Yellow
  }
  return
}

if (-not (Test-Path $script)) { throw "$script 를 찾을 수 없습니다." }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

$trigger = New-ScheduledTaskTrigger -Daily -At $At

# 컴퓨터가 꺼져 있어 시간을 놓쳤으면 켜진 뒤에 한 번 돈다.
# 이게 없으면 그날 백업은 그냥 건너뛴다.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

if (Get-ScheduledTask -TaskName $NAME -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $NAME -Confirm:$false
}

Register-ScheduledTask -TaskName $NAME -Action $action -Trigger $trigger `
  -Settings $settings -Description 'AvoidArc 서버의 데이터베이스 백업을 매일 내 컴퓨터로 받아온다.' | Out-Null

Write-Host "등록했습니다. 매일 $At 에 돕니다." -ForegroundColor Green
Write-Host "  받는 곳: $HOME\AvoidArc-backups"
Write-Host "  지금 바로 한 번 돌려보려면: Start-ScheduledTask -TaskName '$NAME'"
