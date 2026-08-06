// 유저가 녹음한 캐릭터 목소리를 브라우저에 보관한다.
//
// localStorage 를 쓰지 않는다. 소리는 이진 데이터라 문자열로 바꾸면 크기가
// 1.4 배로 부풀고, localStorage 한도(보통 5MB)를 캐릭터 몇 개로 채운다.
// IndexedDB 는 Blob 을 그대로 넣을 수 있고 한도도 훨씬 넉넉하다.
//
// 저장 위치가 브라우저라 기기를 옮기면 따라오지 않는다.

const DB_NAME = 'avoidarc';
const STORE = 'voices';
const VERSION = 1;

let opening = null;

function openDb() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('이 브라우저는 IndexedDB 를 지원하지 않습니다.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 를 열지 못했습니다.'));
  });
  return opening;
}

function run(mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

// record = { blob, at }
//   blob — 녹음한 원본. 다듬기는 불러올 때 한다. 원본을 남겨 둬야
//          나중에 다듬는 방식을 바꿔도 다시 녹음할 필요가 없다.
const KEY = 'jump';   // 점프 소리 하나만 둔다

export const voiceStore = {
  async save(blob) {
    await run('readwrite', (s) => s.put({ blob, at: Date.now() }, KEY));
  },

  async load() {
    return run('readonly', (s) => s.get(KEY));
  },

  async remove() {
    await run('readwrite', (s) => s.delete(KEY));
  },

  // 저장소를 아예 못 쓰는 환경(사파리 비공개 탭 등)인지 미리 알아본다
  async available() {
    try {
      await openDb();
      return true;
    } catch {
      return false;
    }
  }
};
