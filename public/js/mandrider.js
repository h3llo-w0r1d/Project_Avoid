import * as THREE from 'three';
import { buildPlant } from './plant.js';
import { bounceOff, constrainToRoad, createKartState, stepKart, KART } from './mandrider-physics.js';
import { MAPS, buildTrack, drawCourse, sampleCourse } from './mandrider-track.js';

const canvas = document.getElementById('race-stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ed5ff);
scene.fog = new THREE.Fog(0x8ed5ff, 650, 1900);
const camera = new THREE.PerspectiveCamera(70, 1, 0.8, 2400);
scene.add(new THREE.HemisphereLight(0xf4fff0, 0x55625a, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.position.set(-45, 90, 55);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -85;
sun.shadow.camera.right = sun.shadow.camera.top = 85;
scene.add(sun);
scene.add(sun.target);

const minimap = document.getElementById('minimap');
const minimapContext = minimap.getContext('2d');

let raceSky;
new THREE.TextureLoader().load('./img/mandrider-sky-v1.webp', (texture) => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // 카메라가 기울 때 배경도 같이 기운다. 화면 한가운데를 축으로 돌려야
  // 기울기만 생기고 그림이 딸려 움직이지 않는다.
  texture.center.set(.5, .5);
  raceSky = texture;
  if (raceActive) scene.background = raceSky;
});

// 맵마다 도로 폭이 달라 트랙은 고른 다음에 짓는다. 둘 다 미리 지어 두면
// 고르지 않은 맵의 지형까지 화면에 같이 남는다.
let track = null;

function makeKart() {
  const kart = new THREE.Group();
  const potMat = new THREE.MeshStandardMaterial({ color: 0xc7613f, roughness: 0.72 });
  const darkPot = new THREE.MeshStandardMaterial({ color: 0x753621, roughness: 0.85 });

  // 바퀴 없이 화분만 굴러간다. 바닥에 바로 닿도록 높이를 맞췄다 —
  // 카트 원점이 노면보다 0.06 아래라 화분 밑동을 거기에 둔다.
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.68, 1.28, 24), potMat);
  pot.position.set(0, 0.70, 0);
  pot.castShadow = true;
  kart.add(pot);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.13, 10, 28), darkPot);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 1.34, 0);
  rim.castShadow = true;
  kart.add(rim);

  const plant = buildPlant('mandragora');
  plant.scale.setScalar(1.05);
  plant.position.set(0, 0.96, 0);
  kart.add(plant);

  // 부스터 불꽃 — 좌우 두 줄기. 한 줄기를 굵기와 길이가 다른 세 겹으로 겹친다.
  // 한 겹짜리 원뿔은 단면이 또렷해 기둥처럼 보인다. 겹쳐 쌓아야 가운데가 밝고
  // 바깥으로 갈수록 옅어져 불처럼 번진다(더하기 혼합).
  const flames = new THREE.Group();
  // 뾰족한 끝을 뒤(+Z)로 돌리고 밑동을 원점에 붙여, scale.z 가 곧 길이가 되게 한다.
  const flameGeo = new THREE.ConeGeometry(1, 1, 12, 1, true);
  flameGeo.rotateX(Math.PI / 2);
  flameGeo.translate(0, 0, .5);
  const plumes = [];
  for (const x of [-.5, .5]) {
    for (const [color, radius, length, opacity] of [
      [0xffffff, .26, 3.0, .95],   // 속심지 — 가장 밝고 짧다
      [0x7fe0ff, .44, 6.2, .5],
      [0x2f8bff, .66, 9.4, .26]    // 겉불꽃 — 옅게 멀리 번진다
    ]) {
      const layer = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      layer.position.set(x, .5, .8);
      layer.scale.set(radius, radius, length);
      flames.add(layer);
      plumes.push({ layer, radius, length });
    }
  }
  flames.visible = false;
  kart.add(flames);

  kart.userData = { plant, flames, plumes };
  return kart;
}

const kart = makeKart();
scene.add(kart);
kart.visible = false;

// 길을 막고 돌아다니는 큰 만드라고라. 맵이 정한 수만큼 코스 전체에 고르게 세운다.
const GIANT_SCALE = 4.4;          // 기본 몸집
const GIANT_BODY = 2.53;          // 그 몸집일 때 몸통 반지름(잎은 빼고 잰 값)
const KART_ROOM = 1.07;           // 카트 몸집. 둘을 더한 값이 부딪치는 거리다.

// 몸집을 섞는다 — 스물 중 둘은 두 배, 절반은 1.5배, 나머지는 기본이다.
// 홀수 자리를 1.5배로 두면 큰 놈과 기본이 번갈아 서고, 두 배짜리 둘은 코스
// 앞뒤로 하나씩 떨어져 한쪽에만 몰리지 않는다.
const sizeOf = (i, total) =>
  (i === Math.round(total * .2) || i === Math.round(total * .7) ? 2 : i % 2 ? 1.5 : 1);
let giants = [];
// 자리는 세계 좌표가 아니라 '코스 어디쯤(along) · 길 가운데서 얼마나 옆(across)'
// 으로 잡는다. 헤어핀이 이어지는 코스라 세계 좌표로 곧게 움직이면 길 밖으로
// 걸어 나가 버린다. 코스를 따라 재면 어느 구간에서든 길 위에 남는다.
const GIANT_MOVES = ['cross', 'along', 'circle'];

// 붉은 쪽은 닿으면 그 자리에서 끝이다. 색으로만 구별되므로 확실히 붉어야 한다 —
// 원래 색과 섞지 않고 붉은색으로 덮고, 스스로 빛나게 해 그늘에서도 붉게 보인다.
function paintDeadly(body) {
  body.traverse((part) => {
    if (!part.isMesh) return;
    // 재질은 여러 부위가 나눠 쓰므로 반드시 복제한다. 그냥 칠하면 화분 카트의
    // 만드라고라까지 같이 붉어진다.
    part.material = part.material.clone();
    part.material.color?.set(0xd61f24);
    part.material.emissive?.set(0x4a0206);
  });
}

function buildGiants(map) {
  const samples = track.trackSamples;
  const safe = map.giants ?? 0;
  const killers = map.killers ?? 0;
  const total = safe + killers;
  // 스무 마리를 한 줄로 세우고 그 안에서 붉은 쪽을 골라 낸다. 초록과 붉은 것의
  // 자리를 따로 잡았더니 코스 한가운데에서 둘이 겹쳐 섰다 — 초록인 줄 알고
  // 들이받으면 죽는 판이 된다. 한 줄에서 고르면 그런 일이 생길 수 없다.
  return Array.from({ length: total }, (_, i) => {
    const deadly = Math.floor((i + 1) * killers / total) > Math.floor(i * killers / total);
    const size = sizeOf(i, total);
    // 몸집이 크면 부딪치는 거리도 커지고, 그만큼 오갈 수 있는 폭은 좁아진다.
    const radius = GIANT_BODY * size + KART_ROOM;
    const reach = track.halfWidth - radius;
    const spin = Math.min(reach, 8.5);   // 원을 그리려면 가로세로 폭이 같아야 한다
    const body = buildPlant('mandragora');
    body.scale.setScalar(GIANT_SCALE * size);
    if (deadly) paintDeadly(body);
    body.traverse((part) => { if (part.isMesh) part.castShadow = true; });
    scene.add(body);
    // 3(움직임)과 5(속도)는 서로 나눠떨어지지 않아 조합이 골고루 섞인다.
    const move = GIANT_MOVES[i % GIANT_MOVES.length];
    return {
      body,
      deadly,
      radius,
      // 출발선 앞뒤는 비워 둔다 — 카운트다운이 끝나자마자 막히면 억울하다.
      at: Math.round((i + 1) / (total + 1) * samples.length),
      move,
      // 붉은 쪽은 조금 더 빠르다. 피하는 재미가 있으려면 움직임이 읽혀야 하니 두 배까지는 안 간다.
      rate: (.28 + (i % 5) * .15) * (deadly ? 1.35 : 1),
      phase: i * 1.37 + (deadly ? .8 : 0),
      across: move === 'cross' ? reach : move === 'circle' ? spin : 0,
      along: move === 'cross' ? 0 : move === 'circle' ? spin : 26,
      // 길 따라 오가는 쪽은 한가운데를 비켜 한 차선에 선다. 좌우로 갈라 세운다.
      lane: move === 'along' ? (i % 2 ? 1 : -1) * reach * .45 : 0,
      x: 0, z: 0, lastX: 0, lastZ: 0
    };
  });
}

// 붉은 만드라고라에 닿았다. 그 자리에서 판이 끝난다 — 기록은 남지 않는다.
function killRun() {
  if (raceFinished) return;
  raceFinished = true;
  state.speed = state.lateral = 0;
  // 문구는 짧게. 왜 죽었는지는 바로 앞의 붉은 만드라고라가 말해 준다.
  state.notice = 'GAMEOVER';
  state.noticeTimer = 3600;
  runTicket = null;
  // 완주는 올라가는 세 음이었다. 이쪽은 내려가는 두 음으로 반대로 들린다.
  beep(320, .22, .22);
  beep(150, .8, .2, .2);
}

// 저마다 다른 모양으로 돌아다닌다. 부딪치는 판정도 이 자리에서 하므로 그리기가
// 아니라 물리 차례에 부른다 — 화면만 늦게 그려지는 프레임에서 판정이 어긋나면 안 된다.
function moveGiants() {
  const samples = track.trackSamples;
  // 코스 지점은 길이로 고르게 잡혀 있다. 한 칸이 몇 걸음인지 재 두면
  // '코스를 따라 얼마나' 를 지점 수로 바꿀 수 있다.
  const step = samples[0].distanceTo(samples[1]);
  for (const giant of giants) {
    const wave = state.elapsed * giant.rate + giant.phase;
    // 원을 그리는 쪽만 가로세로가 90° 어긋나야 한다. 나머지는 폭이 0 이라 절로 꺼진다.
    const across = giant.lane + (giant.move === 'circle' ? Math.cos(wave) : Math.sin(wave)) * giant.across;
    const along = Math.sin(wave) * giant.along;
    const at = (giant.at + Math.round(along / step) % samples.length + samples.length) % samples.length;
    const point = samples[at];
    const normal = track.trackNormals[at];
    giant.lastX = giant.x;
    giant.lastZ = giant.z;
    giant.x = point.x + normal.x * across;
    giant.z = point.z + normal.y * across;
    // 가는 쪽을 보고 걷는다. 걸음마다 통통 튀어야 살아 있는 것처럼 보인다.
    const dx = giant.x - giant.lastX;
    const dz = giant.z - giant.lastZ;
    giant.body.position.set(giant.x, point.y + 2 + Math.abs(Math.sin(wave * 6)) * .55, giant.z);
    if (Math.hypot(dx, dz) > .002) giant.body.rotation.y = Math.atan2(dx, dz);
  }
}

// 드리프트 자국. 카트를 따라다니면 안 되고 노면에 남아야 하므로 씬에 직접 붙인다.
// 정해진 개수를 돌려 쓴다 — 오래된 것부터 덮어써서 꼬리가 일정 길이로 유지된다.
const MARK_COUNT = 160;
const markGeo = new THREE.PlaneGeometry(1, 1);
markGeo.rotateX(-Math.PI / 2);
const marks = new THREE.InstancedMesh(
  markGeo,
  // 노면(y=2)보다 살짝 위, 차선(2.06)보다는 아래에 깔아 z 다툼을 피한다.
  new THREE.MeshBasicMaterial({ color: 0x40202a, transparent: true, opacity: .5, depthWrite: false }),
  MARK_COUNT
);
marks.frustumCulled = false;
scene.add(marks);
const markMatrix = new THREE.Matrix4();
const markQuaternion = new THREE.Quaternion();
const markUp = new THREE.Vector3(0, 1, 0);
const markScale = new THREE.Vector3();
const markPosition = new THREE.Vector3();
let markIndex = 0;
let markLastX = 0;
let markLastZ = 0;

function clearMarks() {
  markScale.set(0, 0, 0);
  markPosition.set(0, -50, 0);
  markQuaternion.identity();
  for (let i = 0; i < MARK_COUNT; i++) {
    marks.setMatrixAt(i, markMatrix.compose(markPosition, markQuaternion, markScale));
  }
  marks.instanceMatrix.needsUpdate = true;
  markIndex = 0;
}
clearMarks();

// 미끄러지는 동안 일정 거리마다 좌우로 한 쌍씩 찍는다. 매 프레임 찍으면
// 느릴 때 뭉치고 빠를 때 끊긴다.
function dropMarks() {
  const moved = Math.hypot(state.x - markLastX, state.z - markLastZ);
  if (moved < .9) return;
  markLastX = state.x;
  markLastZ = state.z;
  const rightX = Math.cos(state.heading);
  const rightZ = Math.sin(state.heading);
  markQuaternion.setFromAxisAngle(markUp, -state.heading);
  markScale.set(.42, 1, 1.5);
  for (const side of [-1, 1]) {
    markPosition.set(state.x + rightX * side * .62, groundY + 2.02, state.z + rightZ * side * .62);
    marks.setMatrixAt(markIndex, markMatrix.compose(markPosition, markQuaternion, markScale));
    markIndex = (markIndex + 1) % MARK_COUNT;
  }
  marks.instanceMatrix.needsUpdate = true;
}

const keys = Object.create(null);
const pressed = new Set();
const keyAction = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'brake', KeyS: 'brake',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ShiftLeft: 'drift', ShiftRight: 'drift', Space: 'boost', ControlLeft: 'boost', ControlRight: 'boost',
  Up: 'up', Down: 'brake', Left: 'left', Right: 'right',
  w: 'up', s: 'brake', a: 'left', d: 'right', Shift: 'drift', Control: 'boost', ' ': 'boost'
};

addEventListener('keydown', (event) => {
  if (event.code === 'Escape') location.href = '/';
  if (event.code === 'KeyR' && raceActive) reset();
  const action = keyAction[event.code] ?? keyAction[event.key];
  if (!action) return;
  event.preventDefault();
  if (!event.repeat && !keys[action]) pressed.add(action);
  keys[action] = true;
});
addEventListener('keyup', (event) => {
  const action = keyAction[event.code] ?? keyAction[event.key];
  if (action) keys[action] = false;
});
addEventListener('blur', () => { for (const key of Object.keys(keys)) keys[key] = false; });

for (const button of document.querySelectorAll('[data-drive]')) {
  const action = button.dataset.drive;
  const down = (event) => {
    event.preventDefault();
    if (!keys[action]) pressed.add(action);
    keys[action] = true;
    button.classList.add('on');
    button.setPointerCapture?.(event.pointerId);
  };
  const up = (event) => {
    event.preventDefault();
    keys[action] = false;
    button.classList.remove('on');
  };
  button.addEventListener('pointerdown', down);
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('lostpointercapture', up);
}

// 카운트다운 소리. 소리 파일을 두지 않고 그때그때 만들어 낸다 — 짧은 삐 소리
// 하나뿐이라 내려받을 것이 없다. AudioContext 는 브라우저가 클릭 전에는 못 만들게
// 막으므로 출발 버튼을 누를 때 만든다.
let audioContext = null;
// delay 를 주면 그만큼 뒤에 울린다 — 두 음을 이어 붙여 '딩동' 을 만들 때 쓴다.
function beep(frequency, seconds, volume, delay = 0) {
  if (!audioContext) return;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = 'square';
  osc.frequency.value = frequency;
  const at = audioContext.currentTime + delay;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + .012);
  // 뚝 끊으면 '딱' 하고 잡음이 섞인다. 끝을 완만히 줄인다.
  gain.gain.exponentialRampToValueAtTime(.0001, at + seconds);
  osc.connect(gain).connect(audioContext.destination);
  osc.start(at);
  osc.stop(at + seconds + .03);
}

// 타이어 끼익 소리. 잡음을 만들어 좁은 대역만 통과시키면 미끄러지는 소리가 된다.
// 한 번 켜 두고 소리 크기만 여닫는다 — 드리프트마다 새로 만들면 딱딱 끊긴다.
let screech = null;
function startScreech() {
  if (!audioContext || screech) return;
  const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = audioContext.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2100;
  filter.Q.value = 11;            // 좁게 조일수록 '쉬익' 이 아니라 '끼익' 에 가까워진다
  const gain = audioContext.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(audioContext.destination);
  source.start();
  screech = { gain, filter };
}

// 한 판에 도는 바퀴 수. 화면 표시와 완주 판정이 같은 값을 봐야 한다.
const LAPS = 2;

let state = createKartState();
let raceActive = false;
let raceFinished = false;
let lap = 1;
let lapArmed = false;
let previousProgress = 0;
let lastCount = 0;
// 바퀴를 넘긴 알림. 남은 시간 대신 '언제까지' 를 들고 있으면 dt 를 넘길 일이 없다.
let lapBanner = '';
let lapBannerUntil = 0;

function reset() {
  state = createKartState();
  state.x = track.start.x;
  state.z = track.start.z;
  state.heading = track.startHeading;
  cameraHeading = track.startHeading;
  raceFinished = false;
  askTicket();
  lap = 1;
  lapArmed = false;
  previousProgress = 0;
  lastSample = 0;
  groundY = track.start.y;
  lapBanner = '';
  lapBannerUntil = 0;
  markLastX = state.x;
  markLastZ = state.z;
  clearMarks();
  pressed.clear();
  for (const key of Object.keys(keys)) keys[key] = false;
}

let chosenMap = 'circuit';
const mapCards = [...document.querySelectorAll('.map-card')];
for (const card of mapCards) {
  // 카드 그림은 손으로 그리지 않고 실제 코스 좌표로 그린다. 주행 중 미니맵과
  // 같은 함수라 코스를 고쳐도 카드가 옛 모습으로 남지 않는다.
  const thumb = card.querySelector('.course-thumb');
  if (thumb) {
    // 그림칸에 딱 맞는 크기로 그린다. 캔버스를 CSS 로 늘리거나 줄이면 여백까지
    // 같이 줄어들어 코스가 판 밖으로 잘려 나간다.
    const box = thumb.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio, 2);
    thumb.width = Math.round(box.width * ratio);
    thumb.height = Math.round(box.height * ratio);
    const map = MAPS[card.dataset.map];
    drawCourse(thumb, sampleCourse(map, 400),
      { padding: 9 * ratio, halo: 7 * ratio, line: 3.6 * ratio, startDot: 3 * ratio,
        closed: map.closed !== false, down: !!map.sideView });
  }
  card.addEventListener('click', () => {
    chosenMap = card.dataset.map;
    for (const other of mapCards) {
      const on = other === card;
      other.classList.toggle('selected', on);
      other.setAttribute('aria-pressed', on);
    }
  });
}

// 기록 제출. 출발할 때 표를 받아 두었다가 완주 기록과 함께 낸다 — 표를 받은 뒤
// 실제로 그만큼 시간이 흘렀는지 서버가 본다(lib/tickets.js).
let runTicket = null;
function askTicket() {
  fetch('/api/mandrider/start', { method: 'POST' })
    .then((res) => res.ok && res.json())
    .then((data) => { runTicket = data?.ticket ?? null; })
    .catch(() => { runTicket = null; });
}

// 완주 기록을 올리고, 화면에 붙일 문구를 돌려준다.
async function sendRecord(seconds) {
  if (!runTicket) return '기록은 남지 않았습니다';
  const ticket = runTicket;
  runTicket = null;                 // 표는 한 번만 쓴다. 다시 달리면 새로 받는다.
  try {
    const res = await fetch('/api/mandrider/record', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 맵 이름은 관리 화면 기록에 남는다. 랭킹에 넣을지는 서버가 정한다.
      body: JSON.stringify({ ticket, seconds, map: MAPS[chosenMap]?.name ?? chosenMap })
    });
    const data = await res.json();
    if (!res.ok) return data?.error ?? '기록을 올리지 못했습니다';
    if (data.unranked) return '이 맵은 랭킹에 올라가지 않습니다';
    if (data.excluded) return '관리자 판이라 랭킹에 안 올라갑니다';
    if (data.needLogin) return '로그인하면 랭킹에 오릅니다';
    return data.improved
      ? `최고 기록! 현재 ${data.rank}위`
      : `내 최고 기록 ${(data.best / 1000).toFixed(2)}초 (${data.rank}위)`;
  } catch {
    return '기록을 올리지 못했습니다';
  }
}

// 배경음악. 효과음과 달리 파일 하나를 통째로 반복만 하면 되니 Web Audio 대신
// <audio> 를 쓴다. 자동 재생은 막혀 있어 '출발' 을 누르는 순간에 튼다.
const bgm = new window.Audio('./sounds/mandrider-bgm.mp3');
bgm.loop = true;
bgm.volume = .32;   // 드리프트 끼익 소리와 카운트다운이 묻히지 않을 만큼

// 아직 다듬는 중인 맵은 관리자에게만 보인다. 정의는 남아 있지만 고르는 화면에서만 빠진다.
for (const card of mapCards) {
  if (!MAPS[card.dataset.map]?.draft) continue;
  card.classList.add('hidden');
  fetch('/api/admin/me', { cache: 'no-store' })
    .then((res) => res.ok && res.json())
    .then((me) => { if (me?.admin) card.classList.remove('hidden'); })
    .catch(() => {});
}

document.getElementById('start-race').addEventListener('click', () => {
  const map = MAPS[chosenMap];
  track = buildTrack(scene, renderer, map, minimap);
  giants = buildGiants(map);
  document.getElementById('race-map-name').textContent = map.name;
  document.getElementById('map-select').classList.add('hidden');
  // 속도계·게이지·미니맵은 여기서부터 보인다(CSS 의 body.racing).
  document.body.classList.add('racing');
  audioContext ??= new (window.AudioContext ?? window.webkitAudioContext)();
  audioContext.resume?.();
  startScreech();
  // 소리를 막아 둔 브라우저도 있으니 실패해도 경기는 그대로 간다.
  bgm.play().catch(() => {});
  raceActive = true;
  if (raceSky) scene.background = raceSky;
  kart.visible = true;
  reset();
  const forwardX = Math.sin(state.heading);
  const forwardZ = -Math.cos(state.heading);
  // 탑은 꼭대기(210)에서 출발한다. 높이를 빼먹으면 첫 화면이 하늘만 보인다.
  camera.position.set(state.x - forwardX * 18, groundY + 9.5, state.z - forwardZ * 18);
  previous = performance.now();
});

const speedEl = document.getElementById('speed');
const gaugeEl = document.getElementById('drift-fill');
const percentEl = document.getElementById('drift-percent');
const slotBox = document.getElementById('boost-slots');
const slots = [...slotBox.children];
const countdownEl = document.getElementById('countdown');
const againEl = document.getElementById('race-again');
againEl.addEventListener('click', () => { if (raceActive) reset(); });
const lapEl = document.getElementById('lap');
const lapLabelEl = document.querySelector('.lap span');
const timeEl = document.getElementById('race-time');
const speedDialEl = document.getElementById('speed-dial');

function drawMinimap() {
  if (!track) return;
  minimapContext.clearRect(0, 0, minimap.width, minimap.height);
  minimapContext.drawImage(track.minimapBase, 0, 0);
  const [x, y] = track.minimapPoint(raceActive ? { x: state.x, z: state.z, y: groundY } : track.start);
  minimapContext.beginPath();
  minimapContext.arc(x, y, 5, 0, Math.PI * 2);
  minimapContext.fillStyle = '#ff4d2e';
  minimapContext.fill();
  minimapContext.lineWidth = 2;
  minimapContext.strokeStyle = '#fff';
  minimapContext.stroke();
}

function updateHud() {
  const speed = Math.round(Math.abs(state.speed) * 4.25);
  speedEl.textContent = speed;
  speedDialEl.style.setProperty('--speed-angle', `${Math.min(270, speed / (KART.boostSpeed * 4.25) * 270)}deg`);
  const minutes = Math.floor(state.elapsed / 60);
  const seconds = state.elapsed - minutes * 60;
  timeEl.textContent = `${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
  const gauge = Math.min(100, Math.round(state.gauge));
  gaugeEl.style.width = `${gauge}%`;
  percentEl.textContent = `${gauge}%`;
  slots.forEach((slot, i) => slot.classList.toggle('on', i < state.boosts));
  slotBox.setAttribute('aria-label', `부스터 ${state.boosts}개`);
  // 완주 안내는 카운트다운 자리를 빌려 쓴다. 주행 중 잡다한 알림까지
  // 여기에 띄우면 화면 한가운데가 계속 번쩍여 방해된다.
  // 숫자가 바뀌는 순간에만 울린다. 매 프레임 검사하지만 값이 같으면 지나간다.
  const counting = raceActive && state.startTimer > 0 ? Math.ceil(state.startTimer) : 0;
  if (counting !== lastCount) {
    if (counting > 0) beep(760, .17, .16);
    else if (raceActive && state.startTimer > -1) beep(1210, .55, .22);
    lastCount = counting;
  }
  // 판이 끝나면 다시 달릴 길을 내준다. 휴대폰에는 R 키가 없어 죽으면 막다른 길이었다.
  againEl.classList.toggle('hidden', !raceFinished);
  countdownEl.textContent = raceActive && state.startTimer > 0 ? Math.ceil(state.startTimer)
    : raceActive && state.startTimer > -0.75 ? 'GO!'
    : raceFinished ? state.notice
    : state.elapsed < lapBannerUntil ? lapBanner : '';
  // 숫자 한 글자는 화면 가득 차도 되지만 '완주!'·'2 / 2 LAP' 은 좁은 화면에서 넘친다.
  countdownEl.classList.toggle('wordy', countdownEl.textContent.length > 3);
  // 한 줄짜리 길은 바퀴가 없다. 몇 바퀴째 대신 얼마나 내려왔는지를 보여 준다.
  if (raceActive && !track.closed) {
    lapEl.textContent = `${Math.min(100, Math.round(previousProgress * 100))}%`;
    lapLabelEl.textContent = 'DOWN';
  } else {
    lapEl.textContent = `${Math.min(lap, LAPS)} / ${LAPS}`;
    lapLabelEl.textContent = 'LAP';
  }
  drawMinimap();
}

// 지금 달리고 있는 코스 지점. 직전 자리에서 앞뒤로 조금만 살핀다.
//
// 전부 뒤지면 탑에서 무너진다 — 나선은 같은 X·Z 자리에 길이 열 겹 쌓여 있어,
// 거리만 재면 바로 위나 아래 층에 붙어 버린다. 그러면 몇 바퀴를 건너뛴 것으로
// 세고, 길 밖으로 밀어내는 계산도 엉뚱한 층을 기준으로 한다.
// 한 프레임에 움직이는 거리는 1 남짓(최고속 58 × 0.02초)이라 ±90 이면 넉넉하다.
const LOOK_AROUND = 90;
let lastSample = 0;
// 지금 밟고 있는 노면 높이. 탑은 지점마다 높이가 달라, 이 값을 빼면 카트가
// 꼭대기 높이에 그대로 떠서 달린다.
let groundY = 0;
function nearestTrackSample() {
  const samples = track.trackSamples;
  const count = samples.length;
  let index = lastSample;
  let distanceSq = Infinity;
  for (let step = -LOOK_AROUND; step <= LOOK_AROUND; step++) {
    const i = track.closed
      ? (lastSample + step + count) % count
      : Math.min(count - 1, Math.max(0, lastSample + step));
    const dx = state.x - samples[i].x;
    const dz = state.z - samples[i].z;
    const candidate = dx * dx + dz * dz;
    if (candidate < distanceSq) {
      index = i;
      distanceSq = candidate;
    }
  }
  lastSample = index;
  return { index, point: samples[index] };
}

// 완주 처리는 바퀴를 다 돌았을 때와 한 줄짜리 길 끝에 닿았을 때가 같다.
function finishRace() {
  raceFinished = true;
  state.speed = state.lateral = 0;
  const time = state.elapsed;
  state.notice = `완주! ${time.toFixed(2)}초`;
  state.noticeTimer = 3600;
  // 서버 답을 기다리지 않는다 — 완주 문구가 먼저 뜨고, 순위는 오면 붙는다.
  sendRecord(time).then((line) => {
    if (raceFinished) state.notice = `완주! ${time.toFixed(2)}초 · ${line}`;
  });
  // 완주는 올라가는 세 음으로 — 바퀴 넘김과 헷갈리면 안 된다.
  beep(880, .16, .2);
  beep(1170, .16, .2, .17);
  beep(1560, .6, .22, .34);
}

function updateLap(index) {
  const progress = index / track.trackSamples.length;
  // 탑처럼 한 줄짜리 길은 끝까지 내려오면 끝이다. 바퀴를 셀 것이 없다.
  if (!track.closed) {
    if (progress > .995 && !raceFinished) finishRace();
    previousProgress = progress;
    return;
  }
  if (progress > .42 && progress < .68) lapArmed = true;
  if (lapArmed && previousProgress > .85 && progress < .15) {
    lapArmed = false;
    if (lap === LAPS) {
      finishRace();
    } else {
      lap++;
      lapBanner = `${lap} / ${LAPS} LAP`;
      lapBannerUntil = state.elapsed + 1.8;
      beep(1050, .13, .19);
      beep(1400, .3, .19, .14);
    }
  }
  previousProgress = progress;
}

const cameraTarget = new THREE.Vector3();
const cameraLook = new THREE.Vector3();
// 카메라가 실제로 보고 있는 각도. 카트 각도를 조금 늦게 따라간다.
let cameraHeading = 0;
function updateScene(dt, now) {
  if (!raceActive) {
    camera.position.set(0, 1120, 10);
    camera.lookAt(0, 0, 0);
    return;
  }
  kart.position.set(state.x, groundY + 1.94 + (state.hitWall ? .06 : 0), state.z);
  // 물리의 +회전과 Three.js의 로컬 -Z 회전 방향이 반대라 부호를 뒤집는다.
  kart.rotation.y = -state.heading;
  kart.rotation.z = -state.lateral * 0.006;
  const { plant, flames, plumes } = kart.userData;
  plant.userData.animate?.(now, Math.abs(state.speed) * 0.25, true);
  // 길 위의 만드라고라도 잎을 흔든다. 가만히 서 있으면 조형물처럼 보인다.
  for (const giant of giants) giant.body.userData.animate?.(now, 3, true);

  flames.visible = state.boostTimer > 0 || state.instantTimer > 0;
  if (flames.visible) {
    // 겹마다 길이가 따로 흔들려야 불이 일렁이는 것처럼 보인다.
    // 굵기까지 흔들면 지글거려 보기 싫으니 길이만 건드린다.
    plumes.forEach((plume, i) => {
      const wobble = .82 + Math.sin(now * (13 + i * 2.6) + i) * .12 + Math.random() * .12;
      plume.layer.scale.z = plume.length * wobble;
    });
  }

  if (state.drifting) dropMarks();
  // 끼익 소리. 빠를수록 크고 높게, 이어 걸수록 더 날카롭게.
  if (screech) {
    const speedPart = Math.min(Math.abs(state.speed) / KART.maxSpeed, 1);
    const want = state.drifting ? .05 + speedPart * .13 : 0;
    screech.gain.gain.setTargetAtTime(want, audioContext.currentTime, .04);
    screech.filter.frequency.setTargetAtTime(1750 + speedPart * 900 + state.driftChain * 130, audioContext.currentTime, .08);
  }

  // 카메라는 카트보다 늦게 돈다. 시야가 카트를 그대로 따라 휙 돌면 멀미가 난다.
  // 코너에서는 카트만 화면 안에서 비스듬해지고 시야는 천천히 따라붙는다.
  cameraHeading += (state.heading - cameraHeading) * (1 - Math.exp(-dt * 3.2));
  const forwardX = Math.sin(cameraHeading);
  const forwardZ = -Math.cos(cameraHeading);
  cameraTarget.set(state.x - forwardX * 18, groundY + 9.5, state.z - forwardZ * 18);
  camera.position.lerp(cameraTarget, 1 - Math.exp(-dt * 7));
  cameraLook.set(state.x + forwardX * 15, groundY + 2.6, state.z + forwardZ * 15);
  camera.lookAt(cameraLook);
  const roll = -state.lateral * .0009;
  camera.rotateZ(roll);
  if (raceSky) {
    // 배경은 카트가 아니라 카메라 각도를 따라간다. 카트를 따라가면 시야보다
    // 더 돌아서 배경만 미끄러지는 것처럼 보인다.
    raceSky.offset.x = (cameraHeading - track.startHeading) / (Math.PI * 2) + state.elapsed * .0008;
    // 카메라를 roll 만큼 굴리면 화면 속 세상은 반대쪽으로 기운 것처럼 보인다.
    // texture.rotation 은 그 값만큼 그림을 같은 방향으로 기울이므로 -roll 을 준다.
    raceSky.rotation = -roll;
  }
  camera.fov += ((state.boostTimer > 0 ? 76 : state.drifting ? 73 : 70) - camera.fov) * (1 - Math.exp(-dt * 6));
  camera.updateProjectionMatrix();
  sun.position.set(state.x - 18, groundY + 28, state.z + 16);
  sun.target.position.set(state.x, groundY, state.z);
}

function resize() {
  const width = innerWidth;
  const height = innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let previous = performance.now();
function frame(nowMs) {
  const dt = Math.min((nowMs - previous) / 1000, 0.05);
  previous = nowMs;
  if (raceActive && !raceFinished) {
    stepKart(state, {
      up: !!keys.up,
      brake: !!keys.brake,
      left: !!keys.left,
      right: !!keys.right,
      drift: !!keys.drift,
      driftPressed: pressed.has('drift'),
      leftPressed: pressed.has('left'),
      rightPressed: pressed.has('right'),
      acceleratePressed: pressed.has('up'),
      boostPressed: pressed.has('boost')
    }, dt);
    const nearest = nearestTrackSample();
    groundY = nearest.point.y;
    constrainToRoad(state, nearest.point.x, nearest.point.z, track.halfWidth);
    moveGiants();
    for (const giant of giants) {
      if (giant.deadly) {
        if (Math.hypot(state.x - giant.x, state.z - giant.z) < giant.radius) killRun();
      } else if (bounceOff(state, giant.x, giant.z, giant.radius)) {
        beep(120, .2, .2);
      }
    }
    updateLap(nearest.index);
  }
  pressed.clear();
  updateScene(dt, nowMs / 1000);
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
