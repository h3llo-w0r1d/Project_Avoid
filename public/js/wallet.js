// 코인 지갑.
//
// 게임 중 맵에 뜨는 코인을 먹어 모으고, 그 코인으로 캐릭터를 해금한다.
// 시간(버틴 초)으로 여는 해금과는 별개의 트랙이다.
//
// 로그인한 계정은 서버에도 같이 둔다. 브라우저에만 두면 같은 계정이라도
// 기기를 바꿨을 때 코인과 산 것들이 안 따라온다("폰으로 들어오니 캐릭터가
// 사라져요" 제보).
//
// 다만 localStorage 를 버리지는 않는다. 게임 곳곳이 지갑을 '기다리지 않고'
// 바로 읽어 가므로(canUnlock, 코인 표시 등) 동기적으로 답할 수 있어야 한다.
// 그래서 localStorage 를 손에 든 사본으로 쓰고, 서버와 맞춰 준다:
//   로그인할 때  — 이 기기 것을 계정에 합치고(한 번만), 그 결과를 사본에 쓴다
//   값이 바뀔 때  — 잠깐 모았다가 계정에 통째로 올린다
// 사본을 지우지 않는 건 안전장치이기도 하다. 서버 쪽이 잘못돼도 원본이 남는다.

const COINS_KEY = 'avoidarc.coins';
const OWNED_KEY = 'avoidarc.owned';   // 코인으로 산 캐릭터 id 목록
// 이 기기 지갑을 어느 계정에 합쳤는지. 한 번만 합치려고 남긴다 —
// 두 번 합치면 코인이 부푼다.
const MERGED_KEY = (userId) => `avoidarc.merged.${userId}`;
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

// ── 서버와 맞추기 ────────────────────────────────────────
let account = null;      // 로그인한 계정 id (없으면 게스트)
let api = null;          // { getWallet, saveWallet, mergeWallet }
let pushTimer = null;

// 지갑 전체를 한 덩어리로. 서버와 주고받는 모양이다.
function snapshot() {
  return {
    coins: wallet.coins(),
    owned: [...readOwned()],
    ownedFx: [...wallet.ownedIn('trail')],
    ownedArena: [...wallet.ownedIn('arena')],
    playtime: wallet.playtime(),
    spinsUsed: wallet.spinsUsed()
  };
}

// 서버가 준 지갑을 손에 든 사본에 적는다.
function apply(w) {
  if (!w) return;
  localStorage.setItem(COINS_KEY, String(Math.max(0, Math.floor(w.coins ?? 0))));
  localStorage.setItem(OWNED_KEY, JSON.stringify(w.owned ?? []));
  localStorage.setItem(SHOP_KEYS.trail.owned, JSON.stringify(w.ownedFx ?? []));
  localStorage.setItem(SHOP_KEYS.arena.owned, JSON.stringify(w.ownedArena ?? []));
  localStorage.setItem(PLAY_KEY, String(Math.max(0, Number(w.playtime) || 0)));
  localStorage.setItem(SPINUSED_KEY, String(Math.max(0, Math.floor(w.spinsUsed ?? 0))));
}

// 바뀔 때마다 곧장 올리면 룰렛 한 번에 여러 번 오간다. 잠깐 모아서 한 번에.
function schedulePush() {
  if (!account || !api) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    api.saveWallet(snapshot()).catch(() => { /* 실패해도 사본은 그대로 — 다음에 다시 올라간다 */ });
  }, 700);
}

export const wallet = {
  // 로그인/로그아웃이 정해지면 부른다. 게스트면 userId 를 비운다.
  async attach(userId, hooks) {
    account = userId ?? null;
    api = hooks ?? null;
    if (!account || !api) return;
    try {
      const mark = MERGED_KEY(account);
      if (localStorage.getItem(mark)) {
        // 이미 합친 기기 — 계정 것을 받아 사본을 맞춘다
        apply(await api.getWallet());
      } else {
        // 처음 로그인한 기기 — 여기 있던 걸 계정에 합친다(더하기·합집합)
        apply(await api.mergeWallet(snapshot()));
        localStorage.setItem(mark, String(Date.now()));
      }
    } catch { /* 서버가 안 되면 사본을 그대로 쓴다 */ }
  },

  // 지금 가진 코인
  coins() {
    return Math.max(0, Math.floor(Number(localStorage.getItem(COINS_KEY)) || 0));
  },

  // 코인을 더한다(먹었을 때). 새 잔액을 돌려준다.
  add(n) {
    const v = this.coins() + Math.max(0, Math.floor(n));
    localStorage.setItem(COINS_KEY, String(v));
    schedulePush();
    return v;
  },

  // 코인을 쓴다. 모자라면 아무것도 안 하고 false.
  spend(n) {
    n = Math.max(0, Math.floor(n));
    const v = this.coins();
    if (v < n) return false;
    localStorage.setItem(COINS_KEY, String(v - n));
    schedulePush();
    return true;
  },

  // ── 룰렛(누적 게임 시간으로 돌린다) ──
  // 누적 게임 시간(초). 판이 끝날 때마다 그 판 시간을 더한다.
  playtime() { return Math.max(0, Number(localStorage.getItem(PLAY_KEY)) || 0); },
  addPlaytime(sec) {
    const v = this.playtime() + Math.max(0, Number(sec) || 0);
    localStorage.setItem(PLAY_KEY, String(v));
    schedulePush();
    return v;
  },
  // 지금까지 돌린 횟수 / 100초당 1회 규칙으로 남은 횟수.
  spinsUsed() { return Math.max(0, Math.floor(Number(localStorage.getItem(SPINUSED_KEY)) || 0)); },
  spinsAvailable() { return Math.max(0, Math.floor(this.playtime() / SECONDS_PER_SPIN) - this.spinsUsed()); },
  // 룰렛에 쓸 수 있는 초(전체 누적에서 이미 돌린 만큼 뺀 잔여 풀). 1회 돌리면 100초 준다.
  spendableSeconds() { return Math.max(0, this.playtime() - this.spinsUsed() * SECONDS_PER_SPIN); },
  useSpin() { localStorage.setItem(SPINUSED_KEY, String(this.spinsUsed() + 1)); schedulePush(); },
  secondsPerSpin() { return SECONDS_PER_SPIN; },

  // 코인으로 산 캐릭터인가
  isOwned(id) { return readOwned().has(id); },

  // 코인으로 산 목록에 넣는다(중복은 무시).
  markOwned(id) {
    const s = readOwned();
    s.add(id);
    localStorage.setItem(OWNED_KEY, JSON.stringify([...s]));
    schedulePush();
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
    schedulePush();
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
