import {
  MISSIONS_CATALOG,
  MOPED_MODELS,
  MOPED_MODELS_BY_ID,
  PAINT_FINISHES,
  PART_CATEGORY_LABELS,
  PARTS_BY_ID,
  PARTS_CATALOG,
  SPARE_ITEMS,
  TECHNICAL_ISSUES,
} from '../constants';
import {
  buyMoped,
  buyPart,
  buySpareItem,
  cancelMission,
  completeCustomerOrder,
  equipPart,
  getActiveMoped,
  repairIssueWithCash,
  repairIssueWithItem,
  selectActiveMoped,
  sellScrapMetal,
  setMopedPaint,
  startMission,
  tuneUpMopedCondition,
} from '../game/economy';
import { getActiveTutorialStep, skipTutorial } from '../game/tutorial';
import { computeMopedStats } from '../sim/mopedPhysics';
import type {
  GamePhase,
  PartCategory,
  PlayerSaveState,
  SpareItemId,
} from '../types';

export type PcTab = 'garage' | 'shop' | 'dealer' | 'missions';

export interface ShellCallbacks {
  onStartGame: () => void;
  onPauseGame: () => void;
  onResumeGame: () => void;
  onReturnToTitle: () => void;
  onTeleportGarage: () => void;
  onToggleCamera: () => void;
  onToggleMute: () => boolean;
  onToggleVr: () => void;
  onContextAction: () => void;
  onPcOpenChanged: (open: boolean) => void;
  onPcBrowsed: () => void;
  onMissionAccepted: () => void;
  onStateMutated: (sound: 'wrench' | 'cash' | 'none', toast?: string) => void;
}

export class GameShell {
  private readonly root: HTMLDivElement;
  private readonly titleOverlay: HTMLDivElement;
  private readonly hudOverlay: HTMLDivElement;
  private readonly pcModal: HTMLDivElement;
  private readonly pauseModal: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;

  private readonly startBtn: HTMLButtonElement;
  private readonly titleVrBtn: HTMLButtonElement;
  private readonly hudVrBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly camBtn: HTMLButtonElement;

  // High-frequency HUD refs
  private readonly cashValEl: HTMLElement;
  private readonly condValEl: HTMLElement;
  private readonly bikeNameEl: HTMLElement;
  private readonly missionCardEl: HTMLElement;
  private readonly missionTitleEl: HTMLElement;
  private readonly missionMetaEl: HTMLElement;
  private readonly issueAlertEl: HTMLElement;
  private readonly speedNumEl: HTMLElement;
  private readonly rpmTextEl: HTMLElement;
  private readonly rpmFillEl: HTMLElement;
  private readonly condBarTextEl: HTMLElement;
  private readonly condFillEl: HTMLElement;
  private readonly gaugeArcEl: SVGPathElement;
  private readonly contextPromptEl: HTMLButtonElement;
  private readonly contextKeyEl: HTMLElement;
  private readonly contextTextEl: HTMLElement;
  private readonly tutorialCardEl: HTMLElement;
  private readonly tutorialBadgeEl: HTMLElement;
  private readonly tutorialRewardEl: HTMLElement;
  private readonly tutorialTitleEl: HTMLElement;
  private readonly tutorialHintEl: HTMLElement;
  private readonly tutorialSkipBtn: HTMLButtonElement;

  // PC modal refs
  private readonly pcBodyEl: HTMLElement;
  private readonly pcWalletEl: HTMLElement;
  private readonly pcTabButtons: Map<PcTab, HTMLButtonElement> = new Map();

  // Pause modal refs
  private readonly pauseCashEl: HTMLElement;
  private readonly pauseOdoEl: HTMLElement;
  private readonly pauseGigsEl: HTMLElement;

  private activeTab: PcTab = 'garage';
  private pcOpen = false;
  private toastTimer = 0;

  constructor(
    private readonly save: PlayerSaveState,
    private readonly callbacks: ShellCallbacks
  ) {
    this.root = document.createElement('div');
    this.root.className = 'mm-shell';
    this.root.innerHTML = this.buildTemplate();
    document.body.appendChild(this.root);

    this.titleOverlay = this.q('[data-role="title-overlay"]');
    this.hudOverlay = this.q('[data-role="hud-overlay"]');
    this.pcModal = this.q('[data-role="pc-modal"]');
    this.pauseModal = this.q('[data-role="pause-modal"]');
    this.toastEl = this.q('[data-role="toast"]');

    this.startBtn = this.q('[data-start="true"]');
    this.titleVrBtn = this.q('[data-role="title-vr-btn"]');
    this.hudVrBtn = this.q('[data-role="hud-vr-btn"]');
    this.muteBtn = this.q('[data-role="mute-btn"]');
    this.camBtn = this.q('[data-role="cam-btn"]');

    this.cashValEl = this.q('[data-role="hud-cash"]');
    this.condValEl = this.q('[data-role="hud-cond"]');
    this.bikeNameEl = this.q('[data-role="hud-bike"]');
    this.missionCardEl = this.q('[data-role="hud-mission-card"]');
    this.missionTitleEl = this.q('[data-role="hud-mission-title"]');
    this.missionMetaEl = this.q('[data-role="hud-mission-meta"]');
    this.issueAlertEl = this.q('[data-role="hud-issue-alert"]');
    this.speedNumEl = this.q('[data-role="hud-speed"]');
    this.rpmTextEl = this.q('[data-role="hud-rpm-text"]');
    this.rpmFillEl = this.q('[data-role="hud-rpm-fill"]');
    this.condBarTextEl = this.q('[data-role="hud-cond-text"]');
    this.condFillEl = this.q('[data-role="hud-cond-fill"]');
    this.gaugeArcEl = this.q('[data-role="gauge-arc"]');
    this.contextPromptEl = this.q('[data-role="context-prompt"]');
    this.contextKeyEl = this.q('[data-role="context-key"]');
    this.contextTextEl = this.q('[data-role="context-text"]');
    this.tutorialCardEl = this.q('[data-role="tutorial-card"]');
    this.tutorialBadgeEl = this.q('[data-role="tutorial-badge"]');
    this.tutorialRewardEl = this.q('[data-role="tutorial-reward"]');
    this.tutorialTitleEl = this.q('[data-role="tutorial-title"]');
    this.tutorialHintEl = this.q('[data-role="tutorial-hint"]');
    this.tutorialSkipBtn = this.q('[data-role="tutorial-skip"]');

    this.pcBodyEl = this.q('[data-role="pc-body"]');
    this.pcWalletEl = this.q('[data-role="pc-wallet"]');

    this.pauseCashEl = this.q('[data-role="pause-cash"]');
    this.pauseOdoEl = this.q('[data-role="pause-odo"]');
    this.pauseGigsEl = this.q('[data-role="pause-gigs"]');

    (['garage', 'shop', 'dealer', 'missions'] as PcTab[]).forEach((tab) => {
      const btn = this.q<HTMLButtonElement>(`[data-pc-tab="${tab}"]`);
      this.pcTabButtons.set(tab, btn);
      btn.addEventListener('click', () => {
        this.activeTab = tab;
        this.callbacks.onPcBrowsed();
        this.renderPcBody();
      });
    });

    this.bindEvents();
  }

  private q<T extends Element = HTMLElement>(selector: string): T {
    const el = this.root.querySelector(selector);
    if (!el) throw new Error(`Missing UI element: ${selector}`);
    return el as T;
  }

  private bindEvents(): void {
    this.startBtn.addEventListener('click', () => {
      this.startBtn.blur();
      this.callbacks.onStartGame();
    });

    this.titleVrBtn.addEventListener('click', () => {
      this.titleVrBtn.blur();
      this.callbacks.onToggleVr();
    });
    this.hudVrBtn.addEventListener('click', () => {
      this.hudVrBtn.blur();
      this.callbacks.onToggleVr();
    });

    this.q('[data-role="pc-btn"]').addEventListener('click', (e) => {
      (e.currentTarget as HTMLButtonElement).blur();
      this.openPc('garage');
    });
    this.q('[data-role="pc-close"]').addEventListener('click', () => {
      this.closePc();
    });

    this.camBtn.addEventListener('click', () => {
      this.camBtn.blur();
      this.callbacks.onToggleCamera();
    });

    this.muteBtn.addEventListener('click', () => {
      this.muteBtn.blur();
      const muted = this.callbacks.onToggleMute();
      this.muteBtn.classList.toggle('mm-active', muted);
      this.muteBtn.textContent = muted ? 'Muted [M]' : 'Audio [M]';
    });

    this.q('[data-role="pause-btn"]').addEventListener('click', (e) => {
      (e.currentTarget as HTMLButtonElement).blur();
      this.callbacks.onPauseGame();
    });

    this.contextPromptEl.addEventListener('click', () => {
      this.contextPromptEl.blur();
      this.callbacks.onContextAction();
    });

    this.q('[data-role="resume-btn"]').addEventListener('click', () => {
      this.callbacks.onResumeGame();
    });
    this.q('[data-role="garage-reset-btn"]').addEventListener('click', () => {
      this.callbacks.onTeleportGarage();
      this.callbacks.onResumeGame();
    });
    this.q('[data-role="title-return-btn"]').addEventListener('click', () => {
      this.callbacks.onReturnToTitle();
    });

    this.tutorialSkipBtn.addEventListener('click', () => {
      this.tutorialSkipBtn.blur();
      skipTutorial(this.save);
      this.callbacks.onStateMutated('none', 'Tutorial skipped. Ride free!');
    });
  }

  public setPhase(phase: GamePhase): void {
    document.body.dataset.state = phase;
    this.titleOverlay.classList.toggle('mm-hidden', phase !== 'title');
    this.hudOverlay.classList.toggle('mm-hidden', phase !== 'playing');
    this.pauseModal.classList.toggle('mm-hidden', phase !== 'paused');

    if (phase !== 'playing' && this.pcOpen) {
      this.closePc();
    }

    if (phase === 'paused') {
      const moped = getActiveMoped(this.save);
      this.pauseCashEl.textContent = `$${this.save.cash}`;
      this.pauseOdoEl.textContent = `${moped.odometerKm.toFixed(1)} km`;
      this.pauseGigsEl.textContent = `${this.save.totalDeliveries}`;
    }
  }

  public setVrSupported(supported: boolean, active: boolean): void {
    this.titleVrBtn.disabled = !supported;
    this.titleVrBtn.textContent = supported
      ? active
        ? 'Exit VR'
        : 'Enter VR Headset'
      : 'VR Ready (No Headset)';
    this.hudVrBtn.classList.toggle('mm-hidden', !supported);
    this.hudVrBtn.textContent = active ? 'Exit VR' : 'VR';
    this.hudVrBtn.classList.toggle('mm-active', active);
  }

  public isPcOpen(): boolean {
    return this.pcOpen;
  }

  public openPc(tab: PcTab = this.activeTab): void {
    this.activeTab = tab;
    this.pcOpen = true;
    this.pcModal.classList.remove('mm-hidden');
    this.callbacks.onPcOpenChanged(true);
    this.renderPcBody();
  }

  public closePc(): void {
    if (!this.pcOpen) return;
    this.pcOpen = false;
    this.pcModal.classList.add('mm-hidden');
    this.callbacks.onPcOpenChanged(false);
  }

  public showToast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('mm-hidden');
    this.toastTimer = 3.2;
  }

  public setCameraLabel(label: string): void {
    this.camBtn.textContent = `Cam: ${label} [C]`;
  }

  public updateHud(params: {
    speedKmh: number;
    rpm: number;
    redlineRpm: number;
    missionText: string | null;
    missionMeta: string | null;
    contextPrompt: { key: string; label: string } | null;
    dt: number;
  }): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= params.dt;
      if (this.toastTimer <= 0) {
        this.toastEl.classList.add('mm-hidden');
      }
    }

    const moped = getActiveMoped(this.save);
    const model = MOPED_MODELS_BY_ID[moped.modelId];

    this.cashValEl.textContent = `$${this.save.cash}`;
    this.condValEl.textContent = `${Math.round(moped.condition)}%`;
    this.bikeNameEl.textContent = model.name;

    if (params.missionText) {
      this.missionCardEl.classList.remove('mm-hidden');
      this.missionTitleEl.textContent = params.missionText;
      this.missionMetaEl.textContent = params.missionMeta ?? '';
    } else {
      this.missionCardEl.classList.add('mm-hidden');
    }

    if (moped.activeIssues.length > 0) {
      this.issueAlertEl.classList.remove('mm-hidden');
      const names = moped.activeIssues.map((id) => TECHNICAL_ISSUES[id].name).join(' · ');
      this.issueAlertEl.textContent = `ISSUE: ${names} — Scavenge parts or open Garage PC`;
    } else {
      this.issueAlertEl.classList.add('mm-hidden');
    }

    const spd = Math.round(Math.abs(params.speedKmh));
    this.speedNumEl.textContent = String(spd);
    const rpmInt = Math.round(params.rpm);
    this.rpmTextEl.textContent = `${rpmInt} RPM`;

    const rpmFrac = Math.max(0.05, Math.min(1, params.rpm / params.redlineRpm));
    this.rpmFillEl.style.transform = `scaleX(${rpmFrac.toFixed(3)})`;
    this.rpmFillEl.style.backgroundColor = rpmFrac > 0.88 ? '#e64833' : '#f5a623';

    const condFrac = Math.max(0.02, Math.min(1, moped.condition / 100));
    this.condBarTextEl.textContent = `${Math.round(moped.condition)}%`;
    this.condFillEl.style.transform = `scaleX(${condFrac.toFixed(3)})`;
    this.condFillEl.style.backgroundColor =
      moped.condition > 65 ? '#2ec4b6' : moped.condition > 40 ? '#f5a623' : '#e64833';

    // Arc stroke-dashoffset (arc total length ~188)
    const speedFrac = Math.min(1, spd / 95);
    this.gaugeArcEl.style.strokeDashoffset = String(188 - speedFrac * 188);

    if (params.contextPrompt) {
      this.contextPromptEl.classList.remove('mm-hidden');
      this.contextKeyEl.textContent = params.contextPrompt.key;
      this.contextTextEl.textContent = params.contextPrompt.label;
    } else {
      this.contextPromptEl.classList.add('mm-hidden');
    }

    const tutStep = getActiveTutorialStep(this.save);
    if (tutStep) {
      this.tutorialCardEl.classList.remove('mm-hidden');
      this.tutorialBadgeEl.textContent = `TUTORIAL ${tutStep.stepNumber}/${tutStep.totalSteps}`;
      this.tutorialRewardEl.textContent = `+$${tutStep.rewardCash}`;
      this.tutorialTitleEl.textContent = tutStep.title;
      this.tutorialHintEl.textContent = tutStep.hint;
    } else {
      this.tutorialCardEl.classList.add('mm-hidden');
    }
  }

  private renderPcBody(): void {
    this.pcTabButtons.forEach((btn, key) => {
      btn.setAttribute('aria-selected', String(key === this.activeTab));
    });

    const moped = getActiveMoped(this.save);
    const model = MOPED_MODELS_BY_ID[moped.modelId];
    const stats = computeMopedStats(moped);

    this.pcWalletEl.textContent = `CASH: $${this.save.cash}  |  ACTIVE: ${model.name} (${Math.round(moped.condition)}%)`;

    if (this.activeTab === 'garage') {
      this.renderGarageTab(moped, model.name, stats);
    } else if (this.activeTab === 'shop') {
      this.renderShopTab(moped);
    } else if (this.activeTab === 'dealer') {
      this.renderDealerTab();
    } else {
      this.renderMissionsTab();
    }
  }

  private renderGarageTab(
    moped: ReturnType<typeof getActiveMoped>,
    modelName: string,
    stats: ReturnType<typeof computeMopedStats>
  ): void {
    const ownedMopedButtons = this.save.ownedMopeds
      .map((m, idx) => {
        const def = MOPED_MODELS_BY_ID[m.modelId];
        const active = idx === this.save.activeMopedIndex;
        return `<button type="button" class="mm-btn-sm ${active ? 'mm-buy' : ''}" data-select-moped="${idx}">${def.name} (${Math.round(m.condition)}%)</button>`;
      })
      .join('');

    const swatches = PAINT_FINISHES.map(
      (f) =>
        `<button type="button" aria-label="Paint ${f.name}" title="${f.name}" class="mm-swatch ${moped.paintColor === f.hex ? 'mm-selected' : ''}" style="background:${f.hex}" data-paint="${f.hex}"></button>`
    ).join('');

    const issuesHtml =
      moped.activeIssues.length === 0
        ? `<p class="mm-card-desc" style="color:#8bf0e6;">No technical faults. Two-stroke running clean.</p>`
        : moped.activeIssues
            .map((id) => {
              const def = TECHNICAL_ISSUES[id];
              const spareCount = this.save.spareInventory[def.repairItem] ?? 0;
              const spareName = SPARE_ITEMS[def.repairItem].name;
              return `
                <div style="border:1px solid rgba(230,72,51,0.45);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:6px;">
                  <strong style="color:#ff9b8f;font-size:13px;">${def.name}</strong>
                  <span class="mm-card-desc">${def.symptom}</span>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" class="mm-btn-sm mm-buy" ${spareCount <= 0 ? 'disabled' : ''} data-fix-spare="${id}">
                      Fix w/ ${spareName} (${spareCount})
                    </button>
                    <button type="button" class="mm-btn-sm" ${this.save.cash < def.shopRepairCost ? 'disabled' : ''} data-fix-cash="${id}">
                      Shop Fix ($${def.shopRepairCost})
                    </button>
                  </div>
                </div>
              `;
            })
            .join('');

    const partsSlotsHtml = (Object.keys(PART_CATEGORY_LABELS) as PartCategory[])
      .map((cat) => {
        const equippedId = moped.installedParts[cat];
        const equipped = PARTS_BY_ID[equippedId];
        const ownedInCat = PARTS_CATALOG.filter(
          (p) => p.category === cat && this.save.ownedPartIds.includes(p.id)
        );
        const swapButtons = ownedInCat
          .map((p) => {
            const isEquipped = p.id === equippedId;
            return `<button type="button" class="mm-btn-sm ${isEquipped ? 'mm-buy' : ''}" ${isEquipped ? 'disabled' : ''} data-equip-part="${p.id}">${isEquipped ? 'Equipped: ' : 'Fit: '}${p.name}</button>`;
          })
          .join('');
        return `
          <div class="mm-card">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <h4 class="mm-card-title">${PART_CATEGORY_LABELS[cat]}</h4>
              <span style="font-size:11px;color:#ffc857;">Tier ${equipped?.tier ?? 1}</span>
            </div>
            <p class="mm-card-desc">${equipped?.name ?? ''} — ${equipped?.description ?? ''}</p>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">${swapButtons}</div>
          </div>
        `;
      })
      .join('');

    const spareListHtml = (Object.keys(SPARE_ITEMS) as SpareItemId[])
      .map((id) => {
        const count = this.save.spareInventory[id] ?? 0;
        return `<div class="mm-spec-row"><span>${SPARE_ITEMS[id].name}</span><span>x${count}</span></div>`;
      })
      .join('');

    const customerOrdersHtml = (this.save.repairOrders ?? [])
      .slice(0, 3)
      .map((order) => {
        const spare = SPARE_ITEMS[order.neededItem];
        const qty = this.save.spareInventory[order.neededItem] ?? 0;
        return `
          <div style="border:1px solid rgba(46,196,182,0.3);border-radius:8px;padding:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
            <div>
              <strong style="font-size:13px;color:#f3efe6;">${order.customerName} — ${order.mopedName}</strong>
              <div class="mm-card-desc">${order.issueTitle} · Needs: ${spare.name} (Have x${qty})</div>
            </div>
            <button type="button" class="mm-btn-sm mm-buy" ${qty <= 0 ? 'disabled' : ''} data-repair-order="${order.id}">
              Complete (+$${order.rewardCash})
            </button>
          </div>
        `;
      })
      .join('');

    this.pcBodyEl.innerHTML = `
      <div class="mm-grid-2">
        <div class="mm-card">
          <h3 class="mm-card-title">${modelName} — Spec Sheet</h3>
          <div class="mm-spec-row"><span>Displacement</span><span>${stats.displacementCc} cc (2-Stroke)</span></div>
          <div class="mm-spec-row"><span>Peak Power</span><span>${stats.peakPowerKw.toFixed(1)} kW</span></div>
          <div class="mm-spec-row"><span>Est. Top Speed</span><span>${Math.round(stats.topSpeedKmh)} km/h</span></div>
          <div class="mm-spec-row"><span>Redline</span><span>${stats.redlineRpm} RPM</span></div>
          <div class="mm-spec-row"><span>Odometer</span><span>${moped.odometerKm.toFixed(2)} km</span></div>
          <div class="mm-spec-row"><span>Dry Weight</span><span>${Math.round(stats.totalMassKg)} kg</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">${ownedMopedButtons}</div>
          <div style="margin-top:6px;">
            <div class="mm-kicker" style="margin-bottom:6px;">Paint Finish</div>
            <div class="mm-swatch-row">${swatches}</div>
          </div>
        </div>
        <div class="mm-card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h3 class="mm-card-title">Diagnostics & Spare Bag</h3>
            <button type="button" class="mm-btn-sm" ${moped.condition >= 99 || this.save.cash < 35 ? 'disabled' : ''} data-tune-up="1">Tune-Up ($35)</button>
          </div>
          ${issuesHtml}
          <div style="margin-top:6px;">
            <div class="mm-kicker" style="margin-bottom:4px;">Scavenged & Spare Parts</div>
            ${spareListHtml}
          </div>
          <button type="button" class="mm-btn-sm" ${(this.save.spareInventory.scrap_metal ?? 0) <= 0 ? 'disabled' : ''} data-sell-scrap="1">
            Sell Alloy Scrap ($${(this.save.spareInventory.scrap_metal ?? 0) * SPARE_ITEMS.scrap_metal.sellValue})
          </button>
        </div>
      </div>
      <div class="mm-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h3 class="mm-card-title">Customer Repair Side Hustles</h3>
          <span class="mm-kicker">Turn scavenged spares into $85–$150 cash</span>
        </div>
        ${customerOrdersHtml}
      </div>
      <div class="mm-grid-2">${partsSlotsHtml}</div>
    `;

    this.pcBodyEl.querySelectorAll('[data-select-moped]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number((el as HTMLElement).dataset.selectMoped);
        selectActiveMoped(this.save, idx);
        this.renderPcBody();
        this.callbacks.onStateMutated('wrench', 'Switched active moped.');
      });
    });

    this.pcBodyEl.querySelectorAll('[data-paint]').forEach((el) => {
      el.addEventListener('click', () => {
        const hex = (el as HTMLElement).dataset.paint!;
        setMopedPaint(this.save, hex);
        this.callbacks.onPcBrowsed();
        this.renderPcBody();
        this.callbacks.onStateMutated('none');
      });
    });

    this.pcBodyEl.querySelectorAll('[data-equip-part]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.equipPart!;
        const res = equipPart(this.save, id);
        this.renderPcBody();
        this.callbacks.onStateMutated(res.ok ? 'wrench' : 'none', res.reason);
      });
    });

    this.pcBodyEl.querySelectorAll('[data-fix-spare]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.fixSpare as keyof typeof TECHNICAL_ISSUES;
        const res = repairIssueWithItem(this.save, id);
        this.renderPcBody();
        this.callbacks.onStateMutated(res.ok ? 'wrench' : 'none', res.reason);
      });
    });

    this.pcBodyEl.querySelectorAll('[data-fix-cash]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.fixCash as keyof typeof TECHNICAL_ISSUES;
        const res = repairIssueWithCash(this.save, id);
        this.renderPcBody();
        this.callbacks.onStateMutated(res.ok ? 'wrench' : 'none', res.reason);
      });
    });

    this.pcBodyEl.querySelector('[data-tune-up]')?.addEventListener('click', () => {
      const res = tuneUpMopedCondition(this.save);
      this.renderPcBody();
      this.callbacks.onStateMutated(res.ok ? 'wrench' : 'none', res.reason);
    });

    this.pcBodyEl.querySelector('[data-sell-scrap]')?.addEventListener('click', () => {
      const { sold, earned } = sellScrapMetal(this.save);
      this.renderPcBody();
      if (sold > 0) {
        this.callbacks.onStateMutated('cash', `Sold ${sold} scrap for $${earned}!`);
      }
    });

    this.pcBodyEl.querySelectorAll('[data-repair-order]').forEach((el) => {
      el.addEventListener('click', () => {
        const orderId = (el as HTMLElement).dataset.repairOrder!;
        const res = completeCustomerOrder(this.save, orderId);
        this.renderPcBody();
        this.callbacks.onStateMutated(res.ok ? 'cash' : 'none', res.reason);
      });
    });
  }

  private renderShopTab(moped: ReturnType<typeof getActiveMoped>): void {
    const upgradeCards = PARTS_CATALOG.filter((p) => p.price > 0)
      .map((part) => {
        const owned = this.save.ownedPartIds.includes(part.id);
        const equipped = moped.installedParts[part.category] === part.id;
        const canAfford = this.save.cash >= part.price;
        return `
          <div class="mm-card">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <h4 class="mm-card-title">${part.name}</h4>
              <span style="font-family:JetBrains Mono,monospace;color:#ffc857;">$${part.price}</span>
            </div>
            <span class="mm-kicker">${PART_CATEGORY_LABELS[part.category]} · Tier ${part.tier}</span>
            <p class="mm-card-desc">${part.description}</p>
            <div class="mm-spec-row">
              <span>+${Math.round(part.powerGain * 100)}% Power · +${part.topSpeedBonusKmh} km/h</span>
              <span>+${part.redlineBonusRpm} RPM</span>
            </div>
            <div style="display:flex;gap:8px;">
              ${
                owned
                  ? `<button type="button" class="mm-btn-sm ${equipped ? '' : 'mm-buy'}" ${equipped ? 'disabled' : ''} data-shop-equip="${part.id}">
                      ${equipped ? 'Equipped' : 'Equip Now'}
                    </button>`
                  : `<button type="button" class="mm-btn-sm mm-buy" ${!canAfford ? 'disabled' : ''} data-shop-buy="${part.id}">
                      Buy $${part.price}
                    </button>`
              }
            </div>
          </div>
        `;
      })
      .join('');

    const sparesCards = (Object.keys(SPARE_ITEMS) as SpareItemId[])
      .filter((id) => SPARE_ITEMS[id].price > 0)
      .map((id) => {
        const item = SPARE_ITEMS[id];
        const qty = this.save.spareInventory[id] ?? 0;
        return `
          <div class="mm-card">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <h4 class="mm-card-title">${item.name} (x${qty})</h4>
              <span style="font-family:JetBrains Mono,monospace;color:#ffc857;">$${item.price}</span>
            </div>
            <p class="mm-card-desc">${item.description}</p>
            <button type="button" class="mm-btn-sm" ${this.save.cash < item.price ? 'disabled' : ''} data-buy-spare="${id}">
              Buy Spare ($${item.price})
            </button>
          </div>
        `;
      })
      .join('');

    this.pcBodyEl.innerHTML = `
      <div class="mm-kicker">High-End Performance Components</div>
      <div class="mm-grid-2">${upgradeCards}</div>
      <div class="mm-kicker" style="margin-top:8px;">Field Repair Consumables (Or Scavenge For Free!)</div>
      <div class="mm-grid-2">${sparesCards}</div>
    `;

    this.pcBodyEl.querySelectorAll('[data-shop-buy]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.shopBuy!;
        const res = buyPart(this.save, id);
        if (res.ok) equipPart(this.save, id);
        this.renderPcBody();
        this.callbacks.onStateMutated(res.ok ? 'cash' : 'none', res.ok ? `Bought & fitted ${PARTS_BY_ID[id].name}!` : res.reason);
      });
    });

    this.pcBodyEl.querySelectorAll('[data-shop-equip]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.shopEquip!;
        const res = equipPart(this.save, id);
        this.renderPcBody();
        this.callbacks.onStateMutated(res.ok ? 'wrench' : 'none', res.reason);
      });
    });

    this.pcBodyEl.querySelectorAll('[data-buy-spare]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.buySpare as SpareItemId;
        const res = buySpareItem(this.save, id);
        this.renderPcBody();
        this.callbacks.onStateMutated(res.ok ? 'cash' : 'none', res.reason);
      });
    });
  }

  private renderDealerTab(): void {
    const cards = MOPED_MODELS.map((m) => {
      const ownedIdx = this.save.ownedMopeds.findIndex((o) => o.modelId === m.id);
      const isOwned = ownedIdx !== -1;
      const isActive = ownedIdx === this.save.activeMopedIndex;
      const canAfford = this.save.cash >= m.price;
      return `
        <div class="mm-card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h4 class="mm-card-title">${m.name} (${m.year})</h4>
            <span style="font-family:JetBrains Mono,monospace;color:#ffc857;">${m.price === 0 ? 'FREE STARTER' : `$${m.price}`}</span>
          </div>
          <span class="mm-kicker">${m.origin}</span>
          <p class="mm-card-desc">${m.description}</p>
          <div class="mm-spec-row"><span>Stock Power: ${m.basePowerKw} kW</span><span>Top Speed: ${m.baseTopSpeedKmh} km/h</span></div>
          <div class="mm-spec-row"><span>Redline: ${m.baseRedlineRpm} RPM</span><span>Weight: ${m.baseMassKg} kg</span></div>
          <div>
            ${
              isOwned
                ? `<button type="button" class="mm-btn-sm ${isActive ? '' : 'mm-buy'}" ${isActive ? 'disabled' : ''} data-dealer-select="${ownedIdx}">
                    ${isActive ? 'Active Ride' : 'Ride This Moped'}
                  </button>`
                : `<button type="button" class="mm-btn-sm mm-buy" ${!canAfford ? 'disabled' : ''} data-dealer-buy="${m.id}">
                    Buy Moped ($${m.price})
                  </button>`
            }
          </div>
        </div>
      `;
    }).join('');

    this.pcBodyEl.innerHTML = `<div class="mm-grid-2">${cards}</div>`;

    this.pcBodyEl.querySelectorAll('[data-dealer-select]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number((el as HTMLElement).dataset.dealerSelect);
        selectActiveMoped(this.save, idx);
        this.renderPcBody();
        this.callbacks.onStateMutated('wrench', 'Moved moped onto lift.');
      });
    });

    this.pcBodyEl.querySelectorAll('[data-dealer-buy]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.dealerBuy!;
        const res = buyMoped(this.save, id);
        this.renderPcBody();
        this.callbacks.onStateMutated(res.ok ? 'cash' : 'none', res.reason);
      });
    });
  }

  private renderMissionsTab(): void {
    const cards = MISSIONS_CATALOG.map((mission) => {
      const isActive = this.save.activeMission?.missionId === mission.id;
      const done = this.save.completedMissionIds.includes(mission.id);
      return `
        <div class="mm-card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h4 class="mm-card-title">${mission.title}</h4>
            <span style="font-family:JetBrains Mono,monospace;color:#8bf0e6;">+$${mission.rewardCash}</span>
          </div>
          <span class="mm-kicker">${mission.timeLimitSec ? `Time Limit: ${mission.timeLimitSec}s` : 'Untimed Gig'}${done ? ' · Completed' : ''}</span>
          <p class="mm-card-desc">${mission.description}</p>
          <div>
            ${
              isActive
                ? `<button type="button" class="mm-btn-sm" data-mission-cancel="1">Cancel Active Gig</button>`
                : `<button type="button" class="mm-btn-sm mm-buy" data-mission-start="${mission.id}">Accept Gig</button>`
            }
          </div>
        </div>
      `;
    }).join('');

    this.pcBodyEl.innerHTML = `
      <div class="mm-earn-banner">
        <strong style="color:#ffc857;">MORE WAYS TO EARN CASH:</strong>
        1) <strong>Local Gigs</strong> ($165–$520) ·
        2) <strong>3 Free-Roam Radar Speed Traps</strong> ($55–$125) ·
        3) <strong>4 Jump Ramps &amp; Corner Carves</strong> ($15–$55) ·
        4) <strong>8 Golden Cash Stashes</strong> (${this.save.collectedStashIds.length}/8 found, $75–$140 each) ·
        5) <strong>Customer Repair Orders</strong> in Garage &amp; Tuning!
      </div>
      <div class="mm-grid-2">${cards}</div>
    `;

    this.pcBodyEl.querySelectorAll('[data-mission-start]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.missionStart!;
        const res = startMission(this.save, id);
        this.closePc();
        this.callbacks.onMissionAccepted();
        this.callbacks.onStateMutated('cash', res.reason);
      });
    });

    this.pcBodyEl.querySelector('[data-mission-cancel]')?.addEventListener('click', () => {
      cancelMission(this.save);
      this.renderPcBody();
      this.callbacks.onStateMutated('none', 'Gig cancelled.');
    });
  }

  private buildTemplate(): string {
    return `
      <!-- TITLE SCREEN -->
      <div class="mm-title-overlay" data-role="title-overlay">
        <div class="mm-title-left">
          <svg class="mm-title-svg" viewBox="0 0 500 124" xmlns="http://www.w3.org/2000/svg" aria-label="Moped Master">
            <rect x="2" y="10" width="496" height="104" rx="10" fill="rgba(16,18,22,0.88)" stroke="#f5a623" stroke-width="2.5" />
            <circle cx="58" cy="62" r="34" fill="#1d222b" stroke="#ffc857" stroke-width="2.5" />
            <circle cx="58" cy="62" r="22" fill="none" stroke="#2ec4b6" stroke-width="2" stroke-dasharray="6 4" />
            <path d="M58 38 L58 62 L75 50" fill="none" stroke="#e64833" stroke-width="4" stroke-linecap="round" />
            <text x="108" y="56" fill="#ffc857" font-family="Chakra Petch, sans-serif" font-weight="700" font-size="35" letter-spacing="1.5">MOPED MASTER</text>
            <text x="110" y="82" fill="#d6d0c4" font-family="JetBrains Mono, monospace" font-weight="600" font-size="11.5" letter-spacing="1.4">TWO-STROKE GARAGE &amp; ROAD SIMULATOR</text>
            <rect x="110" y="94" width="356" height="3" fill="#2ec4b6" rx="1.5" />
          </svg>
          <p class="mm-title-sub">
            Start with a mint 49cc classic in your garage. Ride the coastal loop, scavenge roadside parts when wear strikes, run local gigs, and tune high-RPM builds on your Garage PC or in VR.
          </p>
          <div class="mm-title-actions">
            <button type="button" class="mm-btn-primary" data-start="true">Enter Garage</button>
            <button type="button" class="mm-btn-secondary" data-role="title-vr-btn">Enter VR Headset</button>
          </div>
        </div>
        <div class="mm-title-hint">W/S Throttle &amp; Brake · A/D Steer · E Garage PC / Scavenge · C Camera · Esc Pause</div>
      </div>

      <!-- PLAYING HUD -->
      <div class="mm-hud mm-hidden" data-role="hud-overlay">
        <div class="mm-hud-top-left">
          <div class="mm-stat-strip">
            <div class="mm-stat-cell">
              <span class="mm-kicker">CASH</span>
              <span class="mm-hero-num mm-cash" data-role="hud-cash">$180</span>
            </div>
            <div class="mm-stat-cell">
              <span class="mm-kicker" data-role="hud-bike">Veloce 50</span>
              <span class="mm-hero-num" data-role="hud-cond">100%</span>
            </div>
          </div>
          <div class="mm-mission-card mm-hidden" data-role="hud-mission-card">
            <div class="mm-kicker">ACTIVE GIG</div>
            <div class="mm-mission-title" data-role="hud-mission-title"></div>
            <div class="mm-mission-meta" data-role="hud-mission-meta"></div>
          </div>
          <div class="mm-issue-alert mm-hidden" data-role="hud-issue-alert"></div>
        </div>

        <div class="mm-hud-top-right">
          <button type="button" class="mm-icon-btn" data-role="pc-btn" aria-label="Open Garage PC">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>
            PC [E]
          </button>
          <button type="button" class="mm-icon-btn" data-role="cam-btn" aria-label="Toggle Camera">Cam: Chase [C]</button>
          <button type="button" class="mm-icon-btn" data-role="mute-btn" aria-label="Toggle Audio">Audio [M]</button>
          <button type="button" class="mm-icon-btn mm-hidden" data-role="hud-vr-btn" aria-label="Toggle VR">VR</button>
          <button type="button" class="mm-icon-btn" data-role="pause-btn" aria-label="Pause Game">Pause [P]</button>
        </div>

        <div class="mm-hud-bottom-right">
          <div class="mm-gauge-wrap">
            <svg class="mm-gauge-svg" viewBox="0 0 100 100">
              <path d="M 20 80 A 40 40 0 1 1 80 80" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="8" stroke-linecap="round"/>
              <path data-role="gauge-arc" d="M 20 80 A 40 40 0 1 1 80 80" fill="none" stroke="#f5a623" stroke-width="8" stroke-linecap="round" stroke-dasharray="188" stroke-dashoffset="188"/>
            </svg>
            <div class="mm-gauge-center">
              <span class="mm-speed-num" data-role="hud-speed">0</span>
              <span class="mm-speed-unit">KM/H</span>
            </div>
          </div>
          <div class="mm-telemetry-col">
            <div class="mm-meter-row">
              <div class="mm-meter-label"><span>ENGINE</span><span data-role="hud-rpm-text">1500 RPM</span></div>
              <div class="mm-meter-track"><div class="mm-meter-fill" data-role="hud-rpm-fill" style="background:#f5a623;transform:scaleX(0.2)"></div></div>
            </div>
            <div class="mm-meter-row">
              <div class="mm-meter-label"><span>HEALTH</span><span data-role="hud-cond-text">100%</span></div>
              <div class="mm-meter-track"><div class="mm-meter-fill" data-role="hud-cond-fill" style="background:#2ec4b6;transform:scaleX(1)"></div></div>
            </div>
          </div>
        </div>

        <button type="button" class="mm-context-prompt mm-hidden" data-role="context-prompt">
          <span class="mm-keycap" data-role="context-key">E</span>
          <span data-role="context-text">Open Garage PC</span>
        </button>

        <div class="mm-tutorial-card mm-hidden" data-role="tutorial-card">
          <div class="mm-tutorial-top">
            <span class="mm-tutorial-badge" data-role="tutorial-badge">TUTORIAL 1/6</span>
            <span class="mm-tutorial-reward" data-role="tutorial-reward">+$25</span>
            <button type="button" class="mm-tutorial-skip" data-role="tutorial-skip">Skip</button>
          </div>
          <div class="mm-tutorial-title" data-role="tutorial-title"></div>
          <div class="mm-tutorial-hint" data-role="tutorial-hint"></div>
        </div>

        <div class="mm-toast mm-hidden" data-role="toast"></div>
      </div>

      <!-- VIRTUAL PC MODAL -->
      <div class="mm-modal-backdrop mm-hidden" data-role="pc-modal" role="dialog" aria-label="Garage Virtual PC">
        <div class="mm-pc-window">
          <div class="mm-pc-titlebar">
            <div class="mm-pc-brand">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
              MOPED-OS v2.4 // WORKBENCH PC
            </div>
            <div class="mm-pc-wallet">
              <span data-role="pc-wallet">CASH: $180</span>
              <button type="button" class="mm-btn-sm" data-role="pc-close">Close [Esc]</button>
            </div>
          </div>
          <div class="mm-pc-tabs" role="tablist">
            <button type="button" class="mm-pc-tab" role="tab" aria-selected="true" data-pc-tab="garage">Garage &amp; Tuning</button>
            <button type="button" class="mm-pc-tab" role="tab" aria-selected="false" data-pc-tab="shop">Parts Shop</button>
            <button type="button" class="mm-pc-tab" role="tab" aria-selected="false" data-pc-tab="dealer">Dealership</button>
            <button type="button" class="mm-pc-tab" role="tab" aria-selected="false" data-pc-tab="missions">Local Gigs</button>
          </div>
          <div class="mm-pc-body" data-role="pc-body"></div>
        </div>
      </div>

      <!-- PAUSE MODAL -->
      <div class="mm-modal-backdrop mm-hidden" data-role="pause-modal" role="dialog" aria-label="Game Paused">
        <div class="mm-pause-card">
          <h2 class="mm-card-title" style="font-size:26px;color:#ffc857;">GARAGE PAUSED</h2>
          <div class="mm-pause-stats">
            <div class="mm-pause-stat">
              <div class="mm-kicker">CASH</div>
              <div class="mm-hero-num mm-cash" style="font-size:20px;" data-role="pause-cash">$180</div>
            </div>
            <div class="mm-pause-stat">
              <div class="mm-kicker">ODOMETER</div>
              <div class="mm-hero-num" style="font-size:20px;" data-role="pause-odo">0.0 km</div>
            </div>
            <div class="mm-pause-stat">
              <div class="mm-kicker">GIGS</div>
              <div class="mm-hero-num" style="font-size:20px;" data-role="pause-gigs">0</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <button type="button" class="mm-btn-primary" data-role="resume-btn">Resume Riding</button>
            <button type="button" class="mm-btn-secondary" data-role="garage-reset-btn">Tow Back to Garage</button>
            <button type="button" class="mm-btn-secondary" data-role="title-return-btn">Title Screen</button>
          </div>
        </div>
      </div>
    `;
  }

  public dispose(): void {
    this.root.remove();
  }
}
