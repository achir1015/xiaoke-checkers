// 跳棋 AI（參考 Crazylitm/jumpchess 文件的做法）
// - 跳棋比較像「競速」：估值函數各玩家獨立，只看自己的棋子
//   估值＝前進得分（往目標角的距離）－偏離中線扣分－最後一顆棋子（落後者）扣分
// - 搜尋：每位玩家都選對自己最有利的分支（max-n），深度＝人數＋等級加深
// - 最後一層只取每位玩家「下一步的最大收益」（彼此不太影響，不必展開）
// - 搜尋中提早完成的分支有獎勵分數，鼓勵最早完成；分數相同時隨機
import { N_CELLS, ZONE_CELLS, NB, HOMES, opposite, progressTable, lateralTable, genMoves, mvFrom, mvTo, PIECES, PASS } from './rules.js';

export const LEVELS = [
  { name: '入門', extra: -9, beam: 5, rootBeam: 10, noise: 1.6 },
  { name: '初級', extra: 0, beam: 6, rootBeam: 12, noise: 0.5 },
  { name: '中級', extra: 1, beam: 6, rootBeam: 14, noise: 0.15 },
  { name: '高級', extra: 2, beam: 5, rootBeam: 16, noise: 0.05 },
  { name: '大師', extra: 3, beam: 5, rootBeam: 18, noise: 0 },
];

const WIN = 1000;
const LAT_W = 0.1;
const LAST_W = 0.45;

// 依人數準備的資料表
const TABLES = {};
function tables(n) {
  if (TABLES[n]) return TABLES[n];
  const homes = HOMES[n];
  const targets = homes.map(opposite);
  const t = {
    homes,
    targets,
    prog: targets.map(progressTable),
    lat: targets.map(lateralTable),
    inT: targets.map((z) => { const a = new Uint8Array(N_CELLS); for (const c of ZONE_CELLS[z]) a[c] = 1; return a; }),
    inH: homes.map((z) => { const a = new Uint8Array(N_CELLS); for (const c of ZONE_CELLS[z]) a[c] = 1; return a; }),
  };
  TABLES[n] = t;
  return t;
}

// 每層一個著法緩衝區
const BUFS = Array.from({ length: 16 }, () => new Int32Array(1024));
const ORDER = Array.from({ length: 16 }, () => new Float64Array(1024));

export class CheckersAI {
  constructor() { this.nodes = 0; }

  // 單一玩家估值（越大越好）
  evaluate(board, seat) {
    const T = this.T;
    const prog = T.prog[seat], lat = T.lat[seat], inT = T.inT[seat];
    let s = 0, minP = 99, mineIn = 0, full = true;
    for (let i = 0; i < N_CELLS; i++) {
      if (board[i] !== seat) continue;
      const p = prog[i];
      s += p;
      if (!inT[i]) s -= lat[i] * LAT_W;
      else mineIn++;
      if (p < minP) minP = p;
    }
    for (const c of ZONE_CELLS[T.targets[seat]]) if (board[c] < 0) { full = false; break; }
    if (mineIn === PIECES || (full && mineIn > 0)) return WIN;
    return s + minP * LAST_W;
  }

  // 一步的粗估收益（排序用）
  delta(seat, m) {
    const T = this.T;
    const f = mvFrom(m), t = mvTo(m);
    const prog = T.prog[seat], lat = T.lat[seat], inT = T.inT[seat];
    let d = prog[t] - prog[f];
    d -= ((inT[t] ? 0 : lat[t]) - (inT[f] ? 0 : lat[f])) * LAT_W;
    if (T.inH[seat][f] && !T.inH[seat][t]) d += 0.25; // 鼓勵離開出發角
    if (inT[f] && !inT[t]) d -= 1.5;                   // 不要離開目標角
    return d;
  }

  isWin(board, seat) {
    const T = this.T;
    let mine = 0, full = true;
    for (const c of ZONE_CELLS[T.targets[seat]]) { if (board[c] === seat) mine++; else if (board[c] < 0) full = false; }
    return mine === PIECES || (full && mine > 0);
  }

  next(seat) {
    for (let k = 1; k <= this.n; k++) { const s = (seat + k) % this.n; if (!this.out[s]) return s; }
    return seat;
  }

  // 取前 beam 個著法（依粗估收益）
  candidates(board, seat, ply, beam) {
    const buf = BUFS[ply], ord = ORDER[ply];
    const k = genMoves(board, seat, buf);
    for (let i = 0; i < k; i++) ord[i] = this.delta(seat, buf[i]) + (this.jitter ? Math.random() * 1e-3 : 0);
    const idx = Array.from({ length: k }, (_, i) => i).sort((a, b) => ord[b] - ord[a]);
    return idx.slice(0, beam).map((i) => buf[i]);
  }

  // 葉節點：每位玩家的估值＋自己下一步的最大收益（最後一層只取最大分支）
  leaf(board) {
    const v = new Float64Array(this.n);
    for (let s = 0; s < this.n; s++) {
      if (this.out[s]) { v[s] = -WIN; continue; }
      let e = this.evaluate(board, s);
      if (e < WIN) {
        const buf = BUFS[15];
        const k = genMoves(board, s, buf);
        let best = 0;
        for (let i = 0; i < k; i++) { const d = this.delta(s, buf[i]); if (d > best) best = d; }
        e += best * 0.9;
      }
      v[s] = e;
    }
    return v;
  }

  // max-n 搜尋：回傳各玩家的分數向量
  search(board, seat, depth, ply) {
    this.nodes++;
    if (depth <= 0) return this.leaf(board);
    const moves = this.candidates(board, seat, ply, this.beam);
    if (!moves.length) return this.search(board, this.next(seat), depth - 1, ply + 1);
    let best = null;
    for (const m of moves) {
      const f = mvFrom(m), t = mvTo(m);
      board[f] = -1; board[t] = seat;
      let v;
      if (this.isWin(board, seat)) {
        v = this.leaf(board);
        v[seat] = WIN + depth; // 越早完成獎勵越多
      } else v = this.search(board, this.next(seat), depth - 1, ply + 1);
      board[t] = -1; board[f] = seat;
      if (!best || v[seat] > best[seat]) best = v;
    }
    return best;
  }

  setup(state, level) {
    this.n = state.n;
    this.T = tables(state.n);
    this.out = state.out || new Array(state.n).fill(false);
    const L = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level))];
    this.L = L;
    this.beam = L.beam;
    this.depth = Math.max(1, this.n + L.extra);
    this.jitter = true;
    return L;
  }

  // 分析：回傳根節點每個候選著法的分數（由好到壞）
  // state: { board:Int8Array|Array, n, turn, out, recent:[我方最近著法] }
  analyze(state, level = 2, lines = 0) {
    const L = this.setup(state, level);
    const board = Int8Array.from(state.board);
    const seat = state.turn;
    this.nodes = 0;
    const base = this.evaluate(board, seat);
    const moves = this.candidates(board, seat, 0, L.rootBeam);
    const recent = state.recent || [];
    const out = [];
    for (const m of moves) {
      const f = mvFrom(m), t = mvTo(m);
      board[f] = -1; board[t] = seat;
      let v;
      if (this.isWin(board, seat)) { v = this.leaf(board); v[seat] = WIN + this.depth + 1; }
      else v = this.search(board, this.next(seat), this.depth - 1, 1);
      board[t] = -1; board[f] = seat;
      let score = v[seat] - base;
      // 避免來回走同一顆棋子
      if (recent.some((r) => r >= 0 && mvFrom(r) === t && mvTo(r) === f)) score -= 2.5;
      out.push({ move: m, score, gain: this.T.prog[seat][t] - this.T.prog[seat][f] });
    }
    out.sort((a, b) => b.score - a.score);
    return lines ? out.slice(0, lines) : out;
  }

  // 選一步：{ move, score, depth, nodes }
  choose(state, level = 2) {
    const all = this.analyze(state, level);
    if (!all.length) return { move: PASS, score: 0, depth: this.depth, nodes: this.nodes };
    const noise = this.L.noise;
    let pick = all[0];
    if (noise > 0) {
      // 入門／初級：偶爾選次佳（分數差在雜訊範圍內）
      const ok = all.filter((x) => x.score >= all[0].score - noise && x.score > -WIN / 2);
      pick = ok[Math.floor(Math.random() * ok.length)] || all[0];
    } else {
      const ties = all.filter((x) => x.score >= all[0].score - 1e-6);
      pick = ties[Math.floor(Math.random() * ties.length)];
    }
    return { move: pick.move, score: pick.score, depth: this.depth, nodes: this.nodes };
  }
}
