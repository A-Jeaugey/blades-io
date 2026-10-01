import { BladeRarity, MAP_RADIUS, WALL_KILL_THICKNESS } from "@bladeio/shared";
import { THREAT_COLORS, getActiveTheme } from "../themes";

function rgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;
}

export interface MinimapPlayer {
  id: string;
  x: number;
  y: number;
  isMe: boolean;
}

export interface MinimapBlade {
  x: number;
  y: number;
  legendary: boolean;
}

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private arenaEdge: string;
  private outsideFill: string;
  private background: string;
  private rim: string;
  private othersFill: string;
  private legendaryFill: string;
  private meFill: string;

  constructor() {
    this.canvas = document.getElementById("minimap") as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;
    this.size = this.canvas.width;
    // Couleurs du thème actif (celles d'avant pour le Néon). Les flèches des
    // légendaires prennent la couleur de la rareté, palette daltonienne
    // comprise (tâche 3.8).
    const theme = getActiveTheme();
    this.arenaEdge = rgba(theme.palette.boundary, 0.9);
    this.outsideFill = rgba(THREAT_COLORS.danger, 0.28);
    this.background = rgba(theme.palette.clearColor, 0.7);
    this.rim = `rgba(${theme.ui.accentCoolRgb}, 0.3)`;
    this.othersFill = theme.ui.accentCool;
    this.legendaryFill = rgba(theme.palette.rarityColor[BladeRarity.Legendary], 1);
    this.meFill = rgba(theme.palette.playerLocal.primary, 1);
  }

  draw(me: MinimapPlayer, others: MinimapPlayer[], legendaries: MinimapBlade[]): void {
    const ctx = this.ctx;
    const S = this.size;
    ctx.clearRect(0, 0, S, S);
    // Fond
    ctx.fillStyle = this.background;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.rim;
    ctx.lineWidth = 1;
    ctx.stroke();

    const scale = (S / 2 - 6) / MAP_RADIUS;
    // Bord de l'arène et zone mortelle au-delà. La minimap est centrée sur
    // le joueur : le cercle se rapproche du centre quand on approche du
    // bord, qui tuait jusqu'ici sans jamais apparaître sur la carte.
    const ax = S / 2 - me.x * scale;
    const ay = S / 2 - me.y * scale;
    const ar = (MAP_RADIUS - WALL_KILL_THICKNESS) * scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.moveTo(ax + ar, ay);
    ctx.arc(ax, ay, ar, 0, Math.PI * 2);
    ctx.fillStyle = this.outsideFill;
    ctx.fill("evenodd");
    ctx.beginPath();
    ctx.arc(ax, ay, ar, 0, Math.PI * 2);
    ctx.strokeStyle = this.arenaEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    // Autres joueurs
    ctx.fillStyle = this.othersFill;
    for (const p of others) {
      const dx = p.x - me.x;
      const dy = p.y - me.y;
      const screenX = S / 2 + dx * scale;
      const screenY = S / 2 + dy * scale;
      const d = Math.hypot(dx, dy);
      if (d > MAP_RADIUS) continue;
      ctx.beginPath();
      ctx.arc(screenX, screenY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Légendaires proches en flèche
    ctx.fillStyle = this.legendaryFill;
    for (const b of legendaries) {
      const dx = b.x - me.x;
      const dy = b.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d > 80) continue;
      const angle = Math.atan2(dy, dx);
      const edge = (S / 2 - 6) * 0.92;
      const ax = S / 2 + Math.cos(angle) * edge;
      const ay = S / 2 + Math.sin(angle) * edge;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(-4, 3);
      ctx.lineTo(-4, -3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // Moi au centre
    ctx.fillStyle = this.meFill;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.meFill;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
