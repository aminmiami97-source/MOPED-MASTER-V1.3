import test from 'node:test';
import assert from 'node:assert/strict';
import {
  awardRidingBonus,
  buyMoped,
  buyPart,
  collectCashStash,
  completeCustomerOrder,
  createInitialSaveState,
  equipPart,
  getActiveMoped,
  repairIssueWithItem,
  scavengeNode,
  startMission,
  triggerSpeedTrap,
  updateActiveMission,
} from './economy';
import { advanceTutorialIfOn, getActiveTutorialStep, skipTutorial } from './tutorial';
import { CASH_STASHES_INIT, SPEED_TRAPS_INIT } from '../constants';
import type { ScavengeNodeState } from '../types';

test('buying and equipping parts updates cash and installed parts', () => {
  const save = createInitialSaveState();
  save.cash = 500;

  const buyRes = buyPart(save, 'exh_expansion');
  assert.equal(buyRes.ok, true);
  assert.equal(save.cash, 210);

  const eqRes = equipPart(save, 'exh_expansion');
  assert.equal(eqRes.ok, true);
  assert.equal(getActiveMoped(save).installedParts.exhaust, 'exh_expansion');
});

test('scavenging yields parts biased toward active issues and repairs them cleanly', () => {
  const save = createInitialSaveState();
  const moped = getActiveMoped(save);
  moped.activeIssues.push('fouled_plug');
  moped.condition = 70;

  const node: ScavengeNodeState = {
    id: 'test_pile',
    label: 'Test Pile',
    x: 10,
    z: 10,
    cooldownSec: 0,
    lootTable: ['scrap_metal'],
  };

  // randomFn returning 0.1 triggers biased repair part drop
  const scav = scavengeNode(save, node, () => 0.1);
  assert.equal(scav.ok, true);
  assert.equal(scav.foundItem, 'spark_plug');
  assert.equal(save.spareInventory.spark_plug, 1);

  const fix = repairIssueWithItem(save, 'fouled_plug');
  assert.equal(fix.ok, true);
  assert.equal(moped.activeIssues.length, 0);
  assert.equal(save.spareInventory.spark_plug, 0);
  assert.equal(moped.condition, 88);
});

test('buying a new moped adds it to garage and switches active ride', () => {
  const save = createInitialSaveState();
  save.cash = 800;
  const res = buyMoped(save, 'simson_rally');
  assert.equal(res.ok, true);
  assert.equal(save.ownedMopeds.length, 2);
  assert.equal(getActiveMoped(save).modelId, 'simson_rally');
});

test('side mission completes through pickup and dropoff waypoints and awards cash', () => {
  const save = createInitialSaveState();
  const initialCash = save.cash;
  const started = startMission(save, 'mission_pizza');
  assert.equal(started.ok, true);

  // Reach pickup at (34, -26)
  const r1 = updateActiveMission(save, 34, -26, 30, 1);
  assert.equal(r1.status, 'active');
  assert.equal(save.activeMission?.waypointIndex, 1);

  // Reach dropoff at (-44, -40)
  const r2 = updateActiveMission(save, -44, -40, 25, 1);
  assert.equal(r2.status, 'completed');
  assert.equal(save.cash, initialCash + 165);
  assert.equal(save.activeMission, null);
});

test('interactive tutorial advances step-by-step paying bonuses, catches up on road exit, and supports skipping', () => {
  const save = createInitialSaveState();
  const startCash = save.cash;
  assert.equal(getActiveTutorialStep(save)?.id, 'open_pc');

  // Camera toggle does not skip ahead from step 1
  const notYet = advanceTutorialIfOn(save, 'steer_cam');
  assert.equal(notYet.advanced, false);

  const step1 = advanceTutorialIfOn(save, 'open_pc');
  assert.equal(step1.advanced, true);
  assert.equal(step1.rewardCash, 25);
  assert.equal(save.cash, startCash + 25);
  assert.equal(getActiveTutorialStep(save)?.id, 'browse_tune');

  // Exiting garage catches up smoothly so riders aren't stuck on step 2 outdoors
  const catchup = advanceTutorialIfOn(save, 'exit_garage');
  assert.equal(catchup.advanced, true);
  assert.equal(getActiveTutorialStep(save)?.id, 'steer_cam');

  skipTutorial(save);
  assert.equal(getActiveTutorialStep(save), null);
});

test('cash stashes, customer repair orders, radar speed traps, and stunt bonuses earn cash', () => {
  const save = createInitialSaveState();
  const initialCash = save.cash;

  // Cash stash with bonus part
  const stash = CASH_STASHES_INIT[0];
  const s1 = collectCashStash(save, stash);
  assert.equal(s1.ok, true);
  assert.equal(save.cash, initialCash + stash.rewardCash);
  assert.equal(collectCashStash(save, stash).ok, false);

  // Customer repair order consuming spark_plug from stash bonus
  const firstOrder = save.repairOrders[0];
  const orderRes = completeCustomerOrder(save, firstOrder.id);
  assert.equal(orderRes.ok, true);
  assert.equal(save.cash, initialCash + stash.rewardCash + firstOrder.rewardCash);

  // Speed trap payout + cooldown
  const trap = { ...SPEED_TRAPS_INIT[0] };
  const miss = triggerSpeedTrap(save, trap, 32);
  assert.equal(miss.paid, false);
  const hit = triggerSpeedTrap(save, trap, 52);
  assert.equal(hit.paid, true);
  assert.ok(hit.rewardCash >= trap.rewardCash);
  assert.equal(triggerSpeedTrap(save, trap, 60).paid, false);

  // Stunt bonus
  const stunt = awardRidingBonus(save, 'air', 32, '1.00s air');
  assert.equal(stunt.rewardCash, 32);
  assert.equal(save.stuntCashEarned, 32);
});
