import * as THREE from 'three';
import { ARENA_RADIUS, CAMERA, COLORS } from './config.js';
import { view } from './orientation.js';
import {
  makeGrassTexture, makeSoilTexture, makeSkyTexture, makeGrassTuftTexture, makeSoftDotTexture,
  makeSnowTexture
} from './textures.js';

// a~b 사이 아무 수. textures.js 에도 같은 게 있지만 그건 내보내지 않는다.
const rnd = (a, b) => a + Math.random() * (b - a);

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
    new THREE.MeshStandardMaterial({ map: topTexture('grass'), roughness: 0.95, metalness: 0 })
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

  const stones = buildEdgeStones();
  stones.name = 'deck-stones';
  group.add(stones);

  // 설원 스킨이 바위 대신 쓰는 얼음 기둥. 미리 만들어 두고 감춰 둔다 —
  // 고를 때마다 만들면 그 순간 멈칫한다(46개 인스턴싱).
  const ice = buildEdgeIce();
  ice.name = 'deck-ice';
  ice.visible = false;
  group.add(ice);

  // 설원 바닥 장식. 잔디는 풀포기(deck-tufts)가 바닥에 입체감을 주는데,
  // 눈밭은 그걸 감추다 보니 허허벌판이 됐다. 대신 눈더미와 작은 얼음
  // 조각을 깔아 준다.
  const snowy = buildSnowDetail();
  snowy.name = 'deck-snowdeco';
  snowy.visible = false;
  group.add(snowy);
  const tufts = buildGrassTufts();
  tufts.name = 'deck-tufts';
  group.add(tufts);
  group.add(buildUnderside());

  scene.add(group);
  return group;
}

// 같은 모양을 여러 번 놓을 때 쓴다. 메시를 따로 만들면 개수만큼
// 드로우콜이 늘지만, 인스턴싱하면 몇 개를 놓든 한 번에 그린다.
function scatter(geo, mat, count, place, color = null) {
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
    if (color) mesh.setColorAt(i, color(i));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // 그림자는 끈다. 가장자리 장식이라 그림자가 거의 보이지도 않는데
  // 켜면 그림자 맵을 굽는 패스에 전부 다시 그려진다.
  mesh.castShadow = false;
  return mesh;
}

// 가장자리를 두른 돌. 어디서 떨어지는지 한눈에 보이게 밝은 돌을 쓴다.
//
// 하나짜리 정십이면체를 그대로 쓰면 46개가 전부 똑같이 생긴 공이라 인조물처럼
// 보인다. 그렇다고 돌마다 메시를 따로 만들면 드로우콜이 46번이다.
// 절충: 서로 다르게 찌그러뜨린 바위 3종을 만들어 나눠 심는다(드로우콜 3번).
// 여기에 돌마다 색을 조금씩 달리해(instanceColor) 같은 모양이 반복돼도
// 눈에 덜 띄게 한다.
function buildEdgeStones() {
  const group = new THREE.Group();
  const KINDS = 3;
  const count = 48;
  const per = count / KINDS;

  for (let k = 0; k < KINDS; k++) {
    // 면을 한 번 더 쪼갠 뒤 찌그러뜨린다. 쪼개지 않으면 찌그러뜨려도
    // 면이 커서 각진 사탕처럼 보인다.
    const geo = new THREE.DodecahedronGeometry(1, 1);
    rockify(geo, 0.5 + k * 0.12, k + 1);
    // 납작 셰이딩 — 면이 또렷해야 저폴리 바위처럼 보인다(무대 그림체와 맞다)
    const mat = new THREE.MeshStandardMaterial({
      color: 0xa89e8c, roughness: 0.92, metalness: 0.04, flatShading: true
    });

    group.add(scatter(geo, mat, per,
      (i, pos, rot, scl) => {
        // 종류를 번갈아 심어야 같은 모양이 몰려 있지 않다
        const idx = i * KINDS + k;
        const a = (idx / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.06;
        const size = 0.28 + Math.random() * 0.30;
        pos.set(
          Math.cos(a) * (ARENA_RADIUS - 0.15),
          -0.08 + Math.random() * 0.13,
          Math.sin(a) * (ARENA_RADIUS - 0.15)
        );
        rot.set(Math.random() * 0.6, Math.random() * 6.3, Math.random() * 0.6);
        // 가로로 눕거나 세로로 선 돌이 섞이게 축마다 따로 흔든다
        scl.set(
          size * (0.75 + Math.random() * 0.7),
          size * (0.55 + Math.random() * 0.6),
          size * (0.75 + Math.random() * 0.7)
        );
      },
      // 돌마다 밝기·색기를 조금씩 — 이끼 낀 것, 볕에 바랜 것이 섞인 느낌
      () => {
        const v = 0.78 + Math.random() * 0.30;
        return new THREE.Color(v, v * (0.97 + Math.random() * 0.05), v * (0.92 + Math.random() * 0.08));
      }
    ));
  }
  return group;
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

// 설원용 가장자리 장식 — 솟아오른 얼음 기둥.
//
// 바위와 같은 자리에 서지만 생김새가 정반대다: 바위는 낮고 둥글게 굴러
// 있고, 얼음은 뾰족하게 위로 솟는다. 그래야 스킨을 바꿨을 때 '색만 바뀐 게
// 아니라' 는 느낌이 든다.
//
// 처음엔 바위처럼 둘레에 고르게 한 줄로 세웠더니 띄엄띄엄해서 허전했다.
// 얼음은 원래 무리 지어 솟는다. 그래서 '무리' 를 잡고 그 언저리에 크고 작은
// 조각을 몰아 심는다. 무리와 무리 사이가 비어야 오히려 뭉친 데가 도드라진다.
// 큰 기둥 사이의 빈 곳은 낮은 조각으로 메워 바닥이 허전하지 않게 한다.
function buildEdgeIce() {
  const group = new THREE.Group();

  // 무리의 중심 각도. 고르게 두되 조금씩 흔들어 기계적이지 않게.
  const CLUSTERS = 26;
  const centers = [];
  for (let i = 0; i < CLUSTERS; i++) {
    centers.push((i / CLUSTERS) * Math.PI * 2 + (Math.random() - 0.5) * 0.14);
  }

  // 큰 기둥 · 중간 · 낮은 조각 세 층으로 쌓는다.
  //   spread : 무리 중심에서 얼마나 벌어지나(라디안)
  //   inset  : 무대 안쪽으로 얼마나 들어오나
  const LAYERS = [
    { seg: 5, n: 2, h: [0.55, 1.15], w: [0.26, 0.44], spread: 0.055, inset: 0.10, rough: 0.24 },
    { seg: 6, n: 2, h: [0.30, 0.62], w: [0.20, 0.34], spread: 0.100, inset: 0.22, rough: 0.30 },
    { seg: 5, n: 3, h: [0.14, 0.34], w: [0.16, 0.30], spread: 0.150, inset: 0.34, rough: 0.36 }
  ];

  LAYERS.forEach((L, li) => {
    const geo = new THREE.ConeGeometry(0.5, 1.6, L.seg);
    rockify(geo, L.rough * 0.6, 7 + li);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xdcefff, roughness: 0.26, metalness: 0.06,
      flatShading: true,
      // 밤이라 그냥 두면 시커멓게 죽는다. 얼음이 스스로 은은히 빛나게 한다.
      emissive: 0x2f5075, emissiveIntensity: 0.6
    });

    const count = CLUSTERS * L.n;
    group.add(scatter(geo, mat, count,
      (i, pos, rot, scl) => {
        const a = centers[i % CLUSTERS] + (Math.random() - 0.5) * L.spread * 2;
        const h = rnd(L.h[0], L.h[1]);
        const w = rnd(L.w[0], L.w[1]);
        const rr = ARENA_RADIUS - L.inset - Math.random() * 0.1;
        pos.set(Math.cos(a) * rr, -0.12 + h * 0.5, Math.sin(a) * rr);
        // 안쪽으로 살짝 눕히고 축을 돌려 결이 제각각 보이게
        rot.set((Math.random() - 0.5) * 0.40, Math.random() * 6.3, (Math.random() - 0.5) * 0.40);
        scl.set(w, h * 1.5, w);
      },
      // 조각마다 푸른 기를 조금씩 — 맑은 얼음과 흐린 얼음이 섞이게
      () => {
        const v = 0.80 + Math.random() * 0.28;
        return new THREE.Color(v * (0.88 + Math.random() * 0.10), v * (0.94 + Math.random() * 0.06), v);
      }
    ));
  });

  return group;
}

// 설원 바닥 장식 — 눈더미 · 작은 얼음조각 · 눈 쓴 전나무.
//
// 잔디에는 풀포기가 깔려 있어 바닥이 살아 보인다. 눈밭은 그 풀포기를 감추니
// 매끈한 흰 접시가 됐다. 그림자를 드리우는 '무언가' 가 바닥에 있어야
// 평평해 보이지 않는다.
//
// 판정에는 전혀 영향이 없다. 전기선은 y 0.38~0.82 에만 있고 이것들은
// 그보다 낮게 깔린다. 가운데(반지름 40% 안쪽)는 비워 둬야 캐릭터와
// 전기선을 가리지 않는다.
function buildSnowDetail() {
  const group = new THREE.Group();

  // ── 눈더미. 납작한 반구를 흩뿌린다.
  const moundGeo = new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  rockify(moundGeo, 0.22, 3);
  group.add(scatter(moundGeo,
    new THREE.MeshStandardMaterial({
      color: 0xf4faff, roughness: 0.6, metalness: 0.02, flatShading: true,
      emissive: 0x2a4763, emissiveIntensity: 0.35
    }), 54,
    (i, pos, rot, scl) => {
      const a = Math.random() * Math.PI * 2;
      // 가운데는 비운다 — 캐릭터·전기선이 가려지면 안 된다
      const r = ARENA_RADIUS * rnd(0.42, 0.95);
      const w = rnd(0.22, 0.62);
      pos.set(Math.cos(a) * r, -0.02, Math.sin(a) * r);
      rot.set(0, Math.random() * 6.3, 0);
      scl.set(w, w * rnd(0.22, 0.42), w * rnd(0.8, 1.3));
    },
    () => { const v = 0.9 + Math.random() * 0.14; return new THREE.Color(v * 0.97, v * 0.99, v); }
  ));

  // ── 바닥에 박힌 작은 얼음조각. 눈더미만 있으면 죄다 둥글어 심심하다.
  const chipGeo = new THREE.ConeGeometry(0.5, 1.4, 4);
  rockify(chipGeo, 0.2, 5);
  group.add(scatter(chipGeo,
    new THREE.MeshStandardMaterial({
      color: 0xd5ecff, roughness: 0.24, metalness: 0.05, flatShading: true,
      emissive: 0x2f5075, emissiveIntensity: 0.5
    }), 40,
    (i, pos, rot, scl) => {
      const a = Math.random() * Math.PI * 2;
      const r = ARENA_RADIUS * rnd(0.45, 0.96);
      const h = rnd(0.10, 0.26);
      const w = rnd(0.07, 0.15);
      pos.set(Math.cos(a) * r, -0.05 + h * 0.5, Math.sin(a) * r);
      rot.set(rnd(-0.5, 0.5), Math.random() * 6.3, rnd(-0.5, 0.5));
      scl.set(w, h * 1.5, w);
    },
    () => { const v = 0.85 + Math.random() * 0.2; return new THREE.Color(v * 0.92, v * 0.97, v); }
  ));

  // ── 눈 쓴 전나무. 가장자리 안쪽에 몇 그루만 — 많으면 시야를 가린다.
  //    잎(짙은 초록)과 그 위에 얹힌 눈을 따로 심어 두 층으로 보이게 한다.
  const TREES = 13;
  const angles = [];
  for (let i = 0; i < TREES; i++) angles.push((i / TREES) * Math.PI * 2 + rnd(-0.16, 0.16));
  const rr = [];
  for (let i = 0; i < TREES; i++) rr.push(ARENA_RADIUS * rnd(0.82, 0.94));
  const hh = [];
  for (let i = 0; i < TREES; i++) hh.push(rnd(0.5, 0.95));

  group.add(scatter(new THREE.ConeGeometry(0.5, 1.5, 7),
    new THREE.MeshStandardMaterial({
      color: 0x2f5f46, roughness: 0.85, flatShading: true,
      emissive: 0x0f2a20, emissiveIntensity: 0.5
    }), TREES,
    (i, pos, rot, scl) => {
      pos.set(Math.cos(angles[i]) * rr[i], -0.05 + hh[i] * 0.55, Math.sin(angles[i]) * rr[i]);
      rot.set(0, Math.random() * 6.3, 0);
      scl.set(hh[i] * 0.62, hh[i] * 1.25, hh[i] * 0.62);
    }
  ));
  // 나무 위에 얹힌 눈
  group.add(scatter(new THREE.ConeGeometry(0.5, 1.5, 7),
    new THREE.MeshStandardMaterial({
      color: 0xf6fbff, roughness: 0.55, flatShading: true,
      emissive: 0x2a4763, emissiveIntensity: 0.35
    }), TREES,
    (i, pos, rot, scl) => {
      pos.set(Math.cos(angles[i]) * rr[i], -0.05 + hh[i] * 0.92, Math.sin(angles[i]) * rr[i]);
      rot.set(0, Math.random() * 6.3, 0);
      scl.set(hh[i] * 0.44, hh[i] * 0.62, hh[i] * 0.44);
    }
  ));

  return group;
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

  // 예전엔 떨어져 나온 흙덩이 9개와 늘어진 뿌리 26개를 매달아 뒀는데,
  // 무대 아래에 검은 막대기와 돌덩이가 흩어져 보여 지저분했다. 섬이 떠 있는
  // 느낌은 아래로 좁아지는 흙덩어리만으로 충분해서 둘 다 걷어냈다.

  return under;
}

// 바위처럼 울퉁불퉁하게. jitter 와 달리 면이 찢어지지 않는다.
//
// 다면체 지오메트리는 인덱스가 없어서 삼각형마다 정점을 따로 갖는다
// (정십이면체 1단계 쪼갬 = 정점 432개인데 실제 자리는 74곳, 한 자리에
// 최대 7개가 겹친다). 그 겹친 정점들을 제각각 밀면 서로 다른 방향으로
// 흩어져 면이 갈라진다 — 돌이 아니라 잎사귀 뭉치처럼 보였다.
//
// 그래서 '자리'로 값을 뽑는다. 같은 자리의 정점은 같은 값을 얻어 함께
// 움직이므로 표면이 붙어 있는 채로 울퉁불퉁해진다.
// 미는 방향도 중심에서 바깥(반지름 방향)이라 바위 덩어리 느낌이 산다.
function rockify(geometry, amount, seed = 1) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  // 자리 → 0~1. 소수점을 잘라 겹친 정점이 반드시 같은 값을 받게 한다.
  const noise = (x, y, z) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1) * 43758.5453;
    return n - Math.floor(n);
  };
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const qx = Math.round(v.x * 1e4) / 1e4;
    const qy = Math.round(v.y * 1e4) / 1e4;
    const qz = Math.round(v.z * 1e4) / 1e4;
    // 큰 덩어리감 + 잔 요철을 겹친다
    const k = noise(qx, qy, qz) * 0.7 + noise(qz * 2.3, qx * 2.3, qy * 2.3) * 0.3;
    v.multiplyScalar(1 + (k - 0.5) * amount);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
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

// 상판 무늬는 한 번 구워 두고 돌려 쓴다. 1024x1024 를 매번 다시 그리면
// 스킨을 고를 때마다 몇십 ms 씩 멈춘다.
const topTexCache = new Map();
function topTexture(kind) {
  if (!topTexCache.has(kind)) {
    topTexCache.set(kind, kind === 'snow' ? makeSnowTexture() : makeGrassTexture());
  }
  return topTexCache.get(kind);
}

// 경기장 스킨을 입힌다.
//
// 색만 바꾸는 스킨과 무늬까지 바꾸는 스킨이 있다. 재질 색은 무늬에 '곱해'
// 지므로 곱셈으로는 어둡게만 할 수 있다 — 초록 잔디를 흰 눈으로 만들 수는
// 없어서, 그런 스킨은 무늬를 따로 그려 갈아 끼운다(spec.topMap).
//
// spec 이 비었으면(기본 스킨) 원래 잔디로 되돌린다.
//   topMap    : 상판 무늬 종류 ('grass' | 'snow')
//   top/cliff/stone/tuft : 그 부분에 곱할 색 (없으면 원래 색)
//   hideTufts : 풀포기를 감춘다. 눈밭에 초록 풀이 서 있으면 어색하다.
export function paintArena(deck, spec = {}) {
  if (!deck) return;

  const tint = (name, hex) => {
    const o = deck.getObjectByName(name);
    if (!o) return;
    o.traverse?.((m) => { if (m.material?.color) m.material.color.setHex(hex ?? 0xffffff); });
    if (o.material?.color) o.material.color.setHex(hex ?? 0xffffff);
  };

  // 상판은 무늬부터 맞춘 뒤 색을 곱한다
  const top = deck.getObjectByName('deck-top');
  if (top) {
    const want = topTexture(spec.topMap ?? 'grass');
    if (top.material.map !== want) {
      top.material.map = want;
      top.material.needsUpdate = true;
    }
    top.material.color.setHex(spec.top ?? 0xffffff);
  }

  // 밤 무대라 흰 바닥은 그냥 두면 잿빛으로 가라앉는다. 스킨이 재질을
  // 조금 손볼 수 있게 열어 둔다(눈은 스스로 은은히 빛나게).
  if (top) {
    top.material.roughness = spec.topRoughness ?? 0.95;
    top.material.emissive.setHex(spec.topEmissive ?? 0x000000);
    top.material.emissiveIntensity = spec.topEmissiveIntensity ?? 1;
  }

  tint('deck-cliff', spec.cliff);
  tint('deck-stones', spec.stone);
  tint('deck-tufts', spec.tuft);

  const tufts = deck.getObjectByName('deck-tufts');
  if (tufts) tufts.visible = !spec.hideTufts;

  // 가장자리 장식. 설원은 얼음 기둥만 두면 사이가 휑해서, 서리 낀 바위를
  // 함께 세워 빈틈을 메운다(바위는 spec.stone 색으로 이미 하얗게 칠해진다).
  const wantIce = spec.edge === 'ice';
  const ice = deck.getObjectByName('deck-ice');
  const snowy = deck.getObjectByName('deck-snowdeco');
  if (ice) ice.visible = wantIce;
  if (snowy) snowy.visible = wantIce;
  // 바위는 어느 스킨에서도 남는다 — 무대 끝을 알려 주는 표시라 없으면
  // 어디서 떨어지는지 가늠하기 어렵다.
}
