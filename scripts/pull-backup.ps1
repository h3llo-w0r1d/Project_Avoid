# 서버의 백업을 내 컴퓨터로 끌어온다.
#
#   .\scripts\pull-backup.ps1
#
# 왜 필요한가
# -----------
# 서버는 매일 새벽 4시에 스스로 백업을 뜬다. 하지만 그 백업은 서버 안에만
# 있다. 디스크가 고장 나면 랭킹·계정·백업이 한꺼번에 사라진다.
# 백업은 원본과 다른 곳에 있어야 백업이다.
#
# 무엇을 하나
# -----------
#   1. 서버에서 제일 최근 백업 파일을 받아온다
#   2. 받은 파일을 실제로 열어 온전한지 확인한다 (안 하면 깨진 걸 모은다)
#   3. 오래된 것은 정리한다
#
# 자동으로 돌게 하려면 register-backup-task.ps1 을 한 번 실행한다.

param(
  [string]$Folder = "$HOME\AvoidArc-backups",
  [int]$Keep = 30
)

$ErrorActionPreference = 'Stop'
$SERVER = 'root@158.247.230.75'
$KEY = "$HOME\.ssh\id_ed25519"
$REMOTE_DIR = '/home/avoidarc/data/backups'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

if (-not (Test-Path $Folder)) { New-Item -ItemType Directory -Path $Folder -Force | Out-Null }

# 서버가 오늘 것을 아직 안 떴을 수도 있다. 받아오기 전에 하나 뜨게 한다.
# 이미 있으면 새로 하나 더 뜰 뿐이라 손해가 없다.
Say "== 서버에서 백업을 뜨는 중 ==" Cyan
$make = 'cd /home/avoidarc/AvoidArc && sudo -u avoidarc env DATA_DIR=/home/avoidarc/data ' +
        '/usr/bin/node --env-file-if-exists=.env scripts/backup.js 2>&1 | grep -v BACKUP_UPLOAD'
ssh -i $KEY $SERVER $make

Say "`n== 제일 최근 것을 받아오는 중 ==" Cyan
$newest = (ssh -i $KEY $SERVER "ls -1 $REMOTE_DIR/*.db | tail -1").Trim()
if (-not $newest) { throw "서버에 백업 파일이 없습니다." }

$name = Split-Path $newest -Leaf
$dest = Join-Path $Folder $name
scp -q -i $KEY "${SERVER}:$newest" $dest
$size = (Get-Item $dest).Length
Say ("  받음: {0} ({1:N1}KB)" -f $name, ($size / 1KB))

# 받은 파일이 온전한지 실제로 열어 본다.
# 이걸 안 하면 깨진 파일을 30일치 모아 두고 안심하게 된다.
Say "`n== 받은 파일 확인 ==" Cyan
$check = @'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const ok = db.prepare("PRAGMA integrity_check").get().integrity_check;
const rows = {};
for (const t of ["users", "scores", "matches", "hall"]) {
  rows[t] = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
}
console.log("  무결성: " + ok);
console.log("  " + Object.entries(rows).map(([k, v]) => `${k} ${v}행`).join(" · "));
if (ok !== "ok") process.exit(1);
'@
$checkFile = Join-Path $env:TEMP 'avoidarc-verify.mjs'
Set-Content -Path $checkFile -Value $check -Encoding utf8
node $checkFile $dest
if ($LASTEXITCODE -ne 0) {
  Remove-Item $dest -Force
  throw "받은 백업이 깨져 있어 지웠습니다."
}
Remove-Item $checkFile -Force

# 오래된 것 정리. 이름이 곧 시간순이라 이름으로 줄을 세우면 된다.
$all = Get-ChildItem $Folder -Filter 'avoidarc-*.db' | Sort-Object Name
if ($all.Count -gt $Keep) {
  $old = $all | Select-Object -First ($all.Count - $Keep)
  $old | Remove-Item -Force
  Say "`n  오래된 백업 $($old.Count)개 정리"
}

$total = (Get-ChildItem $Folder -Filter 'avoidarc-*.db' | Measure-Object -Property Length -Sum)
Say ("`n끝났습니다. {0} 에 {1}개 ({2:N1}MB)" -f $Folder, $total.Count, ($total.Sum / 1MB)) Green
