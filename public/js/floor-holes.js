// 하드코어 전용 — 무대의 한 부채꼴 구역이 전기로 뒤덮인다(감전 지대).
//
// 공정하게: 가운데(반경 R0 이내)는 절대 안 깔려 늘 도망갈 곳이 있다.
// 무대를 부채꼴 타일로 나눠, 한두 개씩 "경고(빨갛게 깜빡) → 감전(전기가 쫙 깔림,
// 그 안에 있으면 감전사) → 사라짐" 순서로 돈다. 전기선의 예열처럼, 깔리기 전에
// 경고를 충분히 줘서 피할 수 있게 한다.
//
// 시드 기반이라 같은 씨앗+같은 입력이면 똑같이 재현된다(다시보기 가능).
// 판정은 solo(하드코어)에서만 돌리므로 서버·1v1 규칙과 무관하다.

import * as THREE from 'three';
import { ARENA_RADIUS } from './config.js';
import { makeRandom } from './shared/beams.js';

const SECTORS = 10;               // 바깥 링을 몇 조각으로 나눌지
const R0 = 2.4;                   // 이 반경 안쪽(가운데)만 항상 안전 — 구멍이 중심 근처까지 파고든다
const R1 = ARENA_RADIUS;          // 가장자리까지가 사라질 수 있는 링
const WARN_T = 1.35;              // 경고 시간 — 아직 밟아도 안전(구멍이 커져 도망 시간 넉넉히)
const OPEN_T = 3.6;               // 사라져 있는 시간 — 밟으면 낙사(더 오래 유지)
const SPAWN_MIN = 2.6;            // 다음 구멍까지 최소 간격
const SPAWN_MAX = 4.0;
const MAX_ACTIVE = 2;             // 동시에 진행 중(경고+사라짐)인 타일 수 상한
const Y = 0.05;                   // 잔디 바로 위

// 부채꼴 고리 조각을 XZ 평면에 직접 짠다(월드 atan2(z,x) 와 각이 그대로 맞게).
function wedgeGeometry(a0, a1, r0, r1, segs) {
  const pos = [];
  const P = (r, a) => [Math.cos(a) * r, Y, Math.sin(a) * r];
  for (let i = 0; i < segs; i++) {
    const b0 = a0 + (a1 - a0) * (i / segs);
    const b1 = a0 + (a1 - a0) * ((i + 1) / segs);
    const iA = P(r0, b0), oA = P(r1, b0), iB = P(r0, b1), oB = P(r1, b1);
    pos.push(...iA, ...oA, ...oB, ...iA, ...oB, ...iB);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  return g;
}

export class FloorHoles {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.tiles = [];
    const step = (Math.PI * 2) / SECTORS;
    for (let i = 0; i < SECTORS; i++) {
      const a0 = i * step, a1 = (i + 1) * step;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff5a3a, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(wedgeGeometry(a0, a1, R0, R1, 6), mat);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.tiles.push({ a0, a1, mat, phase: 'idle', t: 0 });
    }
    this.active = false;
    this.spawnTimer = 1.5;
    this.rand = makeRandom(1);   // reset(seed) 에서 판마다 다시 씨앗을 심는다
  }

  // 하드코어일 때만 켠다. 끄면 전부 원상복구. seed 로 지대 순서를 정한다.
  setActive(on, seed) {
    this.active = on;
    this.group.visible = on;
    this.reset(seed);
  }

  reset(seed) {
    for (const t of this.tiles) { t.phase = 'idle'; t.t = 0; t.mat.opacity = 0; }
    this.spawnTimer = 1.5;   // 시작하고 잠깐 뒤 첫 지대
    // 시드가 있으면 그걸로, 없으면(옛 호출) 랜덤으로. 같은 씨앗이면 똑같이 재현.
    this.rand = makeRandom(seed == null ? (Math.random() * 2 ** 31) | 0 : seed);
  }

  #countActive() {
    let n = 0;
    for (const t of this.tiles) if (t.phase !== 'idle') n++;
    return n;
  }

  #open() {
    const idle = this.tiles.filter((t) => t.phase === 'idle');
    if (!idle.length) return;
    const t = idle[(this.rand() * idle.length) | 0];   // 시드 난수로 지대 선택
    t.phase = 'warn';
    t.t = 0;
  }

  update(dt) {
    if (!this.active) return;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.#countActive() < MAX_ACTIVE) {
      this.#open();
      this.spawnTimer = SPAWN_MIN + this.rand() * (SPAWN_MAX - SPAWN_MIN);
    }

    // 깜빡임은 시뮬 시간(t)으로 낸다 — performance.now 를 쓰면 다시보기에서 어긋난다.
    for (const t of this.tiles) {
      if (t.phase === 'idle') continue;
      t.t += dt;

      if (t.phase === 'warn') {
        // 빨갛게 깜빡 — 전기가 깔리기 전 경고. 아직 서 있어도 안전.
        t.mat.color.setHex(0xff5a3a);
        t.mat.opacity = 0.22 + 0.34 * Math.abs(Math.sin(t.t * 22));
        if (t.t >= WARN_T) { t.phase = 'open'; t.t = 0; }
      } else if (t.phase === 'open') {
        // 전기가 쫙 깔렸다 — 파랗게 지직거린다. 그 안에 있으면 감전사(isOpenAt).
        t.mat.color.setHex(0x8fe6ff);
        const u = t.t / OPEN_T;
        const flicker = 0.68 + 0.30 * Math.abs(Math.sin(t.t * 40));
        t.mat.opacity = Math.min(flicker, u * 8, (1 - u) * 8 + 0.05);
        if (t.t >= OPEN_T) { t.phase = 'idle'; t.t = 0; t.mat.opacity = 0; }
      }
    }
  }

  // 지금 이 지점이 전기로 깔려 있는가(감전 판정용). 안쪽 안전지대는 늘 false.
  isOpenAt(x, z) {
    const r = Math.hypot(x, z);
    if (r < R0 || r > R1) return false;
    let ang = Math.atan2(z, x);
    if (ang < 0) ang += Math.PI * 2;
    for (const t of this.tiles) {
      if (t.phase === 'open' && ang >= t.a0 && ang < t.a1) return true;
    }
    return false;
  }
}
