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
index.html            page markup and all CSS, plus the tuning panel
src/halftone.js       the whole renderer: WebGL2 setup, shader, scroll and cursor wiring
src/crow.js           the crow: point cloud, rig, flight and perch animation
public/img/*.jpg      descreened reference art (tools/build_sources.py), 2048 wide
public/img/*-depth.jpg  depth maps (tools/build_depth.py), white near, black far
public/img/photo/     the original photographs, no longer used
tools/                build_sources.py (descreen refs), build_depth.py (depth maps),
                      build_single.py (one-file HTML), crow-preview.html (crow poses)
public/img/dot-lut.png  256 entry lookup: dot radius as a function of ink coverage
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

## The crow (prototype)

A 3D point cloud, about 5,000 points, built in `src/crow.js` from parametric surfaces: no
model file, no loader, no three.js. Each point carries a part id, and the feathered parts
carry a span and chord coordinate instead of a position, so wings and tail are generated
from the pose rather than deformed.

**It is drawn with the same dots as the landscape.** The cloud is posed and projected on
the CPU, splatted into an offscreen RGBA buffer as coverage (additive, so overlapping
splats build to solid ink), and the halftone pass reads that buffer at each cell centre and
takes `max(sceneCoverage, crowCoverage)`. So the bird lands on the same lattice as
everything else. It is read after the text keep-out, because it perches on the copy.

**Life cycle:** waits 1.1s, flies in from off the left, lands on the top right of the copy,
idles there (breathing, slow looks around), and on a click crouches, jumps, beats hard and
leaves past the right edge. `crowHit` is a small transparent div tracking its bounding box,
so the cursor turns to a pointer and the click target is real; everything else on the band
stays `pointer-events: none`.

**Why it is posed on the CPU:** the rig is a handful of angles, so skinning 5,000 points in
JavaScript is cheaper than the plumbing for doing it on the GPU, and the projection has to
happen here anyway to give the page a bounding box to hit test.

Two things learned the hard way, both visible in `tools/crow-preview.html`, which draws six
poses flat without the halftone in the way:

- **The bird cannot be seen from the side.** Wings spread across its z axis, so a pure side
  view foreshortens them to nothing. Flight is posed three quarters on (yaw -0.85 easing to
  -0.38), which is also why the perch pose keeps a yaw of -0.38.
- **The tail needs layering, not spread.** Its fan opens across the same axis, so from the
  side it is the per feather drop that reads, not the angle.

The canvas now spans the whole window rather than just the band, so the crow can fly the
full width; the picture still occupies the centred band, which `bandW()` derives from
`--band-k`, and the dot pitch is still band width over dots across, so the landscape is
unchanged.

## Layout, all measured from the mockups, not chosen

Reference frame is 1440 x 1024.

| | value |
|---|---|
| Band | centred, width `min(0.96 × viewport height, viewport width)`. Height-driven so the picture keeps the same vertical composition at any window shape (was 14.31% to 85.26% of width) |
| Text column | left edge 29.8% into the band (35.42% of a 1440 frame), 420px wide, 14 / 21px |
| Logo | 27px at 4.86% / 5.18vh |
| Page | `#ECECEC` paper, near `#0A0A0A` ink |
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
