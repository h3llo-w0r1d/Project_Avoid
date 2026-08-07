import * as THREE from 'three';
import { createWorld, fitCamera } from './scene.js';
import { Player } from './player.js';
import { Hazards } from './hazards.js';
import { Input } from './input.js';
import { UI, api } from './ui.js';
import { VersusUI } from './versus-ui.js';
import { PauseUI } from './pause-ui.js';
import { Auth } from './auth.js';
import { CharacterUI } from './char-ui.js';
import { ProfileUI } from './profile-ui.js';
import { AdminUI } from './admin-ui.js';
import { BoardUI } from './board-ui.js';
import { VoiceUI } from './voice-ui.js';
import { DEFAULT_CHARACTER, findCharacter, isUnlocked, isPlayable } from './characters.js';
import { Net } from './net.js';
import { Audio } from './audio.js';
import { voiceStore } from './voice-store.js';
import { ARENA_RADIUS, VOICE } from './config.js';

const canvas = document.getElementById('stage');
const world = createWorld(canvas);
const { renderer, scene, camera } = world;

// 고른 캐릭터는 브라우저에 저장한다. 해금 여부는 최고 기록으로 판단하므로
// 저장할 필요가 없다 — 기록만 있으면 언제든 다시 계산된다.
const CHAR_KEY = 'avoidarc.character';

function savedCharacter() {
  const id = localStorage.getItem(CHAR_KEY) ?? DEFAULT_CHARACTER;
  const spec = findCharacter(id);
  // 저장해 둔 캐릭터가 아직 안 열렸거나(기록을 지웠다면), 다듬는 중으로
  // 내려간 캐릭터면 기본으로 되돌린다. 전에 골라 둔 사람이 그대로 쓰고
  // 있으면 "화면에서 없앴는데 계속 보인다" 가 된다.
  return isPlayable(spec) && isUnlocked(spec, bestSeconds()) ? spec.id : DEFAULT_CHARACTER;
}

function bestSeconds() {
  return Number(localStorage.getItem('voltline.best')) || 0;
}

const player = new Player(scene, { characterId: savedCharacter() });
// 상대는 발밑 링 색으로 구분한다. 캐릭터는 상대가 고른 걸 그대로 보여 준다.
const rival = new Player(scene, { haloColor: 0xc07dff });
rival.mesh.visible = false;
rival.blob.visible = false;
rival.halo.visible = false;

const hazards = new Hazards(scene);
const input = new Input();
const net = new Net();

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
  onSetupOpen: () => ui.hideAllScreens(),
  onSetupDone: () => ui.showTitle()
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

// 관리 창. 서버가 "너는 관리자다" 라고 할 때만 버튼이 뜬다.
// 버튼을 감추는 건 눈에 안 띄게 하려는 것뿐이고, 실제로 막는 건 서버다.
const admin = new AdminUI({
  load: () => api.adminOverview(),
  removeScore: (id) => api.adminRemoveScore(id),
  clearScores: () => api.adminClearScores(),
  clearUsage: () => api.adminClearUsage(),
  resetUser: (id) => api.adminResetUser(id),
  matchesOf: (id) => api.adminMatches(id)
});

// 게시판에서 관리자에게만 삭제 버튼을 보여 줄지 정한다. 실제 삭제는 서버가 막는다.
let isAdmin = false;
api.amIAdmin()
  .then((yes) => { isAdmin = yes; admin.setAdmin(yes); })
  .catch(() => admin.setAdmin(false));

// 자유 게시판. 게스트는 이름을 같이 보내고, 로그인했으면 서버가 계정 닉네임을 쓴다.
const board = new BoardUI({
  list: () => api.boardList(),
  post: (body) => api.boardPost(body, auth.signedIn ? undefined : auth.displayName),
  remove: (id) => api.boardRemove(id),
  isAdmin: () => isAdmin
});

const characters = new CharacterUI({
  bestSeconds,
  selected: () => player.characterId,
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
  if (canShow) btn.classList.remove('hidden');

  // head 스크립트가 신호를 나중에 잡으면 알려 준다.
  addEventListener('install-available', () => { deferred = window.__deferredInstall || deferred; });
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (canShow) btn.classList.remove('hidden');
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
      msg = '지금은 카카오톡·인스타 등 앱 안의 브라우저예요. ' +
        '오른쪽 위 ⋮(또는 공유) → "다른 브라우저로 열기 / Chrome으로 열기" 로 ' +
        '크롬에서 연 다음 이 버튼을 다시 누르면 설치돼요.';
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
  state.phase = 'playing';
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
  setArenaVisible(false);
  ui.showTitle();
}

function killPlayer(cause) {
  state.phase = 'dying';
  state.cause = cause;
  state.deathTimer = cause === 'fall' ? 0.35 : 0.75;
  input.enabled = false;
  if (cause === 'zap') {
    ui.flashZap();
    audio.death();
  } else {
    audio.fall();
  }
}

async function finishGame() {
  state.phase = 'over';
  audio.stopAmbient();
  // 판이 끝났으니 긴장을 푼다. 결과 화면은 첫 화면과 같은 곡으로.
  audio.playMusic('homeMusic');
  const score = state.elapsed;
  ui.showGameOver(score, state.cause);

  // 1초도 못 버틴 기록은 랭킹을 어지럽히므로 올리지 않는다
  if (score < 1) {
    ui.setSubmitState('1초 이상 버텨야 랭킹에 등록됩니다');
    refreshLeaderboard();
    return;
  }

  ui.setSubmitState('기록 등록 중…');
  try {
    const ticket = await state.ticket;
    // 로그인했으면 서버가 계정 닉네임을 쓴다. 여기서 보내는 이름은 게스트용.
    const result = await api.submit(auth.displayName, score, ticket);
    ui.setSubmitState(result.rank ? `전체 ${result.rank}위 등록!` : '기록이 등록되었습니다');
    ui.renderLeaderboard(result, result.id, 'time');
  } catch (err) {
    ui.setSubmitState(`기록 등록 실패: ${err.message}`, true);
    refreshLeaderboard();
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

    if (hazards.hitTest(player)) {
      killPlayer('zap');
    } else if (player.body.droppedOff) {
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
