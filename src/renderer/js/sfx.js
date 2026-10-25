// 音效（WebAudio 即時合成：玻璃彈珠落孔、跳躍、勝負）
let ctx = null;
let enabled = true;
const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

export function setSfx(on) { enabled = !!on; }

function tone(freq, dur, { type = 'sine', gain = 0.3, attack = 0.002, decay = dur, when = 0, slide = 0 } = {}) {
  const c = ac();
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, { gain = 0.3, freq = 2000, q = 1, when = 0 } = {}) {
  const c = ac();
  const t = c.currentTime + when;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.15));
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

// 玻璃彈珠「叩」一聲：高頻短促＋一點共鳴
function clink(pitch = 1, gain = 1, when = 0) {
  noise(0.05, { gain: 0.35 * gain, freq: 3200 * pitch, q: 3, when });
  tone(2100 * pitch, 0.09, { gain: 0.1 * gain, when });
  tone(3350 * pitch, 0.06, { gain: 0.05 * gain, when });
  tone(780 * pitch, 0.12, { gain: 0.08 * gain, slide: 0.8, when });
}

export const sfx = {
  step() { if (enabled) clink(1, 1); },
  hop(k = 0) { if (enabled) clink(1 + k * 0.06, 0.8); },
  land() { if (enabled) { clink(0.9, 1.1); noise(0.07, { gain: 0.2, freq: 900, q: 1.2 }); } },
  select() { if (enabled) tone(1500, 0.05, { gain: 0.06 }); },
  illegal() { if (enabled) tone(220, 0.15, { type: 'square', gain: 0.05, slide: 0.8 }); },
  turn() {
    if (!enabled) return;
    tone(988, 0.12, { gain: 0.12 });
    tone(1319, 0.2, { gain: 0.1, when: 0.1 });
  },
  win() {
    if (!enabled) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.5, { type: 'triangle', gain: 0.15, when: i * 0.12 }));
  },
  lose() {
    if (!enabled) return;
    [440, 392, 349, 262].forEach((f, i) => tone(f, 0.55, { type: 'triangle', gain: 0.13, when: i * 0.17 }));
  },
  resume() { try { ac().resume(); } catch {} },
};
