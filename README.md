# julesbockelee.com

The personal site of Jules Bockelee Morvan, product and brand strategist in Paris and New York.

Live at [julesbockelee.com](https://www.julesbockelee.com).

## The pages

- **Home**: three places (Cassis, Paris, New York) drawn as one halftone screen that morphs between them with the cursor, the scroll or a tap. A crow made of the same dots lands on the name, a pull chain switches light and dark, and an hourglass plays while the page loads.
- **Timeline**: experience, education, certificates, skills, languages and volunteering. Each entry opens a detail card.
- **Projects**: selected work, each card laid out from its own pictures, which open in halftone and turn to colour.
- **Bookshelf**: the books I have read and am reading, as 3D books on a shelf.

Every page but the home page shares a page bar and a footer. The email links send a paper plane across the screen before the mail opens.

## How it is built

Plain HTML, CSS and JavaScript modules. There is no framework, no build step and no dependencies to install.

The halftone, the crow, the chain, the hourglass and the paper plane are drawn with WebGL2 shaders written for this site. The 3D models are baked into small point clouds by the scripts in `tools/`, so nothing loads a 3D library at runtime. Each page asks for its scripts and its first images and models up front, in parallel, and the fonts and project images are cached by the browser for a year.

```
site/               the site, and only what is served
  index.html        home
  timeline.html     Timeline
  projects.html     Projects
  bookshelf.html    Bookshelf
  src/              the scripts and the shared stylesheet
  public/           fonts, images, baked models, project prints, book covers
tools/              bake scripts, build scripts and the local dev server
design/             reference art, wireframes, original photos and the logo source
archive/            the first prototype
vercel.json         hosting: what is served, clean URLs, caching
CLAUDE.md           detailed technical notes
```

The Projects page reads `site/public/projects/projects.json`, which is exported from a separate project database and is not edited by hand here.

The detailed notes (how the renderer works, measured layout values, every design decision and why) are in `CLAUDE.md`.

## Run it locally

```
python3 tools/devserver.py 8765
```

Then open http://localhost:8765. Any static server pointed at `site/` works (`npx serve site`), but this one also serves the clean URLs (`/timeline`, `/projects`) the way Vercel does.

Useful flags: `?noloader` skips the hourglass, `?debug` shows what a phone reports, `?grab` exposes the drawing for inspection.

## Deploy

Vercel deploys `main` automatically on every push. Commits need to be authored with the email on the Vercel account, or the deploy is skipped.
