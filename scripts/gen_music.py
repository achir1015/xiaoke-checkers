# -*- coding: utf-8 -*-
"""
小柯機器人跳棋遊戲：背景音樂產生器（原創、程序合成，無版權疑慮）
以五聲音階（宮商角徵羽）自動作曲，合成古箏、笛子、二胡、琵琶、笙與輕打擊樂，
輸出 20 首約 3 分 10 秒～3 分 40 秒的 MP3 到 assets/music/。

用法：python scripts/gen_music.py [曲目編號...]
"""
import json
import math
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'music')

MODES = {
    '宮': [0, 2, 4, 7, 9],
    '商': [0, 2, 5, 7, 10],
    '角': [0, 3, 5, 8, 10],
    '徵': [0, 2, 5, 7, 9],
    '羽': [0, 3, 5, 7, 10],
}

# 曲目設定：名稱、速度、主音(MIDI)、調式、A段主奏、B段主奏、打擊樂強度(0-2)、密度(0-2)、拍號
TRACKS = [
    ('星盤初啟', 70, 64, '宮', 'zheng', 'dizi', 0, 1, 4),
    ('彈珠流光', 96, 67, '徵', 'pipa', 'zheng', 1, 2, 4),
    ('三角遠征', 104, 62, '商', 'dizi', 'pipa', 2, 1, 4),
    ('六芒星夜', 60, 60, '羽', 'zheng', 'erhu', 0, 0, 4),
    ('跳躍晨曦', 88, 65, '宮', 'dizi', 'zheng', 1, 1, 4),
    ('彩珠嬉春', 100, 69, '徵', 'pipa', 'dizi', 1, 2, 4),
    ('對角之旅', 76, 62, '角', 'erhu', 'zheng', 0, 1, 4),
    ('銀河棋路', 64, 64, '羽', 'sheng', 'dizi', 0, 0, 4),
    ('琉璃清音', 72, 67, '宮', 'zheng', 'pipa', 0, 1, 3),
    ('連跳如風', 116, 62, '徵', 'dizi', 'pipa', 2, 2, 4),
    ('星光漫步', 68, 65, '商', 'dizi', 'zheng', 0, 1, 4),
    ('歸營之路', 84, 60, '宮', 'erhu', 'dizi', 1, 1, 4),
    ('搶灘對岸', 112, 64, '羽', 'pipa', 'erhu', 2, 2, 4),
    ('疾風連跳', 120, 67, '角', 'pipa', 'dizi', 2, 2, 4),
    ('夜空長考', 58, 62, '羽', 'zheng', 'sheng', 0, 0, 4),
    ('珠落玉盤', 92, 69, '宮', 'pipa', 'zheng', 1, 2, 4),
    ('遠方的角', 66, 62, '商', 'erhu', 'zheng', 0, 0, 3),
    ('三國爭渡', 108, 60, '徵', 'erhu', 'pipa', 2, 2, 4),
    ('靜水微瀾', 56, 65, '羽', 'sheng', 'zheng', 0, 0, 4),
    ('凱旋到岸', 104, 67, '宮', 'dizi', 'pipa', 2, 2, 4),
]

TARGET_SEC = (196, 220)


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


SOS_CACHE = {}


def sos(kind, f, order=2):
    key = (kind, tuple(f) if isinstance(f, (list, tuple)) else round(f, 1), order)
    if key not in SOS_CACHE:
        SOS_CACHE[key] = butter(order, f, btype=kind, fs=SR, output='sos')
    return SOS_CACHE[key]


# ---------------- 樂器 ----------------
def env_adsr(n, a, d, s, r, sustain_len):
    """a,d,r 秒；s 為持續音量；sustain_len 為按住時間（秒）"""
    e = np.zeros(n)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    ns = max(0, int(sustain_len * SR) - na - nd)
    i = 0
    seg = min(na, n - i); e[i:i + seg] = np.linspace(0, 1, na, endpoint=False)[:seg]; i += seg
    seg = min(nd, n - i); e[i:i + seg] = np.linspace(1, s, nd, endpoint=False)[:seg] if nd else []; i += seg
    seg = min(ns, n - i); e[i:i + seg] = s; i += seg
    seg = min(nr, n - i)
    if seg > 0:
        e[i:i + seg] = np.linspace(s, 0, nr)[:seg]
    return e


def pluck(f, dur, vel=0.8, bright=1.0, decay=1.6, kind='zheng', rng=None):
    """古箏／琵琶／低音撥弦：加法合成，高次泛音衰減快"""
    ring = min(max(dur * 1.6, 0.6), decay * 2.2)
    n = int(ring * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    inharm = 0.00018 if kind == 'zheng' else 0.00035
    # 起音微微偏高後回落、長音加揉弦
    bend = 1 + 0.004 * np.exp(-t * 40)
    vib = 1.0
    if kind == 'zheng' and dur > 0.45:
        vib = 1 + 0.0035 * np.sin(2 * np.pi * 5.6 * t) * np.clip((t - 0.25) / 0.3, 0, 1)
    if kind == 'pipa':
        vib = 1 + 0.004 * np.sin(2 * np.pi * 7.5 * t) * np.clip((t - 0.15) / 0.2, 0, 1) * (dur > 0.5)
    phase_base = 2 * np.pi * np.cumsum(f * bend * vib) / SR
    nh = 14 if kind != 'bass' else 8
    tau0 = decay if kind != 'pipa' else decay * 0.55
    for k in range(1, nh + 1):
        fk = f * k * math.sqrt(1 + inharm * k * k)
        if fk > SR / 2.2:
            break
        amp = (1.0 / k ** (1.25 - 0.35 * (bright - 1))) * (0.6 if k == 2 else 1.0)
        if kind == 'pipa' and k in (3, 4):
            amp *= 1.4
        tau = tau0 / (1 + 0.55 * (k - 1))
        out += amp * np.sin(phase_base * fk / f) * np.exp(-t / tau)
    # 撥弦雜音
    if rng is not None:
        m = min(n, int(0.012 * SR))
        noise = rng.standard_normal(m) * np.exp(-np.arange(m) / (0.003 * SR))
        out[:m] += sosfilt(sos('highpass', min(f * 3, 9000)), noise) * 0.25
    out *= np.minimum(1, t / 0.002)
    # 放開後快速止音
    stop = int(min(ring, dur + decay * 0.9) * SR)
    if stop < n:
        rel = int(0.15 * SR)
        e = np.ones(n); e[stop:stop + rel] = np.linspace(1, 0, min(rel, n - stop)); e[stop + rel:] = 0
        out *= e
    return out * vel * 0.32


def flute(freqs, durs, vel=0.7, rng=None):
    """笛子：一個樂句連續合成（含倚音、顫音、氣聲）"""
    total = sum(durs) + 0.35
    n = int(total * SR)
    fcurve = np.zeros(n)
    amp = np.zeros(n)
    i = 0
    for f, d in zip(freqs, durs):
        m = int(d * SR)
        seg_t = np.arange(m) / SR
        fc = np.full(m, f)
        # 倚音：長音前加上方鄰音 60ms
        if d > 0.5 and rng is not None and rng.random() < 0.35:
            g = min(m, int(0.06 * SR))
            fc[:g] = f * 2 ** (2 / 12)
        vib = 1 + 0.006 * np.sin(2 * np.pi * 5.2 * seg_t) * np.clip((seg_t - 0.2) / 0.35, 0, 1)
        fcurve[i:i + m] = fc * vib
        e = np.ones(m)
        a = min(m, int(0.05 * SR)); e[:a] = np.linspace(0.3, 1, a)
        r = min(m, int(0.04 * SR)); e[m - r:] *= np.linspace(1, 0.55, r)
        amp[i:i + m] = e
        i += m
    fcurve[i:] = fcurve[i - 1] if i > 0 else 440
    rel = n - i
    amp[i:] = np.linspace(amp[i - 1] if i else 0, 0, rel)
    amp = sosfilt(sos('lowpass', 30), amp)
    ph = 2 * np.pi * np.cumsum(fcurve) / SR
    sig = np.sin(ph) + 0.32 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph) + 0.05 * np.sin(4 * ph)
    # 笛膜共振感：輕微的高頻嗡鳴
    sig += 0.04 * np.sin(5 * ph) * (1 + 0.5 * np.sin(2 * np.pi * 23 * np.arange(n) / SR))
    if rng is not None:
        br = rng.standard_normal(n)
        br = sosfilt(sos('bandpass', [1200, 4500], 4), br) * 0.012
        sig += br
    return sig * amp * vel * 0.28


def erhu(freqs, durs, vel=0.7, rng=None):
    """二胡：鋸齒波泛音＋滑音＋揉弦，樂句連續合成"""
    total = sum(durs) + 0.3
    n = int(total * SR)
    target = np.zeros(n)
    amp = np.zeros(n)
    i = 0
    for f, d in zip(freqs, durs):
        m = int(d * SR)
        target[i:i + m] = f
        e = np.ones(m)
        a = min(m, int(0.08 * SR)); e[:a] = np.linspace(0.25, 1, a)
        r = min(m, int(0.05 * SR)); e[m - r:] *= np.linspace(1, 0.7, r)
        amp[i:i + m] = e
        i += m
    target[i:] = target[i - 1]
    amp[i:] = np.linspace(amp[i - 1], 0, n - i)
    # 滑音：頻率曲線平滑
    logf = np.log(target)
    logf = sosfilt(sos('lowpass', 9), logf - logf[0]) + logf[0]
    t = np.arange(n) / SR
    vib = 1 + 0.008 * np.sin(2 * np.pi * 6.0 * t + 0.6 * np.sin(2 * np.pi * 0.5 * t))
    f = np.exp(logf) * vib
    ph = 2 * np.pi * np.cumsum(f) / SR
    sig = np.zeros(n)
    for k in range(1, 22):
        if f.mean() * k > SR / 2.3:
            break
        formant = 1.0 + 1.2 * math.exp(-((math.log(k * f.mean()) - math.log(1100)) ** 2) / 0.5)
        sig += (formant / k) * np.sin(k * ph)
    if rng is not None:
        sig += sosfilt(sos('bandpass', [2000, 5000], 4), rng.standard_normal(n)) * 0.02  # 弓毛擦弦聲
    sig = sosfilt(sos('lowpass', 5200), sig)
    amp = sosfilt(sos('lowpass', 25), amp)
    return sig * amp * vel * 0.16


def sheng(midis, dur, vel=0.5):
    """笙：和弦長音，緩慢起奏"""
    n = int((dur + 1.2) * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for j, mi in enumerate(midis):
        f = midi_hz(mi)
        for det in (-0.0025, 0.0025):
            ff = f * (1 + det)
            ph = 2 * np.pi * ff * t + j
            out += np.sin(ph) + 0.45 * np.sin(2 * ph) + 0.3 * np.sin(3 * ph) + 0.12 * np.sin(5 * ph)
    e = env_adsr(n, 0.9, 0.3, 0.85, 1.2, dur)
    out = sosfilt(sos('lowpass', 3000), out)
    return out * e * vel * 0.05 / max(1, len(midis) / 3)


def woodblock(vel=0.6):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    s = (np.sin(2 * np.pi * 820 * t) * 0.8 + np.sin(2 * np.pi * 1290 * t) * 0.5) * np.exp(-t / 0.028)
    return s * vel * 0.32


def drum(vel=0.7, rng=None):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    f = 55 + 45 * np.exp(-t / 0.05)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22)
    if rng is not None:
        s += sosfilt(sos('bandpass', [200, 1200]), rng.standard_normal(n)) * np.exp(-t / 0.03) * 0.3
    return s * vel * 0.55


def bell(f=2100, vel=0.4):
    n = int(3.0 * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for ratio, a, tau in ((1, 1, 1.4), (2.76, 0.5, 0.8), (5.4, 0.25, 0.4), (8.9, 0.12, 0.2)):
        s += a * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / tau)
    return s * vel * 0.08


# ---------------- 作曲 ----------------
class Song:
    def __init__(self, idx, cfg):
        (self.title, self.bpm, self.tonic, mode, self.leadA, self.leadB,
         self.perc, self.density, self.beats) = cfg
        self.mode = MODES[mode]
        self.rng = np.random.default_rng(5003 + idx * 7919)
        self.beat = 60.0 / self.bpm
        self.bar = self.beat * self.beats
        self.events = []  # (start_sec, kind, params)

    def pitch(self, step, octave_shift=0):
        o, d = divmod(step, 5)
        return self.tonic + 12 * (o + octave_shift) + self.mode[d]

    RHYTHMS4 = [
        [1, 1, 1, 1], [1.5, 0.5, 1, 1], [0.5, 0.5, 1, 2], [2, 1, 1], [1, 0.5, 0.5, 2],
        [0.5, 0.5, 0.5, 0.5, 1, 1], [3, 1], [1, 1, 2], [0.75, 0.25, 1, 2], [1, 1, 0.5, 0.5, 1],
    ]
    RHYTHMS3 = [[1, 1, 1], [2, 1], [1.5, 0.5, 1], [0.5, 0.5, 1, 1], [1, 0.5, 0.5, 1], [3]]

    def rhythm(self, busy):
        pool = self.RHYTHMS4 if self.beats == 4 else self.RHYTHMS3
        if busy:
            pool = [r for r in pool if len(r) >= 3] or pool
        return list(pool[self.rng.integers(len(pool))])

    def motif(self, start_step, busy):
        r = self.rhythm(busy)
        steps = [start_step]
        for _ in range(len(r) - 1):
            mv = self.rng.choice([-2, -1, -1, 1, 1, 2, 0, 3, -3], p=[0.1, 0.2, 0.1, 0.2, 0.15, 0.1, 0.05, 0.05, 0.05])
            steps.append(int(np.clip(steps[-1] + mv, 2, 12)))
        return list(zip(steps, r))

    def phrase(self, base, busy, end_step):
        """四小節樂句：動機、變奏、新材料、終止"""
        m1 = self.motif(base, busy)
        shift = int(self.rng.choice([-1, 1, 2]))
        m2 = [(int(np.clip(s + shift, 2, 12)), d) for s, d in m1]
        if self.rng.random() < 0.5:
            m2 = m2[:-1] + [(m2[-1][0], m2[-1][1])]
        m3 = self.motif(m2[-1][0], busy)
        # 終止小節：走向終止音並拉長
        last = m3[-1][0]
        cad_r = [1, 1, 2] if self.beats == 4 else [1, 2]
        approach = int(np.clip(end_step + (1 if last > end_step else -1), 2, 12))
        m4 = list(zip([approach, int(np.clip((approach + end_step) // 2 if abs(approach - end_step) > 1 else approach, 2, 12)), end_step][-len(cad_r):], cad_r))
        return [m1, m2, m3, m4]

    def section(self, base, busy):
        a = self.phrase(base, busy, base + 1 + int(self.rng.integers(0, 2)) * 2)
        b = self.phrase(base, busy, (base // 5) * 5 + 5 if base % 5 else base)
        return a + b  # 8 小節

    # ---- 排入事件 ----
    def put_melody(self, t0, bars, instr, octave=0, vel=0.75):
        notes = []
        t = t0
        for bar in bars:
            for step, d in bar:
                notes.append((t, self.pitch(step, octave), d * self.beat))
                t += d * self.beat
        if instr in ('dizi', 'erhu'):
            # 以小節群組成樂句（每兩小節一句，句間換氣）
            for k in range(0, len(bars), 2):
                grp = []
                tt = t0 + k * self.bar
                for bar in bars[k:k + 2]:
                    for step, d in bar:
                        grp.append((self.pitch(step, octave), d * self.beat))
                if not grp:
                    continue
                fs = [midi_hz(m) for m, _ in grp]
                ds = [d for _, d in grp]
                ds[-1] = max(0.2, ds[-1] - 0.08)
                self.events.append((tt, instr, (fs, ds, vel)))
        else:
            for (st, m, d) in notes:
                kind = 'pipa' if instr == 'pipa' else 'zheng'
                if instr == 'sheng':
                    self.events.append((st, 'sheng', ([m, m + 12], d * 1.05, vel * 1.4)))
                    continue
                self.events.append((st, 'pluck', (midi_hz(m), d, vel, 1.15 if kind == 'pipa' else 1.0, 1.4 if kind == 'zheng' else 1.0, kind)))
                # 琵琶長音輪指
                if kind == 'pipa' and d >= 1.5 * self.beat:
                    k = 1
                    while k * 0.09 < d - 0.15:
                        self.events.append((st + k * 0.09, 'pluck', (midi_hz(m), 0.12, vel * 0.45, 1.1, 0.6, 'pipa')))
                        k += 1
        return t

    def put_accomp(self, t0, nbars, prog, style, vel=0.5):
        for b in range(nbars):
            root = prog[b % len(prog)]
            tb = t0 + b * self.bar
            chord = [root, root + 2, root + 3, root + 5]
            # 低音
            self.events.append((tb, 'pluck', (midi_hz(self.pitch(root, -2)), self.bar * 0.9, vel * 1.1, 0.8, 2.2, 'bass')))
            if style == 'arp':
                pat = [0, 1, 3, 2, 3, 1, 2, 1] if self.beats == 4 else [0, 1, 3, 2, 3, 1]
                step = self.beat / 2
                for i, ci in enumerate(pat):
                    s = chord[ci]
                    self.events.append((tb + i * step, 'pluck', (midi_hz(self.pitch(s, -1)), step * 1.5, vel * (0.75 if i else 0.95), 0.95, 1.3, 'zheng')))
            elif style == 'block':
                for i in range(self.beats):
                    if i % 2 == 0:
                        for s in chord[1:3]:
                            self.events.append((tb + i * self.beat, 'pluck', (midi_hz(self.pitch(s, -1)), self.beat, vel * 0.6, 1.0, 1.0, 'pipa')))
            elif style == 'sparse':
                self.events.append((tb + self.beat * (self.beats // 2), 'pluck', (midi_hz(self.pitch(chord[2], -1)), self.beat * 2, vel * 0.7, 0.9, 1.6, 'zheng')))
            if style != 'none' and (b % 2 == 0):
                self.events.append((tb, 'sheng', ([self.pitch(root, -1), self.pitch(root + 2, -1), self.pitch(root + 3, -1)], self.bar * 2, 0.8)))

    def put_perc(self, t0, nbars, level):
        if level <= 0:
            return
        for b in range(nbars):
            tb = t0 + b * self.bar
            if b % 4 == 0:
                self.events.append((tb, 'bell', (midi_hz(self.tonic + 24 + 7), 0.8)))
            for i in range(self.beats):
                if level >= 2 and i == 0:
                    self.events.append((tb, 'drum', (0.8,)))
                if level >= 2 and i == 2 and self.beats == 4 and self.rng.random() < 0.5:
                    self.events.append((tb + i * self.beat + self.beat / 2, 'drum', (0.45,)))
                if i % 2 == 1:
                    self.events.append((tb + i * self.beat, 'wood', (0.55,)))
                if level >= 2 and self.rng.random() < 0.35:
                    self.events.append((tb + i * self.beat + self.beat / 2, 'wood', (0.3,)))

    def gliss(self, t, up=True, span=12):
        steps = list(range(2, 2 + span)) if up else list(range(2 + span, 2, -1))
        for i, s in enumerate(steps):
            self.events.append((t + i * 0.045, 'pluck', (midi_hz(self.pitch(s, -1)), 0.3, 0.42, 1.1, 1.2, 'zheng')))

    def compose(self):
        prog_pool = [[0, 0, 3, 4], [0, 2, 3, 0], [0, 4, 3, 0], [0, 3, 1, 4], [3, 4, 0, 0], [0, 1, 3, 4]]
        progA = prog_pool[self.rng.integers(len(prog_pool))]
        progB = prog_pool[self.rng.integers(len(prog_pool))]
        busy = self.density >= 2
        A = self.section(5, busy)
        A2 = self.section(5, busy)
        Bm = self.section(8, True if self.density >= 1 else False)
        accA = 'arp' if self.density >= 1 else 'sparse'
        accB = 'block' if self.density >= 2 else 'arp'
        t = 0.0
        # 前奏
        self.gliss(t, up=True)
        self.put_accomp(t + 0.6, 4, progA, 'sparse', 0.45)
        t += 4 * self.bar + 0.6
        plan = [
            ('A', self.leadA, 0, accA, 0),
            ('A2', self.leadB, 0, accA, self.perc),
            ('B', self.leadA, 0, accB, self.perc),
            ('A', self.leadB, 1, accA, self.perc),
            ('I', None, 0, 'arp', 0),
            ('B', self.leadB, 0, accB, self.perc),
            ('A2', self.leadA, 0, accA, self.perc),
            ('B', self.leadA, 1, accB, self.perc),
            ('A', self.leadB, 0, accA, self.perc),
            ('A2', self.leadA, 0, 'sparse', 0),
        ]
        min_sec, max_sec = TARGET_SEC
        outro_len = 4 * self.bar + 3
        for name, lead, octv, acc, perc in plan:
            if t + 8 * self.bar + outro_len > max_sec:
                break
            if t + outro_len >= min_sec:
                break
            if name == 'I':
                self.gliss(t, up=False)
                self.put_accomp(t, 4, progB, 'arp', 0.5)
                t += 4 * self.bar
                continue
            mel = {'A': A, 'A2': A2, 'B': Bm}[name]
            octave = octv if lead not in ('erhu', 'sheng') else min(octv, 0)
            if lead == 'pipa' and octave == 0 and name == 'B':
                octave = 0
            self.put_melody(t, mel, lead, octave=octave - (1 if lead == 'erhu' and name != 'B' else 0) + (0 if lead != 'sheng' else -1), vel=0.8)
            # 第二聲部偶爾以古箏八度點綴
            if lead in ('dizi', 'erhu') and self.rng.random() < 0.5:
                for b, bar in enumerate(mel):
                    if b % 2 == 1:
                        st, _ = bar[0]
                        self.events.append((t + b * self.bar, 'pluck', (midi_hz(self.pitch(st, -1)), self.beat * 2, 0.45, 1.0, 1.4, 'zheng')))
            self.put_accomp(t, 8, progA if name != 'B' else progB, acc, 0.5)
            self.put_perc(t, 8, perc)
            t += 8 * self.bar
        # 若仍太短，以間奏補足
        while t + outro_len < min_sec:
            self.put_accomp(t, 4, progA, 'arp', 0.5)
            self.put_melody(t, self.section(5, busy)[:4], self.leadA, vel=0.7)
            t += 4 * self.bar
        # 尾聲
        self.put_accomp(t, 3, [0, 3, 0], 'sparse', 0.42)
        self.events.append((t + 3 * self.bar, 'pluck', (midi_hz(self.pitch(0, -1)), 4.0, 0.6, 1.0, 2.5, 'zheng')))
        self.events.append((t + 3 * self.bar, 'pluck', (midi_hz(self.pitch(5, -1)), 4.0, 0.5, 1.0, 2.5, 'zheng')))
        self.events.append((t + 3 * self.bar, 'sheng', ([self.pitch(0, -1), self.pitch(2, -1), self.pitch(5, -1)], 3.0, 0.9)))
        self.events.append((t + 3 * self.bar, 'bell', (midi_hz(self.tonic + 24), 0.7)))
        self.length = t + 3 * self.bar + 5.5

    # ---- 合成 ----
    def render(self):
        n = int(self.length * SR) + SR
        L = np.zeros(n); Rr = np.zeros(n)
        send = np.zeros(n)
        pans = {'dizi': 0.15, 'erhu': -0.12, 'pipa': 0.25, 'zheng': -0.2, 'bass': 0.0, 'sheng': 0.0, 'wood': 0.35, 'drum': -0.05, 'bell': 0.3}
        rev_amt = {'dizi': 0.5, 'erhu': 0.45, 'pipa': 0.35, 'zheng': 0.4, 'bass': 0.15, 'sheng': 0.6, 'wood': 0.25, 'drum': 0.2, 'bell': 0.7}
        for (st, kind, p) in self.events:
            if kind == 'pluck':
                f, d, vel, bright, decay, sub = p
                sig = pluck(f, d, vel, bright, decay, sub, self.rng)
                key = sub
                # 人性化：輕微時間與力度誤差
                st += float(self.rng.normal(0, 0.006))
            elif kind == 'dizi':
                sig = flute(*p, rng=self.rng); key = 'dizi'
            elif kind == 'erhu':
                sig = erhu(*p, rng=self.rng); key = 'erhu'
            elif kind == 'sheng':
                sig = sheng(*p); key = 'sheng'
            elif kind == 'wood':
                sig = woodblock(*p); key = 'wood'
            elif kind == 'drum':
                sig = drum(*p, rng=self.rng); key = 'drum'
            elif kind == 'bell':
                sig = bell(*p); key = 'bell'
            else:
                continue
            i0 = max(0, int(st * SR))
            i1 = min(n, i0 + len(sig))
            sig = sig[:i1 - i0]
            pan = pans[key] + (float(self.rng.normal(0, 0.05)) if key in ('zheng', 'pipa') else 0)
            a = (pan + 1) * math.pi / 4
            L[i0:i1] += sig * math.cos(a)
            Rr[i0:i1] += sig * math.sin(a)
            send[i0:i1] += sig * rev_amt[key]
        # 殘響：指數衰減雜訊脈衝響應
        ir_n = int(2.8 * SR)
        t = np.arange(ir_n) / SR
        rev = []
        for ch in range(2):
            noise = self.rng.standard_normal(ir_n) * np.exp(-t / 0.75)
            noise = sosfilt(sos('lowpass', 5500), noise)
            noise[:int(0.018 * SR)] = 0  # 預延遲
            noise /= np.sqrt(np.sum(noise ** 2))
            rev.append(fftconvolve(send, noise)[:n] * 0.55)
        L += rev[0]; Rr += rev[1]
        mix = np.stack([L, Rr], axis=1)
        mix = sosfilt(sos('highpass', 35), mix, axis=0)
        # 響度：RMS 正規化、柔性限制
        rms = np.sqrt(np.mean(mix ** 2)) + 1e-9
        mix *= 10 ** (-20.0 / 20) / rms
        mix = np.tanh(mix * 1.1) / 1.1
        peak = np.max(np.abs(mix))
        if peak > 0.89:
            mix *= 0.89 / peak
        # 淡入淡出
        fi = int(0.05 * SR); fo = int(4.0 * SR)
        mix[:fi] *= np.linspace(0, 1, fi)[:, None]
        mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
        return mix


def build(idx):
    cfg = TRACKS[idx]
    song = Song(idx, cfg)
    song.compose()
    mix = song.render()
    name = f'track{idx + 1:02d}.mp3'
    with tempfile.TemporaryDirectory() as td:
        wav = os.path.join(td, 'x.wav')
        wavfile.write(wav, SR, (mix * 32767).astype(np.int16))
        subprocess.run([
            'ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '128k',
            '-id3v2_version', '3', '-metadata', f'title={cfg[0]}', '-metadata', 'artist=小柯機器人',
            '-metadata', 'album=小柯機器人跳棋遊戲 背景音樂', '-metadata', f'track={idx + 1}',
            os.path.join(OUT, name),
        ], check=True)
    return {'file': name, 'title': cfg[0], 'seconds': round(len(mix) / SR, 1)}


def main():
    os.makedirs(OUT, exist_ok=True)
    which = [int(a) - 1 for a in sys.argv[1:]] or list(range(len(TRACKS)))
    with ProcessPoolExecutor(max_workers=min(8, os.cpu_count() or 4)) as ex:
        results = list(ex.map(build, which))
    meta_path = os.path.join(OUT, 'tracks.json')
    meta = {}
    if os.path.exists(meta_path):
        for t in json.load(open(meta_path, encoding='utf-8')):
            meta[t['file']] = t
    for r in results:
        meta[r['file']] = r
        print(r['file'], r['title'], r['seconds'], 's')
    json.dump(sorted(meta.values(), key=lambda x: x['file']), open(meta_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
