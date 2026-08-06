# 배포하기 — 서울 VPS + Cloudflare

빈 우분투 서버 한 대를 빌려 직접 세우는 방법이다. 처음이면 두세 시간 잡자.

**서울 리전을 고르는 게 이 문서의 핵심이다.** 1v1 은 서로 밀치는 게임이라
응답 속도가 그대로 손맛이 된다. 서울에서 서울은 왕복 10ms 안팎이고,
도쿄는 35ms, 싱가포르는 90ms 쯤 된다.

---

## 1. 서버 빌리기

월 5~6천원짜리 제일 싼 것으로 충분하다. **사양 때문에 고민할 필요가 없다** —
재 봤더니 대전을 400판 동시에 돌려도 코어 하나의 0.4% 만 쓴다.

| | |
|---|---|
| 지역 | **서울** — 이것만은 양보하면 안 된다 |
| 운영체제 | Ubuntu 22.04 또는 24.04 |
| 사양 | 1 vCPU / 1GB RAM / 25GB 디스크 |

서울 리전이 있는 곳: **Vultr**, **AWS Lightsail**, 네이버 클라우드,
카페24, 가비아. 처음이면 Vultr 나 Lightsail 이 화면이 단순하다.

### 먼저 — 내 컴퓨터에서 SSH 키 만들기

서버를 만들 때 이 키를 등록한다. 비밀번호 로그인보다 안전하고, 서버를
새로 만들 때마다 다시 쓸 수 있다.

윈도우면 PowerShell 을 열고:

```powershell
ssh-keygen -t ed25519 -C "avoidarc"
```

저장 위치를 물으면 그냥 엔터(기본값 `C:\Users\<이름>\.ssh\id_ed25519`).
암호는 비워도 되고, 넣으면 접속할 때마다 물어본다.

**공개키**를 화면에 띄운다. 이걸 통째로 복사해 둔다:

```powershell
Get-Content ~\.ssh\id_ed25519.pub
```

`ssh-ed25519 AAAA...` 로 시작하는 한 줄이다.

> `.pub` 이 붙은 것이 **공개키**이고 남에게 줘도 된다.
> `.pub` 이 없는 것이 **개인키**다. 이건 절대 남에게 주면 안 되고,
> 잃어버리면 서버에 못 들어간다.

### Vultr 로 서버 만들기

1. [vultr.com](https://www.vultr.com) 가입 → 이메일 인증
2. 결제 수단 등록 (해외 결제 되는 카드 또는 PayPal). 본인 확인용으로
   소액이 승인됐다 취소될 수 있다.
3. **Deploy** → **Deploy New Server**
4. 고르는 것:

   | 항목 | 고를 것 |
   |---|---|
   | 종류 | **Cloud Compute — Shared CPU** |
   | 위치 | **Seoul** ← 이것만은 꼭 |
   | 이미지 | **Ubuntu 24.04 LTS x64** |
   | 플랜 | 제일 싼 것 (1 vCPU / 1GB / 25GB) |
   | SSH Keys | **Add New** 눌러 위에서 복사한 공개키 붙여넣기 |
   | Hostname / Label | `avoidarc` 처럼 알아볼 이름 |

5. 나머지 옵션(Auto Backups, DDoS Protection, IPv6 등)은 **일단 다 끈다.**
   Auto Backups 는 돈이 더 든다. 우리는 5번에서 따로 백업한다.
6. **Deploy Now** → 1분쯤 뒤 상태가 `Running` 이 되고 **IP 주소**가 나온다.

접속해 본다. 처음 연결할 때 `Are you sure...` 가 나오면 `yes`:

```powershell
ssh -i ~\.ssh\id_ed25519 root@<서버IP>
```

> Vultr 는 기본 사용자가 `root` 다. 안내문의 다른 곳에 나오는 `ubuntu`
> 대신 `root` 로 접속하면 되고, `sudo` 는 붙이지 않아도 된다(붙여도 된다).

**안 쓸 때는 "정지"가 아니라 "삭제(Destroy)"** 해야 요금이 멈춘다.
꺼두기만 하면 디스크와 IP 를 계속 잡고 있어서 과금이 이어진다.

> **Oracle Cloud 무료를 쓰려면?** 서버 받는 방법만 다르고 2번부터는 똑같다.
> 서울 리전 무료 ARM 서버는 자리가 거의 없어서(`Out of host capacity`)
> 며칠 기다려야 할 수 있고, 오래 놀고 있으면 회수될 수 있다.
> 이 게임은 CPU 를 0.4% 밖에 안 써서 회수 기준에 걸리기 쉽다.

**방화벽을 연다.** VPS 는 보통 관리 화면에도 방화벽이 있다. 거기서 22, 80,
443 을 열고, 서버 안에서도:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable
```

---

## 2. 서버 세팅

```bash
ssh -i <개인키> ubuntu@<서버IP>       # 제공자에 따라 root 나 다른 이름일 수 있다

# Node 22 이상이 필요하다. node:sqlite 가 22 부터 들어왔다.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt update && sudo apt install -y nodejs nginx git
node -v          # v22 이상인지 확인

# 게임 전용 사용자. 서버가 뚫려도 피해를 좁힌다.
sudo useradd -m -s /bin/bash avoidarc
sudo -u avoidarc mkdir -p /home/avoidarc/data

# 코드 받기
sudo -u avoidarc git clone <저장소 주소> /home/avoidarc/AvoidArc
cd /home/avoidarc/AvoidArc
sudo -u avoidarc npm install --omit=dev
```

**설정 파일을 만든다.** 이 파일은 저장소에 없다 — 열쇠가 들어가기 때문이다.

```bash
sudo -u avoidarc nano /home/avoidarc/AvoidArc/.env
```

```
BASE_URL=https://avoidarc.kr
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ADMIN_TOKEN=<길고 무작위한 값>
ADMIN_NICKNAMES=admin
```

**서비스로 등록한다.** 재부팅되거나 게임이 죽어도 알아서 살아난다.

```bash
sudo cp deploy/avoidarc.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now avoidarc
sudo systemctl status avoidarc        # active (running) 인지
```

**nginx 를 붙인다.**

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/avoidarc
sudo nano /etc/nginx/sites-available/avoidarc     # 도메인 이름을 바꾼다
sudo ln -s /etc/nginx/sites-available/avoidarc /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## 3. 도메인과 Cloudflare

도메인을 사고(`.kr` 은 가비아·후이즈 등), [Cloudflare](https://cloudflare.com)
에 무료로 등록한 뒤 등록기관에서 네임서버를 Cloudflare 것으로 바꾼다.

Cloudflare DNS 에 A 레코드를 추가한다:

| 종류 | 이름 | 값 | 프록시 |
|---|---|---|---|
| A | `@` | 서버 IP | 켬 (주황 구름) |
| A | `www` | 서버 IP | 켬 |

**프록시를 켜면 HTTPS 가 공짜로 붙는다.** SSL/TLS 모드는 `Full` 로 둔다.

> **서버를 옮길 때는 이 IP 만 바꾸면 된다.** 도메인으로 운영하는 진짜
> 이유가 이것이다 — 구글 로그인 설정을 다시 안 해도 된다.

---

## 4. 구글 로그인 열기

[구글 클라우드 콘솔](https://console.cloud.google.com) 에서:

1. **승인된 리디렉션 URI** 에 `https://avoidarc.kr/auth/google/callback` 추가
2. **승인된 도메인** 에 `avoidarc.kr` 추가
3. **테스트 → 프로덕션으로 게시** — 이걸 해야 아무나 로그인할 수 있다

이 게임은 `openid` 만 요청한다(이메일도 안 받는다). 민감한 권한이 아니라
검수 없이 바로 게시된다. 다만 **개인정보처리방침 URL 은 입력하라고 한다.**

---

## 5. 백업

VPS 는 회수되지 않지만, 디스크가 고장 나거나 실수로 지우는 일은 있다.
랭킹과 계정이 통째로 날아가면 되돌릴 방법이 없다.

`rclone` 으로 구글 드라이브에 올리는 방법:

```bash
sudo -u avoidarc bash
curl https://rclone.org/install.sh | sudo bash
rclone config          # gdrive 라는 이름으로 구글 드라이브 연결
```

`.env` 에 한 줄 추가:

```
BACKUP_UPLOAD=rclone copy {file} gdrive:avoidarc-backup
```

**매일 새벽 4시에 돌게 한다:**

```bash
sudo -u avoidarc crontab -e
```
```
0 4 * * * cd /home/avoidarc/AvoidArc && DATA_DIR=/home/avoidarc/data /usr/bin/node --env-file-if-exists=.env scripts/backup.js >> /home/avoidarc/backup.log 2>&1
```

**한 번은 직접 돌려서 확인한다.** 자동으로 돌 때까지 기다렸다가 안 되면 늦다.

```bash
cd /home/avoidarc/AvoidArc
DATA_DIR=/home/avoidarc/data node --env-file-if-exists=.env scripts/backup.js
```

`백업: ... (NNkKB)` 와 `내보냄: rclone` 이 둘 다 나와야 한다.
`BACKUP_UPLOAD 가 없어...` 경고가 나오면 서버 안에만 남은 것이다.

백업은 **서버를 멈추지 않아도** 안전하게 떠진다 (`VACUUM INTO`).
파일을 그냥 복사하면 안 된다 — 최근 기록이 아직 `-wal` 에 있어서 잃는다.

---

## 6. 되돌리기 연습

**백업은 되살려 봐야 백업이다.** 한 번 해 두면 진짜 사고가 났을 때
당황하지 않는다.

```bash
# 내 컴퓨터에서
rclone copy gdrive:avoidarc-backup/avoidarc-YYYYMMDD-HHMMSS-mmm.db .
node -e "const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync(process.argv[1],{readOnly:true});
  console.log(db.prepare('SELECT COUNT(*) c FROM scores').get());" avoidarc-*.db
```

---

## 서버를 옮길 때

15분이면 된다.

1. 새 서버에서 **2번**을 그대로 반복
2. 백업 파일을 `/home/avoidarc/data/avoidarc.db` 로 복사
3. Cloudflare 의 A 레코드 IP 만 새 서버로 변경

**구글 로그인 설정은 건드리지 않는다.** 도메인이 그대로이기 때문이다.

---

## 확인 목록

- [ ] `https://avoidarc.kr` 이 열린다
- [ ] 구글 로그인이 된다
- [ ] **온라인 1v1 이 붙는다** — WebSocket 이 막히면 여기서만 티가 난다.
      게임은 멀쩡히 뜨는데 매칭에서 멈춰서 원인을 찾기 어렵다.
- [ ] 관리자 계정으로 들어가면 🛠 버튼이 보인다
- [ ] 다른 계정으로는 안 보인다
- [ ] 백업이 구글 드라이브에 올라와 있다
- [ ] 서버를 재부팅해도 게임이 저절로 뜬다 (`sudo reboot` 후 확인)
