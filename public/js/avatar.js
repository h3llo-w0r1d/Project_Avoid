import * as THREE from 'three';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/jsm/libs/meshopt_decoder.module.js';
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
function normalizeToPlayerBox(object, recenterXZ, scale = AVATAR.scale, yOffset = AVATAR.yOffset) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!(size.y > 1e-4)) return false;

  object.scale.multiplyScalar((PLAYER.height * scale) / size.y);

  const scaled = new THREE.Box3().setFromObject(object);
  if (recenterXZ) {
    const center = new THREE.Vector3();
    scaled.getCenter(center);
    object.position.x -= center.x;
    object.position.z -= center.z;
  }
  // 발바닥을 히트박스 바닥에 맞춘다. 남는 키는 위로 삐져나가는데,
  // 전기선이 y 0.38~0.82 에만 있어서 머리 위쪽은 판정에 닿지 않는다.
  object.position.y -= scaled.min.y + PLAYER.height / 2 - yOffset;
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

// ── 캐릭터 모델(.glb) ────────────────────────────────────────────────
//
// 캐릭터 스펙에 model 이 있으면 도형 조립 대신 그 .glb 를 쓴다.
// 없으면 예전처럼 AVATAR.url 을 보고, 그것도 없으면 도형으로 조립한다.
//
// 파일 하나를 여러 곳(내 캐릭터·상대·미리보기 카드)에서 쓰기 때문에
// URL 마다 한 번만 받아서 clone 해 나눠 준다. 안 그러면 같은 파일을
// 사람 수만큼 내려받는다.
const modelCache = new Map();    // url → gltf (다 받은 것)
const modelPending = new Map();  // url → Promise (받는 중)

// 캐릭터의 모델 설정을 꺼낸다. 없으면 null.
export function modelSpecOf(characterId) {
  const spec = findCharacter(characterId)?.model;
  if (spec) return typeof spec === 'string' ? { url: spec } : spec;
  return AVATAR.url ? { url: AVATAR.url, yaw: AVATAR.yaw, scale: AVATAR.scale } : null;
}

// meshopt 로 압축한 .glb 도 읽을 수 있게 디코더를 끼운 로더.
// 압축을 안 쓴 파일에도 아무 영향이 없다.
let loader = null;
const gltfLoader = () => (loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder));

function fetchModel(url) {
  if (modelCache.has(url)) return Promise.resolve(modelCache.get(url));
  if (!modelPending.has(url)) {
    modelPending.set(url, gltfLoader().loadAsync(url).then((gltf) => {
      modelCache.set(url, gltf);
      return gltf;
    }).catch((err) => {
      // 파일이 없거나 형식이 안 맞아도 게임은 계속 돌아가야 한다.
      console.warn('캐릭터 모델을 불러오지 못해 기본 캐릭터를 씁니다: ' + url, err.message);
      modelPending.delete(url);
      return null;
    }));
  }
  return modelPending.get(url);
}

// 모델을 밝게 들어올린다.
//
// 무대가 어둡고 렌더러가 ACES 톤매핑을 쓰는 탓에, 그림에서 쨍하던 색이
// 게임 안에서는 칙칙해진다. 도형 캐릭터는 그걸 감안해 색을 골랐지만
// 불러온 모델은 원본 텍스처 그대로라 유독 어둡게 보인다.
//
// color 를 곱하면 밝은 부분만 더 밝아져 그늘은 그대로 어둡다. 텍스처를
// 그대로 emissiveMap 으로 한 번 더 얹으면 조명과 무관한 바닥값이 생겨
// 그늘이 먼저 들리고, 그림의 원래 색조도 같이 살아난다.
//
// 재질은 캐시한 원본과 공유하므로 한 번만 손댄다(여러 번 해도 같은 결과).
function brighten(model, k) {
  if (!k) return;
  model.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [o.material].flat().filter(Boolean)) {
      if (m.userData.brightened === k) continue;
      m.emissiveMap = m.map;
      m.emissive = new THREE.Color(0xffffff);
      m.emissiveIntensity = k;
      m.userData.brightened = k;
      m.needsUpdate = true;
    }
  });
}

// 불러온 gltf 를 게임 규약(원점이 몸 한가운데, 키 PLAYER.height)에 맞춰 조립한다.
function assemble(gltf, spec) {
  // 원본을 그대로 씌우면 두 사람이 같은 메시를 공유해 한쪽 회전이 옮는다.
  const model = gltf.scene.clone(true);
  model.rotation.y = spec.yaw ?? AVATAR.yaw;

  // 그림 한 장에서 만든 모델은 앞뒤(깊이)가 눌려 있다. 정면에서는 멀쩡한데
  // 옆이나 뒤를 보면 종잇장처럼 얇다. depth 로 그 축만 부풀린다.
  //
  // 크기를 맞추기 전에 걸어야 한다. normalizeToPlayerBox 는 키로 배율을
  // 정하고 좌우 중심을 다시 잡는데, 나중에 z 만 늘리면 그 계산이 어긋난다.
  // 깊이는 키에 영향이 없으니 먼저 걸어도 크기는 그대로다.
  model.scale.z = spec.depth ?? 1;

  const ok = normalizeToPlayerBox(model, true,
    spec.scale ?? AVATAR.scale, spec.yOffset ?? AVATAR.yOffset);
  if (!ok) {
    console.warn('모델 높이를 잴 수 없어 기본 캐릭터를 씁니다:', spec.url);
    return null;
  }

  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;   // 스키닝 메시는 경계 상자가 어긋나 사라질 수 있다
    }
  });

  brighten(model, spec.brighten ?? 0);

  const root = new THREE.Group();
  root.add(model);

  // 애니메이션이 들어 있으면 재생한다
  let mixer = null;
  if (gltf.animations?.length) {
    mixer = new THREE.AnimationMixer(model);
    const want = spec.animation ?? AVATAR.animation;
    const clip = want
      ? THREE.AnimationClip.findByName(gltf.animations, want)
      : gltf.animations[0];
    if (clip) mixer.clipAction(clip).play();
    else console.warn('클립을 못 찾았습니다: ' + want, gltf.animations.map((a) => a.name));
  }
  root.userData.mixer = mixer;
  // 캐시한 원본과 지오메트리·재질을 공유한다(clone 은 참조만 복사).
  // 갈아 끼울 때 지우면 같은 모델을 쓰는 다른 사람 것까지 깨진다.
  root.userData.shared = true;
  return root;
}

// 받아 둔 모델이 있으면 바로 조립해 돌려준다(아직이면 null).
// 미리보기 카드처럼 기다릴 수 없는 곳에서 쓴다.
export function buildModelAvatarSync(characterId) {
  const spec = modelSpecOf(characterId);
  if (!spec || !modelCache.has(spec.url)) return null;
  return assemble(modelCache.get(spec.url), spec);
}

// 미리 받아 둔다. 다 받으면 true. 모델이 없는 캐릭터면 false.
export async function preloadModel(characterId) {
  const spec = modelSpecOf(characterId);
  if (!spec) return false;
  return !!(await fetchModel(spec.url));
}

// .glb 를 불러와 크기·위치를 게임 규약에 맞춘다.
// 성공하면 { root, mixer }, 실패하면 null 을 돌려준다.
export async function loadModelAvatar(characterId) {
  const spec = modelSpecOf(characterId);
  if (!spec) return null;
  const gltf = await fetchModel(spec.url);
  if (!gltf) return null;
  const root = assemble(gltf, spec);
  return root ? { root, mixer: root.userData.mixer } : null;
}
