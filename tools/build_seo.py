#!/usr/bin/env python3
"""Writes what search engines and AI assistants read, from the site's own data.

    python3 tools/build_seo.py

Run it after anything below changes: the projects export, books.json, the Timeline's cards
(CARDS in site/src/tlcards.js), or the words in PAGES and PERSON here. It rewrites, in place:

  - each page's <head> between <!-- seo:head --> markers: title, description, canonical,
    the social preview tags (Open Graph and X) and the structured data (schema.org JSON-LD:
    who Jules is, and what each page lists)
  - the text of what the scripts draw, between <!-- seo:body --> markers, in a .seo-text block
    that is out of sight (site.css): the projects, the books and the Timeline's cards. Most AI
    crawlers read the HTML without running its scripts, so without this they saw an empty list.
  - site/sitemap.xml and site/llms.txt (a plain summary for AI tools); site/robots.txt is
    written by hand.

Nothing here changes how a page looks. Reads CARDS by running node on tlcards.js's array.
"""
import html
import json
import pathlib
import re
import subprocess
import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent / "site"
URL = "https://www.julesbockelee.com"
SHARE = f"{URL}/public/img/share.jpg"
LINKEDIN = "https://www.linkedin.com/in/julesbockelee/"
X = "https://x.com/julesbockelee"

DESCRIPTION = ("Jules Bockelee Morvan is a product and brand strategist in Paris and New York, working "
               "between the brand, the product and the people who build it, across hospitality, tech "
               "and consumer brands.")

PAGES = {
    "index.html": dict(path="/", title="Jules Bockelee Morvan · Product & Brand Strategist",
                       description=DESCRIPTION, kind="ProfilePage"),
    "timeline.html": dict(path="/timeline", title="Timeline · Jules Bockelee Morvan",
                          description="Jules Bockelee Morvan's experience, education, certificates, "
                          "skills and languages: 44LLC, NYC Innovation Collective, Vybe Together, Juice "
                          "House, Parsons School of Design and more.", kind="ProfilePage"),
    "projects.html": dict(path="/projects", title="Projects · Jules Bockelee Morvan",
                          description="Selected product, brand and strategy work by Jules Bockelee "
                          "Morvan, 2022-2026: positioning, UX/UI, product design and data.",
                          kind="CollectionPage"),
    "bookshelf.html": dict(path="/bookshelf", title="Bookshelf · Jules Bockelee Morvan",
                           description="The books Jules Bockelee Morvan has read and is reading, "
                           "with the rating Jules gave each.", kind="CollectionPage"),
}

PERSON = {
    "@type": "Person",
    "@id": f"{URL}/#jules",
    "name": "Jules Bockelee Morvan",
    "alternateName": ["Jules Bockelee", "Jules B. M."],
    "givenName": "Jules",
    "familyName": "Bockelee Morvan",
    "jobTitle": "Product & Brand Strategist",
    "description": DESCRIPTION,
    "url": f"{URL}/",
    "image": f"{URL}/public/img/timeline/portrait.jpg",
    "email": "mailto:hello@julesbockelee.com",
    "sameAs": [LINKEDIN, X],
    "homeLocation": [{"@type": "Place", "name": "Paris, France"},
                     {"@type": "Place", "name": "New York, NY, United States"}],
    "alumniOf": [
        {"@type": "CollegeOrUniversity", "name": "Parsons School of Design",
         "url": "https://www.newschool.edu/parsons/"},
        {"@type": "School", "name": "International School of Paris", "url": "https://www.isparis.edu/"},
    ],
    "hasCredential": [
        {"@type": "EducationalOccupationalCredential", "credentialCategory": "degree",
         "name": "BBA, Strategic Design & Management",
         "recognizedBy": {"@type": "CollegeOrUniversity", "name": "Parsons School of Design"}},
        {"@type": "EducationalOccupationalCredential", "credentialCategory": "certificate",
         "name": "Associate Data Analyst", "recognizedBy": {"@type": "Organization", "name": "DataCamp"}},
        {"@type": "EducationalOccupationalCredential", "credentialCategory": "certificate",
         "name": "Data Analytics Professional Certificate",
         "recognizedBy": {"@type": "Organization", "name": "Google"}},
        {"@type": "EducationalOccupationalCredential", "credentialCategory": "certificate",
         "name": "Entrepreneurship 101-103", "recognizedBy": {"@type": "Organization", "name": "MITx"}},
    ],
    "knowsLanguage": [{"@type": "Language", "name": n, "alternateName": c}
                      for n, c in [("English", "en"), ("French", "fr"), ("Spanish", "es")]],
    "knowsAbout": ["Brand strategy", "Product strategy", "Positioning", "Go-to-market",
                   "Product management", "UX/UI design", "Product design", "Data analysis",
                   "Hospitality"],
}

WEBSITE = {"@type": "WebSite", "@id": f"{URL}/#site", "url": f"{URL}/", "name": "Jules Bockelee Morvan",
           "inLanguage": "en", "publisher": {"@id": PERSON["@id"]}}

DISCIPLINE = {"product design": "Product Design", "ux/ui": "UX/UI", "strategy": "Strategy",
              "data & analysis": "Data & Analysis", "graphic design": "Graphic Design",
              "3d & motion": "3D & Motion"}

e = lambda s: html.escape(str(s or ""), quote=True)
strip = lambda s: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s or ""))).strip()


def load():
    projects = json.loads((ROOT / "public/projects/projects.json").read_text())["projects"]
    books = json.loads((ROOT / "public/books/books.json").read_text())["books"]
    src = (ROOT / "src/tlcards.js").read_text()
    lit = re.search(r"const CARDS = (\[.*?\n\]);", src, re.S).group(1)
    cards = json.loads(subprocess.check_output(["node", "-e", f"process.stdout.write(JSON.stringify({lit}))"]))
    return projects, books, cards


def tags(p):
    return [t for t in (DISCIPLINE.get((p.get("discipline") or "").lower(), p.get("discipline")),
                        p.get("context")) if t]


def abs_url(src):
    return f"{URL}/{src}"


def ld(page, cfg, projects, books):
    url = URL + cfg["path"]
    node = {"@type": cfg["kind"], "@id": url, "url": url, "name": cfg["title"],
            "description": cfg["description"], "inLanguage": "en", "isPartOf": {"@id": WEBSITE["@id"]},
            "primaryImageOfPage": SHARE}
    if cfg["kind"] == "ProfilePage":
        node["mainEntity"] = {"@id": PERSON["@id"]}
    else:
        node["about"] = {"@id": PERSON["@id"]}
    if page == "projects.html":
        node["mainEntity"] = {"@type": "ItemList", "numberOfItems": len(projects), "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "item": {k: v for k, v in {
                "@type": "CreativeWork", "name": p["title"], "headline": p.get("headline"),
                "description": p.get("description"), "genre": tags(p)[0] if tags(p) else None,
                "temporalCoverage": p.get("year"), "creator": {"@id": PERSON["@id"]},
                "image": abs_url(p["prints"][0]["src"]) if p.get("prints") else None,
            }.items() if v}} for i, p in enumerate(projects)]}
    if page == "bookshelf.html":
        node["mainEntity"] = {"@type": "ItemList", "numberOfItems": len(books), "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "item": {k: v for k, v in {
                "@type": "Book", "name": b["title"], "alternativeHeadline": b.get("subtitle"),
                "author": {"@type": "Person", "name": b["author"]} if b.get("author") else None,
                "isbn": b.get("isbn"), "numberOfPages": b.get("pages"), "image": abs_url(b["cover"]),
            }.items() if v}} for i, b in enumerate(books)]}
    graph = {"@context": "https://schema.org", "@graph": [PERSON, WEBSITE, node]}
    # </script> can never appear inside; keep it on a few lines
    return json.dumps(graph, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def head(page, cfg, projects, books):
    url = URL + cfg["path"]
    t, d = e(cfg["title"]), e(cfg["description"])
    return "\n".join([
        f"<title>{t}</title>",
        f'<meta name="description" content="{d}">',
        '<meta name="author" content="Jules Bockelee Morvan">',
        f'<link rel="canonical" href="{url}">',
        '<meta property="og:type" content="{}">'.format("profile" if cfg["kind"] == "ProfilePage" else "website"),
        '<meta property="og:site_name" content="Jules Bockelee Morvan">',
        f'<meta property="og:title" content="{t}">',
        f'<meta property="og:description" content="{d}">',
        f'<meta property="og:url" content="{url}">',
        f'<meta property="og:image" content="{SHARE}">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta property="og:image:alt" content="Jules Bockelee Morvan, product and brand strategist, '
        'over a halftone drawing of the calanques at Cassis">',
        '<meta property="og:locale" content="en_US">',
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:site" content="@julesbockelee">',
        '<meta name="twitter:creator" content="@julesbockelee">',
        f'<script type="application/ld+json">{ld(page, cfg, projects, books)}</script>',
    ])


def body_projects(projects):
    items = []
    for p in projects:
        meta = " · ".join(tags(p) + ([p["year"]] if p.get("year") else []))
        items.append(
            f'<article><h3>{e(p["title"])}{": " + e(p["headline"]) if p.get("headline") else ""}</h3>'
            f'<p>{e(meta)}</p><p>{e(p.get("description"))}</p>'
            + (f'<p>Contribution: {e(p.get("contribution"))}</p>' if p.get("contribution") else "")
            + "</article>")
    return ('<div class="seo-text" id="pjText"><h2>All projects</h2>\n    '
            + "\n    ".join(items) + "\n  </div>")


def book_line(b):
    bits = [f'<cite>{e(b["title"])}</cite>' + (f': {e(b["subtitle"])}' if b.get("subtitle") else "")]
    if b.get("author"):
        bits.append(f'by {e(b["author"])}')
    if b.get("status") == "reading":
        bits.append("reading now")
    else:
        if b.get("read"):
            bits.append(f'read {e(b["read"])}')
        if b.get("rating"):
            bits.append(f'rated {b["rating"]} out of 5')
    if b.get("pages"):
        bits.append(f'{b["pages"]} pages')
    return ", ".join(bits) + (f'. {e(b["blurb"])}' if b.get("blurb") else "")


def body_books(books):
    reading = [b for b in books if b.get("status") == "reading"]
    read = [b for b in books if b.get("status") != "reading"]
    li = lambda bs: "".join(f"<li>{book_line(b)}</li>" for b in bs)
    return (f'<div class="seo-text" id="bkText"><h2>Reading now</h2><ul>{li(reading)}</ul>'
            f'<h2>Read</h2><ul>{li(read)}</ul></div>')


def card_html(c):
    out = [f'<h3>{e(c["title"])}</h3><p>{e(c["meta"])}</p>']
    for row in c["body"]:
        kind = row[0]
        if kind in ("h", "p"):
            out.append(f"<p>{e(row[1])}</p>")
        else:   # a certificate: its name may carry a link, which is kept
            _, name, issuer, year, desc = row
            out.append(f"<p>{name}, {e(issuer)}, {e(year)}. {e(desc)}</p>")
    return "<article>" + "".join(out) + "</article>"


def body_timeline(cards):
    return ('<div class="seo-text" id="tlText"><h2>In detail</h2>\n    '
            + "\n    ".join(card_html(c) for c in cards) + "\n  </div>")


def splice(text, name, inner, indent=""):
    pat = re.compile(rf"(<!-- seo:{name} [^>]*-->\n)(.*?)({indent}<!-- /seo:{name} -->)", re.S)
    assert pat.search(text), name
    return pat.sub(lambda m: m.group(1) + (indent + inner + "\n" if inner else "") + m.group(3), text, count=1)


def lastmod(f):
    rel = f.relative_to(ROOT.parent)
    dirty = subprocess.run(["git", "status", "--porcelain", "--", str(rel)], cwd=ROOT.parent,
                           capture_output=True, text=True).stdout.strip()
    if not dirty:
        d = subprocess.run(["git", "log", "-1", "--format=%cs", "--", str(rel)], cwd=ROOT.parent,
                           capture_output=True, text=True).stdout.strip()
        if d:
            return d
    return datetime.date.today().isoformat()


def llms(projects, books, cards):
    first = lambda s: re.split(r"(?<=\.)\s", s or "", maxsplit=1)[0]
    lines = [
        "# Jules Bockelee Morvan",
        "",
        f"> {DESCRIPTION}",
        "",
        "Jules has seen good ideas get lost in the handover more often than anywhere else: between the "
        "promise and the budget, the brand and the product, the pitch and the people who build it. "
        "That is where Jules works. Most recently a strategist, then product manager and strategy "
        "consultant at 44LLC, a New York strategy and design studio working with hotel groups; "
        "co-founder and creative director of Vybe Together, a social events app. BBA in Strategic "
        "Design & Management from Parsons School of Design. English and French, bilingual; Spanish, "
        "professional.",
        "",
        "## Pages",
        "",
        f"- [Home]({URL}/): who Jules is, in a few lines",
        f"- [Timeline]({URL}/timeline): experience, education, certificates, skills, languages, volunteering",
        f"- [Projects]({URL}/projects): {len(projects)} selected projects in strategy, UX/UI, product and graphic design",
        f"- [Bookshelf]({URL}/bookshelf): the books Jules has read and is reading",
        f"- [Everything in full]({URL}/llms-full.txt): every project, Timeline entry and book as plain text",
        "",
        "## Timeline",
        "",
    ]
    for c in cards:
        lines.append(f"- {strip(c['title'])}: {strip(c['meta'])}")
    lines += ["", "## Selected projects", ""]
    for p in projects:
        lead = p.get("headline") or first(p.get("description"))
        lines.append(f"- {p['title']}" + (f" ({p['year']})" if p.get("year") else "") + f": {lead}")
    lines += ["", "## Contact", "",
              "- Email: hello@julesbockelee.com",
              f"- LinkedIn: {LINKEDIN}",
              f"- X: {X}", ""]
    short = "\n".join(lines)

    full = [f"# Jules Bockelee Morvan, in full", "", f"> {DESCRIPTION}", "",
            f"Source: {URL}/ . The same text is on the site; this is it without the drawing.", "",
            "## Timeline", ""]
    for c in cards:
        full += [f"### {strip(c['title'])}", "", strip(c["meta"]), ""]
        for row in c["body"]:
            if row[0] == "h":
                full += [f"**{strip(row[1])}**", ""]
            elif row[0] == "p":
                full += [strip(row[1]), ""]
            else:
                full += [f"- {strip(row[1])}, {row[2]}, {row[3]}: {row[4]}", ""]
    tl = (ROOT / "timeline.html").read_text()
    kv = re.findall(r"<dt>(.*?)</dt><dd>(.*?)</dd>", tl)
    if kv:
        full += ["### Skills & tools", ""] + [f"- {strip(k)}: {strip(v)}" for k, v in kv] + [""]
    full += ["### Languages", "", "- English: bilingual", "- French: mother tongue",
             "- Spanish: professional proficiency", "- Hebrew: beginner, learning", "",
             "## Projects", ""]
    for p in projects:
        full += [f"### {p['title']}" + (f": {p['headline']}" if p.get("headline") else ""), "",
                 " · ".join(tags(p) + ([p["year"]] if p.get("year") else [])), "",
                 p.get("description") or "", ""]
        if p.get("contribution"):
            full += [f"Contribution: {p['contribution']}", ""]
    full += ["## Bookshelf", ""] + [f"- {strip(book_line(b))}" for b in books] + [""]
    return short, "\n".join(full)


def main():
    projects, books, cards = load()
    bodies = {"projects.html": body_projects(projects), "bookshelf.html": body_books(books),
              "timeline.html": body_timeline(cards)}
    for page, cfg in PAGES.items():
        f = ROOT / page
        s = f.read_text()
        s = splice(s, "head", head(page, cfg, projects, books))
        if page in bodies:
            s = splice(s, "body", bodies[page], indent="  ")
        f.write_text(s)

    urls = "".join(
        f"  <url><loc>{URL}{cfg['path']}</loc><lastmod>{lastmod(ROOT / page)}</lastmod></url>\n"
        for page, cfg in PAGES.items())
    (ROOT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "</urlset>\n")
    short, full = llms(projects, books, cards)
    (ROOT / "llms.txt").write_text(short)
    (ROOT / "llms-full.txt").write_text(full)
    print(f"{len(projects)} projects, {len(books)} books, {len(cards)} cards; heads, sitemap, llms written")


if __name__ == "__main__":
    main()
