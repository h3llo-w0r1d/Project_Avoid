// 발자국 효과 — 움직일 때 발밑에서 흩어지는 입자.
//
// 코인으로 사는 꾸미기다. 판정에는 전혀 영향이 없다(그래야 산 사람이
// 유리해지지 않는다). 캐릭터와 달리 한 번에 하나만 켠다.
//
// 어떻게 그리나
// -------------
// 입자 하나에 메시 하나를 쓰면 백 개만 돼도 드로우콜이 백 번이다. 그래서
// THREE.Points 하나에 전부 담고, 자리와 색만 매 프레임 고쳐 쓴다. 드로우콜은
// 효과당 딱 하나다.
//
// 투명도는 색으로 낸다. PointsMaterial 은 입자마다 알파를 줄 수 없지만,
// 가산 합성(AdditiveBlending)에서는 어두워지는 게 곧 옅어지는 것이라
// 수명이 다해 갈수록 색을 어둡게 깎으면 자연스럽게 사라진다.

import * as THREE from 'three';
import { PLAYER } from './config.js';

const MAX = 140;                 // 입자 통 크기. 다 쓰면 제일 오래된 걸 되쓴다.
const FOOT = PLAYER.height / 2;  // 몸 한가운데에서 발바닥까지

// 살 수 있는 발자국 효과들. cost 는 코인.
export const TRAILS = [
  {
    id: 'sparkle', name: '반짝이', cost: 150,
    desc: '걸을 때마다 발밑에서 별가루가 반짝여요',
    shape: 'star', size: 0.30, rate: 26, life: 0.62,
    rise: 0.9, spread: 0.30, gravity: -0.4,
    colors: [0xfff6c8, 0xffd76a, 0xffffff]
  },
  {
    id: 'bubble', name: '비눗방울', cost: 200,
    desc: '동글동글한 비눗방울이 떠올라요',
    shape: 'ring', size: 0.40, rate: 14, life: 1.25,
    rise: 1.5, spread: 0.22, gravity: 0.35,
    colors: [0x9fe6ff, 0xc9f2ff, 0x7ec8ff]
  },
  {
    id: 'flame', name: '불꽃', cost: 300,
    desc: '지나간 자리에 불티가 흩날려요',
    shape: 'dot', size: 0.32, rate: 34, life: 0.5,
    rise: 1.5, spread: 0.24, gravity: 0.6,
    colors: [0xffb03a, 0xff5e2a, 0xffe08a]
  },
  {
    id: 'snow', name: '눈꽃', cost: 250,
    desc: '차가운 눈송이가 천천히 내려앉아요',
    shape: 'star', size: 0.26, rate: 16, life: 1.6,
    rise: 0.5, spread: 0.42, gravity: -0.55,
    colors: [0xffffff, 0xd6f0ff, 0xaadcff]
  },
  {
    id: 'heart', name: '하트', cost: 350,
    desc: '작은 하트가 퐁퐁 피어나요',
    shape: 'heart', size: 0.38, rate: 12, life: 1.1,
    rise: 1.3, spread: 0.20, gravity: 0.25,
    colors: [0xff8fc4, 0xff5f9e, 0xffd0e4]
  },
  {
    id: 'rainbow', name: '무지개', cost: 500,
    desc: '일곱 빛깔이 차례로 흘러나와요',
    shape: 'dot', size: 0.34, rate: 30, life: 0.85,
    rise: 1.0, spread: 0.26, gravity: 0.1,
    rainbow: true, colors: [0xffffff]
  }
];

export const findTrail = (id) => TRAILS.find((t) => t.id === id) ?? null;

// 경기장 스킨. 지금은 원래 풀숲 하나뿐이고, 팔 스킨은 아직 안 정했다.
//
// 새 스킨은 여기 한 줄만 더하면 상점에 바로 뜬다. 색은 scene.js 의
// paintArena() 가 상판·절벽·풀포기 무늬에 곱한다(무늬는 그대로, 색만 바뀐다).
//   { id, name, cost, desc, top: 0xRRGGBB, cliff: 0xRRGGBB, tuft: 0xRRGGBB }
// 색을 안 적으면 원래 색 그대로다.
export const ARENAS = [
  {
    id: 'grass', name: '풀숲', cost: 0,
    desc: '처음부터 쓰던 초록 들판',
    swatchTop: 0x6f9e4a, swatchSide: 0x7a5a3a
  }
];

export const findArena = (id) => ARENAS.find((a) => a.id === id) ?? null;
export const DEFAULT_ARENA = 'grass';

// ---------------------------------------------------------------- 입자 그림
// 입자 모양은 캔버스에 한 번 그려 두고 모두가 나눠 쓴다. 모양마다 하나씩.
const texCache = new Map();

function shapeTexture(shape) {
  if (texCache.has(shape)) return texCache.get(shape);

  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const c = S / 2;

  if (shape === 'dot' || shape === 'ring') {
    const grd = g.createRadialGradient(c, c, 0, c, c, c);
    if (shape === 'ring') {
      // 가운데가 비어야 비눗방울처럼 보인다
      grd.addColorStop(0.00, 'rgba(255,255,255,0.10)');
      grd.addColorStop(0.62, 'rgba(255,255,255,0.20)');
      grd.addColorStop(0.86, 'rgba(255,255,255,1)');
      grd.addColorStop(1.00, 'rgba(255,255,255,0)');
    } else {
      grd.addColorStop(0.00, 'rgba(255,255,255,1)');
      grd.addColorStop(0.45, 'rgba(255,255,255,0.75)');
      grd.addColorStop(1.00, 'rgba(255,255,255,0)');
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  } else if (shape === 'star') {
    // 네 갈래로 뻗은 반짝임. 가운데는 밝은 점.
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const len = i % 2 === 0 ? c * 0.92 : c * 0.55;
      g.lineWidth = i % 2 === 0 ? S * 0.09 : S * 0.06;
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
      g.stroke();
    }
    const grd = g.createRadialGradient(c, c, 0, c, c, c * 0.42);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  } else {   // heart
    g.fillStyle = '#ffffff';
    g.beginPath();
    // 위쪽 두 봉우리 → 아래 꼭짓점. 캔버스 좌표라 y 가 아래로 간다.
    g.moveTo(c, S * 0.86);
    g.bezierCurveTo(S * 0.06, S * 0.56, S * 0.16, S * 0.14, c, S * 0.34);
    g.bezierCurveTo(S * 0.84, S * 0.14, S * 0.94, S * 0.56, c, S * 0.86);
    g.closePath();
    g.fill();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(shape, tex);
  return tex;
}

// ---------------------------------------------------------------- 입자 통
export class TrailFX {
  constructor(scene) {
    this.scene = scene;
    this.spec = null;
    this.points = null;
    this.acc = 0;        // 아직 못 뿌린 입자 수(소수점 누적)
    this.hue = 0;        // 무지개용
    this.n = 0;          // 통에서 다음에 쓸 자리

    // 입자마다: 자리(3) · 색(3) · 속도(3) · 남은 수명 · 처음 수명
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.born = new Float32Array(MAX);
    this.base = new Float32Array(MAX * 3);   // 수명 다해 갈 때 깎기 전의 원래 색
  }

  // id 가 null 이거나 없는 효과면 끈다.
  setEffect(id) {
    const spec = id ? findTrail(id) : null;
    if (spec === this.spec) return;
    this.dispose();
    this.spec = spec;
    if (!spec) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    // 아직 안 쓰는 입자는 아주 멀리 치워 둔다(0,0,0 에 두면 바닥에 뭉친다)
    this.reset();

    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: shapeTexture(spec.shape),
      size: spec.size,
      vertexColors: true,
      transparent: true,
      depthWrite: false,           // 서로 가리지 않게
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    }));
    this.points.frustumCulled = false;   // 입자가 흩어져 경계 상자가 안 맞는다
    this.points.renderOrder = 3;
    this.scene.add(this.points);
  }

  // 판이 새로 시작할 때. 남아 있던 입자를 치운다.
  reset() {
    this.life.fill(0);
    this.acc = 0;
    this.n = 0;
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -999;
    this.col.fill(0);
    if (this.points) this.#flush();
  }

  dispose() {
    if (!this.points) return;
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points = null;
  }

  #spawn(x, y, z) {
    const s = this.spec;
    const i = this.n;
    this.n = (this.n + 1) % MAX;

    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * s.spread;
    this.pos[i * 3] = x + Math.cos(a) * r;
    this.pos[i * 3 + 1] = y + Math.random() * 0.12;
    this.pos[i * 3 + 2] = z + Math.sin(a) * r;

    this.vel[i * 3] = Math.cos(a) * s.spread * 0.7;
    this.vel[i * 3 + 1] = s.rise * (0.6 + Math.random() * 0.7);
    this.vel[i * 3 + 2] = Math.sin(a) * s.spread * 0.7;

    const c = new THREE.Color();
    if (s.rainbow) c.setHSL(this.hue, 0.95, 0.62);
    else c.setHex(s.colors[(Math.random() * s.colors.length) | 0]);
    this.base[i * 3] = c.r; this.base[i * 3 + 1] = c.g; this.base[i * 3 + 2] = c.b;

    const life = s.life * (0.75 + Math.random() * 0.5);
    this.life[i] = life;
    this.born[i] = life;
  }

  #flush() {
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  // pos: 캐릭터 몸 한가운데. speed: 가로 속도. grounded: 바닥에 닿아 있나.
  update(dt, pos, speed, grounded) {
    if (!this.spec || !this.points || dt <= 0) return;
    const s = this.spec;

    if (s.rainbow) this.hue = (this.hue + dt * 0.35) % 1;

    // 뿌리는 양은 속도에 따라. 서 있으면 아주 조금만(살아 있는 느낌은 남게).
    // 공중에서도 뿌린다 — 점프가 이 효과의 제일 예쁜 순간이다.
    const move = Math.min(1, speed / 6);
    const rate = s.rate * (0.18 + move * 0.82) * (grounded ? 1 : 0.75);
    this.acc += rate * dt;
    const foot = pos.y - FOOT;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.#spawn(pos.x, foot, pos.z);
    }

    // 살아 있는 입자를 움직이고, 수명만큼 색을 깎아 사라지게 한다.
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -999;                 // 통 밖으로 치운다
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.vel[i * 3 + 1] += s.gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;

      // 태어날 때 반짝 밝았다가 서서히 꺼진다
      const t = this.life[i] / this.born[i];
      const f = t * t * (0.7 + 0.3 * t);
      this.col[i * 3] = this.base[i * 3] * f;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    this.#flush();
  }
}
