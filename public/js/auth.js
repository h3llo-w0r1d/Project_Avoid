// 로그인 화면.
//
// 세션은 HttpOnly 쿠키라 자바스크립트가 읽을 수 없다. 그래서 "지금
// 로그인한 사람이 누구인지"는 서버에 물어본다(/api/me). 쿠키를 못 읽는
// 대신, XSS 로 세션을 훔쳐가지도 못한다.

const $ = (id) => document.getElementById(id);

const GUEST_KEY = 'avoidarc.guestName';

// 게스트 이름은 Guest + 네 자리 숫자로 자동으로 짓는다.
// 한 번 정해지면 이 브라우저에서는 계속 같은 이름을 쓴다. 매번 바뀌면
// 랭킹에 같은 사람의 기록이 다른 이름으로 흩어진다.
export function guestName() {
  let name = localStorage.getItem(GUEST_KEY);
  if (!/^Guest\d{4}$/.test(name ?? '')) {
    name = `Guest${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    localStorage.setItem(GUEST_KEY, name);
  }
  return name;
}

// 제공자 로고. 이미지 파일을 두지 않으려고 SVG 로 직접 그린다.
// 글자 'G' 로 대신하면 버튼이 "G Google로 로그인" 처럼 읽혀 어색하다.
const MARKS = {
  google: `<svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>`,
  apple: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16.36 12.76c.02-2.3 1.88-3.4 1.96-3.45-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3-.79-1.54.02-2.97.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74s1.78.74 3 .72c1.24-.02 2.02-1.13 2.78-2.23.88-1.28 1.24-2.52 1.26-2.58-.03-.01-2.41-.93-2.42-3.7zM14.1 5.9c.63-.77 1.06-1.83.94-2.9-.91.04-2.01.61-2.67 1.37-.59.68-1.1 1.77-.96 2.81 1.02.08 2.06-.52 2.69-1.28z"/>
  </svg>`
};

export class Auth {
  constructor(handlers) {
    this.h = handlers;
    this.user = null;      // 로그인 안 했으면 null
    this.guest = false;    // 게스트로 하기를 고른 상태

    this.el = {
      signedOut: $('signed-out'),
      signedIn: $('signed-in'),
      providers: $('provider-buttons'),
      authError: $('auth-error'),
      accountName: $('account-name'),
      accountRecord: $('account-record'),
      logoutBtn: $('logout-btn'),
      playButtons: $('play-buttons'),
      setupScreen: $('setup-screen'),
      setupInput: $('setup-nickname'),
      setupError: $('setup-error')
    };

    $('guest-btn').addEventListener('click', () => this.playAsGuest());
    $('logout-btn').addEventListener('click', () => this.logout());
    $('setup-save-btn').addEventListener('click', () => this.saveNickname());
    this.el.setupInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveNickname();
    });
  }

  get signedIn() { return Boolean(this.user); }

  // 로그인했으면 계정 닉네임, 아니면 자동으로 지어진 게스트 이름
  get displayName() {
    return this.user?.nickname ?? guestName();
  }

  async init() {
    // 로그인 실패 메시지를 주소로 되돌려 받는다
    const params = new URLSearchParams(location.search);
    const authError = params.get('authError');
    if (authError) this.el.authError.textContent = authError;

    const [me, providers] = await Promise.all([
      fetch('/api/me').then((r) => r.json()).catch(() => null),
      fetch('/api/auth/providers').then((r) => r.json()).catch(() => [])
    ]);

    this.user = me;
    this.hasProviders = Boolean(providers?.length);
    this.renderProviders(providers);

    // 로그인을 설정하지 않은 서버라면 고를 것도 없다.
    // 「게스트로 하기」를 한 번 누르게 하는 건 의미 없는 단계라 건너뛴다.
    if (!this.hasProviders) this.guest = true;

    // 첫 로그인이라 닉네임이 없으면 정하는 화면부터
    if (this.user && !this.user.nickname) {
      this.showSetup();
    } else {
      this.render();
    }

    // 주소창을 깨끗하게 되돌린다
    if (params.has('authError') || params.has('setup')) {
      history.replaceState(null, '', location.pathname);
    }
  }

  renderProviders(providers) {
    this.el.providers.innerHTML = '';

    if (!providers || providers.length === 0) {
      // 서버에 열쇠가 없으면 로그인 버튼 자체가 없다.
      // 그래도 게스트로는 놀 수 있어야 한다.
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = '로그인이 설정되어 있지 않습니다. 게스트로 플레이할 수 있습니다.';
      this.el.providers.appendChild(note);
      return;
    }

    for (const p of providers) {
      const btn = document.createElement('button');
      btn.className = `provider-btn ${p.name}`;
      btn.type = 'button';
      btn.innerHTML = '<span class="mark"></span><span class="text"></span>';
      // 로고는 코드에 박아 둔 고정 SVG 라 innerHTML 로 넣어도 안전하다.
      // 이름(p.label)은 서버에서 온 값이므로 textContent 로만 넣는다.
      btn.querySelector('.mark').innerHTML = MARKS[p.name] ?? '';
      btn.querySelector('.text').textContent = `${p.label}로 로그인`;
      btn.addEventListener('click', () => { location.href = `/auth/${p.name}`; });
      this.el.providers.appendChild(btn);
    }
  }

  render() {
    const signedIn = this.signedIn;
    const playing = signedIn || this.guest;

    this.el.signedIn.classList.toggle('hidden', !playing);
    this.el.signedOut.classList.toggle('hidden', playing);
    this.el.playButtons.classList.toggle('hidden', !playing);

    if (signedIn) {
      this.el.accountName.textContent = this.user.nickname;
      // 이번 시즌 전적을 보여 준다. 통산으로 보여 주면 시즌 랭킹의
      // 순위와 숫자가 달라 헷갈린다.
      const { seasonWins = 0, seasonLosses = 0, streak = 0 } = this.user;
      const record = seasonWins + seasonLosses > 0 ? `${seasonWins}승 ${seasonLosses}패` : '';
      // 2연승부터 보여 준다. 1연승은 그냥 한 판 이긴 것이다.
      this.el.accountRecord.textContent = streak >= 2 ? `${record} · ${streak}연승` : record;
      this.el.logoutBtn.textContent = '로그아웃';
      this.el.logoutBtn.classList.remove('hidden');
    } else if (this.guest) {
      // 게스트도 자기 이름을 보여 준다. 전적은 계정에만 쌓인다.
      this.el.accountName.textContent = guestName();
      this.el.accountRecord.textContent = '게스트';
      // 로그인 수단이 아예 없는 서버라면 되돌아갈 곳도 없다
      this.el.logoutBtn.textContent = '로그인';
      this.el.logoutBtn.classList.toggle('hidden', !this.hasProviders);
    }

    this.h.onChange?.(this.user);
  }

  playAsGuest() {
    this.guest = true;
    this.el.authError.textContent = '';
    this.render();
  }

  showSetup() {
    this.el.setupScreen.classList.remove('hidden');
    this.el.setupError.textContent = '';
    this.el.setupInput.focus();
    this.h.onSetupOpen?.();
  }

  // 닉네임을 서버에 올린다. 처음 정할 때도, 나중에 바꿀 때도 같은 길이다.
  async putNickname(nickname) {
    const res = await fetch('/api/me/nickname', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    this.user = data;
    this.render();
    return data;
  }

  async saveNickname() {
    this.el.setupError.textContent = '';
    try {
      await this.putNickname(this.el.setupInput.value.trim());
      this.el.setupScreen.classList.add('hidden');
      this.h.onSetupDone?.();
    } catch (err) {
      this.el.setupError.textContent = err.message;
    }
  }

  // 로그인 상태면 로그아웃, 게스트 상태면 로그인 화면으로 되돌아간다
  async logout() {
    if (this.signedIn) {
      await fetch('/api/logout', { method: 'POST' }).catch(() => {});
      this.user = null;
    }
    this.guest = false;
    this.render();
  }

  // 대전이 끝난 뒤 전적을 다시 받아 온다
  async refresh() {
    if (!this.signedIn) return;
    try {
      const me = await fetch('/api/me').then((r) => r.json());
      if (me) {
        this.user = me;
        this.render();
      }
    } catch { /* 실패해도 게임에는 지장 없다 */ }
  }
}
