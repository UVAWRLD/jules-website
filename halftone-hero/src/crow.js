// A crow as a 3D point cloud, rigged and animated on the CPU.
//
// The cloud is built once from parametric surfaces (no model file, no loader) and carries a
// part id per point, plus a span coordinate for the feathered parts. Every frame the parts
// are posed from a handful of angles, projected to screen pixels here, and handed to the
// renderer as (x px, y px, depth). The halftone pass screens it into the same dot lattice as
// the landscape, so the bird is made of the same dots.
//
// Body space: +x forward (the way it faces), +y up, +z to the bird's right. One unit is
// roughly the body length, so the whole bird spans about 2 units with the tail.

const TAU = Math.PI * 2;

// deterministic, so the cloud is identical on every load
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PART = { BODY: 0, HEAD: 1, BEAK: 2, TAIL: 3, WING_L: 4, WING_R: 5, LEGS: 6 };

// counts are the visual weight of each part, not its area
const COUNT = { body: 1700, head: 520, beak: 150, tail: 620, wing: 900, legs: 160 };

function buildCloud() {
  const rand = rng(20260919);
  const P = [], part = [], span = [], chord = [];
  const push = (x, y, z, p, s = 0, c = 0) => { P.push(x, y, z); part.push(p); span.push(s); chord.push(c); };
  const gauss = () => {
    const u = Math.max(rand(), 1e-9), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  // a point on an ellipsoid's surface, roughened a little so it reads as feathers
  const onEllipsoid = (rx, ry, rz, rough) => {
    let x = gauss(), y = gauss(), z = gauss();
    const l = Math.hypot(x, y, z) || 1;
    const k = 1 + rough * (rand() - 0.5);
    return [x / l * rx * k, y / l * ry * k, z / l * rz * k];
  };

  // body: a deep chested egg, widest at the breast, narrowing to the tail base. A tenth
  // of the points sit inside, so the silhouette still reads as solid ink when it is small.
  for (let i = 0; i < COUNT.body; i++) {
    let [x, y, z] = onEllipsoid(0.56, 0.38, 0.32, 0.06);
    const shrink = rand() < 0.12 ? 0.45 + 0.4 * rand() : 1;
    const behind = Math.max(0, -x / 0.56);
    const taper = 1 - 0.5 * behind * behind;                // narrows behind
    y = y * taper * shrink; z = z * taper * shrink; x *= shrink;
    y += 0.07 * Math.max(0, x / 0.56) - 0.03 * behind;      // breast down, back up
    push(x + 0.02, y, z, PART.BODY);
  }
  // head: big, as crows are. The neck fills in behind it so the two read as one mass.
  for (let i = 0; i < COUNT.head; i++) {
    const t = rand();
    if (t < 0.27) {                                          // neck
      const u = rand(), [x, y, z] = onEllipsoid(0.15, 0.15, 0.14, 0.08);
      push(x * 0.9 + 0.36 + u * 0.16, y * 0.9 + 0.2 + u * 0.13, z * 0.9, PART.HEAD);
    } else {
      const [x, y, z] = onEllipsoid(0.21, 0.19, 0.18, 0.07);
      const shrink = rand() < 0.15 ? 0.5 + 0.4 * rand() : 1;
      push(x * shrink + 0.56, y * shrink + 0.36, z * shrink, PART.HEAD);
    }
  }
  // beak: a straight, heavy cone, angled a touch down, with the crow's deep base
  for (let i = 0; i < COUNT.beak; i++) {
    const t = Math.sqrt(rand()), a = rand() * TAU;
    const r = (0.085 * (1 - t) + 0.005) * (rand() < 0.2 ? rand() : 1);
    push(0.73 + t * 0.33, 0.38 - t * 0.075 + Math.sin(a) * r * 0.85, Math.cos(a) * r * 0.7, PART.BEAK);
  }
  // tail: a flat fan of long feathers, stored in its own space (s along the feather)
  for (let i = 0; i < COUNT.tail; i++) {
    const s = Math.pow(rand(), 0.7), c = rand() * 2 - 1;
    push(0, 0, 0, PART.TAIL, s, c);
  }
  // wings: sheets in wing space, s outboard along the span, c across the chord
  for (const side of [PART.WING_L, PART.WING_R]) {
    for (let i = 0; i < COUNT.wing; i++) {
      const s = Math.pow(rand(), 0.62);                     // denser at the tip: primaries
      const c = rand() * 2 - 1;
      push(0, 0, 0, side, s, c);
    }
  }
  // legs: two lines from under the body to the feet, with three toes each
  for (let i = 0; i < COUNT.legs; i++) {
    const side = rand() < 0.5 ? -1 : 1, t = rand();
    const toe = rand();
    if (toe < 0.4) {                                         // toes splay on the perch
      const a = (Math.floor(rand() * 3) - 1) * 0.55, l = rand() * 0.2;
      push(0.2 + Math.cos(a) * l, -0.42, side * 0.09 + Math.sin(a) * l * 0.7, PART.LEGS);
    } else {
      push(0.17 + t * 0.05, -0.16 - t * 0.26, side * 0.09, PART.LEGS);
    }
  }
  return {
    n: part.length,
    base: new Float32Array(P),
    part: new Uint8Array(part),
    span: new Float32Array(span),
    chord: new Float32Array(chord),
  };
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;

// Poses the cloud and projects it. Screen anchor and scale come from the page, so the bird
// sits on the text box at any window size.
export function createCrow() {
  const cloud = buildCloud();
  const out = new Float32Array(cloud.n * 3);                 // x px, y px, depth 0..1
  const CAM = 7;                                             // camera distance in body lengths
  const FOOT = 0.42;                                         // body space y of the feet

  const st = {
    phase: "waiting",      // waiting -> flyIn -> perched -> takeoff -> gone
    t: 0,                  // seconds in this phase
    delay: 1.1,            // before it flies in
    flap: 0,               // wing beat phase
    bbox: [0, 0, 0, 0],
    visible: false,
  };

  const pose = {
    x: 0, y: 0, z: 0,      // position in screen px (z is depth in body lengths)
    yaw: 0, pitch: 0, roll: 0,
    flapAmp: 0, fold: 1,   // 1 folded on the perch, 0 fully spread
    tailSpread: 0.5, tailDrop: 0,
    legs: 1,               // 1 down on the perch, 0 tucked
    headTurn: 0, headBob: 0,
    scale: 70,
  };

  let perch = [0, 0];      // where the feet go, in screen px
  let path = null;         // cubic bezier for the current flight

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
    st.phase = "flyIn"; st.t = 0; st.visible = true;
  }

  function takeoff(w) {
    const [px, py] = perch;
    const rise = Math.min(0.16 * w, 150);
    path = [[px, py], [px + 0.08 * w, py - rise], [px + 0.45 * w, py - rise * 1.25], [w + 0.2 * w, py - rise * 1.1]];
    st.phase = "takeoff"; st.t = 0;
  }

  // ---- posing -------------------------------------------------------------------------
  const rotX = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
  const rotY = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };
  const rotZ = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; };

  function wingPoint(s, c, side, t) {
    // the wing bends at the elbow: the outer half carries more of the beat, and lags it
    const fold = pose.fold;
    const beat = Math.sin(st.flap - s * 1.15) * pose.flapAmp;
    // folded, the wing lies back along the flank; open, it reaches out and beats
    const dihedral = beat * (0.35 + 0.65 * s) + 0.1 - fold * 0.42;
    const sweep = lerp(0.14, 1.42, fold) + Math.max(0, -beat) * 0.12;
    const twist = beat * 0.35 * s;
    const spanLen = lerp(1.08, 0.6, fold);
    const chordLen = (0.4 - 0.2 * s * s) * lerp(1, 0.42, fold);

    let dir = [0, 0, side];                                  // outboard
    dir = rotX(dir, -side * dihedral);
    dir = rotY(dir, side * sweep);
    let ch = rotZ([1, 0, 0], twist);                          // chord, forward
    const shoulder = [0.22, 0.16, side * 0.13];
    const droop = -0.1 * s * s * (1 - pose.flapAmp) - fold * 0.12 * s;
    const hug = fold * (1 - 0.3 * s);                         // pulled in against the flank
    return [
      shoulder[0] + dir[0] * s * spanLen + ch[0] * c * chordLen,
      shoulder[1] + dir[1] * s * spanLen + ch[1] * c * chordLen + droop + 0.05 * Math.sin(c * 3) * s,
      (shoulder[2] + dir[2] * s * spanLen + ch[2] * c * chordLen) * (1 - 0.45 * hug),
    ];
  }

  // the tail is a fan of separate feathers: c picks the feather, so they stay distinct
  // instead of blurring into a sheet
  function tailPoint(s, c) {
    const len = 0.66, spread = pose.tailSpread;
    const feather = Math.round(c * 3) / 3;                   // 7 feathers, kept distinct
    const a = feather * spread * 0.6;
    const droop = pose.tailDrop;
    // the fan opens across the bird, so from the side it is the layering, not the spread,
    // that gives it depth: each feather sits a little lower than the one inboard of it
    return [
      -0.44 - s * len * Math.cos(a),
      -0.04 - s * droop - Math.abs(feather) * s * 0.1 + (1 - Math.abs(feather)) * 0.03,
      Math.sin(a) * s * len * 0.95,
    ];
  }

  function project(p, w, h, out3, i) {
    // body space -> camera space (yaw, pitch, roll) -> screen px
    let q = rotZ(p, pose.roll);
    q = rotX(q, pose.pitch);
    q = rotY(q, pose.yaw);
    const k = pose.scale * CAM / (CAM - q[2]);
    out3[i] = pose.x + q[0] * k;
    out3[i + 1] = pose.y - (q[1] + FOOT) * k;
    out3[i + 2] = clamp(0.5 + q[2] * 0.5, 0, 1);
  }

  function posed(w, h) {
    const { base, part, span, chord, n } = cloud;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const p = part[i];
      let q;
      if (p === PART.WING_L) q = wingPoint(span[i], chord[i], -1);
      else if (p === PART.WING_R) q = wingPoint(span[i], chord[i], 1);
      else if (p === PART.TAIL) q = tailPoint(span[i], chord[i]);
      else {
        q = [base[j], base[j + 1], base[j + 2]];
        if (p === PART.HEAD || p === PART.BEAK) {
          // head turns and bobs on its own, pivoting at the top of the neck
          const pv = [0.5, 0.24, 0];
          let r = [q[0] - pv[0], q[1] - pv[1] - pose.headBob, q[2] - pv[2]];
          r = rotY(r, pose.headTurn);
          q = [r[0] + pv[0], r[1] + pv[1] + pose.headBob, r[2] + pv[2]];
        } else if (p === PART.LEGS) {
          if (pose.legs < 0.99) {                            // tuck up under the body in flight
            q = [q[0] - (1 - pose.legs) * 0.22, lerp(q[1] + 0.3, q[1], pose.legs), q[2]];
          }
        }
      }
      project(q, w, h, out, j);
      const sx = out[j], sy = out[j + 1];
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
      if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
    }
    st.bbox = [x0, y0, x1, y1];
  }

  // ---- per frame ----------------------------------------------------------------------
  function update(dt, ctx) {
    const { w, h, perchX, perchY, sway, scale, reduce } = ctx;
    perch = [perchX, perchY];
    pose.scale = scale;
    st.t += dt;

    // the bird leans with the same cursor sway as the landscape, so it sits in the scene
    const swayYaw = sway[0] * 0.33, swayPitch = -sway[1] * 0.16;

    if (st.phase === "waiting") {
      st.visible = false;
      if (st.t > st.delay) { reduce ? land() : flyIn(w, h); }
      if (!st.visible) return false;
    }

    if (st.phase === "flyIn") {
      const T = 2.6, t = clamp(st.t / T, 0, 1), e = easeOut(t);
      const [x, y] = bez(path, e);
      const [x2, y2] = bez(path, Math.min(e + 0.02, 1));
      // seen from three quarters on, so the wingbeat reads across the screen
      pose.x = x; pose.y = y;
      pose.yaw = swayYaw + lerp(-0.85, -0.38, ease(clamp((t - 0.5) / 0.5, 0, 1)));
      pose.pitch = clamp(-(y2 - y) * 0.02, -0.5, 0.6) + swayPitch;
      pose.roll = clamp((y2 - y) * 0.004, -0.35, 0.35);
      pose.fold = ease(clamp((t - 0.72) / 0.28, 0, 1));       // wings close as it lands
      pose.flapAmp = lerp(0.95, 0.15, ease(t)) * (1 - pose.fold);
      st.flap += dt * lerp(15, 7, t);
      pose.legs = ease(clamp((t - 0.78) / 0.22, 0, 1));
      pose.tailSpread = lerp(1.1, 0.5, t); pose.tailDrop = lerp(0.05, 0.16, t);
      pose.headTurn = 0; pose.headBob = 0;
      if (t >= 1) { st.phase = "perched"; st.t = 0; }
    } else if (st.phase === "perched") {
      const b = st.t;
      pose.x = perchX; pose.y = perchY;
      pose.fold = 1; pose.flapAmp = 0; pose.legs = 1;
      pose.tailSpread = 0.5; pose.tailDrop = 0.1;
      pose.roll = 0;
      pose.pitch = swayPitch - 0.07 + 0.02 * Math.sin(b * 1.7);   // breathing, breast up
      pose.yaw = swayYaw - 0.38;                              // three quarter view
      // it looks around now and then, and never in a hurry
      const look = Math.sin(b * 0.37) + 0.6 * Math.sin(b * 0.91 + 1.3);
      pose.headTurn = clamp(look, -1, 1) * 0.5;
      pose.headBob = 0.012 * Math.sin(b * 2.3);
      if (reduce) { pose.headTurn = 0; pose.headBob = 0; pose.pitch = swayPitch; }
    } else if (st.phase === "takeoff") {
      const T = 2.3, t = clamp(st.t / T, 0, 1);
      const crouch = clamp(st.t / 0.16, 0, 1);
      if (st.t < 0.16) {                                      // gather, then push
        pose.x = perchX; pose.y = perchY + 5 * crouch;
        pose.pitch = -0.12 * crouch; pose.fold = 1 - 0.35 * crouch;
        pose.flapAmp = 0.2; pose.legs = 1;
      } else {
        const f = clamp((st.t - 0.16) / (T - 0.16), 0, 1);
        const [x, y] = bez(path, easeIn(f) * 0.35 + easeOut(f) * 0.65);
        pose.x = x; pose.y = y;
        pose.fold = 0;
        pose.flapAmp = lerp(1.15, 0.75, f);
        st.flap += dt * lerp(22, 13, f);
        pose.pitch = lerp(0.45, -0.05, ease(f)) + swayPitch;
        pose.roll = lerp(0, -0.22, ease(f));
        pose.yaw = swayYaw + lerp(-0.5, -1.05, ease(f));      // turns away as it goes
        pose.legs = 1 - clamp(f / 0.3, 0, 1);
        pose.tailSpread = lerp(1.2, 0.7, f); pose.tailDrop = 0.05;
        pose.headTurn = lerp(0.35, 0, clamp(f * 2, 0, 1));
      }
      if (t >= 1) { st.phase = "gone"; st.visible = false; return false; }
    } else if (st.phase === "gone") {
      st.visible = false;
      return false;
    }

    posed(w, h);
    return true;
  }

  function land() {                                           // skip the flight (reduced motion)
    st.phase = "perched"; st.t = 0; st.visible = true;
    pose.fold = 1; pose.flapAmp = 0; pose.legs = 1;
  }

  // a click counts if it is inside the bird's box, with a little slack for small birds
  function hit(x, y) {
    if (st.phase !== "perched") return false;
    const [x0, y0, x1, y1] = st.bbox, pad = 8;
    return x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad;
  }

  return {
    positions: out,
    parts: cloud.part,
    count: cloud.n,
    state: st,
    update, hit,
    click(w) { if (st.phase === "perched") { takeoff(w); return true; } return false; },
    replay() { st.phase = "waiting"; st.t = 0; st.delay = 0.15; st.visible = false; },
    get phase() { return st.phase; },
    get bbox() { return st.bbox; },
  };
}
