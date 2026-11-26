import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const root = document.querySelector("#game");
const loading = document.querySelector("#loading");
const hint = document.querySelector("#hint");
const errorBox = document.querySelector("#error");
const joystick = document.querySelector("#joystick");
const stick = document.querySelector("#stick");
const runButton = document.querySelector("#run");

let scene, camera, renderer, clock, player, sun;
let yaw = 0, pitch = 0.18, moveX = 0, moveZ = 0, running = false;
let joyPointer = null, lookPointer = null, lastX = 0, lastY = 0;
let walkTime = 0;
const colliders = [];
const traffic = [];
const gltfLoader = new GLTFLoader();
const assetCache = new Map();
let playerMixer = null;
let playerActions = {};
let activePlayerAction = null;
const ASSET_ROOT = "https://raw.githubusercontent.com/kayquer/kit-cidade-lowpoly/main/models/";
const KENNEY_ROOT = "https://raw.githubusercontent.com/shorepine/kenney/main/3d/mini-characters/";
const mats = {};
const quality = {
  shadows: !matchMedia("(max-width: 700px)").matches
};

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
function mat(color, roughness = 0.88, extra = {}) {
  // Bright cel-shaded materials give the city a playful animated-film look.
  return new THREE.MeshToonMaterial({ color, ...extra });
}
function cartoonizeModel(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const convert = source => {
      if (!source || source.isMeshToonMaterial) return source;
      const toon = new THREE.MeshToonMaterial({
        color: source.color ? source.color.clone() : 0xffffff,
        map: source.map || null,
        alphaMap: source.alphaMap || null,
        transparent: source.transparent || false,
        opacity: source.opacity ?? 1,
        side: source.side,
        emissive: source.emissive ? source.emissive.clone() : 0x000000,
        emissiveMap: source.emissiveMap || null
      });
      toon.vertexColors = source.vertexColors;
      toon.skinning = source.skinning;
      toon.morphTargets = source.morphTargets;
      return toon;
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
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}
function makeTextures() {
  const asphalt = canvasTexture((c,w,h) => {
    c.fillStyle = "#343b40"; c.fillRect(0,0,w,h);
    for(let i=0;i<1800;i++){const x=Math.random()*w,y=Math.random()*h,a=Math.random()*.12;c.fillStyle="rgba(220,225,220,"+a+")";c.fillRect(x,y,1+Math.random()*2,1+Math.random()*2);}
  }, 5, 5);
  mats.road = new THREE.MeshStandardMaterial({map:asphalt, roughness:1});
  mats.sidewalk = mat(palette.concrete);
  mats.white = mat(0xf1eee3);
  mats.yellow = mat(0xf4c64d, .75);
  mats.dark = mat(0x20272c);
  mats.glass = mat(0x416675, .24, {metalness:.35});
  mats.glassLight = mat(0x9ac4c8, .28, {metalness:.2});
  mats.leaf = [mat(0x4f7952),mat(0x668b59),mat(0x789565)];
  mats.trunk = mat(0x76553d);
  mats.lamp = mat(0xffe6a3, .35, {emissive:0xffbd57,emissiveIntensity:.45});
  mats.facades = [0xb9a58f,0x9aa9a7,0xc9c0ad,0x9caaa9,0xc1b29f,0x858f94,0xd0c5b1].map((color,index) =>
    canvasTexture((c,w,h) => {
      c.fillStyle = "#" + color.toString(16).padStart(6,"0"); c.fillRect(0,0,w,h);
      c.fillStyle = "rgba(40,48,50,.16)";
      for(let y=0;y<h;y+=64){c.fillRect(0,y,w,3);}
      for(let y=14;y<h-20;y+=64){
        for(let x=16;x<w-16;x+=66){
          c.fillStyle="rgba(27,45,54,.28)";c.fillRect(x-3,y-3,48,40);
          c.fillStyle=index%2?"#63818a":"#4d6c78";c.fillRect(x,y,42,34);
          c.fillStyle="rgba(210,231,226,.5)";c.fillRect(x+3,y+3,3,28);
          c.fillStyle="#c4b9a7";c.fillRect(x-4,y+36,50,5);
        }
      }
    },1,1)
  );
}

function addRoads() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300,300),mat(palette.grass));
  ground.rotation.x=-Math.PI/2; ground.position.y=-.08; ground.receiveShadow=true; scene.add(ground);
  const roadW=14, step=44;
  for(let i=-3;i<=3;i++){
    const p=i*step;
    const vertical=new THREE.Mesh(new THREE.PlaneGeometry(roadW,300),mats.road);
    vertical.rotation.x=-Math.PI/2; vertical.position.set(p,.005,0); vertical.receiveShadow=true; scene.add(vertical);
    const horizontal=new THREE.Mesh(new THREE.PlaneGeometry(300,roadW),mats.road);
    horizontal.rotation.x=-Math.PI/2; horizontal.position.set(0,.006,p); horizontal.receiveShadow=true; scene.add(horizontal);
    for(const side of [-1,1]){
      const curbV=box(scene,p+side*(roadW/2+1.15),.12,0,2.3,.24,300,mats.sidewalk,false);
      const curbH=box(scene,0,.12,p+side*(roadW/2+1.15),300,.24,2.3,mats.sidewalk,false);
    }
    for(let n=-6;n<=6;n++){
      const z=n*22;
      box(scene,p,.035,z,.16,.025,7,mats.yellow,false);
      box(scene,z,.035,p,7,.025,.16,mats.yellow,false);
    }
    // Crosswalks at intersections.
    for(let stripe=-3;stripe<=3;stripe++){
      box(scene,p+stripe*1.55,.045,p-10,0.9,.035,4.2,mats.white,false);
      box(scene,p-10,.045,p+stripe*1.55,4.2,.035,.9,mats.white,false);
    }
  }
}

function createBuilding(x,z,index) {
  const w=13+(index%3)*2, d=12+(index%2)*2, floors=3+(index*7%5), h=floors*3.15;
  const group=new THREE.Group(); group.position.set(x,0,z); scene.add(group);
  const facade=mats.facades[index%mats.facades.length];
  const body=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshToonMaterial({map:facade}));
  body.position.y=h/2+.22; body.castShadow=true; body.receiveShadow=true; group.add(body);
  const outline=new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w+.035,h+.035,d+.035),25),
    new THREE.LineBasicMaterial({color:0x35434a,transparent:true,opacity:.48})
  );
  outline.position.y=h/2+.22; group.add(outline);
  box(group,0,h+.42,0,w+.55,.55,d+.55,mat(0x4b5354));
  box(group,0,.55,d/2+.08,w,.8,.2,mat(index%3===0?0x3b4e54:0x625c50));
  // Shopfront glazing and sign.
  const shopGlass=box(group,0,1.65,d/2+.19,w*.72,1.7,.12,mats.glassLight,false);
  box(group,0,2.65,d/2+.28,w*.8,.34,.18,mat([0x263d48,0x704b3e,0x3f6253][index%3]));
  // Balconies and facade ledges on alternating buildings.
  if(index%2===0){
    for(let floor=1;floor<floors;floor+=2){
      const y=floor*3.15+1.05;
      for(let side of [-1,1]){
        box(group,side*w*.25,y,d/2+.42,w*.36,.12,.9,mat(0x8b8e87));
        box(group,side*w*.25,y+.42,d/2+.82,w*.36,.72,.08,mat(0x5b6a69));
      }
    }
  }
  // Rooftop air-conditioning units, vents and water tanks.
  for(let a=0;a<2;a++){
    const unit=box(group,(a-.5)*w*.35,h+.95,-d*.18,2.1,1.05,1.8,mat(0x737d7d));
    box(group,(a-.5)*w*.35,h+1.52,-d*.18,1.4,.12,1.25,mat(0x454d50));
  }
  if(index%3===0){
    cylinder(group,w*.27,h+1.3,d*.15,.65,.65,2.1,mat(0x8d9b98),12);
  }
  colliders.push({x,z,w:w+1.3,d:d+1.3});
  const modelPath = index % 4 === 0 ? "residencial/predio_apartamentos.glb" :
    index % 4 === 1 ? "comercial/escritorio.glb" :
    index % 4 === 2 ? "comercial/hotel.glb" : "residencial/predio_alto.glb";
  loadAsset(ASSET_ROOT + modelPath).then(gltf => {
    const imported = fitModel(gltf.scene, new THREE.Vector3(w, 24, d), 25);
    cartoonizeModel(imported);
    group.clear(); group.add(imported);
  }).catch(err => console.warn("Building model fallback:", modelPath, err));
}

function addCity() {
  let id=0;
  for(let gx=-2;gx<=2;gx++){
    for(let gz=-2;gz<=2;gz++){
      if(gx===0&&gz===0) continue;
      const bx=gx*44, bz=gz*44;
      createBuilding(bx+(gx<0?-18:18),bz+(gz<0?-18:18),id++);
      if((gx+gz)%2===0){
        createBuilding(bx+(gx<0? -5:5),bz+(gz<0?5:-5),id++);
      }
    }
  }
  // Pocket park around the central fountain.
  box(scene,0,.08,0,31,.16,31,mat(0xc9bda5),false);
  const ring=new THREE.Mesh(new THREE.CylinderGeometry(4.5,4.9,.8,12),mat(0x879b9b));
  ring.position.set(0,.48,0); ring.castShadow=quality.shadows; scene.add(ring);
  const water=new THREE.Mesh(new THREE.CylinderGeometry(3.9,3.9,.1,24),mat(0x3e9aab,.22,{metalness:.25}));
  water.position.set(0,.93,0); water.castShadow=false; scene.add(water);
  cylinder(scene,0,1.55,0,.18,.28,1.2,mat(0xc8d8d4));
  const spray=new THREE.Mesh(new THREE.SphereGeometry(.35,10,8),mat(0x9ce5e8,.2,{transparent:true,opacity:.8}));
  spray.position.set(0,2.2,0);spray.castShadow=false;scene.add(spray);
}

function addTree(x,z,scale=1) {
  const group=new THREE.Group();group.position.set(x,0,z);group.scale.setScalar(scale);scene.add(group);
  cylinder(group,0,1.35,0,.25,.38,2.7,mats.trunk,7);
  const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.8,1),mats.leaf[Math.floor(Math.abs(x+z))%3]);
  crown.position.y=3.25;crown.scale.set(1,1.25,.95);crown.castShadow=true;group.add(crown);
  const crown2=new THREE.Mesh(new THREE.IcosahedronGeometry(1.1,0),mats.leaf[1]);
  crown2.position.set(.7,3.6,.2);crown2.castShadow=quality.shadows;group.add(crown2);
  loadAsset(ASSET_ROOT + "vegetacao/ipe_amarelo.glb").then(gltf => {
    const imported = fitModel(gltf.scene, new THREE.Vector3(3.8, 7, 3.8), 7);
    cartoonizeModel(imported);
    group.clear(); group.add(imported);
  }).catch(err => console.warn("Tree model fallback:", err));
}
function addStreetFurniture() {
  for(let road=-2;road<=2;road++){
    for(let side of [-1,1]){
      for(let k=-2;k<=2;k++){
        const x=road*44+side*10.5, z=k*44+((road+k)%2)*8;
        // lamp post
        cylinder(scene,x,3.2,z,.09,.13,6.4,mat(0x343d3d),8);
        box(scene,x+.62,6.25,z,.95,.12,.18,mat(0x343d3d));
        const bulb=new THREE.Mesh(new THREE.SphereGeometry(.19,8,6),mats.lamp);
        bulb.position.set(x+1.05,6.12,z);bulb.castShadow=false;scene.add(bulb);
        if(k%2===0) addTree(x+side*3,z+5,.8);
      }
    }
  }
  // Traffic signal poles around the central crossroads.
  for(const [x,z] of [[9,9],[-9,9],[9,-9],[-9,-9]]){
    cylinder(scene,x,2.1,z,.12,.16,4.2,mat(0x303a3e),8);
    box(scene,x,4.0,z,.62,1.65,.42,mat(0x20282b));
    for(let i=0;i<3;i++){
      const light=new THREE.Mesh(new THREE.SphereGeometry(.14,8,8),mat([0xff453f,0xf3c84c,0x65d477][i],.3,{emissive:[0x8f1712,0x806017,0x174f28][i],emissiveIntensity:.35}));
      light.position.set(x,4.48-i*.48,z+.23);scene.add(light);
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
  for(let i=0;i<8;i++){
    const lane=(i%2===0)?-3.1:3.1;
    const car=makeCar(colors[i%colors.length],lane,-105+i*27, i%2===0?0:Math.PI);
    traffic.push({mesh:car,dir:i%2===0?1:-1,speed:5+(i%3)*1.5,axis:"z"});
  }
  for(let i=0;i<4;i++){
    const car=makeCar(colors[(i+2)%colors.length],-105+i*48,3.1,Math.PI/2);
    traffic.push({mesh:car,dir:1,speed:4.5+(i%2),axis:"x"});
  }
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
  scene.background=new THREE.Color(0x8ed8ff);
  scene.fog=new THREE.Fog(0x8ed8ff,145,330);
  scene.add(new THREE.HemisphereLight(0xffffff,0x82915b,2.05));
  sun=new THREE.DirectionalLight(0xfff1c7,2.8);
  sun.position.set(-65,95,50);sun.castShadow=true;
  sun.shadow.mapSize.set(1536,1536);
  sun.shadow.camera.left=-115;sun.shadow.camera.right=115;sun.shadow.camera.top=115;sun.shadow.camera.bottom=-115;
  sun.shadow.bias=-.00025;sun.shadow.normalBias=.035;
  scene.add(sun);
}

function resize(){
  if(!renderer||!camera)return;
  camera.aspect=root.clientWidth/root.clientHeight;camera.updateProjectionMatrix();
  renderer.setSize(root.clientWidth,root.clientHeight,false);
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, matchMedia("(max-width: 700px)").matches ? 1.25 : 1.6));
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
  root.addEventListener("pointerdown",e=>{if(joystick.contains(e.target)||e.target===runButton)return;lookPointer=e.pointerId;lastX=e.clientX;lastY=e.clientY;});
  root.addEventListener("pointermove",e=>{if(e.pointerId!==lookPointer)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;yaw-=dx*.0045;pitch=THREE.MathUtils.clamp(pitch+dy*.0028,-.18,.78);});
  const endLook=e=>{if(e.pointerId===lookPointer)lookPointer=null;};
  root.addEventListener("pointerup",endLook);root.addEventListener("pointercancel",endLook);
  const keys={};
  window.addEventListener("keydown",e=>{keys[e.key.toLowerCase()]=true;if(e.key==="Shift")running=true;moveX=(keys.a||keys.arrowleft?-1:0)+(keys.d||keys.arrowright?1:0);moveZ=(keys.w||keys.arrowup?-1:0)+(keys.s||keys.arrowdown?1:0);});
  window.addEventListener("keyup",e=>{keys[e.key.toLowerCase()]=false;if(e.key==="Shift")running=false;moveX=(keys.a||keys.arrowleft?-1:0)+(keys.d||keys.arrowright?1:0);moveZ=(keys.w||keys.arrowup?-1:0)+(keys.s||keys.arrowdown?1:0);});
}
function update(dt){
  const moving=Math.hypot(moveX,moveZ)>.08;
  if (playerMixer) { playerMixer.update(dt); playPlayerAction(!moving ? "idle" : (running ? "run" : "walk")); }
  if(moving){
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
  traffic.forEach(t=>{
    t.mesh.position[t.axis]+=t.dir*t.speed*dt;
    if(t.mesh.position[t.axis]>120)t.mesh.position[t.axis]=-120;
    if(t.mesh.position[t.axis]<-120)t.mesh.position[t.axis]=120;
  });
  const desired=new THREE.Vector3(player.position.x+Math.sin(yaw)*8.2,player.position.y+4.3+pitch*4,player.position.z+Math.cos(yaw)*8.2);
  camera.position.lerp(desired,1-Math.pow(.001,dt));
  camera.lookAt(player.position.x,player.position.y+1.35,player.position.z);
}
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.045);
  update(dt);renderer.render(scene,camera);
}

try{
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(62,1,.1,500);
   renderer=new THREE.WebGLRenderer({antialias:!(matchMedia("(max-width: 700px)").matches),powerPreference:"high-performance",alpha:false});
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.28;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  root.insertBefore(renderer.domElement,root.firstChild);
  clock=new THREE.Clock();
  makeTextures();setupLighting();addRoads();addCity();addStreetFurniture();addTraffic();createPlayer();setupControls();resize();
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
