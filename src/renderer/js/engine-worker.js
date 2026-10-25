// AI 搜尋在背景執行緒，避免卡住 3D 畫面
import { CheckersAI } from './ai.js';

const ai = new CheckersAI();

self.onmessage = (e) => {
  const { id, cmd, state, level, lines } = e.data || {};
  try {
    if (cmd === 'choose') self.postMessage({ id, ok: true, r: ai.choose(state, level) });
    else if (cmd === 'analyze') self.postMessage({ id, ok: true, r: ai.analyze(state, level, lines || 3) });
  } catch (err) {
    self.postMessage({ id, ok: false, e: String((err && err.message) || err) });
  }
};
