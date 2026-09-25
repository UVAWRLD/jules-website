// A pull chain hanging to the left of the place caption. Pull it down and the page switches
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
  const REST_MAX = fine ? 64 : 56;        // hanging length, px, when there is room for it
  let REST = REST_MAX;
  const MAX_PULL = 30, PULL_AT = 19;      // extra chain a pull can draw out; where it clicks
  const PITCH = 6;                        // one link, px: a touch larger than drawn in lines, so
                                          // the rings and bars survive being screened into dots
  const G = 1700;                         // gravity, px/s²
  const STEP = 1 / 120;

  let ax = 0, ay = 0;                     // the mount, in page px
  const p = [], q = [];
  for (let i = 0; i < N; i++) { p.push([0, 0]); q.push([0, 0]); }

  // The mount sits just left of the caption. The caption is pinned by its right edge, so its
  // left edge moves when the place names change width; the mount glides after it (in step())
  // and the chain swings from the move, rather than jumping.
  let axT = 0, ayT = 0, ready = false;
  function measure() {
    const r = caption.getBoundingClientRect();
    axT = r.left - 14; ayT = r.top + r.height / 2 - 1;
    // never down into the copy: on a short screen the chain is shortened to stop above it
    const c = document.getElementById("copy").getBoundingClientRect();
    const over = axT > c.left - 20 && axT < c.right + 20;
    REST = over ? clamp(c.top - ayT - 30, 30, REST_MAX) : REST_MAX;
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

  // ---- interaction ----
  let dragging = false, px = 0, py = 0, downAt = null, fired = false;
  let feed = 0, feedV = 0, auto = -1;
  let mouse = null, mousePrev = null;

  const pointerTo = e => { px = e.clientX; py = e.clientY; };
  handle.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    dragging = true; fired = false; auto = -1; pointerTo(e); downAt = [e.clientX, e.clientY, performance.now()];
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
      const dx = px - ax, dy = py - ay, d = Math.hypot(dx, dy) || 1;
      const reach = REST + MAX_PULL;
      const s = Math.min(1, reach / d);
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
  // The link outlines are sampled at under a pixel, so the splats overlap into a solid wire
  // before the screen averages them into dots.
  const LIGHT = [-0.45, -0.78, 0.44];                       // upper left front, y down
  const out = new Float32Array(2400 * 4);
  let count = 0;
  const put = (x, y, z, ink) => {
    if (count >= 2400) return;
    const o = count * 4; out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = ink; count++;
  };
  function build(t) {
    count = 0;
    // the mount: a short bar
    for (let x = -2.5; x <= 2.5; x += 0.7) { put(ax + x, ay - 1.2, 0.8, 0.85); put(ax + x, ay, 0.8, 0.85); }

    const s = [0];
    for (let i = 1; i < N; i++) s.push(s[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    const total = s[N - 1];
    const at = u => {
      let i = 1; while (i < N - 1 && s[i] < u) i++;
      const k = clamp((u - s[i - 1]) / Math.max(1e-6, s[i] - s[i - 1]), 0, 1);
      return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k,
              p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]];
    };
    let energy = 0;
    for (let i = 1; i < N; i++) energy += Math.abs(p[i][0] - q[i][0]);
    energy = Math.min(1, energy / 6);

    // links slide out of the mount as it is pulled, so the pattern moves with the chain
    const shift = feed % PITCH, first = Math.floor(feed / PITCH);
    for (let k = 0; ; k++) {
      const u = k * PITCH + shift - PITCH;
      if (u > total - 1) break;
      if (u + PITCH < 0) continue;
      const c = at(clamp(u + PITCH / 2, 0, total));
      const l = Math.hypot(c[2], c[3]) || 1, tx = c[2] / l, ty = c[3] / l;   // along the chain
      const nx = -ty, ny = tx;                                              // across it
      const j = k - first;
      // alternate links sit at right angles: a ring face on, then a bar edge on; the twist
      // lets each turn a little as it swings
      const twist = (j & 1 ? Math.PI / 2 : 0) + (reduce ? 0 : 0.5 * energy * Math.sin(t * 5 + j * 0.9));
      const open = Math.abs(Math.cos(twist));
      const half = PITCH * 0.66, hw = Math.max(0.35, 2.2 * open);
      // the outline of a stadium: two straights and two round ends
      const straight = Math.max(0, half - hw);
      const perim = 4 * straight + 2 * Math.PI * hw;
      const n = Math.max(8, Math.ceil(perim / 0.75));
      for (let m = 0; m < n; m++) {
        let d = m / n * perim, lx, ly, ox, oy;             // local position and outward normal
        if (d < 2 * straight) { lx = -straight + d; ly = -hw; ox = 0; oy = -1; }
        else if ((d -= 2 * straight) < Math.PI * hw) { const a = -Math.PI / 2 + d / hw; lx = straight + hw * Math.cos(a); ly = hw * Math.sin(a); ox = Math.cos(a); oy = Math.sin(a); }
        else if ((d -= Math.PI * hw) < 2 * straight) { lx = straight - d; ly = hw; ox = 0; oy = 1; }
        else { d -= 2 * straight; const a = Math.PI / 2 + d / hw; lx = -straight + hw * Math.cos(a); ly = hw * Math.sin(a); ox = Math.cos(a); oy = Math.sin(a); }
        const wx = c[0] + tx * lx + nx * ly, wy = c[1] + ty * lx + ny * ly;
        // the wire's own normal on screen, tipped toward the viewer where the ring turns away
        const gx = tx * ox + nx * oy, gy = ty * ox + ny * oy, gz = 0.55 + 0.45 * (1 - open);
        const lam = Math.max(0, (gx * LIGHT[0] + gy * LIGHT[1] + gz * LIGHT[2]) / Math.hypot(gx, gy, gz));
        put(wx, wy, 0.75, clamp(0.35 + 0.65 * (1 - lam) + 0.15 * (1 - open), 0, 1));
      }
    }

    // the bead: a small lit sphere, shaded as the crow is
    const e = at(total), el = Math.hypot(e[2], e[3]) || 1;
    const R = 3.8, bx = p[N - 1][0] + e[2] / el * (R + 0.6), by = p[N - 1][1] + e[3] / el * (R + 0.6);
    for (let y = -R; y <= R; y += 0.7) for (let x = -R; x <= R; x += 0.7) {
      const r2 = (x * x + y * y) / (R * R);
      if (r2 > 1) continue;
      const nz = Math.sqrt(1 - r2), nx2 = x / R, ny2 = y / R;
      const lam = Math.max(0, nx2 * LIGHT[0] + ny2 * LIGHT[1] + nz * LIGHT[2]);
      const rim = 1 - nz;
      put(bx + x, by + y, 0.55 + 0.45 * nz, clamp(0.1 + 0.62 * (1 - lam) + 0.3 * rim * rim, 0, 1));
    }
    // the grab area follows the bead
    handle.style.transform = `translate3d(${bx - 16}px, ${by - 20}px, 0)`;
  }

  let acc = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    brush();
    acc += dt;
    while (acc >= STEP) { step(STEP, now / 1000); acc -= STEP; }
    build(now / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return {
    label,
    get points() { return out; },
    get count() { return count; },
  };
}
