// 中國跳棋規則：六角星棋盤 121 孔、2～3 人、走一步或連續跳躍
//
// 座標：立方座標 (x, y, z)，x + y + z = 0。棋盤＝兩個大三角形的聯集：
//   x,y,z ≥ -4（尖端朝上）或 x,y,z ≤ 4（尖端朝下），共 121 孔。
// 六個角（每角 10 孔）依「從下方順時針」編號：
//   0 下（z>4）、1 左下（x<-4）、2 左上（y>4）、3 上（z<-4）、4 右上（x>4）、5 右下（y<-4）
// 每位玩家從自己的角出發，把 10 顆棋子全部移到正對面的角（(角+3)%6）就獲勝。

export const N_CELLS = 121;
export const PIECES = 10;
export const DIRS = [[1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1]];
const AX = { x: 0, y: 1, z: 2 };
// 角的定義：坐標軸與方向（sign*coord > 4 即在角內）
export const ZONES = [
  { axis: 'z', sign: 1 }, { axis: 'x', sign: -1 }, { axis: 'y', sign: 1 },
  { axis: 'z', sign: -1 }, { axis: 'x', sign: 1 }, { axis: 'y', sign: -1 },
];
export const opposite = (zone) => (zone + 3) % 6;

// 依人數決定各座位的出發角：2 人對角、3 人隔角（各自的目標角都是空角）
export const HOMES = { 2: [0, 3], 3: [0, 2, 4] };
export const SEAT_COLORS = ['#e53935', '#2fa84f', '#1f6fe0'];
export const SEAT_NAMES = ['紅方', '綠方', '藍方'];
export const SEAT_SHORT = ['紅', '綠', '藍'];

export const CELLS = [];          // {x,y,z,row,col,zone}
const INDEX = new Map();          // "x,z" → index
const inStar = (x, y, z) => (x >= -4 && y >= -4 && z >= -4) || (x <= 4 && y <= 4 && z <= 4);
function zoneOf(c) {
  for (let i = 0; i < 6; i++) {
    const zd = ZONES[i];
    if (zd.sign * c[AX[zd.axis]] > 4) return i;
  }
  return -1;
}
for (let z = -8; z <= 8; z++) {
  let col = 0;
  for (let x = -8; x <= 8; x++) {
    const y = -x - z;
    if (!inStar(x, y, z)) continue;
    const c = [x, y, z];
    INDEX.set(x + ',' + z, CELLS.length);
    CELLS.push({ x, y, z, row: z + 9, col: ++col, zone: zoneOf(c) });
  }
}
export const cellAt = (x, z) => { const i = INDEX.get(x + ',' + z); return i === undefined ? -1 : i; };
// NB[i*6+d]：方向 d 的鄰孔（-1 表示出界）
export const NB = new Int16Array(N_CELLS * 6).fill(-1);
for (let i = 0; i < N_CELLS; i++) {
  const c = CELLS[i];
  DIRS.forEach(([dx, , dz], d) => { NB[i * 6 + d] = cellAt(c.x + dx, c.z + dz); });
}
export const ZONE_CELLS = Array.from({ length: 6 }, (_, k) => CELLS.map((c, i) => (c.zone === k ? i : -1)).filter((i) => i >= 0));

// 孔位名稱：第幾行（由上而下 1～17）第幾孔（由左而右）
export const cellName = (i) => (i >= 0 ? `${CELLS[i].row}-${CELLS[i].col}` : '?');
export function parseCell(s) {
  const m = /^(\d+)-(\d+)$/.exec(String(s).trim());
  if (!m) return -1;
  return CELLS.findIndex((c) => c.row === Number(m[1]) && c.col === Number(m[2]));
}

// 前進量：棋子沿著「往目標角」方向的座標（-8～8，8 是目標角尖端）
export function progressTable(targetZone) {
  const { axis, sign } = ZONES[targetZone];
  return Int8Array.from(CELLS, (c) => sign * [c.x, c.y, c.z][AX[axis]]);
}
// 偏離中線：與通往目標角中心線的距離
export function lateralTable(targetZone) {
  const { axis } = ZONES[targetZone];
  const [a, b] = ['x', 'y', 'z'].filter((k) => k !== axis);
  return Int8Array.from(CELLS, (c) => Math.abs(c[a] - c[b]));
}

// 著法編碼：from * 128 + to
export const MV = (from, to) => from * 128 + to;
export const mvFrom = (m) => m >> 7;
export const mvTo = (m) => m & 127;
export const PASS = -1;

// 一顆棋子可到達的所有落點：相鄰空孔（走一步）＋連續跳躍可到的空孔
// 跳躍：沿直線方向，緊鄰的那一孔有棋子、再過去一孔是空的，就能跳過去（只能跳過一顆，不能轉彎）
// 回傳 { dests: Set(落點), jp: Map(跳躍落點 → 前一個孔) }
export function reachable(board, from) {
  const dests = new Set();
  const jp = new Map();
  const saved = board[from];
  board[from] = -1; // 起點視為空的
  const queue = [from];
  while (queue.length) {
    const c = queue.shift();
    for (let d = 0; d < 6; d++) {
      const over = NB[c * 6 + d];
      if (over < 0 || board[over] < 0) continue;
      const land = NB[over * 6 + d];
      if (land < 0 || board[land] >= 0 || land === from || jp.has(land)) continue;
      jp.set(land, c);
      dests.add(land);
      queue.push(land);
    }
  }
  board[from] = saved;
  for (let d = 0; d < 6; d++) {
    const n = NB[from * 6 + d];
    if (n >= 0 && board[n] < 0) dests.add(n);
  }
  return { dests, jp };
}

// 是否為「走一步」（相鄰）
export function isStep(from, to) {
  for (let d = 0; d < 6; d++) if (NB[from * 6 + d] === to) return true;
  return false;
}

// 還原路徑（起點→…→終點）；相鄰空孔一律當作走一步
export function findPath(board, from, to) {
  if (isStep(from, to)) return board[to] < 0 ? [from, to] : null;
  const { jp } = reachable(board, from);
  if (!jp.has(to)) return null;
  const path = [to];
  let c = to;
  for (let guard = 0; c !== from && guard < 130; guard++) { c = jp.get(c); path.push(c); }
  return path.reverse();
}

// 快速產生著法（AI 用，不配置記憶體）：把著法寫進 out，回傳數量
const STAMP = new Int32Array(N_CELLS);
const QUEUE = new Int16Array(N_CELLS);
let stampNo = 1;
export function genMoves(board, seat, out) {
  let k = 0;
  for (let from = 0; from < N_CELLS; from++) {
    if (board[from] !== seat) continue;
    const st = ++stampNo;
    STAMP[from] = st;
    board[from] = -1;
    for (let d = 0; d < 6; d++) {
      const n = NB[from * 6 + d];
      if (n >= 0 && board[n] < 0) { STAMP[n] = st; out[k++] = from * 128 + n; }
    }
    let qh = 0, qt = 0;
    QUEUE[qt++] = from;
    while (qh < qt) {
      const c = QUEUE[qh++];
      const base = c * 6;
      for (let d = 0; d < 6; d++) {
        const over = NB[base + d];
        if (over < 0 || board[over] < 0) continue;
        const land = NB[over * 6 + d];
        if (land < 0 || board[land] >= 0) continue;
        if (STAMP[land] === st) {
          // 已經是走一步可到的孔仍可當作跳躍中繼點
          if (land !== from && QUEUE.subarray(0, qt).indexOf(land) < 0) QUEUE[qt++] = land;
          continue;
        }
        STAMP[land] = st;
        out[k++] = from * 128 + land;
        QUEUE[qt++] = land;
      }
    }
    board[from] = seat;
  }
  return k;
}

export function legalMovesFor(board, seat) {
  const buf = new Int32Array(1024);
  return Array.from(buf.subarray(0, genMoves(board, seat, buf)));
}

export class Game {
  // n：人數（2 或 3）
  constructor(n = 2) {
    this.n = n === 3 ? 3 : 2;
    this.homes = HOMES[this.n];
    this.targets = this.homes.map(opposite);
    this.board = new Int8Array(N_CELLS).fill(-1);
    this.homes.forEach((z, seat) => { for (const c of ZONE_CELLS[z]) this.board[c] = seat; });
    this.turn = 0;
    this.moves = [];     // 著法（PASS 表示無子可動）
    this.paths = [];     // 每步路徑
    this.movers = [];    // 每步是誰走的
    this.out = new Array(this.n).fill(false); // 認輸、退出
    this.result = null;  // { winner, reason, ranking }
    this.prog = this.targets.map(progressTable);
    this.maxPlies = this.n * 240;
  }

  get active() { return this.out.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0); }

  piecesOf(seat) {
    const out = [];
    for (let i = 0; i < N_CELLS; i++) if (this.board[i] === seat) out.push(i);
    return out;
  }

  inTarget(seat) {
    const t = this.targets[seat];
    let k = 0;
    for (const c of ZONE_CELLS[t]) if (this.board[c] === seat) k++;
    return k;
  }

  // 前進總量（10 顆都在目標角時為 60）
  progressOf(seat) {
    let s = 0;
    const p = this.prog[seat];
    for (let i = 0; i < N_CELLS; i++) if (this.board[i] === seat) s += p[i];
    return s;
  }

  // 勝利：10 顆都進目標角；或目標角已被填滿且至少有一顆是自己的（避免對手故意佔角不走）
  isWin(seat) {
    if (this.out[seat]) return false;
    const t = ZONE_CELLS[this.targets[seat]];
    let mine = 0, full = true;
    for (const c of t) { if (this.board[c] === seat) mine++; else if (this.board[c] < 0) full = false; }
    return mine === PIECES || (full && mine > 0);
  }

  legalMoves(seat = this.turn) {
    if (this.result || this.out[seat]) return [];
    return legalMovesFor(this.board, seat);
  }

  nextSeat(seat) {
    for (let k = 1; k <= this.n; k++) {
      const s = (seat + k) % this.n;
      if (!this.out[s]) return s;
    }
    return seat;
  }

  // 走一步；回傳 { path, jumps, note }
  play(m) {
    if (this.result) throw new Error('對局已結束');
    const seat = this.turn;
    let path = null;
    if (m !== PASS) {
      const from = mvFrom(m), to = mvTo(m);
      if (this.board[from] !== seat) throw new Error('不是自己的棋子');
      path = findPath(this.board, from, to);
      if (!path) throw new Error('不合規則的著法');
      this.board[from] = -1;
      this.board[to] = seat;
    }
    this.moves.push(m);
    this.paths.push(path);
    this.movers.push(seat);
    if (this.isWin(seat)) this.finish(seat, '全部到達對面角');
    else this.advance();
    return { path, jumps: path && !isStep(path[0], path[1]) ? path.length - 1 : 0, note: this.noteOf(this.moves.length - 1) };
  }

  advance() {
    this.turn = this.nextSeat(this.turn);
    if (this.moves.length >= this.maxPlies) { this.finishByProgress('步數上限'); return; }
    // 輪到的人無子可動：自動跳過（全部都不能動就以前進量判定）
    let guard = 0;
    while (!this.result && legalMovesFor(this.board, this.turn).length === 0 && guard++ < this.n) {
      this.moves.push(PASS); this.paths.push(null); this.movers.push(this.turn);
      this.turn = this.nextSeat(this.turn);
    }
    if (guard >= this.n && !this.result) this.finishByProgress('無子可動');
  }

  finish(winner, reason) {
    const ranking = this.active.slice().sort((a, b) => (b === winner) - (a === winner) || this.progressOf(b) - this.progressOf(a));
    this.result = { winner, reason, ranking };
  }

  finishByProgress(reason) {
    const act = this.active;
    act.sort((a, b) => this.progressOf(b) - this.progressOf(a));
    this.finish(act[0], reason + '，以前進最多者勝');
  }

  // 認輸／退出：棋子從棋盤拿走；只剩一人時那人獲勝
  resign(seat, reason = '認輸') {
    if (this.result || this.out[seat]) return [];
    this.out[seat] = true;
    const removed = [];
    for (let i = 0; i < N_CELLS; i++) if (this.board[i] === seat) { this.board[i] = -1; removed.push(i); }
    this.moves.push(-2 - seat); this.paths.push(null); this.movers.push(seat);
    const act = this.active;
    if (act.length === 1) this.finish(act[0], `${SEAT_NAMES[seat]}${reason}`);
    else if (this.turn === seat) this.advance();
    return removed;
  }

  // 悔一步（不支援悔掉認輸）
  undo() {
    if (!this.moves.length) return false;
    const m = this.moves[this.moves.length - 1];
    if (m <= -2) return false;
    this.moves.pop(); this.paths.pop();
    const seat = this.movers.pop();
    if (m !== PASS) { this.board[mvTo(m)] = -1; this.board[mvFrom(m)] = seat; }
    this.turn = seat;
    this.result = null;
    return true;
  }

  noteOf(k) {
    const m = this.moves[k], seat = this.movers[k];
    const who = SEAT_SHORT[seat];
    if (m === PASS) return `${who}：無子可動，跳過`;
    if (m <= -2) return `${who}：認輸`;
    const p = this.paths[k];
    const jumps = p && !isStep(p[0], p[1]) ? p.length - 1 : 0;
    return `${who}：${cellName(mvFrom(m))}→${cellName(mvTo(m))}${jumps ? `（跳 ${jumps} 次）` : ''}`;
  }
  get notes() { return this.moves.map((_, k) => this.noteOf(k)); }

  toRecord(meta = {}) {
    return {
      ...meta,
      kind: 'checkers',
      n: this.n,
      date: meta.date || new Date().toISOString(),
      moves: this.moves.slice(),
      result: this.result ? { winner: this.result.winner, reason: this.result.reason } : null,
    };
  }
}

// 依棋譜重建（前 upto 步）
export function replayRecord(rec, upto = Infinity) {
  const g = new Game(rec.n);
  const ms = rec.moves || [];
  for (let k = 0; k < ms.length && k < upto; k++) {
    const m = ms[k];
    if (g.result) break;
    if (m <= -2) { g.resign(-2 - m); continue; }
    if (m === PASS) continue; // 跳過會自動產生
    if (!g.legalMoves().includes(m)) break;
    g.play(m);
  }
  return g;
}

// 給軍師看的文字棋盤：紅綠藍＝棋子，・＝空孔
export function boardText(board, cells = CELLS) {
  const rows = [];
  for (let r = 1; r <= 17; r++) {
    const row = cells.map((c, i) => (c.row === r ? i : -1)).filter((i) => i >= 0);
    const minPx = Math.min(...row.map((i) => cells[i].x + cells[i].z / 2));
    const pad = ' '.repeat(Math.round((minPx + 8) * 2));
    rows.push(`${String(r).padStart(2)} ${pad}${row.map((i) => (board[i] < 0 ? '・' : SEAT_SHORT[board[i]])).join('')}`);
  }
  return rows.join('\n');
}
