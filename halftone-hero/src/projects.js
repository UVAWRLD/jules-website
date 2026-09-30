// The Projects page (Figma: Projects portfolio): its cards, and the controls above them.
//
// The cards are built from public/projects/projects.json, which the project database exports
// (~/Developer/prj_jules_projects, tools/export_site.py): the Featured and Selected projects in
// rank order, each with its text and three or four web-sized prints. The database is the source;
// to change the page, change the database and export again.
//
// Each card is shaped by what it holds. Its prints are laid out from their own proportions (a
// poster stays tall, a board stays wide): the main print gets the most room, and the others,
// smaller and each turned a little, overlap its corners, hanging off the outer side of the card
// by a few pixels. The spread, sizes and turns vary from card to card, seeded by the project's
// name, so the page is not stamped out of one template but reloads the same. The picture area
// takes the size of the group, and on a wide screen the card takes the width of its pictures plus
// its words, so a set of posters makes a narrower card than a wide board. The pictures alternate
// sides down the page. Layout reruns when the list changes width.
//
//   Search        opens into a field; the cards show only those whose words contain it
//   Sort          steps through the database's order, newest first, and oldest first
//   + Add Filter  a menu of the cards' tags (discipline and context); each one chosen becomes a
//                 chip, and a card shows only with every chosen tag. A chip's × removes it

const DATA = "public/projects/projects.json";

const MAIN_AREA = 98000;                 // px², the main print's area before fitting
const MAIN_MAX_W = 470, MAIN_MAX_H = 310;
const OVER = 14, OVER_PHONE = 8;         // how far prints may hang over the card's outer edge
const STACK = 980;                       // below this the words go under the pictures

// a small repeatable random from the project's slug
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507), h = Math.imul(h ^ (h >>> 13), 3266489909), (h ^= h >>> 16) >>> 0) / 4294967296);
}

// The group's natural layout, in px, with the main print at the origin and the outer side on
// the left: [{i, x, y, w, h, r, z}] and its bounds.
function arrange(p) {
  const R = rng(p.slug), pr = p.prints;
  if (!pr.length) return null;
  const size = (pt, area) => { const a = pt.w / pt.h; return [Math.sqrt(area * a), Math.sqrt(area / a)]; };
  let [mw, mh] = size(pr[0], MAIN_AREA);
  const fit = Math.min(1, MAIN_MAX_W / mw, MAIN_MAX_H / mh); mw *= fit; mh *= fit;
  const out = [{ i: 0, x: 0, y: 0, w: mw, h: mh, r: (R() - 0.5) * 3, z: 2 }];
  const small = (n) => { const [w, h] = size(pr[n], MAIN_AREA * fit * fit * (0.2 + R() * 0.14)); return [Math.min(w, mw * 0.7), Math.min(h, mh * 0.8)]; };
  const turn = (sign) => sign * (2.5 + R() * 3.5);
  // where each other print goes, in order: behind, over the outer top corner; in front, over the
  // outer bottom corner; in front, over the inner bottom corner
  const spots = [
    (w, h) => ({ x: -w * (0.42 + R() * 0.18), y: -h * (0.08 + R() * 0.22), z: 1, r: turn(-1) }),
    (w, h) => ({ x: -w * (0.36 + R() * 0.18), y: mh - h * (0.62 + R() * 0.22), z: 3, r: turn(1) }),
    (w, h) => ({ x: mw - w * (0.5 + R() * 0.18), y: mh - h * (0.5 + R() * 0.25), z: 4, r: turn(-1) }),
  ];
  const order = pr.length === 2 ? [1] : [0, 1, 2];
  pr.slice(1, 4).forEach((_, n) => { const [w, h] = small(n + 1); out.push({ i: n + 1, w, h, ...spots[order[n] ?? n](w, h) }); });
  const pad = 8;                                         // room for the turns and shadows
  const x0 = Math.min(...out.map(o => o.x)) - pad, y0 = Math.min(...out.map(o => o.y)) - pad;
  const x1 = Math.max(...out.map(o => o.x + o.w)) + pad, y1 = Math.max(...out.map(o => o.y + o.h)) + pad;
  out.forEach(o => { o.x -= x0; o.y -= y0; });
  return { items: out, W: x1 - x0, H: y1 - y0 };
}

const DISCIPLINE = { "product design": "Product Design", "ux/ui": "UX/UI", "strategy": "Strategy", "data & analysis": "Data & Analysis",
  "graphic design": "Graphic Design", "3d & motion": "3D & Motion" };

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function card(p, i) {
  const tags = [DISCIPLINE[(p.discipline || "").toLowerCase()] || p.discipline, p.context].filter(Boolean);
  const imgs = p.prints.map((pt, n) => `<figure class="pj-layer" data-n="${n}"><img src="${pt.src}" width="${pt.w}" height="${pt.h}" alt="" loading="lazy" decoding="async"></figure>`).join("");
  return `<article class="pj-card${i % 2 ? " flip" : ""}" data-slug="${esc(p.slug)}" data-rank="${p.rank}" data-year="${p.yearSort ?? ""}" data-tags="${esc(tags.join("|"))}" data-long="${(p.description || "").length > 380 ? 1 : 0}">
    <div class="pj-meta">
      <ul class="pj-tags">${tags.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
      <span class="pj-year">${esc(p.year || "")}</span>
    </div>
    <div class="pj-body">
      <div class="pj-imgs" aria-hidden="true">${imgs}</div>
      <div class="pj-sum">
        <div>
          ${p.headline ? `<p class="pj-name">${esc(p.title)}</p><h3>${esc(p.headline)}</h3>` : `<h3>${esc(p.title)}</h3>`}
          <p>${esc(p.description)}</p>
        </div>
        ${p.contribution ? `<p class="pj-contrib"><b>Contribution</b><span>${esc(p.contribution)}</span></p>` : ""}
      </div>
    </div>
  </article>`;
}

// Fits one card's group to the room it has, and on a wide screen sizes the card to fit it.
function place(c, g, listW) {
  const box = c.querySelector(".pj-imgs"), sum = c.querySelector(".pj-sum");
  const flip = c.classList.contains("flip"), stacked = innerWidth <= STACK;
  const cs = getComputedStyle(c), padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const gap = parseFloat(getComputedStyle(c.querySelector(".pj-body")).columnGap) || 28;
  let k, over;
  if (stacked) {
    over = innerWidth <= 820 ? OVER_PHONE : OVER;
    const room = listW - padX + over * 2;
    k = Math.min(1.1, room / g.W, (innerWidth <= 820 ? 300 : 340) / g.H);
    c.style.width = ""; sum.style.width = "";
    box.style.margin = `0 -${over}px`;
  } else {
    over = OVER;
    const textW = c.dataset.long === "1" ? 300 : 260;
    const room = listW - padX - gap - textW + over;
    k = Math.min(1, room / g.W);
    c.style.width = Math.min(listW, padX + g.W * k - over + gap + textW) + "px";
    sum.style.width = textW + "px";
    box.style.margin = flip ? `0 -${over}px 0 0` : `0 0 0 -${over}px`;
  }
  const W = g.W * k, H = g.H * k, cx = W / 2, cy = H / 2;
  box.style.width = W + "px"; box.style.height = H + "px";
  for (const o of g.items) {
    const el = box.querySelector(`[data-n="${o.i}"]`); if (!el) continue;
    const w = o.w * k, h = o.h * k, x = flip ? W - (o.x * k) - w : o.x * k, y = o.y * k;
    const mx = x + w / 2 - cx, my = y + h / 2 - cy, d = Math.hypot(mx, my) || 1;
    el.style.cssText = `left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;z-index:${o.z};`
      + `--r:${(flip ? -o.r : o.r).toFixed(2)}deg;--dx:${(mx / d * 7).toFixed(1)}px;--dy:${(my / d * 7).toFixed(1)}px`;
  }
}

export async function createProjectControls() {
  const list = document.getElementById("pjList");
  if (!list) return;
  const empty = document.getElementById("pjEmpty");
  const count = document.getElementById("pjCount");

  let projects = [];
  try { projects = (await (await fetch(DATA, { cache: "no-cache" })).json()).projects || []; }
  catch (e) { empty.textContent = "The projects could not be loaded."; empty.hidden = false; return; }
  list.insertAdjacentHTML("afterbegin", projects.map(card).join(""));

  const cards = [...list.querySelectorAll(".pj-card")];
  const groups = new Map(projects.map(p => [p.slug, arrange(p)]));
  const layout = () => { const w = list.clientWidth; for (const c of cards) { const g = groups.get(c.dataset.slug); if (g) place(c, g, w); } };
  layout();
  let lastW = list.clientWidth;
  new ResizeObserver(() => { if (list.clientWidth !== lastW) { lastW = list.clientWidth; layout(); } }).observe(list);
  const search = document.getElementById("pjSearch"), input = search.querySelector("input");
  const sortBtn = document.getElementById("pjSort"), sortLabel = sortBtn.querySelector(".label");
  const add = document.getElementById("pjAdd"), menu = document.getElementById("pjMenu");
  const chips = document.getElementById("pjChips");

  const text = c => c.textContent.replace(/\s+/g, " ").toLowerCase();
  const tagsOf = c => c.dataset.tags ? c.dataset.tags.split("|") : [];
  const allTags = [...new Set(cards.flatMap(tagsOf))].sort();
  const chosen = new Set();

  // the pictures alternate sides down the cards that are showing
  function reflip() {
    let n = 0;
    for (const c of list.querySelectorAll(".pj-card")) { if (c.hidden) continue; c.classList.toggle("flip", n++ % 2 === 1); }
    layout();
  }
  function apply() {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const c of cards) {
      const ok = (!q || text(c).includes(q)) && [...chosen].every(t => tagsOf(c).includes(t));
      c.hidden = !ok; if (ok) shown++;
    }
    empty.hidden = shown > 0;
    reflip();
    count.textContent = String(shown).padStart(2, "0") + (shown === 1 ? " project" : " projects");
  }

  // ---- search ----
  search.addEventListener("click", e => { if (e.target !== input) { search.classList.add("open"); input.focus(); } });
  input.addEventListener("input", apply);
  input.addEventListener("keydown", e => { if (e.key === "Escape") { input.value = ""; apply(); input.blur(); } });
  input.addEventListener("blur", () => { if (!input.value) search.classList.remove("open"); });

  // ---- sort: the database's order, newest first, oldest first. Undated projects go last ----
  const SORTS = [
    { label: "Sort", say: "Sort: selected order", by: (a, b) => +a.dataset.rank - +b.dataset.rank },
    { label: "Newest", say: "Sort: newest first", by: (a, b) => (+b.dataset.year || -1e4) - (+a.dataset.year || -1e4) || +a.dataset.rank - +b.dataset.rank },
    { label: "Oldest", say: "Sort: oldest first", by: (a, b) => (+a.dataset.year || 1e4) - (+b.dataset.year || 1e4) || +a.dataset.rank - +b.dataset.rank },
  ];
  let sort = 0;
  const showSort = () => {
    sortLabel.textContent = SORTS[sort].label;
    sortBtn.setAttribute("aria-label", SORTS[sort].say + ". Change the order");
    sortBtn.classList.toggle("on", sort > 0);
  };
  sortBtn.addEventListener("click", () => {
    sort = (sort + 1) % SORTS.length;
    [...cards].sort(SORTS[sort].by).forEach(c => list.insertBefore(c, empty));
    reflip();
    showSort();
  });
  showSort();

  // ---- filters ----
  function drawMenu() {
    menu.innerHTML = "";
    for (const t of allTags) {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "menuitemcheckbox"); b.textContent = t;
      b.setAttribute("aria-checked", String(chosen.has(t)));
      b.addEventListener("click", () => { chosen.has(t) ? chosen.delete(t) : chosen.add(t); drawChips(); drawMenu(); apply(); });
      menu.append(b);
    }
  }
  function drawChips() {
    chips.innerHTML = "";
    for (const t of chosen) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "pj-chip"; b.setAttribute("aria-label", "Remove filter: " + t);
      b.innerHTML = `${esc(t)}<span aria-hidden="true">×</span>`;
      b.addEventListener("click", () => { chosen.delete(t); drawChips(); drawMenu(); apply(); });
      chips.append(b);
    }
  }
  const setMenu = on => { add.setAttribute("aria-expanded", String(on)); menu.hidden = !on; if (on) drawMenu(); };
  add.addEventListener("click", e => { e.stopPropagation(); setMenu(menu.hidden); });
  addEventListener("pointerdown", e => { if (!menu.hidden && !e.target.closest(".pj-ctlwrap")) setMenu(false); });
  addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) { setMenu(false); add.focus(); } });

  apply();
}
