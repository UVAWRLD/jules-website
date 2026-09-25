// The crow, on a page without the landscape: a transparent canvas over the whole window that
// draws only him, in the same dots as on the home page, perched on an element's bottom edge.
//
// The two passes are the home page's crow passes, lifted out of src/halftone.js: the posed
// point cloud splatted into an offscreen buffer with a depth test, then screened on his own
// lattice (a 3x3 tap, a dark edge where coverage falls off, the far side thinned, the shared
// dot curve). His size and pitch come from the same band as the home page, so he is the same
// bird on every page. The canvas is fixed and the perch is read every frame, so when the page
// scrolls he goes with the line he stands on.

import { createCrow } from "./crow.js";
import { createCrowUI } from "./crowui.js";

const SPLAT_VS = `#version 300 es
in vec4 aPos;                       // x px, y px, depth 0..1 (1 near), ink 0..1
uniform vec2 uRes; uniform float uDpr, uSize;
out float vDepth; out float vInk;
void main(){
  vDepth=aPos.z; vInk=aPos.w;
  vec2 p=aPos.xy*uDpr;
  gl_Position=vec4(p.x/uRes.x*2.0-1.0, 1.0-p.y/uRes.y*2.0, 1.0-aPos.z*2.0, 1.0);
  gl_PointSize=uSize*uDpr*(0.75+0.5*aPos.z);
}`;
const SPLAT_FS = `#version 300 es
precision highp float;
in float vDepth; in float vInk;
out vec4 outColor;
void main(){
  vec2 d=gl_PointCoord*2.0-1.0;
  float a=1.0-smoothstep(0.45,1.0,dot(d,d));
  if(a<=0.01) discard;
  outColor=vec4(vInk*a, vDepth*a, 0.0, a);
}`;
const FULL_VS = `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;
const SCREEN_FS = `#version 300 es
precision highp float;
uniform sampler2D uCrow, uLut;
uniform vec2 uRes;
uniform float uDpr, uCell, uInkK, uFog, uRelief, uOpacity;
uniform vec3 uInk;
out vec4 outColor;
void main(){
  vec2 px=gl_FragCoord.xy/uDpr;
  vec2 cc=(floor(px/uCell)+0.5)*uCell;
  vec2 st=cc/uRes, e=vec2(uCell)/uRes;
  vec4 cr=vec4(0.0);
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    float w=(i==0?2.0:1.0)*(j==0?2.0:1.0);
    cr+=texture(uCrow, st+vec2(float(i)*e.x, float(j)*e.y))*w;
  }
  cr/=16.0;
  if(cr.a<0.004){ outColor=vec4(0.0); return; }
  float ink=cr.r/max(cr.a,0.001);
  ink=clamp(ink+0.3*(1.0-smoothstep(0.25,0.95,cr.a)),0.0,1.0);   // the dark outline
  float near=clamp(cr.g/max(cr.a,0.001),0.0,1.0);
  ink*=mix(1.0, 0.45+0.55*near, uFog);                             // the far side thins
  float cov=ink*smoothstep(0.1,0.5,cr.a)*uInkK;
  if(cov<0.004){ outColor=vec4(0.0); return; }
  float r=texture(uLut,vec2(cov,0.5)).r*0.75*uCell*mix(1.0, 0.72+0.56*near, uRelief);
  float aa=min(0.75,r*0.9);
  float a=(1.0-smoothstep(r-aa,r+aa,length(px-cc)))*uOpacity;
  outColor=vec4(uInk*a, a);
}`;

// the home page's defaults, so the bird matches
const CROW_INK = 0.58, CROW_FOG = 0.5, RELIEF = 0.35, OPACITY = 0.61, SPLAT = 2.7;
const DOTS_ACROSS = 445, SIZE = 0.064, SIZE_MIN = 46, SIZE_MAX = 74;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function createCrowStage({ perchOn, perchAt = 0.5, dir = -1, base = "" }) {
  const fine = matchMedia("(pointer: fine)").matches;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cv = document.createElement("canvas");
  cv.id = "crowStage"; cv.setAttribute("aria-hidden", "true");
  document.body.append(cv);
  const gl = cv.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) { cv.remove(); return null; }

  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; };
  const program = (vs, fs) => { const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p)); return p; };
  const pSplat = program(SPLAT_VS, SPLAT_FS), pScreen = program(FULL_VS, SCREEN_FS);
  const SU = {}, U = {};
  ["uRes", "uDpr", "uSize"].forEach(n => SU[n] = gl.getUniformLocation(pSplat, n));
  ["uCrow", "uLut", "uRes", "uDpr", "uCell", "uInkK", "uFog", "uRelief", "uOpacity", "uInk"].forEach(n => U[n] = gl.getUniformLocation(pScreen, n));

  const vao = gl.createVertexArray(), buf = gl.createBuffer();
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const aPos = gl.getAttribLocation(pSplat, "aPos");
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 4, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const empty = gl.createVertexArray();

  const fb = gl.createFramebuffer(), tex = gl.createTexture(), depth = gl.createRenderbuffer();
  let dpr = 1, W = 0, H = 0;
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
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
  }
  resize();
  addEventListener("resize", resize);

  // the dot curve the landscape uses: dot radius as a function of ink coverage
  const lut = gl.createTexture();
  let lutReady = false;
  const img = new Image();
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, lut);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    lutReady = true;
  };
  img.src = base + "public/img/dot-lut.png";

  const crow = createCrow(base + "public/models/", { dir });
  const ui = createCrowUI({ crow, fine, canvasWidth: () => W });

  // he turns a little toward the cursor, as on the home page
  let mouse = null;
  const sway = [0, 0];
  addEventListener("pointermove", e => { if (e.pointerType === "mouse") mouse = [e.clientX, e.clientY]; }, { passive: true });
  addEventListener("pointerleave", () => { mouse = null; });

  const ink = () => (getComputedStyle(document.body).color.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(v => +v / 255);
  let last = performance.now(), drawn = false;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    const want = mouse && !reduce ? [clamp((mouse[0] - W / 2) / (W / 2) * 1.6, -1, 1), clamp((mouse[1] - H / 2) / (H / 2) * 1.6, -1, 1)] : [0, 0];
    const ease = 1 - Math.pow(1 - 0.12, dt * 60);
    sway[0] += (want[0] - sway[0]) * ease; sway[1] += (want[1] - sway[1]) * ease;

    const band = Math.min(0.96 * H, W);
    const scale = clamp(band * SIZE, SIZE_MIN, SIZE_MAX);
    const r = perchOn.getBoundingClientRect();
    const alive = crow.update(reduce ? 0.016 : dt, {
      w: W, h: H, perchX: r.left + r.width * perchAt, perchY: r.bottom - 1,
      sway, scale, reduce,
    });
    ui.update({ left: 0, top: 0 });

    if (alive && crow.count && lutReady) {
      // splat him
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(pSplat); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, crow.positions, gl.DYNAMIC_DRAW);
      gl.uniform2f(SU.uRes, cv.width, cv.height); gl.uniform1f(SU.uDpr, dpr);
      gl.uniform1f(SU.uSize, SPLAT * scale / 110);
      gl.drawArrays(gl.POINTS, 0, crow.count);
      gl.disable(gl.DEPTH_TEST);
      // and screen him into dots
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(pScreen); gl.bindVertexArray(empty);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uCrow, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lut); gl.uniform1i(U.uLut, 1);
      gl.uniform2f(U.uRes, W, H); gl.uniform1f(U.uDpr, dpr);
      gl.uniform1f(U.uCell, band / DOTS_ACROSS);
      gl.uniform1f(U.uInkK, CROW_INK); gl.uniform1f(U.uFog, CROW_FOG);
      gl.uniform1f(U.uRelief, RELIEF); gl.uniform1f(U.uOpacity, OPACITY);
      gl.uniform3fv(U.uInk, ink());
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      drawn = true;
    } else if (drawn) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      drawn = false;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { crow, ui };
}
