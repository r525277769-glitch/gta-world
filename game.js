import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const game = document.getElementById("game");
const loading = document.getElementById("loading");
const hint = document.getElementById("hint");
const errorBox = document.getElementById("error");
const joystick = document.getElementById("joystick");
const stick = document.getElementById("stick");
const runButton = document.getElementById("run");

let scene, camera, renderer, player, clock;
let yaw = 0, pitch = 0.22, moveX = 0, moveZ = 0, running = false;
let cameraPointer = null, lastX = 0, lastY = 0, joyPointer = null;
const worldSize = 260;
const colliders = [];

function material(color, roughness = 1) {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

function addBox(x, y, z, w, h, d, mat, target = scene) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  target.add(mesh);
  return mesh;
}

function createCity() {
  scene.background = new THREE.Color(0x9fc5d1);
  scene.fog = new THREE.Fog(0x9fc5d1, 95, 245);

  const hemi = new THREE.HemisphereLight(0xdcefff, 0x77705b, 2.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe1b5, 2.2);
  sun.position.set(-55, 95, 45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -130;
  sun.shadow.camera.right = 130;
  sun.shadow.camera.top = 130;
  sun.shadow.camera.bottom = -130;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(worldSize, worldSize), material(0x78916c));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMat = material(0x343a3d);
  const sidewalkMat = material(0xb9b3a1);
  const lineMat = material(0xe8dca8);
  const roadWidth = 13;
  const block = 42;
  for (let i = -3; i <= 3; i++) {
    const p = i * block;
    addBox(p, 0.025, 0, roadWidth, 0.05, worldSize, roadMat);
    addBox(0, 0.025, p, worldSize, 0.05, roadWidth, roadMat);
    addBox(p - roadWidth / 2 - 1.2, 0.08, 0, 2.4, 0.16, worldSize, sidewalkMat);
    addBox(p + roadWidth / 2 + 1.2, 0.08, 0, 2.4, 0.16, worldSize, sidewalkMat);
    addBox(0, 0.08, p - roadWidth / 2 - 1.2, worldSize, 0.16, 2.4, sidewalkMat);
    addBox(0, 0.08, p + roadWidth / 2 + 1.2, worldSize, 0.16, 2.4, sidewalkMat);
    for (let m = -5; m <= 5; m++) {
      addBox(p, 0.06, m * 20, 0.18, 0.025, 7, lineMat);
      addBox(m * 20, 0.06, p, 7, 0.025, 0.18, lineMat);
    }
  }

  const buildingColors = [0xb7a18a, 0x87999a, 0xc4b7a0, 0x8d9292, 0xb7b9a9, 0x9e8c83, 0x738b91];
  const windowMats = [material(0x8fc0c8), material(0x344c59), material(0xb6c9c4)];
  for (let gx = -2; gx <= 2; gx++) {
    for (let gz = -2; gz <= 2; gz++) {
      if (gx === 0 && gz === 0) continue;
      const cx = gx * block + (gx < 0 ? -21 : 21);
      const cz = gz * block + (gz < 0 ? -21 : 21);
      const count = 2 + ((gx * gx + gz * gz) % 2);
      for (let n = 0; n < count; n++) {
        const x = cx + (n - (count - 1) / 2) * 10;
        const z = cz + (n % 2 ? 7 : -7);
        const w = 7 + (n % 2) * 2;
        const d = 8;
        const h = 10 + ((Math.abs(gx * 7 + gz * 11 + n * 5) % 5) * 4);
        const base = addBox(x, h / 2 + 0.18, z, w, h, d, material(buildingColors[Math.abs(gx * 3 + gz * 5 + n) % buildingColors.length]));
        colliders.push({ x, z, w: w + 1.2, d: d + 1.2 });
        addBox(x, h + 0.45, z, w + 0.5, 0.5, d + 0.5, material(0x4d5555));
        const floors = Math.max(2, Math.floor(h / 3));
        for (let f = 0; f < floors; f++) {
          const wy = 1.7 + f * 3;
          for (let side = -1; side <= 1; side++) {
            addBox(x + side * (w / 3), wy, z + d / 2 + 0.035, 1.35, 1.45, 0.08, windowMats[(f + n) % windowMats.length]);
            addBox(x + side * (w / 3), wy, z - d / 2 - 0.035, 1.35, 1.45, 0.08, windowMats[(f + n + 1) % windowMats.length]);
          }
        }
        if (n === 0) {
          addBox(x, 1.1, z + d / 2 + 0.12, 2.1, 2.2, 0.18, material(0x43545a));
        }
      }
    }
  }

  const treeTrunk = material(0x72523a);
  const leaves = [material(0x456f4d), material(0x5f8551), material(0x78935a)];
  for (let i = 0; i < 48; i++) {
    const x = ((i * 37) % 220) - 110;
    const z = ((i * 61) % 220) - 110;
    if (Math.abs(x % block) < 10 || Math.abs(z % block) < 10) continue;
    const trunk = addBox(x, 1.3, z, 0.7, 2.6, 0.7, treeTrunk);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2 + (i % 3) * 0.35, 0), leaves[i % leaves.length]);
    crown.position.set(x, 3.8, z);
    crown.castShadow = true;
    scene.add(crown);
  }

  // Simple downtown landmark plaza.
  addBox(0, 0.12, 0, 25, 0.22, 25, material(0xc5b99f));
  const fountain = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.8, 0.7, 8), material(0x7c9294));
  fountain.position.set(0, 0.55, 0);
  scene.add(fountain);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 0.12, 12), material(0x4d9eae));
  water.position.set(0, 0.96, 0);
  scene.add(water);
}

function createPlayer() {
  player = new THREE.Group();
  const skin = material(0xd2a27e);
  const shirt = material(0x354f68);
  const pants = material(0x292f39);
  const shoes = material(0x171d21);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.05, 0.42), shirt);
  torso.position.y = 1.55;
  torso.castShadow = true;
  player.add(torso);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), skin);
  head.position.y = 2.3;
  head.castShadow = true;
  player.add(head);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.82, 0.32), pants);
    leg.position.set(side * 0.22, 0.62, 0);
    leg.castShadow = true;
    player.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.48), shoes);
    shoe.position.set(side * 0.22, 0.16, 0.06);
    player.add(shoe);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.85, 0.28), shirt);
    arm.position.set(side * 0.56, 1.55, 0);
    arm.castShadow = true;
    player.add(arm);
  }
  player.position.set(0, 0.16, 13);
  scene.add(player);
}

function resize() {
  if (!renderer || !camera) return;
  const w = game.clientWidth, h = game.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
}

function setupControls() {
  const joyStart = (e) => {
    e.preventDefault();
    joyPointer = e.pointerId;
    joystick.setPointerCapture(e.pointerId);
    updateJoystick(e);
  };
  const joyMove = (e) => {
    if (e.pointerId === joyPointer) { e.preventDefault(); updateJoystick(e); }
  };
  const joyEnd = (e) => {
    if (e.pointerId !== joyPointer) return;
    joyPointer = null; moveX = 0; moveZ = 0;
    stick.style.transform = "translate(0px,0px)";
  };
  joystick.addEventListener("pointerdown", joyStart);
  joystick.addEventListener("pointermove", joyMove);
  joystick.addEventListener("pointerup", joyEnd);
  joystick.addEventListener("pointercancel", joyEnd);

  function updateJoystick(e) {
    const r = joystick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const max = r.width * 0.34;
    const len = Math.hypot(dx, dy);
    const scale = len > max ? max / len : 1;
    const x = dx * scale, y = dy * scale;
    stick.style.transform = "translate(" + x + "px," + y + "px)";
    moveX = x / max;
    moveZ = y / max;
  }

  runButton.addEventListener("pointerdown", e => { e.preventDefault(); running = true; runButton.classList.add("active"); });
  const stopRun = () => { running = false; runButton.classList.remove("active"); };
  runButton.addEventListener("pointerup", stopRun);
  runButton.addEventListener("pointercancel", stopRun);
  runButton.addEventListener("pointerleave", stopRun);

  game.addEventListener("pointerdown", e => {
    if (e.target === joystick || joystick.contains(e.target) || e.target === runButton) return;
    cameraPointer = e.pointerId; lastX = e.clientX; lastY = e.clientY;
  });
  game.addEventListener("pointermove", e => {
    if (e.pointerId !== cameraPointer) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    yaw -= dx * 0.005;
    pitch = THREE.MathUtils.clamp(pitch + dy * 0.003, -0.12, 0.8);
  });
  const endLook = e => { if (e.pointerId === cameraPointer) cameraPointer = null; };
  game.addEventListener("pointerup", endLook);
  game.addEventListener("pointercancel", endLook);

  window.addEventListener("keydown", e => {
    if (e.key === "w" || e.key === "ArrowUp") moveZ = -1;
    if (e.key === "s" || e.key === "ArrowDown") moveZ = 1;
    if (e.key === "a" || e.key === "ArrowLeft") moveX = -1;
    if (e.key === "d" || e.key === "ArrowRight") moveX = 1;
    if (e.key === "Shift") running = true;
  });
  window.addEventListener("keyup", e => {
    if (["w","s","ArrowUp","ArrowDown"].includes(e.key)) moveZ = 0;
    if (["a","d","ArrowLeft","ArrowRight"].includes(e.key)) moveX = 0;
    if (e.key === "Shift") running = false;
  });
}

function blocked(x, z) {
  for (const b of colliders) {
    if (Math.abs(x - b.x) < b.w / 2 + 0.55 && Math.abs(z - b.z) < b.d / 2 + 0.55) return true;
  }
  return false;
}

function update(dt) {
  const inputLength = Math.hypot(moveX, moveZ);
  if (inputLength > 0.08) {
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const direction = new THREE.Vector3()
      .addScaledVector(right, moveX)
      .addScaledVector(forward, -moveZ)
      .normalize();
    const speed = running ? 10.5 : 5.4;
    const nx = player.position.x + direction.x * speed * dt;
    const nz = player.position.z + direction.z * speed * dt;
    if (!blocked(nx, player.position.z)) player.position.x = nx;
    if (!blocked(player.position.x, nz)) player.position.z = nz;
    player.rotation.y = Math.atan2(direction.x, direction.z);
  }

  const target = new THREE.Vector3(
    player.position.x + Math.sin(yaw) * 7.5,
    player.position.y + 4.2 + pitch * 4,
    player.position.z + Math.cos(yaw) * 7.5
  );
  camera.position.lerp(target, 1 - Math.pow(0.001, dt));
  camera.lookAt(player.position.x, player.position.y + 1.35, player.position.z);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
}

try {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(65, 1, 0.1, 500);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  game.insertBefore(renderer.domElement, game.firstChild);
  clock = new THREE.Clock();
  createCity();
  createPlayer();
  setupControls();
  resize();
  window.addEventListener("resize", resize);
  camera.position.set(0, 5, 21);
  camera.lookAt(0, 1.5, 13);
  animate();
  setTimeout(() => {
    loading.style.opacity = "0";
    setTimeout(() => loading.remove(), 550);
    hint.textContent = "Джойстик — движение • свайп — камера • БЕГ — ускорение";
  }, 650);
} catch (err) {
  console.error(err);
  errorBox.hidden = false;
  errorBox.textContent = "Не удалось запустить 3D-игру. Проверь подключение к интернету и поддержку WebGL. " + err.message;
  loading.remove();
}
