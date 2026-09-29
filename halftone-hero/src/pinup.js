// The photo pinned beside the Timeline's title (Figma: Timeline WIP, the pinned print). It hangs
// from one pushpin near its top right corner, so everything it does turns about that point:
// brushing past it with the cursor swings it a little on the pin and tips it toward you, like a
// print on a wall. Click it (or tap, or Enter) and it comes off the pin and falls the way paper
// falls, swinging from side to side on the way down, until it has left the bottom of the window.
// The pin stays in the wall. It only comes back with a new visit: a reload, or coming back to
// the Timeline.
//
// The print is the photo on a paper card with layered shadows, and the 3D is CSS transforms
// driven by a small spring. The pin is drawn in dots, like the crow: see drawPin().

const INK_RED = [241, 58, 13];    // the cursor's red, #F13A0D
const G = 1500;                   // px/s², before air resistance

// ---- the pin, screened like the crow ----
// The scene is in the old SVG's units (32 x 40): the head a sphere of radius 7 at (18, 12), the
// needle from under it down to where it enters the paper at (12, 30), and their shadow down and
// to the right (the light is at the upper left, as for the crow). Each cell of a square lattice
// is sampled 3 x 3; a cell's coverage sets its dot's size and its depth the dot's opacity, so the
// sphere has small faint dots where the light hits it and full dots on its shadow side, and the
// needle thins out as it goes into the paper.
const HEAD = [18, 12, 7], NEEDLE = [[16.6, 17.4], [12, 30]], NEEDLE_R = 0.95;
const L = (() => { const v = [-0.52, -0.62, 0.59], n = Math.hypot(...v); return v.map(x => x / n); })();

function scene(x, y) {
  // head
  const dx = (x - HEAD[0]) / HEAD[2], dy = (y - HEAD[1]) / HEAD[2], rr = dx * dx + dy * dy;
  if (rr < 1) {
    const nz = Math.sqrt(1 - rr);
    const diff = Math.max(0, dx * L[0] + dy * L[1] + nz * L[2]);
    // the highlight: where the reflection of the light meets the eye, no dots at all
    const rz = 2 * diff * nz - L[2];
    const spec = Math.pow(Math.max(0, rz), 18);
    let cov = 0.18 + 0.82 * Math.pow(1 - diff, 1.25);
    cov *= 1 - Math.min(1, spec * 1.6);
    const alpha = 0.55 + 0.45 * (1 - diff) * (0.6 + 0.4 * nz);   // the turn away reads deeper
    return { cov, alpha, col: "red" };
  }
  // needle: a thin steel rod, lit along one side, fading toward the paper
  const [a, b] = NEEDLE, vx = b[0] - a[0], vy = b[1] - a[1], len2 = vx * vx + vy * vy;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / len2));
  const px = a[0] + vx * t, py = a[1] + vy * t, d = Math.hypot(x - px, y - py);
  if (d < NEEDLE_R) {
    const side = ((x - px) * -vy + (y - py) * vx) / Math.sqrt(len2) / NEEDLE_R;   // -1..1 across
    const lit = 0.5 + 0.5 * side;
    return { cov: 0.35 + 0.45 * lit, alpha: 0.85 - 0.45 * t, col: "ink" };
  }
  // shadow on the paper: the head's, offset down and right, and the needle's
  const sx = (x - 24.5) / 6.2, sy = (y - 21) / 4.6, s1 = Math.max(0, 1 - Math.hypot(sx, sy));
  const nt = Math.max(0, Math.min(1, ((x - 12) * 10 + (y - 30) * -8) / 164));
  const s2 = Math.max(0, 1 - Math.hypot(x - (12 + 10 * nt), y - (30 - 8 * nt)) / 1.3) * (1 - nt * 0.5);
  const s = Math.max(s1 * s1 * 1.2, s2 * 0.7);
  if (s > 0.02) return { cov: Math.min(1, s), alpha: 0.26, col: "ink" };
  return null;
}

function drawPin(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const ink = (getComputedStyle(document.body).color.match(/[\d.]+/g) || [10, 10, 10]).map(Number);
  const pitch = Math.max(1.5, 3 / dpr);            // round dots, at least 3 device px apart
  const k = 32 / w;                                // css px to scene units
  for (let cy = pitch / 2; cy < h; cy += pitch) {
    for (let cx = pitch / 2; cx < w; cx += pitch) {
      let cov = 0, alpha = 0, n = 0, red = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const s = scene((cx + i * pitch / 3) * k, (cy + j * pitch / 3) * k);
        if (!s) continue;
        cov += s.cov; alpha += s.alpha; n++; if (s.col === "red") red++;
      }
      if (!n) continue;
      cov /= 9; alpha /= n;
      if (cov < 0.02) continue;
      // radius from coverage, square lattice: circles touch at 78.5%, merge above
      const r = Math.min(0.7, Math.sqrt(cov / Math.PI)) * pitch;
      const col = red * 2 >= n ? INK_RED : ink;
      c.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha.toFixed(3)})`;
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    }
  }
}

export function createPinup(el) {
  if (!el) return null;
  const print = el.querySelector(".pinup-print");
  const pin = el.querySelector(".pinup-pin");
  const dots = pin.querySelector("canvas");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const dot = document.getElementById("dot");

  // the pin redraws when its size changes (layout, zoom) or the theme turns the ink
  const redraw = () => drawPin(dots);
  new ResizeObserver(redraw).observe(dots);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  redraw();

  // ---- hanging: a damped spring for the swing about the pin, and a tilt toward the cursor ----
  let ang = 0, vel = 0, tx = 0, ty = 0, tx0 = 0, ty0 = 0, lift = 0, liftT = 0, raf = 0, last = 0, lastX = null;
  function frame(now) {
    const dt = Math.min(0.033, (now - (last || now)) / 1000); last = now;
    vel += (-60 * ang - 5 * vel) * dt;              // stiff enough to settle in a second
    ang += vel * dt;
    tx += (tx0 - tx) * Math.min(1, dt * 10);
    ty += (ty0 - ty) * Math.min(1, dt * 10);
    lift += (liftT - lift) * Math.min(1, dt * 8);
    print.style.setProperty("--sw", ang.toFixed(3) + "deg");
    print.style.setProperty("--rx", tx.toFixed(2) + "deg");
    print.style.setProperty("--ry", ty.toFixed(2) + "deg");
    print.style.setProperty("--lift", lift.toFixed(3));
    const still = Math.abs(ang) < 0.02 && Math.abs(vel) < 0.02 && Math.abs(tx - tx0) < 0.02 && Math.abs(ty - ty0) < 0.02 && Math.abs(lift - liftT) < 0.002;
    raf = still ? 0 : requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf && !reduce) { last = 0; raf = requestAnimationFrame(frame); } };

  if (fine && !reduce) {
    el.addEventListener("pointermove", e => {
      if (el.classList.contains("fallen")) return;
      const r = el.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width - 0.5, v = (e.clientY - r.top) / r.height - 0.5;
      tx0 = -v * 14; ty0 = u * 16;                   // tip toward the cursor
      if (lastX !== null) vel += (e.clientX - lastX) * -1.6;   // brushing past swings it
      lastX = e.clientX;
      kick();
    });
    el.addEventListener("pointerenter", () => { liftT = 1; if (dot) dot.classList.add("over"); kick(); });
    el.addEventListener("pointerleave", () => { tx0 = ty0 = 0; liftT = 0; lastX = null; if (dot) dot.classList.remove("over"); kick(); });
  }

  // ---- the fall ----
  // Paper falls like a leaf. Freed from the pin it drops almost straight at first; as it picks
  // up speed the air starts to swing it from side to side, a pendulum without a string: it follows
  // an arc, level and fastest through the middle of each swing, its outer edge tipping up as it
  // slows at each end before gliding back. The swing builds over the first half second; the
  // descent never passes TERMINAL. The pin keeps its place.
  let falling = null;
  function fall() {
    if (el.classList.contains("fallen")) return;
    el.classList.add("fallen");
    el.setAttribute("aria-hidden", "true"); el.tabIndex = -1;
    if (dot) dot.classList.remove("over");
    cancelAnimationFrame(raf); raf = 0;

    // the pin shudders as the paper comes off it
    if (!reduce) dots.animate([
      { transform: "rotate(0deg)" }, { transform: "rotate(-10deg)" }, { transform: "rotate(6deg)" },
      { transform: "rotate(-3deg)" }, { transform: "rotate(1deg)" }, { transform: "rotate(0deg)" },
    ], { duration: 600, easing: "ease-out" });

    // the print leaves the page for a layer of its own, fixed to the window, where it was
    const r = el.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.className = "pinup-fall";
    layer.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    document.body.append(layer);
    layer.append(print);
    // It now turns about its own middle, not the pin it has left. Moving the pivot would shift
    // the tilted print, so the layer takes the difference and the swap does not show.
    const th = (-6 + ang) * Math.PI / 180, ax = 0.38 * r.width, ay = -0.425 * r.height;
    const offX = ax - (ax * Math.cos(th) - ay * Math.sin(th)), offY = ay - (ax * Math.sin(th) + ay * Math.cos(th));
    print.style.transformOrigin = "50% 45%";

    if (reduce) {
      print.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" })
        .finished.then(() => layer.remove(), () => {});
      falling = { layer };
      return;
    }
    const dir = Math.random() < 0.5 ? -1 : 1;
    const f = {
      t: 0, y: 0, vy: 0,
      w: 4.4 + Math.random() * 0.8,          // swing rate, rad/s: a swing each ~0.7s
      amp: 34 + Math.random() * 14,          // px either side
      tilt: 20 + Math.random() * 8,          // deg, at the ends of the swing
      rot0: ang, lift0: lift, rx0: tx, ry0: ty,
    };
    let prev = 0;
    const step = now => {
      const dt = Math.min(0.033, (now - (prev || now)) / 1000); prev = now;
      f.t += dt;
      const env = Math.min(1, Math.max(0, (f.t - 0.12) / 0.6));   // the swing builds once it is falling
      const e = env * env * (3 - 2 * env);
      const ph = f.w * (f.t - 0.12);
      const s = Math.sin(ph), c = Math.cos(ph);
      // slower at the ends of the swing, faster through the middle
      const terminal = 330 * (1 - e) + e * (150 + 260 * c * c);
      f.vy += (G - G * Math.min(4, (f.vy / terminal) ** 2)) * dt;
      f.vy = Math.max(f.vy, 0);
      f.y += f.vy * dt;
      const x = dir * f.amp * e * s;
      const vx = dir * f.amp * e * c;                              // sign of travel
      const tiltZ = (-6 + f.rot0) * (1 - e) - (x / f.amp) * f.tilt;               // on the arc: level mid-swing, outer edge up at the ends
      const into = Math.min(1, f.t * 3);                                          // out of the hover pose
      const tiltY = f.ry0 + ((vx / f.amp) * 24 * e - f.ry0) * into;               // turns into the swing
      const tiltX = f.rx0 + (8 + 14 * e * (0.5 + 0.5 * Math.abs(c)) - f.rx0) * into;   // lies back as it drops
      layer.style.transform = `translate(${(x + offX).toFixed(2)}px, ${(f.y + offY).toFixed(2)}px)`;
      print.style.setProperty("--base", "0deg");
      print.style.setProperty("--sw", tiltZ.toFixed(2) + "deg");
      print.style.setProperty("--rx", tiltX.toFixed(2) + "deg");
      print.style.setProperty("--ry", tiltY.toFixed(2) + "deg");
      print.style.setProperty("--lift", (f.lift0 + (1 - f.lift0) * Math.min(1, f.t * 4)).toFixed(3));
      if (r.top + f.y > innerHeight + 30) { layer.remove(); falling = null; return; }
      falling.raf = requestAnimationFrame(step);
    };
    falling = { layer, raf: requestAnimationFrame(step) };
  }

  el.addEventListener("click", fall);
  el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fall(); } });

  // Coming back to the page from the history keeps the page as it was, fallen photo and all;
  // that counts as coming back to the Timeline, so the photo is pinned up again.
  addEventListener("pageshow", e => {
    if (!e.persisted || !el.classList.contains("fallen")) return;
    if (falling) { cancelAnimationFrame(falling.raf); falling.layer.remove(); falling = null; }
    ang = vel = tx = ty = tx0 = ty0 = lift = liftT = 0;
    ["--sw", "--rx", "--ry", "--lift", "--base"].forEach(p => print.style.removeProperty(p));
    print.style.transformOrigin = "";
    print.getAnimations().forEach(a => a.cancel());
    el.prepend(print);
    el.classList.remove("fallen"); el.removeAttribute("aria-hidden"); el.tabIndex = 0;
    redraw();
  });

  return { fall };
}
