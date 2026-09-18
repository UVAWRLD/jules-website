"""Estimate a depth map per place with Depth Anything V2.

The renderer keeps its dot lattice fixed in screen space and shifts what each dot samples
by the depth under it, so near things slide further than far ones as the cursor moves.
That needs one greyscale depth map per source, pixel aligned with it: white is near,
black is far.

Run once; the maps are committed. Needs torch + transformers (a ~2.5GB download):

    pip install torch torchvision transformers
    python tools/build_depth.py
"""
import pathlib
import numpy as np
from PIL import Image
import torch
from transformers import pipeline

MODEL = "depth-anything/Depth-Anything-V2-Small-hf"
IMG = pathlib.Path(__file__).resolve().parent.parent / "public" / "img"
PLACES = ["cassis", "paris", "nyc"]

device = "mps" if torch.backends.mps.is_available() else "cpu"
depth = pipeline("depth-estimation", model=MODEL, device=device)
print(f"{MODEL} on {device}")

for key in PLACES:
    src = IMG / f"{key}.jpg"
    im = Image.open(src).convert("RGB")
    d = np.asarray(depth(im)["predicted_depth"].squeeze(), dtype=np.float32)
    d = np.asarray(Image.fromarray(d).resize(im.size, Image.BICUBIC), dtype=np.float32)
    # the model's output is relative inverse depth on an arbitrary scale, so normalise
    # each image to 0..1 on its own 1st/99th percentiles: near = 1
    lo, hi = np.percentile(d, [1, 99])
    d = np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1)
    dst = IMG / f"{key}-depth.jpg"
    Image.fromarray((d * 255).round().astype(np.uint8)).save(dst, quality=92)
    print(f"{src.name} {im.size} -> {dst.name}")
