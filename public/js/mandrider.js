import * as THREE from 'three';
import { buildPlant } from './plant.js';
import { constrainToRoad, createKartState, stepKart, KART } from './mandrider-physics.js';
import { MAPS, buildTrack } from './mandrider-track.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/jsm/libs/meshopt_decoder.module.js';

// 고를 수 있는 카트. 화분은 코드로 그리고 나머지는 받아 온 모델이다.
// height 는 화면에 세울 키 — 모델마다 원본 크기가 제각각이라 이 값에 맞춰 줄인다.
const KARTS = {
  pot: { name: '만드라고라 화분' },
  pigeon: { name: '비둘기', url: './models/pigeon.glb', height: 2.2 },
  chicken: { name: '닭', url: './models/chicken.glb', height: 2.4 },
  deer: { name: '사슴', url: './models/deer.glb', height: 2.9 }
};

// 캐시에 화면이 남아도 관리자가 아니면 주행 코드까지 실행하지 않는다.
const allowed = await fetch('/api/admin/me', { cache: 'no-store' })
  .then((res) => res.ok && res.json())
  .then((me) => me?.admin === true)
  .catch(() => false);
if (!allowed) {
  location.replace('/');
  await new Promise(() => {});
}

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

// 카트 몸통만 만든다. 불꽃 같은 연출은 몸통이 바뀌어도 그대로 쓰므로 따로 둔다.
function buildPot() {
  const body = new THREE.Group();
  const potMat = new THREE.MeshStandardMaterial({ color: 0xc7613f, roughness: 0.72 });
  const darkPot = new THREE.MeshStandardMaterial({ color: 0x753621, roughness: 0.85 });

  // 바퀴 없이 화분만 굴러간다. 바닥에 바로 닿도록 높이를 맞췄다 —
  // 카트 원점이 노면보다 0.06 아래라 화분 밑동을 거기에 둔다.
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.68, 1.28, 24), potMat);
  pot.position.set(0, 0.70, 0);
  pot.castShadow = true;
  body.add(pot);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.13, 10, 28), darkPot);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 1.34, 0);
  rim.castShadow = true;
  body.add(rim);

  const plant = buildPlant('mandragora');
  plant.scale.setScalar(1.05);
  plant.position.set(0, 0.96, 0);
  body.add(plant);
  body.userData.plant = plant;
  return body;
}

// 받아 온 모델을 카트 자리에 맞춰 앉힌다. 원본 크기와 중심이 제각각이라
// 키를 재서 줄이고, 발이 노면에 닿도록 내려 준다.
function fitModel(scene, height) {
  const body = new THREE.Group();
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);
  const scale = height / Math.max(size.y, .001);
  scene.scale.setScalar(scale);
  // 좌우·앞뒤는 가운데로, 아래는 바닥(0.06)에 맞춘다.
  scene.position.set(-centre.x * scale, -box.min.y * scale + .06, -centre.z * scale);
  scene.traverse((part) => { if (part.isMesh) part.castShadow = true; });
  body.add(scene);
  return body;
}

function makeKart() {
  const kart = new THREE.Group();
  const bodyHolder = new THREE.Group();
  bodyHolder.add(buildPot());
  kart.add(bodyHolder);

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

  kart.userData = { bodyHolder, flames, plumes };
  return kart;
}

const kart = makeKart();
scene.add(kart);
kart.visible = false;

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
    markPosition.set(state.x + rightX * side * .62, 2.02, state.z + rightZ * side * .62);
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
function beep(frequency, seconds, volume) {
  if (!audioContext) return;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = 'square';
  osc.frequency.value = frequency;
  const at = audioContext.currentTime;
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

let state = createKartState();
let raceActive = false;
let raceFinished = false;
let lap = 1;
let lapArmed = false;
let previousProgress = 0;
let lastCount = 0;

function reset() {
  state = createKartState();
  state.x = track.start.x;
  state.z = track.start.z;
  state.heading = track.startHeading;
  cameraHeading = track.startHeading;
  raceFinished = false;
  lap = 1;
  lapArmed = false;
  previousProgress = 0;
  markLastX = state.x;
  markLastZ = state.z;
  clearMarks();
  pressed.clear();
  for (const key of Object.keys(keys)) keys[key] = false;
}

let chosenMap = 'circuit';
const mapCards = [...document.querySelectorAll('.map-card')];
for (const card of mapCards) {
  card.addEventListener('click', () => {
    chosenMap = card.dataset.map;
    for (const other of mapCards) {
      const on = other === card;
      other.classList.toggle('selected', on);
      other.setAttribute('aria-pressed', on);
    }
  });
}

let chosenKart = 'pot';
let modelLoader = null;
// 고른 카트로 몸통을 갈아 끼운다. 모델은 처음 고를 때 한 번만 받아 두고 다시 쓴다.
const modelCache = new Map();
async function useKart(id) {
  const spec = KARTS[id] ?? KARTS.pot;
  const holder = kart.userData.bodyHolder;
  if (!spec.url) {
    holder.clear();
    holder.add(buildPot());
    return;
  }
  if (!modelCache.has(id)) {
    modelLoader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    // 못 받아도 게임은 돌아가야 한다 — 화분으로 되돌린다.
    const gltf = await modelLoader.loadAsync(spec.url).catch((err) => {
      console.warn('카트 모델을 불러오지 못했습니다: ' + spec.url, err.message);
      return null;
    });
    modelCache.set(id, gltf && fitModel(gltf.scene, spec.height));
  }
  const body = modelCache.get(id);
  holder.clear();
  holder.add(body ? body.clone(true) : buildPot());
}

const kartCards = [...document.querySelectorAll('.kart-card')];
for (const card of kartCards) {
  card.addEventListener('click', () => {
    chosenKart = card.dataset.kart;
    for (const other of kartCards) {
      const on = other === card;
      other.classList.toggle('selected', on);
      other.setAttribute('aria-pressed', on);
    }
  });
}

document.getElementById('start-race').addEventListener('click', () => {
  const map = MAPS[chosenMap];
  track = buildTrack(scene, renderer, map, minimap);
  document.getElementById('race-map-name').textContent = map.name;
  document.getElementById('map-select').classList.add('hidden');
  // 속도계·게이지·미니맵은 여기서부터 보인다(CSS 의 body.racing).
  document.body.classList.add('racing');
  audioContext ??= new (window.AudioContext ?? window.webkitAudioContext)();
  audioContext.resume?.();
  startScreech();
  raceActive = true;
  if (raceSky) scene.background = raceSky;
  useKart(chosenKart);
  kart.visible = true;
  reset();
  const forwardX = Math.sin(state.heading);
  const forwardZ = -Math.cos(state.heading);
  camera.position.set(state.x - forwardX * 18, 9.5, state.z - forwardZ * 18);
  previous = performance.now();
});

const speedEl = document.getElementById('speed');
const gaugeEl = document.getElementById('drift-fill');
const percentEl = document.getElementById('drift-percent');
const slotBox = document.getElementById('boost-slots');
const slots = [...slotBox.children];
const countdownEl = document.getElementById('countdown');
const lapEl = document.getElementById('lap');
const timeEl = document.getElementById('race-time');
const speedDialEl = document.getElementById('speed-dial');

function drawMinimap() {
  if (!track) return;
  minimapContext.clearRect(0, 0, minimap.width, minimap.height);
  minimapContext.drawImage(track.minimapBase, 0, 0);
  const [x, y] = track.minimapPoint(raceActive ? state : track.start);
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
  countdownEl.textContent = raceActive && state.startTimer > 0 ? Math.ceil(state.startTimer)
    : raceActive && state.startTimer > -0.75 ? 'GO!'
    : raceFinished ? state.notice : '';
  lapEl.textContent = `${Math.min(lap, 3)} / 3`;
  drawMinimap();
}

function nearestTrackSample() {
  const samples = track.trackSamples;
  let index = 0;
  let distanceSq = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const dx = state.x - samples[i].x;
    const dz = state.z - samples[i].z;
    const candidate = dx * dx + dz * dz;
    if (candidate < distanceSq) {
      index = i;
      distanceSq = candidate;
    }
  }
  return { index, point: samples[index] };
}

function updateLap(index) {
  const progress = index / track.trackSamples.length;
  if (progress > .42 && progress < .68) lapArmed = true;
  if (lapArmed && previousProgress > .85 && progress < .15) {
    lapArmed = false;
    if (lap === 3) {
      raceFinished = true;
      state.speed = state.lateral = 0;
      state.notice = `완주! ${state.elapsed.toFixed(2)}초`;
      state.noticeTimer = 3600;
    } else {
      lap++;
      state.notice = `${lap}바퀴째!`;
      state.noticeTimer = 1.2;
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
  kart.position.set(state.x, 1.94 + (state.hitWall ? .06 : 0), state.z);
  // 물리의 +회전과 Three.js의 로컬 -Z 회전 방향이 반대라 부호를 뒤집는다.
  kart.rotation.y = -state.heading;
  kart.rotation.z = -state.lateral * 0.006;
  const { bodyHolder, flames, plumes } = kart.userData;
  // 화분 카트일 때만 잎이 흔들린다. 받아 온 모델에는 흔들 잎이 없다.
  bodyHolder.children[0]?.userData.plant?.userData.animate?.(now, Math.abs(state.speed) * 0.25, true);

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
  cameraTarget.set(state.x - forwardX * 18, 9.5, state.z - forwardZ * 18);
  camera.position.lerp(cameraTarget, 1 - Math.exp(-dt * 7));
  cameraLook.set(state.x + forwardX * 15, 2.6, state.z + forwardZ * 15);
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
  sun.position.set(state.x - 18, 28, state.z + 16);
  sun.target.position.set(state.x, 0, state.z);
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
    constrainToRoad(state, nearest.point.x, nearest.point.z, track.halfWidth);
    updateLap(nearest.index);
  }
  pressed.clear();
  updateScene(dt, nowMs / 1000);
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
