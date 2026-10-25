// 遠端對賽連線：PeerJS（WebRTC）
// 房主（host）是中心：其他人（參賽者、觀棋者）都連到房主，訊息由房主轉送。
// 語音通話則是每兩人直接相連（mesh），最多 3 位參賽者＋觀棋者。
import { Emitter, errMsg } from './util.js';

const PeerCtor = () => window.Peer || (window.peerjs && window.peerjs.Peer);
export const PREFIX = 'xkjump-';
export const PROTOCOL = 1;
export const MAX_MEMBERS = 8; // 房主以外最多幾人（參賽＋觀棋）

export function iceServers(s) {
  const list = String(s.stun || '').split(/\s+/).filter(Boolean).map((u) => ({ urls: u }));
  if (s.turn && s.turn.urls) list.push({ urls: s.turn.urls.split(/[\s,]+/).filter(Boolean), username: s.turn.username, credential: s.turn.credential });
  return list;
}

function peerOptions(s) {
  const o = { debug: 1, config: { iceServers: iceServers(s), sdpSemantics: 'unified-plan' } };
  if (s.server && s.server.mode === 'custom' && s.server.host) {
    Object.assign(o, { host: s.server.host, port: Number(s.server.port) || (s.server.secure ? 443 : 9000), path: s.server.path || '/', key: s.server.key || 'peerjs', secure: !!s.server.secure });
  }
  return o;
}

function openPeer(id, settings) {
  return new Promise((resolve, reject) => {
    const Peer = PeerCtor();
    if (!Peer) { reject(new Error('連線元件載入失敗')); return; }
    const peer = id ? new Peer(id, peerOptions(settings)) : new Peer(peerOptions(settings));
    let opened = false;
    const t = setTimeout(() => { if (!opened) { peer.destroy(); reject(new Error('連不上配對伺服器，請檢查網路或「設定」中的伺服器')); } }, 20000);
    peer.on('open', () => { opened = true; clearTimeout(t); resolve(peer); });
    peer.on('error', (e) => { if (!opened) { clearTimeout(t); peer.destroy(); reject(e); } });
  });
}

const randomCode = () => String(100000 + Math.floor(Math.random() * 900000));

// 單一資料通道（含心跳）
class Link extends Emitter {
  constructor(conn) {
    super();
    this.conn = conn;
    this.lastSeen = Date.now();
    this.alive = true;
    conn.on('data', (m) => {
      this.lastSeen = Date.now();
      if (!m || typeof m !== 'object') return;
      if (m.t === 'ping') return;
      if (m.t === 'bye') { this.lost('已離開'); return; }
      this.emit('msg', m);
    });
    conn.on('close', () => this.lost('連線中斷'));
    conn.on('error', (e) => console.warn('conn error', e));
    const ready = () => {
      this.emit('open');
      this.hb = setInterval(() => {
        if (Date.now() - this.lastSeen > 15000) { this.lost('連線逾時'); return; }
        this.send({ t: 'ping' });
      }, 3000);
    };
    if (conn.open) setTimeout(ready, 0); else conn.on('open', ready);
  }
  get id() { return this.conn.peer; }
  get open() { return this.alive && this.conn.open; }
  send(m) { if (this.open) { try { this.conn.send(m); } catch (e) { console.warn(e); } } }
  lost(reason) {
    if (!this.alive) return;
    this.alive = false;
    clearInterval(this.hb);
    try { this.conn.close(); } catch {}
    this.emit('lost', reason);
  }
  close() {
    if (!this.alive) return;
    this.send({ t: 'bye' });
    this.alive = false;
    clearInterval(this.hb);
    setTimeout(() => { try { this.conn.close(); } catch {} }, 200);
  }
}

// 房間：role = host | guest
// 事件：member-join(id, link)、member-msg(id, m)、member-lost(id, reason)（房主）
//       connected、msg(m)、lost(reason)（來賓）
//       call(mediaConnection)（雙方）
export class Room extends Emitter {
  constructor(settings) {
    super();
    this.settings = settings;
    this.peer = null;
    this.role = null;
    this.code = '';
    this.links = new Map(); // 房主：peerId → Link；來賓：只有房主一條
    this.closed = false;
  }

  get myId() { return this.peer ? this.peer.id : ''; }

  async host() {
    this.role = 'host';
    for (let i = 0; i < 5 && !this.peer; i++) {
      const code = randomCode();
      try {
        this.peer = await openPeer(PREFIX + code, this.settings);
        this.code = code;
      } catch (e) {
        if (e && e.type === 'unavailable-id') continue;
        throw new Error(errMsg(e));
      }
    }
    if (!this.peer) throw new Error('無法建立房間，請稍後再試');
    this._bindPeer();
    this.peer.on('connection', (conn) => {
      if (conn.metadata && conn.metadata.kind === 'voice') return;
      if (this.links.size >= MAX_MEMBERS) {
        conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); });
        return;
      }
      const link = new Link(conn);
      link.on('open', () => { this.links.set(link.id, link); this.emit('member-join', link.id, link); });
      link.on('msg', (m) => this.emit('member-msg', link.id, m));
      link.on('lost', (reason) => { if (this.links.get(link.id) === link) { this.links.delete(link.id); this.emit('member-lost', link.id, reason); } });
    });
    return this.code;
  }

  async join(code) {
    this.role = 'guest';
    this.code = String(code).replace(/\D/g, '');
    if (this.code.length !== 6) throw new Error('房間號碼是 6 位數字');
    this.peer = await openPeer(null, this.settings);
    this._bindPeer();
    return new Promise((resolve, reject) => {
      const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
      const t = setTimeout(() => reject(new Error('找不到這個房間，請確認房號或請房主重新建立')), 20000);
      const onErr = (e) => { if (e && e.type === 'peer-unavailable') { clearTimeout(t); reject(new Error('找不到這個房間，請確認房號')); } };
      this.peer.on('error', onErr);
      const link = new Link(conn);
      link.on('open', () => {
        clearTimeout(t);
        this.peer.off('error', onErr);
        this.links.set(link.id, link);
        this.hostLink = link;
        this.emit('connected');
        resolve();
      });
      link.on('msg', (m) => this.emit('msg', m));
      link.on('lost', (reason) => { if (this.hostLink === link) { this.hostLink = null; this.links.clear(); this.emit('lost', reason === '已離開' ? '房主已離開' : '與房主的' + reason); } });
    });
  }

  _bindPeer() {
    this.peer.on('call', (call) => this.emit('call', call));
    this.peer.on('disconnected', () => { if (!this.closed) { try { this.peer.reconnect(); } catch {} } });
    this.peer.on('error', (e) => { if (e && e.type !== 'peer-unavailable') console.warn('peer error', e.type, e); });
  }

  get connected() { return this.role === 'host' ? !!this.peer && !this.closed : !!(this.hostLink && this.hostLink.open); }

  // 房主：送給所有人（except 可排除一人）；來賓：送給房主
  send(m, except) {
    if (this.role === 'guest') { if (this.hostLink) this.hostLink.send(m); return; }
    for (const [id, l] of this.links) if (id !== except) l.send(m);
  }
  sendTo(id, m) { const l = this.links.get(id); if (l) l.send(m); }
  kick(id) { const l = this.links.get(id); if (l) { l.close(); this.links.delete(id); } }

  call(peerId, stream) { return this.peer.call(peerId, stream, { metadata: { kind: 'voice' } }); }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const l of this.links.values()) l.close();
    this.links.clear();
    setTimeout(() => { try { this.peer && this.peer.destroy(); } catch {} }, 250);
  }
}
