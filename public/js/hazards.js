import * as THREE from 'three';
import { BEAM, COLORS, PLAYER } from './config.js';
import { Hazards as HazardRules } from './shared/beams.js';

// 전기선을 화면에 그린다.
// 어디에 생기고 언제 위험해지는지는 shared/beams.js 가 정한다.
// 1v1 때 서버도 같은 규칙을 돌려야 해서 규칙과 그림을 갈라 놓았다.

// ---------------------------------------------------------------- 렌더링

// 모든 전기선이 공유하는 지오메트리. 실린더의 축은 회전으로 X축에 맞춘다.
const GEO = {
  rod: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
  strip: new THREE.PlaneGeometry(1, 1),
  node: new THREE.SphereGeometry(0.3, 14, 10)
};

// 번개 코어 — 길이 방향 SEG 마디, 각 마디마다 네 점짜리 마름모 단면.
// 매 프레임 마디를 흔들어서 지그재그를 만든다.
const SEG = 26;
const RING = 4;
const SPARKS = 18;

function makeBoltGeometry() {
  const pos = new Float32Array((SEG + 1) * RING * 3);
  const idx = [];
  for (let s = 0; s < SEG; s++) {
    for (let r = 0; r < RING; r++) {
      const a = s * RING + r;
      const b = s * RING + ((r + 1) % RING);
      const c = (s + 1) * RING + r;
      const d = (s + 1) * RING + ((r + 1) % RING);
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

class BeamVisual {
  constructor(scene) {
    const g = new THREE.Group();

    // 지그재그 코어 — 전기선마다 정점이 다르므로 지오메트리도 각자 가진다
    this.bolt = new THREE.Mesh(
      makeBoltGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    this.bolt.position.y = BEAM.y;
    this.bolt.frustumCulled = false;   // 정점을 직접 갱신하므로 경계구를 안 쓴다
    g.add(this.bolt);

    // 코어를 감싸는 부드러운 후광
    this.glow = new THREE.Mesh(
      GEO.rod,
      new THREE.MeshBasicMaterial({
        color: COLORS.volt, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    this.glow.rotation.z = -Math.PI / 2;
    this.glow.position.y = BEAM.y;
    g.add(this.glow);

    // 튀는 불똥
    const sparkPos = new Float32Array(SPARKS * 3);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    this.sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
      color: COLORS.voltGlow, size: 0.28, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.sparks.position.y = BEAM.y;
    this.sparks.frustumCulled = false;
    this.sparkSeed = Array.from({ length: SPARKS }, () => Math.random());
    g.add(this.sparks);

    // 바닥 투영 — 카메라가 비스듬해서 전기선 위치를 바닥에서도 읽을 수 있게 한다
    this.strip = new THREE.Mesh(
      GEO.strip,
      new THREE.MeshBasicMaterial({
        color: COLORS.volt, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    this.strip.rotation.x = -Math.PI / 2;
    this.strip.position.y = 0.04;
    g.add(this.strip);

    // 양 끝 — 드론에 걸린 접점
    const nodeMat = () => new THREE.MeshBasicMaterial({
      color: COLORS.voltGlow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.nodeA = new THREE.Mesh(GEO.node, nodeMat());
    this.nodeB = new THREE.Mesh(GEO.node, nodeMat());
    this.nodeA.position.y = BEAM.y;
    this.nodeB.position.y = BEAM.y;
    g.add(this.nodeA, this.nodeB);

    this.light = new THREE.PointLight(COLORS.volt, 0, 18, 2);
    this.light.position.y = BEAM.y + 0.6;
    g.add(this.light);

    g.visible = false;
    scene.add(g);
    this.group = g;
  }

  place(seg) {
    const mx = (seg.ax + seg.bx) / 2;
    const mz = (seg.az + seg.bz) / 2;
    const len = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az);
    this.group.position.set(mx, 0, mz);
    this.group.rotation.y = -Math.atan2(seg.bz - seg.az, seg.bx - seg.ax);
    this.nodeA.position.x = -len / 2;
    this.nodeB.position.x = len / 2;
    return len;
  }

  // 지그재그 정점을 다시 계산한다. amp 가 흔들리는 폭, radius 가 굵기.
  shapeBolt(len, radius, amp, time) {
    const arr = this.bolt.geometry.attributes.position.array;
    let p = 0;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const x = (t - 0.5) * len;
      // 양 끝은 드론에 고정돼 있으므로 흔들림을 0으로 수렴시킨다
      const taper = Math.sin(Math.PI * t);
      // 길이에 비례한 위상 — 길수록 꺾이는 횟수가 늘어난다
      const k = t * len;
      const oy = (Math.sin(k * 1.7 + time * 21) * 0.62 + Math.sin(k * 4.1 - time * 29) * 0.28) * amp * taper;
      const oz = (Math.cos(k * 2.3 - time * 25) * 0.62 + Math.cos(k * 5.3 + time * 34) * 0.28) * amp * taper;

      arr[p++] = x; arr[p++] = oy + radius; arr[p++] = oz;
      arr[p++] = x; arr[p++] = oy; arr[p++] = oz + radius;
      arr[p++] = x; arr[p++] = oy - radius; arr[p++] = oz;
      arr[p++] = x; arr[p++] = oy; arr[p++] = oz - radius;
    }
    this.bolt.geometry.attributes.position.needsUpdate = true;
  }

  shapeSparks(len, time, spread) {
    const arr = this.sparks.geometry.attributes.position.array;
    for (let i = 0; i < SPARKS; i++) {
      const seed = this.sparkSeed[i];
      // 불똥이 전기선을 따라 흘러가게 한다
      const t = (seed + time * 0.35) % 1;
      arr[i * 3] = (t - 0.5) * len;
      arr[i * 3 + 1] = Math.sin(time * (17 + seed * 23) + seed * 40) * spread;
      arr[i * 3 + 2] = Math.cos(time * (13 + seed * 19) + seed * 25) * spread;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
  }

  applyWarn(seg, k) {
    const len = this.place(seg);
    const pulse = 0.3 + 0.5 * Math.abs(Math.sin(k * Math.PI * 4));
    const time = performance.now() / 1000;

    // 아직 위험하지 않다는 뜻으로 가늘고 노랗게, 흔들림도 작게
    this.shapeBolt(len, 0.045, 0.1, time);
    this.bolt.material.color.setHex(COLORS.warn);
    this.bolt.material.opacity = pulse;

    this.glow.scale.set(0.26, len, 0.26);
    this.glow.material.color.setHex(COLORS.warn);
    this.glow.material.opacity = pulse * 0.28;

    this.sparks.visible = false;

    this.strip.scale.set(len, 0.4 + k * 0.35, 1);
    this.strip.material.color.setHex(COLORS.warn);
    this.strip.material.opacity = pulse * 0.4;

    const nodeScale = 0.5 + k * 0.7;
    this.nodeA.scale.setScalar(nodeScale);
    this.nodeB.scale.setScalar(nodeScale);
    this.nodeA.material.color.setHex(COLORS.warn);
    this.nodeB.material.color.setHex(COLORS.warn);
    this.nodeA.material.opacity = pulse;
    this.nodeB.material.opacity = pulse;

    this.light.intensity = 0;
  }

  applyLive(seg, fade, time) {
    const len = this.place(seg);
    // 지지직거리는 느낌 — 굵기와 밝기를 미세하게 떤다
    const flicker = 1 + Math.sin(time * 47) * 0.14 + Math.sin(time * 113) * 0.07;

    this.shapeBolt(len, BEAM.radius * 0.62 * flicker, BEAM.radius * 0.85, time);
    this.bolt.material.color.setHex(0xffffff);
    this.bolt.material.opacity = fade;

    this.glow.scale.set(BEAM.radius * 2.6 * flicker, len, BEAM.radius * 2.6 * flicker);
    this.glow.material.color.setHex(COLORS.volt);
    this.glow.material.opacity = fade * 0.45;

    this.sparks.visible = true;
    this.shapeSparks(len, time, BEAM.radius * 1.5);
    this.sparks.material.opacity = fade * 0.85;

    // 바닥 띠는 히트박스 폭(전기선 굵기 + 플레이어 반지름)에 맞춘다
    this.strip.scale.set(len, (BEAM.radius + PLAYER.radius) * 2, 1);
    this.strip.material.color.setHex(COLORS.volt);
    this.strip.material.opacity = fade * 0.3;

    this.nodeA.scale.setScalar(1.3 * flicker);
    this.nodeB.scale.setScalar(1.3 * flicker);
    this.nodeA.material.color.setHex(COLORS.voltGlow);
    this.nodeB.material.color.setHex(COLORS.voltGlow);
    this.nodeA.material.opacity = fade;
    this.nodeB.material.opacity = fade;

    this.light.intensity = 30 * fade * flicker;
  }
}

// ---------------------------------------------------------------- 화면 연결

// 규칙(shared/beams.js)이 정한 전기선을 화면에 옮긴다.
// 살아 있는 전기선 순서대로 화면 오브젝트를 붙이고, 남는 건 숨긴다.
// 전기선은 매 프레임 모든 값을 새로 받으므로 짝이 바뀌어도 문제없다.
export class Hazards {
  constructor(scene, seed) {
    this.scene = scene;
    this.sim = new HazardRules(seed);
    this.visuals = [];

    // 소리를 붙일 수 있게 사건만 알려 준다.
    this.onWarn = null;   // 경고선이 뜰 때
    this.onFire = null;   // 실제로 발사돼 위험해질 때
    this.sim.onWarn = () => this.onWarn?.();
    this.sim.onFire = () => this.onFire?.();
  }

  get active() { return this.sim.active; }

  reset(seed) {
    if (seed !== undefined) this.sim.seed = seed;
    this.sim.reset();
    this.ticks = 0;
    for (const v of this.visuals) this.park(v);
  }

  park(visual) {
    visual.group.visible = false;
    visual.light.intensity = 0;
  }

  visualAt(i) {
    while (this.visuals.length <= i) this.visuals.push(new BeamVisual(this.scene));
    return this.visuals[i];
  }

  update(dt, elapsed) {
    this.sim.update(dt, elapsed);
    this.draw();
  }

  // 1v1 용. 서버와 똑같은 크기의 스텝을, 똑같은 횟수만큼 밟아야
  // 전기선이 세 곳(서버·나·상대)에서 같은 모양으로 나온다.
  // 그래서 여기서는 프레임 시간이 아니라 목표 틱 수에 맞춰 굴린다.
  runToTick(targetTick) {
    // 탭이 백그라운드에 갔다 오면 수천 틱이 밀린다. 한 프레임에
    // 다 따라잡으려다 멈추는 것보다, 나눠 따라잡는 편이 낫다.
    const limit = Math.min(targetTick, this.ticks + 20);
    while (this.ticks < limit) {
      this.ticks++;
      this.sim.update(1 / 60, this.ticks / 60);
    }
    this.draw();
  }

  draw() {
    const time = performance.now() / 1000;
    const beams = this.sim.active;

    beams.forEach((beam, i) => {
      const v = this.visualAt(i);
      if (!beam.onStage) {
        this.park(v);
        return;
      }
      v.group.visible = true;
      if (beam.phase === 'warn') {
        v.applyWarn(beam.seg, beam.progress);
      } else if (beam.phase === 'live') {
        // 등장/퇴장 때 살짝 페이드해서 갑툭튀 느낌을 줄인다
        const u = beam.progress;
        v.applyLive(beam.seg, Math.min(1, u * 14, (1 - u) * 14), time);
      } else {
        this.park(v);
      }
    });

    for (let i = beams.length; i < this.visuals.length; i++) this.park(this.visuals[i]);
  }

  hitTest(player) {
    return this.sim.hitTest(player.pos.x, player.pos.z, player.feetY, player.headY);
  }
}
