// The dot screen behind a Timeline detail card, built the way the loader builds the home page:
// every dot comes on at its own moment, mostly at random with a little low-frequency
// clustering, so there is no direction to it. Each dot pops a little large and dark, then
// settles to its size. Closing runs the same build backwards, faster.
//
// The dots are the design's pattern fill: a hex tiling of 1.8px dots, 3.6px apart across and
// 3.12px between rows, in the ink at a fixed strength. One fullscreen triangle, drawn only while
// something is changing; between builds the canvas just keeps its last frame.
// Without WebGL2 the caller falls back to the CSS dots (the .tc-veil.css-dots class).

const SPREAD = 0.7, DUR = 0.3;               // seconds: the start times' range, and each dot's pop
export const BUILD = SPREAD + DUR;
const CLOSE_SPEED = 1.7;                     // closing runs the build backwards this much faster

const VS = `#version 300 es
void main(){ vec2 p=vec2(gl_VertexID==1?3.0:-1.0, gl_VertexID==2?3.0:-1.0); gl_Position=vec4(p,0.0,1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes;          // device px
uniform float uDpr, uT, uSpread, uDur, uAlpha;
uniform vec3 uInk;
out vec4 outColor;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
void main(){
  vec2 px=vec2(gl_FragCoord.x, uRes.y-gl_FragCoord.y)/uDpr;       // css px, from the top left
  // two rectangular lattices, the second offset half a step both ways, make the hex tiling
  vec2 P=vec2(3.6,6.24);
  vec2 ia=floor(px/P+0.5), ca=ia*P;
  vec2 ib=floor((px-P*0.5)/P+0.5), cb=ib*P+P*0.5;
  bool a=length(px-ca)<length(px-cb);
  vec2 c=a?ca:cb, id=a?vec2(ia.x,ia.y*2.0):vec2(ib.x,ib.y*2.0+1.0);
  float delay=0.75*hash(id+3.1)+0.25*vnoise(c/uRes.y*uDpr*3.2+7.0);
  float q=clamp((uT-delay*uSpread)/uDur,0.0,1.0);
  float s1=smoothstep(0.0,0.4,q), s2=smoothstep(0.4,1.0,q);
  float r=0.9*(1.45*s1-0.45*s2);                                   // pops large, settles
  float k=1.0+0.8*(s1-s2);                                         // and darker while it pops
  float aa=0.55/uDpr+0.2;
  float cov=1.0-smoothstep(r-aa,r+aa,length(px-c));
  float al=min(1.0,uAlpha*k)*cov*step(0.001,r);
  outColor=vec4(uInk*al,al);
}`;

export function createDots(host) {
  const cv = document.createElement("canvas");
  cv.className = "tc-dots";
  const gl = cv.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  const U = {};
  ["uRes", "uDpr", "uT", "uSpread", "uDur", "uAlpha", "uInk"].forEach(n => U[n] = gl.getUniformLocation(pr, n));
  host.append(cv);

  let t = 0, raf = 0;
  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  }
  // the ink and its strength come from the page, so the dots follow the theme
  function ink() {
    const m = getComputedStyle(document.body).color.match(/[\d.]+/g).map(Number);
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    return [m[0] / 255, m[1] / 255, m[2] / 255, dark ? 0.16 : 0.34];
  }
  function draw() {
    const dpr = size(), [r, g, b, a] = ink();
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pr);
    gl.uniform2f(U.uRes, cv.width, cv.height); gl.uniform1f(U.uDpr, dpr);
    gl.uniform1f(U.uT, t); gl.uniform1f(U.uSpread, SPREAD); gl.uniform1f(U.uDur, DUR);
    gl.uniform1f(U.uAlpha, a); gl.uniform3f(U.uInk, r, g, b);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // run the build to its end (dir 1) or back to nothing (dir -1); resolves when it gets there
  function run(dir, reduce) {
    cancelAnimationFrame(raf);
    if (reduce) { t = dir > 0 ? BUILD : 0; draw(); return Promise.resolve(); }
    return new Promise(res => {
      let last = performance.now();
      const step = now => {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        t = Math.max(0, Math.min(BUILD, t + dir * dt * (dir > 0 ? 1 : CLOSE_SPEED)));
        draw();
        if ((dir > 0 && t >= BUILD) || (dir < 0 && t <= 0)) res();
        else raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
  }
  addEventListener("resize", () => { if (t > 0) draw(); });
  return { in: reduce => run(1, reduce), out: reduce => run(-1, reduce), redraw: draw };
}
