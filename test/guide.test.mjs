// 遊戲說明的每一課都用規則引擎檢查：擺子合法、示範走法合規則、「不能走」真的走不到、練習答案走得到
import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, parsePieces, pos, whyNot } from '../src/renderer/js/guide.js';
import { reachable, findPath, isStep, ZONE_CELLS, N_CELLS } from '../src/renderer/js/rules.js';

const env = { touch: false };
const say = (st, e = env) => (typeof st.say === 'function' ? st.say(e) : st.say);

test('共 10 課，每一課都有解說', () => {
  assert.equal(LESSONS.length, 10);
  for (const l of LESSONS) {
    assert.ok(l.title && l.steps.length >= 3, l.title);
    for (const st of l.steps) {
      assert.ok(say(st) && say(st).length > 8, l.title);
      assert.ok(say(st, { touch: true }).length > 8);
    }
  }
});

for (const [li, lesson] of LESSONS.entries()) {
  test(`第 ${li + 1} 課「${lesson.title}」的示範都合規則`, () => {
    let board = new Int8Array(N_CELLS).fill(-1);
    for (const [si, st] of lesson.steps.entries()) {
      const where = `${lesson.title} 第 ${si + 1} 步`;
      if (st.pieces != null) board = parsePieces(st.pieces);
      const sel = st.sel ? pos(st.sel) : st.practice ? pos(st.practice.piece) : -1;
      if (sel >= 0) assert.ok(board[sel] >= 0, `${where}：選的位置沒有棋子`);
      const dests = sel >= 0 ? reachable(board, sel).dests : new Set();
      if (st.legal) assert.ok(dests.size > 0, `${where}：沒有可走的位置`);
      for (const b of st.bad || []) {
        const c = pos(b);
        assert.ok(c >= 0, `${where}：位置不存在`);
        assert.ok(!dests.has(c), `${where}：標成不能走的位置其實走得到`);
        assert.ok(whyNot(board, sel, c).length > 5);
      }
      for (const a of st.arrows || []) for (const p of a) assert.ok(pos(p) >= 0, `${where}：箭頭位置不存在 ${p}`);
      if (st.ring) assert.ok(pos(st.ring) >= 0);
      if (st.move) {
        const [f, t] = st.move.map(pos);
        assert.ok(board[f] >= 0, `${where}：移動的位置沒有棋子`);
        const path = findPath(board, f, t);
        assert.ok(path, `${where}：示範走法不合規則`);
        board[t] = board[f]; board[f] = -1;
        if (st.win) {
          const target = ZONE_CELLS[3];
          assert.ok(target.every((c) => board[c] === 0), `${where}：示範完沒有十顆都到岸`);
        }
      }
      if (st.practice) {
        const from = pos(st.practice.piece);
        assert.ok(dests.size > 0, `${where}：練習沒有可以走的位置`);
        if (st.practice.goal) assert.ok(dests.has(pos(st.practice.goal)), `${where}：練習答案走不到`);
        const goal = st.practice.goal ? pos(st.practice.goal) : [...dests][0];
        board[goal] = board[from]; board[from] = -1;
      }
    }
  });
}

test('擋住的原因說得正確', () => {
  const two = parsePieces('r:0,2 g:1,1 g:2,0');
  assert.match(whyNot(two, pos([0, 2]), pos([3, -1])), /兩顆/);
  const gap = parsePieces('r:0,2 g:2,0');
  assert.match(whyNot(gap, pos([0, 2]), pos([4, -2])), /空孔/);
  const turn = parsePieces('r:0,2 g:1,1');
  assert.match(whyNot(turn, pos([0, 2]), pos([1, 0])), /直線/);
  assert.match(whyNot(turn, pos([0, 2]), pos([1, 1])), /已經有棋子/);
});

test('連跳示範一口氣跳三次', () => {
  const b = parsePieces('r:0,3 r:1,2 g:2,0 b:3,-2');
  const path = findPath(b, pos([0, 3]), pos([4, -3]));
  assert.equal(path.length, 4);
  assert.ok(!isStep(path[0], path[1]));
  const ladder = parsePieces('r:0,4 r:0,3 r:0,1 r:0,-1');
  assert.equal(findPath(ladder, pos([0, 4]), pos([0, -2])).length, 4);
});
