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

  // 코인으로 산 캐릭터인가
  isOwned(id) { return readOwned().has(id); },

  // 코인으로 산 목록에 넣는다(중복은 무시).
  markOwned(id) {
    const s = readOwned();
    s.add(id);
    localStorage.setItem(OWNED_KEY, JSON.stringify([...s]));
  }
};
