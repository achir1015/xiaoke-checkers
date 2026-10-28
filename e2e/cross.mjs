// 手機與電腦互通測試：手機（除錯版 APK，CDP）建立房間，電腦版（Electron）加入，用正式的公用配對伺服器對下幾步
// 用法：python android/build.py debug install，手機解鎖、開著小柯跳棋，執行 node e2e/cross.mjs [手機序號]
import { chromium, _electron as electron } from 'playwright-core';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const ADB = process.env.ADB || 'E:/小米觸控音箱/tools/android-sdk/platform-tools/adb.exe';
const SERIAL = process.argv[2] || process.env.ANDROID_SERIAL || 'R5CY236CQ3B';
const outDir = 'e2e/out';
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

const fm = adb('shell', 'dumpsys', 'window').match(/mCurrentFocus=[^\r\n]*/g) || [];
if (!fm.some((f) => f.includes('com.achir.xiaokecheckers'))) { console.log('前景不是小柯跳棋'); process.exit(2); }
const sock = /@?(webview_devtools_remote_\d+)/.exec(adb('shell', 'cat', '/proc/net/unix'));
execFileSync(ADB, ['-s', SERIAL, 'forward', 'tcp:9334', 'localabstract:' + sock[1]]);
const cdp = await chromium.connectOverCDP('http://127.0.0.1:9334');
const P = cdp.contexts()[0].pages().find((p) => p.url().includes('appassets'));

const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
fs.rmSync(path.join(appData, 'xiaoke-checkers-e2eCross'), { recursive: true, force: true });
const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=e2eCross'] });
const D = await app.firstWindow();
const waitOn = async (page, fn, arg, ms = 40000) => {
  const t = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
    await new Promise((r) => setTimeout(r, 250));
  }
};
const best = (page) => page.evaluate(() => {
  const S = window.__xkc, g = S.game, b = window.__xkcBoard;
  const ms = g.legalMoves(); let m0 = ms[0], bs = -99;
  for (const m of ms) { const d = g.prog[g.turn][m & 127] - g.prog[g.turn][m >> 7]; if (d > bs) { bs = d; m0 = m; } }
  b.onCellClick(m0 >> 7); b.onCellClick(m0 & 127);
});
const boardOf = (page) => page.evaluate(() => Array.from(window.__xkc.game.board).join(','));

try {
  await D.waitForSelector('#btnHost', { timeout: 30000 });
  await D.evaluate(async () => { window.__xkc.settings = await window.xk.settings.set({ playerName: '電腦棋友', music: { autoplay: false }, sfx: false }); });
  await P.reload();
  await waitOn(P, () => window.__xkc && document.querySelector('#btnHost'));
  await P.evaluate(async () => { window.__xkc.settings = await window.xk.settings.set({ playerName: '手機棋友', music: { autoplay: false }, server: { mode: 'public' } }); });

  // 手機建立 2 人房間
  await P.evaluate(() => { document.querySelector('.mode-card:nth-child(2) .segbtn[data-v="2"]').click(); document.querySelector('#btnHost').click(); });
  const code = (await waitOn(P, () => document.querySelector('.room-code')?.textContent)).replace(/\s/g, '');
  check('手機建立房間（公用配對伺服器）', /^\d{6}$/.test(code), code);
  // 電腦加入
  await D.fill('#joinCode', code);
  await D.click('#btnJoin');
  await waitOn(P, () => window.__xkc.net.members.length === 2);
  check('電腦加入手機的房間', true);
  await P.evaluate(() => document.querySelector('#btnStartNet').click());
  await waitOn(D, () => window.__xkc.mode === 'net' && window.__xkc.net.started);
  check('雙方開始比賽', (await P.evaluate(() => document.querySelector('#turnBanner').textContent)) === '輪到您下棋');
  for (let k = 0; k < 4; k++) {
    const X = k % 2 === 0 ? P : D;
    await waitOn(X, () => document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkc.animating);
    await best(X);
    await waitOn(P, (n) => window.__xkc.game.moves.length >= n && !window.__xkc.animating, k + 1);
    await waitOn(D, (n) => window.__xkc.game.moves.length >= n && !window.__xkc.animating, k + 1);
  }
  check('手機與電腦輪流下 4 步，棋盤一致', (await boardOf(P)) === (await boardOf(D)));
  // 聊天
  await D.evaluate(() => { document.querySelector('#chatInput').value = '手機你好！'; document.querySelector('#chatSend').click(); });
  await waitOn(P, () => [...document.querySelectorAll('.chat-msg')].some((m) => m.textContent.includes('手機你好')));
  check('電腦傳訊息到手機', true);
  fs.writeFileSync(path.join(outDir, 'cross-phone.png'), execFileSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));
  await D.screenshot({ path: path.join(outDir, 'cross-pc.png') });
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
} finally {
  // 收尾：手機回首頁、關房間
  await P.evaluate(() => { try { document.querySelector('#btnHome').click(); setTimeout(() => document.querySelector('.modal-btns .primary')?.click(), 300); } catch {} }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  console.log(`\n結果：${pass} 通過，${fail} 失敗`);
  await app.close().catch(() => {});
  await cdp.close().catch(() => {});
  process.exit(fail ? 1 : 0);
}
