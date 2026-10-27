// The Bookshelf page: my books on white floating shelves, covers out, each a solid CSS 3D book.
//
// A book is a box W x H x T, at its edition's real size: H its height in inches, W the cover's
// width at that height, T from its page count and binding.
// The cover faces you, lit from the upper left, with the joint of the binding pressed in near its
// left edge; the spine is the left face (its colour sampled from the cover, the title running down
// it), the page block the right face and the top; a soft shadow falls behind it on the wall and
// under it on the shelf. Each shelf is seen from a little above. Hover lifts a book and turns it
// to show its spine, and its title, author, a line on what it is and my rating show faintly under
// its shelf; a click or a tap takes it down: it comes forward, cover to you, the others fade back,
// and its caption comes up in full. A click anywhere else, or Escape, puts it back.
//
// The books come from public/books/books.json (my Goodreads shelf, in the editions on it; the
// covers at full size). The books I am reading ("status": "reading") come first and say so in
// their details.

const DATA = "public/books/books.json";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function createBookshelf() {
  const shelf = document.getElementById("bkShelf");
  if (!shelf) return;
  let books = [];
  try { books = (await (await fetch(DATA, { cache: "no-cache" })).json()).books || []; }
  catch { shelf.innerHTML = '<p class="bk-intro">The books could not be loaded.</p>'; return; }
  const read = books.filter(b => b.status !== "reading"), reading = books.filter(b => b.status === "reading");
  const count = document.getElementById("bkCount");
  if (count) count.textContent = `${read.length} read` + (reading.length ? ` · ${reading.length} reading` : "");
  const order = [...reading, ...read];

  // H0 is pixels to the inch. A book is as tall as its edition (pocket books about 7 inches, trade
  // paperbacks 8, hardbacks 9.5), as wide as its cover at that height, and as thick as its pages
  // (about 0.0024 inch a leaf of paper, counted per page) plus its covers (stiff boards on a hardback)
  function size(b, H0) {
    const H = (b.height_in || 8) * H0, W = H * b.w / b.h;
    const T = ((b.pages || 200) * .0024 + (b.format === "hard" ? .2 : .05)) * H0;
    return { W, H, T, fs: Math.min(10, Math.max(6.5, T * .34)) };
  }

  function book(b, H0) {
    const { W, H, T, fs } = size(b, H0);
    return `<button class="book" type="button" data-slug="${esc(b.slug)}" aria-label="${esc(b.title)} by ${esc(b.author)}"
      style="--w:${W.toFixed(1)}px;--h:${H.toFixed(1)}px;--t:${T.toFixed(1)}px;--fs:${fs.toFixed(1)}px;--spine:${b.spine};--ink-s:${b.ink}">
      <span class="b3">
        <span class="cast" aria-hidden="true"></span>
        <span class="f back"></span>
        <span class="f spine"><span class="sp"><b>${esc(b.title)}</b><i>${esc(b.author.split(" ").slice(-1)[0])}</i></span></span>
        <span class="f pages"></span>
        <span class="f top"></span>
        <span class="f front" style="background-image:url('${esc(b.cover)}')"></span>
      </span>
    </button>`;
  }

  let open = null;
  function layout() {
    const phone = innerWidth <= 520, mid = innerWidth <= 820;
    const per = phone ? 3 : mid ? 4 : 6, H0 = phone ? 14.2 : mid ? 18 : 22.4;
    // as few shelves as hold them all, the books shared out evenly, so no book is left on its own
    const n = Math.ceil(order.length / per), rows = [];
    for (let i = 0, k = 0; k < n; k++) {
      const m = Math.floor(order.length / n) + (k < order.length % n ? 1 : 0);
      rows.push(order.slice(i, i += m));
    }
    shelf.innerHTML = rows.map((r, n) => `<div class="bk-row" data-row="${n}">
        <div class="bk-books">${r.map(b => book(b, H0)).join("")}</div>
        <div class="bk-plank"><span class="top"></span><span class="front"></span></div>
      </div>
      <div class="bk-detail" data-row="${n}" aria-live="polite"><div class="in">${r.map(b =>
        `<div class="cap" data-slug="${esc(b.slug)}" aria-hidden="true">${detail(b)}</div>`).join("")}</div></div>`).join("");
    // a soft shadow under each book, on the shelf's top
    for (const row of shelf.querySelectorAll(".bk-row")) {
      const top = row.querySelector(".bk-plank .top"), base = row.getBoundingClientRect().left;
      for (const el of row.querySelectorAll(".book")) {
        const r = el.getBoundingClientRect(), sh = document.createElement("span");
        sh.className = "sh";
        sh.style.left = (r.left - base - r.width * .02).toFixed(0) + "px";
        sh.style.width = (r.width * 1.08).toFixed(0) + "px";
        top.appendChild(sh);
      }
    }
    if (open) { const el = shelf.querySelector(`.book[data-slug="${CSS.escape(open)}"]`); if (el) take(el); else open = null; }
  }

  const stars = n => `<span class="bk-stars" aria-label="${n} out of 5">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
  function detail(b) {
    const status = b.status === "reading" ? "Reading now" : b.read ? `Read ${esc(b.read)}` : "Read";
    return `<div class="hd"><h2>${esc(b.title)}</h2>${b.subtitle ? `<span>${esc(b.subtitle)}</span>` : ""}<span class="by">${esc(b.author)}</span>
      <span class="meta">${b.status === "reading" ? "" : stars(b.rating || 0)}<span>${status}</span>${b.pages ? `<span>${b.pages} pages</span>` : ""}</span></div>
      ${b.blurb ? `<p>${esc(b.blurb)}</p>` : ""}`;
  }

  // Every book's caption is already under its shelf, stacked in one place and hidden, so the space
  // is there before anything shows and nothing below moves. The book under the cursor (or with
  // focus) shows its caption faintly; the one taken down shows it in full.
  let peek = null;
  function captions() {
    for (const c of shelf.querySelectorAll(".cap")) {
      const s = c.dataset.slug, on = s === open;
      c.classList.toggle("on", on);
      c.classList.toggle("peek", !on && s === peek && !c.closest(".bk-detail").querySelector(`.cap[data-slug="${CSS.escape(open || "")}"]`));
      c.setAttribute("aria-hidden", on ? "false" : "true");
    }
  }
  function take(el) {
    shelf.querySelectorAll(".book.out").forEach(x => x !== el && x.classList.remove("out"));
    el.classList.add("out"); shelf.classList.add("has-out"); open = el.dataset.slug;
    const r = el.closest(".bk-row").dataset.row;
    shelf.querySelectorAll(".bk-detail").forEach(d => d.classList.toggle("on", d.dataset.row === r));
    captions();
  }
  function putBack() {
    shelf.querySelectorAll(".book.out").forEach(x => x.classList.remove("out"));
    shelf.querySelectorAll(".bk-detail.on").forEach(d => d.classList.remove("on"));
    shelf.classList.remove("has-out"); open = null;
    captions();
  }
  const hover = (el, on) => { if (on) peek = el.dataset.slug; else if (peek === el.dataset.slug) peek = null; captions(); };
  shelf.addEventListener("pointerover", e => { const el = e.pointerType === "mouse" && e.target.closest(".book"); if (el) hover(el, true); });
  shelf.addEventListener("pointerout", e => { const el = e.target.closest(".book"); if (el && !el.contains(e.relatedTarget)) hover(el, false); });
  shelf.addEventListener("focusin", e => { const el = e.target.closest(".book"); if (el) hover(el, true); });
  shelf.addEventListener("focusout", e => { const el = e.target.closest(".book"); if (el) hover(el, false); });

  shelf.addEventListener("click", e => {
    const el = e.target.closest(".book"); if (!el) return;
    e.stopPropagation();
    el.classList.contains("out") ? putBack() : take(el);
  });
  addEventListener("click", e => { if (open && !e.target.closest(".book, .bk-detail")) putBack(); });
  addEventListener("keydown", e => { if (e.key === "Escape" && open) putBack(); });

  layout();
  document.getElementById("bkText")?.remove();   // its text for crawlers (tools/build_seo.py)
  let lastW = innerWidth, t = 0;
  addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (innerWidth !== lastW) { lastW = innerWidth; layout(); } }, 120); });
}
