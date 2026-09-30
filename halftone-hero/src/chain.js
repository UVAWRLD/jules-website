// A pull chain hanging to the right of the place caption. Pull it down and the page switches
// between light and dark, like a lamp cord.
//
// The chain is a verlet rope (a string of points with their last positions, gravity, and
// distance constraints that only resist stretching, so it can go slack). It is not drawn
// here: every frame it is turned into shaded points, the link outlines and a lit bead, which
// the renderer splats into the crow's buffer, so the chain is screened into the same dots
// as the bird. Pulling feeds more chain out of the mount, up to MAX_PULL; past PULL_AT it
// clicks and the theme changes, and on release it springs back in.

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function createChain({ fine, reduce, getLean, onPull, dot }) {
  const caption = document.querySelector(".caption");
  const handle = document.createElement("button");
  handle.id = "chainPull"; handle.type = "button";
  document.body.append(handle);

  const N = 22;                           // rope points
  const REST_MAX = fine ? 64 : 72;        // hanging length, px, when there is room for it (by touch 56 read as short, 84 as a touch long)
  let REST = REST_MAX;
  const MAX_PULL = 30, PULL_AT = 19;      // extra chain a pull can draw out; where it clicks
  const PITCH = 4.4;                      // bead to bead, px: a ball chain, like a lamp pull
  const BEAD = 1.6;                       // bead radius, px
  const G = 1700;                         // gravity, px/s²
  const STEP = 1 / 120;

  let ax = 0, ay = 0;                     // the mount, in page px
  const p = [], q = [];
  for (let i = 0; i < N; i++) { p.push([0, 0]); q.push([0, 0]); }

  // The mount sits just right of the caption. The caption is pinned by its right edge, so the
  // mount stays put when the place names change width; if the layout moves it, it glides
  // there (in step()) and the chain swings from the move, rather than jumping.
  let axT = 0, ayT = 0, ready = false;
  function measure() {
    const r = caption.getBoundingClientRect();
    axT = r.right + 14; ayT = r.top + r.height / 2 - 1;
    // Never down into the copy: the chain stops 30px above the first line of text that actually
    // reaches under it. Lines, not the copy's box: on a phone the box runs the full width, but
    // its top lines (the name, the links) end well short of the chain, and judging by the box
    // cut the chain to its 30px minimum whenever the copy sat high.
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("copy"));
    let under = Infinity;
    for (const r of range.getClientRects())
      if (r.width && r.right > axT - 12 && r.left < axT + 12) under = Math.min(under, r.top);
    REST = clamp(under - ayT - 30 - MAX_PULL * 0.5, 30, REST_MAX);
    if (!ready) { ax = axT; ay = ayT; hang(); ready = true; }
  }
  function hang() {
    for (let i = 0; i < N; i++) { const y = ay + REST * i / (N - 1); p[i] = [ax, y]; q[i] = [ax, y]; }
  }
  measure();
  addEventListener("resize", measure);
  // the caption changes width with the place names, and moves when the layout does
  new ResizeObserver(measure).observe(caption);
  new ResizeObserver(measure).observe(document.getElementById("copy"));
  // the copy is placed by the phone layout after load, and the browser's bars settle late
  if (window.visualViewport) visualViewport.addEventListener("resize", measure);
  [150, 600, 1500, 3000].forEach(t => setTimeout(measure, t));
  if (document.fonts) document.fonts.ready.then(measure);

  // ---- interaction ----
  let dragging = false, px = 0, py = 0, downAt = null, fired = false, grabOff = 0;
  let feed = 0, feedV = 0, auto = -1;
  let mouse = null, mousePrev = null;

  const pointerTo = e => { px = e.clientX; py = e.clientY; };
  handle.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    dragging = true; fired = false; auto = -1; pointerTo(e); downAt = [e.clientX, e.clientY, performance.now()];
    // The whole chain is the grab area. Taken anywhere along it, the drag counts from the end:
    // the chain still out below the finger is added to the finger's distance from the mount.
    grabOff = Math.max(0, REST + feed - Math.hypot(px - ax, py - ay));
    handle.classList.add("held");
  });
  handle.addEventListener("pointermove", e => { if (dragging) pointerTo(e); });
  const release = e => {
    if (!dragging) return;
    dragging = false; handle.classList.remove("held");
    // the bead springs back from under the pointer, so the hover may have ended mid drag
    if (dot) { const r = handle.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dot.classList.remove("over"); }
    // a tap, not a pull: do the pull for them
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 6 && performance.now() - downAt[2] < 350 && !fired) auto = 0;
    downAt = null;
  };
  handle.addEventListener("pointerup", release);
  handle.addEventListener("pointercancel", release);
  handle.addEventListener("lostpointercapture", release);    // a press the browser dropped
  handle.addEventListener("click", e => e.stopPropagation());
  handle.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fired = false; auto = 0; } });
  if (fine && dot) {
    handle.addEventListener("pointerenter", () => dot.classList.add("over"));
    handle.addEventListener("pointerleave", () => { if (!dragging) dot.classList.remove("over"); });
  }
  // brushing past it with the cursor sets it swinging
  addEventListener("pointermove", e => { if (e.pointerType === "mouse") mouse = [e.clientX, e.clientY]; }, { passive: true });

  function label() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    handle.setAttribute("aria-label", dark ? "Pull for light mode" : "Pull for dark mode");
  }
  label();

  function pull() {
    if (fired) return;
    fired = true;
    onPull(); label();
    if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
    // the click: a small jolt down the chain
    for (let i = 1; i < N; i++) q[i][1] -= 1.6 * i / N;
  }

  // ---- physics ----
  function step(dt, t) {
    ax += (axT - ax) * Math.min(1, dt * 9); ay += (ayT - ay) * Math.min(1, dt * 9);
    const lean = !fine && getLean ? getLean() : [0, 0];
    const gx = lean[0] * G * 0.28, gy = G;
    // the pull: how much extra chain is out of the mount
    let tx = null, ty = null;
    if (auto >= 0) {                                       // a pull done for them
      auto += dt;
      const k = auto < 0.16 ? auto / 0.16 : Math.max(0, 1 - (auto - 0.24) / 0.1);
      const want = MAX_PULL * 0.95 * k;
      feed += (want - feed) * Math.min(1, dt * 40);
      if (feed > PULL_AT) pull();
      if (auto > 0.34) { auto = -1; fired = false; }
      tx = p[N - 1][0]; ty = ay + REST + feed;
    } else if (dragging) {
      const dx = px - ax, dy = py - ay, dp = Math.hypot(dx, dy) || 1, d = dp + grabOff;
      const reach = REST + MAX_PULL;
      const s = Math.min(reach, d) / dp;                   // the end, along the finger's line
      tx = ax + dx * s; ty = ay + dy * s;
      const want = clamp(d - REST, 0, MAX_PULL);
      feed += (want - feed) * Math.min(1, dt * 30);
      if (feed > PULL_AT) pull();
    } else {
      feedV += (-520 * feed - 26 * feedV) * dt;             // sprung back in, with a little bounce
      feed += feedV * dt;
      if (feed < 0) { feed = 0; feedV = -feedV * 0.25; }
      fired = false;
    }
    const seg = (REST + feed) / (N - 1);
    const damp = reduce ? 0.9 : 0.993;
    for (let i = 1; i < N; i++) {
      const vx = (p[i][0] - q[i][0]) * damp, vy = (p[i][1] - q[i][1]) * damp;
      q[i][0] = p[i][0]; q[i][1] = p[i][1];
      p[i][0] += vx + gx * dt * dt; p[i][1] += vy + gy * dt * dt;
    }
    p[0][0] = ax; p[0][1] = ay;
    if (tx !== null) { p[N - 1][0] = tx; p[N - 1][1] = ty; }
    for (let it = 0; it < 14; it++) {
      for (let i = 0; i < N - 1; i++) {
        const a = p[i], b = p[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
        if (d <= seg || d === 0) continue;                  // a chain goes slack, it never stretches
        const c = (d - seg) / d;
        const pinA = i === 0, pinB = i + 1 === N - 1 && tx !== null;
        if (pinA && pinB) continue;
        const wa = pinA ? 0 : pinB ? 1 : 0.5, wb = pinB ? 0 : pinA ? 1 : 0.5;
        a[0] += dx * c * wa; a[1] += dy * c * wa;
        b[0] -= dx * c * wb; b[1] -= dy * c * wb;
      }
    }
  }
  function brush() {
    if (!mouse || dragging) { mousePrev = mouse; return; }
    if (mousePrev) {
      const vx = mouse[0] - mousePrev[0], vy = mouse[1] - mousePrev[1];
      if (vx || vy) for (let i = 2; i < N; i++) {
        const d = Math.hypot(p[i][0] - mouse[0], p[i][1] - mouse[1]);
        if (d < 12) { const k = (1 - d / 12) * 0.35; q[i][0] -= vx * k; q[i][1] -= vy * k * 0.3; }
      }
    }
    mousePrev = mouse;
  }

  // ---- points for the renderer ----
  // Each point is x, y (page px), depth 0..1 (1 near) and ink 0..1, the crow's own format.
  // The renderer screens the chain on a finer lattice than the bird's (about a pixel), so a
  // bead is a few dots across and its shading shows: small dots on the lit side, large in the
  // shadow. Surfaces are sampled at a third of a pixel so the splats merge before screening.
  const LIGHT = [-0.45, -0.78, 0.44];                       // upper left front, y down
  const L3 = Math.hypot(...LIGHT); LIGHT[0] /= L3; LIGHT[1] /= L3; LIGHT[2] /= L3;
  const MAXP = 4200;
  const out = new Float32Array(MAXP * 4);
  let count = 0;
  const put = (x, y, z, ink) => {
    if (count >= MAXP) return;
    const o = count * 4; out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = ink; count++;
  };
  const GRID = 0.33;
  // shade a point of a surface from its normal: the crow's formula, key light plus a rim
  const shadeN = (nx, ny, nz, extra) => {
    const lam = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    const rim = 1 - Math.max(0, nz);
    return clamp(0.08 + 0.74 * (1 - lam) + 0.28 * rim * rim + (extra || 0), 0, 1);
  };
  function bead(cx, cy, R) {
    for (let y = -R; y <= R; y += GRID) for (let x = -R; x <= R; x += GRID) {
      const r2 = (x * x + y * y) / (R * R);
      if (r2 > 1) continue;
      const nz = Math.sqrt(1 - r2);
      put(cx + x, cy + y, 0.5 + 0.5 * nz, shadeN(x / R, y / R, nz));
    }
  }
  // The pull at the end, turned like the one in the reference: a neck, a cone, a flange,
  // a groove, a rounded body and a small nub. Radius by distance down from the top, px.
  const PULL_H = 12.6;
  const profile = y => {
    if (y < 0.9) return 0.75;                                              // neck
    if (y < 4.3) return 1.1 + (y - 0.9) / 3.4 * 2.1;                       // cone
    if (y < 5.7) return 4.15 - 0.5 * Math.pow(Math.abs(y - 5.0) / 0.7, 2); // flange, rounded
    if (y < 6.2) return 3.3;                                               // groove
    if (y < 11.2) { const k = (y - 6.2) / 5.0; return 3.55 * Math.sqrt(Math.max(0, 1 - 0.78 * k * k)); } // body
    if (y < PULL_H) { const k = (y - 11.2) / (PULL_H - 11.2); return 1.05 * Math.sqrt(Math.max(0, 1 - k * k)); } // nub
    return 0;
  };
  function pullKnob(tx, ty, ex, ey) {
    // (tx, ty): where it hangs from; (ex, ey): its axis, pointing down the chain
    const nx = -ey, ny = ex;                                               // across it
    for (let y = 0; y <= PULL_H; y += GRID) {
      const r = profile(y);
      if (r <= 0.05) continue;
      const dr = (profile(y + 0.2) - profile(y - 0.2)) / 0.4;             // how fast it widens
      // under the flange sits in its shadow
      const occl = y > 5.7 && y < 6.6 ? 0.22 : 0;
      for (let x = -r; x <= r; x += GRID) {
        const u = x / r, cz = Math.sqrt(Math.max(0, 1 - u * u));
        // the normal of a turned surface: around the axis, tipped up where it widens downward
        let gx = u, gy = -dr * cz, gz = cz;
        const gl = Math.hypot(gx, gy, gz) || 1; gx /= gl; gy /= gl; gz /= gl;
        // into screen space: the local x runs across the axis, y down it
        const sx = nx * gx + ex * gy, sy = ny * gx + ey * gy;
        put(tx + nx * x + ex * y, ty + ny * x + ey * y, 0.5 + 0.5 * cz, shadeN(sx, sy, gz, occl));
      }
    }
    return [tx + ex * PULL_H * 0.55, ty + ey * PULL_H * 0.55];
  }

  function build() {
    count = 0;
    // the mount: a small cup the chain comes out of
    for (let y = -2.2; y <= 0.4; y += GRID) for (let x = -2.4; x <= 2.4; x += GRID) {
      const u = x / 2.4, cz = Math.sqrt(Math.max(0, 1 - u * u));
      put(ax + x, ay + y, 0.5 + 0.5 * cz, shadeN(u, 0, cz, 0.05));
    }

    const s = [0];
    for (let i = 1; i < N; i++) s.push(s[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    const total = s[N - 1];
    const at = u => {
      let i = 1; while (i < N - 1 && s[i] < u) i++;
      const k = clamp((u - s[i - 1]) / Math.max(1e-6, s[i] - s[i - 1]), 0, 1);
      return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k];
    };
    // beads slide out of the mount as it is pulled, so the chain visibly feeds out
    const shift = feed % PITCH;
    let prev = [ax, ay + 0.4];
    for (let k = 0; ; k++) {
      const u = k * PITCH + shift + BEAD;
      if (u > total - BEAD) break;
      const c = at(u);
      // the wire between two beads: a hairline, drawn dark
      const dx = c[0] - prev[0], dy = c[1] - prev[1], d = Math.hypot(dx, dy);
      for (let w = 0; w <= d; w += 0.4) put(prev[0] + dx * w / d, prev[1] + dy * w / d, 0.45, 0.9);
      bead(c[0], c[1], BEAD);
      prev = c;
    }
    // the pull hangs from the last bead, along the end of the chain
    const e0 = at(total - 3), e1 = at(total);
    let ex = e1[0] - e0[0], ey = e1[1] - e0[1]; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    const top = [prev[0] + ex * (BEAD + 0.2), prev[1] + ey * (BEAD + 0.2)];
    for (let w = 0; w <= Math.hypot(e1[0] - top[0], e1[1] - top[1]); w += 0.4) put(top[0] + ex * w, top[1] + ey * w, 0.45, 0.9);
    const mid = pullKnob(e1[0], e1[1], ex, ey);
    // the grab area runs the whole chain, from just above the mount to just below the pull
    const hw = fine ? 32 : 44, gTop = Math.min(ay, mid[1]) - 8, gBottom = mid[1] + 20;
    const hx = Math.min(Math.min(ax, mid[0]) - hw / 2, innerWidth - hw);
    handle.style.width = hw + "px"; handle.style.height = Math.round(gBottom - gTop) + "px";
    handle.style.transform = `translate3d(${hx}px, ${gTop}px, 0)`;
  }

  let acc = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    brush();
    acc += dt;
    while (acc >= STEP) { step(STEP, now / 1000); acc -= STEP; }
    build();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return {
    label,
    get points() { return out; },
    get count() { return count; },
  };
}
