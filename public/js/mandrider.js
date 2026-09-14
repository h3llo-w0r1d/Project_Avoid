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

// 원본보다 다섯 배 긴 단일 주행선으로 사진의 잎·팔·발 구성을 실제 레이스에 맞춘다.
const MAP_SCALE = 5;
const trackCurve = new THREE.CatmullRomCurve3([
  [0, 64], [-9, 65], [-16, 68], [-20, 73], [-18, 80], [-15, 90],
  [-24, 99], [-38, 97], [-47, 86], [-48, 73], [-46, 60], [-51, 52],
  [-60, 41], [-63, 29], [-58, 19], [-54, 16], [-49, 16], [-46, 24],
  [-43, 31], [-36, 34], [-29, 31], [-26, 24], [-29, 5], [-39, -9],
  [-52, -22], [-59, -37], [-57, -51], [-48, -61], [-38, -63], [-31, -55],
  [-30, -43], [-25, -35], [-20, -37], [-17, -45], [-19, -64], [-13, -82],
  [0, -98], [13, -82], [19, -64], [17, -45], [20, -37], [25, -35],
  [30, -43], [31, -55], [38, -63], [48, -61], [57, -51], [59, -37],
  [52, -22], [39, -9], [29, 5], [26, 24], [29, 31], [36, 34], [43, 31],
  [46, 24], [49, 16], [54, 16], [58, 19], [63, 29], [60, 41], [51, 52],
  [46, 60], [48, 73], [47, 86], [38, 97], [24, 99], [15, 90], [18, 80],
  [20, 73], [16, 68], [9, 65]
].map(([x, z]) => new THREE.Vector3(x * MAP_SCALE, 0, z * MAP_SCALE)), true, 'centripetal');
const trackSamples = Array.from({ length: 960 }, (_, i) => trackCurve.getPointAt(i / 960));
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
const islandSand = new THREE.MeshStandardMaterial({ color: 0xe7d39c, roughness: 1 });
const islandSpecs = [
  [0, 25, 55, 58, 0, islandSand], [-51, 31, 17, 22, -.2, islandGrass], [51, 31, 17, 22, .2, islandGrass],
  [-31, 84, 22, 23, -.2, islandGrass], [31, 84, 22, 23, .2, islandGrass],
  [-44, -43, 22, 31, -.52, islandGrass], [0, -69, 21, 35, 0, islandGrass], [44, -43, 22, 31, .52, islandGrass]
];
for (const [x, z, rx, rz, rotation, topMaterial] of islandSpecs) {
  const rock = new THREE.Mesh(new THREE.CylinderGeometry(1, .72, 30, 28), islandRock);
  rock.position.set(x * MAP_SCALE, -15, z * MAP_SCALE);
  rock.rotation.y = rotation;
  rock.scale.set(rx * MAP_SCALE, 1, rz * MAP_SCALE);
  rock.receiveShadow = true;
  scene.add(rock);
  const top = new THREE.Mesh(new THREE.CircleGeometry(1, 48), topMaterial);
  top.position.set(x * MAP_SCALE, 1, z * MAP_SCALE);
  top.rotation.set(-Math.PI / 2, 0, rotation);
  top.scale.set(rx * MAP_SCALE * .98, rz * MAP_SCALE * .98, 1);
  top.receiveShadow = true;
  scene.add(top);
}

const roadMat = new THREE.MeshStandardMaterial({ color: 0x77766e, roughness: .92 });
const road = new THREE.Mesh(stripGeometry(-14.1, 14.1, 2), roadMat);
road.receiveShadow = true;
scene.add(road);
const curbGeo = new THREE.BoxGeometry(1, 1, 1);
const curbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .76 });
const curbs = new THREE.InstancedMesh(curbGeo, curbMat, trackSamples.length * 2);
const curbMatrix = new THREE.Matrix4();
const curbQuaternion = new THREE.Quaternion();
const curbRed = new THREE.Color(0xd7352f);
const curbWhite = new THREE.Color(0xffffff);
let curbIndex = 0;
for (const side of [-1, 1]) {
  for (let i = 0; i < trackSamples.length; i++) {
    const p = trackSamples[i];
    const q = trackSamples[(i + 1) % trackSamples.length];
    const angle = Math.atan2(q.x - p.x, q.z - p.z);
    curbQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    curbMatrix.compose(
      new THREE.Vector3(
        (p.x + q.x) / 2 + trackNormals[i].x * side * 14.4,
        2.12,
        (p.z + q.z) / 2 + trackNormals[i].y * side * 14.4
      ),
      curbQuaternion,
      new THREE.Vector3(.72, .22, p.distanceTo(q) + .18)
    );
    curbs.setMatrixAt(curbIndex, curbMatrix);
    curbs.setColorAt(curbIndex++, Math.floor(i / 5) % 2 ? curbRed : curbWhite);
  }
}
curbs.instanceMatrix.needsUpdate = true;
curbs.instanceColor.needsUpdate = true;
scene.add(curbs);

const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf7f5e9, roughness: .75 });
const stripeGeo = new THREE.BoxGeometry(.18, .05, 4.2);
const stripePerLine = trackSamples.length / 2;
const stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, stripePerLine * 2);
const stripeMatrix = new THREE.Matrix4();
let stripeIndex = 0;
for (const lane of [-4.7, 4.7]) {
  for (let i = 0; i < stripePerLine; i++) {
    const sample = i * 2;
    const p = trackSamples[sample];
    const q = trackSamples[(sample + 1) % trackSamples.length];
    stripeMatrix.makeRotationY(Math.atan2(q.x - p.x, q.z - p.z));
    stripeMatrix.setPosition(
      p.x + trackNormals[sample].x * lane,
      2.06,
      p.z + trackNormals[sample].y * lane
    );
    stripes.setMatrixAt(stripeIndex++, stripeMatrix);
  }
}
stripes.instanceMatrix.needsUpdate = true;
scene.add(stripes);

const start = trackSamples[0];
const startNext = trackSamples[1];
const startAngle = Math.atan2(startNext.x - start.x, startNext.z - start.z);
const startNormal = new THREE.Vector2(startNext.z - start.z, -(startNext.x - start.x)).normalize();
for (let i = 0; i < 20; i++) {
  const tile = new THREE.Mesh(
    new THREE.BoxGeometry(1.36, .07, 1.35),
    new THREE.MeshStandardMaterial({ color: i % 2 ? 0x202522 : 0xffffff, roughness: .75 })
  );
  const across = (i - 9.5) * 1.36;
  tile.position.set(start.x + startNormal.x * across, 2.08, start.z + startNormal.y * across);
  tile.rotation.y = startAngle;
  scene.add(tile);
}

const discGeo = new THREE.CircleGeometry(1, 40);
function addGroundDisc(x, z, rx, rz, material, y = 1.2) {
  const disc = new THREE.Mesh(discGeo, material);
  disc.position.set(x * MAP_SCALE, y, z * MAP_SCALE);
  disc.rotation.x = -Math.PI / 2;
  disc.scale.set(rx * MAP_SCALE, rz * MAP_SCALE, 1);
  scene.add(disc);
  return disc;
}

// 넓어진 광장이 비지 않도록 사진처럼 얼굴과 잎 속 정원을 코스 안쪽에 둔다.
const soilMat = new THREE.MeshStandardMaterial({ color: 0x513624, roughness: 1 });
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2b211b, roughness: .8 });
const whiteMat = new THREE.MeshStandardMaterial({ color: 0xfffdf4, roughness: .8 });
const cheekMat = new THREE.MeshStandardMaterial({ color: 0xf4a1a8, roughness: .9 });
const mouthMat = new THREE.MeshStandardMaterial({ color: 0x8e2f32, roughness: .9 });
const waterMat = new THREE.MeshStandardMaterial({ color: 0x45bfe0, roughness: .25, metalness: .08 });
for (const x of [-16, 16]) {
  addGroundDisc(x, 17, 8.5, 10, whiteMat, 1.2);
  addGroundDisc(x, 18, 6.3, 8, eyeMat, 1.4);
  addGroundDisc(x - 2, 14.5, 1.6, 2, whiteMat, 1.6);
}
for (const [x, angle] of [[-16, -.18], [16, .18]]) {
  const brow = new THREE.Mesh(new THREE.BoxGeometry(13 * MAP_SCALE, .2, 1.5 * MAP_SCALE), soilMat);
  brow.position.set(x * MAP_SCALE, 1.5, 5 * MAP_SCALE);
  brow.rotation.y = angle;
  scene.add(brow);
}
for (const x of [-30, 30]) addGroundDisc(x, 34, 6, 3.8, cheekMat, 1.3);
addGroundDisc(0, 39, 12, 8, soilMat, 1.2);
addGroundDisc(0, 42, 9, 4.8, mouthMat, 1.4);
addGroundDisc(0, 35, 7, 2.3, whiteMat, 1.6);

for (const [x, z, rx, rz] of [
  [-43, -42, 6, 9], [0, -66, 6, 10], [43, -42, 6, 9],
  [-51, 31, 5, 7], [51, 31, 5, 7], [-31, 84, 6, 7], [31, 84, 6, 7]
]) addGroundDisc(x, z, rx, rz, waterMat, 1.2);

const bushGeo = new THREE.IcosahedronGeometry(1, 1);
const bushMat = new THREE.MeshStandardMaterial({ color: 0x397d37, roughness: 1 });
const bushes = new THREE.InstancedMesh(bushGeo, bushMat, 56);
const bushMatrix = new THREE.Matrix4();
for (let i = 0; i < 56; i++) {
  const angle = i * 2.399;
  const radius = (27 + i % 4 * 1.5) * MAP_SCALE;
  bushMatrix.compose(
    new THREE.Vector3(Math.cos(angle) * radius, 3.2, 25 * MAP_SCALE + Math.sin(angle) * radius * .9),
    new THREE.Quaternion(),
    new THREE.Vector3(1.5 + i % 3 * .6, 1.4 + i % 2 * .5, 1.5 + i % 3 * .6)
  );
  bushes.setMatrixAt(i, bushMatrix);
}
bushes.instanceMatrix.needsUpdate = true;
bushes.castShadow = true;
scene.add(bushes);

const standBaseMat = new THREE.MeshStandardMaterial({ color: 0x4e514f, roughness: .8 });
const seatMat = new THREE.MeshStandardMaterial({ color: 0xd63832, roughness: .75 });
function addStand(x, z, rotation) {
  const stand = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(28, 2, 10), standBaseMat);
  base.position.y = 1;
  stand.add(base);
  for (let row = 0; row < 3; row++) {
    const seats = new THREE.Mesh(new THREE.BoxGeometry(25 - row * 2, 1.4, 2.2), seatMat);
    seats.position.set(0, 2.2 + row * 1.2, 2.5 - row * 2.2);
    stand.add(seats);
  }
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.28, .35, 12, 8), standBaseMat);
    pole.position.set(side * 12, 6, -4);
    stand.add(pole);
    const light = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.6, .6), whiteMat);
    light.position.set(side * 12, 12, -4);
    stand.add(light);
  }
  stand.position.set(x * MAP_SCALE, 1, z * MAP_SCALE);
  stand.rotation.y = rotation;
  scene.add(stand);
}
addStand(-54, -62, -.35);
addStand(54, -62, .35);
addStand(-67, 32, Math.PI / 2);
addStand(67, 32, -Math.PI / 2);
addStand(-43, 92, -.2);
addStand(43, 92, .2);

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
  camera.position.set(state.x - forwardX * 18, 9.5, state.z - forwardZ * 18);
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
    camera.position.set(0, 1120, 10);
    camera.lookAt(0, 0, 0);
    return;
  }
  kart.position.set(state.x, 1.94 + (state.hitWall ? .06 : 0), state.z);
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
  cameraTarget.set(state.x - forwardX * 18, 9.5, state.z - forwardZ * 18);
  camera.position.lerp(cameraTarget, 1 - Math.exp(-dt * 7));
  cameraLook.set(state.x + forwardX * 15, 2.6, state.z + forwardZ * 15);
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
