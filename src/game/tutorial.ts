import type { PlayerSaveState, TutorialStepId } from '../types';

export interface TutorialStepDef {
  id: TutorialStepId;
  stepNumber: number;
  totalSteps: number;
  title: string;
  hint: string;
  rewardCash: number;
  nextStep: TutorialStepId;
}

export const TUTORIAL_STEPS: TutorialStepDef[] = [
  {
    id: 'open_pc',
    stepNumber: 1,
    totalSteps: 6,
    title: 'Inspect Your Garage PC',
    hint: 'Press [E] or click PC [E] to boot MOPED-OS & inspect your mint starter bike.',
    rewardCash: 25,
    nextStep: 'browse_tune',
  },
  {
    id: 'browse_tune',
    stepNumber: 2,
    totalSteps: 6,
    title: 'Explore Tuning & Side Hustles',
    hint: 'Click Parts Shop or Local Gigs in MOPED-OS, or customize paint, then close [Esc].',
    rewardCash: 25,
    nextStep: 'exit_garage',
  },
  {
    id: 'exit_garage',
    stepNumber: 3,
    totalSteps: 6,
    title: 'Hit the Coastal Streets',
    hint: 'Hold [W] / Up Arrow to throttle out the open north garage bay onto the street.',
    rewardCash: 30,
    nextStep: 'steer_cam',
  },
  {
    id: 'steer_cam',
    stepNumber: 4,
    totalSteps: 6,
    title: 'Carve Corners & Check Views',
    hint: 'Steer with [A]/[D] and tap [C] to switch Chase / Saddle / Orbit camera.',
    rewardCash: 30,
    nextStep: 'scavenge',
  },
  {
    id: 'scavenge',
    stepNumber: 5,
    totalSteps: 6,
    title: 'Scavenge Spare Parts',
    hint: 'Pull up to any glowing amber crate (one sits right outside at the driveway!) and press [E].',
    rewardCash: 40,
    nextStep: 'accept_gig',
  },
  {
    id: 'accept_gig',
    stepNumber: 6,
    totalSteps: 6,
    title: 'Start Earning Real Cash',
    hint: 'Accept a gig on PC [E], blast a Radar Speed Trap, hit a Ramp Jump, or grab a Golden Cash Stash!',
    rewardCash: 50,
    nextStep: 'done',
  },
];

export const TUTORIAL_STEPS_BY_ID: Record<string, TutorialStepDef> = Object.fromEntries(
  TUTORIAL_STEPS.map((step) => [step.id, step])
);

export function getActiveTutorialStep(save: PlayerSaveState): TutorialStepDef | null {
  if (save.tutorialSkipped || save.tutorialStep === 'done') {
    return null;
  }
  return TUTORIAL_STEPS_BY_ID[save.tutorialStep] ?? null;
}

export function advanceTutorialIfOn(
  save: PlayerSaveState,
  milestoneStep: TutorialStepId
): { advanced: boolean; completedTitle?: string; rewardCash: number } {
  if (save.tutorialSkipped || save.tutorialStep === 'done') {
    return { advanced: false, rewardCash: 0 };
  }
  const currentIdx = TUTORIAL_STEPS.findIndex((s) => s.id === save.tutorialStep);
  const milestoneIdx = TUTORIAL_STEPS.findIndex((s) => s.id === milestoneStep);
  if (currentIdx === -1 || milestoneIdx === -1) {
    return { advanced: false, rewardCash: 0 };
  }
  // Exact match or non-stalling catch-up when driving/action milestones occur ahead of PC browsing
  if (milestoneIdx < currentIdx) {
    return { advanced: false, rewardCash: 0 };
  }
  if (milestoneIdx > currentIdx && milestoneStep !== 'exit_garage' && milestoneStep !== 'scavenge' && milestoneStep !== 'accept_gig') {
    return { advanced: false, rewardCash: 0 };
  }
  const def = TUTORIAL_STEPS[milestoneIdx];
  save.cash += def.rewardCash;
  save.tutorialStep = def.nextStep;
  return {
    advanced: true,
    completedTitle: def.title,
    rewardCash: def.rewardCash,
  };
}

export function skipTutorial(save: PlayerSaveState): void {
  save.tutorialSkipped = true;
  save.tutorialStep = 'done';
}
