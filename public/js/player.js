import * as THREE from 'three';
import { ARENA_RADIUS, PLAYER } from './config.js';
import { PlayerBody } from './shared/player-physics.js';
import { buildFallbackAvatar, loadModelAvatar } from './avatar.js';
import { makeLabelTexture } from './textures.js';

const TWO_PI = Math.PI * 2;
const FLIP_TIME = 0.42;   // 2단 점프 한 바퀴에 걸리는 시간(초)

// 각도를 최단 경로로 보간한다. 그냥 lerp 하면 -π ↔ π 를 넘을 때 한 바퀴 돈다.
function angleLerp(from, to, t) {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return from + d * t;
}

const smoothstep = (t) => t * t * (3 - 2 * t);

// 캐릭터를 갈아 끼울 때 옛 것을 정리한다. 안 하면 바꿀 때마다
// 지오메트리와 텍스처가 GPU 에 쌓인다.
function disposeTree(root) {
  root.traverse((o) => {
    // InstancedMesh 는 인스턴스 행렬 버퍼를 따로 들고 있다
    if (o.isInstancedMesh) o.dispose();
    o.geometry?.dispose();
    for (const mat of [o.material].flat().filter(Boolean)) {
      mat.map?.dispose();
      mat.dispose();
    }
  });
}

// 평면 360° 이동 + 2단 점프 컨트롤러.
// 카메라가 +Z 쪽에서 원점을 보고 있으므로 화면 위쪽 = -Z 이다.
export class Player {
  // options.bodyColor / options.haloColor — 1v1 에서 상대와 구분하는 데 쓴다.
  constructor(scene, options = {}) {
    const haloColor = options.haloColor ?? 0x4fd6ff;
    // 움직임 규칙은 shared/player-physics.js 가 갖고 있다.
    // 서버도 같은 코드를 돌려야 1v1 에서 두 화면이 어긋나지 않는다.
    this.body = new PlayerBody();
    this.alive = true;

    // 위치와 바라보는 방향만 담당하는 바깥 그룹
    this.mesh = new THREE.Group();
    // 기울기·회전·찌그러짐 같은 연출은 안쪽 리그에서만 한다.
    // 둘을 한 오브젝트에서 섞으면 서로 값을 덮어써서 모션이 튄다.
    //
    // 리그 원점을 몸 한가운데(발바닥에서 height/2)에 둔다. 발바닥을 축으로
    // 돌리면 몸이 반지름 height 짜리 원을 그리며 휘둘려서 공중제비가 아니라
    // 발작처럼 보인다. 아바타 부품들은 이 원점 기준으로 조립한다.
    this.rig = new THREE.Group();
    this.rig.position.y = PLAYER.height / 2;
    this.mesh.add(this.rig);

    // 겉모습은 리그 안에 갈아 끼운다. 물리·판정은 겉모습과 무관하다.
    this.skin = buildFallbackAvatar(options);
    this.rig.add(this.skin);
    this.mixer = null;
    this.animTime = 0;
    this.characterId = options.characterId ?? null;

    // .glb 가 지정돼 있으면 불러와서 교체한다. 불러오는 동안에도
    // 기본 캐릭터로 게임을 할 수 있고, 실패하면 그대로 남는다.
    loadModelAvatar().then((loaded) => {
      if (!loaded) return;
      this.rig.remove(this.skin);
      this.skin = loaded.root;
      this.rig.add(this.skin);
      this.mixer = loaded.mixer;
    });
    scene.add(this.mesh);

    this.lean = 0;
    this.flipT = -1;      // -1 = 회전 중 아님
    this.stretch = 0;     // + 는 늘어남(점프), - 는 눌림(착지)

    // 소리를 붙일 수 있게 사건만 알려 준다. 물리는 소리를 몰라도 된다.
    this.onJump = null;   // (isDouble) => {}
    this.onLand = null;

    // 착지 지점을 알려 주는 바닥 그림자
    this.blob = new THREE.Mesh(
      new THREE.CircleGeometry(PLAYER.radius * 1.5, 24),
      // 잔디 위에서 새까만 원은 구멍처럼 보인다. 갈색 기가 도는 옅은 그늘로.
      new THREE.MeshBasicMaterial({ color: 0x241c10, transparent: true, opacity: 0.3, depthWrite: false })
    );
    this.blob.rotation.x = -Math.PI / 2;
    scene.add(this.blob);

    // 어두운 무대에서 내 위치를 놓치지 않도록 발밑에 밝은 링을 하나 더 둔다
    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(PLAYER.radius * 1.5, PLAYER.radius * 1.8, 28),
      new THREE.MeshBasicMaterial({
        color: haloColor, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    this.halo.rotation.x = -Math.PI / 2;
    scene.add(this.halo);

    // 점프할 때 발밑에 퍼지는 고리
    this.puff = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.72, 24),
      new THREE.MeshBasicMaterial({
        color: 0x9fe8ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    this.puff.rotation.x = -Math.PI / 2;
    this.puff.visible = false;
    scene.add(this.puff);
    this.puffT = -1;

    this.label = null;
  }

  // 캐릭터를 갈아 끼운다. 물리 상태는 그대로 두고 겉모습만 바꾼다.
  setCharacter(characterId) {
    if (characterId === this.characterId) return;
    this.characterId = characterId;

    this.rig.remove(this.skin);
    disposeTree(this.skin);
    this.skin = buildFallbackAvatar({ characterId });
    this.rig.add(this.skin);
  }

  // 머리 위 이름표. 1v1 에서 누가 나인지 구분하려고 쓴다.
  // 스프라이트라 항상 카메라를 마주 보고, mesh 에 달아서 몸이 도는
  // 것과 무관하다. depthTest 를 끄는 이유는 전기선이 앞을 지나가도
  // 가려지면 안 되기 때문이다.
  setLabel(text, color) {
    this.clearLabel();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeLabelTexture(text, color),
      transparent: true,
      depthTest: false,
      fog: false
    }));
    // 무대 전체가 한 화면에 들어오는 카메라라 캐릭터가 작게 보인다.
    // 이름표를 캐릭터 비례로 잡으면 글자가 안 읽힌다.
    sprite.scale.set(2.7, 1.01, 1);
    sprite.position.y = PLAYER.height * 1.75;   // 잎끝 바로 위
    sprite.renderOrder = 10;
    this.mesh.add(sprite);
    this.label = sprite;
  }

  clearLabel() {
    if (!this.label) return;
    this.mesh.remove(this.label);
    this.label.material.map.dispose();
    this.label.material.dispose();
    this.label = null;
  }

  // 물리 상태는 body 가 갖고 있다. 읽기 편하게 통로만 열어 둔다.
  get pos() { return this.body; }          // .x .y .z
  get vel() { return { x: this.body.vx, y: this.body.vy, z: this.body.vz }; }
  get grounded() { return this.body.grounded; }
  get fell() { return this.body.fell; }
  get feetY() { return this.body.feetY; }
  get headY() { return this.body.headY; }

  reset(x = 0, z = 0) {
    this.body.reset(x, z);
    this.alive = true;

    this.lean = 0;
    this.flipT = -1;
    this.stretch = 0;
    this.puffT = -1;
    this.puff.visible = false;

    this.mesh.visible = true;
    this.mesh.rotation.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.rig.scale.set(1, 1, 1);
    this.blob.visible = true;
    this.halo.visible = true;
    this.sync(0);
  }

  // input.move = 정규화된 {x, y} (y가 화면 위쪽), input.jumpPressed = 이번 프레임 점프 입력
  update(dt, input) {
    this.body.step(dt, { moveX: input.move.x, moveY: input.move.y, jump: input.jumpPressed });
    this.afterStep(dt);
  }

  // 물리 한 스텝이 끝난 뒤의 연출. 온라인에서는 서버가 보낸 상태를
  // body 에 넣은 뒤 이 함수만 부르면 된다.
  afterStep(dt) {
    if (this.body.justJumped) {
      this.stretch = this.body.justJumped === 2 ? 0.8 : 0.7;
      if (this.body.justJumped === 2) this.flipT = 0;   // 공중제비 시작
      this.firePuff();
      this.onJump?.(this.body.justJumped === 2);
    }
    if (this.body.justLanded) {
      this.stretch = -0.6;     // 착지하면 눌린다
      this.flipT = -1;         // 돌다 말고 착지했으면 즉시 정면으로
      this.onLand?.();
    }
    this.sync(dt);
  }

  firePuff() {
    this.puffT = 0;
    this.puff.position.set(this.pos.x, this.pos.y + 0.08, this.pos.z);
    this.puff.visible = true;
  }

  sync(dt = 0) {
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);

    const speed = Math.hypot(this.vel.x, this.vel.z);

    if (dt > 0) {
      if (this.mixer) this.mixer.update(dt);
      // 도형으로 만든 캐릭터는 자체 애니메이션(잎 흔들림, 팔 젓기)을 갖는다
      this.animTime += dt;
      this.skin.userData.animate?.(this.animTime, speed, this.grounded);
    }
    // 프레임 레이트에 상관없이 같은 속도로 수렴하도록 지수 감쇠를 쓴다
    const k = dt > 0 ? 1 - Math.exp(-26 * dt) : 1;

    if (speed > 0.4) {
      this.mesh.rotation.y = angleLerp(this.mesh.rotation.y, Math.atan2(this.vel.x, this.vel.z), k);
    }

    // 진행 방향으로 앞으로 기울기
    this.lean += (speed * 0.02 - this.lean) * k;

    let rx = this.lean;
    if (this.flipT >= 0 && dt > 0) {
      this.flipT += dt / FLIP_TIME;
      if (this.flipT >= 1) this.flipT = -1;
    }
    // 앞으로 한 바퀴. smoothstep 이라 시작과 끝이 부드럽고 중간이 빠르다.
    if (this.flipT >= 0) rx += smoothstep(this.flipT) * TWO_PI;
    this.rig.rotation.x = rx;

    // 늘어남/눌림 — 부피를 대충 유지해서 고무처럼 보이게
    if (dt > 0) this.stretch += (0 - this.stretch) * (1 - Math.exp(-11 * dt));
    // 공중제비 중엔 몸을 살짝 웅크린다. 회전이 훨씬 깔끔하게 읽힌다.
    const tuck = this.flipT >= 0 ? Math.sin(Math.PI * this.flipT) * 0.16 : 0;
    const sx = (1 - this.stretch * 0.16) * (1 - tuck);
    const sy = (1 + this.stretch * 0.26) * (1 - tuck);
    this.rig.scale.set(sx, sy, sx);

    const onDeck = this.pos.y > -0.5 && Math.hypot(this.pos.x, this.pos.z) <= ARENA_RADIUS;
    const shrink = THREE.MathUtils.clamp(1 - this.pos.y / 3.2, 0.35, 1);

    this.blob.position.set(this.pos.x, 0.06, this.pos.z);
    this.blob.visible = onDeck;
    this.blob.scale.setScalar(shrink);
    this.blob.material.opacity = 0.3 * shrink;

    // 링은 크기를 유지해서, 공중에 떠 있어도 착지 지점이 또렷하게 보인다
    this.halo.position.set(this.pos.x, 0.09, this.pos.z);
    this.halo.visible = onDeck;
    this.halo.material.opacity = this.grounded ? 0.55 : 0.9;

    // 점프 고리 — 퍼지면서 사라진다
    if (this.puffT >= 0 && dt > 0) {
      this.puffT += dt / 0.36;
      if (this.puffT >= 1) {
        this.puffT = -1;
        this.puff.visible = false;
      } else {
        const e = this.puffT;
        this.puff.scale.setScalar(0.5 + e * 2.4);
        this.puff.material.opacity = (1 - e) * 0.75;
      }
    }
  }
}

