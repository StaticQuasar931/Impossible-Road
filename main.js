// === Imports ===============================================================
import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js';

// === Utility helpers =======================================================
const TAU = Math.PI * 2;
const DEG2RAD = Math.PI / 180;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;

function makeRng(seed) {
  // Mulberry32-style PRNG for deterministic track seeds.
  let t = seed >>> 0;
  return () => {
    t |= 0;
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function easeOutExpo(x) {
  return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// === Theme definitions =====================================================
const THEMES = [
  {
    name: 'Nebula Glass',
    road: '#1d85ff',
    roadEdge: '#8fe8ff',
    gate: '#ff9df5',
    ball: '#9df0ff',
    trail: '#66d9ff',
    sky: ['#03030a', '#0a1d35'],
  },
  {
    name: 'Solar Bloom',
    road: '#ffb347',
    roadEdge: '#ffd77a',
    gate: '#ff4f6d',
    ball: '#fff7cf',
    trail: '#ff9c5a',
    sky: ['#2a0610', '#06020a'],
  },
  {
    name: 'Aurora Drift',
    road: '#58ffb1',
    roadEdge: '#abffe4',
    gate: '#82b5ff',
    ball: '#d0fff7',
    trail: '#7df9ff',
    sky: ['#001215', '#07303d'],
  },
  {
    name: 'Luminous Dust',
    road: '#ff9ae1',
    roadEdge: '#fbe7ff',
    gate: '#ffe766',
    ball: '#ffd6ff',
    trail: '#ffa5ff',
    sky: ['#190320', '#04020a'],
  },
  {
    name: 'Comet Alloy',
    road: '#9ab3ff',
    roadEdge: '#d5deff',
    gate: '#fffc84',
    ball: '#ecf3ff',
    trail: '#9ad6ff',
    sky: ['#050915', '#02040a'],
  },
  {
    name: 'Pulse Runner',
    road: '#ff6464',
    roadEdge: '#ffc2c2',
    gate: '#ffd35c',
    ball: '#ffffff',
    trail: '#ff8888',
    sky: ['#240202', '#060203'],
  },
];

// Populate theme selector in the UI.
const themeSelect = document.getElementById('themeSelect');
THEMES.forEach((theme, index) => {
  const option = document.createElement('option');
  option.value = index;
  option.textContent = `${index + 1}. ${theme.name}`;
  themeSelect.appendChild(option);
});
let initialThemeIndex = Number(localStorage.getItem('impossibleRoadTheme'));
if (!Number.isFinite(initialThemeIndex) || initialThemeIndex < 0 || initialThemeIndex >= THEMES.length) {
  initialThemeIndex = 0;
}
themeSelect.value = initialThemeIndex;

// === Input management ======================================================
const inputState = {
  steer: 0,
  steerTarget: 0,
  paused: false,
  slowMotion: false,
  freeCamera: false,
  pointerActive: false,
  isMobile: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  tiltActive: false,
  tiltBaseline: 0,
  tiltSensitivity: 1,
};

const keysDown = new Set();

window.addEventListener('keydown', (ev) => {
  if (['INPUT', 'TEXTAREA'].includes(ev.target.tagName)) return;
  keysDown.add(ev.code);
  if (ev.code === 'KeyA' || ev.code === 'ArrowLeft') inputState.steerTarget = -1;
  if (ev.code === 'KeyD' || ev.code === 'ArrowRight') inputState.steerTarget = 1;
  if (ev.code === 'Space') {
    ev.preventDefault();
    togglePause();
  }
  if (ev.code === 'Digit1') {
    inputState.slowMotion = !inputState.slowMotion;
    setStatus(inputState.slowMotion ? 'Slow motion enabled' : 'Slow motion disabled');
  }
  if (ev.code === 'Digit2') {
    inputState.freeCamera = !inputState.freeCamera;
    setStatus(inputState.freeCamera ? 'Free camera' : 'Chase camera');
  }
  if (ev.code === 'Digit3') {
    regenerateSeed();
  }
});

window.addEventListener('keyup', (ev) => {
  keysDown.delete(ev.code);
  if ((ev.code === 'KeyA' || ev.code === 'ArrowLeft') && inputState.steerTarget < 0) inputState.steerTarget = 0;
  if ((ev.code === 'KeyD' || ev.code === 'ArrowRight') && inputState.steerTarget > 0) inputState.steerTarget = 0;
});

// Smooth pointer / button steering for mobile and desktop.
function updateSteerTarget(value) {
  inputState.steerTarget = clamp(value, -1, 1);
}

const leftButton = document.getElementById('leftButton');
const rightButton = document.getElementById('rightButton');
const touchStartOverlay = document.getElementById('touchStart');
let awaitingFirstInteraction = true;

[leftButton, rightButton].forEach((btn, index) => {
  const direction = index === 0 ? -1 : 1;
  const start = (ev) => {
    ev.preventDefault();
    inputState.pointerActive = true;
    updateSteerTarget(direction);
  };
  const end = (ev) => {
    ev.preventDefault();
    inputState.pointerActive = false;
    updateSteerTarget(0);
  };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointerleave', end);
  btn.addEventListener('pointercancel', end);
});

function enableTilt() {
  window.addEventListener('deviceorientation', handleTilt, true);
  inputState.tiltActive = true;
  inputState.tiltBaseline = lastTiltGamma;
  tiltStatus.textContent = 'Tilt: on';
  setStatus('Tilt steering ready');
}

function attachTilt() {
  if (!window.DeviceOrientationEvent) {
    setStatus('Tilt not available on this device');
    return;
  }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then((response) => {
        if (response === 'granted') {
          enableTilt();
        } else {
          setStatus('Tilt permission denied');
        }
      })
      .catch(() => setStatus('Tilt permission denied'));
  } else {
    enableTilt();
  }
}

function detachTilt() {
  window.removeEventListener('deviceorientation', handleTilt, true);
  inputState.tiltActive = false;
  tiltStatus.textContent = 'Tilt: off';
}

const tiltStatus = document.getElementById('tiltStatus');
function handleTilt(ev) {
  if (!inputState.tiltActive) return;
  const gamma = ev.gamma || 0; // left/right tilt in degrees.
  const delta = (gamma - inputState.tiltBaseline) * inputState.tiltSensitivity * 0.03;
  updateSteerTarget(clamp(delta, -1.5, 1.5));
}

// === Audio system ==========================================================
const audio = {
  context: null,
  master: null,
  whooshOsc: null,
  whooshGain: null,
  enabled: false,
  volume: 0.6,
};

function initAudio() {
  if (audio.context) return;
  audio.context = new AudioContext();
  audio.master = audio.context.createGain();
  audio.master.gain.value = audio.volume;
  audio.master.connect(audio.context.destination);
  audio.enabled = true;
  audio.whooshGain = audio.context.createGain();
  audio.whooshGain.gain.value = 0.0;
  audio.whooshGain.connect(audio.master);
  audio.whooshOsc = audio.context.createOscillator();
  audio.whooshOsc.type = 'sawtooth';
  audio.whooshOsc.frequency.value = 120;
  audio.whooshOsc.connect(audio.whooshGain);
  audio.whooshOsc.start();
}

function playTone(frequency = 440, duration = 0.2, type = 'sine') {
  if (!audio.context) return;
  const osc = audio.context.createOscillator();
  const gain = audio.context.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.value = 0.0;
  gain.connect(audio.master);
  osc.connect(gain);
  osc.start();
  gain.gain.setTargetAtTime(0.4, audio.context.currentTime, 0.01);
  gain.gain.setTargetAtTime(0.0, audio.context.currentTime + duration, 0.05);
  osc.stop(audio.context.currentTime + duration + 0.1);
}

// === Renderer & scene setup ===============================================
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const backgroundGroup = new THREE.Group();
scene.add(backgroundGroup);

// Starfield for depth. Points are recycled rather than recreated.
const starGeometry = new THREE.BufferGeometry();
const STAR_COUNT = 2000;
const starPositions = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  const r = 600 + Math.random() * 800;
  const theta = Math.random() * TAU;
  const phi = Math.acos(2 * Math.random() - 1);
  starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPositions[i * 3 + 1] = r * Math.cos(phi);
  starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
}
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: true, opacity: 0.7, transparent: true });
const stars = new THREE.Points(starGeometry, starMaterial);
backgroundGroup.add(stars);

const world = new THREE.Group();
scene.add(world);

// === Lighting ==============================================================
const hemi = new THREE.HemisphereLight(0x99ccff, 0x070710, 0.6);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(12, 30, 18);
scene.add(dir);

// === Track generation ======================================================
const TRACK_WIDTH = 6.2;
const TRACK_STEP = 2.2;
const TRACK_VISIBLE_LENGTH = 600;
const TRACK_RECYCLE_BACK = 120;

class Track {
  constructor() {
    this.points = [];
    this.segments = [];
    this.mesh = null;
    this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#1d85ff'),
      emissive: new THREE.Color('#05264a'),
      metalness: 0.45,
      roughness: 0.25,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.96,
    });
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    world.add(this.mesh);

    this.currentBank = 0;
    this.currentSlope = 0;
    this.currentCurvature = 0;
    this.currentForward = new THREE.Vector3(0, 0, -1);
    this.currentUp = new THREE.Vector3(0, 1, 0);
    this.currentRight = new THREE.Vector3(1, 0, 0);
    this.lastDistance = 0;
    this.targetBank = 0;
    this.targetCurvature = 0;
    this.targetSlope = 0;
    this.rng = makeRng(1);
    this.nextGateDistance = 40;
    this.gateSpacing = 60;
    this.difficulty = 1;
    this.geometryDirty = true;
  }

  reset(seed) {
    world.remove(this.mesh);
    this.geometry.dispose();
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    world.add(this.mesh);

    this.points = [];
    this.segments = [];
    this.currentBank = 0;
    this.currentSlope = 0;
    this.currentCurvature = 0;
    this.currentForward.set(0, 0, -1);
    this.currentUp.set(0, 1, 0);
    this.currentRight.set(1, 0, 0);
    this.lastDistance = 0;
    this.targetBank = 0;
    this.targetCurvature = 0;
    this.targetSlope = 0;
    this.rng = makeRng(seed);
    this.nextGateDistance = 50;
    this.gateSpacing = 70;
    this.difficulty = 1;
    this.geometryDirty = true;

    // Seed with an initial straight platform.
    const startPoint = {
      position: new THREE.Vector3(0, 8, 0),
      forward: this.currentForward.clone(),
      up: this.currentUp.clone(),
      right: this.currentRight.clone(),
      bank: this.currentBank,
      slope: this.currentSlope,
      distance: 0,
    };
    this.points.push(startPoint);

    for (let i = 0; i < 80; i++) {
      this.spawnNextStep();
    }
    this.rebuildGeometry();
  }

  spawnNextStep() {
    // Adjust targets as score grows; difficulty influences curvature, slope variance, etc.
    if (this.points.length % 40 === 0) {
      // Choose new curvature, slope, and bank targets for the next block.
      const curveStrength = lerp(0.001, 0.008, clamp(this.difficulty * 0.12, 0, 1));
      this.targetCurvature = (this.rng() * 2 - 1) * curveStrength;
      const bankMax = lerp(8, 35, clamp(this.difficulty * 0.1, 0, 1)) * DEG2RAD;
      this.targetBank = (this.rng() * 2 - 1) * bankMax;
      const slopeMax = lerp(2, 12, clamp(this.difficulty * 0.1, 0, 1)) * DEG2RAD;
      this.targetSlope = (this.rng() * 2 - 1) * slopeMax;
    }

    const prev = this.points[this.points.length - 1];
    const nextDistance = prev.distance + TRACK_STEP;

    // Gradually approach targets to ensure fair transitions.
    const curvature = THREE.MathUtils.damp(this.currentCurvature || 0, this.targetCurvature, 3.2, 1.0);
    this.currentCurvature = curvature;
    this.currentBank = THREE.MathUtils.damp(this.currentBank, this.targetBank, 4.5, 1.0);
    this.currentSlope = THREE.MathUtils.damp(this.currentSlope, this.targetSlope, 4.2, 1.0);

    const yawAngle = curvature * TRACK_STEP;
    const slopeAngle = this.currentSlope * (TRACK_STEP / 12);

    this.currentForward.applyAxisAngle(this.currentUp, yawAngle);
    this.currentForward.normalize();

    // Apply slope by pitching forward vector around the current right axis.
    this.currentForward.applyAxisAngle(this.currentRight, slopeAngle);
    this.currentForward.normalize();

    // Update right vector to remain orthogonal.
    this.currentRight.crossVectors(this.currentForward, this.currentUp).normalize().negate();
    this.currentRight.normalize();

    // Apply banking (roll) around forward axis.
    const bankDelta = this.currentBank - prev.bank;
    this.currentUp.applyAxisAngle(this.currentForward, bankDelta);
    this.currentUp.normalize();
    this.currentRight.crossVectors(this.currentForward, this.currentUp).normalize();

    // Integrate new position along the forward axis.
    const newPos = prev.position.clone().addScaledVector(this.currentForward, TRACK_STEP);

    const point = {
      position: newPos,
      forward: this.currentForward.clone(),
      up: this.currentUp.clone(),
      right: this.currentRight.clone(),
      bank: this.currentBank,
      slope: this.currentSlope,
      distance: nextDistance,
    };
    this.points.push(point);
    this.geometryDirty = true;
  }

  ensureLength(targetDistance) {
    while (this.points[this.points.length - 1].distance < targetDistance) {
      this.spawnNextStep();
    }
  }

  recycle(playerDistance) {
    // Drop points that are far behind to avoid unbounded arrays.
    let removed = false;
    while (this.points.length > 50 && this.points[1].distance < playerDistance - TRACK_RECYCLE_BACK) {
      this.points.shift();
      removed = true;
    }
    if (removed) this.geometryDirty = true;
  }

  rebuildGeometry() {
    if (this.points.length < 2) return;
    const quadCount = this.points.length - 1;
    const positions = new Float32Array(quadCount * 6 * 3);
    const normals = new Float32Array(quadCount * 6 * 3);
    const uvs = new Float32Array(quadCount * 6 * 2);

    const halfWidth = TRACK_WIDTH * 0.5;
    let vOffset = 0;
    for (let i = 0; i < quadCount; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      const leftA = a.position.clone().addScaledVector(a.right, -halfWidth);
      const rightA = a.position.clone().addScaledVector(a.right, halfWidth);
      const leftB = b.position.clone().addScaledVector(b.right, -halfWidth);
      const rightB = b.position.clone().addScaledVector(b.right, halfWidth);

      const idx = i * 18; // 6 vertices * 3 components.
      const uvIdx = i * 12;
      const normal = new THREE.Vector3().crossVectors(rightB.clone().sub(rightA), leftB.clone().sub(rightA)).normalize();

      // Triangle 1 (leftA, rightA, rightB)
      positions.set(leftA.toArray(), idx);
      positions.set(rightA.toArray(), idx + 3);
      positions.set(rightB.toArray(), idx + 6);

      // Triangle 2 (leftA, rightB, leftB)
      positions.set(leftA.toArray(), idx + 9);
      positions.set(rightB.toArray(), idx + 12);
      positions.set(leftB.toArray(), idx + 15);

      for (let j = 0; j < 6; j++) {
        normals.set(normal.toArray(), idx + j * 3);
      }

      const stripeScale = 1 / 12;
      const v0 = a.distance * stripeScale;
      const v1 = b.distance * stripeScale;

      uvs.set([0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1], uvIdx);
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.computeBoundingSphere();
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.attributes.uv.needsUpdate = true;
    this.geometryDirty = false;
  }

  sampleAtDistance(distance) {
    // Locate the closest segment using a linear scan (array is modest in size after recycling).
    let i = 0;
    while (i < this.points.length - 2 && this.points[i + 1].distance < distance) i++;
    const a = this.points[i];
    const b = this.points[i + 1];
    const t = clamp((distance - a.distance) / (b.distance - a.distance), 0, 1);
    const pos = new THREE.Vector3().lerpVectors(a.position, b.position, t);
    const forward = new THREE.Vector3().lerpVectors(a.forward, b.forward, t).normalize();
    const up = new THREE.Vector3().lerpVectors(a.up, b.up, t).normalize();
    const right = new THREE.Vector3().lerpVectors(a.right, b.right, t).normalize();
    const dist = lerp(a.distance, b.distance, t);
    return { pos, forward, up, right, distance: dist, index: i };
  }

  projectDistance(position, hintDistance = this.points[0].distance) {
    const len = this.points.length;
    if (len < 2) return hintDistance;
    let baseIndex = 0;
    if (hintDistance <= this.points[0].distance) {
      baseIndex = 0;
    } else if (hintDistance >= this.points[len - 1].distance) {
      baseIndex = len - 2;
    } else {
      for (let i = 0; i < len - 1; i++) {
        if (this.points[i + 1].distance >= hintDistance) {
          baseIndex = i;
          break;
        }
      }
    }
    let bestDistance = Infinity;
    let bestProj = this.points[baseIndex].distance;
    const tmp = new THREE.Vector3();
    const seg = new THREE.Vector3();
    const closest = new THREE.Vector3();
    const start = Math.max(0, baseIndex - 12);
    const end = Math.min(len - 2, baseIndex + 12);
    for (let i = start; i <= end; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      seg.subVectors(b.position, a.position);
      const segLenSq = seg.lengthSq();
      if (segLenSq === 0) continue;
      const t = clamp(tmp.copy(position).sub(a.position).dot(seg) / segLenSq, 0, 1);
      closest.copy(a.position).addScaledVector(seg, t);
      const distSq = closest.distanceToSquared(position);
      if (distSq < bestDistance) {
        bestDistance = distSq;
        bestProj = lerp(a.distance, b.distance, t);
      }
    }
    return bestProj;
  }

  updateTheme(theme) {
    this.material.color.set(theme.road);
    this.material.emissive.set(theme.roadEdge).multiplyScalar(0.25);
  }
}

const track = new Track();

// === Gate pool and scoring ================================================
const gateMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#ff9df5'),
  emissive: new THREE.Color('#ff4fbd'),
  emissiveIntensity: 1.5,
  metalness: 0.3,
  roughness: 0.4,
});
const gateGeom = new THREE.TorusGeometry(2.3, 0.22, 12, 64);

const digitCanvas = document.createElement('canvas');
digitCanvas.width = 128;
digitCanvas.height = 128;
const digitCtx = digitCanvas.getContext('2d');

function makeDigitTexture(num, theme) {
  digitCtx.clearRect(0, 0, 128, 128);
  digitCtx.fillStyle = 'rgba(10,16,30,0.65)';
  digitCtx.fillRect(0, 0, 128, 128);
  digitCtx.strokeStyle = theme.gate;
  digitCtx.lineWidth = 6;
  digitCtx.strokeRect(6, 6, 116, 116);
  digitCtx.fillStyle = theme.gate;
  digitCtx.font = 'bold 72px "Segoe UI", sans-serif';
  digitCtx.textAlign = 'center';
  digitCtx.textBaseline = 'middle';
  digitCtx.fillText(num, 64, 70);
  return new THREE.CanvasTexture(digitCanvas);
}

class GatePool {
  constructor() {
    this.pool = [];
    this.active = [];
    this.theme = THEMES[0];
  }

  acquire() {
    let gate;
    if (this.pool.length > 0) {
      gate = this.pool.pop();
    } else {
      const mesh = new THREE.Mesh(gateGeom, gateMaterial.clone());
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 3.4),
        new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide })
      );
      plane.position.set(0, 0, 0);
      mesh.add(plane);
      gate = { mesh, plane, index: 0, distance: 0 };
    }
    if (!gate.mesh.parent) world.add(gate.mesh);
    gate.mesh.visible = true;
    this.active.push(gate);
    return gate;
  }

  release(gate) {
    gate.mesh.visible = false;
    if (gate.mesh.parent) gate.mesh.parent.remove(gate.mesh);
    this.pool.push(gate);
  }

  reset() {
    this.active.forEach((gate) => {
      if (gate.mesh.parent) gate.mesh.parent.remove(gate.mesh);
      this.pool.push(gate);
    });
    this.active.length = 0;
  }

  updateTheme(theme) {
    this.theme = theme;
    this.active.forEach((gate) => {
      gate.mesh.material.color.set(theme.gate);
      gate.mesh.material.emissive.set(theme.gate).multiplyScalar(0.6);
      gate.plane.material.color = new THREE.Color(theme.gate);
      gate.plane.material.opacity = 0.85;
      gate.plane.material.needsUpdate = true;
    });
  }
}

const gatePool = new GatePool();

// === Player physics ========================================================
const sphereGeometry = new THREE.SphereGeometry(1, 48, 48);
const sphereMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color('#9df0ff'),
  metalness: 0.2,
  roughness: 0.1,
  clearcoat: 1,
  clearcoatRoughness: 0.05,
  envMapIntensity: 1.4,
});
const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
sphereMesh.castShadow = true;
sphereMesh.receiveShadow = false;
world.add(sphereMesh);

class Player {
  constructor() {
    this.radius = 1;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.lateral = 0;
    this.distance = 0;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.onTrack = true;
    this.lastForward = new THREE.Vector3(0, 0, -1);
    this.lastUp = new THREE.Vector3(0, 1, 0);
    this.trailPositions = Array(30).fill(0).map(() => new THREE.Vector3());
  }

  reset() {
    this.forwardSpeed = 18;
    this.lateralSpeed = 0;
    this.lateral = 0;
    this.distance = 2;
    this.position.set(0, 9, 0);
    this.velocity.set(0, 0, 0);
    this.onTrack = true;
    this.lastForward.set(0, 0, -1);
    this.lastUp.set(0, 1, 0);
    this.trailPositions.forEach((p) => p.set(0, 9, 0));
  }

  updateOnTrack(dt, sample) {
    const { forward, up, right, pos } = sample;
    const gravity = -9.8;
    const forwardAccel = gravity * forward.y * 0.8 + 5;
    const steering = clamp(inputState.steer, -1.5, 1.5);
    const lateralForce = steering * 22 - this.lateral * 8;

    this.forwardSpeed += forwardAccel * dt;
    this.forwardSpeed = clamp(this.forwardSpeed, 0, 120);

    this.lateralSpeed += lateralForce * dt;
    this.lateralSpeed *= Math.pow(0.92, dt / 0.016);

    const bankTilt = right.y;
    this.lateralSpeed += bankTilt * 30 * dt;

    this.distance += this.forwardSpeed * dt;
    this.lateral += this.lateralSpeed * dt;
    const limit = TRACK_WIDTH * 0.5 - 0.6;
    if (Math.abs(this.lateral) > limit) {
      // Player slipped off the track. Convert to world-space velocity and fall.
      const lateralClamped = clamp(this.lateral, -limit, limit);
      const sideSpeed = this.lateralSpeed;
      this.onTrack = false;
      this.position.copy(pos).addScaledVector(right, lateralClamped).addScaledVector(up, this.radius * 1.1);
      this.velocity.copy(forward).multiplyScalar(this.forwardSpeed).addScaledVector(right, sideSpeed).addScaledVector(up, -2);
      setStatus('Airborne!');
      return;
    }

    this.position.copy(pos).addScaledVector(right, this.lateral).addScaledVector(up, this.radius * 0.98);
    sphereMesh.position.copy(this.position);

    // Update rotation for visual spin.
    const moveDir = new THREE.Vector3().copy(forward).multiplyScalar(this.forwardSpeed).addScaledVector(right, this.lateralSpeed);
    const speed = moveDir.length();
    if (speed > 0.0001) {
      const axis = new THREE.Vector3().crossVectors(moveDir.clone().normalize(), up).normalize();
      if (axis.lengthSq() > 0.0001) {
        sphereMesh.rotateOnAxis(axis, (speed / this.radius) * dt);
      }
    }

    this.lastForward.copy(forward);
    this.lastUp.copy(up);

    // Extend trail positions for effect.
    this.trailPositions.pop();
    this.trailPositions.unshift(this.position.clone());
  }

  updateAirborne(dt) {
    this.velocity.y += -9.8 * dt;
    this.velocity.multiplyScalar(1 - 0.02 * dt);
    this.position.addScaledVector(this.velocity, dt);
    sphereMesh.position.copy(this.position);
    this.forwardSpeed = this.velocity.length();
    this.trailPositions.pop();
    this.trailPositions.unshift(this.position.clone());
  }
}

const player = new Player();

// === Trail and particles ===================================================
const trailGeometry = new THREE.BufferGeometry();
const trailMaterial = new THREE.LineBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.6 });
const trailLine = new THREE.Line(trailGeometry, trailMaterial);
trailLine.frustumCulled = false;
world.add(trailLine);
const trailBuffer = new Float32Array(30 * 3);
trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailBuffer, 3));

const particleGeometry = new THREE.BufferGeometry();
const PARTICLE_COUNT = 120;
const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
const particleVelocities = new Array(PARTICLE_COUNT).fill(0).map(() => new THREE.Vector3());
const particleAges = new Float32Array(PARTICLE_COUNT);
particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
const particleMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0.0 });
const particlePoints = new THREE.Points(particleGeometry, particleMaterial);
world.add(particlePoints);

function spawnParticles(position, strength = 1) {
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    if (particleAges[i] > 0.01) continue;
    particleAges[i] = 0.001;
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1, Math.random() * 2 - 1).normalize();
    particleVelocities[i].copy(dir).multiplyScalar(5 + Math.random() * 10 * strength);
    particlePositions[i * 3] = position.x;
    particlePositions[i * 3 + 1] = position.y;
    particlePositions[i * 3 + 2] = position.z;
  }
  particleGeometry.attributes.position.needsUpdate = true;
}

function updateParticles(dt) {
  let visible = 0;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    if (particleAges[i] <= 0) continue;
    particleAges[i] += dt;
    if (particleAges[i] > 1.2) {
      particleAges[i] = 0;
      particleVelocities[i].set(0, 0, 0);
      continue;
    }
    visible++;
    particleVelocities[i].y += -9.8 * dt * 0.4;
    particleVelocities[i].multiplyScalar(1 - 0.8 * dt);
    particlePositions[i * 3] += particleVelocities[i].x * dt;
    particlePositions[i * 3 + 1] += particleVelocities[i].y * dt;
    particlePositions[i * 3 + 2] += particleVelocities[i].z * dt;
  }
  particleMaterial.opacity = visible > 0 ? 0.85 : 0.0;
  particleGeometry.attributes.position.needsUpdate = true;
}

// === Camera ================================================================
const chaseCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1600);
const freeCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2200);
const orbitControls = new OrbitControls(freeCamera, renderer.domElement);
orbitControls.enabled = false;
orbitControls.enableDamping = true;
orbitControls.maxDistance = 1000;
freeCamera.position.set(15, 15, 15);
freeCamera.lookAt(0, 0, 0);

const cameraRig = new THREE.Object3D();
const cameraTarget = new THREE.Vector3();

function updateCamera(dt, sample) {
  const activeCamera = inputState.freeCamera ? freeCamera : chaseCamera;
  if (inputState.freeCamera) {
    orbitControls.enabled = true;
    orbitControls.update();
    return activeCamera;
  }
  orbitControls.enabled = false;

  const offsetBack = 12 + clamp(player.forwardSpeed * 0.06, 0, 12);
  const offsetUp = 4 + clamp(player.forwardSpeed * 0.03, 0, 6);
  const desiredPos = sample.pos
    .clone()
    .addScaledVector(sample.forward, -offsetBack)
    .addScaledVector(sample.up, offsetUp)
    .addScaledVector(sample.right, player.lateral * 0.3);

  cameraRig.position.lerp(desiredPos, 1 - Math.pow(0.001, dt));
  cameraTarget.lerp(sample.pos.clone().addScaledVector(sample.up, 2), 1 - Math.pow(0.001, dt));

  chaseCamera.position.copy(cameraRig.position);
  chaseCamera.lookAt(cameraTarget);
  const baseFov = 62;
  const fov = lerp(baseFov, 80, clamp(player.forwardSpeed / 80, 0, 1));
  chaseCamera.fov += (fov - chaseCamera.fov) * clamp(dt * 5, 0, 1);
  chaseCamera.updateProjectionMatrix();
  return chaseCamera;
}

// === UI and leaderboard ====================================================
const scoreValue = document.getElementById('scoreValue');
const bestValue = document.getElementById('bestValue');
const speedValue = document.getElementById('speedValue');
const statusValue = document.getElementById('statusValue');
const seedDisplay = document.getElementById('seedDisplay');
const leaderboardList = document.getElementById('leaderboardList');
const playerNameInput = document.getElementById('playerName');
const saveNameButton = document.getElementById('saveName');
const pauseButton = document.getElementById('pauseButton');
const tiltSensitivitySlider = document.getElementById('tiltSensitivity');
const buttonSizeSlider = document.getElementById('buttonSize');
const volumeSlider = document.getElementById('volumeControl');
const calibrateButton = document.getElementById('calibrateTilt');
const resetProgressButton = document.getElementById('resetProgress');

tiltSensitivitySlider.value = inputState.tiltSensitivity;
volumeSlider.value = audio.volume;
const storedSettings = JSON.parse(localStorage.getItem('impossibleRoadSettings') || '{}');
if (storedSettings.tiltSensitivity) {
  inputState.tiltSensitivity = Number(storedSettings.tiltSensitivity) || 1;
  tiltSensitivitySlider.value = inputState.tiltSensitivity;
}
if (storedSettings.buttonScale) {
  buttonSizeSlider.value = storedSettings.buttonScale;
  const scale = Number(buttonSizeSlider.value);
  leftButton.style.transform = `scale(${scale})`;
  rightButton.style.transform = `scale(${scale})`;
}
if (storedSettings.volume !== undefined) {
  audio.volume = Number(storedSettings.volume);
  volumeSlider.value = audio.volume;
}

function persistSettings() {
  localStorage.setItem(
    'impossibleRoadSettings',
    JSON.stringify({
      tiltSensitivity: inputState.tiltSensitivity,
      buttonScale: Number(buttonSizeSlider.value),
      volume: audio.volume,
    })
  );
}

let playerName = localStorage.getItem('impossibleRoadName') || '';
playerNameInput.value = playerName;
let leaderboard = JSON.parse(localStorage.getItem('impossibleRoadScores') || '[]');
let bestScore = leaderboard.length ? leaderboard[0].score : 0;
bestValue.textContent = bestScore;

function setStatus(text) {
  statusValue.textContent = text;
}

function updateLeaderboard(newScore) {
  if (!playerName) return;
  leaderboard.push({ name: playerName, score: newScore });
  leaderboard.sort((a, b) => b.score - a.score);
  leaderboard = leaderboard.slice(0, 8);
  localStorage.setItem('impossibleRoadScores', JSON.stringify(leaderboard));
  renderLeaderboard();
}

function renderLeaderboard() {
  leaderboardList.innerHTML = '';
  leaderboard.forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${entry.name} — ${entry.score}`;
    leaderboardList.appendChild(li);
  });
  bestScore = leaderboard.length ? leaderboard[0].score : 0;
  bestValue.textContent = bestScore;
}
renderLeaderboard();

saveNameButton.addEventListener('click', () => {
  playerName = playerNameInput.value.trim().slice(0, 12);
  localStorage.setItem('impossibleRoadName', playerName);
  setStatus(playerName ? `Pilot set to ${playerName}` : 'Name cleared');
});

pauseButton.addEventListener('click', () => togglePause());

volumeSlider.addEventListener('input', () => {
  audio.volume = Number(volumeSlider.value);
  if (audio.master) audio.master.gain.value = audio.volume;
  persistSettings();
});

themeSelect.addEventListener('change', () => {
  const themeIndex = Number(themeSelect.value);
  applyTheme(THEMES[themeIndex]);
  localStorage.setItem('impossibleRoadTheme', themeIndex);
});

buttonSizeSlider.addEventListener('input', () => {
  const scale = Number(buttonSizeSlider.value);
  leftButton.style.transform = `scale(${scale})`;
  rightButton.style.transform = `scale(${scale})`;
  persistSettings();
});

tiltSensitivitySlider.addEventListener('input', () => {
  inputState.tiltSensitivity = Number(tiltSensitivitySlider.value);
  persistSettings();
});

calibrateButton.addEventListener('click', () => {
  inputState.tiltBaseline = 0;
  setStatus('Hold device neutral… tilt baseline reset in 1s');
  setTimeout(() => {
    inputState.tiltBaseline = lastTiltGamma;
    setStatus('Tilt calibrated');
  }, 1000);
});

resetProgressButton.addEventListener('click', () => {
  if (confirm('Reset local leaderboard and name?')) {
    localStorage.removeItem('impossibleRoadScores');
    localStorage.removeItem('impossibleRoadName');
    leaderboard = [];
    playerName = '';
    playerNameInput.value = '';
    renderLeaderboard();
    setStatus('Progress cleared');
  }
});

let lastTiltGamma = 0;
let respawnTimeout = null;

// === Game state ===========================================================
const gameState = {
  seed: Math.floor(Math.random() * 1e9),
  rng: makeRng(1),
  score: 0,
  nextGateToSpawn: 1,
  expectedGate: 1,
  nextGateDistance: 60,
  gatesInPlay: [],
  activeTheme: THEMES[0],
  tiltAllowed: false,
  runActive: false,
};

function regenerateSeed() {
  gameState.seed = Math.floor(Math.random() * 0xffffffff);
  startRun();
  setStatus('New track seeded');
}

function applyTheme(theme) {
  gameState.activeTheme = theme;
  document.documentElement.style.setProperty('--accent', theme.roadEdge);
  document.documentElement.style.setProperty('--accent-2', theme.gate);
  document.body.style.background = `radial-gradient(circle at top, ${theme.sky[0]} 0%, ${theme.sky[1]} 60%, #000 100%)`;
  track.updateTheme(theme);
  gatePool.updateTheme(theme);
  sphereMaterial.color.set(theme.ball);
  trailMaterial.color.set(theme.trail);
  particleMaterial.color.set(theme.gate);
}

function startRun() {
  gatePool.reset();
  gameState.gatesInPlay = [];
  gameState.score = 0;
  gameState.nextGateToSpawn = 1;
  gameState.expectedGate = 1;
  gameState.nextGateDistance = 55;
  inputState.slowMotion = false;
  gameState.runActive = true;
  updateScore(0);
  track.reset(gameState.seed);
  player.reset();
  track.ensureLength(player.distance + TRACK_VISIBLE_LENGTH);
  track.rebuildGeometry();
  seedDisplay.textContent = `Seed: ${gameState.seed}`;
  spawnInitialGates();
  setStatus('Rolling…');
}

function spawnInitialGates() {
  gatePool.reset();
  gameState.gatesInPlay.length = 0;
  gameState.nextGateToSpawn = 1;
  gameState.expectedGate = 1;
  gameState.nextGateDistance = 55;
  ensureGatesAhead();
}

function spawnGate() {
  const index = gameState.nextGateToSpawn++;
  const distance = gameState.nextGateDistance;
  const theme = gameState.activeTheme;
  track.ensureLength(distance + 50);
  const gate = gatePool.acquire();
  gate.index = index;
  gate.distance = distance;
  const sample = track.sampleAtDistance(distance);
  gate.mesh.position.copy(sample.pos).addScaledVector(sample.up, 3.5);
  gate.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sample.up.clone().normalize());
  gate.mesh.lookAt(sample.pos.clone().add(sample.forward));
  gate.mesh.material.color.set(theme.gate);
  gate.mesh.material.emissive.set(theme.gate).multiplyScalar(0.6);
  if (gate.plane.material.map) gate.plane.material.map.dispose();
  gate.plane.material.map = makeDigitTexture(index, theme);
  gate.plane.material.transparent = true;
  gate.plane.material.opacity = 0.9;
  gate.plane.material.needsUpdate = true;
  gameState.gatesInPlay.push(gate);
  const spacing = Math.max(36, track.gateSpacing - gameState.score * 0.35);
  gameState.nextGateDistance += spacing;
}

function ensureGatesAhead() {
  const maxGates = 10;
  while (gameState.gatesInPlay.length < maxGates) {
    spawnGate();
  }
}

function recycleGates(playerDistance) {
  for (let i = gameState.gatesInPlay.length - 1; i >= 0; i--) {
    if (gameState.gatesInPlay[i].distance < playerDistance - 50) {
      const removed = gameState.gatesInPlay.splice(i, 1)[0];
      gatePool.release(removed);
    }
  }
  ensureGatesAhead();
}

function updateScore(value) {
  gameState.score = value;
  scoreValue.textContent = value;
  speedValue.textContent = `${player.forwardSpeed.toFixed(0)} u/s`;
  if (audio.whooshGain) {
    audio.whooshGain.gain.value = clamp(player.forwardSpeed / 80, 0, 0.6);
    audio.whooshOsc.frequency.value = 120 + player.forwardSpeed * 1.5;
  }
}

function checkGates() {
  while (gameState.gatesInPlay.length) {
    const gate = gameState.gatesInPlay[0];
    if (player.distance + 4 >= gate.distance) {
      gameState.gatesInPlay.shift();
      gatePool.release(gate);
      gameState.expectedGate = gate.index + 1;
      gameState.score = gate.index;
      track.difficulty = 1 + gameState.score * 0.05;
      track.gateSpacing = Math.max(42 - gameState.score * 0.1, 28);
      updateScore(gameState.score);
      playTone(420 + (gameState.score % 6) * 40, 0.16, 'triangle');
      spawnParticles(player.position, 0.7);
      if (gameState.score > bestScore) {
        bestScore = gameState.score;
        bestValue.textContent = bestScore;
      }
    } else {
      break;
    }
  }
}

function triggerRespawn() {
  if (!gameState.runActive) return;
  gameState.runActive = false;
  if (respawnTimeout) clearTimeout(respawnTimeout);
  if (gameState.score > 0) updateLeaderboard(gameState.score);
  setStatus('Respawning…');
  respawnTimeout = setTimeout(() => {
    player.position.set(0, 9, 0);
    player.velocity.set(0, 0, 0);
    startRun();
  }, 1100);
}

// === Pause / resume =======================================================
function togglePause() {
  inputState.paused = !inputState.paused;
  setStatus(inputState.paused ? 'Paused' : 'Resumed');
}

// === Touch overlay to start ===============================================
function hideTouchOverlay() {
  touchStartOverlay.classList.add('hidden');
}

touchStartOverlay.addEventListener('pointerdown', () => {
  if (awaitingFirstInteraction) {
    awaitingFirstInteraction = false;
    initAudio();
    hideTouchOverlay();
    if (inputState.isMobile) attachTilt();
    startRun();
  } else {
    hideTouchOverlay();
  }
});

// === Window resize ========================================================
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  chaseCamera.aspect = width / height;
  freeCamera.aspect = width / height;
  chaseCamera.updateProjectionMatrix();
  freeCamera.updateProjectionMatrix();
});

// === Physics integration ==================================================
const FIXED_STEP = 1 / 120;
const MAX_DELTA = 0.05;
let accumulator = 0;
let lastTime = performance.now();

function stepPhysics(dt) {
  // Sticky tolerance: clamp dt spikes to avoid tunnelling or exploit.
  const clampedDt = Math.min(dt, MAX_DELTA);
  accumulator += clampedDt;
  while (accumulator >= FIXED_STEP) {
    accumulator -= FIXED_STEP;
    simulate(FIXED_STEP);
  }
}

function simulate(dt) {
  if (player.onTrack) {
    const sample = track.sampleAtDistance(player.distance);
    player.updateOnTrack(dt, sample);
  } else {
    player.updateAirborne(dt);
    const projected = track.projectDistance(player.position, player.distance);
    const sample = track.sampleAtDistance(projected);
    const offset = player.position.clone().sub(sample.pos);
    const lateral = offset.dot(sample.right);
    const height = offset.dot(sample.up);
    const halfWidth = TRACK_WIDTH * 0.5 + 0.4;
    if (
      height < player.radius * 1.5 &&
      height > player.radius * 0.1 &&
      Math.abs(lateral) <= halfWidth &&
      player.velocity.dot(sample.up) <= 0
    ) {
      player.onTrack = true;
      player.distance = projected;
      player.lateral = clamp(lateral, -TRACK_WIDTH * 0.5 + 0.4, TRACK_WIDTH * 0.5 - 0.4);
      player.lateralSpeed = player.velocity.dot(sample.right) * 0.6;
      player.forwardSpeed = Math.max(14, player.velocity.dot(sample.forward));
      player.position
        .copy(sample.pos)
        .addScaledVector(sample.right, player.lateral)
        .addScaledVector(sample.up, player.radius * 0.98);
      player.velocity.set(0, 0, 0);
      sphereMesh.position.copy(player.position);
      spawnParticles(player.position, 1.4);
      playTone(220, 0.4, 'sawtooth');
      setStatus('Recovered');
    }
    player.distance = Math.max(player.distance, projected);
  }
}

// === Main loop ============================================================
function animate(now) {
  requestAnimationFrame(animate);
  const delta = (now - lastTime) / 1000;
  lastTime = now;
  if (inputState.paused) {
    renderer.render(scene, chaseCamera);
    return;
  }

  // Smooth steering input.
  inputState.steer += (inputState.steerTarget - inputState.steer) * Math.min(delta * 12, 1);

  const timeScale = inputState.slowMotion ? 0.35 : 1;
  stepPhysics(delta * timeScale);

  // Ensure track length and gating.
  track.ensureLength(player.distance + TRACK_VISIBLE_LENGTH);
  track.recycle(player.distance);
  if (track.geometryDirty) track.rebuildGeometry();
  recycleGates(player.distance);
  checkGates();
  if (player.position.y < -40) triggerRespawn();

  // Update visuals.
  const sample = track.sampleAtDistance(player.distance + 4);
  updateTrail();
  updateParticles(delta * timeScale);
  const activeCamera = updateCamera(delta * timeScale, sample);
  updateScore(gameState.score);
  gameState.gatesInPlay.forEach((gate) => {
    gate.plane.lookAt(activeCamera.position);
  });

  renderer.render(scene, activeCamera);
}

function updateTrail() {
  const points = player.trailPositions;
  points.forEach((p, i) => {
    trailBuffer[i * 3] = p.x;
    trailBuffer[i * 3 + 1] = p.y - 0.2;
    trailBuffer[i * 3 + 2] = p.z;
  });
  trailGeometry.attributes.position.needsUpdate = true;
  trailGeometry.setDrawRange(0, points.length);
  trailMaterial.opacity = clamp(player.forwardSpeed / 80, 0, 0.8);
}

// === Initialization =======================================================
applyTheme(THEMES[initialThemeIndex]);
startRun();
requestAnimationFrame(animate);

if (!inputState.isMobile) {
  awaitingFirstInteraction = false;
  hideTouchOverlay();
}

// === Device orientation baseline tracking =================================
window.addEventListener('deviceorientation', (ev) => {
  lastTiltGamma = ev.gamma || 0;
});

// Provide exports for debugging in console.
window.__ImpossibleRoad = { track, player, gameState };
