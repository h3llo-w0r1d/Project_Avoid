// 코인 지갑.
//
// 게임 중 맵에 뜨는 코인을 먹어 모으고, 그 코인으로 캐릭터를 해금한다.
// 시간(버틴 초)으로 여는 해금과는 별개의 트랙이다.
//
// 지금은 브라우저(localStorage)에만 저장한다 — 기기마다 따로 쌓인다.
// 나중에 로그인 계정은 서버에 저장해 기기 간 공유하도록 옮길 자리다.
// (최고기록을 서버 기준으로 맞춘 것과 같은 이유.)

const COINS_KEY = 'avoidarc.coins';
const OWNED_KEY = 'avoidarc.owned';   // 코인으로 산 캐릭터 id 목록
const PLAY_KEY = 'avoidarc.playtime';   // 누적 게임 시간(초). 룰렛 횟수의 원천.
const SPINUSED_KEY = 'avoidarc.spins.used';   // 지금까지 돌린 룰렛 횟수
const SECONDS_PER_SPIN = 80;            // 이만큼 쌓일 때마다 룰렛 1회
// 상점 항목마다 '산 목록' 과 '지금 켠 것' 을 담는 칸.
// 발자국(trail)은 항목을 나누기 전에 쓰던 키를 그대로 둔다 — 키를 바꾸면
// 이미 산 사람의 기록이 통째로 날아간다.
const SHOP_KEYS = {
  trail: { owned: 'avoidarc.owned.fx',   equip: 'avoidarc.equip.fx' },
  arena: { owned: 'avoidarc.owned.arena', equip: 'avoidarc.equip.arena' }
};

function readOwned() {
  try { return new Set(JSON.parse(localStorage.getItem(OWNED_KEY) || '[]')); }
  catch { return new Set(); }
}

export const wallet = {
  // 지금 가진 코인
  coins() {
    return Math.max(0, Math.floor(Number(localStorage.getItem(COINS_KEY)) || 0));
  },

  // 코인을 더한다(먹었을 때). 새 잔액을 돌려준다.
  add(n) {
    const v = this.coins() + Math.max(0, Math.floor(n));
    localStorage.setItem(COINS_KEY, String(v));
    return v;
  },

  // 코인을 쓴다. 모자라면 아무것도 안 하고 false.
  spend(n) {
    n = Math.max(0, Math.floor(n));
    const v = this.coins();
    if (v < n) return false;
    localStorage.setItem(COINS_KEY, String(v - n));
    return true;
  },

  // ── 룰렛(누적 게임 시간으로 돌린다) ──
  // 누적 게임 시간(초). 판이 끝날 때마다 그 판 시간을 더한다.
  playtime() { return Math.max(0, Number(localStorage.getItem(PLAY_KEY)) || 0); },
  addPlaytime(sec) {
    const v = this.playtime() + Math.max(0, Number(sec) || 0);
    localStorage.setItem(PLAY_KEY, String(v));
    return v;
  },
  // 지금까지 돌린 횟수 / 100초당 1회 규칙으로 남은 횟수.
  spinsUsed() { return Math.max(0, Math.floor(Number(localStorage.getItem(SPINUSED_KEY)) || 0)); },
  spinsAvailable() { return Math.max(0, Math.floor(this.playtime() / SECONDS_PER_SPIN) - this.spinsUsed()); },
  // 룰렛에 쓸 수 있는 초(전체 누적에서 이미 돌린 만큼 뺀 잔여 풀). 1회 돌리면 100초 준다.
  spendableSeconds() { return Math.max(0, this.playtime() - this.spinsUsed() * SECONDS_PER_SPIN); },
  useSpin() { localStorage.setItem(SPINUSED_KEY, String(this.spinsUsed() + 1)); },
  secondsPerSpin() { return SECONDS_PER_SPIN; },

  // 코인으로 산 캐릭터인가
  isOwned(id) { return readOwned().has(id); },

  // 코인으로 산 목록에 넣는다(중복은 무시).
  markOwned(id) {
    const s = readOwned();
    s.add(id);
    localStorage.setItem(OWNED_KEY, JSON.stringify([...s]));
  },

  // ── 상점에서 산 꾸미기 ──
  // 항목(발자국·무대…)마다 칸을 따로 쓴다. 한 칸에 섞으면 나중에 id 가 겹칠 때
  // 하나를 산 사람에게 다른 게 딸려 오는 사고가 난다.
  // 항목이 늘면 SHOP_KEYS 에 한 줄만 더하면 된다.
  ownedIn(kind) {
    const k = SHOP_KEYS[kind];
    if (!k) return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(k.owned) || '[]')); }
    catch { return new Set(); }
  },
  isOwnedIn(kind, id) { return this.ownedIn(kind).has(id); },
  markOwnedIn(kind, id) {
    const k = SHOP_KEYS[kind];
    if (!k) return;
    const s = this.ownedIn(kind);
    s.add(id);
    localStorage.setItem(k.owned, JSON.stringify([...s]));
  },

  // 지금 켠 것. 없으면 null. 산 적 없는 걸 켜 두면 무시한다
  // (기기를 옮기거나 저장이 날아가도 없는 걸 켜 둔 상태로 남지 않게).
  equippedIn(kind) {
    const k = SHOP_KEYS[kind];
    if (!k) return null;
    const id = localStorage.getItem(k.equip);
    return id && this.isOwnedIn(kind, id) ? id : null;
  },
  equipIn(kind, id) {
    const k = SHOP_KEYS[kind];
    if (!k) return;
    if (id) localStorage.setItem(k.equip, id);
    else localStorage.removeItem(k.equip);
  }
};
