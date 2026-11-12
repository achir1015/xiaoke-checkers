// App Store 截圖：用 Chrome 開 mobile/www，模擬 App Store 版的 iPhone／iPad／Mac 外殼
// 用法：node scripts/build-mobile.mjs && node e2e/shots-store.mjs [輸出資料夾]
// 尺寸：iPhone 6.3 吋 1206×2622（直）、iPad 13 吋 2752×2064（橫）、Mac 2880×1800
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const outRoot = process.argv[2] || 'e2e/out/store';
const WWW = path.resolve('mobile/www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.png': 'image/png' };
const PORT = 8837;
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT);

const DEVICES = {
  iphone: { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, shim: { store: true },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' },
  ipad: { viewport: { width: 1376, height: 1032 }, deviceScaleFactor: 2, hasTouch: true, shim: { store: true },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' },
  mac: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, shim: { store: true, mac: true },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' },
};

const browser = await chromium.launch({ channel: 'chrome' });
let fail = 0;
for (const [name, dev] of Object.entries(DEVICES)) {
  const dir = path.join(outRoot, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const { shim, ...opts } = dev;
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript((sh) => {
    window.XiaokeIOS = sh;
    window.webkit = { messageHandlers: { xkj: { postMessage: () => Promise.resolve({ status: 'ok' }) } } };
    // 截圖不念說明（無頭瀏覽器沒有語音）
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    const fake = { name: 'Mei-Jia', lang: 'zh-TW', localService: true, default: true, voiceURI: 'Mei-Jia' };
    Object.defineProperty(speechSynthesis, 'getVoices', { value: () => [fake] });
    speechSynthesis.speak = (u) => { setTimeout(() => u.onend && u.onend(), 9000); };
    speechSynthesis.cancel = () => {};
  }, shim);
  const page = await ctx.newPage();
  const waitFor = async (fn, arg, ms = 40000) => {
    const t = Date.now();
    for (;;) {
      const v = await page.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error(name + ' 等待逾時：' + fn);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  let n = 0;
  const shot = async (label) => { n++; await page.screenshot({ path: path.join(dir, `${String(n).padStart(2, '0')}-${label}.png`) }); };
  const myTurn = () => waitFor(() => document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkc.animating && !window.__xkc.aiThinking, null, 60000);
  // 走一步：挑前進最多（同分時挑跳得最遠）的走法
  const playBest = () => page.evaluate(() => {
    const S = window.__xkc, g = S.game, b = window.__xkcBoard;
    let best = null, bs = -99;
    for (const m of g.legalMoves()) { const d = g.prog[0][m & 127] - g.prog[0][m >> 7]; if (d > bs) { bs = d; best = m; } }
    b.onCellClick(best >> 7); b.onCellClick(best & 127);
  });
  const home = async () => {
    await page.evaluate(() => document.querySelector('#btnHome').click());
    await page.waitForTimeout(500);
    await page.evaluate(() => { const b = document.querySelector('.modal-btns .primary'); if (b) b.click(); });
    await waitFor(() => document.querySelector('#scr-home').classList.contains('on'));
  };
  try {
    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.waitForSelector('#startAI', { timeout: 30000 });
    await page.evaluate(async (view) => { window.__xkc.settings = await window.xk.settings.set({ playerName: '小柯', music: { autoplay: false }, level: 2, view }); }, name === 'iphone' ? 'top' : 'tilt');
    await page.reload();
    await page.waitForSelector('#startAI', { timeout: 30000 });
    await page.waitForTimeout(800);
    // 1. 首頁
    await shot('home');
    // 2. 三人對 AI（中局，選起一顆棋子顯示可以跳的位置）
    await page.evaluate(() => { document.querySelector('.mode-card:nth-child(1) .segbtn[data-v="3"]').click(); document.querySelector('#startAI').click(); });
    await myTurn();
    for (let k = 0; k < 7; k++) { await playBest(); await page.waitForTimeout(300); await myTurn(); }
    await page.evaluate(() => {
      const S = window.__xkc, g = S.game, b = window.__xkcBoard;
      // 選一顆能連跳最多次的棋子
      let pick = -1, most = 0;
      for (const c of g.piecesOf(0)) { const n = g.legalMoves().filter((m) => (m >> 7) === c).length; if (n > most) { most = n; pick = c; } }
      b.onCellClick(pick);
    });
    await page.waitForTimeout(900);
    await shot('game-3p');
    // 3. 軍師
    await page.evaluate(() => { window.__xkcBoard.onCellClick(-1); });
    await page.evaluate(() => { const t = document.querySelector('.tab[data-tab="advisor"]'); t.click(); });
    await page.evaluate(() => document.querySelector('.adv-quick button').click());
    await waitFor(() => [...document.querySelectorAll('.adv-msg.ai')].some((e) => e.textContent.includes('建議把')));
    await page.waitForTimeout(1500);
    await shot('advisor');
    if (name === 'iphone') await page.evaluate(() => document.body.classList.remove('sheet-open'));
    // 4. 遊戲說明：連續跳
    await home();
    await page.evaluate(() => document.querySelector('#btnGuide').click());
    await waitFor(() => document.querySelector('#scr-guide').classList.contains('on'));
    await page.evaluate(() => document.querySelectorAll('.gd-item')[4].click());
    await waitFor(() => document.querySelector('#gdCaption').textContent.includes('連跳了三次'), null, 30000);
    // 等連跳動畫跑完（紅色棋子到最上面），立刻暫停，讓跳躍路線留在畫面上
    await waitFor(() => { const g = window.__guide, b = g.board; return [...b.pieces.entries()].some(([c, p]) => p.seat === 0 && b.xy(c)[1] < b.cy - 70) && !b.svg.querySelector('.gm.lift'); }, null, 15000);
    await page.evaluate(() => { const g = window.__guide; g.paused = true; });
    await page.waitForTimeout(400);
    await shot('guide-chain');
    await page.evaluate(() => { const g = window.__guide; g.paused = false; if (g.resumeGate) g.resumeGate(); });
    // 5. 遊戲說明：兩人與三人
    await page.evaluate(() => document.querySelectorAll('.gd-item')[5].click());
    await waitFor(() => document.querySelector('#gdCaption').textContent.includes('三個人下的時候'), null, 30000);
    await page.waitForTimeout(800);
    await shot('guide-3p');
    // 6. AI 與 AI 對賽（三人）
    await page.evaluate(() => document.querySelector('#gdBack').click());
    await waitFor(() => document.querySelector('#scr-home').classList.contains('on'));
    await page.evaluate(() => { document.querySelector('.mode-card:nth-child(3) .segbtn[data-v="3"]').click(); document.querySelector('.mode-card:nth-child(3) .segbtn[data-v="fast"]').click(); document.querySelector('#startAivai').click(); });
    await waitFor(() => window.__xkc.mode === 'aivai' && window.__xkc.game.moves.length >= 30, null, 120000);
    await page.evaluate(() => document.querySelector('#btnPause').click());
    await waitFor(() => !window.__xkc.animating && !window.__xkc.aiThinking);
    await page.waitForTimeout(800);
    await shot('aivai');
    console.log(`✔ ${name}：${n} 張 → ${dir}`);
  } catch (e) {
    fail++;
    console.log(`✘ ${name}：`, e.message);
    await page.screenshot({ path: path.join(dir, 'fail.png') }).catch(() => {});
  }
  await ctx.close();
}
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
