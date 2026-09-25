# Halftone morph hero

Scroll and cursor driven halftone landscape for Jules Bockelee Morvan's personal site.
Three places (Cassis, Paris, New York) share one fixed dot lattice. Each dot resizes and
changes opacity to the ink coverage of whichever photograph is currently dominant, so the
image transitions without the dots ever moving.

This folder is a working prototype extracted from a browser artifact. It is framework
agnostic on purpose. The target stack is Astro, GitHub Desktop, Vercel.

## Run it

Any static server from this folder. Paths are relative, but `index.html` still needs to be
served rather than opened from the filesystem (the renderer is a module).

```
npx serve .          # or: python3 -m http.server
```

## Files

```
index.html            the home page: markup and its CSS, plus the tuning panel
timeline.html         the Timeline page: static, plus the live crow (src/crowstage.js)
src/site.css          shared by every page: fonts, colour tokens in both themes, the page,
                      the logo, the theme cross-fade
src/halftone.js       the whole renderer: WebGL2 setup, shader, scroll and cursor wiring
src/crow.js           the crow: loads the baked cloud, skins it, runs the state machine
src/crowui.js         around the crow, on every page: his card, its leader, the hit area,
                      the red dot pointer
src/crowstage.js      the crow alone on a transparent canvas, for pages without the landscape
src/loader.js         the loading screen: hourglass and the dot build into the page
src/chain.js          the pull chain that switches light and dark
public/models/        crow-cloud.bin, crow-anim.bin, crow.json (baked from the glTF),
                      plus the model licence. The .glb/.gltf itself is not committed.
public/img/*.jpg      descreened reference art (tools/build_sources.py), 2048 wide
public/img/*-depth.jpg  depth maps (tools/build_depth.py), white near, black far
public/img/photo/     the original photographs, no longer used
tools/                build_sources.py (descreen refs), build_depth.py (depth maps),
                      build_single.py (one-file HTML), bake_crow.py (glTF to point
                      cloud), crow-preview.html (crow poses)
public/img/dot-lut.png  256 entry lookup: dot radius as a function of ink coverage
public/img/favicon.svg  the logo mark (Jules's Vector.svg): ink on a light tab, #ECECEC on a
                      dark one, by prefers-color-scheme inside the SVG. favicon-32.png and
                      apple-touch-icon.png (on the paper, 180px) for Safari and the home screen;
                      favicon.ico (16+32) at the root. Rendered from the same path.
public/img/timeline/  the Timeline page's assets, from Figma (rule, rings, connectors,
                      certificate dashes, back link icon and underline)
```

## How the renderer works

One fullscreen triangle, one fragment shader, no geometry per dot. Everything happens
per pixel.

1. **Lattice.** `cid = floor(px / cell)` where `cell = bandWidth / dotsAcross`. The grid is
   orthogonal at 0 degrees with round dots, matching the reference halftones. The lattice is
   anchored to the band, not to the image, which is what makes the morph work.

2. **Tone pipeline, per cell, in the shader.** The photographs are sampled as colour and
   converted live, so every tone control is a uniform rather than a baked asset:
   - greyscale weights, lerped between Rec.709 luma and a blue-heavy mix (`blue filter`)
   - local contrast: `d + amount * (d - blurred)`, where the blur is the same texture at
     `lod + 1.32`, roughly 2.5 cells. This is not optional. Without it the Cassis water
     collapses into a dead mass, because the screen eats exactly the frequencies that make
     water read as water.
   - levels and gamma: `pow(clamp((d - black) / (white - black)), gamma)`
   - a 1.2% toe, so skies land at exactly zero coverage and draw nothing

3. **Mipmapped sampling.** `lod = log2(cell * textureWidth / drawnWidth)` gives each dot a
   proper area average of the photograph at any pitch. This is why `dotsAcross` can run
   90 to 560 without aliasing.

4. **Radius from coverage.** For a square lattice of circles, coverage is `pi * rho^2` up to
   `rho = 0.5` (78.5% coverage, circles touching), then bends through an overlap branch and
   saturates at `rho = 0.7071`. That curve has no clean closed form, so it lives in
   `dot-lut.png`. Do not replace it with `sqrt(coverage)`: the shadows then never merge into
   solid black with white pinholes, which is most of what makes it read as printed.

5. **Per dot stagger.** A hash of the cell id delays each dot's transition, so the change
   sweeps through the field instead of cross fading. Stagger 0 is a plain dissolve.

6. **Opacity depth.** `alpha *= mix(1.0, 0.18 + 0.82 * coverage, depth)`. Light dots recede.
   Above about 0.7 this stops being a halftone and starts being a greyscale image with dots
   on it, because a partly transparent dot is arithmetically a lighter ink.

7. **Text keep-out.** Distance from each cell centre to the copy block's live bounding box.
   Dots inside the padding are dropped whole, never clipped mid dot, with a fade band
   outside. Open question below.

8. **Ink opacity.** A global alpha multiplier, 0.70 by default, so the field sits lighter
   than the reference art.

9. **Hue.** Each place has an ink (Cassis marine pine, Paris warm sepia, New York cool
   graphite). Light dots carry the full hue, heavy dots pull to neutral, mimicking ink
   density. Inverts in dark mode.

## Sources: reference art, not photographs

The tone sources are the halftone reference images in `../refs/`, not the photographs.
No tone curve on a photo reproduces them (Cassis pines are bright in the photo, black in
the art). `tools/build_sources.py` notches the art's own screen out of the spectrum
(it sits at ~17.5px pitch, 233 dots across, the same for all three) and keeps sub-dot
detail. The renderer re-screens it on our lattice at 233 dots across.

- **Detail** pulls each pixel's tone from under that pixel instead of the cell centre,
  sampled about a quarter cell wide, so edges cut through dots as in the art.
- **Softness** (per place) blends in continuous tone. The art is 28 to 47% mid-grey
  pixels; Paris is the most photographic.
- Tone is neutral: black 0.075 is the `#ECECEC` paper the art was exported on.

## Depth (prototype, branch `depth-prototype`)

The dots never move, but what each dot samples does. `tools/build_depth.py` runs
Depth Anything V2 Small (~100MB, HF `depth-anything/Depth-Anything-V2-Small-hf`, MPS on
this Mac) over each source and writes a pixel aligned depth map, normalised per image on
its 1st/99th percentiles: white near, black far. The maps are committed, so the site never
touches torch; rerun the script only when a source image changes.

Why this model and not the others considered: diffusion-point-cloud generates 3D shapes
rather than reading depth from a photograph, and Depth Anything 3 is built around
multi-view geometry, which is a heavier setup for one still image per place.

Three uses of depth, all per pixel in the fragment shader:

1. **Parallax.** The viewpoint leans toward the cursor (`uSway`, damped, -1..1 on each
   axis). Each pixel's sample point moves by `sway * parallax * (depth - 0.5)`, converted
   from pixels to uv per source. Two refinement steps against the depth map, so a near
   edge can cover what sits behind it rather than smearing through it. The lattice stays
   fixed in screen space, which is what keeps the halftone reading as print rather than as
   a texture wrapped on geometry.
2. **Aerial fade.** `coverage *= mix(1, 0.45 + 0.55 * depth, fog)`. Distance thins the ink.
3. **Relief.** `radius *= mix(1, 0.72 + 0.56 * depth, relief)`. Near dots grow, far ones
   shrink, so the screen itself has some depth even when the cursor is still.

Depth is read at `lod + 2`, deliberately blurrier than the art, so dot-scale noise in the
map cannot jitter the sampling. Panel: "Show depth map" draws depth in place of the art.

Open questions: parallax past about 40px starts to smear the edges of buildings, because a
single depth map cannot show what is hidden behind them. Relief above ~0.6 changes the
tone balance, since dot size is carrying two signals at once.

**Tilt, on phones and tablets.** With no cursor to lean toward, the device's own tilt
drives the same `sway` (`onTilt` / `tiltLean` in `src/halftone.js`). The lean is measured
from a baseline that follows the hand with a 3.5s time constant (`TILT_SETTLE`), so a turn of
the wrist moves the picture, holding still lets it settle, and the resting angle can be
anything. 22 degrees from rest is a full lean (`TILT_RANGE`; 16 was a touch strong). Axes are remapped for landscape.
The sign follows the cursor's convention, eye position: tipping the right edge away looks
from the left. If it feels backwards on a phone, flip the minus in `tiltLean`.
iOS only sends orientation after the visitor allows it, and only asks from inside a gesture
it trusts. So there are three ways in: a quiet `requestPermission()` on load, which resolves
at once if it was already allowed; the loading screen's **"Enable tilt" button** (`enableTilt()`
in `src/halftone.js`, called from the tap); and any other tap on the page also asks, until
iOS answers yes or no. A refusal for want of a gesture throws,
and is not an answer, so asking continues. The first version asked once, on the first tap
anywhere, and gave up if iOS did not count that tap: tilt silently never started.
Android needs no permission. Reduce Motion turns tilt off along with the parallax, on purpose.
No library: `deviceorientation` plus `DeviceOrientationEvent.requestPermission` is all of it.
Testing: the preview pane denies the permission, so `?tilt` skips the prompt, or replace
`DeviceOrientationEvent.requestPermission` with one resolving `"granted"` after load and tap
the button (it is looked up at call time). Orientation is faked by dispatching
`new DeviceOrientationEvent("deviceorientation", {beta, gamma})`.

**`?debug`** overlays what the device reports, refreshed five times a second: inner, visual
viewport and client heights, svh/lvh/dvh, the canvas and picture size, the copy's position,
the tilt state and raw angles, the sway, and reduce motion / pointer / touch points. It exists
for phones, where the only way to see these is a screenshot from the visitor.

## The Timeline page

`timeline.html`, served at `/timeline` (Vercel `cleanUrls`; `tools/devserver.py` does the
same locally). Built from Figma: V4.0 / **Timeline WIP** (node 1700:2). The home page's
"Timeline" nav link points to it; the logo and "← Back ⌂" link home. It scrolls.

- **One scale factor.** The frame was scaled up 1.2665x in Figma, uniformly (the column went
  from 537 to 680px, the title from 24 to 30.4px). Every size on the page is the first cut's
  value times `--k`: 1.26648 on a computer, 1 on phones, where the larger type did not fit
  the rail and date column. The column sits 164px down, as in the frame.
- **Layout in flow, not at the frame's coordinates.** The header (Libre Caslon Condensed
  Medium title, the back link on the title's baseline, without an underline and with 4.5 x k
  between "Back" and the house, the rule), the intro, then the sections in a column 118 x k
  in and 355 x k wide. At 1440 the header and intro land on the frame's numbers; the sections
  sit ~17px higher, because the browser wraps the intro in 4 lines where Figma wraps it in 5.
- **The markers are per entry.** Each `.tl-item` draws its own hollow ring and a connector
  fading toward the text; in the Experience list (`.tl-rail`) each also draws the rail from
  under its ring, through the gap, to the next ring. The li reaches 62 x k left of the column
  (negative margin, equal padding) so the rail can be a background inside it: it stays joined
  however the text wraps, where the design's rail is one fixed dashed line.
- **The Figma vectors are masks** filled with colour tokens (`--strong`, `--body`, `--faint`,
  `--muted`, `--ink`), like the logo, so they turn with the dark theme instead of staying black.
- **The markers' spotlight** (a mouse only). An invisible soft circle, 70px (`--R`), follows the
  cursor and touches only the markers: the rail and connectors darken toward `--strong` per
  pixel, so only the stretch near the cursor changes, and each ring darkens and fills to a
  solid circle as the cursor nears it (`--hot`, 0..1, by distance to the ring's centre). A
  small script tells every entry where the cursor is relative to it (`--mx`, `--my`) on
  pointer move and on scroll; each marker's background is a radial gradient centred there,
  inside the Figma shape's mask, and the ring's mask gains a disc whose alpha is `--hot`.
- **The crow is the live bird** (`src/crowstage.js`, `dir: -1`): he flies in from the right,
  lands on the rule under the title (centred on it, feet on the line), and on a click leaves
  off the left edge, back ten seconds later. Hovering him opens his card, a tap does on a
  phone, exactly as on the home page (`src/crowui.js`). The stage's canvas is fixed and the
  perch is read every frame, so he rides the rule as the page scrolls. It replaced the
  design's static render of him, a 2.1MB mask for a 129px bird.
- **Where the design was inconsistent, one choice was made:** Satoshi throughout (the design
  sets the dates and the Education and Certificates titles in Inter, the rest in Satoshi;
  all three section titles are Satoshi Black here). Company names keep the design's casing
  (two are not in capitals) and the smaller role size on the later entries.
- **Phones**: `--k` 1, the column fills the width less 24px a side, the sections move to 62px
  in, and the certificate dashes are dropped (they only line up three across).
- **The loader plays once a visit** (`sessionStorage` "loaderSeen", set at the reveal), so
  coming back from the Timeline does not mean four more seconds of hourglass.

**The crow on other pages.** `src/crowstage.js` is the home page's two crow passes lifted
out: splat the posed cloud into an offscreen buffer with a depth test, then screen it on his
lattice (3x3 tap, dark edge, far side thinned, the shared dot curve), with the home page's
size and pitch from the same band, so it is the same bird. `createCrowStage({perchOn, perchAt,
dir})` perches him on the bottom edge of any element. `src/crow.js` takes `{dir}`: -1 mirrors
the flight paths across the window and the model in screen space after the pose, with the
light kept at the upper left, so he is lit the same way facing either way.
`src/crowui.js` is the card, the leader, the hit area and the red dot pointer, moved out of
`src/halftone.js` so every page with the bird shares them; it adds its own markup if a page
lacks it, and the page's renderer calls `update(canvasRect)` once a frame. Their CSS is in
`src/site.css`.

## The pull chain

`src/chain.js`. A small chain hangs just right of the place caption; pulling it down switches
light and dark, like a lamp cord. It has no canvas of its own: every frame it hands the renderer
shaded points, which are splatted into the crow's buffer and screened by the crow's pass, so the
chain is made of the bird's dots, on the bird's lattice, and takes the ink of the theme the same
way. An invisible button (`#chainPull`) follows the bead and takes the grab.

**Physics.** A verlet rope: 22 points, gravity, and distance constraints that only resist
stretching, so the chain can go slack and bunch the way a chain does. It hangs 64px (56 on
touch), shortened on a short screen so it always stops 30px above the copy. The mount sits
14px right of the caption, whose right edge is where it is pinned, so it does not move when
the place names change width (it first hung on the left, and slid with every change); if the
layout moves it, it glides there and the chain swings from the move rather than jumping.
The cursor brushing past it sets it swinging; on a phone the device tilt (`sway`) leans its
gravity. Reduce Motion damps it heavily.

**The pull.** Dragging the bead down feeds more chain out of the mount, up to `MAX_PULL`
(30px); past `PULL_AT` (19px) it clicks, vibrates on Android, and the theme flips, once per
pull. On release the extra chain springs back in with a little bounce. A plain tap on the
bead, or Enter / Space when it has focus, does a whole pull by itself. The button's label
says which way the next pull goes.

**Drawing, in dots: a ball chain.** Modelled on a lamp pull chain: beads 3.2px across on a
4.4px pitch, joined by a hairline wire, ending in a turned pull (neck, cone, flange ring, groove,
rounded body, nub; `profile()` gives its radius by height). The beads slide out of a small cup
at the mount as it is pulled. Every surface is sampled at a third of a pixel and each point
carries the crow's format (x, y, depth, ink), shaded with the crow's formula from its normal:
spheres for the beads, a surface of revolution for the pull (tipped up where it widens), and
the groove under the flange darkened.
**Its own lattice.** At the bird's ~2px pitch a 3px bead is one dot and cannot show depth, so
the chain is screened on a lattice of its own, `uCellChain` = max(1.05px, 2 device px). The
splat pass tags chain points in the buffer's blue channel (`uFlag`); the crow's screen ignores
tagged pixels and a second screen in the main shader draws them at the fine pitch, with a
light 5 tap average rather than the crow's 3x3 blur, so a bead is a few dots across: small
dots on its lit upper left, large on its shadow side. That is what shows it as round.
Earlier versions: solid lines on a 2D canvas, then interlocking links in the crow's dots,
which at the bird's pitch read as a thick dotted cord.

**The theme.** `setTheme()` in `src/halftone.js` sets or clears `data-theme="dark"` and
remembers the choice in `localStorage` ("theme"); a small script in `<head>` applies a saved
dark before the first paint, so there is no flash of light. The default is still light.
During the switch `html.theming` cross-fades colours for half a second; the halftone and the
crow follow by themselves, since the renderer reads the page's ink every frame.

## The loading screen

`src/loader.js`. A screen of the page's own paper colour with an hourglass drawn in the crow's dots, the sand running,
then a halftone sweep into the page. It has its own canvas and WebGL context, fixed over
everything (`#loader`, z-index 100), since it must cover the copy and logo too; once the sweep
is done it removes itself and loses its context. `?noloader` skips it.

**Model.** "Sands of Time" by Antonio Gloria, Sketchfab, CC-BY-4.0. The author waived the
credit to Jules directly (2026-09-24), so, as with the crow, there is none on the page;
`public/models/hourglass-license.txt` is kept as the record of where it came from.
`tools/bake_hourglass.py` reads the GLB (no loader library) into `hourglass.bin` (169KB) and
`hourglass.json` (the layout). The model is three rigid parts: frame and glass on one bone,
sand on another, whose shape is morph targets (the top drains, the stream falls, the pile
grows). Its 10s animation drains set A for 4s, flips in the 5th, then repeats with set B. The
halves look alike, so only 0-5s and set A are kept, and looped: flipped with B full on top at
5s is the same picture as upright with A full at 0s. The last frame is held, not lerped into
the first, or it would spin back.

**Runtime.** Frame and glass points are stored in bind space with a smoothed normal and baked
occlusion; sand points as a triangle plus barycentrics, so they ride the morph. Each frame:
morph the sand, recompute its vertex normals, apply the two bones' matrices (lerped between
the 30fps frames), turn it slowly about the vertical (`SPIN`) and look down a little (`PITCH`)
so it reads as 3D. The stream mesh is a smooth rod that reads as still, so ~90 loose grains
drop through it from the neck to the top of the pile.
Shading is the crow's: frame = key light + occlusion + rim (a little lighter than the crow,
so the sand reads against it); sand darker, with a per grain jitter. **Glass** is drawn last,
blended and without writing depth, with alpha from the rim only: the bulbs show as outlines
and the sand shows through them.
Screening is the crow's too: 3x3 tap, dark edge, far side thinned, the shared dot curve; the
cell is held at the crow's pitch, `clamp(height / 80, 1.8, 2.6)` px.
**Size**: on a computer 13% of the screen height, held between 96 and 130px (about 117 on a
laptop); on touch screens 20%, between 120 and 190px: bigger than the crow (46-74px)
but a small object on the page. The first version was 40% of the height, which was too much.

Paper and ink are read from the page's computed `body` colours, so the loader is the hero's
`#ECECEC` (it was white) and would follow a dark theme.

**Timing.** Desktop (fine pointer): the sweep starts 4s after the hourglass first draws, which
is exactly when the model's sand runs out. Touch: an "Enable tilt" button sits under the
hourglass; the tap calls `enableTilt()` (iOS shows its prompt) and the sweep starts once there is
an answer, allow or not; the hourglass keeps draining and flipping while it waits. Either way
the sweep also waits for the page's textures. The crow's arrival is restarted at the reveal
(`crow.replay()`), or he would already be perched behind the loader.

**The build.** Not a sweep: a first version climbed the page as a ragged front with a dark
band behind it, which read as a wipe. Now a lattice of fine cells (3.5px, 3 on phones; 7px read as coarse) covers
the loader, and each cell starts at its own moment within `SPREAD` (0.6s): 75% pure random,
25% low frequency noise, so there is a little clustering and no direction. In `CELL_DUR`
(0.32s) a cell flicks on a small dark dot (`uMid`, the reference's near black), which then
becomes the opening, a dot of the page that grows until it meets its neighbours. The dark dot
and the opening never share a cell: drawn together they made rings, and the screen read as a
scatter of little o's. The page is built out of scattered dots in about 0.9s. Reduced motion
gets a 0.4s fade instead.

Testing: the preview pane's emulated phone sizes offset where taps land, so press the button
with `document.getElementById("loaderTilt").click()`; stub
`DeviceOrientationEvent.requestPermission` to resolve `"granted"` to test the allow path.

## The crow (prototype)

A rigged model, baked to a point cloud, posed by our own state machine.

**Model.** "Crow" by Alexei Ostapenko, from Sketchfab, CC-BY-4.0. The author confirmed
to Jules directly that no visible credit is needed, so there is no credit line on the page;
`public/models/crow-license.txt` is kept as the record of where it came from. 2.2k
triangles, 92 bones, one 10.5s animation, `root|TakeOff`.

**Bake.** `tools/bake_crow.py` reads the glTF itself, with no loader library, and writes:

```
crow-cloud.bin   6000 points sampled over the surface by triangle area, in bind space,
                 each with a smoothed normal, baked ambient occlusion, and its four
                 bone indices and weights                             (140KB)
crow-anim.bin    per frame skinning matrices, 317 frames x 92 joints, 3x4 each,
                 int16 at 1e-4 of a body length                       (683KB)
crow.json        fps, the three segment ranges, and the credit line
```

It also normalises the model: +x forward, +y up, one unit from beak to tail tip, centred.
Which end is forward comes from the head joint, not from the longest axis, or the bird
flies backwards. Rerun it only if the model changes; the site never sees the glTF, and
there is no three.js. `BAKE` in `src/crow.js` is the file layout version and is used as a
cache buster: bump it whenever the bake's layout changes.

**The animation is one continuous take**, performed in place, which the bake splits by how
much the wings are moving:

| range | frames | what it is |
|---|---|---|
| idle | 0–196 | sitting, looking about, **pecking** |
| takeoff | 196–256 | the crouch, the leap, the first beats |
| flight | 256–296 | the wingbeat cycle, looped. The end is found by matching poses
  against the first frame: the take runs to 317, but the beat comes back round at 296, and
  looping on 317 snapped the bird mid air |

**We supply the performance**: where it is on the page, which way it faces, when it lands
and when it leaves. It waits 1.1s, flies in over 2.1s, perches on the name (feet on the top
of the type), plays the idle at 0.72 speed, and on a click leaves over 2.5s. The arrival
ends on `PERCH_YAW`, the same angle it perches at, or it turns with a jolt as it lands. Ten seconds
after it is gone it comes back and the whole thing runs again. `src/crow.js` skins the cloud on the CPU (6000 points x 4 bones, about
290k multiplies a frame), projects it, and hands the renderer screen space points. Phase
changes crossfade the pose over about a sixth of a second, so nothing pops.

**Drawing, and why the bird is shaded.** A flat silhouette screens into a solid mass of
identical dots. What makes the reference art read is that the dot sizes follow the form, so
the bird is lit and the screen turns that into a tonal range:

- the points carry **smoothed normals** (averaged over 18 neighbours at bake time, or the
  low poly model's facets come out as mottling) and **baked ambient occlusion** (how much
  of the neighbourhood sits in front of each point, so creases go dark)
- `src/crow.js` turns those into ink per point: a key light from the upper left front, the
  occlusion, and the turn of the form away from the viewer
- the crow pass writes that ink premultiplied into an offscreen buffer **with a depth test**,
  so only the near surface is screened, not the far side of the body
- the halftone pass averages a 3x3 tap at one cell spacing, adds a dark edge where the
  buffer's coverage falls off, and thins the ink on the bird's own far side (its depth, the
  same idea as the landscape's aerial fade)

**The crow has its own lattice**, 445 dots across the band against the picture's 311. It is
small on the page, so at the picture's pitch there were only about 13 dots across it, too
few to show any form; at 445 there are about 19. The two screens are computed separately,
each with its own cell, radius from the same ink curve, and relief, and composited by
taking whichever dot is more opaque. Since the bird is drawn on a different grid it no
longer has to share phase with the landscape, which is what lets its pitch differ at all.

Splat size follows the bird's size on screen, which keeps its coverage solid at any scale.
It is perched three quarters on (yaw -0.62): side on, the tail fans across the view axis
and collapses to a line.

The canvas spans the whole window rather than just the band, so the crow can fly the full
width; the picture still occupies the centred band, which `bandW()` derives from
`--band-k`, and the dot pitch is still band width over dots across.

**Frame grabs.** `tools/devserver.py` serves the folder and accepts `POST /_grab?name`
with a data URL, writing `tools/grabs/<name>.png`. With `?grab` in the page URL the drawing
buffer is preserved so a frame can be read back. This is the only reliable way to judge the
screen: a screenshot of the preview pane is downsampled, which destroys the dots.

Open items: the takeoff animation ends the moment the bird leaves, so a long flight loops
the wingbeat with no glide. There is no landing in the take, so the fly in uses the flight
loop and our own descent, which reads as a fast approach rather than a flare. The idle
alternates standing and pecking, and the pecking frames are hunched, so the bird spends a
fair amount of its time low; a tighter idle range would keep it upright if that reads
better on the page.

## The crow card

Hovering the perched bird opens a card naming him (Figma: `Hero - With box`, node 1601:437).
It is a plain DOM card, not part of the screen: 280px wide on the paper colour with a
`#D9D4D4` hairline, and a leader line drawn as an SVG polyline — a dashed hop off his
shoulder, a 45 degree run up, then a short horizontal into the card's left edge. Both follow
his live bounding box, so they track him rather than sitting at fixed coordinates.

**By touch, the first tap opens the card and the second sends him off**, since there is no
hover to open it with; a tap anywhere else closes it. With a mouse, hover opens it and one
click sends him off.

**It only answers while he is still.** `crowHit` is hidden unless the phase is `perched` and
more than `SETTLE` (1s) has passed since he landed, so the hover is dead through the whole
arrival, for a second after touchdown, and from the instant he is clicked. Clicking hides
the card and sends him off in the same gesture.

Fonts: Satoshi for the page and Libre Caslon Condensed are self hosted from `public/fonts`
(one 42KB variable file covers every Satoshi weight; Caslon in three cuts: SemiBold for the
card's word, Medium for the name on the home page and the Timeline title, Regular unused
for now), with their licences beside them. The name "Jules Bockelee Morvan" is Caslon Medium
at 1.15em (16.1px), a step above the links so it reads as the heading: at 0.96em its capitals
would stand exactly as tall as Satoshi Bold's beside it (0.762 em against 0.731, measured in
the browser), which read as too small. The nav is aligned on its baseline. It is 143px wide,
where Satoshi at 14px was 150; the crow perches on it all the same. Only Inconsolata, for the
pronunciation line, still comes from Google.

**His size is held between a floor and a ceiling.** It follows the band, which runs away on
a large monitor and collapses on a phone, so it is clamped: `clamp(46px, band × 0.064, 74px)`.
A laptop is unchanged at about 63px; a 2560 wide screen stops at 74 instead of 88; a 390px
phone gets 46 instead of 25, which is proportionally much larger, as it has to be.

**The card takes the theme.** Its hairline and shadow are tokens (`--card-line`,
`--card-shadow`) and its type uses `--ink` and `--muted`, so the dark scheme inverts with
everything else instead of leaving black text on a dark card.

**The leader adapts.** The card is placed first, clamped to the window, and the line is then
built from wherever it landed: off his right shoulder as in the design, off his left when
there is no room that side, or straight up (or down) when the card ends up over him, which
is what a phone gets. The rise shortens to whatever fits and the dashes shorten with it. If
the line cannot be drawn without crossing him, it is dropped rather than drawn through him.

**The pointer is a 7px dot in `#F13A0D`,** with the native cursor hidden. It is an element
rather than a cursor image, so it stays crisp on a retina screen, and it is moved inside the
pointer handler rather than the frame loop, so it does not trail the hand. Over the bird it hollows into a
ring of the same size rather than growing — without a pointer that is the only thing left to
say "this is clickable" — and it grows to 11px while the button is down. Coarse pointers keep the normal cursor.

## Layout, all measured from the mockups, not chosen

Reference frame is 1440 x 1024.

| | value |
|---|---|
| Band | on a desktop, centred, width `min(0.96 × viewport height, viewport width)`: height-driven, so the picture keeps the same vertical composition at any window shape (was 14.31% to 85.26% of width), and never wider than the screen, so the landscape is never cropped. **Below 820px the picture is 94% of the screen width** (capped at 32% of the visible height, for the tallest place), sits 18px off the bottom, and the copy is placed above it by `layoutPhone()`. See below |
| Text column | centred on the window, 420px wide, 14 / 21px. On a tablet (`navigator.maxTouchPoints > 1`, or `?tablet`) `layoutTablet()` lifts it so the tallest place reaches at most 45% of the way up the copy (`TABLET_REACH`): a landscape iPad went from Paris covering 244px of the copy to 141, and moved the copy up 82px. Portrait iPads never overlap that much and are unchanged; so are laptops. The narrow breakpoint pins it left and must clear the centring transform, or the block slides off screen |
| Logo | `public/img/logo.svg` (from `public/img/Logo 1 B/Vector.svg`), 27px at 4.86% / 5.18vh. Drawn as a CSS mask filled with `--ink`, so one file serves light and dark; the source art is off-white, which would be invisible on paper if used as an image |
| Page | `#ECECEC` paper, near `#0A0A0A` ink. The site is light whatever the browser prefers: `prefers-color-scheme` is deliberately not followed; dark only happens with `data-theme="dark"`, which the pull chain sets and remembers |
| Cassis | aspect 2.530 (reference art), bottom on the fold |
| Paris | aspect 1.830 (reference art), bottom on the fold |
| New York | aspect 2.292 (reference art), bottom on the fold |

Every image is drawn at the full band width, so the width is identical across all three.
Only the vertical offset differs. The crops were recovered by correlating each master
photograph against the mockup exports; see the numbers in `PLACES`.

## The tuning panel

`index.html` contains a control panel that writes straight into the renderer's uniforms.
It is a development tool. **Strip it before shipping**, along with the `.panel` CSS and the
control wiring in `halftone.js`, and replace the slider reads with a plain config object.
Copy config emits that object as JSON.

## Open items

1. **The keep-out is a rectangle** and shows as a rectangular void where the field behind
   the text is dense. Two candidate fixes: mask per line of text rather than per block, or
   fade dots by opacity near the text instead of removing them so the field stays continuous.
   The second is probably the right one.
2. ~~Cursor drive on one continuous distance axis~~ Resolved: cursor mode now uses nested
   zones around the copy (outside = Cassis, middle ring = Paris, tight ring = New York,
   rounded like a distance field). Zone sizes are a share of the band width (5.3% and 10.5%, so 70px and 140px at a 1330px band) and scale with the picture; hysteresis is 0.9%. Entering a zone starts a fixed-length
   morph (1.6s per step, eased), and Cassis to New York passes through Paris. Scroll mode is
   still continuous. The "Zones" panel button draws the rings.
3. **Mobile.** 311 dots across a 390px viewport is a 1.25px cell. Needs a breakpoint dropping
   to roughly 110 to 130, which is a visibly coarser artwork. Decide whether that is
   acceptable before shipping.
4. **Paris resolution.** Its crop is 778px wide out of a 2046px panorama. Fine at 311 dots,
   soft past about 400 while the other two stay sharp. Re-crop wider or source a better frame.
5. **Local contrast halos.** Above roughly 2.5 expect visible halos along hard edges, most
   obviously the New York skyline against sky. The fix is a wider blur radius, not less
   amount, which means exposing the `+1.32` lod offset as a fourth tone control.
6. **Accessibility.** `prefers-reduced-motion` is honoured (no damping, no drift). The canvas
   is decorative and has no alt text; add an `aria-hidden` and make sure the copy reads
   standalone.

## Constraints worth not breaking

- The band is `pointer-events: none` so the canvas never eats clicks on the copy.
- The paper colour lives on `html`, not just `body`, and `overscroll-behavior-y: none` is
  set: without both, a phone's rubber band scroll shows a band of bare page under the
  sticky screen at the end of the scroll, black in a dark browser.
- The sticky screen is `lvh`, not `svh`: it has to stay as tall as the window even when the
  phone browser hides its toolbar, or the same strip appears. The picture is lifted clear of
  the fold on phones, so nothing important hides behind the toolbar.
- **A phone does not scroll at all.** The page is one screen, sized from `--vh`, which is
  `visualViewport.height` measured in JS and updated as the browser's bars move. Neither
  `svh` nor `lvh` matched what iOS actually leaves visible: with `svh` the landscape ended up
  under the floating toolbar. Measure, do not guess, and the scroll only ever existed to drive the morph. Tapping the
  caption, which already names where you are and where you are going, steps through the
  places instead (`mode === "steps"`). This is what finally stopped the strip of bare page
  appearing under the sticky screen: there is nothing to scroll, so there is no end to
  scroll past. Scroll mode survives for tablets and for desktop scroll mode.
- **On a phone the picture is the fixed element and the copy is the one that moves.**
  `layoutPhone()` (run from `resize()`) gives the picture 94% of the screen width, capped at
  32% of the visible height, 18px off the bottom, and puts the copy 20% of the way down the
  visible height. If they would come within 20px, the picture gives way first, down to 80% of
  the width (`PHONE_W_MIN`); only then does the copy climb, never above 68px (the logo ends at
  51), and after that the picture shrinks again. The copy holding its share of the height is
  what makes browsers look alike: when the copy climbed first, Comet's shorter screen squeezed
  it up toward the logo (17.7% down against Safari's 20%). All three
  places are sized from the tallest aspect (Paris), so they stay the same size through the
  morph.
  The version before this sized the picture from the room left under the copy, and it broke
  across browsers: width is that room times the aspect, so it amplified every difference in
  toolbar height by nearly two. Comet's taller bar gave a picture 216px wide against Safari's
  355, below one device pixel per dot, which reads as mush. The copy also sat at `22vh`, and
  on a phone `vh` is the height *with the toolbar hidden*, so a taller bar pushed it further
  down. Anything vertical on a phone must come from `--vh`, never `vh`.
  Width is the one measurement no browser's chrome changes, so the picture now comes from it,
  and Safari and Comet get the identical picture; only the copy's position differs.
- **Short phones** (`max-height:640px`, an iPhone SE in Safari leaves about 550) tighten the
  copy to 13/18px with smaller paragraph gaps. Without it the copy alone is 357px tall there
  and the picture fell to 43% of the width; with it, 87%.
- **The visible height is re-measured** on `visualViewport` resize and scroll, on
  `orientationchange` and `pageshow`, and at 0.15, 0.5, 1.2 and 2.5s after load, since not
  every browser has its bars in place when the page first runs. The layout reruns only when
  the height has actually changed.
- **The dot pitch has a floor**, `MIN_CELL` = 1.1 css px. Below about a pixel a dot is not a
  dot, and a picture that small drops dots across rather than turning to mush.
- Premultiplied alpha, `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`, canvas cleared to transparent.
  The page shows through, so paper colour is never painted and cannot mismatch the CSS.
- `UNPACK_FLIP_Y_WEBGL` is true for the photographs and false for the LUT. Getting this
  wrong flips the images or reverses the dot curve.
- `devicePixelRatio` is capped at 2. Uncapped it kills performance on 3x phones for no
  visible gain at this dot size.

## Port to Astro

Straight lift. `index.html` becomes a page or layout, the `<script>` becomes
`client:visible`, `public/img` stays as it is. The renderer has no dependencies and no build
step. Do not reach for three.js: it is 150KB to draw one triangle.
