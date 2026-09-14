import * as THREE from 'three';
import { buildPlant } from './plant.js';
import { constrainToRoad, createKartState, stepKart, KART } from './mandrider-physics.js';

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
scene.fog = new THREE.Fog(0x8ed5ff, 120, 300);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
scene.add(new THREE.HemisphereLight(0xf4fff0, 0x55625a, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.position.set(-45, 90, 55);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -85;
sun.shadow.camera.right = sun.shadow.camera.top = 85;
scene.add(sun);
scene.add(sun.target);

// 윤곽은 만드라고라이되 분기 없이 한 바퀴를 완주할 수 있는 레이싱 라인이다.
const trackCurve = new THREE.CatmullRomCurve3([
  [0, 72], [-13, 80], [-29, 80], [-40, 68], [-36, 54], [-25, 48],
  [-39, 42], [-52, 32], [-57, 18], [-51, 4], [-36, 3], [-32, -14],
  [-50, -30], [-58, -48], [-51, -65], [-36, -72], [-22, -59], [-17, -46],
  [-18, -70], [-10, -88], [0, -97], [10, -88], [18, -70], [17, -46],
  [22, -59], [36, -72], [51, -65], [58, -48], [50, -30], [32, -14],
  [36, 3], [51, 4], [57, 18], [52, 32], [39, 42], [25, 48],
  [36, 54], [40, 68], [29, 80], [13, 80]
].map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.32);
const trackSamples = Array.from({ length: 360 }, (_, i) => trackCurve.getPointAt(i / 360));
const trackNormals = trackSamples.map((point, i) => {
  const previous = trackSamples[(i - 1 + trackSamples.length) % trackSamples.length];
  const next = trackSamples[(i + 1) % trackSamples.length];
  return new THREE.Vector2(next.z - previous.z, -(next.x - previous.x)).normalize();
});

function stripGeometry(offsetA, offsetB, y) {
  const positions = [];
  const indices = [];
  for (let i = 0; i < trackSamples.length; i++) {
    const p = trackSamples[i];
    const q = trackSamples[(i + 1) % trackSamples.length];
    const pNormal = trackNormals[i];
    const qNormal = trackNormals[(i + 1) % trackSamples.length];
    const base = positions.length / 3;
    positions.push(
      p.x + pNormal.x * offsetA, y, p.z + pNormal.y * offsetA,
      p.x + pNormal.x * offsetB, y, p.z + pNormal.y * offsetB,
      q.x + qNormal.x * offsetA, y, q.z + qNormal.y * offsetA,
      q.x + qNormal.x * offsetB, y, q.z + qNormal.y * offsetB
    );
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const islandRock = new THREE.MeshStandardMaterial({ color: 0x52624a, roughness: 1 });
const islandGrass = new THREE.MeshStandardMaterial({ color: 0x65a947, roughness: 1 });
const islandSpecs = [
  [0, 7, 45, 53, 0], [-45, 19, 18, 21, -.2], [45, 19, 18, 21, .2],
  [-25, 66, 20, 21, -.25], [25, 66, 20, 21, .25],
  [-39, -50, 21, 31, -.5], [0, -70, 20, 34, 0], [39, -50, 21, 31, .5]
];
for (const [x, z, rx, rz, rotation] of islandSpecs) {
  const rock = new THREE.Mesh(new THREE.CylinderGeometry(1, .72, 8, 28), islandRock);
  rock.position.set(x, -4, z);
  rock.rotation.y = rotation;
  rock.scale.set(rx, 1, rz);
  rock.receiveShadow = true;
  scene.add(rock);
  const grass = new THREE.Mesh(new THREE.CircleGeometry(1, 40), islandGrass);
  grass.position.set(x, .03, z);
  grass.rotation.set(-Math.PI / 2, 0, rotation);
  grass.scale.set(rx * .98, rz * .98, 1);
  grass.receiveShadow = true;
  scene.add(grass);
}

const roadMat = new THREE.MeshStandardMaterial({ color: 0x77766e, roughness: .92 });
const road = new THREE.Mesh(stripGeometry(-7.05, 7.05, .13), roadMat);
road.receiveShadow = true;
scene.add(road);
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf0a262, roughness: .75 });
for (const side of [-1, 1]) {
  const edgeCurve = new THREE.CatmullRomCurve3(trackSamples.map((point, i) => new THREE.Vector3(
    point.x + trackNormals[i].x * 7.15,
    .28,
    point.z + trackNormals[i].y * 7.15
  )), true, 'catmullrom', .4);
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(edgeCurve, 360, .18, 5, true), edgeMat));
}

const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf8dc77, roughness: .75 });
const stripeGeo = new THREE.BoxGeometry(.15, .05, 2.4);
const stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, 90);
const stripeMatrix = new THREE.Matrix4();
for (let i = 0; i < 90; i++) {
  const p = trackSamples[i * 4];
  const q = trackSamples[(i * 4 + 1) % trackSamples.length];
  stripeMatrix.makeRotationY(Math.atan2(q.x - p.x, q.z - p.z));
  stripeMatrix.setPosition(p.x, .2, p.z);
  stripes.setMatrixAt(i, stripeMatrix);
}
stripes.instanceMatrix.needsUpdate = true;
scene.add(stripes);

const start = trackSamples[0];
const startNext = trackSamples[1];
const startAngle = Math.atan2(startNext.x - start.x, startNext.z - start.z);
const startNormal = new THREE.Vector2(startNext.z - start.z, -(startNext.x - start.x)).normalize();
for (let i = 0; i < 10; i++) {
  const tile = new THREE.Mesh(
    new THREE.BoxGeometry(1.36, .07, 1.35),
    new THREE.MeshStandardMaterial({ color: i % 2 ? 0x202522 : 0xffffff, roughness: .75 })
  );
  const across = (i - 4.5) * 1.36;
  tile.position.set(start.x + startNormal.x * across, .23, start.z + startNormal.y * across);
  tile.rotation.y = startAngle;
  scene.add(tile);
}

const pond = new THREE.Mesh(
  new THREE.CircleGeometry(7, 40),
  new THREE.MeshStandardMaterial({ color: 0x48bfe2, roughness: .25, metalness: .05 })
);
pond.rotation.x = -Math.PI / 2;
pond.position.set(0, .08, 4);
scene.add(pond);

const bushGeo = new THREE.IcosahedronGeometry(1, 1);
const bushMat = new THREE.MeshStandardMaterial({ color: 0x397d37, roughness: 1 });
const bushes = new THREE.InstancedMesh(bushGeo, bushMat, 24);
const bushMatrix = new THREE.Matrix4();
for (let i = 0; i < 24; i++) {
  const angle = i * 2.399;
  const radius = 11 + (i % 4) * 4.2;
  bushMatrix.compose(
    new THREE.Vector3(Math.cos(angle) * radius, .8, 4 + Math.sin(angle) * radius),
    new THREE.Quaternion(),
    new THREE.Vector3(1.1 + i % 3 * .3, .8 + i % 2 * .4, 1.1 + i % 3 * .3)
  );
  bushes.setMatrixAt(i, bushMatrix);
}
bushes.instanceMatrix.needsUpdate = true;
bushes.castShadow = true;
scene.add(bushes);

function makeKart() {
  const kart = new THREE.Group();
  const potMat = new THREE.MeshStandardMaterial({ color: 0xc7613f, roughness: 0.72 });
  const darkPot = new THREE.MeshStandardMaterial({ color: 0x753621, roughness: 0.85 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x202522, roughness: 0.8 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xd8e2d8, metalness: 0.5, roughness: 0.35 });

  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.68, 1.28, 24), potMat);
  pot.position.set(0, 1.22, 0.08);
  pot.castShadow = true;
  kart.add(pot);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.13, 10, 28), darkPot);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 1.88, 0.08);
  rim.castShadow = true;
  kart.add(rim);

  const wheels = [];
  for (const x of [-0.86, 0.86]) for (const z of [-0.58, 0.72]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.34, 18), tireMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.48, z);
    wheel.castShadow = true;
    kart.add(wheel);
    wheels.push(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.355, 14), hubMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(wheel.position);
    kart.add(hub);
  }

  const plant = buildPlant('mandragora');
  plant.scale.setScalar(1.05);
  plant.position.set(0, 1.48, 0.03);
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
  kart.userData = { wheels, plant, flames, sparks };
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
  ShiftLeft: 'drift', ShiftRight: 'drift', Space: 'boost',
  Up: 'up', Down: 'brake', Left: 'left', Right: 'right',
  w: 'up', s: 'brake', a: 'left', d: 'right', Shift: 'drift', ' ': 'boost'
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
  state.x = start.x;
  state.z = start.z;
  state.heading = Math.atan2(startNext.x - start.x, -(startNext.z - start.z));
  raceFinished = false;
  lap = 1;
  lapArmed = false;
  previousProgress = 0;
  pressed.clear();
  for (const key of Object.keys(keys)) keys[key] = false;
}

document.getElementById('start-race').addEventListener('click', () => {
  document.getElementById('map-select').classList.add('hidden');
  raceActive = true;
  kart.visible = true;
  reset();
  const forwardX = Math.sin(state.heading);
  const forwardZ = -Math.cos(state.heading);
  camera.position.set(state.x - forwardX * 10, 5.4, state.z - forwardZ * 10);
  previous = performance.now();
});

const speedEl = document.getElementById('speed');
const gaugeEl = document.getElementById('drift-fill');
const percentEl = document.getElementById('drift-percent');
const slotBox = document.getElementById('boost-slots');
const slots = [...slotBox.children];
const countdownEl = document.getElementById('countdown');
const noticeEl = document.getElementById('race-notice');
const driveStateEl = document.getElementById('drive-state');
const lapEl = document.getElementById('lap');

function updateHud() {
  speedEl.textContent = Math.round(Math.abs(state.speed) * 4.25);
  const gauge = Math.min(100, Math.round(state.gauge));
  gaugeEl.style.width = `${gauge}%`;
  percentEl.textContent = `${gauge}%`;
  slots.forEach((slot, i) => slot.classList.toggle('on', i < state.boosts));
  slotBox.setAttribute('aria-label', `부스터 ${state.boosts}개`);
  countdownEl.textContent = raceActive && state.startTimer > 0 ? Math.ceil(state.startTimer) : (raceActive && state.startTimer > -0.75 ? 'GO!' : '');
  noticeEl.textContent = state.noticeTimer > 0 ? state.notice : '';
  lapEl.textContent = `${Math.min(lap, 3)} / 3`;
  driveStateEl.textContent = raceFinished ? '완주!' : state.boostTimer > 0 ? 'N₂O 부스터' : state.instantTimer > 0 ? '순간 부스터' : state.drifting ? '드리프트' : state.speed < -0.5 ? '후진' : state.started ? '주행 중' : '출발 준비';
}

function nearestTrackSample() {
  let index = 0;
  let distanceSq = Infinity;
  for (let i = 0; i < trackSamples.length; i++) {
    const dx = state.x - trackSamples[i].x;
    const dz = state.z - trackSamples[i].z;
    const candidate = dx * dx + dz * dz;
    if (candidate < distanceSq) {
      index = i;
      distanceSq = candidate;
    }
  }
  return { index, point: trackSamples[index] };
}

function updateLap(index) {
  const progress = index / trackSamples.length;
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
function updateScene(dt, now) {
  if (!raceActive) {
    camera.position.set(0, 180, 5);
    camera.lookAt(0, 0, -4);
    return;
  }
  kart.position.set(state.x, state.hitWall ? 0.06 : 0, state.z);
  // 물리의 +회전과 Three.js의 로컬 -Z 회전 방향이 반대라 부호를 뒤집는다.
  kart.rotation.y = -state.heading;
  kart.rotation.z = -state.lateral * 0.006;
  const { wheels, plant, flames, sparks } = kart.userData;
  for (const wheel of wheels) wheel.rotation.x -= state.speed * dt / 0.42;
  plant.userData.animate?.(now, Math.abs(state.speed) * 0.25, true);
  flames.visible = state.boostTimer > 0 || state.instantTimer > 0;
  sparks.visible = state.drifting;
  flames.scale.z = 0.8 + Math.random() * 0.45;
  sparks.rotation.y += dt * 13;

  const forwardX = Math.sin(state.heading);
  const forwardZ = -Math.cos(state.heading);
  cameraTarget.set(state.x - forwardX * 10, 5.4, state.z - forwardZ * 10);
  camera.position.lerp(cameraTarget, 1 - Math.exp(-dt * 7));
  cameraLook.set(state.x + forwardX * 8, 1.15, state.z + forwardZ * 8);
  camera.lookAt(cameraLook);
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
      acceleratePressed: pressed.has('up'),
      boostPressed: pressed.has('boost')
    }, dt);
    const nearest = nearestTrackSample();
    constrainToRoad(state, nearest.point.x, nearest.point.z);
    updateLap(nearest.index);
  }
  pressed.clear();
  updateScene(dt, nowMs / 1000);
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
