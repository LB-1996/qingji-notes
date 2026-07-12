#!/usr/bin/env python3
"""生成轻记的应用图标（纯 Python，无第三方依赖）。
渲染 2x 超采样再下采样，得到平滑边缘的 512x512 PNG。"""
import struct, zlib, math, os

SS = 2                     # 超采样倍数
N = 512
W = N * SS
R = int(112 * SS)          # 圆角半径

def lerp(a, b, t): return a + (b - a) * t

def bg_color(y):
    t = y / W
    top = (247, 199, 45)
    bot = (238, 168, 4)
    return tuple(int(lerp(top[i], bot[i], t)) for i in range(3))

def in_rounded_rect(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r

def dist_to_hseg(x, y, xa, xb, yc):
    cx = min(max(x, xa), xb)
    return math.hypot(x - cx, y - yc)

# 白色文字线（title + 两条正文）：(x起, x终, y中心, 半高)
S = SS
bars = [
    (150 * S, 320 * S, 200 * S, 26 * S),
    (150 * S, 372 * S, 285 * S, 22 * S),
    (150 * S, 300 * S, 355 * S, 22 * S),
]

def sample(x, y):
    # 背景圆角外 → 透明
    if not in_rounded_rect(x, y, 0, 0, W - 1, W - 1, R):
        return (0, 0, 0, 0)
    # 白色线条
    for (xa, xb, yc, r) in bars:
        if dist_to_hseg(x, y, xa, xb, yc) <= r:
            return (255, 255, 255, 255)
    r, g, b = bg_color(y)
    return (r, g, b, 255)

# 渲染超采样图
big = bytearray(W * W * 4)
for y in range(W):
    row = y * W * 4
    for x in range(W):
        px = sample(x, y)
        i = row + x * 4
        big[i], big[i + 1], big[i + 2], big[i + 3] = px

# 下采样到 512
out = bytearray()
for y in range(N):
    out.append(0)  # filter byte
    for x in range(N):
        r = g = b = a = 0
        for dy in range(SS):
            for dx in range(SS):
                i = ((y * SS + dy) * W + (x * SS + dx)) * 4
                r += big[i]; g += big[i + 1]; b += big[i + 2]; a += big[i + 3]
        n = SS * SS
        out += bytes((r // n, g // n, b // n, a // n))

def chunk(tag, data):
    c = struct.pack('>I', len(data)) + tag + data
    return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 8, 6, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(bytes(out), 9))
png += chunk(b'IEND', b'')

path = os.path.join(os.path.dirname(__file__), 'icon.png')
with open(path, 'wb') as f:
    f.write(png)
print('已生成', path)
