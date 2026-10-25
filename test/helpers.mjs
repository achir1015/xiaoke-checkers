import { ZONE_CELLS, CELLS, NB } from '../src/renderer/js/rules.js';

// 目標角缺最後一孔（底邊），旁邊的中立孔放一顆：走一步就到岸
export function almostWon(g) {
  g.board.fill(-1);
  const t = ZONE_CELLS[g.targets[0]];
  const hole = t[t.length - 1];
  for (const c of t) if (c !== hole) g.board[c] = 0;
  for (const c of ZONE_CELLS[g.homes[0]]) g.board[c] = 1; // 對手棋子放在紅方出發角（2 人時對手的家就是紅方目標角）
  let from = -1;
  for (let d = 0; d < 6; d++) { const n = NB[hole * 6 + d]; if (n >= 0 && CELLS[n].zone < 0) { from = n; break; } }
  g.board[from] = 0;
  return { from, hole };
}

