// 닉네임 검사. 브라우저와 서버가 같은 파일을 쓴다.
//
// 브라우저 검사는 사용자에게 바로 알려 주기 위한 것이고,
// 실제로 막는 건 서버다. 클라이언트 검사는 우회할 수 있으니
// 서버에서 반드시 한 번 더 통과시켜야 한다.
//
// 작정하고 우회하는 건 못 막는다. 흔한 우회(기호 끼우기, 숫자 치환,
// 글자 늘이기)까지만 잡고, 나머지는 신고·수동 삭제의 몫으로 둔다.

export const MAX_LENGTH = 10;

// 게스트 이름 형식. 로그인하지 않은 사람은 이 모양만 쓸 수 있다.
export const GUEST_PATTERN = /^Guest\d{4}$/;

const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

// 한글(자모 포함)과 알파벳
const LETTER = /[a-zᄀ-ᇿ㄰-㆏가-힣]/;
// 이름에 최소 한 글자는 들어 있어야 인정할 문자
const MEANINGFUL = /[a-z0-9ᄀ-ᇿ㄰-㆏가-힣]/i;

// 숫자·기호로 글자를 흉내 낸 걸 되돌린다.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };

// 막을 단어를 품고 있지만 멀쩡한 낱말. 검사 전에 통째로 들어낸다.
// 이게 없으면 'Essex' 가 'sex' 때문에 걸린다.
const ALLOW = ['essex', 'sussex', 'middlesex', 'sextet', 'analyst', 'analysis', 'canal', 'banal'];

// 부분 문자열로 검사한다. 놓치는 쪽보다 조금 과하게 막는 쪽이 낫다고 보고
// 이렇게 뒀다. 대신 'anal'(analyst), 'fag', 'hell' 처럼 멀쩡한 단어에 흔히
// 박히는 짧은 조각은 일부러 뺐다.
const BLOCKED = [
  // 한국어
  '씨발', '시발', '씨빨', '시빨', '씨팔', '시팔', '쒸발', '슈발', '씨바',
  '씹', '좆', '좇', '조까', '존나', '존내', '병신', '븅신', '빙신', '등신',
  '지랄', '개새', '개색', '새끼', '썅', '쌍년', '개년', '미친년', '미친놈',
  '니미', '애미', '애비', '엠창', '느금', '늬금',
  '보지', '자지', '섹스', '섹디', '야동', '야짤', '떡치', '강간', '성폭행',
  '창녀', '창놈', '걸레년', '노애미', '패드립',
  // 자모만 쓰는 줄임말
  'ㅅㅂ', 'ㅆㅂ', 'ㅄ', 'ㅂㅅ', 'ㅈㄹ', 'ㅁㅊ', 'ㄱㅅㄲ', 'ㅆㄲ', 'ㅗ',
  // 영어
  'fuck', 'fuk', 'fck', 'shit', 'bitch', 'bastard', 'cunt', 'dick', 'cock',
  'pussy', 'porn', 'sex', 'rape', 'nigger', 'nigga', 'faggot', 'whore',
  'slut', 'asshole', 'penis', 'vagina', 'boobs', 'wanker', 'jerkoff', 'blowjob'
];

function strip(chars) {
  let out = chars.filter((ch) => LETTER.test(ch)).join('');
  for (const word of ALLOW) out = out.split(word).join('');
  // 늘여 쓴 글자를 하나로 줄인다: 씨이이이발 -> 씨이발
  return out.replace(/(.)\1+/g, '$1');
}

// 검사용 문자열을 두 벌 만든다.
//  - 숫자를 글자로 되돌린 것  : sh1t -> shit
//  - 숫자·기호를 아예 지운 것 : 시1발 -> 시발
// 한쪽만 보면 반대쪽 우회를 놓친다.
function variants(name) {
  const lower = Array.from(name.toLowerCase());
  return [
    strip(lower.map((ch) => LEET[ch] ?? ch)),
    strip(lower)
  ];
}

// word 의 글자가 순서대로 나오되, 사이에 끼어든 글자가 maxGap 이하면 걸린다.
// '씨이발' 처럼 사이에 글자를 끼워 넣는 우회를 잡기 위한 것.
function fuzzyIncludes(hay, word, maxGap = 2) {
  const n = hay.length;
  const m = word.length;
  for (let start = 0; start + m <= n + maxGap; start++) {
    if (hay[start] !== word[0]) continue;
    let wi = 1;
    let gaps = 0;
    let i = start + 1;
    while (i < n && wi < m) {
      if (hay[i] === word[wi]) wi++;
      else if (++gaps > maxGap) break;
      i++;
    }
    if (wi === m) return true;
  }
  return false;
}

/**
 * 닉네임을 검사한다.
 * @returns {{ok: true, name: string} | {ok: false, reason: string}}
 */
export function checkNickname(raw) {
  // 제어문자를 걷어내고 연속 공백을 하나로 줄인다
  const name = String(raw ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 비워 두면 '익명'. 이름 짓기를 강요하지 않는다.
  if (!name) return { ok: true, name: '익명' };

  // 이모지 같은 글자는 코드 단위가 둘이라 length 로 세면 안 된다
  if (Array.from(name).length > MAX_LENGTH) {
    return { ok: false, reason: `닉네임은 ${MAX_LENGTH}자까지 쓸 수 있습니다.` };
  }

  if (!MEANINGFUL.test(name)) {
    return { ok: false, reason: '글자나 숫자를 하나 이상 넣어 주세요.' };
  }

  // 계정 닉네임이 게스트 이름 모양이면 누가 게스트인지 알 수 없게 된다
  if (GUEST_PATTERN.test(name)) {
    return { ok: false, reason: 'Guest 로 시작하는 이름은 쓸 수 없습니다.' };
  }

  for (const flat of variants(name)) {
    for (const word of BLOCKED) {
      if (fuzzyIncludes(flat, word)) {
        return { ok: false, reason: '사용할 수 없는 표현이 들어 있습니다.' };
      }
    }
  }

  return { ok: true, name };
}
