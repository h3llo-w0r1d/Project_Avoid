# 고친 것을 사이트에 올린다.
#
#   .\scripts\deploy.ps1 "무엇을 고쳤는지"
#
# 하는 일: 커밋 -> 깃헙에 올리기 -> 서버가 받아가기 -> 필요하면 재시작
#
# 글자·모양만 바꿨으면 재시작이 필요 없다. public/ 안의 파일은 서버가
# 매번 디스크에서 읽어 내주기 때문이다. server.js 나 lib/ 를 건드렸을
# 때만 다시 켠다 — 그건 서버가 켜질 때 한 번만 읽는다.

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Message
)

$ErrorActionPreference = 'Stop'
$SERVER = 'root@158.247.230.75'
$KEY = "$HOME\.ssh\id_ed25519"
$REPO = Split-Path $PSScriptRoot -Parent

Set-Location $REPO

$changed = git status --porcelain
if (-not $changed) {
  Write-Host "바뀐 게 없습니다." -ForegroundColor Yellow
  exit 0
}

Write-Host "== 바뀐 파일 ==" -ForegroundColor Cyan
git status --short

# 서버를 다시 켜야 하는지 판단한다. public/ 밖이 바뀌었으면 켠다.
$needRestart = $false
foreach ($line in $changed) {
  $path = $line.Substring(3).Trim('"')
  if ($path -notlike 'public/*' -and $path -notlike 'docs/*' -and $path -ne 'README.md') {
    $needRestart = $true
  }
}

Write-Host "`n== 올리는 중 ==" -ForegroundColor Cyan
git add -A
git commit -q -m $Message
git push -q origin main
Write-Host "  깃헙에 올렸습니다."

$remote = 'cd /home/avoidarc/AvoidArc && sudo -u avoidarc git pull -q origin main'
if ($needRestart) { $remote += ' && systemctl restart avoidarc && sleep 3' }
$remote += ' && echo "  받은 것: $(sudo -u avoidarc git log --oneline -1)"'
$remote += ' && echo "  서비스: $(systemctl is-active avoidarc)"'

Write-Host "`n== 서버에 반영 ==" -ForegroundColor Cyan
if ($needRestart) { Write-Host "  (서버 코드가 바뀌어 재시작합니다)" -ForegroundColor DarkGray }
else { Write-Host "  (화면 파일만 바뀌어 재시작하지 않습니다)" -ForegroundColor DarkGray }
ssh -i $KEY $SERVER $remote

Write-Host "`n== 사이트 확인 ==" -ForegroundColor Cyan
foreach ($p in @('/', '/privacy', '/terms')) {
  $code = curl.exe -s -o NUL -w "%{http_code}" "https://avoidarc.kr$p"
  $mark = if ($code -eq '200') { 'OK' } else { '<- 이상함!' }
  Write-Host ("  {0,-10} HTTP {1}  {2}" -f $p, $code, $mark)
}

Write-Host "`n끝났습니다. https://avoidarc.kr" -ForegroundColor Green
Write-Host "화면이 그대로면 브라우저에서 Ctrl+Shift+R (강력 새로고침)" -ForegroundColor DarkGray
