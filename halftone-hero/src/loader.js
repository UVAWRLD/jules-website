// The loading screen: a white page with an hourglass drawn in the crow's dots, the sand
// running, and a halftone sweep into the hero when it is done.
//
// The hourglass is a baked point cloud (tools/bake_hourglass.py), posed on the CPU each
// frame, splatted into an offscreen buffer with a depth test, then screened into dots on its
// own lattice: the same two passes that draw the crow. Its own canvas and WebGL context sit
// over the whole page, since it has to cover the copy and the logo as well as the picture.
//
// Desktop: the sweep starts four seconds after the hourglass appears, which is exactly
// when the model's sand has run out. Touch screens: an "Enable tilt" button under the
// hourglass asks for motion access (iOS shows its prompt), and the sweep starts on the answer.

const BAKE = 1;                       // bump when the bake's layout changes (cache buster)
const LIGHT = (() => { const v = [-0.45, 0.78, 0.44]; const l = Math.hypot(...v); return v.map(x => x / l); })();
const CAM = 5;                        // camera distance, in hourglass heights
const PITCH = 0.2;                    // looking down on it a little, so the rims read as ellipses
const SPIN = 0.32;                    // radians a second: a slow turn, so it reads as 3D
const DESKTOP_HOLD = 4.0;             // seconds on screen before the sweep, on a desktop
const SWEEP = 1.15;                   // the whole sweep, seconds
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

const VS_SPLAT = `#version 300 es
in vec4 aPos;                         // x px, y px, depth 0..1 (1 near), ink
in float aAlpha;
uniform vec2 uRes; uniform float uDpr, uSize;
out float vDepth; out float vInk; out float vAlpha;
void main(){
  vDepth=aPos.z; vInk=aPos.w; vAlpha=aAlpha;
  vec2 p=aPos.xy*uDpr;
  gl_Position=vec4(p.x/uRes.x*2.0-1.0, 1.0-p.y/uRes.y*2.0, 1.0-aPos.z*2.0, 1.0);
  gl_PointSize=uSize*uDpr*(0.8+0.4*aPos.z);
}`;
const FS_SPLAT = `#version 300 es
precision highp float;
in float vDepth; in float vInk; in float vAlpha;
out vec4 outColor;
void main(){
  vec2 d=gl_PointCoord*2.0-1.0;
  float a=(1.0-smoothstep(0.45,1.0,dot(d,d)))*vAlpha;
  if(a<=0.01) discard;
  outColor=vec4(vInk*a, vDepth*a, 0.0, a);     // premultiplied, so the screen can average it
}`;
const VS_FULL = `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;
// The screen, and the sweep. The hourglass is screened exactly as the crow is: a 3x3 tap of
// the splat buffer per cell, a dark edge where coverage falls off, the far side thinned, dot
// radius from the shared ink curve. The sweep is a second, coarser screen over the whole
// loader: as a ragged front climbs the page, the loader breaks into white dots that shrink
// away over a dark band, and the band then breaks into dots that shrink away over the hero.
const FS_SCREEN = `#version 300 es
precision highp float;
uniform sampler2D uSplat, uLut;
uniform vec2 uRes, uCss;
uniform float uDpr, uCell, uInkK, uFog, uCellT, uFrontA, uFrontB, uBand, uFade;
uniform vec3 uPaper, uInk, uMid;
out vec4 outColor;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
// radius, as a share of the cell, for a coverage: circles up to touching, then the overlap
float rho(float c){ return c<0.7854 ? sqrt(c/3.14159265) : mix(0.5,0.7072,(c-0.7854)/0.2146); }
void main(){
  vec2 px=gl_FragCoord.xy/uDpr;                    // css px, y up
  // ---- the hourglass ----
  vec2 cc=(floor(px/uCell)+0.5)*uCell;
  vec2 st=cc/uCss, e=vec2(uCell)/uCss;
  vec4 cr=vec4(0.0);
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    float w=(i==0?2.0:1.0)*(j==0?2.0:1.0);
    cr+=texture(uSplat, st+vec2(float(i)*e.x, float(j)*e.y))*w;
  }
  cr/=16.0;
  float aInk=0.0;
  if(cr.a>0.02){
    float ink=cr.r/max(cr.a,0.001);
    ink=clamp(ink+0.3*(1.0-smoothstep(0.25,0.95,cr.a)),0.0,1.0);
    float near=clamp(cr.g/max(cr.a,0.001),0.0,1.0);
    ink*=mix(1.0, 0.45+0.55*near, uFog);
    float cov=ink*smoothstep(0.1,0.5,cr.a)*uInkK;
    if(cov>=0.004){
      float r=texture(uLut,vec2(cov,0.5)).r*0.75*uCell*mix(1.0, 0.72+0.56*near, 0.35);   // relief, as the crow
      float aa=min(0.75,r*0.9);
      aInk=1.0-smoothstep(r-aa,r+aa,length(px-cc));
    }
  }
  vec3 col=mix(uPaper,uInk,aInk);
  // ---- the sweep ----
  vec2 ct=(floor(px/uCellT)+0.5)*uCellT;
  float h=ct.y/uCss.y + 0.12*(ct.x/uCss.x-0.5)
        + 0.16*(vnoise(ct/uCss.y*5.0)-0.5) + 0.06*(vnoise(ct/uCss.y*17.0)-0.5);
  float cw=smoothstep(uFrontA-uBand, uFrontA+uBand, h);   // 1: loader solid, 0: gone
  float cd=smoothstep(uFrontB-uBand, uFrontB+uBand, h);   // the dark band behind it
  float d=length(px-ct), aa=0.7;
  float inW=cw>=0.999 ? 1.0 : 1.0-smoothstep(rho(cw)*uCellT-aa, rho(cw)*uCellT+aa, d);
  float inD=cd>=0.999 ? 1.0 : 1.0-smoothstep(rho(cd)*uCellT-aa, rho(cd)*uCellT+aa, d);
  vec4 under=vec4(uMid,1.0)*inD;                  // premultiplied
  outColor=mix(under, vec4(col,1.0), inW)*uFade;
}`;

async function loadModel(base) {
  const v = "?v=" + BAKE;
  const [meta, buf] = await Promise.all([
    fetch(base + "hourglass.json" + v).then(r => r.json()),
    fetch(base + "hourglass.bin" + v).then(r => r.arrayBuffer()),
  ]);
  const T = { "<i2": Int16Array, "|i1": Int8Array, "|u1": Uint8Array, "<u2": Uint16Array, "<f4": Float32Array };
  const get = name => {
    const L = meta.layout[name];
    const n = L.shape.reduce((a, b) => a * b, 1);
    return new T[L.dtype](buf, L.offset, n);
  };
  const m = { meta, fps: meta.fps, frames: meta.frames };
  const rpos = get("rpos"), rnrm = get("rnrm");
  m.nr = rpos.length / 3;
  m.rpos = Float32Array.from(rpos, x => x * meta.q);
  m.rnrm = Float32Array.from(rnrm, x => x / 127);
  m.rao = Float32Array.from(get("rao"), x => x / 255);
  m.rkind = get("rkind");
  m.sand = [0, 1, 2].map(k => {
    const pos = get(`sand${k}_pos`), idx = get(`sand${k}_idx`), w = get(`sand${k}_w`);
    const nv = pos.length / 3, nk = w.length / meta.frames;
    return { pos, deltas: get(`sand${k}_deltas`), idx, w, nv, nk,
             cur: new Float32Array(nv * 3), nrm: new Float32Array(nv * 3) };
  });
  m.smesh = get("smesh"); m.stri = get("stri"); m.sbary = get("sbary"); m.sgrain = get("sgrain");
  m.ns = m.smesh.length;
  m.mats = get("mats");                                     // frames x 2 x 12
  return m;
}

export function createLoader(opts) {
  const { mobile, reduce, isHeroReady, enableTilt, onReveal } = opts;
  const root = document.getElementById("loader");
  const cv = document.getElementById("loaderCv");
  const btn = document.getElementById("loaderTilt");
  const gl = cv.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true });
  const done = () => { root.remove(); document.documentElement.classList.remove("loading"); };
  if (!gl) { done(); onReveal(); return; }                 // no WebGL2: straight to the page

  // ---- GL setup ----
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o)); return o; };
  const program = (vs, fs) => { const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p)); return p; };
  const pSplat = program(VS_SPLAT, FS_SPLAT), pScreen = program(VS_FULL, FS_SCREEN);
  const U = {};
  ["uRes", "uCss", "uDpr", "uCell", "uInkK", "uFog", "uCellT", "uFrontA", "uFrontB", "uBand", "uFade",
   "uPaper", "uInk", "uMid", "uSplat", "uLut"].forEach(n => U[n] = gl.getUniformLocation(pScreen, n));
  const SU = {}; ["uRes", "uDpr", "uSize"].forEach(n => SU[n] = gl.getUniformLocation(pSplat, n));

  const vao = gl.createVertexArray(), vbo = gl.createBuffer(), abo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const aPos = gl.getAttribLocation(pSplat, "aPos"), aAlpha = gl.getAttribLocation(pSplat, "aAlpha");
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 4, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, abo);
  gl.enableVertexAttribArray(aAlpha); gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const emptyVao = gl.createVertexArray();

  const fb = gl.createFramebuffer(), tex = gl.createTexture(), depth = gl.createRenderbuffer();
  let dpr = 1, W = 0, H = 0;
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect(); W = r.width; H = r.height;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cv.width, cv.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, cv.width, cv.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    place();
  }
  addEventListener("resize", resize);

  // the dot curve the hero uses, so the hourglass's dots grow exactly as the crow's do
  const lut = gl.createTexture();
  let lutReady = false;
  const lutImg = new Image();
  lutImg.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, lut);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lutImg);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    lutReady = true;
  };
  lutImg.src = "public/img/dot-lut.png";

  // ---- layout: where the hourglass sits and how big ----
  let cx = 0, cy = 0, scale = 1;
  function place() {
    scale = Math.min(H * (mobile ? 0.40 : 0.40), W * 0.9 / 0.47);   // it is 0.47 as wide as tall
    cx = W / 2;
    cy = H * (mobile ? 0.44 : 0.5);
    btn.style.top = Math.round(cy + scale * 0.5 + 34) + "px";
  }

  // ---- posing ----
  let M = null, out = null, alpha = null, nOpaque = 0, nAll = 0;
  const PARTICLES = 90;
  const part = Array.from({ length: PARTICLES }, () => ({ y: -1, x: 0, z: 0, v: 0 }));
  loadModel("public/models/").then(m => {
    M = m;
    nAll = m.nr + m.ns + PARTICLES;
    out = new Float32Array(nAll * 4); alpha = new Float32Array(nAll);
  }).catch(e => { console.error("hourglass", e); });

  function sandPose(fi, f) {
    // morph each sand mesh between frames, then recompute its vertex normals
    const f1 = (fi + 1) % M.frames;
    for (const s of M.sand) {
      const { pos, deltas, w, nv, nk, cur, nrm, idx } = s;
      cur.set(pos);
      for (let k = 0; k < nk; k++) {
        const wk = w[fi * nk + k] * (1 - f) + w[f1 * nk + k] * f;
        if (wk < 1e-4) continue;
        const o = k * nv * 3;
        for (let i = 0; i < nv * 3; i++) cur[i] += wk * deltas[o + i];
      }
      nrm.fill(0);
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        const ux = cur[b] - cur[a], uy = cur[b + 1] - cur[a + 1], uz = cur[b + 2] - cur[a + 2];
        const vx = cur[c] - cur[a], vy = cur[c + 1] - cur[a + 1], vz = cur[c + 2] - cur[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const q of [a, b, c]) { nrm[q] += nx; nrm[q + 1] += ny; nrm[q + 2] += nz; }
      }
    }
  }

  function matAt(fi, f, j) {                                  // lerped 3x4, fine at 30fps
    const a = (fi * 2 + j) * 12, b = (((fi + 1) % M.frames) * 2 + j) * 12, m = new Float32Array(12);
    for (let i = 0; i < 12; i++) m[i] = M.mats[a + i] * (1 - f) + M.mats[b + i] * f;
    return m;
  }

  function pose(t, dt) {
    const loop = M.frames / M.fps;
    const ft = ((t % loop) + loop) % loop * M.fps;
    const fi = Math.floor(ft), f = ft - fi;
    // the loop joins at the flip: at 5s it is upside down with the other bulb full, which is
    // the same picture as 0s. Blending the last frame into the first would spin it back, so
    // the last frame is held rather than lerped.
    const fl = fi === M.frames - 1 ? 0 : f;
    const R = matAt(fi, fl, 0), S = matAt(fi, fl, 1);
    sandPose(fi, fl);

    const yaw = t * SPIN, cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
    let q = 0;
    const emit = (x, y, z, nx, ny, nz, kind, ao, grain) => {
      // spin about the vertical, then tip toward the viewer
      const rx = x * cyw + z * syw, rz = -x * syw + z * cyw;
      const ty = y * cp - rz * sp, tz = y * sp + rz * cp;
      const nrx = nx * cyw + nz * syw, nrz = -nx * syw + nz * cyw;
      const nty = ny * cp - nrz * sp, ntz = ny * sp + nrz * cp;
      const k = scale * CAM / (CAM - tz);
      out[q * 4] = cx + rx * k; out[q * 4 + 1] = cy - ty * k;
      out[q * 4 + 2] = clamp(0.5 + tz * 1.6, 0, 1);
      const lam = Math.max(0, nrx * LIGHT[0] + nty * LIGHT[1] + ntz * LIGHT[2]);
      const rim = 1 - Math.abs(ntz);
      let ink, a = 1;
      if (kind === 0) {                                      // the wooden frame, shaded like the crow
        const shade = 0.55 * (1 - lam) + 0.45 * (1 - ao);
        ink = 0.04 + 0.7 * shade + 0.24 * rim * rim;       // a touch lighter, so the sand reads against it
      } else if (kind === 1) {                               // glass: only where it turns away
        a = 0.03 + 0.97 * Math.pow(rim, 3.2);
        ink = 0.5 + 0.4 * rim;
      } else {                                               // sand, with a grain to it
        ink = 0.5 + 0.42 * (1 - lam) + 0.12 * rim + 0.22 * (grain - 0.5);
      }
      out[q * 4 + 3] = clamp(ink, 0, 1); alpha[q] = a; q++;
    };
    const xf = (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
    const xn = (m, x, y, z) => { const a = m[0] * x + m[1] * y + m[2] * z, b = m[4] * x + m[5] * y + m[6] * z, c = m[8] * x + m[9] * y + m[10] * z;
      const l = Math.hypot(a, b, c) || 1; return [a / l, b / l, c / l]; };

    // opaque first (frame, sand, falling grains), glass last, so glass can be drawn over them
    const glassIdx = [];
    for (let i = 0; i < M.nr; i++) {
      if (M.rkind[i] === 1) { glassIdx.push(i); continue; }
      const p = xf(R, M.rpos[i * 3], M.rpos[i * 3 + 1], M.rpos[i * 3 + 2]);
      const n = xn(R, M.rnrm[i * 3], M.rnrm[i * 3 + 1], M.rnrm[i * 3 + 2]);
      emit(p[0], p[1], p[2], n[0], n[1], n[2], 0, M.rao[i], 0);
    }
    for (let i = 0; i < M.ns; i++) {
      const s = M.sand[M.smesh[i]], t3 = M.stri[i] * 3;
      const b1 = M.sbary[i * 2] / 255, b2 = M.sbary[i * 2 + 1] / 255, b0 = 1 - b1 - b2;
      const a = s.idx[t3] * 3, b = s.idx[t3 + 1] * 3, c = s.idx[t3 + 2] * 3, C = s.cur, N = s.nrm;
      const p = xf(S, b0 * C[a] + b1 * C[b] + b2 * C[c], b0 * C[a + 1] + b1 * C[b + 1] + b2 * C[c + 1], b0 * C[a + 2] + b1 * C[b + 2] + b2 * C[c + 2]);
      const n = xn(S, b0 * N[a] + b1 * N[b] + b2 * N[c], b0 * N[a + 1] + b1 * N[b + 1] + b2 * N[c + 1], b0 * N[a + 2] + b1 * N[b + 2] + b2 * N[c + 2]);
      emit(p[0], p[1], p[2], n[0], n[1], n[2], 2, 1, M.sgrain[i] / 255);
    }
    // falling grains: the stream mesh is a smooth rod, which reads as still. Loose grains
    // dropping through it, from the neck to the top of the pile, are what make it run.
    const st = M.sand[1].cur;
    let top = -1e9, bot = 1e9;
    for (let i = 1; i < st.length; i += 3) { top = Math.max(top, st[i]); bot = Math.min(bot, st[i]); }
    const flowing = top - bot > 3;
    for (const g of part) {
      if (g.y < bot || g.y > top + 1 || !flowing) {
        if (flowing && Math.random() < 0.35) {
          g.y = top - Math.random() * 2; g.v = 20 + Math.random() * 25;
          const r = Math.sqrt(Math.random()) * 2.2, th = Math.random() * 6.283;
          g.x = r * Math.cos(th); g.z = r * Math.sin(th);
        } else { g.y = -1e9; }
      } else { g.v += 260 * dt; g.y -= g.v * dt; }
      if (g.y > -1e8) {
        const p = xf(S, g.x, g.y, g.z);
        emit(p[0], p[1], p[2], 0, 0, 1, 2, 1, 0.9);
      } else { out[q * 4] = -1e4; out[q * 4 + 1] = -1e4; out[q * 4 + 2] = 0; out[q * 4 + 3] = 0; alpha[q] = 0; q++; }
    }
    nOpaque = q;
    for (const i of glassIdx) {
      const p = xf(R, M.rpos[i * 3], M.rpos[i * 3 + 1], M.rpos[i * 3 + 2]);
      const n = xn(R, M.rnrm[i * 3], M.rnrm[i * 3 + 1], M.rnrm[i * 3 + 2]);
      emit(p[0], p[1], p[2], n[0], n[1], n[2], 1, 1, 0);
    }
  }

  // ---- the sequence ----
  let shownAt = null, sweepAt = null, t = 0, last = performance.now(), raf = 0;
  let answered = !mobile;
  const heroOk = () => { try { return isHeroReady(); } catch { return true; } };
  if (mobile) {
    btn.hidden = false;
    btn.onclick = e => {
      e.stopPropagation();
      btn.disabled = true;
      // straight from the tap: iOS only shows its prompt from inside one
      Promise.resolve(enableTilt()).finally(() => { answered = true; });
    };
  }
  document.documentElement.classList.add("loading");

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (M && lutReady) {
      if (shownAt === null) shownAt = now;
      t = (now - shownAt) / 1000;
      pose(t, dt);
      const due = mobile ? answered : t >= DESKTOP_HOLD;
      if (sweepAt === null && due && heroOk()) {
        sweepAt = now;
        root.classList.add("sweeping");                     // the page's white goes; the canvas carries it
        onReveal();
      }
    } else if (sweepAt === null && performance.now() > 8000 && heroOk()) {
      sweepAt = now; root.classList.add("sweeping"); onReveal();    // model never came: leave anyway
    }
    draw(now);
    if (sweepAt !== null && (now - sweepAt) / 1000 > (reduce ? 0.4 : SWEEP)) {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
      done();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function draw(now) {
    // splat
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (M && shownAt !== null) {
      gl.useProgram(pSplat); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, abo); gl.bufferData(gl.ARRAY_BUFFER, alpha, gl.DYNAMIC_DRAW);
      gl.uniform2f(SU.uRes, cv.width, cv.height); gl.uniform1f(SU.uDpr, dpr);
      gl.uniform1f(SU.uSize, Math.max(2.2, scale * 0.0125));
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND); gl.depthMask(true);
      gl.drawArrays(gl.POINTS, 0, nOpaque);
      // glass over what is behind it, without hiding it: blended, and not writing depth
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.drawArrays(gl.POINTS, nOpaque, nAll - nOpaque);
      gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    }
    // screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pScreen); gl.bindVertexArray(emptyVao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uSplat, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lut); gl.uniform1i(U.uLut, 1);
    gl.uniform2f(U.uRes, cv.width, cv.height); gl.uniform2f(U.uCss, W, H);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform1f(U.uCell, Math.max(1.6, scale / 150));      // about the crow's pitch
    gl.uniform1f(U.uInkK, 0.72); gl.uniform1f(U.uFog, 0.5);
    gl.uniform3f(U.uPaper, 1, 1, 1);
    gl.uniform3f(U.uInk, 0.04, 0.04, 0.04);
    gl.uniform3f(U.uMid, 0.125, 0.114, 0.114);             // the dark of the reference
    gl.uniform1f(U.uCellT, W < 820 ? 9 : 11);
    const band = 0.13;                                       // a long gradient of dot sizes, as in the reference
    // h runs 0 at the bottom to 1 at the top; above a front is solid, below it is gone
    let a = -2, b = -2, fade = 1;                            // fronts below the page: all solid
    if (sweepAt !== null) {
      const p = (now - sweepAt) / 1000;
      if (reduce) { fade = clamp(1 - p / 0.4, 0, 1); }
      else {
        const e = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
        const lo = -0.4, hi = 1.45;                          // below the page to above it, noise included
        // the dark band trails the white front closely: far enough to show, not so far that
        // the page goes black
        const lag = SWEEP * 0.13, run = SWEEP - lag;
        a = lo + (hi - lo) * e(p / run);
        b = lo + (hi - lo) * e((p - lag) / run);
      }
    }
    gl.uniform1f(U.uFrontA, a); gl.uniform1f(U.uFrontB, b); gl.uniform1f(U.uBand, band);
    gl.uniform1f(U.uFade, fade);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  resize();
  raf = requestAnimationFrame(frame);
}
