// 單機端對端測試：首頁、與 AI 對局（3 人）、軍師（離線）、提示、悔棋、認輸、棋譜庫、重播、AI 對 AI、音樂
// 用法：node e2e/smoke.mjs [截圖資料夾]
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
fs.rmSync(path.join(appData, 'xiaoke-checkers-e2eSmoke'), { recursive: true, force: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=e2eSmoke', '--autoplay-policy=no-user-gesture-required'] });
const win = await app.firstWindow();
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const waitFor = async (fn, arg, ms = 30000) => {
  const t = Date.now();
  for (;;) {
    const v = await win.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
    await new Promise((r) => setTimeout(r, 150));
  }
};
const banner = () => win.evaluate(() => document.querySelector('#turnBanner').textContent);
const myTurn = () => waitFor(() => document.querySelector('#turnBanner').textContent.startsWith('輪到您下棋') && !window.__xkc.animating && !window.__xkc.aiThinking);
// 用滑鼠邏輯走一步：點自己的棋子，再點落點（優先選前進最多的走法）
const playBest = () => win.evaluate(() => {
  const S = window.__xkc, g = S.game, b = window.__xkcBoard;
  const ms = g.legalMoves();
  let best = ms[0], bs = -99;
  for (const m of ms) { const d = g.prog[g.turn][m & 127] - g.prog[g.turn][m >> 7]; if (d > bs) { bs = d; best = m; } }
  b.onCellClick(best >> 7);
  const targets = b.targets.length;
  b.onCellClick(best & 127);
  return { targets, n: g.moves.length };
});

try {
  await win.waitForSelector('#startAI', { timeout: 20000 });
  await win.evaluate(async () => { window.__xkc.settings = await window.xk.settings.set({ music: { autoplay: false } }); });
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(outDir, '1-home.png') });
  check('首頁有 A、B、C 三種模式', (await win.locator('.mode-card').count()) === 3);
  check('首頁註明開發者', (await win.locator('.credit').textContent()).includes('吳玉柱 先生 與 Claude AI Opus 5.5'));

  const nTracks = await win.evaluate(() => window.xk.music.list().then((l) => l.length));
  check('內建 20 首背景音樂', nTracks === 20, String(nTracks));
  const secs = await win.evaluate(() => window.xk.music.list().then((l) => l.map((t) => t.seconds)));
  check('每首 3 分多鐘', secs.every((s) => s >= 180 && s < 240), secs.join(','));

  // 與 AI 對局：3 人
  await win.click('.mode-card:nth-child(1) .segbtn[data-v="3"]');
  await win.click('#startAI');
  await myTurn();
  check('開局提示「輪到您下棋」', true);
  check('3 人對局：3 張玩家卡片', (await win.locator('.player').count()) === 3);
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(outDir, '2-board.png') });

  // 選棋子會顯示落點
  const r1 = await playBest();
  check('選棋子後顯示可走落點', r1.targets > 0, String(r1.targets));
  await waitFor(() => document.querySelector('#turnBanner').textContent.startsWith('換您觀棋'), null, 5000);
  check('走完換成「換您觀棋」', (await banner()).startsWith('換您觀棋'), await banner());
  check('AI 在思考時不能動棋', await win.evaluate(() => { const S = window.__xkc; const before = S.game.moves.length; window.__xkcBoard.onCellClick(S.game.piecesOf(0)[0]); return S.selected === -1 && S.game.moves.length === before; }));
  await myTurn();
  check('兩個 AI 都走完又輪到我', await win.evaluate(() => window.__xkc.game.moves.length >= 3));

  // 多走幾步，期間可能出現連跳
  for (let i = 0; i < 6; i++) { await playBest(); await myTurn(); }
  const jumps = await win.evaluate(() => window.__xkc.game.notes.filter((n) => n.includes('跳')).length);
  check('走法紀錄有連跳', jumps > 0, String(jumps));
  await win.screenshot({ path: path.join(outDir, '3-midgame.png') });

  // 軍師（離線）
  await win.click('.adv-quick button');
  await waitFor(() => [...document.querySelectorAll('.adv-msg.ai')].some((e) => e.textContent.includes('建議把')), null, 20000);
  check('軍師（離線）給出建議', true);
  check('軍師在棋盤標示建議', await win.evaluate(() => window.__xkcBoard.hintFrom.visible));

  // 提示
  await win.click('#btnHint');
  await waitFor(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.startsWith('提示')), null, 15000);
  check('提示按鈕', true);

  // 悔棋
  const before = await win.evaluate(() => window.__xkc.game.moves.length);
  await win.click('#btnUndo');
  const after = await win.evaluate(() => ({ n: window.__xkc.game.moves.length, turn: window.__xkc.game.turn }));
  check('悔棋退回到我的上一步', after.n === before - 3 && after.turn === 0, JSON.stringify({ before, after }));

  // 認輸
  await win.click('#btnResign');
  await win.click('.modal-btns .primary');
  await waitFor(() => window.__xkc.game.result);
  await win.waitForSelector('.modal h3');
  check('認輸後結束對局', (await win.locator('.modal h3').textContent()).length > 0);
  await win.screenshot({ path: path.join(outDir, '4-over.png') });
  await win.click('.modal-btns button:not(.primary)');

  // 棋譜庫與重播
  await win.click('#btnHome');
  await win.click('text=📜 棋譜庫');
  await win.waitForSelector('.rec-table');
  check('棋譜庫收錄本局', (await win.locator('.rec-table tbody tr').count()) === 1);
  await win.click('.rec-table .ops button:first-child');
  await waitFor(() => window.__xkc.mode === 'replay');
  await win.click('#rpNext'); await win.click('#rpNext');
  await win.waitForTimeout(900);
  check('重播前進兩步', (await banner()).includes('第 2 /'), await banner());
  await win.click('#rpLast');
  check('重播到終局', await win.evaluate(() => window.__xkc.replay.ply === window.__xkc.replay.rec.moves.length));
  await win.click('#btnHome');

  // AI 對 AI（2 人，快速）
  await win.click('.mode-card:nth-child(3) .segbtn[data-v="2"]');
  await win.click('.mode-card:nth-child(3) .segbtn[data-v="fast"]');
  await win.selectOption('#aivai0', '0');
  await win.selectOption('#aivai1', '0');
  await win.click('#startAivai');
  await waitFor(() => window.__xkc.game.moves.length >= 6, null, 30000);
  check('AI 對 AI 自動進行', true);
  await win.click('#btnPause');
  const paused = await win.evaluate(() => window.__xkc.game.moves.length);
  await win.waitForTimeout(1500);
  check('暫停後不再走', (await win.evaluate(() => window.__xkc.game.moves.length)) <= paused + 1);
  await win.click('#btnPause');
  await win.screenshot({ path: path.join(outDir, '5-aivai.png') });
  await waitFor(() => window.__xkc.game.result, null, 240000);
  check('AI 對 AI 下完一局', await win.evaluate(() => /全部到達/.test(window.__xkc.game.result.reason)));
  await win.waitForSelector('.modal h3');
  await win.screenshot({ path: path.join(outDir, '6-aivai-over.png') });
  await win.click('.modal-btns button:not(.primary)');

  // 視角
  await win.click('#viewTop');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(outDir, '7-top.png') });

  // 關於
  await win.click('#btnHome');
  await win.click('#btnAbout');
  await win.waitForSelector('.about');
  check('關於視窗註明開發者', (await win.locator('.about .credit-line').textContent()).includes('吳玉柱 先生'));
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(outDir, '8-about.png') });
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  await win.screenshot({ path: path.join(outDir, 'fail.png') }).catch(() => {});
}

const errs = errors.filter((e) => !/favicon|Autofill/.test(e));
check('沒有主控台錯誤', errs.length === 0, errs.join('\n'));
console.log(`\n通過 ${pass}，失敗 ${fail}`);
await app.close();
process.exit(fail ? 1 : 0);
