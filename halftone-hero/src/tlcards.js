// The Timeline's detail cards (Figma: V4.0 / detail-card-1 to 8, and card 1 shown open over
// the page in the second "Timeline WIP" frame). Clicking an entry, its ring or its text, opens
// its card: a dot screen builds over the page, dot by dot at random (src/tldots.js) while the
// wash under it slowly comes up to full strength, the card unrolls from its top edge, and its
// lines wave in one after another. Previous and Next move through the eight in the timeline's
// order, looping; the old text waves out and the new waves in while the card eases to its new
// height. Close rolls it back up and the dots go the way they came, as the wash fades.
//
// Close ×, Escape or a click on the dots closes; the arrow keys step. The page behind does not
// scroll while a card is open, and focus goes back to the entry it came from.

import { createDots } from "./tldots.js";

// the wash under the dots comes up slowly, over the whole build and a little more
const WASH_IN = 1100, WASH_OUT = 600;

const CARDS = [
  { title: "44LLC, NEW YORK", meta: "Three roles · 2024-2026 · New York and remote", body: [
    ["h", "The company:"],
    ["p", "44LLC is a strategy and design studio in Brooklyn. It works with hotel groups, hospitality brands and private clients, from the first positioning of a project to the standards that architects and operators build from. Clients include Jumeirah and Rosewood."],
    ["h", "Strategy Consultant · 2026 · Remote"],
    ["p", "I worked remotely from France on positioning, innovation strategy and new-business pitches for hotel groups and brands. I also advised the studio on where to spend its time across projects and saw the Jumeirah standards through to final delivery."],
    ["h", "Product Manager · Sep 2025-Feb 2026"],
    ["p", "Jumeirah’s design and product standards cover hotels and resorts, branded residences and branded villas, and I ran the programme like a product. Requirements came in from the client, chapters went out one release at a time, and review rounds ran across three time zones. To keep that pace, I built our own production tools: scripts that turn structured text into InDesign-ready layouts, batch processing for review documents, and interactive boards for client reviews. In parallel I shaped product strategy for a European tile manufacturer deciding how to split its range between trade and retail customers."],
    ["h", "Strategist · 2024-2025"],
    ["p", "Most of my first year went into pitches. I built brand strategy proposals for hospitality groups and private clients, taking each from first positioning to final presentation, and wrote the brand-led concepts behind Jumeirah’s residential and villa standards."],
    ["p", "Focus: Positioning · Pitches · Product management · Production tooling"],
  ]},
  { title: "NYC INNOVATION COLLECTIVE, NEW YORK", meta: "Associate · 2024-2025 · New York", body: [
    ["h", "The company:"],
    ["p", "A nonprofit alliance of New York tech organisations. Its members are accelerators, incubators and other startup programmes, and it works to make the city’s startup scene better connected and easier to get into."],
    ["h", "The role:"],
    ["p", "I started with the numbers. After cleaning up the membership records, I segmented members by stage and sector so we knew who to approach for which events and partnerships. That work shaped the website redesign, which I built around the two things people came for: joining and attending. I also ran the events themselves, mostly founder meetups and panel evenings."],
    ["p", "Focus: Data analysis · UX/UI · Community · Events"],
  ]},
  { title: "VYBE TOGETHER, NEW YORK", meta: "Creative Director & Co-Founder · 2020-2024 · New York", body: [
    ["h", "The company:"],
    ["p", "An app for finding and hosting small get-togethers nearby. A host posts a gathering, guests apply, and the host decides who comes."],
    ["h", "The role:"],
    ["p", "I co-founded Vybe and led its brand, go-to-market and app design, working with our product and engineering team from first concept to launch. In 2020 our first marketing video went much further than the product had. It reached national press before we had users, and we took it down. That taught me how fast a brand’s tone can run ahead of what it’s selling, and it also showed how far one small team’s idea could travel. When we came back, the brand was built around what the app had always been for: small gatherings, with the host choosing the guests."],
    ["p", "Focus: Brand · Go-to-market · App design · Founding team"],
  ]},
  { title: "JUICE HOUSE, NEW YORK", meta: "Creative Brand Strategist · 2024 · New York", body: [
    ["h", "The company:"],
    ["p", "Juice House is a creative agency and content collective based in Minneapolis, with an office in New York. It works on campaigns, content production, and influencer and digital strategy."],
    ["h", "The role:"],
    ["p", "Two projects defined my time there, one for Jordan Brand’s Jumpman line and one with Spike Lee. For each, I turned the brief into a strategy and then into concept routes and pitch decks. Once the client chose a direction, I worked with the production team on the plan to make it."],
    ["p", "Focus: Campaign strategy · Concepts · Pitch decks"],
  ]},
  { title: "REFLETÉE, MILAN", meta: "Designer & Brand Partnerships · 2020-2021 · Milan", body: [
    ["h", "The company:"],
    ["p", "A Milan fashion-tech startup working on body scanning and augmented-reality try-on, so shoppers could see clothes on their own bodies before buying. This was before virtual try-on was common."],
    ["h", "The role:"],
    ["p", "I designed parts of the try-on experience and approached fashion brands about piloting the technology."],
    ["p", "Focus: Fashion tech · AR · Partnerships"],
  ]},
  { title: "GROUPE RENAULT, GUYANCOURT", meta: "Product Design Intern · 2019 · Technocentre, Guyancourt", body: [
    ["h", "The company:"],
    ["p", "The French carmaker behind Renault, Dacia and Alpine, renamed Renault Group in 2021. Its Technocentre, south-west of Paris, is where the group designs and engineers its vehicles."],
    ["h", "The role:"],
    ["p", "I joined the design team for an internship on interior and in-car interface concepts. The work ran from sketches to models and user tests, and ended in design reviews. It was my first look at how a large company takes a product from idea to decision."],
    ["p", "Focus: Product design · Automotive · User testing"],
  ]},
  { title: "PARSONS SCHOOL OF DESIGN, NEW YORK", meta: "BBA, Strategic Design & Management · 2020-2024 · New York", body: [
    ["h", "The school:"],
    ["p", "Parsons School of Design is part of The New School. Strategic Design & Management is its business degree, applying design methods to strategy, organisations and new ventures."],
    ["h", "The degree:"],
    ["p", "I graduated with a minor in Product Design, a 3.91 GPA and a place on the Dean’s List. For my capstone I developed a product and brand strategy for a new venture, tested it with users, and presented it to faculty and industry reviewers."],
    ["p", "Focus: Strategic design · Product design · Business"],
  ]},
  { title: "INTERNATIONAL SCHOOL OF PARIS, PARIS", meta: "Bilingual International Baccalaureate (IB) · 2016-2020 · Paris", body: [
    ["h", "The school:"],
    ["p", "An international school in Paris, where I took the International Baccalaureate. Mine was the bilingual IB, with French and English both studied as first languages."],
    ["h", "Subjects:"],
    ["p", "Mathematics HL, Economics HL, Design and Technology HL and Geography HL, with French Language and Literature, English Language and Literature, and Theory of Knowledge."],
    ["h", "Personal Project:"],
    ["p", "The Uberification of Common Life: a socio-economic study of Airbnb, Uber and the service economy."],
    ["h", "Activities:"],
    ["p", "Student Council President and Vice-President, Chairman of the Model United Nations Club, and Student Mentor."],
    ["p", "Focus: Economics · Design and Technology · Leadership"],
  ]},
  { title: "CERTIFICATES", meta: "Data and entrepreneurship · 2020-2026", body: [
    ["cert", "Associate Data Analyst", "DataCamp", "2026", "DataCamp’s assessed certification in SQL, with a timed exam and a practical case on cleaning, analysing and reporting data."],
    ["cert", "Data Analytics Professional Certificate", "Google | Coursera", "2025", "Google’s programme on the whole analysis process, from framing the question to presenting results, in spreadsheets, SQL, Tableau and R."],
    ["cert", "Entrepreneurship <small>101-103</small>", "MITx | edX", "2020", "MIT’s three-part course on starting a company: finding a first customer, deciding what to offer them, and working out how the business makes money."],
    ["p", "Focus: Data · Analysis · Venture building"],
  ]},
];

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function render(c) {
  const body = c.body.map(([kind, a, b, y, d]) => {
    if (kind === "h") return `<p class="tc-h">${esc(a)}</p>`;
    if (kind === "p") return `<p class="tc-p">${esc(a)}</p>`;
    // a certificate: its name may carry a small course number, the one bit of markup allowed
    return `<div class="tc-cert"><b>${a}</b><span>${esc(b)}</span><em>${esc(y)}</em><p class="tc-p">${esc(d)}</p></div>`;
  }).join("");
  return `<header class="tc-head"><div><h2 id="tcTitle">${esc(c.title)}</h2><p class="tc-meta">${esc(c.meta)}</p></div>
    <button class="tc-close" type="button" data-act="close">Close ×</button></header>
    <div class="tc-body">${body}</div>
    <footer class="tc-foot"><button type="button" data-act="prev">← Previous</button><button type="button" data-act="next">Next →</button></footer>`;
}

export function createTimelineCards(items) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const veil = document.createElement("div");
  veil.className = "tc-veil"; veil.hidden = true;
  const card = document.createElement("div");
  card.className = "tc-card"; card.hidden = true;
  card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "tcTitle"); card.tabIndex = -1;
  const inner = document.createElement("div");
  inner.className = "tc-inner";
  card.append(inner);
  document.body.append(veil, card);
  const dots = createDots(veil);
  if (!dots) veil.classList.add("css-dots");              // no WebGL2: the dots in CSS, all at once
  const dot = document.getElementById("dot");

  let open = -1, from = null, busy = false;
  const lines = () => [...inner.querySelectorAll(".tc-head > div > *, .tc-close, .tc-body > *, .tc-foot")];
  const done = a => a.finished.catch(() => {});


  function waveIn(dir = 0, delay = 0) {
    return lines().map((el, i) => el.animate([
      { opacity: 0, transform: `translate(${dir * 14}px, ${dir ? 0 : 7}px)`, filter: "blur(3px)" },
      { opacity: 1, transform: "none", filter: "blur(0)" },
    ], { duration: reduce ? 1 : 420, delay: reduce ? 0 : delay + i * 32, easing: "cubic-bezier(.2,.7,.2,1)", fill: "backwards" }));
  }
  function waveOut(dir) {
    const ls = lines();
    return Promise.all(ls.map((el, i) => done(el.animate([
      { opacity: 1, transform: "none", filter: "blur(0)" },
      { opacity: 0, transform: `translate(${-dir * 14}px, 0)`, filter: "blur(3px)" },
    ], { duration: reduce ? 1 : 180, delay: reduce ? 0 : i * 14, easing: "ease-in", fill: "forwards" }))));
  }

  // the page stays put underneath; the scrollbar's width is kept so nothing shifts sideways
  function lockScroll(on) {
    const root = document.documentElement;
    if (on) { root.style.setProperty("--sbw", (innerWidth - root.clientWidth) + "px"); root.classList.add("tc-open"); }
    else { root.classList.remove("tc-open"); root.style.removeProperty("--sbw"); }
  }

  async function show(i, li) {
    if (busy) return;
    busy = true; open = i; from = li || items[i];
    inner.innerHTML = render(CARDS[i]);
    lockScroll(true);
    veil.hidden = false; card.hidden = false;
    if (dot) dot.classList.remove("over");
    // the dots build in at random while the whole veil eases up to full strength
    if (dots) dots.in(reduce);
    const wash = veil.animate([{ opacity: 0 }, { opacity: 1 }],
      { duration: reduce ? 1 : WASH_IN, easing: "cubic-bezier(.4,0,.3,1)", fill: "both" });
    done(wash).then(() => { if (open >= 0 && wash.playState === "finished") wash.cancel(); });
    // the card unrolls from its top edge, tipping toward the viewer like paper coming off a roll
    const roll = card.animate([
      { clipPath: "inset(0 0 100% 0)", transform: "perspective(1200px) rotateX(-14deg) translateY(-10px)", opacity: 0.4 },
      { clipPath: "inset(0 0 0 0)", transform: "none", opacity: 1 },
    ], { duration: reduce ? 1 : 640, delay: reduce ? 0 : 200, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
    waveIn(0, 320);
    card.scrollTop = 0;
    card.focus({ preventScroll: true });
    await done(roll);
    busy = false;
  }

  async function step(d) {
    if (busy || open < 0) return;
    busy = true;
    const next = (open + d + CARDS.length) % CARDS.length;
    const h0 = card.offsetHeight;
    await waveOut(d);
    open = next; from = items[next];
    inner.innerHTML = render(CARDS[next]);
    card.scrollTop = 0;
    // ease the card to its new height rather than jumping
    const h1 = card.offsetHeight;
    const grow = card.animate([{ height: h0 + "px" }, { height: h1 + "px" }],
      { duration: reduce ? 1 : 360, easing: "cubic-bezier(.3,.7,.2,1)" });
    waveIn(d, 60);
    await done(grow);
    busy = false;
  }

  async function hide() {
    if (open < 0 || busy) return;
    busy = true;
    lines().forEach(el => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduce ? 1 : 140, fill: "forwards" }));
    const roll = card.animate([
      { clipPath: "inset(0 0 0 0)", transform: "none", opacity: 1 },
      { clipPath: "inset(0 0 100% 0)", transform: "perspective(1200px) rotateX(-10deg) translateY(-6px)", opacity: 0.4 },
    ], { duration: reduce ? 1 : 340, easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" });
    const o0 = getComputedStyle(veil).opacity;           // the wash may still be coming up
    veil.getAnimations().forEach(x => x.cancel());
    const wash = veil.animate([{ opacity: o0 }, { opacity: 0 }],
      { duration: reduce ? 1 : WASH_OUT, delay: reduce ? 0 : 80, easing: "cubic-bezier(.5,0,.7,1)", fill: "forwards" });
    await Promise.all([done(roll), done(wash), dots ? dots.out(reduce) : null]);
    card.getAnimations().forEach(a => a.cancel()); veil.getAnimations().forEach(a => a.cancel());
    card.hidden = true; veil.hidden = true;
    lockScroll(false);
    const was = items[open]; open = -1; busy = false;
    was.focus({ preventScroll: true });
  }

  // the entries: the whole of each, ring and text, opens its card
  items.forEach((li, i) => {
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-haspopup", "dialog");
    const name = li.querySelector("h3") ? li.querySelector("h3").textContent : "Certificates";
    li.setAttribute("aria-label", "Open details: " + name);
    li.addEventListener("click", () => show(i, li));
    li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(i, li); } });
    if (dot) {
      li.addEventListener("pointerenter", () => { if (open < 0) dot.classList.add("over"); });
      li.addEventListener("pointerleave", () => dot.classList.remove("over"));
    }
  });

  card.addEventListener("click", e => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "close") hide();
    else step(act.dataset.act === "next" ? 1 : -1);
  });
  veil.addEventListener("click", hide);
  addEventListener("keydown", e => {
    if (open < 0) return;
    if (e.key === "Escape") { e.preventDefault(); hide(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (e.key === "Tab") {                        // keep the keyboard inside the card
      const f = [...card.querySelectorAll("button")];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  return { show, hide, step };
}
