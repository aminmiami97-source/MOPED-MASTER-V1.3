import {
  ISSUE_LIST,
  MOPED_MODELS_BY_ID,
  PARTS_BY_ID,
  TECHNICAL_ISSUES,
} from '../constants';
import type {
  MopedComputedStats,
  MopedPhysicsState,
  OwnedMoped,
  PartCategory,
  TechnicalIssueId,
} from '../types';

export interface MopedControlsInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (right) .. +1 (left)
  reverse: boolean; // walk-assist reverse when nearly stopped
}

export interface SurfaceSample {
  groundY: number;
  onRoad: boolean;
  bumpiness: number;
  slopeX: number; // dY/dX
  slopeZ: number; // dY/dZ
}

export interface StepPhysicsResult {
  distanceMeters: number;
  triggeredIssue: TechnicalIssueId | null;
  topSpeedKmh: number;
  landedAirTimeSec: number;
}

const PART_CATEGORIES: PartCategory[] = [
  'cylinder',
  'carburetor',
  'exhaust',
  'variator',
  'tires',
  'ignition',
];

export function computeMopedStats(moped: OwnedMoped): MopedComputedStats {
  const model = MOPED_MODELS_BY_ID[moped.modelId];
  let powerMult = 1.0;
  let torqueMult = 1.0;
  let topSpeedBonus = 0;
  let redlineBonus = 0;
  let gripFactor = 1.0;
  let reliabilityDelta = 0;
  let massKg = model.baseMassKg;
  let displacementCc = 49;
  let exhaustStyle: MopedComputedStats['exhaustStyle'] = 'stock';

  for (const cat of PART_CATEGORIES) {
    const partId = moped.installedParts[cat] ?? model.starterParts[cat];
    const part = PARTS_BY_ID[partId];
    if (!part) continue;
    powerMult += part.powerGain;
    torqueMult += part.torqueGain;
    topSpeedBonus += part.topSpeedBonusKmh;
    redlineBonus += part.redlineBonusRpm;
    gripFactor += part.gripBonus;
    reliabilityDelta += part.reliabilityBonus;
    massKg += part.massDeltaKg;
    if (part.displacementCc) {
      displacementCc = part.displacementCc;
    }
    if (part.exhaustStyle) {
      exhaustStyle = part.exhaustStyle;
    }
  }

  return {
    displacementCc,
    peakPowerKw: Math.max(0.8, model.basePowerKw * powerMult),
    peakTorqueNm: Math.max(1.5, model.baseTorqueNm * torqueMult),
    topSpeedKmh: Math.max(30, model.baseTopSpeedKmh + topSpeedBonus),
    redlineRpm: Math.max(5500, model.baseRedlineRpm + redlineBonus),
    gripFactor: Math.max(0.6, gripFactor),
    wearRateMult: Math.max(0.4, 1 - reliabilityDelta),
    totalMassKg: Math.max(35, massKg),
    exhaustStyle,
  };
}

export function createInitialPhysicsState(
  x = 0,
  y = 0,
  z = 0,
  heading = 0
): MopedPhysicsState {
  return {
    x,
    y,
    z,
    heading,
    speedMs: 0,
    verticalVel: 0,
    airborne: false,
    airTimeSec: 0,
    rpm: 1500,
    throttle: 0,
    brake: 0,
    steerAngle: 0,
    leanAngle: 0,
    pitchAngle: 0,
    suspCompression: 0,
    wheelRotation: 0,
    clutchEngaged: false,
    misfiring: false,
    onRoad: true,
    surfaceBump: 0,
  };
}

/**
 * Evaluates a realistic two-stroke torque factor (0..1.15) at a normalized RPM [0..1].
 * Two-strokes have soft low-end, a sharp expansion-pipe powerband around 0.62..0.90,
 * and taper off past peak near redline.
 */
export function twoStrokeTorqueCurve(normRpm: number): number {
  const r = Math.max(0, Math.min(1.1, normRpm));
  if (r < 0.25) return 0.32 + r * 0.6;
  if (r < 0.58) return 0.47 + ((r - 0.25) / 0.33) * 0.45;
  if (r <= 0.88) return 0.92 + Math.sin(((r - 0.58) / 0.3) * Math.PI) * 0.22;
  return Math.max(0.35, 0.92 - ((r - 0.88) / 0.22) * 0.57);
}

export function stepMopedPhysics(
  state: MopedPhysicsState,
  moped: OwnedMoped,
  input: MopedControlsInput,
  surface: SurfaceSample,
  dt: number,
  randomFn: () => number = Math.random
): StepPhysicsResult {
  const clampedDt = Math.min(Math.max(dt, 0.0001), 0.05);
  const stats = computeMopedStats(moped);
  const model = MOPED_MODELS_BY_ID[moped.modelId];

  // Aggregate penalties from active technical issues
  let powerPenalty = 0;
  let extraDrag = 0;
  let misfireChance = 0;
  let steerPull = 0;
  for (const issueId of moped.activeIssues) {
    const issue = TECHNICAL_ISSUES[issueId];
    if (!issue) continue;
    powerPenalty += issue.powerPenalty;
    extraDrag += issue.dragPenalty;
    misfireChance = Math.max(misfireChance, issue.misfireChance);
    steerPull += issue.steerPull;
  }

  // Condition gently scales power below 65%
  const condFactor =
    moped.condition >= 65 ? 1 : 0.72 + (Math.max(0, moped.condition) / 65) * 0.28;
  const effectivePowerMult = Math.max(0.28, (1 - Math.min(0.68, powerPenalty)) * condFactor);

  // Smooth throttle and brake inputs
  const throttleAlpha = 1 - Math.exp(-10 * clampedDt);
  const brakeAlpha = 1 - Math.exp(-14 * clampedDt);
  state.throttle += (Math.max(0, Math.min(1, input.throttle)) - state.throttle) * throttleAlpha;
  state.brake += (Math.max(0, Math.min(1, input.brake)) - state.brake) * brakeAlpha;

  // Misfire check when under load with fouled plug / clogged carb
  const misfireEvent =
    misfireChance > 0 && state.throttle > 0.25 && randomFn() < misfireChance * clampedDt * 3.5;
  state.misfiring = misfireEvent;

  const topSpeedMs = stats.topSpeedKmh / 3.6;
  const idleRpm = 1450;
  const clutchEngageRpm = 2550;

  // Target engine RPM from road speed (CVT keeps engine in powerband above clutch lockup)
  const absSpeed = Math.abs(state.speedMs);
  const speedRatio = Math.min(1.05, absSpeed / Math.max(8, topSpeedMs));
  const cvtTargetRpm =
    idleRpm +
    state.throttle * (stats.redlineRpm * 0.88 - idleRpm) * 0.68 +
    speedRatio * (stats.redlineRpm * 0.96 - idleRpm) * 0.55;
  const freeRevRpm = idleRpm + state.throttle * (stats.redlineRpm * 0.92 - idleRpm);
  const desiredRpm = Math.min(
    stats.redlineRpm,
    absSpeed < 1.2 ? Math.max(freeRevRpm, cvtTargetRpm) : cvtTargetRpm
  );

  const rpmRate = state.throttle > 0.1 ? 8.5 : 4.5;
  state.rpm += (desiredRpm - state.rpm) * (1 - Math.exp(-rpmRate * clampedDt));
  state.clutchEngaged = state.rpm >= clutchEngageRpm && state.throttle > 0.08;

  // Forward direction unit vector (heading=0 faces -Z)
  const dirX = -Math.sin(state.heading);
  const dirZ = -Math.cos(state.heading);

  // Drive force from 2-stroke torque & CVT
  const normRpm = (state.rpm - idleRpm) / Math.max(1000, stats.redlineRpm - idleRpm);
  const torqueFactor = twoStrokeTorqueCurve(normRpm);
  const riderMassKg = 74;
  const totalMass = stats.totalMassKg + riderMassKg;

  // Peak drive acceleration scaled to reach target top speed smoothly
  let driveAccel = 0;
  if (state.clutchEngaged && !misfireEvent) {
    const rawForceN =
      ((stats.peakPowerKw * 1000) / Math.max(2.8, Math.max(absSpeed, 3.0))) *
      state.throttle *
      torqueFactor *
      effectivePowerMult;
    const maxLaunchForceN = stats.peakTorqueNm * 108 * state.throttle * effectivePowerMult;
    const tractiveForceN = Math.min(rawForceN, maxLaunchForceN);
    driveAccel = tractiveForceN / totalMass;
  } else if (misfireEvent) {
    driveAccel = -0.8;
  }

  // Reverse walk-assist when nearly stopped and pressing brake/reverse
  if (input.reverse && state.speedMs <= 0.25 && state.throttle < 0.05) {
    driveAccel = -2.2;
  }

  // Aerodynamic drag calibrated to cap speed at effective topSpeedMs
  const effectiveTopSpeedMs = topSpeedMs * Math.sqrt(effectivePowerMult);
  const maxDriveAtTop = (stats.peakPowerKw * 1000 * effectivePowerMult) / (Math.max(4, effectiveTopSpeedMs) * totalMass);
  const aeroCoeff = maxDriveAtTop / Math.max(25, effectiveTopSpeedMs * effectiveTopSpeedMs);
  const aeroDrag = aeroCoeff * state.speedMs * Math.abs(state.speedMs);

  // Rolling resistance (higher off-road & with flat tire / loose chain)
  const offRoadDrag = surface.onRoad ? 0.16 : 0.65 / Math.max(0.7, stats.gripFactor * 0.75);
  const rollingResist =
    Math.sign(state.speedMs) * (offRoadDrag + extraDrag * 2.2) * (absSpeed > 0.05 ? 1 : 0);

  // Slope gravity component along heading
  const slopeAlongHeading = surface.slopeX * dirX + surface.slopeZ * dirZ;
  const gravityAccel = -9.81 * slopeAlongHeading;

  // Braking deceleration
  let brakeAccel = 0;
  if (state.brake > 0.01 && Math.abs(state.speedMs) > 0.05) {
    const gripLimit = surface.onRoad ? 9.2 * Math.min(1.25, stats.gripFactor) : 5.8 * stats.gripFactor;
    brakeAccel = -Math.sign(state.speedMs) * state.brake * gripLimit;
  }

  // Integrate longitudinal velocity
  const prevSpeed = state.speedMs;
  const netAccel = driveAccel + gravityAccel + brakeAccel - aeroDrag - rollingResist;
  state.speedMs += netAccel * clampedDt;

  // Clamp reverse walk-assist speed & clean stop deadband
  if (state.speedMs < -2.4) state.speedMs = -2.4;
  if (state.brake > 0.1 && Math.abs(prevSpeed) < 0.35 && Math.abs(state.speedMs) < 0.35 && !input.reverse) {
    state.speedMs = 0;
  }
  if (state.throttle < 0.02 && !input.reverse && Math.abs(state.speedMs) < 0.08 && Math.abs(gravityAccel) < 0.5) {
    state.speedMs = 0;
  }

  // Speed-sensitive steering & lean dynamics
  const maxSteerAtLow = 0.56;
  const maxSteerAtHigh = 0.16;
  const speedNorm = Math.min(1, absSpeed / 18);
  const targetSteerLimit = maxSteerAtLow + (maxSteerAtHigh - maxSteerAtLow) * speedNorm;
  const rawSteerTarget = input.steer * targetSteerLimit - steerPull * 0.35;
  state.steerAngle += (rawSteerTarget - state.steerAngle) * (1 - Math.exp(-12 * clampedDt));

  // Bicycle kinematics yaw rate
  let yawRate = 0;
  if (absSpeed > 0.12) {
    const turnRadius = model.wheelbaseM / Math.max(0.0001, Math.abs(Math.tan(state.steerAngle)));
    const rawYaw = (state.speedMs / Math.max(0.9, turnRadius)) * Math.sign(state.steerAngle || 1);
    const gripCap = (surface.onRoad ? 2.4 : 1.75) * stats.gripFactor;
    yawRate = Math.max(-gripCap, Math.min(gripCap, rawYaw));
  }
  state.heading += yawRate * clampedDt;

  // Realistic body lean into turn (leans inward proportional to lateral acceleration v * yawRate)
  const lateralAccel = state.speedMs * yawRate;
  const targetLean = Math.max(-0.54, Math.min(0.54, Math.atan2(lateralAccel, 9.81)));
  state.leanAngle += (targetLean - state.leanAngle) * (1 - Math.exp(-9.5 * clampedDt));

  // Squat on acceleration, fork dive on braking
  const targetPitch = Math.max(-0.11, Math.min(0.11, netAccel * 0.013));
  state.pitchAngle += (targetPitch - state.pitchAngle) * (1 - Math.exp(-10 * clampedDt));

  // Update world position
  const nextDirX = -Math.sin(state.heading);
  const nextDirZ = -Math.cos(state.heading);
  const moveDist = state.speedMs * clampedDt;
  state.x += nextDirX * moveDist;
  state.z += nextDirZ * moveDist;

  // Track vertical elevation & airborne jump ramp physics
  const prevY = state.y;
  const stepSlopeVy = moveDist > 0.001 ? Math.max(0, slopeAlongHeading * state.speedMs) : 0;

  // Suspension bump & airborne vertical integration
  const bumpPhase = (state.x * 1.7 + state.z * 1.7) * (surface.onRoad ? 1.5 : 4.2);
  const bumpImpulse =
    (Math.sin(bumpPhase) * 0.5 + 0.5) * surface.bumpiness * Math.min(1, absSpeed / 8);
  state.surfaceBump = state.airborne ? 0 : bumpImpulse;

  let landedAirTimeSec = 0;
  if (state.airborne || prevY > surface.groundY + 0.04) {
    state.airborne = true;
    state.verticalVel -= 9.81 * clampedDt;
    const nextY = prevY + state.verticalVel * clampedDt;
    state.airTimeSec += clampedDt;
    if (nextY <= surface.groundY) {
      landedAirTimeSec = state.airTimeSec;
      state.y = surface.groundY;
      state.verticalVel = 0;
      state.airborne = false;
      state.airTimeSec = 0;
      state.suspCompression = 0.095; // soak landing impact
    } else {
      state.y = nextY;
    }
  } else {
    // Grounded: check if cresting a steep ramp / hill at speed
    const groundDrop = prevY - surface.groundY;
    if (groundDrop > 0.08 && Math.abs(state.speedMs) > 6.5) {
      state.airborne = true;
      state.verticalVel = Math.max(stepSlopeVy, state.verticalVel);
      state.airTimeSec = clampedDt;
      state.y = prevY + state.verticalVel * clampedDt;
      if (state.y <= surface.groundY) {
        state.y = surface.groundY;
        state.airborne = false;
        state.airTimeSec = 0;
      }
    } else {
      state.y = surface.groundY;
      state.verticalVel = stepSlopeVy;
      state.airborne = false;
      state.airTimeSec = 0;
    }
  }

  const targetComp = state.airborne
    ? -0.02
    : Math.min(0.08, Math.abs(netAccel) * 0.004 + bumpImpulse * 0.04);
  state.suspCompression += (targetComp - state.suspCompression) * (1 - Math.exp(-14 * clampedDt));
  state.onRoad = surface.onRoad && !state.airborne;

  // Wheel rotation
  state.wheelRotation += moveDist / Math.max(0.15, model.wheelRadiusM);

  // Mileage, wear, and technical issue progression
  const distKm = Math.abs(moveDist) / 1000;
  moped.odometerKm += distKm;

  // Grace period on brand new / mint starter moped: first 0.55 km stays issue-free!
  let triggeredIssue: TechnicalIssueId | null = null;
  if (moped.odometerKm > 0.55) {
    const highRpmFactor = state.rpm > stats.redlineRpm * 0.88 ? 1.8 : 1.0;
    const offRoadFactor = surface.onRoad ? 1.0 : 2.1;
    const wearDelta = distKm * 18 * stats.wearRateMult * highRpmFactor * offRoadFactor;
    moped.condition = Math.max(15, moped.condition - wearDelta * 0.35);
    moped.wearAccumulator += wearDelta;

    // Every ~12 wear units (roughly 0.6-1.0 km of hard riding), chance to develop an issue
    if (moped.wearAccumulator >= 12 && moped.activeIssues.length < 3) {
      moped.wearAccumulator = 0;
      const candidates = ISSUE_LIST.filter((id) => !moped.activeIssues.includes(id));
      if (candidates.length > 0) {
        const picked = candidates[Math.floor(randomFn() * candidates.length)];
        moped.activeIssues.push(picked);
        triggeredIssue = picked;
      }
    }
  }

  return {
    distanceMeters: Math.abs(moveDist),
    triggeredIssue,
    topSpeedKmh: stats.topSpeedKmh,
    landedAirTimeSec,
  };
}
