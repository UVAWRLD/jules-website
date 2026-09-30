import {createCrow} from "./crow.js";
import {createLoader} from "./loader.js";
import {createChain} from "./chain.js";
import {createCrowUI} from "./crowui.js";

// paths are relative to index.html, so the folder runs from any static server.
// moving to Astro means public/img/x.jpg becomes /img/x.jpg.
const SRC = { cassis:"public/img/cassis.jpg", paris:"public/img/paris.jpg", nyc:"public/img/nyc.jpg" };
const LUTSRC = "public/img/dot-lut.png";

const PLACES = [
  // sources are the reference art, descreened by tools/build_sources.py. Each one spans the
  // full band and sits on the fold, so bleed is 0. black 0.075 maps the #ECECEC paper the
  // art was exported on to zero ink; soft blends in the continuous tone the art carries.
  {key:"cassis", label:"Cassis",   aspect:4088/1616, texW:2048, bleed:0, hue:[0.12,0.23,0.21],
   tone:{black:0.075, white:1.00, gamma:1.00, lc:0.00, blue:0.0, soft:0.15}},
  {key:"paris",  label:"Paris",    aspect:4084/2232, texW:2048, bleed:0, hue:[0.23,0.18,0.12],
   tone:{black:0.075, white:1.00, gamma:1.00, lc:0.00, blue:0.0, soft:0.35}},
  {key:"nyc",    label:"New York", aspect:4088/1784, texW:2048, bleed:0, hue:[0.10,0.13,0.19],
   tone:{black:0.075, white:1.00, gamma:1.00, lc:0.00, blue:0.0, soft:0.10}}
];
const DEFAULTS = JSON.parse(JSON.stringify(PLACES.map(p=>p.tone)));

const cv=document.getElementById("c");
const band=document.getElementById("band");
// ?grab keeps the drawing buffer so a frame can be read back for inspection; it costs a
// copy per frame, so it is off unless asked for
const GRAB=location.search.includes("grab");
const gl=cv.getContext("webgl2",{antialias:false,alpha:true,premultipliedAlpha:true,
  preserveDrawingBuffer:GRAB});
if(gl){
gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

const VS=`#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;

const FS=`#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uSrcA,uSrcB,uLut,uDepA,uDepB,uCrow;
uniform vec4  uXfA,uXfB,uToneA,uToneB;
uniform vec2  uBlueAB,uSoftAB;
uniform vec3  uHueA,uHueB,uInk;
uniform float uDpr,uCell,uMix,uStagger,uDrift,uTint,uDepth,uDetail,uOpacity;
uniform float uPar,uFog,uRelief,uShowDep;
uniform vec2  uSway,uRes;
uniform float uCrowOn,uCrowInk,uCrowFog,uCellCrow,uCellChain;
uniform vec2 uTexW;
uniform vec4 uTextRect;
uniform vec2 uTextPad;

const vec3 LUMA=vec3(0.2126,0.7152,0.0722);
const vec3 BLUEF=vec3(0.10,0.20,0.70);

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
float vnoise(vec2 p){
  vec2 i=floor(p),f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y);
}
// depth map: 1 near, 0 far, pixel aligned with the source. Depth Anything V2, see
// tools/build_depth.py. near is returned so the caller can size the dot by distance.
float coverage(sampler2D t, sampler2D dt, vec4 xf, vec4 tone, float blueW, vec2 c, vec2 p,
               float lod, float detail, vec2 shift, out float near){
  // tone is read at the cell centre, then pulled toward the value under this pixel so
  // edges can cut through a dot (threshold screening) instead of every dot being round
  vec2 uv=mix(c,p,detail);
  uv=(uv-xf.xy)/xf.zw;
  near=0.5;
  if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) return 0.0;

  // parallax: walk against the depth map twice, so a near edge can cover what is behind it
  float dep=textureLod(dt,uv,lod+2.0).r;
  vec2 uvp=clamp(uv+shift*(dep-0.5),0.0,1.0);
  dep=textureLod(dt,uvp,lod+2.0).r;
  uvp=uv+shift*(dep-0.5);
  if(uvp.x<0.0||uvp.x>1.0||uvp.y<0.0||uvp.y>1.0) return 0.0;
  near=dep;

  vec3 w=mix(LUMA,BLUEF,blueW);
  float d =1.0-dot(textureLod(t,uvp,lod).rgb,w);
  float db=1.0-dot(textureLod(t,uvp,lod+1.32).rgb,w);
  d=clamp(d+tone.w*(d-db),0.0,1.0);
  float cov=pow(clamp((d-tone.x)/max(tone.y-tone.x,0.02),0.0,1.0), tone.z);
  // aerial perspective: distance thins the ink
  cov*=mix(1.0, 0.45+0.55*dep, uFog);
  return cov<0.012 ? 0.0 : cov;
}

void main(){
  vec2 px=gl_FragCoord.xy/uDpr;
  float t=clamp(uMix,0.0,1.0);
  if(uDrift>0.001){
    vec2 n=vec2(vnoise(px*0.011), vnoise(px*0.011+41.7))-0.5;
    px += n*uDrift*2.0*sin(3.14159265*t);
  }
  vec2 cid=floor(px/uCell);
  vec2 c=(cid+0.5)*uCell;

  float s=clamp(uStagger,0.0,0.95);
  float tl=clamp((t-hash(cid+0.37)*s)/max(1.0-s,0.05),0.0,1.0);
  tl=tl*tl*(3.0-2.0*tl);

  // a whole-cell average when detail is 0, about a quarter cell when it is 1
  float lodK=mix(1.0,-1.0,uDetail);
  float lodA=max(log2(uCell*uTexW.x/uXfA.z)+lodK,0.0);
  float lodB=max(log2(uCell*uTexW.y/uXfB.z)+lodK,0.0);
  // the sway is in pixels of the drawn image, so convert per source
  float nearA,nearB;
  float covA=coverage(uSrcA,uDepA,uXfA,uToneA,uBlueAB.x,c,px,lodA,uDetail,uSway*uPar/uXfA.zw,nearA);
  float covB=coverage(uSrcB,uDepB,uXfB,uToneB,uBlueAB.y,c,px,lodB,uDetail,uSway*uPar/uXfB.zw,nearB);
  float cov=mix(covA,covB,tl);
  float near=mix(nearA,nearB,tl);
  if(uShowDep>0.5) cov=near;                 // debug: draw the depth map itself

  // keep clear of the text block: whole dots are dropped, judged at the cell centre
  vec2 q = max(uTextRect.xy - c, c - uTextRect.zw);
  float dText = length(max(q,0.0)) + min(max(q.x,q.y),0.0);
  float clear = smoothstep(uTextPad.x, uTextPad.x + max(uTextPad.y,0.5), dText);

  cov*=clear;                               // the picture respects the text keep-out

  // ---- the picture's dots, on the shared lattice ----
  float aScene=0.0, covOut=cov;
  if(cov>=0.004){
    float rho=texture(uLut,vec2(cov,0.5)).r*0.75;
    // relief: near dots grow, far ones shrink, as if the lattice sat on the surface
    float r=rho*uCell*mix(1.0, 0.72+0.56*near, uRelief);
    float aa=min(0.75,r*0.9);
    aScene=1.0-smoothstep(r-aa,r+aa,length(px-c));
    // the reference art is not pure dots: part of its ink is continuous tone
    aScene=mix(aScene,cov,mix(uSoftAB.x,uSoftAB.y,tl));
    // opacity carries the same signal as size, so light dots sit further back
    aScene*=mix(1.0, 0.18+0.82*cov, uDepth);
  }

  // ---- the crow's dots, on its own finer lattice ----
  // The bird is small on the page, so at the picture's pitch there are too few dots across
  // it to show its form. It gets its own screen, and perches on the copy, so it is read
  // after the keep-out and sits in front of everything.
  float aCrow=0.0;
  if(uCrowOn>0.5){
    vec2 cc=(floor(px/uCellCrow)+0.5)*uCellCrow;
    // averaged over its own cell, a 3x3 tap at one cell spacing, which also takes the
    // facets out of a low poly model's shading
    vec2 st=cc/uRes, e=vec2(uCellCrow)/uRes;
    vec4 cr=vec4(0.0);
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      float wgt=(i==0?2.0:1.0)*(j==0?2.0:1.0);
      cr+=texture(uCrow, st+vec2(float(i)*e.x, float(j)*e.y))*wgt;
    }
    cr/=16.0;
    float ink=cr.r/max(cr.a,0.001);              // undo the premultiply
    float edge=1.0-smoothstep(0.25,0.95,cr.a);   // the silhouette reads as a dark outline
    ink=clamp(ink+0.3*edge,0.0,1.0);
    // the bird has its own depth: the far side of it thins out, as distance does in the
    // landscape, so the body turns away from the viewer instead of reading flat
    float crowNear=clamp(cr.g/max(cr.a,0.001),0.0,1.0);
    ink*=mix(1.0, 0.45+0.55*crowNear, uCrowFog);
    // the chain shares this buffer but has its own screen below
    float notChain=1.0-smoothstep(0.3,0.7,cr.b/max(cr.a,0.001));
    float crowCov=ink*smoothstep(0.1,0.5,cr.a)*uCrowInk*notChain;
    if(crowCov>=0.004){
      float rhoC=texture(uLut,vec2(crowCov,0.5)).r*0.75;
      float rC=rhoC*uCellCrow*mix(1.0, 0.72+0.56*crowNear, uRelief);
      float aaC=min(0.75,rC*0.9);
      aCrow=1.0-smoothstep(rC-aaC,rC+aaC,length(px-cc));
      aCrow*=mix(1.0, 0.18+0.82*crowCov, uDepth);
      covOut=max(covOut,crowCov);
    }
  }

  // ---- the pull chain, on a lattice of its own, about a pixel ----
  // Its beads are under 3px across: at the bird's pitch each would be a single dot. At this
  // pitch a bead is a few dots across, so its light and shadow come out as dot sizes.
  float aChain=0.0;
  if(uCrowOn>0.5){
    vec2 cq=(floor(px/uCellChain)+0.5)*uCellChain;
    vec2 sq=cq/uRes, eq=vec2(uCellChain*0.33)/uRes;
    vec4 ch=(texture(uCrow,sq)*2.0+texture(uCrow,sq+vec2(eq.x,0.0))+texture(uCrow,sq-vec2(eq.x,0.0))
            +texture(uCrow,sq+vec2(0.0,eq.y))+texture(uCrow,sq-vec2(0.0,eq.y)))/6.0;
    if(ch.a>0.02 && ch.b/ch.a>0.5){
      float ink=ch.r/ch.a;
      float near=clamp(ch.g/ch.a,0.0,1.0);
      ink*=mix(1.0, 0.5+0.5*near, uCrowFog);
      float cov=ink*smoothstep(0.08,0.5,ch.a);
      if(cov>=0.01){
        float rho=texture(uLut,vec2(cov,0.5)).r;
        float r=rho*uCellChain*mix(1.0, 0.8+0.4*near, uRelief);
        float aa=min(0.6,r*0.9);
        aChain=1.0-smoothstep(r-aa,r+aa,length(px-cq));
        covOut=max(covOut,cov);
      }
    }
  }

  float a=max(aScene,max(aCrow,aChain))*uOpacity;
  if(a<=0.002){ outColor=vec4(0.0); return; }

  vec3 placeInk=mix(uHueA,uHueB,tl);
  vec3 dotInk=mix(placeInk,uInk,smoothstep(0.22,0.88,covOut));
  outColor=vec4(mix(uInk,dotInk,uTint)*a, a);
}`;

function sh(t,src){const s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))console.error(gl.getShaderInfoLog(s));return s;}
const prog=gl.createProgram();
gl.attachShader(prog,sh(gl.VERTEX_SHADER,VS));
gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FS));
gl.linkProgram(prog); gl.useProgram(prog);
if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
const U={}; ["uSrcA","uSrcB","uLut","uXfA","uXfB","uToneA","uToneB","uBlueAB","uHueA","uHueB",
  "uInk","uDpr","uCell","uMix","uStagger","uDrift","uTint","uDepth","uTexW","uTextRect","uTextPad",
  "uSoftAB","uDetail","uOpacity","uDepA","uDepB","uPar","uFog","uRelief","uSway","uShowDep","uCrow","uRes","uCrowOn","uCrowInk","uCrowFog","uCellCrow","uCellChain"]
  .forEach(n=>U[n]=gl.getUniformLocation(prog,n));
const vao=gl.createVertexArray(); gl.bindVertexArray(vao);

// ---- crow pass ------------------------------------------------------------------------
// The point cloud is posed and projected on the CPU (src/crow.js) and splatted into an
// offscreen buffer as coverage. The halftone pass above reads that buffer, so the bird is
// drawn with the same dots as the landscape rather than pasted over it.
const crow=createCrow();
const crowVS=`#version 300 es
in vec4 aPos;                       // x px, y px, depth 0..1 (1 near), ink 0..1
uniform vec2 uRes; uniform float uDpr, uSize;
out float vDepth; out float vInk;
void main(){
  vDepth=aPos.z; vInk=aPos.w;
  vec2 p=aPos.xy*uDpr;
  // depth into clip z as well, so the near surface wins and we do not screen the far side
  gl_Position=vec4(p.x/uRes.x*2.0-1.0, 1.0-p.y/uRes.y*2.0, 1.0-aPos.z*2.0, 1.0);
  gl_PointSize=uSize*uDpr*(0.75+0.5*aPos.z);
}`;
const crowFS=`#version 300 es
precision highp float;
in float vDepth; in float vInk;
uniform float uFlag;                // 1 for the pull chain, which is screened on its own lattice
out vec4 outColor;
void main(){
  vec2 d=gl_PointCoord*2.0-1.0;
  float a=1.0-smoothstep(0.45,1.0,dot(d,d));   // soft edged splat, so the outline is not blocky
  if(a<=0.01) discard;
  outColor=vec4(vInk*a, vDepth*a, uFlag*a, a); // premultiplied, so blurring averages it
}`;
const crowProg=gl.createProgram();
gl.attachShader(crowProg,sh(gl.VERTEX_SHADER,crowVS));
gl.attachShader(crowProg,sh(gl.FRAGMENT_SHADER,crowFS));
gl.linkProgram(crowProg);
if(!gl.getProgramParameter(crowProg,gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(crowProg));
const CU={}; ["uRes","uDpr","uSize","uFlag"].forEach(n=>CU[n]=gl.getUniformLocation(crowProg,n));
const crowVAO=gl.createVertexArray(), crowBuf=gl.createBuffer();
let crowBufBytes=0;
gl.bindVertexArray(crowVAO);
gl.bindBuffer(gl.ARRAY_BUFFER,crowBuf);
const aPosLoc=gl.getAttribLocation(crowProg,"aPos");
gl.enableVertexAttribArray(aPosLoc);
gl.vertexAttribPointer(aPosLoc,4,gl.FLOAT,false,0,0);
gl.bindVertexArray(null);

let crowScreenScale=110;
const crowFB=gl.createFramebuffer(), crowTex=gl.createTexture(), crowDepth=gl.createRenderbuffer();
function crowTarget(w,h){
  gl.bindTexture(gl.TEXTURE_2D,crowTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.bindRenderbuffer(gl.RENDERBUFFER,crowDepth);
  gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
  gl.bindFramebuffer(gl.FRAMEBUFFER,crowFB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,crowTex,0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,crowDepth);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
}
// the pull chain (src/chain.js) is splatted into the same buffer, so the crow's screen turns
// it into the bird's dots; it has its own buffer, since its points arrive in page px
const chainVAO=gl.createVertexArray(), chainBuf=gl.createBuffer();
gl.bindVertexArray(chainVAO);
gl.bindBuffer(gl.ARRAY_BUFFER,chainBuf);
gl.enableVertexAttribArray(aPosLoc);
gl.vertexAttribPointer(aPosLoc,4,gl.FLOAT,false,0,0);
gl.bindVertexArray(null);
let chainLocal=new Float32Array(0);
function drawCrow(withCrow,chainN){
  gl.bindFramebuffer(gl.FRAMEBUFFER,crowFB);
  gl.viewport(0,0,cv.width,cv.height);
  gl.clearColor(0,0,0,0); gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  gl.useProgram(crowProg);
  gl.uniform2f(CU.uRes,cv.width,cv.height);
  gl.uniform1f(CU.uDpr,dpr);
  if(chainN){
    // page px to this canvas's px
    const r=cv.getBoundingClientRect(), src=chain.points;
    if(chainLocal.length<chainN*4) chainLocal=new Float32Array(src.length);
    for(let i=0;i<chainN*4;i+=4){ chainLocal[i]=src[i]-r.left; chainLocal[i+1]=src[i+1]-r.top; chainLocal[i+2]=src[i+2]; chainLocal[i+3]=src[i+3]; }
    gl.bindVertexArray(chainVAO); gl.bindBuffer(gl.ARRAY_BUFFER,chainBuf);
    gl.bufferData(gl.ARRAY_BUFFER,chainLocal.subarray(0,chainN*4),gl.DYNAMIC_DRAW);
    gl.uniform1f(CU.uSize,1.0); gl.uniform1f(CU.uFlag,1);
    gl.drawArrays(gl.POINTS,0,chainN);
    gl.uniform1f(CU.uFlag,0);
  }
  if(!withCrow){ gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.useProgram(prog); gl.bindVertexArray(vao); return; }
  gl.bindVertexArray(crowVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER,crowBuf);
  if(crowBufBytes!==crow.positions.byteLength){
    crowBufBytes=crow.positions.byteLength;
    gl.bufferData(gl.ARRAY_BUFFER,crowBufBytes,gl.DYNAMIC_DRAW);
  }
  gl.bufferSubData(gl.ARRAY_BUFFER,0,crow.positions);
  gl.uniform2f(CU.uRes,cv.width,cv.height);
  gl.uniform1f(CU.uDpr,dpr);
  // splat size follows the bird's size on screen, so its coverage stays solid at any scale
  gl.uniform1f(CU.uSize,+ctl.crowDot.value*crowScreenScale/110); gl.uniform1f(CU.uFlag,0);
  gl.drawArrays(gl.POINTS,0,crow.count);
  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
  gl.useProgram(prog); gl.bindVertexArray(vao);
}

gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
const tex={}, dep={}; let lutTex=null, ready=0;
{
  const im=new Image();
  im.onload=()=>{
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    lutTex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,lutTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true); ready++;
  };
  im.src=LUTSRC;
}
const NTEX=PLACES.length*2+1;      // art + depth per place, plus the dot LUT
PLACES.forEach(p=>{
  [["",tex],["-depth",dep]].forEach(([suffix,store])=>{
  const im=new Image();
  im.onload=()=>{
    const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    store[p.key]=t; ready++;
  };
  im.src=SRC[p.key].replace(/\.jpg$/,suffix+".jpg");
  });
});

const inkRGB=()=>getComputedStyle(document.body).color.match(/\d+(\.\d+)?/g).slice(0,3).map(x=>+x/255);
const hueFor=(p,ink)=>((ink[0]+ink[1]+ink[2])/3>0.5) ? p.hue.map(v=>1-v*0.55) : p.hue;

const copy=document.getElementById("copy");
let dpr=1,W=0,H=0;
let textRect=[0,0,0,0];
function resize(){
  document.documentElement.style.setProperty("--band-k", ctl.inset.value);
  dpr=Math.min(devicePixelRatio||1,2);
  const r=cv.getBoundingClientRect(); W=r.width; H=r.height;
  cv.width=Math.max(1,Math.round(W*dpr)); cv.height=Math.max(1,Math.round(H*dpr));
  gl.viewport(0,0,cv.width,cv.height);
  crowTarget(cv.width,cv.height);
  if(W<NARROW) layoutPhone(); else if(TABLET) layoutTablet(); else copy.style.top="";
  const t=copy.getBoundingClientRect();
  // canvas space: x from the band's left edge, y up from the band's bottom edge
  textRect=[t.left-r.left, r.bottom-t.bottom, t.right-r.left, r.bottom-t.top];
}
// What a phone browser actually leaves visible, which is neither svh nor lvh: iOS floats
// its toolbar over the page and moves it as you go. Measure it and let the CSS use it.
let lastVH=0;
function measureViewport(){
  const h=Math.round((window.visualViewport && window.visualViewport.height) || innerHeight);
  if(h===lastVH) return false;
  lastVH=h;
  document.documentElement.style.setProperty("--vh", h+"px");
  return true;
}
const remeasure=()=>{ if(measureViewport() && W) resize(); };
measureViewport();
if(window.visualViewport){
  visualViewport.addEventListener("resize",remeasure);
  visualViewport.addEventListener("scroll",remeasure);
}
addEventListener("orientationchange",()=>setTimeout(remeasure,250));
addEventListener("pageshow",remeasure);
// not every phone browser has its bars in place when the page first runs
[150,500,1200,2500].forEach(ms=>setTimeout(remeasure,ms));

addEventListener("resize",()=>{measureViewport();resize();labels();});   // zone sizes are relative, so their px readout moves too

// every image is drawn at the full matrix width and sits on the bottom edge.
// overflow is clipped at the top, which for all three is sky.
// The picture keeps its own centred band inside the full width canvas, never wider than the
// screen: the whole landscape stays visible, edge to edge, and is never cropped.
const NARROW=820, MIN_CELL=1.1;   // css px
// The crow's pitch has a floor of its own. It is the band over 593, which on a phone is about
// 0.6px, a single device pixel a dot: too fine to be dots at all, and the bird smeared into a
// few blotches. 0.8px is what he had there before he was made a quarter smaller.
const CROW_MIN_CELL=0.8;
// On a phone the picture is the fixed element and the copy is the one that moves. Sizing the
// picture from whatever room the copy left over made it depend on the browser: the width is
// that room times the aspect, so Comet's taller toolbar turned into a picture half the width
// of Safari's. Instead it takes a share of the screen width, which no browser changes, capped
// by a share of the height that is actually visible, and the copy is placed above it.
// Only when the copy cannot climb any higher does the picture give way.
// Every place is sized from the tallest aspect, so the three stay the same size through the
// morph and none can reach the text.
const GAP_ABOVE=20, GAP_BELOW=18, COPY_TOP_MIN=68;   // the logo ends at 51
const PHONE_W=0.94, PHONE_W_MIN=0.80, PHONE_H=0.32, PHONE_TOP=0.20;
const TALLEST=Math.min(...PLACES.map(p=>p.aspect));
let phoneW=0;
function layoutPhone(){
  const copyH=copy.offsetHeight;
  let w=Math.min(W*PHONE_W, H*PHONE_H*TALLEST);
  const floor=()=>H-GAP_BELOW-w/TALLEST-GAP_ABOVE;       // lowest the copy may end
  // The copy holds its place, a fifth of the way down, and the picture gives way first, to
  // PHONE_W_MIN of the width; only then does the copy climb, and after that the picture
  // shrinks again. Holding the copy at a share of the visible height keeps browsers alike:
  // with the copy climbing first, Comet's shorter screen squeezed it up toward the logo.
  let top=H*PHONE_TOP, over=top+copyH-floor();
  if(over>0) w=Math.max(Math.min(w, W*PHONE_W_MIN), w-over*TALLEST);
  top=Math.max(COPY_TOP_MIN, Math.min(top, floor()-copyH));
  over=top+copyH-floor();
  if(over>0) w=Math.max(120, w-over*TALLEST);
  phoneW=w;
  copy.style.top=Math.round(top)+"px";
}
// A tablet at desktop width gets the desktop layout, except that the copy is lifted when the
// picture would climb too far over it. The picture is height driven, so on a landscape iPad
// Paris reached three quarters of the way up the copy; the tallest place may now reach at most
// TABLET_REACH of it. Portrait iPads never get that far and are left where they are.
// Checked by touch points rather than pointer type, since an iPad with a trackpad reports a
// fine pointer; ?tablet forces it for testing on a desktop.
const TABLET=navigator.maxTouchPoints>1 || /[?&]tablet\b/.test(location.search), TABLET_REACH=0.45;
function layoutTablet(){
  const copyH=copy.offsetHeight, w=Math.min(+ctl.inset.value*H, W);
  const reach=(H-w/TALLEST)+copyH*TABLET_REACH-copyH;      // top that limits the overlap
  const floor=H*0.0518+27+56;                               // below the logo and caption
  copy.style.top=Math.round(Math.max(floor, Math.min(H*0.352, reach)))+"px";
}
function pictureFit(){
  if(W>=NARROW) return { w: Math.min(+ctl.inset.value*H, W), up: 0 };
  return { w: phoneW || W*PHONE_W, up: GAP_BELOW };
}
function bandW(){ return pictureFit().w; }
function xform(p,lift){
  const fit=pictureFit(), dw=fit.w, dh=dw/p.aspect;
  return [(W-dw)/2, -p.bleed*innerHeight + lift*dh + fit.up, dw, dh];
}

const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine=matchMedia("(pointer: fine)").matches;
const stage=document.getElementById("stage");
let mode=fine?"cursor":(matchMedia("(max-width:820px)").matches?"steps":"scroll");
let target=0, current=0, mouse=null, zone=0, last=performance.now();
let step=0;                     // which place a phone is showing, advanced by tapping

function setMode(m){
  mode=m; document.body.classList.toggle("cursor",m==="cursor");
  document.getElementById("mCursor").setAttribute("aria-pressed",m==="cursor");
  document.getElementById("mScroll").setAttribute("aria-pressed",m==="scroll");
  if(m==="scroll") mouse=null;
  requestAnimationFrame(()=>{resize();readTarget();});
}
document.getElementById("mCursor").onclick=()=>setMode("cursor");
document.getElementById("mScroll").onclick=()=>setMode("scroll");

if(location.hash==="#tune") document.body.classList.add("tune");
addEventListener("keydown",e=>{
  if(e.key==="t"&&!e.metaKey&&!e.ctrlKey&&!e.altKey) document.body.classList.toggle("tune");
});

const themes=[["thAuto",null],["thLight","light"],["thDark","dark"]];
themes.forEach(([id,v])=>document.getElementById(id).onclick=()=>{
  if(v) document.documentElement.setAttribute("data-theme",v);
  else  document.documentElement.removeAttribute("data-theme");
  themes.forEach(([j,w])=>document.getElementById(j).setAttribute("aria-pressed",w===v));
});

// The card, the leader, the hit area over the bird and the red dot pointer (src/crowui.js),
// shared with the other pages that have the bird.
const ui=createCrowUI({crow, fine, canvasWidth:()=>cv.getBoundingClientRect().width});
const dot=ui.dot;
addEventListener("pointermove",e=>{
  if(e.pointerType!=="mouse") return;
  mouse={x:e.clientX,y:e.clientY};
},{passive:true});
addEventListener("pointerleave",()=>{mouse=null;});
addEventListener("scroll",()=>readTarget(),{passive:true});

function readTarget(){
  const n=PLACES.length-1;
  if(mode==="cursor"){
    // nested zones around the copy: outside everything is Cassis, the middle ring is
    // Paris, the tight ring is New York. Each zone's edge sits a little further out once
    // you are inside it, so hovering on a boundary does not flicker between places.
    if(!mouse){ zone=0; target=0; return; }
    const r=copy.getBoundingClientRect();
    const dx=Math.max(r.left-mouse.x,0,mouse.x-r.right);
    const dy=Math.max(r.top-mouse.y,0,mouse.y-r.bottom);
    const d=Math.hypot(dx,dy);
    const within=(z,edge)=>d<=edge+(zone>=z?ZONE_HYST*zoneUnit()/100:0);
    zone = within(2,zonePx(ctl.zNy)) ? 2 : within(1,zonePx(ctl.zParis)) ? 1 : 0;
    target=Math.min(zone,n);
  } else if(mode==="steps"){
    target=Math.min(step,n);          // a phone steps through the places on a tap
  } else {
    const total=stage.offsetHeight-innerHeight;
    const done=Math.min(Math.max(-stage.getBoundingClientRect().top,0),total);
    target=(total>0?done/total:0)*n;
  }
}

// On a phone the caption is the control: it already names where you are and where you are
// going, so tapping it goes there. Nothing else on the page scrolls or swipes.
const captionEl=document.querySelector(".caption");
if(mode==="steps"){
  captionEl.setAttribute("role","button");
  captionEl.setAttribute("aria-label","Next place");
  captionEl.onclick=()=>{ step=(step+1)%PLACES.length; };
}

const nowEl=document.getElementById("now"), nextEl=document.getElementById("next"), barEl=document.getElementById("bar");
// zone sizes are a share of the band width, so they scale with the picture
const ZONE_HYST=0.9;                                   // % of the band, about 12px at 1330
const zoneUnit=()=>bandW()||band.getBoundingClientRect().width;
const zonePx=c=>+c.value/100*zoneUnit();
const ids=["crowSize","crowMin","crowMax","crowCells","crowDot","crowInk","crowFog","par","sens","fog","relief","morph","zNy","zParis","opacity","cells","stag","drift","depth","tint","detail","inset","gap","feather","lift","black","white","gamma","lc","blue","soft"];
const ctl={}; ids.forEach(i=>ctl[i]=document.getElementById(i));
let tuning=0;

function pushTone(){
  const t=PLACES[tuning].tone;
  t.black=+ctl.black.value; t.white=+ctl.white.value; t.gamma=+ctl.gamma.value;
  t.lc=+ctl.lc.value; t.blue=+ctl.blue.value; t.soft=+ctl.soft.value;
}
function pullTone(){
  const t=PLACES[tuning].tone;
  ctl.black.value=t.black; ctl.white.value=t.white; ctl.gamma.value=t.gamma;
  ctl.lc.value=t.lc; ctl.blue.value=t.blue; ctl.soft.value=t.soft;
}
function labels(){
  const s=(id,v)=>document.getElementById(id).textContent=v;
  s("vMorph",(+ctl.morph.value).toFixed(1)+" s"); s("vZNy",(+ctl.zNy.value).toFixed(1)+" % / "+Math.round(zonePx(ctl.zNy))+" px");
  s("vZParis",(+ctl.zParis.value).toFixed(1)+" % / "+Math.round(zonePx(ctl.zParis))+" px"); s("vOpacity",(+ctl.opacity.value).toFixed(2)); s("vCells",ctl.cells.value);
  s("vStag",(+ctl.stag.value).toFixed(2));   s("vDrift",(+ctl.drift.value).toFixed(1));
  s("vDepth",(+ctl.depth.value).toFixed(2)); s("vTint",(+ctl.tint.value).toFixed(2));
  s("vInset",(+ctl.inset.value).toFixed(2)+" vh"); s("vGap",ctl.gap.value+" px"); s("vFeather",ctl.feather.value+" px");
  s("vLift",(+ctl.lift.value).toFixed(2));   s("vBlack",(+ctl.black.value).toFixed(2));
  s("vWhite",(+ctl.white.value).toFixed(2)); s("vGamma",(+ctl.gamma.value).toFixed(2));
  s("vLc",(+ctl.lc.value).toFixed(2));       s("vBlue",(+ctl.blue.value).toFixed(2));
  s("vCrowSize",(+ctl.crowSize.value).toFixed(3)); s("vCrowCells",ctl.crowCells.value);
  s("vCrowMin",ctl.crowMin.value+" px"); s("vCrowMax",ctl.crowMax.value+" px"); s("vCrowDot",(+ctl.crowDot.value).toFixed(1));
  s("vCrowInk",(+ctl.crowInk.value).toFixed(2)); s("vCrowFog",(+ctl.crowFog.value).toFixed(2));
  s("vPar",(+ctl.par.value).toFixed(0)+" px"); s("vSens",(+ctl.sens.value).toFixed(1)+"x"); s("vFog",(+ctl.fog.value).toFixed(2));
  s("vRelief",(+ctl.relief.value).toFixed(2));
  s("vSoft",(+ctl.soft.value).toFixed(2));   s("vDetail",(+ctl.detail.value).toFixed(2));
  document.getElementById("tuneH").textContent="Tone — "+PLACES[tuning].label;
}
ids.forEach(i=>ctl[i].addEventListener("input",()=>{pushTone();labels();resize();}));

const tabs=[["tCassis",0],["tParis",1],["tNyc",2]];
tabs.forEach(([id,i])=>document.getElementById(id).onclick=()=>{
  tuning=i; tabs.forEach(([j,k])=>document.getElementById(j).setAttribute("aria-pressed",k===i));
  pullTone(); labels();
});
document.getElementById("reset").onclick=()=>{
  PLACES.forEach((p,i)=>p.tone=Object.assign({},DEFAULTS[i]));
  ctl.cells.value=311; ctl.stag.value=0.28; ctl.drift.value=0; ctl.depth.value=0;
  ctl.tint.value=0; ctl.detail.value=1; ctl.inset.value=0.96; ctl.gap.value=8; ctl.feather.value=14; ctl.lift.value=0;
  ctl.crowSize.value=0.048; ctl.crowMin.value=35; ctl.crowMax.value=56; ctl.crowCells.value=593; ctl.crowDot.value=2.7; ctl.crowInk.value=0.58; ctl.crowFog.value=0.5;
  ctl.par.value=26; ctl.sens.value=1.6; ctl.fog.value=0.35; ctl.relief.value=0.35;
  ctl.morph.value=1.6; ctl.zNy.value=5.3; ctl.zParis.value=10.5; ctl.opacity.value=0.61;
  pullTone(); labels(); resize();
};
document.getElementById("copyBtn").onclick=e=>{
  const cfg={
    dotsAcross:+ctl.cells.value, stagger:+ctl.stag.value, drift:+ctl.drift.value,
    opacityDepth:+ctl.depth.value, hue:+ctl.tint.value, detail:+ctl.detail.value,
    bandWidthVh:+ctl.inset.value, textKeepOutPx:+ctl.gap.value, keepOutFadePx:+ctl.feather.value, imageLift:+ctl.lift.value,
    morphSeconds:+ctl.morph.value, zoneNyPctOfBand:+ctl.zNy.value, zoneParisPctOfBand:+ctl.zParis.value,
    crowMinPx:+ctl.crowMin.value, crowMaxPx:+ctl.crowMax.value,
    inkOpacity:+ctl.opacity.value, parallaxPx:+ctl.par.value, tiltSensitivity:+ctl.sens.value, aerialFade:+ctl.fog.value,
    relief:+ctl.relief.value, tone:Object.fromEntries(PLACES.map(p=>[p.key,p.tone]))
  };
  navigator.clipboard?.writeText(JSON.stringify(cfg,null,2));
  e.target.textContent="Copied"; setTimeout(()=>e.target.textContent="Copy config",1200);
};
pullTone(); labels(); resize(); setMode(mode);
addEventListener("load",()=>resize());

const nameEl=document.getElementById("name");
if(GRAB) window.__crow=crow;            // ?grab also hands the bird to the console
document.getElementById("crowBtn").onclick=()=>{ ui.hide(); crow.replay(); };

const sway=[0,0];
// Light or dark, from the pull chain. The choice is remembered for the next visit (the
// default is still light), and the colours cross-fade for as long as html.theming is set.
let themeTimer=0;
function setTheme(dark){
  const root=document.documentElement;
  root.classList.add("theming");
  clearTimeout(themeTimer); themeTimer=setTimeout(()=>root.classList.remove("theming"),650);
  if(dark) root.setAttribute("data-theme","dark"); else root.removeAttribute("data-theme");
  try{ localStorage.setItem("theme",dark?"dark":"light"); }catch(e){}
}
const chain=createChain({
  fine, reduce, dot,
  getLean:()=>sway,                       // on a phone, tilting leans the chain too
  onPull:()=>setTheme(document.documentElement.getAttribute("data-theme")!=="dark"),
});
// The loading screen (src/loader.js). It covers the page until the sweep; the crow's arrival
// is restarted when the page is revealed, or he would already be perched behind it.
// ?noloader skips it, which the frame grabs and quick checks want. It plays once a visit:
// coming back from the Timeline page should not mean four more seconds of hourglass.
let loaderSeen=false;
try{ loaderSeen=sessionStorage.getItem("loaderSeen")==="1"; }catch(e){}
if(!/[?&]noloader\b/.test(location.search) && !loaderSeen){
  createLoader({
    mobile:!fine, reduce,
    isHeroReady:()=>ready===NTEX,
    enableTilt:()=>enableTilt(),
    onReveal:()=>{ crow.replay(); try{ sessionStorage.setItem("loaderSeen","1"); }catch(e){} },
  });
} else document.getElementById("loader").remove();
// Tilt. A touch screen has no cursor to lean toward, so the device's own tilt drives the same
// sway. The resting angle is however the hand happens to hold it, so the lean is measured from
// a baseline that follows the hand over a few seconds: a turn of the wrist moves the picture,
// holding still lets it settle back, and putting the phone down re-centres it.
// iOS only sends orientation after the visitor allows it, and will only ask from inside a
// gesture it trusts. So: a quiet check on load (if it was already allowed, tilt just starts),
// an "Enable tilt" button beside the logo, which is a gesture iOS always trusts, and any other
// tap also asks, until iOS gives a definite answer. The first version asked once, on the first
// tap anywhere, and gave up if iOS did not count that tap, so it never asked again.
// Android sends orientation without asking.
const TILT_RANGE=22;        // degrees from rest for a full lean (16 was a touch strong)
const TILT_SETTLE=3.5;      // seconds for the baseline to catch up with the hand
let tiltRaw=null, tiltBase=null, tiltState="off";   // off | ask | on | denied | reduced
function onTilt(e){
  if(e.beta==null||e.gamma==null) return;
  // in screen axes, whichever way up the device is held
  const a=(screen.orientation&&screen.orientation.angle)||window.orientation||0;
  let x=e.gamma, y=e.beta;
  if(a===90){ x=e.beta; y=-e.gamma; }
  else if(a===-90||a===270){ x=-e.beta; y=e.gamma; }
  else if(a===180){ x=-x; y=-y; }
  tiltRaw=[x,y];
}
if(!fine && reduce) tiltState="reduced";               // Reduce Motion is on: no tilt, by design
const tiltCapable=!fine && !reduce && "DeviceOrientationEvent" in window;
// iOS gates orientation behind a prompt it only shows from inside a tap; ?tilt skips the gate,
// for testing in a browser that will not grant it
const tiltGated=tiltCapable && typeof DeviceOrientationEvent.requestPermission==="function"
  && !/[?&]tilt\b/.test(location.search);
let tiltListening=false;
function listenTilt(){
  if(tiltListening) return; tiltListening=true; tiltState="on";
  addEventListener("deviceorientation",onTilt);
  stopAsking();
}
// Called from inside a tap: the loader's "Enable tilt" button, or any tap on the page until
// iOS has answered. Resolves once there is an answer, whatever it is.
function enableTilt(){
  if(!tiltCapable) return Promise.resolve();
  if(!tiltGated){ listenTilt(); return Promise.resolve(); }
  if(tiltListening) return Promise.resolve();
  return DeviceOrientationEvent.requestPermission()
    .then(r=>{ if(r==="granted") listenTilt(); else { tiltState="denied"; stopAsking(); } })
    .catch(()=>{});      // refused for want of a gesture: not an answer, so keep asking
}
const askOnTap=()=>{ enableTilt(); };
function stopAsking(){ removeEventListener("touchend",askOnTap); removeEventListener("click",askOnTap); }
if(tiltCapable){
  if(!tiltGated) listenTilt();
  else {
    tiltState="ask";
    // already allowed on an earlier visit? then it simply starts
    DeviceOrientationEvent.requestPermission().then(r=>{ if(r==="granted") listenTilt(); }).catch(()=>{});
    addEventListener("touchend",askOnTap); addEventListener("click",askOnTap);
  }
}
function tiltLean(dt){
  if(!tiltRaw) return null;
  if(!tiltBase) tiltBase=tiltRaw.slice();
  const k=1-Math.exp(-dt/TILT_SETTLE), out=[0,0];
  for(let i=0;i<2;i++){
    let d=tiltRaw[i]-tiltBase[i];
    if(Math.abs(d)>60){ tiltBase[i]=tiltRaw[i]; d=0; }    // wrapped past vertical: start again
    tiltBase[i]+=d*k;
    // eye position, as with the cursor: tipping the right edge away is looking from the left
    out[i]=Math.max(-1,Math.min(1,-d/TILT_RANGE));
  }
  return out;
}
// ?debug: what the device reports, for diagnosing a phone browser from a screenshot
if(/[?&]debug\b/.test(location.search)){
  const box=document.createElement("pre");
  box.style.cssText="position:fixed;left:8px;top:64px;z-index:30;margin:0;padding:6px 8px;"+
    "font:10px/1.35 ui-monospace,monospace;background:rgba(255,255,255,.88);color:#000;"+
    "border:1px solid #bbb;pointer-events:none;white-space:pre";
  document.body.append(box);
  const probe=u=>{ const d=document.createElement("div");
    d.style.cssText="position:fixed;left:-9px;top:0;width:1px;height:100"+u; document.body.append(d);
    const h=d.getBoundingClientRect().height; d.remove(); return Math.round(h); };
  const f=n=>n==null?"-":Math.round(n);
  setInterval(()=>{
    const c=copy.getBoundingClientRect(), vv=window.visualViewport;
    box.textContent=
      "inner      "+innerWidth+" x "+innerHeight+"\n"+
      "visual vp  "+(vv?f(vv.width)+" x "+f(vv.height)+" @"+f(vv.offsetTop):"-")+"\n"+
      "client     "+document.documentElement.clientHeight+"\n"+
      "svh/lvh/dvh "+probe("svh")+" / "+probe("lvh")+" / "+probe("dvh")+"\n"+
      "screen     "+screen.width+" x "+screen.height+"\n"+
      "canvas     "+f(W)+" x "+f(H)+"  pic "+f(bandW())+"\n"+
      "copy       "+f(c.top)+" - "+f(c.bottom)+"\n"+
      "tilt       "+tiltState+(tiltRaw?"  x "+f(tiltRaw[0])+"  y "+f(tiltRaw[1]):"")+"\n"+
      "sway       "+sway[0].toFixed(2)+", "+sway[1].toFixed(2)+"\n"+
      "reduce "+reduce+"  fine "+fine+"  touch "+navigator.maxTouchPoints;
  },200);
}
let showDep=false;
document.getElementById("depBtn").onclick=e=>{
  showDep=!showDep; e.target.setAttribute("aria-pressed",showDep);
};

const zoneEls=[...document.querySelectorAll(".zone")];
let showZones=false;
document.getElementById("zonesBtn").onclick=e=>{
  showZones=!showZones; e.target.setAttribute("aria-pressed",showZones);
};
function drawZones(){
  const on=showZones && mode==="cursor";
  zoneEls.forEach(el=>el.hidden=!on);
  if(!on) return;
  const r=copy.getBoundingClientRect();
  [zonePx(ctl.zParis),zonePx(ctl.zNy)].forEach((m,k)=>{
    const s=zoneEls[k].style;
    s.left=(r.left-m)+"px"; s.top=(r.top-m)+"px";
    s.width=(r.width+2*m)+"px"; s.height=(r.height+2*m)+"px"; s.borderRadius=m+"px";
    zoneEls[k].classList.toggle("on",zone===k+1);
  });
}

function frame(){
  readTarget();
  const now=performance.now(), dt=Math.min((now-last)/1000,0.1); last=now;
  if(reduce) current=target;
  else if(mode==="cursor"){
    // fixed-duration steps: one place per morph period, passing through Paris on the way
    const step=dt/Math.max(+ctl.morph.value,0.1);
    current += Math.max(-step,Math.min(step,target-current));
  } else {
    current += (target-current)*0.09;
    if(Math.abs(target-current)<0.0004) current=target;
  }
  drawZones();

  // the viewpoint leans toward the cursor; everything else follows from the depth map
  const r=cv.getBoundingClientRect();
  // sensitivity shrinks the travel needed for a full tilt, so small moves read
  const k=+ctl.sens.value;
  const lean=tiltLean(dt);
  const want=mouse&&!reduce
    ? [Math.max(-1,Math.min(1,(mouse.x-(r.left+r.width/2))/(r.width/2)*k)),
       Math.max(-1,Math.min(1,(mouse.y-(r.top+r.height/2))/(r.height/2)*k))]
    : lean || [0,0];
  const ease=1-Math.pow(1-0.12,dt*60);   // frame rate independent, snappier than before
  sway[0]+=(want[0]-sway[0])*ease;
  sway[1]+=(want[1]-sway[1])*ease;

  // the crow stands on the name, feet just above the type
  const nameR=nameEl.getBoundingClientRect(), cvr=cv.getBoundingClientRect();
  // His size follows the band, which runs away on a large screen and collapses on a phone,
  // so it is held between a floor and a ceiling: proportionally bigger on small windows,
  // smaller on big ones, and unchanged around a laptop.
  const crowScale=Math.max(+ctl.crowMin.value,
                  Math.min(bandW()*(+ctl.crowSize.value), +ctl.crowMax.value));
  crowScreenScale=crowScale;
  const alive=crow.update(reduce?0.016:dt,{
    w:cvr.width, h:cvr.height,
    perchX:nameR.left+nameR.width*0.62-cvr.left,
    perchY:nameR.top-cvr.top-1,
    sway, scale:crowScale, reduce
  });
  const chainN=chain?chain.count:0, crowOn=!!(alive&&crow.count);
  if(crowOn||chainN) drawCrow(crowOn,chainN);
  ui.update(cvr);

  if(ready===NTEX){
    const i=Math.min(Math.floor(current),PLACES.length-2), f0=current-i;
    const f=mode==="cursor" ? f0*f0*(3-2*f0) : f0;   // ease each timed step in and out
    const A=PLACES[i], B=PLACES[i+1], lift=+ctl.lift.value, ink=inkRGB();

    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,tex[A.key]); gl.uniform1i(U.uSrcA,0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,tex[B.key]); gl.uniform1i(U.uSrcB,1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,lutTex);     gl.uniform1i(U.uLut,2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D,dep[A.key]); gl.uniform1i(U.uDepA,3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D,dep[B.key]); gl.uniform1i(U.uDepB,4);

    gl.uniform4fv(U.uXfA,xform(A,lift)); gl.uniform4fv(U.uXfB,xform(B,lift));
    gl.uniform4f(U.uToneA,A.tone.black,A.tone.white,A.tone.gamma,A.tone.lc);
    gl.uniform4f(U.uToneB,B.tone.black,B.tone.white,B.tone.gamma,B.tone.lc);
    gl.uniform2f(U.uBlueAB,A.tone.blue,B.tone.blue);
    gl.uniform2f(U.uSoftAB,A.tone.soft,B.tone.soft);
    gl.uniform1f(U.uDetail,+ctl.detail.value);
    gl.uniform1f(U.uOpacity,+ctl.opacity.value);
    gl.uniform1f(U.uPar,reduce?0:+ctl.par.value);
    gl.uniform1f(U.uFog,+ctl.fog.value);
    gl.uniform1f(U.uRelief,+ctl.relief.value);
    gl.uniform2f(U.uSway,sway[0],sway[1]);
    gl.uniform1f(U.uShowDep,showDep?1:0);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D,crowTex); gl.uniform1i(U.uCrow,5);
    gl.uniform2f(U.uRes,cv.width/dpr,cv.height/dpr);
    gl.uniform1f(U.uCrowOn,crowOn||chainN?1:0);
    gl.uniform1f(U.uCrowInk,+ctl.crowInk.value);
    gl.uniform1f(U.uCrowFog,+ctl.crowFog.value);
    gl.uniform1f(U.uCellCrow,Math.max(bandW()/+ctl.crowCells.value, CROW_MIN_CELL));
    gl.uniform1f(U.uCellChain,Math.max(1.05,2/dpr));      // about a pixel, two device pixels at least
    gl.uniform3fv(U.uHueA,hueFor(A,ink)); gl.uniform3fv(U.uHueB,hueFor(B,ink));
    gl.uniform3fv(U.uInk,ink);
    gl.uniform1f(U.uDpr,dpr);
    gl.uniform1f(U.uCell,Math.max(bandW()/+ctl.cells.value, MIN_CELL));
    gl.uniform1f(U.uMix,f);
    gl.uniform1f(U.uStagger,+ctl.stag.value);
    gl.uniform1f(U.uDrift,reduce?0:+ctl.drift.value);
    gl.uniform1f(U.uTint,+ctl.tint.value);
    gl.uniform1f(U.uDepth,+ctl.depth.value);
    gl.uniform2f(U.uTexW,A.texW,B.texW);
    gl.uniform4fv(U.uTextRect,textRect);
    gl.uniform2f(U.uTextPad,+ctl.gap.value,+ctl.feather.value);
    gl.drawArrays(gl.TRIANGLES,0,3);

    nowEl.textContent=A.label; nextEl.textContent=B.label;
    barEl.style.width=(f*100).toFixed(1)+"%";
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
}
