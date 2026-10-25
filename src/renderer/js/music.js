// 背景音樂播放器（每台電腦各自播放，不經過網路）
import { $, h, toast } from './util.js';

const ICONS = {
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z',
  prev: 'M5 5h2.5v14H5zM19.5 5v14L8.5 12z',
  next: 'M16.5 5H19v14h-2.5zM4.5 5v14l11-7z',
  shuffle: 'M16 4l4 4-4 4V9.5h-2.2l-6 7H4V14h2.6l6-7H16zM4 7h3.8l1.8 2.1-1.6 1.9L6.6 9.5H4zM16 12l4 4-4 4v-2.5h-3.8l-1.8-2.1 1.6-1.9 1.4 1.5H16z',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
}

export class MusicPlayer {
  constructor(root, settings, save) {
    this.root = root;
    this.save = save;
    this.cfg = { ...settings.music };
    this.tracks = [];
    this.idx = Math.max(0, this.cfg.track || 0);
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.duck = 1;
    this.audio.volume = this.cfg.volume;
    this.audio.addEventListener('ended', () => this.next(true));
    this.audio.addEventListener('timeupdate', () => this.renderTime());
    this.audio.addEventListener('play', () => this.renderState());
    this.audio.addEventListener('pause', () => this.renderState());
    this.audio.addEventListener('error', () => { if (this.tracks.length > 1) setTimeout(() => this.next(true), 500); });
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    this.titleEl = h('div', { class: 'mu-title' }, '—');
    this.timeEl = h('div', { class: 'mu-time' }, '0:00 / 0:00');
    this.seek = h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'mu-seek', oninput: () => { if (this.audio.duration) this.audio.currentTime = (this.seek.value / 1000) * this.audio.duration; } });
    this.btnPlay = h('button', { class: 'mu-btn big', title: '播放／暫停', onclick: () => this.toggle() }, icon('play'));
    this.btnShuffle = h('button', { class: 'mu-btn', title: '隨機播放', onclick: () => { this.cfg.shuffle = !this.cfg.shuffle; this.persist(); this.renderState(); } }, icon('shuffle'));
    this.vol = h('input', { type: 'range', min: 0, max: 100, value: Math.round(this.cfg.volume * 100), class: 'mu-vol', oninput: () => { this.cfg.volume = this.vol.value / 100; this.applyVolume(); this.persist(); } });
    this.list = h('div', { class: 'mu-list' });
    r.append(
      h('div', { class: 'mu-now' }, h('span', { class: 'mu-disc' }, '♫'), h('div', { class: 'mu-meta' }, this.titleEl, this.timeEl)),
      this.seek,
      h('div', { class: 'mu-ctrl' },
        h('button', { class: 'mu-btn', title: '上一首', onclick: () => this.prev() }, icon('prev')),
        this.btnPlay,
        h('button', { class: 'mu-btn', title: '下一首', onclick: () => this.next() }, icon('next')),
        this.btnShuffle,
        h('span', { class: 'mu-volicon' }, '🔊'), this.vol),
      h('div', { class: 'mu-listhead' }, h('span', {}, '曲目'), h('button', { class: 'link', onclick: () => this.addOwn() }, '＋ 加入自己的音樂')),
      this.list,
    );
  }

  async load() {
    this.tracks = await xk.music.list();
    if (this.idx >= this.tracks.length) this.idx = 0;
    this.renderList();
    if (this.tracks.length) this.setTrack(this.idx, false);
  }

  renderList() {
    this.list.innerHTML = '';
    this.tracks.forEach((t, i) => {
      const row = h('div', { class: 'mu-item' + (i === this.idx ? ' on' : ''), ondblclick: () => this.setTrack(i, true), onclick: () => this.setTrack(i, true) },
        h('span', { class: 'n' }, String(i + 1).padStart(2, '0')),
        h('span', { class: 't' }, t.title),
        t.builtin ? h('span', { class: 'd' }, fmt(t.seconds)) : h('button', { class: 'link small', title: '移除', onclick: async (e) => { e.stopPropagation(); await xk.music.remove(t.file); await this.load(); } }, '✕'));
      this.list.append(row);
    });
  }

  setTrack(i, play) {
    if (!this.tracks.length) return;
    this.idx = (i + this.tracks.length) % this.tracks.length;
    const t = this.tracks[this.idx];
    this.audio.src = t.url;
    this.titleEl.textContent = t.title;
    this.cfg.track = this.idx;
    this.persist();
    [...this.list.children].forEach((el, k) => el.classList.toggle('on', k === this.idx));
    const cur = this.list.children[this.idx];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
    if (play) this.play();
  }

  play() {
    if (!this.tracks.length) return;
    if (!this.audio.src) this.setTrack(this.idx, false);
    this.audio.play().catch(() => {});
    this.cfg.enabled = true; this.persist();
  }
  pause() { this.audio.pause(); this.cfg.enabled = false; this.persist(); }
  toggle() { if (this.audio.paused) this.play(); else this.pause(); }
  get playing() { return !this.audio.paused; }

  next(auto = false) {
    if (!this.tracks.length) return;
    let i = this.idx + 1;
    if (this.cfg.shuffle && this.tracks.length > 1) { do { i = Math.floor(Math.random() * this.tracks.length); } while (i === this.idx); }
    this.setTrack(i, auto || this.playing);
    if (auto) this.play();
  }
  prev() {
    if (this.audio.currentTime > 4) { this.audio.currentTime = 0; return; }
    this.setTrack(this.idx - 1, this.playing);
  }

  // 語音通話時自動降低音量
  setDuck(on) { this.duck = on ? 0.35 : 1; this.applyVolume(); }
  applyVolume() { this.audio.volume = Math.max(0, Math.min(1, this.cfg.volume * this.duck)); }

  async addOwn() {
    const n = await xk.music.add();
    if (n) { toast(`已加入 ${n} 首音樂`, 'ok'); await this.load(); }
  }

  renderState() {
    this.btnPlay.replaceChildren(icon(this.playing ? 'pause' : 'play'));
    this.btnShuffle.classList.toggle('on', !!this.cfg.shuffle);
    this.root.classList.toggle('playing', this.playing);
    const mini = $('#miniMusic');
    if (mini) mini.textContent = this.playing ? '♫ ' + (this.tracks[this.idx]?.title || '') : '♫ 背景音樂（暫停）';
  }

  renderTime() {
    const a = this.audio;
    this.timeEl.textContent = `${fmt(a.currentTime)} / ${fmt(a.duration)}`;
    if (a.duration && document.activeElement !== this.seek) this.seek.value = Math.round((a.currentTime / a.duration) * 1000);
  }

  persist() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.save({ music: { volume: this.cfg.volume, shuffle: this.cfg.shuffle, track: this.cfg.track, enabled: this.cfg.enabled } }), 400);
  }
}

function fmt(s) {
  if (!isFinite(s)) return '0:00';
  s = Math.floor(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
