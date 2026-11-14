import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  CASH_STASHES_INIT,
  JUMP_RAMPS_INIT,
  SCAVENGE_NODES_INIT,
  SPEED_TRAPS_INIT,
  WORLD_LANDMARKS,
} from '../constants';
import type { SurfaceSample } from '../sim/mopedPhysics';
import type {
  CashStashDef,
  JumpRampDef,
  ScavengeNodeState,
  SpeedTrapZone,
} from '../types';
import type { ProceduralTextureSet } from './textures';

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WorldVisuals {
  root: THREE.Group;
  sunLight: THREE.DirectionalLight;
  scavengeNodes: ScavengeNodeState[];
  scavengeMarkers: THREE.Object3D[];
  cashStashes: CashStashDef[];
  stashMeshes: THREE.Object3D[];
  speedTraps: SpeedTrapZone[];
  missionBeacon: THREE.Group;
  pcScreenMesh: THREE.Mesh;
  colliders: BoxCollider[];
  sampleSurface: (x: number, z: number) => SurfaceSample;
  resolveCollision: (x: number, z: number, radius?: number) => { x: number; z: number; hit: boolean };
  updateWorld: (
    timeSec: number,
    playerX: number,
    playerZ: number,
    activeWp: { x: number; z: number } | null,
    collectedStashIds: string[]
  ) => void;
  dispose: () => void;
}

const ROAD_HALF_WIDTH = 4.2;
export const WORLD_LIMIT = 240;

const ROAD_LINES_NS = [
  { x: 0, minZ: -199, maxZ: -5 },
  { x: -105, minZ: -199, maxZ: 189 },
  { x: 105, minZ: -199, maxZ: 189 },
  { x: -195, minZ: -199, maxZ: 189 },
  { x: 195, minZ: -199, maxZ: 189 },
];

const ROAD_LINES_EW = [
  { z: -195, minX: -199, maxX: 199 },
  { z: -110, minX: -199, maxX: 199 },
  { z: -18, minX: -199, maxX: 199 },
  { z: 95, minX: -199, maxX: 199 },
  { z: 185, minX: -199, maxX: 199 },
];

export function groundHeightAt(x: number, z: number): number {
  // Scenic Hilltop Lookout rise centered inside SW block (-145, 150), radius 30m
  const hdx = x - -145;
  const hdz = z - 150;
  const hDistSq = hdx * hdx + hdz * hdz;
  const hill =
    hDistSq < 900 ? Math.cos((Math.sqrt(hDistSq) / 30) * (Math.PI / 2)) ** 2 * 5.8 : 0;

  // Quarry dirt berm inside NE block (152, -152), radius 24m
  const qdx = x - 152;
  const qdz = z - -152;
  const qDistSq = qdx * qdx + qdz * qdz;
  const quarryMound =
    qDistSq < 576 ? Math.sin((Math.sqrt(qDistSq) / 24) * Math.PI) * 1.4 : 0;

  // Outer coastal cliffs & perimeter hills beyond 244m
  const radial = Math.max(Math.abs(x), Math.abs(z));
  const rim = radial > 244 ? Math.min(24, ((radial - 244) / 36) ** 1.5 * 14) : 0;

  // Western Coastal Harbor Bay water basin
  if (x < -202 && z < -40) return -0.55;
  return hill + quarryMound + rim;
}

export function rampHeightAt(x: number, z: number, ramps: JumpRampDef[] = JUMP_RAMPS_INIT): number | null {
  for (const r of ramps) {
    const dx = x - r.x;
    const dz = z - r.z;
    const cos = Math.cos(-r.rotY);
    const sin = Math.sin(-r.rotY);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    const halfW = r.width * 0.5;
    const halfL = r.length * 0.5;
    if (Math.abs(lx) <= halfW && lz >= -halfL && lz <= halfL) {
      const t = (halfL - lz) / r.length; // 0 at low entry (+L/2), 1 at high lip (-L/2)
      return groundHeightAt(r.x, r.z) + t * r.height;
    }
  }
  return null;
}

export function totalSurfaceHeightAt(x: number, z: number): number {
  const ground = groundHeightAt(x, z);
  const ramp = rampHeightAt(x, z);
  return ramp !== null ? Math.max(ground, ramp) : ground;
}

export function isPointOnRoad(x: number, z: number): boolean {
  // Garage floor & driveway apron
  if (Math.abs(x) <= 5.5 && z >= -18 && z <= 5.5) return true;
  for (const ns of ROAD_LINES_NS) {
    if (Math.abs(x - ns.x) <= ROAD_HALF_WIDTH && z >= ns.minZ && z <= ns.maxZ) return true;
  }
  for (const ew of ROAD_LINES_EW) {
    if (Math.abs(z - ew.z) <= ROAD_HALF_WIDTH && x >= ew.minX && x <= ew.maxX) return true;
  }
  // Landmark paved driveways & spurs
  if (x >= 28 && x <= 42 && Math.abs(z + 21) <= 3.5) return true;
  if (x >= 105 && x <= 140 && Math.abs(z + 135) <= 4.0) return true;
  if (x >= -145 && x <= -105 && Math.abs(z - 150) <= 3.6) return true;
  return false;
}

export function buildMopedWorld(
  scene: THREE.Scene,
  textures: ProceduralTextureSet,
  enableShadows: boolean
): WorldVisuals {
  const root = new THREE.Group();
  root.name = 'MopedMasterWorld';
  scene.add(root);

  const disposableGeos: THREE.BufferGeometry[] = [];
  const disposableMats: THREE.Material[] = [];
  const colliders: BoxCollider[] = [];

  // 1. Sky + Horizon Fog + 3-Point Outdoor Lighting
  if (enableShadows) {
    const sky = new Sky();
    sky.scale.setScalar(4500);
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 4.2;
    skyUniforms['rayleigh'].value = 1.5;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.82;
    const sunVec = new THREE.Vector3();
    sunVec.setFromSphericalCoords(1, THREE.MathUtils.degToRad(68), THREE.MathUtils.degToRad(142));
    skyUniforms['sunPosition'].value.copy(sunVec);
    root.add(sky);
  } else {
    scene.background = new THREE.Color(0x8ec0e4);
  }

  scene.fog = new THREE.FogExp2(0xc8d9e6, 0.0021);

  const hemiLight = new THREE.HemisphereLight(0xb8dcff, 0x5c5346, enableShadows ? 1.35 : 1.75);
  root.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff0d4, 2.5);
  sunLight.position.set(42, 64, -34);
  sunLight.castShadow = enableShadows;
  if (enableShadows) {
    sunLight.shadow.mapSize.set(1024, 1024);
    const d = 48;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.camera.near = 4;
    sunLight.shadow.camera.far = 170;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
  }
  root.add(sunLight, sunLight.target);

  const garageLight = new THREE.PointLight(0xffcf87, 5.5, 16, 1.6);
  garageLight.position.set(0, 3.2, -0.5);
  root.add(garageLight);

  // 2. Sculpted 560x560m Coastal Peninsula Terrain
  const terrainSegs = enableShadows ? 96 : 48;
  const terrainGeo = new THREE.PlaneGeometry(580, 580, terrainSegs, terrainSegs);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    posAttr.setY(i, groundHeightAt(vx, vz));
  }
  terrainGeo.computeVertexNormals();
  textures.grass.repeat.set(64, 64);
  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.grass,
    roughness: 0.92,
    metalness: 0.02,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = enableShadows;
  root.add(terrain);
  disposableGeos.push(terrainGeo);
  disposableMats.push(terrainMat);

  // Shimmering Western Harbor Ocean Bay
  const waterGeo = new THREE.PlaneGeometry(180, 420);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1b6588,
    roughness: 0.14,
    metalness: 0.45,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.set(-285, -0.18, -95);
  root.add(water);
  disposableGeos.push(waterGeo);
  disposableMats.push(waterMat);

  // 3. Expanded Multi-Avenue & Peninsula Loop Road Network
  const roadMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.asphalt,
    roughness: 0.85,
    metalness: 0.04,
  });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xf0c954,
    roughness: 0.65,
  });
  disposableMats.push(roadMat, stripeMat);

  const addRoadSegment = (cx: number, cz: number, width: number, length: number, rotY = 0) => {
    const geo = new THREE.PlaneGeometry(width, length);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, roadMat);
    mesh.position.set(cx, 0.025, cz);
    mesh.rotation.y = rotY;
    mesh.receiveShadow = enableShadows;
    root.add(mesh);
    disposableGeos.push(geo);

    const stripeGeo = new THREE.PlaneGeometry(0.2, length * 0.96);
    stripeGeo.rotateX(-Math.PI / 2);
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(cx, 0.038, cz);
    stripe.rotation.y = rotY;
    root.add(stripe);
    disposableGeos.push(stripeGeo);
  };

  for (const ns of ROAD_LINES_NS) {
    const len = ns.maxZ - ns.minZ;
    addRoadSegment(ns.x, (ns.minZ + ns.maxZ) * 0.5, ROAD_HALF_WIDTH * 2, len, 0);
  }
  for (const ew of ROAD_LINES_EW) {
    const len = ew.maxX - ew.minX;
    addRoadSegment((ew.minX + ew.maxX) * 0.5, ew.z, ROAD_HALF_WIDTH * 2, len, Math.PI / 2);
  }
  // Quarry & Harbor Spurs
  addRoadSegment(122, -135, 6.8, 34, Math.PI / 2);

  // 4. Home Garage + Virtual PC Workbench
  const garageFloorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.garageFloor,
    roughness: 0.78,
    metalness: 0.06,
  });
  const brickMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.brick,
    roughness: 0.86,
  });
  const metalRoofMat = new THREE.MeshStandardMaterial({
    color: 0x3b424d,
    roughness: 0.48,
    metalness: 0.65,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x7c5334,
    roughness: 0.76,
  });
  disposableMats.push(garageFloorMat, brickMat, metalRoofMat, woodMat);

  const gFloor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 11), garageFloorMat);
  gFloor.position.set(0, -0.025, 0);
  gFloor.receiveShadow = enableShadows;
  root.add(gFloor);

  const addWall = (x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = enableShadows;
    m.receiveShadow = enableShadows;
    root.add(m);
    if (y < 2.5) {
      colliders.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
      });
    }
  };

  addWall(-5.25, 1.9, 0, 0.5, 3.8, 11, brickMat);
  addWall(5.25, 1.9, 0, 0.5, 3.8, 11, brickMat);
  addWall(0, 1.9, 5.25, 11, 3.8, 0.5, brickMat);
  addWall(-4.0, 1.9, -5.25, 2.5, 3.8, 0.5, brickMat);
  addWall(4.0, 1.9, -5.25, 2.5, 3.8, 0.5, brickMat);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(11, 0.7, 0.55), metalRoofMat);
  lintel.position.set(0, 3.45, -5.25);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.25, 11.6), metalRoofMat);
  roof.position.set(0, 3.92, 0);
  roof.castShadow = enableShadows;
  root.add(lintel, roof);

  const liftMat = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.02, 2.6),
    new THREE.MeshStandardMaterial({ color: 0x1d2229, roughness: 0.9 })
  );
  liftMat.position.set(0, 0.025, 0);
  root.add(liftMat);

  const benchGroup = new THREE.Group();
  benchGroup.position.set(WORLD_LANDMARKS.pcBench.x, 0.015, WORLD_LANDMARKS.pcBench.z);
  benchGroup.rotation.y = Math.PI / 2;
  const benchTop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.85), woodMat);
  benchTop.position.set(0, 0.9, 0);
  benchTop.castShadow = enableShadows;
  benchGroup.add(benchTop);
  for (const lx of [-0.95, 0.95]) {
    for (const lz of [-0.32, 0.32]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.88, 0.08), metalRoofMat);
      leg.position.set(lx, 0.44, lz);
      benchGroup.add(leg);
    }
  }
  const pcMonitor = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.46, 0.14), metalRoofMat);
  pcMonitor.position.set(0, 1.24, -0.1);
  const pcScreenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.38),
    new THREE.MeshBasicMaterial({ map: textures.pcScreen })
  );
  pcScreenMesh.position.set(0, 1.24, -0.025);
  const pcTower = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.46, 0.44), metalRoofMat);
  pcTower.position.set(0.62, 1.17, -0.05);
  const keyboard = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.03, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x252a32, roughness: 0.6 })
  );
  keyboard.position.set(0, 0.955, 0.18);
  benchGroup.add(pcMonitor, pcScreenMesh, pcTower, keyboard);
  root.add(benchGroup);
  colliders.push({
    minX: WORLD_LANDMARKS.pcBench.x - 0.6,
    maxX: WORLD_LANDMARKS.pcBench.x + 0.6,
    minZ: WORLD_LANDMARKS.pcBench.z - 1.2,
    maxZ: WORLD_LANDMARKS.pcBench.z + 1.2,
  });

  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1e2024, roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const spareTire = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.075, 10, 18), tireMat);
    spareTire.rotation.x = Math.PI / 2;
    spareTire.position.set(3.8, 0.13 + i * 0.14, 3.8);
    root.add(spareTire);
  }

  // 5. Named Commercial & Industrial District Buildings
  const districtBuildings = [
    // Pizzeria Napoli (34, -28)
    { x: WORLD_LANDMARKS.pizzeria.x, z: WORLD_LANDMARKS.pizzeria.z, w: 9, h: 5.2, d: 7, wallColor: 0xd9a87e, roofColor: 0x8f3324, signColor: 0xdf3b2c, awningColor: 0xcf2e22 },
    // Sunrise Bakery (-48, -28)
    { x: WORLD_LANDMARKS.bakery.x, z: WORLD_LANDMARKS.bakery.z, w: 10, h: 5.8, d: 7.5, wallColor: 0xe6d4b5, roofColor: 0x5c4232, signColor: 0xf5a623, awningColor: 0xd98026 },
    // Espresso Moto Bar (-92, -32)
    { x: WORLD_LANDMARKS.espresso.x, z: WORLD_LANDMARKS.espresso.z, w: 9.5, h: 6.4, d: 8, wallColor: 0xc97b5b, roofColor: 0x353b45, signColor: 0x2ec4b6, awningColor: 0x1e6b65 },
    // Bologna Moto Depot (88, -28)
    { x: WORLD_LANDMARKS.hardwareDepot.x, z: WORLD_LANDMARKS.hardwareDepot.z, w: 12, h: 6.2, d: 8, wallColor: 0x7e8c9c, roofColor: 0x2c3645, signColor: 0xf5a623, awningColor: 0x455366 },
    // Starlight Diner (-88, 72)
    { x: WORLD_LANDMARKS.diner.x, z: WORLD_LANDMARKS.diner.z, w: 11, h: 4.6, d: 7.5, wallColor: 0xdde3ea, roofColor: 0xb82b2b, signColor: 0x38d9a9, awningColor: 0x226688 },
    // Premix Fuel & Oil Gas Station (90, 82)
    { x: WORLD_LANDMARKS.gasStation.x, z: WORLD_LANDMARKS.gasStation.z, w: 10, h: 4.4, d: 6.5, wallColor: 0xcfd6de, roofColor: 0x2b6cb0, signColor: 0xffc857, awningColor: 0x22558a },
    // East Salvage Barn (165, 115) & Foundry
    { x: WORLD_LANDMARKS.scrapyard.x, z: WORLD_LANDMARKS.scrapyard.z, w: 12, h: 5.5, d: 9, wallColor: 0x6f777d, roofColor: 0x7c4632, signColor: 0xf5a623, awningColor: 0x454c54 },
    { x: 145, z: 135, w: 14, h: 7.5, d: 10, wallColor: 0x5c646b, roofColor: 0x3b4046, signColor: 0xe64833, awningColor: 0x3a3f45 },
    // Harbor Fish Market & Warehouses
    { x: -162, z: -124, w: 12, h: 5.0, d: 8, wallColor: 0x8da4b5, roofColor: 0x385369, signColor: 0x5bc0be, awningColor: 0x2c475e },
    { x: -178, z: -82, w: 14, h: 6.8, d: 9, wallColor: 0x76828d, roofColor: 0x2b3642, signColor: 0xf5a623, awningColor: 0x3a4959 },
    // Downtown Mid-rise Shops & Flats
    { x: 24, z: -132, w: 12, h: 11.5, d: 10, wallColor: 0xc9b8a3, roofColor: 0x4b535e, signColor: 0x2ec4b6, awningColor: 0x365f6b },
    { x: -28, z: -132, w: 11, h: 9.8, d: 9.5, wallColor: 0xbda188, roofColor: 0x69372e, signColor: 0xffc857, awningColor: 0x703e2a },
    { x: -64, z: -132, w: 13, h: 13.0, d: 10, wallColor: 0x9da7b2, roofColor: 0x323944, signColor: 0x6bc5ff, awningColor: 0x374759 },
    { x: 64, z: -132, w: 12, h: 10.6, d: 10, wallColor: 0xd1bfa9, roofColor: 0x624136, signColor: 0xf5a623, awningColor: 0x7c4f3d },
  ];

  for (const b of districtBuildings) {
    buildBuilding(root, colliders, enableShadows, b);
  }

  // Gas Station Fuel Pumps & Overhead Canopy
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(9.5, 0.45, 5.2),
    new THREE.MeshStandardMaterial({ color: 0x22558a, roughness: 0.5 })
  );
  canopy.position.set(82, 4.1, 74);
  canopy.castShadow = enableShadows;
  root.add(canopy);
  for (const px of [79, 85]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.38, 4.0, 0.38), metalRoofMat);
    pillar.position.set(px, 2.0, 74);
    const pump = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 1.55, 0.55),
      new THREE.MeshStandardMaterial({ color: 0xd63928, roughness: 0.45 })
    );
    pump.position.set(px + 0.9, 0.78, 74);
    root.add(pillar, pump);
    colliders.push({ minX: px - 0.5, maxX: px + 1.3, minZ: 73.2, maxZ: 74.8 });
  }

  // 5b. Harbor Pier, Lighthouse & Shipping Containers (-175, -145)
  const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(7, 0.3, 36), woodMat);
  pierDeck.position.set(-196, 0.14, -155);
  pierDeck.rotation.y = Math.PI / 5;
  pierDeck.receiveShadow = enableShadows;
  root.add(pierDeck);

  const lhX = -194;
  const lhZ = -170;
  const lhBase = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 3.0, 6.0, 16),
    new THREE.MeshStandardMaterial({ color: 0xebe6da, roughness: 0.7 })
  );
  lhBase.position.set(lhX, 3.0, lhZ);
  lhBase.castShadow = enableShadows;
  const lhMid = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 2.4, 7.0, 16),
    new THREE.MeshStandardMaterial({ color: 0xc83228, roughness: 0.65 })
  );
  lhMid.position.set(lhX, 9.5, lhZ);
  lhMid.castShadow = enableShadows;
  const lhTop = new THREE.Mesh(
    new THREE.CylinderGeometry(1.45, 1.9, 5.5, 16),
    new THREE.MeshStandardMaterial({ color: 0xebe6da, roughness: 0.65 })
  );
  lhTop.position.set(lhX, 15.75, lhZ);
  const lhLantern = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 2.0, 12),
    new THREE.MeshStandardMaterial({
      color: 0xfff1a8,
      emissive: 0xffc845,
      emissiveIntensity: 2.0,
      roughness: 0.2,
    })
  );
  lhLantern.position.set(lhX, 19.5, lhZ);
  const lhCap = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.6, 12), metalRoofMat);
  lhCap.position.set(lhX, 21.3, lhZ);
  root.add(lhBase, lhMid, lhTop, lhLantern, lhCap);
  colliders.push({ minX: lhX - 3.0, maxX: lhX + 3.0, minZ: lhZ - 3.0, maxZ: lhZ + 3.0 });

  // Harbor Cargo Containers
  const containerDefs = [
    { x: -162, z: -158, color: 0x2c6e91, rotY: 0 },
    { x: -154, z: -158, color: 0xb8402e, rotY: 0 },
    { x: -162, z: -148, color: 0x2f754d, rotY: 0.15 },
    { x: -145, z: -132, color: 0xc27b25, rotY: Math.PI / 2 },
  ];
  for (const c of containerDefs) {
    const cm = new THREE.Mesh(
      new THREE.BoxGeometry(6.0, 2.6, 2.5),
      new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.72 })
    );
    cm.position.set(c.x, 1.3, c.z);
    cm.rotation.y = c.rotY;
    cm.castShadow = enableShadows;
    root.add(cm);
    colliders.push({ minX: c.x - 3.1, maxX: c.x + 3.1, minZ: c.z - 1.5, maxZ: c.z + 1.5 });
  }

  // East Salvage Silos
  const siloMat = new THREE.MeshStandardMaterial({ color: 0x8d959e, metalness: 0.6, roughness: 0.45 });
  for (const sx of [178, 184]) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 11.0, 14), siloMat);
    silo.position.set(sx, 5.5, 142);
    silo.castShadow = enableShadows;
    root.add(silo);
    colliders.push({ minX: sx - 2.4, maxX: sx + 2.4, minZ: 139.5, maxZ: 144.5 });
  }

  // 5c. Hilltop Lookout Gazebo + Blinking Radio Mast (-145, 150)
  const hillY = groundHeightAt(-145, 150);
  const gazeboBase = new THREE.Mesh(
    new THREE.CylinderGeometry(3.8, 4.2, 0.45, 8),
    new THREE.MeshStandardMaterial({ color: 0x8d887e, roughness: 0.88 })
  );
  gazeboBase.position.set(-145, hillY + 0.22, 150);
  root.add(gazeboBase);
  for (let p = 0; p < 4; p++) {
    const a = (p * Math.PI) / 2 + Math.PI / 4;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.2, 8), woodMat);
    post.position.set(-145 + Math.cos(a) * 2.8, hillY + 1.9, 150 + Math.sin(a) * 2.8);
    post.castShadow = enableShadows;
    root.add(post);
  }
  const gazeboRoof = new THREE.Mesh(new THREE.ConeGeometry(4.3, 2.0, 8), metalRoofMat);
  gazeboRoof.position.set(-145, hillY + 4.4, 150);
  gazeboRoof.castShadow = enableShadows;
  root.add(gazeboRoof);

  // Tall Hilltop Radio Tower
  const towerY = groundHeightAt(-158, 138);
  const towerMast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.85, 22, 6), metalRoofMat);
  towerMast.position.set(-158, towerY + 11, 138);
  const towerBeaconMat = new THREE.MeshStandardMaterial({
    color: 0xff3b30,
    emissive: 0xff3b30,
    emissiveIntensity: 2.0,
  });
  const towerBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10), towerBeaconMat);
  towerBeacon.position.set(-158, towerY + 22.3, 138);
  root.add(towerMast, towerBeacon);
  disposableMats.push(towerBeaconMat);

  // 5d. Instanced Neighborhood Houses & Apartment Blocks (~28 buildings across outer districts)
  const townBlockSpots: Array<{ x: number; z: number; sx: number; sy: number; sz: number; hsl: [number, number, number] }> = [
    // NW & North Town blocks
    { x: -135, z: -55, sx: 10, sy: 6.2, sz: 8, hsl: [0.08, 0.35, 0.68] },
    { x: -158, z: -55, sx: 11, sy: 7.4, sz: 8.5, hsl: [0.56, 0.25, 0.62] },
    { x: -135, z: -85, sx: 10, sy: 5.5, sz: 8, hsl: [0.1, 0.42, 0.7] },
    { x: -55, z: -72, sx: 11, sy: 8.8, sz: 9, hsl: [0.06, 0.28, 0.65] },
    { x: -26, z: -72, sx: 10, sy: 10.2, sz: 9, hsl: [0.58, 0.18, 0.64] },
    { x: 26, z: -72, sx: 11, sy: 9.4, sz: 9, hsl: [0.09, 0.3, 0.72] },
    { x: 58, z: -72, sx: 12, sy: 11.4, sz: 9, hsl: [0.55, 0.22, 0.58] },
    { x: -145, z: -172, sx: 12, sy: 7.2, sz: 8.5, hsl: [0.54, 0.28, 0.6] },
    { x: -65, z: -172, sx: 11, sy: 8.2, sz: 8.5, hsl: [0.07, 0.34, 0.68] },
    { x: 45, z: -172, sx: 12, sy: 9.6, sz: 9, hsl: [0.1, 0.28, 0.66] },
    // South & Suburban districts
    { x: -34, z: 26, sx: 9.5, sy: 5.6, sz: 7.5, hsl: [0.09, 0.36, 0.74] },
    { x: -64, z: 26, sx: 9.5, sy: 5.2, sz: 7.5, hsl: [0.55, 0.26, 0.66] },
    { x: -34, z: 62, sx: 10, sy: 6.4, sz: 8, hsl: [0.05, 0.35, 0.64] },
    { x: 34, z: 26, sx: 9.5, sy: 5.8, sz: 7.5, hsl: [0.12, 0.38, 0.7] },
    { x: 64, z: 26, sx: 9.5, sy: 5.0, sz: 7.5, hsl: [0.58, 0.24, 0.68] },
    { x: 34, z: 62, sx: 10, sy: 6.6, sz: 8, hsl: [0.07, 0.32, 0.66] },
    { x: -55, z: 128, sx: 10.5, sy: 5.5, sz: 8, hsl: [0.1, 0.36, 0.72] },
    { x: -24, z: 128, sx: 10, sy: 5.2, sz: 8, hsl: [0.56, 0.24, 0.65] },
    { x: 24, z: 128, sx: 10, sy: 5.8, sz: 8, hsl: [0.06, 0.32, 0.67] },
    { x: 58, z: 128, sx: 11, sy: 6.2, sz: 8.5, hsl: [0.11, 0.3, 0.7] },
    { x: -55, z: 158, sx: 10, sy: 5.0, sz: 7.5, hsl: [0.54, 0.25, 0.64] },
    { x: 55, z: 158, sx: 10.5, sy: 5.4, sz: 8, hsl: [0.08, 0.36, 0.71] },
    // East district & Industrial
    { x: 145, z: -55, sx: 12, sy: 7.2, sz: 9, hsl: [0.58, 0.16, 0.56] },
    { x: 168, z: -55, sx: 11, sy: 6.0, sz: 8.5, hsl: [0.07, 0.24, 0.58] },
    { x: 145, z: 25, sx: 12, sy: 6.5, sz: 9, hsl: [0.56, 0.18, 0.55] },
    { x: 168, z: 58, sx: 11, sy: 7.8, sz: 9, hsl: [0.05, 0.22, 0.52] },
    { x: -145, z: 28, sx: 10.5, sy: 5.6, sz: 8, hsl: [0.1, 0.35, 0.7] },
    { x: -168, z: 62, sx: 10.5, sy: 6.0, sz: 8, hsl: [0.55, 0.25, 0.65] },
  ];

  const houseWallGeo = new THREE.BoxGeometry(1, 1, 1);
  houseWallGeo.translate(0, 0.5, 0);
  const houseRoofGeo = new THREE.BoxGeometry(1.06, 0.12, 1.06);
  const houseWallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const houseRoofMat = new THREE.MeshStandardMaterial({ color: 0x5c3b2e, roughness: 0.7 });

  const instWalls = new THREE.InstancedMesh(houseWallGeo, houseWallMat, townBlockSpots.length);
  const instRoofs = new THREE.InstancedMesh(houseRoofGeo, houseRoofMat, townBlockSpots.length);
  instWalls.castShadow = enableShadows;
  instWalls.receiveShadow = enableShadows;
  instRoofs.castShadow = enableShadows;

  const bDummy = new THREE.Object3D();
  const bTint = new THREE.Color();
  townBlockSpots.forEach((b, idx) => {
    const by = groundHeightAt(b.x, b.z);
    bDummy.position.set(b.x, by, b.z);
    bDummy.rotation.set(0, 0, 0);
    bDummy.scale.set(b.sx, b.sy, b.sz);
    bDummy.updateMatrix();
    instWalls.setMatrixAt(idx, bDummy.matrix);
    bTint.setHSL(b.hsl[0], b.hsl[1], b.hsl[2]);
    instWalls.setColorAt(idx, bTint);

    bDummy.position.set(b.x, by + b.sy + 0.06, b.z);
    bDummy.scale.set(b.sx, 1, b.sz);
    bDummy.updateMatrix();
    instRoofs.setMatrixAt(idx, bDummy.matrix);

    colliders.push({
      minX: b.x - b.sx / 2,
      maxX: b.x + b.sx / 2,
      minZ: b.z - b.sz / 2,
      maxZ: b.z + b.sz / 2,
    });
  });
  instWalls.instanceMatrix.needsUpdate = true;
  if (instWalls.instanceColor) instWalls.instanceColor.needsUpdate = true;
  instRoofs.instanceMatrix.needsUpdate = true;
  instWalls.computeBoundingSphere();
  instRoofs.computeBoundingSphere();
  root.add(instWalls, instRoofs);
  disposableGeos.push(houseWallGeo, houseRoofGeo);
  disposableMats.push(houseWallMat, houseRoofMat);

  // 6. Jump Ramps (solid sloped wedge geometry matching rampHeightAt 1:1)
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x3b424d, roughness: 0.65 });
  const rampStripeMat = new THREE.MeshStandardMaterial({
    color: 0xf5a623,
    emissive: 0xf5a623,
    emissiveIntensity: 0.22,
    roughness: 0.5,
  });
  disposableMats.push(rampMat, rampStripeMat);
  for (const ramp of JUMP_RAMPS_INIT) {
    const baseY = groundHeightAt(ramp.x, ramp.z);
    const shape = new THREE.Shape();
    const hl = ramp.length * 0.5;
    // In local XY before extrusion along Z (we'll rotate so slope goes up toward -Z)
    shape.moveTo(-hl, 0);
    shape.lineTo(hl, 0);
    shape.lineTo(-hl, ramp.height);
    shape.closePath();
    const wedgeGeo = new THREE.ExtrudeGeometry(shape, { depth: ramp.width, bevelEnabled: false });
    wedgeGeo.translate(0, 0, -ramp.width * 0.5);
    wedgeGeo.rotateY(-Math.PI / 2); // now -Z is the tall lip (+ramp.height), +Z is low entry (0)

    const wedge = new THREE.Mesh(wedgeGeo, rampMat);
    wedge.position.set(ramp.x, baseY, ramp.z);
    wedge.rotation.y = ramp.rotY;
    wedge.castShadow = enableShadows;
    wedge.receiveShadow = enableShadows;

    // Glowing lip chevron bar on top edge
    const lipBar = new THREE.Mesh(new THREE.BoxGeometry(ramp.width, 0.12, 0.45), rampStripeMat);
    lipBar.position.set(0, ramp.height - 0.02, -hl + 0.25);
    wedge.add(lipBar);
    root.add(wedge);
    disposableGeos.push(wedgeGeo);
  }

  // 7. Radar Speed Trap Gantries (3 free-roam speed traps across avenues)
  const speedTraps: SpeedTrapZone[] = SPEED_TRAPS_INIT.map((s) => ({ ...s }));
  const gantryMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 0.65, roughness: 0.35 });
  disposableMats.push(gantryMat);

  for (const trap of speedTraps) {
    const trapGroup = new THREE.Group();
    trapGroup.position.set(trap.x, groundHeightAt(trap.x, trap.z), trap.z);
    if (Math.abs(trap.x) === 105 && Math.abs(trap.z) === 195) {
      // Positioned on EW road -> straddle Z
      trapGroup.rotation.y = Math.PI / 2;
    } else if (trap.id === 'trap_east_coast') {
      trapGroup.rotation.y = Math.PI / 2;
    }

    for (const sx of [-4.6, 4.6]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.2, 0.35), gantryMat);
      pillar.position.set(sx, 2.6, 0);
      pillar.castShadow = enableShadows;
      trapGroup.add(pillar);
    }
    const crossbar = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.55, 0.45), gantryMat);
    crossbar.position.set(0, 5.1, 0);
    const radarSign = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.8, 0.55),
      new THREE.MeshStandardMaterial({
        color: 0x161920,
        emissive: 0x2ec4b6,
        emissiveIntensity: 0.65,
        roughness: 0.35,
      })
    );
    radarSign.position.set(0, 5.1, 0);
    trapGroup.add(crossbar, radarSign);
    root.add(trapGroup);
  }

  // 8. InstancedMesh Streetlamps (40 lamps lining major intersections)
  const lampPositions: Array<{ x: number; z: number }> = [];
  for (const rx of [-195, -105, 0, 105, 195]) {
    for (const rz of [-160, -80, 40, 140]) {
      lampPositions.push({ x: rx + 5.2, z: rz });
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 4.8, 6);
  poleGeo.translate(0, 2.4, 0);
  const bulbGeo = new THREE.SphereGeometry(0.24, 8, 8);
  bulbGeo.translate(0, 4.85, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x353b45, metalness: 0.6, roughness: 0.4 });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff3c4,
    emissive: 0xffd275,
    emissiveIntensity: 1.4,
  });
  const lampPoles = new THREE.InstancedMesh(poleGeo, poleMat, lampPositions.length);
  const lampBulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampPositions.length);
  lampPositions.forEach((lp, idx) => {
    bDummy.position.set(lp.x, groundHeightAt(lp.x, lp.z), lp.z);
    bDummy.rotation.set(0, 0, 0);
    bDummy.scale.setScalar(1);
    bDummy.updateMatrix();
    lampPoles.setMatrixAt(idx, bDummy.matrix);
    lampBulbs.setMatrixAt(idx, bDummy.matrix);
  });
  lampPoles.instanceMatrix.needsUpdate = true;
  lampBulbs.instanceMatrix.needsUpdate = true;
  root.add(lampPoles, lampBulbs);
  disposableGeos.push(poleGeo, bulbGeo);
  disposableMats.push(poleMat, bulbMat);

  // 9. InstancedMesh Cypress & Pine Trees (~190 trees across hills, parks & perimeter)
  const treePositions: Array<{ x: number; z: number; s: number }> = [];
  for (let i = 0; i < 120; i++) {
    const angle = (i / 120) * Math.PI * 2;
    const rad = 212 + (i % 5) * 9;
    const tx = Math.cos(angle) * rad;
    const tz = Math.sin(angle) * rad;
    if (tx < -198 && tz < -40) continue; // keep harbor water clear
    treePositions.push({ x: tx, z: tz, s: 0.9 + ((i * 37) % 10) * 0.05 });
  }
  for (let gx = -180; gx <= 180; gx += 36) {
    for (let gz = -180; gz <= 180; gz += 36) {
      const tx = gx + ((gx * 13 + gz * 7) % 9);
      const tz = gz + ((gx * 5 + gz * 17) % 9);
      if (isPointOnRoad(tx, tz)) continue;
      if (Math.abs(tx) < 16 && Math.abs(tz) < 16) continue;
      if (tx < -140 && tz < -60) continue;
      const blocked = colliders.some(
        (c) => tx >= c.minX - 3 && tx <= c.maxX + 3 && tz >= c.minZ - 3 && tz <= c.maxZ + 3
      );
      if (!blocked) {
        treePositions.push({ x: tx, z: tz, s: 0.88 + (Math.abs(gx + gz) % 4) * 0.1 });
      }
    }
  }

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 7);
  trunkGeo.translate(0, 1.1, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c422c, roughness: 0.92 });
  const canopyGeo = new THREE.ConeGeometry(1.55, 4.6, 8);
  canopyGeo.translate(0, 4.0, 0);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2f6039, roughness: 0.82 });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treePositions.length);
  trunks.castShadow = enableShadows;
  canopies.castShadow = enableShadows;

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  treePositions.forEach((t, idx) => {
    const ty = groundHeightAt(t.x, t.z);
    dummy.position.set(t.x, ty, t.z);
    dummy.rotation.set(0, idx * 0.7, 0);
    dummy.scale.setScalar(t.s);
    dummy.updateMatrix();
    trunks.setMatrixAt(idx, dummy.matrix);
    canopies.setMatrixAt(idx, dummy.matrix);
    tint.setHSL(0.32 + ((idx % 5) - 2) * 0.015, 0.38, 0.28 + (idx % 3) * 0.04);
    canopies.setColorAt(idx, tint);
  });
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
  trunks.computeBoundingSphere();
  canopies.computeBoundingSphere();
  root.add(trunks, canopies);
  disposableGeos.push(trunkGeo, canopyGeo);
  disposableMats.push(trunkMat, canopyMat);

  // 10. 12 Scavenge Nodes (crates + floating amber ring beacon)
  const scavengeNodes: ScavengeNodeState[] = SCAVENGE_NODES_INIT.map((n) => ({
    ...n,
    lootTable: [...n.lootTable],
  }));
  const scavengeMarkers: THREE.Object3D[] = [];
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x9b6b3a, roughness: 0.85 });
  const beaconMat = new THREE.MeshBasicMaterial({
    color: 0xffc857,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  disposableMats.push(crateMat, beaconMat);

  for (const node of scavengeNodes) {
    const ny = groundHeightAt(node.x, node.z);
    const group = new THREE.Group();
    group.position.set(node.x, ny, node.z);

    const crate1 = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.95), crateMat);
    crate1.position.set(0, 0.375, 0);
    crate1.castShadow = enableShadows;
    const crate2 = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.55, 0.65), woodMat);
    crate2.position.set(0.65, 0.275, 0.35);
    crate2.rotation.y = 0.4;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 8, 20), beaconMat);
    ring.position.set(0, 1.55, 0);
    group.add(crate1, crate2, ring);
    root.add(group);
    scavengeMarkers.push(ring);
  }

  // 11. 8 Hidden Golden Cash Stashes (spinning emerald/gold crystal + chest)
  const cashStashes: CashStashDef[] = CASH_STASHES_INIT.map((s) => ({ ...s }));
  const stashMeshes: THREE.Object3D[] = [];
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.55,
    metalness: 0.7,
    roughness: 0.2,
  });
  const tealOrbMat = new THREE.MeshBasicMaterial({
    color: 0x38f2d8,
    transparent: true,
    opacity: 0.85,
  });
  disposableMats.push(goldMat, tealOrbMat);

  for (const stash of cashStashes) {
    const sy = groundHeightAt(stash.x, stash.z);
    const sGroup = new THREE.Group();
    sGroup.position.set(stash.x, sy, stash.z);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.55, 0.6), goldMat);
    box.position.set(0, 0.28, 0);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), tealOrbMat);
    gem.position.set(0, 1.35, 0);
    sGroup.add(box, gem);
    root.add(sGroup);
    stashMeshes.push(sGroup);
  }

  // 12. Active Mission Target Beacon (tall translucent teal beam + ring)
  const missionBeacon = new THREE.Group();
  missionBeacon.visible = false;
  const beamGeo = new THREE.CylinderGeometry(1.6, 1.6, 48, 20, 1, true);
  beamGeo.translate(0, 24, 0);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x2ec4b6,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const baseRing = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 2.85, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0x8bf0e6,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    })
  );
  baseRing.position.y = 0.08;
  missionBeacon.add(new THREE.Mesh(beamGeo, beamMat), baseRing);
  root.add(missionBeacon);
  disposableGeos.push(beamGeo);
  disposableMats.push(beamMat);

  return {
    root,
    sunLight,
    scavengeNodes,
    scavengeMarkers,
    cashStashes,
    stashMeshes,
    speedTraps,
    missionBeacon,
    pcScreenMesh,
    colliders,
    sampleSurface(x: number, z: number): SurfaceSample {
      let y = totalSurfaceHeightAt(x, z);
      const onRamp = rampHeightAt(x, z) !== null;
      const onRoad = isPointOnRoad(x, z) || onRamp;
      if (Math.abs(x) <= 0.75 && Math.abs(z) <= 1.3) {
        y = 0.035;
      } else if (Math.abs(x) <= 5.5 && Math.abs(z) <= 5.5) {
        y = 0.015;
      } else if (onRoad) {
        y = Math.max(y, 0.025);
      }
      const eps = 0.45;
      const slopeX = (totalSurfaceHeightAt(x + eps, z) - totalSurfaceHeightAt(x - eps, z)) / (2 * eps);
      const slopeZ = (totalSurfaceHeightAt(x, z + eps) - totalSurfaceHeightAt(x, z - eps)) / (2 * eps);
      return {
        groundY: y,
        onRoad,
        bumpiness: onRoad ? 0.04 : 0.42,
        slopeX,
        slopeZ,
      };
    },
    resolveCollision(x: number, z: number, radius = 0.55) {
      let nx = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, x));
      let nz = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, z));
      let hit = nx !== x || nz !== z;

      for (const box of colliders) {
        const closestX = Math.max(box.minX, Math.min(nx, box.maxX));
        const closestZ = Math.max(box.minZ, Math.min(nz, box.maxZ));
        const dx = nx - closestX;
        const dz = nz - closestZ;
        const distSq = dx * dx + dz * dz;
        if (distSq < radius * radius) {
          hit = true;
          if (distSq > 0.00001) {
            const dist = Math.sqrt(distSq);
            const push = radius - dist;
            nx += (dx / dist) * push;
            nz += (dz / dist) * push;
          } else {
            const left = Math.abs(nx - box.minX);
            const right = Math.abs(box.maxX - nx);
            const top = Math.abs(nz - box.minZ);
            const bottom = Math.abs(box.maxZ - nz);
            const m = Math.min(left, right, top, bottom);
            if (m === left) nx = box.minX - radius;
            else if (m === right) nx = box.maxX + radius;
            else if (m === top) nz = box.minZ - radius;
            else nz = box.maxZ + radius;
          }
        }
      }
      return { x: nx, z: nz, hit };
    },
    updateWorld(timeSec, playerX, playerZ, activeWp, collectedStashIds) {
      if (enableShadows) {
        sunLight.position.set(playerX + 42, 64, playerZ - 34);
        sunLight.target.position.set(playerX, 0, playerZ);
      }

      // Pulse Hilltop radio mast beacon
      towerBeaconMat.emissiveIntensity = 1.1 + Math.sin(timeSec * 3.5) * 0.9;

      // Spin scavenge beacons & hide while on cooldown
      scavengeNodes.forEach((node, idx) => {
        const marker = scavengeMarkers[idx];
        marker.visible = node.cooldownSec <= 0;
        if (marker.visible) {
          marker.rotation.y = timeSec * 1.8 + idx;
          marker.position.y = 1.55 + Math.sin(timeSec * 3 + idx) * 0.12;
        }
      });

      // Spin uncollected cash stashes
      cashStashes.forEach((stash, idx) => {
        const mesh = stashMeshes[idx];
        const collected = collectedStashIds.includes(stash.id);
        mesh.visible = !collected;
        if (!collected && mesh.children[1]) {
          mesh.children[1].rotation.y = timeSec * 2.2 + idx;
          mesh.children[1].position.y = 1.35 + Math.sin(timeSec * 3.4 + idx) * 0.14;
        }
      });

      if (activeWp) {
        missionBeacon.visible = true;
        missionBeacon.position.set(activeWp.x, groundHeightAt(activeWp.x, activeWp.z), activeWp.z);
        missionBeacon.rotation.y = timeSec * 1.2;
      } else {
        missionBeacon.visible = false;
      }
    },
    dispose() {
      for (const g of disposableGeos) g.dispose();
      for (const m of disposableMats) m.dispose();
      scene.remove(root);
    },
  };
}

function buildBuilding(
  root: THREE.Group,
  colliders: BoxCollider[],
  enableShadows: boolean,
  opts: {
    x: number;
    z: number;
    w: number;
    h: number;
    d: number;
    wallColor: number;
    roofColor: number;
    signColor: number;
    awningColor: number;
  }
): void {
  const y = groundHeightAt(opts.x, opts.z);
  const group = new THREE.Group();
  group.position.set(opts.x, y, opts.z);

  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(opts.w, opts.h, opts.d),
    new THREE.MeshStandardMaterial({ color: opts.wallColor, roughness: 0.85 })
  );
  wall.position.y = opts.h / 2;
  wall.castShadow = enableShadows;
  wall.receiveShadow = enableShadows;

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(opts.w + 0.6, 0.45, opts.d + 0.6),
    new THREE.MeshStandardMaterial({ color: opts.roofColor, roughness: 0.65 })
  );
  roof.position.y = opts.h + 0.22;
  roof.castShadow = enableShadows;

  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(opts.w * 0.72, 0.28, 1.4),
    new THREE.MeshStandardMaterial({ color: opts.awningColor, roughness: 0.7 })
  );
  awning.position.set(0, 2.7, opts.d / 2 + 0.65);
  awning.rotation.x = 0.24;

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(opts.w * 0.56, 0.8, 0.25),
    new THREE.MeshStandardMaterial({
      color: opts.signColor,
      emissive: opts.signColor,
      emissiveIntensity: 0.35,
      roughness: 0.4,
    })
  );
  sign.position.set(0, opts.h - 0.7, opts.d / 2 + 0.14);

  group.add(wall, roof, awning, sign);
  root.add(group);

  colliders.push({
    minX: opts.x - opts.w / 2,
    maxX: opts.x + opts.w / 2,
    minZ: opts.z - opts.d / 2,
    maxZ: opts.z + opts.d / 2,
  });
}
