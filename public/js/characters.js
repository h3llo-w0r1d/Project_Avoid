// 고를 수 있는 캐릭터 목록.
//
// 모양·색만 다르고 판정은 전부 같다. 몸집이 판정에 영향을 주면
// 유리한 캐릭터가 생겨 랭킹이 무의미해진다. 실제 크기는
// avatar.js 의 normalizeToPlayerBox() 가 모두 같게 맞춘다.
//
// profile: 몸통 옆모습 [높이, 반지름]. 아래에서 위로 올라가며 적는다.
// top:     머리 위 장식 (leaves / cap / acorn / spikes / sprout)
// skin:    몸통 표면 무늬 (fiber / grooves / ribs / speckle / 없으면 민무늬)
// unlockAt: 이 초 이상 버틴 적이 있으면 열린다. 0 이면 처음부터.
// wip:     아직 다듬는 중. 고르는 화면에 안 나오고 고를 수도 없다.
//          정의는 그대로 두었다가 마음에 들면 이 줄만 지우면 된다.

export const CHARACTERS = [
  {
    id: 'mandragora',
    name: '만드라고라',
    unlockAt: 0,
    previewZoom: 1.18,       // 잎이 길어 작아 보여, 고르는 화면에서만 살짝 당긴다
    body: 0xf2e6cd,
    profile: [
      [0.000, 0.00], [0.005, 0.18], [0.030, 0.34], [0.100, 0.48],
      [0.220, 0.56], [0.380, 0.575], [0.560, 0.56], [0.760, 0.51],
      [0.960, 0.44], [1.140, 0.34], [1.300, 0.21], [1.410, 0.09],
      [1.450, 0.00]
    ],
    top: { kind: 'leaves', count: 5, length: 1.5, color: '#a9d477' },
    skin: 'fiber'
  },
  {
    // 왕만두라고라 — 만드라고라 + 만두. 둥글고 통통한 찐만두에, 위는
    // 잎이 아니라 반죽을 여민 주름 꼭지가 앉는다.
    // 폭은 자동으로 똑같이 맞춰지므로(판정 공정), '통통함'은 실루엣으로 낸다.
    id: 'mandu',
    name: '왕만두라고라',
    unlockAt: 0,
    body: 0xf5e8c8,          // 노릇한 만두 반죽색
    profile: [               // 둥글고 통통한 찐만두. 위로 갈수록 좁아져 꼭지가 앉는다.
      [0.000, 0.00], [0.045, 0.32], [0.130, 0.47], [0.270, 0.56],
      [0.450, 0.59], [0.630, 0.58], [0.800, 0.53], [0.940, 0.44],
      [1.050, 0.32], [1.140, 0.20], [1.200, 0.11], [1.235, 0.00]
    ],
    top: { kind: 'pleat', color: 0xf5e8c8 },
    skin: 'grooves'          // 만두 주름 느낌
  },
  {
    // 만드라구라 — 이름 오타 밈. 만드라고라를 잘못 베낀 '짝퉁'.
    // 색은 칙칙하고, 몸은 삐뚤빼뚤, 잎은 축 처지고, 표정은 더 얼빠졌다.
    id: 'mandragura',
    name: '만드라구라',
    unlockAt: 0,
    previewZoom: 1.18,       // 만드라고라와 같은 이유로 살짝 당긴다
    body: 0xd8cfa2,          // 원본보다 누리끼리하고 칙칙한 짝퉁 색
    lumpy: 0.07,             // 삐뚤빼뚤 — 잘못 빚은 느낌
    profile: [               // 원본보다 홀쭉하고 길쭉하게 — 어딘가 어설프다
      [0.000, 0.00], [0.005, 0.16], [0.030, 0.31], [0.100, 0.44],
      [0.220, 0.51], [0.380, 0.53], [0.560, 0.515], [0.760, 0.47],
      [0.960, 0.40], [1.140, 0.31], [1.320, 0.19], [1.440, 0.085],
      [1.490, 0.00]
    ],
    // 잎이 적고 축 처지고 누렇게 뜬 색 (upright 를 낮춰 아래로 늘어뜨린다)
    top: { kind: 'leaves', count: 3, length: 1.35, color: '#b7bd63', upright: 0.34 },
    skin: 'fiber',
    // 심한 사시 + 크게 어긋난 눈썹 = 아주 얼빠진 짝퉁 표정
    face: { pupil: [[0.062, -0.032], [-0.056, 0.052]], brow: [0.12, -0.07] }
  },
  {
    id: 'carrot',
    wip: true,
    name: '당근',
    unlockAt: 30,
    body: 0xf0954a,
    // 위가 굵고 아래로 갈수록 뾰족해진다 — 당근을 세워 둔 모양.
    // 제일 굵은 데를 어깨(80% 높이)까지 올려야 당근으로 읽힌다.
    // 가운데가 제일 굵으면 그냥 주황색 덩어리로 보인다.
    profile: [
      [0.000, 0.00], [0.030, 0.08], [0.120, 0.17], [0.300, 0.27],
      [0.560, 0.37], [0.860, 0.46], [1.150, 0.52], [1.380, 0.555],
      [1.520, 0.55], [1.600, 0.50], [1.650, 0.36], [1.680, 0.18],
      [1.700, 0.00]
    ],
    top: { kind: 'leaves', count: 7, length: 1.6, color: '#7fbf52', upright: 1.05 },
    skin: 'grooves'
  },
  {
    id: 'mushroom',
    wip: true,
    name: '버섯',
    unlockAt: 60,
    body: 0xf6ecd8,
    // 짧고 통통한 기둥. 위에 갓이 덮인다.
    profile: [
      [0.000, 0.00], [0.020, 0.24], [0.090, 0.33], [0.260, 0.345],
      [0.520, 0.335], [0.780, 0.325], [0.940, 0.32], [0.990, 0.28],
      [1.010, 0.00]
    ],
    top: { kind: 'cap', radius: 0.78, height: 0.52, color: 0xe0483f, dots: 0xfff6ea }
  },
  {
    id: 'acorn',
    wip: true,
    name: '도토리',
    unlockAt: 90,
    body: 0xe8c48f,
    profile: [
      [0.000, 0.00], [0.030, 0.24], [0.120, 0.42], [0.300, 0.54],
      [0.550, 0.58], [0.800, 0.56], [1.000, 0.48], [1.150, 0.34],
      [1.220, 0.15], [1.250, 0.00]
    ],
    top: { kind: 'acorn', radius: 0.74, height: 0.5, color: 0x7a5230 }
  },
  {
    id: 'cactus',
    wip: true,
    name: '선인장',
    unlockAt: 120,
    body: 0x5aa05a,
    // 위로 곧게 뻗은 기둥
    profile: [
      [0.000, 0.00], [0.020, 0.30], [0.100, 0.40], [0.300, 0.44],
      [0.700, 0.45], [1.100, 0.44], [1.400, 0.41], [1.550, 0.32],
      [1.620, 0.16], [1.650, 0.00]
    ],
    top: { kind: 'spikes', color: 0xf5f0dc, flower: 0xf2a4c0 },
    skin: 'ribs',
    armStyle: 'up',
    armScale: 1.9        // 선인장 팔은 길게 뻗어야 선인장으로 보인다
  },
  {
    id: 'potato',
    wip: true,
    name: '감자',
    unlockAt: 150,
    body: 0xc8a06a,
    profile: [
      [0.000, 0.00], [0.040, 0.28], [0.150, 0.46], [0.350, 0.56],
      [0.600, 0.60], [0.850, 0.57], [1.050, 0.48], [1.180, 0.32],
      [1.250, 0.14], [1.280, 0.00]
    ],
    top: { kind: 'sprout', count: 3, color: '#8fbf62', length: 0.62 },
    skin: 'speckle',
    lumpy: 0.05
  }
];

export const DEFAULT_CHARACTER = CHARACTERS[0].id;

// 지금 고를 수 있는 것들. 화면에도 이것만 나온다.
export const PLAYABLE = CHARACTERS.filter((c) => !c.wip);

// 아직 다듬는 중인 캐릭터가 남아 있는가. 있으면 고르는 화면에 안내를 띄운다.
export const HAS_WIP = CHARACTERS.some((c) => c.wip);

// findCharacter 는 wip 도 찾아 준다. 1v1 상대가 예전에 고른 캐릭터를
// 보내올 수 있는데, 여기서 못 찾으면 상대가 통째로 안 보인다.
export function findCharacter(id) {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export const isPlayable = (spec) => !!spec && !spec.wip;

// 최고 기록으로 열린 캐릭터인지
export function isUnlocked(spec, bestSeconds) {
  return (bestSeconds ?? 0) >= spec.unlockAt;
}
