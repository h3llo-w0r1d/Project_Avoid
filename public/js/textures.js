import * as THREE from 'three';

// 무대에 쓰는 무늬를 전부 캔버스로 그린다. 이미지 파일 의존이 없다.

const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- 잔디 상판

// CircleGeometry 의 기본 UV 는 원이 정사각형 텍스처에 내접하도록 잡히므로,
// 캔버스 중심을 무대 중심으로 두고 극좌표로 그리면 그대로 맞아떨어진다.
// 크기를 키운 만큼 풀잎도 늘려야 한다. 넓은 캔버스에 같은 수를 그리면
// 오히려 듬성듬성해진다.
export function makeGrassTexture(size = 1536) {
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

  // 풀잎 — 짧은 선을 잔뜩 그어 결을 만든다.
  //
  // 방향을 완전히 무작위로 두면 결이 안 생겨 잔디가 '노이즈' 처럼 보인다.
  // 자리마다 완만하게 도는 바람 방향을 정하고, 거기서 조금씩만 흩어 놓으면
  // 실제 풀밭처럼 결이 흐른다.
  g.lineCap = 'round';
  for (let i = 0; i < 26000; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    // 길이를 넓게 벌린다 — 짧은 잔풀과 웃자란 풀이 섞여야 깊이가 생긴다
    const long = Math.random() < 0.18;
    const len = long ? rnd(size * 0.010, size * 0.020) : rnd(size * 0.003, size * 0.009);
    // 바람 결: 자리에 따라 천천히 도는 기준 방향 + 약간의 흩어짐
    const wind = Math.sin(x * 0.004) + Math.cos(y * 0.0033) * 1.2;
    const dir = wind + rnd(-0.55, 0.55);
    const shade = ['#598f4c', '#2f5530', '#6aa257', '#456f3d', '#7ab55f', '#24421f'][(Math.random() * 6) | 0];
    g.strokeStyle = shade;
    g.globalAlpha = rnd(0.22, 0.85);
    g.lineWidth = rnd(size * 0.0009, size * 0.0022);
    // 곧은 선 대신 살짝 휜다. 풀은 곧게 서 있지 않다.
    const bend = rnd(-0.5, 0.5);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(
      x + Math.cos(dir + bend) * len * 0.55, y + Math.sin(dir + bend) * len * 0.55,
      x + Math.cos(dir) * len, y + Math.sin(dir) * len
    );
    g.stroke();
  }
  g.globalAlpha = 1;

  // 볕이 드는 곳 — 넓고 아주 옅은 밝은 얼룩. 색 얼룩(어두운 쪽)만 있으면
  // 전체가 가라앉아 보인다.
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R * 0.85;
    const rad = rnd(size * 0.08, size * 0.20);
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(150, 200, 120, 0.16)');
    grad.addColorStop(1, 'rgba(150, 200, 120, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }

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
  for (let i = 0; i < 120; i++) {
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
  // 바닥을 비스듬히 내려다보는 화면이라, 멀리 있는 잔디가 흐려지는 정도를
  // 이 값이 좌우한다. 16 은 요즘 기기에서 대부분 지원한다(초과하면 알아서 깎인다).
  tex.anisotropy = 16;
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

// 설원용 하늘. 기본 하늘은 밤빛(짙은 남색 → 흙빛 지평선)이라 흰 눈밭 위에
// 두면 무대만 뜬금없이 하얗다.
//
// 처음엔 아주 밝게 뽑았더니 이번엔 하늘까지 하얘져 무대와 배경이 붙어 버렸다.
// 흰 무대가 도드라지려면 하늘은 오히려 어두워야 한다. 그래서 위쪽을 짙은
// 청색으로 눌러 두고, 지평선 쪽만 눈빛이 번지듯 열어 준다.
//
// 세로 4px 짜리 띠로 만들면 위아래 그라데이션밖에 못 넣는다. 폭을 줘서
// 구름 결을 그린다 — 밋밋한 그라데이션 하늘은 종이처럼 보인다.
// 왼쪽·오른쪽 끝이 이어져야 하므로 가장자리에 걸친 구름은 반대쪽에도 그린다.
export function makeSnowSkyTexture(w = 1024, h = 512) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');

  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.00, '#1d3349');   // 꼭대기 — 깊은 겨울 하늘
  grad.addColorStop(0.34, '#2f5175');
  grad.addColorStop(0.60, '#5b81a0');
  grad.addColorStop(0.82, '#93b4cb');
  grad.addColorStop(1.00, '#c6dbe9');   // 지평선 — 눈빛이 번진다
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  // 구름 띠. 가로로 길게 눌린 타원을 겹쳐 흐린 하늘을 만든다.
  const band = (x, y, rw, rh, color, alpha) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, rw);
    gr.addColorStop(0, color.replace('ALPHA', alpha));
    gr.addColorStop(1, color.replace('ALPHA', '0'));
    g.save();
    g.translate(x, y);
    g.scale(1, rh / rw);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, rw, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };

  for (let i = 0; i < 60; i++) {
    const x = Math.random() * w;
    const y = rnd(h * 0.10, h * 0.78);
    const rw = rnd(w * 0.06, w * 0.20);
    const rh = rw * rnd(0.10, 0.26);
    // 위쪽은 밝은 구름, 아래쪽은 옅은 회청색 그늘
    const up = y < h * 0.5;
    const color = up ? 'rgba(190, 214, 234, ALPHA)' : 'rgba(120, 152, 180, ALPHA)';
    const alpha = rnd(0.08, 0.22);
    band(x, y, rw, rh, color, alpha);
    // 끝에 걸치면 반대쪽에도 그려 이음매를 없앤다
    if (x < rw) band(x + w, y, rw, rh, color, alpha);
    if (x > w - rw) band(x - w, y, rw, rh, color, alpha);
  }

  // 지평선 근처의 옅은 빛. 눈밭에서 올라오는 반사광 같은 느낌.
  const glow = g.createLinearGradient(0, h * 0.72, 0, h);
  glow.addColorStop(0, 'rgba(226, 240, 250, 0)');
  glow.addColorStop(1, 'rgba(226, 240, 250, 0.5)');
  g.fillStyle = glow;
  g.fillRect(0, h * 0.72, w, h * 0.28);

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
//
// 두 번 헤맸다. 처음엔 잔디처럼 짙은 얼룩을 넣어 잿빛 자갈밭이 됐고, 그걸
// 피하려 대비를 낮췄더니 이번엔 색종이처럼 밋밋했다.
//
// 눈은 '어둡게' 가 아니라 '입체로' 보여야 한다. 그래서 빛 방향을 하나로
// 정하고(왼쪽 위), 눈언덕마다 볕 드는 쪽에 흰 테를, 그늘 쪽에 푸른 그늘을
// 짝지어 그린다. 대비는 낮아도 방향이 일정하면 굴곡으로 읽힌다.
// 여기에 잔 알갱이를 촘촘히 깔아 단색으로 안 보이게 한다.
export function makeSnowTexture(size = 1536) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const c = size / 2;
  const R = size / 2;

  // 빛은 왼쪽 위에서. 아래 모든 굴곡이 이 방향을 따른다.
  const LX = -0.62, LY = -0.78;

  g.fillStyle = '#f2f7fd';
  g.fillRect(0, 0, size, size);

  // ── 1) 눈언덕. 볕 쪽 흰 테 + 그늘 쪽 푸른 그늘을 짝지어 그린다.
  for (let i = 0; i < 130; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    // 크기를 크게 벌린다 — 큰 언덕과 잔 둔덕이 섞여야 넓이가 느껴진다
    const rad = Math.random() < 0.25 ? rnd(size * 0.16, size * 0.30) : rnd(size * 0.035, size * 0.13);
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    const off = rad * 0.34;

    // 그늘(빛 반대쪽)
    let gr = g.createRadialGradient(x - LX * off, y - LY * off, 0, x - LX * off, y - LY * off, rad);
    gr.addColorStop(0, `rgba(146, 175, 208, ${rnd(0.22, 0.42)})`);
    gr.addColorStop(1, 'rgba(150, 178, 210, 0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x - LX * off, y - LY * off, rad, 0, Math.PI * 2); g.fill();

    // 볕(빛 쪽)
    gr = g.createRadialGradient(x + LX * off, y + LY * off, 0, x + LX * off, y + LY * off, rad * 0.9);
    gr.addColorStop(0, `rgba(255, 255, 255, ${rnd(0.5, 0.9)})`);
    gr.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x + LX * off, y + LY * off, rad * 0.9, 0, Math.PI * 2); g.fill();
  }

  // ── 2) 바람이 쓸고 간 이랑. 눈밭을 눈밭으로 만드는 결.
  //     그늘 줄과 볕 줄을 나란히 그어 골과 마루를 만든다.
  g.lineCap = 'round';
  for (let i = 0; i < 1500; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R * 0.98;
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    const len = rnd(size * 0.03, size * 0.14);
    const dir = a + Math.PI / 2 + rnd(-0.4, 0.4);
    const w = rnd(size * 0.0014, size * 0.0038);
    const nx = -Math.sin(dir) * w * 1.6, ny = Math.cos(dir) * w * 1.6;
    const draw = (dx, dy, style, alpha) => {
      g.globalAlpha = alpha;
      g.strokeStyle = style;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.quadraticCurveTo(
        x + dx + Math.cos(dir + 0.22) * len * 0.5, y + dy + Math.sin(dir + 0.22) * len * 0.5,
        x + dx + Math.cos(dir) * len, y + dy + Math.sin(dir) * len
      );
      g.stroke();
    };
    // 마루(볕)와 골(그늘)을 빛 방향에 맞춰 나란히
    draw(LX * w, LY * w, '#ffffff', rnd(0.30, 0.6));
    draw(nx - LX * w, ny - LY * w, '#a9c4de', rnd(0.10, 0.22));
  }
  g.globalAlpha = 1;

  // ── 3) 잔 알갱이. 단색으로 안 보이게 하는 건 결국 이 촘촘한 결이다.
  //     밝은 알갱이만 찍으면 안개처럼 뿌예져서, 어두운 알갱이도 섞는다.
  for (let i = 0; i < 30000; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    const up = Math.random() < 0.62;
    g.globalAlpha = up ? rnd(0.14, 0.5) : rnd(0.05, 0.16);
    g.fillStyle = up ? '#ffffff' : '#b6cee6';
    g.beginPath();
    g.arc(x, y, rnd(size * 0.0004, size * 0.0013), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // ── 4) 밟혀 다져진 자국. 넓고 아주 옅게 — 사람이 지나다닌 흔적.
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R * 0.8;
    const rad = rnd(size * 0.03, size * 0.08);
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(168, 192, 220, ${rnd(0.10, 0.20)})`);
    gr.addColorStop(0.7, 'rgba(168, 192, 220, 0.05)');
    gr.addColorStop(1, 'rgba(168, 192, 220, 0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }

  // ── 5) 거리 띠. 중심에서 얼마나 떨어졌는지 눈으로 재는 기준이라 필요는
  //     한데, 잔디처럼 점선을 그으면 눈밭에선 '누가 그려 놓은 원' 으로
  //     보인다. 그래서 선 대신 '눈이 쓸려 쌓인 낮은 띠' 로 만든다 —
  //     안쪽은 그늘, 바깥쪽은 볕. 굴곡으로 읽혀 자연스럽다.
  g.save();
  g.translate(c, c);
  for (const rr of [0.32, 0.58, 0.80]) {
    const band = R * 0.030;
    const mid = R * rr;
    const gr = g.createRadialGradient(0, 0, mid - band, 0, 0, mid + band);
    gr.addColorStop(0.00, 'rgba(158, 184, 212, 0)');
    gr.addColorStop(0.40, 'rgba(158, 184, 212, 0.16)');   // 안쪽 그늘
    gr.addColorStop(0.58, 'rgba(255, 255, 255, 0.30)');   // 마루
    gr.addColorStop(1.00, 'rgba(255, 255, 255, 0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, mid + band, 0, Math.PI * 2);
    g.arc(0, 0, mid - band, 0, Math.PI * 2, true);
    g.fill();
  }

  // ── 6) 가장자리 — 눈이 끝나며 언 바위가 드러나는 띠
  const bandIn = R * 0.92;
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.arc(0, 0, bandIn, 0, Math.PI * 2, true);
  g.clip();
  const edge = g.createRadialGradient(0, 0, bandIn, 0, 0, R);
  edge.addColorStop(0, 'rgba(146, 172, 200, 0)');
  edge.addColorStop(1, 'rgba(120, 146, 176, 0.8)');
  g.fillStyle = edge;
  g.fillRect(-R, -R, size, size);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}
