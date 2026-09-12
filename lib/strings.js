// 서버가 플레이어에게 보내는 오류·안내 문구 사전. public/js/strings.js 와
// 모양(ko/en)만 같고 서로 다른 사전이다 — 여기 값은 lib/i18n.js 의 t(req, 키)
// 로만 쓰인다. 관리자 전용 라우트(서버.js 의 requireAdmin 라우트들)는 이
// 사전을 거치지 않고 한국어 문구를 그대로 둔다.
export const STRINGS = {
  // ── 공용 ────────────────────────────────────────────────────
  'api.needLogin': { ko: '로그인이 필요합니다.', en: 'Please log in.' },
  'api.needNickname': { ko: '닉네임을 먼저 정해 주세요.', en: 'Please set a nickname first.' },
  'api.badGuestName': { ko: '게스트 이름 형식이 아닙니다.', en: 'Not a valid guest name format.' },
  'api.nameRequired': { ko: '이름이 필요합니다.', en: 'Name is required.' },
  'api.badWord': { ko: '사용할 수 없는 표현이 들어 있습니다.', en: 'Contains a word that cannot be used.' },

  // ── 혼자 하기 기록(/api/scores) ──────────────────────────────
  'api.tooFast': { ko: '너무 빠릅니다. 잠시 후 다시 시도하세요.', en: 'Too fast. Please try again in a moment.' },
  'api.invalidTime': { ko: '기록 값이 올바르지 않습니다.', en: 'Invalid time value.' },
  'api.saveScoreFailed': { ko: '서버에 기록을 저장하지 못했습니다.', en: 'Failed to save your run on the server.' },

  // ── 다시보기(/api/replay) ────────────────────────────────────
  'api.scoreNotFound': { ko: '기록을 찾을 수 없습니다.', en: "Couldn't find that run." },
  'api.notYourScore': { ko: '자기 기록만 올릴 수 있습니다.', en: 'You can only attach this to your own run.' },
  'api.timeMismatch': { ko: '기록 시간이 맞지 않습니다.', en: "The time doesn't match the run." },
  'api.badSeed': { ko: 'seed 가 올바르지 않습니다.', en: 'Invalid seed.' },
  'api.modeMismatch': { ko: '모드가 맞지 않습니다.', en: "The mode doesn't match." },
  'api.badReplayData': { ko: '기록 데이터가 올바르지 않습니다.', en: 'Invalid replay data.' },
  'api.badReplaySize': { ko: '기록 데이터 크기가 올바르지 않습니다.', en: 'Invalid replay data size.' },
  'api.saveReplayFailed': { ko: '다시보기를 저장하지 못했습니다.', en: 'Failed to save the replay.' },

  // ── 게시판(/api/board) ───────────────────────────────────────
  'api.boardCooldown': { ko: '잠시 후 다시 올려 주세요. ({secs}초)', en: 'Please wait a moment before posting again. ({secs}s)' },
  'api.replyTargetMissing': { ko: '답글을 달 글을 찾지 못했습니다.', en: "Couldn't find the post to reply to." },
  'api.staffOnlyCategory': { ko: '이 칸에는 운영자만 글을 쓸 수 있습니다.', en: 'Only staff can post in this category.' },
  'api.savePostFailed': { ko: '글을 저장하지 못했습니다.', en: 'Failed to save the post.' },

  // ── 구매·룰렛·도전모드·봇전 로그(참고용) ─────────────────────
  'api.characterRequired': { ko: '캐릭터가 필요합니다.', en: 'A character is required.' },
  'api.logFailed': { ko: '기록에 실패했습니다.', en: 'Failed to log this.' },
  'api.saveLogFailed': { ko: '기록 저장 실패', en: 'Failed to save the log' },

  // ── 투표 ────────────────────────────────────────────────────
  'api.pollNotFound': { ko: '없는 투표입니다.', en: "That poll doesn't exist." },
  'api.badPollChoice': { ko: '고를 수 없는 항목입니다.', en: "That's not a choosable option." },
  'api.unknownVoter': { ko: '누구인지 알 수 없습니다.', en: "Couldn't identify you." },

  // ── 도전모드(탑) ────────────────────────────────────────────
  'api.floorNotFound': { ko: '없는 층입니다.', en: "That floor doesn't exist." },
  'api.floorNotReady': { ko: '아직 준비 중인 층입니다.', en: "That floor isn't ready yet." },

  // ── 칭호 ────────────────────────────────────────────────────
  'api.titleNotAwardable': { ko: '수여할 수 없는 칭호입니다.', en: "That title can't be awarded." },

  // ── 로그인(auth-routes.js) ───────────────────────────────────
  'api.providerDisabled': { ko: '그 로그인 수단은 켜져 있지 않습니다.', en: "That sign-in method isn't enabled." },
  'api.loginCancelled': { ko: '로그인이 취소되었습니다.', en: 'Login was cancelled.' },
  'api.loginExpired': { ko: '로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.', en: 'The login request expired or is invalid. Please try again.' },
  'api.noAuthCode': { ko: '인가 코드가 없습니다.', en: 'No authorization code was provided.' },
  'api.loginFailed': { ko: '로그인에 실패했습니다. 잠시 뒤 다시 시도해 주세요.', en: 'Login failed. Please try again shortly.' },
  'api.nicknameRequired': { ko: '닉네임을 입력해 주세요.', en: 'Please enter a nickname.' },
  'api.nicknameTaken': { ko: '이미 쓰고 있는 닉네임입니다.', en: 'That nickname is already taken.' },

  // ── 닉네임·게시글 내용 검사(profanity.js) ─────────────────────
  'api.nicknameTooLong': { ko: '닉네임은 {n}자까지 쓸 수 있습니다.', en: 'Nicknames can be up to {n} characters.' },
  'api.nicknameNeedChar': { ko: '글자나 숫자를 하나 이상 넣어 주세요.', en: 'Please include at least one letter or digit.' },
  'api.nicknameGuestLike': { ko: 'Guest 로 시작하는 이름은 쓸 수 없습니다.', en: "Names starting with 'Guest' aren't allowed." },
  'api.messageEmpty': { ko: '내용을 입력해 주세요.', en: 'Please enter some text.' },
  'api.messageTooLong': { ko: '{n}자까지 쓸 수 있습니다.', en: 'Up to {n} characters allowed.' },
  'api.messageNeedChar': { ko: '글자나 숫자를 넣어 주세요.', en: 'Please include a letter or digit.' },

  // ── 혼자 하기 기록 표(tickets.js) ─────────────────────────────
  'api.ticketInvalid': { ko: '기록을 확인할 수 없습니다. 게임을 다시 시작해 주세요.', en: "Couldn't verify your run. Please restart the game." },
  'api.ticketExpired': { ko: '너무 오래된 기록입니다. 게임을 다시 시작해 주세요.', en: 'This run is too old. Please restart the game.' },
  'api.ticketTimeMismatch': { ko: '기록이 실제 경과 시간과 맞지 않습니다.', en: "The time doesn't match how long you actually played." },

  // ── 1v1 로비(lobby.js, WebSocket) ─────────────────────────────
  'api.roomNotFound': { ko: '그런 방이 없습니다.', en: 'No such room.' },
  'api.roomIsMine': { ko: '내가 만든 방입니다.', en: "That's the room you created." },
  'api.roomFull': { ko: '이미 두 명이 차 있습니다.', en: 'The room already has two players.' },

  // ── 판수 랭킹(/api/play-ranks) 안내 문구 ───────────────────────
  'api.notePlays': { ko: '시즌과 상관없는 통산 판수입니다 · 혼자 하기·탑 오르기·봇전·1대1 을 모두 셉니다', en: 'All-time play count regardless of season · Counts Solo Run, Tower Climb, Bot Match and 1v1' },
  'api.notePlaytime': { ko: '시즌과 상관없는 통산 플레이 시간입니다 · 모든 모드를 셉니다', en: 'All-time playtime regardless of season · Counts every mode' }
};
