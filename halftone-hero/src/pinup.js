// The photo pinned beside the Timeline's title (Figma: Timeline WIP, the pinned print). It hangs
// from one red pushpin near its top right corner, so everything it does turns about that point:
// brushing past it with the cursor swings it a little on the pin and tips it toward you, like a
// print on a wall. Click it (or tap, or Enter) and it tears off the pin and falls, fluttering and
// tumbling like paper, until it has left the bottom of the window. The pin stays in the wall.
// It only comes back with a new visit to the page: a reload, or coming back to the Timeline.
//
// Nothing here draws in canvas: the print is the photo on a paper-coloured card with layered
// shadows and a sheen, the pin an SVG, and the 3D is CSS transforms driven by a small spring.

const PIVOT = [0.88, 0.025];      // the pin, as a share of the print's width and height
const G = 2400;                   // px/s², before air resistance
const TERMINAL = 520;             // px/s: paper does not fall like a stone

export function createPinup(el) {
  if (!el) return null;
  const print = el.querySelector(".pinup-print");
  const pin = el.querySelector(".pinup-pin");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const dot = document.getElementById("dot");

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
    print.style.setProperty("--shx", (50 + ty * 3 - tx * 2).toFixed(1) + "%");   // the sheen slides as it tips
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
  let falling = null;
  function fall() {
    if (el.classList.contains("fallen")) return;
    el.classList.add("fallen");
    el.setAttribute("aria-hidden", "true"); el.tabIndex = -1;
    if (dot) dot.classList.remove("over");
    cancelAnimationFrame(raf); raf = 0;

    // the pin shudders as the paper tears off it
    if (!reduce) pin.animate([
      { transform: "rotate(0deg)" }, { transform: "rotate(-14deg)" }, { transform: "rotate(9deg)" },
      { transform: "rotate(-5deg)" }, { transform: "rotate(2deg)" }, { transform: "rotate(0deg)" },
    ], { duration: 650, easing: "ease-out" });

    // the print leaves the page for a layer of its own, fixed to the window, where it was
    const r = el.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.className = "pinup-fall";
    layer.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    document.body.append(layer);
    layer.append(print);
    print.style.setProperty("--lift", "1");

    if (reduce) {
      print.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" })
        .finished.then(() => layer.remove(), () => {});
      falling = { layer };
      return;
    }
    // paper: gravity against drag, a sideways drift that swings back and forth, the swing's
    // rotation about the vertical, and a slow tumble toward and away from the viewer
    const s = { x: 0, y: 0, vy: -140, t: 0, rot: ang, spin: 90 + Math.random() * 60,
                phase: Math.random() * 6.3, amp: 18 + Math.random() * 16, tumble: 0, tSpeed: 140 + Math.random() * 80 };
    let prev = 0;
    const step = now => {
      const dt = Math.min(0.033, (now - (prev || now)) / 1000); prev = now;
      s.t += dt;
      s.vy += (G - (s.vy > 0 ? G * (s.vy / TERMINAL) ** 2 : 0)) * dt;
      s.y += s.vy * dt;
      const sway = Math.sin(s.t * 3.4 + s.phase);
      s.x = s.amp * sway * Math.min(1, s.t * 2) + s.t * 22;
      s.rot += (sway * 38 - s.rot) * Math.min(1, dt * 3) + s.spin * dt * 0.15;
      s.tumble += s.tSpeed * dt;
      layer.style.transform = `translate(${s.x}px, ${s.y}px)`;
      print.style.setProperty("--sw", s.rot.toFixed(2) + "deg");
      print.style.setProperty("--rx", (Math.sin(s.tumble * Math.PI / 180) * 55).toFixed(2) + "deg");
      print.style.setProperty("--ry", (Math.cos(s.t * 2.1 + s.phase) * 30).toFixed(2) + "deg");
      print.style.setProperty("--shx", (50 + Math.sin(s.tumble * Math.PI / 180) * 60).toFixed(1) + "%");
      if (r.top + s.y > innerHeight + 40) { layer.remove(); falling = null; return; }
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
    ["--sw", "--rx", "--ry", "--lift", "--shx"].forEach(p => print.style.removeProperty(p));
    print.getAnimations().forEach(a => a.cancel());
    el.prepend(print);
    el.classList.remove("fallen"); el.removeAttribute("aria-hidden"); el.tabIndex = 0;
  });

  return { fall };
}
