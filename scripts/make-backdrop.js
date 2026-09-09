// 타이틀 화면 배경 사진을 웹용으로 줄인다.
//
//   node scripts/make-backdrop.js <원본 이미지>
//
// 큰 화면용과 폰용 두 장을 public/img/ 에 WebP 로 만든다. 원본(보통 1~3MB)을
// 그대로 올리면 첫 화면이 눈에 띄게 느려진다 — 지금 HTML+CSS+JS 를 다 합쳐도
// 300KB 남짓이라, 배경 한 장이 나머지 전부보다 무거워지는 셈이다.
//
// 폰용을 따로 두는 건 화면이 작아서가 아니라 회선 때문이다. 같은 그림을
// 절반 폭으로 주면 4분의 1 무게가 된다.
//
// 가운데는 타이틀 카드가 덮으므로 잘릴 때 좌우가 아니라 위아래가 잘리게
// 둔다(cover + 가운데 정렬). 원본은 가로로 넉넉한 그림일수록 좋다.

import { mkdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import sharp from 'sharp';

const OUT = 'public/img';

// [파일 이름, 가로, 세로, 품질]
// 품질 72/68 은 눈으로 구별이 안 가면서 용량이 확 떨어지는 지점이다.
const SIZES = [
  ['title-bg.webp', 2400, 1350, 72],
  ['title-bg-sm.webp', 1200, 675, 68]
];

const kb = (p) => (statSync(p).size / 1024).toFixed(0) + 'KB';

async function main() {
  const src = process.argv[2];
  if (!src) {
    console.error('쓰는 법: node scripts/make-backdrop.js <원본 이미지>');
    process.exit(1);
  }

  const meta = await sharp(src).metadata();
  console.log(`원본  ${basename(src)}  ${meta.width}×${meta.height}  ${kb(src)}`);
  if (meta.width < 1920) {
    console.log('  ⚠ 가로가 1920 보다 작습니다. 큰 화면에서 늘어나 흐려질 수 있어요.');
  }

  mkdirSync(OUT, { recursive: true });
  for (const [name, w, h, quality] of SIZES) {
    const out = join(OUT, name);
    await sharp(src)
      .resize(w, h, { fit: 'cover', position: 'centre' })
      .webp({ quality, effort: 6 })
      .toFile(out);
    console.log(`만듦  ${out}  ${w}×${h}  ${kb(out)}`);
  }
  console.log('');
  console.log('넣었으면 배포만 하면 타이틀 화면에 바로 뜹니다.');
}

main().catch((err) => {
  console.error('실패:', err.message);
  process.exit(1);
});
