import * as THREE from 'three';

export interface ProceduralTextureSet {
  asphalt: THREE.CanvasTexture;
  garageFloor: THREE.CanvasTexture;
  grass: THREE.CanvasTexture;
  brick: THREE.CanvasTexture;
  tireTread: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  pcScreen: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));

  const asphalt = makeRepeatTexture(512, 512, true, aniso, (ctx, w, h) => {
    ctx.fillStyle = '#2c3036';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4500; i++) {
      const x = (i * 73) % w;
      const y = (i * 137) % h;
      const v = 34 + ((i * 19) % 24);
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
      ctx.fillRect(x, y, 2, 2);
    }
    // Subtle worn tire tracks
    ctx.fillStyle = 'rgba(20, 22, 26, 0.22)';
    ctx.fillRect(w * 0.22, 0, w * 0.14, h);
    ctx.fillRect(w * 0.64, 0, w * 0.14, h);
  });
  asphalt.repeat.set(1, 24);

  const garageFloor = makeRepeatTexture(512, 512, true, aniso, (ctx, w, h) => {
    ctx.fillStyle = '#474c54';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      const x = (i * 97) % w;
      const y = (i * 53) % h;
      const v = 64 + ((i * 11) % 18);
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 4})`;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.strokeStyle = 'rgba(24, 26, 30, 0.45)';
    ctx.lineWidth = 3;
    for (let g = 0; g <= w; g += 128) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, g);
      ctx.lineTo(w, g);
      ctx.stroke();
    }
  });
  garageFloor.repeat.set(4, 4);

  const grass = makeRepeatTexture(256, 256, true, aniso, (ctx, w, h) => {
    ctx.fillStyle = '#4a6b3b';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) {
      const x = (i * 61) % w;
      const y = (i * 113) % h;
      const g = 88 + ((i * 29) % 36);
      ctx.fillStyle = `rgb(${Math.round(g * 0.68)},${g},${Math.round(g * 0.52)})`;
      ctx.fillRect(x, y, 3, 2);
    }
  });
  grass.repeat.set(42, 42);

  const brick = makeRepeatTexture(256, 256, true, aniso, (ctx, w, h) => {
    ctx.fillStyle = '#7e4838';
    ctx.fillRect(0, 0, w, h);
    const rows = 8;
    const cols = 4;
    const rh = h / rows;
    const cw = w / cols;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (cw * 0.5);
      for (let c = -1; c <= cols; c++) {
        const shade = 110 + (((r * 7 + c * 13) & 15) - 7);
        ctx.fillStyle = `rgb(${shade + 18}, ${Math.round(shade * 0.62)}, ${Math.round(shade * 0.48)})`;
        ctx.fillRect(c * cw + offset + 2, r * rh + 2, cw - 4, rh - 4);
      }
    }
  });
  brick.repeat.set(3, 2);

  const tireTread = makeRepeatTexture(256, 256, false, aniso, (ctx, w, h) => {
    ctx.fillStyle = '#1b1d21';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#0c0d0f';
    ctx.lineWidth = 6;
    for (let y = 0; y < h; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w * 0.5, y + 10);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  });
  tireTread.repeat.set(1, 6);

  const contactShadow = makeSingleTexture(128, 128, true, aniso, (ctx, w, h) => {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, w * 0.48);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.68)');
    grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.34)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });

  const pcScreen = makeSingleTexture(512, 320, true, aniso, (ctx, w, h) => {
    ctx.fillStyle = '#0f1622';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b2434';
    ctx.fillRect(0, 0, w, 40);
    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('MOPED-OS v2.4 // GARAGE TERMINAL', 16, 26);

    ctx.strokeStyle = '#2ec4b6';
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 56, w - 36, 110);
    ctx.fillStyle = '#8bf0e6';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('> PARTS SHOP & DEALERSHIP', 32, 92);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '15px monospace';
    ctx.fillText('  [E] OPEN WORKBENCH TERMINAL', 32, 122);
    ctx.fillText('  UPGRADES · REPAIRS · GIGS', 32, 148);

    ctx.fillStyle = '#f5a623';
    ctx.fillRect(18, 184, 226, 108);
    ctx.fillStyle = '#11161f';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('2-STROKE DEPOT', 32, 224);
    ctx.font = '14px monospace';
    ctx.fillText('CYLINDERS · EXHAUST', 32, 252);
    ctx.fillText('CARBS · CVT KITS', 32, 274);

    ctx.fillStyle = '#1c2638';
    ctx.fillRect(262, 184, 232, 108);
    ctx.strokeStyle = '#f5a623';
    ctx.strokeRect(262, 184, 232, 108);
    ctx.fillStyle = '#f3efe6';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('LOCAL GIGS', 278, 224);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#9da5b4';
    ctx.fillText('DELIVERY & TIME TRIALS', 278, 252);
    ctx.fillText('EARN CASH FOR BUILDS', 278, 274);
  });

  return {
    asphalt,
    garageFloor,
    grass,
    brick,
    tireTread,
    contactShadow,
    pcScreen,
    dispose() {
      asphalt.dispose();
      garageFloor.dispose();
      grass.dispose();
      brick.dispose();
      tireTread.dispose();
      contactShadow.dispose();
      pcScreen.dispose();
    },
  };
}

function makeRepeatTexture(
  width: number,
  height: number,
  isColor: boolean,
  anisotropy: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): THREE.CanvasTexture {
  const tex = makeSingleTexture(width, height, isColor, anisotropy, draw);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeSingleTexture(
  width: number,
  height: number,
  isColor: boolean,
  anisotropy: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  if (isColor) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}
