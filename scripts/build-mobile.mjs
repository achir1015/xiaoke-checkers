// 產生 iPad 版用的網頁：mobile/www
// 和桌面版同一份程式；把 node_modules 的函式庫複製到 vendor/、打包 Claude SDK、調整 index.html 路徑。
// 用法：node scripts/build-mobile.mjs
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'mobile', 'www');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true });

// 1. 網頁本體
copy('src/renderer', '.');
fs.rmSync(path.join(OUT, 'package.json'), { force: true });
// 2. 素材（音樂）
copy('assets/music', 'assets/music');
// 3. 函式庫
fs.copyFileSync(path.join(ROOT, 'node_modules/three/build/three.module.js'), path.join(OUT, 'vendor/three.module.js'));
fs.copyFileSync(path.join(ROOT, 'node_modules/peerjs/dist/peerjs.min.js'), path.join(OUT, 'vendor/peerjs.min.js'));
await build({ entryPoints: [path.join(ROOT, 'mobile/anthropic-entry.mjs')], bundle: true, format: 'esm', platform: 'browser', minify: true, outfile: path.join(OUT, 'vendor/anthropic.js'), logLevel: 'warning' });
// 4. 版本號
fs.writeFileSync(path.join(OUT, 'js/version.js'), `window.XKJ_VERSION = ${JSON.stringify(pkg.version)};\n`);
// 5. index.html：路徑改到 vendor/，重算 importmap 的 CSP 雜湊
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const sub = (a, b) => { if (!html.includes(a)) throw new Error('index.html 找不到：' + a); html = html.replace(a, b); };
sub('../../node_modules/three/build/three.module.js', './vendor/three.module.js');
sub('../../node_modules/peerjs/dist/peerjs.min.js', 'vendor/peerjs.min.js');
sub('<script src="js/xk-mobile.js"></script>', '<script src="js/version.js"></script>\n<script src="js/xk-mobile.js"></script>');
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">');
const im = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1];
const hash = crypto.createHash('sha256').update(im, 'utf8').digest('base64');
html = html.replace(/'sha256-[^']*'/, `'sha256-${hash}'`);
fs.writeFileSync(path.join(OUT, 'index.html'), html);

let n = 0, bytes = 0;
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else { n++; bytes += fs.statSync(p).size; } } })(OUT);
console.log(`iPad 版網頁 v${pkg.version}：${n} 個檔案、${(bytes / 1048576).toFixed(1)} MB → ${OUT}`);
