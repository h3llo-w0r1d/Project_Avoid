import * as THREE from 'three';
import { ARENA_RADIUS, CAMERA, COLORS } from './config.js';
import { view } from './orientation.js';
import {
  makeGrassTexture, makeSoilTexture, makeSkyTexture, makeGrassTuftTexture, makeSoftDotTexture
} from './textures.js';

const SOFT_DOT = makeSoftDotTexture();

// 해질녘 숲속 빈터. 게임 로직과 무관한 볼거리를 전부 여기서 만든다.
// 붉은 전기선이 묻히지 않도록 바닥과 하늘은 채도·명도를 눌러 둔다.

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: window.devicePixelRatio < 2
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.haze, 60, 220);

  // 실제 위치와 거리는 fitCamera() 가 화면 비율에 맞춰 잡아 준다.
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);

  addSky(scene);
  addLights(scene);
  const deck = addArena(scene);
  addPollen(scene);

  return { renderer, scene, camera, deck };
}

function addSky(scene) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(320, 32, 24),
    new THREE.MeshBasicMaterial({
      map: makeSkyTexture(), side: THREE.BackSide, depthWrite: false, fog: false
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);
}

function addLights(scene) {
  // 위는 땅거미 하늘빛, 아래는 풀에서 올라오는 반사광
  scene.add(new THREE.HemisphereLight(0x8fb6d8, 0x2e3d22, 0.85));

  // 지평선에 낮게 걸린 해
  const key = new THREE.DirectionalLight(0xffd9a8, 1.7);
  key.position.set(16, 15, 14);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 5;
  key.shadow.camera.far = 80;
  const s = ARENA_RADIUS + 5;
  Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0012;
  scene.add(key);

  // 반대쪽에서 받쳐 주는 서늘한 빛 — 그림자가 새까맣게 죽지 않게
  const fill = new THREE.DirectionalLight(0x6d9ec9, 0.5);
  fill.position.set(-18, 7, -16);
  scene.add(fill);
}

function addArena(scene) {
  const group = new THREE.Group();

  // 상판 — 잔디
  const top = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_RADIUS, 96),
    new THREE.MeshStandardMaterial({ map: makeGrassTexture(), roughness: 0.95, metalness: 0 })
  );
  top.name = 'deck-top';
  top.rotation.x = -Math.PI / 2;
  top.receiveShadow = true;
  group.add(top);

  // 옆면 — 흙 절벽. 아래로 갈수록 좁아져서 떠 있는 섬처럼 보인다.
  const cliff = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS * 0.86, 3.4, 48, 1, true),
    new THREE.MeshStandardMaterial({
      map: makeSoilTexture(), roughness: 0.95, metalness: 0, side: THREE.DoubleSide
    })
  );
  cliff.name = 'deck-cliff';
  cliff.position.y = -1.7;
  group.add(cliff);

  group.add(buildEdgeStones());
  const tufts = buildGrassTufts();
  tufts.name = 'deck-tufts';
  group.add(tufts);
  group.add(buildUnderside());

  scene.add(group);
  return group;
}

// 같은 모양을 여러 번 놓을 때 쓴다. 메시를 따로 만들면 개수만큼
// 드로우콜이 늘지만, 인스턴싱하면 몇 개를 놓든 한 번에 그린다.
function scatter(geo, mat, count, place) {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const rot = new THREE.Euler();
  const quat = new THREE.Quaternion();

  for (let i = 0; i < count; i++) {
    place(i, pos, rot, scl);
    quat.setFromEuler(rot);
    mesh.setMatrixAt(i, m.compose(pos, quat, scl));
  }
  mesh.instanceMatrix.needsUpdate = true;
  // 그림자는 끈다. 가장자리 장식이라 그림자가 거의 보이지도 않는데
  // 켜면 그림자 맵을 굽는 패스에 전부 다시 그려진다.
  mesh.castShadow = false;
  return mesh;
}

// 가장자리를 두른 돌. 어디서 떨어지는지 한눈에 보이게 밝은 돌을 쓴다.
function buildEdgeStones() {
  const count = 46;
  return scatter(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0xa89e8c, roughness: 0.85, metalness: 0.05 }),
    count,
    (i, pos, rot, scl) => {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.05;
      const size = 0.3 + Math.random() * 0.26;
      pos.set(
        Math.cos(a) * (ARENA_RADIUS - 0.15),
        -0.06 + Math.random() * 0.1,
        Math.sin(a) * (ARENA_RADIUS - 0.15)
      );
      rot.set(Math.random(), Math.random() * 3, Math.random());
      scl.set(size * (0.8 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.4), size);
    }
  );
}

// 바닥에 심는 풀포기. 전기선은 y 0.6 에 있으므로 그보다 훨씬 낮게 유지한다.
function buildGrassTufts() {
  const tex = makeGrassTuftTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, metalness: 0
  });

  // 십자로 겹친 판 두 장 — 어느 각도에서 봐도 종잇장으로 보이지 않는다
  const plane = new THREE.PlaneGeometry(1, 1);
  const a = plane.clone().translate(0, 0.5, 0);
  const b = plane.clone().rotateY(Math.PI / 2).translate(0, 0.5, 0);
  const merged = mergeTwo(a, b);

  const COUNT = 520;
  const tufts = new THREE.InstancedMesh(merged, mat, COUNT);
  tufts.castShadow = false;
  tufts.receiveShadow = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  for (let i = 0; i < COUNT; i++) {
    const ang = Math.random() * Math.PI * 2;
    // sqrt 를 써야 원 안에 고르게 퍼진다. 그냥 곱하면 가운데로 몰린다.
    const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 0.5);
    const h = 0.22 + Math.random() * 0.16;
    pos.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
    scl.set(h * (0.9 + Math.random() * 0.5), h, h);
    tufts.setMatrixAt(i, m.compose(pos, q, scl));
  }
  tufts.instanceMatrix.needsUpdate = true;
  return tufts;
}

// 지오메트리 두 개를 정점 배열째 이어 붙인다.
// BufferGeometryUtils 를 쓰자고 파일 하나를 더 벤더링하기엔 과하다.
function mergeTwo(a, b) {
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const av = a.attributes[name];
    const bv = b.attributes[name];
    const out = new Float32Array(av.array.length + bv.array.length);
    out.set(av.array, 0);
    out.set(bv.array, av.array.length);
    geo.setAttribute(name, new THREE.BufferAttribute(out, av.itemSize));
  }
  const ai = a.index.array;
  const bi = b.index.array;
  const idx = new Uint16Array(ai.length + bi.length);
  idx.set(ai, 0);
  const offset = a.attributes.position.count;
  for (let i = 0; i < bi.length; i++) idx[ai.length + i] = bi[i] + offset;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

// 무대 아래. 흙덩이와 늘어진 뿌리 — 섬이 공중에 떠 있는 느낌을 만든다.
function buildUnderside() {
  const under = new THREE.Group();
  // 절벽과 같은 흙 무늬를 이어 붙인다. 단색이면 흔들어 놓은 면들이
  // 커다란 삼각형 조각처럼 도드라져 보인다.
  const clumpTex = makeSoilTexture();
  clumpTex.repeat.set(4, 1);
  const soil = new THREE.MeshStandardMaterial({
    map: clumpTex, color: 0x9c8874, roughness: 1, metalness: 0
  });

  // 아래로 좁아지는 흙덩어리.
  // 완전한 원뿔(ConeGeometry)은 꼭짓점에서 UV 가 뭉개져 텍스처가 삼각형으로
  // 갈라진다. 끝을 조금 남긴 원통으로 만들면 UV 가 사각형으로 곱게 펴진다.
  const clump = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA_RADIUS * 0.86, ARENA_RADIUS * 0.1, 9, 40, 8, true),
    soil
  );
  clump.position.y = -7.9;
  clump.rotation.y = 0.3;
  jitter(clump.geometry, 0.3);
  under.add(clump);

  // 끝을 막는 흙덩이
  const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(ARENA_RADIUS * 0.14, 1), soil);
  tip.position.y = -12.3;
  tip.scale.y = 0.7;
  under.add(tip);

  // 떨어져 나온 흙덩이 몇 개
  under.add(scatter(
    new THREE.DodecahedronGeometry(1, 0), soil, 9,
    (i, pos, rot, scl) => {
      const a = Math.random() * Math.PI * 2;
      const r = ARENA_RADIUS * (0.5 + Math.random() * 0.7);
      const s = 0.4 + Math.random() * 1.1;
      pos.set(Math.cos(a) * r, -3 - Math.random() * 11, Math.sin(a) * r);
      rot.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      scl.set(s, s * 0.7, s);
    }
  ));

  // 가장자리에서 늘어진 뿌리. 길이는 스케일로 준다.
  const count = 26;
  under.add(scatter(
    new THREE.CylinderGeometry(0.05, 0.13, 1, 5),
    new THREE.MeshStandardMaterial({ color: 0x53402c, roughness: 1 }),
    count,
    (i, pos, rot, scl) => {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.2;
      const len = 1.4 + Math.random() * 4.5;
      const r = ARENA_RADIUS * (0.9 + Math.random() * 0.08);
      pos.set(Math.cos(a) * r, -0.6 - len / 2, Math.sin(a) * r);
      rot.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
      scl.set(1, len, 1);
    }
  ));

  return under;
}

// 정점을 무작위로 밀어 매끈한 도형을 자연물처럼 만든다.
function jitter(geometry, amount) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + (Math.random() - 0.5) * amount,
      pos.getY(i) + (Math.random() - 0.5) * amount * 0.5,
      pos.getZ(i) + (Math.random() - 0.5) * amount
    );
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

// 공중에 떠다니는 꽃가루. 별 대신 화면에 잔잔한 움직임을 준다.
function addPollen(scene) {
  const count = 420;
  const pos = new Float32Array(count * 3);
  const speed = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * (ARENA_RADIUS + 14);
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.random() * 16 - 1;
    pos[i * 3 + 2] = Math.sin(a) * r;
    speed[i] = 0.15 + Math.random() * 0.45;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const pollen = new THREE.Points(geo, new THREE.PointsMaterial({
    map: SOFT_DOT, color: 0xffe2a0, size: 0.2, sizeAttenuation: true,
    transparent: true, opacity: 0.32, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false
  }));
  pollen.name = 'pollen';
  pollen.frustumCulled = false;

  // 천천히 위로 떠오르다가 꼭대기에 닿으면 아래에서 다시 시작
  pollen.userData.animate = (dt, t) => {
    const arr = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += speed[i] * dt;
      arr[i * 3] += Math.sin(t * 0.6 + i) * dt * 0.25;
      if (arr[i * 3 + 1] > 15) arr[i * 3 + 1] = -1;
    }
    geo.attributes.position.needsUpdate = true;
  };

  scene.add(pollen);
}

// ---------------------------------------------------------------- 카메라

// 카메라 고각 — 무대를 얼마나 위에서 내려다볼지. 낮으면 멋있고, 높으면 판단이 쉽다.
// 세로로 긴 화면은 가로가 좁아 거리를 많이 벌려야 하므로, 더 위에서 내려다봐
// 남는 세로 공간을 쓰고 전기선 위치도 읽기 쉽게 한다.
function tiltFor(aspect) {
  const k = THREE.MathUtils.clamp((aspect - 0.55) / (1.5 - 0.55), 0, 1);
  return THREE.MathUtils.degToRad(THREE.MathUtils.lerp(CAMERA.tiltTall, CAMERA.tiltWide, k));
}

// 프레임 안에 반드시 들어와야 하는 지점들 — 무대 테두리와 그 위 공간.
// 원근 때문에 앞쪽 테두리가 뒤쪽보다 훨씬 크게 잡히므로,
// 공식 대신 실제로 투영해서 확인한다.
const FIT_POINTS = (() => {
  const pts = [];
  const r = ARENA_RADIUS + CAMERA.padding;
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    pts.push(new THREE.Vector3(x, 0, z));
    pts.push(new THREE.Vector3(x, 2.4, z));
  }
  return pts;
})();

const LOOK_AT = new THREE.Vector3(0, 0.5, 0);
const probe = new THREE.Vector3();

function placeAt(camera, dist, tilt) {
  camera.position.set(0, dist * Math.sin(tilt), dist * Math.cos(tilt));
  camera.lookAt(LOOK_AT);
  camera.updateMatrixWorld(true);
}

function allVisible(camera) {
  for (const p of FIT_POINTS) {
    probe.copy(p).project(camera);
    if (Math.abs(probe.x) > CAMERA.margin || Math.abs(probe.y) > CAMERA.margin) return false;
  }
  return true;
}

// 화면 비율이 어떻든 무대 전체가 프레임에 들어오도록 카메라 거리를 다시 잡는다.
export function fitCamera(camera, renderer) {
  // 화면을 강제로 가로로 돌렸으면 폭·높이가 뒤바뀐다. view() 가 그걸 맞춰 준다.
  const { w, h } = view();
  renderer.setSize(w, h, false);

  const aspect = w / h;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  const tilt = tiltFor(aspect);

  // 전부 들어오는 최소 거리를 이분 탐색으로 찾는다.
  let lo = 10;
  let hi = 260;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    placeAt(camera, mid, tilt);
    if (allVisible(camera)) hi = mid;
    else lo = mid;
  }
  placeAt(camera, hi, tilt);
}

// 경기장 스킨 — 상판·절벽·풀포기의 색을 바꾼다.
//
// 무늬(텍스처)는 그대로 두고 색만 곱한다. 스킨마다 텍스처를 새로 구우면
// 고를 때마다 몇십 ms 씩 멈추는데, 색만 바꾸면 즉시 반영되고 같은 무늬가
// 계절이 바뀐 것처럼 보인다. 무늬 자체를 갈아야 하는 스킨이 생기면
// 그때 spec 에 map 을 받아 여기서 갈아 끼우면 된다.
//
// spec 이 비었으면(기본 스킨) 원래 색으로 되돌린다.
export function paintArena(deck, spec = {}) {
  if (!deck) return;
  const put = (name, hex) => {
    const o = deck.getObjectByName(name);
    if (!o) return;
    // 풀포기는 그룹이라 안쪽 메시들을 훑는다
    o.traverse?.((m) => { if (m.material?.color) m.material.color.setHex(hex ?? 0xffffff); });
    if (o.material?.color) o.material.color.setHex(hex ?? 0xffffff);
  };
  put('deck-top', spec.top);
  put('deck-cliff', spec.cliff);
  put('deck-tufts', spec.tuft);
}
