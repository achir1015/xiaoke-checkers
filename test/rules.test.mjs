import test from 'node:test';
import assert from 'node:assert/strict';
import { almostWon } from './helpers.mjs';
import { CELLS, ZONE_CELLS, N_CELLS, Game, MV, mvFrom, mvTo, cellAt, reachable, findPath, genMoves, legalMovesFor, replayRecord, opposite, HOMES, cellName, parseCell } from '../src/renderer/js/rules.js';

const empty = () => new Int8Array(N_CELLS).fill(-1);
const at = (x, z) => { const i = cellAt(x, z); assert.ok(i >= 0, `孔 ${x},${z} 不存在`); return i; };

test('棋盤 121 孔、六個角各 10 孔', () => {
  assert.equal(CELLS.length, 121);
  for (const z of ZONE_CELLS) assert.equal(z.length, 10);
  assert.equal(CELLS.filter((c) => c.zone < 0).length, 61);
  for (let k = 0; k < 6; k++) assert.equal(opposite(opposite(k)), k);
  assert.equal(parseCell(cellName(57)), 57);
});

test('開局：2 人與 3 人各有 14 種走法', () => {
  for (const n of [2, 3]) {
    const g = new Game(n);
    assert.equal(g.legalMoves().length, 14);
    HOMES[n].forEach((z, s) => assert.equal(g.piecesOf(s).length, 10));
  }
});

test('跳一顆棋子落在正後方空孔', () => {
  const b = empty();
  const a = at(0, 0), over = at(1, 0), land = at(2, 0);
  b[a] = 0; b[over] = 1;
  assert.ok(reachable(b, a).dests.has(land));
  assert.deepEqual(findPath(b, a, land), [a, land]);
});

test('隔兩顆棋子不能跳（擋住）', () => {
  const b = empty();
  const a = at(0, 0);
  b[a] = 0; b[at(1, 0)] = 1; b[at(2, 0)] = 1;
  const d = reachable(b, a).dests;
  assert.ok(!d.has(at(3, 0)));
  assert.ok(!d.has(at(4, 0)));
});

test('中間有空孔不能跳（只能跳緊鄰的一顆）', () => {
  const b = empty();
  const a = at(0, 0);
  b[a] = 0; b[at(2, 0)] = 1;
  assert.ok(!reachable(b, a).dests.has(at(4, 0)));
  assert.ok(!reachable(b, a).dests.has(at(3, 0)));
});

test('連跳：每一跳都是直線，可以換方向接著跳', () => {
  const b = empty();
  const a = at(0, 0);
  b[a] = 0; b[at(1, 0)] = 1;          // 往 +x 跳到 (2,0)
  b[at(2, 1)] = 1;                    // 再從 (2,0) 往 +z 跳到 (2,2)
  const land = at(2, 2);
  assert.ok(reachable(b, a).dests.has(land));
  assert.deepEqual(findPath(b, a, land), [a, at(2, 0), land]);
  // 不會出現「轉彎跳」：(0,0) 不能直接到 (2,1) 旁邊的 (3,1)
  assert.ok(!reachable(b, a).dests.has(at(3, 1)));
});

test('快速走法產生器與逐顆搜尋結果一致', () => {
  const g = new Game(3);
  const buf = new Int32Array(1024);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 150 && !g.result; k++) {
    const fast = Array.from(buf.subarray(0, genMoves(g.board, g.turn, buf))).sort((a, b) => a - b);
    const slow = [];
    for (let i = 0; i < N_CELLS; i++) if (g.board[i] === g.turn) for (const d of reachable(g.board, i).dests) slow.push(MV(i, d));
    slow.sort((a, b) => a - b);
    assert.deepEqual(fast, slow);
    g.play(fast[Math.floor(rnd() * fast.length)]);
  }
});

test('10 顆全部進入對面角獲勝', () => {
  const g = new Game(2);
  const { from, hole } = almostWon(g);
  assert.ok(g.legalMoves().includes(MV(from, hole)));
  g.play(MV(from, hole));
  assert.equal(g.result.winner, 0);
});

test('對面角被填滿且有自己的棋子也算贏（防止佔角）', () => {
  const g = new Game(2);
  const t = ZONE_CELLS[g.targets[0]];
  g.board.fill(-1);
  // 紅方 9 顆＋綠方 1 顆佔住
  t.forEach((c, k) => { g.board[c] = k === 0 ? 1 : 0; });
  assert.ok(g.isWin(0));
});

test('認輸：2 人時另一方獲勝，3 人時棋子拿走繼續', () => {
  const g2 = new Game(2);
  g2.resign(0);
  assert.equal(g2.result.winner, 1);
  const g3 = new Game(3);
  const removed = g3.resign(0);
  assert.equal(removed.length, 10);
  assert.equal(g3.result, null);
  assert.equal(g3.turn, 1);
  g3.play(g3.legalMoves()[0]);
  assert.equal(g3.turn, 2);
  g3.play(g3.legalMoves()[0]);
  assert.equal(g3.turn, 1);
});

test('悔棋與棋譜重播', () => {
  const g = new Game(3);
  const before = Array.from(g.board);
  for (let k = 0; k < 9; k++) g.play(g.legalMoves()[k % 3]);
  const rec = g.toRecord({});
  const r = replayRecord(rec);
  assert.deepEqual(Array.from(r.board), Array.from(g.board));
  assert.equal(replayRecord(rec, 4).moves.length, 4);
  for (let k = 0; k < 9; k++) g.undo();
  assert.deepEqual(Array.from(g.board), before);
  assert.equal(g.turn, 0);
});

test('著法編碼', () => {
  const m = MV(100, 7);
  assert.equal(mvFrom(m), 100);
  assert.equal(mvTo(m), 7);
});
