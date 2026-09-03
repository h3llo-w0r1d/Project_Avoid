import * as THREE from 'three';
import { createWorld, fitCamera, paintArena } from './scene.js';
import { startOrientationManager } from './orientation.js';
import { Player } from './player.js';
import { Hazards } from './hazards.js';
import { BotAI, BOT_TIERS, saveChanceAt } from './bot-ai.js';
import { FloorHoles } from './floor-holes.js';
import { Coins } from './coins.js';
import { wallet } from './wallet.js';
import { Input } from './input.js';
import { VoiceJump } from './voice-jump.js';
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
import { TrailFX, findArena, DEFAULT_ARENA } from './effects.js';
import { ShopUI } from './shop-ui.js';

// 하드코어 모드 난이도. 1) 1단 점프만 2) 예열 25% 단축 3) 빔 20% 빠름
// 6) 동시 전기선 +1·가로볼리 +1. (무대 축소·시야 제한 등은 나중에 추가)
const HARDCORE_MODS = { warnMul: 0.75, speedMul: 1.2, maxLiveAdd: 1, volleyAdd: 1 };

// 랭킹 모드(네 갈래)와 랭킹 탭 이름을 서로 오간다.
function runModeOf(hardcore, voice) {
  if (hardcore && voice) return 'voicehard';
  if (voice) return 'voice';
  if (hardcore) return 'hardcore';
  return 'normal';
}
// 랭킹 탭 kind → 서버 모드. 'time' 만 이름이 다르고 나머지는 같다.
const BOARD_MODE = { time: 'normal', hardcore: 'hardcore', voice: 'voice', voicehard: 'voicehard' };
const MODE_BOARD = { normal: 'time', hardcore: 'hardcore', voice: 'voice', voicehard: 'voicehard' };

const HARDCORE_BEST_KEY = 'voltline.best.hardcore';
function hardcoreBest() { return Number(localStorage.getItem(HARDCORE_BEST_KEY)) || 0; }

// ── 다시보기 기록 ──────────────────────────────────────────
// 판을 (seed + 프레임별 dt·입력)으로 남긴다. 시뮬(shared/beams·player-physics)이
// 순수 함수라, 같은 값을 다시 먹이면 전기선·플레이어가 그대로 재현된다.
// 최고 기록일 때만 서버로 올리고, 관리자만 프로필에서 본다.
const REC_CAP = 18000;     // 안전 상한(약 5분). 넘으면 그만 기록한다.
let rec = null;            // 기록 중이면 { seed, mode, dt[], x[], y[], j[] }

// 기록 → base64. 프레임마다 float 4개(dt, x, y, jump)로 촘촘히 담는다.
function encodeReplay(r) {
  const n = r.dt.length;
  const buf = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    buf[i * 4] = r.dt[i]; buf[i * 4 + 1] = r.x[i];
    buf[i * 4 + 2] = r.y[i]; buf[i * 4 + 3] = r.j[i];
  }
  const bytes = new Uint8Array(buf.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

// base64 → { dt, x, y, j, n } (재생용)
function decodeReplay(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const f = new Float32Array(bytes.buffer);
  const n = f.length >> 2;
  const dt = new Array(n), x = new Array(n), y = new Array(n), j = new Array(n);
  for (let i = 0; i < n; i++) { dt[i] = f[i * 4]; x[i] = f[i * 4 + 1]; y[i] = f[i * 4 + 2]; j[i] = f[i * 4 + 3]; }
  return { dt, x, y, j, n };
}

const canvas = document.getElementById('stage');
const world = createWorld(canvas);
const { renderer, scene, camera, deck } = world;

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
  if (spec.rouletteOnly) return wallet.isOwned(spec.id); // 룰렛 전용은 룰렛으로 얻었으면
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
  // 관리자가 준 코인이 대기 중이면 받아 지갑에 넣는다. 로그인 상태면 폴링으로
  // 새로고침 없이도 10초 안에 받는다(아래 startCoinPolling).
  if (auth.signedIn) { await claimCoinsNow(); startCoinPolling(); }
  else stopCoinPolling();
  syncCharacterForAuth();
}

// 판이 도는 중인가. 이때 선물 창을 띄우면 화면을 가려서 그대로 죽는다.
// (실제로 그렇게 죽었다는 제보가 있었다.) 다시보기도 화면을 다 쓰므로 같이 막는다.
function inPlay() {
  return state.phase === 'playing' || state.phase === 'countdown'
    || state.mode === 'replay';
}

// 대기 코인을 한 번 받아 지갑에 넣고, 있으면 선물 팝업(관리자 멘트 포함)을 띄운다.
// 판 중이면 아무것도 안 한다 — 서버에 그대로 남아 있다가, 판이 끝나면
// finishGame/goHome 이 다시 불러 그때 받는다.
async function claimCoinsNow() {
  if (!auth.signedIn || inPlay()) return;
  try {
    const { amount, message } = await api.claimCoins();
    if (amount > 0) {
      wallet.add(amount);
      renderCoinHud();
      if (characters.open$) characters.draw();
      showCoinGift(amount, message);
    }
  } catch { /* 무시 */ }
}

// 로그인 상태면 10초마다 대기 코인을 확인해 자동 수령(화면이 보일 때만).
let coinPoll = null;
function startCoinPolling() {
  if (coinPoll) return;
  coinPoll = setInterval(() => {
    if (auth.signedIn && document.visibilityState === 'visible') claimCoinsNow();
  }, 10000);
}
function stopCoinPolling() { if (coinPoll) { clearInterval(coinPoll); coinPoll = null; } }

const player = new Player(scene, { characterId: savedCharacter() });
// 상대는 발밑 링 색으로 구분한다. 캐릭터는 상대가 고른 걸 그대로 보여 준다.
const rival = new Player(scene, { haloColor: 0xc07dff });
rival.mesh.visible = false;
rival.blob.visible = false;
rival.halo.visible = false;

const hazards = new Hazards(scene);
const floorHoles = new FloorHoles(scene);   // 하드코어: 부채꼴 감전 지대(시드 기반)
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

// 상점에서 산 발자국 효과. 꾸미기라 판정에는 아무 영향이 없다.
// 지금 켠 것만 그린다(안 샀거나 껐으면 setEffect(null) 로 통째로 끈다).
const trail = new TrailFX(scene);
trail.setEffect(wallet.equippedIn('trail'));

// 경기장 스킨(상점 '경기장 스킨'). 안 골랐으면 원래 풀숲.
function applyArena(id) {
  const spec = findArena(id ?? DEFAULT_ARENA) ?? findArena(DEFAULT_ARENA);
  paintArena(deck, spec);
}
applyArena(wallet.equippedIn('arena'));

// 발자국 효과 한 프레임. 혼자 하기·봇전·1v1 이 모두 이 한 줄만 부른다.
// 죽고 나서까지 뿌리면 시체에서 반짝이므로 살아 있을 때만.
function updateTrail(dt) {
  if (!trail.spec) return;
  const b = player.body;
  trail.update(dt, { x: b.x, y: b.y, z: b.z },
    Math.hypot(b.vx, b.vz), !!b.grounded);
}

// 음성 점프 모드의 화면 왼쪽 볼륨 바. 지금 목소리 크기(채워짐)와 점프 기준선
// (가로줄)을 보여 준다. 기준선을 넘겨 소리 지르면 점프 → 그 순간 반짝인다.
const voiceMeter = (() => {
  const el = document.createElement('div');
  el.id = 'voice-meter';
  el.className = 'hidden';
  el.innerHTML =
    '<div class="vm-track"><div class="vm-fill"></div><div class="vm-threshold"></div></div>' +
    '<div class="vm-cap">🎤</div>';
  document.body.appendChild(el);
  const fill = el.querySelector('.vm-fill');
  // 기준선은 화면상 이 위치에 '고정'한다(CSS 에서 bottom: LINE%).
  // 실제 기준(high)은 주변 소음에 맞춰 변하지만, 채워짐을 '기준 대비 비율'로
  // 그리므로 선은 안 움직이고, 채워짐이 이 선을 넘는 순간이 곧 점프다.
  const LINE = 45;
  let flashT = 0;
  return {
    show() { el.classList.remove('hidden'); },
    hide() { el.classList.add('hidden'); },
    flash() { flashT = 0.18; el.classList.add('hit'); },
    update(level, high, dt) {
      el.classList.remove('hidden');
      const ratio = high > 0 ? level / high : 0;      // 1 이면 기준선에 닿는다
      fill.style.height = Math.max(0, Math.min(100, ratio * LINE)) + '%';
      el.classList.toggle('over', level >= high);      // 기준 넘기는 중이면 뜨겁게
      if (flashT > 0) { flashT -= dt; if (flashT <= 0) el.classList.remove('hit'); }
    }
  };
})();

// 마이크로 점프. 함성 시작마다 점프 신호를 넣고, 바를 반짝인다.
const voiceJump = new VoiceJump(() => { input.jumpQueued = true; voiceMeter.flash(); });
const VOICE_KEY = 'avoidarc.voicejump';
let voiceOn = localStorage.getItem(VOICE_KEY) === '1';

// 소리 질러 점프 토글(하드코어 밑). 켜면 지금 바로 마이크 권한을 물어본다.
const voiceToggle = document.getElementById('voice-toggle');
function paintVoice() {
  if (!voiceToggle) return;
  voiceToggle.classList.toggle('on', voiceOn);
  voiceToggle.setAttribute('aria-pressed', voiceOn ? 'true' : 'false');
  const st = voiceToggle.querySelector('.hc-state');
  if (st) st.textContent = voiceOn ? 'ON' : 'OFF';
}
paintVoice();
voiceToggle?.addEventListener('click', async () => {
  if (!voiceOn) {
    if (!voiceJump.supported()) { alert('이 브라우저는 마이크를 지원하지 않습니다.'); return; }
    try { await voiceJump.open(); voiceOn = true; }       // 권한 프롬프트 → 켜 둔다
    catch { alert('마이크 권한을 허용해야 소리 질러 점프를 쓸 수 있어요.'); voiceOn = false; }
  } else {
    voiceOn = false; voiceJump.close();
  }
  localStorage.setItem(VOICE_KEY, voiceOn ? '1' : '0');
  paintVoice();
});

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
  myAlive: true,
  // 봇전용
  botAI: null,          // BotAI 인스턴스(봇전일 때만)
  botAlive: true,
  botTier: 'mid',
  botInvuln: 0,         // 위기탈출 후 잠깐 무적(초)
  challenge: null       // 도전모드에서 지금 도전 중인 층(없으면 일반 판)
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
// 관리자 전용: 프로필의 최고기록 다시보기.
profile.onReplay = (scoreId) => watchReplay(scoreId);
// 칭호 장착 저장(로그인 계정만). 게스트는 계정이 없어 저장되지 않는다.
profile.onEquipTitles = (equipped) => api.equipTitles(equipped);

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
      adminCoins.enableAdmin();   // 코인 지급 버튼(💰) 켜기
      renderCoinHud();       // 코인 표시를 ∞ 로
      // 관리자로 확정되면 전부 해금 상태로 화면을 다시 맞춘다.
      syncCharacterForAuth();
    }
    return yes;
  })
  .catch(() => { isAdmin = false; return false; });

// ── 공지 ────────────────────────────────────────────────
// 관리자가 쓴 한 줄 공지를 타이틀 상단 배너에 띄운다.
let notices = [];          // 공지 목록(줄마다 하나)
let noticeIndex = 0;       // 지금 보여 주는 공지 번호(여러 개면 번갈아)
const noticeBanner = document.getElementById('notice-banner');

function renderNotice() {
  // 첫 화면에 머무를 때만 띄운다. 두 조건을 모두 본다:
  //  - phase 가 title (혼자하기·대전을 시작하면 playing/countdown 으로 바뀐다)
  //  - title-screen 이 실제로 화면에 떠 있음 (1v1 매치메이킹은 phase 는 아직
  //    title 이지만 화면은 대전 메뉴라, 이 조건이 있어야 배너가 안 남는다)
  const titleScreen = document.getElementById('title-screen');
  const titleShown = titleScreen && !titleScreen.classList.contains('hidden');
  const text = notices[noticeIndex] ?? '';
  const show = text && state.phase === 'title' && titleShown;
  if (noticeBanner) {
    noticeBanner.textContent = text;
    noticeBanner.classList.toggle('hidden', !show);
  }
}

api.notices().then((list) => { notices = list; noticeIndex = 0; renderNotice(); }).catch(() => {});

// 타이틀 오른쪽 '누적 판수' 카드. 못 받아 오면 카드를 그냥 안 띄운다 —
// 장식이라 없다고 아쉬울 게 없고, 0판이라고 거짓말하는 것보단 낫다.
//
// 갱신은 셋으로 나눠 둔다:
//  · 처음 한 번 — 0 에서 굴려 올리는 연출과 함께
//  · 15초마다  — 숫자만 조용히 바꾼다
//  · 타이틀로 돌아올 때 — 방금 내 판이 더해진 걸 바로 보게(제일 보고 싶은 순간)
// 이보다 더 촘촘히 할 이유는 없다. 제일 붐비는 시간대도 평균 51초에 한 판이라
// 1초마다 물어봐도 대개 같은 숫자가 돌아온다.
let playCountShown = 0;
function refreshPlayCount(animate = false) {
  const card = document.getElementById('play-count');
  const numEl = document.getElementById('play-count-num');
  if (!card || !numEl) return;
  api.playCount().then(({ total, since }) => {
    if (!(total > 0)) return;
    card.classList.remove('hidden');
    // '2026-08-20' → '2026.08.20'. 언제부터 센 숫자인지 밝혀 둔다.
    const sinceEl = document.getElementById('play-count-since');
    if (sinceEl && since) sinceEl.textContent = String(since).replaceAll('-', '.');
    if (!animate) { numEl.textContent = total.toLocaleString('ko-KR'); playCountShown = total; return; }
    // 지금 보이는 숫자에서 새 숫자까지 굴린다(처음엔 0 에서).
    const from = playCountShown, t0 = performance.now(), DUR = 1100;
    playCountShown = total;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / DUR);
      const eased = 1 - (1 - p) ** 3;              // 끝에서 부드럽게 멈추게
      numEl.textContent = Math.round(from + (total - from) * eased).toLocaleString('ko-KR');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).catch(() => {});
}
refreshPlayCount(true);
setInterval(() => refreshPlayCount(false), 15_000);
// 10초마다: 최신 공지를 다시 받아오고(바뀌면 처음부터), 안 바뀌었으면 다음
// 공지로 넘긴다 → 여러 개면 10초 간격으로 번갈아 뜬다.
setInterval(() => {
  api.notices().then((list) => {
    const changed = list.join('\n') !== notices.join('\n');
    if (changed) { notices = list; noticeIndex = 0; }
    else if (notices.length > 1) { noticeIndex = (noticeIndex + 1) % notices.length; }
    renderNotice();
  }).catch(() => {});
}, 10_000);

// 관리자에게만 상단바 📢 버튼과 공지 편집 창을 켜 준다.
function setupNoticeAdmin() {
  const btn = document.getElementById('notice-btn');
  const modal = document.getElementById('notice-modal');
  const fields = [1, 2, 3, 4].map((n) => document.getElementById('notice-' + n));
  const count = document.getElementById('notice-count');
  const errEl = document.getElementById('notice-error');
  if (!btn || !modal || fields.some((f) => !f)) return;

  const filled = () => fields.map((f) => f.value.trim()).filter(Boolean);
  const paintCount = () => { count.textContent = `공지 ${filled().length}개`; };

  btn.classList.remove('hidden');
  const close = () => modal.classList.add('hidden');
  const open = () => {
    fields.forEach((f, i) => { f.value = notices[i] ?? ''; });   // 칸마다 하나씩
    paintCount();
    errEl.textContent = '';
    modal.classList.remove('hidden');
    fields[0].focus();
  };
  // 빈 칸은 빼고, 채운 순서대로 저장한다.
  const save = async () => {
    try {
      notices = await api.saveNotice(filled().join('\n'));
      noticeIndex = 0;
      renderNotice();
      close();
    } catch (e) {
      errEl.textContent = e.message;
    }
  };

  btn.addEventListener('click', open);
  document.getElementById('notice-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  for (const f of fields) f.addEventListener('input', paintCount);
  document.getElementById('notice-save').addEventListener('click', save);
  // 비우기: 네 칸을 모두 지운다(저장을 눌러야 실제로 사라진다).
  document.getElementById('notice-clear').addEventListener('click', () => {
    fields.forEach((f) => { f.value = ''; });
    paintCount();
    fields[0].focus();
  });
}

// 자유 게시판. 게스트는 이름을 같이 보내고, 로그인했으면 서버가 계정 닉네임을 쓴다.
const board = new BoardUI({
  list: () => api.boardList(),
  post: (body, parentId, category) =>
    api.boardPost(body, auth.signedIn ? undefined : auth.displayName, parentId, category),
  remove: (id) => api.boardRemove(id),
  edit: (id, body) => api.boardEdit(id, body),
  isAdmin: () => isAdmin
});

// 왼쪽 메뉴 버튼은 상단바의 진짜 버튼(숨김)을 대신 눌러 준다. 각 창의
// 열기 로직은 그대로 두고, 여는 입구만 왼쪽으로 옮긴 셈이다.
for (const btn of document.querySelectorAll('#side-menu [data-forward]')) {
  btn.addEventListener('click', () => document.getElementById(btn.dataset.forward)?.click());
}

// ── 상점 ────────────────────────────────────────────────
// 코인으로 사는 꾸미기(지금은 발자국 효과). 코인 처리는 캐릭터 구매와 똑같이
// 브라우저에서 하고, 서버에는 '누가 뭘 샀다' 기록만 남긴다.
const shop = new ShopUI();
shop.isAdmin = () => isAdmin;
shop.onBuy = (item, cat) => {
  if (isAdmin) { wallet.markOwnedIn(cat.kind, item.id); return true; }   // 관리자는 코인 무한
  if (wallet.isOwnedIn(cat.kind, item.id)) return true;
  if (!wallet.spend(item.cost)) return false;
  wallet.markOwnedIn(cat.kind, item.id);
  renderCoinHud();
  api.recordPurchase(`${cat.kind}:${item.id}`, `${item.name}(${cat.name})`, item.cost,
    auth.signedIn ? undefined : auth.displayName);
  return true;
};
shop.onEquip = (kind, id) => {
  wallet.equipIn(kind, id);
  if (kind === 'trail') trail.setEffect(id);
  else if (kind === 'arena') applyArena(id);
};
document.getElementById('shop-btn')?.addEventListener('click', () => {
  if (isAdmin) shop.open();
  else comingSoon();
});

// 아직 여는 중인 기능을 눌렀을 때. 버튼은 보이게 두되(뭐가 올지 보이게)
// 누르면 준비 중이라고만 알린다. 관리자는 그대로 쓸 수 있다.
function comingSoon() {
  const t = document.createElement('div');
  t.className = 'shop-toast center';
  t.textContent = '업데이트 중입니다';
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 240);
  }, 1600);
}

// ── 코인 지급(관리자) ──────────────────────────────────────
// 계정 목록을 보여 주고, 누르면 그 계정에 코인을 지급한다(대기에 쌓임 →
// 그 사람 다음 접속 때 자동 수령). 상단바 💰 버튼으로 연다.
const adminCoins = (() => {
  const modal = document.getElementById('admin-coins-modal');
  if (!modal) return { enableAdmin() {} };
  const list = document.getElementById('admin-coins-list');
  const search = document.getElementById('admin-coins-search');
  const btn = document.getElementById('admin-coin-btn');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let accounts = [];

  function render() {
    const q = search.value.trim().toLowerCase();
    const rows = accounts.filter((a) => a.nickname.toLowerCase().includes(q));
    list.innerHTML = rows.length
      ? rows.map((a) => `<li class="acgrant" data-id="${esc(a.id)}" data-name="${esc(a.nickname)}">
          <span class="acgrant-name">${esc(a.nickname)}</span>
          ${a.pending ? `<span class="acgrant-pending">대기 🪙${a.pending}</span>` +
            `<button type="button" class="acgrant-revoke" data-revoke="${esc(a.id)}">취소</button>` : ''}
          <span class="acgrant-go">지급 ▸</span></li>`).join('')
      : '<li class="board-empty">계정이 없습니다.</li>';
    for (const li of list.querySelectorAll('.acgrant')) {
      li.addEventListener('click', () => askGrant(li.dataset.id, li.dataset.name));
    }
    // 대기 코인 '취소' — 아직 안 받아간 지급을 0으로. (li 지급 창이 안 뜨게 전파 차단)
    for (const b of list.querySelectorAll('.acgrant-revoke')) {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = b.dataset.revoke;
        const a = accounts.find((x) => x.id === id);
        if (!confirm(`${a?.nickname ?? ''} 에게 준 대기 코인 🪙${a?.pending ?? 0} 을(를) 취소할까요?\n(이미 받아간 코인은 되돌릴 수 없습니다.)`)) return;
        try {
          await api.revokeCoins(id);
          if (a) a.pending = 0;
          render();
        } catch (err) { alert(err.message); }
      });
    }
  }

  async function open() {
    modal.classList.remove('hidden');
    search.value = '';
    list.innerHTML = '<li class="board-empty">불러오는 중…</li>';
    try { accounts = await api.adminAccounts(); render(); }
    catch { list.innerHTML = '<li class="board-empty">불러오지 못했습니다.</li>'; }
  }
  const close = () => modal.classList.add('hidden');

  // 지급 금액을 묻는 가운데 작은 창.
  function askGrant(id, name) {
    const dlg = document.createElement('div');
    dlg.className = 'modal buy-confirm';
    dlg.innerHTML = `<div class="modal-card panel">
        <div class="buy-ico">💰</div>
        <p class="buy-msg"><b>${esc(name)}</b> 에게 줄 코인 수</p>
        <input class="ac-amt" type="number" min="1" max="100000" value="20" inputmode="numeric" />
        <input class="ac-msg" type="text" maxlength="100" placeholder="멘트(선택) — 받을 때 뜹니다" />
        <div class="buy-row">
          <button type="button" class="ghost small ac-cancel">취소</button>
          <button type="button" class="primary small ac-ok">지급</button>
        </div>
        <em class="ac-err field-error"></em></div>`;
    document.body.appendChild(dlg);
    const amt = dlg.querySelector('.ac-amt');
    const msgEl = dlg.querySelector('.ac-msg');
    const errEl = dlg.querySelector('.ac-err');
    const closeDlg = () => dlg.remove();
    setTimeout(() => { amt.focus(); amt.select(); }, 0);
    dlg.querySelector('.ac-cancel').addEventListener('click', closeDlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDlg(); });
    dlg.querySelector('.ac-ok').addEventListener('click', async () => {
      const n = Math.floor(Number(amt.value) || 0);
      if (n < 1) { errEl.textContent = '1 이상 입력하세요.'; return; }
      try {
        const pending = await api.grantCoins(id, n, msgEl.value.trim());
        const a = accounts.find((x) => x.id === id); if (a) a.pending = pending;
        render();
        closeDlg();
      } catch (e) { errEl.textContent = e.message; }
    });
  }

  btn.addEventListener('click', open);
  document.getElementById('admin-coins-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  search.addEventListener('input', render);

  return { enableAdmin() { btn.classList.remove('hidden'); } };
})();

// ── 코인 룰렛 ──────────────────────────────────────────────
// 누적 게임 시간이 100초 쌓일 때마다 1회씩 돌린다(코인이 아니라 '시간'으로).
// 돌리면 랜덤 코인 보상. 칸은 7개지만 확률은 WEIGHTS 로 따로 준다.
(() => {
  const modal = document.getElementById('roulette-modal');
  if (!modal) return;
  const wheel = document.getElementById('roulette-wheel');
  const spinBtn = document.getElementById('roulette-spin');
  const resultEl = document.getElementById('roulette-result');
  const hubEl = document.getElementById('roulette-hub');   // 가운데 원(누적시간·남은횟수)

  const PER = wallet.secondsPerSpin();   // 한 회에 필요한 누적 시간(초)
  const BLANK_STREAK_KEY = 'avoidarc.roul.blankStreak';   // 룰렛 꽝 연속 횟수(불운·저주 업적용)
  // 게스트가 뽑은 희귀 보상 횟수. 서버에 쌓을 계정이 없어 브라우저에만 센다.
  // 칭호를 주는 게 아니라 '로그인하면 받을 수 있다'고 알릴 때만 쓴다.
  const GUEST_LUCKY_KEY = 'avoidarc.roul.guestLucky';
  // 8칸(결과당 한 칸씩). 확률은 아래 WEIGHTS 로만 정해지므로 칸을 여러 개 둘 필요가 없다.
  const SEG = [
    { label: '꽝', coins: 0, color: '#474d5e' },
    { label: '5', coins: 5, color: '#57d18a' },
    { label: '10', coins: 10, color: '#4fd6ff' },
    { label: '20', coins: 20, color: '#ff9f43' },
    { label: '50', coins: 50, color: '#ffcf3f' },
    { label: '💰300', jackpot: true, coins: 300, color: '#ffd93b' }, // 코인 잭팟
    { label: '가나디라고라', lucky: true, color: '#ffcf6a' },        // 가나디라고라(한정 캐릭터)
    { label: '개발자의 선물', gift: true, color: '#ff7eb6' },        // 인스타 DM 소정의 선물
    { label: '🎵', song: true, color: '#b57bff' }                    // 개발자가 불러주는 노래
  ];
  // 보상별 확률(합 100). 노래 1% · 개발자의 선물 0.1% · 코인 잭팟 2% · 가나디라고라 3%,
  // 코인은 값이 클수록 희귀: 꽝 41.9 · 5코인 20 · 10코인 15 · 20코인 10 · 50코인 7.
  const WEIGHTS = [
    { coins: 0, p: 41.9 }, { coins: 5, p: 20 }, { coins: 10, p: 15 },
    { coins: 20, p: 10 }, { coins: 50, p: 7 },
    { jackpot: true, coins: 300, p: 2 },   // 코인 잭팟 300
    { lucky: true, p: 3 },                  // 가나디라고라
    { gift: true, p: 0.1 },                 // 개발자의 선물(당첨되면 안내창에서 인스타 DM 요청)
    { song: true, p: 1 }                    // 개발자 노래
  ];
  const N = SEG.length, ARC = 360 / N;

  // 원판은 SVG 부채꼴로 그린다. conic-gradient 은 0°·180°(위·아래)에서 이음새
  // 띠가 보여서 색이 달라 보인다 — SVG 조각은 그런 이음새가 없다.
  const pt = (deg) => {
    const r = deg * Math.PI / 180;
    return [(50 + 50 * Math.sin(r)).toFixed(3), (50 - 50 * Math.cos(r)).toFixed(3)];
  };
  const wedges = SEG.map((s, i) => {
    const [x0, y0] = pt(i * ARC);
    const [x1, y1] = pt((i + 1) * ARC);
    return `<path d="M50,50 L${x0},${y0} A50,50 0 0 1 ${x1},${y1} Z" fill="${s.color}"/>`;
  }).join('');
  wheel.style.background = 'none';
  // preserveAspectRatio 를 유지(meet)로 둬, 칸이 눌려도 원이 타원으로 안 늘어난다.
  // 라벨 거리는 휠 크기(--wheel)에 비례시켜 크기가 바뀌어도 자리가 맞게.
  wheel.innerHTML =
    `<svg class="roulette-svg" viewBox="0 0 100 100" aria-hidden="true">${wedges}</svg>` +
    SEG.map((s, i) => {
      const a = i * ARC + ARC / 2;
      // 노래 칸은 글씨가 길어 작게 세 줄로 넣는다.
      const txt = s.song ? '개발자가<br>불러주는<br>노래'
        : s.lucky ? '가나디라고라<br><small>(룰렛 전용)</small>'
        : s.gift ? '🎁<br>개발자의<br>선물'
        : s.jackpot ? '💰300'
        : (s.coins ? `🪙${s.label}` : '꽝');
      const cls = (s.song || s.lucky || s.gift) ? 'roul-label roul-label-song' : 'roul-label';
      return `<span class="${cls}" style="transform:translate(-50%,-50%) rotate(${a}deg) translateY(calc(var(--wheel, 300px) * -0.345))">${txt}</span>`;
    }).join('');

  let spinning = false;
  let rotation = 0;

  // 가운데 원과 버튼을 지금 상태로 그린다.
  const refresh = () => {
    // 룰렛에 쓸 수 있는 초(잔여 풀). 1회 돌리면 100초 차감된다.
    const secs = wallet.spendableSeconds();
    const left = isAdmin ? Infinity : wallet.spinsAvailable();
    if (hubEl) {
      // 다음 1회까지 더 필요한 시간(진행 표시). 관리자는 무제한.
      const toNext = isAdmin ? 0 : PER - (secs % PER);
      hubEl.innerHTML = isAdmin
        ? '<span class="hub-secs">∞</span><span class="hub-spins">무제한</span>'
        : `<span class="hub-secs">보유 ${Math.floor(secs)}초</span>` +
          `<span class="hub-spins">${left}회</span>` +
          `<span class="hub-next">다음까지 ${Math.ceil(toNext)}초</span>`;
    }
    spinBtn.disabled = spinning || (!isAdmin && left <= 0);
    spinBtn.textContent = spinning ? '돌리는 중…'
      : isAdmin ? '돌리기' : (left > 0 ? `돌리기 (남은 ${left}회)` : '아직 부족해요');
  };

  // 보상 하나 뽑기 → { idx(멈출 칸), coins, song?, lucky?, jackpot? }
  function pick() {
    const total = WEIGHTS.reduce((s, w) => s + w.p, 0);
    let r = Math.random() * total;
    let chosen = WEIGHTS[WEIGHTS.length - 1];
    for (const w of WEIGHTS) { if (r < w.p) { chosen = w; break; } r -= w.p; }
    if (chosen.song) return { idx: SEG.findIndex((s) => s.song), coins: 0, song: true };
    if (chosen.lucky) return { idx: SEG.findIndex((s) => s.lucky), coins: 0, lucky: true };
    if (chosen.gift) return { idx: SEG.findIndex((s) => s.gift), coins: 0, gift: true };
    if (chosen.jackpot) return { idx: SEG.findIndex((s) => s.jackpot), coins: chosen.coins, jackpot: true };
    // 일반 코인: 특별 칸은 빼고 같은 코인 칸 중에서.
    const idxs = SEG.map((s, i) => (!s.song && !s.lucky && !s.gift && !s.jackpot && s.coins === chosen.coins ? i : -1)).filter((i) => i >= 0);
    return { idx: idxs[(Math.random() * idxs.length) | 0], coins: chosen.coins };
  }

  // 개발자 노래 재생. 파일이 없으면 조용히 넘어간다(축하 문구는 그대로 뜬다).
  // public/dev-song.mp3 에 녹음 파일을 넣으면 그게 재생된다.
  function playDevSong() {
    try {
      const a = new Audio('/dev-song.mp3');
      a.volume = 0.9;
      a.play().catch(() => { /* 파일 없음/자동재생 막힘 — 무시 */ });
    } catch { /* 무시 */ }
  }

  function spin() {
    if (spinning) return;
    if (!isAdmin && wallet.spinsAvailable() <= 0) {
      const toNext = PER - (wallet.playtime() % PER);
      resultEl.textContent = `게임을 ${Math.ceil(toNext)}초 더 하면 한 번 돌릴 수 있어요`;
      resultEl.className = 'roulette-result lose';
      return;
    }
    if (!isAdmin) wallet.useSpin();   // 누적 시간 100초 = 1회 소모
    spinning = true;
    resultEl.textContent = '';
    resultEl.className = 'roulette-result';
    refresh();

    const { idx, coins, song, lucky, jackpot, gift } = pick();
    const wasOwnedLucky = lucky && wallet.isOwned('lucky');   // 이미 가진 가나디라고라인지
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

      // 보상 지급. 가나디라고라는 이미 있으면 100코인으로 대체한다.
      let rewardCoins = coins;   // 서버 기록에 남길 보상 코인
      let prize;                 // 특별 당첨 태그(관리 기록)
      if (lucky) {
        if (wasOwnedLucky) { rewardCoins = 100; wallet.add(100); prize = '가나디라고라(중복)'; }
        else { wallet.markOwned('lucky'); rewardCoins = 0; prize = '가나디라고라'; }
      } else {
        if (coins > 0) wallet.add(coins);
        if (jackpot) prize = '잭팟';
        else if (song) prize = '노래';
        else if (gift) prize = '개발자의 선물';
      }
      renderCoinHud();
      // 관리자가 아니면 결과를 서버에 남긴다(관리 화면에서 보려고). 시간으로 돌려
      // 건 코인은 0. 특별 당첨은 prize 로 누가 됐는지 남긴다.
      if (!isAdmin) api.recordSpin(0, rewardCoins, auth.signedIn ? undefined : auth.displayName, prize);
      if (characters.open$) characters.draw();   // 가나디라고라 해금·코인 반영

      if (lucky) {
        resultEl.textContent = wasOwnedLucky
          ? '가나디라고라는 이미 있어요! 대신 100코인 지급'
          : '🎉 초대박! 한정 캐릭터 가나디라고라 획득!';
        resultEl.className = 'roulette-result win jackpot';
        audio.stageUp?.();
      } else if (jackpot) {
        resultEl.textContent = '💰🎉 잭팟! 300코인 획득!!';
        resultEl.className = 'roulette-result win jackpot';
        audio.coin?.(); audio.stageUp?.();
      } else if (song) {
        resultEl.textContent = '🎉 초대박! 개발자가 불러주는 노래 🎵';
        resultEl.className = 'roulette-result win jackpot';
        audio.stageUp?.();
        playDevSong();
      } else if (gift) {
        resultEl.innerHTML = '🎁 개발자의 선물 당첨!<br>' +
          '<small>avoid_arc 인스타그램 DM으로 연락하면 개발자가 소정의 선물을 드려요</small>';
        resultEl.className = 'roulette-result win jackpot';
        audio.stageUp?.();
      } else if (coins === 0) {
        resultEl.textContent = '꽝! 다음 기회에…';
        resultEl.className = 'roulette-result lose';
      } else {
        resultEl.textContent = `🪙 ${coins}코인 당첨!`;
        resultEl.className = 'roulette-result win' + (coins >= 50 ? ' jackpot' : '');
        audio.coin?.();
        if (coins >= 50) audio.stageUp?.();
      }

      // 희귀 보상(0.1~3%: 가나디·300코인 잭팟·노래·개발자의 선물)을 뽑으면 누적 횟수를
      // 올린다. 3회면 럭키가이, 10회면 행운의 여신을 얻고 축하 연출이 뜬다.
      if (lucky || jackpot || song || gift) {
        if (auth.signedIn) {
          api.luckyHit().then((r) => {
            if (r?.newTitles?.length) showTitleUnlock(r.newTitles);
          });
        } else {
          // 게스트는 서버에 쌓을 계정이 없어서, 브라우저에만 세어 두고 문턱을
          // 넘길 때 로그인하면 받을 수 있다고 알려 준다(칭호를 주진 않는다).
          const n = (parseInt(localStorage.getItem(GUEST_LUCKY_KEY) || '0', 10) || 0) + 1;
          localStorage.setItem(GUEST_LUCKY_KEY, String(n));
          if (n === 3) showTitleLoginPrompt(['럭키가이']);
          else if (n === 10) showTitleLoginPrompt(['행운의 여신']);
        }
      }

      // 꽝 연속 카운트 → 불운(5연속)·저주받은 자(10연속) 업적. 대박·코인 당첨이
      // 나오면 연속이 끊겨 0 으로 돌아간다. 카운트는 브라우저에 이어 둔다.
      const isBlank = !lucky && !jackpot && !song && !gift && coins === 0;
      if (isBlank) {
        const n = (parseInt(localStorage.getItem(BLANK_STREAK_KEY) || '0', 10) || 0) + 1;
        localStorage.setItem(BLANK_STREAK_KEY, String(n));
        if (n === 5 || n === 10) {
          if (auth.signedIn) {
            api.awardTitle(n >= 10 ? 'cursed' : 'unlucky').then((r) => {
              if (r?.fresh && r.title) showTitleUnlock([r.title]);
            });
          } else {
            showTitleLoginPrompt([n >= 10 ? '저주받은 자' : '불운']);
          }
        }
      } else {
        localStorage.setItem(BLANK_STREAK_KEY, '0');
      }
      refresh();
    }, 4100);
  }

  // ── 확률표 ──
  // 각 칸의 당첨 확률을 WEIGHTS 로 정확히 계산해 채운다(노래 먼저, 코인 큰 순, 꽝).
  const oddsBox = document.getElementById('roulette-odds');
  const oddsList = document.getElementById('roulette-odds-list');
  const oddsBtn = document.getElementById('roulette-odds-btn');
  if (oddsList) {
    const total = WEIGHTS.reduce((s, w) => s + w.p, 0);
    // 표시 정보(라벨·정렬순서·강조). 초대박 3종을 맨 위, 그다음 코인 큰 순, 꽝은 맨 아래.
    const info = (w) => {
      if (w.gift) return { label: '🎁 개발자의 선물', ord: 1001, special: true };
      if (w.song) return { label: '🎵 개발자가 불러주는 노래', ord: 1000, special: true };
      if (w.jackpot) return { label: '💰 코인 300 잭팟', ord: 999, special: true };
      if (w.lucky) return { label: '가나디라고라 (한정 캐릭터)', ord: 998, special: true };
      if (w.coins) return { label: `🪙 ${w.coins}코인`, ord: w.coins, special: false };
      return { label: '꽝', ord: -1, special: false };
    };
    const rows = WEIGHTS.map((w) => ({ ...info(w), p: w.p })).sort((a, b) => b.ord - a.ord);
    oddsList.innerHTML = rows.map((r) => {
      const txt = String(parseFloat(((r.p / total) * 100).toFixed(2)));   // 0.01, 5, 33 처럼 필요한 만큼만
      return `<li${r.special ? ' class="song"' : ''}><span>${r.label}</span><b>${txt}%</b></li>`;
    }).join('');
  }
  const closeOdds = () => oddsBox?.classList.add('hidden');
  oddsBtn?.addEventListener('click', (e) => { e.stopPropagation(); oddsBox?.classList.toggle('hidden'); });

  const open = () => {
    // 게스트는 룰렛을 이용할 수 없다 — 창을 열지 않고 로그인 안내만 띄운다.
    if (!auth.signedIn) {
      const ov = document.createElement('div');
      ov.className = 'unlock-overlay';
      ov.innerHTML =
        '<div class="unlock-card">' +
        '<div class="unlock-kicker">🔒 로그인 필요</div>' +
        '<div class="unlock-lockface">🎰</div>' +
        '<div class="unlock-name">로그인 후 이용 가능</div>' +
        '<div class="unlock-hint">로그인하면 룰렛을 돌릴 수 있어요 · 화면을 누르면 넘어가요</div></div>';
      document.body.appendChild(ov);
      requestAnimationFrame(() => ov.classList.add('show'));
      ov.addEventListener('click', () => { ov.classList.remove('show'); setTimeout(() => ov.remove(), 260); });
      return;
    }
    resultEl.textContent = ''; resultEl.className = 'roulette-result'; closeOdds(); refresh(); modal.classList.remove('hidden');
  };
  const close = () => { closeOdds(); modal.classList.add('hidden'); };
  document.getElementById('roulette-btn').addEventListener('click', open);
  document.getElementById('roulette-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  spinBtn.addEventListener('click', () => { closeOdds(); spin(); });
})();

const characters = new CharacterUI({
  bestSeconds,
  selected: () => player.characterId,
  canUse: (spec) => canUnlock(spec),
  signedIn: () => auth.signedIn,
  isAdmin: () => isAdmin,             // 관리자는 최고기록·코인 힌트를 숨긴다

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

// 봇전 버튼 — 난이도 고르는 창을 연다.
document.getElementById('bot-btn')?.addEventListener('click', pickBotDifficulty);
// 도전모드(탑) 버튼 — 왼쪽 아래 동그란 버튼.
document.getElementById('tower-btn')?.addEventListener('click', () => {
  if (isAdmin) openTower();
  else comingSoon();
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
  state.botAI = null;      // 봇전·도전모드 흔적을 지운다(일반 판)
  state.challenge = null;
  // 하드코어 여부는 타이틀 토글에서 읽는다. 다시 시작해도 같은 모드로 이어진다.
  state.hardcore = ui.isHardcore();
  // 이번 판의 씨앗. 전기선·감전지대를 이 씨앗으로 돌려 다시보기가 그대로 재현된다.
  const seed = (Math.random() * 2 ** 31) | 0;
  // 1) 1단 점프만 (하드코어) / 평소 2단.  2·3·6) 빔 난이도는 hazards 로.
  player.body.maxJumps = state.hardcore ? 1 : PLAYER.maxJumps;
  hazards.setMods(state.hardcore ? HARDCORE_MODS : null);
  floorHoles.setActive(state.hardcore, seed);   // 하드코어: 감전 지대(시드 기반)
  // 소리 질러 점프가 켜져 있으면 마이크를 준비한다(키·터치 점프도 그대로 된다).
  if (voiceOn && !voiceJump.on) voiceJump.open().catch(() => {});
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

  // 이번 판의 모드를 확정한다(랭킹이 네 갈래로 갈린다):
  // 버티기 normal · 하드코어 hardcore · 마이크 voice · 마이크(하드코어) voicehard.
  state.voice = voiceOn;
  state.runMode = runModeOf(state.hardcore, state.voice);
  // 마이크 모드면 키·터치 점프를 막고 목소리로만 뛰게 한다.
  input.voiceOnly = state.voice;

  // 다시보기용 프레임 입력 기록 시작. 감전 지대도 시드 기반이라 하드코어도 재현된다.
  rec = { seed, mode: state.runMode, dt: [], x: [], y: [], j: [] };

  player.reset();
  trail.reset();           // 지난 판에 남은 입자를 치운다
  setArenaVisible(true);
  hazards.reset(seed);
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

// ── 도전모드(탑) ────────────────────────────────────────────
// 잔디·바위 텍스처를 캔버스로 한 번 그려 두고 섬 배경으로 쓴다. 그라데이션만으론
// 단색으로 밋밋해서, 잎을 수천 개 그려 진짜 잔디처럼 보이게 한다.
let grassTex = null, stoneTex = null;
function makeGrassTexture(dark = false) {
  const w = 512, h = 200;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  // 바탕: 위는 볕든 잔디, 아래로 갈수록 그늘
  const base = g.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, dark ? '#4f9a52' : '#63b45e');
  base.addColorStop(0.6, dark ? '#3c7f42' : '#4a9a4e');
  base.addColorStop(1, dark ? '#24552b' : '#2c6733');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  // 잔디 잎 — 짧은 곡선을 빽빽하게. 위쪽일수록 밝게 해 빛 방향을 준다.
  g.lineCap = 'round';
  for (let i = 0; i < 3200; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const len = 7 + Math.random() * 15;
    const lean = (Math.random() - 0.5) * 9;
    const light = 0.6 + (1 - y / h) * 0.55;
    const hue = 92 + Math.random() * 32;
    const sat = 38 + Math.random() * 32;
    const lum = Math.min(72, (24 + Math.random() * 26) * light);
    g.strokeStyle = `hsl(${hue} ${sat}% ${lum}%)`;
    g.lineWidth = 0.8 + Math.random() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + lean * 0.5, y - len * 0.6, x + lean, y - len);
    g.stroke();
  }
  return cv.toDataURL('image/png');
}
function makeStoneTexture() {
  const w = 512, h = 200;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const base = g.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#767d8c'); base.addColorStop(1, '#3a3e48');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  // 자잘한 돌 얼룩
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = 1 + Math.random() * 5;
    const v = Math.random() < 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${0.03 + Math.random() * 0.09})`;
    g.beginPath(); g.ellipse(x, y, r, r * 0.7, Math.random() * 3, 0, 6.3); g.fill();
  }
  return cv.toDataURL('image/png');
}
// 섬 배경 스타일(윗면 광 그라데이션을 잔디 텍스처 위에 얹는다).
function islandStyle(state) {
  if (!grassTex) { grassTex = makeGrassTexture(false); stoneTex = makeStoneTexture(); }
  const tex = state === 'lock' ? stoneTex : grassTex;
  const glow = state === 'lock'
    ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.34)';
  // 깬 층은 살짝 밝은 초록을 덧입혀 더 무성해 보이게.
  const tint = state === 'done'
    ? 'linear-gradient(rgba(180,255,180,0.18),rgba(180,255,180,0.10)),' : '';
  return `background-image:${tint}radial-gradient(ellipse 55% 48% at 34% 22%,${glow},rgba(255,255,255,0) 62%),url(${tex});` +
    `background-size:cover;background-position:center;`;
}

// 1층부터 한 층씩. 층 정의·진행도는 서버가 갖고 있고(계정에 저장), 여기선
// 그걸 받아 그리고 클리어를 보고한다.
async function openTower() {
  const overlay = document.createElement('div');
  overlay.className = 'modal tower-modal';
  overlay.innerHTML =
    '<div class="modal-card panel tower-card">' +
    '<div class="modal-head"><h2>층 오르기</h2>' +
    '<button type="button" class="icon-btn tower-close" aria-label="닫기">✕</button></div>' +
    '<p class="board-hint tower-hint">불러오는 중…</p>' +
    '<div class="tower-list"></div></div>';
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.tower-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  let data;
  try { data = await api.challenge(); }
  catch { overlay.querySelector('.tower-hint').textContent = '불러오지 못했습니다.'; return; }

  const hint = overlay.querySelector('.tower-hint');
  hint.textContent = data.signedIn
    ? `${data.cleared} / ${data.top}층 클리어`
    : '🔒 로그인하면 도전모드를 할 수 있어요';

  // 한 화면에 5층씩. 위로 갈수록 땅이 커지고, 5층을 넘기면 화면이 위로 넘어간다.
  const PER_PAGE = 5, ROW = 124;
  let face = '';
  try { face = characters.preview(player.characterId); } catch { /* 미리보기 실패는 무시 */ }
  const cur = Math.min(data.top, data.cleared + 1);
  const pages = Math.max(1, Math.ceil(data.top / PER_PAGE));
  let page = Math.min(pages, Math.ceil(Math.max(1, cur) / PER_PAGE));

  // 1층이 맨 아래로 오게 뒤집어 그린다. 섬 크기는 층이 올라갈수록 커진다.
  const rows = [...data.floors].reverse().map((f) => {
    const state = f.done ? 'done' : (f.open ? 'open' : 'lock');
    const canGo = f.open && data.signedIn;
    const w = 105 + f.floor * 14;                // 위층일수록 넓은 땅
    // 한 화면(5층) 안에서 대각선으로 오른다. 한 화면을 다 오르면 방향을
    // 뒤집어 지그재그로 이어 간다 (1~5층 →, 6~10층 ←, 11~15층 → …).
    // 뒤집는 편이 화면이 넘어가는 자리에서 자연스럽다 — 5층이 오른쪽 끝에서
    // 끝나면 6층도 오른쪽 끝에서 시작해 길이 끊기지 않고 이어진다.
    const band = Math.floor((f.floor - 1) / PER_PAGE);   // 몇 번째 5층 묶음인지
    const raw = (f.floor - 1) % PER_PAGE;
    const step = band % 2 === 0 ? raw : PER_PAGE - 1 - raw;
    const me = (f.floor === cur && data.signedIn && face)
      ? `<img class="tower-me" src="${face}" alt="">` : '';
    return `<div class="tower-floor ${state}" data-floor="${f.floor}"` +
      ` style="height:${ROW}px;padding-left:${5 + step * 15}%">` +
      `<button type="button" class="tower-node"${canGo ? '' : ' disabled'}>` +
      `<span class="tower-stage" style="width:${w}px;height:${Math.round(w * 0.35)}px">` +
      `${me}<span class="tower-island" style="${islandStyle(state)}"></span></span>` +
      `<span class="tower-label"><b class="tower-num">${f.floor}층</b>` +
      `<em class="tower-goal">${f.done ? '✔ 클리어' : f.goal}</em></span>` +
      '</button></div>';
  }).join('');

  const list = overlay.querySelector('.tower-list');
  list.innerHTML =
    `<div class="tower-view" style="height:${PER_PAGE * ROW}px">` +
    `<div class="tower-track">${rows}</div></div>` +
    '<div class="tower-pager">' +
    '<button type="button" class="tower-page up" aria-label="위층">▲</button>' +
    '<span class="tower-page-now"></span>' +
    '<button type="button" class="tower-page down" aria-label="아래층">▼</button>' +
    '</div>';

  const track = list.querySelector('.tower-track');
  const nowEl = list.querySelector('.tower-page-now');
  // page 1 = 아래(1~5층). 트랙을 밀어 그 구간만 보이게 한다.
  const showPage = (p) => {
    page = Math.max(1, Math.min(pages, p));
    track.style.transform = `translateY(${-(data.top - page * PER_PAGE) * ROW}px)`;
    nowEl.textContent = `${(page - 1) * PER_PAGE + 1}~${Math.min(data.top, page * PER_PAGE)}층`;
    list.querySelector('.tower-page.up').disabled = page >= pages;
    list.querySelector('.tower-page.down').disabled = page <= 1;
  };
  list.querySelector('.tower-page.up').addEventListener('click', () => showPage(page + 1));
  list.querySelector('.tower-page.down').addEventListener('click', () => showPage(page - 1));
  showPage(page);

  for (const b of list.querySelectorAll('.tower-node:not([disabled])')) {
    b.addEventListener('click', () => {
      const n = Number(b.closest('.tower-floor').dataset.floor);
      const f = data.floors.find((x) => x.floor === n);
      close();
      startChallenge(f);
    });
  }
}

// 그 층에 도전한다. 일반 판과 같은 게임이지만 목표를 채우면 바로 클리어.
function startChallenge(f) {
  startGame();
  state.challenge = f;
  ui.setSubmitState?.(`${f.floor}층 — ${f.goal}`);
}

// 목표를 채웠다. 서버에 보고하고 결과창을 띄운다.
async function challengeCleared() {
  const f = state.challenge;
  state.challenge = null;
  state.phase = 'over';
  input.enabled = false;
  voiceMeter.hide();
  audio.stopAmbient();
  audio.playMusic('homeMusic');
  audio.stageUp?.();
  api.recordChallenge(f.floor, f.goal, true, state.elapsed,
    auth.signedIn ? undefined : auth.displayName);
  let msg = '';
  try {
    const r = await api.clearFloor(f.floor);
    msg = `${r.cleared} / ${r.top}층 클리어`;
  } catch (e) { msg = '진행 저장에 실패했습니다.'; }
  showTowerResult(true, f, msg);
}

// 도전 결과창(성공/실패). 다시 도전하거나 탑으로 돌아간다.
function showTowerResult(win, f, msg) {
  const overlay = document.createElement('div');
  overlay.className = 'unlock-overlay';
  overlay.innerHTML =
    '<div class="unlock-card bot-result">' +
    `<div class="unlock-kicker">${win ? '🏆 층 클리어!' : '😢 실패'}</div>` +
    `<div class="bot-result-face">${win ? '🗼' : '💥'}</div>` +
    `<div class="unlock-name">${f.floor}층 — ${f.goal}</div>` +
    `<div class="unlock-hint">${msg}</div>` +
    '<div class="bot-result-row">' +
    '<button type="button" class="ghost small tower-again">다시</button>' +
    '<button type="button" class="primary small tower-back">탑으로</button>' +
    '</div></div>';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('.tower-again').addEventListener('click', () => { close(); startChallenge(f); });
  overlay.querySelector('.tower-back').addEventListener('click', () => { close(); goHome(); openTower(); });
}

// ── 봇전(연습) ──────────────────────────────────────────────
// 봇이랑 나란히 같은 빔을 피하다가 오래 버티는 쪽이 승리. 서버·랭킹과 무관한
// 연습 모드다. 난이도(초보~고인물)는 봇 AI 의 실력만 바꾼다.
function startBotMatch(tier) {
  state.mode = 'bot';
  state.hardcore = false;
  state.voice = false;
  player.body.maxJumps = PLAYER.maxJumps;
  hazards.setMods(null);
  floorHoles.setActive(false);
  versus.hide(); pause.hide();
  state.paused = false;
  audio.unlock();
  audio.startAmbient();
  audio.playMusic('music');

  const seed = (Math.random() * 2 ** 31) | 0;
  rec = null;            // 봇전은 다시보기 저장 안 함
  input.voiceOnly = false;

  // 나와 봇을 서로 반대편에서 시작(가까이 시작하면 초반이 불공평).
  const a = Math.random() * Math.PI * 2, r = 4.5;
  player.reset(Math.cos(a) * r, Math.sin(a) * r);
  rival.reset(-Math.cos(a) * r, -Math.sin(a) * r);
  rival.mesh.visible = true; rival.blob.visible = true; rival.halo.visible = true;
  player.setLabel('나', '#4fd6ff');
  rival.setLabel(`봇 · ${BOT_TIERS[tier]?.name ?? ''}`, '#c07dff');

  state.botAI = new BotAI(tier);
  state.botAlive = true;
  state.botTier = tier;
  state.botInvuln = 0;

  setArenaVisible(true);
  hazards.reset(seed);
  coins.setActive(false);
  runCoins = 0;
  state.phase = 'playing';
  renderNotice();
  state.elapsed = 0;
  state.deathTimer = 0;
  state.cause = 'zap';
  input.enabled = true;
  input.releaseAll();
  ui.showGame();
  ui.updateHud(0);
}

// 봇전 종료. win 이면 내가 봇보다 오래 버틴 것.
function endBotMatch(win) {
  state.phase = 'over';
  state.botAI = null;
  input.enabled = false;
  voiceMeter.hide();
  audio.stopAmbient();
  audio.playMusic('homeMusic');
  if (win) audio.stageUp?.(); else audio.death?.();
  const secs = state.elapsed;
  // 봇전도 논 시간만큼 룰렛 누적 초가 쌓인다(관리자는 룰렛 무제한이라 제외).
  if (!isAdmin) wallet.addPlaytime(secs);
  hideRival();
  api.recordBotMatch(state.botTier, win, secs, auth.signedIn ? undefined : auth.displayName);
  showBotResult(win, secs, state.botTier);
}

// 봇전 결과 오버레이(승리/패배 + 버틴 시간 + 다시/나가기).
function showBotResult(win, secs, tier) {
  const tname = BOT_TIERS[tier]?.name ?? '';
  const overlay = document.createElement('div');
  overlay.className = 'unlock-overlay';
  overlay.innerHTML =
    '<div class="unlock-card bot-result">' +
    `<div class="unlock-kicker">${win ? '🏆 승리!' : '😢 패배'}</div>` +
    `<div class="bot-result-face">${win ? '🎉' : '🤖'}</div>` +
    `<div class="unlock-name">${win ? `봇(${tname})을 이겼어요` : `봇(${tname})에게 졌어요`}</div>` +
    `<div class="unlock-hint">${secs.toFixed(2)}초 버팀</div>` +
    '<div class="bot-result-row">' +
    `<button type="button" class="ghost small bot-again">다시</button>` +
    `<button type="button" class="primary small bot-exit">나가기</button>` +
    '</div></div>';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('.bot-again').addEventListener('click', () => { close(); startBotMatch(tier); });
  overlay.querySelector('.bot-exit').addEventListener('click', () => { close(); goHome(); });
}

// 난이도 고르는 오버레이. 고르면 그 난이도로 봇전 시작.
function pickBotDifficulty() {
  const overlay = document.createElement('div');
  overlay.className = 'modal bot-pick';
  const btns = Object.entries(BOT_TIERS)
    .map(([k, v]) => `<button type="button" class="bot-tier" data-tier="${k}">${v.name}</button>`).join('');
  overlay.innerHTML =
    '<div class="modal-card panel" style="max-width:360px">' +
    '<div class="modal-head"><h2>봇전 난이도</h2>' +
    '<button type="button" class="icon-btn bot-pick-close" aria-label="닫기">✕</button></div>' +
    '<p class="board-hint">봇이랑 같은 빔을 피하다가 오래 버티는 쪽이 승리! (연습 · 랭킹 반영 안 됨)</p>' +
    `<div class="bot-tier-list">${btns}</div></div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.bot-pick-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  for (const b of overlay.querySelectorAll('.bot-tier')) {
    b.addEventListener('click', () => { close(); startBotMatch(b.dataset.tier); });
  }
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
  state.mode = 'solo';
  state.botAI = null;
  hideRival();
  input.enabled = false;
  audio.stopAmbient();
  audio.playMusic('homeMusic');
  versus.hide();
  voiceMeter.hide();
  floorHoles.setActive(false);
  coins.setActive(false);
  setArenaVisible(false);
  ui.showTitle();
  renderNotice();
  refreshPlayCount(true);   // 방금 한 판이 더해진 걸 굴려 올리며 보여 준다
  claimCoinsNow();          // 판 중이라 미뤄 뒀던 선물이 있으면 여기서 받는다
}

// ── 다시보기 재생 ──────────────────────────────────────────
// 기록(seed + 프레임)을 실제 무대에서 다시 돌려 보여 준다. 입력을 새로 받지
// 않고 기록된 값을 그대로 시뮬에 먹인다 → 그때 그 판이 눈앞에 재현된다.
// 시뮬이 순수 함수라, 아무 초로 점프하려면 처음부터 그 지점까지 눈 깜짝할
// 새에 다시 돌리면 된다(탐색바).
const replayBar = (() => {
  const el = document.createElement('div');
  el.id = 'replay-bar';
  el.className = 'hidden';
  el.innerHTML =
    '<div class="replay-row">' +
      '<span class="replay-tag">▶ 다시보기</span>' +
      '<span id="replay-who"></span>' +
      '<span id="replay-time" class="replay-time">0.00 / 0.00초</span>' +
      '<button id="replay-exit" type="button">나가기</button>' +
    '</div>' +
    '<input id="replay-seek" class="replay-seek" type="range" min="0" max="1000" value="0" step="1" ' +
    'aria-label="재생 위치" />';
  document.body.appendChild(el);
  const who = el.querySelector('#replay-who');
  const timeEl = el.querySelector('#replay-time');
  const seek = el.querySelector('#replay-seek');

  el.querySelector('#replay-exit').addEventListener('click', () => endReplay());
  // 탐색바를 잡으면 자동재생을 멈추고, 끌 때마다 그 초로 점프한다.
  const beginScrub = () => { if (state.replay) state.replay.scrubbing = true; };
  const endScrub = () => { if (state.replay) state.replay.scrubbing = false; };
  seek.addEventListener('pointerdown', beginScrub);
  seek.addEventListener('pointerup', endScrub);
  seek.addEventListener('input', () => {
    const rp = state.replay; if (!rp) return;
    rp.scrubbing = true;
    seekReplay((Number(seek.value) / 1000) * rp.total);
  });
  // 손을 떼면(마우스업이 바 밖에서 나도) 다시 재생
  addEventListener('pointerup', endScrub);

  return {
    show(data) {
      who.textContent = data.name ?? '';
      el.classList.remove('hidden');
    },
    // 재생 위치 표시 갱신(드래그 중이 아닐 때만 바를 움직인다).
    tick(sim, total, scrubbing) {
      timeEl.textContent = `${sim.toFixed(2)} / ${total.toFixed(2)}초`;
      if (!scrubbing) seek.value = String(total > 0 ? Math.round((sim / total) * 1000) : 0);
    },
    hide() { el.classList.add('hidden'); }
  };
})();

function startReplay(data) {
  const frames = decodeReplay(data.data);   // data.data = base64 입력 버퍼(개수는 data.frames)
  versus.hide(); hideRival(); pause.hide(); profile.close?.();
  state.paused = false;
  state.mode = 'replay';
  state.hardcore = data.mode === 'hardcore' || data.mode === 'voicehard';
  player.body.maxJumps = state.hardcore ? 1 : PLAYER.maxJumps;
  hazards.setMods(state.hardcore ? HARDCORE_MODS : null);
  floorHoles.setActive(state.hardcore, data.seed);   // 하드코어: 감전 지대(같은 씨앗으로 재현)
  coins.setActive(false);        // 재생엔 코인 없음
  input.enabled = false;

  // 게임오버·타이틀·공지 배너 등 다른 화면을 싹 내리고 무대만 남긴다.
  ui.hideAllScreens();
  noticeBanner?.classList.add('hidden');

  // 전체 길이 = 프레임 dt 합(= 그 판이 버틴 시간).
  let total = 0;
  for (let i = 0; i < frames.n; i++) total += frames.dt[i];

  setArenaVisible(true);
  hazards.reset(data.seed);
  player.reset();
  state.replay = {
    f: frames, n: frames.n, seed: data.seed, total,
    i: 0, consumed: 0, clock: 0, sim: 0,
    ended: false, deathTimer: 0, scrubbing: false
  };
  state.elapsed = 0;
  state.cause = 'zap';
  replayBar.show(data);
  replayBar.tick(0, total, false);
}

// 기록된 한 프레임을 시뮬에 먹인다. 죽으면 true.
function replayStepOnce(rp) {
  const i = rp.i++;
  const fdt = rp.f.dt[i];
  rp.consumed += fdt;
  rp.sim += fdt;
  player.update(fdt, { move: { x: rp.f.x[i], y: rp.f.y[i] }, jumpPressed: rp.f.j[i] > 0.5 });
  hazards.update(fdt, rp.sim);
  if (state.hardcore) floorHoles.update(fdt);   // 감전 지대(시드로 재현)
  if (hazards.hitTest(player)) { rp.ended = true; state.cause = 'zap'; return true; }
  if (player.body.droppedOff) { rp.ended = true; state.cause = 'fall'; return true; }
  if (state.hardcore && floorHoles.isOpenAt(player.body.x, player.body.z)) {
    rp.ended = true; state.cause = 'zap'; return true;   // 감전사
  }
  return false;
}

// 원하는 초로 점프. 처음부터 그 지점까지 렌더 없이 빠르게 다시 돌린다.
function seekReplay(targetSim) {
  const rp = state.replay;
  if (!rp) return;
  hazards.reset(rp.seed);
  if (state.hardcore) floorHoles.reset(rp.seed);   // 감전 지대도 씨앗부터 다시 돌린다
  player.reset();
  rp.i = 0; rp.consumed = 0; rp.sim = 0; rp.ended = false; rp.deathTimer = 0;
  while (rp.i < rp.n && rp.sim < targetSim) {
    if (replayStepOnce(rp)) break;   // 그 판이 죽는 지점을 넘겨 잡으면 거기서 멈춘다
  }
  rp.clock = rp.consumed;            // 재생 시계도 맞춰 이어서 재생되게
  replayBar.tick(rp.sim, rp.total, true);
}

function stepReplay(dt) {
  const rp = state.replay;
  if (!rp) return;

  // 탐색바를 잡고 있는 동안은 그 자리에 멈춰 있는다(seek 가 위치를 잡는다).
  if (rp.scrubbing) return;

  if (rp.ended) {
    // 끝났으면 죽는 연출만 잠깐 더 보이고 그 뒤 정지(자동으로 안 나간다).
    if (rp.deathTimer > 0) { hazards.update(dt, rp.sim); playDeathAnim(dt); rp.deathTimer -= dt; }
    return;
  }

  rp.clock += dt;
  // 실제 시간에 맞춰(1배속) 기록된 프레임을 소비한다. 한 프레임에 너무 많이
  // 따라잡지 않게 상한을 둔다(탭 복귀 등으로 clock 이 튀는 경우).
  let guard = 0;
  while (rp.i < rp.n && rp.consumed < rp.clock && guard++ < 240) {
    if (replayStepOnce(rp)) { rp.deathTimer = 1.4; break; }
  }
  if (rp.i >= rp.n && !rp.ended) rp.ended = true;   // 사망 미검출로 끝까지 재생됨
  replayBar.tick(rp.sim, rp.total, false);
}

function endReplay() {
  state.replay = null;
  replayBar.hide();
  state.mode = 'solo';
  goHome();
}

// 프로필의 '다시보기' 버튼이 부른다. 서버에서 기록을 받아 재생한다.
async function watchReplay(scoreId) {
  try {
    const data = await api.getReplay(scoreId);
    startReplay(data);
  } catch (err) {
    alert('다시보기를 불러오지 못했습니다: ' + (err?.message ?? ''));
  }
}

function killPlayer(cause) {
  state.phase = 'dying';
  state.cause = cause;
  voiceMeter.hide();        // 죽으면 음성 바를 내린다
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

// 관리자가 준 코인을 받았을 때 띄우는 선물 안내.
function showCoinGift(count, message = '') {
  return new Promise((resolve) => {
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const overlay = document.createElement('div');
    overlay.className = 'unlock-overlay';
    overlay.innerHTML =
      '<div class="unlock-card">' +
      '<div class="unlock-kicker">🎁 선물 도착!</div>' +
      '<div class="unlock-lockface">🪙</div>' +
      '<div class="unlock-name">코인 ' + count + '개를 받았어요</div>' +
      (message ? '<div class="coin-gift-msg">“' + esc(message) + '”</div>' : '') +
      '<div class="unlock-hint">화면을 누르면 넘어가요</div></div>';
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

// 판이 끝나 새 칭호를 얻었을 때 띄우는 축하 연출(캐릭터 해금과 같은 스타일).
// 여러 개면 하나씩 넘긴다. 화면을 누르면 건너뛴다.
function showTitleUnlock(list) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'unlock-overlay';
    overlay.innerHTML =
      '<div class="unlock-card">' +
      '<div class="unlock-kicker">🏆 새 칭호 획득!</div>' +
      '<div class="unlock-lockface">🏷️</div>' +
      '<div class="unlock-name"></div>' +
      '<div class="unlock-hint">프로필에서 장착할 수 있어요 · 화면을 누르면 넘어가요</div></div>';
    document.body.appendChild(overlay);
    const nameEl = overlay.querySelector('.unlock-name');
    requestAnimationFrame(() => overlay.classList.add('show'));
    let i = 0, timer = null;
    const done = () => {
      clearTimeout(timer);
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); resolve(); }, 260);
    };
    const next = () => {
      if (i >= list.length) { done(); return; }
      nameEl.textContent = `「${list[i++].name}」`;
      nameEl.style.animation = 'none';
      void nameEl.offsetWidth;
      nameEl.style.animation = 'unlockPop 0.5s ease-out';
      timer = setTimeout(next, 1900);
    };
    overlay.addEventListener('click', done);
    next();
  });
}

// 게스트가 칭호 조건을 채웠을 때. 칭호는 계정에 저장돼서 게스트는 받아 둘 곳이
// 없다 — 얻었다고 하면 거짓말이니, '로그인하면 받을 수 있다'고 알려 준다.
// 조건을 넘긴 그 순간 한 번만 뜬다.
function showTitleLoginPrompt(names) {
  if (!names?.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'unlock-overlay';
  overlay.innerHTML =
    '<div class="unlock-card">' +
    '<div class="unlock-kicker">🔒 칭호 조건 달성!</div>' +
    '<div class="unlock-lockface">🏷️</div>' +
    '<div class="unlock-name"></div>' +
    '<div class="unlock-hint">칭호는 계정에 저장돼요 · 로그인하면 바로 받을 수 있어요</div>' +
    '<button type="button" class="unlock-login">구글로 로그인</button>' +
    '<div class="unlock-hint dim-hint">화면을 누르면 넘어가요</div></div>';
  document.body.appendChild(overlay);
  overlay.querySelector('.unlock-name').textContent =
    names.map((n) => `「${n}」`).join(' ');
  requestAnimationFrame(() => overlay.classList.add('show'));

  const close = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 260);
  };
  overlay.querySelector('.unlock-login').addEventListener('click', (e) => {
    e.stopPropagation();          // 닫기보다 로그인이 먼저
    location.href = '/auth/google';
  });
  overlay.addEventListener('click', close);
  setTimeout(close, 5200);        // 읽을 시간은 주되 알아서 사라지게
}

// 이 초 이상 버텨야 그 판에 먹은 코인을 인정한다(먹고 바로 죽는 파밍 방지).
const MIN_COIN_SECONDS = 10;

async function finishGame() {
  state.phase = 'over';
  floorHoles.setActive(false);   // 바닥 구멍 정리
  audio.stopAmbient();
  // 판이 끝났으니 긴장을 푼다. 결과 화면은 첫 화면과 같은 곡으로.
  audio.playMusic('homeMusic');
  const score = state.elapsed;

  // 도전모드 중 죽었으면 그 층 실패. 랭킹엔 올리지 않는다.
  if (state.challenge) {
    const f = state.challenge;
    state.challenge = null;
    voiceMeter.hide();
    if (!isAdmin) wallet.addPlaytime(score);   // 도전모드도 룰렛 초가 쌓인다
    api.recordChallenge(f.floor, f.goal, false, score,
      auth.signedIn ? undefined : auth.displayName);
    showTowerResult(false, f, `${score.toFixed(2)}초 버팀`);
    return;
  }

  // 이번 판 시간을 누적 게임 시간에 더한다(룰렛 횟수의 원천). 관리자는 룰렛이
  // 무제한이라 쌓을 필요가 없다.
  if (!isAdmin) wallet.addPlaytime(score);

  // 이번 판으로 새로 열린 캐릭터가 있으면, 결과창 전에 해금 연출을 띄운다.
  // 최고기록은 showGameOver 가 갱신하므로, 지금 읽으면 '이전' 최고기록이다.
  // 관리자는 이미 전부 해금이라(기록이 집계 제외라 최고가 낮게 잡혀 매판 다시
  // 뜨는 문제도 있어) 해금 연출을 아예 띄우지 않는다.
  const prevBest = bestSeconds();
  const freshUnlocks = isAdmin ? [] : PLAYABLE.filter(
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

  ui.showGameOver(score, state.cause, state.hardcore);

  // 모드마다 랭킹이 따로 있다(버티기·하드코어·마이크·마이크 하드코어).
  const mode = state.runMode ?? runModeOf(state.hardcore, state.voice);
  const board = MODE_BOARD[mode] ?? 'time';
  const tag = { normal: '', hardcore: '🔥 하드코어 ', voice: '🎤 마이크 ', voicehard: '🎤🔥 마이크·하드코어 ' }[mode] ?? '';

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

    // 이번 판으로 새 칭호를 얻었으면 축하 연출을 띄운다. 게스트는 조건만 채운
    // 것이므로(계정이 없어 저장할 곳이 없다) 로그인 안내를 대신 띄운다.
    if (result.newTitles?.length) {
      if (result.titlesLocked) showTitleLoginPrompt(result.newTitles.map((t) => t.name));
      else await showTitleUnlock(result.newTitles);
    }

    // 이 판이 그 사람의 최고 기록이면 다시보기를 서버에 올린다(관리자만 봄).
    // rec 은 일반 모드에서만 만들어지고, 최고 기록일 때만(me.time 과 일치) 올린다.
    if (!result.excluded && result.id && rec && rec.dt.length > 30) {
      const rounded = Math.round(score * 100) / 100;
      if (result.me && Math.abs(result.me.time - rounded) < 0.005) {
        api.saveReplay({
          scoreId: result.id, seed: rec.seed, mode: rec.mode,
          time: rounded, frames: rec.dt.length, data: encodeReplay(rec),
          name: auth.signedIn ? undefined : auth.displayName
        }).catch(() => {});
      }
    }
  } catch (err) {
    ui.setSubmitState(`기록 등록 실패: ${err.message}`, true);
    refreshLeaderboard(board);
  }

  // 판 중이라 미뤄 뒀던 관리자 선물이 있으면 지금 받는다. 결과 화면 위로 뜬다.
  claimCoinsNow();
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
    // 버티기·하드코어·마이크·마이크(하드코어)는 같은 기록 저장소에서 모드만 다르다.
    if (BOARD_MODE[kind]) {
      ui.renderLeaderboard(await api.top(auth.displayName, BOARD_MODE[kind]), null, kind);
      return;
    }
    if (kind === 'hall') {
      ui.renderHall((await api.hall()).seasons);
      return;
    }
    if (kind === 'tower') {   // 도전모드 — 몇 층까지 올라갔나
      ui.renderLeaderboard(await api.towerRanks(), null, kind);
      return;
    }
    if (kind === 'plays') {   // 판수 — 누가 제일 많이 했나
      ui.renderLeaderboard(await api.playRanks(auth.displayName), null, kind);
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
  input.voiceOnly = false;   // 대전은 마이크 점프를 쓰지 않는다(키/터치로)

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
  refreshPlayCount(true);   // 방금 한 판이 더해진 걸 굴려 올리며 보여 준다
  claimCoinsNow();          // 판 중이라 미뤄 뒀던 선물이 있으면 여기서 받는다
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

  // 탭이 백그라운드에 갔다 오면 dt가 튀므로 상한을 둔다.
  //
  // Math.fround 로 float32 로 깎아서 쓴다. 다시보기는 dt 를 float32 로 저장하는데
  // (encodeReplay), 판이 돌 때는 float64 로 굴리면 저장된 값과 미세하게 어긋난다.
  // 그 차이가 1e-7 쯤인데, 전기선 시뮬은 그보다 훨씬 예민하다 — dt 를 1e-8 만
  // 흔들어도 죽는 시점이 60초에서 78초로 바뀌는 걸 확인했다(스폰 타이밍이 한
  // 프레임 밀리면 그 뒤 패턴이 통째로 갈린다). 그래서 애초에 저장할 값 그대로
  // 굴려, 기록한 판과 다시보기가 한 치도 안 어긋나게 한다.
  const dt = Math.fround(Math.min(clock.getDelta(), 1 / 20));
  const now = performance.now() / 1000;

  animateAmbient(dt, now);

  if (state.mode === 'versus') {
    // 대전은 멈출 수 없다. 서버가 계속 돌기 때문에 여기서 손을 놓으면
    // 그 사이에 전기선을 맞고 죽어 있다. 메뉴만 떠 있고 게임은 흘러간다.
    stepVersus(dt);
    renderer.render(scene, camera);
    return;
  }

  if (state.mode === 'replay') {
    stepReplay(dt);
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

    // 마이크 함성을 먼저 재서(켜져 있으면) 점프 신호로 넣는다. input.poll() 이
    // 그 신호를 읽어 가므로 반드시 poll 앞에서 부른다. 그리고 왼쪽 볼륨 바 갱신.
    if (voiceOn && voiceJump.on) {
      voiceJump.poll(dt);
      voiceMeter.update(voiceJump.level, voiceJump.high, dt);
    }

    // 입력은 한 번만 읽어(기록과 시뮬이 같은 값을 쓰게), 다시보기용으로 남긴다.
    const control = input.poll();
    if (rec && rec.dt.length < REC_CAP) {
      rec.dt.push(dt); rec.x.push(control.move.x);
      rec.y.push(control.move.y); rec.j.push(control.jumpPressed ? 1 : 0);
    }
    player.update(dt, control);
    updateTrail(dt);
    hazards.update(dt, state.elapsed);
    if (state.hardcore) floorHoles.update(dt);
    coins.update(dt, player.body.x, player.body.z);   // 코인 회전·수집 판정

    // 봇전: 봇도 같은 빔을 AI 로 피한다. 먼저 죽는 쪽이 진다.
    // 상위 난이도는 맞을 뻔했을 때 save 확률로 아슬아슬하게 빠져나간다(잠깐 무적).
    if (state.botAI && state.botAlive) {
      const bc = state.botAI.think(dt, rival.body, hazards.sim);
      rival.update(dt, bc);
      if (state.botInvuln > 0) state.botInvuln -= dt;
      if (rival.body.droppedOff) {
        state.botAlive = false;
      } else if (hazards.hitTest(rival) && state.botInvuln <= 0) {
        // 목표 시간 전엔 잘 빠져나가고, 목표를 넘기면 보호가 사라진다.
        if (Math.random() < saveChanceAt(state.botTier, state.elapsed)) state.botInvuln = 0.6;
        else state.botAlive = false;
      }
    }

    const playerDead = hazards.hitTest(player) || player.body.droppedOff
      || (state.hardcore && floorHoles.isOpenAt(player.body.x, player.body.z));

    if (state.challenge && state.challenge.kind === 'survive'
        && state.elapsed >= state.challenge.seconds) {
      challengeCleared();                          // 도전모드: 목표 달성
    } else if (state.botAI) {
      if (playerDead) endBotMatch(false);          // 내가 먼저 죽음 → 패배
      else if (!state.botAlive) endBotMatch(true);  // 봇이 먼저 죽음 → 승리
    } else if (hazards.hitTest(player)) {
      killPlayer('zap');
    } else if (player.body.droppedOff) {
      killPlayer('fall');
    } else if (state.hardcore && floorHoles.isOpenAt(player.body.x, player.body.z)) {
      // 감전 지대 안에 있으면 감전사 — 점프해도 못 피하니 다른 구역으로 이동해야 한다
      killPlayer('zap');
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
    updateTrail(dt);
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
