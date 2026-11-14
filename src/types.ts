export type GamePhase = 'title' | 'playing' | 'paused';

export type PartCategory =
  | 'cylinder'
  | 'carburetor'
  | 'exhaust'
  | 'variator'
  | 'tires'
  | 'ignition';

export type ExhaustStyle = 'stock' | 'touring' | 'expansion' | 'titanium';

export interface MopedPartSpec {
  id: string;
  name: string;
  category: PartCategory;
  tier: 1 | 2 | 3 | 4;
  price: number;
  description: string;
  displacementCc?: number;
  powerGain: number; // multiplier delta, e.g., 0 = stock, 0.35 = +35%
  torqueGain: number;
  topSpeedBonusKmh: number;
  redlineBonusRpm: number;
  gripBonus: number;
  reliabilityBonus: number; // reduces wear rate
  massDeltaKg: number;
  exhaustStyle?: ExhaustStyle;
}

export type TechnicalIssueId =
  | 'fouled_plug'
  | 'clogged_carb'
  | 'worn_belt'
  | 'flat_tire'
  | 'carbon_exhaust'
  | 'loose_chain';

export type SpareItemId =
  | 'spark_plug'
  | 'carb_jet'
  | 'drive_belt'
  | 'patch_kit'
  | 'exhaust_brush'
  | 'chain_link'
  | 'scrap_metal';

export interface TechnicalIssueDef {
  id: TechnicalIssueId;
  name: string;
  symptom: string;
  repairItem: SpareItemId;
  shopRepairCost: number;
  powerPenalty: number; // 0..1 fraction lost
  dragPenalty: number; // extra rolling resistance
  misfireChance: number; // 0..1 per second at load
  steerPull: number; // rad/s pull
}

export interface SpareItemDef {
  id: SpareItemId;
  name: string;
  description: string;
  price: number;
  sellValue: number;
  fixesIssue?: TechnicalIssueId;
}

export interface MopedModelDef {
  id: string;
  name: string;
  year: number;
  origin: string;
  price: number;
  description: string;
  basePowerKw: number;
  baseTorqueNm: number;
  baseTopSpeedKmh: number;
  baseRedlineRpm: number;
  baseMassKg: number;
  wheelbaseM: number;
  wheelRadiusM: number;
  defaultColor: string;
  frameStyle: 'step_through' | 'cafe_tube' | 'touring_body' | 'scrambler';
  starterParts: Record<PartCategory, string>;
}

export interface OwnedMoped {
  instanceId: string;
  modelId: string;
  paintColor: string;
  installedParts: Record<PartCategory, string>;
  condition: number; // 0..100 overall mechanical health
  odometerKm: number;
  wearAccumulator: number; // triggers issues after grace mileage
  activeIssues: TechnicalIssueId[];
}

export type MissionType = 'delivery' | 'courier' | 'time_trial' | 'scavenge_run' | 'speed_trap';

export interface Vec2 {
  x: number;
  z: number;
}

export interface MissionDef {
  id: string;
  title: string;
  type: MissionType;
  description: string;
  rewardCash: number;
  timeLimitSec?: number;
  targetSpeedKmh?: number;
  waypoints: Array<{ label: string; x: number; z: number }>;
  requiredPartsCount?: number;
}

export interface ActiveMissionState {
  missionId: string;
  waypointIndex: number;
  elapsedSec: number;
  collectedCount: number;
  bestSpeedKmh: number;
  pickedUp: boolean;
}

export interface ScavengeNodeState {
  id: string;
  label: string;
  x: number;
  z: number;
  cooldownSec: number;
  lootTable: SpareItemId[];
}

export interface CashStashDef {
  id: string;
  label: string;
  x: number;
  z: number;
  rewardCash: number;
  bonusPart?: SpareItemId;
}

export interface SpeedTrapZone {
  id: string;
  label: string;
  x: number;
  z: number;
  radius: number;
  minSpeedKmh: number;
  rewardCash: number;
  cooldownSec: number;
}

export interface JumpRampDef {
  id: string;
  x: number;
  z: number;
  width: number;
  length: number;
  height: number;
  rotY: number; // 0 = ramp slopes UP as Z decreases (-Z north)
}

export interface CustomerRepairOrder {
  id: string;
  customerName: string;
  mopedName: string;
  issueTitle: string;
  neededItem: SpareItemId;
  rewardCash: number;
}

export type TutorialStepId =
  | 'open_pc'
  | 'browse_tune'
  | 'exit_garage'
  | 'steer_cam'
  | 'scavenge'
  | 'accept_gig'
  | 'done';

export interface MopedComputedStats {
  displacementCc: number;
  peakPowerKw: number;
  peakTorqueNm: number;
  topSpeedKmh: number;
  redlineRpm: number;
  gripFactor: number;
  wearRateMult: number;
  totalMassKg: number;
  exhaustStyle: ExhaustStyle;
}

export interface MopedPhysicsState {
  x: number;
  y: number;
  z: number;
  heading: number; // radians, 0 = -Z (north)
  speedMs: number; // forward velocity m/s
  verticalVel: number; // vertical m/s for jump ramps
  airborne: boolean;
  airTimeSec: number;
  rpm: number;
  throttle: number; // 0..1
  brake: number; // 0..1
  steerAngle: number; // front fork angle rad
  leanAngle: number; // body roll rad
  pitchAngle: number; // wheelie / brake dive rad
  suspCompression: number;
  wheelRotation: number;
  clutchEngaged: boolean;
  misfiring: boolean;
  onRoad: boolean;
  surfaceBump: number;
}

export interface PlayerSaveState {
  cash: number;
  ownedMopeds: OwnedMoped[];
  activeMopedIndex: number;
  ownedPartIds: string[];
  spareInventory: Record<SpareItemId, number>;
  completedMissionIds: string[];
  activeMission: ActiveMissionState | null;
  totalDeliveries: number;
  tutorialStep: TutorialStepId;
  tutorialSkipped: boolean;
  collectedStashIds: string[];
  repairOrders: CustomerRepairOrder[];
  stuntCashEarned: number;
}
