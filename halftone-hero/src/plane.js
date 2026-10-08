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
// fly(x, y, onEdge): it appears at (x, y), a little small, settles to full size, and glides to the
// right edge of the window (see update for the flight). onEdge() is called as its nose reaches the
// edge; it then carries on out of sight.

const LIGHT = (() => { const l = [-0.45, -0.78, 0.44], n = Math.hypot(...l); return l.map(v => v / n); })();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The dart is "Animated Paper plane | Blockbench" by 3DartSam (Sketchfab, CC-BY-4.0), given to Jules
// by a friend; public/models/paper-plane-license.txt is the record. Only its shape is used (its six
// triangles, read out of the GLB): its own animation, a loop the loop, is not. Here in our frame,
// nose at +x, y up, z across, one unit long: two broad wings drooping a little from the spine and
// the two leaves of the keel below. (The model's inner wing layers lie in the wings' planes and add
// nothing seen from outside, so they are left out.)
const NOSE = [0.5, 0.037, 0];
const SPINE_L = [-0.5, 0.104, 0.031], SPINE_R = [-0.5, 0.104, -0.031];
const TIP_L = [-0.5, 0.004, 0.5], TIP_R = [-0.5, 0.004, -0.5], KEEL = [-0.5, -0.196, 0];
const PANELS = [
  [NOSE, SPINE_L, TIP_L],                 // wing
  [NOSE, SPINE_R, TIP_R],                 // wing
  [NOSE, SPINE_L, KEEL],                  // keel leaf
  [NOSE, SPINE_R, KEEL],                  // keel leaf
];

// a slight turn about its long axis, held through the flight, so it banks a little toward you
// and shows more of the top of its wings
const ROLL = 0.2;

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
    const yaw = -0.3, tilt = 0.45;                       // three quarters on, seen a little from above
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

  // The flight is simulated, a little differently every time: thrown from the link, it starts
  // fast and slows to a glide; its speed and height are pushed about by gusts (a few slow sines
  // with random rates and phases, so nothing repeats or jumps), and it rocks and banks with them.
  // It is never allowed to sink: its height is sprung toward a line that climbs gently from where
  // it was thrown (40-90px over the flight), and a hard floor a few pixels below its start pushes
  // it back up, so it never dives, and never heads down toward the city under the copy.
  function update(now) {
    if (!flight) { count = 0; return; }
    const f = flight;
    const dt = Math.min(0.05, Math.max(0, (now - f.last) / 1000)); f.last = now;
    const t = (now - f.t0) / 1000, W = innerWidth;
    const g = (k) => { let v = 0; for (const [a, w, ph] of f.gust[k]) v += a * Math.sin(w * t + ph); return v; };
    // forward: the throw decays to a cruise, which the gusts speed up and slow down
    const cruise = f.cruise * (1 + 0.16 * g(0));
    f.vx += ((cruise + f.throwV * Math.exp(-t / 0.45)) - f.vx) * Math.min(1, dt * 4);
    f.x += f.vx * dt;
    // up and down: a spring toward a gently climbing line, plus gusts; a floor below the start
    const along = Math.min(1, (f.x - f.x0) / Math.max(1, W - f.x0));
    const target = f.y0 - f.climb * (1 - Math.pow(1 - along, 2)) + 14 * g(1);
    f.vy += ((target - f.y) * 9 - f.vy * 4.2) * dt;
    if (f.y > f.y0 + 6) f.vy = Math.min(f.vy, -40 * (f.y - f.y0 - 6) / 6);
    f.y += f.vy * dt;
    // attitude: nose along the path (with a little lag), banking and rocking in the gusts
    const want = Math.atan2(-f.vy, f.vx) * 0.85;
    f.pitch += (clamp(want, -0.42, 0.42) - f.pitch) * Math.min(1, dt * 6);
    const roll = ROLL + 0.22 * g(2) + 0.06 * Math.sin(t * 5.1 + f.ph);
    const grow = Math.min(1, t / 0.3), S = f.S * (0.72 + 0.28 * (1 - (1 - grow) * (1 - grow)));
    draw(f.x, f.y, S, f.pitch, roll, Math.min(1, t / 0.12));
    if (!f.edged && f.x + S * 0.5 >= W) { f.edged = true; f.onEdge && f.onEdge(); }
    if (f.x - S > W || t > 12) { flight = null; count = 0; }
  }

  return {
    fly(x, y, onEdge) {
      if (reduce) { onEdge && onEdge(); return; }
      const r = (a, b) => a + Math.random() * (b - a);
      // on a phone it is smaller (its 44px floor was big on a 375px screen) and climbs much more,
      // since the edge is close: up and away to the side, where it can be seen
      const phone = innerWidth <= 820;
      const S = phone ? clamp(innerWidth * 0.085, 30, 38) : clamp(innerWidth * 0.042, 44, 64), now = performance.now();
      const gust = () => [[1, r(0.7, 1.3), r(0, 6.3)], [0.55, r(1.6, 2.6), r(0, 6.3)], [0.3, r(3.1, 4.4), r(0, 6.3)]]
        .map(([a, w, ph]) => [a / 1.85, w, ph]);
      const x0 = x + S * 0.3, y0 = y - S * 0.2;
      const cruise = clamp((innerWidth - x0) / r(2.1, 2.7), 70, 600);   // about two and a half seconds to the edge, on any screen
      flight = { t0: now, last: now, x: x0, y: y0, x0, y0, S, onEdge, edged: false,
                 vx: 0, vy: r(-70, -40), pitch: 0, ph: r(0, 6.3),
                 cruise, throwV: cruise * r(0.8, 1.2),
                 climb: phone ? clamp((y - 60) * r(0.3, 0.42), 90, 220) : r(40, 90), gust: [gust(), gust(), gust()] };
    },
    get flying() { return !!flight; },
    update,
    get points() { return out; },
    get count() { return count; },
  };
}
