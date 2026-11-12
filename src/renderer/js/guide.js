// 遊戲說明：SVG 動畫小棋盤＋語音解說＋練習題（電腦、iPad、手機共用）
import { $$, h, sleep } from './util.js';
import { CELLS, N_CELLS, NB, DIRS, ZONE_CELLS, HOMES, SEAT_COLORS, opposite, cellAt, reachable, findPath, isStep } from './rules.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
};
const U = 36;                 // 孔距
const SQ3 = Math.sqrt(3) / 2;
const SEAT_OF = { r: 0, g: 1, b: 2 };
// 六個角的尖端：下（紅的家）、左下、左上（三人時綠的家）、上、右上（三人時藍的家）、右下
const TIP = [[-4, 8], [-8, 4], [-4, -4], [4, -8], [8, -4], [4, 4]];

// ---------------- 擺子 ----------------
// 'r:0,2 g:1,1' → 紅子在 (x=0,z=2)、綠子在 (1,1)；'start2'／'start3' 開局；也可以是函式（自己擺）
export const at = (x, z) => cellAt(x, z);
export function parsePieces(spec) {
  const b = new Int8Array(N_CELLS).fill(-1);
  if (typeof spec === 'function') { spec(b); return b; }
  if (spec === 'start2' || spec === 'start3') {
    HOMES[spec === 'start3' ? 3 : 2].forEach((z, s) => { for (const c of ZONE_CELLS[z]) b[c] = s; });
    return b;
  }
  for (const tok of String(spec).trim().split(/\s+/).filter(Boolean)) {
    const m = /^([rgb]):(-?\d+),(-?\d+)$/.exec(tok);
    if (!m) throw new Error('擺子格式錯誤：' + tok);
    const c = at(Number(m[2]), Number(m[3]));
    if (c < 0) throw new Error('沒有這個孔：' + tok);
    b[c] = SEAT_OF[m[1]];
  }
  return b;
}
export const cellOf = (p) => (Array.isArray(p) ? at(p[0], p[1]) : p);

// 為什麼不能走到這裡（只對走不到的孔說明）
export function whyNot(board, from, to) {
  if (board[to] >= 0) return '這個孔已經有棋子了。';
  const a = CELLS[from], b = CELLS[to];
  const dx = b.x - a.x, dz = b.z - a.z;
  for (let d = 0; d < 6; d++) {
    const [ux, , uz] = DIRS[d];
    const k = ux ? dx / ux : uz ? dz / uz : 0;
    if (!(k > 1 && Number.isInteger(k) && ux * k === dx && uz * k === dz)) continue;
    const c1 = NB[from * 6 + d], c2 = c1 >= 0 ? NB[c1 * 6 + d] : -1;
    if (c1 >= 0 && board[c1] < 0) return '中間是空孔：跳躍只能跳過「緊鄰」的一顆棋子。';
    if (k >= 3 && c2 >= 0 && board[c2] >= 0) return '前面連著兩顆棋子，擋住了：一次只能跳過一顆。';
    return '一次只能跳過一顆棋子，落在它正後方的空孔，距離太遠了。';
  }
  return '不在同一條直線上：跳躍一定走直線、不能轉彎，也沒有連跳可以到這裡。';
}

// ---------------- 動畫小棋盤 ----------------
class StarBoard {
  constructor(host, onClick) {
    this.host = host;
    this.onClick = onClick;
    this.pieces = new Map(); // 孔 → { g, seat }
    this.build();
  }

  xy(c) { const p = CELLS[c]; return [this.cx + (p.x + p.z / 2) * U, this.cy + p.z * SQ3 * U]; }

  build() {
    const W = 12 * U + 96, H = Math.ceil(16 * SQ3 * U) + 96;
    this.cx = W / 2; this.cy = H / 2;
    this.svg = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gb-svg', id: 'gdSvg' });
    const defs = svg('defs');
    SEAT_COLORS.forEach((col, s) => {
      const g = svg('radialGradient', { id: 'gbm' + s, cx: '35%', cy: '30%', r: '70%' });
      g.append(svg('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '.95' }), svg('stop', { offset: '30%', 'stop-color': col }), svg('stop', { offset: '100%', 'stop-color': col, 'stop-opacity': '1' }));
      defs.append(g);
    });
    this.svg.append(defs, svg('rect', { x: 2, y: 2, width: W - 4, height: H - 4, rx: 22, class: 'gb-bg' }));
    // 星形
    const tip = (x, z, k = 1) => [this.cx + (x + z / 2) * U * k, this.cy + z * SQ3 * U * k];
    const corners = [[-4, 8], [-4, 4], [-8, 4], [-4, 0], [-4, -4], [0, -4], [4, -8], [4, -4], [8, -4], [4, 0], [4, 4], [0, 4]];
    this.svg.append(svg('polygon', { points: corners.map(([x, z]) => tip(x, z, 1.13).join(',')).join(' '), class: 'gb-star' }));
    this.zoneLayer = svg('g');
    this.svg.append(this.zoneLayer);
    const grid = svg('g', { class: 'gb-lines' });
    for (let i = 0; i < N_CELLS; i++) for (const d of [0, 1, 5]) {
      const j = NB[i * 6 + d];
      if (j < 0) continue;
      const [x1, y1] = this.xy(i), [x2, y2] = this.xy(j);
      grid.append(svg('line', { x1, y1, x2, y2 }));
    }
    this.svg.append(grid);
    const holes = svg('g', { class: 'gb-holes' });
    for (let i = 0; i < N_CELLS; i++) { const [x, y] = this.xy(i); holes.append(svg('circle', { cx: x, cy: y, r: 7 })); }
    this.svg.append(holes);
    this.hl = svg('g'); this.marks = svg('g'); this.layer = svg('g'); this.top = svg('g');
    this.svg.append(this.hl, this.marks, this.layer, this.top);
    this.svg.addEventListener('click', (e) => {
      const pt = this.svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(this.svg.getScreenCTM().inverse());
      let best = -1, bd = U * 0.5;
      for (let i = 0; i < N_CELLS; i++) { const [x, y] = this.xy(i); const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = i; } }
      if (best >= 0 && this.onClick) this.onClick(best);
    });
    this.host.append(this.svg);
  }

  // 角落的三角形
  zonePoly(z, grow = 1.42) {
    const pts = ZONE_CELLS[z].map((c) => this.xy(c));
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const apex = pts.reduce((m, p) => (dist(p, [this.cx, this.cy]) > dist(m, [this.cx, this.cy]) ? p : m));
    const far = pts.slice().sort((p, q) => dist(q, apex) - dist(p, apex));
    return [apex, far[0], far[1]].map(([x, y]) => [cx + (x - cx) * grow, cy + (y - cy) * grow].join(',')).join(' ');
  }

  // homes：2 或 3 人的出發角上色；其他角淡淡的
  setZones(n) {
    this.zoneLayer.innerHTML = '';
    const fill = new Array(6).fill(null);
    if (n) HOMES[n].forEach((home, s) => { fill[home] = [SEAT_COLORS[s], 0.85]; if (!fill[opposite(home)]) fill[opposite(home)] = [SEAT_COLORS[s], 0.25]; });
    for (let z = 0; z < 6; z++) {
      const [col, op] = fill[z] || ['#b8a58a', 0.18];
      this.zoneLayer.append(svg('polygon', { points: this.zonePoly(z), fill: col, 'fill-opacity': op }));
    }
  }

  marble(seat) {
    const g = svg('g', { class: 'gm' });
    g.append(svg('circle', { r: 15, cy: 2.5, class: 'gm-shadow' }), svg('circle', { r: 14, fill: `url(#gbm${seat})`, class: 'gm-ball' }));
    return g;
  }

  setPieces(board) {
    this.layer.innerHTML = '';
    this.pieces.clear();
    for (let c = 0; c < N_CELLS; c++) {
      if (board[c] < 0) continue;
      const g = this.marble(board[c]);
      const [x, y] = this.xy(c);
      g.style.transform = `translate(${x}px, ${y}px)`;
      this.layer.append(g);
      this.pieces.set(c, { g, seat: board[c] });
    }
  }

  clearMarks() { this.hl.innerHTML = ''; this.marks.innerHTML = ''; this.top.innerHTML = ''; }

  highlight(zones) { for (const z of zones) this.hl.append(svg('polygon', { points: this.zonePoly(z, 1.5), class: 'gz' })); }

  ring(c, cls = 'gk-sel', r = 20) { const [x, y] = this.xy(c); this.marks.append(svg('circle', { cx: x, cy: y, r, class: cls })); }

  // 可走的位置：綠點＝走一步、黃圈＝跳過去
  legal(from, list) {
    for (const c of list) {
      const [x, y] = this.xy(c);
      this.marks.append(isStep(from, c) ? svg('circle', { cx: x, cy: y, r: 7, class: 'gk-ok' }) : svg('circle', { cx: x, cy: y, r: 13, class: 'gk-jump' }));
    }
  }

  bad(list) {
    for (const [c, why] of list) {
      const [x, y] = this.xy(c);
      const s = 9;
      const g = svg('g', { class: 'gk-bad' });
      g.append(svg('circle', { cx: x, cy: y, r: s + 7 }), svg('path', { d: `M${x - s} ${y - s} L${x + s} ${y + s} M${x + s} ${y - s} L${x - s} ${y + s}` }));
      if (why) g.append(svg('title', {}, why));
      this.top.append(g);
    }
  }

  // 箭頭（可經過多個點）
  arrow(cells, cls = 'gk-arrow') {
    const pts = cells.map((c) => this.xy(c));
    const n = pts.length;
    const [x1, y1] = pts[n - 2], [x2, y2] = pts[n - 1];
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const end = [x2 - Math.cos(ang) * 17, y2 - Math.sin(ang) * 17];
    const d = 'M' + pts.slice(0, -1).map((p) => p.join(' ')).join(' L') + ` L${end.join(' ')}`;
    this.top.append(svg('path', { d, class: cls }),
      svg('path', { d: `M${end[0]} ${end[1]} l${-13 * Math.cos(ang - 0.5)} ${-13 * Math.sin(ang - 0.5)} M${end[0]} ${end[1]} l${-13 * Math.cos(ang + 0.5)} ${-13 * Math.sin(ang + 0.5)}`, class: cls }));
  }

  // 沿路徑移動（每一跳都抬起來）
  async move(path) {
    const p = this.pieces.get(path[0]);
    if (!p) return;
    this.pieces.delete(path[0]);
    this.pieces.set(path[path.length - 1], p);
    p.g.classList.add('lift');
    for (let k = 1; k < path.length; k++) {
      const [x, y] = this.xy(path[k]);
      p.g.style.transform = `translate(${x}px, ${y}px)`;
      if (this.onHop) this.onHop(k);
      await sleep(isStep(path[k - 1], path[k]) ? 420 : 520);
    }
    p.g.classList.remove('lift');
  }

  flash(c, cls) {
    const [x, y] = this.xy(c);
    const el = svg('circle', { cx: x, cy: y, r: 22, class: cls });
    this.top.append(el);
    setTimeout(() => el.remove(), 900);
  }
}

// ---------------- 語音 ----------------
class Narrator {
  constructor() {
    this.on = true;
    this.rate = 1;
    this.voice = null;
    this.onReady = null;
    this.pick();
    // 語音清單是非同步載入的，載入後再挑一次並通知畫面
    if ('speechSynthesis' in window) {
      speechSynthesis.addEventListener('voiceschanged', () => { this.pick(); if (this.onReady) this.onReady(); });
      let n = 0;
      const poll = () => { if (this.voice || ++n > 30) { if (this.onReady) this.onReady(); return; } this.pick(); setTimeout(poll, 200); };
      poll();
    }
  }
  pick() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    // 台灣中文優先：Windows（Yating、Hanhan、Zhiwei）、Mac／iPhone／iPad（Mei-Jia）
    const pref = [/Yating/i, /Hanhan/i, /Mei-?Jia/i, /Zhiwei/i];
    this.voice = pref.map((re) => vs.find((v) => re.test(v.name))).find(Boolean)
      || vs.find((v) => /zh[-_]TW/i.test(v.lang)) || vs.find((v) => /zh[-_]HK/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
  }
  get native() { return window.xk && window.xk.tts && window.xk.tts.available() ? window.xk.tts : null; }
  get available() { if (this.native) return true; if (!this.voice) this.pick(); return 'speechSynthesis' in window && !!this.voice; }
  get voiceName() { return this.native ? this.native.voiceName() : this.voice ? this.voice.name : ''; }
  stop() { if (this.native) this.native.stop(); else if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  pause() { if (this.native) this.native.stop(); else if ('speechSynthesis' in window) speechSynthesis.pause(); }
  resume() { if (!this.native && 'speechSynthesis' in window) speechSynthesis.resume(); }
  // 說完才 resolve；沒有語音時依字數等待
  speak(text) {
    const plain = String(text).replace(/[「」（）()]/g, ' ');
    const est = 700 + plain.length * 210 / this.rate;
    if (!this.on || !this.available) return sleep(Math.min(9000, 900 + plain.length * 95));
    if (this.native) { this.native.stop(); return this.native.speak(plain, this.rate); }
    return new Promise((resolve) => {
      this.stop();
      const u = new SpeechSynthesisUtterance(plain);
      u.voice = this.voice; u.lang = this.voice.lang; u.rate = this.rate; u.pitch = 1;
      let done = false;
      const fin = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
      const t = setTimeout(fin, est * 2 + 4000);
      u.onend = fin; u.onerror = fin;
      speechSynthesis.speak(u);
    });
  }
}

// ---------------- 課程 ----------------
// 步驟欄位：say 解說（字串或 (env) => 字串）、pieces 擺子、homes 出發角上色（2／3 人）、hl 標示角落、
// sel 選子、legal 顯示可走位置、bad 走不到的位置（自動說明原因）、move 移動動畫（[起點, 終點]，路徑自動算）、
// arrows 箭頭、ring 圈起來、practice 練習（piece 要移動的棋子；goal 正確落點，可省略＝任一合法位置）、win 勝利特效
const winSetup = (fill) => (b) => {
  const t = ZONE_CELLS[3];
  const hole = t[t.length - 1];
  t.forEach((c) => { if (c !== hole) b[c] = 0; });
  if (fill) b[hole] = 1;
  else b[at(4, -4)] = 0;
  for (const c of ZONE_CELLS[0]) b[c] = 1;
};
export const WIN_HOLE = () => ZONE_CELLS[3][ZONE_CELLS[3].length - 1];

export const LESSONS = [
  { title: '棋盤與目標', steps: [
    { pieces: '', say: '歡迎來到中國跳棋！棋盤是一顆六角星，總共有一百二十一個孔，棋子就放在孔上。' },
    { hl: [0, 1, 2, 3, 4, 5], say: '星星有六個角，每個角有十個孔。每位玩家用一種顏色的十顆彈珠，從自己的角出發。' },
    { pieces: 'start2', homes: 2, hl: [3], arrows: [[TIP[0], TIP[3]]], say: '目標很簡單：把自己的十顆棋子，全部移到正對面的角。誰先全部到達，誰就贏了。' },
    { say: '大家輪流下，每回合只能移動一顆棋子。棋子不會被吃掉，所以這是一場比誰走得快的競賽。' },
  ] },
  { title: '走一步', steps: [
    { pieces: 'r:0,2', sel: [0, 2], legal: true, say: '最簡單的走法，是走到旁邊相鄰的空孔。每個孔旁邊有六個方向，綠色小點就是可以走的位置。' },
    { move: [[0, 2], [1, 1]], say: '往前、往旁邊，甚至往後退都可以，每次走一格。' },
    { pieces: 'r:0,3', practice: { piece: [0, 3] }, say: '換您試試：點紅色棋子旁邊的任何一個空孔，走一步。' },
  ] },
  { title: '跳一顆', steps: [
    { pieces: 'r:0,2 g:1,1', sel: [0, 2], legal: true, say: '跳棋最重要的走法是「跳」。如果旁邊緊鄰著一顆棋子，而且它正後方是空孔，就可以跳過去。黃色圓圈就是可以跳到的位置。' },
    { move: [[0, 2], [2, 0]], say: '跳的時候要沿著直線，從棋子的正上方跳過去，落在正後方的空孔。' },
    { say: '自己的棋子和對手的棋子都可以跳，被跳過的棋子不會被吃掉，還會留在原地。' },
    { pieces: 'r:0,2 b:-1,2 g:0,1', practice: { piece: [0, 2], goal: [0, 0] }, say: '換您試試：讓紅色棋子跳過綠色棋子。' },
  ] },
  { title: '擋住了不能跳', steps: [
    { pieces: 'r:0,2 g:1,1 g:2,0', sel: [0, 2], bad: [[3, -1]], arrows: [[[0, 2], [3, -1]]], say: '如果前面連著兩顆棋子，就擋住了。一次只能跳過一顆，不能一口氣跳過兩顆。' },
    { pieces: 'r:0,2 g:2,0', sel: [0, 2], bad: [[4, -2]], say: '如果棋子和您中間隔了一個空孔，也不能跳。只能跳過緊鄰的那一顆。' },
    { pieces: 'r:0,2 g:1,1', sel: [0, 2], bad: [[1, 0], [3, 0]], say: '跳躍一定是直線，不能在半空中轉彎。落點一定在被跳過那顆棋子的正後方。' },
  ] },
  { title: '連續跳', steps: [
    { pieces: 'r:0,3 r:1,2 g:2,0 b:3,-2', sel: [0, 3], legal: true, say: '跳過去之後，如果落點旁邊又有可以跳的棋子，就可以接著再跳，這叫做連跳。' },
    { move: [[0, 3], [4, -3]], say: '每一跳都要走直線，但是跳完一次可以換方向。看，這顆棋子一口氣連跳了三次！' },
    { say: '連跳到哪裡停下由您決定，不一定要跳完。在遊戲裡，點棋子後，所有能跳到的位置都會用黃色圓圈標出來，點您想停的那一個就好。' },
    { pieces: 'r:0,4 r:0,3 g:0,1 r:0,-1 g:1,3', practice: { piece: [0, 4], goal: [0, -2] }, say: '換您試試：找出這顆紅色棋子能連跳得最遠的位置。' },
  ] },
  { title: '兩人與三人', steps: [
    { pieces: 'start2', homes: 2, arrows: [[TIP[0], TIP[3]], [TIP[3], TIP[0]]], say: '兩個人下的時候，雙方面對面坐在對角。紅方往上走，綠方往下走，兩邊的棋子會在中間交會。' },
    { pieces: 'start3', homes: 3, say: '三個人下的時候，三個人隔一個角坐，各自的目標角都是空的角。' },
    { arrows: [[TIP[0], TIP[3]], [TIP[2], TIP[5]], [TIP[4], TIP[1]]], say: '紅方先走，接著綠方、藍方，照順時針方向輪流。在遊戲畫面裡，自己的角永遠在畫面下方。' },
  ] },
  { title: '怎樣算贏', steps: [
    { pieces: winSetup(false), homes: 2, hl: [3], sel: [4, -4], say: '把十顆棋子全部移進對面的角就獲勝了。現在紅方只差最後一顆。' },
    { move: [[4, -4], 'hole'], win: true, say: '最後一顆走進去，十顆全部到達，紅方獲勝！' },
    { pieces: winSetup(true), homes: 2, hl: [3], ring: 'hole', say: '還有一條規則：如果對面的角已經被填滿，而且裡面有您的棋子，也算您贏。這是為了防止對手故意佔著您的目標角不走。' },
    { say: '如果走了很多步都還沒分出勝負，就由前進得最多的人獲勝。中途也可以按「認輸」結束這一局。' },
  ] },
  { title: '致勝技巧', steps: [
    { pieces: 'r:0,4 r:0,3 r:0,1 r:0,-1', sel: [0, 4], legal: true, say: '技巧一：搭梯子。把棋子隔一個孔排成一直線，後面的棋子就能一路連跳到最前面，一次前進很多格。' },
    { move: [[0, 4], [0, -2]], say: '看，一口氣從最後面跳到最前面！' },
    { pieces: 'r:0,-2 r:1,-2 r:-1,-1 r:0,-1 r:1,-3 r:2,-3 r:0,0 r:-1,0 r:1,-1 r:-4,8', ring: [-4, 8], say: '技巧二：不要留下落後的棋子。最後一顆棋子沒有人可以讓它跳，只能一格一格慢慢走，常常害整盤輸掉。' },
    { pieces: 'r:0,3 g:1,2 b:2,0 g:3,-2', sel: [0, 3], legal: true, say: '技巧三：多利用對手的棋子當跳板，對手的棋子也能幫您連跳，而且不會被吃掉。' },
  ] },
  { title: '操作方式', steps: [
    { pieces: 'r:0,2 g:1,1 r:-1,2', sel: [0, 2], legal: true, say: (env) => `${env.touch ? '用手指點一下' : '用滑鼠點一下'}自己的棋子，它會被選起來。綠色小點是走一步能到的孔，黃色圓圈是跳過去能到的孔。再點一下落點，棋子就會移過去。` },
    { move: [[0, 2], [2, 0]], say: '換別顆棋子，直接點另一顆自己的棋子就可以。' },
    { say: (env) => `畫面上方可以切換斜視、俯視、立體三種視角，旋轉箭頭可以把棋盤轉到下一個角。${env.touch ? '用兩根手指拖曳可以旋轉棋盤，兩指捏合可以縮放。' : '按住滑鼠右鍵拖曳可以旋轉棋盤，滾輪可以縮放。'}` },
    { pieces: 'r:0,3 r:1,2 g:2,0 b:3,-2', arrows: [[[0, 3], [2, 1], [2, -1], [4, -3]]], say: '下方的「提示」按鈕會在棋盤上用綠色箭頭標出建議的走法；與 AI 對賽時可以按「悔棋」退回自己的上一步。右邊的軍師也可以問，例如：現在該怎麼走？' },
  ] },
  { title: '三種遊戲模式', steps: [
    { pieces: 'start3', homes: 3, say: '首頁有三種模式。第一種是「與 AI 對賽」，不需要網路，可以選兩人或三人，AI 有入門、初級、中級、高級、大師五種難度。' },
    { move: [[-1, 5], [0, 4]], say: '第二種是「遠端對賽」。按「建立房間」會得到六位數的房號，告訴朋友，朋友在「加入房間」輸入房號就能一起下。' },
    { move: [[-2, -3], [-2, -2]], say: '可以邀請一位或兩位朋友，空著的座位在開始時由 AI 代下。比賽開始後才加入的人會變成觀棋者。' },
    { move: [[5, -2], [4, -1]], say: '比賽中，只有輪到的人可以下棋，其他人都在觀棋。大家可以加入語音通話，或用文字聊天。電腦、手機、平板都能一起連線。' },
    { say: '第三種是「AI 與 AI 對賽」，坐下來看 AI 彼此比賽，可以調整速度、隨時暫停。每一局下完都會自動存進棋譜庫，可以重播、匯出。祝您玩得開心！' },
  ] },
];

// 把步驟裡的位置換成孔號（'hole'＝勝利示範的最後一孔）
export const pos = (p) => (p === 'hole' ? WIN_HOLE() : cellOf(p));

export class Guide {
  constructor(root, { onBack, settings, save }) {
    this.root = root;
    this.onBack = onBack;
    this.save = save;
    this.narr = new Narrator();
    this.narr.on = settings.guideVoice !== false;
    this.narr.rate = settings.guideRate || 1;
    this.narr.onReady = () => this.renderVoice();
    this.lesson = 0;
    this.token = 0;
    this.paused = false;
    this.practice = null;
    this.env = { touch: document.documentElement.classList.contains('touch') || document.documentElement.classList.contains('mobile') };
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    this.list = h('div', { class: 'gd-list' });
    this.caption = h('div', { class: 'gd-caption', id: 'gdCaption' }, '');
    this.boardHost = h('div', { class: 'gd-board' });
    this.board = new StarBoard(this.boardHost, (c) => this.onBoardClick(c));
    this.board.onHop = (k) => { if (this.onHop) this.onHop(k); };
    this.btnPlay = h('button', { class: 'primary', id: 'gdPlay', onclick: () => this.togglePlay() }, '⏸ 暫停');
    this.btnVoice = h('button', { id: 'gdVoice', onclick: () => this.toggleVoice() });
    this.rateSel = h('select', { id: 'gdRate', onchange: () => { this.narr.rate = Number(this.rateSel.value); this.save({ guideRate: this.narr.rate }); } },
      [[0.8, '慢'], [1, '一般'], [1.2, '快']].map(([v, l]) => h('option', { value: v, selected: v === this.narr.rate }, `語速：${l}`)));
    this.status = h('div', { class: 'gd-status muted small' });
    r.append(
      h('div', { class: 'gd-head' }, h('button', { class: 'ghost', id: 'gdBack', onclick: () => this.close() }, '⟵ 首頁'), h('h2', {}, '📖 遊戲說明'),
        h('span', { class: 'muted small gd-sub' }, '語音＋動畫，看完就會玩；也可以點左邊的課程直接跳過去')),
      h('div', { class: 'gd-body' },
        this.list,
        h('div', { class: 'gd-main' },
          this.caption,
          this.boardHost,
          h('div', { class: 'gd-ctrl' },
            h('button', { onclick: () => this.go(this.lesson - 1) }, '⏮ 上一課'),
            h('button', { onclick: () => this.go(this.lesson) }, '↺ 重播'),
            this.btnPlay,
            h('button', { onclick: () => this.go(this.lesson + 1) }, '下一課 ⏭'),
            this.btnVoice, this.rateSel),
          this.status)));
    this.renderVoice();
    this.renderList();
  }

  open(i = 0) { this.go(i); }

  // 停止解說與動畫（離開說明畫面時）
  stop() {
    this.token++;
    this.paused = false;
    this.practice = null;
    this.narr.stop();
  }

  close() {
    this.stop();
    this.onBack && this.onBack();
  }

  renderList() {
    this.list.innerHTML = '';
    LESSONS.forEach((l, i) => this.list.append(h('button', { class: 'gd-item' + (i === this.lesson ? ' on' : ''), onclick: () => this.go(i) }, h('span', { class: 'n' }, String(i + 1)), l.title)));
    const cur = this.list.children[this.lesson];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  renderVoice() {
    const ok = this.narr.available;
    this.btnVoice.textContent = !ok ? '🔇 無語音' : this.narr.on ? '🔊 語音：開' : '🔈 語音：關';
    this.btnVoice.disabled = !ok;
    this.btnVoice.title = ok ? `使用語音：${this.narr.voiceName}` : '這台裝置沒有中文語音，解說會以文字顯示';
  }

  toggleVoice() {
    this.narr.on = !this.narr.on;
    if (!this.narr.on) this.narr.stop();
    this.save({ guideVoice: this.narr.on });
    this.renderVoice();
  }

  togglePlay() {
    this.paused = !this.paused;
    this.btnPlay.textContent = this.paused ? '▶ 繼續' : '⏸ 暫停';
    if (this.paused) this.narr.pause(); else { this.narr.resume(); if (this.resumeGate) this.resumeGate(); }
  }

  async gate(tok) {
    while (this.paused && tok === this.token) await new Promise((r) => { this.resumeGate = r; setTimeout(r, 300); });
    return tok === this.token;
  }

  go(i) {
    if (i < 0 || i >= LESSONS.length) return;
    this.lesson = i;
    this.renderList();
    this.paused = false;
    this.btnPlay.textContent = '⏸ 暫停';
    this.run(++this.token);
  }

  sayText(st) { return typeof st.say === 'function' ? st.say(this.env) : st.say; }

  async run(tok) {
    this.narr.stop();
    this.practice = null;
    const lesson = LESSONS[this.lesson];
    this.status.textContent = `第 ${this.lesson + 1} 課：${lesson.title}（共 ${lesson.steps.length} 步）`;
    let board = new Int8Array(N_CELLS).fill(-1);
    this.board.setZones(0);
    for (let i = 0; i < lesson.steps.length; i++) {
      if (!(await this.gate(tok))) return;
      const st = lesson.steps[i];
      if (st.pieces != null) {
        board = parsePieces(st.pieces);
        this.board.setPieces(board);
        this.board.setZones(st.homes || 0);
      }
      this.board.clearMarks();
      if (st.hl) this.board.highlight(st.hl);
      const sel = st.sel ? pos(st.sel) : st.practice ? pos(st.practice.piece) : -1;
      if (sel >= 0) this.board.ring(sel);
      if (st.legal && sel >= 0) this.board.legal(sel, [...reachable(board, sel).dests]);
      let text = this.sayText(st);
      if (st.bad && sel >= 0) {
        const list = st.bad.map((p) => { const c = pos(p); return [c, whyNot(board, sel, c)]; });
        this.board.bad(list);
        const reasons = [...new Set(list.map((x) => x[1]))];
        text += '\n✕ ' + reasons.join('\n✕ ');
      }
      for (const a of st.arrows || []) this.board.arrow(a.map(pos), 'gk-arrow');
      if (st.ring) this.board.ring(pos(st.ring), 'gk-hint', 22);
      this.caption.textContent = text;
      this.caption.classList.toggle('practice', !!st.practice);
      const talk = this.narr.speak(this.sayText(st));
      if (st.move) {
        await sleep(900);
        if (tok !== this.token) return;
        const [f, t] = st.move.map(pos);
        const path = findPath(board, f, t) || [f, t];
        this.board.ring(f);
        this.board.arrow(path, 'gk-path');
        await this.board.move(path);
        board[t] = board[f]; board[f] = -1;
        if (st.win) { this.board.highlight([3]); this.board.flash(t, 'gk-good'); if (this.onWin) this.onWin(); }
      }
      if (st.practice) {
        // 練習一出現就可以作答，不必等解說講完
        const ok = await this.runPractice(tok, board, st.practice);
        if (!ok) return;
      } else {
        await talk;
        if (tok !== this.token) return;
        await sleep(st.pause || 600);
      }
    }
    if (tok !== this.token) return;
    const next = this.lesson + 1 < LESSONS.length;
    if (next) {
      // 自動接著講下一課
      this.caption.textContent = `「${lesson.title}」說明完畢，接著是「${LESSONS[this.lesson + 1].title}」。`;
      await sleep(1500);
      if (!(await this.gate(tok))) return;
      this.go(this.lesson + 1);
    } else {
      this.caption.textContent = '說明全部看完了！回首頁選一種模式開始下棋吧，祝您玩得開心！';
      this.status.textContent = '全部 ' + LESSONS.length + ' 課都看完了';
    }
  }

  // 練習：點落點，錯了說明原因
  runPractice(tok, board, pr) {
    const from = pos(pr.piece);
    const targets = [...reachable(board, from).dests];
    const goal = pr.goal ? pos(pr.goal) : null;
    this.status.textContent = '練習中：在棋盤上點選落點（點錯會告訴您原因）';
    return new Promise((resolve) => {
      this.practice = {
        tok,
        click: async (c) => {
          if (tok !== this.token || c === from) return;
          const good = targets.includes(c) && (goal == null || c === goal);
          if (good) {
            this.practice = null;
            this.board.clearMarks();
            this.board.flash(c, 'gk-good');
            await this.board.move(findPath(board, from, c) || [from, c]);
            board[c] = board[from]; board[from] = -1;
            this.caption.textContent = '答對了！做得好。';
            await this.narr.speak('答對了！做得好。');
            this.status.textContent = '';
            resolve(tok === this.token);
            return;
          }
          this.board.flash(c, 'gk-wrong');
          const why = targets.includes(c) ? '這一步可以走，但這題要找另一個位置喔。' : whyNot(board, from, c);
          this.caption.textContent = `✕ ${why}\n再試一次，或按「看答案」。`;
          this.narr.speak(why);
        },
      };
      const show = h('button', { class: 'gd-answer', id: 'gdAnswer', onclick: () => {
        if (!this.practice) return;
        this.board.legal(from, goal != null ? [goal] : targets);
        this.caption.textContent = '標出來的位置就是答案，點它試試看。';
        show.remove();
      } }, '看答案');
      this.status.append(' ', show);
    });
  }

  onBoardClick(c) { if (this.practice) this.practice.click(c); }
}
