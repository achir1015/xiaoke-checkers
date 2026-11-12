// App Store 版（iPhone、iPad、Mac 外殼）行為測試：Chrome 模擬 XiaokeIOS = { store, mac }
// 用法：node scripts/build-mobile.mjs && node e2e/store.mjs
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const WWW = path.resolve('mobile/www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.png': 'image/png' };
const PORT = 8836;
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT);

const DEVICES = {
  iPhone: { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, shim: { store: true }, layout: 'mobile',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' },
  iPad: { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, shim: { store: true }, layout: 'touch',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' },
  Mac: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, shim: { store: true, mac: true }, layout: 'mac',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' },
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
for (const [name, dev] of Object.entries(DEVICES)) {
  const { shim, layout, ...opts } = dev;
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript((sh) => {
    window.XiaokeIOS = sh;
    window.__opened = [];
    window.webkit = { messageHandlers: { xkj: { postMessage: (m) => { if (m.cmd === 'open_url') window.__opened.push(m.args[0]); return Promise.resolve({ status: 'ok' }); } } } };
  }, shim);
  const page = await ctx.newPage();
  const github = [];
  page.on('request', (r) => { if (/api\.github\.com|releases/.test(r.url())) github.push(r.url()); });
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' [pageerror] ' + e.message));
  const waitFor = async (fn, arg, ms = 20000) => {
    const t = Date.now();
    for (;;) {
      const v = await page.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error(name + ' 等待逾時：' + fn);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  try {
    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.waitForSelector('#startAI', { timeout: 30000 });
    await page.evaluate(async () => { window.__xkc.settings = await window.xk.settings.set({ music: { autoplay: false } }); });
    const cls = await page.evaluate(() => document.documentElement.className);
    check(`${name}：版面（${layout}）`, layout === 'mac' ? /\bmac\b/.test(cls) && !/\bmobile\b|\btouch\b/.test(cls) : new RegExp(`\\b${layout}\\b`).test(cls), cls);
    check(`${name}：App Store 版`, await page.evaluate(() => window.xk.store === true && document.documentElement.classList.contains('store')));
    check(`${name}：首頁按鈕是「關於」（沒有更新）`, (await page.evaluate(() => document.querySelector('#btnAbout').textContent)) === 'ℹ 關於');
    await page.evaluate(() => document.querySelector('#btnAbout').click());
    await waitFor(() => document.querySelector('.about'));
    check(`${name}：關於寫明由 App Store 更新、有支援與隱私連結`, await page.evaluate(() => /App Store/.test(document.querySelector('.upd-status').textContent) && /隱私權政策/.test(document.querySelector('.about').textContent) && !document.querySelector('.about input[type=checkbox]')));
    await page.evaluate(() => [...document.querySelectorAll('.about a')].find((a) => a.textContent.includes('技術支援')).click());
    check(`${name}：技術支援頁用外部瀏覽器開`, (await page.evaluate(() => window.__opened.join(' '))).includes('xiaoke-checkers/support.html'));
    await page.evaluate(() => document.querySelector('.modal-btns .primary').click());
    // 連線對戰須知
    await page.evaluate(() => document.querySelector('#btnHost').click());
    await waitFor(() => document.querySelector('.modal h3') && document.querySelector('.modal h3').textContent === '連線對戰須知');
    check(`${name}：第一次建立房間先顯示「連線對戰須知」`, /零容忍/.test(await page.evaluate(() => document.querySelector('.modal').textContent)));
    await page.evaluate(() => document.querySelector('.modal-btns button:not(.primary)').click());
    await page.waitForTimeout(500);
    check(`${name}：不同意就不建立房間`, await page.evaluate(() => !window.__xkc.room && !window.__xkc.settings.netTermsOK));
    // Claude 同意
    await page.evaluate(async () => { window.__xkc.settings = await window.xk.settings.set({ advisor: { apiKey: 'sk-ant-test-not-real' } }); });
    await page.reload();
    await page.waitForSelector('#startAI', { timeout: 30000 });
    await page.evaluate(() => document.querySelector('#startAI').click());
    await waitFor(() => window.__xkc.mode === 'ai');
    await page.evaluate(() => { const t = document.querySelector('.tab[data-tab="advisor"]'); t.click(); if (document.body.classList.contains('is-mobile') && !document.body.classList.contains('sheet-open')) t.click(); });
    await page.evaluate(() => { document.querySelectorAll('.adv-quick button')[0].click(); });
    const consent = await waitFor(() => document.querySelector('.modal h3') && document.querySelector('.modal h3').textContent === '使用 Claude AI 軍師', null, 20000).catch(() => false);
    // 軍師面板的 hasKey 由 setHasKey 控制：沒有提示時改用 setHasKey 再試一次
    if (!consent) {
      check(`${name}：送給 Claude 前先問同意`, false, '沒有出現同意視窗');
    } else {
      check(`${name}：送給 Claude 前先問同意`, /Anthropic/.test(await page.evaluate(() => document.querySelector('.modal').textContent)));
      await page.evaluate(() => document.querySelector('.modal-btns button:not(.primary)').click());
      await waitFor(() => [...document.querySelectorAll('.adv-msg.ai')].some((e) => e.textContent.includes('建議把')), null, 20000);
      check(`${name}：不同意就用本機 AI 回答`, await page.evaluate(() => window.__xkc.settings.claudeConsent === false));
    }
    await page.waitForTimeout(1500);
    check(`${name}：沒有連 GitHub 檢查更新`, github.length === 0, github.join(' '));
  } catch (e) {
    fail++;
    console.log(`✘ ${name} 例外：`, e.message);
  }
  await ctx.close();
}
check('沒有網頁錯誤', errors.length === 0, errors.join(' | '));
console.log(`\n結果：${pass} 通過，${fail} 失敗`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
