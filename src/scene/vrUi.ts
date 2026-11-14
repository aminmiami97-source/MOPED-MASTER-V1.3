import * as THREE from 'three';
import * as xb from 'xrblocks';

export interface VrSpatialUiActions {
  onCycleMoped: () => void;
  onTuneUp: () => void;
  onFixFirstIssue: () => void;
  onQuickMission: () => void;
  onOpenPcOverlay: () => void;
}

export class VrSpatialUi {
  public readonly garageCard: xb.UICard;
  public readonly dashCard: xb.UICard;

  private readonly garageMopedText: xb.UIText;
  private readonly garageStatusText: xb.UIText;
  private readonly dashSpeedText: xb.UIText;
  private readonly dashMetaText: xb.UIText;

  constructor(actions: VrSpatialUiActions) {
    this.garageMopedText = new xb.UIText({
      text: 'Veloce 50 Classic · 100%',
      style: { fontSize: 22, fontWeight: 'bold', textAlign: 'center' },
    });
    this.garageStatusText = new xb.UIText({
      text: 'Cash: $180 · Issues: 0',
      style: { fontSize: 16, opacity: 0.85, textAlign: 'center' },
    });

    this.garageCard = new xb.UICard({
      size: { width: 0.72, height: 'auto' },
      manipulation: true,
      edge: true,
      style: { flexDirection: 'column', gap: 12, padding: 18 },
      children: [
        new xb.UIText({
          text: 'MOPED-OS // GARAGE PC',
          style: { fontSize: 24, fontWeight: 'bold', color: '#ffc857', textAlign: 'center' },
        }),
        this.garageMopedText,
        this.garageStatusText,
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 10 },
          children: [
            new xb.UIButton({
              label: 'Switch Ride',
              icon: 'two_wheeler',
              style: { flexGrow: 1 },
              onClick: actions.onCycleMoped,
            }),
            new xb.UIButton({
              label: 'Fix Issue',
              icon: 'build',
              style: { flexGrow: 1 },
              onClick: actions.onFixFirstIssue,
            }),
          ],
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 10 },
          children: [
            new xb.UIButton({
              label: 'Tune-Up $35',
              icon: 'tune',
              style: { flexGrow: 1 },
              onClick: actions.onTuneUp,
            }),
            new xb.UIButton({
              label: 'Start Gig',
              icon: 'flag',
              style: { flexGrow: 1 },
              onClick: actions.onQuickMission,
            }),
          ],
        }),
        new xb.UIButton({
          label: 'Full PC Catalog',
          icon: 'computer',
          style: { width: '100%' },
          onClick: actions.onOpenPcOverlay,
        }),
      ],
    });

    this.garageCard.position.set(-2.15, 1.52, -2.2);
    this.garageCard.rotation.y = Math.PI / 2.6;

    // Handlebar-mounted VR dash card (shown only in immersive VR session)
    this.dashSpeedText = new xb.UIText({
      text: '0 km/h',
      style: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', color: '#ffc857' },
    });
    this.dashMetaText = new xb.UIText({
      text: '1500 RPM · 100%',
      style: { fontSize: 15, textAlign: 'center', opacity: 0.85 },
    });
    this.dashCard = new xb.UICard({
      size: { width: 0.34, height: 'auto' },
      pointerEvents: 'none',
      style: { flexDirection: 'column', gap: 4, padding: 10 },
      children: [this.dashSpeedText, this.dashMetaText],
    });
    this.dashCard.visible = false;
  }

  public attachTo(sceneOrParent: THREE.Object3D, mopedRoot: THREE.Object3D): void {
    sceneOrParent.add(this.garageCard);
    this.dashCard.position.set(0, 1.04, -0.52);
    this.dashCard.rotation.x = -0.35;
    mopedRoot.add(this.dashCard);
  }

  public setVrActive(inVr: boolean): void {
    this.dashCard.visible = inVr;
  }

  public updateGarageReadout(
    mopedName: string,
    condition: number,
    cash: number,
    issueCount: number
  ): void {
    this.garageMopedText.text = `${mopedName} · ${Math.round(condition)}%`;
    this.garageStatusText.text =
      issueCount > 0
        ? `Cash: $${cash} · ${issueCount} Technical Issue(s)`
        : `Cash: $${cash} · Running Smoothly`;
  }

  public updateDashReadout(speedKmh: number, rpm: number, condition: number): void {
    if (!this.dashCard.visible) return;
    this.dashSpeedText.text = `${Math.round(speedKmh)} km/h`;
    this.dashMetaText.text = `${Math.round(rpm)} RPM · ${Math.round(condition)}%`;
  }
}
