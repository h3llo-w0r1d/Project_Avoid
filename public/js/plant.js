import * as THREE from 'three';
import { findCharacter } from './characters.js';

// 캐릭터를 도형만으로 조립한다. 외부 모델 파일이 없다.
//
// characters.js 의 명세(몸통 옆모습·색·표면 무늬·머리 장식)를 읽어서 만든다.
// 모양만 다르고 얼굴·팔·발·테두리·움직임은 전부 공유한다.
//
// 만들어 두는 좌표계는 "발바닥 y≈0, 위로 자라는, 앞쪽이 +Z" 형태다.
// 게임 규약(원점 = 몸 한가운데, 몸통 폭 = 판정 폭)에 맞추는 일은
// avatar.js 의 normalizeByBody() 가 마지막에 처리한다.

const COLOR = {
  outline: 0x3d3226,
  eye: 0x2b211a,
  sclera: 0xfdfbf5,
  blush: 0xf2a49c
};

// 셀 셰이딩용 계단 그라데이션. 빛이 부드럽게 번지지 않고 몇 단계로 뚝뚝 끊긴다.
function makeToonGradient() {
  const data = new Uint8Array([
    120, 120, 120, 255,
    190, 190, 190, 255,
    240, 240, 240, 255,
    255, 255, 255, 255
  ]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const GRADIENT = makeToonGradient();
const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT });

// 0xrrggbb 를 밝기만 바꿔 css 색 문자열로. 캔버스에 그릴 때 쓴다.
function shade(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function canvas(size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  return cv;
}

function textureFrom(cv, { wrap = false } = {}) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (wrap) tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------- 몸통 자

// 옆모습에서 특정 높이의 굵기를 읽는다. 눈·볼을 표면에 붙일 때 쓴다.
function makeRuler(profile) {
  const top = profile[profile.length - 1][0];

  const radiusAt = (y) => {
    if (y <= profile[0][0]) return profile[0][1];
    for (let i = 1; i < profile.length; i++) {
      const [y1, r1] = profile[i];
      if (y <= y1) {
        const [y0, r0] = profile[i - 1];
        return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
      }
    }
    return profile[profile.length - 1][1];
  };

  // 회전체라 높이만 알면 표면의 z 를 계산할 수 있다
  const surfaceZ = (x, y) => {
    const r = radiusAt(y);
    return Math.sqrt(Math.max(r * r - x * x, 0.0025));
  };

  return {
    top,
    at: (frac) => top * frac,     // 몸통 높이의 비율로 위치를 잡는다
    radiusAt,
    surfaceZ,
    // 입·볼처럼 평평한 장식을 붙일 z. 곡면에 평면을 표면 높이 그대로 붙이면
    // 가운데만 걸치고 가장자리가 몸 안으로 파묻혀 통째로 잘려 보인다.
    decalZ: (x, y) => surfaceZ(x, y) + 0.014
  };
}

// ---------------------------------------------------------------- 몸통 껍질

// 몸통에 입힐 그림. 단색이면 셀 셰이딩 단계만 보여서 납작해 보인다.
//
// LatheGeometry 의 uv 는 u 가 몸을 한 바퀴 돌고, v 가 아래(0)에서 위(1)로
// 올라간다. 텍스처는 v=0 이 그림의 아래쪽이므로 캔버스 위쪽이 몸 위쪽이다.
// 그래서 가로줄은 몸을 감는 테가 되고, 세로줄은 몸을 타고 흐르는 골이 된다.
function makeBodyTexture(spec, size = 512) {
  const cv = canvas(size);
  const g = cv.getContext('2d');

  // 아래로 갈수록 어둡게. 바닥에 가까운 쪽이 그늘지는 걸 흉내 낸다.
  // bodyTop / bodyBottom 을 주면 위·아래가 그 색으로 물든다
  // (망고의 주황 어깨 → 노랑 → 초록 바닥처럼).
  const grd = g.createLinearGradient(0, 0, 0, size);
  grd.addColorStop(0.00, spec.bodyTop ? shade(spec.bodyTop, 1.02) : shade(spec.body, 1.09));
  grd.addColorStop(spec.bodyTop ? 0.32 : 0.45, shade(spec.body, 1.0));
  if (spec.bodyBottom) {
    grd.addColorStop(0.60, shade(spec.body, 0.96));
    grd.addColorStop(1.00, shade(spec.bodyBottom, 1.0));
  } else {
    grd.addColorStop(1.00, shade(spec.body, 0.70));
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);

  const dark = (a) => `rgba(60, 44, 30, ${a})`;
  g.lineCap = 'round';

  if (spec.skin === 'fiber') {
    // 무 뿌리의 잔섬유. 아래쪽에만 옅게.
    g.strokeStyle = dark(0.13);
    g.lineWidth = size * 0.006;
    for (let i = 0; i < 26; i++) {
      const x = (i / 26) * size + Math.sin(i * 3.7) * size * 0.01;
      const y0 = size * (0.52 + (i % 4) * 0.07);
      g.beginPath();
      g.moveTo(x, y0);
      g.quadraticCurveTo(x + size * 0.02, y0 + size * 0.16, x - size * 0.01, y0 + size * 0.3);
      g.stroke();
    }
  } else if (spec.skin === 'grooves') {
    // 당근의 가로 골. 짧은 조각으로 끊어 그려야 당근처럼 보인다.
    g.strokeStyle = dark(0.17);
    for (let row = 0; row < 13; row++) {
      const y = size * (0.06 + row * 0.072);
      g.lineWidth = size * (0.004 + (row % 3) * 0.0015);
      for (let i = 0; i < 5; i++) {
        const x = ((i + (row % 2) * 0.5) / 5) * size;
        const w = size * (0.09 + (i % 2) * 0.04);
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + w / 2, y + size * 0.012, x + w, y);
        g.stroke();
      }
    }
  } else if (spec.skin === 'ribs') {
    // 선인장의 세로 능선. 골은 어둡게, 능선 위는 밝게.
    const ribs = 10;
    for (let i = 0; i < ribs; i++) {
      const x = (i / ribs) * size;
      g.strokeStyle = dark(0.2);
      g.lineWidth = size * 0.012;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, size);
      g.stroke();

      g.strokeStyle = 'rgba(255, 255, 245, 0.1)';
      g.lineWidth = size * 0.03;
      g.beginPath();
      g.moveTo(x + size / ribs / 2, 0);
      g.lineTo(x + size / ribs / 2, size);
      g.stroke();
    }
  } else if (spec.skin === 'speckle') {
    // 감자의 반점과 눈.
    // 몸을 한 바퀴 감으므로 좌우 끝에서 무늬가 이어져야 한다. 가장자리에
    // 걸친 것은 반대편에도 한 번 더 그려 준다.
    const wrapped = (draw) => { draw(0); draw(-size); draw(size); };

    for (let i = 0; i < 90; i++) {
      const x = Math.random() * size;
      const y = size * (0.05 + Math.random() * 0.9);
      const r = size * (0.004 + Math.random() * 0.008);
      const tilt = Math.random() * 3;
      g.fillStyle = dark(0.1 + Math.random() * 0.14);
      wrapped((dx) => {
        g.beginPath();
        g.ellipse(x + dx, y, r * 1.6, r, tilt, 0, Math.PI * 2);
        g.fill();
      });
    }
    for (let i = 0; i < 7; i++) {
      const x = (i / 7) * size + size * 0.06;
      const y = size * (0.2 + ((i * 5) % 7) * 0.09);
      wrapped((dx) => {
        g.fillStyle = dark(0.34);
        g.beginPath();
        g.ellipse(x + dx, y, size * 0.019, size * 0.013, 0.6, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.beginPath();
        g.ellipse(x + dx - size * 0.005, y - size * 0.004, size * 0.008, size * 0.005, 0.6, 0, Math.PI * 2);
        g.fill();
      });
    }
  }

  // 금속 광택(spec.shine). 텍스처는 몸을 한 바퀴 감싸는데 정면(카메라 쪽)은
  // u≈0(양 끝)이라, 반사 하이라이트를 그쪽(왼끝·오른끝)에 몰아 '더하기(lighter)'
  // 로 얹는다. 큰 sheen + 밝은 글린트 + 작은 스파클로 금·동전처럼 번쩍이게.
  if (spec.shine) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    // 몸을 감싼 텍스처라 왼끝/오른끝이 정면에서 이어진다. 양쪽에 그려 준다.
    const near = [size * 0.13, size * 0.13 - size, size * 0.87];   // 정면(오른뺨쪽)
    for (const cx of near) {
      // 세로 sheen 띠
      const band = g.createLinearGradient(cx - size * 0.14, 0, cx + size * 0.14, 0);
      band.addColorStop(0.0, 'rgba(255,255,255,0)');
      band.addColorStop(0.5, 'rgba(255,250,215,0.6)');
      band.addColorStop(1.0, 'rgba(255,255,255,0)');
      g.fillStyle = band;
      g.fillRect(cx - size * 0.14, 0, size * 0.28, size);
      // 위쪽 큰 글린트
      const glint = g.createRadialGradient(cx, size * 0.3, 0, cx, size * 0.3, size * 0.17);
      glint.addColorStop(0.0, 'rgba(255,255,255,0.95)');
      glint.addColorStop(0.5, 'rgba(255,252,225,0.45)');
      glint.addColorStop(1.0, 'rgba(255,255,255,0)');
      g.fillStyle = glint;
      g.beginPath();
      g.ellipse(cx, size * 0.3, size * 0.09, size * 0.16, 0, 0, Math.PI * 2);
      g.fill();
      // 작은 스파클 점 두 개(톡톡 튀는 반짝)
      for (const [sx, sy, sr] of [[cx + size * 0.02, size * 0.16, 0.02], [cx - size * 0.03, size * 0.5, 0.014]]) {
        const sp = g.createRadialGradient(sx, sy, 0, sx, sy, size * sr * 2.4);
        sp.addColorStop(0, 'rgba(255,255,255,0.95)');
        sp.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = sp;
        g.beginPath();
        g.arc(sx, sy, size * sr * 2.4, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }

  return textureFrom(cv, { wrap: true });
}

// ---------------------------------------------------------------- 잎

// 잎을 캔버스에 그려서 텍스처로 쓴다. 외곽선과 잎맥까지 한 번에 얻을 수 있다.
// 캔버스 위쪽이 잎끝, 아래쪽이 줄기 — PlaneGeometry 의 +Y 방향과 맞는다.
function makeLeafTexture(fill = '#a9d477', size = 384) {
  const cv = canvas(size);
  const g = cv.getContext('2d');
  const cx = size / 2;

  const top = size * 0.07;
  const bottom = size * 0.95;
  const halfW = size * 0.36;
  const belly = size * 0.58;   // 가장 넓어지는 지점

  const outline = () => {
    g.beginPath();
    g.moveTo(cx, bottom);
    g.bezierCurveTo(cx + halfW * 0.95, belly + size * 0.2, cx + halfW, belly - size * 0.26, cx, top);
    g.bezierCurveTo(cx - halfW, belly - size * 0.26, cx - halfW * 0.95, belly + size * 0.2, cx, bottom);
    g.closePath();
  };

  // 잎 안에서도 밑동이 어둡고 끝이 밝다
  outline();
  const grd = g.createLinearGradient(0, bottom, 0, top);
  grd.addColorStop(0, fill);
  grd.addColorStop(1, '#ffffff');
  g.fillStyle = fill;
  g.fill();
  g.save();
  g.clip();
  g.globalAlpha = 0.22;
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  g.globalAlpha = 1;
  // 한쪽 면에 그늘을 줘서 접힌 느낌을 낸다
  g.fillStyle = 'rgba(40, 70, 30, 0.16)';
  g.beginPath();
  g.moveTo(cx, bottom);
  g.lineTo(cx, top);
  g.lineTo(cx - halfW, belly);
  g.closePath();
  g.fill();
  g.restore();

  outline();
  g.strokeStyle = '#3d3226';
  g.lineWidth = size * 0.034;
  g.lineJoin = 'round';
  g.stroke();

  // 잎맥 — 가운데 굵은 줄 하나에 좌우로 뻗는 잔줄
  g.strokeStyle = 'rgba(60, 90, 40, 0.5)';
  g.lineCap = 'round';
  g.lineWidth = size * 0.022;
  g.beginPath();
  g.moveTo(cx, bottom - size * 0.04);
  g.lineTo(cx, top + size * 0.07);
  g.stroke();

  g.lineWidth = size * 0.013;
  for (let i = 0; i < 5; i++) {
    const t = 0.18 + i * 0.16;
    const y = bottom - (bottom - top) * t;
    const spread = halfW * (0.78 - i * 0.13);
    const drop = size * 0.075;
    for (const dir of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx, y + drop * 0.55);
      g.quadraticCurveTo(cx + dir * spread * 0.6, y, cx + dir * spread, y - drop);
      g.stroke();
    }
  }

  return textureFrom(cv);
}

// 잎 재질. 빛을 받아야 몸통과 같은 세계에 있는 것처럼 보인다.
// MeshBasicMaterial 을 쓰면 어느 방향에서 봐도 같은 밝기라 오려 붙인 것 같다.
const leafMaterial = (color) => new THREE.MeshToonMaterial({
  map: makeLeafTexture(color),
  gradientMap: GRADIENT,
  alphaTest: 0.5,
  side: THREE.DoubleSide
});

// 살짝 휜 잎 판. 완전한 평면이면 옆에서 볼 때 실선 하나로 사라져 버린다.
// 폭 방향으로는 오목하게(가장자리가 들리게), 길이 방향으로는 끝이 처지게 휜다.
function makeLeafGeometry(width, length) {
  const geo = new THREE.PlaneGeometry(width, length, 6, 10);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / (width / 2);            // -1 ~ 1
    const v = (pos.getY(i) + length / 2) / length;  //  0(줄기) ~ 1(잎끝)
    pos.setZ(i, length * (0.09 * u * u - 0.17 * v * v));
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- 얼굴 그림

// 벌린 입. 테두리·안쪽·혀를 한 장에 그린다.
// 도형을 겹쳐 쌓으면 테두리가 안 생겨서 붉은 얼룩처럼 보인다.
// kind 로 표정을 바꾼다: 기본은 활짝 벌린 웃는 입, 'confused' 는 갸우뚱한 의문 입.
function makeMouthTexture(kind = 'smile', size = 256) {
  const cv = canvas(size);
  const g = cv.getContext('2d');
  const cx = size / 2;

  // 갸우뚱·의문 입 — 크고 삐뚜름하게 쩍 벌린 "으에?!" 느낌.
  if (kind === 'confused') {
    const my = size * 0.46;
    const shape = () => {
      g.beginPath();
      // 왼쪽은 처지고 오른쪽은 올라간 비대칭. 아래로 크게 벌어진다.
      g.moveTo(cx - size * 0.22, my - size * 0.02);
      g.quadraticCurveTo(cx - size * 0.04, my - size * 0.13, cx + size * 0.24, my - size * 0.06);
      g.quadraticCurveTo(cx + size * 0.17, my + size * 0.21, cx - size * 0.02, my + size * 0.23);
      g.quadraticCurveTo(cx - size * 0.23, my + size * 0.16, cx - size * 0.22, my - size * 0.02);
      g.closePath();
    };
    shape();
    g.fillStyle = '#7a3330';
    g.fill();
    g.save(); shape(); g.clip();
    g.fillStyle = '#e4837c';
    g.beginPath();
    g.ellipse(cx, my + size * 0.16, size * 0.14, size * 0.07, 0.1, 0, Math.PI * 2);
    g.fill();
    g.restore();
    shape();
    g.strokeStyle = '#3d3226';
    g.lineWidth = size * 0.05;
    g.lineJoin = 'round';
    g.stroke();
    return textureFrom(cv);
  }

  // 귀여운 강아지 입 — 코 아래 짧은 세로선 + 작은 ω(두 봉우리). 선만.
  if (kind === 'cute') {
    g.strokeStyle = '#000000';
    g.lineWidth = size * 0.05; g.lineCap = 'round'; g.lineJoin = 'round';
    const my = size * 0.44, w = size * 0.24;  // 넓게 펼친 ω 입
    g.beginPath();                            // ω 입(두 봉우리) — 인중 세로선 없이
    g.moveTo(cx - w, my - size * 0.02);
    g.quadraticCurveTo(cx - w * 0.5, my + size * 0.13, cx, my - size * 0.01);
    g.quadraticCurveTo(cx + w * 0.5, my + size * 0.13, cx + w, my - size * 0.02);
    g.stroke();
    return textureFrom(cv);
  }

  // 사악한 이빨 웃음 — 시커먼 입에 지그재그 뾰족니. 흑화용.
  if (kind === 'evil') {
    const my = size * 0.44;
    const halfW = size * 0.31;
    const halfH = size * 0.16;
    const shape = () => {
      g.beginPath();
      g.moveTo(cx - halfW, my - halfH * 0.2);
      g.quadraticCurveTo(cx, my - halfH * 0.9, cx + halfW, my - halfH * 0.2);   // 윗선(살짝 치켜올림)
      g.quadraticCurveTo(cx, my + halfH * 1.7, cx - halfW, my - halfH * 0.2);   // 아랫선(크게 벌어짐)
      g.closePath();
    };
    shape();
    g.fillStyle = '#160a0a';           // 시커먼 입 속
    g.fill();
    g.save(); shape(); g.clip();
    g.fillStyle = '#e9e2cf';           // 누런 뼈색 이빨
    const teeth = 7;
    const tw = (halfW * 2) / teeth;
    for (let i = 0; i < teeth; i++) {  // 윗니(아래로 뾰족)
      const x0 = cx - halfW + i * tw;
      g.beginPath();
      g.moveTo(x0, my - halfH * 0.5); g.lineTo(x0 + tw, my - halfH * 0.5);
      g.lineTo(x0 + tw / 2, my + halfH * 0.25); g.closePath(); g.fill();
    }
    for (let i = 0; i < teeth; i++) {  // 아랫니(위로 뾰족)
      const x0 = cx - halfW + i * tw;
      g.beginPath();
      g.moveTo(x0, my + halfH * 1.5); g.lineTo(x0 + tw, my + halfH * 1.5);
      g.lineTo(x0 + tw / 2, my + halfH * 0.6); g.closePath(); g.fill();
    }
    g.restore();
    shape();
    g.strokeStyle = '#0c0808';
    g.lineWidth = size * 0.05; g.lineJoin = 'round';
    g.stroke();
    return textureFrom(cv);
  }

  const top = size * 0.34;
  const w = size * 0.34;
  const deep = size * 0.42;

  const shape = () => {
    g.beginPath();
    g.moveTo(cx - w, top);
    g.quadraticCurveTo(cx, top + size * 0.05, cx + w, top);   // 윗입술은 살짝 처진 직선
    g.bezierCurveTo(cx + w * 0.98, top + deep, cx - w * 0.98, top + deep, cx - w, top);
    g.closePath();
  };

  shape();
  g.fillStyle = '#7a3330';
  g.fill();

  // 혀 — 입 안쪽 아래에 붙인다
  g.save();
  shape();
  g.clip();
  g.fillStyle = '#e4837c';
  g.beginPath();
  g.ellipse(cx, top + deep * 0.86, w * 0.62, deep * 0.34, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  shape();
  g.strokeStyle = '#3d3226';
  g.lineWidth = size * 0.045;
  g.lineJoin = 'round';
  g.stroke();

  return textureFrom(cv);
}

// 물음표 "?" 그림. 머리 옆에 띄워 '의문 가득' 느낌을 준다.
function makeQuestionTexture(size = 128) {
  const cv = canvas(size);
  const g = cv.getContext('2d');
  g.font = `900 ${Math.round(size * 0.82)}px "Arial Black", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.16;
  g.strokeStyle = '#3d3226';
  g.strokeText('?', size / 2, size * 0.55);
  g.fillStyle = '#ffd24a';
  g.fillText('?', size / 2, size * 0.55);
  return textureFrom(cv);
}

// ---------------------------------------------------------------- 테두리

// 만화 같은 검은 테두리. 뒷면만 그리는 껍데기를 겉에 한 겹 씌운다.
//
// 크기를 곱해서 부풀리면 굵은 데는 테두리가 두껍고 가는 데는 얇아진다.
// 그래서 각 정점을 자기 법선 방향으로 같은 거리만큼 밀어낸다.
function outlineGeometry(geo, thickness) {
  const out = geo.clone();
  const pos = out.attributes.position;
  const nor = out.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + nor.getX(i) * thickness,
      pos.getY(i) + nor.getY(i) * thickness,
      pos.getZ(i) + nor.getZ(i) * thickness
    );
  }
  pos.needsUpdate = true;
  out.deleteAttribute('uv');
  return out;
}

// 테두리 재질은 캐릭터마다 하나씩 만든다.
//
// 모듈 전체가 하나를 나눠 쓰면 안 된다. 캐릭터를 갈아 끼울 때
// player.js 의 disposeTree() 가 옛 몸의 재질을 버리는데, 그게 공유물이면
// 화면에 남아 있는 다른 캐릭터(1v1 이면 상대)의 테두리까지 같이 사라진다.
const newOutlineMaterial = (color = COLOR.outline) => new THREE.MeshBasicMaterial({
  color, side: THREE.BackSide
});

// 껍데기를 대상의 자식으로 넣는다. 그래야 숨쉬기처럼 크기가 변할 때
// 테두리도 따라 움직인다.
function addOutline(mesh, thickness, mat) {
  const shell = new THREE.Mesh(outlineGeometry(mesh.geometry, thickness), mat);
  mesh.add(shell);
  return shell;
}

// 회전체는 좌우대칭이라 옆으로 휜 실루엣을 못 낸다. 그래서 만든 뒤에 정점 x 를
// 높이에 따라 밀어 살짝 휘게 한다(망고의 비대칭 곡선). 같은 bendX(y) 를 장식에도
// 적용하면(아래 buildPlant) 데칼·잎·발이 휜 표면에 그대로 얹혀 어긋나지 않는다.
// 위로 갈수록 크게 휘고, 배(가운데)는 반대로 살짝 볼록해 자연스러운 곡선을 만든다.
function makeBend(amount, top) {
  return (y) => {
    const t = Math.max(0, Math.min(1, y / top));
    return amount * (Math.pow(t, 1.6) - 0.28 * Math.sin(Math.PI * t));
  };
}

function bendGeometry(geo, bendX) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) + bendX(pos.getY(i)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// 정점을 흔들어 매끈한 도형을 울퉁불퉁하게 만든다 (감자용)
//
// 난수를 정점마다 뽑으면 안 된다. 회전체는 한 바퀴 돌아 만나는 이음매에
// 같은 자리 정점을 두 벌 갖고 있어서, 둘이 서로 다르게 밀리면 몸에
// 세로로 금이 쭉 간다. 각도의 sin/cos 으로만 흔들어 한 바퀴가 저절로 맞물리게 한다.
function roughen(geometry, amount) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;

    const a = Math.atan2(z, x);
    const wob =
      Math.sin(a * 3 + y * 6.1) * 0.5 +
      Math.sin(a * 5 - y * 9.7) * 0.3 +
      Math.sin(a * 8 + y * 4.3) * 0.2;

    // 위아래 끝은 건드리지 않는다. 건드리면 뚜껑이 어긋난다.
    const k = Math.sin(Math.PI * Math.min(1, Math.max(0, y / 1.3)));
    const scale = 1 + wob * amount * k / r;
    pos.setX(i, x * scale);
    pos.setZ(i, z * scale);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

// 같은 도형을 여러 개 뿌릴 때 쓴다. 하나씩 Mesh 로 만들면
// 선인장 가시만으로 드로우콜이 마흔 개 넘게 늘어난다.
function scatterInstances(geo, mat, placements) {
  const inst = new THREE.InstancedMesh(geo, mat, placements.length);
  const dummy = new THREE.Object3D();
  placements.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
    dummy.scale.setScalar(p.s ?? 1);
    if (p.sy) dummy.scale.y *= p.sy;
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  });
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

// ---------------------------------------------------------------- 머리 장식

// 사방으로 퍼지는 잎. 흔들리는 것들을 배열로 돌려준다.
function addLeaves(root, ruler, spec, _outlineMat, _oW, halfSide = null) {
  const { count = 5, length = 1.5, color, upright: baseUpright = 0.72 } = spec;
  const mat = leafMaterial(color);

  const swaying = [];
  for (let i = 0; i < count; i++) {
    const pivot = new THREE.Group();
    pivot.position.y = ruler.top - 0.03;

    // 기울인 다음(X) 방향을 돌려야(Y) 잎들이 사방으로 퍼진다.
    // three.js 기본 순서 'XYZ' 는 Y 를 먼저 적용해서, 방향과 무관하게
    // 전부 같은 쪽으로 기울어져 버린다.
    pivot.rotation.order = 'YXZ';
    // 반쪽이면 잎도 남은 쪽에만. 오른쪽(+x)은 rotation.y ∈(π,2π), 왼쪽(-x)은
    // (0,π) 구간이라 그 안에서만 고르게 편다. 아니면 평소대로 사방으로.
    const spread = ((i + 0.5) / count) * Math.PI;
    pivot.rotation.y = halfSide === 'right' ? Math.PI + spread
      : halfSide === 'left' ? spread
      : (i / count) * Math.PI * 2 + 0.4;

    // upright = 0 이면 바닥에 눕고, π/2 면 수직으로 선다
    const upright = baseUpright + (i % 2) * 0.28;
    const len = length - (i % 3) * (length * 0.11);

    const leaf = new THREE.Mesh(makeLeafGeometry(len * 0.74, len), mat);
    leaf.position.y = len / 2;
    pivot.add(leaf);
    pivot.rotation.x = upright - Math.PI / 2;

    pivot.userData.upright = upright;
    pivot.userData.phase = i * 1.3;
    root.add(pivot);
    swaying.push(pivot);
  }

  // 잎이 돋아나는 밑동. 잎 다섯 장이 허공에서 시작하면 붙다 만 것처럼 보인다.
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), toon(0x9cb862));
  knob.position.y = ruler.top - 0.02;
  knob.scale.y = 0.7;
  root.add(knob);

  return swaying;
}

// 버섯 갓 — 몸통을 덮는 둥근 지붕에 흰 점, 아래엔 주름
function addCap(root, ruler, spec, outlineMat) {
  const { radius = 0.78, height = 0.52, color = 0xe0483f, dots = 0xfff6ea } = spec;
  const capY = ruler.top - 0.12;

  // 반구를 그대로 쓰면 갓 밑동이 칼로 자른 듯 평평해서 모자를 얹은 것 같다.
  // 옆모습을 직접 그려 테두리를 살짝 벌리고 안쪽으로 말아 넣는다.
  //
  // 점은 반드시 아래에서 위로 적는다. 거꾸로 적으면 면이 안팎으로 뒤집혀
  // 겉이 사라지고 테두리 껍데기만 남아 새까맣게 보인다.
  const capGeo = new THREE.LatheGeometry(
    [
      [0.22, -0.075], [0.55, -0.08], [0.84, -0.06], [0.96, -0.02],
      [1.00, 0.06], [0.98, 0.20], [0.91, 0.44], [0.80, 0.66],
      [0.65, 0.83], [0.46, 0.93], [0.24, 0.985], [0.00, 1.00]
    ].map(([r, y]) => new THREE.Vector2(r * radius, y * height)),
    34
  );
  capGeo.computeVertexNormals();

  const cap = new THREE.Mesh(capGeo, toon(color));
  cap.position.y = capY;
  cap.castShadow = true;
  root.add(cap);
  addOutline(cap, 0.03, outlineMat);

  // 갓 아래 주름. 점프해서 올려다볼 때 보인다.
  const gillCv = canvas(256);
  const gg = gillCv.getContext('2d');
  gg.fillStyle = '#e8d6bd';
  gg.beginPath();
  gg.arc(128, 128, 126, 0, Math.PI * 2);
  gg.fill();
  gg.strokeStyle = 'rgba(120, 84, 66, 0.55)';
  gg.lineWidth = 3;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    gg.beginPath();
    gg.moveTo(128 + Math.cos(a) * 26, 128 + Math.sin(a) * 26);
    gg.lineTo(128 + Math.cos(a) * 124, 128 + Math.sin(a) * 124);
    gg.stroke();
  }
  const gills = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.82, 40),
    new THREE.MeshToonMaterial({ map: textureFrom(gillCv), gradientMap: GRADIENT })
  );
  gills.rotation.x = Math.PI / 2;   // 아래를 보게 뒤집는다
  gills.position.y = capY - height * 0.055;
  root.add(gills);

  // 갓 위의 점. 구면을 따라 붙여야 떠 보이지 않는다.
  const spots = [[0.0, 0.35], [1.3, 0.7], [2.5, 0.5], [3.7, 0.75], [5.0, 0.4], [5.9, 0.72]];
  const places = spots.map(([angle, t], i) => {
    const phi = t * (Math.PI / 2);
    return {
      x: Math.cos(angle) * Math.sin(phi) * radius * 0.97,
      y: capY + Math.cos(phi) * height * 0.97,
      z: Math.sin(angle) * Math.sin(phi) * radius * 0.97,
      s: 0.85 + (i % 3) * 0.16,
      sy: 0.5
    };
  });
  root.add(scatterInstances(new THREE.SphereGeometry(0.1, 12, 8), toon(dots), places));

  return [];
}

// 도토리 모자 — 비늘무늬가 있는 갈색 뚜껑에 꼭지
function addAcornCap(root, ruler, spec, outlineMat) {
  const { radius = 0.62, height = 0.42, color = 0x7a5230 } = spec;
  const capY = ruler.top - 0.22;

  // 도토리 깍정이의 비늘. 민무늬 돔은 그냥 갈색 그릇처럼 보인다.
  const cv = canvas(512);
  const g = cv.getContext('2d');
  g.fillStyle = shade(color, 1.0);
  g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 7; row++) {
    const y = 40 + row * 74;
    for (let i = 0; i < 14; i++) {
      const x = (i + (row % 2) * 0.5) * (512 / 14);
      g.fillStyle = shade(color, 1.16 - (row % 2) * 0.1);
      g.beginPath();
      g.ellipse(x, y, 512 / 30, 30, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(50, 32, 18, 0.45)';
      g.lineWidth = 3.5;
      g.stroke();
    }
  }

  const capGeo = new THREE.SphereGeometry(radius, 26, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  capGeo.scale(1, height / radius, 1);
  capGeo.computeVertexNormals();

  const cap = new THREE.Mesh(capGeo, new THREE.MeshToonMaterial({
    map: textureFrom(cv, { wrap: true }), gradientMap: GRADIENT
  }));
  cap.position.y = capY;
  cap.castShadow = true;
  root.add(cap);
  addOutline(cap, 0.03, outlineMat);

  // 꼭지
  const stemGeo = new THREE.CylinderGeometry(0.06, 0.1, 0.28, 10);
  const stem = new THREE.Mesh(stemGeo, toon(0x5c3d22));
  stem.position.y = capY + height + 0.1;
  root.add(stem);
  addOutline(stem, 0.026, outlineMat);

  return [];
}

// 선인장 가시와 머리 꽃
function addSpikes(root, ruler, spec) {
  const { color = 0xf5f0dc, flower = 0xf2a4c0 } = spec;

  // 가시는 능선을 따라 줄지어 난다. 아무 데나 뿌리면 보풀처럼 보인다.
  const ribs = 5;
  const places = [];
  for (let row = 0; row < 7; row++) {
    const y = ruler.at(0.16 + row * 0.115);
    const r = ruler.radiusAt(y);
    for (let i = 0; i < ribs; i++) {
      const a = (i / ribs) * Math.PI * 2 + (row % 2) * (Math.PI / ribs);
      places.push({
        x: Math.cos(a) * r * 0.96,
        y,
        z: Math.sin(a) * r * 0.96,
        // 원뿔의 +Y 축을 바깥으로 눕히고 끝을 살짝 위로 든다
        rz: -Math.PI / 2 + 0.34,
        ry: -a,
        s: 0.85 + (row % 3) * 0.18
      });
    }
  }
  const spikeGeo = new THREE.ConeGeometry(0.028, 0.22, 5);
  root.add(scatterInstances(spikeGeo, toon(color), places));

  // 머리 위 작은 꽃
  const petals = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    petals.push({
      x: Math.cos(a) * 0.14, y: ruler.top + 0.02, z: Math.sin(a) * 0.14, sy: 0.55
    });
  }
  root.add(scatterInstances(new THREE.SphereGeometry(0.13, 12, 8), toon(flower), petals));

  const core = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), toon(0xffe07a));
  core.position.y = ruler.top + 0.07;
  core.scale.y = 0.6;
  root.add(core);

  return [];
}

// 감자 싹 — 짧은 줄기 끝에 잎 두 장
function addSprouts(root, ruler, spec) {
  const { count = 3, color = '#8fbf62', length = 0.46 } = spec;
  const stemMat = toon(0x9ab86a);
  const leafMat = leafMaterial(color);

  const swaying = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.6;
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    pivot.position.set(Math.cos(a) * 0.16, ruler.top - 0.06, Math.sin(a) * 0.16);
    pivot.rotation.y = a;

    const stemLen = length * 0.74;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, stemLen, 8), stemMat);
    stem.position.y = stemLen / 2;
    pivot.add(stem);

    // 싹 끝에 잎 두 장이 마주 보게 달린다. 한 장이면 깃발처럼 보인다.
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(makeLeafGeometry(length * 0.5, length * 0.72), leafMat);
      leaf.position.set(side * length * 0.2, stemLen + length * 0.3, 0);
      leaf.rotation.z = side * 0.7;
      leaf.rotation.x = -0.4;
      pivot.add(leaf);
    }

    pivot.rotation.x = 0.18;
    pivot.userData.upright = Math.PI / 2 + 0.18;
    pivot.userData.phase = i * 1.7;
    root.add(pivot);
    swaying.push(pivot);
  }
  return swaying;
}

// 만두 꼭지 — 반죽 주름들이 가운데 위로 오므라들어 만두를 여민 모양.
// 잎 대신 이걸 얹으면 뿌리채소가 아니라 만두처럼 보인다.
function addPleat(root, ruler, spec, outlineMat, oW = 1) {
  const color = spec.color ?? 0xf3e2bf;
  const mat = toon(color);
  const topY = ruler.top;

  // 주름은 어깨(윗부분 넓은 데)에서 시작해 낮게 오므라든다. 좁은 꼭대기에서
  // 시작하면 한 점으로 뭉쳐 마늘 꼭지처럼 보인다.
  const baseFrac = 0.84;
  const baseY = ruler.at(baseFrac);
  const bodyR = ruler.radiusAt(baseY);
  const ringR = Math.max(0.2, bodyR * 0.92);

  // 반죽 주름 한 조각. foldLen 으로 크게(왕만두의 큼직한 주름) 만들 수 있다.
  const fl = spec.foldLen ?? 1;
  const foldGeo = new THREE.SphereGeometry(0.13, 12, 10);
  foldGeo.scale(0.72 * fl, 1.15 * fl, 0.55 * fl);
  foldGeo.translate(0, 0.12 * fl, 0);
  foldGeo.computeVertexNormals();

  // 주름들이 모여드는 꼭지. 기본은 낮게(여민 주름). spec.apex 를 키우면
  // 레퍼런스처럼 위로 봉긋 솟은 큰 꼭지가 된다.
  const apexLift = spec.apex ?? 0.07;
  const apex = new THREE.Vector3(0, topY + apexLift, 0);
  const up = new THREE.Vector3(0, 1, 0);

  const count = spec.count ?? 9;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.2;
    const base = new THREE.Vector3(Math.cos(a) * ringR, baseY, Math.sin(a) * ringR);
    const dir = apex.clone().sub(base).normalize();

    const pivot = new THREE.Group();
    pivot.position.copy(base);
    pivot.quaternion.setFromUnitVectors(up, dir);  // 조각의 위끝이 꼭지를 향하게

    const fold = new THREE.Mesh(foldGeo, mat);
    fold.castShadow = true;
    pivot.add(fold);
    addOutline(fold, 0.018 * oW, outlineMat);
    root.add(pivot);
  }

  // 여민 가운데 꼭지. 기본은 넓고 낮게. apex 를 키우면 위로 봉긋 솟은 큰 꼭지.
  const tipH = Math.max(0.12, apexLift * 0.8);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * fl, 0.15 * fl, tipH, 14), mat);
  tip.position.y = topY + apexLift * 0.5;
  tip.castShadow = true;
  root.add(tip);
  addOutline(tip, 0.018 * oW, outlineMat);

  return [];
}

// 'none' 은 머리 장식 없이 몸통만. (왕만두처럼 꼭지를 아예 없앨 때)
// 고라니 귀 — 크고 둥근 귀 한 쌍. 잎 대신 머리 위 양옆에 쫑긋 선다.
function addEars(root, ruler, spec, outlineMat, oW = 1) {
  const outer = toon(spec.color ?? 0xa5673a);
  const inner = toon(spec.inner ?? 0xecd2ab);
  const baseY = ruler.at(0.9);
  const ringR = Math.max(0.16, ruler.radiusAt(baseY) * 0.66);

  const earGeo = new THREE.SphereGeometry(0.3, 16, 12);
  earGeo.scale(0.72, 0.92, 0.4);   // 크고 둥근 고라니 귀 (덜 뾰족)
  earGeo.computeVertexNormals();
  const innerGeo = new THREE.SphereGeometry(0.3, 14, 10);
  innerGeo.scale(0.48, 0.64, 0.22);
  innerGeo.computeVertexNormals();

  for (const dir of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(dir * ringR, baseY + 0.02, 0.02);
    pivot.rotation.z = -dir * 0.42;   // 바깥으로 더 벌림
    pivot.rotation.x = -0.12;         // 뒤로 살짝 젖힘

    const ear = new THREE.Mesh(earGeo, outer);
    ear.position.y = 0.3;
    ear.castShadow = true;
    pivot.add(ear);
    addOutline(ear, 0.02 * oW, outlineMat);

    const inr = new THREE.Mesh(innerGeo, inner);
    inr.position.set(0, 0.3, 0.085);
    pivot.add(inr);

    root.add(pivot);
  }
  return [];
}

// 고라니 송곳니 — 입에서 아래로 뻗은 흰 엄니 한 쌍 (고라니의 상징).
// 뿌리(위)는 굵고 끝(아래)은 뾰족하게. 입 바로 밑, 얼굴 앞으로 붙인다.
function addFangs(root, ruler, outlineMat, oW = 1) {
  const white = toon(0xf7f2e8);
  const fangGeo = new THREE.CylinderGeometry(0.05, 0.006, 0.42, 10); // 위 굵고 아래 뾰족
  fangGeo.translate(0, -0.21, 0);   // 뿌리를 피벗에, 아래로 뻗게
  fangGeo.computeVertexNormals();

  const yTop = ruler.at(0.405);     // 입(0.42) 바로 아래에서 시작
  for (const dir of [-1, 1]) {
    const x = dir * 0.072;
    const pivot = new THREE.Group();
    pivot.position.set(x, yTop, ruler.surfaceZ(x, yTop) + 0.07);  // 얼굴 앞으로 확실히 튀어나오게
    pivot.rotation.z = dir * 0.17;   // 아래로 갈수록 바깥으로 벌어짐
    pivot.rotation.x = 0.14;         // 앞으로 살짝
    const fang = new THREE.Mesh(fangGeo, white);
    fang.castShadow = true;
    pivot.add(fang);
    addOutline(fang, 0.014 * oW, outlineMat);
    root.add(pivot);
  }
}

// 검은 코 — 얼굴 가운데. 눈과 입 사이에 붙는다.
// face.noseY 로 높이를, face.noseScale 로 크기를 조절한다(입 바로 위 작은 코 등).
function addNose(root, ruler, color, outlineMat, oW = 1, face = null) {
  const y = ruler.at(face?.noseY ?? 0.49);
  const s = face?.noseScale ?? 1;
  const flat = face?.noseFlat ?? 1;   // 1보다 작으면 세로로 납작해진다
  const geo = new THREE.SphereGeometry(0.09 * s, 16, 12);
  geo.scale(1.25, 0.85 * flat, 0.9);
  geo.computeVertexNormals();
  const nose = new THREE.Mesh(geo, toon(color));
  nose.position.set(0, y, ruler.surfaceZ(0, y) + 0.04);
  root.add(nose);
  addOutline(nose, 0.012 * oW, outlineMat);
}

// 천사 후광 — 머리 위에 뜬 금빛 링(셰이딩 없이 밝게 빛난다).
function addHalo(root, ruler, spec, outlineMat, oW = 1) {
  const color = (spec && spec.color) || 0xffe27a;
  const geo = new THREE.TorusGeometry(0.34, 0.055, 12, 32);
  const halo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
  halo.position.set(0, ruler.top + 0.7, 0.02);
  halo.rotation.x = Math.PI / 2 - 0.30;   // 살짝 눕혀 원반처럼 보이게
  root.add(halo);
  addOutline(halo, 0.012 * oW, outlineMat);
  return [];
}

// 악마 뿔 — 머리 위 양옆에서 위·바깥으로 뻗은 뾰족한 뿔 한 쌍.
function addHorns(root, ruler, spec, outlineMat, oW = 1) {
  const color = (spec && spec.color) || 0x5a1010;
  const baseY = ruler.at(0.9);
  const ringR = Math.max(0.13, ruler.radiusAt(baseY) * 0.52);
  const geo = new THREE.ConeGeometry(0.12, 0.48, 12);
  geo.translate(0, 0.24, 0);   // 밑동을 피벗에 맞춰 위로 뻗게
  geo.computeVertexNormals();
  for (const dir of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(dir * ringR, baseY, 0.03);
    pivot.rotation.z = dir * 0.55;   // 바깥으로 벌림
    pivot.rotation.x = -0.2;         // 뒤로 살짝
    const horn = new THREE.Mesh(geo, toon(color));
    horn.castShadow = true;
    pivot.add(horn);
    addOutline(horn, 0.02 * oW, outlineMat);
    root.add(pivot);
  }
  return [];
}

// 악마 삼지창 — 오른손에 세워 든 빨간 창(자루 + 세 갈래 창끝).
function addTrident(root, ruler, outlineMat) {
  const red = toon(0xd21f1f);
  const dark = toon(0x6e1414);
  const t = new THREE.Group();

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 10), dark);
  t.add(shaft); addOutline(shaft, 0.02, outlineMat);

  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.08), red);
  bar.position.set(0, 0.62, 0);
  t.add(bar); addOutline(bar, 0.02, outlineMat);

  const prong = () => new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.34, 10), red);
  const mid = prong(); mid.position.set(0, 0.86, 0); t.add(mid); addOutline(mid, 0.018, outlineMat);
  for (const dir of [-1, 1]) {
    const p = prong(); p.position.set(dir * 0.19, 0.84, 0); t.add(p); addOutline(p, 0.018, outlineMat);
  }

  // 오른손 쪽에 세워 든다(총 소품과 반대편).
  const armY = ruler.at(0.42);
  const handX = ruler.radiusAt(armY) * 0.82 + 0.22;
  t.position.set(handX, armY + 0.12, 0.28);
  t.rotation.set(0.12, 0, -0.1);
  root.add(t);
}

// 천사 십자가 — 손에 세워 든 금빛 십자가(세로 기둥 + 가로대).
function addCross(root, ruler, outlineMat) {
  const gold = toon(0xf2d98a);
  const c = new THREE.Group();

  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.5, 0.11), gold);
  c.add(shaft); addOutline(shaft, 0.02, outlineMat);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.11, 0.11), gold);
  arm.position.set(0, 0.5, 0);   // 위쪽 1/4 지점 가로대
  c.add(arm); addOutline(arm, 0.02, outlineMat);

  // 손에 세워 든다(삼지창과 같은 자리).
  const armY = ruler.at(0.42);
  const handX = ruler.radiusAt(armY) * 0.82 + 0.22;
  c.position.set(handX, armY + 0.12, 0.28);
  c.rotation.set(0.12, 0, -0.1);
  root.add(c);
}

// 오른쪽 날개 하나를 2D 로 그린다(흰 깃털 실루엣 + 깃털 선). 왼쪽은 평면을
// 좌우반전해 쓴다. 3D 깃털을 쌓는 것보다 훨씬 깔끔하고 조명에도 안 물든다.
function makeWingTexture(size = 360, dark = false) {
  const cv = canvas(size);
  const g = cv.getContext('2d');
  const S = size;
  // 색 팔레트: 천사(흰) / 악마(검). 결 선은 대비되게 반대 밝기로.
  const P = dark ? {
    fill: '#3b3a42', edge: '#141319',
    g0: 'rgba(15,14,20,0)', g1: 'rgba(8,7,12,0.55)',
    line: 'rgba(205,203,214,0.26)', cov: (a) => `rgba(198,196,208,${a * 0.55})`
  } : {
    fill: '#fdfdfb', edge: '#d1ccc0',
    g0: 'rgba(206,202,191,0)', g1: 'rgba(198,194,183,0.42)',
    line: 'rgba(150,146,136,0.5)', cov: (a) => `rgba(140,136,126,${a})`
  };

  // 트레일링(깃털 끝) 스캘럽 위치
  const tips = [[0.915, 0.37], [0.835, 0.52], [0.74, 0.645], [0.63, 0.735],
    [0.51, 0.80], [0.38, 0.835], [0.25, 0.835], [0.14, 0.81]];
  const silhouette = () => {
    g.beginPath();
    g.moveTo(S * 0.10, S * 0.82);
    g.bezierCurveTo(S * 0.18, S * 0.32, S * 0.55, S * 0.08, S * 0.94, S * 0.18);   // 앞전 → 날개끝
    let px = 0.94, py = 0.18;
    for (const [tx, ty] of tips) {
      g.quadraticCurveTo(S * ((px + tx) / 2 + 0.03), S * ((py + ty) / 2 + 0.05), S * tx, S * ty);
      px = tx; py = ty;
    }
    g.quadraticCurveTo(S * 0.09, S * 0.85, S * 0.10, S * 0.82);
    g.closePath();
  };
  silhouette(); g.fillStyle = P.fill; g.fill();

  g.save(); silhouette(); g.clip();
  // 음영(앞전-안쪽을 살짝 어둡게 → 깊이)
  const grd = g.createLinearGradient(S * 0.15, S * 0.15, S * 0.5, S * 0.9);
  grd.addColorStop(0, P.g0); grd.addColorStop(1, P.g1);
  g.fillStyle = grd; g.fillRect(0, 0, S, S);

  // 비행깃 결 선: 손목(갈라지는 지점)에서 각 트레일링 끝으로
  const wx = 0.34, wy = 0.30;
  g.lineWidth = S * 0.007; g.strokeStyle = P.line; g.lineCap = 'round';
  for (const [tx, ty] of tips) {
    g.beginPath();
    g.moveTo(S * wx, S * wy);
    g.quadraticCurveTo(S * (wx * 0.35 + tx * 0.65), S * (Math.min(wy, ty) + Math.abs(ty - wy) * 0.15), S * tx, S * (ty - 0.01));
    g.stroke();
  }
  // 덮깃(coverts) 층: 위쪽에 작은 스캘럽 곡선을 겹쳐 그려 결을 낸다
  const covert = (y0, x0, x1, bumps, depth, alpha) => {
    g.beginPath(); g.moveTo(S * x0, S * y0);
    for (let i = 1; i <= bumps; i++) {
      const t = i / bumps, x = x0 + (x1 - x0) * t;
      g.quadraticCurveTo(S * (x - (x1 - x0) / bumps * 0.5), S * (y0 + Math.sin(t * Math.PI) * 0.02 + depth * t), S * x, S * (y0 + depth * t));
    }
    g.lineWidth = S * 0.006; g.strokeStyle = P.cov(alpha); g.stroke();
  };
  covert(0.30, 0.30, 0.90, 7, 0.10, 0.5);
  covert(0.42, 0.24, 0.80, 7, 0.10, 0.45);
  covert(0.55, 0.20, 0.66, 6, 0.09, 0.4);
  g.restore();

  silhouette(); g.lineWidth = S * 0.011; g.strokeStyle = P.edge; g.lineJoin = 'round'; g.stroke();
  return textureFrom(cv);
}

// 날개 — 그린 텍스처를 판 두 개(좌우 대칭)에 붙여 등에 단다. dark 면 검은 날개.
function addWings(root, ruler, _outlineMat, dark = false) {
  const tex = makeWingTexture(360, dark);
  const shoulderY = ruler.at(0.46);
  const backZ = -ruler.radiusAt(shoulderY) - 0.06;
  const W = 1.7, H = 1.6;
  for (const dir of [-1, 1]) {
    // MeshBasic(빛 안 받음)이라 항상 순백. 뒷면도 보이게, 알파로 깃털 모양만.
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, depthWrite: false
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    plane.position.set(W * 0.32, H * 0.28, 0);   // 텍스처의 어깨(좌하단)가 그룹 원점 근처로
    const wing = new THREE.Group();
    wing.add(plane);
    wing.position.set(dir * (ruler.radiusAt(shoulderY) * 0.28), shoulderY, backZ);
    wing.rotation.y = dir * 0.32;   // 바깥으로 살짝 틀어 입체감
    wing.scale.set(dir, 1, 1);      // 왼쪽은 좌우 반전
    root.add(wing);
  }
}

// 네잎클로버 머리 장식(럭키라고라). 짧은 줄기 위에 둥근 잎 4장이 십자로.
function addClover(root, ruler, spec, outlineMat, oW = 1) {
  const green = toon(spec.color ?? 0x49b84f);   // 문자열 hex 도 THREE.Color 가 받는다
  const stemMat = toon(0x3c8a41);
  const baseY = ruler.top - 0.02;

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.32, 8), stemMat);
  stem.position.y = baseY + 0.16;
  root.add(stem); addOutline(stem, 0.012 * oW, outlineMat);

  // 둥근 잎(하트처럼 살짝 눌러) 4장을 중심에서 바깥으로 벌린다.
  const leafGeo = new THREE.SphereGeometry(0.22, 14, 12);
  leafGeo.scale(1.05, 1.0, 0.45);
  leafGeo.computeVertexNormals();
  const hubY = baseY + 0.4;
  const sway = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(0, hubY, 0);
    pivot.rotation.y = i * Math.PI / 2 + Math.PI / 4;   // 45° 돌려 십자 배치
    const leaf = new THREE.Mesh(leafGeo, green);
    leaf.position.set(0, 0.04, 0.2);      // 중심에서 바깥으로
    leaf.rotation.x = -0.55;              // 위로 벌림
    leaf.castShadow = true;
    pivot.add(leaf);
    addOutline(leaf, 0.016 * oW, outlineMat);
    root.add(pivot);
    sway.push(pivot);
  }
  return sway;   // 살랑살랑
}

// 강아지 귀 — 머리 양옆에서 아래로 축 처진 길쭉한 귀 한 쌍(가나디라고라).
function addDogEars(root, ruler, spec, outlineMat, oW = 1) {
  const mat = toon(spec.color ?? 0xffffff);
  const y = ruler.at(0.8);
  const ringR = Math.max(0.2, ruler.radiusAt(y) * 0.82);
  const earGeo = new THREE.SphereGeometry(0.21, 16, 12);   // 더 작은 귀
  earGeo.scale(0.5, 1.05, 0.36);   // 길쭉한 귀
  earGeo.translate(0, -0.19, 0);   // 밑동을 피벗에, 아래로 처지게
  earGeo.computeVertexNormals();
  for (const dir of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(dir * ringR, y + 0.08, 0.03);
    pivot.rotation.z = dir * 1.2;    // 옆으로 눕혀 아래로 처짐
    pivot.rotation.x = -0.12;
    const ear = new THREE.Mesh(earGeo, mat);
    ear.castShadow = true;
    pivot.add(ear);
    addOutline(ear, 0.02 * oW, outlineMat);
    root.add(pivot);
  }
  return [];
}

// 강아지 꼬리 — 엉덩이(뒤 아래)에 붙는 작고 뭉툭한 꼬리.
function addTail(root, ruler, spec, outlineMat, oW = 1) {
  const mat = toon((spec && spec.color) || 0xffffff);
  const y = ruler.at(0.2);
  const z = -ruler.radiusAt(y) - 0.02;
  const geo = new THREE.SphereGeometry(0.16, 12, 10);
  geo.scale(0.55, 1.15, 0.55);
  const tail = new THREE.Mesh(geo, mat);
  tail.position.set(0, y + 0.16, z);
  tail.rotation.x = 0.7;   // 뒤로 살짝 치켜올림
  tail.castShadow = true;
  root.add(tail);
  addOutline(tail, 0.018 * oW, outlineMat);
}

const TOPS = { leaves: addLeaves, cap: addCap, acorn: addAcornCap, spikes: addSpikes, sprout: addSprouts, pleat: addPleat, ears: addEars, clover: addClover, dogears: addDogEars, none: () => [] };

// ---------------------------------------------------------------- 소품 (보스라고라)

// 선글라스 — 눈을 덮는 검은 렌즈 두 짝에 콧대 다리. 눈 자리에 그대로 얹는다.
function addShades(root, ruler, eyeY, eyeGap, outlineMat) {
  const dark = new THREE.MeshToonMaterial({ color: 0x14161c, gradientMap: GRADIENT });
  const lensY = eyeY + 0.008;
  const proud = 0.05;   // 눈보다 조금 더 앞으로 내밀어 확실히 덮는다

  const lensGeo = new THREE.SphereGeometry(0.15, 18, 14);
  lensGeo.scale(1.2, 0.92, 0.34);
  lensGeo.computeVertexNormals();

  for (const dir of [-1, 1]) {
    const x = dir * eyeGap;
    const z = ruler.surfaceZ(x, lensY) + proud;

    const lens = new THREE.Mesh(lensGeo, dark);
    lens.position.set(x, lensY, z);
    root.add(lens);
    addOutline(lens, 0.02, outlineMat);

    // 유리에 비친 빛 한 줄
    const glint = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xcfe6ff })
    );
    glint.position.set(x - dir * 0.055, lensY + 0.045, z + 0.05);
    glint.scale.set(1.8, 0.7, 1);
    root.add(glint);
  }

  // 콧대 다리 — 두 렌즈 사이를 잇는다
  const bridgeZ = ruler.surfaceZ(0, lensY) + proud;
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(eyeGap * 1.2, 0.035, 0.05), dark);
  bridge.position.set(0, lensY + 0.03, bridgeZ);
  root.add(bridge);
}

// 권총 — 상자 몇 개로 조립한 만화풍 권총. 왼손에 총구가 위를 보게 세워 든다.
// (담배가 입 오른쪽에 있어, 권총은 왼쪽에 둬서 겹치지 않게 한다.)
function addGun(root, ruler, outlineMat) {
  const metal = new THREE.MeshToonMaterial({ color: 0x2b2f36, gradientMap: GRADIENT });
  const gun = new THREE.Group();

  // 총열(슬라이드) — 위로 향한 긴 상자. 카드에서도 보이게 큼직하게.
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.62, 0.21), metal);
  slide.position.set(0, 0.16, 0);
  gun.add(slide);
  addOutline(slide, 0.026, outlineMat);

  // 손잡이 — 아래로 살짝 기울여
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.34, 0.2), metal);
  grip.position.set(-0.03, -0.2, 0);
  grip.rotation.z = 0.22;
  gun.add(grip);
  addOutline(grip, 0.026, outlineMat);

  // 방아쇠울 — 손잡이 앞의 작은 고리
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 8, 14), metal);
  guard.position.set(0.03, -0.04, 0);
  gun.add(guard);

  // 왼손 앞에 세워 든다. 몸 옆으로 조금 더 내밀어 확실히 보이게.
  const armY = ruler.at(0.42);
  const handX = ruler.radiusAt(armY) * 0.82 + 0.2;
  gun.position.set(-handX, armY + 0.06, 0.3);
  gun.rotation.set(0.18, 0, 0.14);
  gun.scale.setScalar(1.15);
  root.add(gun);
}

// 담배 — 입에 문 흰 막대에 불붙은 끝과 연기. 흰 막대가 밝은 몸통에 묻히지
// 않게, 테두리와 갈색 필터로 대비를 준다.
function addCigarette(root, ruler, outlineMat) {
  const mouthY = ruler.at(0.42);
  const paper = new THREE.MeshToonMaterial({ color: 0xfbf8f0, gradientMap: GRADIENT });
  const cig = new THREE.Group();

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.46, 12), paper);
  stick.rotation.z = Math.PI / 2;
  cig.add(stick);
  addOutline(stick, 0.016, outlineMat);   // 검은 테두리로 흰 담배를 또렷하게

  // 물리는 쪽 갈색 필터 — 대비를 준다
  const filter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.044, 0.044, 0.1, 12),
    new THREE.MeshToonMaterial({ color: 0xc08a4a, gradientMap: GRADIENT })
  );
  filter.rotation.z = Math.PI / 2;
  filter.position.x = -0.19;
  cig.add(filter);

  // 불붙은 끝 — 크고 밝게
  const ember = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.044, 0.06, 12),
    new THREE.MeshBasicMaterial({ color: 0xff5a1e })
  );
  ember.rotation.z = Math.PI / 2;
  ember.position.x = 0.25;
  cig.add(ember);

  // 피어오르는 연기 몇 조각
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0xeaeff5, transparent: true, opacity: 0.4 });
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.055 + i * 0.025, 8, 8), smokeMat);
    puff.position.set(0.3 + i * 0.02, 0.16 + i * 0.15, 0);
    cig.add(puff);
  }

  // 입 오른쪽 끝에 물린 자리
  const x = 0.11;
  const y = mouthY - 0.015;
  cig.position.set(x + 0.17, y, ruler.surfaceZ(x, y) + 0.06);
  cig.rotation.z = -0.16;
  root.add(cig);
}

// ---------------------------------------------------------------- 조립

export function buildPlant(id) {
  const spec = findCharacter(id);
  const ruler = makeRuler(spec.profile);
  const { at, radiusAt, surfaceZ, decalZ } = ruler;
  const root = new THREE.Group();

  // 우드라고라/좌드라고라: 몸을 세로로 반 잘라 한쪽만 남긴다. 팔·발·눈·볼도
  // 그쪽만 붙이고, 잘린 단면은 아래에서 납작한 뚜껑으로 막는다.
  //   half: true|'right' → 오른쪽(x≥0),  half: 'left' → 왼쪽(x≤0)
  const half = !!spec.half;
  const leftHalf = spec.half === 'left';
  const halfSide = half ? (leftHalf ? 'left' : 'right') : null;
  const DIRS = half ? [leftHalf ? -1 : 1] : [-1, 1];   // 붙이는 쪽(남은 반쪽)

  // ---- 몸통 -------------------------------------------------------------
  // 반 바퀴만 돌려 한쪽 반만 만든다. phi=0 은 앞(+Z), π/2 는 오른(+X), π 는 뒤(-Z),
  // 3π/2 는 왼(-X). 오른쪽은 phi 0→π(x≥0), 왼쪽은 phi π→2π(x≤0).
  const bodyGeo = new THREE.LatheGeometry(
    spec.profile.map(([y, r]) => new THREE.Vector2(r, y)),
    48, leftHalf ? Math.PI : 0, half ? Math.PI : Math.PI * 2
  );
  if (spec.lumpy) roughen(bodyGeo, spec.lumpy);
  // 망고처럼 살짝 휘게. 아웃라인이 이 지오메트리를 복사하므로 반드시 먼저 휜다.
  const bendX = spec.bend ? makeBend(spec.bend, ruler.top) : null;
  if (bendX) bendGeometry(bodyGeo, bendX);

  // outlineColor/outlineWidth 로 캐릭터마다 테두리 색·굵기를 바꿀 수 있다
  // (예: 왕만두는 굵은 검은 선으로 스티커처럼).
  const outlineMat = newOutlineMaterial(spec.outlineColor);
  const oW = spec.outlineWidth ?? 1;
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshToonMaterial({
    map: makeBodyTexture(spec), gradientMap: GRADIENT
  }));
  body.name = 'body';   // 히트박스와 견주어 보려고 이름을 달아 둔다
  body.castShadow = true;
  root.add(body);
  addOutline(body, 0.03 * oW, outlineMat);

  // 잘린 단면(x=0 평면)을 납작한 뚜껑으로 막는다. 안 막으면 속이 뻥 뚫려 보인다.
  // 단면 윤곽 = 옆모습을 앞(z=+r)으로 올라갔다 뒤(z=-r)로 내려오는 대칭 도형.
  if (half) {
    const shape = new THREE.Shape();
    const pts = [];
    for (const [y, r] of spec.profile) pts.push([r, y]);           // 앞쪽 가장자리
    for (let i = spec.profile.length - 1; i >= 0; i--) {
      const [y, r] = spec.profile[i]; pts.push([-r, y]);           // 뒤쪽 가장자리
    }
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    const capGeo2 = new THREE.ShapeGeometry(shape);
    const innerColor = new THREE.Color(spec.body).multiplyScalar(0.82);  // 속살은 조금 어둡게
    const cap = new THREE.Mesh(capGeo2, new THREE.MeshToonMaterial({
      color: innerColor, gradientMap: GRADIENT, side: THREE.DoubleSide
    }));
    cap.rotation.y = Math.PI / 2;   // 그림 평면(XY)을 x=0 단면(ZY)으로 세운다
    cap.name = 'cut';
    root.add(cap);
    addOutline(cap, 0.02 * oW, outlineMat);
  }

  const skinMat = toon(spec.body);

  // ---- 발 — 앞으로 살짝 나온 콩알 두 개 ----------------------------------
  // 발이 없으면 얼굴 붙인 달걀처럼 보인다. 실루엣에서 제일 크게 달라지는 부분.
  //
  // 발을 몸통 바닥과 같은 높이에 두면 둥근 배에 파묻혀 안 보인다.
  // 몸통보다 아래로 내밀어서, 몸이 발 위에 올라선 모양이 되게 한다.
  const footGeo = new THREE.SphereGeometry(0.18, 16, 12);
  footGeo.scale(1, 0.58, 1.5);
  footGeo.computeVertexNormals();

  const hipX = Math.max(0.15, radiusAt(at(0.1)) * 0.42);
  const feet = [];
  for (const dir of DIRS) {
    const pivot = new THREE.Group();
    pivot.position.set(dir * hipX, 0.02, 0.02);

    const foot = new THREE.Mesh(footGeo, skinMat);
    foot.position.set(0, -0.10, 0.07);
    foot.castShadow = true;
    pivot.add(foot);
    addOutline(foot, 0.026 * oW, outlineMat);

    pivot.userData.dir = dir;
    root.add(pivot);
    feet.push(pivot);
  }

  // ---- 팔 — 옆구리에 붙은 작은 혹 ---------------------------------------
  const armY = at(0.42);
  const long = spec.armScale ?? 1;
  const armGeo = new THREE.SphereGeometry(0.125, 16, 12);
  armGeo.scale(1.35 * long, 0.9, 0.9);
  armGeo.computeVertexNormals();

  const arms = [];
  for (const dir of DIRS) {
    const pivot = new THREE.Group();
    pivot.position.set(dir * radiusAt(armY) * 0.82, armY, 0);

    const arm = new THREE.Mesh(armGeo, skinMat);
    arm.position.x = dir * 0.09 * long;
    arm.castShadow = true;
    pivot.add(arm);
    addOutline(arm, 0.026 * oW, outlineMat);

    pivot.userData.dir = dir;
    // 선인장은 팔을 위로 들고 있다.
    // z 축 회전은 +x 쪽 팔에서 양수가 위로 든다. 부호를 뒤집으면 축 처진다.
    pivot.userData.base = spec.armStyle === 'up' ? dir * 0.9 : dir * -0.3;
    pivot.rotation.z = pivot.userData.base;
    root.add(pivot);
    arms.push(pivot);
  }

  // ---- 얼굴 -------------------------------------------------------------
  // 눈은 네 겹이다. 검은자만 있으면 눈이 뻥 뚫린 것처럼 보여 무섭다.
  //   테 → 흰자 → 검은자 → 반사광
  // 흰자만 얹으면 몸 색과 비슷해 눈으로 안 읽히므로 테가 꼭 필요하다.
  const eyeY = at(spec.face?.eyeY ?? 0.56);   // face.eyeY 로 눈 높이 조절
  const ringGeo = new THREE.SphereGeometry(0.163, 18, 14);
  const ringMat = new THREE.MeshBasicMaterial({ color: COLOR.outline });
  const scleraGeo = new THREE.SphereGeometry(0.145, 18, 14);
  // 캐릭터마다 흰자·눈동자 색을 바꿀 수 있다(예: 흑화 = 붉은 눈).
  const scleraMat = new THREE.MeshBasicMaterial({ color: spec.face?.sclera ?? COLOR.sclera });
  const pupilGeo = new THREE.SphereGeometry(0.092, 18, 14);
  const pupilMat = new THREE.MeshBasicMaterial({ color: spec.face?.eye ?? COLOR.eye });
  const glintGeo = new THREE.SphereGeometry(0.036, 10, 8);
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  // 몸이 가늘면 눈도 좁게 붙여야 옆으로 삐져나가지 않는다.
  // 눈을 크게 키우면 코 쪽에서 붙으므로, face.eyeGap 으로 간격을 넓힐 수 있다.
  const eyeGap = spec.face?.eyeGap ?? Math.min(0.175, radiusAt(eyeY) * 0.42);

  // 표정. 캐릭터마다 눈동자·눈썹을 조금씩 어긋내 개성을 준다.
  //   face.pupil : [[왼dx,왼dy],[오dx,오dy]]  검은자 이동 (사시·얼빠짐용)
  //   face.brow  : [왼raise, 오raise]          눈썹 높이 어긋내기
  // 없으면(대부분) 기본 순한 표정 그대로.
  const face = spec.face ?? null;
  const eyeIndex = (dir) => (dir < 0 ? 0 : 1);

  const browGeo = new THREE.SphereGeometry(0.062, 12, 8);
  browGeo.scale(1.75, 0.42, 0.4);
  browGeo.computeVertexNormals();

  // 눈알은 표면에서 재서 얹는다.
  //
  // 표면 z 에 비율을 곱하면(z * 0.8 같은 식) 몸이 굵을수록 더 깊이 파묻힌다.
  // 선인장처럼 통통한 몸에서는 눈이 통째로 몸 안에 들어가 실눈이 돼 버렸다.
  // 몸 굵기와 무관하게 "표면에서 이만큼 튀어나온다"로 정해야 한다.
  const layer = (geo, zScale, proud) => ({ geo, zScale, proud });
  const EYE_LAYERS = [
    layer(ringGeo, 0.30, 0.010),    // 테
    layer(scleraGeo, 0.32, 0.020),  // 흰자
    layer(pupilGeo, 0.32, 0.028),   // 검은자
    layer(glintGeo, 0.38, 0.036)    // 반사광
  ];

  for (const dir of DIRS) {
    const x = dir * eyeGap;
    const z = surfaceZ(x, eyeY);
    const depth = (i) => {
      const { geo, zScale, proud } = EYE_LAYERS[i];
      geo.computeBoundingSphere();
      return z + proud - geo.boundingSphere.radius * zScale;
    };

    // 눈 크기 배율. 좌우를 다르게 주면 짝짝이 눈이 되어 어리둥절·못생긴 느낌.
    const es = face?.eyeScale?.[eyeIndex(dir)] ?? 1;

    // face.eyeAspect 로 세로 비율을 바꾼다(1.2=살짝 세로로, 1.0=완전 동그라미).
    const aspect = face?.eyeAspect ?? 1.2;
    // face.eyeBulge 로 앞뒤 두께를 키운다. 기본 눈은 납작한 원반이라 비스듬히
    // 보면 타원으로 보인다. 1보다 키우면 공처럼 통통해 어느 각도든 동그랗다.
    const bulge = face?.eyeBulge ?? 1;

    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(x, eyeY, depth(0));
    ring.scale.set(es, aspect * es, 0.30 * bulge);
    root.add(ring);

    const sclera = new THREE.Mesh(scleraGeo, scleraMat);
    sclera.position.set(x, eyeY, depth(1));
    sclera.scale.set(es, aspect * es, 0.32 * bulge);
    root.add(sclera);

    // 검은자를 살짝 위로 올리면 아래쪽에 흰자가 더 보여 순해 보인다.
    // 표정이 있으면 눈동자를 그만큼 어긋내 사시·얼빠진 눈을 만든다.
    const ps = face?.pupil?.[eyeIndex(dir)] ?? [0, 0];
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(x + ps[0], eyeY + 0.026 + ps[1], depth(2));
    pupil.scale.set(es, Math.min(aspect, 1.1) * es, 0.32 * bulge);
    root.add(pupil);

    // 반사광(생기 있는 눈). face.glint:false 면 뺀다 → 죽은 듯 음산한 눈.
    if (face?.glint !== false) {
      const glint = new THREE.Mesh(glintGeo, glintMat);
      glint.position.set(x - dir * 0.03 + ps[0], eyeY + 0.058 + ps[1], depth(3));
      glint.scale.set(es, es, 0.38);
      root.add(glint);
    }

    // 눈썹. 눈만 있으면 표정이 없어 인형처럼 보인다.
    // face.browAngle 로 기울기를 키우면(예: 2.5) 안쪽이 처져 성난 표정이 된다.
    // face.brows:false 면 눈썹을 아예 뺀다(강아지처럼 눈만 동그란 얼굴).
    if (face?.brows !== false) {
      const browRaise = face?.brow?.[eyeIndex(dir)] ?? 0;
      const browY = eyeY + 0.2 + browRaise;
      const brow = new THREE.Mesh(browGeo, ringMat);
      brow.position.set(x, browY, surfaceZ(x, browY) * 0.86);
      brow.rotation.z = dir * 0.2 * (face?.browAngle ?? 1);
      root.add(brow);
    }
  }

  // 입 (기본은 웃는 입, spec.mouth 로 표정을, spec.mouthScale 로 크기를 바꾼다)
  const mouthY = at(spec.face?.mouthY ?? 0.42);   // face.mouthY 로 입 높이 조절(코 밑에 붙이기 등)
  const ms = spec.mouthScale ?? 1;
  const mouthGeo = new THREE.PlaneGeometry(0.44 * ms, 0.44 * ms);
  // 반쪽이면 입도 절단선(x=0)에서 딱 자른다. 남은 쪽 반대편 정점을 x=0·uv 0.5
  // 로 접어, 남은 쪽 절반(입 텍스처의 그쪽 반)만 남긴다.
  if (half) {
    const pos = mouthGeo.attributes.position, uv = mouthGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      // 오른쪽만 남길 땐 x<0 을, 왼쪽만 남길 땐 x>0 을 절단선으로 접는다.
      if (leftHalf ? x > 0 : x < 0) { pos.setX(i, 0); uv.setX(i, 0.5); }
    }
    pos.needsUpdate = true; uv.needsUpdate = true;
  }
  const mouth = new THREE.Mesh(
    mouthGeo,
    new THREE.MeshBasicMaterial({ map: makeMouthTexture(spec.mouth), transparent: true })
  );
  mouth.position.set(0, mouthY, decalZ(0, mouthY));
  root.add(mouth);

  // 볼 홍조. face.blush:false 면 뺀다 → 귀여운 티를 없앤다(흑화 등).
  if (face?.blush !== false) {
    const blushGeo = new THREE.CircleGeometry(0.095, 18);
    const blushMat = new THREE.MeshBasicMaterial({
      color: COLOR.blush, transparent: true, opacity: 0.8
    });
    // 볼은 몸 옆면을 넘지 않게 붙인다. 넉넉하게 벌리면 통통한 몸에서는
    // 실루엣 밖으로 삐져나가 허공에 분홍 얼룩이 뜬다.
    const blushY = at(0.49);
    const blushGap = Math.min(0.34, radiusAt(blushY) * 0.6);
    for (const dir of DIRS) {
      const x = dir * blushGap;
      const blush = new THREE.Mesh(blushGeo, blushMat);
      blush.position.set(x, blushY, decalZ(x, blushY));
      blush.rotation.y = dir * 0.62;
      blush.scale.set(1.3, 0.85, 1);
      root.add(blush);
    }
  }

  // ---- 소품 -------------------------------------------------------------
  if (spec.shades) addShades(root, ruler, eyeY, eyeGap, outlineMat);
  if (spec.hold === 'gun') addGun(root, ruler, outlineMat);
  if (spec.cigarette) addCigarette(root, ruler, outlineMat);
  if (spec.fangs) addFangs(root, ruler, outlineMat, oW);
  if (spec.nose != null) addNose(root, ruler, spec.nose, outlineMat, oW, spec.face);
  if (spec.halo) addHalo(root, ruler, spec.halo, outlineMat, oW);     // 천사 후광
  if (spec.horns) addHorns(root, ruler, spec.horns, outlineMat, oW);  // 악마 뿔
  if (spec.wings) addWings(root, ruler, outlineMat, spec.wings === 'dark');  // 날개(등): 흰/검
  if (spec.trident) addTrident(root, ruler, outlineMat);              // 악마 삼지창(손)
  if (spec.cross) addCross(root, ruler, outlineMat);                  // 천사 십자가(손)
  if (spec.tail) addTail(root, ruler, spec.tail, outlineMat, oW);     // 강아지 꼬리

  // 뭐라고라: 머리 옆에 떠 있는 물음표 "?"
  if (spec.question) {
    const q = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ map: makeQuestionTexture(), transparent: true, depthWrite: false })
    );
    q.position.set(radiusAt(ruler.top) * 0 + 0.62, ruler.top + 0.34, 0.22);
    q.rotation.z = 0.18;
    root.add(q);
  }

  // ---- 머리 장식 ---------------------------------------------------------
  const swaying = (TOPS[spec.top.kind] ?? addLeaves)(root, ruler, spec.top, outlineMat, oW, halfSide);

  // 몸통을 휘었으면, 장식도 각자 높이의 bendX 만큼 옆으로 밀어 휜 표면에
  // 그대로 얹는다. 몸통(이미 정점을 휘었다)만 빼고 전부 민다.
  if (bendX) {
    for (const child of root.children) {
      if (child === body) continue;
      child.position.x += bendX(child.position.y);
    }
  }

  // ---- 살아 있는 느낌 ---------------------------------------------------
  // Player 가 매 프레임 불러 준다. speed 는 현재 이동 속도.
  root.userData.animate = (t, speed, grounded) => {
    const move = Math.min(speed / 8, 1);
    const stride = t * (5 + move * 9);

    // 잎·싹이 바람에 흔들리듯
    for (const leaf of swaying) {
      const { upright, phase } = leaf.userData;
      leaf.rotation.x = upright - Math.PI / 2 + Math.sin(t * 2.6 + phase) * (0.07 + move * 0.16);
      leaf.rotation.z = Math.sin(t * 1.9 + phase * 1.7) * (0.06 + move * 0.12);
    }

    // 팔은 움직일수록 크게 젓는다
    for (const arm of arms) {
      const d = arm.userData.dir;
      arm.rotation.z = arm.userData.base
        + Math.sin(stride + (d > 0 ? 0 : Math.PI)) * d * (0.2 + move * 0.55);
    }

    // 발은 팔과 반대로 나간다. 공중에서는 접는다.
    for (const foot of feet) {
      const d = foot.userData.dir;
      foot.rotation.x = grounded
        ? Math.sin(stride + (d > 0 ? Math.PI : 0)) * move * 0.62
        : -0.42;
    }

    // 서 있을 때 숨쉬듯 부풀었다 줄었다
    const breathe = grounded ? Math.sin(t * 2.2) * 0.022 : 0;
    body.scale.set(1 + breathe, 1 - breathe, 1 + breathe);
  };

  // ---- 조합 캐릭터(많다고라 등) --------------------------------------------
  // spec.companions: 본체 둘레에 다른 캐릭터를 작게 세운다.
  //   { id, scale(본체 키 대비), x, z(바닥 위치), rot(y 회전) }
  // 각 동반 캐릭터를 buildPlant 로 만들고, 원하는 키로 맞춘 뒤 발바닥을 바닥에 붙인다.
  if (Array.isArray(spec.companions)) {
    for (const c of spec.companions) {
      const sub = buildPlant(c.id);
      const size = new THREE.Vector3();
      new THREE.Box3().setFromObject(sub).getSize(size);
      const h = size.y > 1e-4 ? size.y : 1;
      sub.scale.setScalar(((c.scale ?? 0.4) * ruler.top) / h);   // 본체 키의 scale 배
      const floor = new THREE.Box3().setFromObject(sub);
      sub.position.set(c.x ?? 0, -floor.min.y, c.z ?? 0);        // 발바닥을 y=0 에
      sub.rotation.y = c.rot ?? 0;
      root.add(sub);
    }
  }

  return root;
}
