// 온라인 1v1 화면. 로비 조작과 결과 표시만 담당하고,
// 통신은 net.js, 게임 진행은 main.js 가 맡는다.

import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);

export class VersusUI {
  constructor(handlers) {
    this.h = handlers;

    this.el = {
      screen: $('versus-screen'),
      status: $('versus-status'),
      menu: $('versus-menu'),
      waiting: $('versus-waiting'),
      codeBox: $('room-code-display'),
      codeValue: $('room-code-value'),
      roomInput: $('room-code'),
      result: $('result-screen'),
      resultTitle: $('result-title'),
      resultTime: $('result-time'),
      resultNote: $('result-note'),
      resultPlayers: $('result-players'),
      countdown: $('countdown'),
      countdownNum: $('countdown-num'),
      versusHud: $('versus-hud'),
      opponentState: $('opponent-state'),
      pingLabel: $('ping-label')
    };

    $('versus-btn').addEventListener('click', () => this.h.onOpen());
    $('versus-back-btn').addEventListener('click', () => this.h.onBack());
    $('queue-btn').addEventListener('click', () => this.h.onQueue());
    $('create-room-btn').addEventListener('click', () => this.h.onCreateRoom());
    $('cancel-wait-btn').addEventListener('click', () => this.h.onCancel());
    $('rematch-btn').addEventListener('click', () => this.h.onOpen());
    $('result-home-btn').addEventListener('click', () => this.h.onBack());

    $('join-room-btn').addEventListener('click', () => this.joinRoom());
    this.el.roomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.joinRoom();
    });

    $('copy-code-btn').addEventListener('click', () => {
      navigator.clipboard?.writeText(this.el.codeValue.textContent)
        .then(() => this.setStatus(t('versus.copied')))
        .catch(() => this.setStatus(t('versus.copyFailed'), true));
    });
  }

  joinRoom() {
    const code = this.el.roomInput.value.trim().toUpperCase();
    if (!code) return this.setStatus(t('versus.enterCode'), true);
    this.h.onJoinRoom(code);
  }

  // ---------------------------------------------------------------- 화면

  showMenu() {
    this.el.screen.classList.remove('hidden');
    this.el.result.classList.add('hidden');
    this.el.menu.classList.remove('hidden');
    this.el.waiting.classList.add('hidden');
    this.el.codeBox.classList.add('hidden');
    this.setStatus('');
  }

  hide() {
    this.el.screen.classList.add('hidden');
    this.el.result.classList.add('hidden');
    this.el.countdown.classList.add('hidden');
    this.el.versusHud.classList.add('hidden');
  }

  // 상대를 기다리는 중. code 가 있으면 방 코드를 함께 보여 준다.
  showWaiting(message, code = null) {
    this.el.screen.classList.remove('hidden');
    this.el.menu.classList.add('hidden');
    this.el.waiting.classList.remove('hidden');
    this.el.codeBox.classList.toggle('hidden', !code);
    if (code) this.el.codeValue.textContent = code;
    this.setStatus(message);
  }

  setStatus(text, isError = false) {
    this.el.status.textContent = text;
    this.el.status.classList.toggle('error', isError);
  }

  // ---------------------------------------------------------------- 대전

  showCountdown(n) {
    this.el.countdown.classList.remove('hidden');
    // 같은 숫자를 다시 넣으면 애니메이션이 안 돌아서, 노드를 갈아 끼운다
    const span = document.createElement('span');
    span.id = 'countdown-num';
    span.textContent = n > 0 ? String(n) : 'GO';
    this.el.countdownNum.replaceWith(span);
    this.el.countdownNum = span;
  }

  hideCountdown() {
    this.el.countdown.classList.add('hidden');
  }

  showVersusHud() {
    this.el.versusHud.classList.remove('hidden');
  }

  updateVersusHud({ opponentName, opponentAlive, ping }) {
    this.el.opponentState.textContent = opponentAlive
      ? t('versus.opponentAlive', { name: opponentName })
      : t('versus.opponentDown', { name: opponentName });
    this.el.opponentState.classList.toggle('down', !opponentAlive);
    this.el.pingLabel.textContent = ping ? `${ping}ms` : '';
  }

  showResult({ outcome, duration, players, myId, reason }) {
    this.hideCountdown();
    this.el.versusHud.classList.add('hidden');
    this.el.screen.classList.add('hidden');
    this.el.result.classList.remove('hidden');

    const title = { win: t('versus.outcomeWin'), lose: t('versus.outcomeLose'), draw: t('versus.outcomeDraw') }[outcome];
    this.el.resultTitle.textContent = title;
    this.el.resultTitle.className = `panel-title ${outcome}`;

    this.el.resultTime.textContent = duration.toFixed(2);

    if (reason === 'left') {
      this.el.resultNote.textContent = outcome === 'win'
        ? t('versus.opponentLeft')
        : t('versus.lostConnectionNote');
    } else {
      this.el.resultNote.textContent = t('versus.roundLength');
    }

    this.el.resultPlayers.innerHTML = '';
    for (const p of players) {
      const li = document.createElement('li');
      if (p.id === myId) li.className = 'me';
      li.innerHTML = `
        <span class="who"></span>
        <span class="tag"></span>
        <span class="secs">${Number(p.survived).toFixed(2)}s</span>`;
      li.querySelector('.who').textContent = p.name;
      li.querySelector('.tag').textContent = CAUSE_LABEL[p.cause]?.() ?? t('versus.causeSurvived');
      this.el.resultPlayers.appendChild(li);
    }
  }
}

const CAUSE_LABEL = {
  zap: () => t('versus.causeZap'),
  fall: () => t('versus.causeFall'),
  left: () => t('versus.causeLeft')
};
