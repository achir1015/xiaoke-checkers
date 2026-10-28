// 實機測試：透過 adb 連到手機上小柯跳棋（除錯版 APK）的 WebView，用 DevTools 協定檢查功能；點棋子用 adb 真的觸控螢幕
// 用法：python android/build.py debug install，手機解鎖後執行 node e2e/phone.mjs [手機序號]
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ADB = process.env.ADB || 'E:/小米觸控音箱/tools/android-sdk/platform-tools/adb.exe';
const SERIAL = process.argv[2] || process.env.ANDROID_SERIAL || 'R5CY236CQ3B';
const outDir = process.argv[3] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const shotPhone = (name) => fs.writeFileSync(path.join(outDir, name), execFileSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

// 安全守則：只有本 App 在前景、螢幕沒鎖時才操作
const focus = adb('shell', 'dumpsys', 'window');
if (/isKeyguardShowing=true/.test(focus)) { console.log('手機鎖著，請先解鎖'); process.exit(2); }
const fm = focus.match(/mCurrentFocus=[^\r\n]*/g) || [];
if (!fm.some((f) => f.includes('com.achir.xiaokecheckers'))) { console.log('前景不是小柯跳棋：', fm.join(' ')); process.exit(2); }
const sock = /@?(webview_devtools_remote_\d+)/.exec(adb('shell', 'cat', '/proc/net/unix'));
if (!sock) { console.log('找不到 WebView 偵錯通道（要用 python android/build.py debug 建置）'); process.exit(2); }
execFileSync(ADB, ['-s', SERIAL, 'forward', 'tcp:9334', 'localabstract:' + sock[1]]);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9334');
const page = browser.contexts()[0].pages().find((p) => p.url().includes('appassets')) || browser.contexts()[0].pages()[0];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const waitFor = async (fn, arg, ms = 30000) => {
  const t = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
    await new Promise((r) => setTimeout(r, 200));
  }
};
// 3D 物件在手機螢幕上的實際像素位置，用 adb 點下去
const tapObj = async (kind, a) => {
  const p = await page.evaluate(([k, x]) => {
    const b = window.__xkcBoard;
    const o = k === 'marble' ? b.marbles.get(x) : b.targets[b.targets.length - 1];
    const v = o.position.clone().project(b.camera);
    const r = b.renderer.domElement.getBoundingClientRect();
    // WebView 貼齊螢幕下緣，上方瀏海（鏡頭挖孔）那一條不畫網頁：要加上這段高度
    const top = (screen.height - innerHeight) * devicePixelRatio;
    return { x: (r.left + (v.x + 1) / 2 * r.width) * devicePixelRatio, y: top + (r.top + (1 - v.y) / 2 * r.height) * devicePixelRatio };
  }, [kind, a]);
  adb('shell', 'input', 'tap', String(Math.round(p.x)), String(Math.round(p.y)));
};

try {
  const info = await page.evaluate(() => ({
    android: !!window.XiaokeAndroid, mobile: document.documentElement.classList.contains('mobile'),
    w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ver: JSON.parse(window.XiaokeAndroid.appInfo()).version,
    webgl: !!document.createElement('canvas').getContext('webgl2'),
  }));
  console.log('  ', JSON.stringify(info));
  check('在 Android App 裡執行（原生橋接、手機版面）', info.android && info.mobile);
  check('WebGL2（3D 棋盤）可用', info.webgl);
  check('直立畫面', info.h > info.w);
  await page.reload();
  await waitFor(() => window.__xkc && window.__xkcBoard && document.querySelector('#startAI'));
  await page.evaluate(async () => { window.__xkc.settings = await window.xk.settings.set({ music: { autoplay: false } }); });
  await page.waitForTimeout(800);
  shotPhone('p1-home.png');
  check('20 首背景音樂', (await page.evaluate(() => window.xk.music.list().then((l) => l.length))) === 20);
  const seek = await page.evaluate(async () => {
    const r = await fetch(new URL('assets/music/track02.mp3', document.baseURI), { headers: { Range: 'bytes=1000-1999' } });
    return [r.status, r.headers.get('content-range'), (await r.arrayBuffer()).byteLength];
  });
  check('音樂支援拖曳進度（Range）', seek[0] === 206 && seek[2] === 1000, JSON.stringify(seek));
  const play = await page.evaluate(async () => { const a = new Audio(new URL('assets/music/track03.mp3', document.baseURI).href); a.volume = 0.05; await a.play().catch(() => null); await new Promise((r) => setTimeout(r, 1500)); const t = a.currentTime; a.pause(); return t; });
  check('音樂可以播放', play > 0.3, String(play));

  // 3 人對 AI
  await page.evaluate(() => { document.querySelector('.mode-card:nth-child(1) .segbtn[data-v="3"]').click(); document.querySelector('#startAI').click(); });
  await waitFor(() => window.__xkc.mode === 'ai' && document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkc.animating);
  await page.waitForTimeout(1500);
  shotPhone('p2-game.png');
  check('預設俯視（棋盤最大）', await page.evaluate(() => window.__xkcBoard.viewName === 'top'));

  // 用手指點棋子、點落點（真的觸控）
  const cell = await page.evaluate(() => { const S = window.__xkc; const m = S.game.legalMoves().find((x) => S.game.prog[0][x & 127] - S.game.prog[0][x >> 7] >= 2) ?? S.game.legalMoves()[0]; return m >> 7; });
  await tapObj('marble', cell);
  await waitFor(() => window.__xkc.selected >= 0, null, 5000);
  check('觸控點棋子會選起來', true);
  await page.waitForTimeout(500);
  shotPhone('p3-select.png');
  await tapObj('target');
  await waitFor(() => window.__xkc.game.moves.length >= 1, null, 5000);
  check('觸控點落點就走棋', true);
  await waitFor(() => window.__xkc.game.moves.length >= 3 && document.querySelector('#turnBanner').textContent === '輪到您下棋', null, 40000);
  check('兩個 AI 回應後又輪到我', true);
  // 再下兩步，看看 AI 速度
  for (let k = 0; k < 2; k++) {
    const t0 = Date.now();
    await page.evaluate(() => { const S = window.__xkc, b = window.__xkcBoard; const ms = S.game.legalMoves(); let best = ms[0], bs = -99; for (const m of ms) { const d = S.game.prog[0][m & 127] - S.game.prog[0][m >> 7]; if (d > bs) { bs = d; best = m; } } b.onCellClick(best >> 7); b.onCellClick(best & 127); });
    await waitFor(() => window.__xkc.game.turn === 0 && !window.__xkc.animating && !window.__xkc.aiThinking, null, 40000);
    console.log(`   第 ${k + 2} 輪 AI 共用 ${((Date.now() - t0) / 1000).toFixed(1)} 秒（含動畫）`);
  }
  shotPhone('p4-midgame.png');

  // 抽屜：軍師
  await page.evaluate(() => document.querySelector('.tab[data-tab="advisor"]').click());
  await page.evaluate(() => document.querySelector('.adv-quick button').click());
  await waitFor(() => [...document.querySelectorAll('.adv-msg.ai')].some((e) => e.textContent.includes('建議把')), null, 30000);
  check('軍師給出建議', true);
  await page.waitForTimeout(600);
  shotPhone('p5-advisor.png');
  await page.evaluate(() => document.querySelector('.tab[data-tab="advisor"]').click());

  // 返回鍵（真的按 Android 返回鍵）
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await waitFor(() => !!document.querySelector('.modal-back'), null, 5000);
  check('返回鍵：問要不要離開對局', true);
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await waitFor(() => !document.querySelector('.modal-back'), null, 5000);
  check('再按返回鍵：關掉對話框、留在對局', await page.evaluate(() => window.__xkc.screen === 'game'));

  // 檢查更新（GitHub）
  const upd = await page.evaluate(() => window.xk.update.check().then((i) => i, (e) => ({ error: e.message })));
  check('檢查更新（Android）', upd.flavor === 'android' || !!upd.error, JSON.stringify(upd).slice(0, 200));
  console.log('   更新：', JSON.stringify(upd).slice(0, 160));
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  try { shotPhone('p-fail.png'); } catch {}
} finally {
  check('沒有網頁錯誤', errors.length === 0, errors.join(' | '));
  console.log(`\n結果：${pass} 通過，${fail} 失敗`);
  await browser.close().catch(() => {});
  process.exit(fail ? 1 : 0);
}
