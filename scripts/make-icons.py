"""生成应用图标（无第三方依赖）。

输出：
  src-tauri/icons/32x32.png
  src-tauri/icons/128x128.png
  src-tauri/icons/128x128@2x.png
  src-tauri/icons/icon.png
  src-tauri/icons/icon.ico

图形：蓝色渐变圆角方块 + 白色纸张 + 三条文字线，表达「文档编辑器」。
"""

import os
import struct
import zlib

SS = 4  # 超采样倍数


def lerp(a, b, t):
    return a + (b - a) * t


def rounded_rect_alpha(x, y, x0, y0, x1, y1, r):
    """返回点 (x,y) 在圆角矩形内的覆盖率（0/1）。"""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return 0.0
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx = x - cx
    dy = y - cy
    if dx * dx + dy * dy <= r * r:
        return 1.0
    return 0.0


def render(size):
    w = h = size * SS
    buf = bytearray(w * h * 4)

    # 背景渐变（#3370ff -> #7aa3ff）
    c0 = (0x33, 0x70, 0xFF)
    c1 = (0x7A, 0xA3, 0xFF)

    pad = 0.0
    radius = 0.225

    for y in range(h):
        ny = (y + 0.5) / h
        t = ny
        bg = (
            int(lerp(c0[0], c1[0], t)),
            int(lerp(c0[1], c1[1], t)),
            int(lerp(c0[2], c1[2], t)),
            255,
        )
        for x in range(w):
            nx = (x + 0.5) / w
            i = (y * w + x) * 4
            if rounded_rect_alpha(nx, ny, pad, pad, 1 - pad, 1 - pad, radius) > 0.5:
                buf[i : i + 4] = bytes(bg)
            else:
                buf[i : i + 4] = b"\x00\x00\x00\x00"

    # 白色纸张
    page = (0.235, 0.175, 0.765, 0.825)
    page_r = 0.075
    white = (255, 255, 255, 255)
    for y in range(h):
        ny = (y + 0.5) / h
        if ny < page[1] or ny > page[3]:
            continue
        for x in range(w):
            nx = (x + 0.5) / w
            if rounded_rect_alpha(nx, ny, *page, page_r) > 0.5:
                i = (y * w + x) * 4
                buf[i : i + 4] = bytes(white)

    # 三条「文字」线（用底色蓝，形成镂空感）
    lines = [
        (0.31, 0.315, 0.69, 0.355),
        (0.31, 0.405, 0.69, 0.445),
        (0.31, 0.495, 0.56, 0.535),
    ]
    line_color = (0x33, 0x70, 0xFF, 255)
    for (x0, y0, x1, y1) in lines:
        for y in range(h):
            ny = (y + 0.5) / h
            if ny < y0 or ny > y1:
                continue
            for x in range(w):
                nx = (x + 0.5) / w
                if x0 <= nx <= x1:
                    i = (y * w + x) * 4
                    buf[i : i + 4] = bytes(line_color)

    # 向下的箭头，暗示「Markdown 下钻/写下去」
    arrow = (0x33, 0x70, 0xFF, 255)
    # 箭杆
    for y in range(h):
        ny = (y + 0.5) / h
        if 0.60 <= ny <= 0.665:
            for x in range(w):
                nx = (x + 0.5) / w
                if 0.455 <= nx <= 0.545:
                    i = (y * w + x) * 4
                    buf[i : i + 4] = bytes(arrow)
    # 箭头
    for y in range(h):
        ny = (y + 0.5) / h
        if 0.655 <= ny <= 0.755:
            span = (0.755 - ny) / 0.1
            half = 0.115 * span
            for x in range(w):
                nx = (x + 0.5) / w
                if abs(nx - 0.5) <= half:
                    i = (y * w + x) * 4
                    buf[i : i + 4] = bytes(arrow)

    # 降采样
    out = bytearray(size * size * 4)
    n = SS * SS
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    i = (((y * SS + sy) * w) + (x * SS + sx)) * 4
                    r += buf[i]
                    g += buf[i + 1]
                    b += buf[i + 2]
                    a += buf[i + 3]
            o = (y * size + x) * 4
            out[o] = r // n
            out[o + 1] = g // n
            out[o + 2] = b // n
            out[o + 3] = a // n
    return bytes(out)


def png_bytes(size, rgba):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        raw += rgba[y * stride : (y + 1) * stride]

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def ico_bytes(entries):
    """entries: [(size, png_bytes)]，使用 PNG 压缩条目（Vista+ 支持）"""
    count = len(entries)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    directory = b""
    blobs = b""
    for size, data in entries:
        dim = 0 if size >= 256 else size
        directory += struct.pack(
            "<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset
        )
        offset += len(data)
        blobs += data
    return header + directory + blobs


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "..", "src-tauri", "icons")
    os.makedirs(out_dir, exist_ok=True)

    sizes = {16, 32, 48, 64, 128, 256}
    rendered = {}
    for s in sorted(sizes | {512}):
        print(f"渲染 {s}x{s} …")
        rendered[s] = png_bytes(s, render(s))

    mapping = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
    }
    for name, s in mapping.items():
        with open(os.path.join(out_dir, name), "wb") as fh:
            fh.write(rendered[s])

    with open(os.path.join(out_dir, "icon.ico"), "wb") as fh:
        fh.write(ico_bytes([(s, rendered[s]) for s in sorted(sizes)]))

    print("完成：", out_dir)


if __name__ == "__main__":
    main()
