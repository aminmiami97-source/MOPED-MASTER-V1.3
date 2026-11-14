import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as xb from 'xrblocks';
import { MopedAudioEngine } from './audio/mopedAudio';
import {
  MISSIONS_CATALOG,
  MOPED_MODELS_BY_ID,
  TECHNICAL_ISSUES,
  WORLD_LANDMARKS,
} from './constants';
import {
  awardRidingBonus,
  cancelMission,
  collectCashStash,
  createInitialSaveState,
  getActiveMoped,
  normalizeSaveState,
  repairIssueWithCash,
  repairIssueWithItem,
  scavengeNode,
  selectActiveMoped,
  startMission,
  triggerSpeedTrap,
  tuneUpMopedCondition,
  updateActiveMission,
} from './game/economy';
import { advanceTutorialIfOn, skipTutorial } from './game/tutorial';
import { MopedRig } from './scene/mopedMesh';
import { createProceduralTextures, type ProceduralTextureSet } from './scene/textures';
import { VrSpatialUi } from './scene/vrUi';
import { buildMopedWorld, type WorldVisuals } from './scene/worldBuilder';
import {
  computeMopedStats,
  createInitialPhysicsState,
  stepMopedPhysics,
} from './sim/mopedPhysics';
import type { GamePhase, MopedPhysicsState, PlayerSaveState, ScavengeNodeState } from './types';
import { GameShell } from './ui/gameShell';

type CameraMode = 'chase' | 'saddle' | 'orbit';

const SAVE_STORAGE_KEY = 'moped_master_save_v1';

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const rendererStr = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    return /swiftshader|llvmpipe|softpipe|mesa/i.test(rendererStr);
  } catch {
    return false;
  }
}

function loadSavedState(): PlayerSaveState {
  const params = new URLSearchParams(window.location.search);
  let loaded: PlayerSaveState;
  if (params.get('reset') === '1') {
    loaded = createInitialSaveState();
  } else {
    loaded = createInitialSaveState();
    try {
      const raw = window.localStorage.getItem(SAVE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PlayerSaveState>;
        if (
          parsed &&
          typeof parsed.cash === 'number' &&
          Array.isArray(parsed.ownedMopeds) &&
          parsed.ownedMopeds.length > 0
        ) {
          loaded = normalizeSaveState(parsed);
        }
      }
    } catch {
      // Ignore corrupted save data
    }
  }
  if (params.get('tutorial') === '0') {
    skipTutorial(loaded);
  }
  return loaded;
}

function persistSavedState(save: PlayerSaveState): void {
  try {
    window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(save));
  } catch {
    // Ignore storage quota / privacy errors
  }
}

class MopedMasterApp extends xb.Script {
  private readonly save: PlayerSaveState = loadSavedState();
  private readonly physState: MopedPhysicsState = createInitialPhysicsState(0, 0.035, 0.5, 0);
  private readonly audio = new MopedAudioEngine();
  private readonly keys = new Set<string>();

  private textures!: ProceduralTextureSet;
  private world!: WorldVisuals;
  private mopedRig!: MopedRig;
  private vrUi!: VrSpatialUi;
  private shell!: GameShell;

  private playerRig = new THREE.Group();
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private isSoftwareGl = false;
  private softwareLoopRunning = false;
  private phase: GamePhase = 'title';
  private cameraMode: CameraMode = 'chase';
  private inVr = false;
  private elapsedSec = 0;
  private lastLoopMs = 0;
  private hudSyncTimer = 0;
  private carveAccumSec = 0;
  private carveCooldownSec = 0;

  private readonly camPos = new THREE.Vector3(2.8, 2.2, 4.4);
  private readonly camLook = new THREE.Vector3(0, 0.9, 0);
  private readonly desiredCamPos = new THREE.Vector3();
  private readonly desiredCamLook = new THREE.Vector3();
  private readonly tmpVec = new THREE.Vector3();

  private readonly handleWindowKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    if (code === 'Tab') return;

    if (this.phase === 'title') {
      if (code === 'Enter' || code === 'Space') {
        e.preventDefault();
        this.startGame();
      }
      return;
    }

    if (code === 'Escape' || code === 'KeyP') {
      e.preventDefault();
      if (this.shell.isPcOpen()) {
        this.shell.closePc();
      } else if (this.phase === 'playing') {
        this.pauseGame();
      } else if (this.phase === 'paused') {
        this.resumeGame();
      }
      return;
    }

    if (this.phase !== 'playing') return;

    if (code === 'KeyE') {
      e.preventDefault();
      if (this.shell.isPcOpen()) {
        this.shell.closePc();
      } else {
        this.handleContextAction();
      }
      return;
    }

    if (this.shell.isPcOpen()) return;

    if (code === 'KeyC') {
      e.preventDefault();
      this.cycleCameraMode();
      return;
    }

    if (code === 'KeyM') {
      e.preventDefault();
      this.audio.toggleMute();
      return;
    }

    if (
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      if (code.startsWith('Arrow') || code === 'Space') {
        e.preventDefault();
      }
      this.audio.ensureStarted();
      this.keys.add(code);
    }
  };

  private readonly handleWindowKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private readonly clearHeldInputs = () => {
    this.keys.clear();
  };

  private readonly onVisibilityChange = () => {
    if (document.hidden) {
      this.clearHeldInputs();
    }
  };

  public init(): void {
    this.isSoftwareGl = detectSoftwareGl();

    const renderer = xb.core.renderer as THREE.WebGLRenderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(this.isSoftwareGl ? 0.75 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !this.isSoftwareGl;
    if (!this.isSoftwareGl) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      // Studio/Garage PMREM environment lighting for rich chrome & paint reflections
      const pmrem = new THREE.PMREMGenerator(renderer);
      const roomEnv = new RoomEnvironment();
      this.envRenderTarget = pmrem.fromScene(roomEnv, 0.04);
      xb.core.scene.environment = this.envRenderTarget.texture;
      xb.core.scene.environmentIntensity = 0.68;
      roomEnv.dispose();
      pmrem.dispose();
    }

    xb.core.camera.far = 1200;
    xb.core.camera.updateProjectionMatrix();

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAnisotropy);
    this.world = buildMopedWorld(xb.core.scene, this.textures, !this.isSoftwareGl);

    this.mopedRig = new MopedRig(this.textures);
    this.mopedRig.syncAppearance(getActiveMoped(this.save));
    this.add(this.mopedRig.root);
    this.add(this.mopedRig.getSmokeObject());

    // Parent camera and XR systems under a movable player rig for full VR riding
    this.playerRig.name = 'PlayerXrRig';
    xb.core.scene.add(this.playerRig);
    this.playerRig.add(xb.core.camera, xb.core.xrSystemsGroup);

    // Spatial VR UI inside garage + handlebar dash
    this.vrUi = new VrSpatialUi({
      onCycleMoped: () => {
        if (this.save.ownedMopeds.length > 1) {
          const next = (this.save.activeMopedIndex + 1) % this.save.ownedMopeds.length;
          selectActiveMoped(this.save, next);
          this.onStateMutated('wrench', `Switched to ${MOPED_MODELS_BY_ID[getActiveMoped(this.save).modelId].name}.`);
        } else {
          this.shell.showToast('Buy additional mopeds on the Garage PC!');
        }
      },
      onTuneUp: () => {
        const res = tuneUpMopedCondition(this.save);
        this.onStateMutated(res.ok ? 'wrench' : 'none', res.reason);
      },
      onFixFirstIssue: () => {
        const moped = getActiveMoped(this.save);
        if (moped.activeIssues.length === 0) {
          this.shell.showToast('No mechanical issues right now.');
          return;
        }
        const issueId = moped.activeIssues[0];
        let res = repairIssueWithItem(this.save, issueId);
        if (!res.ok) {
          res = repairIssueWithCash(this.save, issueId);
        }
        this.onStateMutated(res.ok ? 'wrench' : 'none', res.reason);
      },
      onQuickMission: () => {
        if (this.save.activeMission) {
          cancelMission(this.save);
          this.onStateMutated('none', 'Active gig cancelled.');
        } else {
          const res = startMission(this.save, MISSIONS_CATALOG[0].id);
          this.onStateMutated('cash', res.reason);
        }
      },
      onOpenPcOverlay: () => {
        if (this.phase !== 'playing') this.startGame();
        this.shell.openPc('garage');
      },
    });
    this.vrUi.attachTo(xb.core.scene, this.mopedRig.root);
    this.refreshVrUi();

    // DOM Game Shell (Title Screen, HUD, Virtual PC, Pause)
    this.shell = new GameShell(this.save, {
      onStartGame: () => this.startGame(),
      onPauseGame: () => this.pauseGame(),
      onResumeGame: () => this.resumeGame(),
      onReturnToTitle: () => this.returnToTitle(),
      onTeleportGarage: () => this.teleportToGarage(),
      onToggleCamera: () => this.cycleCameraMode(),
      onToggleMute: () => this.audio.toggleMute(),
      onToggleVr: () => void this.toggleVrSession(),
      onContextAction: () => this.handleContextAction(),
      onPcOpenChanged: (open) => {
        if (open) {
          this.clearHeldInputs();
          this.checkTutorialStep('open_pc');
        }
      },
      onPcBrowsed: () => {
        this.checkTutorialStep('browse_tune');
      },
      onMissionAccepted: () => {
        this.checkTutorialStep('accept_gig');
      },
      onStateMutated: (sound, toast) => this.onStateMutated(sound, toast),
    });

    this.shell.setCameraLabel('Chase');
    this.syncVrSupportStatus();
    this.bindWebXrEvents();

    window.addEventListener('keydown', this.handleWindowKeyDown);
    window.addEventListener('keyup', this.handleWindowKeyUp);
    window.addEventListener('blur', this.clearHeldInputs);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // Pre-compile scene shaders on hardware WebGL to avoid mid-drive stutter
    if (!this.isSoftwareGl) {
      renderer.compile(xb.core.scene, xb.core.camera);
    }

    // Initial hero framing for title screen
    this.mopedRig.updateVisuals(this.physState, 0.016);
    this.updateDesktopCamera(1.0);

    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      this.startGame();
    } else {
      this.setPhase('title');
    }

    // Pace software WebGL rendering with fenceSync so headless verification never starves
    if (this.isSoftwareGl) {
      this.startSoftwareGlLoop();
    }
  }

  private bindWebXrEvents(): void {
    const mgr = xb.core.webXRSessionManager;
    if (!mgr) return;
    mgr.addEventListener(xb.WebXRSessionEventType.READY, () => this.syncVrSupportStatus());
    mgr.addEventListener(xb.WebXRSessionEventType.UNSUPPORTED, () => this.syncVrSupportStatus());
    mgr.addEventListener(xb.WebXRSessionEventType.SESSION_ERROR, () => {
      this.shell.showToast('VR headset session failed to start.');
    });
  }

  private syncVrSupportStatus(): void {
    const supported = Boolean(xb.core.webXRSessionManager?.isXRSupported());
    this.shell.setVrSupported(supported, this.inVr);
  }

  private async toggleVrSession(): Promise<void> {
    const mgr = xb.core.webXRSessionManager;
    if (!mgr || !mgr.isXRSupported()) {
      this.shell.showToast('Connect a WebXR-compatible VR headset (e.g. Android XR / Quest) to enter VR.');
      return;
    }
    try {
      if (this.inVr && mgr.currentSession) {
        await mgr.endSession();
      } else {
        if (this.phase === 'title') {
          this.startGame();
        }
        mgr.startSession();
      }
    } catch {
      this.shell.showToast('Could not toggle VR session.');
    }
  }

  public onXRSessionStarted(): void {
    this.inVr = true;
    this.vrUi.setVrActive(true);
    this.syncVrSupportStatus();
    if (this.phase === 'title') {
      this.startGame();
    }
    this.shell.showToast('VR Riding Mode Active — Use thumbsticks & triggers!');
  }

  public onXRSessionEnded(): void {
    this.inVr = false;
    this.vrUi.setVrActive(false);
    this.playerRig.position.set(0, 0, 0);
    this.playerRig.rotation.set(0, 0, 0);
    this.syncVrSupportStatus();
    if (this.isSoftwareGl && !this.softwareLoopRunning) {
      this.startSoftwareGlLoop();
    }
  }

  private startSoftwareGlLoop(): void {
    if (this.softwareLoopRunning) return;
    this.softwareLoopRunning = true;
    const renderer = xb.core.renderer as THREE.WebGLRenderer;
    renderer.setAnimationLoop(null);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    this.lastLoopMs = performance.now();

    const afterDraw = (tick: () => void) => {
      if (typeof gl?.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const check = () => {
          if (!this.softwareLoopRunning || this.inVr) return;
          if (!sync) {
            tick();
            return;
          }
          const status = gl.clientWaitSync(sync, 0, 0);
          if (status === gl.WAIT_FAILED) {
            gl.deleteSync(sync);
            tick();
            return;
          }
          if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
            gl.deleteSync(sync);
            tick();
          } else {
            window.setTimeout(check, 32);
          }
        };
        window.setTimeout(check, 32);
      } else {
        requestAnimationFrame(tick);
      }
    };

    const tick = () => {
      if (!this.softwareLoopRunning || this.inVr) return;
      const now = performance.now();
      const dtMs = Math.min(50, Math.max(4, now - this.lastLoopMs));
      this.lastLoopMs = now;
      xb.core.stepFrame(dtMs);
      afterDraw(tick);
    };

    afterDraw(tick);
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase;
    this.shell.setPhase(phase);
    if (phase !== 'playing') {
      this.clearHeldInputs();
      this.audio.updateEngine(1500, 0, 'stock', false, false);
    }
  }

  private startGame(): void {
    this.audio.ensureStarted();
    this.setPhase('playing');
    this.updateDesktopCamera(1.0);
  }

  private pauseGame(): void {
    if (this.phase !== 'playing') return;
    this.setPhase('paused');
  }

  private resumeGame(): void {
    if (this.phase !== 'paused') return;
    this.audio.ensureStarted();
    this.setPhase('playing');
  }

  private returnToTitle(): void {
    this.teleportToGarage();
    this.setPhase('title');
  }

  private teleportToGarage(): void {
    this.physState.x = 0;
    this.physState.z = 0.5;
    this.physState.y = 0.035;
    this.physState.verticalVel = 0;
    this.physState.airborne = false;
    this.physState.airTimeSec = 0;
    this.physState.heading = 0;
    this.physState.speedMs = 0;
    this.physState.rpm = 1500;
    this.physState.steerAngle = 0;
    this.physState.leanAngle = 0;
    this.physState.pitchAngle = 0;
    this.mopedRig.updateVisuals(this.physState, 0.016);
    this.shell.showToast('Towed moped back onto garage lift.');
  }

  private cycleCameraMode(): void {
    const order: CameraMode[] = ['chase', 'saddle', 'orbit'];
    const nextIdx = (order.indexOf(this.cameraMode) + 1) % order.length;
    this.cameraMode = order[nextIdx];
    const labels: Record<CameraMode, string> = {
      chase: 'Chase',
      saddle: 'Saddle',
      orbit: 'Orbit',
    };
    this.shell.setCameraLabel(labels[this.cameraMode]);
    this.updateDesktopCamera(1.0);
    this.checkTutorialStep('steer_cam');
  }

  private checkTutorialStep(step: 'open_pc' | 'browse_tune' | 'exit_garage' | 'steer_cam' | 'scavenge' | 'accept_gig'): void {
    const res = advanceTutorialIfOn(this.save, step);
    if (res.advanced) {
      this.audio.playCashChime();
      persistSavedState(this.save);
      this.refreshVrUi();
      const suffix = this.save.tutorialStep === 'done' ? ' — All Tutorial Steps Complete!' : '';
      this.shell.showToast(`Tutorial: ${res.completedTitle} (+$${res.rewardCash})${suffix}`);
    }
  }

  private onStateMutated(sound: 'wrench' | 'cash' | 'none', toast?: string): void {
    this.mopedRig.syncAppearance(getActiveMoped(this.save));
    this.refreshVrUi();
    persistSavedState(this.save);
    if (sound === 'wrench') this.audio.playWrenchSound();
    if (sound === 'cash') this.audio.playCashChime();
    if (toast) this.shell.showToast(toast);
  }

  private refreshVrUi(): void {
    const moped = getActiveMoped(this.save);
    const model = MOPED_MODELS_BY_ID[moped.modelId];
    this.vrUi.updateGarageReadout(model.name, moped.condition, this.save.cash, moped.activeIssues.length);
  }

  private getNearestScavengeNode(): { node: ScavengeNodeState; dist: number } | null {
    let best: { node: ScavengeNodeState; dist: number } | null = null;
    for (const node of this.world.scavengeNodes) {
      const dx = this.physState.x - node.x;
      const dz = this.physState.z - node.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= 4.8 && (!best || dist < best.dist)) {
        best = { node, dist };
      }
    }
    return best;
  }

  private isNearGaragePc(): boolean {
    const dx = this.physState.x - WORLD_LANDMARKS.pcBench.x;
    const dz = this.physState.z - WORLD_LANDMARKS.pcBench.z;
    const insideGarage = Math.abs(this.physState.x) < 5.0 && Math.abs(this.physState.z) < 5.0;
    return insideGarage || Math.hypot(dx, dz) < 4.2;
  }

  private handleContextAction(): void {
    const nearNode = this.getNearestScavengeNode();
    if (nearNode) {
      const res = scavengeNode(this.save, nearNode.node);
      if (res.ok) {
        this.audio.playScavengeChime();
        persistSavedState(this.save);
        this.refreshVrUi();
        this.shell.showToast(res.reason);
        this.checkTutorialStep('scavenge');
      } else {
        this.shell.showToast(res.reason);
      }
      return;
    }

    if (this.isNearGaragePc()) {
      this.shell.openPc('garage');
      return;
    }

    this.shell.openPc('garage');
  }

  private sampleDrivingInput(): {
    throttle: number;
    brake: number;
    steer: number;
    reverse: boolean;
  } {
    let throttle = 0;
    let brake = 0;
    let steer = 0;
    let reverse = false;

    if (!this.shell.isPcOpen()) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle = 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
        brake = 1;
        reverse = true;
      }
      if (this.keys.has('Space')) brake = 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) steer += 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) steer -= 1;
    }

    // Merge WebXR VR controller thumbstick & trigger axes
    if (this.inVr) {
      const session = (xb.core.renderer as THREE.WebGLRenderer).xr.getSession?.();
      if (session) {
        for (const source of session.inputSources) {
          const gp = source.gamepad;
          if (!gp) continue;
          const stickX = gp.axes[2] ?? gp.axes[0] ?? 0;
          const stickY = gp.axes[3] ?? gp.axes[1] ?? 0;
          const trigger = gp.buttons[0]?.value ?? 0;

          if (source.handedness === 'right') {
            if (trigger > 0.1) throttle = Math.max(throttle, trigger);
            if (stickY < -0.15) throttle = Math.max(throttle, -stickY);
            if (Math.abs(stickX) > 0.12) steer = Math.max(-1, Math.min(1, steer - stickX));
          } else if (source.handedness === 'left') {
            if (trigger > 0.1) {
              brake = Math.max(brake, trigger);
              reverse = true;
            }
            if (stickY > 0.15) {
              brake = Math.max(brake, stickY);
              reverse = true;
            }
            if (Math.abs(stickX) > 0.12) steer = Math.max(-1, Math.min(1, steer - stickX));
          }
        }
      }
    }

    return { throttle, brake, steer, reverse };
  }

  public update(): void {
    const rawDt = xb.getDeltaTime();
    const dt = Math.min(0.05, Math.max(0.001, rawDt || 0.016));
    this.elapsedSec += dt;

    // Tick scavenge node & radar trap cooldowns
    for (const node of this.world.scavengeNodes) {
      if (node.cooldownSec > 0) {
        node.cooldownSec = Math.max(0, node.cooldownSec - dt);
      }
    }
    for (const trap of this.world.speedTraps) {
      if (trap.cooldownSec > 0) {
        trap.cooldownSec = Math.max(0, trap.cooldownSec - dt);
      }
    }
    if (this.carveCooldownSec > 0) {
      this.carveCooldownSec = Math.max(0, this.carveCooldownSec - dt);
    }

    const activeMoped = getActiveMoped(this.save);
    const stats = computeMopedStats(activeMoped);

    if (this.phase === 'playing') {
      const input = this.sampleDrivingInput();
      const surface = this.world.sampleSurface(this.physState.x, this.physState.z);
      const stepRes = stepMopedPhysics(this.physState, activeMoped, input, surface, dt);

      // Sliding collision resolution against buildings, garage walls, and boundary
      const col = this.world.resolveCollision(this.physState.x, this.physState.z, 0.58);
      if (col.hit) {
        this.physState.x = col.x;
        this.physState.z = col.z;
        this.physState.speedMs *= 0.45;
      }

      if (stepRes.triggeredIssue) {
        const issue = TECHNICAL_ISSUES[stepRes.triggeredIssue];
        this.shell.showToast(`WEAR ALERT: ${issue.name}! Scavenge parts or fix on PC.`);
        this.refreshVrUi();
        persistSavedState(this.save);
      }

      const speedKmh = Math.abs(this.physState.speedMs) * 3.6;

      // Tutorial progress: leaving garage + leaning/camera
      if (this.physState.z < -6.5) {
        this.checkTutorialStep('exit_garage');
      }
      if (this.save.tutorialStep === 'steer_cam' && Math.abs(this.physState.leanAngle) > 0.22) {
        this.checkTutorialStep('steer_cam');
      }

      // Free-Roam Cash Stash auto-pickup (within 2.6m)
      for (const stash of this.world.cashStashes) {
        if (this.save.collectedStashIds.includes(stash.id)) continue;
        const dx = this.physState.x - stash.x;
        const dz = this.physState.z - stash.z;
        if (dx * dx + dz * dz <= 6.8) {
          const stashRes = collectCashStash(this.save, stash);
          if (stashRes.ok) {
            this.audio.playCashChime();
            this.refreshVrUi();
            persistSavedState(this.save);
            this.shell.showToast(stashRes.reason);
            this.checkTutorialStep('accept_gig');
          }
        }
      }

      // Free-Roam Radar Speed Traps
      for (const trap of this.world.speedTraps) {
        if (trap.cooldownSec > 0) continue;
        const dx = this.physState.x - trap.x;
        const dz = this.physState.z - trap.z;
        if (dx * dx + dz * dz <= trap.radius * trap.radius) {
          const trapRes = triggerSpeedTrap(this.save, trap, speedKmh);
          if (trapRes.paid && trapRes.reason) {
            this.audio.playCashChime();
            this.refreshVrUi();
            persistSavedState(this.save);
            this.shell.showToast(trapRes.reason);
            this.checkTutorialStep('accept_gig');
          }
        }
      }

      // Ramp Big Air Stunt Cash Bonus
      if (stepRes.landedAirTimeSec >= 0.42) {
        const reward = Math.min(60, Math.round(stepRes.landedAirTimeSec * 32));
        const bonusRes = awardRidingBonus(
          this.save,
          'air',
          reward,
          `${stepRes.landedAirTimeSec.toFixed(2)}s air`
        );
        this.audio.playCashChime();
        this.refreshVrUi();
        persistSavedState(this.save);
        this.shell.showToast(bonusRes.reason);
        this.checkTutorialStep('accept_gig');
      }

      // Corner Carving Streak Bonus
      if (!this.physState.airborne && Math.abs(this.physState.leanAngle) > 0.24 && speedKmh > 30) {
        this.carveAccumSec += dt;
        if (this.carveAccumSec >= 1.6 && this.carveCooldownSec <= 0) {
          this.carveAccumSec = 0;
          this.carveCooldownSec = 10;
          const reward = Math.min(35, 12 + Math.round(speedKmh / 10));
          const bonusRes = awardRidingBonus(
            this.save,
            'carve',
            reward,
            `${Math.round(speedKmh)} km/h lean`
          );
          this.audio.playCashChime();
          this.refreshVrUi();
          persistSavedState(this.save);
          this.shell.showToast(bonusRes.reason);
        }
      } else {
        this.carveAccumSec = Math.max(0, this.carveAccumSec - dt * 1.5);
      }

      const missionRes = updateActiveMission(
        this.save,
        this.physState.x,
        this.physState.z,
        speedKmh,
        dt
      );
      if (missionRes.status === 'completed') {
        this.audio.playCashChime();
        this.refreshVrUi();
        persistSavedState(this.save);
        if (missionRes.message) this.shell.showToast(missionRes.message);
      } else if (missionRes.status === 'failed') {
        if (missionRes.message) this.shell.showToast(missionRes.message);
        persistSavedState(this.save);
      } else if (missionRes.message) {
        this.shell.showToast(missionRes.message);
      }

      this.audio.updateEngine(
        this.physState.rpm,
        this.physState.throttle,
        stats.exhaustStyle,
        this.physState.misfiring,
        true
      );
    } else {
      this.audio.updateEngine(1500, 0, stats.exhaustStyle, false, false);
    }

    // Update 3D moped rig and world beacons
    this.mopedRig.updateVisuals(this.physState, dt);

    const activeMissionDef = this.save.activeMission
      ? MISSIONS_CATALOG.find((m) => m.id === this.save.activeMission?.missionId) ?? null
      : null;
    const activeWp =
      activeMissionDef && this.save.activeMission
        ? activeMissionDef.waypoints[this.save.activeMission.waypointIndex] ?? null
        : null;

    this.world.updateWorld(
      this.elapsedSec,
      this.physState.x,
      this.physState.z,
      activeWp,
      this.save.collectedStashIds
    );

    // Camera or VR PlayerRig synchronization
    if (this.inVr) {
      this.playerRig.position.set(
        this.physState.x,
        this.physState.y - 0.36,
        this.physState.z
      );
      this.playerRig.rotation.y = this.physState.heading;
      this.vrUi.updateDashReadout(
        Math.abs(this.physState.speedMs) * 3.6,
        this.physState.rpm,
        activeMoped.condition
      );
    } else {
      this.playerRig.position.set(0, 0, 0);
      this.playerRig.rotation.set(0, 0, 0);
      this.updateDesktopCamera(dt);
    }

    // Update 2D HUD telemetry cleanly
    this.hudSyncTimer += dt;
    if (this.phase === 'playing' && this.hudSyncTimer >= 0.04) {
      this.hudSyncTimer = 0;
      let missionText: string | null = null;
      let missionMeta: string | null = null;
      if (activeMissionDef && this.save.activeMission && activeWp) {
        const dxWp = activeWp.x - this.physState.x;
        const dzWp = activeWp.z - this.physState.z;
        const dist = Math.round(Math.hypot(dxWp, dzWp));
        const forwardX = -Math.sin(this.physState.heading);
        const forwardZ = -Math.cos(this.physState.heading);
        const rightX = Math.cos(this.physState.heading);
        const rightZ = -Math.sin(this.physState.heading);
        const fwdDot = (dxWp * forwardX + dzWp * forwardZ) / Math.max(1, dist);
        const rightDot = (dxWp * rightX + dzWp * rightZ) / Math.max(1, dist);
        const dirHint =
          fwdDot > 0.72
            ? 'Ahead'
            : fwdDot < -0.72
              ? 'Behind'
              : rightDot > 0
                ? 'Right →'
                : '← Left';
        missionText = `${activeMissionDef.title} — ${activeWp.label}`;
        const timePart = activeMissionDef.timeLimitSec
          ? `${Math.max(0, Math.ceil(activeMissionDef.timeLimitSec - this.save.activeMission.elapsedSec))}s left`
          : 'No timer';
        const extra =
          activeMissionDef.type === 'scavenge_run'
            ? `Parts: ${this.save.activeMission.collectedCount}/${activeMissionDef.requiredPartsCount ?? 2}`
            : activeMissionDef.type === 'speed_trap'
              ? `Target: ${activeMissionDef.targetSpeedKmh ?? 68} km/h`
              : `${dist}m (${dirHint})`;
        missionMeta = `${extra} · ${timePart} · Reward $${activeMissionDef.rewardCash}`;
      }

      const nearNode = this.getNearestScavengeNode();
      let contextPrompt: { key: string; label: string } | null = null;
      if (nearNode) {
        contextPrompt =
          nearNode.node.cooldownSec > 0
            ? { key: 'E', label: `${nearNode.node.label} (Wait ${Math.ceil(nearNode.node.cooldownSec)}s)` }
            : { key: 'E', label: `Scavenge ${nearNode.node.label}` };
      } else if (this.isNearGaragePc() && !this.shell.isPcOpen()) {
        contextPrompt = { key: 'E', label: 'Open Garage PC (Shop, Tuning & Gigs)' };
      }

      this.shell.updateHud({
        speedKmh: Math.abs(this.physState.speedMs) * 3.6,
        rpm: this.physState.rpm,
        redlineRpm: stats.redlineRpm,
        missionText,
        missionMeta,
        contextPrompt,
        dt,
      });
    }
  }

  private updateDesktopCamera(dt: number): void {
    const cam = xb.core.camera;
    const h = this.physState.heading;
    const forwardX = -Math.sin(h);
    const forwardZ = -Math.cos(h);

    if (this.phase === 'title') {
      // Hero garage showcase framing: bike in center-right, leaving left clear for Title SVG
      const angle = 0.58 + Math.sin(this.elapsedSec * 0.25) * 0.14;
      this.desiredCamPos.set(
        this.physState.x + Math.sin(angle) * 2.75,
        this.physState.y + 1.38,
        this.physState.z + Math.cos(angle) * 2.75
      );
      this.desiredCamLook.set(this.physState.x - 0.55, this.physState.y + 0.72, this.physState.z - 0.15);
      if (cam.fov !== 52) {
        cam.fov = 52;
        cam.updateProjectionMatrix();
      }
      this.camPos.lerp(this.desiredCamPos, Math.min(1, dt * 6));
      this.camLook.lerp(this.desiredCamLook, Math.min(1, dt * 6));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      return;
    }

    if (this.cameraMode === 'saddle') {
      this.mopedRig.riderEyeAnchor.getWorldPosition(this.tmpVec);
      this.desiredCamPos.copy(this.tmpVec);
      this.desiredCamLook.set(
        this.tmpVec.x + forwardX * 14,
        this.tmpVec.y - 0.62,
        this.tmpVec.z + forwardZ * 14
      );
      if (cam.fov !== 72) {
        cam.fov = 72;
        cam.updateProjectionMatrix();
      }
      this.camPos.lerp(this.desiredCamPos, Math.min(1, dt * 18));
      this.camLook.lerp(this.desiredCamLook, Math.min(1, dt * 18));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      return;
    }

    if (this.cameraMode === 'orbit') {
      const orbitAngle = this.elapsedSec * 0.42;
      this.desiredCamPos.set(
        this.physState.x + Math.sin(orbitAngle) * 3.1,
        this.physState.y + 1.55,
        this.physState.z + Math.cos(orbitAngle) * 3.1
      );
      this.desiredCamLook.set(this.physState.x, this.physState.y + 0.75, this.physState.z);
      if (cam.fov !== 58) {
        cam.fov = 58;
        cam.updateProjectionMatrix();
      }
      this.camPos.lerp(this.desiredCamPos, Math.min(1, dt * 7));
      this.camLook.lerp(this.desiredCamLook, Math.min(1, dt * 7));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      return;
    }

    // Default dynamic third-person Chase camera
    const speedFrac = Math.min(1, Math.abs(this.physState.speedMs) / 22);
    const chaseDist = 3.25 + speedFrac * 0.75;
    const chaseHeight = 1.62 + speedFrac * 0.18;
    this.desiredCamPos.set(
      this.physState.x - forwardX * chaseDist,
      this.physState.y + chaseHeight,
      this.physState.z - forwardZ * chaseDist
    );
    this.desiredCamLook.set(
      this.physState.x + forwardX * 4.5,
      this.physState.y + 0.85,
      this.physState.z + forwardZ * 4.5
    );
    const targetFov = 60 + speedFrac * 10;
    if (Math.abs(cam.fov - targetFov) > 0.25) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    }

    const smooth = Math.min(1, dt * 9.5);
    this.camPos.lerp(this.desiredCamPos, smooth);
    this.camLook.lerp(this.desiredCamLook, smooth);
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }

  public dispose(): void {
    this.softwareLoopRunning = false;
    window.removeEventListener('keydown', this.handleWindowKeyDown);
    window.removeEventListener('keyup', this.handleWindowKeyUp);
    window.removeEventListener('blur', this.clearHeldInputs);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    // Restore xrSystemsGroup & camera cleanly to scene if disposed
    xb.core.scene.add(xb.core.camera, xb.core.xrSystemsGroup);
    xb.core.scene.remove(this.playerRig);

    this.mopedRig?.dispose();
    this.world?.dispose();
    this.textures?.dispose();
    this.audio?.dispose();
    this.shell?.dispose();
    this.envRenderTarget?.dispose();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const options = new xb.Options();
  options.antialias = !detectSoftwareGl();
  options.enableVR();
  options.enableControllers();
  options.enableHands();
  options.enableSimulator = false;
  options.xrButton.enabled = false;
  options.reticles.enabled = true;
  options.controllers.visualizeRays = true;
  options.setAppTitle('Moped Master');
  options.setAppDescription('Realistic 3D & VR vintage moped driving, repair, and tuning simulator.');

  xb.add(new MopedMasterApp());
  void xb.init(options);
});
