import {createCrow} from "./crow.js";

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
uniform float uCrowOn,uCrowInk,uCrowFog,uCellCrow;
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
    float crowCov=ink*smoothstep(0.1,0.5,cr.a)*uCrowInk;
    if(crowCov>=0.004){
      float rhoC=texture(uLut,vec2(crowCov,0.5)).r*0.75;
      float rC=rhoC*uCellCrow*mix(1.0, 0.72+0.56*crowNear, uRelief);
      float aaC=min(0.75,rC*0.9);
      aCrow=1.0-smoothstep(rC-aaC,rC+aaC,length(px-cc));
      aCrow*=mix(1.0, 0.18+0.82*crowCov, uDepth);
      covOut=max(covOut,crowCov);
    }
  }

  float a=max(aScene,aCrow)*uOpacity;
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
  "uSoftAB","uDetail","uOpacity","uDepA","uDepB","uPar","uFog","uRelief","uSway","uShowDep","uCrow","uRes","uCrowOn","uCrowInk","uCrowFog","uCellCrow"]
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
out vec4 outColor;
void main(){
  vec2 d=gl_PointCoord*2.0-1.0;
  float a=1.0-smoothstep(0.45,1.0,dot(d,d));   // soft edged splat, so the outline is not blocky
  if(a<=0.01) discard;
  outColor=vec4(vInk*a, vDepth*a, 0.0, a);     // premultiplied, so blurring averages it
}`;
const crowProg=gl.createProgram();
gl.attachShader(crowProg,sh(gl.VERTEX_SHADER,crowVS));
gl.attachShader(crowProg,sh(gl.FRAGMENT_SHADER,crowFS));
gl.linkProgram(crowProg);
if(!gl.getProgramParameter(crowProg,gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(crowProg));
const CU={}; ["uRes","uDpr","uSize"].forEach(n=>CU[n]=gl.getUniformLocation(crowProg,n));
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
function drawCrow(){
  gl.bindFramebuffer(gl.FRAMEBUFFER,crowFB);
  gl.viewport(0,0,cv.width,cv.height);
  gl.clearColor(0,0,0,0); gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  gl.useProgram(crowProg); gl.bindVertexArray(crowVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER,crowBuf);
  if(crowBufBytes!==crow.positions.byteLength){
    crowBufBytes=crow.positions.byteLength;
    gl.bufferData(gl.ARRAY_BUFFER,crowBufBytes,gl.DYNAMIC_DRAW);
  }
  gl.bufferSubData(gl.ARRAY_BUFFER,0,crow.positions);
  gl.uniform2f(CU.uRes,cv.width,cv.height);
  gl.uniform1f(CU.uDpr,dpr);
  // splat size follows the bird's size on screen, so its coverage stays solid at any scale
  gl.uniform1f(CU.uSize,+ctl.crowDot.value*crowScreenScale/110);
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
  const t=copy.getBoundingClientRect();
  // canvas space: x from the band's left edge, y up from the band's bottom edge
  textRect=[t.left-r.left, r.bottom-t.bottom, t.right-r.left, r.bottom-t.top];
}
addEventListener("resize",()=>{resize();labels();});   // zone sizes are relative, so their px readout moves too

// every image is drawn at the full matrix width and sits on the bottom edge.
// overflow is clipped at the top, which for all three is sky.
// The picture keeps its own centred band inside the full width canvas, never wider than the
// screen: the whole landscape stays visible, edge to edge, and is never cropped.
const NARROW=820, NARROW_RAISE=0.06;
function bandW(){ return Math.min(+ctl.inset.value*H, W); }
// On a phone the picture is only as tall as the screen is wide, which leaves it stranded at
// the very bottom with a gap above. Lift it clear of the fold instead of cropping it.
function raise(){ return W<NARROW ? H*NARROW_RAISE : 0; }
function xform(p,lift){
  const dw=bandW(), dh=dw/p.aspect;
  return [(W-dw)/2, -p.bleed*innerHeight + lift*dh + raise(), dw, dh];
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

// A dot instead of a pointer. Drawn as an element rather than a cursor image so it stays
// crisp on a retina screen; it is moved in the pointer handler itself, not in the frame
// loop, so it does not lag behind the hand.
const dot=document.getElementById("dot");
if(fine){
  document.body.classList.add("dotted");
  addEventListener("pointerdown",()=>dot.classList.add("down"));
  addEventListener("pointerup",()=>dot.classList.remove("down"));
  addEventListener("pointerleave",()=>dot.classList.remove("on"));
}
addEventListener("pointermove",e=>{
  if(e.pointerType!=="mouse") return;
  mouse={x:e.clientX,y:e.clientY};
  if(fine){ dot.style.transform="translate3d("+e.clientX+"px,"+e.clientY+"px,0)"; dot.classList.add("on"); }
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
  ctl.crowSize.value=0.064; ctl.crowMin.value=46; ctl.crowMax.value=74; ctl.crowCells.value=445; ctl.crowDot.value=2.7; ctl.crowInk.value=0.58; ctl.crowFog.value=0.5;
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
const crowHit=document.getElementById("crowHit");
if(GRAB) window.__crow=crow;            // ?grab also hands the bird to the console
const crowCard=document.getElementById("crowCard");
const crowLead=document.getElementById("crowLead");
const crowLeadPath=crowLead.querySelector("path");

// The card is a hover on the bird, and only while he is actually still: not in flight, not
// for the first second on the perch, and gone the moment he leaves.
const SETTLE=1.0;                       // seconds on the perch before the hover answers
let cardWanted=false, cardOn=false;
function showCard(on){
  cardWanted=on;
  if(on===cardOn) return;
  cardOn=on;
  document.body.classList.toggle("crow-card",on);
  crowCard.setAttribute("aria-hidden",String(!on));
}
crowHit.onmouseenter=()=>{ if(fine){ showCard(true); dot.classList.add("over"); } };
crowHit.onmouseleave=()=>{ if(fine){ showCard(false); dot.classList.remove("over"); } };
crowHit.onclick=()=>{
  // With a mouse the card is already open on hover, so a click sends him off. By touch
  // there is no hover: the first tap opens the card, the second sends him off.
  if(!fine && !cardOn){ showCard(true); return; }
  showCard(false); dot.classList.remove("over");
  crow.click(cv.getBoundingClientRect().width);
};
// a tap anywhere else puts the card away again
addEventListener("pointerdown",e=>{
  if(!fine && cardOn && !crowHit.contains(e.target)) showCard(false);
},{passive:true});
document.getElementById("crowBtn").onclick=()=>{ showCard(false); crow.replay(); };

// The leader: a dashed hop off the bird, a 45 degree run, then a short horizontal into the
// card's edge. The card is placed first and clamped to the window, then the leader is built
// from wherever it landed: off his right shoulder, his left, or straight up when the card
// sits over him, which is what happens on a phone. Same motif, just shorter.
const LEAD_RISE=75, CARD_MID=61, EDGE=12, HOP=8, OVER_GAP=22;
function placeCard(cvr){
  const [x0,y0,x1,y1]=crow.bbox;
  const vw=innerWidth, vh=innerHeight;
  const cw=crowCard.offsetWidth, ch=crowCard.offsetHeight;
  const bl=cvr.left+x0, br=cvr.left+x1, bt=cvr.top+y0, bb=cvr.top+y1;
  const rise=Math.max(14, Math.min(LEAD_RISE, bt-EDGE-CARD_MID));

  // room to the right, as in the design; failing that the left; failing both, above him
  let side=0;
  if(br-10+rise+22.5+cw<=vw-EDGE) side=1;
  else if(bl+10-rise-22.5-cw>=EDGE) side=-1;

  let left, top, ax, ay, entryX, entryY, corner=0;
  if(side){
    ax=side>0?br-10:bl+10; ay=bt+2;
    left=side>0 ? ax+rise+22.5 : ax-rise-22.5-cw;
    left=Math.max(EDGE, Math.min(left, vw-EDGE-cw));
    top=Math.max(EDGE, Math.min(ay-rise-CARD_MID, vh-EDGE-ch));
    entryX=side>0?left:left+cw;
    entryY=Math.max(top+8, Math.min(top+CARD_MID, top+ch-8));
    corner=ax+side*Math.max(0, ay-entryY);                  // 45 degrees out of the hop
    const limit=entryX-side*6;                              // always leave a little run
    if(side>0 ? corner>limit : corner<limit) corner=limit;
  } else {
    // no room either side, so above him, or below when the card is taller than the space
    // over his head. That is the usual case on a phone.
    ax=(bl+br)/2;
    const above=bt-OVER_GAP-ch>=EDGE;
    left=Math.max(EDGE, Math.min(ax-cw/2, vw-EDGE-cw));
    if(above){ ay=bt-2; top=Math.max(EDGE, ay-OVER_GAP-ch); entryY=top+ch; }
    else { ay=bb+2; top=Math.min(vh-EDGE-ch, ay+OVER_GAP); entryY=top; }
    entryX=Math.max(left+24, Math.min(ax, left+cw-24));
  }
  crowCard.style.left=left+"px"; crowCard.style.top=top+"px";

  // no room to draw it without crossing him: better no line than a line into his back
  const room=side ? true : Math.abs(ay-entryY)>=8;
  crowLead.style.display=room?"":"none";
  if(!room) return;

  const xs=[ax,entryX].concat(side?[corner]:[]), pad=10;
  const lx=Math.min(...xs)-pad, ly=Math.min(entryY,ay)-pad;
  crowLead.style.left=lx+"px"; crowLead.style.top=ly+"px";
  crowLead.setAttribute("width",(Math.max(...xs)-lx+pad)+"");
  crowLead.setAttribute("height",(Math.max(ay,entryY)-ly+pad)+"");
  const P=(x,y)=>(x-lx).toFixed(1)+" "+(y-ly).toFixed(1);
  const span=Math.abs(ay-entryY);
  const g=Math.min(HOP, Math.max(4, span*0.35));             // the dashes shrink with it
  const hx=side?side*g:(entryX>ax?g*0.4:-g*0.4);
  const hy=(entryY<ay?-1:1)*g;
  crowLeadPath.setAttribute("d",
    "M "+P(ax,ay)+" L "+P(ax+hx*0.45,ay+hy*0.45)+
    " M "+P(ax+hx*0.72,ay+hy*0.72)+" L "+P(ax+hx,ay+hy)+
    " M "+P(ax+hx*1.25,ay+hy*1.25)+
    (side ? " L "+P(corner,entryY)+" L "+P(entryX,entryY)
          : " L "+P(entryX,entryY)));
}

const sway=[0,0];
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
  const want=mouse&&!reduce
    ? [Math.max(-1,Math.min(1,(mouse.x-(r.left+r.width/2))/(r.width/2)*k)),
       Math.max(-1,Math.min(1,(mouse.y-(r.top+r.height/2))/(r.height/2)*k))]
    : [0,0];
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
  if(alive&&crow.count) drawCrow();
  const still=crow.phase==="perched"&&crow.state.t>SETTLE;
  crowHit.hidden=!still;
  if(still){
    const [x0,y0,x1,y1]=crow.bbox;
    crowHit.style.left=(cvr.left+x0-6)+"px"; crowHit.style.top=(cvr.top+y0-6)+"px";
    crowHit.style.width=(x1-x0+12)+"px"; crowHit.style.height=(y1-y0+12)+"px";
    if(cardWanted){ showCard(true); placeCard(cvr); }
  } else if(cardOn||cardWanted){
    showCard(false); cardWanted=false;      // he moved: the card goes with him
    dot.classList.remove("over");
  }

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
    gl.uniform1f(U.uCrowOn,alive&&crow.count?1:0);
    gl.uniform1f(U.uCrowInk,+ctl.crowInk.value);
    gl.uniform1f(U.uCrowFog,+ctl.crowFog.value);
    gl.uniform1f(U.uCellCrow,bandW()/+ctl.crowCells.value);
    gl.uniform3fv(U.uHueA,hueFor(A,ink)); gl.uniform3fv(U.uHueB,hueFor(B,ink));
    gl.uniform3fv(U.uInk,ink);
    gl.uniform1f(U.uDpr,dpr);
    gl.uniform1f(U.uCell,bandW()/+ctl.cells.value);
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
