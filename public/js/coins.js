// 맵에 뜨는 코인.
//
// 혼자 하기(솔로) 중에만 켠다. 일정 시간마다 무대 위 한 곳에 금화가 떠오르고,
// 가까이 가면 먹는다(수평 거리만 본다 — 점프 높이는 안 따져 너그럽게). 먹으면
// wallet 에 쌓이고, 그 코인으로 캐릭터를 해금한다.
//
// 판정(죽음)과는 무관한 순수 수집 요소다. 서버·1v1 규칙을 건드리지 않는다.

import * as THREE from 'three';
import { ARENA_RADIUS } from './config.js';

const SPAWN_MIN = 3.5;            // 다음 코인까지 최소 간격(초)
const SPAWN_MAX = 6.0;
const MAX_ON_FIELD = 3;          // 동시에 떠 있는 코인 수 상한
const LIFETIME = 11;             // 안 먹으면 사라지는 시간(초)
const COLLECT_R = 0.95;          // 수집 반경(수평 거리)
const Y = 0.7;                   // 떠 있는 높이(플레이어 몸통쯤)
const R_MIN = 1.6;               // 스폰 반경 범위 — 중앙·가장자리 너무 붙지 않게
const R_MAX = ARENA_RADIUS - 1.4;
const CLEAR_OF_PLAYER = 2.2;     // 플레이어 코앞엔 안 띄운다(즉시 먹힘 방지)

export class Coins {
  constructor(scene, onCollect) {
    this.onCollect = onCollect;   // (개수) => void
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    // 금화 한 장: 납작한 원기둥을 세워, Y축으로 돌면 반짝이며 도는 코인처럼 보인다.
    this.geo = new THREE.CylinderGeometry(0.32, 0.32, 0.07, 24);
    this.geo.rotateX(Math.PI / 2);   // 원기둥 축을 Z로 눕혀 동전 면이 옆을 보게
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xffcf3f, metalness: 0.75, roughness: 0.3,
      emissive: 0x6b4a00, emissiveIntensity: 0.5
    });

    this.coins = [];   // { mesh, x, z, t, phase }
    this.active = false;
    this.spawnTimer = 1.5;
  }

  setActive(on) {
    this.active = on;
    this.group.visible = on;
    if (!on) this.reset();
  }

  reset() {
    for (const c of this.coins) this.group.remove(c.mesh);
    this.coins.length = 0;
    this.spawnTimer = 1.5;
  }

  #spawn(px, pz) {
    // 플레이어와 겹치지 않는 지점을 몇 번 시도해 고른다.
    let x = 0, z = 0;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = R_MIN + Math.random() * (R_MAX - R_MIN);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
      if (Math.hypot(x - px, z - pz) >= CLEAR_OF_PLAYER) break;
    }
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.set(x, Y, z);
    mesh.renderOrder = 3;
    this.group.add(mesh);
    this.coins.push({ mesh, x, z, t: 0, phase: 'live' });
  }

  // 매 프레임. 플레이어 위치를 받아 수집을 판정한다.
  update(dt, px, pz) {
    if (!this.active) return;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.coins.length < MAX_ON_FIELD) {
      this.#spawn(px, pz);
      this.spawnTimer = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    }

    const now = performance.now() / 1000;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.t += dt;
      // 빙글 돌며 위아래로 살짝 둥실.
      c.mesh.rotation.y += dt * 3.2;
      c.mesh.position.y = Y + Math.sin(now * 2.5 + i) * 0.12;

      // 먹었나 — 수평 거리만.
      if (Math.hypot(c.x - px, c.z - pz) <= COLLECT_R) {
        this.group.remove(c.mesh);
        this.coins.splice(i, 1);
        this.onCollect?.(1);
        continue;
      }
      // 수명이 다하면 사라진다(끝에 잠깐 페이드).
      if (c.t >= LIFETIME) {
        this.group.remove(c.mesh);
        this.coins.splice(i, 1);
      }
    }
  }
}
