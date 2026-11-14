import {
  CUSTOMER_REPAIR_ORDERS_INIT,
  MISSIONS_CATALOG,
  MOPED_MODELS_BY_ID,
  PARTS_BY_ID,
  SPARE_ITEMS,
  TECHNICAL_ISSUES,
} from '../constants';
import type {
  ActiveMissionState,
  CashStashDef,
  OwnedMoped,
  PartCategory,
  PlayerSaveState,
  ScavengeNodeState,
  SpareItemId,
  SpeedTrapZone,
  TechnicalIssueId,
} from '../types';

export function createOwnedMoped(modelId: string, instanceSuffix: string): OwnedMoped {
  const model = MOPED_MODELS_BY_ID[modelId];
  if (!model) {
    throw new Error(`Unknown moped model: ${modelId}`);
  }
  return {
    instanceId: `${modelId}_${instanceSuffix}`,
    modelId,
    paintColor: model.defaultColor,
    installedParts: { ...model.starterParts },
    condition: 100,
    odometerKm: 0,
    wearAccumulator: 0,
    activeIssues: [],
  };
}

export function createInitialSaveState(): PlayerSaveState {
  const starterMoped = createOwnedMoped('veloce_50', 'starter');
  const starterParts = Object.values(starterMoped.installedParts);

  return {
    cash: 180,
    ownedMopeds: [starterMoped],
    activeMopedIndex: 0,
    ownedPartIds: [...new Set(starterParts)],
    spareInventory: {
      spark_plug: 0,
      carb_jet: 0,
      drive_belt: 0,
      patch_kit: 0,
      exhaust_brush: 0,
      chain_link: 0,
      scrap_metal: 0,
    },
    completedMissionIds: [],
    activeMission: null,
    totalDeliveries: 0,
    tutorialStep: 'open_pc',
    tutorialSkipped: false,
    collectedStashIds: [],
    repairOrders: CUSTOMER_REPAIR_ORDERS_INIT.map((o) => ({ ...o })),
    stuntCashEarned: 0,
  };
}

export function normalizeSaveState(raw: Partial<PlayerSaveState>): PlayerSaveState {
  const base = createInitialSaveState();
  return {
    ...base,
    ...raw,
    spareInventory: { ...base.spareInventory, ...(raw.spareInventory ?? {}) },
    completedMissionIds: Array.isArray(raw.completedMissionIds) ? raw.completedMissionIds : [],
    collectedStashIds: Array.isArray(raw.collectedStashIds) ? raw.collectedStashIds : [],
    repairOrders:
      Array.isArray(raw.repairOrders) && raw.repairOrders.length > 0
        ? raw.repairOrders
        : base.repairOrders,
    tutorialStep: raw.tutorialStep ?? 'open_pc',
    tutorialSkipped: Boolean(raw.tutorialSkipped),
    stuntCashEarned: typeof raw.stuntCashEarned === 'number' ? raw.stuntCashEarned : 0,
  };
}

export function getActiveMoped(save: PlayerSaveState): OwnedMoped {
  return save.ownedMopeds[save.activeMopedIndex] ?? save.ownedMopeds[0];
}

export function buyPart(
  save: PlayerSaveState,
  partId: string
): { ok: boolean; reason: string } {
  const part = PARTS_BY_ID[partId];
  if (!part) return { ok: false, reason: 'Part not found.' };
  if (save.ownedPartIds.includes(partId)) {
    return { ok: false, reason: 'You already own this part.' };
  }
  if (save.cash < part.price) {
    return { ok: false, reason: `Need $${part.price} (you have $${save.cash}).` };
  }
  save.cash -= part.price;
  save.ownedPartIds.push(partId);
  return { ok: true, reason: `Purchased ${part.name}!` };
}

export function equipPart(
  save: PlayerSaveState,
  partId: string
): { ok: boolean; reason: string } {
  const part = PARTS_BY_ID[partId];
  if (!part) return { ok: false, reason: 'Part not found.' };
  if (!save.ownedPartIds.includes(partId)) {
    return { ok: false, reason: 'You do not own this part yet.' };
  }
  const moped = getActiveMoped(save);
  moped.installedParts[part.category as PartCategory] = partId;
  return { ok: true, reason: `Fitted ${part.name}.` };
}

export function setMopedPaint(save: PlayerSaveState, hex: string): void {
  const moped = getActiveMoped(save);
  moped.paintColor = hex;
}

export function buyMoped(
  save: PlayerSaveState,
  modelId: string
): { ok: boolean; reason: string } {
  const model = MOPED_MODELS_BY_ID[modelId];
  if (!model) return { ok: false, reason: 'Moped model not found.' };
  const alreadyOwned = save.ownedMopeds.some((m) => m.modelId === modelId);
  if (alreadyOwned) {
    return { ok: false, reason: `You already own a ${model.name}.` };
  }
  if (save.cash < model.price) {
    return { ok: false, reason: `Need $${model.price} (you have $${save.cash}).` };
  }
  save.cash -= model.price;
  const newMoped = createOwnedMoped(modelId, String(save.ownedMopeds.length + 1));
  save.ownedMopeds.push(newMoped);
  save.activeMopedIndex = save.ownedMopeds.length - 1;
  for (const pid of Object.values(newMoped.installedParts)) {
    if (!save.ownedPartIds.includes(pid)) {
      save.ownedPartIds.push(pid);
    }
  }
  return { ok: true, reason: `Bought ${model.name} and parked it on the lift!` };
}

export function selectActiveMoped(save: PlayerSaveState, index: number): boolean {
  if (index < 0 || index >= save.ownedMopeds.length) return false;
  save.activeMopedIndex = index;
  return true;
}

export function buySpareItem(
  save: PlayerSaveState,
  itemId: SpareItemId
): { ok: boolean; reason: string } {
  const def = SPARE_ITEMS[itemId];
  if (!def || def.price <= 0) return { ok: false, reason: 'Item not sold.' };
  if (save.cash < def.price) {
    return { ok: false, reason: `Need $${def.price}.` };
  }
  save.cash -= def.price;
  save.spareInventory[itemId] = (save.spareInventory[itemId] ?? 0) + 1;
  return { ok: true, reason: `Bought ${def.name}.` };
}

export function sellScrapMetal(save: PlayerSaveState): { sold: number; earned: number } {
  const qty = save.spareInventory.scrap_metal ?? 0;
  if (qty <= 0) return { sold: 0, earned: 0 };
  const earned = qty * SPARE_ITEMS.scrap_metal.sellValue;
  save.spareInventory.scrap_metal = 0;
  save.cash += earned;
  return { sold: qty, earned };
}

export function repairIssueWithItem(
  save: PlayerSaveState,
  issueId: TechnicalIssueId
): { ok: boolean; reason: string } {
  const moped = getActiveMoped(save);
  const idx = moped.activeIssues.indexOf(issueId);
  if (idx === -1) return { ok: false, reason: 'Issue not present.' };
  const issue = TECHNICAL_ISSUES[issueId];
  const itemId = issue.repairItem;
  if ((save.spareInventory[itemId] ?? 0) <= 0) {
    return {
      ok: false,
      reason: `Need ${SPARE_ITEMS[itemId].name}. Scavenge scrap piles or buy one!`,
    };
  }
  save.spareInventory[itemId] -= 1;
  moped.activeIssues.splice(idx, 1);
  moped.condition = Math.min(100, moped.condition + 18);
  return { ok: true, reason: `Fixed ${issue.name} using ${SPARE_ITEMS[itemId].name}!` };
}

export function repairIssueWithCash(
  save: PlayerSaveState,
  issueId: TechnicalIssueId
): { ok: boolean; reason: string } {
  const moped = getActiveMoped(save);
  const idx = moped.activeIssues.indexOf(issueId);
  if (idx === -1) return { ok: false, reason: 'Issue not present.' };
  const issue = TECHNICAL_ISSUES[issueId];
  if (save.cash < issue.shopRepairCost) {
    return { ok: false, reason: `Shop repair costs $${issue.shopRepairCost}.` };
  }
  save.cash -= issue.shopRepairCost;
  moped.activeIssues.splice(idx, 1);
  moped.condition = Math.min(100, moped.condition + 18);
  return { ok: true, reason: `Mechanic fixed ${issue.name} for $${issue.shopRepairCost}.` };
}

export function tuneUpMopedCondition(save: PlayerSaveState): { ok: boolean; reason: string } {
  const moped = getActiveMoped(save);
  if (moped.condition >= 99) return { ok: false, reason: 'Moped is already in mint tune.' };
  const cost = 35;
  if (save.cash < cost) return { ok: false, reason: `Full tune-up costs $${cost}.` };
  save.cash -= cost;
  moped.condition = 100;
  moped.wearAccumulator = 0;
  return { ok: true, reason: 'Completed full 2-stroke tune-up (100% condition).' };
}

export function scavengeNode(
  save: PlayerSaveState,
  node: ScavengeNodeState,
  randomFn: () => number = Math.random
): { ok: boolean; foundItem?: SpareItemId; bonusCash: number; reason: string } {
  if (node.cooldownSec > 0) {
    return {
      ok: false,
      bonusCash: 0,
      reason: `Pile searched recently (${Math.ceil(node.cooldownSec)}s).`,
    };
  }
  const moped = getActiveMoped(save);
  let foundItem: SpareItemId;
  // Bias loot toward an active issue's needed repair part if the moped currently has one!
  if (moped.activeIssues.length > 0 && randomFn() < 0.72) {
    const neededIssue = TECHNICAL_ISSUES[moped.activeIssues[0]];
    foundItem = neededIssue.repairItem;
  } else {
    foundItem = node.lootTable[Math.floor(randomFn() * node.lootTable.length)];
  }
  save.spareInventory[foundItem] = (save.spareInventory[foundItem] ?? 0) + 1;
  const bonusCash = randomFn() < 0.4 ? 15 : 0;
  save.cash += bonusCash;
  node.cooldownSec = 35;

  if (save.activeMission) {
    const missionDef = MISSIONS_CATALOG.find((m) => m.id === save.activeMission?.missionId);
    if (missionDef?.type === 'scavenge_run') {
      save.activeMission.collectedCount += 1;
    }
  }

  return {
    ok: true,
    foundItem,
    bonusCash,
    reason: `Scavenged ${SPARE_ITEMS[foundItem].name}${bonusCash > 0 ? ` + $${bonusCash}` : ''}!`,
  };
}

export function startMission(
  save: PlayerSaveState,
  missionId: string
): { ok: boolean; reason: string } {
  const def = MISSIONS_CATALOG.find((m) => m.id === missionId);
  if (!def) return { ok: false, reason: 'Mission not found.' };
  const state: ActiveMissionState = {
    missionId,
    waypointIndex: 0,
    elapsedSec: 0,
    collectedCount: 0,
    bestSpeedKmh: 0,
    pickedUp: false,
  };
  save.activeMission = state;
  return { ok: true, reason: `Started: ${def.title}` };
}

export function cancelMission(save: PlayerSaveState): void {
  save.activeMission = null;
}

export function updateActiveMission(
  save: PlayerSaveState,
  playerX: number,
  playerZ: number,
  speedKmh: number,
  dt: number
): { status: 'none' | 'active' | 'completed' | 'failed'; message?: string; reward?: number } {
  const active = save.activeMission;
  if (!active) return { status: 'none' };
  const def = MISSIONS_CATALOG.find((m) => m.id === active.missionId);
  if (!def) {
    save.activeMission = null;
    return { status: 'none' };
  }

  active.elapsedSec += dt;
  active.bestSpeedKmh = Math.max(active.bestSpeedKmh, speedKmh);

  if (def.timeLimitSec && active.elapsedSec > def.timeLimitSec) {
    save.activeMission = null;
    return { status: 'failed', message: `Time expired on ${def.title}!` };
  }

  const wp = def.waypoints[active.waypointIndex];
  if (!wp) return { status: 'active' };

  const dx = playerX - wp.x;
  const dz = playerZ - wp.z;
  const distSq = dx * dx + dz * dz;
  const hitRadius = 4.6;

  if (distSq <= hitRadius * hitRadius) {
    if (def.type === 'speed_trap') {
      if (speedKmh >= (def.targetSpeedKmh ?? 68)) {
        return finishMissionSuccess(save, def.id, def.title, def.rewardCash);
      }
      return {
        status: 'active',
        message: `Speed trap clocked ${Math.round(speedKmh)} km/h — need ${def.targetSpeedKmh} km/h!`,
      };
    }

    if (def.type === 'scavenge_run') {
      if (active.collectedCount < (def.requiredPartsCount ?? 2)) {
        return { status: 'active' };
      }
      return finishMissionSuccess(save, def.id, def.title, def.rewardCash);
    }

    if (active.waypointIndex + 1 < def.waypoints.length) {
      active.waypointIndex += 1;
      active.pickedUp = true;
      return {
        status: 'active',
        message: `Checkpoint reached! Head to ${def.waypoints[active.waypointIndex].label}.`,
      };
    } else {
      return finishMissionSuccess(save, def.id, def.title, def.rewardCash);
    }
  }

  return { status: 'active' };
}

function finishMissionSuccess(
  save: PlayerSaveState,
  missionId: string,
  title: string,
  rewardCash: number
): { status: 'completed'; message: string; reward: number } {
  save.cash += rewardCash;
  save.totalDeliveries += 1;
  if (!save.completedMissionIds.includes(missionId)) {
    save.completedMissionIds.push(missionId);
  }
  save.activeMission = null;
  return {
    status: 'completed',
    message: `Mission Complete: ${title} (+$${rewardCash})!`,
    reward: rewardCash,
  };
}

export function collectCashStash(
  save: PlayerSaveState,
  stash: CashStashDef
): { ok: boolean; reason: string; rewardCash: number } {
  if (save.collectedStashIds.includes(stash.id)) {
    return { ok: false, reason: 'Stash already collected.', rewardCash: 0 };
  }
  save.collectedStashIds.push(stash.id);
  save.cash += stash.rewardCash;
  let partNote = '';
  if (stash.bonusPart) {
    save.spareInventory[stash.bonusPart] = (save.spareInventory[stash.bonusPart] ?? 0) + 1;
    partNote = ` + ${SPARE_ITEMS[stash.bonusPart].name}`;
  }
  return {
    ok: true,
    rewardCash: stash.rewardCash,
    reason: `Found ${stash.label}: +$${stash.rewardCash}${partNote}!`,
  };
}

export function completeCustomerOrder(
  save: PlayerSaveState,
  orderId: string
): { ok: boolean; reason: string; rewardCash: number } {
  const idx = save.repairOrders.findIndex((o) => o.id === orderId);
  if (idx === -1) return { ok: false, reason: 'Repair order not found.', rewardCash: 0 };
  const order = save.repairOrders[idx];
  const have = save.spareInventory[order.neededItem] ?? 0;
  if (have <= 0) {
    return {
      ok: false,
      rewardCash: 0,
      reason: `Need 1x ${SPARE_ITEMS[order.neededItem].name} to finish ${order.customerName}'s bike.`,
    };
  }
  save.spareInventory[order.neededItem] = have - 1;
  save.cash += order.rewardCash;
  save.repairOrders.splice(idx, 1);
  if (save.repairOrders.length === 0) {
    save.repairOrders = CUSTOMER_REPAIR_ORDERS_INIT.map((o) => ({ ...o }));
  }
  return {
    ok: true,
    rewardCash: order.rewardCash,
    reason: `Repaired ${order.customerName}'s ${order.mopedName} (+$${order.rewardCash})!`,
  };
}

export function triggerSpeedTrap(
  save: PlayerSaveState,
  trap: SpeedTrapZone,
  speedKmh: number
): { paid: boolean; reason?: string; rewardCash: number } {
  if (trap.cooldownSec > 0 || speedKmh < trap.minSpeedKmh) {
    return { paid: false, rewardCash: 0 };
  }
  const overSpeed = Math.max(0, Math.round(speedKmh - trap.minSpeedKmh));
  const bonus = Math.min(35, Math.floor(overSpeed / 4) * 5);
  const total = trap.rewardCash + bonus;
  save.cash += total;
  trap.cooldownSec = 25;
  return {
    paid: true,
    rewardCash: total,
    reason: `${trap.label}: ${Math.round(speedKmh)} km/h! Radar Bounty +$${total}!`,
  };
}

export function awardRidingBonus(
  save: PlayerSaveState,
  kind: 'air' | 'carve',
  amount: number,
  metricLabel: string
): { rewardCash: number; reason: string } {
  save.cash += amount;
  save.stuntCashEarned += amount;
  const tag = kind === 'air' ? 'BIG AIR STUNT' : 'CORNER CARVE';
  return {
    rewardCash: amount,
    reason: `${tag} (${metricLabel}): +$${amount}!`,
  };
}

