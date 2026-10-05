// The paper plane that "Message me." sends off: a folded paper dart, drawn in the crow's dots.
//
// Like the pull chain it has no canvas of its own. Every frame it hands the renderer shaded
// points in the crow's format (x, y in window px, depth 0..1 with 1 near, ink 0..1), which are
// splatted into the crow's buffer and screened on the crow's lattice, so it is printed the way the
// bird is. The dart is modelled here, not loaded: two wings and the two halves of the keel, each
// a flat triangle of paper, sampled at about half a pixel and shaded with the crow's formula (a
// key light from the upper left front, a rim where the paper turns away), with its folds a little
// darker. Seen from the side, a little above and a little in front: the keel below the spine, the
// two wings rising from it, the far one standing higher.
//
// fly(x, y, onEdge): it appears at (x, y), a little small, settles to full size, and glides
// slowly to the right edge of the window on a gentle rise and fall, nose following its path,
// rocking a little on its long axis. onEdge() is called as its nose reaches the edge; it then
// carries on out of sight.

const LIGHT = (() => { const l = [-0.45, -0.78, 0.44], n = Math.hypot(...l); return l.map(v => v / n); })();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// the dart, nose at +x, y up, z toward the viewer, one unit long
const NOSE = [0.5, 0, 0], TAIL = [-0.5, 0, 0];
const PANELS = [
  [NOSE, TAIL, [-0.5, 0.17, 0.3]],       // near wing, folded up from the spine (the V of a dart)
  [NOSE, TAIL, [-0.5, 0.17, -0.3]],      // far wing
  [NOSE, TAIL, [-0.4, -0.2, 0.02]],      // the keel, two leaves folded together
  [NOSE, TAIL, [-0.4, -0.2, -0.02]],
];

// rotations, applied to [x, y, z]
const rx = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
const ry = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };
const rz = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; };

export function createPlane({ reduce } = {}) {
  const MAXP = 32000;
  const out = new Float32Array(MAXP * 4);
  let count = 0, flight = null;

  function draw(cx, cy, S, pitch, roll, alpha) {
    count = 0;
    const yaw = -0.25, tilt = 0.3;                       // three quarters on, seen a little from above
    const pose = p => rx(ry(rz(rx(p, roll), pitch), yaw), tilt);
    const step = 0.9 / S;                                // under a pixel between samples
    for (const [pi, [A, B, C]] of PANELS.entries()) {
      const under = pi >= 2 ? 0.16 : 0;                  // the keel sits in the wings' shadow
      const a = pose(A), b = pose(B), c = pose(C);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const nl = Math.hypot(...n) || 1; n = n.map(x => x / nl);
      if (n[2] < 0) n = n.map(x => -x);                   // paper has two sides: shade the one we see
      const ns = [n[0], -n[1], n[2]];                      // to screen axes, y down
      const lam = Math.max(0, ns[0] * LIGHT[0] + ns[1] * LIGHT[1] + ns[2] * LIGHT[2]);
      const rim = 1 - Math.max(0, ns[2]);
      const base = 0.16 + 0.62 * (1 - lam) + 0.22 * rim * rim + under;
      const lu = Math.hypot(...u), lv = Math.hypot(...v);
      const nu = Math.ceil(lu / step), nv = Math.ceil(lv / step);
      for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv - Math.floor(i * nv / nu); j++) {
        const s = i / nu, t = j / nv;
        if (s + t > 1) continue;
        if (count >= MAXP) break;
        const x = a[0] + u[0] * s + v[0] * t, y = a[1] + u[1] * s + v[1] * t, z = a[2] + u[2] * s + v[2] * t;
        // the fold along the spine and the panel's outer edges print a little darker
        const fold = t < 0.04 ? 0.32 : (s < 0.025 || s + t > 0.97) ? 0.26 : 0;
        const o = count * 4;
        out[o] = cx + x * S; out[o + 1] = cy - y * S;
        out[o + 2] = clamp(0.5 + z * 0.9, 0, 1);
        out[o + 3] = clamp((base + fold) * alpha, 0, 1);
        count++;
      }
    }
  }

  function update(now) {
    if (!flight) { count = 0; return; }
    const f = flight, t = (now - f.t0) / 1000;
    const W = innerWidth, k = Math.min(1, t / f.dur);
    // it eases into its glide over the first fifth, then keeps a steady, slow pace
    const e = k < 0.2 ? (k * k) / 0.4 : 0.1 + (k - 0.2) * 1.125;
    const x = f.x0 + (W + f.S * 1.2 - f.x0) * e;
    const dy = -f.rise * Math.sin(Math.min(1, e) * Math.PI * 0.9) - 6 * Math.sin(t * 2.4);
    const vy = (-f.rise * Math.PI * 0.9 * Math.cos(Math.min(1, e) * Math.PI * 0.9) * 1.125 / f.dur - 6 * 2.4 * Math.cos(t * 2.4)) ;
    const vx = (W + f.S * 1.2 - f.x0) * 1.125 / f.dur;
    const pitch = clamp(Math.atan2(-vy, vx), -0.45, 0.45);          // nose up while it rises
    const roll = 0.16 * Math.sin(t * 1.7) + 0.05 * Math.sin(t * 4.3);
    const grow = Math.min(1, t / 0.35), S = f.S * (0.7 + 0.3 * (1 - (1 - grow) * (1 - grow)));
    draw(x, f.y0 + dy, S, pitch, roll, Math.min(1, t / 0.15));
    if (!f.edged && x + S * 0.5 >= W) { f.edged = true; f.onEdge && f.onEdge(); }
    if (x - S > W) { flight = null; count = 0; }
  }

  return {
    fly(x, y, onEdge) {
      if (reduce) { onEdge && onEdge(); return; }
      const S = clamp(innerWidth * 0.062, 62, 96);
      const dist = innerWidth - x;
      flight = { t0: performance.now(), x0: x + S * 0.3, y0: y - S * 0.15, S, onEdge, edged: false,
                 dur: clamp(dist / 240, 2.2, 3.6), rise: clamp(dist * 0.09, 18, 60) };
    },
    get flying() { return !!flight; },
    update,
    get points() { return out; },
    get count() { return count; },
  };
}
