"""Descreen the halftone reference art into ink-coverage maps.

The references already carry the look we want, but they are halftoned on their own
~17.5px lattice. Sampling them under our lattice would beat into moire, so we notch
their screen frequencies out of the spectrum and keep everything else, including the
sub-dot detail (edges, windows, branches) the renderer needs for threshold screening.

    python3 tools/build_sources.py design/references/cassis.png design/references/nyc.png design/references/paris.png
"""
import sys, pathlib
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

PAPER = 0.925   # #ECECEC, the page colour the references were exported on
OUT_W = 2048

def descreen(cov, px, py):
    H, W = cov.shape
    F = np.fft.fft2(cov - cov.mean())
    P = gaussian_filter(np.abs(np.fft.fftshift(F)), 1.5)
    fy = np.fft.fftshift(np.fft.fftfreq(H))[:, None]
    fx = np.fft.fftshift(np.fft.fftfreq(W))[None, :]
    rad = np.hypot(fx, fy)
    fx0, fy0 = 1 / px, 1 / py
    # the screen lives at the lattice harmonics (k/px, l/py); find the true peak near
    # each one (the art is not a perfect grid) and notch it out
    mask = np.ones((H, W))
    w = 0.10 * fx0
    n = 0
    for k in range(-3, 4):
        for l in range(-3, 4):
            if k == 0 and l == 0:
                continue
            tx, ty = k * fx0, l * fy0
            if abs(tx) >= 0.5 or abs(ty) >= 0.5:
                continue
            near = np.hypot(fx - tx, fy - ty) < 0.2 * fx0
            y, x = np.unravel_index(np.argmax(np.where(near, P, 0)), P.shape)
            mask *= 1 - np.exp(-((fx - fx[0, x]) ** 2 + (fy - fy[y, 0]) ** 2) / (2 * w * w))
            n += 1
    out = np.real(np.fft.ifft2(np.fft.ifftshift(np.fft.fftshift(F) * mask))) + cov.mean()
    return gaussian_filter(out, 0.12 * px), n

def pitch(profile):
    p = profile - profile.mean()
    n = len(p) * 8
    F = np.abs(np.fft.rfft(p * np.hanning(len(p)), n))
    f = np.fft.rfftfreq(n)
    band = (f > 1 / 40) & (f < 1 / 6)
    return 1 / f[np.argmax(F * band)]

out_dir = pathlib.Path(__file__).resolve().parent.parent / "site" / "public" / "img"
for src in sys.argv[1:]:
    src = pathlib.Path(src)
    g = np.asarray(Image.open(src).convert("L")).astype(np.float32) / 255
    H, W = g.shape
    p = pitch(g[H // 2:].mean(0))
    q = pitch(g[H // 2:].mean(1))
    cov = np.clip(1 - g / PAPER, 0, 1)          # 0 on paper, 1 on solid ink
    cov, n = descreen(cov, p, q)
    cov = np.clip(cov, 0, 1)
    h = round(H * OUT_W / W)
    im = Image.fromarray((255 * (1 - cov)).round().astype(np.uint8)).resize((OUT_W, h), Image.LANCZOS)
    dst = out_dir / f"{src.stem}.jpg"
    im.save(dst, quality=92)
    print(f"{src.name}: {W}x{H}, pitch {p:.2f}px ({W / p:.1f} across), {n} peaks notched, aspect {W / H:.4f} -> {dst.name} {OUT_W}x{h}")
