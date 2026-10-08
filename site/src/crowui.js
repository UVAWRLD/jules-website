// Everything around the crow that is not the crow: the card that names him, the leader line
// that ties it to him, the hit area over him, and the red dot that stands in for the pointer.
// Shared by every page that has the bird; the page's renderer draws him and calls update()
// once a frame with the canvas's rect.

const MARKUP = `
<div id="crowHit" hidden></div>
<div id="dot" aria-hidden="true"></div>
<svg id="crowLead" width="0" height="0" aria-hidden="true"><path fill="none"/></svg>
<div id="crowCard" role="note" aria-hidden="true">
  <div>
    <p class="term">Crow</p>
    <p class="say">Corvus · /ˈkɔː.vəs/ KOR-vus</p>
  </div>
  <p class="def">Passerine bird of the family Corvidae. Known to make its own tools and to combine
    them into new ones. Appears to think a problem through before acting, and adapts whatever
    materials are to hand. Thrives in both urban and wild habitats, from city centres to coastal
    cliffs. Recognises individual people and remembers those it has dealt with for years.</p>
</div>`;

// The card is a hover on the bird, and only while he is actually still: not in flight, not
// for the first second on the perch, and gone the moment he leaves.
export const SETTLE = 1.0;                  // seconds on the perch before the hover answers

// The leader: a dashed hop off the bird, a 45 degree run, then a short horizontal into the
// card's edge. The card is placed first and clamped to the window, then the leader is built
// from wherever it landed: off his right shoulder, his left, or straight up when the card
// sits over him, which is what happens on a phone. Same motif, just shorter.
const LEAD_RISE = 75, CARD_MID = 61, EDGE = 12, HOP = 8, OVER_GAP = 22;

export function createCrowUI({ crow, fine, canvasWidth }) {
  if (!document.getElementById("crowCard")) document.body.insertAdjacentHTML("beforeend", MARKUP);
  const crowHit = document.getElementById("crowHit");
  const crowCard = document.getElementById("crowCard");
  const crowLead = document.getElementById("crowLead");
  const crowLeadPath = crowLead.querySelector("path");
  const dot = document.getElementById("dot");

  // A dot instead of a pointer. Drawn as an element rather than a cursor image so it stays
  // crisp on a retina screen; it is moved in the pointer handler itself, not in the frame
  // loop, so it does not lag behind the hand.
  if (fine) {
    document.body.classList.add("dotted");
    addEventListener("pointerdown", () => dot.classList.add("down"));
    addEventListener("pointerup", () => dot.classList.remove("down"));
    addEventListener("pointerleave", () => dot.classList.remove("on"));
    addEventListener("pointermove", e => {
      if (e.pointerType !== "mouse") return;
      dot.style.transform = "translate3d(" + e.clientX + "px," + e.clientY + "px,0)";
      dot.classList.add("on");
    }, { passive: true });
  }

  let cardWanted = false, cardOn = false;
  function showCard(on) {
    cardWanted = on;
    if (on === cardOn) return;
    cardOn = on;
    document.body.classList.toggle("crow-card", on);
    crowCard.setAttribute("aria-hidden", String(!on));
  }
  crowHit.onmouseenter = () => { if (fine) { showCard(true); dot.classList.add("over"); } };
  crowHit.onmouseleave = () => { if (fine) { showCard(false); dot.classList.remove("over"); } };
  crowHit.onclick = () => {
    // With a mouse the card is already open on hover, so a click sends him off. By touch
    // there is no hover: the first tap opens the card, the second sends him off.
    if (!fine && !cardOn) { showCard(true); return; }
    showCard(false); dot.classList.remove("over");
    crow.click(canvasWidth());
  };
  // a tap anywhere else puts the card away again
  addEventListener("pointerdown", e => {
    if (!fine && cardOn && !crowHit.contains(e.target)) showCard(false);
  }, { passive: true });

  function placeCard(cvr) {
    const [x0, y0, x1, y1] = crow.bbox;
    const vw = innerWidth, vh = innerHeight;
    const cw = crowCard.offsetWidth, ch = crowCard.offsetHeight;
    const bl = cvr.left + x0, br = cvr.left + x1, bt = cvr.top + y0, bb = cvr.top + y1;
    const rise = Math.max(14, Math.min(LEAD_RISE, bt - EDGE - CARD_MID));

    // room to the right, as in the design; failing that the left; failing both, above him
    let side = 0;
    if (br - 10 + rise + 22.5 + cw <= vw - EDGE) side = 1;
    else if (bl + 10 - rise - 22.5 - cw >= EDGE) side = -1;

    let left, top, ax, ay, entryX, entryY, corner = 0;
    if (side) {
      ax = side > 0 ? br - 10 : bl + 10; ay = bt + 2;
      left = side > 0 ? ax + rise + 22.5 : ax - rise - 22.5 - cw;
      left = Math.max(EDGE, Math.min(left, vw - EDGE - cw));
      top = Math.max(EDGE, Math.min(ay - rise - CARD_MID, vh - EDGE - ch));
      entryX = side > 0 ? left : left + cw;
      entryY = Math.max(top + 8, Math.min(top + CARD_MID, top + ch - 8));
      corner = ax + side * Math.max(0, ay - entryY);          // 45 degrees out of the hop
      const limit = entryX - side * 6;                        // always leave a little run
      if (side > 0 ? corner > limit : corner < limit) corner = limit;
    } else {
      // no room either side, so above him, or below when the card is taller than the space
      // over his head. That is the usual case on a phone.
      ax = (bl + br) / 2;
      const above = bt - OVER_GAP - ch >= EDGE;
      left = Math.max(EDGE, Math.min(ax - cw / 2, vw - EDGE - cw));
      if (above) { ay = bt - 2; top = Math.max(EDGE, ay - OVER_GAP - ch); entryY = top + ch; }
      else { ay = bb + 2; top = Math.min(vh - EDGE - ch, ay + OVER_GAP); entryY = top; }
      entryX = Math.max(left + 24, Math.min(ax, left + cw - 24));
    }
    crowCard.style.left = left + "px"; crowCard.style.top = top + "px";

    // no room to draw it without crossing him: better no line than a line into his back
    const room = side ? true : Math.abs(ay - entryY) >= 8;
    crowLead.style.display = room ? "" : "none";
    if (!room) return;

    const xs = [ax, entryX].concat(side ? [corner] : []), pad = 10;
    const lx = Math.min(...xs) - pad, ly = Math.min(entryY, ay) - pad;
    crowLead.style.left = lx + "px"; crowLead.style.top = ly + "px";
    crowLead.setAttribute("width", (Math.max(...xs) - lx + pad) + "");
    crowLead.setAttribute("height", (Math.max(ay, entryY) - ly + pad) + "");
    const P = (x, y) => (x - lx).toFixed(1) + " " + (y - ly).toFixed(1);
    const span = Math.abs(ay - entryY);
    const g = Math.min(HOP, Math.max(4, span * 0.35));          // the dashes shrink with it
    const hx = side ? side * g : (entryX > ax ? g * 0.4 : -g * 0.4);
    const hy = (entryY < ay ? -1 : 1) * g;
    crowLeadPath.setAttribute("d",
      "M " + P(ax, ay) + " L " + P(ax + hx * 0.45, ay + hy * 0.45) +
      " M " + P(ax + hx * 0.72, ay + hy * 0.72) + " L " + P(ax + hx, ay + hy) +
      " M " + P(ax + hx * 1.25, ay + hy * 1.25) +
      (side ? " L " + P(corner, entryY) + " L " + P(entryX, entryY)
            : " L " + P(entryX, entryY)));
  }

  // once a frame, after the crow has been updated: the hit area follows him while he is
  // still, and the card with it
  function update(cvr) {
    const still = crow.phase === "perched" && crow.state.t > SETTLE;
    crowHit.hidden = !still;
    if (still) {
      const [x0, y0, x1, y1] = crow.bbox;
      crowHit.style.left = (cvr.left + x0 - 6) + "px"; crowHit.style.top = (cvr.top + y0 - 6) + "px";
      crowHit.style.width = (x1 - x0 + 12) + "px"; crowHit.style.height = (y1 - y0 + 12) + "px";
      if (cardWanted) { showCard(true); placeCard(cvr); }
    } else if (cardOn || cardWanted) {
      showCard(false); cardWanted = false;      // he moved: the card goes with him
      dot.classList.remove("over");
    }
  }

  return { update, hide: () => showCard(false), dot };
}
