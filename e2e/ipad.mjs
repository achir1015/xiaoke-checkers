// iPad 版網頁測試：用 Chrome 模擬 iPad Pro 11 吋橫放（觸控、UA 是 Macintosh，和真的 iPad WebView 一樣）
// 並模擬 iOS App 的橋（window.XiaokeIOS＋webkit.messageHandlers.xkj）
// 用法：node scripts/build-mobile.mjs && node e2e/ipad.mjs [截圖資料夾]
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const WWW = path.resolve('mobile/www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.png': 'image/png' };
const PORT = 8833;
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT);

// iOS App 的橋：記下網頁送來的指令
const BRIDGE = () => {
  window.XiaokeIOS = true;
  window.__iosCalls = [];
  window.webkit = { messageHandlers: { xkj: { postMessage: (m) => {
    window.__iosCalls.push(m.cmd + ':' + (m.args || [])[0]);
    if (m.cmd === 'begin_save') return Promise.resolve({ status: 'ok', token: 't1', path: m.args[0] });
    if (m.cmd === 'end_save') return Promise.resolve({ status: 'ok', path: 'shared.txt' });
    return Promise.resolve({ status: 'ok' });
  } } } };
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const browser = await chromium.launch({ channel: 'chrome' });
const W = 1194, H = 834;
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' });
await ctx.addInitScript(BRIDGE);
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404|403/.test(m.text())) errors.push(m.text()); }); // 403／404：GitHub 查詢次數限制或安裝頁還沒上線
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const waitFor = async (fn, arg, ms = 30000) => {
  const t = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
    await new Promise((r) => setTimeout(r, 150));
  }
};
const shot = (n) => page.screenshot({ path: path.join(outDir, n) });
const box = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, b: r.bottom, r: r.right }; }, sel);
const fits = () => page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
// 3D 物件在螢幕上的位置
const screenOf = (kind, arg) => page.evaluate(([k, a]) => {
  const b = window.__xkcBoard;
  const obj = k === 'marble' ? b.marbles.get(a) : b.targets[b.targets.length - 1];
  const v = obj.position.clone().project(b.camera);
  const r = b.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
}, [kind, arg]);

try {
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForSelector('#startAI', { timeout: 30000 });
  const cls = await page.evaluate(() => document.documentElement.className);
  check('iPad：電腦版版面＋觸控', /\btouch\b/.test(cls) && /\bios\b/.test(cls), cls);
  await page.evaluate(async () => { window.__xkc.settings = await window.xk.settings.set({ music: { autoplay: false } }); });
  check('首頁沒有左右捲動', (await fits())[0] <= W, String(await fits()));
  check('首頁註明開發者', (await page.locator('.credit').textContent()).includes('吳玉柱 先生 與 Claude AI Opus 5.5'));
  const tracks = await page.evaluate(() => window.xk.music.list().then((l) => l.length));
  check('內建 20 首背景音樂', tracks === 20, String(tracks));
  await shot('i1-home.png');

  // 與 AI 對賽（3 人）
  await page.tap('.mode-card:nth-child(1) .segbtn[data-v="3"]');
  await page.tap('#startAI');
  await waitFor(() => window.__xkc.mode === 'ai' && document.querySelector('#turnBanner').textContent === '輪到您下棋');
  await page.waitForTimeout(800);
  const gf = await fits();
  check('對局畫面剛好一頁（不用捲動）', gf[0] <= W && gf[1] <= H, String(gf));
  const bw = await box('#boardWrap'), right = await box('.game-body > .right'), left = await box('.game-body > .left');
  check('左邊棋手、中間棋盤、右邊面板', left.r <= bw.l + 2 && bw.r <= right.l + 2 && right.r <= W + 1, JSON.stringify({ left, bw, right }));
  check('棋盤夠大', bw.w >= 550 && bw.h >= 600, JSON.stringify(bw));
  check('棋盤提示改成手指操作', (await page.evaluate(() => document.querySelector('.board-tip').textContent)).includes('兩指'));

  // 用手指點棋子、再點落點（真的觸控點擊 3D 畫面）
  const cell = await page.evaluate(() => { const S = window.__xkc; const m = S.game.legalMoves().find((x) => { const f = x >> 7; return S.game.prog[0][x & 127] - S.game.prog[0][f] >= 2; }) ?? S.game.legalMoves()[0]; return m >> 7; });
  const p1 = await screenOf('marble', cell);
  await page.touchscreen.tap(p1.x, p1.y);
  await waitFor(() => window.__xkc.selected >= 0, null, 5000);
  check('手指點棋子會選起來並顯示落點', await page.evaluate(() => window.__xkcBoard.targets.length > 0));
  await shot('i2-select.png');
  const p2 = await screenOf('target');
  await page.touchscreen.tap(p2.x, p2.y);
  await waitFor(() => window.__xkc.game.moves.length >= 1, null, 5000);
  check('手指點落點就走棋', true);
  await waitFor(() => window.__xkc.game.moves.length >= 3 && document.querySelector('#turnBanner').textContent === '輪到您下棋', null, 30000);
  check('兩個 AI 回應後又輪到我', true);
  await page.waitForTimeout(600);
  await shot('i3-game.png');

  // 軍師（離線）
  await page.tap('.adv-quick button');
  await waitFor(() => [...document.querySelectorAll('.adv-msg.ai')].some((e) => e.textContent.includes('建議把')), null, 20000);
  check('軍師（離線）給出建議', true);

  // 匯出棋譜 → iOS 分享選單
  const saved = await page.evaluate(() => window.xk.games.export('test.txt', '紅：14-1→13-5'));
  const calls = await page.evaluate(() => window.__iosCalls.join(' '));
  check('匯出棋譜走 iOS 分享選單', saved === 'shared.txt' && /begin_save:test.txt/.test(calls) && /end_save/.test(calls), calls);

  // 認輸 → 棋譜存到 iPad（IndexedDB）
  await page.tap('#btnResign');
  await page.tap('.modal-btns .primary');
  await waitFor(() => window.__xkc.game.result);
  await page.waitForSelector('.modal h3');
  await page.tap('.modal-btns button:not(.primary)');
  const recs = await page.evaluate(() => window.xk.games.list().then((l) => l.length));
  check('棋譜存在 iPad 裡', recs === 1, String(recs));

  // 平台、檢查更新（iOS 走安裝頁）
  const info = await page.evaluate(() => window.xk.sys.info());
  check('平台是 iOS、版本號正確', info.platform === 'ios' && info.packaged && /^\d+\.\d+\.\d+$/.test(info.version), JSON.stringify(info));
  const upd = await page.evaluate(() => window.xk.update.check().then((i) => i, (e) => ({ error: e.message })));
  check('檢查更新（iOS）', upd.flavor === 'ios' || /查詢失敗/.test(upd.error || ''), JSON.stringify(upd).slice(0, 200));
  await page.evaluate(() => window.xk.update.openPage());
  check('更新頁用 Safari 開', (await page.evaluate(() => window.__iosCalls.join(' '))).includes('open_url:https://achir1015.github.io/xiaoke-checkers/ios/'), await page.evaluate(() => window.__iosCalls.join(' ')));

  // 重播
  await page.tap('#btnHome');
  await page.tap('text=📜 棋譜庫');
  await page.waitForSelector('.rec-table');
  await page.tap('.rec-table .ops button:first-child');
  await waitFor(() => window.__xkc.mode === 'replay');
  await page.tap('#rpNext');
  await page.waitForTimeout(600);
  check('棋譜重播', (await page.evaluate(() => window.__xkc.replay.ply)) === 1);
  await shot('i4-replay.png');
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  await shot('i-fail.png').catch(() => {});
} finally {
  check('沒有網頁錯誤', errors.length === 0, errors.join(' | '));
  console.log(`\n結果：${pass} 通過，${fail} 失敗`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
}
