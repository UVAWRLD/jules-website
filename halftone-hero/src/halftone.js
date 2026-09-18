const SRC = { cassis:"/img/cassis.jpg", paris:"/img/paris.jpg", nyc:"/img/nyc.jpg" };
const LUTSRC = "/img/dot-lut.png";

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
const gl=cv.getContext("webgl2",{antialias:false,alpha:true,premultipliedAlpha:true});
if(gl){
gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

const VS=`#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;

const FS=`#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uSrcA,uSrcB,uLut;
uniform vec4  uXfA,uXfB,uToneA,uToneB;
uniform vec2  uBlueAB,uSoftAB;
uniform vec3  uHueA,uHueB,uInk;
uniform float uDpr,uCell,uMix,uStagger,uDrift,uTint,uDepth,uDetail,uOpacity;
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
float coverage(sampler2D t, vec4 xf, vec4 tone, float blueW, vec2 c, vec2 p, float lod, float detail){
  // tone is read at the cell centre, then pulled toward the value under this pixel so
  // edges can cut through a dot (threshold screening) instead of every dot being round
  vec2 uv=mix(c,p,detail);
  uv=(uv-xf.xy)/xf.zw;
  if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) return 0.0;
  vec3 w=mix(LUMA,BLUEF,blueW);
  float d =1.0-dot(textureLod(t,uv,lod).rgb,w);
  float db=1.0-dot(textureLod(t,uv,lod+1.32).rgb,w);
  d=clamp(d+tone.w*(d-db),0.0,1.0);
  float cov=pow(clamp((d-tone.x)/max(tone.y-tone.x,0.02),0.0,1.0), tone.z);
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
  float cov=mix(coverage(uSrcA,uXfA,uToneA,uBlueAB.x,c,px,lodA,uDetail),
                coverage(uSrcB,uXfB,uToneB,uBlueAB.y,c,px,lodB,uDetail), tl);
  if(cov<0.004){ outColor=vec4(0.0); return; }

  // keep clear of the text block: whole dots are dropped, judged at the cell centre
  vec2 q = max(uTextRect.xy - c, c - uTextRect.zw);
  float dText = length(max(q,0.0)) + min(max(q.x,q.y),0.0);
  float clear = smoothstep(uTextPad.x, uTextPad.x + max(uTextPad.y,0.5), dText);
  if(clear <= 0.001){ outColor=vec4(0.0); return; }

  float rho=texture(uLut,vec2(cov,0.5)).r*0.75;
  float r=rho*uCell;
  float aa=min(0.75,r*0.9);
  float a=1.0-smoothstep(r-aa,r+aa,length(px-c));

  // the reference art is not pure dots: part of its ink is continuous tone
  a=mix(a,cov,mix(uSoftAB.x,uSoftAB.y,tl));

  // opacity carries the same signal as size, so light dots sit further back
  a *= mix(1.0, 0.18+0.82*cov, uDepth) * clear * uOpacity;

  vec3 placeInk=mix(uHueA,uHueB,tl);
  vec3 dotInk=mix(placeInk,uInk,smoothstep(0.22,0.88,cov));
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
  "uSoftAB","uDetail","uOpacity"]
  .forEach(n=>U[n]=gl.getUniformLocation(prog,n));
gl.bindVertexArray(gl.createVertexArray());

gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
const tex={}; let lutTex=null, ready=0;
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
PLACES.forEach(p=>{
  const im=new Image();
  im.onload=()=>{
    const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    tex[p.key]=t; ready++;
  };
  im.src=SRC[p.key];
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
  const t=copy.getBoundingClientRect();
  // canvas space: x from the band's left edge, y up from the band's bottom edge
  textRect=[t.left-r.left, r.bottom-t.bottom, t.right-r.left, r.bottom-t.top];
}
addEventListener("resize",()=>{resize();labels();});   // zone sizes are relative, so their px readout moves too

// every image is drawn at the full matrix width and sits on the bottom edge.
// overflow is clipped at the top, which for all three is sky.
function xform(p,lift){
  const dw=W, dh=W/p.aspect;
  return [0, -p.bleed*innerHeight + lift*dh, dw, dh];
}

const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine=matchMedia("(pointer: fine)").matches;
const stage=document.getElementById("stage");
let mode=fine?"cursor":"scroll", target=0, current=0, mouse=null, zone=0, last=performance.now();

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

addEventListener("pointermove",e=>{if(e.pointerType==="mouse")mouse={x:e.clientX,y:e.clientY};},{passive:true});
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
  } else {
    const total=stage.offsetHeight-innerHeight;
    const done=Math.min(Math.max(-stage.getBoundingClientRect().top,0),total);
    target=(total>0?done/total:0)*n;
  }
}

const nowEl=document.getElementById("now"), nextEl=document.getElementById("next"), barEl=document.getElementById("bar");
// zone sizes are a share of the band width, so they scale with the picture
const ZONE_HYST=0.9;                                   // % of the band, about 12px at 1330
const zoneUnit=()=>band.getBoundingClientRect().width;
const zonePx=c=>+c.value/100*zoneUnit();
const ids=["morph","zNy","zParis","opacity","cells","stag","drift","depth","tint","detail","inset","gap","feather","lift","black","white","gamma","lc","blue","soft"];
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
  ctl.morph.value=1; ctl.zNy.value=5.3; ctl.zParis.value=10.5; ctl.opacity.value=0.61;
  pullTone(); labels(); resize();
};
document.getElementById("copyBtn").onclick=e=>{
  const cfg={
    dotsAcross:+ctl.cells.value, stagger:+ctl.stag.value, drift:+ctl.drift.value,
    opacityDepth:+ctl.depth.value, hue:+ctl.tint.value, detail:+ctl.detail.value,
    bandWidthVh:+ctl.inset.value, textKeepOutPx:+ctl.gap.value, keepOutFadePx:+ctl.feather.value, imageLift:+ctl.lift.value,
    morphSeconds:+ctl.morph.value, zoneNyPctOfBand:+ctl.zNy.value, zoneParisPctOfBand:+ctl.zParis.value,
    inkOpacity:+ctl.opacity.value, tone:Object.fromEntries(PLACES.map(p=>[p.key,p.tone]))
  };
  navigator.clipboard?.writeText(JSON.stringify(cfg,null,2));
  e.target.textContent="Copied"; setTimeout(()=>e.target.textContent="Copy config",1200);
};
pullTone(); labels(); resize(); setMode(mode);
addEventListener("load",()=>resize());

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

  if(ready===PLACES.length+1){
    const i=Math.min(Math.floor(current),PLACES.length-2), f0=current-i;
    const f=mode==="cursor" ? f0*f0*(3-2*f0) : f0;   // ease each timed step in and out
    const A=PLACES[i], B=PLACES[i+1], lift=+ctl.lift.value, ink=inkRGB();

    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,tex[A.key]); gl.uniform1i(U.uSrcA,0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,tex[B.key]); gl.uniform1i(U.uSrcB,1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,lutTex);     gl.uniform1i(U.uLut,2);

    gl.uniform4fv(U.uXfA,xform(A,lift)); gl.uniform4fv(U.uXfB,xform(B,lift));
    gl.uniform4f(U.uToneA,A.tone.black,A.tone.white,A.tone.gamma,A.tone.lc);
    gl.uniform4f(U.uToneB,B.tone.black,B.tone.white,B.tone.gamma,B.tone.lc);
    gl.uniform2f(U.uBlueAB,A.tone.blue,B.tone.blue);
    gl.uniform2f(U.uSoftAB,A.tone.soft,B.tone.soft);
    gl.uniform1f(U.uDetail,+ctl.detail.value);
    gl.uniform1f(U.uOpacity,+ctl.opacity.value);
    gl.uniform3fv(U.uHueA,hueFor(A,ink)); gl.uniform3fv(U.uHueB,hueFor(B,ink));
    gl.uniform3fv(U.uInk,ink);
    gl.uniform1f(U.uDpr,dpr);
    gl.uniform1f(U.uCell,W/+ctl.cells.value);
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
