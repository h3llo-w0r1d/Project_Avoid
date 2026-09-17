import * as THREE from 'three';
import { buildPlant } from './plant.js';
import { constrainToRoad, createKartState, stepKart, KART } from './mandrider-physics.js';
import { MAPS, buildTrack } from './mandrider-track.js';

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

  const flames = new THREE.Group();
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x6ee9ff, transparent: true, opacity: 0.9 });
  for (const x of [-0.52, 0.52]) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.1, 10), flameMat);
    flame.rotation.x = Math.PI / 2;
    flame.position.set(x, 0.58, 1.05);
    flames.add(flame);
  }
  flames.visible = false;
  kart.add(flames);

  const sparks = new THREE.Group();
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffcf4f });
  for (const x of [-1.15, 1.15]) {
    const spark = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), sparkMat);
    spark.position.set(x, 0.28, 0.72);
    sparks.add(spark);
  }
  sparks.visible = false;
  kart.add(sparks);

  const smoke = new THREE.Group();
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0xeaf4ef, transparent: true, opacity: .42, depthWrite: false });
  for (let i = 0; i < 8; i++) smoke.add(new THREE.Mesh(new THREE.IcosahedronGeometry(.24, 1), smokeMat));
  smoke.visible = false;
  kart.add(smoke);
  kart.userData = { plant, flames, sparks, smoke };
  return kart;
}

const kart = makeKart();
scene.add(kart);
kart.visible = false;

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

let state = createKartState();
let raceActive = false;
let raceFinished = false;
let lap = 1;
let lapArmed = false;
let previousProgress = 0;

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

// 카트는 아직 화분 하나뿐이라 고를 것이 없지만, 고르는 자리는 미리 둔다.
// 카드를 더 넣으면 이 반복문이 그대로 받아 준다.
const kartCards = [...document.querySelectorAll('.kart-card')];
for (const card of kartCards) {
  card.addEventListener('click', () => {
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
  raceActive = true;
  if (raceSky) scene.background = raceSky;
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
  const { plant, flames, sparks, smoke } = kart.userData;
  plant.userData.animate?.(now, Math.abs(state.speed) * 0.25, true);
  flames.visible = state.boostTimer > 0 || state.instantTimer > 0;
  sparks.visible = state.drifting;
  smoke.visible = state.drifting;
  flames.scale.z = 0.8 + Math.random() * 0.45;
  sparks.rotation.y += dt * 13;
  smoke.children.forEach((cloud, i) => {
    const phase = (now * 1.8 + i / smoke.children.length) % 1;
    cloud.position.set((i % 2 ? .72 : -.72) * (1 + phase * .4), .32 + phase * .7, .78 + phase * 2.1);
    cloud.scale.setScalar(.5 + phase * 1.9);
  });

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
