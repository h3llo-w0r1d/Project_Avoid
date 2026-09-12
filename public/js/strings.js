// 화면 문구 사전. ko/en 을 나란히 둔다 — 따로 파일을 두면 한쪽만 넣고
// 잊어버린 걸 코드 리뷰에서나 알아채게 된다.
//
// 1단계 범위: 처음 들어온 사람이 보는 화면(타이틀·로그인·닉네임 정하기·
// 일시정지·설정 창)까지만. 상점·캐릭터·프로필·게시판·탑·서버 문구는
// 2·3단계다. 캐릭터 이름(만드라고라 등)은 말장난이라 여기 넣지 않는다 —
// 번역하면 뜻도 웃음도 죽는다.
export const STRINGS = {
  // ── 타이틀 화면 ──────────────────────────────────────────────
  'menu.solo': { ko: '혼자 하기', en: 'Solo Run' },
  'menu.bot': { ko: '봇전', en: 'Bot Match' },
  'menu.versus': { ko: '온라인 1v1', en: 'Online 1v1' },
  'menu.tower': { ko: '탑 오르기', en: 'Tower Climb' },
  'menu.rank': { ko: '랭킹', en: 'Leaderboard' },
  'menu.shop': { ko: '상점', en: 'Shop' },
  'menu.char': { ko: '캐릭터', en: 'Characters' },
  'menu.tagline': { ko: '붉은 전기선에 닿으면 GAMEOVER', en: 'Touch the red current and it\'s game over' },
  'menu.hardcore': { ko: '하드코어 모드', en: 'Hardcore Mode' },
  'menu.hardcoreHint': { ko: '2단 점프 불가능 · 맵 사라짐 및 난이도 증가', en: 'No double jump — floor vanishes and difficulty rises' },
  'menu.voiceJump': { ko: '음성 인식 점프 모드', en: 'Voice Jump Mode' },
  'menu.voiceJumpHint': { ko: '오로지 음성으로만 점프 가능', en: 'Jump using only your voice' },
  'menu.profile': { ko: '프로필', en: 'Profile' },
  'menu.roulette': { ko: '룰렛', en: 'Roulette' },
  'menu.community': { ko: '커뮤니티', en: 'Community' },

  // ── 공용 ────────────────────────────────────────────────────
  'common.fullscreen': { ko: '전체화면', en: 'Fullscreen' },
  'common.move': { ko: '이동', en: 'Move' },
  'common.jump': { ko: '점프 (2단 점프 가능)', en: 'Jump (double jump available)' },
  'common.pauseHint': { ko: '일시정지', en: 'Pause' },
  'common.touchControls': { ko: '화면 왼쪽 드래그 — 이동 · 오른쪽 탭 — 점프', en: 'Drag the left side to move, tap the right side to jump' },
  'common.privacy': { ko: '개인정보처리방침', en: 'Privacy Policy' },
  'common.terms': { ko: '이용약관', en: 'Terms of Service' },
  'common.start': { ko: '시작하기', en: 'Get Started' },
  'common.home': { ko: '처음으로', en: 'Home' },
  'common.on': { ko: '켜짐', en: 'On' },
  'common.off': { ko: '꺼짐', en: 'Off' },
  // 숫자 뒤에 바로 붙인다 — 영어는 '1.20s' 처럼 띄지 않는 쪽이 짧고 읽기 쉽다.
  'common.sec': { ko: '초', en: 's' },

  // ── 로그인 / 닉네임 ─────────────────────────────────────────
  'auth.guest': { ko: '게스트로 로그인', en: 'Continue as Guest' },
  'auth.noProviders': { ko: '로그인이 설정되어 있지 않습니다. 게스트로 플레이할 수 있습니다.', en: 'Sign-in isn\'t set up. You can still play as a guest.' },
  'auth.providerLogin': { ko: '{label}로 로그인', en: 'Sign in with {label}' },
  'auth.logout': { ko: '로그아웃', en: 'Log Out' },
  'auth.login': { ko: '로그인', en: 'Log In' },
  'auth.guestLabel': { ko: '게스트', en: 'Guest' },
  'auth.record': { ko: '{wins}승 {losses}패', en: '{wins}W {losses}L' },
  'auth.streak': { ko: '{record} · {streak}연승', en: '{record} · {streak} win streak' },
  'auth.setupTitle': { ko: '닉네임 정하기', en: 'Choose a Nickname' },
  'auth.setupDesc': { ko: '랭킹과 대전에서 이 이름으로 보입니다. 나중에 프로필(👤)에서 바꿀 수 있습니다.', en: 'This name shows on leaderboards and in matches. You can change it later in your profile (👤).' },
  'auth.nickname': { ko: '닉네임', en: 'Nickname' },
  'auth.nicknamePlaceholder': { ko: '10자 이내', en: 'Up to 10 characters' },

  // ── 일시정지 ────────────────────────────────────────────────
  'pause.title': { ko: '일시정지', en: 'Pause' },
  'pause.menuTitle': { ko: '메뉴', en: 'Menu' },
  'pause.versusNote': { ko: '대전은 계속 진행됩니다. 나가면 패배 처리됩니다.', en: 'The match keeps running. Leaving counts as a loss.' },
  'pause.resume': { ko: '계속하기', en: 'Resume' },
  'pause.restart': { ko: '다시 시작', en: 'Restart' },
  'pause.giveUp': { ko: '대전 포기', en: 'Forfeit Match' },

  // ── 설정 창 ─────────────────────────────────────────────────
  'settings.title': { ko: '설정', en: 'Settings' },
  'settings.lang': { ko: '언어', en: 'Language' },
  'settings.langAuto': { ko: '자동', en: 'Auto' },
  'settings.langKo': { ko: '한국어', en: '한국어' },
  'settings.langEn': { ko: 'English', en: 'English' },
  'settings.sound': { ko: '소리', en: 'Sound' },
  'settings.music': { ko: '배경음', en: 'Music' },
  'settings.sfx': { ko: '효과음', en: 'Effects' },
  'settings.bgm': { ko: '배경음악', en: 'Background Music' },
  'settings.myMusic': { ko: '내 음악', en: 'My Music' },
  'settings.myMusicHint': { ko: '「내 음악」 을 누르면 파일을 고릅니다 (mp3 · m4a · wav · ogg · flac)', en: 'Tap "My Music" to pick a file (mp3, m4a, wav, ogg, flac)' },
  'settings.clearMusic': { ko: '지우고 기본 곡으로', en: 'Remove and use default track' },
  'settings.controls': { ko: '조작', en: 'Controls' },
  'settings.jump': { ko: '점프', en: 'Jump' },
  'settings.pressKey': { ko: '원하는 키 입력', en: 'Press a key' },
  'settings.pressToChange': { ko: '키를 눌러 바꿉니다.', en: 'Press a key to change it.' },
  'settings.moveFixedHint': { ko: '이동(WASD·화살표)은 고정입니다.', en: 'Movement (WASD/arrows) is fixed.' },
  'settings.moveKeyWarn': { ko: '이동에 쓰는 키예요', en: 'That key is used for movement' },
  'settings.screen': { ko: '화면', en: 'Display' },
  'settings.lowEffects': { ko: '화면 효과 줄이기', en: 'Reduce screen effects' },
  'settings.lowEffectsHint': { ko: '감전 번쩍임과 발자국 효과를 끕니다. (렉 걸림 감소)', en: 'Turns off shock flashes and footstep effects (reduces lag)' },
  'settings.resetAll': { ko: '모두 기본값으로', en: 'Reset to defaults' },
  'settings.numpad': { ko: '숫자판', en: 'Numpad' },
  'settings.loadingFile': { ko: '읽는 중…', en: 'Loading…' },
  'settings.fileError': { ko: '이 파일은 읽지 못했어요 (mp3·m4a·ogg·wav)', en: 'Couldn\'t read this file (mp3, m4a, ogg, wav)' },

  // ── 목소리 녹음 ─────────────────────────────────────────────
  'voice.title': { ko: '점프 소리', en: 'Jump Sound' },
  'voice.record': { ko: '녹음', en: 'Record' },
  'voice.rerecord': { ko: '다시 녹음', en: 'Re-record' },
  'voice.stop': { ko: '멈추기', en: 'Stop' },
  'voice.recording': { ko: '녹음 중…', en: 'Recording…' },
  'voice.saved': { ko: '저장했습니다', en: 'Saved' },
  'voice.hint': { ko: '점프할 때 낼 내 목소리', en: 'Your voice when you jump' },
  'voice.play': { ko: '듣기', en: 'Play' },
  'voice.erase': { ko: '지우기', en: 'Erase' },
  'voice.micAllowError': { ko: '마이크 사용을 허용해 주세요', en: 'Please allow microphone access' },
  'voice.micOpenError': { ko: '마이크를 열지 못했습니다', en: 'Could not open microphone' }
};
