import * as THREE from 'three';
import { createWorld, fitCamera } from './scene.js';
import { startOrientationManager } from './orientation.js';
import { Player } from './player.js';
import { Hazards } from './hazards.js';
import { FloorHoles } from './floor-holes.js';
import { Coins } from './coins.js';
import { wallet } from './wallet.js';
import { PATCH_NOTES } from './patch-notes.js';
import { Input } from './input.js';
import { UI, api } from './ui.js';
import { VersusUI } from './versus-ui.js';
import { PauseUI } from './pause-ui.js';
import { Auth } from './auth.js';
import { CharacterUI } from './char-ui.js';
import { ProfileUI } from './profile-ui.js';
import { BoardUI } from './board-ui.js';
import { VoiceUI } from './voice-ui.js';
import { DEFAULT_CHARACTER, findCharacter, isUnlocked, isPlayable, isCoinChar, PLAYABLE } from './characters.js';
import { Net } from './net.js';
import { Audio } from './audio.js';
import { voiceStore } from './voice-store.js';
import { ARENA_RADIUS, VOICE, PLAYER } from './config.js';

// 하드코어 모드 난이도. 1) 1단 점프만 2) 예열 25% 단축 3) 빔 20% 빠름
// 6) 동시 전기선 +1·가로볼리 +1. (무대 축소·시야 제한 등은 나중에 추가)
const HARDCORE_MODS = { warnMul: 0.75, speedMul: 1.2, maxLiveAdd: 1, volleyAdd: 1 };
const HARDCORE_BEST_KEY = 'voltline.best.hardcore';
function hardcoreBest() { return Number(localStorage.getItem(HARDCORE_BEST_KEY)) || 0; }

const canvas = document.getElementById('stage');
const world = createWorld(canvas);
const { renderer, scene, camera } = world;

// 고른 캐릭터는 브라우저에 저장한다. 해금 여부는 최고 기록으로 판단하므로
// 저장할 필요가 없다 — 기록만 있으면 언제든 다시 계산된다.
const CHAR_KEY = 'avoidarc.character';

function savedCharacter() {
  const id = localStorage.getItem(CHAR_KEY) ?? DEFAULT_CHARACTER;
  const spec = findCharacter(id);
  if (!isPlayable(spec)) return DEFAULT_CHARACTER;   // 다듬는 중으로 내려간 캐릭터
  // 한 번 고른 건 나갔다 와도 유지한다. 기본 캐릭터, 코인으로 산 캐릭터,
  // 또는 시간(기록)으로 열린 캐릭터면 그대로 둔다. (로그인 게이팅은 auth 가
  // 정해진 뒤 syncCharacterForAuth 가 다시 맞춘다.) 아니면 기본으로.
  if (spec.unlockAt === 0 || wallet.isOwned(spec.id) || isUnlocked(spec, bestSeconds())) {
    return spec.id;
  }
  return DEFAULT_CHARACTER;
}

// 캐릭터 해금 기준. 일반·하드코어 중 더 오래 버틴 기록을 쓴다(하드코어로
// 세운 기록도 해금에 쳐준다 — 더 어려운데 안 쳐주면 억울하니까).
function bestSeconds() {
  return Math.max(
    Number(localStorage.getItem('voltline.best')) || 0,
    hardcoreBest()
  );
}

// 캐릭터를 실제로 쓸 수 있는가. 해금 조건(기록)을 넘어, 로그인까지 봐야 한다.
// 게스트는 기본 캐릭터만 쓸 수 있다 — 해금은 로그인의 특전으로 남겨,
// 로그인할 이유를 만든다. (auth 는 아래에서 선언되지만 이 함수는 실행 시점에
// 만 불리므로 참조에 문제가 없다.)
function canUnlock(spec) {
  if (!spec) return false;
  if (isAdmin) return true;                     // 관리자는 전부 해금(기록이 집계 제외라 0으로 잡힘)
  if (spec.unlockAt === 0) return true;         // 기본 캐릭터는 누구나
  if (isCoinChar(spec)) return wallet.isOwned(spec.id);  // 코인 캐릭터는 산 적 있으면
  return auth.signedIn && isUnlocked(spec, bestSeconds());
}

// 코인으로 캐릭터를 산다. 코인이 모자라거나 코인 캐릭터가 아니면 false.
// 성공하면 소유 목록에 넣고 코인을 깎는다.
function buyCharacter(spec) {
  if (!spec || !isCoinChar(spec) || wallet.isOwned(spec.id)) return false;
  if (!wallet.spend(spec.coinCost)) return false;
  wallet.markOwned(spec.id);
  renderCoinHud();
  // 관리자 참고용으로 서버에 '누가 뭘 샀다' 를 남긴다(코인 처리 자체는 로컬).
  api.recordPurchase(spec.id, spec.name, spec.coinCost, auth.signedIn ? undefined : auth.displayName);
  return true;
}

// 로그인 상태가 바뀌면(로그아웃/게스트 전환) 지금 쓰는 캐릭터가 아직 유효한지
// 다시 본다. 게스트가 되며 못 쓰게 된 캐릭터는 기본으로 되돌린다.
function syncCharacterForAuth() {
  if (!canUnlock(findCharacter(player.characterId))) {
    localStorage.setItem(CHAR_KEY, DEFAULT_CHARACTER);
    player.setCharacter(DEFAULT_CHARACTER);
    characters.paintButton(DEFAULT_CHARACTER);
    net.send({ type: 'character', id: DEFAULT_CHARACTER });
  }
  if (characters.open$) characters.draw();
}

// 로그인 상태가 정해질 때 부르는 훅. 계정이면 서버 기록을 정답으로 삼아
// 로컬 최고기록을 맞춘 뒤(한 계정당 한 번), 캐릭터 해금을 다시 맞춘다.
// 남의 기기에서 대신 플레이해 부풀려진 로컬값을 서버 기준으로 되돌린다.
let syncedBestFor = null;
async function onAuthChange() {
  // 관리자 여부를 먼저 확정한다. 관리자는 기록이 집계에서 빠져 서버 최고가
  // 0 이라, 동기화하면 로컬 기록·해금이 다 지워진다 — 그래서 건너뛴다.
  const admin = await adminReady.catch(() => false);
  if (!auth.signedIn) { syncedBestFor = null; }
  else if (!admin && syncedBestFor !== auth.displayName) {
    syncedBestFor = auth.displayName;
    try {
      const p = await api.profile(auth.displayName);
      ui.setBest(p.best ? p.best.time : 0, p.hardcore ? p.hardcore.time : 0);
    } catch { /* 못 불러오면 로컬 유지 */ }
  }
  syncCharacterForAuth();
}

const player = new Player(scene, { characterId: savedCharacter() });
// 상대는 발밑 링 색으로 구분한다. 캐릭터는 상대가 고른 걸 그대로 보여 준다.
const rival = new Player(scene, { haloColor: 0xc07dff });
rival.mesh.visible = false;
rival.blob.visible = false;
rival.halo.visible = false;

const hazards = new Hazards(scene);
const floorHoles = new FloorHoles(scene);   // 하드코어: 바닥이 사라졌다 나타난다
// 이번 판에 먹은 코인 수. 판 중엔 지갑에 바로 넣지 않고 여기 모아 뒀다가,
// 판이 끝날 때 정산한다(10초 넘게 버텨야 인정 — 먹고 바로 죽는 악용 방지).
// startGame 에서 0으로.
let runCoins = 0;
// 맵의 코인. 먹으면 소리·사라짐 효과만 주고, 실제 적립은 finishGame 에서.
const coins = new Coins(scene, () => {
  runCoins++;
  audio.coin?.();
});
const input = new Input();
const net = new Net();

// 관리자(개발자) 여부. 아래 api.amIAdmin() 로 확정되며, canUnlock·코인표시 등
// 여러 곳에서 본다. 초기 렌더보다 먼저 선언해 둔다(TDZ 방지).
let isAdmin = false;

// 우측 상단(소리 버튼 왼쪽)에 늘 떠 있는 코인 개수. 먹거나 살 때 갱신한다.
// 관리자(개발자)는 코인이 무한이라 ∞ 로 보여 준다.
const coinHudEl = document.getElementById('coin-count');
function renderCoinHud() {
  if (coinHudEl) coinHudEl.textContent = isAdmin ? '∞' : String(wallet.coins());
}
renderCoinHud();   // 처음 켤 때 지금까지 모은 코인을 바로 보여 준다

const state = {
  mode: 'solo',     // solo | versus
  phase: 'title',   // title | countdown | playing | dying | over
  elapsed: 0,
  deathTimer: 0,
  cause: 'zap',
  paused: false,
  // 대전용
  serverTime: 0,        // 서버가 마지막으로 알려 준 경과 시간
  serverAt: 0,          // 그걸 받은 순간(로컬 시계)
  rivalName: '상대',
  rivalAlive: true,
  myAlive: true
};

const audio = new Audio();

const ui = new UI({
  onStart: startGame,
  onToggleMute: () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    return audio.muted;
  },
  isMuted: () => audio.muted,
  onEscape: togglePause,
  onHome: goHome
});

const auth = new Auth({
  // 닉네임 정하는 화면이 뜨는 동안은 타이틀을 가린다
  onSetupOpen: () => { ui.hideAllScreens(); renderNotice(); },
  onSetupDone: () => { ui.showTitle(); renderNotice(); },
  // 로그인 상태가 정해지거나 바뀔 때: 서버 기록으로 로컬을 맞추고 해금 재정렬
  onChange: () => onAuthChange()
});

const pause = new PauseUI({
  onResume: () => setPaused(false),
  onRestart: () => {
    setPaused(false);
    if (state.mode === 'versus') leaveVersus();
    else startGame();
  },
  onHome: () => {
    setPaused(false);
    goHome();
  }
});

// 랭킹 창을 열거나 탭을 바꿀 때마다 최신 목록을 받아 온다
ui.onRankOpen = (kind) => refreshLeaderboard(kind);

// 프로필. 랭킹에서 이름을 누르거나 상단 바의 사람 버튼으로 연다.
const profile = new ProfileUI();

async function showProfile(name) {
  if (!name) return;
  profile.loading(name);
  try {
    profile.draw(await api.profile(name));
  } catch {
    profile.error('프로필을 불러오지 못했습니다');
  }
}

ui.onName = (name) => showProfile(name);
profile.openMine = () => {
  // 게스트는 계정이 없어 이름을 못 바꾼다. 그때는 버튼도 안 만든다.
  profile.me = auth.signedIn ? auth.displayName : null;
  return showProfile(auth.displayName);
};
profile.onRename = async (name) => {
  await auth.putNickname(name);
  // 이름이 바뀌었으니 랭킹도 다시 받는다. 안 그러면 옛 이름이 남는다.
  refreshLeaderboard();
};

// 관리는 별도 페이지 /admin 하나로 한다. 게임 안 관리 창은 없앴다.
// 여기서는 게시판에서 관리자에게만 삭제 버튼을 보여 줄지 정하는 데만 쓴다.
// (실제 삭제는 서버가 막는다.) isAdmin 은 위에서 선언했다.
// 관리자 확인은 한 번만 하고 그 결과(약속)를 재사용한다. onAuthChange 가
// 서버 기록 동기화 전에 관리자 여부를 기다리는 데도 쓴다.
const adminReady = api.amIAdmin()
  .then((yes) => {
    isAdmin = yes;
    if (yes) {
      setupNoticeAdmin();
      patch.enableAdmin();   // 패치노트 편집 버튼(✏️) 켜기
      renderCoinHud();       // 코인 표시를 ∞ 로
      // 관리자로 확정되면 전부 해금 상태로 화면을 다시 맞춘다.
      syncCharacterForAuth();
    }
    return yes;
  })
  .catch(() => { isAdmin = false; return false; });

// ── 공지 ────────────────────────────────────────────────
// 관리자가 쓴 한 줄 공지를 타이틀 상단 배너에 띄운다.
let noticeText = '';
const noticeBanner = document.getElementById('notice-banner');

function renderNotice() {
  // 첫 화면에 머무를 때만 띄운다. 두 조건을 모두 본다:
  //  - phase 가 title (혼자하기·대전을 시작하면 playing/countdown 으로 바뀐다)
  //  - title-screen 이 실제로 화면에 떠 있음 (1v1 매치메이킹은 phase 는 아직
  //    title 이지만 화면은 대전 메뉴라, 이 조건이 있어야 배너가 안 남는다)
  const titleScreen = document.getElementById('title-screen');
  const titleShown = titleScreen && !titleScreen.classList.contains('hidden');
  const show = noticeText && state.phase === 'title' && titleShown;
  if (noticeBanner) {
    noticeBanner.textContent = noticeText;
    noticeBanner.classList.toggle('hidden', !show);
  }
}

api.notice().then((t) => { noticeText = t; renderNotice(); }).catch(() => {});
// 새로고침 없이도 바뀐 공지가 반영되게 10초마다 다시 받아온다. 응답은
// 서버가 들고 있는 문자열 한 줄이라 가볍다. 바뀐 게 있을 때만 다시 그린다.
setInterval(() => {
  api.notice().then((t) => {
    if (t !== noticeText) { noticeText = t; renderNotice(); }
  }).catch(() => {});
}, 10_000);

// 관리자에게만 상단바 📢 버튼과 공지 편집 창을 켜 준다.
function setupNoticeAdmin() {
  const btn = document.getElementById('notice-btn');
  const modal = document.getElementById('notice-modal');
  const input = document.getElementById('notice-input');
  const count = document.getElementById('notice-count');
  const errEl = document.getElementById('notice-error');
  if (!btn || !modal) return;

  btn.classList.remove('hidden');
  const close = () => modal.classList.add('hidden');
  const open = () => {
    input.value = noticeText;
    count.textContent = `${input.value.length} / 200`;
    errEl.textContent = '';
    modal.classList.remove('hidden');
    input.focus();
  };
  const save = async (text) => {
    try {
      noticeText = await api.saveNotice(text);
      renderNotice();
      close();
    } catch (e) {
      errEl.textContent = e.message;
    }
  };

  btn.addEventListener('click', open);
  document.getElementById('notice-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  input.addEventListener('input', () => { count.textContent = `${input.value.length} / 200`; });
  document.getElementById('notice-save').addEventListener('click', () => save(input.value));
  document.getElementById('notice-clear').addEventListener('click', () => save(''));
}

// 자유 게시판. 게스트는 이름을 같이 보내고, 로그인했으면 서버가 계정 닉네임을 쓴다.
const board = new BoardUI({
  list: () => api.boardList(),
  post: (body, parentId) => api.boardPost(body, auth.signedIn ? undefined : auth.displayName, parentId),
  remove: (id) => api.boardRemove(id),
  isAdmin: () => isAdmin
});

// 왼쪽 메뉴 버튼은 상단바의 진짜 버튼(숨김)을 대신 눌러 준다. 각 창의
// 열기 로직은 그대로 두고, 여는 입구만 왼쪽으로 옮긴 셈이다.
for (const btn of document.querySelectorAll('#side-menu [data-forward]')) {
  btn.addEventListener('click', () => document.getElementById(btn.dataset.forward)?.click());
}

// 패치노트 창. 서버에 저장된 텍스트를 날짜별로 파싱해 보여 준다. 관리자는
// ✏️ 로 직접 고친다(공지처럼 서버 저장). 서버가 비어 있으면 코드에 넣어 둔
// 기본 목록(patch-notes.js)을 대신 쓴다.
const patch = (() => {
  const modal = document.getElementById('patch-modal');
  const list = document.getElementById('patch-list');
  const editModal = document.getElementById('patch-edit-modal');
  const editBtn = document.getElementById('patch-edit-btn');
  const input = document.getElementById('patch-input');
  const count = document.getElementById('patch-count');
  const errEl = document.getElementById('patch-error');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 기본 목록(코드) → 편집용 텍스트. 서버가 비었을 때 시작점으로 쓴다.
  const defaultText = PATCH_NOTES
    .map((n) => `${n.date}\n${n.items.map((i) => `- ${i}`).join('\n')}`).join('\n\n');

  let text = '';   // 서버 원문(비면 기본을 쓴다)

  // 이름 색 → 실제 색. 안전하게 화이트리스트로만 허용한다(임의 CSS 주입 방지).
  const COLOR_NAMES = {
    빨강: '#ff5566', 빨간: '#ff5566', red: '#ff5566',
    주황: '#ff9f43', orange: '#ff9f43',
    노랑: '#ffd54a', yellow: '#ffd54a',
    초록: '#57d18a', 녹색: '#57d18a', green: '#57d18a',
    파랑: '#4f8bff', 파란: '#4f8bff', blue: '#4f8bff',
    하늘: '#4fd6ff', cyan: '#4fd6ff',
    보라: '#b57bff', purple: '#b57bff',
    분홍: '#ff7eb6', pink: '#ff7eb6',
    회색: '#9aa4bf', gray: '#9aa4bf', grey: '#9aa4bf',
    흰색: '#ffffff', white: '#ffffff'
  };

  // 이름/hex → 실제 색(화이트리스트). 아니면 null.
  const toColor = (key) =>
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(key)
      ? key : (COLOR_NAMES[key] || COLOR_NAMES[key.toLowerCase()] || null);

  // 줄 앞의 [색] 을 뽑아 { color, text } 로 나눈다(줄 전체 색). 색이 아니면 원문 그대로.
  function pickColor(s) {
    const m = s.match(/^\[([^\]]{1,12})\]\s*(.*)$/);
    if (!m) return { color: null, text: s };
    const color = toColor(m[1].trim());
    return color ? { color, text: m[2] } : { color: null, text: s };
  }

  // 문장 속 {색|부분} 을 그 색 span 으로. 색이 아니면 토큰을 글자 그대로 둔다.
  function colorizeInline(s) {
    const re = /\{(#[0-9a-fA-F]{3,6}|[가-힣A-Za-z]+)\|([^}]*)\}/g;
    let out = '', last = 0, m;
    while ((m = re.exec(s))) {
      out += esc(s.slice(last, m.index));
      const color = toColor(m[1]);
      out += color ? `<span style="color:${color}">${esc(m[2])}</span>` : esc(m[0]);
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }

  // 텍스트 → [{date, items:[{text,color}]}]. 날짜 줄 + '- 항목' 줄. 빈 줄은 무시.
  function parse(t) {
    const entries = [];
    let cur = null;
    for (const raw of String(t).split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (/^[-•]/.test(line)) {
        if (!cur) { cur = { date: '', items: [] }; entries.push(cur); }
        cur.items.push(pickColor(line.replace(/^[-•]\s*/, '')));
      } else {
        cur = { date: line, items: [] };
        entries.push(cur);
      }
    }
    return entries;
  }

  // 텍스트 → 화면 HTML. 실제 목록과 편집 미리보기가 같이 쓴다.
  function entriesHtml(t) {
    const entries = parse(t);
    // 줄 전체 색은 style 로(검증된 값), 부분 색은 colorizeInline 이 span 으로.
    const item = (i) => `<li${i.color ? ` style="color:${i.color}"` : ''}>${colorizeInline(i.text)}</li>`;
    return entries.length
      ? entries.map((n) => `
          <li class="patch-entry">
            ${n.date ? `<div class="patch-date">${esc(n.date)}</div>` : ''}
            <ul class="patch-items">${n.items.map(item).join('')}</ul>
          </li>`).join('')
      : '<li class="board-empty">아직 기록이 없습니다.</li>';
  }

  function render() { list.innerHTML = entriesHtml(text || defaultText); }

  async function open() {
    render();                       // 우선 지금 값으로 그려 두고
    modal.classList.remove('hidden');
    try { text = await api.patchNotes(); render(); } catch { /* 실패하면 기존값 유지 */ }
  }
  const close = () => modal.classList.add('hidden');
  document.getElementById('patch-btn').addEventListener('click', open);
  document.getElementById('patch-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // ── 편집(관리자) ──
  const preview = document.getElementById('patch-preview');
  const colorsBar = document.getElementById('patch-colors');
  const closeEdit = () => editModal.classList.add('hidden');

  const updatePreview = () => {
    count.textContent = `${input.value.length} / 6000`;
    if (preview) preview.innerHTML = entriesHtml(input.value || defaultText);
  };

  // 선택 안의 기존 색 토큰을 벗긴다(중첩 방지).
  const stripTokens = (s) => s.replace(/\{(?:#[0-9a-fA-F]{3,6}|[가-힣A-Za-z]+)\|([^}]*)\}/g, '$1');

  // 선택한 글자에 색을 입힌다. name 이 없으면(기본) 색만 지운다.
  function applyColor(name) {
    const a = input.selectionStart, b = input.selectionEnd;
    if (a === b) return;                       // 선택한 게 없으면 아무것도 안 함
    const before = input.value.slice(0, a);
    const sel = stripTokens(input.value.slice(a, b));
    const after = input.value.slice(b);
    const wrapped = name ? `{${name}|${sel}}` : sel;
    input.value = before + wrapped + after;
    const innerStart = before.length + (name ? `{${name}|`.length : 0);
    input.focus();
    input.selectionStart = innerStart;
    input.selectionEnd = innerStart + sel.length;
    updatePreview();
  }

  // 색 팔레트 버튼(한 번만 만든다). mousedown 에서 처리해 선택이 풀리기 전에 잡는다.
  const PALETTE = ['빨강', '주황', '노랑', '초록', '파랑', '하늘', '보라', '분홍', '회색'];
  if (colorsBar && !colorsBar.dataset.built) {
    colorsBar.dataset.built = '1';
    for (const name of PALETTE) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'patch-swatch'; b.title = name;
      b.style.background = COLOR_NAMES[name];
      b.addEventListener('mousedown', (e) => { e.preventDefault(); applyColor(name); });
      colorsBar.appendChild(b);
    }
    const clr = document.createElement('button');
    clr.type = 'button'; clr.className = 'patch-swatch clear'; clr.textContent = '기본'; clr.title = '색 지우기';
    clr.addEventListener('mousedown', (e) => { e.preventDefault(); applyColor(null); });
    colorsBar.appendChild(clr);
  }

  editBtn.addEventListener('click', () => {
    input.value = text || defaultText;   // 비었으면 기본을 시작점으로
    errEl.textContent = '';
    editModal.classList.remove('hidden');
    updatePreview();
    input.focus();
  });
  input.addEventListener('input', updatePreview);
  document.getElementById('patch-edit-close').addEventListener('click', closeEdit);
  editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEdit(); });
  document.getElementById('patch-save').addEventListener('click', async () => {
    try {
      text = await api.savePatchNotes(input.value);
      render();
      closeEdit();
    } catch (e) { errEl.textContent = e.message; }
  });

  // 패치노트도 10초마다 다시 받아와, 바뀌었으면 캐시를 갱신한다. 창이 열려
  // 있으면 그 자리에서 다시 그린다(닫혀 있으면 다음에 열 때 최신으로 뜬다).
  setInterval(async () => {
    try {
      const t = await api.patchNotes();
      if (t !== text) {
        text = t;
        if (!modal.classList.contains('hidden')) render();
      }
    } catch { /* 실패는 무시 */ }
  }, 10_000);

  return { enableAdmin() { editBtn.classList.remove('hidden'); } };
})();

// ── 코인 룰렛 ──────────────────────────────────────────────
// 코인을 걸고 돌려 랜덤 보상. 칸은 6개(같은 크기)지만 확률은 WEIGHTS 로 따로
// 준다(50코인은 드물게). 코인은 로컬 지갑이라 결과도 여기서 정한다(경쟁 아님).
(() => {
  const modal = document.getElementById('roulette-modal');
  if (!modal) return;
  const wheel = document.getElementById('roulette-wheel');
  const spinBtn = document.getElementById('roulette-spin');
  const resultEl = document.getElementById('roulette-result');
  const coinsEl = document.getElementById('roul-coins');

  const COST = 10;                       // 한 번 돌리는 값
  // 6칸: 꽝×2, 5×2, 10×1, 50×1. 이웃끼리 안 겹치게 섞어 둔다.
  const SEG = [
    { label: '꽝', coins: 0, color: '#474d5e' },
    { label: '5', coins: 5, color: '#57d18a' },
    { label: '10', coins: 10, color: '#4fd6ff' },
    { label: '꽝', coins: 0, color: '#474d5e' },
    { label: '5', coins: 5, color: '#57d18a' },
    { label: '50', coins: 50, color: '#ffcf3f' }
  ];
  // 보상별 확률(합 100). 50코인은 드문 대박.
  const WEIGHTS = [{ coins: 0, p: 30 }, { coins: 5, p: 40 }, { coins: 10, p: 22 }, { coins: 50, p: 8 }];
  const N = SEG.length, ARC = 360 / N;

  // 휠 색(conic) + 칸 라벨(반지름 방향)
  wheel.style.background =
    `conic-gradient(${SEG.map((s, i) => `${s.color} ${i * ARC}deg ${(i + 1) * ARC}deg`).join(',')})`;
  wheel.innerHTML = SEG.map((s, i) => {
    const a = i * ARC + ARC / 2;
    const txt = s.coins ? `🪙${s.label}` : '꽝';
    return `<span class="roul-label" style="transform:translate(-50%,-50%) rotate(${a}deg) translateY(-104px)">${txt}</span>`;
  }).join('');

  let spinning = false;
  let rotation = 0;

  const refresh = () => {
    coinsEl.textContent = isAdmin ? '∞' : String(wallet.coins());
    spinBtn.disabled = spinning || (!isAdmin && wallet.coins() < COST);
  };

  // 보상 하나 뽑기 → { idx(멈출 칸), coins }
  function pick() {
    let r = Math.random() * WEIGHTS.reduce((s, w) => s + w.p, 0);
    let coins = 0;
    for (const w of WEIGHTS) { if (r < w.p) { coins = w.coins; break; } r -= w.p; }
    const idxs = SEG.map((s, i) => (s.coins === coins ? i : -1)).filter((i) => i >= 0);
    return { idx: idxs[(Math.random() * idxs.length) | 0], coins };
  }

  function spin() {
    if (spinning) return;
    if (!isAdmin && wallet.coins() < COST) {
      resultEl.textContent = '코인이 부족해요';
      resultEl.className = 'roulette-result lose';
      return;
    }
    if (!isAdmin) { wallet.spend(COST); renderCoinHud(); }
    spinning = true;
    resultEl.textContent = '';
    resultEl.className = 'roulette-result';
    refresh();

    const { idx, coins } = pick();
    // idx 칸 중심이 위(포인터)로 오게. 칸 중심각(시계방향, top 기준) = idx*ARC+ARC/2
    const center = idx * ARC + ARC / 2;
    const desiredMod = (360 - center) % 360;                 // 그 칸을 위로 보내는 회전각
    const currentMod = ((rotation % 360) + 360) % 360;
    const jitter = (Math.random() - 0.5) * (ARC * 0.5);       // 칸 안에서 살짝 랜덤
    rotation += 5 * 360 + ((desiredMod - currentMod + 360) % 360) + jitter;
    wheel.style.transition = 'transform 4s cubic-bezier(0.16, 0.84, 0.28, 1)';
    wheel.style.transform = `rotate(${rotation}deg)`;

    setTimeout(() => {
      spinning = false;
      if (coins > 0) wallet.add(coins);
      renderCoinHud();
      if (characters.open$) characters.draw();   // 코인 늘어 상점 살 수 있게 됐을 수도
      if (coins === 0) {
        resultEl.textContent = '꽝! 다음 기회에…';
        resultEl.className = 'roulette-result lose';
      } else {
        resultEl.textContent = `🪙 ${coins}코인 당첨!`;
        resultEl.className = 'roulette-result win' + (coins >= 50 ? ' jackpot' : '');
        audio.coin?.();
        if (coins >= 50) audio.stageUp?.();
      }
      refresh();
    }, 4100);
  }

  const open = () => { resultEl.textContent = ''; resultEl.className = 'roulette-result'; refresh(); modal.classList.remove('hidden'); };
  const close = () => modal.classList.add('hidden');
  document.getElementById('roulette-btn').addEventListener('click', open);
  document.getElementById('roulette-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  spinBtn.addEventListener('click', spin);
})();

const characters = new CharacterUI({
  bestSeconds,
  selected: () => player.characterId,
  canUse: (spec) => canUnlock(spec),
  signedIn: () => auth.signedIn,
  coins: () => wallet.coins(),        // 지금 가진 코인(상점 표시용)
  buy: (spec) => buyCharacter(spec),  // 코인으로 캐릭터 사기. 성공하면 true
  onSelect: (id) => {
    localStorage.setItem(CHAR_KEY, id);
    player.setCharacter(id);
    characters.paintButton(id);
    net.send({ type: 'character', id });
  }
});

// 점프할 때 낼 내 목소리.
//
// 녹음은 브라우저(IndexedDB)에 있고, 소리를 낼 수 있게 풀어 두는 건 audio 다.
// 그 사이를 여기서 잇는다. 캐릭터마다 두지 않는다 — 하나를 녹음해 두면
// 어떤 캐릭터로 뛰든 그 소리가 난다.
const voiceUI = new VoiceUI({
  hasVoice: () => audio.hasUserVoice(),

  onRecorded: async (blob) => {
    // 녹음 버튼을 누른 것 자체가 사용자 제스처라 여기서 소리를 깨울 수 있다
    audio.unlock();
    const result = await audio.setUserVoice(blob);
    if (result.ok) await voiceStore.save(blob);
    return result;
  },

  onPlay: () => {
    audio.unlock();
    audio.auditionUserVoice();
  },

  onErase: async () => {
    audio.clearUserVoice();
    await voiceStore.remove();
  }
});

(async () => {
  try {
    const saved = await voiceStore.load();
    if (!saved) return;
    await audio.setUserVoice(saved.blob);
    voiceUI.draw();
  } catch (err) {
    console.warn('저장해 둔 목소리를 불러오지 못했습니다:', err.message);
  }
})();

// 게임 중에는 캐릭터 창도 못 열게 한다
ui.onPlayableChange = (canOpen) => characters.setAvailable(canOpen);

const versus = new VersusUI({
  onOpen: openVersus,
  onBack: leaveVersus,
  onQueue: () => sendLobby({ type: 'queue-join' }, '상대를 찾는 중…'),
  onCreateRoom: () => sendLobby({ type: 'room-create' }, '방을 만드는 중…'),
  onJoinRoom: (code) => sendLobby({ type: 'room-join', code }, '방에 들어가는 중…'),
  onCancel: cancelWaiting
});

// 물리·연출 쪽은 소리를 모른다. 사건만 받아서 여기서 소리를 낸다.
//
// 내 목소리는 두 번 다 낸다. 다만 2단 점프는 조금 높은 음으로 낸다.
// 같은 소리를 0.2초 간격으로 두 번 틀면 말을 더듬는 것처럼 들린다.
//
// 목소리를 녹음해 뒀으면 기본 점프 효과음은 내지 않는다. 둘이 겹치면
// 애써 녹음한 목소리가 묻힌다.
player.onJump = (isDouble) => {
  const spoke = audio.say(isDouble ? VOICE.doubleRate : 1);
  if (spoke) return;
  if (isDouble) audio.doubleJump();
  else audio.jump();
};
player.onLand = () => audio.land();
hazards.onWarn = () => audio.warn();
hazards.onFire = () => audio.zap();

// 세로로 열린 폰이면 화면을 가로로 돌린다. 방향이 바뀔 때 resize 를 쏴서
// 아래 fitCamera 가 다시 맞추게 한다.
startOrientationManager();
fitCamera(camera, renderer);
addEventListener('resize', () => fitCamera(camera, renderer));

// 전체화면. 폰에서 주소창·내비바를 숨겨 게임이 화면을 꽉 채우게 한다.
// 화면이 커지면 위 resize 가 fitCamera 를 다시 불러 무대도 커진다.
(() => {
  const btn = document.getElementById('fullscreen-btn');
  const root = document.documentElement;
  // 지원하는 기기에서만 버튼을 보여 준다 (아이폰 사파리는 지원 안 함).
  if (!(root.requestFullscreen || root.webkitRequestFullscreen)) return;
  root.classList.add('can-fullscreen');

  const isFull = () => document.fullscreenElement || document.webkitFullscreenElement;
  // 켜져 있으면 버튼을 살짝 강조만 한다. 아이콘 글자를 바꾸면 폰에 따라
  // 깨진 네모로 보일 수 있어 ⛶ 하나로 둔다.
  const paint = () => btn.classList.toggle('on', !!isFull());

  btn.addEventListener('click', () => {
    if (isFull()) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    } else {
      (root.requestFullscreen || root.webkitRequestFullscreen)?.call(root);
    }
  });
  document.addEventListener('fullscreenchange', paint);
  document.addEventListener('webkitfullscreenchange', paint);
})();

// '홈 화면에 앱으로 추가' 버튼. PC·폰 어디서든 보인다. 설치는 누른 그
// 기기에 된다 — PC 에서 누르면 PC 에, 폰에서 누르면 폰에.
//
// 크롬·삼성인터넷은 설치할 수 있을 때 beforeinstallprompt 를 주는데, 늘
// 바로 주지는 않는다(한동안 써 본 사이트에만 주기도 한다). 그래서 버튼을
// 처음부터 띄워 두고, 눌렀을 때:
//   - 설치 창을 쓸 수 있으면 그걸 띄우고
//   - 아니면 브라우저 메뉴로 직접 추가하는 방법을 알려 준다.
(() => {
  const btn = document.getElementById('install-btn');
  const help = document.getElementById('install-help');
  const note = document.getElementById('install-note');
  // <head> 에서 미리 잡아 둔 신호가 있으면 그걸 이어받는다. 없으면 아래
  // 리스너로 나중에 오는 것을 받는다.
  let deferred = window.__deferredInstall || null;

  // 이미 앱으로 켰으면(홈 화면 아이콘으로 실행) 버튼을 숨긴다.
  const standalone = matchMedia('(display-mode: standalone)').matches
    || matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  // 카톡·인스타 등 앱 안의 미니 브라우저. 여기서는 홈 화면 추가가 아예 안 된다.
  const inApp = /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER|DaumApps|everytimeApp/i.test(ua);

  // 폰(터치)에서만, 아직 앱으로 설치하지 않았을 때만 보여 준다.
  // PC 에서는 이 버튼으로 바탕화면 바로가기를 만들 수 없어(브라우저가 막음)
  // 헷갈리기만 한다. PC 는 주소창 아이콘을 끌어다 놓으면 된다.
  const canShow = touch && !standalone;
  if (canShow) {
    btn.classList.remove('hidden');
    note.classList.remove('hidden');    // "앱·PC 로 하면 더 편하다" 안내도 같이
  }

  // head 스크립트가 신호를 나중에 잡으면 알려 준다.
  addEventListener('install-available', () => { deferred = window.__deferredInstall || deferred; });
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (canShow) { btn.classList.remove('hidden'); note.classList.remove('hidden'); }
  });

  const label = btn.textContent;

  // 설치 창을 띄운다. 신호가 있으면 true.
  async function installNow() {
    if (!deferred) return false;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    btn.classList.add('hidden');
    help.classList.add('hidden');
    note.classList.add('hidden');
    return true;
  }

  // 신호가 아직 안 왔으면 잠깐 기다린다. 크롬이 신호를 조금 늦게 줄 때가
  // 있어서, 눌렀을 때 바로 안내문으로 빠지지 않고 이만큼은 기다려 본다.
  function waitForSignal(ms) {
    if (deferred) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok) => { removeEventListener('install-available', onSig); resolve(ok); };
      const onSig = () => { deferred = window.__deferredInstall || deferred; done(!!deferred); };
      addEventListener('install-available', onSig);
      setTimeout(() => done(!!deferred), ms);
    });
  }

  btn.addEventListener('click', async () => {
    if (await installNow()) return;

    // 신호를 잠깐 기다렸다가 오면 바로 설치창을 띄운다.
    btn.disabled = true;
    btn.textContent = '설치 준비 중…';
    const got = await waitForSignal(2500);
    btn.disabled = false;
    btn.textContent = label;
    if (got && await installNow()) return;

    // 그래도 없으면(이미 설치됐거나 브라우저가 막은 경우) 상황에 맞는 방법을
    // 알려 준다. 웹은 바탕화면에 파일을 못 만들어서 마지막 한 걸음은 사용자 몫이다.
    //
    // 카톡·인스타 안의 미니 브라우저가 제일 흔한 걸림돌이다. 여기서는 설치가
    // 아예 안 되므로, 다른 방법을 안내하기 전에 "크롬으로 열라"고 먼저 알린다.
    let msg;
    if (inApp) {
      msg = '지금은 링크를 통해 들어온 브라우저예요. ' +
        '크롬에서 연 다음 다시 누르면 설치돼요.';
    } else if (isIOS) {
      msg = '사파리 아래 공유 버튼( ⬆️ )을 누르고 "홈 화면에 추가"를 선택하세요.';
    } else if (touch) {
      msg = '크롬 오른쪽 위 ⋮ 메뉴 → "앱 설치" 또는 "홈 화면에 추가"를 누르세요.';
    } else {
      msg = '주소창 왼쪽 아이콘을 바탕화면으로 끌어다 놓으면 바로가기가 생겨요.';
    }
    help.textContent = msg;
    help.classList.remove('hidden');
  });

  addEventListener('appinstalled', () => {
    btn.classList.add('hidden');
    help.classList.add('hidden');
    note.classList.add('hidden');
  });
})();

// ---------------------------------------------------------------- 게임 흐름

// 타이틀에서는 무대를 감춘다. 로그인 창 뒤로 흐릿하게 비치면 어수선하다.
// 하늘과 꽃가루는 남겨 둬서 배경이 밋밋해지지 않게 한다.
function setArenaVisible(visible) {
  world.deck.visible = visible;
  player.mesh.visible = visible;
  player.blob.visible = visible;
  player.halo.visible = visible;
  if (!visible) {
    hideRival();
    // 전기선도 같이 치운다. 무대만 감추면 마지막 판에 떠 있던 전기선이
    // 허공에 그대로 남아 타이틀 뒤로 비친다.
    hazards.reset();
  }
}

function startGame() {
  state.mode = 'solo';
  // 하드코어 여부는 타이틀 토글에서 읽는다. 다시 시작해도 같은 모드로 이어진다.
  state.hardcore = ui.isHardcore();
  // 1) 1단 점프만 (하드코어) / 평소 2단.  2·3·6) 빔 난이도는 hazards 로.
  player.body.maxJumps = state.hardcore ? 1 : PLAYER.maxJumps;
  hazards.setMods(state.hardcore ? HARDCORE_MODS : null);
  floorHoles.setActive(state.hardcore);   // 하드코어에서만 바닥이 사라진다
  state.paused = false;
  pause.hide();
  // 대전을 하다 왔을 수 있으니 대전 흔적을 지운다
  versus.hide();
  hideRival();
  // 브라우저는 사용자가 뭔가 누르기 전엔 소리를 막는다.
  // 이 함수는 항상 버튼 클릭 안에서 불리므로 여기가 소리를 여는 자리다.
  audio.unlock();
  audio.startAmbient();
  audio.playMusic('music');

  // 표를 미리 받아 둔다. 기다리지 않는다 — 게임은 바로 시작하고,
  // 기록을 올릴 때 이 약속이 끝나 있으면 된다.
  // 실패해도 여기서 터뜨리지 않는다. 그러면 판이 시작조차 안 된다.
  state.ticket = api.startRun().catch(() => null);

  player.reset();
  setArenaVisible(true);
  hazards.reset();
  coins.setActive(true);   // 맵에 코인이 뜨기 시작한다(솔로 전용)
  runCoins = 0;
  renderCoinHud();
  state.phase = 'playing';
  renderNotice();   // 플레이 중엔 공지 배너를 숨긴다
  state.elapsed = 0;
  state.deathTimer = 0;
  state.cause = 'zap';
  input.enabled = true;
  input.releaseAll();
  ui.showGame();
  ui.updateHud(0);
}

// ESC. 게임 중이 아닐 때는 아무 일도 하지 않는다.
function togglePause() {
  const inPlay = state.phase === 'playing' || state.phase === 'countdown';
  if (!inPlay) return;
  setPaused(!state.paused);
}

function setPaused(paused) {
  state.paused = paused;
  if (paused) {
    pause.show(state.mode);
    // 멈춘 사이에 키가 눌린 채로 남으면 풀자마자 미끄러진다
    input.enabled = false;
    input.releaseAll();
  } else {
    pause.hide();
    // 대전은 카운트다운 동안 못 움직인다. 그때는 다시 켜지 않는다.
    input.enabled = state.phase === 'playing';
    input.releaseAll();
  }
}

// 어느 화면에 있든 처음으로 돌아간다
function goHome() {
  if (state.mode === 'versus') {
    leaveVersus();
    return;
  }
  state.phase = 'title';
  input.enabled = false;
  audio.stopAmbient();
  audio.playMusic('homeMusic');
  versus.hide();
  floorHoles.setActive(false);
  coins.setActive(false);
  setArenaVisible(false);
  ui.showTitle();
  renderNotice();
}

function killPlayer(cause) {
  state.phase = 'dying';
  state.cause = cause;
  coins.setActive(false);   // 죽으면 남은 코인 정리·수집 중단
  state.deathTimer = cause === 'fall' ? 0.35 : 0.75;
  input.enabled = false;
  if (cause === 'zap') {
    ui.flashZap();
    audio.death();
  } else {
    audio.fall();
  }
}

// 게스트가 해금 조건을 넘겼을 때. 캐릭터를 공개하지 않고(그건 로그인 특전),
// 로그인하면 바로 쓸 수 있다는 안내만 띄운다. "차별점" 을 여기서 만든다.
function showLoginUnlock(count) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'unlock-overlay';
    overlay.innerHTML =
      '<div class="unlock-card">' +
      '<div class="unlock-kicker">🔒 새 캐릭터 조건 달성!</div>' +
      '<div class="unlock-lockface">🔒</div>' +
      '<div class="unlock-name">캐릭터 ' + count + '종 대기 중</div>' +
      '<div class="unlock-hint">로그인하면 바로 사용할 수 있어요 · 화면을 누르면 넘어가요</div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    const done = () => {
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); resolve(); }, 260);
    };
    // 자동으로 넘기지 않는다 — 눌러야 넘어간다(안내 문구를 읽을 시간을 준다)
    overlay.addEventListener('click', done);
  });
}

// 10초 안에 죽어 코인이 무효가 됐을 때. 먹고 바로 죽는 파밍을 막는다.
function showCoinLost(count) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'unlock-overlay';
    overlay.innerHTML =
      '<div class="unlock-card">' +
      '<div class="unlock-kicker">🪙 코인 ' + count + '개 무효</div>' +
      '<div class="unlock-lockface">⏱️</div>' +
      '<div class="unlock-name">10초 안에 끝났어요</div>' +
      '<div class="unlock-hint">10초 넘게 버텨야 코인이 쌓여요 · 화면을 누르면 넘어가요</div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    const done = () => {
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); resolve(); }, 260);
    };
    overlay.addEventListener('click', done);
  });
}

// 게스트가 판 중에 코인을 먹었을 때. 게스트는 코인이 안 쌓이므로, 로그인하면
// 코인 시스템을 쓸 수 있다고 안내한다(로그인 유도).
function showCoinLogin(count) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'unlock-overlay';
    overlay.innerHTML =
      '<div class="unlock-card">' +
      '<div class="unlock-kicker">🪙 코인 ' + count + '개 획득!</div>' +
      '<div class="unlock-lockface">🪙</div>' +
      '<div class="unlock-name">게스트는 코인이 쌓이지 않아요</div>' +
      '<div class="unlock-hint">로그인하면 코인이 모여 캐릭터를 해금할 수 있어요 · 화면을 누르면 넘어가요</div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    const done = () => {
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); resolve(); }, 260);
    };
    overlay.addEventListener('click', done);
  });
}

// 새로 열린 캐릭터를 가운데에 크게 보여 준다. 여러 개면 하나씩 차례로.
// 클릭하면 건너뛴다. 애니메이션이 끝나면(또는 건너뛰면) resolve 된다.
function showUnlock(list) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'unlock-overlay';
    overlay.innerHTML =
      '<div class="unlock-card">' +
      '<div class="unlock-kicker">새 캐릭터 해금!</div>' +
      '<img class="unlock-face" alt="">' +
      '<div class="unlock-name"></div>' +
      '<div class="unlock-hint">화면을 누르면 넘어가요</div></div>';
    document.body.appendChild(overlay);
    const face = overlay.querySelector('.unlock-face');
    const nameEl = overlay.querySelector('.unlock-name');
    requestAnimationFrame(() => overlay.classList.add('show'));

    let i = 0;
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); resolve(); }, 260);
    };
    const next = () => {
      if (i >= list.length) { done(); return; }
      const c = list[i++];
      try { face.src = characters.preview(c.id); } catch (e) { /* 미리보기 실패는 무시 */ }
      nameEl.textContent = c.name;
      // 캐릭터가 바뀔 때마다 얼굴을 팝 시킨다
      face.style.animation = 'none';
      void face.offsetWidth;
      face.style.animation = 'unlockPop 0.5s ease-out';
      timer = setTimeout(next, 1900);
    };
    overlay.addEventListener('click', done);
    next();
  });
}

// 커피 이벤트 기준 초.
const COFFEE_SECONDS = 111;

// 이 초 이상 버텨야 그 판에 먹은 코인을 인정한다(먹고 바로 죽는 파밍 방지).
const MIN_COIN_SECONDS = 10;

// 커피 이벤트 창. 캡처해서 인스타 DM 을 보내야 하므로 자동으로 사라지지 않고,
// '확인' 을 누르거나 바깥을 눌러야 닫힌다.
function showCoffee(score) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'unlock-overlay coffee';
    overlay.innerHTML =
      '<div class="unlock-card coffee-card">' +
      '<div class="coffee-emoji">☕</div>' +
      '<div class="coffee-kicker">' + COFFEE_SECONDS + '초 돌파!</div>' +
      '<div class="coffee-title">커피 이벤트 당첨 🎉</div>' +
      '<div class="coffee-body">' + score.toFixed(2) + '초로 ' + COFFEE_SECONDS + '초를 넘겼어요!<br>' +
      '이 화면을 캡처해서<br><b>AvoidArc 인스타그램 DM</b> 으로 보내주세요.</div>' +
      '<button class="coffee-ok" type="button">확인</button>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    const close = () => {
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); resolve(); }, 260);
    };
    overlay.querySelector('.coffee-ok').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  });
}

async function finishGame() {
  state.phase = 'over';
  floorHoles.setActive(false);   // 바닥 구멍 정리
  audio.stopAmbient();
  // 판이 끝났으니 긴장을 푼다. 결과 화면은 첫 화면과 같은 곡으로.
  audio.playMusic('homeMusic');
  const score = state.elapsed;

  // 이번 판으로 새로 열린 캐릭터가 있으면, 결과창 전에 해금 연출을 띄운다.
  // 최고기록은 showGameOver 가 갱신하므로, 지금 읽으면 '이전' 최고기록이다.
  const prevBest = bestSeconds();
  const freshUnlocks = PLAYABLE.filter(
    (c) => c.unlockAt > 0 && prevBest < c.unlockAt && c.unlockAt <= score
  );
  let guestNagged = false;   // 게스트에게 로그인 유도를 이미 한 번 띄웠는가
  if (freshUnlocks.length) {
    // 로그인 유저에게는 해금 연출을, 게스트에게는 로그인 유도 안내를 띄운다.
    if (auth.signedIn) await showUnlock(freshUnlocks);
    else { await showLoginUnlock(freshUnlocks.length); guestNagged = true; }
  }

  // 코인 정산. 먹고 바로 죽는 파밍을 막으려고, 10초 넘게 버틴 판만 인정한다.
  if (runCoins > 0) {
    if (!auth.signedIn) {
      // 게스트는 원래 안 쌓인다 — 위 안내를 안 띄웠으면 로그인 유도.
      if (!guestNagged) await showCoinLogin(runCoins);
    } else if (score >= MIN_COIN_SECONDS) {
      wallet.add(runCoins);          // 10초 넘김 → 지갑에 적립
      renderCoinHud();
      if (characters.open$) characters.draw();
    } else {
      await showCoinLost(runCoins);  // 10초 못 버팀 → 무효 안내
    }
  }

  // 기준 초를 처음 넘긴 사람에게 커피 이벤트 창을 띄운다.
  if (prevBest < COFFEE_SECONDS && score >= COFFEE_SECONDS) await showCoffee(score);

  ui.showGameOver(score, state.cause, state.hardcore);

  // 하드코어는 하드코어 랭킹으로, 일반은 일반 랭킹으로 따로 올린다.
  const mode = state.hardcore ? 'hardcore' : 'normal';
  const board = state.hardcore ? 'hardcore' : 'time';
  const tag = state.hardcore ? '🔥 하드코어 ' : '';

  // 1초도 못 버틴 기록은 랭킹을 어지럽히므로 올리지 않는다
  if (score < 1) {
    ui.setSubmitState('1초 이상 버텨야 랭킹에 등록됩니다');
    refreshLeaderboard(board);
    return;
  }

  ui.setSubmitState('기록 등록 중…');
  try {
    const ticket = await state.ticket;
    // 로그인했으면 서버가 계정 닉네임을 쓴다. 여기서 보내는 이름은 게스트용.
    const result = await api.submit(auth.displayName, score, ticket, mode);
    if (result.excluded) {
      ui.setSubmitState('🛠 관리자 계정이라 집계에서 제외됩니다');
    } else {
      ui.setSubmitState(result.rank ? `${tag}전체 ${result.rank}위 등록!` : `${tag}기록이 등록되었습니다`);
    }
    ui.renderLeaderboard(result, result.id, board);
  } catch (err) {
    ui.setSubmitState(`기록 등록 실패: ${err.message}`, true);
    refreshLeaderboard(board);
  }
}

// 랭킹은 세 가지다. 오래 버티기는 기록 저장소에서, 다승·승률은
// 계정에서 온다. 창을 열거나 탭을 누를 때 그때 필요한 것만 받아 온다.
const VERSUS_NOTE = {
  wins: () => '이번 시즌 · 로그인한 계정만 오릅니다',
  rate: (d) => `이번 시즌 · ${d.minGames}전 이상 치른 계정만 오릅니다`,
  streak: () => '지금 달리고 있는 연승만 셉니다. 한 번 지면 0 으로 돌아갑니다'
};

async function refreshLeaderboard(kind = 'time') {
  try {
    if (kind === 'time') {
      ui.renderLeaderboard(await api.top(auth.displayName), null, 'time');
      return;
    }
    if (kind === 'hardcore') {
      ui.renderLeaderboard(await api.top(auth.displayName, 'hardcore'), null, 'hardcore');
      return;
    }
    if (kind === 'hall') {
      ui.renderHall((await api.hall()).seasons);
      return;
    }
    const data = await api.versus();
    ui.renderLeaderboard({
      ...data[kind],
      season: data.season,
      note: VERSUS_NOTE[kind](data)
    }, null, kind);
  } catch {
    ui.leaderboardError('랭킹을 불러오지 못했습니다');
  }
}

// ---------------------------------------------------------------- 온라인 1v1

async function openVersus() {
  audio.unlock();

  ui.hideAllScreens();
  renderNotice();   // 첫 화면을 벗어났으니 공지 배너를 내린다(대전 중 남는 버그 방지)
  versus.showMenu();

  if (net.connected) return;
  versus.setStatus('서버에 연결하는 중…');
  try {
    await net.connect(auth.displayName, player.characterId);
    versus.setStatus('');
  } catch {
    versus.setStatus('서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', true);
  }
}

function sendLobby(msg, waitingText) {
  if (!net.connected) {
    versus.setStatus('서버와 연결이 끊겼습니다. 처음으로 돌아가 다시 시도해 주세요.', true);
    return;
  }
  net.send(msg);
  if (waitingText) versus.showWaiting(waitingText);
}

function cancelWaiting() {
  net.send({ type: 'queue-leave' });
  net.send({ type: 'room-leave' });
  versus.showMenu();
}

function leaveVersus() {
  net.send({ type: 'match-leave' });
  net.send({ type: 'queue-leave' });
  net.send({ type: 'room-leave' });
  net.endMatch();
  hideRival();
  audio.stopAmbient();
  audio.playMusic('homeMusic');
  state.mode = 'solo';
  state.phase = 'title';
  state.paused = false;
  pause.hide();
  input.enabled = false;
  versus.hide();
  setArenaVisible(false);
  ui.showTitle();
  renderNotice();
}

function hideRival() {
  rival.mesh.visible = false;
  rival.blob.visible = false;
  rival.halo.visible = false;
  rival.clearLabel();
  player.clearLabel();
}

net.on('room-created', (msg) => versus.showWaiting('친구가 코드를 넣고 들어오면 시작합니다.', msg.code));
net.on('room-error', (msg) => {
  versus.showMenu();
  versus.setStatus(msg.error, true);
});
net.on('room-closed', () => {
  versus.showMenu();
  versus.setStatus('방장이 방을 닫았습니다.', true);
});
net.on('queued', () => versus.showWaiting('상대를 찾는 중…'));
net.on('disconnected', () => {
  if (state.mode !== 'versus') return;
  versus.setStatus('연결이 끊겼습니다.', true);
  leaveVersus();
});

// 서버 시각을 받아 둔다. 스냅샷 사이는 로컬 시계로 메운다.
net.on('time', (t) => {
  state.serverTime = t;
  state.serverAt = performance.now() / 1000;
});

net.on('match-start', (msg) => beginVersusMatch(msg));
net.on('go', () => {
  state.phase = 'playing';
  versus.showCountdown(0);
  setTimeout(() => versus.hideCountdown(), 600);
  input.enabled = true;
});
net.on('died', (msg) => {
  if (msg.id === net.id) {
    state.myAlive = false;
    input.enabled = false;
    if (msg.cause === 'zap') { ui.flashZap(); audio.death(); } else audio.fall();
  } else {
    state.rivalAlive = false;
  }
});
net.on('match-over', (msg) => endVersusMatch(msg));

function beginVersusMatch(msg) {
  state.mode = 'versus';
  state.phase = 'countdown';
  coins.setActive(false);   // 대전에는 코인이 뜨지 않는다(솔로 전용)
  state.elapsed = 0;
  state.serverTime = 0;
  state.serverAt = performance.now() / 1000;
  state.myAlive = true;
  state.rivalAlive = true;

  const me = msg.players.find((p) => p.id === net.id);
  const other = msg.players.find((p) => p.id !== net.id);
  state.rivalName = other?.name ?? '상대';
  // 상대가 고른 캐릭터를 그대로 보여 준다
  rival.setCharacter(findCharacter(other?.character).id);

  // 서버가 정한 씨앗으로 전기선을 만든다. 통신으로 위치를 받지 않아도
  // 서버·나·상대가 같은 전기선을 스스로 만들어 낸다.
  hazards.reset(msg.seed);

  // 서버가 앉힌 자리와 같은 곳에서 시작한다 (arena-match.js 와 같은 규칙)
  const angle = me?.seat === 0 ? Math.PI : 0;
  const r = ARENA_RADIUS * 0.45;
  const mine = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
  const theirs = { x: -mine.x, z: -mine.z };

  player.reset(mine.x, mine.z);
  rival.reset(theirs.x, theirs.z);
  setArenaVisible(true);
  rival.mesh.visible = true;

  // 머리 위 이름표. 색은 발밑 링과 맞춰 둔다.
  player.setLabel('나', '#4fd6ff');
  rival.setLabel('상대', '#c07dff');

  net.beginMatch(player.body, theirs);

  versus.hide();
  ui.hideAllScreens();
  ui.showGame();
  versus.showVersusHud();
  audio.startAmbient();
  audio.playMusic('music');

  input.enabled = false;   // 카운트다운 동안은 못 움직인다
  input.releaseAll();

  let n = Math.ceil(msg.countdown);
  versus.showCountdown(n);
  const tick = setInterval(() => {
    n--;
    if (n <= 0 || state.phase !== 'countdown') return clearInterval(tick);
    versus.showCountdown(n);
  }, 1000);
}

function endVersusMatch(msg) {
  state.phase = 'over';
  state.paused = false;
  pause.hide();
  input.enabled = false;
  net.endMatch();
  hideRival();
  audio.stopAmbient();
  audio.playMusic('homeMusic');

  const outcome = msg.winner === null ? 'draw' : msg.winner === net.id ? 'win' : 'lose';
  versus.showResult({
    outcome,
    duration: msg.duration,
    players: msg.players,
    myId: net.id,
    reason: msg.reason
  });
  ui.hideAllScreens();
  ui.showRankButton();

  // 승패가 반영된 전적을 다시 받아 온다
  auth.refresh();
}

// ---------------------------------------------------------------- 루프

const clock = new THREE.Clock();
const pollen = scene.getObjectByName('pollen');

function frame() {
  requestAnimationFrame(frame);

  // 탭이 백그라운드에 갔다 오면 dt가 튀므로 상한을 둔다
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const now = performance.now() / 1000;

  animateAmbient(dt, now);

  if (state.mode === 'versus') {
    // 대전은 멈출 수 없다. 서버가 계속 돌기 때문에 여기서 손을 놓으면
    // 그 사이에 전기선을 맞고 죽어 있다. 메뉴만 떠 있고 게임은 흘러간다.
    stepVersus(dt);
    renderer.render(scene, camera);
    return;
  }

  // 일시정지 — 시간도 전기선도 멈춘다. 화면은 계속 그려서
  // 뒤로 무대가 보이게 둔다.
  if (state.paused) {
    renderer.render(scene, camera);
    return;
  }

  if (state.phase === 'playing') {
    state.elapsed += dt;

    player.update(dt, input.poll());
    hazards.update(dt, state.elapsed);
    if (state.hardcore) floorHoles.update(dt);
    coins.update(dt, player.body.x, player.body.z);   // 코인 회전·수집 판정

    if (hazards.hitTest(player)) {
      killPlayer('zap');
    } else if (player.body.droppedOff) {
      killPlayer('fall');
    } else if (state.hardcore && player.body.grounded
               && floorHoles.isOpenAt(player.body.x, player.body.z)) {
      // 사라진 바닥을 밟고 있으면 아래로 떨어진다
      killPlayer('fall');
    }

    if (ui.updateHud(state.elapsed)) audio.stageUp();
  } else if (state.phase === 'dying') {
    // 죽는 연출 동안에도 전기선은 계속 움직인다
    hazards.update(dt, state.elapsed);
    playDeathAnim(dt);

    state.deathTimer -= dt;
    if (state.deathTimer <= 0) finishGame();
  }

  renderer.render(scene, camera);
}

// 대전 한 프레임.
// 판정은 서버가 한다. 여기서는 조작에 즉시 반응하도록 미리 굴려 보고,
// 서버 값이 오면 net.update() 가 어긋난 만큼 당겨서 맞춘다.
function stepVersus(dt) {
  if (state.phase === 'playing' && state.myAlive) {
    const control = input.poll();
    net.feedInput(control);
    player.update(dt, control);
  } else {
    player.sync(dt);
  }

  net.update(dt);

  // 전기선은 서버와 같은 크기의 스텝을 같은 횟수만큼 밟아야 모양이 같다.
  // 스냅샷 사이는 로컬 시계로 메운다.
  const estimate = state.serverTime + (performance.now() / 1000 - state.serverAt);
  if (state.phase === 'playing') {
    hazards.runToTick(Math.floor(estimate * 60));
  }

  // 상대 그리기
  const rv = net.remote;
  if (rv) {
    rival.body.x = rv.body.x;
    rival.body.y = rv.body.y;
    rival.body.z = rv.body.z;
    rival.body.vx = rv.body.vx;
    rival.body.vz = rv.body.vz;
    rival.body.grounded = rv.body.grounded;
    rival.sync(dt);
    rival.mesh.visible = rv.alive;
    rival.blob.visible = rv.alive && rival.blob.visible;
    rival.halo.visible = rv.alive && rival.halo.visible;
  }

  state.elapsed = Math.max(0, estimate);
  if (state.phase === 'playing') {
    ui.updateHud(state.elapsed);
    versus.updateVersusHud({
      opponentName: state.rivalName,
      opponentAlive: state.rivalAlive,
      ping: net.ping
    });
  }
}

function playDeathAnim(dt) {
  if (state.cause === 'fall') {
    // 계속 떨어지게 둔다. player.vel 은 읽기용 사본이라 body 를 직접 만진다.
    player.body.vy -= 32 * dt;
    player.body.y += player.body.vy * dt;
    player.mesh.rotation.z += dt * 6;
    player.sync();
  } else {
    // 감전 — 부르르 떨면서 튕겨 오른다
    player.mesh.position.x = player.pos.x + (Math.random() - 0.5) * 0.35;
    player.mesh.position.z = player.pos.z + (Math.random() - 0.5) * 0.35;
    player.mesh.position.y = player.pos.y + Math.random() * 0.15;
    player.mesh.rotation.y += dt * 22;
    player.blob.visible = false;
    player.halo.visible = false;
  }
}

function animateAmbient(dt, now) {
  // 각 장식이 자기 움직임을 스스로 안다. 여기서는 시간만 넘겨 준다.
  pollen?.userData.animate(dt, now);
}

// ---------------------------------------------------------------- 시작

ui.showTitle();
setArenaVisible(false);

// 브라우저는 사용자가 뭔가 하기 전에는 소리를 못 내게 막는다.
// 첫 화면 음악을 들려주려면 게임 시작 버튼을 기다릴 게 아니라,
// 무엇을 누르든 그 첫 순간에 소리를 열어야 한다.
audio.playMusic('homeMusic');
// click 까지 듣는 이유: 마우스로 누르면 pointerdown 이 먼저 오지만,
// 키보드나 보조기기로 버튼을 누르면 click 만 오는 경우가 있다.
const openSound = () => audio.unlock();
for (const evt of ['pointerdown', 'keydown', 'touchstart', 'click']) {
  window.addEventListener(evt, openSound, { once: true, passive: true });
}

auth.init();
refreshLeaderboard();
frame();
