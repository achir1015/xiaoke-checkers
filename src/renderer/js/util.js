// 共用小工具
export class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter((f) => f !== fn); }
  emit(ev, ...a) { for (const f of [...(this._h[ev] || [])]) { try { f(...a); } catch (e) { console.error(e); } } }
}

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const errMsg = (e) => (e && (e.message || e.type)) || String(e);

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function toast(text, kind = 'info', ms = 3200) {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, text);
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
}

// 對話框：buttons = [{label, value, primary}]；回傳選到的 value
export function modal(title, body, buttons = [{ label: '確定', value: true, primary: true }], { timeout = 0, timeoutValue = null } = {}) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    let timer = null;
    const done = (v) => { clearTimeout(timer); back.remove(); resolve(v); };
    const content = typeof body === 'string' ? h('p', {}, body) : body;
    const box = h('div', { class: 'modal' },
      h('h3', {}, title),
      content,
      h('div', { class: 'modal-btns' }, buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: () => done(b.value) }, b.label))));
    back.append(box);
    document.body.append(back);
    const first = box.querySelector('button.primary') || box.querySelector('button');
    if (first) setTimeout(() => first.focus(), 30);
    if (timeout) timer = setTimeout(() => done(timeoutValue), timeout);
  });
}

export function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
