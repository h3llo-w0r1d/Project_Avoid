'use strict';

// ═══════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════
const PW   = 14;     // platform half-size (full = PW*2 = 28 units... wait, PW is full)
                     // actually: platform width = PW, depth = PW
const HALF = PW / 2; // 7
const PR   = 0.36;   // player radius
const JUMP_VEL   = 0.20;
const GRAVITY    = -0.010;
const MOVE_SPD   = 0.12;
const MOVE_FRIC  = 0.80;
const BAR_H      = 0.90; // barrier height (player must jump above this)
const BAR_COLL   = 0.10; // collision thickness

const lerp  = (a,b,t) => a + (b-a)*t;
const clamp = (v,lo,hi) => Math.max(lo, Math.min(hi, v));
const fmtT  = t => {
  const mm = String(Math.floor(t/60)).padStart(2,'0');
  const ss = String(Math.floor(t%60)).padStart(2,'0');
  const cs = String(Math.floor((t%1)*100)).padStart(2,'0');
  return `${mm}:${ss}.${cs}`;
};

// ═══════════════════════════════════════════════════════════
//  ELECTRIC BARRIER
// ═══════════════════════════════════════════════════════════
class ElectricBarrier {
  /**
   * dir: 0=N(−z→+z)  1=S(+z→−z)  2=E(+x→−x)  3=W(−x→+x)
   * coverage: 'full' | 'half-left' | 'half-right'
   */
  // dir: 0=N(−z→+z)  1=S(+z→−z)  2=E(+x→−x)  3=W(−x→+x)
  constructor(scene, dir, speed, coverage='full', posOffset=0) {
    this.scene    = scene;
    this.dir      = dir;
    this.speed    = speed;
    this.coverage = coverage;
    this.done     = false;
    this._animTimer = 0;
    this._lineGeos  = [];

    let bw, lateralOffset;
    if (coverage === 'full')           { bw = PW;    lateralOffset = 0;      }
    else if (coverage === 'half-left') { bw = PW/2; lateralOffset = -PW/4; }
    else                               { bw = PW/2; lateralOffset =  PW/4;  }
    this._bw     = bw;
    this._latOff = lateralOffset;
    const isZ = (dir < 2);
    this._axis    = isZ ? 'z' : 'x';
    this._latAxis = isZ ? 'x' : 'z';
    if (dir === 0) { this._pos = -HALF - posOffset; this._sign =  1; this._limit =  HALF + 2; }
    if (dir === 1) { this._pos =  HALF + posOffset; this._sign = -1; this._limit = -HALF - 2; }
    if (dir === 2) { this._pos =  HALF + posOffset; this._sign = -1; this._limit = -HALF - 2; }
    if (dir === 3) { this._pos = -HALF - posOffset; this._sign =  1; this._limit =  HALF + 2; }

    this.group = new THREE.Group();
    this._build();
    scene.add(this.group);
    this._place();
  }

  _build() {
    const bw  = this._bw;
    const isZ = this._axis === 'z';
    const BY  = this._beamY = 0.82;
    const SEG = 28;

    const childRotY = isZ ? 0 : Math.PI / 2;

    const outerBox = new THREE.Mesh(
      new THREE.BoxGeometry(bw, 0.46, 0.26),
      new THREE.MeshBasicMaterial({ color: 0x660000, transparent: true, opacity: 0.50, depthWrite: false })
    );
    outerBox.position.y = BY; outerBox.rotation.y = childRotY;
    this.group.add(outerBox);

    const midBox = new THREE.Mesh(
      new THREE.BoxGeometry(bw, 0.24, 0.15),
      new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.75, depthWrite: false })
    );
    midBox.position.y = BY; midBox.rotation.y = childRotY;
    this.group.add(midBox);

    const coreBox = new THREE.Mesh(
      new THREE.BoxGeometry(bw, 0.09, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    coreBox.position.y = BY; coreBox.rotation.y = childRotY;
    this.group.add(coreBox);

    const LAYERS = [
      { spread: 0.55, color: 0xcc2200, opacity: 0.55 },
      { spread: 0.28, color: 0xff5500, opacity: 0.75 },
      { spread: 0.10, color: 0xffcc88, opacity: 0.95 },
    ];
    this._lineGeos = [];
    for (const layer of LAYERS) {
      const pts = [];
      for (let j = 0; j <= SEG; j++) {
        const t = j / SEG;
        const mid = j > 0 && j < SEG;
        pts.push(new THREE.Vector3(
          (t - 0.5) * bw + (mid ? (Math.random()-0.5)*0.20 : 0),
          BY              + (mid ? (Math.random()-0.5)*layer.spread : 0),
                            (mid ? (Math.random()-0.5)*0.04 : 0)
        ));
      }
      const geo  = new THREE.BufferGeometry().setFromPoints(pts);
      const mat  = new THREE.LineBasicMaterial({ color: layer.color, transparent: true, opacity: layer.opacity });
      const line = new THREE.Line(geo, mat);
      line.rotation.y = childRotY;
      this.group.add(line);
      this._lineGeos.push({ geo, bw, spread: layer.spread });
    }

    // 양 끝 앵커 오브: 빔 회전 방향에 맞게 끝점에 배치
    const cx = Math.cos(childRotY), cz = Math.sin(childRotY);
    for (const side of [-1, 1]) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xff8844, transparent: true, opacity: 0.92 })
      );
      orb.position.set(side * bw / 2 * cx, BY, side * bw / 2 * cz);
      this.group.add(orb);
      const el = new THREE.PointLight(0xff4400, 2.0, 4.5);
      el.position.copy(orb.position);
      this.group.add(el);
    }

    this._light = new THREE.PointLight(0xff4400, 4.5, 9);
    this._light.position.y = BY;
    this.group.add(this._light);
  }

  _place() {
    if (this._axis === 'z') {
      this.group.position.set(this._latOff, 0, this._pos);
    } else {
      this.group.position.set(this._pos, 0, this._latOff);
    }
  }

  update() {
    this._pos += this._sign * this.speed;
    this._place();
    const prog = Math.abs(this._pos) / HALF;
    this._light.intensity = 3 + (1 - clamp(prog,0,1)) * 4;
    const over = this._sign > 0 ? this._pos >= this._limit : this._pos <= this._limit;
    if (over) { this.scene.remove(this.group); this.done = true; return; }

    // 번개선 애니메이션 (매 2프레임)
    if ((++this._animTimer) % 2 === 0) {
      const BY = this._beamY;
      this._lineGeos.forEach(({ geo, bw, spread }) => {
        const pa = geo.attributes.position;
        for (let i = 1; i < pa.count - 1; i++) {
          const t = i / (pa.count - 1);
          pa.setX(i, (t - 0.5) * bw + (Math.random()-0.5) * 0.18);
          pa.setY(i, BY + (Math.random()-0.5) * spread);
          pa.setZ(i, (Math.random()-0.5) * 0.04);
        }
        pa.needsUpdate = true;
      });
    }
  }

  // Check collision with a sphere at (px, py, pz) radius pr
  collides(px, py, pz, pr) {
    if (py - pr > BAR_H) return false;
    const bPos = this.group.position;

    const planeDist = this._axis === 'z'
      ? Math.abs(pz - bPos.z) : Math.abs(px - bPos.x);
    if (planeDist > BAR_COLL + pr) return false;
    const latPos    = this._axis === 'z' ? px : pz;
    const latCenter = this._axis === 'z' ? bPos.x : bPos.z;
    if (Math.abs(latPos - latCenter) > this._bw / 2 + pr * 0.6) return false;
    return true;
  }
}

// ═══════════════════════════════════════════════════════════
//  DEATH PARTICLE SYSTEM
// ═══════════════════════════════════════════════════════════
class DeathParticles {
  constructor(scene, x, y, z, color) {
    this._meshes = [];
    this._vels   = [];
    this._scene  = scene;
    this._timer  = 0;
    this._life   = 55;

    const geo = new THREE.SphereGeometry(0.12, 6, 6);
    for (let i = 0; i < 28; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
      const m   = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      scene.add(m);
      this._meshes.push(m);

      const angle  = Math.random() * Math.PI * 2;
      const elevat = (Math.random() - 0.3) * Math.PI;
      const spd    = 0.06 + Math.random() * 0.18;
      this._vels.push({
        x: Math.cos(angle) * Math.cos(elevat) * spd,
        y: Math.sin(elevat) * spd + 0.04,
        z: Math.sin(angle) * Math.cos(elevat) * spd
      });
    }
  }

  update() {
    this._timer++;
    const alpha = 1 - this._timer / this._life;
    this._meshes.forEach((m, i) => {
      const v = this._vels[i];
      m.position.x += v.x;
      m.position.y += v.y;
      m.position.z += v.z;
      v.y -= 0.005; // mini gravity
      m.material.opacity = Math.max(0, alpha * 0.85);
    });
  }

  isDone() { return this._timer >= this._life; }

  dispose() {
    this._meshes.forEach(m => this._scene.remove(m));
  }
}

// ═══════════════════════════════════════════════════════════
//  PLAYER
// ═══════════════════════════════════════════════════════════
// ── 캐릭터 스킨 정의 (나중에 선택 기능 확장용) ───────────────────
const CHAR_DEFS = [
  { id: 'cyan',   name: '기본',   bodyColor: 0x005577, legColor: 0x003355, glowColor: 0x00ffff },
  { id: 'red',    name: '레드',   bodyColor: 0x661111, legColor: 0x440000, glowColor: 0xff3333 },
  { id: 'green',  name: '그린',   bodyColor: 0x115511, legColor: 0x003300, glowColor: 0x44ff44 },
  { id: 'purple', name: '퍼플',   bodyColor: 0x440066, legColor: 0x220044, glowColor: 0xcc44ff },
];

class Player3D {
  constructor(scene, startX, startZ, color, glowColor, controls) {
    this.px = startX; this.py = PR; this.pz = startZ;
    this.pvx = 0; this.pvy = 0; this.pvz = 0;
    this.onGround = true;
    this.alive = true;
    this.color = color;
    this.glowColor = glowColor;
    this.ctrl = controls;

    // 캐릭터 그룹 (발 위치 = y 기준)
    this.charGroup = new THREE.Group();
    scene.add(this.charGroup);
    this._mixer = null;
    this._runAction = null;
    this._clock = new THREE.Clock();
    this._loadModel(color, glowColor);

    // 발광 라이트
    this.light = new THREE.PointLight(glowColor, 1.8, 3.5);
    this.light.position.y = 0.45;
    this.charGroup.add(this.light);

    // 캐릭터 전용 흰색 보조광 (씬 붉은 조명 상쇄)
    const fillLight = new THREE.PointLight(0xffffff, 3.5, 2.5);
    fillLight.position.set(0, 1.2, 0.8);
    this.charGroup.add(fillLight);

    // 지면 그림자
    const sGeo = new THREE.CircleGeometry(0.22, 16);
    const sMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false
    });
    this.shadowDisc = new THREE.Mesh(sGeo, sMat);
    this.shadowDisc.rotation.x = -Math.PI / 2;
    this.shadowDisc.position.y = 0.008;
    scene.add(this.shadowDisc);

    // 잔상 파티클
    this._trail = [];
    const tGeo = new THREE.SphereGeometry(0.055, 6, 6);
    for (let i = 0; i < 8; i++) {
      const tm = new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0 });
      const ts = new THREE.Mesh(tGeo, tm);
      scene.add(ts);
      this._trail.push({ mesh: ts, x: startX, y: PR, z: startZ });
    }

    this._scene = scene;
    this._deathParticles = null;
    this._frame = 0;
    this._jumpPressed = false;
    this._jumpsLeft = 2;
    this._runPhase = 0;
  }

  _loadModel(color, glowColor) {
    const loader = new THREE.GLTFLoader();
    loader.load('/models/Running.fbx.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.setScalar(0.008);
      model.traverse(m => {
        if (m.isMesh) {
          m.castShadow = true;
          // 씬 붉은 조명을 중립 emissive로 상쇄 → 전방향 균일 밝기
          if (m.material) {
            m.material.emissive = new THREE.Color(0x606060);
            m.material.emissiveIntensity = 1.0;
          }
        }
      });
      this.charGroup.add(model);
      this._model = model;
      this._mixer = new THREE.AnimationMixer(model);

      // 달리기 애니메이션
      if (gltf.animations.length > 0) {
        const runClip = gltf.animations[0];
        runClip.tracks = runClip.tracks.filter(t => !t.name.endsWith('.position'));
        this._runAction = this._mixer.clipAction(runClip);
        this._runAction.play();
      }

    }, undefined, () => {
      this._buildHumanoid(color, glowColor);
    });
  }

  _buildHumanoid(color, glowColor) {
    const bodyMat = new THREE.MeshStandardMaterial({
      color, emissive: glowColor, emissiveIntensity: 0.30,
      roughness: 0.40, metalness: 0.35
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffd090, roughness: 0.55, metalness: 0.0
    });
    const legMat = new THREE.MeshStandardMaterial({
      color: glowColor, emissive: glowColor, emissiveIntensity: 0.55,
      roughness: 0.25, metalness: 0.5
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: glowColor });

    // 몸통 (torso)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.13), bodyMat);
    torso.position.y = 0.46;
    this.charGroup.add(torso);

    // 머리 그룹
    this._head = new THREE.Group();
    this._head.position.y = 0.71;
    const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.23, 0.25), headMat);
    this._head.add(headBox);
    // 눈
    for (const ex of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.05, 0.02), eyeMat);
      eye.position.set(ex, 0.02, 0.135);
      this._head.add(eye);
    }
    this.charGroup.add(this._head);

    // 팔 (shoulder pivot)
    this._leftArm  = new THREE.Group();
    this._rightArm = new THREE.Group();
    this._leftArm.position.set(-0.18, 0.575, 0);
    this._rightArm.position.set( 0.18, 0.575, 0);
    for (const grp of [this._leftArm, this._rightArm]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.27, 0.10), bodyMat);
      arm.position.y = -0.135;
      grp.add(arm);
      this.charGroup.add(grp);
    }

    // 다리 (hip pivot)
    this._leftLeg  = new THREE.Group();
    this._rightLeg = new THREE.Group();
    this._leftLeg.position.set(-0.075, 0.30, 0);
    this._rightLeg.position.set( 0.075, 0.30, 0);
    for (const grp of [this._leftLeg, this._rightLeg]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.30, 0.11), legMat);
      leg.position.y = -0.15;
      grp.add(leg);
      this.charGroup.add(grp);
    }

    this.charGroup.traverse(m => { if (m.isMesh) m.castShadow = true; });
  }

  _animateChar(isMoving) {
    if (!this._leftArm) return; // GLTF 모델 사용 중이면 스킵
    if (!this.onGround) {
      // 점프 자세: 팔 들어올리기, 다리 모으기
      this._leftArm.rotation.x  = lerp(this._leftArm.rotation.x,  -0.65, 0.18);
      this._rightArm.rotation.x = lerp(this._rightArm.rotation.x, -0.65, 0.18);
      this._leftLeg.rotation.x  = lerp(this._leftLeg.rotation.x,   0.25, 0.18);
      this._rightLeg.rotation.x = lerp(this._rightLeg.rotation.x, -0.25, 0.18);
    } else if (isMoving) {
      // 달리기 애니메이션
      this._runPhase += 0.22;
      const swing = Math.sin(this._runPhase) * 0.60;
      this._leftLeg.rotation.x  =  swing;
      this._rightLeg.rotation.x = -swing;
      this._leftArm.rotation.x  = -swing * 0.55;
      this._rightArm.rotation.x =  swing * 0.55;
      // 머리 살짝 흔들기
      this._head.position.y = 0.71 + Math.abs(Math.sin(this._runPhase * 2)) * 0.025;
    } else {
      // 대기: 중립으로 복귀
      this._leftLeg.rotation.x  = lerp(this._leftLeg.rotation.x,  0, 0.14);
      this._rightLeg.rotation.x = lerp(this._rightLeg.rotation.x, 0, 0.14);
      this._leftArm.rotation.x  = lerp(this._leftArm.rotation.x,  0, 0.14);
      this._rightArm.rotation.x = lerp(this._rightArm.rotation.x, 0, 0.14);
      // 숨쉬기 효과
      this._head.position.y = 0.71 + Math.sin(this._frame * 0.04) * 0.008;
    }
  }

  update(keys, halfMap) {
    this._frame++;
    if (!this.alive) {
      if (this._deathParticles) {
        this._deathParticles.update();
        if (this._deathParticles.isDone()) {
          this._deathParticles.dispose();
          this._deathParticles = null;
        }
      }
      return;
    }

    // 이동
    let ax = 0, az = 0;
    if (keys[this.ctrl.left])  ax -= 1;
    if (keys[this.ctrl.right]) ax += 1;
    if (keys[this.ctrl.fwd])   az -= 1;
    if (keys[this.ctrl.back])  az += 1;
    if (ax && az) { ax *= 0.707; az *= 0.707; }

    this.pvx = this.pvx * MOVE_FRIC + ax * MOVE_SPD * (1 - MOVE_FRIC);
    this.pvz = this.pvz * MOVE_FRIC + az * MOVE_SPD * (1 - MOVE_FRIC);
    const spd = Math.sqrt(this.pvx**2 + this.pvz**2);
    if (spd > MOVE_SPD) { this.pvx = (this.pvx/spd)*MOVE_SPD; this.pvz = (this.pvz/spd)*MOVE_SPD; }

    // 2단 점프 (ControlLeft / ControlRight)
    const jumpDown = keys[this.ctrl.jump] || keys['ControlRight'];
    if (jumpDown && !this._jumpPressed && this._jumpsLeft > 0) {
      this.pvy = JUMP_VEL;
      this.onGround = false;
      this._jumpsLeft--;
    }
    this._jumpPressed = jumpDown;

    if (!this.onGround) this.pvy += GRAVITY;

    this.px = clamp(this.px + this.pvx, -halfMap + PR, halfMap - PR);
    this.pz = clamp(this.pz + this.pvz, -halfMap + PR, halfMap - PR);
    this.py += this.pvy;
    if (this.py <= PR) { this.py = PR; this.pvy = 0; this.onGround = true; this._jumpsLeft = 2; }

    // 발 위치 기준으로 캐릭터 그룹 배치
    const feetY = this.py - PR;
    this.charGroup.position.set(this.px, feetY, this.pz);

    // 이동 방향으로 캐릭터 회전
    const isMoving = spd > 0.008;
    if (isMoving) {
      const targetAngle = Math.atan2(this.pvx, this.pvz);
      this.charGroup.rotation.y = lerp(this.charGroup.rotation.y, targetAngle, 0.14);
    }

    // 애니메이션
    if (this._mixer) {
      this._mixer.update(1 / 60);
      if (this._runAction) this._runAction.timeScale = isMoving ? 1 : 0;
      if (this._model) { this._model.position.x = 0; this._model.position.z = 0; }
    } else {
      this._animateChar(isMoving);
    }

    // 그림자 (공중에 뜰수록 작아짐)
    this.shadowDisc.position.set(this.px, 0.008, this.pz);
    this.shadowDisc.scale.setScalar(Math.max(0.12, 1.0 - feetY * 0.4));

    // 빛 펄스
    this.light.intensity = 1.5 + Math.sin(this._frame * 0.12) * 0.4;

    // 잔상
    for (let i = this._trail.length - 1; i >= 0; i--) {
      const t = this._trail[i];
      if (i === 0) { t.x = this.px; t.y = feetY + 0.35; t.z = this.pz; }
      else {
        t.x = lerp(t.x, this._trail[i-1].x, 0.35);
        t.y = lerp(t.y, this._trail[i-1].y, 0.35);
        t.z = lerp(t.z, this._trail[i-1].z, 0.35);
      }
      t.mesh.position.set(t.x, t.y, t.z);
      t.mesh.material.opacity = (1 - i / this._trail.length) * 0.16;
    }
  }

  updateRemote(x, y, z) {
    const prevX = this.px, prevZ = this.pz;
    this.px = x; this.py = y; this.pz = z;
    const feetY = y - PR;
    this.charGroup.position.set(x, feetY, z);

    const dx = x - prevX, dz = z - prevZ;
    const isMoving = Math.sqrt(dx*dx + dz*dz) > 0.002;
    if (isMoving) {
      const targetAngle = Math.atan2(dx, dz);
      this.charGroup.rotation.y = lerp(this.charGroup.rotation.y, targetAngle, 0.14);
    }

    if (this._mixer) {
      this._mixer.update(1 / 60);
      if (this._runAction) this._runAction.timeScale = isMoving ? 1 : 0;
      if (this._model) { this._model.position.x = 0; this._model.position.z = 0; }
    } else {
      this._animateChar(isMoving);
    }

    this.shadowDisc.position.set(x, 0.008, z);
    this.shadowDisc.scale.setScalar(Math.max(0.12, 1.0 - feetY * 0.4));
    this.light.intensity = 1.5 + Math.sin(this._frame * 0.12) * 0.4;

    for (let i = this._trail.length - 1; i >= 0; i--) {
      const t = this._trail[i];
      if (i === 0) { t.x = x; t.y = feetY + 0.35; t.z = z; }
      else {
        t.x = lerp(t.x, this._trail[i-1].x, 0.35);
        t.y = lerp(t.y, this._trail[i-1].y, 0.35);
        t.z = lerp(t.z, this._trail[i-1].z, 0.35);
      }
      t.mesh.position.set(t.x, t.y, t.z);
      t.mesh.material.opacity = (1 - i / this._trail.length) * 0.16;
    }
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.charGroup.visible = false;
    this.shadowDisc.visible = false;
    this._trail.forEach(t => { t.mesh.material.opacity = 0; });
    this._deathParticles = new DeathParticles(this._scene, this.px, this.py, this.pz, this.glowColor);
  }

  dispose() {
    this._scene.remove(this.charGroup);
    this._scene.remove(this.shadowDisc);
    this._trail.forEach(t => this._scene.remove(t.mesh));
    if (this._deathParticles) { this._deathParticles.dispose(); }
  }
}

// ═══════════════════════════════════════════════════════════
//  MAP CONFIGS
// ═══════════════════════════════════════════════════════════
const MAP_CFGS = {
  square: {
    name: '지옥 경기장',
    platformColor: 0x0d0000,
    gridColor:     0x2a0000,
    edgeColor:     0xff2200,
    halfMap: HALF,
    depthMap: HALF,
    camPos: [0, 9.5, 14],
    camLook: [0, 0.5, 0],
  },
  ice: {
    name: '빙하 경기장',
    platformColor: 0x1a3348,
    gridColor:     0x1a4466,
    edgeColor:     0x44ccff,
    halfMap: HALF,
    depthMap: HALF,
    camPos: [0, 9.5, 14],
    camLook: [0, 0.5, 0],
  },
};

// ═══════════════════════════════════════════════════════════
//  GAME3D
// ═══════════════════════════════════════════════════════════
class Game3D {
  constructor(canvas) {
    this.canvas   = canvas;
    this.W        = 800;
    this.H        = 600;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(this.W, this.H);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050000);
    this.scene.fog = new THREE.Fog(0x0a0000, 16, 42);

    // Camera
    this.camera = new THREE.PerspectiveCamera(55, this.W / this.H, 0.1, 80);

    // State
    this.state     = 'menu';
    this.mode      = 'solo';
    this.mapId     = 'square';
    this.elapsed   = 0;
    this.startTime = 0;
    this.diff      = 0;
    this.frame     = 0;
    this.spawnCd   = 120;
    this.flashAlpha = 0;

    this.barriers  = [];
    this.players   = [];
    this.keys      = {};

    // Socket.io
    this.socket  = null;
    this.roomId  = null;
    this.myNum   = null;
    this.oppPos  = null;

    // Static scene objects
    this._platformMesh  = null;
    this._gridHelper    = null;
    this._starPoints    = null;
    this._floorWarnings = []; // warning lines on floor

    this._setupInput();
    this._buildStars();
    this._animate();
  }

  // ── SCENE SETUP ────────────────────────────────────────
  _buildScene(cfgId) {
    const cfg = MAP_CFGS[cfgId] || MAP_CFGS.square;

    if (this._platformMesh) { this.scene.remove(this._platformMesh); this._platformMesh.geometry.dispose(); }
    if (this._gridHelper)   { this.scene.remove(this._gridHelper); }
    this._platformLights?.forEach(l => this.scene.remove(l));
    this._platformLights = [];

    this.camera.position.set(...cfg.camPos);
    this.camera.lookAt(...cfg.camLook);

    while (this.scene.children.find(c => c.isAmbientLight || c.isDirectionalLight)) {
      const l = this.scene.children.find(c => c.isAmbientLight || c.isDirectionalLight);
      this.scene.remove(l);
    }

    if (cfgId === 'ice') {
      this.scene.background = new THREE.Color(0x010a18);
      this.scene.fog = new THREE.Fog(0x020d22, 18, 48);
      const amb = new THREE.AmbientLight(0x5588bb, 1.4); this.scene.add(amb);
      const sun = new THREE.DirectionalLight(0xaaddff, 0.9);
      sun.position.set(-8, 14, 6); sun.castShadow = true;
      sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 50;
      sun.shadow.camera.left = sun.shadow.camera.bottom = -15;
      sun.shadow.camera.right = sun.shadow.camera.top = 15;
      this.scene.add(sun);
      const moonUp = new THREE.DirectionalLight(0x112244, 0.4);
      moonUp.position.set(0, -5, 0); this.scene.add(moonUp);
    } else {
      this.scene.background = new THREE.Color(0x050000);
      this.scene.fog = new THREE.Fog(0x0a0000, 16, 42);
      const amb = new THREE.AmbientLight(0x220500, 1.2); this.scene.add(amb);
      const dir = new THREE.DirectionalLight(0xff4400, 1.1);
      dir.position.set(6, 12, 8); dir.castShadow = true;
      dir.shadow.camera.near = 0.5; dir.shadow.camera.far = 50;
      dir.shadow.camera.left = dir.shadow.camera.bottom = -15;
      dir.shadow.camera.right = dir.shadow.camera.top = 15;
      this.scene.add(dir);
      const lavaUp = new THREE.DirectionalLight(0xff1100, 0.6);
      lavaUp.position.set(0, -5, 0); this.scene.add(lavaUp);
    }

    const add = obj => { this.scene.add(obj); this._platformLights.push(obj); };

    if (cfgId === 'ice') { this._buildSceneIce(cfg, add); return; }

    // ── 재질 팔레트 (지옥) ──
    const rockMat   = new THREE.MeshStandardMaterial({ color: cfg.platformColor, roughness: 0.95, metalness: 0.05 });
    const darkRock  = new THREE.MeshStandardMaterial({ color: 0x080000, roughness: 0.98, metalness: 0.02 });
    const towerMat  = new THREE.MeshStandardMaterial({ color: 0x1a0200, roughness: 0.92, metalness: 0.08 });
    const towerCap  = new THREE.MeshStandardMaterial({ color: 0x330500, roughness: 0.85, metalness: 0.15 });
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x150000, roughness: 0.93, metalness: 0.07 });
    const stoneMat  = new THREE.MeshStandardMaterial({ color: 0x120000, roughness: 0.96, metalness: 0.04 });
    const altarMat  = new THREE.MeshStandardMaterial({ color: 0x0d0000, roughness: 0.88, metalness: 0.12 });
    const chainMat  = new THREE.MeshStandardMaterial({ color: 0x1a0600, roughness: 0.70, metalness: 0.55 });
    const orbMat    = new THREE.MeshBasicMaterial({ color: 0xff4400 });
    const rimMat    = new THREE.MeshBasicMaterial({ color: cfg.edgeColor });

    // ── 메인 플랫폼 ──
    this._platformMesh = new THREE.Mesh(new THREE.BoxGeometry(PW, 0.6, PW), rockMat);
    this._platformMesh.receiveShadow = true;
    this._platformMesh.position.y = -0.3;
    this.scene.add(this._platformMesh);

    // 바닥 새김 홈 (십자 + 대각)
    const grooveM = new THREE.MeshBasicMaterial({ color: 0x180000 });
    [[PW-0.3, 0.015, 0.07, 0, 0], [0.07, 0.015, PW-0.3, 0, 0]].forEach(([w,h,d,x,z]) => {
      const g = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), grooveM); g.position.set(x,0.005,z); add(g);
    });
    [45,-45].forEach(deg => {
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, PW*1.35), grooveM.clone());
      g.position.y = 0.005; g.rotation.y = deg*Math.PI/180; add(g);
    });

    // 바닥 룬 원 (동심원 2개)
    [4.5, 3.0, 1.8].forEach((r, ri) => {
      const rt = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 32+ri*8),
        new THREE.MeshBasicMaterial({ color: ri===0?0x660000:ri===1?0x440000:0x550000, transparent:true, opacity:0.65 }));
      rt.rotation.x = Math.PI/2; rt.position.y = 0.012; add(rt);
    });
    // 룬 방사선 8개
    for (let i = 0; i < 8; i++) {
      const ang = (i/8)*Math.PI*2;
      const rl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 1.4),
        new THREE.MeshBasicMaterial({ color: 0x440000, transparent:true, opacity:0.5 }));
      rl.position.set(Math.cos(ang)*2.7, 0.011, Math.sin(ang)*2.7);
      rl.rotation.y = ang; add(rl);
    }

    // 계단식 받침대 3단
    [[PW+2.4, 0.55, -0.88],[PW+4.2, 0.45, -1.43],[PW+6.0, 0.40, -1.90]].forEach(([w,h,y],i) => {
      const m = i===0?darkRock:i===1?darkRock.clone():stoneMat.clone();
      const b = new THREE.Mesh(new THREE.BoxGeometry(w,h,w), m);
      b.receiveShadow = true; b.position.y = y; add(b);
    });

    // 테두리 발광 띠
    [[0,-HALF,PW+0.1,0.12,0.12],[0,HALF,PW+0.1,0.12,0.12]].forEach(([x,z,w,h,d]) => {
      const rm = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), rimMat); rm.position.set(x,0.01,z); add(rm);
    });
    [[HALF,0,0.12,0.12,PW-0.1],[-HALF,0,0.12,0.12,PW-0.1]].forEach(([x,z,w,h,d]) => {
      const rm = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), rimMat); rm.position.set(x,0.01,z); add(rm);
    });
    [[0,-HALF-1.2,PW+2.5,0.10,0.10],[0,HALF+1.2,PW+2.5,0.10,0.10],
     [HALF+1.2,0,0.10,0.10,PW+2.3],[-HALF-1.2,0,0.10,0.10,PW+2.3]].forEach(([x,z,w,h,d]) => {
      const rm = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshBasicMaterial({color:0xaa1100}));
      rm.position.set(x,-0.61,z); add(rm);
    });

    // 그리드
    this._gridHelper = new THREE.GridHelper(PW, 7, cfg.gridColor, cfg.gridColor);
    this._gridHelper.position.y = 0.008;
    this.scene.add(this._gridHelper);

    // ── 용암 바닥 ──
    const lavaFloor = new THREE.Mesh(new THREE.PlaneGeometry(100,100),
      new THREE.MeshBasicMaterial({color:0x0d0000}));
    lavaFloor.rotation.x = -Math.PI/2; lavaFloor.position.y = -2.5; add(lavaFloor);
    const lavaGlow = new THREE.Mesh(new THREE.PlaneGeometry(PW+10,PW+10),
      new THREE.MeshBasicMaterial({color:0xff1100,transparent:true,opacity:0.09,depthWrite:false}));
    lavaGlow.rotation.x = -Math.PI/2; lavaGlow.position.y = -2.3; add(lavaGlow);

    // ── 바닥 균열 (십자+대각+소형 산재) ──
    const crackM = new THREE.MeshBasicMaterial({color:0xff3300,transparent:true,opacity:0.60,depthWrite:false});
    const crackGlow = new THREE.MeshBasicMaterial({color:0xff1100,transparent:true,opacity:0.20,depthWrite:false});
    [0,90].forEach(deg => {
      const cr = new THREE.Mesh(new THREE.BoxGeometry(PW*0.88,0.02,0.07),crackM.clone());
      cr.position.set(0,0.013,0); cr.rotation.y = deg*Math.PI/180; add(cr);
      const cg = new THREE.Mesh(new THREE.BoxGeometry(PW*0.88,0.01,0.22),crackGlow.clone());
      cg.position.set(0,0.006,0); cg.rotation.y = deg*Math.PI/180; add(cg);
    });
    [35,-35,55,-55].forEach((deg,i) => {
      const cr = new THREE.Mesh(new THREE.BoxGeometry(PW*0.65,0.02,0.055),crackM.clone());
      cr.position.set((i%2===0?1.0:-1.0),0.013,(i<2?0.5:-0.5));
      cr.rotation.y = deg*Math.PI/180; add(cr);
    });
    for (let i = 0; i < 16; i++) {
      const sc = new THREE.Mesh(new THREE.BoxGeometry(0.7+Math.random()*2.2,0.014,0.038),
        new THREE.MeshBasicMaterial({color:0xff2200,transparent:true,opacity:0.35+Math.random()*0.25,depthWrite:false}));
      sc.position.set((Math.random()-0.5)*(PW-1.5),0.011,(Math.random()-0.5)*(PW-1.5));
      sc.rotation.y = Math.random()*Math.PI; add(sc);
    }
    // 균열 조명
    [[-3,0],[3,0],[0,-3],[0,3],[-2.5,-2.5],[2.5,2.5]].forEach(([x,z]) => {
      const cl = new THREE.PointLight(0xff2200,0.7,3.5); cl.position.set(x,0.1,z); add(cl);
    });

    // ── 코너 탑 (대폭 강화) ──
    const TPOS = [[-HALF-2.0,-HALF-2.0],[HALF+2.0,-HALF-2.0],[-HALF-2.0,HALF+2.0],[HALF+2.0,HALF+2.0]];
    TPOS.forEach(([tx,tz],ti) => {
      // 기단 2단
      const tb1 = new THREE.Mesh(new THREE.BoxGeometry(2.0,0.5,2.0),towerMat.clone());
      tb1.position.set(tx,0.25,tz); tb1.castShadow=true; add(tb1);
      const tb2 = new THREE.Mesh(new THREE.BoxGeometry(1.5,0.38,1.5),towerMat.clone());
      tb2.position.set(tx,0.69,tz); add(tb2);
      // 탑 몸통 (팔각)
      const tbody = new THREE.Mesh(new THREE.CylinderGeometry(0.40,0.50,3.0,8),towerMat.clone());
      tbody.position.set(tx,2.08,tz); tbody.castShadow=true; add(tbody);
      // 목 좁힘
      const tneck = new THREE.Mesh(new THREE.CylinderGeometry(0.30,0.40,0.55,8),towerMat.clone());
      tneck.position.set(tx,3.85,tz); add(tneck);
      // 관 (왕관형)
      const tcrown = new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.32,0.38,8),towerCap.clone());
      tcrown.position.set(tx,4.30,tz); add(tcrown);
      // 흉벽 4개
      for (let m = 0; m < 4; m++) {
        const ma = (m/4)*Math.PI*2+Math.PI/8;
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.13,0.24,0.13),towerCap.clone());
        merlon.position.set(tx+Math.cos(ma)*0.44,4.62,tz+Math.sin(ma)*0.44); add(merlon);
      }
      // 불꽃 오브 + 코로나
      const torb = new THREE.Mesh(new THREE.SphereGeometry(0.32,14,14),orbMat);
      torb.position.set(tx,4.58,tz); add(torb);
      const corona = new THREE.Mesh(new THREE.SphereGeometry(0.50,10,10),
        new THREE.MeshBasicMaterial({color:0xff2200,transparent:true,opacity:0.15,depthWrite:false}));
      corona.position.set(tx,4.58,tz); add(corona);
      // 탑 조명 2개
      const tl  = new THREE.PointLight(0xff3300,4.5,11); tl.position.set(tx,4.4,tz); add(tl);
      const tl2 = new THREE.PointLight(0x660000,1.4,7);  tl2.position.set(tx,1.8,tz); add(tl2);
      // 링 3개
      [1.2,2.0,2.9].forEach(ry => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.52,0.058,6,14),
          new THREE.MeshStandardMaterial({color:0x330500,roughness:0.8,metalness:0.3}));
        ring.rotation.x = Math.PI/2; ring.position.set(tx,ry,tz); add(ring);
      });
      // 기단 소형 기둥 4개
      [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dx,dz]) => {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.08,0.90,6),pillarMat.clone());
        col.position.set(tx+dx*0.66,0.45,tz+dz*0.66); add(col);
        const cc = new THREE.Mesh(new THREE.BoxGeometry(0.15,0.07,0.15),towerCap.clone());
        cc.position.set(tx+dx*0.66,0.94,tz+dz*0.66); add(cc);
      });
      // 탑 벽 음각 장식
      const fa = [Math.PI/4,-Math.PI/4,3*Math.PI/4,-3*Math.PI/4][ti];
      const fi = new THREE.Mesh(new THREE.BoxGeometry(0.24,0.20,0.06),
        new THREE.MeshBasicMaterial({color:0x080000}));
      fi.position.set(tx+Math.cos(fa)*0.51,0.60,tz+Math.sin(fa)*0.51);
      fi.rotation.y = fa+Math.PI; add(fi);
    });

    // ── 탑 간 체인 연결 ──
    [[0,1],[1,3],[3,2],[2,0]].forEach(([a,b]) => {
      const [ax,az]=TPOS[a],[bx,bz]=TPOS[b];
      const SEG = 9;
      for (let s = 0; s <= SEG; s++) {
        const t = s/SEG;
        const cx = ax+(bx-ax)*t, cz = az+(bz-az)*t;
        const cy = 4.35 - Math.sin(t*Math.PI)*0.65;
        const lnk = new THREE.Mesh(new THREE.TorusGeometry(0.056,0.022,4,6),chainMat.clone());
        lnk.position.set(cx,cy,cz);
        lnk.rotation.y = Math.atan2(bx-ax,bz-az);
        lnk.rotation.z = s%2===0?0:Math.PI/2;
        add(lnk);
      }
    });

    // 코너 바닥 + 중앙 하부 조명
    [[-HALF,0,-HALF],[-HALF,0,HALF],[HALF,0,-HALF],[HALF,0,HALF]].forEach(([x,,z]) => {
      const pl = new THREE.PointLight(cfg.edgeColor,1.2,10); pl.position.set(x,0.5,z); add(pl);
    });
    [new THREE.PointLight(0xff2200,2.2,13),new THREE.PointLight(0xff1100,3.2,16)].forEach((l,i) => {
      l.position.set(0,-1.5+i*0.3,0); add(l);
    });

    // ── 배경 화산 기둥 10개 (조명 없음 - 성능) ──
    const spireMt = new THREE.MeshStandardMaterial({color:0x0a0000,roughness:0.96,metalness:0.04});
    [[-HALF-6,-HALF-6,1.4,9,6],[HALF+5.5,-HALF-5.5,0.9,7,5],
     [-HALF-9,0,1.8,12,7],[HALF+7,1.5,1.1,8,5],
     [0,-HALF-9,1.2,10,6],[-HALF-5,HALF+4,1.0,6,5],
     [HALF+6,HALF+5,1.3,8,6],[-2,-HALF-7,0.7,5,5],
     [-HALF-11,-HALF-4,2.0,14,7],[HALF+9,HALF+7,1.6,11,6],
    ].forEach(([x,z,r,h,s]) => {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(r,h,s),spireMt.clone());
      sp.position.set(x,h/2-2.0,z); sp.rotation.y=Math.random()*Math.PI; add(sp);
      if (Math.random()>0.5) {
        const lp = new THREE.Mesh(new THREE.CircleGeometry(r*0.7,6),
          new THREE.MeshBasicMaterial({color:0xff2200,transparent:true,opacity:0.45,depthWrite:false}));
        lp.rotation.x=-Math.PI/2; lp.position.set(x,-1.9,z); add(lp);
      }
    });

    // ── 종유석 20개 (castShadow 없음) ──
    const stalMt = new THREE.MeshStandardMaterial({color:0x0c0000,roughness:0.97});
    for (let i = 0; i < 20; i++) {
      const ang = (i/20)*Math.PI*2+Math.random()*0.4;
      const dist = 8+Math.random()*10;
      const h = 0.9+Math.random()*3.2, r = 0.065+Math.random()*0.20;
      const stal = new THREE.Mesh(new THREE.ConeGeometry(r,h,6),stalMt.clone());
      stal.rotation.z = Math.PI;
      stal.position.set(Math.cos(ang)*dist, 8+Math.random()*4, Math.sin(ang)*dist);
      add(stal);
      if (Math.random()>0.6) {
        const drip = new THREE.Mesh(new THREE.SphereGeometry(r*0.5,4,4),
          new THREE.MeshBasicMaterial({color:0xff1100,transparent:true,opacity:0.70}));
        drip.position.set(stal.position.x, stal.position.y-h*0.5, stal.position.z);
        add(drip);
      }
    }

    // ── 매달린 체인 6줄 ──
    for (let i = 0; i < 6; i++) {
      const ang = (i/6)*Math.PI*2+0.3;
      const dist = 6+Math.random()*6;
      const cx = Math.cos(ang)*dist, cz = Math.sin(ang)*dist;
      const topY = 7.5+Math.random()*2.5, botY = 1.5+Math.random()*2.5;
      const nLinks = Math.floor((topY-botY)/0.5);
      for (let l = 0; l < nLinks; l++) {
        const lnk = new THREE.Mesh(new THREE.TorusGeometry(0.044,0.019,4,6),chainMat.clone());
        lnk.position.set(cx, topY-l*0.5, cz);
        lnk.rotation.z = l%2===0?0:Math.PI/2;
        add(lnk);
      }
      const ember = new THREE.Mesh(new THREE.SphereGeometry(0.045,4,4),
        new THREE.MeshBasicMaterial({color:0xff4400,transparent:true,opacity:0.85}));
      ember.position.set(cx,botY,cz); add(ember);
    }

    // ── 용암 바위 20개 (castShadow 없음) ──
    const rockMtL = new THREE.MeshStandardMaterial({color:0x110000,roughness:0.98});
    for (let i = 0; i < 20; i++) {
      const ang = Math.random()*Math.PI*2;
      const dist = HALF+2.0+Math.random()*7;
      const s = 0.25+Math.random()*1.0;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s,0),rockMtL.clone());
      rock.position.set(Math.cos(ang)*dist,-1.2+Math.random()*0.8,Math.sin(ang)*dist);
      rock.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,Math.random()*Math.PI);
      add(rock);
    }

    // 분위기 보조 조명
    [[-5,2.5,-4],[5,3,3],[-3,2,5],[4,2.5,-5]].forEach(([lx,ly,lz]) => {
      const il = new THREE.PointLight(0xff2200,1.0,7); il.position.set(lx,ly,lz); add(il);
    });

    // ── 파이어 파티클 (Points 단일 오브젝트 — 드로콜 1회) ──
    if (this._firePoints) { this.scene.remove(this._firePoints); this._firePoints.geometry.dispose(); }
    const fireSources = [
      ...TPOS.map(([x,z])=>[x,4.32,z]),
      [-HALF+1.5,0.1,-HALF+1.5],[HALF-1.5,0.1,-HALF+1.5],
      [-HALF+1.5,0.1, HALF-1.5],[HALF-1.5,0.1, HALF-1.5],
    ];
    const FIRE_N = 75, EMBER_N = 25, PT_N = FIRE_N + EMBER_N;
    const ptPos = new Float32Array(PT_N * 3);
    const ptCol = new Float32Array(PT_N * 3);
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPos, 3));
    ptGeo.setAttribute('color',    new THREE.BufferAttribute(ptCol, 3));
    const ptMat = new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.90, sizeAttenuation: true, depthWrite: false });
    this._firePoints = new THREE.Points(ptGeo, ptMat);
    this.scene.add(this._firePoints);
    this._particleType = 'fire';
    this._fireParticleData = Array.from({length: PT_N}, (_, i) => {
      const isEmber = i >= FIRE_N;
      const src = fireSources[Math.floor(Math.random()*fireSources.length)];
      return {
        sx:src[0], sy:src[1], sz:src[2],
        x:src[0], y:src[1], z:src[2],
        vx:(Math.random()-0.5)*(isEmber?0.022:0.042),
        vy:isEmber ? 0.045+Math.random()*0.075 : 0.025+Math.random()*0.050,
        vz:(Math.random()-0.5)*(isEmber?0.022:0.042),
        life:Math.random(), maxLife:isEmber ? 0.9+Math.random()*1.3 : 0.4+Math.random()*0.9,
        isEmber
      };
    });
  }

  _buildSceneIce(cfg, add) {
    // ── 재질 팔레트 (빙하) ──
    const iceFloor  = new THREE.MeshStandardMaterial({ color: 0x1a3348, roughness: 0.20, metalness: 0.35 });
    const iceDark   = new THREE.MeshStandardMaterial({ color: 0x0d1e2e, roughness: 0.25, metalness: 0.25 });
    const crystalM  = new THREE.MeshStandardMaterial({ color: 0x4499cc, roughness: 0.08, metalness: 0.55, transparent: true, opacity: 0.82 });
    const crystalLt = new THREE.MeshStandardMaterial({ color: 0x88ddff, roughness: 0.05, metalness: 0.70, transparent: true, opacity: 0.70 });
    const rimMat    = new THREE.MeshBasicMaterial({ color: cfg.edgeColor });
    const snowMat   = new THREE.MeshBasicMaterial({ color: 0xddeeff, transparent: true, opacity: 0.85 });

    // ── 메인 플랫폼 ──
    this._platformMesh = new THREE.Mesh(new THREE.BoxGeometry(PW, 0.6, PW), iceFloor);
    this._platformMesh.receiveShadow = true;
    this._platformMesh.position.y = -0.3;
    this.scene.add(this._platformMesh);

    // 얼음 균열 패턴
    const crackM  = new THREE.MeshBasicMaterial({ color: 0x44aacc, transparent: true, opacity: 0.55, depthWrite: false });
    const crackGl = new THREE.MeshBasicMaterial({ color: 0x22bbff, transparent: true, opacity: 0.18, depthWrite: false });
    [0, 90].forEach(deg => {
      const cr = new THREE.Mesh(new THREE.BoxGeometry(PW*0.90, 0.015, 0.06), crackM.clone());
      cr.position.set(0, 0.012, 0); cr.rotation.y = deg * Math.PI / 180; add(cr);
      const cg = new THREE.Mesh(new THREE.BoxGeometry(PW*0.90, 0.008, 0.20), crackGl.clone());
      cg.position.set(0, 0.005, 0); cg.rotation.y = deg * Math.PI / 180; add(cg);
    });
    [30, -30, 60, -60].forEach((deg, i) => {
      const cr = new THREE.Mesh(new THREE.BoxGeometry(PW*0.60, 0.013, 0.045), crackM.clone());
      cr.position.set((i % 2 === 0 ? 1.2 : -1.2), 0.012, (i < 2 ? 0.6 : -0.6));
      cr.rotation.y = deg * Math.PI / 180; add(cr);
    });
    for (let i = 0; i < 14; i++) {
      const sc = new THREE.Mesh(new THREE.BoxGeometry(0.5 + Math.random()*2.0, 0.012, 0.032), crackM.clone());
      sc.position.set((Math.random()-0.5)*(PW-1.5), 0.010, (Math.random()-0.5)*(PW-1.5));
      sc.rotation.y = Math.random() * Math.PI; add(sc);
    }
    // 균열 빛 조명
    [[-3,0],[3,0],[0,-3],[0,3]].forEach(([x,z]) => {
      const cl = new THREE.PointLight(0x22aadd, 0.5, 3.0); cl.position.set(x, 0.08, z); add(cl);
    });

    // 얼음 동심원 문양
    [4.5, 3.0, 1.8].forEach((r, ri) => {
      const rt = new THREE.Mesh(new THREE.TorusGeometry(r, 0.030, 6, 32 + ri*8),
        new THREE.MeshBasicMaterial({ color: ri===0?0x115577:ri===1?0x1166aa:0x2288bb, transparent: true, opacity: 0.60 }));
      rt.rotation.x = Math.PI/2; rt.position.y = 0.011; add(rt);
    });
    for (let i = 0; i < 8; i++) {
      const ang = (i/8)*Math.PI*2;
      const rl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.010, 1.3),
        new THREE.MeshBasicMaterial({ color: 0x1177aa, transparent: true, opacity: 0.45 }));
      rl.position.set(Math.cos(ang)*2.7, 0.010, Math.sin(ang)*2.7);
      rl.rotation.y = ang; add(rl);
    }

    // 계단식 받침대
    [[PW+2.4,0.55,-0.88],[PW+4.2,0.45,-1.43],[PW+6.0,0.40,-1.90]].forEach(([w,h,y]) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w,h,w), iceDark.clone());
      b.receiveShadow = true; b.position.y = y; add(b);
    });

    // 테두리 발광 띠
    [[0,-HALF,PW+0.1,0.12,0.12],[0,HALF,PW+0.1,0.12,0.12]].forEach(([x,z,w,h,d]) => {
      const rm = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), rimMat.clone()); rm.position.set(x,0.01,z); add(rm);
    });
    [[HALF,0,0.12,0.12,PW-0.1],[-HALF,0,0.12,0.12,PW-0.1]].forEach(([x,z,w,h,d]) => {
      const rm = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), rimMat.clone()); rm.position.set(x,0.01,z); add(rm);
    });
    [[0,-HALF-1.2,PW+2.5,0.10,0.10],[0,HALF+1.2,PW+2.5,0.10,0.10],
     [HALF+1.2,0,0.10,0.10,PW+2.3],[-HALF-1.2,0,0.10,0.10,PW+2.3]].forEach(([x,z,w,h,d]) => {
      const rm = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshBasicMaterial({color:0x1188cc}));
      rm.position.set(x,-0.61,z); add(rm);
    });

    // 그리드
    this._gridHelper = new THREE.GridHelper(PW, 7, cfg.gridColor, cfg.gridColor);
    this._gridHelper.position.y = 0.008;
    this.scene.add(this._gridHelper);

    // ── 얼음 바닥 (빙하 아래 바다) ──
    const seaFloor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120),
      new THREE.MeshBasicMaterial({ color: 0x010d1a }));
    seaFloor.rotation.x = -Math.PI/2; seaFloor.position.y = -2.8; add(seaFloor);
    const seaGlow = new THREE.Mesh(new THREE.PlaneGeometry(PW+12, PW+12),
      new THREE.MeshBasicMaterial({ color: 0x0066aa, transparent: true, opacity: 0.07, depthWrite: false }));
    seaGlow.rotation.x = -Math.PI/2; seaGlow.position.y = -2.5; add(seaGlow);

    // ── 코너 얼음 수정 탑 ──
    const TPOS = [[-HALF-2.0,-HALF-2.0],[HALF+2.0,-HALF-2.0],[-HALF-2.0,HALF+2.0],[HALF+2.0,HALF+2.0]];
    TPOS.forEach(([tx,tz], ti) => {
      // 기단 2단
      const tb1 = new THREE.Mesh(new THREE.BoxGeometry(2.0,0.45,2.0), iceDark.clone());
      tb1.position.set(tx,0.22,tz); tb1.castShadow = true; add(tb1);
      const tb2 = new THREE.Mesh(new THREE.BoxGeometry(1.5,0.35,1.5), iceDark.clone());
      tb2.position.set(tx,0.62,tz); add(tb2);
      // 중심 기둥 (팔각)
      const tbody = new THREE.Mesh(new THREE.CylinderGeometry(0.38,0.48,2.8,8), crystalM.clone());
      tbody.position.set(tx,2.0,tz); tbody.castShadow = true; add(tbody);
      // 링 장식
      [1.0,1.7,2.5].forEach(ry => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.50,0.045,6,12),
          new THREE.MeshStandardMaterial({ color: 0x88ccee, roughness: 0.1, metalness: 0.6 }));
        ring.rotation.x = Math.PI/2; ring.position.set(tx,ry,tz); add(ring);
      });
      // 수정 첨탑 3개 (중앙+좌우)
      [[0,3.4,0,0.22,0.04,2.2],[0.3,3.1,0.3,0.14,0.03,1.5],[-0.3,3.0,-0.3,0.14,0.03,1.4]].forEach(([dx,y,dz,rb,rt,h]) => {
        const spire = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,6), crystalLt.clone());
        spire.position.set(tx+dx,y,tz+dz);
        spire.rotation.y = (ti*Math.PI/4); add(spire);
      });
      // 수정 오브 + 코로나
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.28,12,12),
        new THREE.MeshBasicMaterial({ color: 0x66ddff }));
      orb.position.set(tx,4.6,tz); add(orb);
      const corona = new THREE.Mesh(new THREE.SphereGeometry(0.46,10,10),
        new THREE.MeshBasicMaterial({ color: 0x22aaff, transparent: true, opacity: 0.12, depthWrite: false }));
      corona.position.set(tx,4.6,tz); add(corona);
      // 탑 조명
      const tl  = new THREE.PointLight(0x44ccff, 4.5, 11); tl.position.set(tx,4.5,tz); add(tl);
      const tl2 = new THREE.PointLight(0x0066aa, 1.2, 7);  tl2.position.set(tx,1.5,tz); add(tl2);
    });

    // ── 탑 간 얼음 줄기 ──
    [[0,1],[1,3],[3,2],[2,0]].forEach(([a,b]) => {
      const [ax,az]=TPOS[a],[bx,bz]=TPOS[b];
      const SEG = 8;
      for (let s = 0; s <= SEG; s++) {
        const t = s/SEG;
        const cx = ax+(bx-ax)*t, cz = az+(bz-az)*t;
        const cy = 4.45 - Math.sin(t*Math.PI)*0.55;
        const lnk = new THREE.Mesh(new THREE.TorusGeometry(0.050,0.018,4,6),
          new THREE.MeshStandardMaterial({ color: 0x55aacc, roughness: 0.12, metalness: 0.55 }));
        lnk.position.set(cx,cy,cz);
        lnk.rotation.y = Math.atan2(bx-ax,bz-az);
        lnk.rotation.z = s%2===0?0:Math.PI/2; add(lnk);
      }
    });

    // 코너 조명
    TPOS.forEach(([x,z]) => {
      const pl = new THREE.PointLight(0x33aadd, 1.0, 10); pl.position.set(x,0.5,z); add(pl);
    });
    const cenL = new THREE.PointLight(0x2299cc, 2.0, 14); cenL.position.set(0,-1.2,0); add(cenL);

    // ── 배경 빙산 ──
    const bergMt = new THREE.MeshStandardMaterial({ color: 0x1e4060, roughness: 0.35, metalness: 0.20 });
    [[-HALF-7,-HALF-7,1.6,8],[ HALF+6,-HALF-6,1.1,6],
     [-HALF-9,1,2.0,11],     [ HALF+7,2,1.3,8],
     [0,-HALF-9,1.4,9],      [-HALF-5,HALF+5,1.1,6],
     [ HALF+6,HALF+5,1.5,8], [-2,-HALF-7,0.8,5],
     [-HALF-11,-HALF-4,2.2,13],[HALF+9,HALF+7,1.7,10],
    ].forEach(([x,z,r,h]) => {
      const berg = new THREE.Mesh(new THREE.ConeGeometry(r,h,7), bergMt.clone());
      berg.position.set(x,h/2-2.2,z); berg.rotation.y = Math.random()*Math.PI; add(berg);
      // 빙산 발광 테두리
      const glow = new THREE.Mesh(new THREE.CircleGeometry(r*0.6,6),
        new THREE.MeshBasicMaterial({ color: 0x1155aa, transparent: true, opacity: 0.35, depthWrite: false }));
      glow.rotation.x = -Math.PI/2; glow.position.set(x,-2.0,z); add(glow);
    });

    // ── 고드름 (천장에서 내려오는) ──
    for (let i = 0; i < 22; i++) {
      const ang = (i/22)*Math.PI*2 + Math.random()*0.5;
      const dist = 8 + Math.random()*9;
      const h = 0.8 + Math.random()*3.0, r = 0.06 + Math.random()*0.18;
      const icicle = new THREE.Mesh(new THREE.ConeGeometry(r,h,6),
        new THREE.MeshStandardMaterial({ color: 0x4488bb, roughness: 0.08, metalness: 0.55, transparent: true, opacity: 0.80 }));
      icicle.rotation.z = Math.PI; // 아래로 뾰족
      icicle.position.set(Math.cos(ang)*dist, 9+Math.random()*3, Math.sin(ang)*dist);
      add(icicle);
      if (Math.random() > 0.5) {
        const drop = new THREE.Mesh(new THREE.SphereGeometry(r*0.45,4,4),
          new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.65 }));
        drop.position.set(icicle.position.x, icicle.position.y-h*0.48, icicle.position.z); add(drop);
      }
    }

    // ── 분위기 보조 조명 ──
    [[-5,2.5,-4],[5,3,3],[-3,2,5],[4,2.5,-5]].forEach(([lx,ly,lz]) => {
      const il = new THREE.PointLight(0x2288bb, 0.8, 7); il.position.set(lx,ly,lz); add(il);
    });

    // ── 눈 파티클 (Points — 드로콜 1회) ──
    if (this._firePoints) { this.scene.remove(this._firePoints); this._firePoints.geometry.dispose(); }
    const SNOW_N = 140;
    const snPos = new Float32Array(SNOW_N * 3);
    const snCol = new Float32Array(SNOW_N * 3);
    const snGeo = new THREE.BufferGeometry();
    snGeo.setAttribute('position', new THREE.BufferAttribute(snPos, 3));
    snGeo.setAttribute('color',    new THREE.BufferAttribute(snCol, 3));
    const snMat = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.85, sizeAttenuation: true, depthWrite: false });
    this._firePoints = new THREE.Points(snGeo, snMat);
    this.scene.add(this._firePoints);
    this._particleType = 'snow';
    this._fireParticleData = Array.from({ length: SNOW_N }, () => ({
      x: (Math.random()-0.5)*28, y: 2+Math.random()*10, z: (Math.random()-0.5)*28,
      vx: (Math.random()-0.5)*0.012, vy: -(0.018+Math.random()*0.025), vz: (Math.random()-0.5)*0.012,
      life: Math.random(), maxLife: 3.0+Math.random()*4.0,
      bright: 0.75+Math.random()*0.25,
    }));
  }

  _buildStars() {
    const N = 300;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i*3]   = (Math.random() - 0.5) * 80;
      pos[i*3+1] = Math.random() * 30 + 5;
      pos[i*3+2] = (Math.random() - 0.5) * 80;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xff4400, size: 0.10, transparent: true, opacity: 0.55 });
    this._starPoints = new THREE.Points(geo, mat);
    this.scene.add(this._starPoints);
  }

  // ── INPUT ───────────────────────────────────────────────
  _setupInput() {
    document.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'Space' || e.code === 'ControlLeft' || e.code === 'ControlRight') e.preventDefault();
      if (e.code === 'Escape') {
        if (this.state === 'playing') this.pauseGame();
        else if (this.state === 'paused') this.resumeGame();
      }
    });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });
  }

  // ── START GAME ─────────────────────────────────────────
  startGame(mapId, mode) {
    this.mapId = mapId;
    this.mode  = mode;
    this._buildScene(mapId);

    // Clean up old players/barriers/opponent
    this.players.forEach(p => p.dispose());
    this.players = [];
    this.barriers.forEach(b => { if (!b.done) this.scene.remove(b.group); });
    this.barriers = [];
    this._floorWarnings.forEach(w => this.scene.remove(w));
    this._floorWarnings = [];
    if (this.oppPlayer) { this.oppPlayer.dispose(); this.oppPlayer = null; }
    this._removeNameLabels();
    this.oppPos = null;

    this.state     = 'playing';
    this.startTime = Date.now();
    this.elapsed   = 0;
    this.diff      = 0;
    this.frame     = 0;
    this.spawnCd   = 180;
    this.flashAlpha = 0;
    this.oppPos    = null;

    const cfgHalf = (MAP_CFGS[mapId] || MAP_CFGS.square).halfMap;

    // 공통 컨트롤: 방향키 이동, Ctrl 점프
    const CTRL = { left:'ArrowLeft', right:'ArrowRight', fwd:'ArrowUp', back:'ArrowDown', jump:'ControlLeft' };

    if (mode === 'solo') {
      this.players = [
        new Player3D(this.scene, 0, 0, 0x00ffff, 0x0099ff, CTRL)
      ];
    } else if (mode === 'online1v1') {
      const sx    = this.myNum === 1 ? -2 : 2;
      const oppSx = this.myNum === 1 ?  2 : -2;
      this.players = [
        new Player3D(this.scene, sx, 0, 0x00ffff, 0x0099ff, CTRL)
      ];
      this.oppPlayer = new Player3D(this.scene, oppSx, 0, 0xff4400, 0xff6600,
        { left:'', right:'', fwd:'', back:'', jump:'' });
      this.oppPlayer.charGroup.visible = false;
      this._createNameLabels();
    }

    showScreen('gameScreen');
  }

  // ── GAME LOOP ──────────────────────────────────────────
  _tick() {
    this.frame++;
    if (this.state === 'playing' || this.state === 'dying') {
      this._update();
    }
    // Always update player particles even after death
    this.players.forEach(p => {
      if (!p.alive) {
        if (p._deathParticles) {
          p._deathParticles.update();
          if (p._deathParticles.isDone()) { p._deathParticles.dispose(); p._deathParticles = null; }
        }
      }
    });
  }

  _update() {
    if (this.state !== 'playing') return;

    this.elapsed = (Date.now() - this.startTime) / 1000;
    this.diff    = Math.floor(this.elapsed / 10);

    const cfg = MAP_CFGS[this.mapId] || MAP_CFGS.square;
    const halfMap = cfg.halfMap;

    // Update players
    this.players.forEach(p => p.update(this.keys, halfMap));

    // Online: send position & update opponent visual
    if (this.mode === 'online1v1') {
      if (this.socket && this.frame % 3 === 0) {
        const me = this.players[0];
        if (me.alive) this.socket.emit('playerUpdate',
          { roomId: this.roomId, x: me.px, y: me.py, z: me.pz });
      }
      if (this.oppPlayer && this.oppPos) {
        if (!this.oppPlayer.charGroup.visible) this.oppPlayer.charGroup.visible = true;
        this.oppPlayer.updateRemote(this.oppPos.x, this.oppPos.y, this.oppPos.z);
      }
    }

    // Spawn barriers
    if (--this.spawnCd <= 0) {
      this._spawnBarrier();
    }

    // Update barriers
    this.barriers.forEach(b => { if (!b.done) b.update(); });
    this.barriers = this.barriers.filter(b => !b.done);

    // Collision
    this.players.forEach(p => {
      if (!p.alive) return;
      for (const b of this.barriers) {
        if (b.collides(p.px, p.py, p.pz, PR)) {
          this._onPlayerDied(p);
          break;
        }
      }
    });

    // 별(잔불) 느린 회전
    if (this._starPoints) this._starPoints.rotation.y += 0.0003;

    // 파티클 업데이트 (Points — 드로콜 1회)
    if (this._firePoints && this._fireParticleData) {
      const pos = this._firePoints.geometry.attributes.position.array;
      const col = this._firePoints.geometry.attributes.color.array;
      if (this._particleType === 'snow') {
        this._fireParticleData.forEach((d, i) => {
          d.x += d.vx + Math.sin(this.frame*0.018+i)*0.003;
          d.y += d.vy;
          d.z += d.vz + Math.cos(this.frame*0.014+i)*0.003;
          d.life += 0.016;
          if (d.y < -0.5 || d.life >= d.maxLife) {
            d.x = (Math.random()-0.5)*28; d.y = 9+Math.random()*3; d.z = (Math.random()-0.5)*28;
            d.life = 0;
          }
          pos[i*3]=d.x; pos[i*3+1]=d.y; pos[i*3+2]=d.z;
          const b = d.bright; col[i*3]=b; col[i*3+1]=b; col[i*3+2]=1.0;
        });
      } else {
        this._fireParticleData.forEach((d, i) => {
          d.life += 0.022;
          if (d.life >= d.maxLife) {
            d.life = 0;
            d.x = d.sx + (Math.random()-0.5)*0.3;
            d.y = d.sy;
            d.z = d.sz + (Math.random()-0.5)*0.3;
          }
          d.x += d.vx; d.y += d.vy; d.z += d.vz;
          pos[i*3] = d.x; pos[i*3+1] = d.y; pos[i*3+2] = d.z;
          const t = d.life / d.maxLife;
          const a = Math.sin(t * Math.PI);
          let r, g;
          if (d.isEmber) { r=1.0; g=t<0.5?0.93:t<0.8?0.67:0.33; }
          else           { r=1.0; g=t<0.4?0.67:t<0.7?0.27:0.07; }
          col[i*3]=r*a; col[i*3+1]=g*a; col[i*3+2]=0;
        });
      }
      this._firePoints.geometry.attributes.position.needsUpdate = true;
      this._firePoints.geometry.attributes.color.needsUpdate = true;
    }

    // Game over checks
    if (this.mode === 'solo') {
      if (!this.players[0].alive) this._endGame(1500);
    }
  }

  _spawnBarrier() {
    const speed = Math.min(0.28, 0.065 + this.diff * 0.020);

    // 스폰 간격 갱신
    this.spawnCd = Math.max(18, 155 - this.diff * 14) + Math.floor(Math.random() * 14);

    const allDirs = [0, 1, 2, 3];

    // 동시 배리어 수 결정
    let count = 1;
    const r = Math.random();
    if      (this.diff >= 12) count = r < 0.45 ? 9 : r < 0.75 ? 7 : r < 0.90 ? 5 : 3;
    else if (this.diff >= 10) count = r < 0.40 ? 7 : r < 0.70 ? 5 : r < 0.88 ? 4 : 3;
    else if (this.diff >= 8)  count = r < 0.35 ? 5 : r < 0.65 ? 4 : r < 0.85 ? 3 : 2;
    else if (this.diff >= 6)  count = r < 0.30 ? 4 : r < 0.65 ? 3 : r < 0.85 ? 2 : 1;
    else if (this.diff >= 4)  count = r < 0.20 ? 3 : r < 0.65 ? 2 : 1;
    else if (this.diff >= 2)  count = r < 0.15 ? 3 : r < 0.55 ? 2 : 1;
    else if (this.diff >= 1)  count = r < 0.38 ? 2 : 1;

    // 방향별 몇 번째인지 추적 → posOffset으로 간격 부여
    const dirCount = {};
    for (let i = 0; i < count; i++) {
      const dir = allDirs[Math.floor(Math.random() * allDirs.length)];
      dirCount[dir] = (dirCount[dir] || 0) + 1;

      // 같은 방향이 여러 개면 3.5유닛 간격으로 뒤에 배치
      const posOffset = (dirCount[dir] - 1) * 3.5;

      let coverage = 'full';
      if (this.diff >= 1 && Math.random() < Math.min(0.65, 0.18 + this.diff * 0.07)) {
        coverage = Math.random() < 0.5 ? 'half-left' : 'half-right';
      }

      this.barriers.push(new ElectricBarrier(this.scene, dir, speed, coverage, posOffset));
    }
  }

  _onPlayerDied(player) {
    player.die();
    this.flashAlpha = 1.0;
    if (this.mode === 'online1v1' && this.socket) {
      this.socket.emit('playerDied', { roomId: this.roomId });
    }
  }

  _endGame(delay = 1500) {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    this._removeNameLabels();
    if (this.oppPlayer) { this.oppPlayer.dispose(); this.oppPlayer = null; }
    const t = this.elapsed;
    setTimeout(() => {
      showGameOver(t, this.mode, this.players, this.mapId, this);
    }, delay);
  }

  // ── RENDER ─────────────────────────────────────────────
  _render() {
    this.renderer.render(this.scene, this.camera);

    // Flash overlay via canvas 2D context
    if (this.flashAlpha > 0.005) {
      const ctx = this._overlayCtx;
      if (ctx) {
        ctx.clearRect(0, 0, this.W, this.H);
        ctx.fillStyle = `rgba(255,255,255,${this.flashAlpha.toFixed(3)})`;
        ctx.fillRect(0, 0, this.W, this.H);
      }
      this.flashAlpha = Math.max(0, this.flashAlpha - 0.05);
    } else {
      this._overlayCtx?.clearRect(0, 0, this.W, this.H);
    }

    // HUD timer update
    this._updateHUD();

    // Name label 2D projection
    if (this.mode === 'online1v1') this._updateNameLabels();
  }

  _updateHUD() {
    const el = document.getElementById('timerDisplay');
    if (el && this.state === 'playing') el.textContent = fmtT(this.elapsed);
    const lbl = document.getElementById('hudLabels');
    if (lbl) lbl.innerHTML = '';
  }

  pauseGame() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this._pausedAt = Date.now();
    document.getElementById('pauseTime').textContent = fmtT(this.elapsed);
    document.getElementById('pauseOverlay').classList.add('active');
  }

  resumeGame() {
    if (this.state !== 'paused') return;
    this.startTime += Date.now() - this._pausedAt;
    this.state = 'playing';
    document.getElementById('pauseOverlay').classList.remove('active');
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this._tick();
    this._render();
  }

  // ── OVERLAY CANVAS (for flash) ─────────────────────────
  setOverlayCanvas(canvas) {
    this._overlayCtx = canvas.getContext('2d');
  }

  // ── NAME LABELS ────────────────────────────────────────
  _createNameLabels() {
    this._removeNameLabels();
    const gs = document.getElementById('gameScreen');
    const make = (text, cls) => {
      const el = document.createElement('div');
      el.className = `name-label ${cls}`;
      el.textContent = text;
      gs.appendChild(el);
      return el;
    };
    this._myLabel  = make('나', 'label-me');
    this._oppLabel = make('상대방', 'label-opp');
  }

  _removeNameLabels() {
    this._myLabel?.remove();  this._myLabel  = null;
    this._oppLabel?.remove(); this._oppLabel = null;
  }

  _updateNameLabels() {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const project = (px, py, pz) => {
      const v = new THREE.Vector3(px, py + 1.6, pz);
      v.project(this.camera);
      return {
        x: rect.left + ( v.x * 0.5 + 0.5) * rect.width,
        y: rect.top  + (-v.y * 0.5 + 0.5) * rect.height,
        behind: v.z > 1,
      };
    };
    const me = this.players[0];
    if (this._myLabel && me) {
      const p = project(me.px, me.py, me.pz);
      this._myLabel.style.display = p.behind ? 'none' : 'block';
      this._myLabel.style.left = `${p.x}px`;
      this._myLabel.style.top  = `${p.y}px`;
    }
    if (this._oppLabel && this.oppPlayer) {
      const p = project(this.oppPlayer.px, this.oppPlayer.py, this.oppPlayer.pz);
      this._oppLabel.style.display = p.behind ? 'none' : 'block';
      this._oppLabel.style.left = `${p.x}px`;
      this._oppLabel.style.top  = `${p.y}px`;
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}

function showGameOver(time, mode, players, mapId, game) {
  showScreen('gameOverScreen');

  document.getElementById('finalTime').textContent = fmtT(time);
  document.getElementById('rankBlock').classList.add('hidden');
  document.getElementById('miniRank').innerHTML = '';

  const title = document.getElementById('goTitle');
  const sub   = document.getElementById('goSub');
  const nb    = document.getElementById('nameBlock');

  if (mode === 'online1v1') {
    const won = players[0]?.alive;
    title.textContent = won ? '승리! 🎉' : '패배';
    sub.textContent   = won ? '상대가 먼저 탈락했습니다' : '전기에 닿았습니다';
    nb.style.display  = 'none';
  } else {
    title.textContent = '게임 오버';
    sub.textContent   = '전기에 닿았습니다';
    nb.style.display  = 'flex';
  }

  if (game.socket) {
    game.socket.emit('getLeaderboard', { mapId }, data => {
      renderMiniRank(data, null);
    });
  }
}

function renderMiniRank(data, hlRank) {
  const el = document.getElementById('miniRank');
  if (!data || !data.length) { el.innerHTML = ''; return; }
  const medals = ['🥇','🥈','🥉'];
  el.innerHTML = data.slice(0,10).map((e,i) => `
    <div class="mr-row${i+1===hlRank?' hl':''}">
      <span class="mr-rank ${i<3?['g','s','b'][i]:''}">${medals[i]||i+1}</span>
      <span class="mr-name">${e.name}</span>
      <span class="mr-time">${fmtT(e.time)}</span>
    </div>`).join('');
}

function loadLB(mapId, socket) {
  const el = document.getElementById('lbList');
  el.innerHTML = '<li class="no-data">불러오는 중...</li>';
  if (!socket?.connected) { el.innerHTML = '<li class="no-data">서버 연결 없음</li>'; return; }
  socket.emit('getLeaderboard', { mapId }, data => {
    if (!data?.length) { el.innerHTML = '<li class="no-data">기록 없음</li>'; return; }
    const medals = ['🥇','🥈','🥉'];
    el.innerHTML = data.map((e,i) => `
      <li>
        <span class="r">${medals[i]||i+1}</span>
        <span class="n">${e.name}</span>
        <span class="t">${fmtT(e.time)}</span>
      </li>`).join('');
  });
}

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
let G;

window.addEventListener('DOMContentLoaded', () => {
  // Canvas setup: Three.js renders to #gameCanvas
  const canvas = document.getElementById('gameCanvas');
  canvas.width  = 800;
  canvas.height = 600;

  // Overlay canvas for flash effects
  const overlay = document.createElement('canvas');
  overlay.width  = 800;
  overlay.height = 600;
  overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
  document.getElementById('gameScreen').appendChild(overlay);

  G = new Game3D(canvas);
  G.setOverlayCanvas(overlay);

  // Socket.io
  if (typeof io !== 'undefined') {
    try {
      G.socket = io({ reconnectionAttempts: 3 });

      G.socket.on('matchFound', ({ roomId, playerNum, seed, mapId }) => {
        G.roomId = roomId;
        G.myNum  = playerNum;
        G.startGame(G.mapId, 'online1v1');
      });
      G.socket.on('waitingForOpponent', () => {
        document.getElementById('mmStatus').textContent = '상대를 기다리는 중...';
      });
      G.socket.on('opponentUpdate', ({ x, y, z }) => { G.oppPos = { x, y, z }; });
      G.socket.on('opponentDied', () => {
        if (G.state === 'playing') {
          G.state = 'dying';
          setTimeout(() => G._endGame(200), 600);
        }
      });
    } catch (e) { console.warn('Socket.io connection failed:', e); }
  }

  // Map selection
  document.querySelectorAll('.map-card').forEach(c => {
    c.addEventListener('click', () => {
      document.querySelectorAll('.map-card').forEach(x => x.classList.remove('selected'));
      c.classList.add('selected');
      G.mapId = c.dataset.map;
    });
  });

  // Mode buttons
  document.getElementById('soloBtn').addEventListener('click', () =>
    G.startGame(G.mapId, 'solo'));

  document.getElementById('online1v1Btn').addEventListener('click', () => {
    if (!G.socket?.connected) { alert('서버 연결 필요. 로컬 모드를 이용해 주세요.'); return; }
    showScreen('mmScreen');
    document.getElementById('mmStatus').textContent = '상대방을 찾는 중...';
    G.socket.emit('findMatch', { mapId: G.mapId });
  });

  document.getElementById('mmCancelBtn').addEventListener('click', () => {
    G.socket?.emit('cancelMatch', { mapId: G.mapId });
    showScreen('menuScreen');
  });

  document.getElementById('escBtn').addEventListener('click', () => {
    if (G.state === 'playing') G.pauseGame();
    else if (G.state === 'paused') G.resumeGame();
  });

  document.getElementById('resumeBtn').addEventListener('click', () => G.resumeGame());

  document.getElementById('pauseMenuBtn').addEventListener('click', () => {
    G.state = 'menu';
    document.getElementById('pauseOverlay').classList.remove('active');
    showScreen('menuScreen');
  });

  document.getElementById('replayBtn').addEventListener('click', () =>
    G.startGame(G.mapId, G.mode === 'online1v1' ? 'solo' : G.mode));

  document.getElementById('menuBtn').addEventListener('click', () => {
    G.state = 'menu';
    showScreen('menuScreen');
  });

  document.getElementById('leaderboardBtn').addEventListener('click', () => {
    showScreen('lbScreen');
    loadLB('square', G.socket);
  });

  document.getElementById('lbBackBtn').addEventListener('click', () =>
    showScreen('menuScreen'));

  // Leaderboard tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      loadLB(t.dataset.id, G.socket);
    });
  });

  // Submit score
  document.getElementById('submitBtn').addEventListener('click', () => {
    if (!G.socket?.connected) return;
    const name = document.getElementById('nameInput').value.trim() || 'Player';
    G.socket.emit('submitScore', { name, time: G.elapsed, mapId: G.mapId }, res => {
      if (res) {
        document.getElementById('rankBlock').classList.remove('hidden');
        document.getElementById('rankText').textContent = `🏆 ${res.rank}위 달성!`;
        renderMiniRank(res.leaderboard, res.rank);
        document.getElementById('nameBlock').style.display = 'none';
      }
    });
  });

  document.getElementById('nameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('submitBtn').click();
  });

  showScreen('menuScreen');
});
