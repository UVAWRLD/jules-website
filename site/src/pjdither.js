// The Projects page's prints, revealed from halftone as the page opens.
//
// Each print gets a canvas over its picture holding a one-bit ordered dither of it (Bayer 8 x 8,
// one dot per screen pixel, up to two a CSS pixel, the picture lightly sharpened first so fine
// detail survives; in the page's ink and the card's paper), so the page reads as black and
// white for a moment as the page opens, then the colour comes back by itself in 1.5s: the dither
// is wiped away dot by dot in a random order, cell by cell (2px cells, the order a seeded shuffle
// over a 64px tile), the prints a little apart. Only the prints on screen when the page opens are
// dithered; the rest are in colour from the start.
//
// Each dither is made from the picture at the size it is shown, and remade if that size changes
// before the colour has come back. The theme swaps the two colours (light dots on
// dark in the dark theme) by redrawing from the stored dots.

const BAYER = (() => {                       // 8 x 8 ordered-dither thresholds, 0..63
  const m = [[0]];
  let b = m;
  for (let n = 1; n < 8; n *= 2) {
    const s = n * 2, o = Array.from({ length: s }, () => new Array(s));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = b[y][x] * 4;
      o[y][x] = v; o[y][x + n] = v + 2; o[y + n][x] = v + 3; o[y + n][x + n] = v + 1;
    }
    b = o;
  }
  return b.flat();
})();

const CELL = 2, CELLS = 32;                          // the wipe: 2px cells (CSS) on a 64px tile
const RES = () => Math.min(2, Math.max(1, Math.round(devicePixelRatio || 1)));   // dots per CSS pixel
const LEVELS = 160;                                  // steps the wipe is drawn in
const RANK = (() => {                                // a seeded shuffle of the tile's cells
  let s = 1234567;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const a = [...Array(CELLS * CELLS).keys()];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  const rank = new Uint16Array(a.length);
  a.forEach((cell, k) => (rank[cell] = k));
  return rank;
})();
const tiles = new Map();                             // level -> pattern tile: the cells wiped so far
function tile(level, k) {                            // k: canvas pixels per CSS pixel
  let t = tiles.get(k + ":" + level);
  if (t) return t;
  const cell = CELL * k;
  const c = document.createElement("canvas"); c.width = c.height = cell * CELLS;
  const g = c.getContext("2d"), cut = level / LEVELS * RANK.length;
  g.fillStyle = "#000";
  for (let i = 0; i < RANK.length; i++) if (RANK[i] < cut) g.fillRect((i % CELLS) * cell, Math.floor(i / CELLS) * cell, cell, cell);
  t = c; tiles.set(k + ":" + level, t);
  return t;
}

function colours() {
  const cs = getComputedStyle(document.documentElement);
  const hex = v => { const m = v.trim().match(/^#?([0-9a-f]{6})$/i); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
  const a = hex(cs.getPropertyValue("--ink")), b = hex(cs.getPropertyValue("--surface"));
  const lum = c => c[0] * .3 + c[1] * .59 + c[2] * .11;
  return lum(a) < lum(b) ? { dark: a, light: b } : { dark: b, light: a };   // dark dots for dark parts, in either theme
}

const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export function ditherPrints(list, cards) {
  if (!list || !cards.length) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  list.classList.add("pj-dither");
  let pal = colours();

  // ---- one print ----
  const prints = [];                                  // { fig, img, cv, off, bits, w, h, n, p, target, card }
  const byFig = new Map();
  for (const c of cards) {
    c.querySelectorAll(".pj-layer").forEach((fig, n) => {
      const cv = document.createElement("canvas"); cv.className = "pj-dot";
      fig.appendChild(cv);
      const pr = { fig, img: fig.querySelector("img"), cv, off: null, bits: null, w: 0, h: 0, n, p: 0, target: 0, card: c };
      prints.push(pr); byFig.set(fig, pr);
    });
  }

  function paint(pr) {                                 // the stored dots, in the theme's colours, onto the offscreen
    const { w, h, bits } = pr;
    if (!pr.off) pr.off = document.createElement("canvas");
    pr.off.width = w; pr.off.height = h;
    const g = pr.off.getContext("2d"), im = g.createImageData(w, h), d = im.data;
    const [dr, dg, db] = pal.dark, [lr, lg, lb] = pal.light;
    for (let i = 0, j = 0; i < bits.length; i++, j += 4) {
      const on = bits[i];
      d[j] = on ? lr : dr; d[j + 1] = on ? lg : dg; d[j + 2] = on ? lb : db; d[j + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }

  function make(pr) {                                 // dither the picture as it is shown (object-fit: cover, top)
    const k = RES(), w = Math.round(pr.fig.clientWidth * k), h = Math.round(pr.fig.clientHeight * k);
    if (w < 4 || h < 4 || !pr.img.naturalWidth) return false;
    const src = document.createElement("canvas"); src.width = w; src.height = h;
    const g = src.getContext("2d", { willReadFrequently: true });
    const iw = pr.img.naturalWidth, ih = pr.img.naturalHeight, s = Math.max(w / iw, h / ih);
    const sw = w / s, sh = h / s;
    g.drawImage(pr.img, (iw - sw) / 2, 0, sw, sh, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data, n = w * h, L = new Float32Array(n);
    const hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = px[j] * .299 + px[j + 1] * .587 + px[j + 2] * .114;
    // a light unsharp mask (against a 3 x 3 box blur) so edges and small type hold up in the dots
    const S = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; sum += L[yy * w + xx]; c++; } }
      const i = y * w + x, v = Math.min(255, Math.max(0, L[i] + .7 * (L[i] - sum / c)));
      S[i] = v; hist[v | 0]++;
    }
    L.set(S);
    // stretch the tones between the 1st and 99th percentiles, so flat pictures still hold detail
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * .01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * .01) { hi = v; break; } }
    const span = Math.max(24, hi - lo), bits = new Uint8Array(n);
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      const t = Math.min(1, Math.max(0, (L[i] - lo) / span)) ** 1.1;
      bits[i] = t * 64 > BAYER[(y & 7) * 8 + (x & 7)] + .5 ? 1 : 0;
    }
    Object.assign(pr, { w, h, k, bits });
    paint(pr);
    pr.cv.width = w; pr.cv.height = h;
    pr.level = -1; draw(pr);
    pr.fig.classList.add("dz");
    return true;
  }

  function draw(pr) {                                 // the dither, minus the cells wiped so far
    if (!pr.off) return;
    const level = Math.round(Math.min(1, Math.max(0, pr.p)) * LEVELS);
    if (level === pr.level) return;
    pr.level = level;
    pr.cv.style.visibility = level >= LEVELS ? "hidden" : "";
    if (level >= LEVELS) return;
    const g = pr.cv.getContext("2d");
    g.globalCompositeOperation = "copy";
    g.drawImage(pr.off, 0, 0);
    if (level > 0) {
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = g.createPattern(tile(level, pr.k), "repeat");
      g.fillRect(0, 0, pr.w, pr.h);
    }
  }

  async function ready(pr) {
    if (pr.busy) return; pr.busy = true;
    const img = pr.img;
    if (img.loading === "lazy") img.loading = "eager";
    try { if (!img.complete) await new Promise((ok, no) => { img.addEventListener("load", ok, { once: true }); img.addEventListener("error", no, { once: true }); }); await img.decode?.(); }
    catch { pr.fig.classList.add("dz"); pr.cv.remove(); return; }    // no picture: leave it to the browser
    make(pr);
    pr.done = true;
  }

  // Only the prints on screen when the page opens are put in halftone; the rest show in colour
  // from the start, and never get a dither at all.
  const vh = innerHeight, firstView = prints.filter(pr => {
    const r = pr.card.querySelector(".pj-imgs").getBoundingClientRect();
    return !pr.card.hidden && r.bottom > 0 && r.top < vh;
  });
  for (const pr of prints) if (!firstView.includes(pr)) { pr.fig.classList.add("dz"); pr.cv.remove(); pr.p = 1; }
  const readyAll = Promise.all(firstView.map(ready));

  // remade when a print is shown at a new size (the layout reruns on a change of width)
  let resizeT = 0;
  const sized = new ResizeObserver(() => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => prints.forEach(pr => { if (pr.done && (Math.abs(pr.fig.clientWidth * pr.k - pr.w) > 2 || Math.abs(pr.fig.clientHeight * pr.k - pr.h) > 2 || RES() !== pr.k)) make(pr); }), 160);
  });
  prints.forEach(pr => sized.observe(pr.fig));

  // the theme swaps the colours
  new MutationObserver(() => { pal = colours(); prints.forEach(pr => { if (pr.bits) { paint(pr); pr.level = -1; draw(pr); } }); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // ---- the wipe: once, as the page opens. When the prints on screen are ready (or after 2.5s
  // at most, whatever has loaded), a beat, then they all go from halftone to colour, wiped away
  // dot by dot, in 1.5s from first to last: each print over 1.1s, starting up to 0.4s apart. ----
  const TOTAL = 1500, EACH = 1100;
  let raf = 0, last = 0;
  function tick(now) {
    raf = 0;
    const dt = Math.min(64, now - (last || now)); last = now;
    let moving = false;
    for (const pr of prints) {
      if (pr.p >= 1 || !pr.target) continue;
      if (reduce) pr.p = 1;
      else if (pr.wait > 0) { pr.wait -= dt; moving = true; continue; }
      else { pr.lin = Math.min(1, (pr.lin || 0) + dt / EACH); pr.p = ease(pr.lin); }
      draw(pr);
      if (pr.p < 1) moving = true;
    }
    if (moving) raf = requestAnimationFrame(tick); else last = 0;
  }
  function play() {
    const n = firstView.length;
    firstView.forEach((pr, k) => {
      if (!pr.done) { pr.p = 1; pr.fig.classList.add("dz"); pr.cv.style.visibility = "hidden"; return; }   // not loaded in time: colour as it comes
      pr.p = 0; pr.lin = 0; pr.level = -1; pr.target = 1;
      pr.wait = n > 1 ? (k / (n - 1)) * (TOTAL - EACH) : 0;
      draw(pr);
    });
    if (!raf) raf = requestAnimationFrame(tick);
  }
  let played = false;
  const go = () => { if (played) return; played = true; setTimeout(play, 250); };
  readyAll.then(go); setTimeout(go, 2500);
  // coming back to the page (the back button can restore it as it was left) plays it again
  addEventListener("pageshow", e => { if (e.persisted) play(); });
  return { prints };
}

// A soft shadow along the bottom of the screen while there are more projects below; it fades out
// once the end of the list is on screen.
export function moreShade(list) {
  const el = document.createElement("div");
  el.className = "pj-more"; el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  let r = 0;
  const check = () => { r = 0; el.classList.toggle("off", list.getBoundingClientRect().bottom < innerHeight + 40); };
  const go = () => { if (!r) r = requestAnimationFrame(check); };
  addEventListener("scroll", go, { passive: true });
  addEventListener("resize", go);
  new ResizeObserver(go).observe(list);
  check();
}
