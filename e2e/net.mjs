// 遠端對賽端對端測試：本機配對伺服器＋四個程式實例
// A 房主（紅）、B 遠端（綠）、C 遠端（藍）、D 比賽開始後加入（觀棋者）
// 用法：node e2e/net.mjs [截圖資料夾]
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const { PeerServer } = require('peer');
const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const PORT = 9131;
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
for (const p of ['e2eA', 'e2eB', 'e2eC', 'e2eD']) fs.rmSync(path.join(appData, 'xiaoke-checkers-' + p), { recursive: true, force: true });
const server = PeerServer({ port: PORT, path: '/' });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

async function launch(profile, name) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', '--profile=' + profile, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  win.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await win.waitForSelector('#btnHost', { timeout: 30000 });
  await win.evaluate(async ({ port, name }) => {
    window.__xkc.settings = await window.xk.settings.set({ playerName: name, server: { mode: 'custom', host: '127.0.0.1', port, path: '/', secure: false }, music: { autoplay: false }, sfx: false });
  }, { port: PORT, name });
  await win.evaluate(() => document.querySelector('#btnAbout') && 0);
  const waitFor = async (fn, arg, ms = 25000) => {
    const t = Date.now();
    for (;;) {
      const v = await win.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error(profile + ' 等待逾時：' + fn);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  return { app, win, errors, waitFor, name: profile };
}

const A = await launch('e2eA', '小明');
const B = await launch('e2eB', '阿華');
const C = await launch('e2eC', '小美');
const all = [A, B, C];
const banner = (X) => X.win.evaluate(() => document.querySelector('#turnBanner').textContent);
const boardOf = (X) => X.win.evaluate(() => Array.from(window.__xkc.game.board).join(','));
const plies = (X) => X.win.evaluate(() => window.__xkc.game.moves.length);
const idle = (X) => X.waitFor(() => !window.__xkc.animating);
// 在 X 上用滑鼠邏輯走一步（前進最多的走法）
const playBest = (X) => X.win.evaluate(() => {
  const S = window.__xkc, g = S.game, b = window.__xkcBoard;
  const ms = g.legalMoves();
  let best = ms[0], bs = -99;
  for (const m of ms) { const d = g.prog[g.turn][m & 127] - g.prog[g.turn][m >> 7]; if (d > bs) { bs = d; best = m; } }
  b.onCellClick(best >> 7); b.onCellClick(best & 127);
  return S.game.moves.length;
});
const syncedAt = async (list, n) => { for (const X of list) await X.waitFor((k) => window.__xkc.game && window.__xkc.game.moves.length >= k && !window.__xkc.animating, n); };

try {
  // A 建立 3 人房間
  await A.win.click('.mode-card:nth-child(2) .segbtn[data-v="3"]');
  await A.win.click('#btnHost');
  const code = (await A.waitFor(() => document.querySelector('.room-code')?.textContent)).replace(/\s/g, '');
  check('建立房間取得 6 位數房號', /^\d{6}$/.test(code), code);

  // B、C 加入
  for (const X of [B, C]) { await X.win.fill('#joinCode', code); await X.win.click('#btnJoin'); }
  await A.waitFor(() => window.__xkc.net.members.length === 3);
  await C.waitFor(() => document.querySelectorAll('.seat-row:not(.wait)').length === 3);
  check('大廳顯示三位參賽者', true);
  check('B 是綠方、C 是藍方', (await B.win.evaluate(() => window.__xkc.net.mySeat)) === 1 && (await C.win.evaluate(() => window.__xkc.net.mySeat)) === 2);
  await A.win.screenshot({ path: path.join(outDir, 'net-1-lobby-A.png') });

  // 開始比賽
  await A.win.click('#btnStartNet');
  for (const X of all) await X.waitFor(() => window.__xkc.mode === 'net' && window.__xkc.net.started);
  check('三方進入比賽', true);
  check('A（主控權）提示「輪到您下棋」', (await banner(A)) === '輪到您下棋', await banner(A));
  check('B、C 提示「換您觀棋」', (await banner(B)).startsWith('換您觀棋') && (await banner(C)).startsWith('換您觀棋'));
  check('名稱互通', (await C.win.evaluate(() => window.__xkc.seats.map((s) => s.name).join('/'))) === '小明/阿華/小美');
  check('B 不能在 A 的回合動棋', await B.win.evaluate(() => { const S = window.__xkc; window.__xkcBoard.onCellClick(S.game.piecesOf(1)[0]); return S.selected === -1; }));

  // 輪流下：A → B → C → A …
  const order = [A, B, C];
  for (let k = 0; k < 9; k++) {
    const X = order[k % 3];
    await X.waitFor(() => document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkc.animating);
    await playBest(X);
    await syncedAt(all, k + 1);
  }
  const boards = await Promise.all(all.map(boardOf));
  check('9 步後三方棋盤一致', boards.every((b) => b === boards[0]));
  await A.win.screenshot({ path: path.join(outDir, 'net-2-A.png') });
  await C.win.screenshot({ path: path.join(outDir, 'net-2-C.png') });

  // 觀棋者 D 中途加入
  const D = await launch('e2eD', '阿德');
  all.push(D);
  await D.win.fill('#joinCode', code);
  await D.win.click('#btnJoin');
  await D.waitFor(() => window.__xkc.mode === 'net' && window.__xkc.game && window.__xkc.game.moves.length >= 9);
  check('觀棋者 D 加入並同步棋局', (await boardOf(D)) === boards[0]);
  check('D 是觀棋者', (await D.win.evaluate(() => window.__xkc.mySeat)) === -1 && (await banner(D)).startsWith('觀棋中'), await banner(D));
  check('D 不能動棋', await D.win.evaluate(() => { const S = window.__xkc, n = S.game.moves.length; window.__xkcBoard.onCellClick(S.game.piecesOf(S.game.turn)[0]); return S.selected === -1 && S.game.moves.length === n; }));
  await D.win.screenshot({ path: path.join(outDir, 'net-3-spectator-D.png') });

  // 觀棋者看得到主控者選到的棋子
  await A.waitFor(() => document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkc.animating);
  await A.win.evaluate(() => { const S = window.__xkc; window.__xkcBoard.onCellClick(S.game.piecesOf(0)[3]); });
  await D.waitFor(() => window.__xkcBoard.peerSel.visible, null, 5000);
  check('觀棋者看到主控者選子', true);
  await playBest(A);
  await syncedAt(all, 10);

  // 文字聊天（B 說話，其他人都收到）
  await B.win.click('.tab[data-tab="chat"]');
  await B.win.fill('#chatInput', '大家好，我是阿華！');
  await B.win.press('#chatInput', 'Enter');
  for (const X of [A, C, D]) await X.waitFor(() => [...document.querySelectorAll('.chat-msg')].some((m) => m.textContent.includes('我是阿華')));
  check('聊天訊息送到所有人（含觀棋者）', true);

  // 語音：A、B、D 加入（mesh）
  for (const X of [A, B, D]) {
    await X.win.click('.tab[data-tab="chat"]');
    await X.win.click('#btnVoice');
    await X.waitFor(() => window.__xkc.voice.on);
    await X.win.waitForTimeout(800);
  }
  await A.waitFor(() => window.__xkc.voice.calls.size === 2, null, 20000);
  await D.waitFor(() => window.__xkc.voice.calls.size === 2, null, 20000);
  await A.waitFor(() => document.querySelectorAll('#remoteAudios audio').length === 2, null, 20000);
  check('三人語音互通（各有 2 條通話）', true);
  check('成員列表顯示語音中', await C.waitFor(() => document.querySelectorAll('.member.voice').length === 3, null, 10000));
  await B.win.click('#btnVoice');
  await A.waitFor(() => window.__xkc.voice.calls.size === 1, null, 15000);
  check('B 離開語音後其他人斷開與 B 的通話', true);
  await A.win.screenshot({ path: path.join(outDir, 'net-4-chat-voice-A.png') });

  // C 斷線 → 藍方由 AI 代下
  const n0 = await plies(A);
  await C.app.close();
  all.splice(all.indexOf(C), 1);
  await A.waitFor(() => window.__xkc.seats[2].kind === 'ai', null, 30000);
  await B.waitFor(() => window.__xkc.seats[2].kind === 'ai', null, 10000);
  check('C 斷線後藍方改由 AI 代下', true);
  // 輪到 A、B 時由他們走；輪到藍方時等 AI 自動走
  for (let k = 0; k < 4; k++) {
    await A.waitFor(() => !window.__xkc.animating && !window.__xkc.aiThinking);
    const before = await plies(A);
    const turn = await A.win.evaluate(() => window.__xkc.game.turn);
    if (turn === 0) await playBest(A);
    else if (turn === 1) { await B.waitFor(() => !window.__xkc.animating && document.querySelector('#turnBanner').textContent === '輪到您下棋'); await playBest(B); }
    await A.waitFor((x) => window.__xkc.game.moves.length > x, before, 30000);
  }
  await A.waitFor(() => !window.__xkc.animating && !window.__xkc.aiThinking);
  await syncedAt(all, (await plies(A)));
  const movers = await A.win.evaluate((x) => window.__xkc.game.movers.slice(x), n0);
  check('AI 替藍方走棋', movers.includes(2), movers.join(','));
  const b2 = await Promise.all(all.map(boardOf));
  check('斷線後 A、B、D 棋盤仍一致', b2.every((b) => b === b2[0]));

  // B 認輸 → 綠方棋子拿走，A 與藍方 AI 繼續
  await B.win.click('#btnResign');
  await B.win.click('.modal-btns .primary');
  await A.waitFor(() => window.__xkc.game.out[1], null, 15000);
  await D.waitFor(() => window.__xkc.game.out[1], null, 15000);
  check('B 認輸：綠方出局、棋子拿走', (await A.win.evaluate(() => window.__xkc.game.piecesOf(1).length)) === 0);
  check('A 與藍方繼續比賽', (await A.win.evaluate(() => !window.__xkc.game.result)));
  await A.win.waitForTimeout(1000);
  await D.win.screenshot({ path: path.join(outDir, 'net-5-after-resign-D.png') });
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  for (const X of all) await X.win.screenshot({ path: path.join(outDir, `net-fail-${X.name}.png`) }).catch(() => {});
}

for (const X of all) {
  const errs = X.errors.filter((e) => !/favicon|Autofill|peer error|ICE|WebRTC|Could not connect|Lost connection/i.test(e));
  check(`${X.name} 沒有主控台錯誤`, errs.length === 0, errs.join('\n'));
}
console.log(`\n通過 ${pass}，失敗 ${fail}`);
for (const X of all) await X.app.close().catch(() => {});
server.close?.();
process.exit(fail ? 1 : 0);
