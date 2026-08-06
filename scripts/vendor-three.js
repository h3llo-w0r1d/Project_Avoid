// three.js 파일들을 public/js/vendor/ 로 복사한다.
// node_modules 는 배포에 올리지 않으므로, 브라우저가 받아갈 사본을 저장소에 둔다.
//
// jsm 파일들은 원본 디렉터리 구조를 그대로 유지한다. GLTFLoader 가
// '../utils/BufferGeometryUtils.js' 를 상대 경로로 가져오기 때문에,
// 구조를 무너뜨리면 import 를 일일이 고쳐 써야 한다.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'three');
const dest = join(root, 'public', 'js', 'vendor');

const files = [
  ['build/three.module.min.js', 'three.module.min.js'],
  ['examples/jsm/loaders/GLTFLoader.js', 'jsm/loaders/GLTFLoader.js'],
  ['examples/jsm/utils/BufferGeometryUtils.js', 'jsm/utils/BufferGeometryUtils.js']
];

for (const [from, to] of files) {
  const target = join(dest, to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(src, from), target);
  console.log('%s -> public/js/vendor/%s', from, to);
}
