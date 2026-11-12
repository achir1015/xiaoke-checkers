// 遊戲說明在 iPad（橫放）、Android 手機、iPhone（直立）的版面與語音測試（Chrome 模擬）
// Android 模擬原生語音橋（ttsSpeak），iPhone／iPad 用網頁語音（攔截記錄）
// 用法：node scripts/build-mobile.mjs && node e2e/guide-mobile.mjs [截圖資料夾]
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const WWW = path.resolve('mobile/www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.png': 'image/png' };
const PORT = 8835;
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT);

const ANDROID = () => {
  window.__said = [];
  window.XiaokeAndroid = {
    appInfo: () => JSON.stringify({ status: 'ok', version: '1.3.0' }),
    ttsAvailable: () => true,
    ttsVoice: () => 'cmn-tw-x-ctc-local（zh-TW）',
    ttsSpeak: (text, rate, id) => { window.__said.push(text); setTimeout(() => window.__xkTtsDone(id), 60); },
    ttsStop: () => {},
    checkUpdate: () => JSON.stringify({ status: 'ok', current: '1.3.0', latest: '1.3.0', url: '', page: '' }),
    openUrl: () => true,
  };
};
const IOSVOICE = () => {
  window.__said = [];
  window.XiaokeIOS = true;
  window.webkit = { messageHandlers: { xkj: { postMessage: () => Promise.resolve({ status: 'ok' }) } } };
  const fake = { name: 'Mei-Jia', lang: 'zh-TW', localService: true, default: true, voiceURI: 'Mei-Jia' };
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  Object.defineProperty(speechSynthesis, 'getVoices', { value: () => [fake] });
  speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 60); };
  speechSynthesis.cancel = () => {};
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];

async function run(label, opts, init, shotName) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/404|403/.test(m.text())) errors.push(label + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(label + ' [pageerror] ' + e.message));
  const waitFor = async (fn, arg, ms = 30000) => {
    const t = Date.now();
    for (;;) {
      const v = await page.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error(label + ' 等待逾時：' + fn);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForSelector('#btnGuide', { timeout: 30000 });
  await page.evaluate(async () => { window.__xkc.settings = await window.xk.settings.set({ music: { autoplay: false } }); });
  await page.tap('#btnGuide');
  await waitFor(() => document.querySelector('#scr-guide').classList.contains('on') && window.__said.length > 0);
  check(`${label}：一進來就語音講解`, (await page.evaluate(() => window.__said[0])).includes('歡迎'));
  check(`${label}：語音可用`, await page.evaluate(() => !document.querySelector('#gdVoice').disabled && document.querySelector('#gdVoice').textContent.includes('開')), await page.evaluate(() => document.querySelector('#gdVoice').textContent));
  const W = opts.viewport.width, H = opts.viewport.height;
  const f = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  check(`${label}：說明畫面不用捲動`, f[0] <= W && f[1] <= H, String(f));
  const bb = await page.evaluate(() => { const r = document.querySelector('#gdSvg').getBoundingClientRect(); return { w: r.width, h: r.height, t: r.top, b: r.bottom }; });
  check(`${label}：動畫棋盤夠大`, bb.w >= Math.min(W, H) * 0.55, JSON.stringify(bb));
  const cap = await page.evaluate(() => { const r = document.querySelector('#gdCaption').getBoundingClientRect(); return { t: r.top, b: r.bottom, h: r.height }; });
  check(`${label}：解說文字看得到`, cap.h > 40 && cap.b <= H, JSON.stringify(cap));
  await waitFor(() => window.__guide.lesson === 1 && window.__guide.practice, null, 30000);
  // 用手指點練習答案
  const pt = await page.evaluate(() => {
    const g = window.__guide, b = g.board;
    const from = [...b.pieces.keys()][0];
    const [fx, fy] = b.xy(from);
    let near = -1;
    for (let c = 0; c < 121; c++) { if (c === from) continue; const [x, y] = b.xy(c); if (Math.hypot(x - fx, y - fy) < 40) { near = c; break; } }
    const [x, y] = b.xy(near); const p = b.svg.createSVGPoint(); p.x = x; p.y = y; const s = p.matrixTransform(b.svg.getScreenCTM());
    return { x: s.x, y: s.y };
  });
  await page.touchscreen.tap(pt.x, pt.y);
  await waitFor(() => window.__said.includes('答對了！做得好。'), null, 8000);
  check(`${label}：用手指點練習答案`, true);
  await page.tap('.gd-item:nth-child(5)');
  await waitFor(() => window.__said.some((s) => s.includes('一口氣連跳了三次')), null, 20000);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(outDir, shotName) });
  if (label === 'Android') {
    const back = await page.evaluate(() => window.__xkBack());
    await page.waitForTimeout(300);
    check('Android：返回鍵離開說明、回首頁', back && await page.evaluate(() => document.querySelector('#scr-home').classList.contains('on')));
  }
  await ctx.close();
}

try {
  await run('iPad', { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' }, IOSVOICE, 'gm-ipad.png');
  await run('Android', { viewport: { width: 384, height: 798 }, deviceScaleFactor: 2.8, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S9380) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' }, ANDROID, 'gm-android.png');
  await run('iPhone', { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }, IOSVOICE, 'gm-iphone.png');
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
