'use strict';
// 版本更新：查詢 GitHub 最新 Release，下載對應平台的安裝檔並安裝
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const REPO = 'achir1015/xiaoke-checkers';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

// 比較版本：a > b 回傳正數
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// 目前執行的是哪一種版本
function flavor() {
  if (!app.isPackaged) return 'dev';
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'nsis';
  if (process.platform === 'darwin') return 'mac';
  return 'other';
}

function pickAsset(assets) {
  const f = flavor();
  const find = (re) => assets.find((a) => re.test(a.name));
  if (f === 'portable') return find(/win-x64-portable\.exe$/i);
  if (f === 'nsis' || (f === 'dev' && process.platform === 'win32')) return find(/win-x64\.exe$/i);
  if (process.platform === 'darwin') return find(new RegExp(`mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}\\.dmg$`, 'i'));
  return null;
}

class Updater {
  constructor() { this.info = null; this.downloading = null; }

  // GitHub API 每個網路每小時只能查 60 次；被限制時改從「最新版」網頁的轉址取得版本號
  async latestRelease() {
    try {
      const res = await fetch(API, { headers: { 'User-Agent': 'xiaoke-checkers-updater', Accept: 'application/vnd.github+json' } });
      if (res.ok) return await res.json();
      if (res.status === 404) throw new Error('還沒有發佈任何版本');
    } catch (e) {
      if (/還沒有發佈/.test(e.message)) throw e;
    }
    const page = await fetch(`https://github.com/${REPO}/releases/latest`, { method: 'HEAD', headers: { 'User-Agent': 'xiaoke-checkers-updater' } });
    const m = /\/releases\/tag\/(v?[\d.]+)/.exec(page.url || '');
    if (!m) throw new Error(`查詢失敗（${page.status}）`);
    const tag = m[1], ver = tag.replace(/^v/, '');
    const dl = (n) => ({ name: n, browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${n}`, size: 0 });
    return {
      tag_name: tag,
      html_url: page.url,
      body: '',
      assets: [
        dl(`XiaokeCheckers-${ver}-win-x64.exe`), dl(`XiaokeCheckers-${ver}-win-x64-portable.exe`),
        dl(`XiaokeCheckers-${ver}-mac-arm64.dmg`), dl(`XiaokeCheckers-${ver}-mac-x64.dmg`),
      ],
    };
  }

  async check() {
    const r = await this.latestRelease();
    const latest = String(r.tag_name || '').replace(/^v/, '');
    const current = app.getVersion();
    const asset = pickAsset(r.assets || []);
    this.info = {
      current,
      latest,
      newer: cmpVer(latest, current) > 0,
      notes: String(r.body || '').slice(0, 4000),
      page: r.html_url,
      asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
      flavor: flavor(),
      canInstall: app.isPackaged && !!asset,
    };
    return this.info;
  }

  // 下載安裝檔（含進度）；回傳檔案路徑
  async download(onProgress) {
    if (!this.info || !this.info.asset) throw new Error('找不到這個平台的安裝檔');
    if (this.downloading) return this.downloading;
    const { url, name, size } = this.info.asset;
    const dir = path.join(os.tmpdir(), 'xiaoke-checkers-update');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    this.downloading = (async () => {
      const res = await fetch(url, { headers: { 'User-Agent': 'xiaoke-checkers-updater' } });
      if (!res.ok || !res.body) throw new Error(`下載失敗（${res.status}）`);
      const total = Number(res.headers.get('content-length')) || size || 0;
      const tmp = file + '.part';
      const out = fs.createWriteStream(tmp);
      let got = 0, last = 0;
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
          if (Date.now() - last > 200) { last = Date.now(); onProgress && onProgress(got, total); }
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
      if (total && got < total) throw new Error('下載不完整，請再試一次');
      fs.renameSync(tmp, file);
      onProgress && onProgress(got, total);
      return file;
    })();
    try { return await this.downloading; } finally { this.downloading = null; }
  }

  // 安裝：Windows 安裝版靜默安裝後自動重新開啟；免安裝版放到原資料夾並開啟新版；Mac 打開 dmg
  async install(file) {
    const f = flavor();
    if (f === 'nsis') {
      const child = spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' });
      child.unref();
      setTimeout(() => app.quit(), 400);
      return { quitting: true };
    }
    if (f === 'portable') {
      const target = path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE), path.basename(file));
      fs.copyFileSync(file, target);
      const child = spawn(target, [], { detached: true, stdio: 'ignore' });
      child.unref();
      setTimeout(() => app.quit(), 400);
      return { quitting: true, path: target };
    }
    if (f === 'mac') {
      const target = path.join(app.getPath('downloads'), path.basename(file));
      fs.copyFileSync(file, target);
      await shell.openPath(target);
      return { manual: true, path: target };
    }
    shell.showItemInFolder(file);
    return { manual: true, path: file };
  }
}

module.exports = { Updater, cmpVer };
