// 遊戲說明端對端測試（電腦版）：語音念了什麼、動畫、練習題、自動接下一課、離開時停止
// 語音引擎被換成「立刻說完」的版本並記錄每一句，測試才不用真的等它念完；另外檢查電腦上真的有中文語音
// 用法：node e2e/guide.mjs [截圖資料夾]
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
fs.rmSync(path.join(appData, 'xiaoke-checkers-e2eGuide'), { recursive: true, force: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=e2eGuide'] });
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

try {
  await win.waitForSelector('#btnGuide', { timeout: 30000 });
  await win.evaluate(async () => { window.__xkc.settings = await window.xk.settings.set({ music: { autoplay: false } }); });
  // 真的語音（Windows 的中文語音）
  await waitFor(() => speechSynthesis.getVoices().length > 0, null, 10000).catch(() => {});
  const voices = await win.evaluate(() => speechSynthesis.getVoices().filter((v) => /^zh/i.test(v.lang)).map((v) => v.name));
  check('電腦上有中文語音', voices.length > 0, voices.join(', '));
  console.log('   中文語音：', voices.join('、'));
  // 換成立刻說完的語音，記錄念了哪些句子
  await win.evaluate(() => {
    window.__said = [];
    const real = speechSynthesis.speak.bind(speechSynthesis);
    window.__realSpeak = real;
    speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 60); };
  });

  await win.click('#btnGuide');
  await waitFor(() => document.querySelector('#scr-guide').classList.contains('on'));
  check('首頁按「遊戲說明」進入說明畫面', true);
  check('左邊列出 10 課', (await win.locator('.gd-item').count()) === 10);
  check('語音按鈕顯示開、用台灣中文語音', await win.evaluate(() => document.querySelector('#gdVoice').textContent.includes('開') && /Yating|Hanhan|Zhiwei|zh/i.test(window.__guide.narr.voiceName + window.__guide.narr.voice?.lang)), await win.evaluate(() => window.__guide.narr.voiceName));
  await waitFor(() => window.__said.length >= 1);
  check('一進來就自動語音講解', (await win.evaluate(() => window.__said[0])).includes('歡迎來到中國跳棋'));
  check('畫面上有動畫小棋盤（121 孔）', await win.evaluate(() => document.querySelectorAll('#gdSvg .gb-holes circle').length === 121));
  await win.waitForTimeout(1200);
  await win.screenshot({ path: path.join(outDir, 'g1-intro.png') });

  // 第 1 課講完自動接第 2 課（走一步），第 2 課有練習
  await waitFor(() => window.__guide.lesson === 1 && window.__guide.practice, null, 30000);
  check('講完自動接下一課', true);
  check('第 2 課示範走一步的動畫（棋子移動）', await win.evaluate(() => window.__said.some((s) => s.includes('每次走一格'))));
  // 練習：先點錯（太遠），再點對
  const ans = await win.evaluate(() => {
    const g = window.__guide;
    const b = g.board;
    // 找一個太遠的孔與一個相鄰的孔
    const from = [...b.pieces.keys()][0];
    const [fx, fy] = b.xy(from);
    let far = -1, near = -1;
    for (let c = 0; c < 121; c++) { if (c === from) continue; const [x, y] = b.xy(c); const d = Math.hypot(x - fx, y - fy); if (d > 100 && far < 0) far = c; if (d < 40 && near < 0) near = c; }
    return { from, far, near };
  });
  await win.evaluate((c) => window.__guide.onBoardClick(c), ans.far);
  await win.waitForTimeout(300);
  check('練習點錯會說明原因', await win.evaluate(() => document.querySelector('#gdCaption').textContent.startsWith('✕')), await win.evaluate(() => document.querySelector('#gdCaption').textContent));
  // 用真的滑鼠點棋盤上的孔
  const pt = await win.evaluate((c) => { const b = window.__guide.board; const [x, y] = b.xy(c); const p = b.svg.createSVGPoint(); p.x = x; p.y = y; const s = p.matrixTransform(b.svg.getScreenCTM()); return { x: s.x, y: s.y }; }, ans.near);
  await win.mouse.click(pt.x, pt.y);
  await waitFor(() => window.__said.includes('答對了！做得好。'), null, 8000);
  check('用滑鼠點對了說「答對了」', true);

  // 跳到「連續跳」：示範連跳三次的動畫
  await win.click('.gd-item:nth-child(5)');
  await waitFor(() => window.__said.some((s) => s.includes('一口氣連跳了三次')), null, 20000);
  await win.waitForTimeout(700);
  const jumped = await waitFor(() => { const b = window.__guide.board; return [...b.pieces.entries()].some(([c, p]) => p.seat === 0 && b.xy(c)[1] < b.cy - 70); }, null, 8000).catch(() => false);
  check('連跳動畫：紅色棋子跳到上方終點', jumped);
  await win.screenshot({ path: path.join(outDir, 'g2-chain.png') });
  // 練習：連跳最遠
  await waitFor(() => window.__guide.practice, null, 20000);
  await win.click('#gdAnswer');
  check('「看答案」標出答案', await win.evaluate(() => document.querySelectorAll('#gdSvg .gk-jump, #gdSvg .gk-ok').length === 1));
  await win.screenshot({ path: path.join(outDir, 'g3-answer.png') });

  // 擋住的說明：畫出 ✕ 並說明原因
  await win.click('.gd-item:nth-child(4)');
  await waitFor(() => document.querySelectorAll('#gdSvg .gk-bad').length > 0, null, 10000);
  check('「擋住了」畫出 ✕ 並說明原因', await win.evaluate(() => /兩顆/.test(document.querySelector('#gdCaption').textContent)));
  await win.screenshot({ path: path.join(outDir, 'g4-blocked.png') });

  // 怎樣算贏：勝利動畫
  await win.click('.gd-item:nth-child(7)');
  await waitFor(() => window.__said.some((s) => s.includes('紅方獲勝')), null, 20000);
  check('勝利示範', true);

  // 暫停／繼續
  await win.click('#gdPlay');
  const n0 = await win.evaluate(() => window.__said.length);
  await win.waitForTimeout(1500);
  check('暫停後不再往下講', (await win.evaluate(() => window.__said.length)) === n0);
  await win.click('#gdPlay');
  await waitFor((n) => window.__said.length > n, n0, 15000);
  check('繼續後接著講', true);

  // 語音關閉
  await win.click('#gdVoice');
  check('可以關掉語音', await win.evaluate(() => document.querySelector('#gdVoice').textContent.includes('關')));
  await win.click('#gdVoice');

  // 最後一課的解說念到「祝您玩得開心」
  await win.click('.gd-item:nth-child(10)');
  await waitFor(() => window.__said.some((s) => s.includes('祝您玩得開心')), null, 40000);
  check('最後一課講到三種模式', await win.evaluate(() => window.__said.some((s) => s.includes('遠端對賽')) && window.__said.some((s) => s.includes('AI 與 AI'))));
  await win.screenshot({ path: path.join(outDir, 'g5-modes.png') });

  // 離開：停止解說
  await win.click('#gdBack');
  await waitFor(() => document.querySelector('#scr-home').classList.contains('on'));
  const n1 = await win.evaluate(() => window.__said.length);
  await win.waitForTimeout(2000);
  check('回首頁後停止解說', (await win.evaluate(() => window.__said.length)) === n1);

  // 全部 10 課的句子都念得出來（沒有空白）
  check('念的句子都有內容', await win.evaluate(() => window.__said.every((s) => s && s.length > 3)));
  console.log(`   共念了 ${await win.evaluate(() => window.__said.length)} 句`);
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  await win.screenshot({ path: path.join(outDir, 'g-fail.png') }).catch(() => {});
}
const errs = errors.filter((e) => !/favicon|Autofill/.test(e));
check('沒有主控台錯誤', errs.length === 0, errs.join('\n'));
console.log(`\n通過 ${pass}，失敗 ${fail}`);
await app.close();
process.exit(fail ? 1 : 0);
