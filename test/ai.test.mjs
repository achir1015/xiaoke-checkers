import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, MV } from '../src/renderer/js/rules.js';
import { almostWon } from './helpers.mjs';
import { CheckersAI, LEVELS } from '../src/renderer/js/ai.js';

function selfPlay(n, levels) {
  const ai = new CheckersAI();
  const g = new Game(n);
  const recent = [[], [], []];
  while (!g.result) {
    const s = g.turn;
    const r = ai.choose({ board: g.board, n, turn: s, out: g.out, recent: recent[s].slice(-2) }, levels[s]);
    assert.ok(g.legalMoves().includes(r.move), 'AI 走法必須合法');
    recent[s].push(r.move);
    g.play(r.move);
  }
  return g;
}

test('五種難度', () => { assert.equal(LEVELS.length, 5); });

test('2 人 AI 對局能下完（有人全部到岸）', () => {
  const g = selfPlay(2, [1, 2]);
  assert.match(g.result.reason, /全部到達/);
  assert.ok(g.moves.length < g.maxPlies);
});

test('3 人 AI 對局能下完', () => {
  const g = selfPlay(3, [0, 1, 1]);
  assert.match(g.result.reason, /全部到達/);
});

test('有一步就贏時一定會走', () => {
  const g = new Game(2);
  const { from, hole } = almostWon(g);
  const r = new CheckersAI().choose({ board: g.board, n: 2, turn: 0, out: [false, false] }, 2);
  assert.equal(r.move, MV(from, hole));
});

test('分析會回傳由好到壞的候選著法', () => {
  const g = new Game(3);
  const lines = new CheckersAI().analyze({ board: g.board, n: 3, turn: 0, out: g.out }, 2, 3);
  assert.equal(lines.length, 3);
  assert.ok(lines[0].score >= lines[1].score && lines[1].score >= lines[2].score);
});
