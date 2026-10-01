// The Bookshelf page: each book a CSS 3D box standing on a thin floating shelf, spine out.
//
// A book is W x H x D: W its thickness, from the page count; H its height, from its format (a
// hardback stands taller than a pocket paperback); D the cover's width, from the cover's own
// proportions. The spine faces you in the colour sampled from the cover's left edge, with the
// title and author running down it; the cover is the right-hand face, the page edges on top. The
// shelf is perspective from a little above, so the tops show. Hover slides a book out a little; a
// click or a tap takes it out: it comes forward and turns to show its cover, and its title,
// author and my rating show under the shelf. A click anywhere else, or Escape, puts it back.
//
// The books come from public/books/books.json (my Goodreads shelf; covers and page counts from
// Open Library). A book with "status": "reading" stands at the end of the shelf, leaning, with a
// bookmark ribbon out of the top. The rows are packed to the width the shelf has.

const DATA = "public/books/books.json";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function createBookshelf() {
  const shelf = document.getElementById("bkShelf"), info = document.getElementById("bkInfo");
  if (!shelf) return;
  let books = [];
  try { books = (await (await fetch(DATA, { cache: "no-cache" })).json()).books || []; }
  catch { shelf.innerHTML = '<p class="bk-intro">The books could not be loaded.</p>'; return; }
  const read = books.filter(b => b.status !== "reading"), reading = books.filter(b => b.status === "reading");
  const count = document.getElementById("bkCount");
  if (count) count.textContent = `${read.length} read` + (reading.length ? ` · ${reading.length} reading` : "");
  const order = [...read, ...reading];

  function size(b, s) {
    const H = b.height * s, D = H * b.w / b.h;
    const W = Math.min(40, Math.max(11, b.pages * .062 + 8)) * s;
    return { W, H, D, fs: Math.min(11, Math.max(7, W * .4)) };
  }

  function book(b, s) {
    const { W, H, D, fs } = size(b, s);
    const lean = b.status === "reading" ? "-9deg" : "0deg";
    return `<button class="book${b.status === "reading" ? " reading" : ""}" type="button" data-slug="${esc(b.slug)}"
      aria-label="${esc(b.title)} by ${esc(b.author)}"
      style="--w:${W.toFixed(1)}px;--h:${H.toFixed(1)}px;--d:${D.toFixed(1)}px;--fs:${fs.toFixed(1)}px;--spine:${b.spine};--ink-s:${b.ink};--lean:${lean}">
      <span class="b3">
        <span class="f spine"><b>${esc(b.title)}</b><i>${esc(b.author.split(" ").slice(-1)[0])}</i></span>
        <span class="f cover" style="background-image:url('${esc(b.cover)}')"></span>
        <span class="f back"></span>
        <span class="f top"></span>
        ${b.status === "reading" ? '<span class="rib" aria-hidden="true"></span>' : ""}
      </span>
    </button>`;
  }

  let open = null;
  function layout() {
    // the books fill most of each shelf (as many shelves as they need at their smallest size, up to
    // 1.55x), shared out evenly between the shelves
    const pad = innerWidth <= 820 ? 16 : 36, room = shelf.clientWidth - pad;
    const wOf = (b, k) => size(b, k).W + 1 + (b.status === "reading" ? 22 * k : 0);
    const sum1 = order.reduce((a, b) => a + wOf(b, 1), 0);
    const k0 = innerWidth <= 520 ? .78 : .9, n0 = Math.ceil(sum1 * k0 / room);
    const s = Math.max(k0, Math.min(1.55, room * n0 * .88 / sum1));
    const total = order.reduce((a, b) => a + wOf(b, s), 0), n = Math.ceil(total / room), target = total / n;
    const rows = [[]];
    let used = 0;
    for (const b of order) {
      const w = wOf(b, s);
      if (rows.length < n && used + w / 2 > target && rows[rows.length - 1].length) { rows.push([]); used = 0; }
      rows[rows.length - 1].push(b); used += w;
    }
    shelf.innerHTML = rows.map(r => {
      const deep = Math.max(...r.map(b => size(b, s).D));
      return `<div class="bk-row"><div class="bk-books">${r.map(b => (b.status === "reading" ? `<i style="flex:none;width:${(18 * s).toFixed(0)}px"></i>` : "") + book(b, s)).join("")}</div>
        <div class="bk-plank" style="--pd:${(deep + 22).toFixed(0)}px;--pz:${(10 * s).toFixed(0)}px"><span class="top"></span><span class="front"></span></div>
        <span class="bk-wall" aria-hidden="true"></span></div>`;
    }).join("");
    if (open) { const el = shelf.querySelector(`.book[data-slug="${CSS.escape(open)}"]`); if (el) take(el, true); else open = null; }
  }

  function stars(n) { return `<span class="bk-stars" aria-label="${n} out of 5">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`; }
  function show(b) {
    if (!b) { info.innerHTML = '<span class="hint">Tap or click a book to take it out.</span>'; return; }
    const status = b.status === "reading" ? "Reading now" : b.read ? `Read ${esc(b.read)}` : "Read";
    info.innerHTML = `<h2>${esc(b.title)}</h2>${b.subtitle ? `<p>${esc(b.subtitle)}</p>` : ""}<p>${esc(b.author)}</p>
      <span class="meta">${b.status === "reading" ? "" : stars(b.rating || 0)}<span>${status}</span><span>${b.pages} pages</span></span>`;
  }

  // take a book out: it comes forward, turned to show its cover, kept inside the screen
  function take(el, quiet) {
    shelf.querySelectorAll(".book.out").forEach(x => x !== el && x.classList.remove("out"));
    el.classList.add("out"); shelf.classList.add("has-out");
    open = el.dataset.slug;
    el.style.setProperty("--ox", "0px");
    const r = el.getBoundingClientRect(), d = parseFloat(el.style.getPropertyValue("--d")) * 1.3;
    const left = r.left + r.width / 2 - d / 2, right = r.left + r.width / 2 + d / 2, m = 16;
    el.style.setProperty("--ox", (left < m ? m - left : right > innerWidth - m ? innerWidth - m - right : 0).toFixed(0) + "px");
    if (!quiet) show(order.find(b => b.slug === open));
  }
  function putBack() {
    shelf.querySelectorAll(".book.out").forEach(x => x.classList.remove("out"));
    shelf.classList.remove("has-out"); open = null; show(null);
  }

  shelf.addEventListener("click", e => {
    const el = e.target.closest(".book"); if (!el) return;
    e.stopPropagation();
    el.classList.contains("out") ? putBack() : take(el);
  });
  addEventListener("click", e => { if (open && !e.target.closest(".book")) putBack(); });
  addEventListener("keydown", e => { if (e.key === "Escape" && open) putBack(); });

  layout();
  let lastW = innerWidth, t = 0;
  addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (innerWidth !== lastW) { lastW = innerWidth; layout(); } }, 120); });
}
