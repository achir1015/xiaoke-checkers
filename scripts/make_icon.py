# 產生程式圖示：木製圓盤上的六角星與紅、綠、藍三顆玻璃彈珠
import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024
C = S / 2

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shadow).ellipse((70, 110, S - 50, S - 30), fill=(0, 0, 0, 150))
img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(26)))
d = ImageDraw.Draw(img)
d.ellipse((50, 50, S - 50, S - 50), fill=(156, 104, 52, 255))      # 圓盤側邊
d.ellipse((62, 56, S - 62, S - 76), fill=(226, 186, 128, 255))     # 圓盤面

# 六角星
def star(r_out):
    r_in = r_out / math.sqrt(3)
    pts = []
    for k in range(12):
        a = math.pi / 2 + k * math.pi / 6
        r = r_out if k % 2 == 0 else r_in
        pts.append((C + r * math.cos(a), C - 10 + r * math.sin(a)))
    return pts
d.polygon(star(400), fill=(251, 246, 234, 255))
d.polygon(star(372), fill=(240, 230, 210, 255))
# 角落色塊（上下對角＋其他四角）
cols = [(229, 57, 53), (47, 168, 79), (31, 111, 224), (229, 57, 53, 90), (47, 168, 79, 90), (31, 111, 224, 90)]
order = [3, 1, 5, 0, 4, 2]
pts = star(372)
for i in range(6):
    tip = pts[2 * i]
    a, b = pts[(2 * i - 1) % 12], pts[(2 * i + 1) % 12]
    c = cols[order[i]]
    overlay = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(overlay).polygon([tip, a, b], fill=c if len(c) == 4 else c + (235,))
    img = Image.alpha_composite(img, overlay)
d = ImageDraw.Draw(img)
# 孔
for gx in range(-4, 5):
    for gy in range(-4, 5):
        x = C + (gx + gy / 2) * 62
        y = C - 10 + gy * 62 * math.sqrt(3) / 2
        if (x - C) ** 2 + (y - C + 10) ** 2 < 250 ** 2:
            d.ellipse((x - 11, y - 11, x + 11, y + 11), fill=(70, 44, 24, 255))

# 玻璃彈珠
def marble(cx, cy, r, rgb):
    global img
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((cx - r + 10, cy - r + 22, cx + r + 10, cy + r + 22), fill=(0, 0, 0, 140))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(14)))
    m = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    md = ImageDraw.Draw(m)
    steps = 60
    for k in range(steps):
        t = k / steps
        rr = r * (1 - t * 0.98)
        ox, oy = -r * 0.28 * t, -r * 0.32 * t
        shade = 0.55 + 0.75 * t
        col = tuple(min(255, int(v * shade + 40 * t * t)) for v in rgb) + (255,)
        md.ellipse((cx + ox - rr, cy + oy - rr, cx + ox + rr, cy + oy + rr), fill=col)
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse((cx - r * 0.55, cy - r * 0.68, cx - r * 0.12, cy - r * 0.3), fill=(255, 255, 255, 210))
    m = Image.alpha_composite(m, hl.filter(ImageFilter.GaussianBlur(6)))
    img = Image.alpha_composite(img, m)

marble(C, C - 150, 125, (229, 57, 53))
marble(C - 150, C + 110, 125, (47, 168, 79))
marble(C + 150, C + 110, 125, (31, 111, 224))

os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
img.save(os.path.join(ROOT, 'build', 'icon.png'))
img.save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print('ok')
