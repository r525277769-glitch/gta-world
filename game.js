import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const root = document.querySelector("#game");
const loading = document.querySelector("#loading");
const hint = document.querySelector("#hint");
const errorBox = document.querySelector("#error");
const joystick = document.querySelector("#joystick");
const stick = document.querySelector("#stick");
const runButton = document.querySelector("#run");
const actionButton = document.querySelector("#action");
const walletHud = document.querySelector("#wallet");
const missionHud = document.querySelector("#mission");
const missionTitle = missionHud.querySelector("strong");
const missionSub = missionHud.querySelector("span");

let scene, camera, renderer, clock, player, sun;
let yaw = 0, pitch = 0.18, moveX = 0, moveZ = 0, running = false;
let joyPointer = null, lookPointer = null, lastX = 0, lastY = 0;
let walkTime = 0;
const colliders = [];
const traffic = [];
let npc, missionPackage, grammPickup, parkedCar, driving = false;
let missionState = "new", cash = 0, gramm = 0, actionTarget = null, actionRefresh = 0;
const SAVE_KEY = "gtaworld-save-v1";
try {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
  missionState = saved.missionState || "new";
  cash = Number(saved.cash) || 0;
  gramm = Number(saved.gramm) || 0;
} catch {}
const gltfLoader = new GLTFLoader();
const assetCache = new Map();
let playerMixer = null;
let playerActions = {};
let activePlayerAction = null;
const ASSET_ROOT = "https://raw.githubusercontent.com/kayquer/kit-cidade-lowpoly/main/models/";
const KENNEY_ROOT = "https://raw.githubusercontent.com/shorepine/kenney/main/3d/mini-characters/";
const mats = {};
const isMobile = matchMedia("(max-width: 700px)").matches;
const quality = {
  // Mobile GPUs need a lighter render path; desktop keeps the richer lighting.
  shadows: !isMobile,
  shadowSize: isMobile ? 1024 : 2048,
  pixelRatio: isMobile ? 1.2 : 1.8,
  minPixelRatio: isMobile ? 0.75 : 1.0
};
let adaptiveFrameMs = 16.7;
let adaptiveCheckTime = 0;

const palette = {
  asphalt: 0x30383d, concrete: 0xb8b5aa, curb: 0xd0c8b7,
  grass: 0x718c69, sky: 0xa7cbd8
};

function loadAsset(url) {
  if (!assetCache.has(url)) {
    assetCache.set(url, new Promise((resolve, reject) => {
      gltfLoader.load(url, gltf => resolve(gltf), undefined, reject);
    }));
  }
  return assetCache.get(url);
}
function fitModel(source, target, maxHeight = 24, cloneSource = true) {
  const model = cloneSource ? source.clone(true) : source;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = Math.min(target.x / Math.max(size.x,.001), target.z / Math.max(size.z,.001), maxHeight / Math.max(size.y,.001));
  model.scale.setScalar(scale);
  model.position.set(-center.x*scale, -bounds.min.y*scale, -center.z*scale);
  model.traverse(o => {
    if (o.isMesh) { o.castShadow = quality.shadows; o.receiveShadow = true; }
  });
  return model;
}
let toonGradient;
function mat(color, roughness = 0.78, extra = {}) {
  // Bold, stepped lighting gives props and street furniture a stylized battle-royale look.
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient || null, ...extra });
}
function createToonGradient() {
  const data = new Uint8Array([82, 148, 210, 255]);
  toonGradient = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  toonGradient.minFilter = THREE.NearestFilter;
  toonGradient.magFilter = THREE.NearestFilter;
  toonGradient.generateMipmaps = false;
  toonGradient.needsUpdate = true;
}
function cartoonizeModel(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const convert = source => {
      if (!source || source.isMeshToonMaterial) return source;
      const material = new THREE.MeshStandardMaterial({
        color: source.color ? source.color.clone() : 0xffffff,
        map: source.map || null,
        alphaMap: source.alphaMap || null,
        normalMap: source.normalMap || null,
        roughnessMap: source.roughnessMap || null,
        metalnessMap: source.metalnessMap || null,
        aoMap: source.aoMap || null,
        emissive: source.emissive ? source.emissive.clone() : 0x000000,
        emissiveMap: source.emissiveMap || null,
        roughness: source.roughness ?? 0.82,
        metalness: source.metalness ?? 0.04,
        transparent: source.transparent || false,
        opacity: source.opacity ?? 1,
        side: source.side
      });
      material.vertexColors = source.vertexColors;
      material.skinning = source.skinning;
      material.morphTargets = source.morphTargets;
      return material;
    };
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
    o.castShadow = quality.shadows;
    o.receiveShadow = true;
  });
}
function box(parent, x, y, z, w, h, d, material, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function cylinder(parent, x, y, z, rt, rb, h, material, sides = 10) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, sides), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = quality.shadows;
  parent.add(mesh);
  return mesh;
}
function canvasTexture(draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext("2d");
  draw(ctx, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = Math.min(isMobile ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}
function makeTextures() {
  // High-resolution procedural materials: layered grass, stone paving and facade finishes.
  const grassTexture = canvasTexture((c,w,h) => {
    c.fillStyle = "#667f55"; c.fillRect(0,0,w,h);
    // Irregular color patches prevent the ground from reading as a flat green carpet.
    for(let i=0;i<1700;i++){
      const r=8+Math.random()*58, x=Math.random()*w, y=Math.random()*h;
      c.fillStyle=Math.random()>.5?"rgba(145,166,91,.10)":"rgba(28,57,35,.12)";
      c.beginPath();c.ellipse(x,y,r,r*(.35+Math.random()*.7),Math.random()*Math.PI,0,Math.PI*2);c.fill();
    }
    // Fine blades and tiny clumps remain visible at street level.
    for(let i=0;i<18000;i++){
      const x=Math.random()*w,y=Math.random()*h,len=2+Math.random()*10;
      c.strokeStyle=Math.random()>.52?"rgba(190,202,123,.30)":"rgba(25,53,31,.30)";
      c.lineWidth=.7+Math.random()*1.1;c.beginPath();c.moveTo(x,y);c.lineTo(x+(Math.random()-.5)*4,y-len);c.stroke();
    }
    for(let i=0;i<8000;i++){
      c.fillStyle="rgba(220,211,151,"+(Math.random()*.10)+")";
      c.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*2,1+Math.random()*2);
    }
  }, 11, 11);
  const grassBump = canvasTexture((c,w,h) => {
    c.fillStyle="#777";c.fillRect(0,0,w,h);
    for(let i=0;i<22000;i++){const v=75+Math.random()*120;c.fillStyle="rgb("+v+","+v+","+v+")";c.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*3,1+Math.random()*3);}
  },11,11);
  mats.grass = new THREE.MeshToonMaterial({map:grassTexture,gradientMap:toonGradient});

  const pavementTexture = canvasTexture((c,w,h) => {
    c.fillStyle="#aaa99f";c.fillRect(0,0,w,h);
    const tile=128;
    for(let y=0;y<h;y+=tile) for(let x=0;x<w;x+=tile){
      const v=165+Math.floor(Math.random()*25);
      c.fillStyle="rgb("+v+","+(v-2)+","+(v-9)+")";c.fillRect(x+3,y+3,tile-6,tile-6);
      c.fillStyle="rgba(255,255,245,.24)";c.fillRect(x+4,y+4,tile-8,2);c.fillRect(x+4,y+4,2,tile-8);
      c.fillStyle="rgba(55,58,57,.30)";c.fillRect(x+4,y+tile-6,tile-8,2);c.fillRect(x+tile-6,y+4,2,tile-8);
      for(let k=0;k<150;k++){
        c.fillStyle="rgba(48,51,49,"+(Math.random()*.12)+")";
        c.fillRect(x+Math.random()*tile,y+Math.random()*tile,1+Math.random()*3,1+Math.random()*3);
      }
    }
    // Scuffs, hairline cracks and subtle dirt near slab edges.
    for(let i=0;i<180;i++){
      const x=Math.random()*w,y=Math.random()*h;
      c.strokeStyle="rgba(65,66,61,.16)";c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(x+4+Math.random()*18,y+2+Math.random()*12);c.stroke();
    }
  }, 8, 8);
  const pavementBump=canvasTexture((c,w,h)=>{
    c.fillStyle="#888";c.fillRect(0,0,w,h);
    for(let i=0;i<16000;i++){const v=95+Math.random()*95;c.fillStyle="rgb("+v+","+v+","+v+")";c.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*2,1+Math.random()*2);}
  },8,8);
  mats.sidewalk = new THREE.MeshToonMaterial({map:pavementTexture,gradientMap:toonGradient});

  const asphalt=canvasTexture((c,w,h)=>{
    c.fillStyle="#292f33";c.fillRect(0,0,w,h);
    for(let i=0;i<18000;i++){const v=Math.random()>.5?210:95;c.fillStyle="rgba("+v+","+v+","+v+","+(Math.random()*.13)+")";c.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*2,1+Math.random()*2);}
    for(let i=0;i<65;i++){const x=Math.random()*w,y=Math.random()*h;c.strokeStyle="rgba(12,15,16,.22)";c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(x+Math.random()*25,y+Math.random()*8);c.stroke();}
  },5,5);
  mats.road = new THREE.MeshToonMaterial({map:asphalt,gradientMap:toonGradient});

  mats.white = mat(0xf1eee3);
  mats.yellow = mat(0xf4c64d,.75);
  mats.dark = mat(0x20272c);
  mats.glass = mat(0x416675,.24,{metalness:.35});
  mats.glassLight = mat(0x9ac4c8,.28,{metalness:.2});
  mats.leaf=[mat(0x416c43),mat(0x5d824b),mat(0x78945a)];
  mats.trunk=mat(0x76553d);
  mats.lamp=mat(0xffe6a3,.35,{emissive:0xffbd57,emissiveIntensity:.45});

  mats.facades=[0xb9a58f,0x9aa9a7,0xc9c0ad,0x9caaa9,0xc1b29f,0x858f94,0xd0c5b1].map((color,index)=>
    canvasTexture((c,w,h)=>{
      const base="#"+color.toString(16).padStart(6,"0");c.fillStyle=base;c.fillRect(0,0,w,h);
      // Fine stucco / concrete grain with subtle color variation.
      for(let i=0;i<24000;i++){
        const alpha=Math.random()*.13, light=Math.random()>.5;
        c.fillStyle=light?"rgba(255,245,225,"+alpha+")":"rgba(25,34,38,"+alpha+")";
        c.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*3,1+Math.random()*3);
      }
      for(let y=0;y<h;y+=128){
        c.fillStyle="rgba(38,46,48,.17)";c.fillRect(0,y,w,3);
        c.fillStyle="rgba(255,255,245,.15)";c.fillRect(0,y+4,w,2);
      }
      // Brick / cladding courses visible between the modeled windows.
      if(index===0||index===4||index===6){
        for(let y=8;y<h;y+=24) for(let x=(Math.floor(y/24)%2)*32;x<w;x+=64){
          c.strokeStyle="rgba(83,66,52,.16)";c.lineWidth=1;c.strokeRect(x,y,64,24);
        }
      } else {
        for(let x=0;x<w;x+=128){c.fillStyle="rgba(38,50,54,.10)";c.fillRect(x,0,3,h);}
      }
      // Recessed-looking blue glass panes; geometry frames and sills sit above them.
      for(let y=20;y<h-24;y+=128) for(let x=16;x<w-16;x+=128){
        c.fillStyle="rgba(28,43,50,.28)";c.fillRect(x-4,y-4,88,78);
        c.fillStyle=index%2?"#607f88":"#496b78";c.fillRect(x,y,80,68);
        c.fillStyle="rgba(218,237,231,.42)";c.fillRect(x+6,y+5,5,56);
        c.fillStyle="rgba(255,255,255,.12)";c.fillRect(x+14,y+6,60,2);
      }
      // Weathering streaks beneath roof edges.
      for(let i=0;i<34;i++){const x=Math.random()*w,y=Math.random()*h;c.fillStyle="rgba(55,58,53,"+(Math.random()*.08)+")";c.fillRect(x,y,1+Math.random()*4,8+Math.random()*42);}
    },1,1)
  );
}

function addRoads() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420,420), mats.grass);
  ground.rotation.x = -Math.PI/2; ground.position.y = -0.12; ground.receiveShadow = true; scene.add(ground);
  const roadW = 14, step = 44, curb = mat(0xd8d2c5), white = mat(0xe8e6dc), yellow = mat(0xf2c94c);
  for (let i=-4;i<=4;i++) {
    const p=i*step;
    const v=new THREE.Mesh(new THREE.PlaneGeometry(roadW,420),mats.road);
    v.rotation.x=-Math.PI/2; v.position.set(p,.012,0); v.receiveShadow=true; scene.add(v);
    const h=new THREE.Mesh(new THREE.PlaneGeometry(420,roadW),mats.road);
    h.rotation.x=-Math.PI/2; h.position.set(0,.013,p); h.receiveShadow=true; scene.add(h);
    for (const side of [-1,1]) {
      const off=10.1*side;
      const sv=new THREE.Mesh(new THREE.PlaneGeometry(6.2,420),mats.sidewalk);
      sv.rotation.x=-Math.PI/2; sv.position.set(p+off,.025,0); sv.receiveShadow=true; scene.add(sv);
      const sh=new THREE.Mesh(new THREE.PlaneGeometry(420,6.2),mats.sidewalk);
      sh.rotation.x=-Math.PI/2; sh.position.set(0,.026,p+off); sh.receiveShadow=true; scene.add(sh);
      box(scene,p+side*7.22,.11,0,.44,.22,420,curb,false);
      box(scene,0,.11,p+side*7.22,420,.22,.44,curb,false);
    }
    for (const o of [-.16,.16]) {
      box(scene,p+o,.035,0,.11,.025,420,yellow,false);
      box(scene,0,.036,p+o,420,.025,.11,yellow,false);
    }
    for (const lane of [-3.35,3.35]) for(let z=-200;z<=200;z+=13) {
      box(scene,p+lane,.034,z,.075,.022,5.2,white,false);
      box(scene,z,.035,p+lane,5.2,.022,.075,white,false);
    }
  }
  // Zebra crossings only at the central junction; all other road corridors stay unobstructed.
  for(const side of [-1,1]) for(let n=-3;n<=3;n++) {
    const t=n*1.55;
    box(scene,t,.045,side*9.7,.82,.035,3,mats.white,false);
    box(scene,side*9.7,.046,t,3,.035,.82,mats.white,false);
  }
}
function createBuilding(x,z,index) {
  const district = x >= 110 ? "industrial" : x <= -110 ? "residential" : (Math.abs(x) <= 66 && Math.abs(z) <= 66 ? "business" : "commercial");
  const isTower = district === "business";
  const w = district === "industrial" ? 16+(index%2)*2 : 13+(index%3)*2;
  const d = district === "industrial" ? 16 : 12+(index%2)*2;
  const floors = isTower ? 12+(index%6) : district === "residential" ? 2+(index%3) : district === "industrial" ? 2+(index%2) : 4+(index*7%4);
  const floorH=3.15, h=floors*floorH;
  const group=new THREE.Group(); group.position.set(x,0,z); scene.add(group);
  const facade=mats.facades[index%mats.facades.length];
  const body=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshToonMaterial({map:facade,gradientMap:toonGradient}));
  body.position.y=h/2+.22; body.castShadow=true; body.receiveShadow=true; group.add(body);

  const trim=mat(0xd4c9b7), darkTrim=mat(0x465257), glass=mat(index%4===0?0x8bb7c2:0x527583,.2,{metalness:.28}), glassLit=mat(0xe7c98d,.28,{emissive:0x6b4a20,emissiveIntensity:.12});
  const frameGeo=new THREE.BoxGeometry(2.05,1.72,.16), paneGeo=new THREE.BoxGeometry(1.78,1.45,.08);
  const cols=3, rows=Math.max(2,floors-1), winX=[];
  for(let c=0;c<cols;c++) winX.push((c-(cols-1)/2)*(w/(cols+.45)));
  const frames=[], panes=[];
  for(let r=0;r<rows;r++) for(const wx of winX) {
    const wy=1.15+r*floorH;
    frames.push(new THREE.Vector3(wx,wy,d/2+.11));
    panes.push(new THREE.Vector3(wx,wy,d/2+.205));
  }
  const frameInst=new THREE.InstancedMesh(frameGeo,trim,frames.length);
  const paneInst=new THREE.InstancedMesh(paneGeo,glass,panes.length);
  const dummy=new THREE.Object3D();
  frames.forEach((p,i)=>{dummy.position.copy(p);dummy.updateMatrix();frameInst.setMatrixAt(i,dummy.matrix);});
  panes.forEach((p,i)=>{dummy.position.copy(p);dummy.updateMatrix();paneInst.setMatrixAt(i,dummy.matrix);});
  frameInst.castShadow=false; paneInst.castShadow=false; group.add(frameInst,paneInst);

  // Side windows add depth to the building when viewed from the street corners.
  const sideFrameGeo=new THREE.BoxGeometry(.16,1.72,1.85), sidePaneGeo=new THREE.BoxGeometry(.08,1.45,1.58);
  const sideFrames=[],sidePanes=[];
  for(let r=0;r<rows;r++) for(const side of [-1,1]) {
    for(let c=0;c<2;c++) {
      const wz=(c-.5)*(d/2.3), wy=1.15+r*floorH;
      sideFrames.push(new THREE.Vector3(side*(w/2+.11),wy,wz));
      sidePanes.push(new THREE.Vector3(side*(w/2+.205),wy,wz));
    }
  }
  const sf=new THREE.InstancedMesh(sideFrameGeo,trim,sideFrames.length);
  const sp=new THREE.InstancedMesh(sidePaneGeo,glass,sidePanes.length);
  sideFrames.forEach((p,i)=>{dummy.position.copy(p);dummy.updateMatrix();sf.setMatrixAt(i,dummy.matrix);});
  sidePanes.forEach((p,i)=>{dummy.position.copy(p);dummy.updateMatrix();sp.setMatrixAt(i,dummy.matrix);});
  sf.castShadow=false;sp.castShadow=false;group.add(sf,sp);

  // Vertical facade piers and floor bands make the silhouette less like a plain box.
  for(let c=0;c<=cols;c++) {
    const px=(c-(cols/2))*(w/(cols+.45));
    box(group,px,h/2+.22,d/2+.25,.13,h,.12,darkTrim,false);
  }
  for(let r=0;r<=floors;r++) box(group,0,r*floorH+.28,d/2+.27,w+.35,.13,.16,trim,false);

  // Street-level shopfront with a distinct signboard and illuminated display windows.
  const shopWidth=w*.78;
  box(group,0,1.55,d/2+.28,shopWidth,1.72,.18,glassLit,false);
  box(group,0,2.72,d/2+.39,w*.88,.48,.24,mat([0x284b5c,0x704638,0x37614d,0x5c4a70][index%4]),false);
  const signCanvas=document.createElement("canvas"); signCanvas.width=512; signCanvas.height=128;
  const sc=signCanvas.getContext("2d");
  sc.fillStyle=["#244653","#754532","#315b45","#534365"][index%4];sc.fillRect(0,0,512,128);
  sc.fillStyle="#f4ead4";sc.font="bold 54px Arial";sc.textAlign="center";sc.textBaseline="middle";
  const signWords = district === "industrial" ? ["LOGISTICS","WAREHOUSE","WORKSHOP","DEPOT"] : district === "residential" ? ["RESIDENCE","APARTMENTS","HOMES","LIVING"] : district === "business" ? ["FINANCE","OFFICES","TOWER","BUSINESS"] : ["MARKET","DOWNTOWN","CAFE","AUTO SHOP"];
  sc.fillText(signWords[index%4],256,66);
  const signTex=new THREE.CanvasTexture(signCanvas);signTex.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(w*.82,.39),new THREE.MeshBasicMaterial({map:signTex}));
  sign.position.set(0,2.72,d/2+.52);group.add(sign);
  box(group,0,.48,d/2+.29,w*.86,.18,.32,darkTrim,false);

  // Deep window reveals, projecting sills and vertical mullions: these are real geometry,
  // not just a flat window texture, and remain inexpensive through instancing.
  const sillGeo=new THREE.BoxGeometry(2.18,.13,.34);
  const sillInst=new THREE.InstancedMesh(sillGeo,trim,frames.length);
  frames.forEach((p,i)=>{dummy.position.set(p.x,p.y-.91,p.z+.06);dummy.updateMatrix();sillInst.setMatrixAt(i,dummy.matrix);});
  sillInst.castShadow=false;group.add(sillInst);
  const mullionGeo=new THREE.BoxGeometry(.07,1.48,.1);
  const mullions=new THREE.InstancedMesh(mullionGeo,darkTrim,frames.length);
  frames.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z+.07);dummy.updateMatrix();mullions.setMatrixAt(i,dummy.matrix);});
  mullions.castShadow=false;group.add(mullions);

  // Projecting facade-mounted air conditioners beneath selected windows.
  if(index%3===1) for(let r=0;r<rows;r++) {
    const wx=winX[(r+index)%winX.length], wy=1.15+r*floorH-.98;
    box(group,wx,wy,d/2+.48,1.05,.48,.48,mat(0x929b98),false);
    for(let vent=0;vent<3;vent++) box(group,wx-.25+vent*.25,wy,d/2+.735,.045,.31,.035,darkTrim,false);
  }
  // Rainwater downpipes give corners a visible architectural edge.
  for(const side of [-1,1]) {
    cylinder(group,side*(w/2+.13),h/2+.2,d/2+.12,.055,.055,h+.1,darkTrim,8);
    box(group,side*(w/2+.13),.2,d/2+.23,.11,.4,.12,darkTrim,false);
  }

  // Selected buildings get projecting balconies with railings and visible supports.
  if(index%2===0) for(let floor=1;floor<floors;floor+=2) {
    const y=floor*floorH+1.1;
    for(const side of [-1,1]) {
      const bx=side*w*.25;
      box(group,bx,y,d/2+.48,w*.34,.13,.95,trim,false);
      box(group,bx,y+.39,d/2+.91,w*.34,.08,.08,darkTrim,false);
      for(let k=-2;k<=2;k++) box(group,bx+k*w*.065,y+.2,d/2+.91,.055,.38,.055,darkTrim,false);
      box(group,bx-w*.17,y+.2,d/2+.48,.07,.42,.08,darkTrim,false);
      box(group,bx+w*.17,y+.2,d/2+.48,.07,.42,.08,darkTrim,false);
    }
  }

  // District-specific silhouettes make the expanded map read as distinct neighborhoods.
  if(isTower) {
    // Tall glass office towers: corner ribs, crown cap and a red aviation beacon.
    for(const side of [-1,1]) for(const front of [-1,1]) {
      box(group,side*(w/2-.18),h/2+.22,front*(d/2+.12),.24,h+.1,.22,mat(index%2?0x536b75:0x334f60),false);
    }
    box(group,0,h+.62,0,w+.9,.72,d+.9,mat(0x354b59),false);
    box(group,0,h+1.02,0,w*.55,.12,d*.55,mat(0x9bb7b9),false);
    cylinder(group,0,h+1.55,0,.07,.07,1.0,mat(0xd9d7ce),8);
    const beacon=new THREE.Mesh(new THREE.SphereGeometry(.16,8,8),mat(0xff3b32,.3,{emissive:0xd71912,emissiveIntensity:.8}));
    beacon.position.set(0,h+2.1,0);group.add(beacon);
  }
  if(district==="industrial") {
    // Industrial roof plant, loading-bay doors and two exhaust stacks.
    for(let bay=0;bay<2;bay++) {
      const bx=(bay-.5)*w*.48;
      box(group,bx,1.55,d/2+.28,w*.38,2.35,.2,mat(0x46565a),false);
      box(group,bx,1.55,d/2+.4,w*.29,2.0,.08,mat(0x8a9a98),false);
      for(let slat=0;slat<5;slat++) box(group,bx,0.8+slat*.32,d/2+.46,w*.28,.055,.04,darkTrim,false);
    }
    for(let stack=0;stack<2;stack++) {
      const sx=(stack-.5)*w*.55;
      cylinder(group,sx,h+1.5,-d*.2,.42,.58,3.0,mat(0x777e7b),12);
      cylinder(group,sx,h+3.05,-d*.2,.48,.48,.18,darkTrim,12);
    }
  }
  if(district==="residential") {
    // Shorter residential blocks get a pitched, colored roof and small balconies.
    const roof=new THREE.Mesh(new THREE.ConeGeometry(Math.max(w,d)*.78,2.4,4),mat(index%2?0x765b4a:0x59666a));
    roof.rotation.y=Math.PI/4;roof.position.set(0,h+1.25,0);roof.castShadow=quality.shadows;group.add(roof);
    for(const side of [-1,1]) box(group,side*w*.29,1.65,d/2+.45,w*.28,.12,.72,mat(0xb6aa98),false);
  }

  // Roof parapets, vents and HVAC equipment.
  box(group,0,h+.47,0,w+.5,.5,d+.5,darkTrim,false);
  box(group,0,h+.74,0,w-.2,.12,d-.2,mat(0x777d78),false);
  for(let side of [-1,1]) {
    box(group,side*(w/2-.12),h+.78,0,.2,.58,d+.25,trim,false);
    box(group,0,h+.78,side*(d/2-.12),w+.25,.58,.2,trim,false);
  }
  for(let unit=0;unit<2;unit++) {
    const ux=(unit-.5)*w*.38, uz=-d*.18;
    box(group,ux,h+1.2,uz,2.25,1.05,1.85,mat(0x737d7d),false);
    box(group,ux,h+1.76,uz,1.55,.12,1.35,darkTrim,false);
    for(let vent=0;vent<4;vent++) box(group,ux-0.7+vent*.46,h+1.2,uz+.94,.12,.68,.06,mat(0x4a5557),false);
  }
  if(index%3===0) {
    cylinder(group,w*.27,h+1.2,d*.17,.68,.68,1.9,mat(0x899895),14);
    cylinder(group,w*.27,h+2.2,d*.17,.12,.12,.25,darkTrim,10);
  }
  // Fire escape ladder on selected side walls for a lived-in city feel.
  if(index%4===1) {
    const side=w/2+.25;
    for(let r=0;r<floors;r++) {
      box(group,side,r*floorH+1.1,0,.1,.1,d*.62,darkTrim,false);
      for(let zStep=-2;zStep<=2;zStep++) box(group,side,r*floorH+1.3,zStep*1.05,.07,.48,.07,darkTrim,false);
    }
    for(const zSide of [-d*.31,d*.31]) box(group,side,h/2+.3,zSide,.09,h,.09,darkTrim,false);
  }

  colliders.push({x,z,w:w+1.3,d:d+1.3});
  if(index%5===0) {
    // Small street tree in a planter, positioned within the building setback.
    const planter=box(group,-w*.38,.32,d/2+2.0,1.5,.55,1.5,mat(0x77786b),false);
    const trunk=cylinder(group,-w*.38,1.45,d/2+2.0,.13,.19,2.3,mats.trunk,8);
    const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.05,1),mats.leaf[index%3]);
    crown.position.set(-w*.38,2.65,d/2+2.0);crown.scale.set(1,1.15,1);crown.castShadow=quality.shadows;group.add(crown);
  }
}
function addParkGrass(cx,cz) {
  // Three crossed, tapered blades per clump create a readable 3D lawn silhouette.
  const vertices=[],indices=[];
  for(let blade=0;blade<3;blade++){
    const a=blade*Math.PI/3,wx=Math.cos(a)*.075,wz=Math.sin(a)*.075;
    const leanX=Math.cos(a+1.1)*.11,leanZ=Math.sin(a+1.1)*.11;
    const b=vertices.length/3,h=.42+(blade%2)*.09;
    vertices.push(-wx,0,-wz,wx,0,wz,wx*.18+leanX,h,wz*.18+leanZ,
      -wx,0,-wz,wx*.18+leanX,h,wz*.18+leanZ,-wx*.18+leanX,h,-wz*.18+leanZ);
    indices.push(b,b+1,b+2,b+3,b+4,b+5);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  geo.setIndex(indices);geo.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,side:THREE.DoubleSide});
  const count=isMobile?1050:1650,field=new THREE.InstancedMesh(geo,material,count),dummy=new THREE.Object3D();
  const colors=[new THREE.Color(0x527b38),new THREE.Color(0x6f9844),new THREE.Color(0x91ad53),new THREE.Color(0x3e6732),new THREE.Color(0xb1bd68)];
  let placed=0,tries=0;
  while(placed<count&&tries<count*10){
    tries++;
    const x=(Math.random()-.5)*16.7,z=(Math.random()-.5)*16.7;
    if(Math.abs(x)<1.35||Math.abs(z)<1.35)continue;
    if([[-6,-6],[6,-6],[-6,6],[6,6]].some(([tx,tz])=>Math.hypot(x-tx,z-tz)<1.65))continue;
    dummy.position.set(cx+x,.035,cz+z);
    dummy.rotation.y=Math.random()*Math.PI*2;
    const scale=.72+Math.random()*.9;
    dummy.scale.set(scale,.72+Math.random()*.9,scale);
    dummy.updateMatrix();field.setMatrixAt(placed,dummy.matrix);
    field.setColorAt(placed,colors[Math.floor(Math.random()*colors.length)]);placed++;
  }
  field.count=placed;field.castShadow=false;field.receiveShadow=true;scene.add(field);
}
function addCity() {
  let id=0;
  const centers=[-154,-110,-66,-22,22,66,110,154];
  for(const bx of centers) for(const bz of centers) {
    if(Math.abs(bx)===22 && Math.abs(bz)===22) continue;
    createBuilding(bx,bz,id++);
  }
  // Four pocket parks are contained inside the four central blocks, not on the roads.
  for(const [cx,cz] of [[-22,-22],[22,-22],[-22,22],[22,22]]) {
    const lawn=new THREE.Mesh(new THREE.PlaneGeometry(18,18),mats.grass);
    lawn.rotation.x=-Math.PI/2; lawn.position.set(cx,.02,cz); lawn.receiveShadow=true; scene.add(lawn);
    addParkGrass(cx,cz);
    const walk1=new THREE.Mesh(new THREE.PlaneGeometry(12,2.1),mats.sidewalk);
    walk1.rotation.x=-Math.PI/2; walk1.position.set(cx,.04,cz); scene.add(walk1);
    const walk2=new THREE.Mesh(new THREE.PlaneGeometry(2.1,12),mats.sidewalk);
    walk2.rotation.x=-Math.PI/2; walk2.position.set(cx,.041,cz); scene.add(walk2);
    for(const [dx,dz] of [[-6,-6],[6,-6],[-6,6],[6,6]]) addTree(cx+dx,cz+dz,.52);
    for(const side of [-1,1]) {
      const bx=cx+side*4;
      box(scene,bx,.55,cz,2.1,.17,.58,mat(0x80583b),false);
      box(scene,bx,.8,cz-.22,2.1,.55,.13,mat(0x80583b),false);
      for(const leg of [-.75,.75]) box(scene,bx+leg,.27,cz,.12,.54,.12,mat(0x343a3c),false);
    }
  }
  // The four-way intersection stays completely clear for traffic and pedestrians.
}
function addTree(x, z, scale = 1) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  scene.add(group);
  cylinder(group, 0, 1.35, 0, .25, .38, 2.7, mats.trunk, 9);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 2), mats.leaf[Math.floor(Math.abs(x + z)) % 3]);
  crown.position.y = 3.25;
  crown.scale.set(1, 1.25, .95);
  crown.castShadow = quality.shadows;
  crown.receiveShadow = true;
  group.add(crown);
  const crown2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 2), mats.leaf[1]);
  crown2.position.set(.7, 3.6, .2);
  crown2.scale.set(1.08,1.12,1.05);
  crown2.castShadow = quality.shadows;
  group.add(crown2);
  for(const [px,py,pz,sc,mi] of [[-.78,3.05,.25,.72,0],[.15,4.12,-.48,.68,2],[-.35,3.7,.72,.58,1]]) {
    const cluster=new THREE.Mesh(new THREE.IcosahedronGeometry(1,2),mats.leaf[mi]);
    cluster.position.set(px,py,pz);cluster.scale.set(sc,sc*1.08,sc);
    cluster.castShadow=quality.shadows;cluster.receiveShadow=true;group.add(cluster);
  }
}

function addStreetFurniture() {
  for(let road=-4;road<=4;road++) for(const side of [-1,1]) for(let block=-3;block<=3;block++) {
    const x=road*44+side*10.1, z=block*44+22;
    cylinder(scene,x,3, z,.075,.11,6,mat(0x303a3d),10);
    box(scene,x+side*.55,5.85,z,.9,.11,.16,mat(0x303a3d));
    const bulb=new THREE.Mesh(new THREE.SphereGeometry(.17,10,8),mats.lamp);
    bulb.position.set(x+side*.98,5.72,z); bulb.castShadow=false; scene.add(bulb);
  }
  for(const [x,z] of [[10.8,10.8],[-10.8,10.8],[10.8,-10.8],[-10.8,-10.8]]) {
    cylinder(scene,x,2,z,.11,.14,4,mat(0x303a3e),10);
    box(scene,x,3.85,z,.58,1.5,.38,mat(0x20282b));
    for(let i=0;i<3;i++) {
      const colors=[0xff453f,0xf3c84c,0x65d477], glows=[0x8f1712,0x806017,0x174f28];
      const light=new THREE.Mesh(new THREE.SphereGeometry(.13,10,8),mat(colors[i],.3,{emissive:glows[i],emissiveIntensity:.35}));
      light.position.set(x,4.25-i*.43,z+.21); scene.add(light);
    }
  }
}
function makeCar(color,x,z,rotation=0) {
  const group=new THREE.Group();group.position.set(x,.25,z);group.rotation.y=rotation;scene.add(group);
  const bodyMat=mat(color,.38,{metalness:.22});
  box(group,0,.55,0,2.15,.68,4.2,bodyMat);
  box(group,0,1.05,-.25,1.72,.78,2.15,mat(0x344b57,.2,{metalness:.25}));
  box(group,0,1.06,-.25,1.56,.6,2.0,mat(0x72929b,.18,{metalness:.28,transparent:true,opacity:.78}));
  box(group,0,1.48,-.25,1.9,.1,2.3,bodyMat);
  for(const sx of [-1,1]){
    for(const sz of [-1.35,1.35]){
      const wheel=cylinder(group,sx*1.08,.35,sz,.39,.39,.22,mat(0x171b1d),12);
      wheel.rotation.z=Math.PI/2;
      const hub=cylinder(group,sx*1.205,.35,sz,.17,.17,.035,mat(0x9ba2a1),10);
      hub.rotation.z=Math.PI/2;
    }
    box(group,sx*.72,.62,2.12,.35,.18,.12,mat(0xffe3a1,.25,{emissive:0x8c5b20,emissiveIntensity:.25}),false);
    box(group,sx*.72,.62,-2.12,.35,.18,.12,mat(0xe34d40),false);
  }
  box(group,0,.24,0,1.5,.08,3.5,mat(0x22272a),false);
  const modelPath = Math.random() < .18 ? "veiculos/taxi.glb" : "veiculos/carro.glb";
  loadAsset(ASSET_ROOT + modelPath).then(gltf => {
    const imported = fitModel(gltf.scene, new THREE.Vector3(2.2, 1.8, 4.25), 1.8);
    cartoonizeModel(imported);
    group.clear(); group.add(imported);
  }).catch(err => console.warn("Car model fallback:", err));
  return group;
}
function addTraffic() {
  const colors=[0xc64f43,0x315c82,0xd3b44c,0xddddda,0x343c42,0x4d8067];
  const verticalCount = isMobile ? 3 : 8;
  const horizontalCount = isMobile ? 1 : 4;
  for(let i=0;i<verticalCount;i++){
    const lane=(i%2===0)?-3.1:3.1;
    const car=makeCar(colors[i%colors.length],lane,-175+i*48, i%2===0?0:Math.PI);
    traffic.push({mesh:car,dir:i%2===0?1:-1,speed:5+(i%3)*1.5,axis:"z"});
  }
  for(let i=0;i<horizontalCount;i++){
    const car=makeCar(colors[(i+2)%colors.length],-165+i*82,3.1,Math.PI/2);
    traffic.push({mesh:car,dir:1,speed:4.5+(i%2),axis:"x"});
  }
}

function createNpc(x,z) {
  const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);
  const skin=mat(0xb77c5c), jacket=mat(0x9b4b32), pants=mat(0x303a48), dark=mat(0x292322);
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.36,.65,4,9),jacket);body.position.y=1.15;body.castShadow=true;g.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.27,16,12),skin);head.position.y=1.9;head.castShadow=true;g.add(head);
  const hair=new THREE.Mesh(new THREE.SphereGeometry(.275,14,9,0,Math.PI*2,0,Math.PI*.52),dark);hair.position.y=2.02;g.add(hair);
  for(const side of [-1,1]){
    const arm=box(g,side*.47,1.2,0,.19,.72,.2,jacket);arm.rotation.z=side*.12;
    box(g,side*.19,.47,0,.24,.72,.27,pants);
    box(g,side*.19,.12,.08,.27,.18,.42,mat(0x171b20));
  }
  const marker=new THREE.Group();marker.position.set(0,3.05,0);g.add(marker);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.42,.07,8,24),mat(0xffd34d,.35,{emissive:0x9b6b12,emissiveIntensity:.35}));ring.rotation.x=Math.PI/2;marker.add(ring);
  const pin=new THREE.Mesh(new THREE.SphereGeometry(.16,12,10),mat(0xffe17a,.3,{emissive:0x9b6b12,emissiveIntensity:.5}));pin.position.y=.25;marker.add(pin);
  g.userData.marker=marker;return g;
}
function createMissionObject(x,z,color,label) {
  const g=new THREE.Group();g.position.set(x,.12,z);scene.add(g);
  const orb=new THREE.Mesh(new THREE.IcosahedronGeometry(.42,1),mat(color,.28,{metalness:.12,emissive:color,emissiveIntensity:.28}));orb.position.y=.72;orb.castShadow=true;g.add(orb);
  const halo=new THREE.Mesh(new THREE.TorusGeometry(.62,.055,8,28),mat(color,.35,{emissive:color,emissiveIntensity:.35}));halo.rotation.x=Math.PI/2;halo.position.y=.16;g.add(halo);
  const canvas=document.createElement("canvas");canvas.width=256;canvas.height=64;const c=canvas.getContext("2d");
  c.fillStyle="#101820";c.fillRect(0,0,256,64);c.fillStyle="#fff";c.font="bold 25px Arial";c.textAlign="center";c.textBaseline="middle";c.fillText(label,128,32);
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  const tag=new THREE.Mesh(new THREE.PlaneGeometry(2.1,.52),new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide}));
  tag.position.y=1.65;g.add(tag);return g;
}
function saveGame(){
  try{localStorage.setItem(SAVE_KEY,JSON.stringify({missionState,cash,gramm}));}catch{}
  updateWallet();
}
function updateWallet(){
  walletHud.innerHTML='<b>$ '+cash.toLocaleString("en-US")+'</b><span>'+gramm.toLocaleString("en-US")+' GRAMM</span>';
}
function updateMissionPanel(){
  if(missionState==="new"){missionTitle.textContent="Поговори с незнакомцем";missionSub.textContent="Подойди к человеку с жёлтым значком";}
  else if(missionState==="package"){missionTitle.textContent="Доставь посылку";missionSub.textContent="Забери посылку и вернись к заказчику";}
  else if(missionState==="return"){missionTitle.textContent="Посылка у тебя";missionSub.textContent="Вернись к заказчику с посылкой";}
  else {missionTitle.textContent="Первое задание выполнено";missionSub.textContent="Награда получена • Исследуй город";}
  updateWallet();
}
function setupWorldActivities(){
  npc=createNpc(10.7,17.2);
  missionPackage=createMissionObject(22,22,0x63e5a1,"ПОСЫЛКА");
  grammPickup=createMissionObject(-22,22,0x52d9ff,"100 GRAMM");
  missionPackage.visible=missionState==="package";
  grammPickup.visible=gramm<100;
  parkedCar=makeCar(0x2474a8,3.1,30,0);
  updateMissionPanel();
}
function nearestInteraction(){
  if(driving)return {type:"exit",distance:0};
  const px=player.position.x,pz=player.position.z;
  const dist=o=>Math.hypot(px-o.position.x,pz-o.position.z);
  const options=[];
  if(npc&&(missionState==="new"||missionState==="return"))options.push({type:"npc",distance:dist(npc)});
  if(missionState==="package"&&missionPackage.visible)options.push({type:"package",distance:dist(missionPackage)});
  if(grammPickup.visible)options.push({type:"gramm",distance:dist(grammPickup)});
  if(parkedCar)options.push({type:"car",distance:dist(parkedCar)});
  return options.filter(o=>o.distance<3.25).sort((a,b)=>a.distance-b.distance)[0]||null;
}
function refreshInteraction(){
  actionTarget=nearestInteraction();
  if(!actionTarget){actionButton.classList.remove("available");actionButton.textContent="НЕТ ДЕЙСТВИЯ";return;}
  const labels={npc:missionState==="new"?"ПОГОВОРИТЬ":"СДАТЬ ПОСЫЛКУ",package:"ЗАБРАТЬ ПОСЫЛКУ",gramm:"ПОДОБРАТЬ 100 GRAMM",car:"СЕСТЬ В МАШИНУ",exit:"ВЫЙТИ ИЗ МАШИНЫ"};
  actionButton.textContent=labels[actionTarget.type];actionButton.classList.add("available");
}
function interact(){
  if(!actionTarget)return;
  const type=actionTarget.type;
  if(type==="npc"&&missionState==="new"){
    missionState="package";missionPackage.visible=true;
    hint.textContent="ЗАДАНИЕ ПРИНЯТО • НАЙДИ ЗЕЛЁНЫЙ МАРКЕР";
  }else if(type==="package"&&missionState==="package"){
    missionState="return";missionPackage.visible=false;
    hint.textContent="ПОСЫЛКА ПОЛУЧЕНА • ВЕРНИСЬ К ЗАКАЗЧИКУ";
  }else if(type==="npc"&&missionState==="return"){
    missionState="done";cash+=5000;npc.userData.marker.visible=false;
    hint.textContent="ЗАДАНИЕ ВЫПОЛНЕНО • +$5,000";
  }else if(type==="gramm"){
    gramm+=100;grammPickup.visible=false;
    hint.textContent="НАЙДЕН ПРЕДМЕТ • +100 GRAMM";
  }else if(type==="car"){
    driving=true;player.visible=false;moveX=0;moveZ=0;
    hint.textContent="ТЫ ЗА РУЛЁМ • ДЖОЙСТИК — ПОВОРОТ И ГАЗ";
  }else if(type==="exit"){
    driving=false;player.visible=true;
    player.position.set(parkedCar.position.x+2.2,.15,parkedCar.position.z);
    hint.textContent="ВЫ ВЫШЛИ ИЗ МАШИНЫ";
  }
  saveGame();updateMissionPanel();refreshInteraction();
}
function limb(parent,x,y,z,w,h,d,material){
  const pivot=new THREE.Group();pivot.position.set(x,y,z);parent.add(pivot);
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.y=-h/2;mesh.castShadow=true;pivot.add(mesh);
  return pivot;
}
function createPlayer(){
  player=new THREE.Group();scene.add(player);
  const skin=mat(0xc78f6c), hoodie=mat(0x263f55), pants=mat(0x252c34), shoe=mat(0x171c20), hair=mat(0x302923);
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.43,.55,4,8),hoodie);torso.position.y=1.48;torso.castShadow=true;player.add(torso);
  const neck=cylinder(player,0,1.97,0,.14,.14,.2,skin,8);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.31,16,12),skin);head.position.y=2.27;head.castShadow=quality.shadows;player.add(head);
  const hairCap=new THREE.Mesh(new THREE.SphereGeometry(.315,14,8,0,Math.PI*2,0,Math.PI*.48),hair);hairCap.position.y=2.34;player.add(hairCap);
  const frontHair=box(player,0,2.39,.25,.42,.14,.14,hair);
  const legs=[],arms=[];
  for(const s of [-1,1]){
    legs.push(limb(player,s*.21,1.0,0,.27,.88,.3,pants));
    const foot=box(player,s*.21,.12,.13,.34,.2,.55,shoe);
    arms.push(limb(player,s*.53,1.77,0,.23,.78,.25,hoodie));
    const hand=new THREE.Mesh(new THREE.SphereGeometry(.12,8,8),skin);hand.position.set(s*.53,1.28,0);player.add(hand);
  }
  player.userData={legs,arms,torso,imported:false};
  player.position.set(0,.15,16);
  loadAsset(KENNEY_ROOT + "character-male-c.glb").then(gltf => {
    const imported = fitModel(gltf.scene, new THREE.Vector3(1.2, 2.2, 1.2), 2.15, false);
    cartoonizeModel(imported);
    player.clear(); player.add(imported); player.userData.imported = true;
    if (gltf.animations && gltf.animations.length) {
      playerMixer = new THREE.AnimationMixer(imported);
      for (const clip of gltf.animations) {
        const key = clip.name.toLowerCase();
        if (key.includes("walk")) playerActions.walk = playerMixer.clipAction(clip);
        else if (key.includes("idle")) playerActions.idle = playerMixer.clipAction(clip);
        else if (key.includes("run") || key.includes("sprint")) playerActions.run = playerMixer.clipAction(clip);
      }
      playPlayerAction("idle");
    }
  }).catch(err => console.warn("Character model fallback:", err));
  return player;
}

function playPlayerAction(name) {
  if (!playerActions[name] || activePlayerAction === playerActions[name]) return;
  const next = playerActions[name]; next.reset().fadeIn(.2).play();
  if (activePlayerAction) activePlayerAction.fadeOut(.2);
  activePlayerAction = next;
}
function setupLighting(){
  scene.background=new THREE.Color(0x65c8ff);
  scene.fog=new THREE.Fog(0x65c8ff,205,490);
  scene.add(new THREE.HemisphereLight(0xf4fbff,0x78945b,1.9));
  const fill = new THREE.DirectionalLight(0xc9e8ff,0.8);
  fill.position.set(55,35,-70);
  scene.add(fill);
  sun=new THREE.DirectionalLight(0xfff1cf,2.5);
  sun.position.set(-65,95,50);sun.castShadow=true;
  sun.shadow.mapSize.set(quality.shadowSize,quality.shadowSize);
  sun.shadow.radius = isMobile ? 2 : 3;
  sun.shadow.camera.left=-92;sun.shadow.camera.right=92;sun.shadow.camera.top=92;sun.shadow.camera.bottom=-92;
  sun.shadow.camera.near=1;sun.shadow.camera.far=220;
  sun.shadow.bias=-.00025;sun.shadow.normalBias=.035;
  scene.add(sun);
}

function resize(){
  if(!renderer||!camera)return;
  camera.aspect=root.clientWidth/root.clientHeight;camera.updateProjectionMatrix();
  renderer.setSize(root.clientWidth,root.clientHeight,false);
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, quality.pixelRatio));
}
function blocked(x,z){
  for(const b of colliders) if(Math.abs(x-b.x)<b.w/2+.55&&Math.abs(z-b.z)<b.d/2+.55)return true;
  return false;
}
function updateJoystick(e){
  const r=joystick.getBoundingClientRect(),dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2;
  const max=r.width*.34,len=Math.hypot(dx,dy),scale=len>max?max/len:1;
  const x=dx*scale,y=dy*scale;stick.style.transform="translate("+x+"px,"+y+"px)";
  moveX=x/max;moveZ=y/max;
}
function setupControls(){
  joystick.addEventListener("pointerdown",e=>{e.preventDefault();joyPointer=e.pointerId;joystick.setPointerCapture(e.pointerId);updateJoystick(e);});
  joystick.addEventListener("pointermove",e=>{if(e.pointerId===joyPointer){e.preventDefault();updateJoystick(e);}});
  const endJoy=e=>{if(e.pointerId!==joyPointer)return;joyPointer=null;moveX=0;moveZ=0;stick.style.transform="translate(0,0)";};
  joystick.addEventListener("pointerup",endJoy);joystick.addEventListener("pointercancel",endJoy);
  runButton.addEventListener("pointerdown",e=>{e.preventDefault();running=true;runButton.classList.add("active");});
  const stopRun=()=>{running=false;runButton.classList.remove("active");};
  runButton.addEventListener("pointerup",stopRun);runButton.addEventListener("pointercancel",stopRun);runButton.addEventListener("pointerleave",stopRun);
  actionButton.addEventListener("pointerdown",e=>{e.preventDefault();interact();});
  window.addEventListener("keydown",e=>{if(e.key.toLowerCase()==="e")interact();});
  root.addEventListener("pointerdown",e=>{if(joystick.contains(e.target)||e.target===runButton||e.target===actionButton)return;lookPointer=e.pointerId;lastX=e.clientX;lastY=e.clientY;});
  root.addEventListener("pointermove",e=>{if(e.pointerId!==lookPointer)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;yaw-=dx*.0045;pitch=THREE.MathUtils.clamp(pitch+dy*.0028,-.18,.78);});
  const endLook=e=>{if(e.pointerId===lookPointer)lookPointer=null;};
  root.addEventListener("pointerup",endLook);root.addEventListener("pointercancel",endLook);
  const keys={};
  window.addEventListener("keydown",e=>{keys[e.key.toLowerCase()]=true;if(e.key==="Shift")running=true;moveX=(keys.a||keys.arrowleft?-1:0)+(keys.d||keys.arrowright?1:0);moveZ=(keys.w||keys.arrowup?-1:0)+(keys.s||keys.arrowdown?1:0);});
  window.addEventListener("keyup",e=>{keys[e.key.toLowerCase()]=false;if(e.key==="Shift")running=false;moveX=(keys.a||keys.arrowleft?-1:0)+(keys.d||keys.arrowright?1:0);moveZ=(keys.w||keys.arrowup?-1:0)+(keys.s||keys.arrowdown?1:0);});
}
function update(dt){
  actionRefresh+=dt;
  if(actionRefresh>.18){actionRefresh=0;refreshInteraction();}
  const moving=Math.hypot(moveX,moveZ)>.08;
  if (playerMixer) { playerMixer.update(dt); playPlayerAction(!moving ? "idle" : (running ? "run" : "walk")); }
  if(moving&&!driving){
    const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
    const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const dir=new THREE.Vector3().addScaledVector(right,moveX).addScaledVector(forward,-moveZ).normalize();
    const speed=running?10:5.1;
    const nx=player.position.x+dir.x*speed*dt,nz=player.position.z+dir.z*speed*dt;
    if(!blocked(nx,player.position.z))player.position.x=nx;
    if(!blocked(player.position.x,nz))player.position.z=nz;
    player.rotation.y=Math.atan2(dir.x,dir.z);
    walkTime+=dt*(running?12:8);
  }
  const swing=moving?Math.sin(walkTime)*.55:0;
  if (!player.userData.imported) {
    player.userData.legs[0].rotation.x=swing;player.userData.legs[1].rotation.x=-swing;
    player.userData.arms[0].rotation.x=-swing*.7;player.userData.arms[1].rotation.x=swing*.7;
    player.userData.torso.position.y=1.48+(moving?Math.abs(Math.sin(walkTime*2))*.035:0);
  }
  if(driving&&moving){
    parkedCar.rotation.y+=moveX*.95*dt;
    const throttle=-moveZ;
    const speed=throttle>=0?throttle*18:throttle*8;
    const nx=parkedCar.position.x+Math.sin(parkedCar.rotation.y)*speed*dt;
    const nz=parkedCar.position.z+Math.cos(parkedCar.rotation.y)*speed*dt;
    if(!blocked(nx,nz)){parkedCar.position.x=THREE.MathUtils.clamp(nx,-190,190);parkedCar.position.z=THREE.MathUtils.clamp(nz,-190,190);}
    yaw=parkedCar.rotation.y;
  }
  if(npc?.userData.marker)npc.userData.marker.position.y=3.05+Math.sin(clock.elapsedTime*2.4)*.12;
  if(missionPackage?.visible)missionPackage.position.y=.12+Math.sin(clock.elapsedTime*2.5)*.08;
  if(grammPickup?.visible)grammPickup.position.y=.12+Math.sin(clock.elapsedTime*2.1)*.08;
  traffic.forEach(t=>{
    t.mesh.position[t.axis]+=t.dir*t.speed*dt;
    if(t.mesh.position[t.axis]>185)t.mesh.position[t.axis]=-185;
    if(t.mesh.position[t.axis]<-185)t.mesh.position[t.axis]=185;
  });
  const focus=driving?parkedCar:player;
  const desired=new THREE.Vector3(focus.position.x+Math.sin(yaw)*(driving?10:8.2),focus.position.y+(driving?5:4.3)+pitch*4,focus.position.z+Math.cos(yaw)*(driving?10:8.2));
  camera.position.lerp(desired,1-Math.pow(.001,dt));
  camera.lookAt(focus.position.x,focus.position.y+(driving?1.1:1.35),focus.position.z);
}
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.045);
  // Automatically trade a little resolution for stable frame pacing on slower phones.
  adaptiveFrameMs = adaptiveFrameMs * .92 + (dt * 1000) * .08;
  adaptiveCheckTime += dt;
  if(adaptiveCheckTime >= 2){
    adaptiveCheckTime = 0;
    let nextRatio = renderer.getPixelRatio();
    if(adaptiveFrameMs > 23) nextRatio = Math.max(quality.minPixelRatio, nextRatio - .1);
    else if(adaptiveFrameMs < 16) nextRatio = Math.min(quality.pixelRatio, nextRatio + .05);
    if(Math.abs(nextRatio - renderer.getPixelRatio()) > .01){
      renderer.setPixelRatio(nextRatio);
      renderer.setSize(root.clientWidth,root.clientHeight,false);
    }
  }
  update(dt);renderer.render(scene,camera);
}

try{
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(62,1,.1,500);
  renderer=new THREE.WebGLRenderer({antialias:!isMobile,powerPreference:"high-performance",alpha:false});
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.32;
  renderer.physicallyCorrectLights = true;
  renderer.shadowMap.enabled=quality.shadows;renderer.shadowMap.type=isMobile?THREE.BasicShadowMap:THREE.PCFSoftShadowMap;
  root.insertBefore(renderer.domElement,root.firstChild);
  clock=new THREE.Clock();
  createToonGradient();makeTextures();setupLighting();addRoads();addCity();addStreetFurniture();addTraffic();createPlayer();setupWorldActivities();setupControls();resize();
  window.addEventListener("resize",resize);
  camera.position.set(0,5,24);camera.lookAt(0,1.5,16);
  animate();
  const finishLoading=()=>{
    if(!loading.isConnected) return;
    loading.style.opacity="0";
    setTimeout(()=>loading.remove(),600);
    hint.textContent="ДЖОЙСТИК — ДВИЖЕНИЕ  •  СВАЙП — КАМЕРА  •  БЕГ — УСКОРЕНИЕ";
  };
  Promise.allSettled([...assetCache.values()]).then(finishLoading);
  setTimeout(finishLoading,6500);
}catch(err){
  console.error(err);errorBox.hidden=false;
  errorBox.textContent="Не удалось запустить 3D-город. Обнови страницу и проверь поддержку WebGL. "+err.message;
  loading.remove();
}
