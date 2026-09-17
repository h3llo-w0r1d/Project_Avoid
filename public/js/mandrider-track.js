import * as THREE from 'three';

// 도로 폭이 맵마다 다르므로 갓길·연석·난간·상판은 전부 폭에서 재서 놓는다.
// 숫자를 박아 두면 넓은 맵에서 난간만 제자리에 남아 도로 위로 올라온다.
export const MAPS = {
  circuit: {
    name: '빌리지 손가락 하나 잘림',
    // 랭킹에 오르는 코스. 계정에 최고 기록이 한 줄뿐이라 여러 코스를 받으면
    // 무엇을 잰 기록인지 알 수 없어진다.
    ranked: true,
    scale: 4,
    // 3차선에서 4차선으로 넓혔다. 차선 폭(9.2)을 유지하려고 반폭도 같이 올렸다.
    // 헤어핀 곡률 반경이 32 라 상판 끝(반폭+4.3=21.6)보다 넉넉히 크고, 이웃한
    // 손가락끼리도 54 떨어져 있어 상판이 서로 겹치지 않는다.
    roadHalfWidth: 17.3,
    // 참고 미니맵의 비율과 일곱 연속 헤어핀 순서를 그대로 따라야 손가락형 실루엣이 유지된다.
    // 직선이 지루해서 가로로 줄였다. 코너는 손대지 않았다 — 헤어핀을 이루는 점들을
    // 통째로 같은 거리만큼 밀어서, 직선 길이만 빠지고 회전 반경은 그대로다.
    points: [
      [0, -50], [-38, -50], [-48, -48], [-54, -44], [-56, -38], [-56, 49],
      [-54, 56], [-48, 62], [-38, 65], [43, 65], [50, 63], [54, 59],
      [54, 55], [50, 51], [43, 49], [10, 49], [4, 47], [0, 43],
      [0, 39], [4, 35], [10, 33], [43, 33], [50, 31], [54, 27],
      [54, 23], [50, 19], [43, 17], [10, 17], [4, 15], [0, 11],
      [0, 7], [4, 3], [10, 1], [43, 1], [50, -1], [54, -5],
      [54, -9], [50, -13], [43, -15], [10, -15], [4, -17], [0, -21],
      [0, -25], [4, -29], [10, -31], [56, -31], [63, -33], [68, -37],
      [68, -42], [65, -46], [60, -49], [53, -50], [44, -50]
    ],
    // 길을 막고 돌아다니는 큰 만드라고라의 수. 코스 전체에 고르게 세운다
    // (자리와 움직임은 mandrider.js 의 buildGiants 가 정한다).
    giants: 15,
    // 그중 붉은 쪽은 따로 세운다. 닿으면 그 자리에서 판이 끝난다.
    killers: 5
  },

  // 탑 꼭대기에서 출발해 열 바퀴를 돌아 내려온 뒤, 마지막에 직선으로 빠져나간다.
  // 서킷과 달리 고리가 아니라 한 줄짜리 길이다(closed: false) — 끝에 닿으면 끝난다.
  //
  // 내려갈수록 반지름이 준다. 같은 반지름으로 쌓으면 위에서 봤을 때 원 하나로
  // 겹쳐 보여, 미니맵에서 어디쯤인지 읽을 수가 없다.
  tower: {
    name: '만드라고라 탑',
    scale: 1,
    // 미니맵은 옆에서 본 모습으로. 위에서 보면 열 바퀴가 원 하나로 겹친다.
    sideView: true,
    roadHalfWidth: 14,
    closed: false,
    giants: 0,
    spiral: {
      turns: 10,
      topRadius: 110,   // 한 바퀴 690 → 아래로 갈수록 짧아진다
      endRadius: 45,    // 서킷 헤어핀(32)보다 넉넉해 마지막 바퀴도 돌 만하다
      drop: 21,         // 한 바퀴에 내려오는 높이. 10바퀴면 210
      exit: 360         // 다 내려온 뒤 곧게 빠지는 길
    }
  }
};

// 나선 한 줄. 위에서 아래로 돌아 내려온 뒤 마지막에 곧게 빠진다.
// 한 바퀴를 16 조각으로 나눈다 — 더 성기면 모서리가 지고, 더 잘게 나눠도
// CatmullRom 이 어차피 부드럽게 이어 준다.
function spiralPoints({ turns, topRadius, endRadius, drop, exit }) {
  const steps = turns * 16;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2;
    const radius = topRadius + (endRadius - topRadius) * t;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, (1 - t) * drop * turns, Math.sin(angle) * radius));
  }
  // 마지막에 가던 방향 그대로 곧게 빠진다. 바닥 높이는 그대로 0.
  const last = points[points.length - 1];
  const before = points[points.length - 2];
  const dir = new THREE.Vector3(last.x - before.x, 0, last.z - before.z).normalize();
  for (const at of [.25, .5, .75, 1]) {
    points.push(new THREE.Vector3(last.x + dir.x * exit * at, 0, last.z + dir.z * exit * at));
  }
  return points;
}

// 코스 곡선. 서킷은 점을 이어 닫힌 고리로, 탑은 나선 한 줄로 만든다.
export const courseCurve = (map) => new THREE.CatmullRomCurve3(
  map.spiral ? spiralPoints(map.spiral)
    : map.points.map(([x, z]) => new THREE.Vector3(x * map.scale, 0, z * map.scale)),
  map.closed !== false, 'centripetal');

export function sampleCourse(map, count) {
  const curve = courseCurve(map);
  return Array.from({ length: count }, (_, i) => curve.getPointAt(i / count));
}

// 코스 윤곽을 캔버스에 그리고, 그린 자리를 되돌려 준다. 달리는 위치 표시도
// 이 함수를 써야 선과 점이 같은 자리에 찍힌다. 주행 중 미니맵과 맵 고르는
// 화면이 같은 그림을 쓰므로, 코스를 고쳐도 한쪽만 옛 모습으로 남지 않는다.
// down 을 켜면 세로축이 Z 가 아니라 높이가 된다 — 탑처럼 위아래로 쌓인 길은
// 위에서 내려다보면 원 하나로 겹쳐 보여, 어디쯤 내려왔는지 읽을 수가 없다.
export function drawCourse(canvas, samples,
    { padding = 16, halo = 9, line = 5, startDot = 0, closed = true, down = false } = {}) {
  const axis = down ? 'y' : 'z';
  const context = canvas.getContext('2d');
  const bounds = samples.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
    minV: Math.min(box.minV, point[axis]), maxV: Math.max(box.maxV, point[axis])
  }), { minX: Infinity, maxX: -Infinity, minV: Infinity, maxV: -Infinity });
  const place = (point) => [
    padding + (point.x - bounds.minX) / (bounds.maxX - bounds.minX) * (canvas.width - padding * 2),
    padding + (bounds.maxV - (point[axis] ?? 0)) / (bounds.maxV - bounds.minV) * (canvas.height - padding * 2)
  ];
  for (const [color, width] of [['rgba(10,18,24,.85)', halo], ['#f7fbff', line]]) {
    context.beginPath();
    samples.forEach((point, i) => {
      const [x, y] = place(point);
      if (i) context.lineTo(x, y); else context.moveTo(x, y);
    });
    if (closed) context.closePath();   // 한 줄짜리 길은 끝과 시작을 잇지 않는다
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineJoin = context.lineCap = 'round';
    context.stroke();
  }
  // 출발선 표시. 주행 중에는 카트가 그 자리를 대신 그리므로 미니맵에서는 끈다.
  if (startDot) {
    const [x, y] = place(samples[0]);
    context.beginPath();
    context.arc(x, y, startDot, 0, Math.PI * 2);
    context.fillStyle = '#ff4d2e';
    context.fill();
    context.lineWidth = Math.max(1, startDot / 2.5);
    context.strokeStyle = '#fff';
    context.stroke();
  }
  return place;
}

export function buildTrack(scene, renderer, map, minimap) {
  const halfWidth = map.roadHalfWidth;
  const trackCurve = courseCurve(map);
  const trackSamples = sampleCourse(map, 1200);
  // 고리(서킷)와 한 줄짜리 길(탑)을 같이 다룬다. 한 줄짜리는 마지막 지점에서
  // 처음으로 돌아가면 안 된다 — 탑 꼭대기와 바닥을 잇는 거대한 조각이 생긴다.
  const closed = map.closed !== false;
  const count = trackSamples.length;
  const next = (i) => (closed ? (i + 1) % count : Math.min(i + 1, count - 1));
  const spans = closed ? count : count - 1;
  const trackNormals = trackSamples.map((point, i) => {
    const previous = trackSamples[closed ? (i - 1 + count) % count : Math.max(i - 1, 0)];
    const after = trackSamples[next(i)];
    return new THREE.Vector2(after.z - previous.z, -(after.x - previous.x)).normalize();
  });

  // y 는 코스 높이 위로 얼마나 띄울지다. 탑처럼 내려가는 길에서는 지점마다
  // 바닥 높이가 달라, 숫자를 그대로 쓰면 길이 공중에 남는다.
  function stripGeometry(offsetA, offsetB, y) {
    const positions = [];
    const indices = [];
    const uvs = [];
    let distance = 0;
    for (let i = 0; i < spans; i++) {
      const p = trackSamples[i];
      const q = trackSamples[next(i)];
      const pNormal = trackNormals[i];
      const qNormal = trackNormals[next(i)];
      const base = positions.length / 3;
      positions.push(
        p.x + pNormal.x * offsetA, p.y + y, p.z + pNormal.y * offsetA,
        p.x + pNormal.x * offsetB, p.y + y, p.z + pNormal.y * offsetB,
        q.x + qNormal.x * offsetA, q.y + y, q.z + qNormal.y * offsetA,
        q.x + qNormal.x * offsetB, q.y + y, q.z + qNormal.y * offsetB
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
    // 길이 어느 쪽으로 감기느냐에 따라 삼각형 앞뒤가 뒤집힌다(나선은 서킷과
    // 반대로 감긴다). 뒤집힌 채로 두면 위에서 오는 빛을 못 받아 노면이
    // 새까맣게 보인다. 법선이 아래를 보면 감는 순서를 되돌린다.
    if (geometry.attributes.normal.getY(0) < 0) {
      for (let i = 0; i < indices.length; i += 3) {
        const keep = indices[i];
        indices[i] = indices[i + 2];
        indices[i + 2] = keep;
      }
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
    }
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

  const deckEdge = halfWidth + 4.3;
  const trackDeck = new THREE.Mesh(
    stripGeometry(-deckEdge, deckEdge, 1.78),
    new THREE.MeshStandardMaterial({ color: 0xb9c1bd, metalness: .08, roughness: .82 })
  );
  // 그림자를 받지 않게 한다. 도로(y=2.0)와 0.22 밖에 차이가 안 나서 그림자 깊이
  // 비교가 뭉개지고, 도로 밖으로 나온 부분이 통째로 그늘 처리돼 긴 직선에서
  // 커다란 검은 쐐기로 보였다. 도로 밑에 깔린 구조물이라 그림자가 필요 없다.
  trackDeck.receiveShadow = false;
  scene.add(trackDeck);

  const asphaltTexture = loadTiledTexture('./img/mandrider-asphalt-v1.webp', 3, 1);
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTexture, bumpMap: asphaltTexture, bumpScale: .09, color: 0xd7d8d5, roughness: .88
  });
  const road = new THREE.Mesh(stripGeometry(-(halfWidth + 1.1), halfWidth + 1.1, 2), roadMat);
  road.receiveShadow = true;
  scene.add(road);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xfff8de, roughness: .72 });
  scene.add(new THREE.Mesh(stripGeometry(-(halfWidth + .9), -(halfWidth + .55), 2.055), edgeMat));
  scene.add(new THREE.Mesh(stripGeometry(halfWidth + .55, halfWidth + .9, 2.055), edgeMat));
  const curbGeo = new THREE.BoxGeometry(1, 1, 1);
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6 });
  const curbs = new THREE.InstancedMesh(curbGeo, curbMat, spans * 2);
  const curbMatrix = new THREE.Matrix4();
  const curbQuaternion = new THREE.Quaternion();
  const curbGreen = new THREE.Color(0x327a4b);
  const curbIvory = new THREE.Color(0xfff4cf);
  let curbIndex = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < spans; i++) {
      const p = trackSamples[i];
      const q = trackSamples[next(i)];
      const angle = Math.atan2(q.x - p.x, q.z - p.z);
      curbQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      curbMatrix.compose(
        new THREE.Vector3(
          (p.x + q.x) / 2 + trackNormals[i].x * side * (halfWidth + 1.4),
          (p.y + q.y) / 2 + 2.12,
          (p.z + q.z) / 2 + trackNormals[i].y * side * (halfWidth + 1.4)
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

  // 방벽. 중심선이 아니라 '방벽이 실제로 놓이는 자리' 에서 방향과 길이를 잰다.
  // 중심선 길이로 만들면 코너 안쪽에서 호가 더 짧은데도 같은 길이를 쓰게 돼
  // 막대가 넘쳐 부챗살처럼 삐져나온다.
  const barrierStep = 5;
  const barrierCount = Math.ceil(spans / barrierStep) * 2;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .55, metalness: .06 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xdfe7dc, metalness: .45, roughness: .3 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2c5240, metalness: .2, roughness: .5 });
  // 축을 Z 로 눕혀 둔다. 그래야 scale.z 가 곧 길이가 된다.
  const capGeo = new THREE.CylinderGeometry(.13, .13, 1, 10);
  capGeo.rotateX(Math.PI / 2);
  const walls = new THREE.InstancedMesh(curbGeo, wallMat, barrierCount);
  const caps = new THREE.InstancedMesh(capGeo, capMat, barrierCount);
  const posts = new THREE.InstancedMesh(curbGeo, postMat, barrierCount);
  const up = new THREE.Vector3(0, 1, 0);
  let wallIndex = 0;
  let capIndex = 0;
  let postIndex = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < spans; i += barrierStep) {
      const j = closed ? (i + barrierStep) % count : Math.min(i + barrierStep, count - 1);
      const offset = halfWidth + 3.15;
      const ax = trackSamples[i].x + trackNormals[i].x * side * offset;
      const az = trackSamples[i].z + trackNormals[i].y * side * offset;
      const bx = trackSamples[j].x + trackNormals[j].x * side * offset;
      const bz = trackSamples[j].z + trackNormals[j].y * side * offset;
      const length = Math.hypot(bx - ax, bz - az);
      curbQuaternion.setFromAxisAngle(up, Math.atan2(bx - ax, bz - az));
      const mid = new THREE.Vector3((ax + bx) / 2, 0, (az + bz) / 2);
      const floor = (trackSamples[i].y + trackSamples[j].y) / 2;

      // 벽면 — 흰 패널에 초록을 섞어 서킷 방벽처럼 보이게 한다.
      mid.y = floor + 2.72;
      curbMatrix.compose(mid, curbQuaternion, new THREE.Vector3(.3, 1.24, length + .04));
      walls.setMatrixAt(wallIndex, curbMatrix);
      walls.setColorAt(wallIndex++, Math.floor(i / barrierStep) % 4 === 0 ? curbGreen : curbIvory);

      // 위에 얹는 둥근 손잡이 — 각진 상자만 있으면 값싸 보인다.
      mid.y = floor + 3.42;
      curbMatrix.compose(mid, curbQuaternion, new THREE.Vector3(1, 1, length + .04));
      caps.setMatrixAt(capIndex++, curbMatrix);

      // 기둥은 이음매마다 하나. 벽보다 조금 밖으로 물려 세운다.
      curbMatrix.compose(
        new THREE.Vector3(ax + trackNormals[i].x * side * .18, trackSamples[i].y + 2.6, az + trackNormals[i].y * side * .18),
        curbQuaternion,
        new THREE.Vector3(.34, 1.36, .34)
      );
      posts.setMatrixAt(postIndex++, curbMatrix);
    }
  }
  walls.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  posts.instanceMatrix.needsUpdate = true;
  if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
  walls.castShadow = caps.castShadow = posts.castShadow = true;
  scene.add(walls, caps, posts);

  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf7f5e9, roughness: .75 });
  const stripeGeo = new THREE.BoxGeometry(.18, .05, 5.5);
  const stripePerLine = Math.floor(spans / 3);
  // 4차선 — 가운데 한 줄과 좌우 한 줄씩. 폭에서 재므로 맵이 넓어져도 비율이 같다.
  const LANE_LINES = [-halfWidth * .53, 0, halfWidth * .53];
  const stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, stripePerLine * LANE_LINES.length);
  const stripeMatrix = new THREE.Matrix4();
  let stripeIndex = 0;
  for (const lane of LANE_LINES) {
    for (let i = 0; i < stripePerLine; i++) {
      const sample = i * 3;
      const p = trackSamples[sample];
      const q = trackSamples[next(sample)];
      stripeMatrix.makeRotationY(Math.atan2(q.x - p.x, q.z - p.z));
      stripeMatrix.setPosition(
        p.x + trackNormals[sample].x * lane,
        p.y + 2.06,
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
  const startHeading = Math.atan2(startNext.x - start.x, -(startNext.z - start.z));
  const startNormal = new THREE.Vector2(startNext.z - start.z, -(startNext.x - start.x)).normalize();
  // 출발선 타일 수는 도로 폭을 따라간다. 하나씩 놓으면 넓은 맵에서만 드로우콜이 는다.
  const tileCount = Math.round(halfWidth * 2 / 1.36);
  const tiles = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.36, .07, 1.35),
    new THREE.MeshStandardMaterial({ roughness: .75 }),
    tileCount
  );
  const tileDark = new THREE.Color(0x202522);
  const tileLight = new THREE.Color(0xffffff);
  const tileScale = new THREE.Vector3(1, 1, 1);
  curbQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), startAngle);
  for (let i = 0; i < tileCount; i++) {
    const across = (i - (tileCount - 1) / 2) * 1.36;
    curbMatrix.compose(
      new THREE.Vector3(start.x + startNormal.x * across, start.y + 2.08, start.z + startNormal.y * across),
      curbQuaternion,
      tileScale
    );
    tiles.setMatrixAt(i, curbMatrix);
    tiles.setColorAt(i, i % 2 ? tileDark : tileLight);
  }
  tiles.instanceMatrix.needsUpdate = true;
  tiles.instanceColor.needsUpdate = true;
  scene.add(tiles);

  const gate = new THREE.Group();
  const gateStoneMat = new THREE.MeshStandardMaterial({ color: 0xe8d9b7, roughness: .68 });
  const gateGreenMat = new THREE.MeshStandardMaterial({ color: 0x285c43, metalness: .15, roughness: .42 });
  const gateGoldMat = new THREE.MeshStandardMaterial({ color: 0xe2bd5c, metalness: .48, roughness: .32 });
  const gatePostX = halfWidth + 3.5;
  for (const x of [-gatePostX, gatePostX]) {
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
  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(gatePostX * 2 + 2, 1.3, 1.4), gateGreenMat);
  crossbar.position.y = 13.45;
  gate.add(crossbar);
  const leafEdge = halfWidth + .5;
  for (let x = -leafEdge, i = 0; x <= leafEdge; x += 3, i++) {
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
  const signWidth = halfWidth * 1.6;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(signWidth, signWidth / 5.12),
    new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.DoubleSide })
  );
  sign.position.set(0, 16.35, -.65);
  sign.rotation.y = Math.PI;
  gate.add(sign);
  gate.position.copy(trackCurve.getPointAt(.0015));
  gate.rotation.y = startAngle;
  gate.traverse((part) => { if (part.isMesh) part.castShadow = part.receiveShadow = true; });
  scene.add(gate);

  const minimapBase = document.createElement('canvas');
  minimapBase.width = minimap.width;
  minimapBase.height = minimap.height;
  const minimapPoint = drawCourse(minimapBase, trackSamples, { closed, down: !!map.sideView });

  return { trackSamples, trackNormals, start, startHeading, halfWidth, closed, minimapBase, minimapPoint };
}
