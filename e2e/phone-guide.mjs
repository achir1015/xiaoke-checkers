// 實機測試遊戲說明（Android 除錯版 APK）：手機原生語音真的念出來、動畫、用真的觸控作答
// 用法：python android/build.py debug install，手機解鎖後執行 node e2e/phone-guide.mjs [手機序號]
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ADB = process.env.ADB || 'E:/小米觸控音箱/tools/android-sdk/platform-tools/adb.exe';
const SERIAL = process.argv[2] || process.env.ANDROID_SERIAL || 'R5CY236CQ3B';
const outDir = 'e2e/out';
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const shotPhone = (name) => fs.writeFileSync(path.join(outDir, name), execFileSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

const focus = adb('shell', 'dumpsys', 'window');
if (/isKeyguardShowing=true/.test(focus)) { console.log('手機鎖著，請先解鎖'); process.exit(2); }
if (!(focus.match(/mCurrentFocus=[^\r\n]*/g) || []).some((f) => f.includes('com.achir.xiaokecheckers'))) { console.log('前景不是小柯跳棋'); process.exit(2); }
const sock = /@?(webview_devtools_remote_\d+)/.exec(adb('shell', 'cat', '/proc/net/unix'));
execFileSync(ADB, ['-s', SERIAL, 'forward', 'tcp:9334', 'localabstract:' + sock[1]]);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9334');
const page = browser.contexts()[0].pages().find((p) => p.url().includes('appassets'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const waitFor = async (fn, arg, ms = 30000) => {
  const t = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
    await new Promise((r) => setTimeout(r, 250));
  }
};

try {
  await page.reload();
  await waitFor(() => window.__xkc && document.querySelector('#btnGuide'));
  await page.evaluate(async () => { window.__xkc.settings = await window.xk.settings.set({ music: { autoplay: false } }); });
  await waitFor(() => window.xk.tts && window.xk.tts.available(), null, 15000);
  const voice = await page.evaluate(() => window.xk.tts.voiceName());
  check('手機的文字轉語音可用', true);
  console.log('   語音：', voice);
  // 記錄每一句：念了多久（手機語音引擎念完才回報）
  await page.evaluate(() => {
    window.__spoke = [];
    const t = window.xk.tts, orig = t.speak.bind(t);
    t.speak = (text, rate) => { const t0 = Date.now(); return orig(text, rate).then(() => { window.__spoke.push({ text, ms: Date.now() - t0, fallback: 3000 + String(text).length * 450 }); }); };
  });
  await page.evaluate(() => document.querySelector('#btnGuide').click());
  await waitFor(() => window.__spoke.length >= 2, null, 60000);
  const sp = await page.evaluate(() => window.__spoke.slice(0, 2));
  console.log('   ', sp.map((s) => `${(s.ms / 1000).toFixed(1)} 秒：${s.text.slice(0, 18)}…`).join(' ／ '));
  check('第一句由手機語音引擎念完（比備用計時早結束）', sp[0].ms > 1500 && sp[0].ms < sp[0].fallback - 1500, JSON.stringify(sp[0]));
  check('念的是遊戲說明', sp[0].text.includes('歡迎來到中國跳棋'));
  shotPhone('pg1-intro.png');
  // 等到第 2 課的練習，用真的觸控點答案（走一步）
  await waitFor(() => window.__guide.lesson === 1 && window.__guide.practice, null, 120000);
  const p = await page.evaluate(() => {
    const b = window.__guide.board;
    const from = [...b.pieces.keys()][0];
    const [fx, fy] = b.xy(from);
    let near = -1;
    for (let c = 0; c < 121; c++) { if (c === from) continue; const [x, y] = b.xy(c); if (Math.hypot(x - fx, y - fy) < 40) { near = c; break; } }
    const [x, y] = b.xy(near); const pt = b.svg.createSVGPoint(); pt.x = x; pt.y = y; const s = pt.matrixTransform(b.svg.getScreenCTM());
    const top = (screen.height - innerHeight) * devicePixelRatio;
    return { x: s.x * devicePixelRatio, y: top + s.y * devicePixelRatio };
  });
  shotPhone('pg2-practice.png');
  adb('shell', 'input', 'tap', String(Math.round(p.x)), String(Math.round(p.y)));
  await waitFor(() => window.__spoke.some((s) => s.text === '答對了！做得好。'), null, 20000);
  check('用手指點練習答案，手機念「答對了」', true);
  // 跳到連續跳看動畫
  await page.evaluate(() => document.querySelectorAll('.gd-item')[4].click());
  await waitFor(() => window.__spoke.some((s) => s.text.includes('一口氣連跳了三次')), null, 60000);
  shotPhone('pg3-chain.png');
  check('連跳動畫與解說', true);
  // 返回鍵：停止並回首頁
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await waitFor(() => document.querySelector('#scr-home').classList.contains('on'), null, 5000);
  const n = await page.evaluate(() => window.__spoke.length);
  await new Promise((r) => setTimeout(r, 4000));
  check('返回鍵回首頁、停止念說明', (await page.evaluate(() => window.__spoke.length)) <= n + 1);
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  try { shotPhone('pg-fail.png'); } catch {}
} finally {
  check('沒有網頁錯誤', errors.length === 0, errors.join(' | '));
  console.log(`\n結果：${pass} 通過，${fail} 失敗`);
  await browser.close().catch(() => {});
  process.exit(fail ? 1 : 0);
}
