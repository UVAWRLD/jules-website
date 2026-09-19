// The crow: a rigged model, baked to a point cloud, posed by our own state machine.
//
// The shape and the wingbeat come from the Sketchfab model ("Crow" by Alexei Ostapenko,
// CC-BY-4.0), baked by tools/bake_crow.py into two files: points sampled over its surface
// with their bone weights, and the animation as per frame skinning matrices. Nothing is
// loaded at runtime beyond those two files: no glTF loader, no three.js.
//
// What the model does not supply is the performance. Its animation is a single take of a
// bird sitting, pecking, then leaving, all in place. We cut it into three ranges and decide
// ourselves when each plays, where the bird is on the page, and which way it faces.
//
// Model space after the bake: +x forward, +y up, one unit from beak to tail tip.

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;

const BASE = "public/models/";

async function load(base) {
  const [cloudBuf, animBuf, meta] = await Promise.all([
    fetch(base + "crow-cloud.bin").then(r => r.arrayBuffer()),
    fetch(base + "crow-anim.bin").then(r => r.arrayBuffer()),
    fetch(base + "crow.json").then(r => r.json()),
  ]);

  const n = new DataView(cloudBuf).getUint32(8, true);
  let off = 16;
  const pos = new Float32Array(cloudBuf, off, n * 3); off += n * 12;
  const joint = new Uint8Array(cloudBuf, off, n * 4); off += n * 4;
  const raw = new Uint8Array(cloudBuf, off, n * 4);
  const weight = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) weight[i] = raw[i] / 255;

  const av = new DataView(animBuf);
  const frames = av.getUint32(8, true), joints = av.getUint32(12, true);
  const fps = av.getFloat32(16, true), q = av.getFloat32(20, true);
  const qm = new Int16Array(animBuf, 24, frames * joints * 12);
  const mats = new Float32Array(qm.length);
  for (let i = 0; i < qm.length; i++) mats[i] = qm[i] * q;

  return { n, pos, joint, weight, frames, joints, fps, mats, meta };
}

export function createCrow(base = BASE) {
  const CAM = 7;                       // camera distance, in body lengths
  const st = {
    phase: "loading",                  // loading -> waiting -> flyIn -> perched -> takeoff -> gone
    t: 0, delay: 1.1,
    bbox: [0, 0, 0, 0],
    frame: 0,                          // where we are in the baked animation
    ready: false,
  };
  const pose = { x: 0, y: 0, yaw: 0, pitch: 0, roll: 0, scale: 70 };
  let M = null, out = new Float32Array(0), skinned = null;
  let frameMats = null, blendFrom = null, blendT = 0;
  let foot = 0;                        // model y of the feet, so it stands on the perch
  let perch = [0, 0], path = null;

  load(base).then(m => {
    M = m;
    out = new Float32Array(m.n * 3);
    skinned = new Float32Array(m.n * 3);
    frameMats = new Float32Array(m.joints * 12);
    blendFrom = new Float32Array(m.joints * 12);
    poseFrame(m.meta.idle[0], 0);
    let lo = 1e9;
    for (let i = 1; i < m.n * 3; i += 3) lo = Math.min(lo, skinned[i]);
    foot = lo;
    st.ready = true; st.phase = "waiting";
  }).catch(e => console.error("crow: could not load the baked model", e));

  // ---- skinning -----------------------------------------------------------------------
  function gather(fi, fract) {
    const { mats, joints, frames } = M;
    const a = clamp(Math.floor(fi), 0, frames - 1) * joints * 12;
    const b = clamp(Math.floor(fi) + 1, 0, frames - 1) * joints * 12;
    const t = fract;
    for (let j = 0; j < joints * 12; j++) frameMats[j] = mats[a + j] * (1 - t) + mats[b + j] * t;
    if (blendT > 0) {                  // crossfade after a phase change, so poses do not pop
      for (let j = 0; j < joints * 12; j++) {
        frameMats[j] = blendFrom[j] * blendT + frameMats[j] * (1 - blendT);
      }
    }
  }

  function poseFrame(fi, fract) {
    gather(fi, fract);
    const { n, pos, joint, weight } = M;
    for (let i = 0, p = 0, k = 0; i < n; i++, p += 3, k += 4) {
      const x = pos[p], y = pos[p + 1], z = pos[p + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let b = 0; b < 4; b++) {
        const w = weight[k + b];
        if (w <= 0) continue;
        const m = joint[k + b] * 12;
        ox += w * (frameMats[m] * x + frameMats[m + 1] * y + frameMats[m + 2] * z + frameMats[m + 3]);
        oy += w * (frameMats[m + 4] * x + frameMats[m + 5] * y + frameMats[m + 6] * z + frameMats[m + 7]);
        oz += w * (frameMats[m + 8] * x + frameMats[m + 9] * y + frameMats[m + 10] * z + frameMats[m + 11]);
      }
      skinned[p] = ox; skinned[p + 1] = oy; skinned[p + 2] = oz;
    }
  }

  function startPhase(name) {          // keep the current pose to blend out of
    if (frameMats) blendFrom.set(frameMats);
    blendT = 0.999;
    st.phase = name; st.t = 0;
  }

  // ---- flight paths -------------------------------------------------------------------
  const bez = (p, t) => {
    const u = 1 - t;
    return [
      u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
      u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1],
    ];
  };
  function flyIn(w, h) {
    const [px, py] = perch;
    path = [[-0.15 * w, py - 0.3 * h], [0.16 * w, py - 0.36 * h], [px - 0.4 * w, py - 0.12 * h], [px, py]];
    startPhase("flyIn");
  }
  function takeoff(w) {
    const [px, py] = perch;
    const rise = Math.min(0.13 * w, 130);   // the model leaps on its own, so ours is gentle
    path = [[px, py], [px + 0.08 * w, py - rise], [px + 0.45 * w, py - rise * 1.2], [w * 1.2, py - rise * 1.05]];
    startPhase("takeoff");
  }

  // ---- projection ---------------------------------------------------------------------
  function project() {
    const { n } = M;
    const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw);
    const cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch);
    const cr = Math.cos(pose.roll), sr = Math.sin(pose.roll);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0, p = 0; i < n; i++, p += 3) {
      const x = skinned[p], y = skinned[p + 1] - foot, z = skinned[p + 2];
      const rx = x * cr - y * sr, ry = x * sr + y * cr;        // roll
      const ty = ry * cp - z * sp, tz = ry * sp + z * cp;      // pitch
      const fx = rx * cy + tz * sy, fz = -rx * sy + tz * cy;   // yaw
      const k = pose.scale * CAM / (CAM - fz);
      const sx = pose.x + fx * k, syy = pose.y - ty * k;
      out[p] = sx; out[p + 1] = syy; out[p + 2] = clamp(0.5 + fz * 0.5, 0, 1);
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
      if (syy < y0) y0 = syy; if (syy > y1) y1 = syy;
    }
    st.bbox = [x0, y0, x1, y1];
  }

  // ---- per frame ----------------------------------------------------------------------
  function update(dt, ctx) {
    if (!st.ready) return false;
    const { w, h, perchX, perchY, sway, scale, reduce } = ctx;
    perch = [perchX, perchY];
    pose.scale = scale;
    st.t += dt;
    blendT = Math.max(0, blendT - dt * 6);            // about a sixth of a second

    const { idle, takeoff: to, flight } = M.meta;
    const swayYaw = sway[0] * 0.33, swayPitch = -sway[1] * 0.16;
    const loop = (a, b, t) => a + ((t * M.fps) % (b - a));

    if (st.phase === "waiting") {
      if (st.t > st.delay) { reduce ? startPhase("perched") : flyIn(w, h); }
      return false;
    }

    if (st.phase === "flyIn") {
      const T = 2.6, t = clamp(st.t / T, 0, 1), e = easeOut(t);
      const [x, y] = bez(path, e), [x2, y2] = bez(path, Math.min(e + 0.02, 1));
      pose.x = x; pose.y = y;
      pose.yaw = swayYaw + lerp(-0.85, -0.38, ease(clamp((t - 0.5) / 0.5, 0, 1)));
      pose.pitch = clamp(-(y2 - y) * 0.02, -0.5, 0.6) + swayPitch;
      pose.roll = clamp((y2 - y) * 0.004, -0.35, 0.35);
      st.frame = loop(flight[0], flight[1], st.t);
      if (t >= 1) startPhase("perched");
    } else if (st.phase === "perched") {
      pose.x = perchX; pose.y = perchY;
      pose.yaw = swayYaw - 0.38;
      pose.pitch = swayPitch;
      pose.roll = 0;
      // the idle take is the bird sitting, looking about and pecking: just let it run
      st.frame = reduce ? idle[0] : loop(idle[0], idle[1], st.t);
    } else if (st.phase === "takeoff") {
      const T = 2.3, t = clamp(st.t / T, 0, 1);
      const lead = 0.22;                              // it crouches and leaps before moving
      if (st.t < lead) {
        pose.x = perchX; pose.y = perchY;
        pose.pitch = swayPitch; pose.yaw = swayYaw - 0.38;
      } else {
        const f = clamp((st.t - lead) / (T - lead), 0, 1);
        const [x, y] = bez(path, easeIn(f) * 0.35 + easeOut(f) * 0.65);
        pose.x = x; pose.y = y;
        pose.pitch = lerp(0.3, -0.05, ease(f)) + swayPitch;
        pose.roll = lerp(0, -0.2, ease(f));
        pose.yaw = swayYaw + lerp(-0.5, -1.05, ease(f));
      }
      const tf = to[0] + st.t * M.fps;
      st.frame = tf < to[1] ? tf : loop(flight[0], flight[1], st.t - (to[1] - to[0]) / M.fps);
      if (t >= 1) { st.phase = "gone"; return false; }
    } else {
      return false;
    }

    poseFrame(Math.floor(st.frame), st.frame - Math.floor(st.frame));
    project();
    return true;
  }

  return {
    get positions() { return out; },
    get count() { return M ? M.n : 0; },
    get ready() { return st.ready; },
    get phase() { return st.phase; },
    get bbox() { return st.bbox; },
    get credit() { return M ? M.meta.credit : ""; },
    state: st,
    update,
    hit(x, y) {
      if (st.phase !== "perched") return false;
      const [x0, y0, x1, y1] = st.bbox, pad = 8;
      return x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad;
    },
    click(w) { if (st.phase === "perched") { takeoff(w); return true; } return false; },
    replay() { st.phase = "waiting"; st.t = 0; st.delay = 0.15; },
  };
}
