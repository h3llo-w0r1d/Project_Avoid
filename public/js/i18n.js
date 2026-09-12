// 다국어 문구 조회. 문구를 저장해 두는 곳은 strings.js, 언어 값을 저장해
// 두는 곳은 settings.js — 여기서는 그 둘을 이어 "지금 언어로 뭐라고
// 하나"만 답한다.
//
// 순환 참조 주의: 이 파일은 settings.js 만 가져온다. 다른 화면 모듈이
// 이 파일을 가져오는 방향만 있어야 한다.
import { settings } from './settings.js';
import { STRINGS } from './strings.js';

// 키가 없을 때 콘솔을 도배하지 않으려고 한 번만 경고한다.
const warned = new Set();

// 'auto' 는 브라우저 언어를 본다. 지원 언어가 한국어·영어 둘뿐이라
// ko 로 시작하지 않으면 전부 영어로 묶는다.
function resolve(pref) {
  if (pref === 'ko' || pref === 'en') return pref;
  return navigator.language?.startsWith('ko') ? 'ko' : 'en';
}

export function getLangPref() {
  return settings.get('lang') ?? 'auto';
}

export function getLang() {
  return resolve(getLangPref());
}

export function setLang(pref) {
  settings.set('lang', pref);
  document.documentElement.lang = getLang();
}

// 언어가 바뀔 때(또는 설정을 통째로 초기화했을 때) 부른다. 떼는 함수를 돌려준다.
export function onLangChange(fn) {
  return settings.onChange((key) => {
    if (key === 'lang' || key === null) fn();
  });
}

export function t(key, vars) {
  const text = STRINGS[key]?.[getLang()];
  if (text === undefined) {
    if (!warned.has(key)) { console.warn(`i18n: 없는 키 - ${key}`); warned.add(key); }
    return key;
  }
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// [data-i18n] 은 textContent, [data-i18n-attr]="attr:key;attr2:key2" 는
// 그 속성들을 채운다. 언어가 바뀔 때마다 다시 불러 화면을 새로 채운다.
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}

// 로딩 시점부터 <html lang> 을 실제 언어에 맞춘다. index.html 은 'ko' 로 박아
// 두기만 하고, 여기서 실제 값으로 갈아 끼운다.
document.documentElement.lang = getLang();
