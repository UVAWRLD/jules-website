// The Projects page's controls (Figma: Projects portfolio, the pills beside "Selected projects").
// The cards are written into the page; this only narrows and orders them.
//
//   Search        opens into a field; the cards show only those whose words contain it
//   Sort          flips the order by year, newest first (as written) or oldest first
//   + Add Filter  a menu of the cards' own tags; each one chosen becomes a chip, and a card
//                 shows only with every chosen tag. A chip's × removes it
//
// The count under the intro follows what is showing ("02 projects").

export function createProjectControls() {
  const list = document.getElementById("pjList");
  if (!list) return;
  const cards = [...list.querySelectorAll(".pj-card")];
  const empty = document.getElementById("pjEmpty");
  const count = document.getElementById("pjCount");
  const search = document.getElementById("pjSearch"), input = search.querySelector("input");
  const sortBtn = document.getElementById("pjSort");
  const add = document.getElementById("pjAdd"), menu = document.getElementById("pjMenu");
  const chips = document.getElementById("pjChips");

  const text = c => c.textContent.replace(/\s+/g, " ").toLowerCase();
  const tagsOf = c => [...c.querySelectorAll(".pj-tags li")].map(li => li.textContent.trim());
  const allTags = [...new Set(cards.flatMap(tagsOf))].sort();
  const chosen = new Set();
  let newestFirst = true;

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
  const open = () => { search.classList.add("open"); input.focus(); };
  search.addEventListener("click", e => { if (e.target !== input) open(); });
  input.addEventListener("input", apply);
  input.addEventListener("keydown", e => { if (e.key === "Escape") { input.value = ""; apply(); input.blur(); } });
  input.addEventListener("blur", () => { if (!input.value) search.classList.remove("open"); });

  // ---- sort ----
  const label = () => {
    sortBtn.setAttribute("aria-label", newestFirst ? "Sort: newest first. Switch to oldest first" : "Sort: oldest first. Switch to newest first");
    sortBtn.classList.toggle("on", !newestFirst);
  };
  sortBtn.addEventListener("click", () => {
    newestFirst = !newestFirst;
    const order = [...cards].sort((a, b) => (newestFirst ? -1 : 1) * (+a.dataset.year - +b.dataset.year));
    order.forEach(c => list.insertBefore(c, empty));
    label();
  });
  label();

  // ---- filters ----
  function drawMenu() {
    menu.innerHTML = "";
    if (!allTags.length) { menu.innerHTML = '<button type="button" disabled>No tags yet</button>'; return; }
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
      b.innerHTML = `${t}<span aria-hidden="true">×</span>`;
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
