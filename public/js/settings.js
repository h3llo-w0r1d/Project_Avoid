// 게임 설정. 값을 보관하고 바뀌면 알려 주는 일만 한다 —
// 창을 그리는 건 settings-ui.js, 값을 실제로 쓰는 건 audio·input 쪽이다.
//
// 전부 이 브라우저에만 저장한다(localStorage). 계정을 따라다니지 않는 건
// 조작 취향이 기기마다 다르기 때문이다 — PC 에서 정한 점프 키를 폰에
// 옮겨 봐야 쓸 데가 없다.
//
// 사용자가 넣은 배경음악 파일만 예외로 IndexedDB 에 둔다. 몇 MB 라
// localStorage 에 안 들어간다(따옴표로 감싼 글자만 저장되고 보통 5MB 가 한계).

const KEY = 'avoidarc.settings';

// 소리 크기는 0~1. 배경음이 기본으로 작은 건 반복 재생이라 금세 거슬려서다.
export const DEFAULTS = {
  musicVolume: 0.4,
  sfxVolume: 0.8,
  // 배경음은 켜짐 여부와 어느 곡이냐를 따로 둔다. 하나로 묶으면
  // '내 음악을 넣어 둔 채 잠깐 끄기' 가 안 된다 — 껐다 켜면 기본 곡으로
  // 돌아가 버린다.
  musicOn: true,
  musicSource: 'default',    // 'default' | 'custom'
  jumpKeys: ['Space'],       // 점프 키 하나. 설정에서 바꿀 수 있다.
  lowEffects: false          // 화면 효과 줄이기
};

// 설정 창이 생기기 전에 쓰던 🔊 음소거. 그 버튼은 없어졌는데 값은 남아
// 있어서, 껐던 사람은 설정에서 무엇을 켜도 소리가 안 났다.
// 여기서 한 번 새 설정으로 옮기고 지운다.
const OLD_MUTE = 'avoidarc.muted';
function takeOldMute() {
  try {
    const was = localStorage.getItem(OLD_MUTE) === '1';
    localStorage.removeItem(OLD_MUTE);
    return was;
  } catch { return false; }
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    // 설정을 한 번도 안 만져 본 사람만 옛 음소거를 물려받는다. 이미
    // 설정에서 무언가 정한 사람은 그 선택이 우선이다.
    const oldMute = takeOldMute();
    if (!raw) {
      return oldMute
        ? { ...DEFAULTS, musicOn: false, sfxVolume: 0 }
        : { ...DEFAULTS };
    }
    const v = JSON.parse(raw);
    // 저장해 둔 것과 기본값을 합친다. 나중에 항목이 늘어도 옛 저장본이
    // 그대로 살아난다 — 없는 값만 기본으로 채워진다.
    // 옛 저장본(musicPick 하나로 쓰던 것)을 새 두 값으로 옮긴다.
    if (v.musicPick && v.musicOn === undefined) {
      v.musicOn = v.musicPick !== 'off';
      v.musicSource = v.musicPick === 'custom' ? 'custom' : 'default';
      delete v.musicPick;
    }
    return {
      ...DEFAULTS,
      ...v,
      // 점프는 하나만 쓴다. 여러 개를 저장해 둔 옛 값은 첫 번째만 살린다.
      jumpKeys: Array.isArray(v.jumpKeys) && v.jumpKeys.length
        ? [String(v.jumpKeys[0])] : [...DEFAULTS.jumpKeys]
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = read();
const listeners = new Set();

export const settings = {
  get all() { return { ...current }; },
  get(k) { return current[k]; },

  // 하나를 바꾸고 저장한 뒤 알린다. 같은 값이면 아무 일도 안 한다 —
  // 슬라이더를 끄는 동안 매 픽셀마다 저장하는 걸 막는다.
  set(k, v) {
    if (current[k] === v) return;
    current[k] = v;
    this.save();
    for (const fn of listeners) fn(k, v, this.all);
  },

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* 막혔으면 이번 판만 */ }
  },

  reset() {
    current = { ...DEFAULTS };
    this.save();
    for (const fn of listeners) fn(null, null, this.all);
  },

  // 값이 바뀔 때마다 부른다. 떼는 함수를 돌려준다.
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
};

// ── 사용자가 넣은 배경음악 ────────────────────────────────────────
// 녹음(voice-store.js)과 같은 방식이다. 파일이 몇 MB 라 localStorage 로는
// 안 되고, 서버로도 안 보낸다 — 남의 음악을 우리 서버에 쌓아 둘 이유가 없다.
const DB_NAME = 'avoidarc.music';
const STORE = 'files';

function withStore(mode, work) {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onerror = () => resolve(null);          // 비공개 탭 등 — 조용히 포기
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE, mode);
      const out = work(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(out?.result ?? null); };
      tx.onerror = () => { db.close(); resolve(null); };
    };
  });
}

export const musicStore = {
  save(blob, name) { return withStore('readwrite', (s) => { s.put({ blob, name }, 'music'); }); },
  load() { return withStore('readonly', (s) => s.get('music')); },
  clear() { return withStore('readwrite', (s) => { s.delete('music'); }); }
};
