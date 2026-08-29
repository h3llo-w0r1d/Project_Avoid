import * as THREE from 'three';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { AVATAR, PLAYER } from './config.js';
import { buildPlant } from './plant.js';
import { DEFAULT_CHARACTER, findCharacter } from './characters.js';

// 캐릭터 겉모습을 만든다.
// AVATAR.url 이 있으면 .glb 를 불러오고, 없거나 실패하면 만드라고라를 쓴다.
//
// 어느 쪽이든 결과물은 "원점이 몸 한가운데, 높이가 PLAYER.height" 인 그룹이다.
// 발바닥을 축으로 돌리면 공중제비가 아니라 발작처럼 보이기 때문에,
// Player 의 리그가 이 규약에 의존한다.

// 실제 크기를 재서 게임 규약에 맞춘다. 도형으로 만든 캐릭터든 불러온
// 모델이든 같은 규칙을 적용해야 물리와 겉모습이 어긋나지 않는다.
// 맞출 수 없으면 false 를 돌려준다.
//
// AVATAR.scale 은 여기서 함께 반영한다. 정규화가 끝난 그룹을 바깥에서
// 다시 키우면 몸 한가운데를 기준으로 커져서 발이 바닥 아래로 꺼진다.
// 배율이 얼마든 발바닥은 항상 -PLAYER.height/2 에 붙어 있어야 한다.
//
// recenterXZ: 좌우 중심을 원점으로 끌어올지. 불러온 모델은 원점이
// 어디일지 몰라 켜야 하지만, 직접 조립한 캐릭터는 이미 Y축 위에 서 있다.
// 켜면 잎처럼 비대칭인 장식까지 계산에 들어가 몸통이 축에서 밀려난다.
function normalizeToPlayerBox(object, recenterXZ) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!(size.y > 1e-4)) return false;

  object.scale.multiplyScalar((PLAYER.height * AVATAR.scale) / size.y);

  const scaled = new THREE.Box3().setFromObject(object);
  if (recenterXZ) {
    const center = new THREE.Vector3();
    scaled.getCenter(center);
    object.position.x -= center.x;
    object.position.z -= center.z;
  }
  // 발바닥을 히트박스 바닥에 맞춘다. 남는 키는 위로 삐져나가는데,
  // 전기선이 y 0.38~0.82 에만 있어서 머리 위쪽은 판정에 닿지 않는다.
  object.position.y -= scaled.min.y + PLAYER.height / 2 - AVATAR.yOffset;
  return true;
}

// 캐릭터마다 몸통 폭을 이 값으로 맞춘다. 화면에 보이는 최종 폭이다.
//
// 전기선은 y 0.38~0.82 에만 있으므로 판정에 걸리는 건 몸통 폭뿐이다.
// 전체 높이로 맞추면, 머리 장식이 작은 캐릭터(도토리)는 그만큼 몸이
// 커져서 "스쳤는데 안 죽는" 캐릭터가 된다.
//
// 판정 폭(1.0)보다 11% 넓다. 살짝 스쳐도 살아남는 쪽이 그 반대보다 낫다.
// AVATAR.scale 은 여기 곱하지 않는다 — 크기를 히트박스에 묶어 두는 게
// 이 값의 존재 이유라, 배율을 더하면 그 목적이 깨진다.
const BODY_WIDTH = PLAYER.radius * 2 * 1.11;

// 모델 파일 없이도 게임이 돌아가게 해 주는 기본 캐릭터.
// characterId 로 어떤 캐릭터를 만들지 고른다.
export function buildFallbackAvatar({ characterId = DEFAULT_CHARACTER, preview = false } = {}) {
  const inner = buildPlant(characterId, { preview });
  const root = new THREE.Group();
  root.add(inner);
  // sizeMul: 순수 겉보기 배율. 판정(고정 반경)엔 영향이 없고, '왕만두'처럼
  // 더 커 보이게 하고 싶은 캐릭터만 살짝 키운다. 기본 1.
  normalizeByBody(inner, findCharacter(characterId).sizeMul ?? 1);

  // 잎 흔들림·팔 젓기를 Player 가 이어서 호출할 수 있게 위로 올려 준다
  root.userData.animate = inner.userData.animate;
  return root;
}

// 몸통 폭을 기준으로 크기를 맞추고, 발바닥을 히트박스 바닥에 붙인다.
// 키는 캐릭터마다 달라지는데, 머리 위로 삐져나가는 건 판정과 무관하다.
function normalizeByBody(object, sizeMul = 1) {
  const body = object.getObjectByName('body');
  if (!body) return normalizeToPlayerBox(object, false);

  const bodyBox = new THREE.Box3().setFromObject(body);
  const width = Math.max(bodyBox.max.x - bodyBox.min.x, 1e-4);
  object.scale.multiplyScalar((BODY_WIDTH * sizeMul) / width);

  const whole = new THREE.Box3().setFromObject(object);
  object.position.y -= whole.min.y + PLAYER.height / 2 - AVATAR.yOffset;
}

// .glb 를 불러와 크기·위치를 게임 규약에 맞춘다.
// 성공하면 { root, mixer }, 실패하면 null 을 돌려준다.
export async function loadModelAvatar() {
  if (!AVATAR.url) return null;

  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(AVATAR.url);
  } catch (err) {
    // 파일이 없거나 형식이 안 맞아도 게임은 계속 돌아가야 한다.
    console.warn(`캐릭터 모델을 불러오지 못해 기본 캐릭터를 씁니다 (${AVATAR.url}):`, err.message);
    return null;
  }

  const model = gltf.scene;
  model.rotation.y = AVATAR.yaw;

  if (!normalizeToPlayerBox(model, true)) {
    console.warn('모델 높이를 잴 수 없어 기본 캐릭터를 씁니다:', AVATAR.url);
    return null;
  }

  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;   // 스키닝 메시는 경계 상자가 어긋나 사라질 수 있다
    }
  });

  const root = new THREE.Group();
  root.add(model);

  // 애니메이션이 들어 있으면 재생한다
  let mixer = null;
  if (gltf.animations?.length) {
    mixer = new THREE.AnimationMixer(model);
    const clip = AVATAR.animation
      ? THREE.AnimationClip.findByName(gltf.animations, AVATAR.animation)
      : gltf.animations[0];
    if (clip) {
      mixer.clipAction(clip).play();
    } else {
      console.warn(`'${AVATAR.animation}' 클립이 없습니다. 들어 있는 클립:`,
        gltf.animations.map((a) => a.name));
    }
  }

  return { root, mixer };
}
