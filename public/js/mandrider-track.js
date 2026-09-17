import * as THREE from 'three';

// 도로 폭이 맵마다 다르므로 갓길·연석·난간·상판은 전부 폭에서 재서 놓는다.
// 숫자를 박아 두면 넓은 맵에서 난간만 제자리에 남아 도로 위로 올라온다.
export const MAPS = {
  circuit: {
    name: '만드라고라 서킷',
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
    ]
  },
  speedway: {
    name: '그랑프리 스피드웨이',
    scale: 4,
    roadHalfWidth: 24,
    // 폭을 넓히면 헤어핀은 제자리에서 도는 구간이 된다 — 도로 반폭보다 곡률 반경이
    // 작아지면 코너 안쪽 가장자리가 스스로를 넘어 접힌다. 그래서 대형 코너 네 개와
    // 시케인 하나로만 짰다. 긴 직선 둘은 부스터를 쓸 자리, 시케인은 그 속도를 끊는 자리다.
    // 시케인은 깊이 10 을 좌우 35 에 걸쳐 편 값이다 — 더 깊거나 짧으면 반경이 반폭 밑으로 떨어진다.
    points: [
      [0, -88], [-35, -88], [-52, -80], [-62, -62],
      [-62, 62], [-52, 80], [-35, 88],
      [-18, 84], [0, 78], [18, 84], [35, 88],
      [52, 80], [62, 62],
      [62, -62], [52, -80], [35, -88], [14, -88]
    ]
  }
};

export function buildTrack(scene, renderer, map, minimap) {
  const halfWidth = map.roadHalfWidth;
  const trackCurve = new THREE.CatmullRomCurve3(
    map.points.map(([x, z]) => new THREE.Vector3(x * map.scale, 0, z * map.scale)), true, 'centripetal'
  );
  const trackSamples = Array.from({ length: 1200 }, (_, i) => trackCurve.getPointAt(i / 1200));
  const trackNormals = trackSamples.map((point, i) => {
    const previous = trackSamples[(i - 1 + trackSamples.length) % trackSamples.length];
    const next = trackSamples[(i + 1) % trackSamples.length];
    return new THREE.Vector2(next.z - previous.z, -(next.x - previous.x)).normalize();
  });

  // yB 를 따로 주면 같은 폭에서 높이만 벌어져 수직면이 된다 — 절벽은 이걸로 세운다.
  function stripGeometry(offsetA, offsetB, yA, yB = yA) {
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
        p.x + pNormal.x * offsetA, yA, p.z + pNormal.y * offsetA,
        p.x + pNormal.x * offsetB, yB, p.z + pNormal.y * offsetB,
        q.x + qNormal.x * offsetA, yA, q.z + qNormal.y * offsetA,
        q.x + qNormal.x * offsetB, yB, q.z + qNormal.y * offsetB
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

  // 트랙은 허공에 떠 있다. 상판만 두면 종잇장처럼 보여서, 아래로 두 단을 세워
  // 낭떠러지를 만든다. 안쪽으로 조금씩 좁혀야 깎인 절벽처럼 보인다.
  // 양면으로 그리는 이유는 좌우 스트립의 감김 방향이 반대라서다.
  const cliffTop = new THREE.MeshStandardMaterial({ color: 0x6b5138, roughness: .95, side: THREE.DoubleSide });
  const cliffDeep = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 1, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    scene.add(new THREE.Mesh(stripGeometry(deckEdge * side, (deckEdge - 2.2) * side, 1.78, -13), cliffTop));
    scene.add(new THREE.Mesh(stripGeometry((deckEdge - 2.2) * side, (deckEdge - 9) * side, -13, -120), cliffDeep));
  }

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
          (p.x + q.x) / 2 + trackNormals[i].x * side * (halfWidth + 1.4),
          2.12,
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
      const x = (p.x + q.x) / 2 + trackNormals[i].x * side * (halfWidth + 3.15);
      const z = (p.z + q.z) / 2 + trackNormals[i].y * side * (halfWidth + 3.15);
      for (const y of [3.05, 3.82]) {
        curbMatrix.compose(new THREE.Vector3(x, y, z), curbQuaternion, new THREE.Vector3(.24, .18, p.distanceTo(q) + .65));
        rails.setMatrixAt(railIndex++, curbMatrix);
      }
      curbMatrix.compose(
        new THREE.Vector3(
          p.x + trackNormals[i].x * side * (halfWidth + 3.15),
          3.15,
          p.z + trackNormals[i].y * side * (halfWidth + 3.15)
        ),
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
  // 4차선 — 가운데 한 줄과 좌우 한 줄씩. 폭에서 재므로 맵이 넓어져도 비율이 같다.
  const LANE_LINES = [-halfWidth * .53, 0, halfWidth * .53];
  const stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, stripePerLine * LANE_LINES.length);
  const stripeMatrix = new THREE.Matrix4();
  let stripeIndex = 0;
  for (const lane of LANE_LINES) {
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
      new THREE.Vector3(start.x + startNormal.x * across, 2.08, start.z + startNormal.y * across),
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
  const minimapBaseContext = minimapBase.getContext('2d');
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
  function strokeMinimap(color, width) {
    minimapBaseContext.beginPath();
    trackSamples.forEach((point, i) => {
      const [x, y] = minimapPoint(point);
      if (i) minimapBaseContext.lineTo(x, y); else minimapBaseContext.moveTo(x, y);
    });
    minimapBaseContext.closePath();
    minimapBaseContext.strokeStyle = color;
    minimapBaseContext.lineWidth = width;
    minimapBaseContext.lineJoin = minimapBaseContext.lineCap = 'round';
    minimapBaseContext.stroke();
  }
  strokeMinimap('rgba(10,18,24,.85)', 9);
  strokeMinimap('#f7fbff', 5);

  return { trackSamples, start, startHeading, halfWidth, minimapBase, minimapPoint };
}
