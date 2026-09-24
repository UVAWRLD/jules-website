"""Bake the hourglass for the loading screen into a point cloud plus its animation.

Input is the Sketchfab GLB ("Sands of Time" by Antonio Gloria, CC-BY-4.0). As with the crow,
nothing loads the model at runtime: this reads it here and writes two small files.

The model is three rigidly skinned parts: the wooden frame and the glass on one bone, and the
sand on another, whose shape is driven by morph targets (the top drains, the stream falls,
the pile grows). Its one animation runs for ten seconds: sand set A drains for four, the
hourglass flips over in the fifth, and set B repeats it. The two halves look the same, so we
keep 0..5s and set A only, and loop it: the frame at 5s, flipped with B full on top, is the
frame at 0s, upright with A full on top.

    hourglass.json   layout of the bin, plus fps and frame count
    hourglass.bin    rigid points (frame and glass) in bind space with normal, occlusion
                     and kind; the sand meshes (base, morph deltas, triangles); sand points
                     as triangle + barycentrics, so they follow the morph; and per frame, the
                     two skinning matrices and the sand's morph weights

    python tools/bake_hourglass.py sands_of_time.glb [--points 13000] [--fps 30]
"""
import argparse, json, pathlib, struct, sys
import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from bake_crow import compose, slerp, trs  # noqa: E402

COMPONENT = {5120: "i1", 5121: "u1", 5122: "i2", 5123: "u2", 5125: "u4", 5126: "f4"}
NUM = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
LOOP = 5.0                       # seconds kept: set A drains, then the flip


class GLB:
    def __init__(self, path):
        b = pathlib.Path(path).read_bytes()
        jlen, = struct.unpack_from("<I", b, 12)
        self.g = json.loads(b[20:20 + jlen])
        off = 20 + jlen
        blen, = struct.unpack_from("<I", b, off)
        self.bin = b[off + 8:off + 8 + blen]

    def accessor(self, i):
        a = self.g["accessors"][i]
        n = NUM[a["type"]]
        dt = np.dtype("<" + COMPONENT[a["componentType"]])
        bv = self.g["bufferViews"][a["bufferView"]]
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride") or n * dt.itemsize
        out = np.empty((a["count"], n), dt)
        for k in range(a["count"]):
            out[k] = np.frombuffer(self.bin, dt, n, start + k * stride)
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("--points", type=int, default=13000)
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    glb = GLB(args.glb)
    g = glb.g
    out_dir = pathlib.Path(args.out or pathlib.Path(__file__).resolve().parent.parent / "public" / "models")
    rng = np.random.default_rng(20260924)

    def prim(mi):
        p = g["meshes"][mi]["primitives"][0]
        pos = glb.accessor(p["attributes"]["POSITION"]).astype(np.float64)
        nrm = glb.accessor(p["attributes"]["NORMAL"]).astype(np.float64)
        idx = glb.accessor(p["indices"]).reshape(-1, 3).astype(np.int64)
        deltas = [glb.accessor(t["POSITION"]).astype(np.float64) for t in p.get("targets", [])]
        return pos, nrm, idx, deltas

    WOOD, GLASS, SAND = 0, 1, [2, 3, 4]          # set A: top, stream, bottom

    # ---- skeleton and animation ---------------------------------------------------------
    skin = g["skins"][0]
    joint_nodes = skin["joints"]                  # _rootJoint, center, A, B
    inv_bind = glb.accessor(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    parent = {c: i for i, n in enumerate(g["nodes"]) for c in n.get("children", [])}
    order, seen = [], set()

    def walk(n):
        if n in seen:
            return
        seen.add(n); order.append(n)
        for c in g["nodes"][n].get("children", []):
            walk(c)
    for r in [i for i in range(len(g["nodes"])) if i not in parent]:
        walk(r)

    anim = g["animations"][0]
    tracks, weight_tracks = {}, {}
    for ch in anim["channels"]:
        s = anim["samplers"][ch["sampler"]]
        times = glb.accessor(s["input"]).reshape(-1)
        vals = glb.accessor(s["output"]).astype(np.float64)
        node, path = ch["target"]["node"], ch["target"]["path"]
        if path == "weights":
            weight_tracks[g["nodes"][node]["mesh"]] = (times, vals.reshape(len(times), -1))
        else:
            tracks.setdefault(node, {})[path] = (times, vals)

    def sample(times, vals, t, rot=False):
        if t <= times[0]:
            return vals[0]
        if t >= times[-1]:
            return vals[-1]
        i = int(np.searchsorted(times, t) - 1)
        f = (t - times[i]) / max(times[i + 1] - times[i], 1e-9)
        return slerp(vals[i], vals[i + 1], f) if rot else vals[i] + f * (vals[i + 1] - vals[i])

    def pose(t):
        world = [None] * len(g["nodes"])
        for n in order:
            node = g["nodes"][n]
            if "matrix" in node:
                local = trs(node)
            else:
                tr = tracks.get(n, {})
                T = sample(*tr["translation"], t) if "translation" in tr else np.array(node.get("translation", [0, 0, 0]), float)
                R = sample(*tr["rotation"], t, True) if "rotation" in tr else np.array(node.get("rotation", [0, 0, 0, 1]), float)
                # the A/B bones' scale is only a visibility switch between the two sand sets;
                # we keep set A throughout, so it is held at 1
                S = np.array(node.get("scale", [1, 1, 1]), float)
                if "scale" in tr and node.get("name") not in ("A_bn_01", "B_bn_02"):
                    S = sample(*tr["scale"], t)
                local = compose(T, R, S)
            world[n] = world[parent[n]] @ local if n in parent else local
        return [world[j] @ inv_bind[k] for k, j in enumerate(joint_nodes)]

    frames = int(round(LOOP * args.fps))
    skins = [pose(f / args.fps) for f in range(frames)]

    # ---- normalise: upright at t=0, centred, one unit tall -------------------------------
    wood_pos = prim(WOOD)[0]
    p0 = (skins[0][1][:3, :3] @ wood_pos.T).T + skins[0][1][:3, 3]
    lo, hi = p0.min(0), p0.max(0)
    height = hi[1] - lo[1]
    N = np.eye(4)
    N[:3, :3] /= height
    N[:3, 3] = -0.5 * (lo + hi) / height
    print(f"frame bbox {np.round(hi - lo, 1)}, height {height:.1f} -> 1")

    # ---- sand meshes and their morph weights per frame ------------------------------------
    sand = []
    for mi in SAND:
        pos, nrm, idx, deltas = prim(mi)
        times, vals = weight_tracks[mi]
        w = np.array([sample(times, vals, f / args.fps) for f in range(frames)])
        sand.append(dict(pos=pos, idx=idx, deltas=np.array(deltas), w=w))

    def morphed(s, f):
        return s["pos"] + np.tensordot(s["w"][f], s["deltas"], 1)

    # ---- surface points ---------------------------------------------------------------------
    def tri_area(p, idx):
        t = p[idx]
        return 0.5 * np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)

    def bary(n):
        u, v = rng.random(n), rng.random(n)
        flip = u + v > 1
        u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
        return np.stack([1 - u - v, u, v], 1)

    wood = prim(WOOD); glass = prim(GLASS)
    a_wood = tri_area(wood[0], wood[2]); a_glass = tri_area(glass[0], glass[2])
    # sand is sampled on each triangle's largest extent over the loop, so the pile, which
    # starts as nothing, still has enough points once it has grown
    a_sand = [np.max([tri_area(morphed(s, f), s["idx"]) for f in range(0, frames, 3)], 0) for s in sand]
    # the glass only draws at its rims, so it can be thinner; the sand is the subject
    weight = {"wood": 1.0, "glass": 0.55, "sand": 1.6}
    total = a_wood.sum() * weight["wood"] + a_glass.sum() * weight["glass"] + sum(a.sum() for a in a_sand) * weight["sand"]
    per = args.points / total
    n_wood = int(a_wood.sum() * weight["wood"] * per)
    n_glass = int(a_glass.sum() * weight["glass"] * per)
    n_sand = [int(a.sum() * weight["sand"] * per) for a in a_sand]
    print(f"points: wood {n_wood}, glass {n_glass}, sand {n_sand}")

    def rigid(meshdata, areas, n, kind):
        pos, nrm, idx, _ = meshdata
        pick = rng.choice(len(idx), size=n, p=areas / areas.sum())
        b = bary(n)
        v = idx[pick]
        p = (b[:, :, None] * pos[v]).sum(1)
        q = (b[:, :, None] * nrm[v]).sum(1)
        q /= np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-9)
        return p, q, np.full(n, kind, np.uint8)

    wp, wn, wk = rigid(wood, a_wood, n_wood, 0)
    gp, gn, gk = rigid(glass, a_glass, n_glass, 1)
    rp = np.concatenate([wp, gp]); rn = np.concatenate([wn, gn]); rk = np.concatenate([wk, gk])
    # smooth the wood's normals over its neighbours, as for the crow: a low poly model's
    # facets otherwise come out as mottling in the screen
    tree = cKDTree(wp)
    _, near = tree.query(wp, k=14)
    wn_s = wn[near].mean(1)
    rn[:n_wood] = wn_s / np.maximum(np.linalg.norm(wn_s, axis=1, keepdims=True), 1e-9)

    # occlusion on the frame, in the rest pose: the joints of the posts and the insides of
    # the caps go dark, which is what gives the frame its form in dots
    span = float(np.ptp(wp, axis=0).max())
    r_ao = 0.09 * span
    occ = np.zeros(n_wood)
    for i, nb in enumerate(tree.query_ball_point(wp, r_ao)):
        d = wp[nb] - wp[i]
        dist = np.linalg.norm(d, axis=1) + 1e-9
        front = np.clip((d / dist[:, None]) @ rn[i], 0, None)
        occ[i] = (front * (1 - dist / r_ao)).sum()
    ao = np.ones(len(rp))
    ao[:n_wood] = 1 - np.clip(occ / max(np.percentile(occ, 97), 1e-9), 0, 1)

    s_mesh, s_tri, s_bary = [], [], []
    for k, (s, a, n) in enumerate(zip(sand, a_sand, n_sand)):
        pick = rng.choice(len(s["idx"]), size=n, p=a / a.sum())
        b = bary(n)
        s_mesh.append(np.full(n, k, np.uint8)); s_tri.append(pick.astype(np.uint16)); s_bary.append(b[:, 1:])
    s_mesh = np.concatenate(s_mesh); s_tri = np.concatenate(s_tri); s_bary = np.concatenate(s_bary)
    s_grain = rng.integers(0, 256, len(s_mesh), dtype=np.uint8)

    # ---- write --------------------------------------------------------------------------
    Q = 0.01                                          # int16 step for bind positions
    assert np.abs(rp).max() / Q < 32000
    parts, layout, off = [], {}, 0

    def put(name, arr):
        nonlocal off
        arr = np.ascontiguousarray(arr)
        pad = (-off) % 4
        if pad:
            parts.append(b"\0" * pad); off += pad
        layout[name] = {"offset": off, "dtype": arr.dtype.str, "shape": list(arr.shape)}
        parts.append(arr.tobytes()); off += arr.nbytes

    put("rpos", np.round(rp / Q).astype("<i2"))
    put("rnrm", np.round(rn * 127).astype("i1"))
    put("rao", np.round(ao * 255).astype("u1"))
    put("rkind", rk)
    for k, s in enumerate(sand):
        put(f"sand{k}_pos", s["pos"].astype("<f4"))
        put(f"sand{k}_deltas", s["deltas"].astype("<f4"))
        put(f"sand{k}_idx", s["idx"].astype("<u2"))
        put(f"sand{k}_w", s["w"].astype("<f4"))
    put("smesh", s_mesh)
    put("stri", s_tri.astype("<u2"))
    put("sbary", np.round(s_bary * 255).astype("u1"))
    put("sgrain", s_grain)
    # per frame: frame/glass bone, then sand bone, normalisation folded in, 3x4 row major
    mats = np.array([[(N @ sk[j])[:3, :4] for j in (1, 2)] for sk in skins], "<f4")
    put("mats", mats)

    (out_dir / "hourglass.bin").write_bytes(b"".join(parts))
    meta = {"fps": args.fps, "frames": frames, "q": Q, "wood": n_wood, "glass": n_glass,
            "sand": n_sand, "layout": layout,
            "credit": "Sands of Time by Antonio Gloria, CC-BY-4.0"}
    (out_dir / "hourglass.json").write_text(json.dumps(meta))
    print(f"wrote hourglass.bin {off / 1024:.0f}KB, {frames} frames at {args.fps}fps")


if __name__ == "__main__":
    sys.exit(main())
