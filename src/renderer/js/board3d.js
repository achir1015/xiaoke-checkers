// 3D 跳棋棋盤（Three.js）：木製圓盤、六角星、121 孔、玻璃彈珠
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CELLS, N_CELLS, ZONE_CELLS, SEAT_COLORS } from './rules.js';

const D = 1;                 // 孔距
const R_BOARD = 9.3;         // 圓盤半徑
const TOP = 0.32;            // 棋盤表面高度
const MR = 0.34;             // 彈珠半徑
const SINK = 0.1;            // 彈珠陷入孔中的深度
const SQ3 = Math.sqrt(3) / 2;

export const cellX = (i) => (CELLS[i].x + CELLS[i].z / 2) * D;
export const cellZ = (i) => CELLS[i].z * SQ3 * D;

// 星形外框頂點（世界座標 xz）
function starOutline(scale = 1) {
  const pts = [];
  // 依序：下尖、右下凹、右下尖…（以三角形頂點與內六角形頂點交錯）
  const tip = (x, z) => [(x + z / 2) * D * scale, z * SQ3 * D * scale];
  const corners = [[-4, 8], [-4, 4], [-8, 4], [-4, 0], [-4, -4], [0, -4], [4, -8], [4, -4], [8, -4], [4, 0], [4, 4], [0, 4]];
  for (const [x, z] of corners) pts.push(tip(x, z));
  return pts;
}

function makeBoardTexture(zoneFill) {
  const W = 2048;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = W;
  const g = cv.getContext('2d');
  const P = (wx, wz) => [((wx / R_BOARD) + 1) / 2 * W, ((wz / R_BOARD) + 1) / 2 * W];
  const unit = (W / 2) / R_BOARD;
  // 木紋圓盤
  const rg = g.createRadialGradient(W / 2, W / 2, W * 0.05, W / 2, W / 2, W / 2);
  rg.addColorStop(0, '#e6c28b'); rg.addColorStop(0.75, '#d9ae6c'); rg.addColorStop(1, '#b98848');
  g.fillStyle = rg; g.fillRect(0, 0, W, W);
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = `rgba(${110 + Math.random() * 40},${60 + Math.random() * 30},${20 + Math.random() * 20},${0.04 + Math.random() * 0.07})`;
    g.lineWidth = 1 + Math.random() * 4;
    g.beginPath();
    const y = Math.random() * W;
    g.moveTo(0, y);
    for (let x = 0; x <= W; x += 64) g.lineTo(x, y + Math.sin(x / (130 + Math.random() * 90)) * 14);
    g.stroke();
  }
  // 外圈刻線
  g.strokeStyle = 'rgba(90,50,20,.55)'; g.lineWidth = 10;
  g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 34, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 56, 0, Math.PI * 2); g.stroke();
  // 星形底（白邊＋米白內面）
  const star = (scale) => { const pts = starOutline(scale).map(([x, z]) => P(x, z)); g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
  g.save();
  g.shadowColor = 'rgba(60,30,10,.5)'; g.shadowBlur = 18;
  star(1.16); g.fillStyle = '#fbf6ea'; g.fill();
  g.restore();
  star(1.07); g.fillStyle = '#f1e7d2'; g.fill();
  // 角落三角形上色
  for (let z = 0; z < 6; z++) {
    const f = zoneFill[z];
    if (!f) continue;
    const cells = ZONE_CELLS[z];
    // 三角形三個頂點：離中心最遠的尖端，以及離尖端最遠的兩個底角
    const pts = cells.map((i) => [cellX(i), cellZ(i)]);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const apex = pts.reduce((m, p) => (Math.hypot(p[0], p[1]) > Math.hypot(m[0], m[1]) ? p : m));
    const byFar = pts.slice().sort((p, q) => dist(q, apex) - dist(p, apex));
    const b1 = byFar[0], b2 = byFar[1];
    // 往外擴一點
    const grow = (p) => [cx + (p[0] - cx) * 1.42, cz + (p[1] - cz) * 1.42];
    const tri = [apex, b1, b2].map(grow).map(([x, zz]) => P(x, zz));
    g.beginPath(); tri.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.globalAlpha = f.alpha;
    g.fillStyle = f.color; g.fill();
    g.globalAlpha = 1;
  }
  // 孔與孔之間的連線
  g.strokeStyle = 'rgba(70,45,25,.55)';
  g.lineWidth = unit * 0.035;
  for (let i = 0; i < N_CELLS; i++) {
    const c = CELLS[i];
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 1]]) {
      const j = CELLS.findIndex((o) => o.x === c.x + dx && o.z === c.z + dz);
      if (j < 0) continue;
      const [x1, y1] = P(cellX(i), cellZ(i)), [x2, y2] = P(cellX(j), cellZ(j));
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
  }
  // 孔
  for (let i = 0; i < N_CELLS; i++) {
    const [x, y] = P(cellX(i), cellZ(i));
    const r = unit * 0.24;
    const hg = g.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r);
    hg.addColorStop(0, '#1d120a'); hg.addColorStop(0.7, '#3b2414'); hg.addColorStop(1, '#8a6038');
    g.fillStyle = hg;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, r + 2, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 環境貼圖：讓玻璃彈珠有反光
function makeEnv(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const pos = geo.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    const c = new THREE.Color().lerpColors(new THREE.Color('#3a2616'), new THREE.Color('#fff2dc'), Math.max(0, y * 0.8 + 0.3));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const lamp = (x, y, z, w, h, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k * 0.92), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); scene.add(m);
  };
  lamp(-14, 30, 12, 18, 10, 6);
  lamp(20, 18, -14, 10, 14, 2.5);
  lamp(0, 10, 32, 30, 6, 1.4);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.02);
  pm.dispose();
  return rt.texture;
}

export class Board3D {
  constructor(container, { onCellClick } = {}) {
    this.container = container;
    this.onCellClick = onCellClick || (() => {});
    this.marbles = new Map();    // 孔 → mesh
    this.all = new Set();
    this.anims = [];
    this.pending = new Set();
    this.interactive = true;
    this.facingZone = 0;         // 哪一個角朝向觀看者
    this.viewName = 'tilt';
    this.zoneFill = [];

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    container.appendChild(r.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#1b1410');
    scene.fog = new THREE.Fog('#1b1410', 38, 75);
    scene.environment = makeEnv(r);
    scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    const ctl = this.controls = new OrbitControls(this.camera, r.domElement);
    ctl.enableDamping = true;
    ctl.enablePan = false;
    ctl.minDistance = 10;
    ctl.maxDistance = 40;
    ctl.maxPolarAngle = Math.PI * 0.44;
    ctl.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

    scene.add(new THREE.HemisphereLight('#fff4e0', '#3a2a1a', 0.7));
    const key = new THREE.DirectionalLight('#ffe9c8', 2.1);
    key.position.set(-8, 18, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 50 });
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    scene.add(key);
    const fill = new THREE.DirectionalLight('#cfe0ff', 0.4);
    fill.position.set(10, 8, -8);
    scene.add(fill);

    this.buildTable();
    this.buildBoard();
    this.buildMarbles();
    this.buildMarkers();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP);
    r.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    r.domElement.addEventListener('pointermove', (e) => this.onPointerMove(e));
    r.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    r.setAnimationLoop(() => this.frame());
  }

  buildTable() {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 1024;
    const g = cv.getContext('2d');
    g.fillStyle = '#33201a'; g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 400; i++) {
      g.strokeStyle = `rgba(${15 + Math.random() * 25},${8 + Math.random() * 12},5,${0.15 + Math.random() * 0.2})`;
      g.lineWidth = 1 + Math.random() * 3;
      const y = Math.random() * 1024;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= 1024; x += 32) g.lineTo(x, y + Math.sin(x / 90 + i) * 6);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 5);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  buildBoard() {
    const side = new THREE.MeshStandardMaterial({ color: '#9c6a34', roughness: 0.55 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R_BOARD, R_BOARD + 0.12, TOP, 96, 1, true), side);
    body.position.y = TOP / 2;
    body.castShadow = true; body.receiveShadow = true;
    this.scene.add(body);
    this.topMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
    const top = new THREE.Mesh(new THREE.CircleGeometry(R_BOARD, 96), this.topMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = TOP;
    top.receiveShadow = true;
    this.scene.add(top);
    this.setZones([]);
  }

  // 依座位設定角落顏色：seats = [{ home, target, color }]
  setZones(seats) {
    const fill = new Array(6).fill(null);
    for (const s of seats) {
      fill[s.home] = { color: s.color, alpha: 0.9 };
      if (!fill[s.target]) fill[s.target] = { color: s.color, alpha: 0.3 };
    }
    const key = JSON.stringify(fill);
    if (key === this.zoneKey) return;
    this.zoneKey = key;
    if (this.topMat.map) this.topMat.map.dispose();
    this.topMat.map = makeBoardTexture(fill);
    this.topMat.needsUpdate = true;
  }

  buildMarbles() {
    this.marbleGeo = new THREE.SphereGeometry(MR, 40, 24);
    this.marbleMat = SEAT_COLORS.map((c) => new THREE.MeshPhysicalMaterial({
      color: c, roughness: 0.12, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.06, sheen: 0.3, sheenColor: new THREE.Color('#ffffff'),
    }));
    // 彈珠中心的亮點（看起來像玻璃彈珠裡的花紋）
    this.coreGeo = new THREE.SphereGeometry(MR * 0.45, 16, 12);
    this.coreMat = SEAT_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.55), emissive: c, emissiveIntensity: 0.25, transparent: true, opacity: 0.55 }));
  }

  makeMarble(seat) {
    const m = new THREE.Mesh(this.marbleGeo, this.marbleMat[seat]);
    m.castShadow = true; m.receiveShadow = true;
    m.userData = { seat };
    this.all.add(m);
    return m;
  }

  restY() { return TOP + MR - SINK; }

  buildMarkers() {
    const mk = (color, opacity, geo) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      return m;
    };
    this.selMarker = mk('#ffe066', 0.95, new THREE.RingGeometry(MR + 0.04, MR + 0.13, 48));
    this.peerSel = mk('#9ad7ff', 0.85, new THREE.RingGeometry(MR + 0.04, MR + 0.12, 48));
    this.lastFrom = mk('#4fc3f7', 0.8, new THREE.RingGeometry(0.17, 0.26, 32));
    this.lastTo = mk('#4fc3f7', 0.85, new THREE.RingGeometry(MR + 0.03, MR + 0.1, 48));
    this.hintFrom = mk('#7CFC00', 0.9, new THREE.RingGeometry(MR + 0.03, MR + 0.14, 48));
    this.hintTo = mk('#7CFC00', 0.9, new THREE.RingGeometry(MR + 0.03, MR + 0.14, 48));
    this.dotGeo = new THREE.CircleGeometry(0.15, 32);
    this.jumpGeo = new THREE.RingGeometry(0.12, 0.22, 32);
    this.dotMat = new THREE.MeshBasicMaterial({ color: '#2ecc71', transparent: true, opacity: 0.9, depthWrite: false });
    this.jumpMat = new THREE.MeshBasicMaterial({ color: '#ffd54f', transparent: true, opacity: 0.95, depthWrite: false });
    this.targets = [];
    this.pathLine = null;
    this.hintArrow = null;
  }

  place(m, cell, y = TOP + 0.004) {
    if (cell == null || cell < 0) { m.visible = false; return; }
    m.position.set(cellX(cell), y, cellZ(cell));
    m.visible = true;
  }

  resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fit();
  }

  // 觀看方向：讓 facingZone 那個角朝向自己（在畫面下方）
  fit() {
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * this.camera.aspect;
    const need = R_BOARD + 0.3;
    const top = this.viewName === 'top';
    const dist = Math.max(need / tanH, (need * (top ? 1 : 0.86)) / tanV) * (this.viewName === 'low' ? 1.02 : 1);
    const tip = ZONE_CELLS[this.facingZone].reduce((a, i) => [a[0] + cellX(i), a[1] + cellZ(i)], [0, 0]);
    const len = Math.hypot(tip[0], tip[1]) || 1;
    const hx = tip[0] / len, hz = tip[1] / len;
    let dir;
    if (top) dir = new THREE.Vector3(hx * 0.0001, 1, hz * 0.0001);
    else if (this.viewName === 'low') dir = new THREE.Vector3(hx * 0.8, 0.6, hz * 0.8);
    else dir = new THREE.Vector3(hx * 0.6, 0.8, hz * 0.6);
    dir.normalize();
    const target = new THREE.Vector3(hx * (top ? 0 : 0.6), 0, hz * (top ? 0 : 0.6));
    this.camera.up.set(0, 1, 0);
    if (top) this.camera.up.set(-hx, 0, -hz);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.controls.maxDistance = Math.max(40, dist * 1.4);
    this.camera.lookAt(target);
    this.controls.update();
  }

  setView(name) { this.viewName = name; this.fit(); }
  setFacing(zone) { this.facingZone = zone; this.fit(); }

  // board：Int8Array（-1 空，否則座位）
  setPosition(board) {
    for (const m of this.all) this.scene.remove(m);
    this.all.clear();
    this.marbles.clear();
    for (let i = 0; i < N_CELLS; i++) {
      if (board[i] < 0) continue;
      const m = this.makeMarble(board[i]);
      m.position.set(cellX(i), this.restY(), cellZ(i));
      this.scene.add(m);
      this.marbles.set(i, m);
    }
    this.anims = [];
    for (const done of [...this.pending]) done();
    this.pending.clear();
  }

  // 沿路徑移動（走一步或連續跳躍）
  animatePath(path, { stepMs = 260 } = {}) {
    return new Promise((res) => {
      const resolve = () => { this.pending.delete(resolve); res(); };
      this.pending.add(resolve);
      if (!path || path.length < 2) { resolve(); return; }
      const m = this.marbles.get(path[0]);
      if (!m) { resolve(); return; }
      this.marbles.delete(path[0]);
      this.marbles.set(path[path.length - 1], m);
      const pts = path.map((c) => new THREE.Vector3(cellX(c), this.restY(), cellZ(c)));
      const segs = pts.length - 1;
      const t0 = performance.now();
      const total = stepMs * segs;
      let lastSeg = -1;
      this.anims.push((now) => {
        const k = Math.min(1, (now - t0) / total);
        const f = k * segs;
        const s = Math.min(segs - 1, Math.floor(f));
        const u = f - s;
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        const a = pts[s], b = pts[s + 1];
        const len = a.distanceTo(b);
        m.position.lerpVectors(a, b, e);
        m.position.y = this.restY() + Math.sin(Math.PI * e) * (0.35 + len * 0.28);
        if (s !== lastSeg) { lastSeg = s; if (this.onHop) this.onHop(s, segs); }
        if (k >= 1) { m.position.copy(pts[segs]); resolve(); return false; }
        return true;
      });
    });
  }

  // 認輸／退出：棋子飛離棋盤
  removeMarbles(cells) {
    for (const c of cells) {
      const m = this.marbles.get(c);
      if (!m) continue;
      this.marbles.delete(c);
      const start = m.position.clone();
      const out = start.clone().multiplyScalar(1.6).add(new THREE.Vector3(0, 3, 0));
      const t0 = performance.now() + Math.random() * 300;
      this.anims.push((now) => {
        const k = Math.max(0, Math.min(1, (now - t0) / 700));
        const e = 1 - Math.pow(1 - k, 3);
        m.position.lerpVectors(start, out, e);
        m.scale.setScalar(Math.max(0.01, 1 - e));
        if (k >= 1) { this.scene.remove(m); this.all.delete(m); return false; }
        return true;
      });
    }
  }

  setSelected(cell) {
    this.selected = cell;
    this.place(this.selMarker, cell, TOP + 0.006);
    for (const [c, m] of this.marbles) m.position.y = this.restY() + (c === cell ? 0.22 : 0);
  }

  // 觀棋者看到主控者選到的棋子
  setPeerSelected(cell) { this.place(this.peerSel, cell, TOP + 0.006); }

  // list：[{ cell, jump }]
  setTargets(list) {
    for (const m of this.targets) this.scene.remove(m);
    this.targets = [];
    for (const { cell, jump } of list || []) {
      const m = new THREE.Mesh(jump ? this.jumpGeo : this.dotGeo, jump ? this.jumpMat : this.dotMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cellX(cell), TOP + 0.006, cellZ(cell));
      this.scene.add(m);
      this.targets.push(m);
    }
  }

  // 上一步：起點、終點與跳躍路徑
  setLastMove(path, seat = -1) {
    if (this.pathLine) { this.scene.remove(this.pathLine); this.pathLine.geometry.dispose(); this.pathLine = null; }
    if (!path || path.length < 2) { this.place(this.lastFrom, -1); this.place(this.lastTo, -1); return; }
    this.place(this.lastFrom, path[0]);
    this.place(this.lastTo, path[path.length - 1]);
    const color = seat >= 0 ? SEAT_COLORS[seat] : '#4fc3f7';
    this.lastFrom.material.color.set(color); this.lastTo.material.color.set(color);
    {
      const pts = [];
      for (let k = 0; k < path.length - 1; k++) {
        const a = new THREE.Vector3(cellX(path[k]), TOP + 0.02, cellZ(path[k]));
        const b = new THREE.Vector3(cellX(path[k + 1]), TOP + 0.02, cellZ(path[k + 1]));
        const mid = a.clone().lerp(b, 0.5); mid.y += 0.25 + a.distanceTo(b) * 0.15;
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        pts.push(...curve.getPoints(16));
      }
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.035, 8, false);
      this.pathLine = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }));
      this.scene.add(this.pathLine);
    }
  }

  setHint(from, to) {
    this.place(this.hintFrom, from, TOP + 0.008);
    this.place(this.hintTo, to, TOP + 0.008);
    if (this.hintArrow) { this.scene.remove(this.hintArrow); this.hintArrow = null; }
    if (from == null || from < 0) return;
    const a = new THREE.Vector3(cellX(from), TOP + 1.0, cellZ(from));
    const b = new THREE.Vector3(cellX(to), TOP + 1.0, cellZ(to));
    const dir = b.clone().sub(a);
    const len = dir.length();
    this.hintArrow = new THREE.ArrowHelper(dir.normalize(), a, len, 0x39ff14, Math.min(0.6, len * 0.3), 0.35);
    this.scene.add(this.hintArrow);
  }

  setInteractive(on) {
    this.interactive = on;
    this.renderer.domElement.style.cursor = on ? 'default' : 'not-allowed';
  }

  pickCell(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [...this.marbles.values()];
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (hit) for (const [c, m] of this.marbles) if (m === hit.object) return c;
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, p)) return -1;
    let best = -1, bd = 0.5 * D;
    for (let i = 0; i < N_CELLS; i++) {
      const d = Math.hypot(p.x - cellX(i), p.z - cellZ(i));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    const c = this.pickCell(e);
    if (c >= 0) this.onCellClick(c);
  }

  onPointerMove(e) {
    if (!this.interactive) return;
    const c = this.pickCell(e);
    this.renderer.domElement.style.cursor = c >= 0 && (this.marbles.has(c) || this.targets.length) ? 'pointer' : 'default';
  }

  frame() {
    const now = performance.now();
    const running = this.anims;
    this.anims = [];
    const keep = running.filter((fn) => fn(now) !== false);
    this.anims = keep.concat(this.anims);
    const t = now / 1000;
    if (this.selMarker.visible) this.selMarker.rotation.z = t;
    if (this.peerSel.visible) this.peerSel.material.opacity = 0.55 + 0.35 * Math.sin(t * 5);
    for (const m of this.targets) m.scale.setScalar(1 + 0.12 * Math.sin(t * 6));
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  snapshot() { return this.renderer.domElement.toDataURL('image/png'); }
}
