// 手機直立版面測試：用 Chrome 模擬 Android 手機（模擬 XiaokeAndroid 橋）與 iPhone（模擬 iOS 橋）
// 用法：node scripts/build-mobile.mjs && node e2e/mobile.mjs [截圖資料夾]
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const WWW = path.resolve('mobile/www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.png': 'image/png' };
const PORT = 8834;
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT);

const ANDROID = () => {
  window.__calls = [];
  const log = (x) => { window.__calls.push(x); };
  window.XiaokeAndroid = {
    appInfo: () => JSON.stringify({ status: 'ok', version: '1.2.0', platform: 'android' }),
    beginSave: (n) => { log('beginSave:' + n); return JSON.stringify({ status: 'ok', token: 't', path: '下載/小柯跳棋/' + n }); },
    writeChunk: () => JSON.stringify({ status: 'ok' }),
    endSave: () => { log('endSave'); return JSON.stringify({ status: 'ok', path: '下載/小柯跳棋/x.txt' }); },
    checkUpdate: () => JSON.stringify({ status: 'ok', current: '1.2.0', latest: '1.2.0', url: 'https://github.com/achir1015/xiaoke-checkers/releases/download/v1.2.0/XiaokeCheckers-1.2.0-android.apk', page: '' }),
    openUrl: (u) => { log('openUrl:' + u); return true; },
  };
};
const IOS = () => {
  window.XiaokeIOS = true;
  window.webkit = { messageHandlers: { xkj: { postMessage: () => Promise.resolve({ status: 'ok' }) } } };
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];

async function phone(label, W, H, ua, bridge, prefix) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: ua });
  await ctx.addInitScript(bridge);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/404|403/.test(m.text())) errors.push(label + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(label + ' [pageerror] ' + e.message));
  const waitFor = async (fn, arg, ms = 30000) => {
    const t = Date.now();
    for (;;) {
      const v = await page.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const box = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, b: r.bottom, r: r.right }; }, sel);
  const fits = () => page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  const shot = (n) => page.screenshot({ path: path.join(outDir, prefix + n) });

  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForSelector('#startAI', { timeout: 30000 });
  const cls = await page.evaluate(() => document.documentElement.className);
  check(`${label}：手機直立版面`, /\bmobile\b/.test(cls), cls);
  await page.evaluate(async () => { window.__xkc.settings = await window.xk.settings.set({ music: { autoplay: false } }); });
  check(`${label}：首頁沒有左右捲動`, (await fits())[0] <= W, String(await fits()));
  await shot('1-home.png');

  // 3 人對 AI
  await page.tap('.mode-card:nth-child(1) .segbtn[data-v="3"]');
  await page.tap('#startAI');
  await waitFor(() => window.__xkc.mode === 'ai' && document.querySelector('#turnBanner').textContent === '輪到您下棋');
  await page.waitForTimeout(700);
  const f = await fits();
  check(`${label}：對局畫面剛好一頁`, f[0] <= W && f[1] <= H, String(f));
  const pl = await box('#players'), bw = await box('#boardWrap'), act = await box('.actions.play-only');
  check(`${label}：玩家在上、棋盤在中、按鈕在下`, pl.b <= bw.t + 2 && bw.b <= act.t + 2 && act.b <= H - 40, JSON.stringify({ pl, bw, act }));
  check(`${label}：三位玩家排成一排`, await page.evaluate(() => { const c = [...document.querySelectorAll('#players .player')].map((e) => e.getBoundingClientRect().top); return c.length === 3 && Math.max(...c) - Math.min(...c) < 2; }));
  check(`${label}：棋盤寬度用滿`, bw.w >= W - 2 && bw.h >= 300, JSON.stringify(bw));
  await shot('2-game.png');

  // 點棋子（手指）→ 落點
  const pos = (kind, a) => page.evaluate(([k, x]) => {
    const b = window.__xkcBoard;
    const o = k === 'marble' ? b.marbles.get(x) : b.targets[b.targets.length - 1];
    const v = o.position.clone().project(b.camera);
    const r = b.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, [kind, a]);
  const cell = await page.evaluate(() => { const S = window.__xkc; const m = S.game.legalMoves().find((x) => S.game.prog[0][x & 127] - S.game.prog[0][x >> 7] >= 2) ?? S.game.legalMoves()[0]; return m >> 7; });
  const p1 = await pos('marble', cell);
  await page.touchscreen.tap(p1.x, p1.y);
  await waitFor(() => window.__xkc.selected >= 0, null, 5000);
  const p2 = await pos('target');
  await page.touchscreen.tap(p2.x, p2.y);
  await waitFor(() => window.__xkc.game.moves.length >= 1, null, 5000);
  check(`${label}：手指點棋子、點落點走棋`, true);
  await waitFor(() => window.__xkc.game.moves.length >= 3 && document.querySelector('#turnBanner').textContent === '輪到您下棋', null, 30000);

  // 抽屜：走法、軍師
  await page.tap('.tab[data-tab="moves"]');
  await page.waitForTimeout(400);
  check(`${label}：點「走法」打開抽屜`, await page.evaluate(() => document.body.classList.contains('sheet-open') && document.querySelectorAll('#moveList .mv-row').length >= 3));
  await shot('3-moves.png');
  await page.tap('.tab[data-tab="advisor"]');
  await page.tap('.adv-quick button');
  await waitFor(() => [...document.querySelectorAll('.adv-msg.ai')].some((e) => e.textContent.includes('建議把')), null, 20000);
  check(`${label}：軍師給出建議`, true);
  await shot('4-advisor.png');
  await page.tap('.tab[data-tab="advisor"]');
  await page.waitForTimeout(400);
  check(`${label}：再點一次收起抽屜`, await page.evaluate(() => !document.body.classList.contains('sheet-open')));

  // 返回鍵（Android）
  const backed = await page.evaluate(() => window.__xkBack());
  await page.waitForTimeout(300);
  check(`${label}：返回鍵先問要不要離開對局`, backed && await page.evaluate(() => !!document.querySelector('.modal-back')));
  await page.evaluate(() => window.__xkBack());
  check(`${label}：再按返回鍵關掉對話框、留在對局`, await page.evaluate(() => !document.querySelector('.modal-back') && window.__xkc.screen === 'game'));
  return { page, ctx };
}

try {
  const a = await phone('Android', 412, 915, 'Mozilla/5.0 (Linux; Android 16; SM-S9380) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 XiaokeCheckersAndroid/1.2.0', ANDROID, 'm-a');
  const info = await a.page.evaluate(() => window.xk.sys.info());
  check('Android：平台與版本', info.platform === 'android' && info.version === '1.2.0', JSON.stringify(info));
  const saved = await a.page.evaluate(() => window.xk.games.export('t.txt', 'x'));
  check('Android：匯出棋譜存到「下載/小柯跳棋」', /小柯跳棋/.test(saved) && (await a.page.evaluate(() => window.__calls.join(' '))).includes('beginSave:t.txt'));
  const upd = await a.page.evaluate(() => window.xk.update.check());
  check('Android：檢查更新找到 APK', upd.flavor === 'android' && upd.canInstall && /android\.apk$/.test(upd.asset.url), JSON.stringify(upd));
  await a.ctx.close();
  const i = await phone('iPhone', 393, 852, 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', IOS, 'm-i');
  check('iPhone：平台是 iOS', (await i.page.evaluate(() => window.xk.sys.info())).platform === 'ios');
  await i.ctx.close();
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
} finally {
  check('沒有網頁錯誤', errors.length === 0, errors.join(' | '));
  console.log(`\n結果：${pass} 通過，${fail} 失敗`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
}
