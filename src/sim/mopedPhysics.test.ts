import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMopedStats,
  createInitialPhysicsState,
  stepMopedPhysics,
  type SurfaceSample,
} from './mopedPhysics';
import { createInitialSaveState, getActiveMoped } from '../game/economy';

const FLAT_ROAD: SurfaceSample = {
  groundY: 0,
  onRoad: true,
  bumpiness: 0.05,
  slopeX: 0,
  slopeZ: 0,
};

test('starter moped begins mint with 100% condition and zero issues', () => {
  const save = createInitialSaveState();
  const starter = getActiveMoped(save);
  assert.equal(starter.modelId, 'veloce_50');
  assert.equal(starter.condition, 100);
  assert.equal(starter.activeIssues.length, 0);
});

test('upgrading cylinder and exhaust increases power and top speed', () => {
  const save = createInitialSaveState();
  const moped = getActiveMoped(save);
  const stockStats = computeMopedStats(moped);

  moped.installedParts.cylinder = 'cyl_race_70';
  moped.installedParts.exhaust = 'exh_expansion';
  const tunedStats = computeMopedStats(moped);

  assert.ok(tunedStats.topSpeedKmh > stockStats.topSpeedKmh + 25);
  assert.ok(tunedStats.peakPowerKw > stockStats.peakPowerKw * 1.8);
  assert.equal(tunedStats.displacementCc, 70);
  assert.equal(tunedStats.exhaustStyle, 'expansion');
});

test('moped accelerates forward under throttle, engages CVT clutch, and leans into turns', () => {
  const save = createInitialSaveState();
  const moped = getActiveMoped(save);
  const state = createInitialPhysicsState(0, 0, 0, 0);

  for (let i = 0; i < 120; i++) {
    stepMopedPhysics(
      state,
      moped,
      { throttle: 1, brake: 0, steer: 0.6, reverse: false },
      FLAT_ROAD,
      1 / 60,
      () => 0.5
    );
  }

  assert.equal(state.clutchEngaged, true);
  assert.ok(state.speedMs > 5, `expected speed > 5 m/s, got ${state.speedMs}`);
  assert.ok(Math.abs(state.leanAngle) > 0.05, 'expected moped to lean into turn');
  assert.ok(state.heading > 0.2, 'expected moped heading to turn left');
  // Within first 0.55km grace period, starter moped stays trouble-free
  assert.equal(moped.activeIssues.length, 0);
});

test('technical issues degrade acceleration/top speed and high mileage triggers wear', () => {
  const save = createInitialSaveState();
  const moped = getActiveMoped(save);
  moped.odometerKm = 1.0; // past grace period
  moped.wearAccumulator = 11.99;

  const state = createInitialPhysicsState(0, 0, 0, 0);
  state.speedMs = 10;

  let triggered = null;
  for (let i = 0; i < 60; i++) {
    const res = stepMopedPhysics(
      state,
      moped,
      { throttle: 1, brake: 0, steer: 0, reverse: false },
      FLAT_ROAD,
      1 / 60,
      () => 0.2
    );
    if (res.triggeredIssue) triggered = res.triggeredIssue;
  }

  assert.ok(triggered !== null, 'expected an issue to trigger past wear threshold');
  assert.ok(moped.activeIssues.length >= 1);
  assert.ok(moped.condition < 100);
});

test('riding fast off a jump ramp launches moped airborne and reports landedAirTimeSec on touchdown', () => {
  const save = createInitialSaveState();
  const moped = getActiveMoped(save);
  const state = createInitialPhysicsState(0, 1.0, -67.5, 0);
  state.speedMs = 15;
  state.verticalVel = 2.6;

  // Step onto lower flat road after ramp lip
  let airborneObserved = false;
  let landedAirTime = 0;
  for (let i = 0; i < 60; i++) {
    const res = stepMopedPhysics(
      state,
      moped,
      { throttle: 1, brake: 0, steer: 0, reverse: false },
      FLAT_ROAD,
      1 / 60,
      () => 0.5
    );
    if (state.airborne) airborneObserved = true;
    if (res.landedAirTimeSec > 0) landedAirTime = res.landedAirTimeSec;
  }

  assert.equal(airborneObserved, true, 'expected moped to go airborne off ramp lip');
  assert.ok(landedAirTime > 0.25, `expected landedAirTimeSec > 0.25, got ${landedAirTime}`);
  assert.equal(state.airborne, false);
});
