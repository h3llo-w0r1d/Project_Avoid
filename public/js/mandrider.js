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

// 참고 미니맵의 긴 외곽 직선과 연속 헤어핀을 실제 주행 가능한 한 바퀴로 잇는다.
const MAP_SCALE = 4.5;
const trackCurve = new THREE.CatmullRomCurve3([
  [0, -125], [-45, -125], [-65, -120], [-78, -108], [-84, -90], [-84, 95],
  [-80, 108], [-70, 118], [-55, 123], [58, 123], [70, 120], [80, 112],
  [84, 102], [84, 94], [80, 86], [70, 80], [58, 78], [-48, 78],
  [-60, 75], [-70, 68], [-74, 58], [-74, 50], [-70, 42], [-60, 35],
  [-48, 32], [58, 32], [68, 29], [76, 22], [80, 12], [80, 4],
  [76, -4], [68, -11], [58, -14], [-48, -14], [-58, -17], [-66, -24],
  [-70, -34], [-70, -42], [-66, -50], [-58, -57], [-48, -60], [58, -60],
  [68, -63], [76, -70], [80, -80], [80, -88], [76, -96], [68, -103],
  [55, -106], [25, -106], [14, -110], [8, -117]
].map(([x, z]) => new THREE.Vector3(x * MAP_SCALE, 0, z * MAP_SCALE)), true, 'centripetal');
const trackSamples = Array.from({ length: 1200 }, (_, i) => trackCurve.getPointAt(i / 1200));
const trackNormals = trackSamples.map((point, i) => {
  const previous = trackSamples[(i - 1 + trackSamples.length) % trackSamples.length];
  const next = trackSamples[(i + 1) % trackSamples.length];
  return new THREE.Vector2(next.z - previous.z, -(next.x - previous.x)).normalize();
});

function stripGeometry(offsetA, offsetB, y) {
  const positions = [];
  const indices = [];
  const uvs = [];
  let distance = 0;
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
    const nextDistance = distance + p.distanceTo(q);
    uvs.push(0, distance / 10, 1, distance / 10, 0, nextDistance / 10, 1, nextDistance / 10);
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    distance = nextDistance;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makePattern(base, fleckA, fleckB) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 520; i++) {
    context.fillStyle = i % 3 ? fleckA : fleckB;
    context.globalAlpha = .12 + (i % 5) * .025;
    context.fillRect((i * 47) % 128, (i * 83) % 128, 1 + i % 3, 1 + (i >> 2) % 2);
  }
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const skyCanvas = document.createElement('canvas');
skyCanvas.width = 1024;
skyCanvas.height = 512;
const skyContext = skyCanvas.getContext('2d');
const skyGradient = skyContext.createLinearGradient(0, 0, 0, 512);
skyGradient.addColorStop(0, '#48a9f2');
skyGradient.addColorStop(.62, '#94d9ff');
skyGradient.addColorStop(1, '#eef9ff');
skyContext.fillStyle = skyGradient;
skyContext.fillRect(0, 0, 1024, 512);
skyContext.fillStyle = 'rgba(255,255,255,.72)';
for (let i = 0; i < 34; i++) {
  const x = (i * 137) % 1080 - 28;
  const y = 125 + (i * 53) % 190;
  const radius = 15 + i % 5 * 5;
  for (let part = 0; part < 4; part++) {
    skyContext.beginPath();
    skyContext.arc(x + part * radius * .85, y + Math.sin(part) * 7, radius * (1 - part * .06), 0, Math.PI * 2);
    skyContext.fill();
  }
}
const skyTexture = new THREE.CanvasTexture(skyCanvas);
skyTexture.colorSpace = THREE.SRGBColorSpace;
skyTexture.mapping = THREE.EquirectangularReflectionMapping;
scene.background = skyTexture;

const grassTexture = makePattern('#6aa64f', '#d8ed78', '#315f35');
grassTexture.repeat.set(14, 20);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(980, 1320),
  new THREE.MeshStandardMaterial({ map: grassTexture, color: 0xb9d994, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const shoulder = new THREE.Mesh(
  stripGeometry(-17.3, 17.3, 1.86),
  new THREE.MeshStandardMaterial({ color: 0x355c38, roughness: 1 })
);
shoulder.receiveShadow = true;
scene.add(shoulder);

const asphaltTexture = makePattern('#626566', '#b8b8ae', '#24292a');
const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTexture, color: 0xb8bab7, roughness: .96 });
const road = new THREE.Mesh(stripGeometry(-14.1, 14.1, 2), roadMat);
road.receiveShadow = true;
scene.add(road);
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf6f5eb, roughness: .8 });
scene.add(new THREE.Mesh(stripGeometry(-13.9, -13.55, 2.055), edgeMat));
scene.add(new THREE.Mesh(stripGeometry(13.55, 13.9, 2.055), edgeMat));
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

const barrierStep = 4;
const barriers = new THREE.InstancedMesh(curbGeo, curbMat, Math.ceil(trackSamples.length / barrierStep) * 2);
let barrierIndex = 0;
for (const side of [-1, 1]) {
  for (let i = 0; i < trackSamples.length; i += barrierStep) {
    const p = trackSamples[i];
    const q = trackSamples[(i + barrierStep) % trackSamples.length];
    curbQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(q.x - p.x, q.z - p.z));
    curbMatrix.compose(
      new THREE.Vector3(
        (p.x + q.x) / 2 + trackNormals[i].x * side * 16.2,
        2.75,
        (p.z + q.z) / 2 + trackNormals[i].y * side * 16.2
      ),
      curbQuaternion,
      new THREE.Vector3(.55, 1.25, p.distanceTo(q) + .5)
    );
    barriers.setMatrixAt(barrierIndex, curbMatrix);
    barriers.setColorAt(barrierIndex++, Math.floor(i / 20) % 2 ? curbRed : curbWhite);
  }
}
barriers.instanceMatrix.needsUpdate = true;
barriers.instanceColor.needsUpdate = true;
barriers.castShadow = true;
scene.add(barriers);

const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf7f5e9, roughness: .75 });
const stripeGeo = new THREE.BoxGeometry(.18, .05, 5.5);
const stripePerLine = trackSamples.length / 3;
const stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, stripePerLine * 2);
const stripeMatrix = new THREE.Matrix4();
let stripeIndex = 0;
for (const lane of [-4.7, 4.7]) {
  for (let i = 0; i < stripePerLine; i++) {
    const sample = i * 3;
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

const whiteMat = new THREE.MeshStandardMaterial({ color: 0xfffdf4, roughness: .8 });
const standBaseMat = new THREE.MeshStandardMaterial({ color: 0x4e514f, roughness: .8 });
const seatMat = new THREE.MeshStandardMaterial({ color: 0xd63832, roughness: .75 });
function addStand(x, z, rotation) {
  const stand = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(58, 3, 18), standBaseMat);
  base.position.y = 1;
  stand.add(base);
  for (let row = 0; row < 5; row++) {
    const seats = new THREE.Mesh(new THREE.BoxGeometry(53 - row * 2, 1.6, 2.5), seatMat);
    seats.position.set(0, 2.8 + row * 1.45, 5 - row * 2.6);
    stand.add(seats);
  }
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.3, .42, 17, 8), standBaseMat);
    pole.position.set(side * 25, 8.5, -7);
    stand.add(pole);
    const light = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3, .7), whiteMat);
    light.position.set(side * 25, 17, -7);
    stand.add(light);
  }
  stand.position.set(x * MAP_SCALE, 1, z * MAP_SCALE);
  stand.rotation.y = rotation;
  scene.add(stand);
}
addStand(-98, 58, Math.PI / 2);
addStand(98, 58, -Math.PI / 2);
addStand(-98, -48, Math.PI / 2);
addStand(98, -48, -Math.PI / 2);

const hash = (value) => {
  const raw = Math.sin(value * 127.1) * 43758.5453;
  return raw - Math.floor(raw);
};
const treePositions = [];
for (let i = 0; i < 420 && treePositions.length < 130; i++) {
  const x = (hash(i * 2 + 1) - .5) * 900;
  const z = (hash(i * 2 + 2) - .5) * 1240;
  const candidate = new THREE.Vector3(x, 0, z);
  if (trackSamples.every((point) => point.distanceToSquared(candidate) > 46 ** 2)) {
    treePositions.push([x, z, 5 + hash(i + 8) * 5, 2.8 + hash(i + 15) * 2]);
  }
}
const trunks = new THREE.InstancedMesh(
  new THREE.CylinderGeometry(.45, .65, 1, 8),
  new THREE.MeshStandardMaterial({ color: 0x765039, roughness: 1 }),
  treePositions.length
);
const crowns = new THREE.InstancedMesh(
  new THREE.IcosahedronGeometry(1, 1),
  new THREE.MeshStandardMaterial({ color: 0x398349, roughness: 1 }),
  treePositions.length
);
const treeMatrix = new THREE.Matrix4();
const treeQuaternion = new THREE.Quaternion();
const treeColors = [new THREE.Color(0x2f7c42), new THREE.Color(0x4a963f), new THREE.Color(0x6aa83e)];
treePositions.forEach(([x, z, height, radius], i) => {
  treeMatrix.compose(new THREE.Vector3(x, height / 2, z), treeQuaternion, new THREE.Vector3(1, height, 1));
  trunks.setMatrixAt(i, treeMatrix);
  treeMatrix.compose(new THREE.Vector3(x, height + radius * .7, z), treeQuaternion, new THREE.Vector3(radius, radius * 1.15, radius));
  crowns.setMatrixAt(i, treeMatrix);
  crowns.setColorAt(i, treeColors[i % treeColors.length]);
});
trunks.instanceMatrix.needsUpdate = true;
crowns.instanceMatrix.needsUpdate = true;
crowns.instanceColor.needsUpdate = true;
trunks.castShadow = crowns.castShadow = true;
scene.add(trunks, crowns);

const gate = new THREE.Group();
const gateMat = new THREE.MeshStandardMaterial({ color: 0x253139, metalness: .55, roughness: .35 });
for (const x of [-16.5, 16.5]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(1.1, 15, 1.1), gateMat);
  post.position.set(x, 7.5, 0);
  gate.add(post);
}
const crossbar = new THREE.Mesh(new THREE.BoxGeometry(34, 1, 1.2), gateMat);
crossbar.position.y = 14.4;
gate.add(crossbar);
const signCanvas = document.createElement('canvas');
signCanvas.width = 512;
signCanvas.height = 96;
const signContext = signCanvas.getContext('2d');
signContext.fillStyle = '#ef542f';
signContext.fillRect(0, 0, 512, 96);
signContext.fillStyle = '#fff';
signContext.font = '900 54px sans-serif';
signContext.textAlign = 'center';
signContext.textBaseline = 'middle';
signContext.fillText('MANDRIDER', 256, 51);
const signTexture = new THREE.CanvasTexture(signCanvas);
signTexture.colorSpace = THREE.SRGBColorSpace;
const sign = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 4.5),
  new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.DoubleSide })
);
sign.position.set(0, 14.4, -.65);
sign.rotation.y = Math.PI;
gate.add(sign);
gate.position.copy(start);
gate.rotation.y = startAngle;
scene.add(gate);

const minimap = document.getElementById('minimap');
const minimapBase = document.createElement('canvas');
minimapBase.width = minimap.width;
minimapBase.height = minimap.height;
const minimapBaseContext = minimapBase.getContext('2d');
const minimapContext = minimap.getContext('2d');
const mapBounds = trackSamples.reduce((bounds, point) => ({
  minX: Math.min(bounds.minX, point.x), maxX: Math.max(bounds.maxX, point.x),
  minZ: Math.min(bounds.minZ, point.z), maxZ: Math.max(bounds.maxZ, point.z)
}), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
function minimapPoint(point) {
  const padding = 16;
  return [
    padding + (point.x - mapBounds.minX) / (mapBounds.maxX - mapBounds.minX) * (minimap.width - padding * 2),
    padding + (mapBounds.maxZ - point.z) / (mapBounds.maxZ - mapBounds.minZ) * (minimap.height - padding * 2)
  ];
}
function strokeMinimap(context, color, width) {
  context.beginPath();
  trackSamples.forEach((point, i) => {
    const [x, y] = minimapPoint(point);
    if (i) context.lineTo(x, y); else context.moveTo(x, y);
  });
  context.closePath();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineJoin = context.lineCap = 'round';
  context.stroke();
}
strokeMinimap(minimapBaseContext, 'rgba(10,18,24,.85)', 9);
strokeMinimap(minimapBaseContext, '#f7fbff', 5);

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

  const smoke = new THREE.Group();
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0xeaf4ef, transparent: true, opacity: .42, depthWrite: false });
  for (let i = 0; i < 8; i++) smoke.add(new THREE.Mesh(new THREE.IcosahedronGeometry(.24, 1), smokeMat));
  smoke.visible = false;
  kart.add(smoke);
  kart.userData = { wheels, plant, flames, sparks, smoke };
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
const timeEl = document.getElementById('race-time');
const speedDialEl = document.getElementById('speed-dial');

function drawMinimap() {
  minimapContext.clearRect(0, 0, minimap.width, minimap.height);
  minimapContext.drawImage(minimapBase, 0, 0);
  const [x, y] = minimapPoint(raceActive ? state : start);
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
  countdownEl.textContent = raceActive && state.startTimer > 0 ? Math.ceil(state.startTimer) : (raceActive && state.startTimer > -0.75 ? 'GO!' : '');
  noticeEl.textContent = state.noticeTimer > 0 ? state.notice : '';
  lapEl.textContent = `${Math.min(lap, 3)} / 3`;
  driveStateEl.textContent = raceFinished ? '완주!' : state.boostTimer > 0 ? 'N₂O 부스터' : state.instantTimer > 0 ? '순간 부스터' : state.drifting ? `${state.driftChain > 1 ? `${state.driftChain}연속 ` : ''}드리프트` : state.speed < -0.5 ? '후진' : state.started ? '주행 중' : '출발 준비';
  drawMinimap();
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
  const { wheels, plant, flames, sparks, smoke } = kart.userData;
  for (const wheel of wheels) wheel.rotation.x -= state.speed * dt / 0.42;
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

  const forwardX = Math.sin(state.heading);
  const forwardZ = -Math.cos(state.heading);
  cameraTarget.set(state.x - forwardX * 18, 9.5, state.z - forwardZ * 18);
  camera.position.lerp(cameraTarget, 1 - Math.exp(-dt * 7));
  cameraLook.set(state.x + forwardX * 15, 2.6, state.z + forwardZ * 15);
  camera.lookAt(cameraLook);
  camera.rotateZ(-state.lateral * .0015);
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
