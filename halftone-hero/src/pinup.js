// The photo clipped beside the Timeline's title (Figma: Timeline WIP, the print left of the
// title). A wallet-size print held by one paperclip over its top edge, so everything it does
// turns about the clip: brushing past it with the cursor swings it a little and tips it toward
// you. Click it (or tap, or Enter) and it slips out of the clip and falls the way paper falls,
// swinging from side to side on the way down, until it has left the bottom of the window. The
// clip stays where it was. The photo only comes back with a new visit: a reload, or coming back
// to the Timeline.
//
// The print is the photo on a paper card with layered shadows, and the 3D is CSS transforms
// driven by a small spring. The clip is steel wire drawn on two canvases: see drawClip().

const G = 1500;                   // px/s², before air resistance

// ---- the paperclip ----
// A Gem clip, 28mm long and 8.4mm wide in 0.82mm wire, to the scale of a wallet photo (64 x 89mm):
// three bends, one loop inside the other. The photo's edge sits between the loops: the inner loop
// lies on the front of the photo, the outer loop behind it, and the bend joining them straddles
// the edge, 8mm of the clip showing above it. Drawn in millimetres on a box 14 x 36mm, whose
// point (7, 9.5) is where the clip crosses the edge. The back half is drawn under the print, so
// the photo hides it below its edge (and shows it all once the photo has gone); the front half
// over it. Lit from the upper left like everything else: a dark edge, a lighter body, a thin
// highlight on the lit side, and a small shadow cast down and to the right.
const BOX = [14, 36], WIRE = 0.82;
const PARTS = {
  back: c => {                      // the outer loop: left leg (free end), bottom bend, right leg
    c.moveTo(3.25, 6.2); c.lineTo(3.25, 25.3);
    c.arc(7.0, 25.3, 3.75, Math.PI, 0, true);
    c.lineTo(10.75, 4.3);
  },
  front: c => {                     // the top bend over the edge, then the inner loop to its free end
    c.moveTo(10.75, 4.3);
    c.arc(8.3, 4.3, 2.45, 0, Math.PI, true);
    c.lineTo(5.85, 21.5);
    c.arc(7.35, 21.5, 1.5, Math.PI, 0, true);
    c.lineTo(8.85, 10.6);
  },
};

function drawClip(canvas, part) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const c = canvas.getContext("2d");
  const mm = w / BOX[0];
  c.setTransform(dpr * mm, 0, 0, dpr * mm, 0, 0);
  c.clearRect(0, 0, BOX[0], BOX[1]);
  c.lineCap = "round"; c.lineJoin = "round";
  const stroke = (color, width, dx = 0, dy = 0, blur = 0) => {
    c.save();
    c.translate(dx, dy);
    if (blur) c.filter = `blur(${(blur * mm * dpr).toFixed(2)}px)`;
    c.beginPath(); PARTS[part](c);
    c.strokeStyle = color; c.lineWidth = width; c.stroke();
    c.restore();
  };
  // the shadow: the front half stands off the photo a little, the back half lies on the page
  if (part === "front") stroke("rgba(0,0,0,.30)", WIRE * 1.05, 0.55, 0.75, 0.35);
  else stroke("rgba(0,0,0,.22)", WIRE, 0.2, 0.3, 0.25);
  stroke("#4B5057", WIRE);                                   // the wire's dark edge
  stroke("#A3AAB2", WIRE * 0.7);                             // its body
  stroke("rgba(214,220,226,.8)", WIRE * 0.22, 0.13, 0.13);   // light bounced into the shadow side
  stroke("#FFFFFF", WIRE * 0.28, -0.14, -0.14);              // the highlight, toward the light
}

export function createPinup(el) {
  if (!el) return null;
  const print = el.querySelector(".pinup-print");
  const clips = [...el.querySelectorAll(".pinup-clip")];      // the back half's box, and the front's
  const back = el.querySelector(".pinup-clip .back"), front = el.querySelector(".pinup-clip .front");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const dot = document.getElementById("dot");

  // the clip redraws when its size changes (layout, zoom, a sharper screen)
  const redraw = () => { drawClip(back, "back"); drawClip(front, "front"); };
  new ResizeObserver(redraw).observe(front);
  redraw();

  // ---- hanging ----
  // Three springs. The print swings about the clip (ang) and tips toward the cursor (tx, ty); a
  // scroll gives it a nudge back or forward as the page moves under it (sx), the bottom lagging
  // behind like anything hung by its top. The clip is its own spring (cw, cx), driven by the print
  // but a beat behind and with a fraction of its travel: the wire flexes a little as the photo
  // moves in it and settles after it. When the photo has gone, only the clip is left moving.
  let ang = 0, vel = 0, tx = 0, ty = 0, tx0 = 0, ty0 = 0, lift = 0, liftT = 0, raf = 0, last = 0, lastX = null;
  let sx = 0, sxv = 0, cw = 0, cwv = 0, cx = 0, cxv = 0;
  const spring = (x, v, target, k, d, dt) => { v += (-k * (x - target) - d * v) * dt; return [x + v * dt, v]; };
  function frame(now) {
    const dt = Math.min(0.033, (now - (last || now)) / 1000); last = now;
    const gone = el.classList.contains("fallen");
    if (!gone) {
      [ang, vel] = spring(ang, vel, 0, 60, 5, dt);            // settles in about a second
      [sx, sxv] = spring(sx, sxv, 0, 70, 7, dt);
      tx += (tx0 - tx) * Math.min(1, dt * 10);
      ty += (ty0 - ty) * Math.min(1, dt * 10);
      lift += (liftT - lift) * Math.min(1, dt * 8);
      print.style.setProperty("--sw", ang.toFixed(3) + "deg");
      print.style.setProperty("--rx", (tx + sx).toFixed(2) + "deg");
      print.style.setProperty("--ry", ty.toFixed(2) + "deg");
      print.style.setProperty("--lift", lift.toFixed(3));
    }
    [cw, cwv] = spring(cw, cwv, gone ? 0 : ang * 0.4, 90, 6, dt);
    [cx, cxv] = spring(cx, cxv, gone ? 0 : (tx + sx) * 0.3, 90, 6, dt);
    el.style.setProperty("--cw", cw.toFixed(3) + "deg");
    el.style.setProperty("--cx", cx.toFixed(2) + "deg");
    const moving = [vel, sxv, cwv, cxv].some(v => Math.abs(v) > 0.02) || [ang, sx, cw - (gone ? 0 : ang * 0.4)].some(v => Math.abs(v) > 0.02)
      || (!gone && (Math.abs(tx - tx0) > 0.02 || Math.abs(ty - ty0) > 0.02 || Math.abs(lift - liftT) > 0.002));
    raf = moving ? requestAnimationFrame(frame) : 0;
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

  if (!reduce) {
    let lastY = scrollY;
    addEventListener("scroll", () => {
      const d = scrollY - lastY; lastY = scrollY;
      if (el.classList.contains("fallen")) return;
      sxv += Math.max(-40, Math.min(40, d)) * 1.2;           // page moves up, the bottom lags: tips back
      vel += Math.max(-40, Math.min(40, d)) * 0.15;          // and a touch of swing
      kick();
    }, { passive: true });
  }

  // ---- the fall ----
  // Paper falls like a leaf. Freed from the pin it drops almost straight at first; as it picks
  // up speed the air starts to swing it from side to side, a pendulum without a string: it follows
  // an arc, level and fastest through the middle of each swing, its outer edge tipping up as it
  // slows at each end before gliding back. The swing builds over the first half second; the
  // descent never passes TERMINAL. The clip keeps its place.
  let falling = null;
  function fall() {
    if (el.classList.contains("fallen")) return;
    el.classList.add("fallen");
    el.setAttribute("aria-hidden", "true"); el.tabIndex = -1;
    if (dot) dot.classList.remove("over");
    cancelAnimationFrame(raf); raf = 0;

    // the clip is left springing a little as the paper slides out of it, and settles
    if (!reduce) { cwv += (Math.random() < 0.5 ? -1 : 1) * 55; cxv -= 40; kick(); }

    // the print leaves the page for a layer of its own, fixed to the window, where it was
    const r = el.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.className = "pinup-fall";
    layer.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    document.body.append(layer);
    layer.append(print);
    // It now turns about its own middle, not the clip it has left. Moving the pivot would shift
    // the tilted print, so the layer takes the difference and the swap does not show.
    const th = (-6 + ang) * Math.PI / 180, ax = 0.18 * r.width, ay = -0.45 * r.height;
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
      const env = Math.min(1, f.t / 0.45);                        // the swing starts as it leaves the clip
      const e = env * env * (3 - 2 * env);
      const ph = f.w * f.t;
      const s = Math.sin(ph), c = Math.cos(ph);
      // slower at the ends of the swing, faster through the middle
      const terminal = 150 + 260 * c * c;
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
  // that counts as coming back to the Timeline, so the photo is clipped up again.
  addEventListener("pageshow", e => {
    if (!e.persisted || !el.classList.contains("fallen")) return;
    if (falling) { cancelAnimationFrame(falling.raf); falling.layer.remove(); falling = null; }
    ang = vel = tx = ty = tx0 = ty0 = lift = liftT = sx = sxv = cw = cwv = cx = cxv = 0;
    el.style.removeProperty("--cw"); el.style.removeProperty("--cx");
    ["--sw", "--rx", "--ry", "--lift", "--base"].forEach(p => print.style.removeProperty(p));
    print.style.transformOrigin = "";
    print.getAnimations().forEach(a => a.cancel());
    el.insertBefore(print, clips[1]);                      // back between the clip's two halves
    el.classList.remove("fallen"); el.removeAttribute("aria-hidden"); el.tabIndex = 0;
    redraw();
  });

  return { fall };
}
