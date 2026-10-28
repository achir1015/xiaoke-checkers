// AI 軍師小視窗：本機 AI 分析＋（有金鑰時）Claude 白話解說
import { h, uid } from './util.js';
import { boardText, cellName, findPath, isStep, mvFrom, mvTo, SEAT_NAMES, PIECES } from './rules.js';

const QUICK = [
  ['現在該怎麼走？', '現在輪到我，該怎麼走比較好？'],
  ['分析局勢', '請分析目前的局勢，各方進度如何？我有什麼要注意的？'],
  ['怎麼連跳？', '有沒有可以連跳很遠的走法？要怎麼搭橋讓棋子跳得更遠？'],
  ['教我技巧', '中國跳棋有什麼實用的技巧？請配合目前的局面說明。'],
];

export class AdvisorPanel {
  // ctx(): { game, mySeat, names, analyze(state, lines) → Promise<[{move,score,gain}]>, showHint(move) }
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.history = [];
    this.busy = null;
    this.hasKey = false;
    this.build();
    xk.advisor.onDelta((d) => { if (this.busy && d.id === this.busy.id) { this.busy.text += d.text; this.busy.el.textContent = this.busy.text; this.scroll(); } });
    xk.advisor.onDone((d) => this.onDone(d));
  }

  setHasKey(v) {
    this.hasKey = v;
    this.modeEl.textContent = v ? '🟢 Claude 軍師（線上）' : '⚪ 離線軍師（本機 AI）';
    this.modeEl.title = v ? '使用 Claude 以白話解說 AI 分析' : '尚未設定 Anthropic API 金鑰，只提供 AI 建議。可到「設定」輸入金鑰。';
  }

  build() {
    this.modeEl = h('div', { class: 'adv-mode' });
    this.log = h('div', { class: 'adv-log' });
    this.input = h('textarea', { class: 'adv-input', rows: 2, placeholder: '問軍師，例如：哪一顆棋子可以跳最遠？（Enter 送出）', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } } });
    this.btnSend = h('button', { class: 'primary', onclick: () => this.send() }, '請教');
    this.root.append(
      h('div', { class: 'adv-head' }, h('span', { class: 'adv-avatar' }, '🧙'), h('div', {}, h('b', {}, '小柯軍師'), this.modeEl)),
      this.log,
      h('div', { class: 'adv-quick' }, QUICK.map(([label, q]) => h('button', { class: 'chip', onclick: () => this.send(q) }, label))),
      h('div', { class: 'adv-send' }, this.input, this.btnSend),
    );
    this.say('ai', '您好！我是小柯軍師。對局中有任何疑問都可以問我，我會先請 AI 算一遍，再告訴您建議的走法和理由。');
  }

  reset() {
    this.history = [];
    this.log.innerHTML = '';
    this.say('ai', '新的一局開始了，需要建議隨時叫我！');
  }

  say(who, text) {
    const el = h('div', { class: 'adv-msg ' + who }, text);
    this.log.append(el);
    this.scroll();
    return el;
  }

  scroll() { this.log.scrollTop = this.log.scrollHeight; }

  describe(g, m) {
    const f = mvFrom(m), t = mvTo(m);
    const path = findPath(g.board, f, t) || [f, t];
    const jumps = isStep(f, t) ? 0 : path.length - 1;
    const gain = g.prog[g.turn][t] - g.prog[g.turn][f];
    const how = jumps > 1 ? `連跳 ${jumps} 次（中途落在 ${path.slice(1, -1).map(cellName).join('、')}）` : jumps ? '跳 1 次' : '走一步';
    return `把 ${cellName(f)} 的棋子移到 ${cellName(t)}，${how}，${gain > 0 ? `前進 ${gain} 行` : gain < 0 ? `後退 ${-gain} 行` : '橫移'}`;
  }

  progressLines(g, mySeat, names) {
    return g.active.map((s) => {
      const p = g.progressOf(s);
      const pieces = g.piecesOf(s);
      const minP = Math.min(...pieces.map((i) => g.prog[s][i]));
      return `${SEAT_NAMES[s]}${s === mySeat ? '（您）' : ''} ${names[s] || ''}：已進對面角 ${g.inTarget(s)}/${PIECES} 顆，前進量 ${p + 60}/120，最落後的棋子還差 ${8 - minP} 行到尖端`;
    });
  }

  async buildContext() {
    const { game: g, mySeat, names } = this.ctx();
    const mine = g.turn === mySeat && !g.result;
    const lines = g.result ? [] : await this.ctx().analyze({ board: Array.from(g.board), n: g.n, turn: g.turn, out: g.out }, 3);
    const recent = g.notes.slice(-9).map((n, i) => `${g.notes.length - Math.min(9, g.notes.length) + i + 1}. ${n}`);
    const text = [
      '【局面資訊】',
      `${g.n} 人對局。${g.active.map((s) => `${SEAT_NAMES[s]}＝${names[s] || ''}${s === mySeat ? '（您）' : ''}`).join('、')}。`,
      g.result ? `對局已結束：${SEAT_NAMES[g.result.winner]}獲勝。` : `現在輪到${SEAT_NAMES[g.turn]}${mine ? '（輪到您）' : ''}。`,
      '文字棋盤（第 1 行在最上方；您的出發角與目標角請看進度說明）：',
      boardText(g.board),
      '各方進度：',
      ...this.progressLines(g, mySeat, names),
      recent.length ? `最近的走法：\n${recent.join('\n')}` : '（還沒有任何走法）',
      lines.length ? `AI 分析（${mine ? '您的候選走法' : `${SEAT_NAMES[g.turn]}可能的走法`}，分數越高越好）：` : '',
      ...lines.map((l, i) => `${i + 1}. ${this.describe(g, l.move)}（評分 ${l.score.toFixed(1)}）`),
    ].filter(Boolean).join('\n');
    return { text, lines, mine, g, mySeat };
  }

  async send(q) {
    const question = (q || this.input.value).trim();
    if (!question || this.busy) return;
    const { game } = this.ctx();
    if (!game) return;
    this.input.value = '';
    this.say('me', question);
    const pending = this.say('ai thinking', '軍師正在計算局面…');
    let c;
    try { c = await this.buildContext(); } catch (e) { pending.textContent = '分析失敗：' + e.message; pending.classList.remove('thinking'); return; }
    if (c.mine && c.lines[0]) this.ctx().showHint(c.lines[0].move);
    if (!this.hasKey) {
      pending.classList.remove('thinking');
      pending.textContent = this.offlineAnswer(c);
      this.scroll();
      return;
    }
    pending.textContent = '';
    pending.classList.add('streaming');
    const id = uid();
    this.busy = { id, el: pending, text: '', question };
    this.btnSend.textContent = '停止';
    this.btnSend.onclick = () => xk.advisor.cancel(id);
    const userMsg = { role: 'user', content: `${c.text}\n\n【我的問題】${question}` };
    this.busy.userMsg = userMsg;
    this.busy.offline = this.offlineAnswer(c);
    xk.advisor.ask(id, { messages: [...this.history.slice(-12), userMsg] });
  }

  onDone(d) {
    const b = this.busy;
    if (!b || d.id !== b.id) return;
    this.busy = null;
    this.btnSend.textContent = '請教';
    this.btnSend.onclick = () => this.send();
    b.el.classList.remove('thinking', 'streaming');
    if (d.error) {
      if (d.error === 'cancelled') { b.el.textContent = (b.text || '') + '（已停止）'; return; }
      if (d.error === 'nokey') { this.setHasKey(false); b.el.textContent = b.offline; return; }
      b.el.textContent = `${b.offline}\n\n⚠ ${d.error}`;
      return;
    }
    const text = d.text || b.text;
    b.el.textContent = text + (d.truncated ? '…' : '');
    this.history.push(b.userMsg, { role: 'assistant', content: text });
    this.scroll();
  }

  offlineAnswer(c) {
    const g = c.g;
    if (g.result) return `這盤已經結束，${SEAT_NAMES[g.result.winner]}獲勝。可以到「棋譜庫」重播檢討喔。`;
    if (c.mySeat < 0) return c.lines[0] ? `目前輪到${SEAT_NAMES[g.turn]}，AI 預測會${this.describe(g, c.lines[0].move)}。` : '目前沒有可以分析的走法。';
    const me = c.mySeat;
    const myP = g.progressOf(me);
    const others = g.active.filter((s) => s !== me);
    const bestOther = Math.max(...others.map((s) => g.progressOf(s)));
    const judge = myP > bestOther + 6 ? '您目前領先，保持節奏、別留下落後的棋子。' : myP < bestOther - 6 ? '您目前落後，多找能連跳的走法追上去。' : '各方進度差不多，關鍵在誰能搭出連跳的橋。';
    const pieces = g.piecesOf(me);
    const lag = pieces.reduce((a, i) => (g.prog[me][i] < g.prog[me][a] ? i : a), pieces[0]);
    const lagTip = g.prog[me][lag] < -3 ? `\n提醒：${cellName(lag)} 那顆棋子落後太多，記得帶它一起走。` : '';
    if (!c.mine) {
      const pred = c.lines[0] ? `AI 預測${SEAT_NAMES[g.turn]}會${this.describe(g, c.lines[0].move)}。` : '';
      return `現在是${SEAT_NAMES[g.turn]}在走。${pred}\n${judge}${lagTip}`;
    }
    const alts = c.lines.slice(1).map((l) => `${cellName(mvFrom(l.move))}→${cellName(mvTo(l.move))}`).join('、');
    return `建議${this.describe(g, c.lines[0].move)}。\n${judge}${lagTip}${alts ? `\n其他可考慮：${alts}` : ''}\n（棋盤上綠色箭頭就是建議走法）`;
  }
}
