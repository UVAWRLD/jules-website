// The Projects page (Figma: Projects portfolio): its cards, and the controls above them.
//
// The cards are built from public/projects/projects.json, which the project database exports
// (~/Developer/prj_jules_projects, tools/export_site.py): the Featured and Selected projects in
// rank order, each with its text and three or four web-sized prints. The database is the source;
// to change the page, change the database and export again.
//
// Cards alternate between the frame's two cards: a wide one with its pictures on the left (a
// backing sheet, a supporting print, the main print, a detail print) and a narrower one with its
// words on the left and three small prints. The prints take the frame's places and turns.
//
//   Search        opens into a field; the cards show only those whose words contain it
//   Sort          steps through the database's order, newest first, and oldest first
//   + Add Filter  a menu of the cards' tags (discipline and context); each one chosen becomes a
//                 chip, and a card shows only with every chosen tag. A chip's × removes it

const DATA = "public/projects/projects.json";

// the frame's layers, in % of the 574 x 300 picture area: x, y, w, h, turn, spread on hover
const WIDE = [
  { slot: "sheet",      x: 16.035, y: 8.053,  w: 74.913, h: 83.333, r: 2.2,  dx: 2,  dy: -2, print: 3, flat: true, o: 0.68 },
  { slot: "supporting", x: 2.852,  y: 6.437,  w: 28.92,  h: 39.333, r: -4.5, dx: -8, dy: -5, print: 1 },
  { slot: "main",       x: 20.557, y: 10.333, w: 73.171, h: 78.667, r: 0,    dx: 4,  dy: 0,  print: 0 },
  { slot: "detail",     x: -0.765, y: 54.903, w: 29.268, h: 40,     r: 4,    dx: -9, dy: 6,  print: 2 },
];
const NARROW = [
  { x: 11.04,  y: 10.11,  w: 28.92,  h: 39.333, r: 4.5, dx: -6, dy: -5, print: 1 },
  { x: 12.76,  y: 50.33,  w: 29.268, h: 40,     r: -4,  dx: -5, dy: 5,  print: 2 },
  { x: 26.129, y: 29.903, w: 29.268, h: 40,     r: -4,  dx: 8,  dy: 0,  print: 0 },
];
const DISCIPLINE = { "product design": "Product Design", "ux/ui": "UX/UI", "strategy": "Strategy", "data & analysis": "Data & Analysis",
  "graphic design": "Graphic Design", "3d & motion": "3D & Motion" };

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function layer(l, p) {
  const img = p.prints[l.print];
  const style = `--x:${l.x}%;--y:${l.y}%;--w:${l.w}%;--h:${l.h}%;--r:${l.r}deg;--dx:${l.dx}px;--dy:${l.dy}px` + (img && l.o ? `;--o:${l.o}` : "");
  const cls = "pj-layer" + (l.flat ? " flat" : "") + (!img ? " sheet" : "");
  if (!img && l.slot !== "sheet") return "";            // a print it does not have is left out
  return `<figure class="${cls}" style="${style}">${img ? `<img src="${img.src}" width="${img.w}" height="${img.h}" alt="" loading="lazy" decoding="async">` : ""}</figure>`;
}

function card(p, i) {
  const wide = i % 2 === 0;
  const tags = [DISCIPLINE[(p.discipline || "").toLowerCase()] || p.discipline, p.context].filter(Boolean);
  const layers = (wide ? WIDE : NARROW).map(l => layer(l, p)).join("");
  return `<article class="pj-card${wide ? "" : " alt"}" data-rank="${p.rank}" data-year="${p.yearSort ?? ""}" data-tags="${esc(tags.join("|"))}">
    <div class="pj-meta">
      <ul class="pj-tags">${tags.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
      <span class="pj-year">${esc(p.year || "")}</span>
    </div>
    <div class="pj-body">
      <div class="pj-imgs" aria-hidden="true">${layers}</div>
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
  const search = document.getElementById("pjSearch"), input = search.querySelector("input");
  const sortBtn = document.getElementById("pjSort"), sortLabel = sortBtn.querySelector(".label");
  const add = document.getElementById("pjAdd"), menu = document.getElementById("pjMenu");
  const chips = document.getElementById("pjChips");

  const text = c => c.textContent.replace(/\s+/g, " ").toLowerCase();
  const tagsOf = c => c.dataset.tags ? c.dataset.tags.split("|") : [];
  const allTags = [...new Set(cards.flatMap(tagsOf))].sort();
  const chosen = new Set();

  function apply() {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const c of cards) {
      const ok = (!q || text(c).includes(q)) && [...chosen].every(t => tagsOf(c).includes(t));
      c.hidden = !ok; if (ok) shown++;
    }
    empty.hidden = shown > 0;
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
