import * as THREE from 'three';
import { buildPlant } from './plant.js';
import { createKartState, stepKart, KART } from './mandrider-physics.js';

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
scene.background = new THREE.Color(0xa8b4b1);
scene.fog = new THREE.Fog(0xa8b4b1, 85, 230);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 350);
scene.add(new THREE.HemisphereLight(0xf4fff0, 0x55625a, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.position.set(-18, 28, 16);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -18;
sun.shadow.camera.right = sun.shadow.camera.top = 18;
scene.add(sun);
scene.add(sun.target);

const road = new THREE.Group();
scene.add(road);
const roadMat = new THREE.MeshStandardMaterial({ color: 0x7c8078, roughness: 0.95 });
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf0ead6, roughness: 0.8 });
const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf4c95d, roughness: 0.75 });
const roadGeo = new THREE.BoxGeometry(18, 0.28, 30);
const edgeGeo = new THREE.BoxGeometry(0.42, 0.18, 30);
const stripeGeo = new THREE.BoxGeometry(0.18, 0.025, 3.4);
const segments = [];

for (let i = 0; i < 18; i++) {
  const segment = new THREE.Group();
  const slab = new THREE.Mesh(roadGeo, roadMat);
  slab.receiveShadow = true;
  segment.add(slab);
  for (const x of [-8.75, 8.75]) {
    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.position.set(x, 0.18, 0);
    edge.castShadow = true;
    segment.add(edge);
  }
  for (const z of [-10, 0, 10]) {
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(0, 0.155, z);
    segment.add(stripe);
  }
  road.add(segment);
  segments.push(segment);
}

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
  if (event.code === 'KeyR') reset();
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
function reset() {
  state = createKartState();
  pressed.clear();
  for (const key of Object.keys(keys)) keys[key] = false;
}

const speedEl = document.getElementById('speed');
const gaugeEl = document.getElementById('drift-fill');
const percentEl = document.getElementById('drift-percent');
const slotBox = document.getElementById('boost-slots');
const slots = [...slotBox.children];
const countdownEl = document.getElementById('countdown');
const noticeEl = document.getElementById('race-notice');
const driveStateEl = document.getElementById('drive-state');

function updateHud() {
  speedEl.textContent = Math.round(Math.abs(state.speed) * 4.25);
  const gauge = Math.min(100, Math.round(state.gauge));
  gaugeEl.style.width = `${gauge}%`;
  percentEl.textContent = `${gauge}%`;
  slots.forEach((slot, i) => slot.classList.toggle('on', i < state.boosts));
  slotBox.setAttribute('aria-label', `부스터 ${state.boosts}개`);
  countdownEl.textContent = state.startTimer > 0 ? Math.ceil(state.startTimer) : (state.startTimer > -0.75 ? 'GO!' : '');
  noticeEl.textContent = state.noticeTimer > 0 ? state.notice : '';
  driveStateEl.textContent = state.boostTimer > 0 ? 'N₂O 부스터' : state.instantTimer > 0 ? '순간 부스터' : state.drifting ? '드리프트' : state.speed < -0.5 ? '후진' : state.started ? '주행 중' : '출발 준비';
}

const cameraTarget = new THREE.Vector3();
const cameraLook = new THREE.Vector3();
function updateScene(dt, now) {
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

  const base = Math.floor(state.z / 30) * 30;
  segments.forEach((segment, i) => { segment.position.z = base + (i - 8) * 30; });
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
  stepKart(state, {
    up: !!keys.up,
    brake: !!keys.brake,
    left: !!keys.left,
    right: !!keys.right,
    drift: !!keys.drift,
    acceleratePressed: pressed.has('up'),
    boostPressed: pressed.has('boost')
  }, dt);
  pressed.clear();
  updateScene(dt, nowMs / 1000);
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
