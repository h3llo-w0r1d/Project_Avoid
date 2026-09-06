// 도전모드 전용 장치 두 가지 — 좁아지는 안전지대와 밟고 다니는 발판.
//
// 둘 다 판정은 '플레이어 좌표 하나'만 본다. 전기선 시뮬(shared/beams)이나
// 물리(shared/player-physics)는 전혀 건드리지 않는다. 그래서 일반 판·1v1·
// 다시보기에 영향이 없다 — 도전모드에서만 켜고 끝나면 끈다.

import * as THREE from 'three';
import { ARENA_RADIUS } from './config.js';

// ── 좁아지는 안전지대 ──────────────────────────────────────
// 바깥부터 서서히 붉게 잠긴다. 붉은 쪽에 서 있으면 죽는다.
// 무대 밖으로 떨어지는 것과 달리 '밟고 있어도' 죽으므로 계속 안으로 밀린다.

const ZONE_MIN = 3.2;        // 이보다 더는 안 좁아진다(설 자리는 남긴다)
const ZONE_GRACE = 3.0;      // 시작하고 이 초까지는 안 줄어든다(자리 잡을 틈)

export class SafeZone {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'safe-zone';
    this.group.visible = false;
    scene.add(this.group);

    // 위험 구역(안전 반지름 ~ 무대 끝)을 덮는 납작한 고리.
    // 안쪽 반지름을 매 프레임 다시 만들지 않으려고, 고리는 무대 전체 크기로
    // 한 번만 만들고 scale 로 늘렸다 줄인다 — 대신 안쪽 구멍을 가리는
    // '안전 원판'을 따로 얹어 그 안쪽을 도로 덮는다.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.999, 1, 96),
      new THREE.MeshBasicMaterial({
        color: 0xff3a4e, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.renderOrder = 4;
    this.ring = ring;
    this.group.add(ring);

    // 경계 안쪽으로 옅게 번지는 띠. 선만 있으면 어디가 밖인지 헷갈린다.
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.93, 1, 96),
      new THREE.MeshBasicMaterial({
        color: 0xff5566, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.05;
    glow.renderOrder = 3;
    this.glow = glow;
    this.group.add(glow);

    this.radius = ARENA_RADIUS;
    this.active = false;
  }

  // total = 이 판이 목표로 하는 길이(초). 그 시간에 걸쳐 ZONE_MIN 까지 좁힌다.
  start(total) {
    this.active = true;
    this.total = Math.max(1, total);
    this.radius = ARENA_RADIUS;
    this.group.visible = true;
    this.#draw();
  }

  stop() {
    this.active = false;
    this.group.visible = false;
  }

  update(elapsed) {
    if (!this.active) return;
    // 처음 ZONE_GRACE 초는 그대로 두고, 남은 시간에 걸쳐 선형으로 줄인다.
    const t = Math.max(0, elapsed - ZONE_GRACE);
    const span = Math.max(1, this.total - ZONE_GRACE);
    const k = Math.min(1, t / span);
    this.radius = ARENA_RADIUS + (ZONE_MIN - ARENA_RADIUS) * k;
    this.#draw();
  }

  #draw() {
    this.ring.scale.set(this.radius, this.radius, 1);
    this.glow.scale.set(this.radius, this.radius, 1);
  }

  // 이 자리가 위험한가(붉은 쪽인가).
  isOutside(x, z) {
    return this.active && Math.hypot(x, z) > this.radius;
  }
}

// ── 발판 순회 ──────────────────────────────────────────────
// 빛나는 자리가 한 곳 뜬다. 밟으면 다음 자리가 다른 곳에 뜬다.
// 코인과 달리 '가야 할 곳이 정해져 있어서' 빔이 있어도 그리로 가야 한다.

const PAD_R = 1.35;              // 밟았다고 치는 반경
const PAD_SPAWN_MIN = 3.0;       // 무대 중심에서 이만큼은 떨어뜨린다
const PAD_SPAWN_MAX = ARENA_RADIUS - 1.8;
const PAD_AWAY = 5.0;            // 직전 자리에서 이만큼은 떨어진 곳으로

export class Pads {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'circuit-pads';
    this.group.visible = false;
    scene.add(this.group);

    // 바닥에 깔리는 원판 + 위로 솟는 옅은 기둥(멀리서도 보이게).
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(PAD_R, 40),
      new THREE.MeshBasicMaterial({
        color: 0x53f2c4, transparent: true, opacity: 0.35, depthWrite: false
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.05;
    disc.renderOrder = 3;
    this.disc = disc;
    this.group.add(disc);

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(PAD_R * 0.72, PAD_R * 0.72, 2.6, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x53f2c4, transparent: true, opacity: 0.14,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    pillar.position.y = 1.3;
    pillar.renderOrder = 3;
    this.pillar = pillar;
    this.group.add(pillar);

    this.x = 0; this.z = 0;
    this.done = 0;
    this.active = false;
    this.t = 0;
  }

  start() {
    this.active = true;
    this.done = 0;
    this.t = 0;
    this.group.visible = true;
    this.#place(0, 0);
  }

  stop() {
    this.active = false;
    this.group.visible = false;
  }

  #place(px, pz) {
    // 직전 자리(그리고 플레이어)에서 충분히 떨어진 곳을 몇 번 시도해 고른다.
    let x = 0, z = 0;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = PAD_SPAWN_MIN + Math.random() * (PAD_SPAWN_MAX - PAD_SPAWN_MIN);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
      if (Math.hypot(x - px, z - pz) >= PAD_AWAY) break;
    }
    this.x = x; this.z = z;
    this.group.position.set(x, 0, z);
  }

  // 밟았으면 true. 밟은 개수는 done 에 쌓인다.
  update(dt, px, pz) {
    if (!this.active) return false;
    this.t += dt;
    // 숨쉬듯 크기가 오르내려 눈에 띈다.
    const s = 1 + Math.sin(this.t * 3.4) * 0.08;
    this.disc.scale.set(s, s, 1);
    this.pillar.scale.set(s, 1, s);

    if (Math.hypot(this.x - px, this.z - pz) <= PAD_R) {
      this.done++;
      this.#place(px, pz);
      return true;
    }
    return false;
  }
}
