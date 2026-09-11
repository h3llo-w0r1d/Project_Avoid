// 탑 오르기 창의 송전탑 그림.
//
// 예전엔 CSS 그라디언트로 격자를 칠했다. 곧은 기둥에 X 무늬를 되풀이한 것이라
// 철탑보다는 사다리처럼 보였다. 이제는 SVG 로 실제 송전탑의 뼈대를 그린다 —
// 아래로 벌어지는 주각, 한 뼘 뒤에 비치는 뒷면, 층마다 뻗은 트러스 가로대와
// 애자, 꼭대기의 완금·애자련·전선·피뢰침, 콘크리트 기초.
//
// 칸 높이를 정해 두지 않고 층 명판(.pf)과 구간 표지판(.pz)의 실제 위치를 재서
// 마디를 잡는다. 표지판이 끼어 간격이 들쭉날쭉해도 가로대가 늘 명판 한가운데로
// 뻗는다. 그래서 화면 폭이 바뀌면 다시 그려야 한다(부르는 쪽이 ResizeObserver 로).
//
// 통전은 같은 뼈대를 주황으로 한 벌 더 그리고, 깬 층보다 위를 잘라 낸다.
// 번짐은 filter 대신 굵고 옅은 선을 한 번 더 긋는다 — 4천 px 높이에 blur 를
// 걸면 스크롤할 때마다 다시 칠해서 무겁다.

const r1 = (n) => Math.round(n * 10) / 10;
const L = (x1, y1, x2, y2) => `M${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}`;
const poly = (pts) => 'M' + pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L');

// 트러스 웹. 윗줄(yT 고정)과 아랫줄(yb0 → yb1 로 기운다)을 번갈아 찍는다.
function zig(x0, x1, yT, yb0, yb1, step) {
  const n = Math.max(2, Math.round(Math.abs(x1 - x0) / step));
  let d = `M${r1(x0)} ${r1(yb0)}`;
  for (let k = 1; k <= n; k++) {
    const f = k / n;
    d += `L${r1(x0 + (x1 - x0) * f)} ${r1(k % 2 ? yT : yb0 + (yb1 - yb0) * f)}`;
  }
  return d;
}

// 색은 강철(회청)과 통전(주황) 두 벌뿐이다 — 게임의 붉은 전기선과 같은 계열.
const STEEL = {
  back: 'rgba(110, 132, 172, 0.3)', wire: 'rgba(160, 182, 220, 0.34)',
  brace: 'rgba(146, 170, 210, 0.5)', web: 'rgba(146, 170, 210, 0.42)', strut: 'rgba(168, 190, 226, 0.72)',
  shade: 'rgba(8, 11, 20, 0.85)', leg: '#7d92b6', shine: 'rgba(226, 237, 255, 0.9)',
  gusset: '#4f5c76', disc: 'rgba(196, 220, 250, 0.85)'
};
const LIVE = {
  glow: 'rgba(255, 118, 46, 0.16)',
  back: 'rgba(255, 138, 64, 0.36)', wire: 'rgba(255, 170, 100, 0.55)',
  brace: 'rgba(255, 170, 98, 0.8)', web: 'rgba(255, 164, 92, 0.64)', strut: 'rgba(255, 196, 140, 0.92)',
  shade: 'rgba(60, 22, 6, 0.9)', leg: '#ff9a4c', shine: 'rgba(255, 240, 214, 0.95)',
  gusset: '#a85a2e', disc: '#ffd6a6'
};

// pylon: .pylon 요소(안에 svg.pylon-art 와 .pf/.pz 줄이 있다).
// cleared: 깬 층. full: 탑 전체를 켤지(관리자·다 깬 사람).
export function drawPylon(pylon, { cleared = 0, full = false } = {}) {
  const svg = pylon.querySelector('.pylon-art');
  const W = pylon.clientWidth, H = pylon.offsetHeight;
  const rows = [...pylon.querySelectorAll('.pf, .pz')];
  if (!svg || !W || !rows.length) return;

  const cs = getComputedStyle(pylon);
  const P = parseFloat(cs.paddingLeft);                // 명판이 시작하는 x
  const s = Math.min(1, Math.max(0.45, P / 206));      // 좁은 화면에선 선도 가늘게

  // ── 치수 ──
  // 몸통은 첫 줄 위에서 마지막 줄 아래까지. 그 위는 머리, 아래는 벌어진 다리와 기초.
  const cx = P * 0.44;
  const yTop = rows[0].offsetTop - 4;
  const last = rows[rows.length - 1];
  const yB = last.offsetTop + last.offsetHeight;
  const yG = H - parseFloat(cs.paddingBottom) * 0.3;   // 땅
  const yF = yG - 9 * s;                               // 기초 윗면
  const hwT = P * 0.13, hwB = P * 0.2, hwF = P * 0.27; // 반폭: 몸통 위·몸통 아래·기초
  const hw = (y) => hwT + (hwB - hwT) * (y - yTop) / Math.max(1, yB - yTop);
  const dx = 7 * s, dy = -5 * s;                       // 뒷면이 비치는 방향
  const yA2 = yTop * 0.7, yA1 = yTop * 0.42, yPk = yTop * 0.2, yTip = Math.max(5, yTop * 0.05);
  const wA2 = hwT * 0.85, wA1 = hwT * 0.62;

  const g = { legs: '', struts: '', braces: '', side: '', gusset: '', arms: '', webs: '', discs: '', wires: '' };
  const plate = (x, y) => `M${r1(x - 2.6 * s)} ${r1(y - 4.2 * s)}h${r1(5.2 * s)}v${r1(8.4 * s)}h${r1(-5.2 * s)}z`;

  // 주각 — 꼭짓점에서 머리를 지나 몸통으로 벌어지고, 땅 가까이서 한 번 더 벌어진다.
  for (const k of [-1, 1]) {
    g.legs += poly([[cx, yPk], [cx + k * wA1, yA1], [cx + k * wA2, yA2],
      [cx + k * hwT, yTop], [cx + k * hwB, yB], [cx + k * hwF, yF]]);
  }

  // 마디마다 가로 부재·옆면 부재·이음판, 마디 사이마다 X 브레이스.
  const nodes = [[yA1, wA1], [yA2, wA2],
    ...[yTop, ...rows.map((r) => r.offsetTop + r.offsetHeight / 2), yB].map((y) => [y, hw(y)]),
    [yF, hwF]];
  nodes.forEach(([y, w], i) => {
    g.struts += L(cx - w, y, cx + w, y);
    // 앞면과 뒷면을 잇는 짧은 사선 — 이게 있어야 두 겹이 한 덩어리로 읽힌다
    g.side += L(cx - w, y, cx - w + dx, y + dy) + L(cx + w, y, cx + w + dx, y + dy);
    g.gusset += plate(cx - w, y) + plate(cx + w, y);
    if (!i) return;
    const [y0, w0] = nodes[i - 1];
    if (y - y0 < 14 * s) return;      // 너무 낮은 칸에 X 를 넣으면 뭉개진다
    g.braces += L(cx - w0, y0, cx + w, y) + L(cx + w0, y0, cx - w, y);
  });
  g.braces += L(cx, yPk, cx, yA1);

  // 층마다 뻗은 가로대(트러스)와, 명판을 붙드는 애자.
  const insLen = P > 120 ? 24 * s : 0;   // 좁으면 애자까지 넣을 자리가 없다
  for (const r of pylon.querySelectorAll('.pf')) {
    const y = r.offsetTop + r.offsetHeight / 2;
    const x0 = cx + hw(y), x1 = P - insLen - 3 * s;
    if (x1 - x0 < 8) continue;
    const t = 13 * s, yT = y - t / 2;
    g.arms += L(x0, yT, x1, yT) + L(x0, yT + t, x1, yT + t * 0.45) + L(x1, yT, x1, yT + t * 0.45);
    g.webs += zig(x0, x1, yT, yT + t, yT + t * 0.45, t * 0.95);
    if (!insLen) continue;
    const yi = yT + t * 0.22;
    g.arms += L(x1, yi, P - 1, yi);
    for (let x = x1 + 4 * s; x < P - 3 * s; x += 4.2 * s) g.discs += L(x, yi - 4.4 * s, x, yi + 4.4 * s);
  }

  // 꼭대기 완금 두 단(위가 짧다 — 실제 송전탑 순서), 끝에 매달린 애자련, 화면 밖으로 처지는 전선.
  const reach = (wA) => Math.min(cx - wA - 4 * s, 64 * s);
  for (const [yA, wA, len] of [[yA2, wA2, reach(wA2)], [yA1, wA1, reach(wA1) * 0.72]]) {
    const t = 9 * s;
    for (const k of [-1, 1]) {
      const x0 = cx + k * wA, x1 = cx + k * (wA + len);
      g.arms += L(x0, yA - t, x1, yA - t) + L(x0, yA, x1, yA - t);
      g.webs += zig(x0, x1, yA - t, yA, yA - t, t);
      const yc = yA - t + 18 * s;
      g.arms += L(x1, yA - t, x1, yc);
      for (let y = yA - t + 5 * s; y < yc - 1; y += 3.4 * s) g.discs += L(x1 - 3.4 * s, y, x1 + 3.4 * s, y);
      const xe = k < 0 ? -8 : W + 8;
      // 처짐은 경간에 비례 — 왼쪽처럼 짧은 경간에 같은 처짐을 주면 갈고리처럼 꺾인다
      const sag = Math.min(26 * s, Math.abs(xe - x1) * 0.1, (yTop - yc) * 0.6);
      g.wires += `M${r1(x1)} ${r1(yc)}Q${r1((x1 + xe) / 2)} ${r1(yc + sag * 2)} ${r1(xe)} ${r1(yc + sag * 0.4)}`;
    }
  }
  // 가공지선(꼭짓점)과 피뢰침
  for (const xe of [-8, W + 8]) {
    const sag = Math.min(12 * s, Math.abs(xe - cx) * 0.06);
    g.wires += `M${r1(cx)} ${r1(yPk)}Q${r1((cx + xe) / 2)} ${r1(yPk + sag * 2)} ${r1(xe)} ${r1(yPk + sag * 0.5)}`;
  }
  g.arms += L(cx, yPk, cx, yTip);

  const frame = (c) =>
    (c.glow ? `<path d="${g.legs}${g.struts}${g.arms}" stroke="${c.glow}" stroke-width="${r1(9 * s)}"/>` : '') +
    `<path d="${g.legs}${g.struts}${g.braces}" transform="translate(${r1(dx)} ${r1(dy)})" stroke="${c.back}" stroke-width="${r1(1.3 * s)}"/>` +
    `<path d="${g.side}" stroke="${c.back}" stroke-width="${r1(1.3 * s)}"/>` +
    `<path d="${g.wires}" stroke="${c.wire}" stroke-width="1"/>` +
    `<path d="${g.braces}" stroke="${c.brace}" stroke-width="${r1(1.6 * s)}"/>` +
    `<path d="${g.webs}" stroke="${c.web}" stroke-width="${r1(1.2 * s)}"/>` +
    `<path d="${g.struts}${g.arms}" stroke="${c.strut}" stroke-width="${r1(2.1 * s)}"/>` +
    `<path d="${g.legs}" stroke="${c.shade}" stroke-width="${r1(5.6 * s)}"/>` +
    `<path d="${g.legs}" stroke="${c.leg}" stroke-width="${r1(3.4 * s)}"/>` +
    `<path d="${g.legs}" stroke="${c.shine}" stroke-width="${r1(0.9 * s)}" transform="translate(${r1(-0.9 * s)} 0)"/>` +
    `<path d="${g.gusset}" fill="${c.gusset}" stroke="${c.shine}" stroke-width="${r1(0.5 * s)}"/>` +
    `<path d="${g.discs}" stroke="${c.disc}" stroke-width="${r1(2.2 * s)}" stroke-linecap="round"/>`;

  // 통전 경계 — 깬 층 명판의 윗변. 그 층 가로대까지는 켜지고 다음 층부터 꺼진다.
  let litY = H + 10;
  if (full) litY = -10;
  else if (cleared > 0) {
    const r = pylon.querySelector(`.pf[data-floor="${cleared}"]`);
    if (r) litY = r.offsetTop;
  }

  // 전류 한 점이 주각을 타고 오르고, 경계와 피뢰침 끝에서 불꽃이 깜박인다.
  const spark = (x, y, big) =>
    `<circle class="py-spark" cx="${r1(x)}" cy="${r1(y)}" r="${r1(big * s)}" fill="rgba(255, 160, 80, 0.45)"/>` +
    `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(2.3 * s)}" fill="#ffe4c0"/>`;
  let fx = spark(cx, yTip, 6.5);
  if (litY < yB) {
    const yEnd = Math.max(litY, yTop);
    for (const k of [-1, 1]) {
      fx += `<path class="py-flow" d="${L(cx + k * hwB, yB, cx + k * hw(yEnd), yEnd)}" stroke="#fff3e2" ` +
        `stroke-width="${r1(2.2 * s)}" stroke-linecap="round" stroke-dasharray="3 56"${k > 0 ? ' style="animation-delay:-0.45s"' : ''}/>`;
    }
    if (litY > yTop) for (const k of [-1, 1]) fx += spark(cx + k * hw(litY), litY, 7);
  }

  // 기초와 땅은 전기가 안 흐르니 한 벌만.
  const fw = 8 * s;
  const foot = (x) => `M${r1(x - fw)} ${r1(yG)}L${r1(x - fw * 0.62)} ${r1(yF)}h${r1(fw * 1.24)}L${r1(x + fw)} ${r1(yG)}z`;
  const ground =
    `<ellipse cx="${r1(cx)}" cy="${r1(yG)}" rx="${r1(hwF * 2)}" ry="${r1(5 * s)}" fill="rgba(0, 0, 0, 0.55)"/>` +
    `<path d="${foot(cx - hwF) + foot(cx + hwF)}" transform="translate(${r1(dx)} ${r1(dy)})" fill="#2c3242"/>` +
    `<path d="${foot(cx - hwF) + foot(cx + hwF)}" fill="#5a6378" stroke="rgba(190, 204, 230, 0.55)" stroke-width="${r1(0.8 * s)}"/>` +
    `<path d="M0 ${r1(yG + 0.5)}H${r1(P * 1.15)}" stroke="url(#py-ground)"/>`;

  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML =
    '<defs>' +
    `<clipPath id="py-live"><rect x="-20" y="${r1(litY)}" width="${W + 40}" height="${H + 20}"/></clipPath>` +
    `<linearGradient id="py-ground" gradientUnits="userSpaceOnUse" x1="0" x2="${r1(P * 1.15)}" y1="0" y2="0">` +
    '<stop offset="0" stop-color="#96acd2" stop-opacity="0"/><stop offset="0.35" stop-color="#96acd2" stop-opacity="0.4"/>' +
    '<stop offset="1" stop-color="#96acd2" stop-opacity="0"/></linearGradient>' +
    '</defs>' +
    frame(STEEL) + `<g clip-path="url(#py-live)">${frame(LIVE)}</g>` + ground + fx;
}
