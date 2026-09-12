// 일시정지 화면 (ESC).
//
// 혼자 하기는 진짜로 멈춘다.
// 온라인 대전은 서버가 계속 돌기 때문에 멈출 수 없다. 메뉴만 띄우고
// 게임은 그대로 진행되며, '다시 시작' 대신 '대전 포기'를 보여 준다.

import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);

export class PauseUI {
  constructor(handlers) {
    this.h = handlers;
    this.el = {
      screen: $('pause-screen'),
      note: $('pause-note'),
      resume: $('resume-btn'),
      restart: $('restart-btn'),
      home: $('pause-home-btn'),
      title: document.querySelector('#pause-screen .panel-title')
    };

    this.el.resume.addEventListener('click', () => this.h.onResume());
    this.el.restart.addEventListener('click', () => this.h.onRestart());
    this.el.home.addEventListener('click', () => this.h.onHome());
  }

  get open() { return !this.el.screen.classList.contains('hidden'); }

  show(mode) {
    const versus = mode === 'versus';
    this.el.title.textContent = versus ? t('pause.menuTitle') : t('pause.title');
    this.el.note.textContent = versus ? t('pause.versusNote') : '';
    this.el.restart.textContent = versus ? t('pause.giveUp') : t('pause.restart');
    this.el.home.classList.toggle('hidden', versus);
    this.el.screen.classList.remove('hidden');
  }

  hide() {
    this.el.screen.classList.add('hidden');
  }
}
