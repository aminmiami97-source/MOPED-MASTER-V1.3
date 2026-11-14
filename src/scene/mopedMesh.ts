import * as THREE from 'three';
import { MOPED_MODELS_BY_ID } from '../constants';
import { computeMopedStats } from '../sim/mopedPhysics';
import type { ExhaustStyle, MopedPhysicsState, OwnedMoped } from '../types';
import type { ProceduralTextureSet } from './textures';

interface SmokePuff {
  active: boolean;
  age: number;
  maxAge: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
}

const SMOKE_COUNT = 48;
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _exhaustWorld = new THREE.Vector3();

export class MopedRig {
  public readonly root = new THREE.Group();
  public readonly bodyTilt = new THREE.Group();
  public readonly suspensionGroup = new THREE.Group();
  public readonly steeringPivot = new THREE.Group();
  public readonly frontWheel = new THREE.Group();
  public readonly rearWheel = new THREE.Group();
  public readonly speedoNeedle = new THREE.Mesh();
  public readonly exhaustTip = new THREE.Object3D();
  public readonly riderEyeAnchor = new THREE.Object3D();

  private readonly paintMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly exhaustGroup = new THREE.Group();
  private readonly engineGroup = new THREE.Group();
  private readonly frameGroup = new THREE.Group();
  private readonly smokeMesh: THREE.InstancedMesh;
  private readonly puffs: SmokePuff[] = [];
  private puffCursor = 0;
  private smokeTimer = 0;

  private currentModelId = '';
  private currentExhaustStyle: ExhaustStyle = 'stock';
  private currentWheelRadius = 0.27;
  private currentWheelbase = 1.14;

  // Shared materials
  private readonly chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe6eaf0,
    metalness: 0.92,
    roughness: 0.14,
  });
  private readonly alloyMat = new THREE.MeshStandardMaterial({
    color: 0xb7bfc9,
    metalness: 0.78,
    roughness: 0.36,
  });
  private readonly darkSteelMat = new THREE.MeshStandardMaterial({
    color: 0x262930,
    metalness: 0.55,
    roughness: 0.52,
  });
  private readonly seatMat = new THREE.MeshStandardMaterial({
    color: 0x1b1918,
    metalness: 0.05,
    roughness: 0.82,
  });
  private readonly rubberMat: THREE.MeshStandardMaterial;
  private readonly headlightGlassMat = new THREE.MeshStandardMaterial({
    color: 0xfff8dc,
    emissive: 0xffe29a,
    emissiveIntensity: 1.4,
    roughness: 0.15,
    metalness: 0.1,
  });
  private readonly tailLightMat = new THREE.MeshStandardMaterial({
    color: 0xaa1818,
    emissive: 0xff2820,
    emissiveIntensity: 0.9,
    roughness: 0.22,
  });
  private readonly titaniumMat = new THREE.MeshStandardMaterial({
    color: 0xd6b57e,
    metalness: 0.88,
    roughness: 0.2,
  });

  private readonly disposableGeos: THREE.BufferGeometry[] = [];
  private readonly disposableMats: THREE.Material[] = [];

  constructor(private readonly textures: ProceduralTextureSet) {
    this.rubberMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.tireTread,
      roughness: 0.9,
      metalness: 0.04,
    });

    this.root.name = 'MopedRig';
    this.root.add(this.bodyTilt);
    this.bodyTilt.add(this.suspensionGroup);

    // Soft radial contact shadow flush on ground
    const shadowGeo = new THREE.PlaneGeometry(1.15, 2.05);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.position.y = 0.015;
    this.root.add(shadowPlane);
    this.disposableGeos.push(shadowGeo);
    this.disposableMats.push(shadowMat);

    this.suspensionGroup.add(this.frameGroup, this.engineGroup, this.exhaustGroup, this.steeringPivot, this.rearWheel);

    // Exhaust smoke instanced pool (added to root's parent later or world scene)
    const puffGeo = new THREE.IcosahedronGeometry(0.065, 1);
    const puffMat = new THREE.MeshStandardMaterial({
      color: 0xd8e0ea,
      transparent: true,
      opacity: 0.32,
      roughness: 0.95,
      depthWrite: false,
    });
    this.smokeMesh = new THREE.InstancedMesh(puffGeo, puffMat, SMOKE_COUNT);
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < SMOKE_COUNT; i++) {
      this.puffs.push({
        active: false,
        age: 0,
        maxAge: 0.9,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        scale: 0,
      });
      _pos.set(0, -50, 0);
      _scl.setScalar(0.001);
      _mat4.compose(_pos, _quat, _scl);
      this.smokeMesh.setMatrixAt(i, _mat4);
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.disposableGeos.push(puffGeo);
    this.disposableMats.push(puffMat);
  }

  public getSmokeObject(): THREE.InstancedMesh {
    return this.smokeMesh;
  }

  public syncAppearance(moped: OwnedMoped): void {
    const stats = computeMopedStats(moped);
    if (this.currentModelId !== moped.modelId) {
      this.rebuildChassis(moped);
      this.currentModelId = moped.modelId;
    }
    if (this.currentExhaustStyle !== stats.exhaustStyle) {
      this.rebuildExhaust(stats.exhaustStyle);
      this.currentExhaustStyle = stats.exhaustStyle;
    }
    for (const mat of this.paintMaterials) {
      mat.color.set(moped.paintColor);
    }
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
    }
  }

  private rebuildChassis(moped: OwnedMoped): void {
    const model = MOPED_MODELS_BY_ID[moped.modelId];
    this.currentWheelRadius = model.wheelRadiusM;
    this.currentWheelbase = model.wheelbaseM;

    this.clearGroup(this.frameGroup);
    this.clearGroup(this.engineGroup);
    this.clearGroup(this.steeringPivot);
    this.clearGroup(this.rearWheel);
    this.paintMaterials.length = 0;

    const paintMat = new THREE.MeshStandardMaterial({
      color: moped.paintColor,
      metalness: 0.35,
      roughness: 0.24,
    });
    this.paintMaterials.push(paintMat);
    this.disposableMats.push(paintMat);

    const wr = model.wheelRadiusM;
    const wb = model.wheelbaseM;
    const rearZ = wb * 0.48;
    const frontZ = -wb * 0.52;

    // 1. Rear Wheel + Front Wheel (spoked hub + tire)
    this.buildWheel(this.rearWheel, wr);
    this.rearWheel.position.set(0, wr, rearZ);

    this.steeringPivot.position.set(0, wr, frontZ);
    this.buildWheel(this.frontWheel, wr);
    this.steeringPivot.add(this.frontWheel);

    // 2. Front Telescopic Forks, Fender, Headlight, Handlebars & Speedo Pod
    const forkGroup = new THREE.Group();
    forkGroup.rotation.x = 0.24; // rake angle
    this.steeringPivot.add(forkGroup);

    const forkLegGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.62, 12);
    const leftLeg = new THREE.Mesh(forkLegGeo, this.chromeMat);
    leftLeg.position.set(-0.085, 0.31, 0);
    leftLeg.castShadow = true;
    const rightLeg = new THREE.Mesh(forkLegGeo, this.chromeMat);
    rightLeg.position.set(0.085, 0.31, 0);
    rightLeg.castShadow = true;
    forkGroup.add(leftLeg, rightLeg);

    // Triple clamp + front fender
    const crownGeo = new THREE.BoxGeometry(0.22, 0.035, 0.07);
    const crown = new THREE.Mesh(crownGeo, this.alloyMat);
    crown.position.set(0, 0.56, 0);
    forkGroup.add(crown);

    const fenderGeo = new THREE.CylinderGeometry(wr + 0.045, wr + 0.045, 0.11, 18, 1, true, Math.PI / 2 - 0.85, 1.7);
    fenderGeo.rotateZ(Math.PI / 2);
    const frontFender = new THREE.Mesh(fenderGeo, paintMat);
    frontFender.position.set(0, 0.01, 0);
    this.steeringPivot.add(frontFender);

    // Steering stem & Handlebars
    const stemGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.22, 10);
    const stem = new THREE.Mesh(stemGeo, this.chromeMat);
    stem.position.set(0, 0.66, 0);
    forkGroup.add(stem);

    const barCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.31, 0.78, 0.07),
      new THREE.Vector3(-0.18, 0.77, 0.01),
      new THREE.Vector3(0, 0.74, 0),
      new THREE.Vector3(0.18, 0.77, 0.01),
      new THREE.Vector3(0.31, 0.78, 0.07),
    ]);
    const barGeo = new THREE.TubeGeometry(barCurve, 18, 0.014, 10, false);
    const handlebars = new THREE.Mesh(barGeo, this.chromeMat);
    handlebars.castShadow = true;
    forkGroup.add(handlebars);

    // Rubber grips
    const gripGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.11, 10);
    gripGeo.rotateZ(Math.PI / 2);
    const leftGrip = new THREE.Mesh(gripGeo, this.rubberMat);
    leftGrip.position.set(-0.26, 0.78, 0.05);
    leftGrip.rotation.y = 0.3;
    const rightGrip = new THREE.Mesh(gripGeo, this.rubberMat);
    rightGrip.position.set(0.26, 0.78, 0.05);
    rightGrip.rotation.y = -0.3;
    forkGroup.add(leftGrip, rightGrip);

    // Vintage round chrome headlight bucket + lens
    const lampBucket = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), this.chromeMat);
    lampBucket.scale.set(1, 1, 1.15);
    lampBucket.position.set(0, 0.57, -0.09);
    lampBucket.castShadow = true;
    const lampLens = new THREE.Mesh(new THREE.CircleGeometry(0.064, 16), this.headlightGlassMat);
    lampLens.rotation.y = Math.PI;
    lampLens.position.set(0, 0.57, -0.172);
    forkGroup.add(lampBucket, lampLens);

    // Analog Speedometer Pod + Animated Needle (readable in 1st-person VR saddle view!)
    const podHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.04, 18), this.chromeMat);
    podHousing.position.set(0, 0.78, -0.045);
    podHousing.rotation.x = 0.55;
    const podFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.039, 18),
      new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.4 })
    );
    podFace.position.set(0, 0.021, 0);
    podFace.rotation.x = -Math.PI / 2;
    podHousing.add(podFace);

    this.speedoNeedle.geometry = new THREE.BoxGeometry(0.004, 0.004, 0.032);
    this.speedoNeedle.material = new THREE.MeshBasicMaterial({ color: 0xd93025 });
    this.speedoNeedle.position.set(0, 0.023, -0.01);
    podHousing.add(this.speedoNeedle);
    forkGroup.add(podHousing);

    // Twin round chrome mirrors
    for (const side of [-1, 1]) {
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 8), this.chromeMat);
      stalk.position.set(side * 0.21, 0.84, 0.02);
      stalk.rotation.z = side * -0.25;
      const mirrorHead = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.012, 14), this.chromeMat);
      mirrorHead.rotation.x = Math.PI / 2;
      mirrorHead.position.set(side * 0.24, 0.91, 0.02);
      forkGroup.add(stalk, mirrorHead);
    }

    // 3. Main Frame Backbone & Model-Specific Bodywork
    const headTube = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.26, 12), paintMat);
    headTube.position.set(0, wr + 0.45, frontZ + 0.09);
    headTube.rotation.x = 0.24;
    headTube.castShadow = true;
    this.frameGroup.add(headTube);

    if (model.frameStyle === 'step_through') {
      const spineCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, wr + 0.4, frontZ + 0.12),
        new THREE.Vector3(0, wr + 0.14, -0.1),
        new THREE.Vector3(0, wr + 0.16, 0.15),
        new THREE.Vector3(0, wr + 0.46, rearZ - 0.15),
      ]);
      const spine = new THREE.Mesh(new THREE.TubeGeometry(spineCurve, 20, 0.042, 10, false), paintMat);
      spine.castShadow = true;
      this.frameGroup.add(spine);

      // Under-rack fuel tank
      const tank = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.34), paintMat);
      tank.position.set(0, wr + 0.43, rearZ - 0.18);
      tank.castShadow = true;
      this.frameGroup.add(tank);
    } else if (model.frameStyle === 'touring_body') {
      // Sculpted steel legshield + bulbous side cowls
      const shield = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.5, 0.09), paintMat);
      shield.position.set(0, wr + 0.32, frontZ + 0.16);
      shield.rotation.x = -0.18;
      shield.castShadow = true;
      const floorboard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.46), this.darkSteelMat);
      floorboard.position.set(0, wr + 0.05, 0.02);
      const rearCowl = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.34, 6, 12), paintMat);
      rearCowl.rotation.x = Math.PI / 2;
      rearCowl.scale.set(1.1, 1, 0.85);
      rearCowl.position.set(0, wr + 0.36, rearZ - 0.14);
      rearCowl.castShadow = true;
      this.frameGroup.add(shield, floorboard, rearCowl);
    } else {
      // cafe_tube or scrambler top-tube + sculpted teardrop tank
      const topTube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, wb * 0.56, 10), this.darkSteelMat);
      topTube.rotation.x = Math.PI / 2 + 0.06;
      topTube.position.set(0, wr + 0.47, -0.04);
      const downTube = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.46, 10), this.darkSteelMat);
      downTube.rotation.x = -0.58;
      downTube.position.set(0, wr + 0.27, frontZ + 0.22);
      const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.28, 8, 12), paintMat);
      tank.rotation.x = Math.PI / 2;
      tank.scale.set(1.15, 1, 0.88);
      tank.position.set(0, wr + 0.53, frontZ + 0.34);
      tank.castShadow = true;
      this.frameGroup.add(topTube, downTube, tank);
    }

    // Swingarm & Twin Rear Coilover Shocks
    const swingarm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.04, wb * 0.48), this.darkSteelMat);
    swingarm.position.set(0, wr + 0.02, rearZ * 0.55);
    this.frameGroup.add(swingarm);

    for (const side of [-1, 1]) {
      const shock = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.32, 10), this.chromeMat);
      shock.position.set(side * 0.095, wr + 0.22, rearZ - 0.06);
      shock.rotation.x = 0.34;
      this.frameGroup.add(shock);
    }

    // Rear Fender + Luggage Rack + Tail Light
    const rearFender = new THREE.Mesh(
      new THREE.CylinderGeometry(wr + 0.05, wr + 0.05, 0.13, 18, 1, true, Math.PI / 2 - 0.9, 1.8),
      paintMat
    );
    rearFender.rotation.z = Math.PI / 2;
    rearFender.position.set(0, wr + 0.01, rearZ);
    this.frameGroup.add(rearFender);

    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.26), this.chromeMat);
    rack.position.set(0, wr + 0.5, rearZ + 0.08);
    const tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.045), this.tailLightMat);
    tailLight.position.set(0, wr + 0.41, rearZ + 0.22);
    this.frameGroup.add(rack, tailLight);

    // Padded Vintage Saddle
    const saddle = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.26, 6, 12), this.seatMat);
    saddle.rotation.x = Math.PI / 2;
    saddle.scale.set(1.22, 1, 0.58);
    saddle.position.set(0, wr + 0.54, rearZ - 0.24);
    saddle.castShadow = true;
    this.frameGroup.add(saddle);

    // Rider Eye Anchor (for 1st-person VR / Saddle view)
    this.riderEyeAnchor.position.set(0, wr + 1.18, rearZ - 0.22);
    this.frameGroup.add(this.riderEyeAnchor);

    // 4. Visible 2-Stroke Engine Block + Finned Cylinder + Carburetor + CVT Cover
    const crankcase = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.14, 0.24), this.alloyMat);
    crankcase.position.set(0, wr + 0.08, 0.06);
    crankcase.castShadow = true;
    this.engineGroup.add(crankcase);

    // Cooling fins (5 stacked discs)
    for (let f = 0; f < 5; f++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.012, 0.13), this.alloyMat);
      fin.position.set(0, wr + 0.18 + f * 0.022, -0.02 - f * 0.008);
      fin.rotation.x = -0.35;
      this.engineGroup.add(fin);
    }

    // Carburetor + cone air filter
    const carb = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.07, 10), this.alloyMat);
    carb.position.set(0.05, wr + 0.22, 0.09);
    const airFilter = new THREE.Mesh(
      new THREE.ConeGeometry(0.036, 0.07, 10),
      new THREE.MeshStandardMaterial({ color: 0xc83228, roughness: 0.5 })
    );
    airFilter.rotation.x = Math.PI / 2;
    airFilter.position.set(0.05, wr + 0.22, 0.15);
    this.engineGroup.add(carb, airFilter);

    // Left-side CVT Belt Cover
    const cvtCover = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.26, 6, 10), this.darkSteelMat);
    cvtCover.rotation.x = Math.PI / 2;
    cvtCover.scale.set(0.45, 1, 1);
    cvtCover.position.set(-0.1, wr + 0.06, 0.22);
    this.engineGroup.add(cvtCover);

    // 5. Exhaust pipe
    this.rebuildExhaust(this.currentExhaustStyle);
  }

  private buildWheel(target: THREE.Group, radius: number): void {
    const tireGeo = new THREE.TorusGeometry(radius - 0.04, 0.04, 12, 26);
    tireGeo.rotateY(Math.PI / 2);
    const tire = new THREE.Mesh(tireGeo, this.rubberMat);
    tire.castShadow = true;

    const rimGeo = new THREE.TorusGeometry(radius - 0.068, 0.014, 8, 24);
    rimGeo.rotateY(Math.PI / 2);
    const rim = new THREE.Mesh(rimGeo, this.chromeMat);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.048, 0.048, 0.07, 12).rotateZ(Math.PI / 2),
      this.alloyMat
    );
    target.add(tire, rim, hub);

    // 8 crisp spokes
    const spokeGeo = new THREE.CylinderGeometry(0.004, 0.004, (radius - 0.068) * 2, 6);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(spokeGeo, this.chromeMat);
      spoke.rotation.x = (i * Math.PI) / 4;
      target.add(spoke);
    }
  }

  private rebuildExhaust(style: ExhaustStyle): void {
    this.clearGroup(this.exhaustGroup);
    const wr = this.currentWheelRadius;
    const rearZ = this.currentWheelbase * 0.48;

    const mat =
      style === 'titanium'
        ? this.titaniumMat
        : style === 'expansion'
          ? this.alloyMat
          : this.chromeMat;

    const points =
      style === 'expansion' || style === 'titanium'
        ? [
            new THREE.Vector3(0.02, wr + 0.14, -0.05),
            new THREE.Vector3(0.11, wr + 0.02, 0.02),
            new THREE.Vector3(0.13, wr - 0.02, 0.28),
            new THREE.Vector3(0.12, wr + 0.12, rearZ + 0.06),
            new THREE.Vector3(0.11, wr + 0.24, rearZ + 0.22),
          ]
        : [
            new THREE.Vector3(0.02, wr + 0.14, -0.05),
            new THREE.Vector3(0.1, wr - 0.02, 0.04),
            new THREE.Vector3(0.11, wr - 0.03, rearZ - 0.08),
            new THREE.Vector3(0.11, wr + 0.01, rearZ + 0.18),
          ];

    const pipeRadius = style === 'stock' ? 0.017 : style === 'touring' ? 0.023 : 0.026;
    const curve = new THREE.CatmullRomCurve3(points);
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, pipeRadius, 10, false), mat);
    pipe.castShadow = true;
    this.exhaustGroup.add(pipe);

    // Expansion chamber belly cone + silencer can
    if (style === 'expansion' || style === 'titanium') {
      const chamber = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.048, 0.18, 6, 12).rotateX(Math.PI / 2),
        mat
      );
      chamber.position.set(0.13, wr + 0.0, 0.25);
      const silencer = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.22, 12).rotateX(Math.PI / 2 - 0.42),
        style === 'titanium' ? this.darkSteelMat : this.alloyMat
      );
      silencer.position.set(0.115, wr + 0.19, rearZ + 0.14);
      this.exhaustGroup.add(chamber, silencer);
    } else {
      const muffler = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.028, 0.34, 12).rotateX(Math.PI / 2),
        mat
      );
      muffler.position.set(0.11, wr - 0.01, rearZ + 0.03);
      this.exhaustGroup.add(muffler);
    }

    const tipPos = points[points.length - 1];
    this.exhaustTip.position.copy(tipPos);
    this.exhaustGroup.add(this.exhaustTip);
  }

  public updateVisuals(state: MopedPhysicsState, dt: number): void {
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.y = state.heading;

    this.bodyTilt.rotation.z = state.leanAngle;
    this.bodyTilt.rotation.x = state.pitchAngle;
    this.suspensionGroup.position.y = -state.suspCompression;

    this.steeringPivot.rotation.y = state.steerAngle;
    this.frontWheel.rotation.x = -state.wheelRotation;
    this.rearWheel.rotation.x = -state.wheelRotation;

    // Speedometer needle sweeps from -1.8 rad (0 km/h) to +1.8 rad (95 km/h)
    const speedKmh = Math.abs(state.speedMs) * 3.6;
    const needleAngle = -1.8 + Math.min(1, speedKmh / 95) * 3.6;
    this.speedoNeedle.rotation.y = -needleAngle;

    // Update 2-stroke exhaust smoke puffs in world space
    this.smokeTimer += dt * (1 + state.throttle * 2.5);
    if (this.smokeTimer >= 0.09) {
      this.smokeTimer = 0;
      this.exhaustTip.getWorldPosition(_exhaustWorld);
      const puff = this.puffs[this.puffCursor];
      this.puffCursor = (this.puffCursor + 1) % SMOKE_COUNT;
      puff.active = true;
      puff.age = 0;
      puff.maxAge = 0.65 + Math.random() * 0.35;
      puff.x = _exhaustWorld.x;
      puff.y = _exhaustWorld.y;
      puff.z = _exhaustWorld.z;
      const backX = Math.sin(state.heading);
      const backZ = Math.cos(state.heading);
      puff.vx = backX * (0.9 + state.throttle * 1.4) + (Math.random() - 0.5) * 0.25;
      puff.vy = 0.45 + Math.random() * 0.25;
      puff.vz = backZ * (0.9 + state.throttle * 1.4) + (Math.random() - 0.5) * 0.25;
      puff.scale = 0.45 + state.throttle * 0.45;
    }

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const puff = this.puffs[i];
      if (!puff.active) continue;
      puff.age += dt;
      if (puff.age >= puff.maxAge) {
        puff.active = false;
        _pos.set(0, -50, 0);
        _scl.setScalar(0.001);
      } else {
        const t = puff.age / puff.maxAge;
        puff.x += puff.vx * dt;
        puff.y += puff.vy * dt;
        puff.z += puff.vz * dt;
        const s = puff.scale * (0.6 + t * 2.2) * (1 - t * 0.65);
        _pos.set(puff.x, puff.y, puff.z);
        _scl.setScalar(Math.max(0.001, s));
      }
      _mat4.compose(_pos, _quat, _scl);
      this.smokeMesh.setMatrixAt(i, _mat4);
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    for (const g of this.disposableGeos) g.dispose();
    for (const m of this.disposableMats) m.dispose();
    this.chromeMat.dispose();
    this.alloyMat.dispose();
    this.darkSteelMat.dispose();
    this.seatMat.dispose();
    this.rubberMat.dispose();
    this.headlightGlassMat.dispose();
    this.tailLightMat.dispose();
    this.titaniumMat.dispose();
  }
}
