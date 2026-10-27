// The reading bar on an essay: minutes left and a thin progress line, and a button that steps the
// text through three sizes (remembered for the next essay). It comes in once the title has
// scrolled away and goes again when the essay's end comes into view.
const SIZES = [16, 17.5, 19.5];          // css px on a computer; a phone takes 0.5px less
const WPM = 230;

export function createReader({ text, start, end, bar }) {
  const words = text.textContent.trim().split(/\s+/).length;
  const minutes = words / WPM;
  const left = bar.querySelector("[data-left]");
  const fill = bar.querySelector(".bar i");
  const sizeBtn = bar.querySelector("[data-size]");
  const phone = matchMedia("(max-width:820px)");

  let size = 1;
  try { const s = +localStorage.getItem("readSize"); if (s >= 0 && s < SIZES.length) size = s; } catch (e) {}
  const applySize = () => {
    text.style.setProperty("--fs", (SIZES[size] - (phone.matches ? 0.5 : 0)) + "px");
    sizeBtn.setAttribute("aria-label", `Text size ${["small", "medium", "large"][size]}; change`);
  };
  sizeBtn.addEventListener("click", () => {
    size = (size + 1) % SIZES.length;
    try { localStorage.setItem("readSize", size); } catch (e) {}
    applySize();
  });
  phone.addEventListener("change", applySize);
  applySize();

  let raf = 0;
  const update = () => {
    raf = 0;
    const r = text.getBoundingClientRect();
    const vh = innerHeight;
    // read so far: how much of the text has passed the bottom of the window
    const p = Math.min(1, Math.max(0, (vh - r.top) / r.height));
    fill.style.setProperty("--p", p.toFixed(4));
    const m = Math.max(1, Math.ceil(minutes * (1 - p)));
    left.textContent = p > 0.985 ? "Finished" : `${m} min left`;
    const shown = start.getBoundingClientRect().bottom < 0 && end.getBoundingClientRect().top > vh - 40;
    bar.classList.toggle("on", shown);
  };
  const ask = () => { if (!raf) raf = requestAnimationFrame(update); };
  addEventListener("scroll", ask, { passive: true });
  addEventListener("resize", ask);
  // the text's height changes with its size
  new ResizeObserver(ask).observe(text);
  update();
}
