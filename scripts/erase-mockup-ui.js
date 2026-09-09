// 시안 그림에서 박혀 있는 UI 를 지운다.
//
//   node scripts/erase-mockup-ui.js <시안> <나온 파일>
//
// 배경 시안을 화면 전체 모습으로 뽑으면 메뉴 판·카드·상단 바까지 그림에
// 그려져 나온다. 그대로 배경에 깔면 진짜 UI 가 그 위에 한 번 더 얹혀
// 판이 두 겹으로 보인다.
//
// 지운다고 해도 그 자리에 없던 풍경을 그려 넣을 수는 없다. 대신 그 부분만
// 뭉개고 어둡게 눌러서 "원래 어두운 자리" 로 만든다. 어차피 진짜 UI 가
// 정확히 그 위에 앉으므로 안 보인다. 경계는 크게 번지게 해서 네모난
// 자국이 남지 않게 한다.
//
// 상단 바는 아예 잘라낸다 — 위쪽 띠는 풍경이 거의 없다.

import sharp from 'sharp';

const TOP_BAR = 50;          // 잘라낼 상단 바 높이(원본 기준)
const FEATHER = 46;          // 경계를 번지게 하는 정도

// 지울 자리(원본 좌표). 넉넉히 잡는다 — 진짜 UI 위치가 화면마다 조금씩
// 다르므로, 모자라서 가짜 테두리가 삐져나오는 쪽이 훨씬 눈에 띈다.
// 발광 테두리까지 확실히 덮어야 한다. 번지는 폭(FEATHER) 안쪽은 반쯤만
// 덮이므로, 테두리에서 그 폭만큼 더 바깥까지 잡는다 — 처음엔 딱 맞게
// 잡았다가 주황 테두리가 반투명으로 남았다.
const HIDE = [
  { x: -40, y: 60, w: 400, h: 900, r: 30 },    // 왼쪽 메뉴 판 + 층 오르기 버튼
  { x: 592, y: 34, w: 612, h: 830, r: 36 }     // 가운데 카드
];

async function main() {
  const [, , src, out] = process.argv;
  if (!src || !out) {
    console.error('쓰는 법: node scripts/erase-mockup-ui.js <시안> <나온 파일>');
    process.exit(1);
  }

  const meta = await sharp(src).metadata();
  const W = meta.width;
  const H = meta.height - TOP_BAR;
  console.log(`원본 ${meta.width}×${meta.height} → 상단 바 ${TOP_BAR}px 잘라 ${W}×${H}`);

  // 왼쪽으로 갈수록 어두워지는 그라데이션을 먼저 깐다.
  // 지운 자리만 검게 눌러 두면 남은 풍경과 사이에 세로 경계가 생겨
  // "검은 네모" 로 읽힌다. 왼쪽 전체를 서서히 재우면 그 경계가 사라지고,
  // 오른쪽 포탈만 밝게 남아 시선이 그리로 간다.
  const RAMP = 0.62;   // 이 비율까지 어둡게 재운다(오른쪽은 그대로)

  const raw = await sharp(src)
    .extract({ left: 0, top: TOP_BAR, width: W, height: H })
    .png()
    .toBuffer();

  const ramp = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0%" stop-color="#05060f" stop-opacity="0.72"/>` +
    `<stop offset="${Math.round(RAMP * 100)}%" stop-color="#05060f" stop-opacity="0"/>` +
    `</linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);

  const base = await sharp(raw)
    .composite([{ input: ramp }])
    .png()
    .toBuffer();


  // 뭉갠 뒤 어둡게 누른 판. 이걸 가짜 UI 자리에만 덮는다.
  const soft = await sharp(base)
    .blur(64)
    .modulate({ brightness: 0.55, saturation: 0.8 })
    .removeAlpha()
    .raw()
    .toBuffer();

  // 덮을 자리를 흰색으로 그린 뒤 크게 번지게 한다(네모난 자국 방지).
  const rects = HIDE.map((b) =>
    `<rect x="${b.x}" y="${b.y - TOP_BAR}" width="${b.w}" height="${b.h}" rx="${b.r}" fill="#fff"/>`
  ).join('');
  const mask = await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="#000"/>${rects}</svg>`
  ))
    .greyscale()
    .blur(FEATHER)
    .raw()
    .toBuffer();

  const layer = await sharp(soft, { raw: { width: W, height: H, channels: 3 } })
    .joinChannel(mask, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();

  await sharp(base).composite([{ input: layer }]).png().toFile(out);
  console.log(`만듦 ${out}`);
  console.log('이어서: node scripts/make-backdrop.js ' + out);
}

main().catch((err) => {
  console.error('실패:', err.message);
  process.exit(1);
});
