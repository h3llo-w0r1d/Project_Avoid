import * as THREE from 'three';

// 무대에 쓰는 무늬를 전부 캔버스로 그린다. 이미지 파일 의존이 없다.

const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- 잔디 상판

// CircleGeometry 의 기본 UV 는 원이 정사각형 텍스처에 내접하도록 잡히므로,
// 캔버스 중심을 무대 중심으로 두고 극좌표로 그리면 그대로 맞아떨어진다.
export function makeGrassTexture(size = 1024) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const c = size / 2;
  const R = size / 2;

  g.fillStyle = '#3f6b3c';
  g.fillRect(0, 0, size, size);

  // 넓게 번지는 색 얼룩 — 잔디가 균일하면 인조 잔디처럼 보인다
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    const rad = rnd(size * 0.04, size * 0.14);
    const grad = g.createRadialGradient(
      c + Math.cos(a) * r, c + Math.sin(a) * r, 0,
      c + Math.cos(a) * r, c + Math.sin(a) * r, rad
    );
    const tone = ['#4b7d44', '#375f34', '#54874a', '#33562f'][(Math.random() * 4) | 0];
    grad.addColorStop(0, tone);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, rad, 0, Math.PI * 2);
    g.fill();
  }

  // 풀잎 — 짧은 선을 잔뜩 그어 결을 만든다
  g.lineCap = 'round';
  for (let i = 0; i < 9000; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    const len = rnd(size * 0.004, size * 0.012);
    const dir = rnd(0, Math.PI * 2);
    const shade = ['#598f4c', '#2f5530', '#6aa257', '#456f3d'][(Math.random() * 4) | 0];
    g.strokeStyle = shade;
    g.globalAlpha = rnd(0.25, 0.8);
    g.lineWidth = rnd(size * 0.0012, size * 0.0028);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
    g.stroke();
  }
  g.globalAlpha = 1;

  // 밟혀서 흙이 드러난 자국 — 중심에서 얼마나 떨어졌는지 눈으로 재는 기준
  g.save();
  g.translate(c, c);
  for (const [rr, alpha] of [[0.3, 0.2], [0.55, 0.16], [0.77, 0.2]]) {
    g.beginPath();
    g.arc(0, 0, R * rr, 0, Math.PI * 2);
    g.strokeStyle = `rgba(122, 96, 62, ${alpha})`;
    g.lineWidth = size * 0.012;
    g.setLineDash([size * 0.05, size * 0.03]);
    g.stroke();
  }
  g.setLineDash([]);

  // 흙 얼룩
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R * 0.92;
    const rad = rnd(size * 0.012, size * 0.04);
    g.beginPath();
    g.ellipse(Math.cos(a) * r, Math.sin(a) * r, rad, rad * rnd(0.5, 0.9), Math.random() * 3, 0, Math.PI * 2);
    g.fillStyle = `rgba(120, 92, 58, ${rnd(0.12, 0.32)})`;
    g.fill();
  }

  // 작은 들꽃
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R * 0.9;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    const petal = size * rnd(0.0022, 0.0038);
    g.fillStyle = ['#f2e6a8', '#f0d7e4', '#fdf6df'][(Math.random() * 3) | 0];
    for (let k = 0; k < 5; k++) {
      const pa = (k / 5) * Math.PI * 2;
      g.beginPath();
      g.arc(x + Math.cos(pa) * petal, y + Math.sin(pa) * petal, petal, 0, Math.PI * 2);
      g.fill();
    }
  }

  // 가장자리 — 잔디가 끝나고 맨흙이 드러나는 띠
  const bandIn = R * 0.9;
  g.save();
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.arc(0, 0, bandIn, 0, Math.PI * 2, true);
  g.clip();
  const edge = g.createRadialGradient(0, 0, bandIn, 0, 0, R);
  edge.addColorStop(0, 'rgba(104, 80, 50, 0)');
  edge.addColorStop(0.45, 'rgba(104, 80, 50, 0.85)');
  edge.addColorStop(1, 'rgba(78, 58, 36, 1)');
  g.fillStyle = edge;
  g.fillRect(-R, -R, size, size);
  g.restore();

  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------- 흙 절벽

// 무대 옆면. 지층처럼 가로줄이 쌓이고 돌이 박혀 있다.
export function makeSoilTexture(w = 512, h = 256) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');

  g.fillStyle = '#4a3524';
  g.fillRect(0, 0, w, h);

  // 지층
  let y = 0;
  while (y < h) {
    const band = rnd(h * 0.05, h * 0.16);
    const tone = ['#553d29', '#42301f', '#5e4530', '#3a2a1b'][(Math.random() * 4) | 0];
    g.fillStyle = tone;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += w / 16) {
      g.lineTo(x, y + Math.sin(x * 0.02 + y) * h * 0.012);
    }
    g.lineTo(w, y + band);
    g.lineTo(0, y + band);
    g.closePath();
    g.fill();
    y += band;
  }

  // 박힌 돌
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * w;
    const yy = rnd(h * 0.1, h);
    const rad = rnd(h * 0.008, h * 0.03);
    g.beginPath();
    g.ellipse(x, yy, rad, rad * rnd(0.5, 0.9), Math.random() * 3, 0, Math.PI * 2);
    g.fillStyle = `rgba(150, 140, 126, ${rnd(0.25, 0.6)})`;
    g.fill();
    g.beginPath();
    g.ellipse(x, yy - rad * 0.3, rad * 0.7, rad * 0.35, Math.random() * 3, 0, Math.PI * 2);
    g.fillStyle = 'rgba(190, 182, 168, 0.25)';
    g.fill();
  }

  // 위쪽 — 잔디가 흙 위로 살짝 덮인 경계
  const top = g.createLinearGradient(0, 0, 0, h * 0.16);
  top.addColorStop(0, '#43703d');
  top.addColorStop(0.6, 'rgba(67, 112, 61, 0.5)');
  top.addColorStop(1, 'rgba(67, 112, 61, 0)');
  g.fillStyle = top;
  g.fillRect(0, 0, w, h * 0.16);

  // 아래로 갈수록 어둡게
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.85)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  return tex;
}

// ---------------------------------------------------------------- 하늘

// 위는 짙은 땅거미, 아래는 노을이 남은 따뜻한 색.
export function makeSkyTexture(h = 512) {
  const cv = document.createElement('canvas');
  cv.width = 4;
  cv.height = h;
  const g = cv.getContext('2d');

  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.00, '#0d1524');
  grad.addColorStop(0.40, '#1b2c3a');
  grad.addColorStop(0.62, '#31414a');
  grad.addColorStop(0.80, '#5c5644');
  grad.addColorStop(1.00, '#7a6647');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, h);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- 빛망울

// 가장자리로 갈수록 사라지는 둥근 점. 안 쓰면 Points 가 네모로 찍혀서
// 꽃가루가 아니라 흩날리는 종잇조각처럼 보인다.
export function makeSoftDotTexture(size = 64) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const c = size / 2;

  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- 이름표

// 캐릭터 머리 위에 띄울 라벨. 알약 모양 배경에 글자를 얹는다.
// 배경이 없으면 밝은 잔디 위에서 흰 글자가 묻힌다.
export function makeLabelTexture(text, color = '#4fd6ff') {
  const W = 320;
  const H = 120;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');

  const pad = 12;
  const r = (H - pad * 2) / 2;
  const x0 = pad;
  const y0 = pad;
  const w = W - pad * 2;
  const h = H - pad * 2;

  g.beginPath();
  g.moveTo(x0 + r, y0);
  g.lineTo(x0 + w - r, y0);
  g.arcTo(x0 + w, y0, x0 + w, y0 + r, r);
  g.lineTo(x0 + w, y0 + h - r);
  g.arcTo(x0 + w, y0 + h, x0 + w - r, y0 + h, r);
  g.lineTo(x0 + r, y0 + h);
  g.arcTo(x0, y0 + h, x0, y0 + h - r, r);
  g.lineTo(x0, y0 + r);
  g.arcTo(x0, y0, x0 + r, y0, r);
  g.closePath();

  g.fillStyle = 'rgba(8, 12, 24, 0.72)';
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 5;
  g.stroke();

  g.font = '700 60px "Pretendard", "Noto Sans KR", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, W / 2, H / 2 + 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- 풀포기

// 바닥에 심을 풀 한 포기. 알파로 잎 모양을 뚫는다.
export function makeGrassTuftTexture(size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');

  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const baseX = size * (0.18 + (i / (blades - 1)) * 0.64) + rnd(-4, 4);
    const tipX = baseX + rnd(-size * 0.22, size * 0.22);
    const tipY = size * rnd(0.06, 0.42);
    const width = size * rnd(0.035, 0.06);

    g.beginPath();
    g.moveTo(baseX - width / 2, size);
    g.quadraticCurveTo(baseX - width * 0.3, (size + tipY) / 2, tipX, tipY);
    g.quadraticCurveTo(baseX + width * 0.3, (size + tipY) / 2, baseX + width / 2, size);
    g.closePath();

    const grad = g.createLinearGradient(0, size, 0, tipY);
    grad.addColorStop(0, '#2f5530');
    grad.addColorStop(1, ['#6fa85a', '#8bbf62', '#5c9450'][(Math.random() * 3) | 0]);
    g.fillStyle = grad;
    g.fill();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- 설원 상판

// 눈밭. 잔디 텍스처를 색만 바꿔서는 만들 수 없다 — 재질 색은 무늬에 '곱해'
// 지므로 초록을 흰색으로 밝게 만들 방법이 없다(곱셈은 어둡게만 한다).
// 그래서 무늬 자체를 따로 그린다.
//
// 잔디와 같은 규약: 정사각형 캔버스에 극좌표로 그리면 CircleGeometry 의
// 기본 UV 에 그대로 맞아떨어진다. 가운데가 무대 중심이다.
export function makeSnowTexture(size = 1024) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const c = size / 2;
  const R = size / 2;

  g.fillStyle = '#e9f1fa';
  g.fillRect(0, 0, size, size);

  // 넓게 번지는 그늘. 눈은 하얗기만 하면 종잇장처럼 납작해 보인다 —
  // 푸른 그림자가 있어야 굴곡이 생긴다.
  for (let i = 0; i < 80; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    const rad = rnd(size * 0.05, size * 0.16);
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const tone = ['#d3e2f2', '#c4d8ee', '#f4f9ff', '#dae7f6'][(Math.random() * 4) | 0];
    grad.addColorStop(0, tone);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }

  // 눈 결정이 반짝이는 점. 잔디의 '풀잎 선' 자리를 대신한다.
  for (let i = 0; i < 5200; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    g.globalAlpha = rnd(0.25, 0.9);
    g.fillStyle = Math.random() < 0.3 ? '#ffffff' : '#f2f8ff';
    g.beginPath();
    g.arc(x, y, rnd(size * 0.0008, size * 0.0022), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // 바람에 쓸린 결. 길고 옅은 곡선이라 눈밭처럼 보인다.
  g.lineCap = 'round';
  for (let i = 0; i < 220; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R * 0.96;
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    const len = rnd(size * 0.03, size * 0.10);
    const dir = a + Math.PI / 2 + rnd(-0.5, 0.5);   // 대체로 원을 따라 흐르게
    g.globalAlpha = rnd(0.10, 0.28);
    g.strokeStyle = '#b9d1ea';
    g.lineWidth = rnd(size * 0.002, size * 0.005);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(
      x + Math.cos(dir) * len * 0.5, y + Math.sin(dir) * len * 0.5 - size * 0.006,
      x + Math.cos(dir) * len, y + Math.sin(dir) * len
    );
    g.stroke();
  }
  g.globalAlpha = 1;

  // 거리 기준선. 잔디의 '밟힌 자국' 과 같은 역할 — 중심에서 얼마나 떨어졌는지
  // 눈으로 재는 기준이라, 스킨이 바뀌어도 반드시 있어야 한다.
  g.save();
  g.translate(c, c);
  for (const [rr, alpha] of [[0.3, 0.16], [0.55, 0.13], [0.77, 0.16]]) {
    g.beginPath();
    g.arc(0, 0, R * rr, 0, Math.PI * 2);
    g.strokeStyle = `rgba(140, 170, 200, ${alpha})`;
    g.lineWidth = size * 0.012;
    g.setLineDash([size * 0.05, size * 0.03]);
    g.stroke();
  }
  g.setLineDash([]);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
