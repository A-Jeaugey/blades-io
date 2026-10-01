import { BladeRarity } from "@bladeio/shared";
import { NEON_THEME } from "../src/themes/neon";

// Image d'aperçu des liens partagés (balises Open Graph, tâche 5.5),
// 1200 × 630. Dessinée par programme comme tout le jeu : aucune image dans
// le dépôt. Les couleurs viennent du thème par défaut. Le seul texte est le
// logo, valable dans toutes les langues : titre et description voyagent
// dans les balises (server/src/http/ogTags.ts).
//
// Rendu logiciel : lumière additive en flottants (halos), puis passage en
// 8 bits avec un blanchiment des zones saturées (cœur des néons), et
// encodage JPEG.

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const OG_QUALITY = 90;

type RGB = [number, number, number];

const rgbOf = (hex: number): RGB => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const rgbOfCss = (css: string): RGB => rgbOf(parseInt(css.slice(1), 16));
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Générateur pseudo-aléatoire à graine fixe : la même image à chaque build.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Canvas {
  readonly px: Float32Array;
  constructor(readonly w: number, readonly h: number) {
    this.px = new Float32Array(w * h * 3);
  }
  add(i: number, c: RGB, k: number): void {
    this.px[i] += c[0] * k;
    this.px[i + 1] += c[1] * k;
    this.px[i + 2] += c[2] * k;
  }
  mix(i: number, c: RGB, a: number): void {
    this.px[i] += (c[0] - this.px[i]) * a;
    this.px[i + 1] += (c[1] - this.px[i + 1]) * a;
    this.px[i + 2] += (c[2] - this.px[i + 2]) * a;
  }
}

// Segment épais (capsule) : largeur w, intensité k.
interface Seg { ax: number; ay: number; bx: number; by: number; w: number; k: number }

function segDist(x: number, y: number, s: Seg): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp01(((x - s.ax) * dx + (y - s.ay) * dy) / len2) : 0;
  return Math.hypot(x - (s.ax + dx * t), y - (s.ay + dy * t));
}

// Tube néon : cœur net (anticrénelé) et halo exponentiel. Un groupe prend
// le maximum de ses segments, pas leur somme : pas de surbrillance aux
// jointures d'une même lettre ou d'une même traînée.
function neon(c: Canvas, segs: Seg[], color: RGB, sigma: number, halo = 0.9, core = 0.7): void {
  if (segs.length === 0) return;
  const reach = sigma * 6;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segs) {
    x0 = Math.min(x0, s.ax - s.w, s.bx - s.w);
    x1 = Math.max(x1, s.ax + s.w, s.bx + s.w);
    y0 = Math.min(y0, s.ay - s.w, s.by - s.w);
    y1 = Math.max(y1, s.ay + s.w, s.by + s.w);
  }
  const xa = Math.max(0, Math.floor(x0 - reach)), xb = Math.min(c.w - 1, Math.ceil(x1 + reach));
  const ya = Math.max(0, Math.floor(y0 - reach)), yb = Math.min(c.h - 1, Math.ceil(y1 + reach));
  const white: RGB = [1, 1, 1];
  const boxes = segs.map((s) => [
    Math.min(s.ax, s.bx) - s.w - reach, Math.min(s.ay, s.by) - s.w - reach,
    Math.max(s.ax, s.bx) + s.w + reach, Math.max(s.ay, s.by) + s.w + reach,
  ]);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      let glow = 0;
      let fill = 0;
      for (let n = 0; n < segs.length; n++) {
        const bx = boxes[n];
        if (x < bx[0] || x > bx[2] || y < bx[1] || y > bx[3]) continue;
        const s = segs[n];
        const d = segDist(x + 0.5, y + 0.5, s) - s.w / 2;
        const cover = clamp01(0.5 - d) * s.k;
        const g = Math.exp(-Math.max(0, d) / sigma) * s.k;
        if (cover > fill) fill = cover;
        if (g > glow) glow = g;
      }
      if (glow < 0.002) continue;
      const i = (y * c.w + x) * 3;
      c.add(i, color, glow * halo + fill * 0.8);
      c.add(i, white, fill * core);
    }
  }
}

// Disque plein avec dégradé radial (corps du joueur) : mélange, il masque
// ce qui est derrière.
function sphere(c: Canvas, cx: number, cy: number, r: number, base: RGB, light: RGB): void {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      if (x < 0 || y < 0 || x >= c.w || y >= c.h) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const cover = clamp01(r - d + 0.5);
      if (cover <= 0) continue;
      // Éclairage d'en haut à gauche.
      const hx = dx + r * 0.35;
      const hy = dy + r * 0.4;
      const spec = Math.exp(-(hx * hx + hy * hy) / (r * r * 0.18));
      const rim = smoothstep(r * 0.55, r, d);
      const col: RGB = [
        base[0] * (0.35 + 0.65 * rim) + light[0] * spec,
        base[1] * (0.35 + 0.65 * rim) + light[1] * spec,
        base[2] * (0.35 + 0.65 * rim) + light[2] * spec,
      ];
      c.mix((y * c.w + x) * 3, col, cover);
    }
  }
}

// Ellipse (orbite vue en perspective) en segments.
function ellipseSegs(cx: number, cy: number, rx: number, ry: number, w: number, k: number, from = 0, to = Math.PI * 2, n = 96): Seg[] {
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = from + ((to - from) * i) / n;
    const a1 = from + ((to - from) * (i + 1)) / n;
    segs.push({ ax: cx + rx * Math.cos(a0), ay: cy + ry * Math.sin(a0), bx: cx + rx * Math.cos(a1), by: cy + ry * Math.sin(a1), w, k });
  }
  return segs;
}

// Logo en traits : chaque glyphe est une liste de polylignes dans une boîte
// de hauteur 1 (y vers le bas), avec sa largeur.
const GLYPHS: Record<string, { w: number; lines: number[][] }> = {
  B: { w: 0.6, lines: [[0, 0, 0, 1], [0, 0, 0.44, 0, 0.55, 0.1, 0.55, 0.38, 0.45, 0.48, 0, 0.48], [0.45, 0.48, 0.6, 0.6, 0.6, 0.88, 0.48, 1, 0, 1]] },
  L: { w: 0.52, lines: [[0, 0, 0, 1, 0.52, 1]] },
  A: { w: 0.62, lines: [[0, 1, 0, 0.2, 0.2, 0, 0.42, 0, 0.62, 0.2, 0.62, 1], [0, 0.56, 0.62, 0.56]] },
  D: { w: 0.62, lines: [[0, 0, 0.42, 0, 0.62, 0.2, 0.62, 0.8, 0.42, 1, 0, 1, 0, 0]] },
  E: { w: 0.55, lines: [[0.55, 0, 0, 0, 0, 1, 0.55, 1], [0, 0.5, 0.44, 0.5]] },
  ".": { w: 0.04, lines: [[0.02, 0.97, 0.02, 0.985]] },
  I: { w: 0.04, lines: [[0.02, 0, 0.02, 1]] },
  O: { w: 0.62, lines: [[0.2, 0, 0.42, 0, 0.62, 0.2, 0.62, 0.8, 0.42, 1, 0.2, 1, 0, 0.8, 0, 0.2, 0.2, 0]] },
};

function textSegs(text: string, x: number, y: number, size: number, stroke: number, gap: number): { segs: Seg[]; width: number } {
  const segs: Seg[] = [];
  let pen = x;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) continue;
    for (const line of g.lines) {
      for (let i = 0; i + 3 < line.length; i += 2) {
        segs.push({
          ax: pen + line[i] * size, ay: y + line[i + 1] * size,
          bx: pen + line[i + 2] * size, by: y + line[i + 3] * size,
          w: stroke, k: 1,
        });
      }
    }
    pen += g.w * size + gap;
  }
  return { segs, width: pen - gap - x };
}

// Une lame en orbite : un trait tangent à l'ellipse et sa traînée qui
// s'éteint derrière elle.
function bladeSegs(cx: number, cy: number, r: number, squash: number, a: number, len: number, w: number, k: number, trail: number): Seg[] {
  const segs: Seg[] = [];
  const at = (ang: number) => [cx + r * Math.cos(ang), cy + r * squash * Math.sin(ang)];
  const half = len / r / 2;
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const [ax, ay] = at(a - half + (2 * half * i) / steps);
    const [bx, by] = at(a - half + (2 * half * (i + 1)) / steps);
    segs.push({ ax, ay, bx, by, w, k });
  }
  const tsteps = 10;
  for (let i = 0; i < tsteps; i++) {
    const f = i / tsteps;
    const [ax, ay] = at(a - half - trail * f);
    const [bx, by] = at(a - half - trail * (f + 1 / tsteps));
    segs.push({ ax, ay, bx, by, w: w * (0.55 - 0.35 * f), k: k * 0.3 * (1 - f) * (1 - f) });
  }
  return segs;
}

// Image JPEG prête à servir (og.jpg).
export function renderOgImage(): Buffer {
  return encodeJpeg(renderOgPixels(), OG_WIDTH, OG_HEIGHT, OG_QUALITY);
}

// Pixels RGB 8 bits, ligne par ligne.
export function renderOgPixels(): Buffer {
  const W = OG_WIDTH;
  const H = OG_HEIGHT;
  const c = new Canvas(W, H);
  const pal = NEON_THEME.palette;
  const ui = NEON_THEME.ui;
  const dark = rgbOf(pal.clearColor);
  const fog = rgbOf(pal.fogColor);
  const cool = rgbOfCss(ui.accentCool);
  const warm = rgbOfCss(ui.accentWarm);
  const rarity = [BladeRarity.Common, BladeRarity.Rare, BladeRarity.Epic, BladeRarity.Legendary].map((r) => rgbOf(pal.rarityColor[r]));
  const rand = mulberry32(5);

  // Logo : placé d'abord, la grille s'éteint derrière lui (lisibilité).
  const size = 104;
  const lx = 78, ly = 246;
  const blade = textSegs("BLADE", lx, ly, size, 13, 0.24 * size);
  const io = textSegs(".IO", lx + blade.width + 0.24 * size, ly, size, 13, 0.2 * size);
  const right = lx + blade.width + 0.24 * size + io.width;
  const plate = (x: number, y: number) => {
    const dx = Math.max(0, lx - 20 - x, x - (right + 20));
    const dy = Math.max(0, ly - 10 - y, y - (ly + size + 80));
    return 1 - 0.65 * (1 - smoothstep(0, 120, Math.hypot(dx, dy)));
  };

  // 1. Ciel et sol : nuit en haut, brume violette à l'horizon, sol sombre
  // quadrillé en perspective (la grille de l'arène), qui s'efface au loin.
  const horizon = 196;
  const focal = 600;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      if (y < horizon) {
        const t = Math.pow(y / horizon, 2.2);
        c.px[i] = dark[0] + (fog[0] - dark[0]) * t;
        c.px[i + 1] = dark[1] + (fog[1] - dark[1]) * t;
        c.px[i + 2] = dark[2] + (fog[2] - dark[2]) * t;
        continue;
      }
      const depthPx = y - horizon + 0.5;
      const near = smoothstep(0, 220, depthPx);
      c.px[i] = fog[0] * (1 - near) * 0.8 + dark[0] * near + 0.01;
      c.px[i + 1] = fog[1] * (1 - near) * 0.8 + dark[1] * near + 0.015;
      c.px[i + 2] = fog[2] * (1 - near) * 0.8 + dark[2] * near + 0.04;
      // Grille : x monde = (x - centre) / profondeur, z monde = focale / profondeur.
      const cell = 0.24;
      const u = (x + 0.5 - W / 2) / depthPx / cell;
      const v = focal / depthPx / cell;
      const pxPerCellX = cell * depthPx;
      const pxPerCellZ = (cell * depthPx * depthPx) / focal;
      const du = Math.abs(u - Math.round(u)) * pxPerCellX;
      const dv = Math.abs(v - Math.round(v)) * pxPerCellZ;
      const major = (Math.round(u) % 5 === 0 ? 1 : 0) + (Math.round(v) % 5 === 0 ? 1 : 0);
      // Les lignes trop serrées (moins de ~10 px par case) s'effacent : près
      // de l'horizon, elles faisaient un moiré.
      const lineU = clamp01(1.2 - du) * smoothstep(8, 22, pxPerCellX);
      const lineV = clamp01(1.2 - dv) * smoothstep(8, 22, pxPerCellZ);
      const fade = smoothstep(10, 190, depthPx);
      const line = Math.max(lineU, lineV);
      if (line > 0) c.add(i, cool, line * (0.22 + 0.16 * major) * fade * plate(x, y));
    }
  }
  // Lueur rose sur la ligne d'horizon.
  for (let y = horizon - 60; y < horizon + 60; y++) {
    for (let x = 0; x < W; x++) {
      const k = Math.exp(-Math.abs(y - horizon) / 14) * 0.22 * (1 - Math.pow(Math.abs(x - W / 2) / (W / 2), 2));
      c.add((y * W + x) * 3, warm, k);
    }
  }

  // 2. Lames libres éparpillées sur le sol.
  for (let n = 0; n < 24; n++) {
    const x = 40 + rand() * (W - 80);
    const y = horizon + 30 + rand() * (H - horizon - 50);
    // Pas sous le logo ni sur le joueur.
    if (x < 690 && y > 220 && y < 450) continue;
    if (Math.hypot(x - 878, (y - 400) * 2) < 330) continue;
    const scale = 0.45 + 0.75 * ((y - horizon) / (H - horizon));
    const a = rand() * Math.PI;
    const len = 16 * scale;
    const col = rarity[Math.min(3, Math.floor(Math.pow(rand(), 1.8) * 4))];
    neon(c, [{ ax: x - Math.cos(a) * len / 2, ay: y - Math.sin(a) * len * 0.5 / 2, bx: x + Math.cos(a) * len / 2, by: y + Math.sin(a) * len * 0.5 / 2, w: 3.2 * scale, k: 0.55 }], col, 4 * scale);
  }

  // 3. Un adversaire au loin, à droite, avec sa petite orbite.
  const ex = 1086, ey = 262, es = 0.42;
  neon(c, ellipseSegs(ex, ey, 34 * es * 2.2, 17 * es * 2.2, 2, 0.35), warm, 5);
  for (let b = 0; b < 7; b++) {
    const a = (b / 7) * Math.PI * 2 + 0.4;
    neon(c, bladeSegs(ex, ey, 84 * es, 0.5, a, 22 * es, 4 * es, 0.9, 0.4), rarity[b % 3 === 0 ? 3 : 1], 4, 1.1, 0.3);
  }
  sphere(c, ex, ey - 16 * es, 26 * es, warm, [1, 1, 1]);

  // 4. Le joueur au centre de son orbite : socle, anneaux de lames (celles
  // de derrière plus sombres), corps.
  const cx = 878, cy = 404, squash = 0.5;
  neon(c, ellipseSegs(cx, cy, 52, 26, 3, 0.9), cool, 7);
  neon(c, ellipseSegs(cx, cy, 120, 60, 1.4, 0.22), cool, 2);
  neon(c, ellipseSegs(cx, cy, 196, 98, 1.4, 0.18), cool, 2);
  const rings = [
    { r: 120, n: 8, len: 34, w: 8, off: 0.25, mix: [1, 2, 0, 1, 3, 1, 2, 0] },
    { r: 196, n: 12, len: 44, w: 9, off: 0.0, mix: [0, 1, 2, 3, 1, 0, 2, 1, 3, 0, 1, 2] },
  ];
  const front: Array<() => void> = [];
  for (const ring of rings) {
    for (let b = 0; b < ring.n; b++) {
      const a = (b / ring.n) * Math.PI * 2 + ring.off;
      const behind = Math.sin(a) < 0;
      const k = behind ? 0.6 : 1;
      const col = rarity[ring.mix[b % ring.mix.length]];
      const draw = () => neon(c, bladeSegs(cx, cy, ring.r, squash, a, ring.len, ring.w, k, 0.42), col, 6, 1.1, 0.3);
      if (behind) draw();
      else front.push(draw);
    }
  }
  // Halo du corps, puis le corps (il masque les lames de derrière).
  for (let y = cy - 150; y < cy + 60; y++) {
    for (let x = cx - 150; x < cx + 150; x++) {
      const d = Math.hypot(x - cx, (y - (cy - 40)) * 1.1);
      c.add((y * W + x) * 3, cool, Math.exp(-d / 26) * 0.55);
    }
  }
  sphere(c, cx, cy - 40, 38, rgbOf(pal.playerLocal.accentDim), [1, 1, 1]);
  neon(c, ellipseSegs(cx, cy - 40, 38, 38, 2.5, 0.85, 0, Math.PI * 2, 64), cool, 6, 0.6, 0.25);
  for (const draw of front) draw();

  // 5. Logo.
  neon(c, blade.segs, cool, 11, 0.95, 0.55);
  neon(c, io.segs, warm, 11, 0.95, 0.55);
  // Filet et les quatre raretés, comme le bandeau du lobby.
  const lineY = ly + size + 34;
  neon(c, [{ ax: lx, ay: lineY, bx: right, by: lineY, w: 2, k: 0.55 }], cool, 5);
  rarity.forEach((col, i) => {
    const x = lx + 8 + i * 34;
    neon(c, [{ ax: x, ay: lineY + 34, bx: x + 0.01, by: lineY + 34, w: 13, k: 1 }], col, 6, 0.8, 0.35);
  });

  // 6. Vignette, puis 8 bits : ce qui dépasse 1 déborde sur les autres
  // canaux (cœur blanc des néons) avant d'être écrêté.
  const rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const nx = (x - W / 2) / (W / 2);
      const ny = (y - H / 2) / (H / 2);
      const vig = 1 - 0.4 * Math.pow(Math.min(1, Math.hypot(nx * 0.8, ny)), 2.4);
      let r = c.px[i] * vig, g = c.px[i + 1] * vig, b = c.px[i + 2] * vig;
      const m = Math.max(r, g, b);
      if (m > 1) {
        const spill = (m - 1) * 0.5;
        r += spill; g += spill; b += spill;
      }
      rgb[i] = Math.round(clamp01(r) * 255);
      rgb[i + 1] = Math.round(clamp01(g) * 255);
      rgb[i + 2] = Math.round(clamp01(b) * 255);
    }
  }
  return rgb;
}

// ---------------------------------------------------------------------------
// Encodeur JPEG de base (séquentiel, tables de Huffman standard de
// l'annexe K), sans sous-échantillonnage de la chrominance : les traits
// néon fins gardent leur couleur. Le PNG des mêmes pixels pesait ~280 Ko
// (les halos se compressent mal), à la limite de ce qu'accepte WhatsApp ;
// en JPEG qualité 90, ~150 Ko.

// Ordre zigzag : indice naturel (ligne × 8 + colonne) du k-ième coefficient.
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

const LUM_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const CHR_Q = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...new Array(32).fill(99),
];

const DC_LUM_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_CHR_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUM_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUM_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];
const AC_CHR_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHR_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

interface Huffman { code: number[]; len: number[] }

// Codes canoniques à partir du nombre de codes par longueur.
function huffman(bits: number[], vals: number[]): Huffman {
  const h: Huffman = { code: [], len: [] };
  let code = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < bits[l - 1]; i++) {
      h.code[vals[k]] = code;
      h.len[vals[k]] = l;
      k++;
      code++;
    }
    code <<= 1;
  }
  return h;
}

function scaledTable(base: number[], quality: number): number[] {
  const scale = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  return base.map((q) => Math.min(255, Math.max(1, Math.floor((q * scale + 50) / 100))));
}

// Catégorie (nombre de bits) d'une valeur non nulle.
function category(v: number): number {
  let a = Math.abs(v);
  let n = 0;
  while (a > 0) { n++; a >>= 1; }
  return n;
}

class BitWriter {
  readonly out: number[] = [];
  private buf = 0;
  private count = 0;
  write(code: number, len: number): void {
    this.buf = (this.buf << len) | (code & ((1 << len) - 1));
    this.count += len;
    while (this.count >= 8) {
      const b = (this.buf >> (this.count - 8)) & 0xff;
      this.out.push(b);
      // Octet de bourrage : 0xFF dans les données serait pris pour un marqueur.
      if (b === 0xff) this.out.push(0);
      this.count -= 8;
    }
    this.buf &= (1 << this.count) - 1;
  }
  flush(): void {
    if (this.count > 0) this.write((1 << (8 - this.count)) - 1, 8 - this.count);
  }
}

// cos((2x + 1) u π / 16), précalculé.
const COS = Array.from({ length: 64 }, (_, i) => Math.cos(((2 * (i >> 3) + 1) * (i & 7) * Math.PI) / 16));

function fdct(block: Float64Array, out: Float64Array): void {
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += block[y * 8 + x] * COS[x * 8 + u];
      tmp[y * 8 + u] = s;
    }
  }
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[y * 8 + v];
      out[v * 8 + u] = 0.25 * (u === 0 ? Math.SQRT1_2 : 1) * (v === 0 ? Math.SQRT1_2 : 1) * s;
    }
  }
}

function segment(marker: number, data: number[]): number[] {
  const len = data.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...data];
}

export function encodeJpeg(rgb: Buffer, w: number, h: number, quality = 90): Buffer {
  const qLum = scaledTable(LUM_Q, quality);
  const qChr = scaledTable(CHR_Q, quality);
  const dcLum = huffman(DC_LUM_BITS, DC_VALS);
  const dcChr = huffman(DC_CHR_BITS, DC_VALS);
  const acLum = huffman(AC_LUM_BITS, AC_LUM_VALS);
  const acChr = huffman(AC_CHR_BITS, AC_CHR_VALS);
  const comps = [
    { q: qLum, dc: dcLum, ac: acLum, prev: 0 },
    { q: qChr, dc: dcChr, ac: acChr, prev: 0 },
    { q: qChr, dc: dcChr, ac: acChr, prev: 0 },
  ];
  const bw = new BitWriter();
  const block = [new Float64Array(64), new Float64Array(64), new Float64Array(64)];
  const coef = new Float64Array(64);
  for (let by = 0; by < h; by += 8) {
    for (let bx = 0; bx < w; bx += 8) {
      // YCbCr (JFIF), centré sur 0 ; bords répétés au-delà de l'image.
      for (let j = 0; j < 64; j++) {
        const x = Math.min(w - 1, bx + (j & 7));
        const y = Math.min(h - 1, by + (j >> 3));
        const i = (y * w + x) * 3;
        const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
        block[0][j] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
        block[1][j] = -0.168736 * r - 0.331264 * g + 0.5 * b;
        block[2][j] = 0.5 * r - 0.418688 * g - 0.081312 * b;
      }
      for (let c = 0; c < 3; c++) {
        const comp = comps[c];
        fdct(block[c], coef);
        const dc = Math.round(coef[0] / comp.q[0]);
        const diff = dc - comp.prev;
        comp.prev = dc;
        const dcCat = diff === 0 ? 0 : category(diff);
        bw.write(comp.dc.code[dcCat], comp.dc.len[dcCat]);
        if (dcCat > 0) bw.write(diff < 0 ? diff + (1 << dcCat) - 1 : diff, dcCat);
        let run = 0;
        for (let k = 1; k < 64; k++) {
          const n = ZIGZAG[k];
          const v = Math.round(coef[n] / comp.q[n]);
          if (v === 0) { run++; continue; }
          while (run > 15) {
            bw.write(comp.ac.code[0xf0], comp.ac.len[0xf0]);
            run -= 16;
          }
          const cat = category(v);
          const sym = (run << 4) | cat;
          bw.write(comp.ac.code[sym], comp.ac.len[sym]);
          bw.write(v < 0 ? v + (1 << cat) - 1 : v, cat);
          run = 0;
        }
        if (run > 0) bw.write(comp.ac.code[0], comp.ac.len[0]);
      }
    }
  }
  bw.flush();

  const dht = (cls: number, bits: number[], vals: number[]) => [cls, ...bits, ...vals];
  const header = [
    0xff, 0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...segment(0xdb, [0, ...ZIGZAG.map((n) => qLum[n]), 1, ...ZIGZAG.map((n) => qChr[n])]),
    ...segment(0xc0, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...segment(0xc4, [
      ...dht(0x00, DC_LUM_BITS, DC_VALS), ...dht(0x10, AC_LUM_BITS, AC_LUM_VALS),
      ...dht(0x01, DC_CHR_BITS, DC_VALS), ...dht(0x11, AC_CHR_BITS, AC_CHR_VALS),
    ]),
    ...segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]),
  ];
  return Buffer.concat([Buffer.from(header), Buffer.from(bw.out), Buffer.from([0xff, 0xd9])]);
}
