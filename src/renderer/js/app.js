// 小柯機器人跳棋遊戲：主控流程（與 AI、遠端 2～3 人＋觀棋、AI 對 AI、棋譜重播）
import { $, $$, h, toast, modal, sleep, errMsg, fmtDate, uid } from './util.js';
import { Game, replayRecord, HOMES, opposite, SEAT_COLORS, SEAT_NAMES, cellName, mvFrom, mvTo, MV, PASS, reachable, isStep, PIECES } from './rules.js';
import { LEVELS } from './ai.js';
import { Board3D } from './board3d.js';
import { Room, PROTOCOL } from './net.js';
import { MusicPlayer } from './music.js';
import { AdvisorPanel } from './advisor-ui.js';
import { sfx, setSfx } from './sfx.js';

const APP_NAME = '小柯機器人跳棋遊戲';
const CREDIT = '系統開發：吳玉柱 先生 與 Claude AI Opus 5.5';
const SPEEDS = [['fast', '快', 300], ['normal', '一般', 900], ['slow', '慢', 1800]];

// ---------------- AI（背景執行緒） ----------------
class EngineClient {
  constructor() {
    this.w = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
    this.seq = 0;
    this.pending = new Map();
    this.w.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data.r) : p.reject(new Error(e.data.e));
    };
    this.w.onerror = (e) => console.error('engine worker', e);
  }
  req(msg) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.w.postMessage({ id, ...msg }); });
  }
  choose(state, level) { return this.req({ cmd: 'choose', state, level }); }
  analyze(state, lines = 3, level = 2) { return this.req({ cmd: 'analyze', state, level, lines }); }
}

const S = {
  settings: null,
  info: null,
  screen: 'home',
  mode: null,          // ai | net | aivai | replay | idle
  game: null,
  seats: [],           // [{ name, kind: me|ai|remote|watch, level }]
  mySeat: -1,          // -1：觀棋者／AI 對 AI
  selected: -1,
  aiThinking: false,
  animating: false,
  paused: false,
  aivaiDelay: 900,
  gameId: '',
  saved: false,
  room: null,
  net: null,           // { role, code, n, aiLevel, members, started, mySeat }
  clocks: [0, 0, 0],
  clockSeat: 0,
  clockStart: 0,
  voice: { on: false, mic: null, calls: new Map() },
  replay: null,
  recent: [[], [], []],
  hintTimer: 0,
};

let board, music, advisor, engineAI, engineAna;
const newGameId = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + uid().slice(-6);
const myName = () => S.settings.playerName || '棋友';
const lvName = (i) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))].name;

// ---------------- 啟動 ----------------
async function init() {
  S.settings = await xk.settings.get();
  S.info = await xk.sys.info();
  setSfx(S.settings.sfx);
  engineAI = new EngineClient();
  engineAna = new EngineClient();

  board = new Board3D($('#board'), { onCellClick });
  board.onHop = (k, n) => { if (k > 0 || n > 1) sfx.hop(k); };
  board.setView(S.settings.view || 'tilt');
  $$('.viewbtn').forEach((b) => b.classList.toggle('on', b.id === 'view' + board.viewName[0].toUpperCase() + board.viewName.slice(1)));
  idleBoard();

  music = new MusicPlayer($('#musicPanel'), S.settings, (patch) => saveSettings(patch));
  await music.load();
  if (S.settings.music.autoplay && S.settings.music.enabled !== false) {
    const start = () => { music.play(); document.removeEventListener('pointerdown', start); };
    document.addEventListener('pointerdown', start);
  }
  music.renderState();

  advisor = new AdvisorPanel($('#advisorPanel'), () => ({
    game: S.mode === 'replay' ? S.replay.game : S.game,
    mySeat: S.mySeat,
    names: S.seats.map((s) => s.name),
    analyze: (state, lines) => engineAna.analyze(state, lines, 3),
    showHint: (m) => showHint(m),
  }));
  advisor.setHasKey(S.settings.advisor.hasKey);

  bindUI();
  if (document.documentElement.classList.contains('mobile')) setupMobile();
  else if (document.documentElement.classList.contains('touch')) setupTouch();
  renderHome();
  showScreen('home');
  setInterval(tickClock, 500);
  document.addEventListener('pointerdown', () => sfx.resume(), { once: true });
  window.__xkc = S; // 方便自動化測試
  window.__xkcBoard = board;
  if (S.settings.autoUpdate !== false && S.info.packaged && !S.info.profile) setTimeout(() => checkUpdate(false), 5000);
}

async function saveSettings(patch) {
  S.settings = await xk.settings.set(patch);
  return S.settings;
}

function idleBoard() {
  const g = new Game(3);
  board.setZones(g.homes.map((home, s) => ({ home, target: opposite(home), color: SEAT_COLORS[s] })));
  board.setFacing(0);
  board.setPosition(g.board);
}

// ---------------- 畫面切換 ----------------
function showScreen(name) {
  S.screen = name;
  $$('.screen').forEach((el) => el.classList.toggle('on', el.id === 'scr-' + name));
  if (name === 'game') setTimeout(() => board.resize(), 30);
  if (name === 'records') renderRecords();
}

function bindUI() {
  $('#btnHome').onclick = () => leaveGame();
  $('#viewTilt').onclick = () => setView('tilt');
  $('#viewTop').onclick = () => setView('top');
  $('#viewLow').onclick = () => setView('low');
  $('#btnRotate').onclick = () => board.setFacing((board.facingZone + 1) % 6);
  $('#btnUndo').onclick = () => undo();
  $('#btnResign').onclick = () => resign();
  $('#btnHint').onclick = () => hint();
  $('#btnPause').onclick = () => togglePause();
  $('#btnNew').onclick = () => newGameSameMode();
  $('#btnExport').onclick = () => exportCurrent();
  $('#miniMusic').onclick = () => { selectTab('music'); music.toggle(); };
  $$('.tab').forEach((t) => { t.onclick = () => { t.classList.remove('ping'); selectTab(t.dataset.tab); }; });
  $('#chatSend').onclick = () => sendChat();
  $('#chatInput').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
  $('#btnVoice').onclick = () => toggleVoice();
  $('#btnMute').onclick = () => toggleMute();
  $('#rpFirst').onclick = () => replayGo(0);
  $('#rpPrev').onclick = () => replayGo(S.replay.ply - 1);
  $('#rpNext').onclick = () => replayGo(S.replay.ply + 1);
  $('#rpLast').onclick = () => replayGo(S.replay.rec.moves.length);
  $('#rpPlay').onclick = () => replayAuto();
  $('#rpExport').onclick = () => exportCurrent();
  document.addEventListener('keydown', (e) => {
    if (S.mode !== 'replay' || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowLeft') replayGo(S.replay.ply - 1);
    if (e.key === 'ArrowRight') replayGo(S.replay.ply + 1);
  });
}

// 手機版（Android、iPhone 直立）：走法紀錄、軍師、對話、音樂收進底部的抽屜；點分頁打開、再點一次收起
function setupMobile() {
  document.body.classList.add('is-mobile');
  const tabs = $('.right .tabs');
  tabs.prepend(h('button', { class: 'tab', 'data-tab': 'moves' }, '📜 走法'));
  const pane = h('div', { id: 'pane-moves', class: 'tabpane' });
  pane.append($('.movebox'));
  $('#pane-advisor').before(pane);
  $$('.tab').forEach((t) => {
    t.onclick = () => {
      t.classList.remove('ping');
      const open = document.body.classList.contains('sheet-open');
      const same = t.classList.contains('on');
      selectTab(t.dataset.tab);
      document.body.classList.toggle('sheet-open', !(open && same));
    };
  });
  // 點棋盤就收起抽屜
  $('#boardWrap').addEventListener('pointerdown', () => document.body.classList.remove('sheet-open'));
  // 手機返回鍵：先關對話框、抽屜，再回上一頁
  window.__xkjBack = () => {
    const m = $('.modal-back');
    if (m) { const btns = m.querySelectorAll('.modal-btns button'); (btns[0] || btns[btns.length - 1]).click(); return true; }
    if (document.body.classList.contains('sheet-open')) { document.body.classList.remove('sheet-open'); return true; }
    if (S.screen === 'game') { leaveGame(); return true; }
    if (S.screen === 'records') { showScreen('home'); return true; }
    return false;
  };
}

// iPad（電腦版版面、觸控螢幕）：沒有滑鼠右鍵與滾輪，提示改成手指操作
function setupTouch() {
  $('.board-tip').textContent = '點棋子、再點落點（黃圈＝跳躍可到）．兩指拖曳旋轉．兩指捏合縮放';
}

function selectTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  $$('.tabpane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + name));
}

function setView(v) {
  board.setView(v);
  $$('.viewbtn').forEach((b) => b.classList.toggle('on', b.id === 'view' + v[0].toUpperCase() + v.slice(1)));
  saveSettings({ view: v });
}

// ---------------- 首頁 ----------------
function seg(options, value, onPick) {
  const el = h('div', { class: 'seg' }, ...options.map(([v, l]) => h('button', { class: 'segbtn' + (String(v) === String(value) ? ' on' : ''), 'data-v': v, onclick: () => { $$('.segbtn', el).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); el.dataset.v = v; onPick && onPick(v); } }, l)));
  el.dataset.v = value;
  return el;
}
const NSEG = [[2, '2 人'], [3, '3 人']];
const lvSelect = (id, val) => h('select', { class: 'lv', id }, LEVELS.map((l, i) => h('option', { value: i, selected: i === val }, l.name)));

function renderHome() {
  const home = $('#homeBody');
  home.innerHTML = '';
  const nameInput = h('input', { class: 'name-in', value: myName(), maxLength: 16, onchange: (e) => saveSettings({ playerName: e.target.value.trim() || '棋友' }) });
  const nDef = S.settings.players === 3 ? 3 : 2;

  // A：與 AI 對賽
  const nA = seg(NSEG, nDef, (v) => saveSettings({ players: Number(v) }));
  const lvA = lvSelect('lvAI', S.settings.level ?? 2);
  lvA.onchange = () => saveSettings({ level: Number(lvA.value) });
  const cardAI = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🤖'),
    h('h2', {}, 'A　與 AI 對賽'),
    h('p', { class: 'muted' }, '不需要網路。您執紅色，從下方的角出發；其他顏色由小柯 AI 下。'),
    h('label', {}, '人數：'), nA,
    h('label', {}, 'AI 難度：'), lvA,
    h('button', { class: 'primary big', id: 'startAI', onclick: () => startAIGame(Number(nA.dataset.v), Number(lvA.value)) }, '開始對局'));

  // B：遠端對賽
  const nc = S.settings.netCfg || {};
  const nB = seg(NSEG, nc.n || nDef);
  const lvB = lvSelect('lvNet', nc.aiLevel ?? 2);
  const codeIn = h('input', { class: 'code-in', id: 'joinCode', placeholder: '輸入 6 位數房號', maxLength: 7, inputMode: 'numeric' });
  const cardNet = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🌐'),
    h('h2', {}, 'B　遠端對賽'),
    h('p', { class: 'muted' }, '邀請一位或兩位朋友遠端參賽，空位可由 AI 代下；更多人加入就當觀棋者。可以語音通話、文字聊天。'),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '人數：'), nB), h('div', {}, h('label', {}, '空位 AI 難度：'), lvB)),
    h('button', { class: 'primary', id: 'btnHost', onclick: () => { const cfg = { n: Number(nB.dataset.v), aiLevel: Number(lvB.value) }; saveSettings({ netCfg: cfg }); hostRoom(cfg); } }, '建立房間（我當房主）'),
    h('div', { class: 'net-or' }, '或'),
    h('div', { class: 'net-row' }, codeIn, h('button', { class: 'primary', id: 'btnJoin', onclick: () => joinRoom(codeIn.value) }, '加入房間')),
    h('div', { id: 'netWait', class: 'net-wait hidden' }));

  // C：AI 對 AI
  const av = S.settings.aivai || {};
  const nC = seg(NSEG, av.n || nDef, (v) => { lvC[2].parentElement.classList.toggle('hidden', Number(v) !== 3); });
  const lvC = [0, 1, 2].map((s) => lvSelect('aivai' + s, (av.levels || [])[s] ?? 2));
  const speedSel = seg(SPEEDS.map(([v, l]) => [v, l]), av.speed || 'normal');
  const cardAivai = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🎬'),
    h('h2', {}, 'C　AI 與 AI 對賽'),
    h('p', { class: 'muted' }, '坐下來觀戰，看小柯 AI 彼此較量。可以暫停、請軍師講解，棋譜也會收錄。'),
    h('label', {}, '人數：'), nC,
    h('div', { class: 'lv-row' }, ...lvC.map((sel, s) => h('div', { class: s === 2 && Number(nC.dataset.v) !== 3 ? 'hidden' : '' }, h('label', {}, SEAT_NAMES[s] + '：'), sel))),
    h('label', {}, '每步速度：'), speedSel,
    h('button', { class: 'primary big', id: 'startAivai', onclick: () => {
      const cfg = { n: Number(nC.dataset.v), levels: lvC.map((x) => Number(x.value)), speed: speedSel.dataset.v };
      saveSettings({ aivai: cfg });
      startAIvAI(cfg);
    } }, '開始觀戰'));

  home.append(
    h('div', { class: 'home-hero' },
      h('div', { class: 'hero-marbles' }, h('i'), h('i'), h('i')),
      h('div', {}, h('h1', {}, APP_NAME), h('p', { class: 'muted' }, '3D 中國跳棋．2～3 人對戰．遠端連線＋語音')),
      h('div', { class: 'hero-name' }, h('label', {}, '我的暱稱'), nameInput)),
    h('div', { class: 'mode-grid' }, cardAI, cardNet, cardAivai),
    h('div', { class: 'home-links' },
      h('button', { onclick: () => showScreen('records') }, '📜 棋譜庫'),
      h('button', { onclick: () => openSettings() }, '⚙ 設定'),
      h('button', { onclick: () => { selectTab('music'); enterIdle(); } }, '♫ 背景音樂'),
      h('button', { id: 'btnAbout', onclick: () => openAbout() }, 'ℹ 關於與更新')),
    h('div', { class: 'card rules-box' },
      h('h3', {}, '遊戲規則'),
      h('ul', {},
        h('li', {}, '六角星棋盤共 121 孔，最多三組參賽，各用一種顏色的 10 顆棋子，從自己的角出發。'),
        h('li', {}, '先把 10 顆棋子全部移到正對面的角就獲勝（對面角被填滿、且其中有自己的棋子也算贏）。'),
        h('li', {}, '每回合移動一顆：走到相鄰的空孔，或「跳」——沿直線跳過緊鄰的一顆棋子，落在它正後方的空孔。'),
        h('li', {}, '跳躍一定走直線、不能轉彎；隔了兩顆以上（或中間有空孔）就擋住了、不能跳。落下後可以接著再跳（連跳）。'),
        h('li', {}, '比賽時只有輪到的人（主控權者）能動滑鼠下棋，其他人都是觀棋者。'))),
    h('div', { class: 'credit muted small' }, `v${S.info.version}　${CREDIT}`),
  );
}

function enterIdle() {
  if (!S.mode) {
    S.mode = 'idle';
    S.game = new Game(3);
    S.seats = [0, 1, 2].map((s) => ({ name: SEAT_NAMES[s], kind: 'watch' }));
    S.mySeat = -1;
    document.body.className = document.documentElement.classList.contains('mobile') ? 'is-mobile' : '';
    board.setPosition(S.game.board);
    board.setLastMove(null); board.setHint(-1); board.setSelected(-1); board.setTargets([]);
    board.setInteractive(false);
    updateGameUI();
  }
  showScreen('game');
}

// ---------------- 對局共用 ----------------
// seats: [{ name, kind, level }]
function setupGame(mode, n, seats, mySeat, opts = {}) {
  S.mode = mode;
  S.game = new Game(n);
  S.seats = seats;
  S.mySeat = mySeat;
  S.selected = -1;
  S.aiThinking = false;
  S.animating = false;
  S.paused = false;
  S.saved = false;
  S.gameId = opts.gameId || newGameId();
  S.recent = [[], [], []];
  S.clocks = [0, 0, 0]; S.clockSeat = 0; S.clockStart = Date.now();
  const g = S.game;
  board.setZones(g.homes.map((home, s) => ({ home, target: g.targets[s], color: SEAT_COLORS[s] })));
  board.setFacing(mySeat >= 0 ? g.homes[mySeat] : 0);
  board.setPosition(g.board);
  board.setLastMove(null); board.setHint(-1); board.setSelected(-1); board.setPeerSelected(-1); board.setTargets([]);
  advisor.reset();
  document.body.className = 'mode-' + mode + (document.documentElement.classList.contains('mobile') ? ' is-mobile' : '');
  $('#aiInfo').textContent = '';
  if (mode !== 'net') { $('#chatLog').innerHTML = ''; $('#memberList').innerHTML = ''; }
  showScreen('game');
  selectTab(mode === 'net' ? 'chat' : 'advisor');
  updateGameUI();
}

const iControlAI = () => S.mode === 'ai' || S.mode === 'aivai' || (S.mode === 'net' && S.net && S.net.role === 'host');

function canMove() {
  const g = S.game;
  if (!g || g.result || S.animating || S.mySeat < 0 || g.turn !== S.mySeat) return false;
  if (S.mode === 'ai') return !S.aiThinking;
  if (S.mode === 'net') return !!(S.net && S.net.started && S.room && S.room.connected);
  return false;
}

function onCellClick(c) {
  const g = S.game;
  if (!g || !['ai', 'net'].includes(S.mode)) return;
  if (!canMove()) {
    if (!g.result && S.mySeat >= 0 && g.turn !== S.mySeat) { flashBanner(); sfx.illegal(); }
    else if (S.mySeat < 0 && S.mode === 'net') toast('您是觀棋者，只能觀看', 'info', 1500);
    return;
  }
  if (g.board[c] === S.mySeat) {
    S.selected = c;
    board.setSelected(c);
    const { dests } = reachable(g.board, c);
    board.setTargets([...dests].map((d) => ({ cell: d, jump: !isStep(c, d) })));
    sfx.select();
    if (S.mode === 'net') S.room.send({ t: 'sel', seat: S.mySeat, cell: c });
    return;
  }
  if (S.selected >= 0) {
    const m = MV(S.selected, c);
    if (g.legalMoves().includes(m)) { localMove(m); return; }
    sfx.illegal();
    if (g.board[c] >= 0) toast('這不是您的棋子', 'info', 1400);
  } else if (g.board[c] >= 0) toast(`這是${SEAT_NAMES[g.board[c]]}的棋子`, 'info', 1400);
}

async function localMove(m) {
  if (S.mode === 'net') S.room.send({ t: 'move', ply: S.game.moves.length, seat: S.mySeat, m });
  await applyMove(m);
}

async function applyMove(m) {
  const g = S.game;
  S.selected = -1;
  board.setSelected(-1); board.setTargets([]); board.setHint(-1); board.setPeerSelected(-1);
  const seat = g.turn;
  S.clocks[seat] += Date.now() - S.clockStart;
  S.clockStart = Date.now();
  let res;
  try { res = g.play(m); } catch (e) { console.warn(e); toast('走法錯誤：' + errMsg(e), 'err'); updateGameUI(); return; }
  S.recent[seat].push(m); if (S.recent[seat].length > 4) S.recent[seat].shift();
  S.clockSeat = g.turn;
  S.animating = true;
  updateGameUI();
  await board.animatePath(res.path);
  S.animating = false;
  if (S.game !== g) return; // 動畫期間已離開或重開
  if (res.jumps) sfx.land(); else sfx.step();
  board.setLastMove(res.path, seat);
  updateGameUI();
  if (g.result) { await onGameOver(); return; }
  if (S.mode === 'net' && g.turn === S.mySeat) { sfx.turn(); xk.win.attention('輪到您下棋', res.note); }
  maybeAI();
}

function maybeAI() {
  const g = S.game;
  if (!g || g.result || !iControlAI()) return;
  if (S.seats[g.turn] && S.seats[g.turn].kind === 'ai') aiTurn();
}

async function aiTurn() {
  const g = S.game;
  if (!g || g.result || S.aiThinking || S.animating) return;
  if (S.mode === 'aivai' && S.paused) return;
  const mode = S.mode, seat = g.turn, ply = g.moves.length;
  const level = S.seats[seat].level ?? 2;
  S.aiThinking = true;
  updateGameUI();
  const t0 = Date.now();
  let r;
  try { r = await engineAI.choose({ board: Array.from(g.board), n: g.n, turn: seat, out: g.out, recent: S.recent[seat].slice(-2) }, level); }
  catch (e) { console.error(e); r = { move: g.legalMoves()[0], depth: 0 }; }
  const minWait = mode === 'aivai' ? S.aivaiDelay : 500;
  const wait = minWait - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  S.aiThinking = false;
  if (S.game !== g || S.mode !== mode || g.moves.length !== ply || g.result) { updateGameUI(); return; }
  if (mode === 'aivai' && S.paused) { updateGameUI(); return; }
  if (!S.seats[seat] || S.seats[seat].kind !== 'ai') { updateGameUI(); return; } // 這期間座位已有人接手
  $('#aiInfo').textContent = `${SEAT_NAMES[seat]} AI（${lvName(level)}）：搜尋 ${r.depth} 層`;
  if (!g.legalMoves().includes(r.move)) { updateGameUI(); return; }
  if (mode === 'net') S.room.send({ t: 'move', ply, seat, m: r.move });
  await applyMove(r.move);
}

// ---------------- 畫面更新 ----------------
function seatLabel(s) {
  const st = S.seats[s] || {};
  if (st.kind === 'me') return '（我）';
  if (st.kind === 'ai') return st.left ? `（離線，AI 代下）` : `（AI ${lvName(st.level ?? 2)}）`;
  if (st.kind === 'remote') return '（遠端）';
  return '';
}

function updateGameUI() {
  const g = S.mode === 'replay' ? S.replay.game : S.game;
  if (!g) return;
  // 玩家卡片
  const box = $('#players');
  box.innerHTML = '';
  for (let s = 0; s < g.n; s++) {
    const inT = g.inTarget(s);
    const prog = g.progressOf(s) + 60;
    const card = h('div', { class: 'player' + (g.out[s] ? ' out' : '') + (!g.result && g.turn === s && !['idle', 'replay'].includes(S.mode) ? ' active' : ''), style: { '--mc': SEAT_COLORS[s] } },
      h('span', { class: 'pchip marble' }),
      h('div', { class: 'pinfo' },
        h('div', {}, h('span', { class: 'pname' }, S.seats[s] ? S.seats[s].name : SEAT_NAMES[s]), h('span', { class: 'ptag' }, seatLabel(s))),
        h('div', { class: 'pmeta' }, h('span', { title: `到岸 ${inT}/${PIECES}` }, h('span', { class: 'pseat' }, `${SEAT_NAMES[s]}．`), h('span', { class: 'plabel' }, '到岸 '), `${inT}/${PIECES}`), h('span', { class: 'pclock', 'data-seat': s }, '0:00')),
        h('div', { class: 'pbar' }, h('i', { style: { width: Math.round((prog / 120) * 100) + '%' } }))));
    box.append(card);
  }
  // 走法列表
  const list = $('#moveList');
  list.innerHTML = '';
  const notes = g.notes;
  const cur = S.mode === 'replay' ? S.replay.ply : notes.length;
  notes.forEach((n, i) => {
    list.append(h('div', { class: 'mv-row one' },
      h('span', { class: 'mv-no' }, `${i + 1}.`),
      h('span', { class: `mv s${g.movers[i]}` + (cur === i + 1 ? ' cur' : ''), onclick: () => S.mode === 'replay' && replayGo(i + 1) }, n)));
  });
  list.scrollTop = list.scrollHeight;
  $('#plyCount').textContent = notes.length ? `共 ${notes.length} 步` : '';
  // 輪次提示
  const banner = $('#turnBanner');
  let text = '', cls = '';
  const who = (s) => `${SEAT_NAMES[s]} ${S.seats[s] ? S.seats[s].name : ''}`;
  if (S.mode === 'replay') { text = `棋譜重播　第 ${S.replay.ply} / ${S.replay.rec.moves.length} 步`; cls = 'replay'; }
  else if (S.mode === 'idle') { text = '請回首頁選擇對局模式'; cls = 'watch'; }
  else if (g.result) { text = resultText(g.result); cls = 'over'; }
  else if (S.mode === 'aivai') { text = S.paused ? `AI 對 AI．已暫停（輪到${SEAT_NAMES[g.turn]}）` : `AI 對 AI．${who(g.turn)} 思考中…`; cls = 'watch s' + g.turn; }
  else if (S.mode === 'net' && S.net && S.net.status) { text = S.net.status; cls = 'watch'; }
  else if (g.turn === S.mySeat) { text = '輪到您下棋'; cls = 'mine'; }
  else if (S.mySeat < 0) { text = `觀棋中．輪到${who(g.turn)}`; cls = 'watch s' + g.turn; }
  else { text = `換您觀棋（${who(g.turn)} 思考中…）`; cls = 'watch s' + g.turn; }
  banner.textContent = text;
  banner.className = 'turn-banner ' + cls;
  board.setInteractive(canMove());
  // 按鈕
  const playing = (S.mode === 'ai' || S.mode === 'net') && !g.result && S.mySeat >= 0 && !g.out[S.mySeat];
  $('#btnUndo').disabled = S.mode !== 'ai' || !!g.result || S.aiThinking || S.animating || !g.movers.includes(S.mySeat);
  $('#btnResign').disabled = !playing;
  $('#btnHint').disabled = !playing || g.turn !== S.mySeat;
  $('#btnPause').textContent = S.paused ? '▶ 繼續' : '⏸ 暫停';
  $('#btnPause').disabled = S.mode !== 'aivai' || !!g.result;
  const isGuest = S.mode === 'net' && S.net && S.net.role !== 'host';
  $('#btnNew').textContent = S.mode === 'net' ? '再來一局' : '新局';
  $('#btnNew').disabled = ['replay', 'idle'].includes(S.mode) || isGuest || (S.mode === 'net' && !g.result);
  $('#btnNew').title = isGuest ? '由房主開新局' : '';
  $('#btnExport').disabled = !g.moves.length;
  renderClocks();
}

function renderClocks() {
  const g = S.game;
  if (!g || S.mode === 'replay') return;
  $$('.pclock').forEach((el) => {
    const s = Number(el.dataset.seat);
    let ms = S.clocks[s] || 0;
    if (!g.result && S.clockSeat === s && ['ai', 'aivai', 'net'].includes(S.mode) && (S.mode !== 'net' || S.net.started)) ms += Date.now() - S.clockStart;
    const sec = Math.floor(ms / 1000);
    el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  });
}
function tickClock() { if (S.screen === 'game' && S.game) renderClocks(); }

function flashBanner() {
  const b = $('#turnBanner');
  b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
}

function popText(text, color = '') {
  const el = h('div', { class: 'pop', style: color ? { color } : {} }, text);
  $('#boardWrap').append(el);
  setTimeout(() => el.remove(), 1600);
}

function resultText(r) {
  if (!r) return '';
  const name = S.seats[r.winner] ? S.seats[r.winner].name : '';
  const mine = S.mySeat >= 0 && ['ai', 'net'].includes(S.mode) ? r.winner === S.mySeat : null;
  return `${SEAT_NAMES[r.winner]} ${name} 獲勝${mine == null ? '' : mine ? '　🎉 您贏了！' : ''}（${r.reason}）`;
}

async function onGameOver() {
  const g = S.game;
  const r = g.result;
  board.setInteractive(false);
  const mine = S.mySeat >= 0 && ['ai', 'net'].includes(S.mode);
  if (!mine || r.winner === S.mySeat) sfx.win(); else sfx.lose();
  popText(`${SEAT_NAMES[r.winner]}獲勝！`, SEAT_COLORS[r.winner]);
  await saveGame();
  updateGameUI();
  if (S.mode === 'net') chatSys(resultText(r));
  const rank = r.ranking.map((s, i) => `${i + 1}. ${SEAT_NAMES[s]} ${S.seats[s].name}（到岸 ${g.inTarget(s)}/${PIECES}）`).join('\n');
  const btns = S.mode === 'ai' ? [{ label: '檢視棋盤', value: 'stay' }, { label: '再下一局', value: 'again', primary: true }]
    : S.mode === 'aivai' ? [{ label: '檢視棋盤', value: 'stay' }, { label: '再看一局', value: 'again', primary: true }]
    : S.net && S.net.role === 'host' ? [{ label: '檢視棋盤', value: 'stay' }, { label: '再來一局', value: 'again', primary: true }]
    : [{ label: '知道了', value: 'stay', primary: true }];
  const title = !mine ? '對局結束' : r.winner === S.mySeat ? '恭喜獲勝！' : '這局輸了';
  const v = await modal(title, h('div', {},
    h('p', {}, resultText(r)),
    h('pre', { class: 'rank' }, rank),
    h('p', { class: 'muted small' }, '本局棋譜已自動存入棋譜庫，可以重播。')), btns);
  if (v === 'again') newGameSameMode();
}

function recordMeta() {
  return {
    id: S.gameId,
    mode: S.mode,
    names: S.seats.map((s) => s.name),
    kinds: S.seats.map((s) => s.kind),
    mySeat: S.mySeat,
  };
}

async function saveGame() {
  if (S.saved || !S.game || !S.game.moves.length) return;
  if (!['ai', 'net', 'aivai'].includes(S.mode)) return;
  S.saved = true;
  try { await xk.games.save(S.game.toRecord(recordMeta())); } catch (e) { toast('棋譜儲存失敗：' + errMsg(e), 'err'); }
}

async function saveUnfinished() {
  if (S.saved || !S.game || S.game.result || S.game.moves.length < 4) return;
  if (!['ai', 'net', 'aivai'].includes(S.mode)) return;
  S.saved = true;
  try { await xk.games.save(S.game.toRecord(recordMeta())); } catch {}
}

async function leaveGame() {
  const active = (S.mode === 'ai' || S.mode === 'net') && S.game && !S.game.result;
  if (active && (S.game.moves.length || S.mode === 'net')) {
    const msg = S.mode === 'net' ? (S.net && S.net.role === 'host' ? '您是房主，離開後房間會關閉，確定要離開嗎？' : '確定要離開這個房間嗎？') : '這局還沒下完，確定要離開嗎？（棋譜會保留）';
    const ok = await modal('離開對局', msg, [{ label: '留下', value: false }, { label: '離開', value: true, primary: true }]);
    if (!ok) return;
  }
  await saveUnfinished();
  closeNet();
  stopReplayAuto();
  S.mode = null;
  S.game = null;
  document.body.className = document.documentElement.classList.contains('mobile') ? 'is-mobile' : '';
  idleBoard();
  renderHome();
  showScreen('home');
}

function newGameSameMode() {
  if (S.mode === 'ai') startAIGame(S.game.n, S.lastLevel);
  else if (S.mode === 'aivai') startAIvAI(S.lastAivai);
  else if (S.mode === 'net' && S.net && S.net.role === 'host') hostStartGame();
}

// ---------------- 與 AI 對賽 ----------------
function startAIGame(n, level) {
  S.lastLevel = level;
  const seats = Array.from({ length: n }, (_, s) => (s === 0 ? { name: myName(), kind: 'me' } : { name: `小柯 AI ${s}`, kind: 'ai', level }));
  setupGame('ai', n, seats, 0);
  popText('您執紅色，請先走', SEAT_COLORS[0]);
}

// ---------------- AI 對 AI ----------------
function startAIvAI(cfg) {
  cfg = cfg || { n: 2, levels: [2, 2, 2], speed: 'normal' };
  S.lastAivai = cfg;
  const seats = Array.from({ length: cfg.n }, (_, s) => ({ name: `小柯 AI（${lvName(cfg.levels[s])}）`, kind: 'ai', level: cfg.levels[s] }));
  setupGame('aivai', cfg.n, seats, -1);
  S.aivaiDelay = (SPEEDS.find(([v]) => v === cfg.speed) || SPEEDS[1])[2];
  setTimeout(() => maybeAI(), 700);
}

function togglePause() {
  if (S.mode !== 'aivai' || !S.game || S.game.result) return;
  S.paused = !S.paused;
  updateGameUI();
  if (!S.paused) maybeAI();
}

// ---------------- 悔棋、認輸、提示 ----------------
function undo() {
  const g = S.game;
  if (S.mode !== 'ai' || !g || g.result || S.aiThinking || S.animating) return;
  let undone = false;
  while (g.moves.length) {
    const s = g.movers[g.movers.length - 1];
    if (!g.undo()) break;
    if (s === S.mySeat) { undone = true; break; }
  }
  if (!undone) return;
  S.recent = [[], [], []];
  board.setPosition(g.board);
  const k = g.paths.length - 1;
  board.setLastMove(k >= 0 ? g.paths[k] : null, k >= 0 ? g.movers[k] : -1);
  board.setHint(-1);
  S.clockSeat = g.turn;
  updateGameUI();
}

async function resign() {
  const g = S.game;
  if (!g || g.result || S.mySeat < 0) return;
  const ok = await modal('認輸', g.n === 3 && S.mode === 'net' ? '確定要認輸嗎？您的棋子會從棋盤上拿走，其他兩方繼續比賽。' : '確定要認輸嗎？', [{ label: '取消', value: false }, { label: '認輸', value: true, primary: true }]);
  if (!ok || g.result) return;
  if (S.mode === 'net') S.room.send({ t: 'resign', seat: S.mySeat });
  doResign(S.mySeat);
  if (S.mode === 'ai' && !g.result) { g.finishByProgress('您認輸'); await onGameOver(); }
}

async function doResign(seat, reason) {
  const g = S.game;
  if (!g || g.result || g.out[seat]) return;
  const removed = g.resign(seat, reason);
  board.removeMarbles(removed);
  chatSys(`${SEAT_NAMES[seat]} ${S.seats[seat].name} ${reason || '認輸'}`);
  S.clockSeat = g.turn;
  updateGameUI();
  if (g.result) await onGameOver();
  else maybeAI();
}

async function hint() {
  const g = S.game;
  if (!g || g.result || g.turn !== S.mySeat) return;
  $('#btnHint').disabled = true;
  try {
    const lines = await engineAna.analyze({ board: Array.from(g.board), n: g.n, turn: g.turn, out: g.out, recent: S.recent[g.turn] }, 1, 3);
    if (lines[0] && S.game === g && g.turn === S.mySeat) {
      const m = lines[0].move;
      showHint(m);
      const jumps = isStep(mvFrom(m), mvTo(m)) ? '' : '（跳躍）';
      toast(`提示：${cellName(mvFrom(m))} → ${cellName(mvTo(m))}${jumps}`, 'ok');
    }
  } finally { updateGameUI(); }
}

function showHint(m) {
  if (m == null || m < 0) return;
  board.setHint(mvFrom(m), mvTo(m));
  clearTimeout(S.hintTimer);
  S.hintTimer = setTimeout(() => board.setHint(-1), 12000);
}

// ---------------- 遠端對賽 ----------------
function netWait(content) {
  const w = $('#netWait');
  if (!w) return;
  w.classList.toggle('hidden', !content);
  w.innerHTML = '';
  if (content) w.append(content);
}

function memberOfSeat(s) { return S.net.members.find((m) => m.seat === s); }

function renderLobby() {
  if (!S.net || S.net.started || S.screen !== 'home') return;
  const host = S.net.role === 'host';
  const rows = [];
  for (let s = 0; s < S.net.n; s++) {
    const m = memberOfSeat(s);
    rows.push(h('div', { class: 'seat-row' + (m ? '' : ' wait'), style: { '--mc': SEAT_COLORS[s] } },
      h('span', { class: 'dot' }),
      h('span', { class: 'who' }, m ? m.name : '等待加入…'),
      h('span', { class: 'kind' }, m ? (s === 0 ? '房主' : m.id === S.room.myId ? '我' : '遠端') : `開始時由 AI（${lvName(S.net.aiLevel)}）代下`)));
  }
  const watchers = S.net.members.filter((m) => m.seat < 0);
  const content = h('div', {},
    h('div', { class: 'lobby-head' }, h('b', {}, `房號`), h('span', { class: 'muted small' }, `${S.net.n} 人比賽`)),
    h('div', { class: 'room-code' }, S.net.code.replace(/(\d{3})(\d{3})/, '$1 $2')),
    h('div', { class: 'seat-list' }, rows),
    watchers.length ? h('div', { class: 'muted small' }, `觀棋者：${watchers.map((w) => w.name).join('、')}`) : null,
    host
      ? h('div', { class: 'net-row' },
        h('button', { onclick: () => { navigator.clipboard.writeText(S.net.code); toast('已複製房號', 'ok'); } }, '複製房號'),
        h('button', { onclick: () => { closeNet(); netWait(null); } }, '取消'),
        h('button', { class: 'primary', id: 'btnStartNet', onclick: () => hostStartGame() }, '開始比賽'))
      : h('div', { class: 'net-row' }, h('span', { class: 'muted small spin' }, '等待房主開始比賽…'), h('button', { onclick: () => { closeNet(); netWait(null); } }, '離開')),
    host ? h('div', { class: 'muted small' }, '請把房號告訴朋友，對方在「加入房間」輸入即可。比賽開始後加入的人會成為觀棋者。') : null);
  netWait(content);
}

function renderMembers() {
  const box = $('#memberList');
  if (!box || !S.net || !S.room) return;
  box.innerHTML = '';
  for (const m of S.net.members) {
    box.append(h('span', { class: 'member' + (m.voice ? ' voice' : ''), style: { '--mc': m.seat >= 0 ? SEAT_COLORS[m.seat] : '#999' }, title: m.voice ? '語音中' : '' },
      h('span', { class: 'dot' }), `${m.name}${m.seat < 0 ? '（觀棋）' : ''}${m.id === S.room.myId ? '（我）' : ''}`));
  }
  const n = S.net.members.filter((m) => m.voice).length;
  $('#voiceState').textContent = S.voice.on ? `🟢 語音中（${n} 人）` : n ? `語音：${n} 人通話中` : '語音：未通話';
}

async function hostRoom(cfg) {
  closeNet();
  netWait(h('span', {}, '正在建立房間…'));
  const room = new Room(S.settings);
  S.room = room;
  try {
    const code = await room.host();
    S.net = { role: 'host', code, n: cfg.n, aiLevel: cfg.aiLevel, started: false, members: [{ id: room.myId, name: myName(), seat: 0, voice: false }], mySeat: 0 };
    room.on('member-msg', (id, m) => queueNet(() => onHostMsg(id, m)));
    room.on('member-lost', (id, reason) => queueNet(() => onMemberLost(id, reason)));
    room.on('call', (call) => onVoiceCall(call));
    renderLobby();
  } catch (e) {
    netWait(h('span', { class: 'err' }, '建立房間失敗：' + errMsg(e)));
    S.room = null;
  }
}

function broadcastRoster() {
  if (!S.net || S.net.role !== 'host') return;
  S.room.send({ t: 'roster', members: S.net.members, n: S.net.n, aiLevel: S.net.aiLevel, started: S.net.started });
  renderLobby();
  renderMembers();
}

// 房主：開始（或再來一局）
function hostStartGame() {
  if (!S.net || S.net.role !== 'host') return;
  const n = S.net.n;
  const names = [], kinds = [], levels = [];
  for (let s = 0; s < n; s++) {
    const m = memberOfSeat(s);
    names.push(m ? m.name : `小柯 AI（${lvName(S.net.aiLevel)}）`);
    kinds.push(m ? 'human' : 'ai');
    levels.push(S.net.aiLevel);
  }
  const start = { t: 'start', gameId: newGameId(), n, names, kinds, levels, moves: [] };
  S.net.started = true;
  S.net.curStart = start;
  S.room.send(start);
  startNetGame(start);
  broadcastRoster();
}

function startNetGame(m) {
  const mySeat = S.net.mySeat ?? -1;
  const seats = m.names.map((name, s) => ({
    name,
    kind: s === mySeat ? 'me' : m.kinds[s] === 'ai' ? 'ai' : 'remote',
    level: m.levels[s],
    left: m.kinds[s] === 'ai' && !String(name).startsWith('小柯 AI'),
  }));
  S.net.curStart = m;
  S.net.started = true;
  S.net.status = '';
  setupGame('net', m.n, seats, mySeat, { gameId: m.gameId });
  const g = S.game;
  for (const mv of m.moves || []) {
    if (g.result) break;
    if (mv <= -2) g.resign(-2 - mv);
    else if (mv !== PASS && g.legalMoves().includes(mv)) g.play(mv);
  }
  board.setPosition(g.board);
  const k = g.paths.length - 1;
  if (k >= 0) board.setLastMove(g.paths[k], g.movers[k]);
  netWait(null);
  renderMembers();
  if (!(m.moves || []).length) {
    chatSys(mySeat >= 0 ? `比賽開始！您是${SEAT_NAMES[mySeat]}${mySeat === 0 ? '，請先走' : '，紅方先走'}。` : '比賽開始！您是觀棋者。');
    popText(mySeat >= 0 ? `您是${SEAT_NAMES[mySeat]}` : '觀棋中', mySeat >= 0 ? SEAT_COLORS[mySeat] : '');
  } else chatSys('已同步目前的棋局');
  updateGameUI();
  if (mySeat >= 0 && g.turn === mySeat) sfx.turn();
  xk.win.attention('比賽開始', mySeat >= 0 ? `您是${SEAT_NAMES[mySeat]}` : '觀棋中');
  if (g.result) onGameOver(); else maybeAI();
}

// 網路訊息一則一則處理；走法要等上一步動畫結束再套用
let netChain = Promise.resolve();
function queueNet(fn) { netChain = netChain.then(fn).catch((e) => console.error('net msg', e)); }
async function whenIdle() { while (S.animating) await sleep(40); }

async function onHostMsg(id, m) {
  const g = S.game;
  const mem = S.net.members.find((x) => x.id === id);
  switch (m.t) {
    case 'hello': {
      if (m.ver !== PROTOCOL) { S.room.sendTo(id, { t: 'old', text: '雙方程式版本不同，請先更新到最新版。' }); setTimeout(() => S.room.kick(id), 400); return; }
      const name = String(m.name || '棋友').slice(0, 16);
      let seat = -1;
      if (!S.net.started) {
        for (let s = 1; s < S.net.n; s++) if (!memberOfSeat(s)) { seat = s; break; }
      } else if (g && !g.result) {
        // 斷線重連：拿回原本的座位
        const s = S.seats.findIndex((st) => st.kind === 'ai' && st.left && st.leftName === name);
        if (s >= 0 && !memberOfSeat(s)) { seat = s; S.seats[s].kind = 'remote'; S.seats[s].left = false; S.seats[s].name = name; S.net.curStart.kinds[s] = 'human'; S.net.curStart.names[s] = name; }
      }
      S.net.members.push({ id, name, seat, voice: false });
      S.room.sendTo(id, { t: 'welcome', seat });
      if (S.net.started && g) {
        S.room.sendTo(id, { ...S.net.curStart, moves: g.moves.filter((x) => x !== PASS) });
        if (seat >= 0) { S.room.send({ t: 'seat-back', seat, name }, id); chatSys(`${name} 回來了，接回${SEAT_NAMES[seat]}`); updateGameUI(); }
        else chatSys(`${name} 加入觀棋`);
      }
      broadcastRoster();
      break;
    }
    case 'move': {
      await whenIdle();
      if (!g || !mem || g.result || S.game !== g) return;
      if (mem.seat !== g.turn || m.seat !== mem.seat || m.ply !== g.moves.length || !g.legalMoves().includes(m.m)) {
        S.room.sendTo(id, { t: 'sync', moves: g.moves.filter((x) => x !== PASS) });
        return;
      }
      S.room.send({ t: 'move', ply: m.ply, seat: mem.seat, m: m.m }, id);
      await applyMove(m.m);
      break;
    }
    case 'sel':
      if (mem && g && mem.seat === g.turn) { S.room.send({ t: 'sel', seat: mem.seat, cell: m.cell }, id); board.setPeerSelected(m.cell); }
      break;
    case 'resign':
      await whenIdle();
      if (mem && mem.seat >= 0 && g && !g.result) { S.room.send({ t: 'resign', seat: mem.seat }, id); doResign(mem.seat); }
      break;
    case 'chat': {
      if (!mem) return;
      const text = String(m.text || '').slice(0, 500);
      S.room.send({ t: 'chat', name: mem.name, seat: mem.seat, text }, id);
      chatLine(mem.name, mem.seat, text, false);
      break;
    }
    case 'voice':
      if (mem) { mem.voice = !!m.on; broadcastRoster(); }
      break;
    case 'sync-req':
      if (g) S.room.sendTo(id, { t: 'sync', moves: g.moves.filter((x) => x !== PASS) });
      break;
  }
}

function onMemberLost(id, reason) {
  const i = S.net.members.findIndex((x) => x.id === id);
  if (i < 0) return;
  const mem = S.net.members[i];
  S.net.members.splice(i, 1);
  closeCall(id);
  const g = S.game;
  if (S.net.started && mem.seat >= 0 && g && !g.result && S.mode === 'net') {
    const st = S.seats[mem.seat];
    st.kind = 'ai'; st.left = true; st.leftName = mem.name; st.level = S.net.aiLevel;
    S.net.curStart.kinds[mem.seat] = 'ai';
    S.room.send({ t: 'seat-ai', seat: mem.seat, name: mem.name });
    chatSys(`${mem.name}（${SEAT_NAMES[mem.seat]}）${reason}，暫時由 AI 代下`);
    updateGameUI();
    maybeAI();
  } else if (S.screen === 'game') chatSys(`${mem.name} 離開了`);
  broadcastRoster();
}

async function joinRoom(code) {
  closeNet();
  netWait(h('span', {}, '正在連線…'));
  const room = new Room(S.settings);
  S.room = room;
  S.net = { role: 'guest', code: String(code).replace(/\D/g, ''), n: 2, members: [], started: false, mySeat: -1 };
  room.on('connected', () => room.send({ t: 'hello', name: myName(), ver: PROTOCOL }));
  room.on('msg', (m) => queueNet(() => onGuestMsg(m)));
  room.on('lost', (reason) => {
    if (S.room !== room) return;
    endVoice();
    if (S.screen === 'game' && S.mode === 'net') {
      S.net.status = '⚠ ' + reason + '，比賽中斷';
      chatSys(reason);
      updateGameUI();
      toast(reason, 'err', 6000);
    } else netWait(h('span', { class: 'err' }, reason));
  });
  room.on('call', (call) => onVoiceCall(call));
  try {
    await room.join(code);
  } catch (e) {
    netWait(h('span', { class: 'err' }, errMsg(e)));
    S.room = null;
    room.close();
  }
}

async function onGuestMsg(m) {
  const g = S.game;
  switch (m.t) {
    case 'full': netWait(h('span', { class: 'err' }, '這個房間人數已滿')); closeNet(); break;
    case 'old': netWait(h('span', { class: 'err' }, m.text || '版本不相容')); toast(m.text || '版本不相容', 'err', 8000); break;
    case 'end':
      if (S.mode === 'net') { S.net.status = '⚠ 房主已關閉房間'; chatSys('房主已關閉房間'); updateGameUI(); }
      else netWait(h('span', { class: 'err' }, '房主已關閉房間'));
      break;
    case 'welcome': S.net.mySeat = m.seat; break;
    case 'roster':
      S.net.members = m.members || [];
      S.net.n = m.n;
      S.net.aiLevel = m.aiLevel;
      renderLobby();
      renderMembers();
      break;
    case 'start':
      startNetGame(m);
      break;
    case 'move': {
      await whenIdle();
      if (!g || S.mode !== 'net' || g.result || S.game !== g) return;
      if (m.ply !== g.moves.length || m.seat !== g.turn || !g.legalMoves().includes(m.m)) { S.room.send({ t: 'sync-req' }); return; }
      await applyMove(m.m);
      break;
    }
    case 'sync': {
      await whenIdle();
      if (!S.net.curStart) return;
      startNetGame({ ...S.net.curStart, moves: m.moves });
      break;
    }
    case 'sel': if (g && m.seat === g.turn && m.seat !== S.mySeat) board.setPeerSelected(m.cell); break;
    case 'resign': await whenIdle(); doResign(m.seat); break;
    case 'seat-ai':
      if (S.seats[m.seat]) { Object.assign(S.seats[m.seat], { kind: 'ai', left: true }); chatSys(`${m.name}（${SEAT_NAMES[m.seat]}）離線，暫時由 AI 代下`); updateGameUI(); }
      if (S.net.curStart) S.net.curStart.kinds[m.seat] = 'ai';
      break;
    case 'seat-back':
      if (S.seats[m.seat]) { Object.assign(S.seats[m.seat], { kind: m.seat === S.mySeat ? 'me' : 'remote', left: false, name: m.name }); chatSys(`${m.name} 回來了，接回${SEAT_NAMES[m.seat]}`); updateGameUI(); }
      break;
    case 'chat': chatLine(m.name, m.seat, String(m.text || '').slice(0, 500), false); break;
  }
}

function closeNet() {
  endVoice();
  if (S.room) {
    if (S.net && S.net.role === 'host') S.room.send({ t: 'end' });
    S.room.close();
    S.room = null;
  }
  if (S.net) S.net.started = false;
}

// ---------------- 文字聊天 ----------------
function chatLine(name, seat, text, me) {
  const log = $('#chatLog');
  log.append(h('div', { class: 'chat-msg' + (me ? ' me' : ''), style: { '--mc': seat >= 0 ? SEAT_COLORS[seat] : '#bbb' } },
    h('b', {}, me ? '我' : `${name}${seat < 0 ? '（觀棋）' : ''}`), h('span', {}, text)));
  log.scrollTop = log.scrollHeight;
  if (!me && !$('#pane-chat').classList.contains('on')) $('.tab[data-tab="chat"]').classList.add('ping');
}
function chatSys(text) {
  const log = $('#chatLog');
  log.append(h('div', { class: 'chat-msg sys' }, text));
  log.scrollTop = log.scrollHeight;
}
function sendChat() {
  const inp = $('#chatInput');
  const text = inp.value.trim();
  if (!text || !S.room || !S.room.connected) return;
  if (S.net.role === 'host') S.room.send({ t: 'chat', name: myName(), seat: S.net.mySeat, text });
  else S.room.send({ t: 'chat', text });
  chatLine(myName(), S.net.mySeat, text, true);
  inp.value = '';
}

// ---------------- 語音通話（多人，兩兩直連） ----------------
async function getMic() {
  await xk.sys.askMicrophone();
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
}

function announceVoice(on) {
  if (!S.net || !S.room) return;
  if (S.net.role === 'host') {
    const me = S.net.members.find((x) => x.id === S.room.myId);
    if (me) me.voice = on;
    broadcastRoster();
  } else S.room.send({ t: 'voice', on });
}

function setVoiceUI() {
  $('#btnVoice').textContent = S.voice.on ? '⏹ 離開語音' : '🎤 加入語音';
  $('#btnMute').classList.toggle('hidden', !S.voice.on);
  $('#voiceBar').classList.toggle('on', S.voice.on);
  if (music) music.setDuck(S.voice.on && S.voice.calls.size > 0);
  renderMembers();
}

async function toggleVoice() {
  if (S.voice.on) { endVoice(); return; }
  if (!S.room || !S.room.connected) { toast('尚未連線', 'err'); return; }
  try {
    S.voice.mic = await getMic();
  } catch (e) { toast('無法開啟麥克風：' + errMsg(e), 'err'); return; }
  S.voice.on = true;
  announceVoice(true);
  // 打給已經在語音中的人
  for (const m of S.net.members) if (m.voice && m.id !== S.room.myId && !S.voice.calls.has(m.id)) setupCall(m.id, S.room.call(m.id, S.voice.mic));
  setVoiceUI();
  chatSys('您已加入語音通話');
}

function onVoiceCall(call) {
  if (!S.voice.on || !S.voice.mic) { try { call.close(); } catch {} return; }
  if (S.voice.calls.has(call.peer)) closeCall(call.peer);
  call.answer(S.voice.mic);
  setupCall(call.peer, call);
}

function setupCall(id, call) {
  S.voice.calls.set(id, call);
  call.on('stream', (stream) => {
    let a = document.getElementById('aud-' + id);
    if (!a) { a = h('audio', { id: 'aud-' + id, autoplay: true }); $('#remoteAudios').append(a); }
    a.srcObject = stream;
    a.play().catch(() => {});
    setVoiceUI();
  });
  call.on('close', () => { if (S.voice.calls.get(id) === call) closeCall(id); });
  call.on('error', () => { if (S.voice.calls.get(id) === call) closeCall(id); });
}

function closeCall(id) {
  const c = S.voice.calls.get(id);
  S.voice.calls.delete(id);
  if (c) { try { c.close(); } catch {} }
  const a = document.getElementById('aud-' + id);
  if (a) { a.srcObject = null; a.remove(); }
  if (music) setVoiceUI();
}

function toggleMute() {
  if (!S.voice.mic) return;
  const t = S.voice.mic.getAudioTracks()[0];
  t.enabled = !t.enabled;
  $('#btnMute').textContent = t.enabled ? '🔇 靜音' : '🔈 取消靜音';
}

function endVoice() {
  const was = S.voice.on;
  for (const id of [...S.voice.calls.keys()]) closeCall(id);
  if (S.voice.mic) { S.voice.mic.getTracks().forEach((t) => t.stop()); S.voice.mic = null; }
  S.voice.on = false;
  if (was) { announceVoice(false); if (S.screen === 'game') chatSys('已離開語音通話'); }
  if (music) setVoiceUI();
}

// ---------------- 棋譜庫 ----------------
const MODE_NAME = { ai: 'AI 對賽', net: '遠端對賽', aivai: 'AI 對 AI', import: '匯入' };
function namesHtml(names, n) {
  return h('span', {}, ...Array.from({ length: n }, (_, s) => h('span', { class: 'rec-name', style: { color: SEAT_COLORS[s] } }, (names[s] || SEAT_NAMES[s]) + (s < n - 1 ? '、' : ''))));
}

async function renderRecords() {
  const body = $('#recordsBody');
  body.innerHTML = '';
  const list = await xk.games.list();
  body.append(h('div', { class: 'rec-head' },
    h('div', {}, h('h2', {}, '📜 棋譜庫'), h('p', { class: 'muted' }, '每下完一局都會自動收錄，可以重播、匯出、匯入。')),
    h('div', { class: 'rec-actions' },
      h('button', { onclick: importRecords }, '匯入棋譜'),
      h('button', { onclick: () => showScreen('home') }, '返回首頁'))));
  if (!list.length) {
    body.append(h('div', { class: 'empty' }, '還沒有棋譜。每下完一局都會自動收錄在這裡。'));
    return;
  }
  body.append(h('div', { class: 'rec-wrap' }, h('table', { class: 'rec-table' },
    h('thead', {}, h('tr', {}, ...['日期', '類型', '人數', '參賽者', '結果', '步數', ''].map((t) => h('th', {}, t)))),
    h('tbody', {}, list.map((g) => h('tr', {},
      h('td', {}, fmtDate(g.date)),
      h('td', {}, MODE_NAME[g.mode] || g.mode || ''),
      h('td', {}, `${g.n} 人`),
      h('td', {}, namesHtml(g.names, g.n)),
      h('td', { class: 'res' }, g.result ? `${SEAT_NAMES[g.result.winner]}勝` : '未完成'),
      h('td', {}, String(g.plies)),
      h('td', { class: 'ops' },
        h('button', { onclick: () => openReplay(g.id) }, '重播'),
        h('button', { onclick: () => exportRecord(g.id) }, '匯出'),
        h('button', { class: 'danger', onclick: async () => { if (await modal('刪除棋譜', '確定刪除這份棋譜？', [{ label: '取消', value: false }, { label: '刪除', value: true, primary: true }])) { await xk.games.delete(g.id); renderRecords(); } } }, '刪除'))))))));
}

function recordText(rec) {
  const g = replayRecord(rec);
  const names = rec.names || [];
  const lines = [`[${APP_NAME} 棋譜]`, `日期：${fmtDate(rec.date)}`, `人數：${rec.n}`,
    ...Array.from({ length: rec.n }, (_, s) => `${SEAT_NAMES[s]}：${names[s] || ''}`),
    `結果：${rec.result ? `${SEAT_NAMES[rec.result.winner]}勝（${rec.result.reason}）` : '未完成'}`, ''];
  g.notes.forEach((n, i) => lines.push(`${i + 1}. ${n}`));
  lines.push('', '資料：' + JSON.stringify({ kind: 'checkers', n: rec.n, names, moves: rec.moves, result: rec.result, date: rec.date }));
  return lines.join('\r\n');
}

async function exportRecord(id) {
  const rec = await xk.games.get(id);
  if (!rec) return;
  const p = await xk.games.export(`跳棋棋譜_${(rec.id || '').slice(0, 12)}.txt`, recordText(rec));
  if (p) toast('已匯出：' + p, 'ok', 5000);
}

async function exportCurrent() {
  if (S.mode === 'replay') return exportRecord(S.replay.rec.id);
  const g = S.game;
  if (!g || !g.moves.length) return;
  const p = await xk.games.export(`跳棋棋譜_${S.gameId.slice(0, 12)}.txt`, recordText(g.toRecord(recordMeta())));
  if (p) toast('已匯出：' + p, 'ok', 5000);
}

async function importRecords() {
  const files = await xk.games.pickImport();
  if (!files.length) return;
  let ok = 0, bad = 0;
  for (const f of files) {
    try {
      if (f.error) throw new Error(f.error);
      const t = f.text.trim();
      let data = null;
      if (t.startsWith('{') || t.startsWith('[')) data = JSON.parse(t);
      else { const m = /資料[:：]\s*(\{.*\})\s*$/m.exec(t); if (m) data = JSON.parse(m[1]); }
      if (!data) throw new Error('無法辨識');
      for (const r of Array.isArray(data) ? data : [data]) {
        if (![2, 3].includes(r.n) || !Array.isArray(r.moves)) { bad++; continue; }
        const g = replayRecord(r);
        if (!g.moves.length) { bad++; continue; }
        await xk.games.save(g.toRecord({ mode: 'import', names: r.names || [], mySeat: -1, date: r.date }));
        ok++;
      }
    } catch { bad++; }
  }
  toast(`匯入 ${ok} 份棋譜${bad ? `，${bad} 份無法辨識` : ''}`, ok ? 'ok' : 'err');
  renderRecords();
}

// ---------------- 棋譜重播 ----------------
async function openReplay(id) {
  const rec = await xk.games.get(id);
  if (!rec) return;
  const full = replayRecord(rec);
  const seats = Array.from({ length: rec.n }, (_, s) => ({ name: (rec.names || [])[s] || SEAT_NAMES[s], kind: 'replay' }));
  S.replay = { rec, game: full, ply: 0, timer: 0 };
  setupGame('replay', rec.n, seats, -1);
  if (rec.mySeat >= 0) board.setFacing(full.homes[rec.mySeat]);
  replayGo(0);
  if (full.result) toast(resultText(full.result));
}

function replayGo(ply) {
  const r = S.replay;
  if (!r) return;
  ply = Math.max(0, Math.min(r.rec.moves.length, ply));
  const g = replayRecord(r.rec, ply);
  const forward = ply === r.ply + 1;
  r.ply = ply;
  r.game = g;
  S.game = g;
  const k = g.paths.length - 1;
  if (forward && k >= 0 && g.paths[k]) {
    board.animatePath(g.paths[k]).then(() => sfx.step());
  } else board.setPosition(g.board);
  board.setLastMove(k >= 0 ? g.paths[k] : null, k >= 0 ? g.movers[k] : -1);
  updateGameUI();
}

function replayAuto() {
  const r = S.replay;
  if (!r) return;
  if (r.timer) { stopReplayAuto(); return; }
  $('#rpPlay').textContent = '⏸';
  r.timer = setInterval(() => {
    if (r.ply >= r.rec.moves.length) { stopReplayAuto(); return; }
    replayGo(r.ply + 1);
  }, 1100);
}
function stopReplayAuto() {
  if (S.replay && S.replay.timer) { clearInterval(S.replay.timer); S.replay.timer = 0; }
  const b = $('#rpPlay'); if (b) b.textContent = '▶';
}

// ---------------- 關於與版本更新 ----------------
async function openAbout() {
  const status = h('div', { class: 'upd-status muted' }, '正在檢查是否有新版本…');
  const body = h('div', { class: 'about' },
    h('div', { class: 'about-head' }, h('div', { class: 'hero-marbles small' }, h('i'), h('i'), h('i')),
      h('div', {}, h('h2', {}, APP_NAME), h('div', { class: 'muted' }, `版本 v${S.info.version}　（${S.info.platform === 'darwin' ? 'macOS' : S.info.platform === 'win32' ? 'Windows' : S.info.platform}）`))),
    h('p', { class: 'credit-line' }, CREDIT),
    h('p', { class: 'muted small' }, '3D 中國跳棋：2～3 人對戰；與 AI 對賽、遠端邀請一位或兩位朋友參賽（空位 AI 代下、可觀棋、語音與文字聊天）、AI 與 AI 對賽；20 首原創背景音樂；AI 軍師；自動收錄棋譜。'),
    h('p', { class: 'muted small' }, 'AI 演算法參考：github.com/Crazylitm/jumpchess　棋盤參考：github.com/ghh3809/Chinese-Checkers'),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: S.settings.autoUpdate !== false, onchange: (e) => saveSettings({ autoUpdate: e.target.checked }) }), ' 開啟程式時自動檢查新版本'),
    status);
  const p = modal('關於與更新', body, [{ label: '關閉', value: false, primary: true }]);
  checkUpdate(true, status);
  await p;
}

async function checkUpdate(manual, statusEl) {
  let info;
  try { info = await xk.update.check(); }
  catch (e) { if (statusEl) statusEl.textContent = '無法檢查更新：' + errMsg(e); return; }
  if (!info.newer) { if (statusEl) statusEl.textContent = `✅ 已經是最新版本（v${info.current}）`; return; }
  const go = () => startUpdate(info);
  if (statusEl) {
    statusEl.innerHTML = '';
    statusEl.append(h('span', {}, `🔔 有新版本 v${info.latest}（目前 v${info.current}）　`),
      h('button', { class: 'primary', id: 'btnDoUpdate', onclick: () => { $$('.modal-back').forEach((b) => b.remove()); go(); } }, '立即更新'));
    return;
  }
  const v = await modal(`發現新版本 v${info.latest}`, h('div', {},
    h('p', {}, `目前版本 v${info.current}，要更新到 v${info.latest} 嗎？`),
    info.notes ? h('pre', { class: 'upd-notes' }, info.notes) : null), [{ label: '稍後再說', value: false }, { label: '立即更新', value: true, primary: true }]);
  if (v) go();
}

async function startUpdate(info) {
  if (info.flavor === 'ios') {
    const v = await modal('更新到新版本', h('div', {},
      h('p', {}, `會用 Safari 打開安裝頁，按紅色的「安裝」就會更新到 v${info.latest}。`),
      h('p', { class: 'muted small' }, '棋譜與設定都會保留。')), [{ label: '取消', value: false }, { label: '開啟安裝頁', value: true, primary: true }]);
    if (v) xk.update.openPage();
    return;
  }
  if (!info.canInstall) {
    const v = await modal('下載新版本', h('p', {}, info.flavor === 'dev' ? '目前是開發版，請到 GitHub 下載安裝檔。' : '找不到這個平台的安裝檔，請到 GitHub 下載。'), [{ label: '取消', value: false }, { label: '開啟下載頁', value: true, primary: true }]);
    if (v) xk.update.openPage();
    return;
  }
  const bar = h('div', { class: 'upd-bar' }, h('div', { class: 'upd-fill' }));
  const txt = h('div', { class: 'muted small' }, '準備下載…');
  const box = h('div', { class: 'upd-box' }, h('b', {}, `正在下載 v${info.latest}`), bar, txt);
  document.body.append(box);
  const off = xk.update.onProgress(({ got, total }) => {
    const pct = total ? Math.floor((got / total) * 100) : 0;
    bar.firstChild.style.width = pct + '%';
    txt.textContent = `${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB（${pct}%）`;
  });
  try {
    const file = await xk.update.download();
    off();
    await saveUnfinished();
    txt.textContent = info.flavor === 'mac' ? '下載完成，正在開啟安裝檔…' : '下載完成，正在安裝，程式會自動重新開啟…';
    const r = await xk.update.install(file);
    if (r.manual && r.android) {
      box.remove();
      await modal('請完成安裝', h('p', {}, '新版已下載完成，請在跳出的畫面按「安裝」（第一次會先請您允許安裝），棋譜與設定都會保留。'));
    } else if (r.manual) {
      box.remove();
      await modal('請完成安裝', h('div', {},
        h('p', {}, '新版安裝檔已開啟（也放在「下載」資料夾）。'),
        h('p', {}, info.flavor === 'mac' ? `請先結束本程式，再把「${APP_NAME}」拖到「應用程式」資料夾覆蓋舊版。` : '請依照畫面指示完成安裝。')));
    }
  } catch (e) {
    off();
    box.remove();
    toast('更新失敗：' + errMsg(e), 'err', 8000);
  }
}

// ---------------- 設定 ----------------
async function openSettings() {
  const s = S.settings;
  const f = {};
  const row = (label, el, tip) => h('div', { class: 'set-row' }, h('label', {}, label), el, tip ? h('div', { class: 'muted small' }, tip) : null);
  f.name = h('input', { value: s.playerName });
  f.sfx = h('input', { type: 'checkbox', checked: s.sfx });
  f.autoplay = h('input', { type: 'checkbox', checked: s.music.autoplay });
  f.autoUpdate = h('input', { type: 'checkbox', checked: s.autoUpdate !== false });
  f.key = h('input', { type: 'password', placeholder: s.advisor.hasKey ? '（已設定，留空表示不變更）' : 'sk-ant-…' });
  f.model = h('select', {}, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((m) => h('option', { value: m, selected: s.advisor.model === m }, m)));
  f.effort = h('select', {}, [['low', '快速（low）'], ['medium', '一般（medium）'], ['high', '深入（high）']].map(([v, l]) => h('option', { value: v, selected: s.advisor.effort === v }, l)));
  f.srvMode = h('select', {}, h('option', { value: 'public', selected: s.server.mode !== 'custom' }, '公用配對伺服器（PeerJS Cloud）'), h('option', { value: 'custom', selected: s.server.mode === 'custom' }, '自架伺服器'));
  f.host = h('input', { value: s.server.host, placeholder: '例如 peer.example.com' });
  f.port = h('input', { value: s.server.port, type: 'number', style: { width: '90px' } });
  f.path = h('input', { value: s.server.path, style: { width: '90px' } });
  f.secure = h('input', { type: 'checkbox', checked: s.server.secure });
  f.stun = h('textarea', { rows: 2, value: s.stun });
  f.turnUrls = h('input', { value: s.turn.urls, placeholder: 'turn:turn.example.com:3478' });
  f.turnUser = h('input', { value: s.turn.username, placeholder: '帳號' });
  f.turnPass = h('input', { type: 'password', value: s.turn.credential, placeholder: '密碼' });
  const testOut = h('div', { class: 'muted small' });
  const body = h('div', { class: 'settings' },
    h('h4', {}, '一般'),
    row('我的暱稱', f.name),
    row('音效', h('label', { class: 'chk' }, f.sfx, ' 彈珠落孔、跳躍音效')),
    row('背景音樂', h('label', { class: 'chk' }, f.autoplay, ' 開啟程式後自動播放')),
    row('版本更新', h('label', { class: 'chk' }, f.autoUpdate, ' 開啟程式時自動檢查新版本')),
    h('h4', {}, 'AI 軍師（Claude）'),
    row('Anthropic API 金鑰', f.key, s.advisor.envKey && !s.advisor.hasKey ? '已偵測到環境變數 ANTHROPIC_API_KEY。' : '金鑰會加密存在本機，只用來呼叫 Claude。沒有金鑰時軍師仍會提供本機 AI 的建議。'),
    row('模型', f.model),
    row('思考深度', f.effort),
    h('div', { class: 'set-row' }, h('label', {}, ''), h('button', { onclick: async () => { testOut.textContent = '測試中…'; await applySettings(f); const r = await xk.advisor.test(); testOut.textContent = r.ok ? `✅ ${r.text}` : `❌ ${r.error}`; } }, '測試金鑰'), testOut),
    h('h4', {}, '遠端對賽連線'),
    row('配對伺服器', f.srvMode),
    row('自架伺服器', h('div', { class: 'inline' }, f.host, f.port, f.path, h('label', { class: 'chk' }, f.secure, ' HTTPS'))),
    row('STUN', f.stun),
    row('TURN（跨網路連不上時）', h('div', { class: 'inline' }, f.turnUrls, f.turnUser, f.turnPass)),
    h('p', { class: 'credit-line small' }, `${APP_NAME} v${S.info.version}．${CREDIT}`),
  );
  const ok = await modal('設定', body, [{ label: '取消', value: false }, { label: '儲存', value: true, primary: true }]);
  if (ok) { await applySettings(f); toast('設定已儲存', 'ok'); renderHome(); }
}

async function applySettings(f) {
  const patch = {
    playerName: f.name.value.trim() || '棋友',
    sfx: f.sfx.checked,
    autoUpdate: f.autoUpdate.checked,
    music: { autoplay: f.autoplay.checked },
    advisor: { model: f.model.value, effort: f.effort.value },
    server: { mode: f.srvMode.value, host: f.host.value.trim(), port: Number(f.port.value) || 9000, path: f.path.value.trim() || '/', secure: f.secure.checked },
    stun: f.stun.value,
    turn: { urls: f.turnUrls.value.trim(), username: f.turnUser.value.trim(), credential: f.turnPass.value },
  };
  if (f.key.value.trim()) patch.advisor.apiKey = f.key.value.trim();
  await saveSettings(patch);
  f.key.value = '';
  setSfx(S.settings.sfx);
  advisor.setHasKey(S.settings.advisor.hasKey);
}

window.addEventListener('beforeunload', () => { closeNet(); });
init().catch((e) => { console.error(e); document.body.append(h('pre', { class: 'fatal' }, '啟動失敗：' + (e.stack || e))); });
