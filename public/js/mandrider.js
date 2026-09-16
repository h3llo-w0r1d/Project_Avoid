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

// 참고 미니맵의 비율과 일곱 연속 헤어핀 순서를 그대로 따라야 손가락형 실루엣이 유지된다.
// 직선이 지루해서 가로로 줄였다. 코너는 손대지 않았다 — 헤어핀을 이루는 점들을
// 통째로 같은 거리만큼 밀어서, 직선 길이만 빠지고 회전 반경은 그대로다.
const MAP_SCALE = 4.0;
const trackCurve = new THREE.CatmullRomCurve3([
  [0, -50], [-38, -50], [-48, -48], [-54, -44], [-56, -38], [-56, 49],
  [-54, 56], [-48, 62], [-38, 65], [43, 65], [50, 63], [54, 59],
  [54, 55], [50, 51], [43, 49], [10, 49], [4, 47], [0, 43],
  [0, 39], [4, 35], [10, 33], [43, 33], [50, 31], [54, 27],
  [54, 23], [50, 19], [43, 17], [10, 17], [4, 15], [0, 11],
  [0, 7], [4, 3], [10, 1], [43, 1], [50, -1], [54, -5],
  [54, -9], [50, -13], [43, -15], [10, -15], [4, -17], [0, -21],
  [0, -25], [4, -29], [10, -31], [56, -31], [63, -33], [68, -37],
  [68, -42], [65, -46], [60, -49], [53, -50], [44, -50]
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

function loadTiledTexture(path, repeatX, repeatY) {
  const texture = new THREE.TextureLoader().load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

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

// 주변 지형 없이도 난간이 공중에 뜨지 않도록 트랙 폭만큼의 구조물만 남긴다.
const trackDeck = new THREE.Mesh(
  stripGeometry(-17.3, 17.3, 1.78),
  new THREE.MeshStandardMaterial({ color: 0xb9c1bd, metalness: .08, roughness: .82 })
);
trackDeck.receiveShadow = true;
scene.add(trackDeck);

const asphaltTexture = loadTiledTexture('./img/mandrider-asphalt-v1.webp', 3, 1);
const roadMat = new THREE.MeshStandardMaterial({
  map: asphaltTexture, bumpMap: asphaltTexture, bumpScale: .09, color: 0xd7d8d5, roughness: .88
});
const road = new THREE.Mesh(stripGeometry(-14.1, 14.1, 2), roadMat);
road.receiveShadow = true;
scene.add(road);
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xfff8de, roughness: .72 });
scene.add(new THREE.Mesh(stripGeometry(-13.9, -13.55, 2.055), edgeMat));
scene.add(new THREE.Mesh(stripGeometry(13.55, 13.9, 2.055), edgeMat));
const curbGeo = new THREE.BoxGeometry(1, 1, 1);
const curbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6 });
const curbs = new THREE.InstancedMesh(curbGeo, curbMat, trackSamples.length * 2);
const curbMatrix = new THREE.Matrix4();
const curbQuaternion = new THREE.Quaternion();
const curbGreen = new THREE.Color(0x327a4b);
const curbIvory = new THREE.Color(0xfff4cf);
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
      new THREE.Vector3(.78, .16, p.distanceTo(q) + .16)
    );
    curbs.setMatrixAt(curbIndex, curbMatrix);
    curbs.setColorAt(curbIndex++, Math.floor(i / 5) % 2 ? curbGreen : curbIvory);
  }
}
curbs.instanceMatrix.needsUpdate = true;
curbs.instanceColor.needsUpdate = true;
scene.add(curbs);

const barrierStep = 5;
const barrierCount = Math.ceil(trackSamples.length / barrierStep) * 2;
const railMat = new THREE.MeshStandardMaterial({ color: 0xe8eedb, metalness: .28, roughness: .42 });
const postMat = new THREE.MeshStandardMaterial({ color: 0x325b46, metalness: .18, roughness: .5 });
const rails = new THREE.InstancedMesh(curbGeo, railMat, barrierCount * 2);
const posts = new THREE.InstancedMesh(curbGeo, postMat, barrierCount);
let railIndex = 0;
let postIndex = 0;
for (const side of [-1, 1]) {
  for (let i = 0; i < trackSamples.length; i += barrierStep) {
    const p = trackSamples[i];
    const q = trackSamples[(i + barrierStep) % trackSamples.length];
    curbQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(q.x - p.x, q.z - p.z));
    const x = (p.x + q.x) / 2 + trackNormals[i].x * side * 16.15;
    const z = (p.z + q.z) / 2 + trackNormals[i].y * side * 16.15;
    for (const y of [3.05, 3.82]) {
      curbMatrix.compose(new THREE.Vector3(x, y, z), curbQuaternion, new THREE.Vector3(.24, .18, p.distanceTo(q) + .65));
      rails.setMatrixAt(railIndex++, curbMatrix);
    }
    curbMatrix.compose(
      new THREE.Vector3(p.x + trackNormals[i].x * side * 16.15, 3.15, p.z + trackNormals[i].y * side * 16.15),
      curbQuaternion,
      new THREE.Vector3(.5, 2.05, .5)
    );
    posts.setMatrixAt(postIndex++, curbMatrix);
  }
}
rails.instanceMatrix.needsUpdate = true;
posts.instanceMatrix.needsUpdate = true;
rails.castShadow = posts.castShadow = true;
scene.add(rails, posts);

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

// 전기선. 좌우로 피하는 장애물이라 직선에만 세운다 — 코너에 두면 카트가
// 이미 기울어 들어오는 터라 피할 각이 안 나온다. 트랙을 고치면 직선 위치도
// 달라지므로, 좌표를 박아 두지 않고 매번 곡률을 재서 자리를 찾는다.
const ARC_GAP = 4.6;          // 빠져나갈 틈의 절반 너비
const ARC_LANES = [-6.6, 6.6, 0];  // 틈의 좌우 위치를 번갈아 둬서 계속 꺾게 만든다
const arcs = [];
{
  const headingAt = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
  const total = trackSamples.length;
  let previousArc = -Infinity;
  // 출발선 직후와 결승선 직전은 비워 둔다. 출발하자마자 눈앞에 서 있으면
  // 피할 판단을 할 시간이 없다.
  for (let i = 120; i < total - 120; i++) {
    if (i - previousArc < 96) continue;
    const a = trackSamples[i - 24];
    const b = trackSamples[i];
    const c = trackSamples[i + 24];
    const turn = headingAt(b, c) - headingAt(a, b);
    if (Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) > .1) continue;
    arcs.push({ index: i, lane: ARC_LANES[arcs.length % ARC_LANES.length] });
    previousArc = i;
  }
}

// 막대 하나를 재질까지 같이 쓴다. 깜빡임을 재질 한 곳만 건드려 처리하려는 것.
const arcMat = new THREE.MeshBasicMaterial({ color: 0xff2f3d, transparent: true, opacity: .92 });
const arcGlowMat = new THREE.MeshBasicMaterial({ color: 0xff8a5c, transparent: true, opacity: .3, depthWrite: false });
const arcGeo = new THREE.BoxGeometry(1, 2.7, .42);
const arcGlowGeo = new THREE.BoxGeometry(1, 3.5, 1.5);
for (const arc of arcs) {
  const point = trackSamples[arc.index];
  const normal = trackNormals[arc.index];
  // 로컬 +X 를 트랙 법선 방향으로 돌린다. 막대가 도로를 가로질러 서야 한다.
  const yaw = Math.atan2(-normal.y, normal.x);
  for (const [from, to] of [[-KART.roadHalfWidth, arc.lane - ARC_GAP], [arc.lane + ARC_GAP, KART.roadHalfWidth]]) {
    const width = to - from;
    if (width < .4) continue;
    const offset = (from + to) / 2;
    for (const [geo, mat, y] of [[arcGeo, arcMat, 3.4], [arcGlowGeo, arcGlowMat, 3.4]]) {
      const bar = new THREE.Mesh(geo, mat);
      bar.scale.x = width;
      bar.rotation.y = yaw;
      bar.position.set(point.x + normal.x * offset, y, point.z + normal.y * offset);
      scene.add(bar);
    }
  }
}

const start = trackSamples[0];
const startNext = trackSamples[1];
const startAngle = Math.atan2(startNext.x - start.x, startNext.z - start.z);
const startHeading = Math.atan2(startNext.x - start.x, -(startNext.z - start.z));
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

const gate = new THREE.Group();
const gateStoneMat = new THREE.MeshStandardMaterial({ color: 0xe8d9b7, roughness: .68 });
const gateGreenMat = new THREE.MeshStandardMaterial({ color: 0x285c43, metalness: .15, roughness: .42 });
const gateGoldMat = new THREE.MeshStandardMaterial({ color: 0xe2bd5c, metalness: .48, roughness: .32 });
for (const x of [-16.5, 16.5]) {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.1, 1.3, 12), gateStoneMat);
  base.position.set(x, .65, 0);
  gate.add(base);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.72, 1.08, 12.5, 12), gateStoneMat);
  post.position.set(x, 7.45, 0);
  gate.add(post);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.05, .75, 12), gateGoldMat);
  cap.position.set(x, 13.8, 0);
  gate.add(cap);
  const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(1.55, 1), gateGreenMat);
  crown.scale.set(1.35, .85, .9);
  crown.position.set(x, 15, 0);
  gate.add(crown);
}
const crossbar = new THREE.Mesh(new THREE.BoxGeometry(35, 1.3, 1.4), gateGreenMat);
crossbar.position.y = 13.45;
gate.add(crossbar);
for (let x = -13.5, i = 0; x <= 13.5; x += 3, i++) {
  const leaf = new THREE.Mesh(new THREE.DodecahedronGeometry(.72, 0), i % 2 ? gateGreenMat : gateGoldMat);
  leaf.scale.set(1.3, .55, .62);
  leaf.position.set(x, 14.3 + Math.cos(x) * .18, 0);
  leaf.rotation.z = x * .08;
  gate.add(leaf);
}
const signCanvas = document.createElement('canvas');
signCanvas.width = 1024;
signCanvas.height = 256;
const signContext = signCanvas.getContext('2d');
const signGradient = signContext.createLinearGradient(0, 0, 0, 256);
signGradient.addColorStop(0, '#3f8058');
signGradient.addColorStop(1, '#1d4938');
signContext.fillStyle = signGradient;
signContext.fillRect(0, 0, 1024, 256);
signContext.strokeStyle = '#e7c867';
signContext.lineWidth = 18;
signContext.strokeRect(14, 14, 996, 228);
signContext.fillStyle = '#fff6cf';
signContext.font = '900 112px sans-serif';
signContext.textAlign = 'center';
signContext.textBaseline = 'middle';
signContext.shadowColor = 'rgba(0,0,0,.42)';
signContext.shadowBlur = 10;
signContext.shadowOffsetY = 6;
signContext.fillText('MANDRIDER', 512, 134);
const signTexture = new THREE.CanvasTexture(signCanvas);
signTexture.colorSpace = THREE.SRGBColorSpace;
signTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
const sign = new THREE.Mesh(
  new THREE.PlaneGeometry(21, 4.1),
  new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.DoubleSide })
);
sign.position.set(0, 16.35, -.65);
sign.rotation.y = Math.PI;
gate.add(sign);
gate.position.copy(trackCurve.getPointAt(.0015));
gate.rotation.y = startAngle;
gate.traverse((part) => { if (part.isMesh) part.castShadow = part.receiveShadow = true; });
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
let raceDead = false;
let lap = 1;
let lapArmed = false;
let previousProgress = 0;

function reset() {
  state = createKartState();
  state.x = start.x;
  state.z = start.z;
  state.heading = startHeading;
  cameraHeading = startHeading;
  raceFinished = false;
  raceDead = false;
  lap = 1;
  lapArmed = false;
  previousProgress = 0;
  pressed.clear();
  for (const key of Object.keys(keys)) keys[key] = false;
}

document.getElementById('start-race').addEventListener('click', () => {
  document.getElementById('map-select').classList.add('hidden');
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
  // 감전·완주 안내는 카운트다운 자리를 빌려 쓴다. 주행 중 잡다한 알림까지
  // 여기에 띄우면 화면 한가운데가 계속 번쩍여 방해된다.
  countdownEl.textContent = raceActive && state.startTimer > 0 ? Math.ceil(state.startTimer)
    : raceActive && state.startTimer > -0.75 ? 'GO!'
    : raceDead || raceFinished ? state.notice : '';
  lapEl.textContent = `${Math.min(lap, 3)} / 3`;
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

// 전기선에 닿았는지 본다. 막대의 좌표계로 옮겨서, 트랙을 따라 막대 두께 안에
// 들어왔고 좌우로는 틈 밖이면 감전이다.
function touchedArc() {
  for (const arc of arcs) {
    const point = trackSamples[arc.index];
    const normal = trackNormals[arc.index];
    const dx = state.x - point.x;
    const dz = state.z - point.z;
    const along = dx * -normal.y + dz * normal.x;
    if (Math.abs(along) > 2.2) continue;
    const across = dx * normal.x + dz * normal.y;
    // 도로 밖이면 이 전기선과 무관하다. 트랙이 뱀처럼 접혀 있어서, 이 검사가
    // 없으면 옆 손가락을 달릴 때 여기 띠에 걸려 보이지도 않는 전기에 죽는다.
    if (Math.abs(across) > KART.roadHalfWidth) continue;
    if (Math.abs(across - arc.lane) > ARC_GAP) return true;
  }
  return false;
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

  // 전기선이 지직거리게 한다. 막대들이 재질을 공유해서 여기 두 줄이면 다 같이 떤다.
  arcMat.opacity = .72 + Math.random() * .28;
  arcGlowMat.opacity = .16 + Math.random() * .2;

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
    raceSky.offset.x = (cameraHeading - startHeading) / (Math.PI * 2) + state.elapsed * .0008;
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
  if (raceActive && !raceFinished && !raceDead) {
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
    constrainToRoad(state, nearest.point.x, nearest.point.z);
    updateLap(nearest.index);
    if (!raceFinished && state.startTimer <= 0 && touchedArc()) {
      raceDead = true;
      state.speed = state.lateral = 0;
      state.notice = '감전! R 키로 다시';
      state.noticeTimer = 3600;
    }
  }
  pressed.clear();
  updateScene(dt, nowMs / 1000);
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
