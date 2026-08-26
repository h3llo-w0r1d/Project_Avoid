// 맵에 뜨는 코인.
//
// 혼자 하기(솔로) 중에만 켠다. 일정 시간마다 무대 위 한 곳에 금화가 떠오르고,
// 가까이 가면 먹는다(수평 거리만 본다 — 점프 높이는 안 따져 너그럽게). 먹으면
// wallet 에 쌓이고, 그 코인으로 캐릭터를 해금한다.
//
// 판정(죽음)과는 무관한 순수 수집 요소다. 서버·1v1 규칙을 건드리지 않는다.

import * as THREE from 'three';
import { ARENA_RADIUS } from './config.js';

const SPAWN_MIN = 7.0;            // 다음 코인까지 최소 간격(초) — 너무 자주 안 나오게 늘림
const SPAWN_MAX = 12.0;
const MAX_ON_FIELD = 2;          // 동시에 떠 있는 코인 수 상한
const LIFETIME = 4;              // 안 먹으면 사라지는 시간(초) — 짧게 줘서 바로 안 먹으면 놓친다
const COLLECT_R = 0.95;          // 수집 반경(수평 거리)
const Y = 0.7;                   // 떠 있는 높이(플레이어 몸통쯤)
const R_MIN = 1.6;               // 스폰 반경 범위 — 중앙·가장자리 너무 붙지 않게
const R_MAX = ARENA_RADIUS - 1.4;
const CLEAR_OF_PLAYER = 2.2;     // 플레이어 코앞엔 안 띄운다(즉시 먹힘 방지)

// 코인 뒤에 깔 부드러운 금빛 후광. 어두운 무대에서도 코인이 눈에 띄고
// 반짝여 보이게 한다(가운데 밝고 밖으로 사라지는 원).
function makeGlowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, 'rgba(255,244,190,0.95)');
  grad.addColorStop(0.35, 'rgba(255,205,80,0.6)');
  grad.addColorStop(1.0, 'rgba(255,205,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

export class Coins {
  constructor(scene, onCollect) {
    this.onCollect = onCollect;   // (개수) => void
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    // 금화 한 장: 납작한 원기둥을 세워, Y축으로 돌면 반짝이며 도는 코인처럼 보인다.
    this.geo = new THREE.CylinderGeometry(0.32, 0.32, 0.07, 24);
    this.geo.rotateX(Math.PI / 2);   // 원기둥 축을 Z로 눕혀 동전 면이 옆을 보게
    // 밝고 자체발광이 강한 금색. 무대 조명이 약해도 어둡지 않게 스스로 빛난다.
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xffe25a, metalness: 0.55, roughness: 0.22,
      emissive: 0xffc23a, emissiveIntensity: 1.15
    });

    // 코인 뒤 후광(가산 혼합). 모든 코인이 공유하고, 크기만 각자 반짝이게 흔든다.
    this.glowTex = makeGlowTexture();
    this.glowMat = new THREE.SpriteMaterial({
      map: this.glowTex, color: 0xffd24a, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9
    });

    this.coins = [];   // { mesh, glow, x, z, t, phase }
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

    // 후광 스프라이트는 코인 자식으로 붙여 같이 움직인다. 스프라이트는 늘
    // 카메라를 보므로 코인이 돌아도 후광은 정면으로 반짝인다.
    const glow = new THREE.Sprite(this.glowMat);
    glow.scale.set(1.3, 1.3, 1);
    glow.position.set(0, 0, -0.02);   // 코인 살짝 뒤
    glow.renderOrder = 2;
    mesh.add(glow);

    this.group.add(mesh);
    this.coins.push({ mesh, glow, x, z, t: 0, phase: 'live' });
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
      // 후광이 커졌다 작아지며 반짝인다(코인마다 위상 어긋내기).
      const tw = 1.15 + Math.sin(now * 6 + i * 1.7) * 0.22;
      c.glow.scale.set(1.3 * tw, 1.3 * tw, 1);

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
