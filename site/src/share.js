// Share buttons ([data-share]): the phone's own share sheet where there is one (iPhone, Android,
// Safari on a Mac); elsewhere the link is copied and the button says so for a moment. The link is
// data-url (made absolute), else the page's canonical address.
export function bindShare(root = document) {
  for (const btn of root.querySelectorAll("[data-share]")) {
    const label = btn.querySelector("span");
    const idle = label.textContent;
    let timer = 0;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const canon = document.querySelector('link[rel="canonical"]')?.href;
      const url = btn.dataset.url ? new URL(btn.dataset.url, document.baseURI).href : (canon || location.href);
      const title = btn.dataset.title || document.title;
      if (navigator.share) {
        try { await navigator.share({ title, url }); return; }
        catch (err) { if (err.name === "AbortError") return; }
      }
      try { await navigator.clipboard.writeText(url); label.textContent = "Link copied"; }
      catch (err) { label.textContent = "Copy failed"; }
      clearTimeout(timer);
      timer = setTimeout(() => { label.textContent = idle; }, 1800);
    });
  }
}
