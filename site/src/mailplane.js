// Email links that send the paper plane first (src/plane.js): "Message me." on the home page and
// hello@julesbockelee.com in the footers. A click flies the plane from the end of the link to the
// right edge of the window and opens the mail as it gets there. The page's renderer (the home page's
// src/halftone.js, or src/crowstage.js elsewhere) puts window.flyPlane there; without it, with
// Reduce Motion, or on a cmd/ctrl click, the mail opens at once.
export function bindPlaneLinks(selector = "a[data-plane]") {
  let flying = false;
  for (const link of document.querySelectorAll(selector)) {
    link.addEventListener("click", e => {
      if (!window.flyPlane || matchMedia("(prefers-reduced-motion: reduce)").matches || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      if (flying) return;
      flying = true;
      let opened = false;
      const go = () => { if (opened) return; opened = true; flying = false; location.href = link.href; };
      const r = link.getBoundingClientRect();
      window.flyPlane(r.right + 6, r.top + r.height / 2, go);
      setTimeout(go, 6000);                       // the mail opens even if frames stall
    });
  }
}
