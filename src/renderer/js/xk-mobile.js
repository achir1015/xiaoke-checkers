// 手機／平板版（Android、iPhone、iPad）與網頁版的 window.xk：取代桌面版主程序提供的功能。
// 桌面版有 preload 提供 window.xk，這個檔案就什麼都不做。
// Android App 提供 window.XiaokeAndroid（存檔、檢查更新與安裝、開網址）；
// iPhone／iPad App 提供 window.XiaokeIOS＋webkit.messageHandlers.xkj（存檔分享、開網址、系統記錄）；在一般瀏覽器測試時改用網頁功能。
(function () {
  'use strict';
  if (window.xk) return;
  var A = window.XiaokeAndroid || null;
  var isAndroid = !!A;
  var isIOS = !!(window.XiaokeIOS && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.xkj);
  function ios(cmd, args) { return window.webkit.messageHandlers.xkj.postMessage({ cmd: cmd, args: args || [] }); }
  // 手機（Android、iPhone）直立版面：html.mobile；iPad 的 WebView 用電腦版 UA（Macintosh），走電腦版版面＋html.touch
  var ua = navigator.userAgent || '';
  var mobile = isAndroid || /Android|iPhone|Mobile/i.test(ua) || /[?&]mobile=1/.test(location.search);
  var touch = mobile || isIOS || navigator.maxTouchPoints > 1;
  if (mobile) document.documentElement.classList.add('mobile');
  else if (touch) document.documentElement.classList.add('touch');
  document.documentElement.classList.add(isAndroid ? 'android' : isIOS ? 'ios' : 'webapp');

  var REPO = 'achir1015/xiaoke-checkers';
  var IOS_INSTALL_PAGE = 'https://achir1015.github.io/xiaoke-checkers/ios/';
  function parse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function appVersion() {
    if (isAndroid) { var i = parse(A.appInfo()); if (i && i.version) return i.version; }
    return window.XKJ_VERSION || '0';
  }

  // ---------------- 設定（localStorage） ----------------
  var SKEY = 'xkj.settings';
  function defaults() {
    return {
      playerName: '棋友', level: 2, players: 2,
      server: { mode: 'public', host: '', port: 9000, path: '/', key: 'peerjs', secure: false },
      stun: 'stun:stun.l.google.com:19302\nstun:stun.cloudflare.com:3478',
      turn: { urls: '', username: '', credential: '' },
      music: { volume: 0.45, shuffle: false, autoplay: true, track: 0, enabled: true },
      sfx: true, view: mobile ? 'top' : 'tilt', autoUpdate: true,  // 手機直立時俯視棋盤最大
      advisor: { apiKey: '', model: 'claude-opus-5-5', effort: 'low' },
    };
  }
  function load() {
    var d = defaults(), raw = parse(localStorage.getItem(SKEY)) || {};
    return Object.assign({}, d, raw, {
      server: Object.assign({}, d.server, raw.server || {}), turn: Object.assign({}, d.turn, raw.turn || {}),
      music: Object.assign({}, d.music, raw.music || {}), advisor: Object.assign({}, d.advisor, raw.advisor || {}),
    });
  }
  var settings = load();
  function persist() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) { /* 空間不足 */ } }
  function pub() {
    var s = JSON.parse(JSON.stringify(settings));
    s.advisor = { model: settings.advisor.model, effort: settings.advisor.effort, hasKey: !!settings.advisor.apiKey, envKey: false };
    return s;
  }
  var KEYS = ['playerName', 'level', 'players', 'stun', 'sfx', 'view', 'autoUpdate', 'aivai', 'netCfg'];
  function setSettings(p) {
    p = p || {};
    KEYS.forEach(function (k) { if (k in p) settings[k] = p[k]; });
    ['server', 'turn', 'music'].forEach(function (k) { if (p[k]) settings[k] = Object.assign({}, settings[k], p[k]); });
    if (p.advisor) {
      if ('apiKey' in p.advisor) settings.advisor.apiKey = String(p.advisor.apiKey || '').trim();
      if (p.advisor.model) settings.advisor.model = String(p.advisor.model);
      if (p.advisor.effort) settings.advisor.effort = String(p.advisor.effort);
    }
    persist();
    return pub();
  }

  // ---------------- IndexedDB（棋譜、自己的音樂） ----------------
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('xiaoke-checkers', 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('games')) d.createObjectStore('games', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('music')) d.createObjectStore('music', { keyPath: 'name' });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), st = t.objectStore(store), out;
        var req = fn(st);
        if (req) req.onsuccess = function () { out = req.result; };
        t.oncomplete = function () { res(out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function newId() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' + Math.random().toString(16).slice(2, 8);
  }
  function summary(g) {
    return { id: g.id, date: g.date, mode: g.mode, n: g.n, names: g.names || [], result: g.result, plies: (g.moves || []).length, mySeat: g.mySeat };
  }

  // ---------------- 選擇檔案（匯入棋譜、加入音樂） ----------------
  function pickFiles(accept, multiple) {
    return new Promise(function (res) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept; inp.multiple = !!multiple;
      inp.style.display = 'none';
      var done = false;
      inp.onchange = function () { done = true; res([].slice.call(inp.files || [])); inp.remove(); };
      inp.addEventListener('cancel', function () { if (!done) { done = true; res([]); inp.remove(); } });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  // ---------------- 存檔（匯出棋譜） ----------------
  function b64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function saveText(name, text) {
    var bytes = new TextEncoder().encode('﻿' + text);
    if (isIOS) {
      // 寫到 App 的暫存檔，再開分享選單（儲存到「檔案」、AirDrop、LINE…）
      return ios('begin_save', [name]).then(function (b) {
        if (!b || b.status !== 'ok') throw new Error((b && b.message) || '無法存檔');
        var chain = Promise.resolve();
        for (var i = 0; i < bytes.length; i += 512 * 1024) (function (part) { chain = chain.then(function () { return ios('write_chunk', [b.token, b64(part)]); }); })(bytes.subarray(i, i + 512 * 1024));
        return chain.then(function () { return ios('end_save', [b.token]); }).then(function (e) { return e && e.status === 'ok' ? e.path : ''; });
      });
    }
    if (isAndroid) {
      // 存到手機的「下載/小柯跳棋」
      var sv = parse(A.beginSave(name));
      if (!sv || sv.status !== 'ok') return Promise.reject(new Error((sv && sv.message) || '無法存檔'));
      for (var k = 0; k < bytes.length; k += 512 * 1024) A.writeChunk(sv.token, b64(bytes.subarray(k, k + 512 * 1024)));
      var e = parse(A.endSave(sv.token));
      return Promise.resolve(e && e.path ? e.path : name);
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    return Promise.resolve('下載資料夾／' + name);
  }

  // ---------------- 版本更新（Android：下載 APK 安裝；iPhone／iPad：開線上安裝頁，用 Safari 按一下就裝好新版） ----------------
  var updInfo = null;
  var progressFns = [];
  function cmpVer(a, b) {
    var pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
    for (var i = 0; i < 3; i++) { var d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
    return 0;
  }
  function checkUpdate() {
    var cur = appVersion();
    if (isAndroid) {
      return new Promise(function (res, rej) {
        setTimeout(function () {
          var r = parse(A.checkUpdate());
          if (!r || r.status !== 'ok') { rej(new Error((r && r.message) || '無法連線')); return; }
          updInfo = { current: r.current, latest: r.latest, newer: cmpVer(r.latest, r.current) > 0, notes: r.notes || '', page: r.page,
            asset: r.url ? { name: r.url.split('/').pop(), url: r.url, size: 0 } : null, flavor: 'android', canInstall: !!r.url };
          res(updInfo);
        }, 0);
      });
    }
    var done = function (latest, notes, page, ipa) {
      updInfo = { current: cur, latest: latest, newer: cmpVer(latest, cur) > 0, notes: notes || '', page: isIOS ? IOS_INSTALL_PAGE : page,
        asset: ipa ? { name: ipa.name, url: ipa.browser_download_url, size: ipa.size } : null, flavor: isIOS ? 'ios' : 'web', canInstall: false };
      return updInfo;
    };
    return fetch('https://api.github.com/repos/' + REPO + '/releases/latest').then(function (r) {
      if (!r.ok) throw new Error('查詢失敗（' + r.status + '）');
      return r.json();
    }).then(function (j) {
      return done(String(j.tag_name || '').replace(/^v/, ''), String(j.body || '').slice(0, 4000), j.html_url,
        (j.assets || []).filter(function (a) { return /\.ipa$/i.test(a.name); })[0]);
    }).catch(function (err) {
      // GitHub API 每個網路每小時只能查 60 次；被限制時改讀安裝頁的 manifest.plist（裡面有 iPad 版的版本號）
      return fetch(IOS_INSTALL_PAGE + 'manifest.plist', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw err;
        return r.text();
      }).then(function (t) {
        var m = /<key>bundle-version<\/key>\s*<string>([^<]+)<\/string>/.exec(t);
        if (!m) throw err;
        return done(m[1], '', 'https://github.com/' + REPO + '/releases/latest', null);
      }).catch(function () { throw err; });
    });
  }

  // ---------------- AI 軍師（Claude，直接從 iPad 連線） ----------------
  var deltaFns = [], doneFns = [], active = {};
  function emit(list, d) { list.forEach(function (f) { try { f(d); } catch (e) { console.error(e); } }); }
  // 動態載入：以網頁位置為準（一般 script 的相對路徑會以這個檔案為準，所以用絕對網址）
  function abs(p) { return new URL(p, document.baseURI).href; }
  function sdk() { return import(abs('vendor/anthropic.js')).then(function (m) { return m.default; }); }
  function core() { return import(abs('js/advisor-core.js')); }
  function explain(Anthropic, err) {
    if (err instanceof Anthropic.AuthenticationError) return 'API 金鑰無效，請到「設定」重新輸入 Anthropic API 金鑰。';
    if (err instanceof Anthropic.PermissionDeniedError) return '這把金鑰沒有使用此模型的權限，請到「設定」換一個模型或金鑰。';
    if (err instanceof Anthropic.NotFoundError) return '找不到指定的模型，請到「設定」改用 claude-opus-5-5。';
    if (err instanceof Anthropic.RateLimitError) return '請求太頻繁或額度用完了，請稍後再問。';
    if (err instanceof Anthropic.BadRequestError) return '請求格式有誤：' + (err.message || '');
    if (err instanceof Anthropic.APIConnectionError) return '連不上 Claude 伺服器，請檢查網路。';
    if (err instanceof Anthropic.APIError) return 'Claude 回應錯誤（' + (err.status || '') + '）：' + (err.message || '');
    return String((err && err.message) || err);
  }
  function client(Anthropic) { return new Anthropic({ apiKey: settings.advisor.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 120000 }); }
  async function ask(id, payload) {
    if (!settings.advisor.apiKey) { emit(doneFns, { id: id, error: 'nokey' }); return; }
    var Anthropic, stream;
    try {
      Anthropic = await sdk();
      var c = await core();
      stream = client(Anthropic).beta.messages.stream(c.buildParams(settings.advisor, payload.messages, 4000, payload.effort));
      active[id] = stream;
      for await (var ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') emit(deltaFns, { id: id, text: ev.delta.text });
      }
      var msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') { emit(doneFns, { id: id, error: '軍師這題無法回答，換個問法試試看。' }); return; }
      var text = msg.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
      emit(doneFns, { id: id, text: text, model: msg.model, truncated: msg.stop_reason === 'max_tokens' });
    } catch (err) {
      if (stream && stream.aborted) emit(doneFns, { id: id, error: 'cancelled' });
      else emit(doneFns, { id: id, error: Anthropic ? explain(Anthropic, err) : String(err && err.message || err) });
    } finally { delete active[id]; }
  }
  async function testKey() {
    if (!settings.advisor.apiKey) return { ok: false, error: '尚未設定 API 金鑰' };
    var Anthropic = await sdk();
    try {
      var c = await core();
      var msg = await client(Anthropic).beta.messages.create(c.buildParams(settings.advisor, [{ role: 'user', content: '請用一句話向棋友打招呼。' }], 2000, 'low'));
      return { ok: true, text: msg.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join(''), model: msg.model };
    } catch (err) { return { ok: false, error: explain(Anthropic, err) }; }
  }

  function downloadUpdate() {
    if (!isAndroid || !updInfo || !updInfo.asset) return Promise.reject(new Error('請到安裝頁更新'));
    var r = parse(A.installUpdate(updInfo.asset.url, updInfo.latest));
    if (!r || r.status !== 'ok') return Promise.reject(new Error((r && r.message) || '無法下載'));
    return new Promise(function (res, rej) {
      (function poll() {
        var st = parse(A.updateStatus()) || {};
        progressFns.forEach(function (f) { f({ got: st.pct || 0, total: 100 }); });
        if (st.state === 'permission') rej(new Error('請先在設定畫面允許本 App「安裝未知應用程式」，回來後再按一次更新'));
        else if (st.state === 'error') rej(new Error('下載失敗，請再試一次'));
        else if (st.state === 'launching') res('android');
        else setTimeout(poll, 500);
      })();
    });
  }

  function openUrl(url) { if (isAndroid) A.openUrl(url); else if (isIOS) ios('open_url', [url]); else window.open(url, '_blank'); }

  // ---------------- 手機返回鍵（Android 原生呼叫） ----------------
  window.__xkBack = function () { return window.__xkjBack ? !!window.__xkjBack() : false; };

  window.xk = {
    settings: { get: function () { return Promise.resolve(pub()); }, set: function (p) { return Promise.resolve(setSettings(p)); } },
    sys: {
      info: function () { return Promise.resolve({ platform: isAndroid ? 'android' : isIOS ? 'ios' : 'web', arch: '', version: appVersion(), packaged: isAndroid || isIOS, profile: '', electron: '', mobile: mobile }); },
      askMicrophone: function () { return Promise.resolve(true); },
    },
    win: { attention: function () { try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) { /* 不支援 */ } return Promise.resolve(); } },
    openExternal: function (url) { openUrl(url); return Promise.resolve(); },
    games: {
      save: function (rec) { var id = String(rec.id || '').replace(/[^\w.-]/g, '') || newId(); var data = Object.assign({}, rec, { id: id }); return tx('games', 'readwrite', function (s) { s.put(data); }).then(function () { return id; }); },
      list: function () { return tx('games', 'readonly', function (s) { return s.getAll(); }).then(function (l) { return (l || []).sort(function (a, b) { return a.id < b.id ? 1 : -1; }).map(summary); }); },
      all: function () { return tx('games', 'readonly', function (s) { return s.getAll(); }).then(function (l) { return l || []; }); },
      get: function (id) { return tx('games', 'readonly', function (s) { return s.get(id); }).then(function (g) { return g || null; }); },
      delete: function (id) { return tx('games', 'readwrite', function (s) { s.delete(id); }).then(function () { return true; }); },
      export: function (name, text) { return saveText(name, text); },
      pickImport: function () {
        return pickFiles('.json,.txt,text/plain,application/json', true).then(function (files) {
          return Promise.all(files.slice(0, 500).map(function (f) {
            if (f.size > 5 * 1024 * 1024) return { name: f.name, error: '檔案太大' };
            return f.text().then(function (t) { return { name: f.name, text: t }; });
          }));
        });
      },
    },
    music: {
      list: function () {
        var builtin = fetch(abs('assets/music/tracks.json')).then(function (r) { return r.json(); }).then(function (l) {
          return l.map(function (t) { return { title: t.title, url: abs('assets/music/' + t.file), builtin: true, seconds: t.seconds }; });
        }).catch(function () { return []; });
        var own = tx('music', 'readonly', function (s) { return s.getAll(); }).then(function (l) {
          return (l || []).map(function (m) { return { title: m.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(m.blob), builtin: false, file: m.name }; });
        });
        return Promise.all([builtin, own]).then(function (x) { return x[0].concat(x[1]); });
      },
      add: function () {
        return pickFiles('audio/*,.mp3,.m4a,.ogg,.wav', true).then(function (files) {
          return Promise.all(files.map(function (f) { return tx('music', 'readwrite', function (s) { s.put({ name: f.name, blob: f }); }); })).then(function () { return files.length; });
        });
      },
      remove: function (name) { return tx('music', 'readwrite', function (s) { s.delete(name); }).then(function () { return true; }); },
    },
    update: {
      check: checkUpdate,
      download: downloadUpdate,
      install: function () { return Promise.resolve({ manual: true, android: isAndroid }); },
      openPage: function () { openUrl((updInfo && updInfo.page) || (isIOS ? IOS_INSTALL_PAGE : 'https://github.com/' + REPO + '/releases/latest')); return Promise.resolve(); },
      onProgress: function (fn) { progressFns.push(fn); return function () { progressFns = progressFns.filter(function (f) { return f !== fn; }); }; },
    },
    advisor: {
      ask: function (id, payload) { ask(id, payload); },
      cancel: function (id) { var s = active[id]; if (s) { try { s.abort(); } catch (e) { /* 已結束 */ } } },
      test: testKey,
      onDelta: function (fn) { deltaFns.push(fn); return function () { deltaFns = deltaFns.filter(function (f) { return f !== fn; }); }; },
      onDone: function (fn) { doneFns.push(fn); return function () { doneFns = doneFns.filter(function (f) { return f !== fn; }); }; },
    },
    mobile: mobile,
    touch: touch,
    android: isAndroid,
    ios: isIOS,
  };
})();
