"""Bake the rigged crow into a point cloud plus its animation, for the halftone renderer.

Input is the Sketchfab glTF ("Crow" by Alexei Ostapenko, CC-BY-4.0). We do not ship the
model or use a runtime loader: this reads the glTF here and writes two small files.

    crow-cloud.bin    points sampled evenly over the mesh surface, in bind space, each
                      with its normal and up to four joints and weights
    crow-anim.bin     per frame skinning matrices (3x4 each), for the frames we keep

The renderer then skins the cloud on the CPU, the same way it already poses the
procedural bird, so the model supplies the shape and the wingbeat while our own state
machine still decides where it flies and when it lands.

    python tools/bake_crow.py <scene.gltf> [--points 2600] [--fps 30]
"""
import argparse, base64, json, pathlib, struct, sys
import numpy as np

COMPONENT = {5120: "i1", 5121: "u1", 5122: "i2", 5123: "u2", 5125: "u4", 5126: "f4"}
NUM = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class GLTF:
    def __init__(self, path):
        self.path = pathlib.Path(path)
        self.g = json.loads(self.path.read_text())
        self.buffers = [self._buffer(b) for b in self.g["buffers"]]

    def _buffer(self, b):
        uri = b.get("uri", "")
        if uri.startswith("data:"):
            return base64.b64decode(uri.split(",", 1)[1])
        return (self.path.parent / uri).read_bytes()

    def accessor(self, i):
        a = self.g["accessors"][i]
        n = NUM[a["type"]]
        dtype = np.dtype("<" + COMPONENT[a["componentType"]])
        if "bufferView" not in a:
            return np.zeros((a["count"], n), dtype)
        bv = self.g["bufferViews"][a["bufferView"]]
        buf = self.buffers[bv["buffer"]]
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride") or n * dtype.itemsize
        raw = np.frombuffer(buf, np.uint8, count=stride * a["count"], offset=start)
        out = np.empty((a["count"], n), dtype)
        for k in range(a["count"]):
            out[k] = np.frombuffer(raw, dtype, count=n, offset=k * stride)
        return out.reshape(a["count"], n) if n > 1 else out.reshape(-1, 1)


def trs(node):
    if "matrix" in node:
        return np.array(node["matrix"], np.float64).reshape(4, 4).T
    t = np.array(node.get("translation", [0, 0, 0]), np.float64)
    r = np.array(node.get("rotation", [0, 0, 0, 1]), np.float64)
    s = np.array(node.get("scale", [1, 1, 1]), np.float64)
    return compose(t, r, s)


def compose(t, q, s):
    x, y, z, w = q
    m = np.eye(4)
    m[:3, :3] = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]) * s[None, :]
    m[:3, 3] = t
    return m


def slerp(a, b, t):
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        return a + t * (b - a)
    th = np.arccos(np.clip(d, -1, 1))
    return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gltf")
    ap.add_argument("--points", type=int, default=2600)
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    gl = GLTF(args.gltf)
    g = gl.g
    out_dir = pathlib.Path(args.out or (pathlib.Path(__file__).resolve().parent.parent / "public" / "models"))
    out_dir.mkdir(parents=True, exist_ok=True)

    # ---- mesh in bind space -------------------------------------------------------------
    prim = g["meshes"][0]["primitives"][0]
    pos = gl.accessor(prim["attributes"]["POSITION"]).astype(np.float64)
    nrm = gl.accessor(prim["attributes"]["NORMAL"]).astype(np.float64)
    joints = gl.accessor(prim["attributes"]["JOINTS_0"]).astype(np.int32)
    weights = gl.accessor(prim["attributes"]["WEIGHTS_0"]).astype(np.float64)
    if weights.dtype != np.float64:
        weights = weights / np.iinfo(weights.dtype).max
    weights = weights / np.maximum(weights.sum(1, keepdims=True), 1e-9)
    idx = gl.accessor(prim["indices"]).reshape(-1, 3)

    # ---- sample points evenly over the surface, by triangle area ------------------------
    rng = np.random.default_rng(20260919)
    tri = pos[idx]
    area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    pick = rng.choice(len(idx), size=args.points, p=area / area.sum())
    u, v = rng.random(args.points), rng.random(args.points)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    bary = np.stack([1 - u - v, u, v], 1)                       # per sampled point
    verts = idx[pick]
    p_pos = (bary[:, :, None] * pos[verts]).sum(1)
    # the normal is what lets the renderer shade the bird, which is what turns a flat
    # silhouette into a halftone with dot sizes that follow the form
    p_nrm = (bary[:, :, None] * nrm[verts]).sum(1)
    p_nrm /= np.maximum(np.linalg.norm(p_nrm, axis=1, keepdims=True), 1e-9)
    # the model is low poly, so its normals are faceted and the shading comes out mottled.
    # Average each point with its neighbours on the surface: the form survives, the facets
    # do not.
    from scipy.spatial import cKDTree
    tree = cKDTree(p_pos)
    _, near_idx = tree.query(p_pos, k=18)
    p_nrm = p_nrm[near_idx].mean(1)
    p_nrm /= np.maximum(np.linalg.norm(p_nrm, axis=1, keepdims=True), 1e-9)

    # ambient occlusion, baked in the rest pose: how much of the neighbourhood sits in
    # front of each point. Creases (wing against flank, under the tail, between the legs)
    # come out dark, which is what gives the halftone its form rather than a flat mass.
    span_all = float(np.ptp(p_pos, axis=0).max())
    r_ao = 0.13 * span_all
    counts = tree.query_ball_point(p_pos, r_ao, return_length=True)
    occ = np.zeros(len(p_pos))
    for i, nb in enumerate(tree.query_ball_point(p_pos, r_ao)):
        if not nb:
            continue
        d = p_pos[nb] - p_pos[i]
        dist = np.linalg.norm(d, axis=1) + 1e-9
        front = np.clip((d / dist[:, None]) @ p_nrm[i], 0, None)   # above the tangent plane
        occ[i] = (front * (1 - dist / r_ao)).sum()
    p_ao = 1 - np.clip(occ / max(np.percentile(occ, 97), 1e-9), 0, 1)
    print(f"ao: radius {r_ao:.3f}, mean {p_ao.mean():.2f}, "
          f"range {p_ao.min():.2f}-{p_ao.max():.2f}, neighbours {counts.mean():.0f}")

    # each sample inherits the joints and weights of its triangle's nearest corner, which
    # keeps the four-bone limit without blending across unrelated bones
    near = bary.argmax(1)
    corner = verts[np.arange(len(verts)), near]
    p_joint = joints[corner]
    p_weight = weights[corner]

    # ---- skeleton -----------------------------------------------------------------------
    skin = g["skins"][0]
    joint_nodes = skin["joints"]
    inv_bind = gl.accessor(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    parent = {}
    for i, n in enumerate(g["nodes"]):
        for c in n.get("children", []):
            parent[c] = i
    order = []                                                   # parents before children
    seen = set()

    def walk(n):
        if n in seen:
            return
        seen.add(n)
        order.append(n)
        for c in g["nodes"][n].get("children", []):
            walk(c)

    roots = [i for i in range(len(g["nodes"])) if i not in parent]
    for r in roots:
        walk(r)

    # ---- animation ----------------------------------------------------------------------
    anim = g["animations"][0]
    tracks = {}                                                  # node -> path -> (times, values)
    t_end = 0.0
    for ch in anim["channels"]:
        s = anim["samplers"][ch["sampler"]]
        times = gl.accessor(s["input"]).reshape(-1)
        vals = gl.accessor(s["output"])
        tracks.setdefault(ch["target"]["node"], {})[ch["target"]["path"]] = (times, vals, s.get("interpolation", "LINEAR"))
        t_end = max(t_end, float(times[-1]))

    def sample(node, path, t, default):
        tr = tracks.get(node, {}).get(path)
        if tr is None:
            return np.array(g["nodes"][node].get(path, default), np.float64)
        times, vals, interp = tr
        if t <= times[0]:
            return vals[0].astype(np.float64)
        if t >= times[-1]:
            return vals[-1].astype(np.float64)
        i = int(np.searchsorted(times, t) - 1)
        span = times[i + 1] - times[i]
        f = 0.0 if span <= 0 else (t - times[i]) / span
        a, b = vals[i].astype(np.float64), vals[i + 1].astype(np.float64)
        if interp == "STEP":
            return a
        return slerp(a, b, f) if path == "rotation" else a + f * (b - a)

    frames = int(round(t_end * args.fps)) + 1
    mats = np.zeros((frames, len(joint_nodes), 3, 4), np.float32)
    world = [np.eye(4)] * len(g["nodes"])
    for fi in range(frames):
        t = fi / args.fps
        world = [None] * len(g["nodes"])
        for n in order:
            local = compose(sample(n, "translation", t, [0, 0, 0]),
                            sample(n, "rotation", t, [0, 0, 0, 1]),
                            sample(n, "scale", t, [1, 1, 1])) if n in tracks else trs(g["nodes"][n])
            p = parent.get(n)
            world[n] = local if p is None else world[p] @ local
        for j, n in enumerate(joint_nodes):
            mats[fi, j] = (world[n] @ inv_bind[j])[:3, :]

    # ---- orient and scale: +x forward, +y up, one unit from beak to tail ------------------
    def skin_frame(fi):
        m = mats[fi][p_joint]                                    # points x 4 x 3 x 4
        p = np.concatenate([p_pos, np.ones((len(p_pos), 1))], 1)
        out = np.einsum("pbij,pj,pb->pi", m, p, p_weight)
        return out

    ref = skin_frame(0)
    span = ref.max(0) - ref.min(0)
    long_axis = int(np.argmax(span))
    up_axis = int(np.argmax([span[i] if i != long_axis else -1 for i in range(3)]))
    print(f"frames {frames}  points {len(p_pos)}  bind span {np.round(span, 3)} "
          f"long axis {long_axis} up axis {up_axis}")

    scale = 1.0 / span[long_axis]
    perm = [long_axis, up_axis, 3 - long_axis - up_axis]
    p_nrm = p_nrm[:, perm]
    for fi in range(frames):
        mats[fi] = mats[fi][:, perm, :]                          # reorder rows to x,y,z

    # which end is the head? The longest axis does not say, and getting it wrong makes the
    # bird fly backwards. Ask the skeleton: find the head joint and see which way it sits.
    head_j = next((j for j, nd in enumerate(joint_nodes)
                   if "head" in (g["nodes"][nd].get("name") or "").lower()), None)
    if head_j is None:
        print("no head joint found; leaving the facing as it is")
    else:
        head_x = float(mats[0, head_j, 0, 3])
        body_x = float(np.median(skin_frame(0)[:, 0]))
        if head_x < body_x:                                      # turn it around, not mirror
            mats[:, :, 0, :] *= -1
            mats[:, :, 2, :] *= -1
            p_nrm[:, 0] *= -1
            p_nrm[:, 2] *= -1
            print("head was facing -x: rotated 180 degrees about up")
        else:
            print("head already faces +x")
    mats *= scale
    centre = (skin_frame(0).min(0) + skin_frame(0).max(0)) / 2
    mats[:, :, :, 3] -= centre[None, None, :]

    # ---- write ---------------------------------------------------------------------------
    cloud = out_dir / "crow-cloud.bin"
    with cloud.open("wb") as f:
        f.write(struct.pack("<4sIII", b"CRWC", 3, len(p_pos), 0))
        f.write(p_pos.astype("<f4").tobytes())
        f.write(np.clip(np.round(p_nrm * 127), -127, 127).astype("<i1").tobytes())
        f.write((p_ao * 255).round().clip(0, 255).astype("<u1").tobytes())
        f.write(p_joint.astype("<u1").tobytes())
        f.write((p_weight * 255).round().clip(0, 255).astype("<u1").tobytes())
    # int16 with one scale for the file: the matrices sit well inside +-3, and 1e-4 of a
    # body length is far finer than a dot, so this halves the file for nothing visible
    animf = out_dir / "crow-anim.bin"
    q = np.clip(np.round(mats * 10000.0), -32767, 32767).astype("<i2")
    with animf.open("wb") as f:
        f.write(struct.pack("<4sIIIff", b"CRWA", 2, frames, len(joint_nodes), args.fps, 1 / 10000.0))
        f.write(q.tobytes())
    print(f"{cloud.name} {cloud.stat().st_size // 1024}KB, {animf.name} {animf.stat().st_size // 1024}KB")

    # segments, found by how much the wings move: still means perched, beating means flight
    span_y = np.array([float(np.ptp(skin_frame(fi)[:, 1])) for fi in range(frames)])
    moving = span_y > span_y[:120].mean() * 1.25
    first = int(np.argmax(moving)) if moving.any() else frames
    meta = {
        "fps": args.fps, "frames": frames, "points": len(p_pos),
        "idle": [0, max(first - 10, 1)],          # perched, with the pecks
        "takeoff": [max(first - 10, 1), min(first + 50, frames)],
        "flight": [min(first + 50, frames - 1), frames],
        "credit": "Crow by Alexei Ostapenko, CC-BY-4.0, sketchfab.com/3d-models/crow-d5a9b0df4da3493688b63ce42c8a83e2",
    }
    (out_dir / "crow.json").write_text(json.dumps(meta, indent=2) + "\n")
    print("segments", {k: v for k, v in meta.items() if isinstance(v, list)})


if __name__ == "__main__":
    sys.exit(main())
