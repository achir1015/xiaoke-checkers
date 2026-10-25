'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('xk', {
  settings: { get: inv('settings:get'), set: inv('settings:set') },
  sys: { info: inv('sys:info'), askMicrophone: inv('sys:askMicrophone') },
  win: { attention: inv('win:attention') },
  openExternal: inv('app:openExternal'),
  games: {
    save: inv('games:save'), list: inv('games:list'), all: inv('games:all'), get: inv('games:get'),
    delete: inv('games:delete'), export: inv('games:export'), pickImport: inv('games:pickImport'),
  },
  music: { list: inv('music:list'), add: inv('music:add'), remove: inv('music:remove') },
  update: {
    check: inv('update:check'), download: inv('update:download'), install: inv('update:install'), openPage: inv('update:openPage'),
    onProgress: (fn) => { const h = (e, d) => fn(d); ipcRenderer.on('update:progress', h); return () => ipcRenderer.off('update:progress', h); },
  },
  advisor: {
    ask: (id, payload) => ipcRenderer.send('advisor:ask', id, payload),
    cancel: (id) => ipcRenderer.send('advisor:cancel', id),
    test: inv('advisor:test'),
    onDelta: (fn) => { const h = (e, d) => fn(d); ipcRenderer.on('advisor:delta', h); return () => ipcRenderer.off('advisor:delta', h); },
    onDone: (fn) => { const h = (e, d) => fn(d); ipcRenderer.on('advisor:done', h); return () => ipcRenderer.off('advisor:done', h); },
  },
});
