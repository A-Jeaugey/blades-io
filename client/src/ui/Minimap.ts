import { BladeRarity, MAP_RADIUS, MapEventKind, WALL_KILL_THICKNESS } from "@bladeio/shared";
import { THREAT_COLORS, getActiveTheme } from "../themes";

function rgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;
}

// Portée minimale de la minimap (u) : en fin de manche, l'arène se
// resserre jusqu'à 80 u.
const MIN_RANGE = 90;

export interface MinimapPlayer {
  id: string;
  x: number;
  y: number;
  isMe: boolean;
  // Modes équipe (tâche 7.2) : allié (losange) ou adversaire ; absent hors
  // équipe.
  side?: "ally" | "foe";
}

// Évènement de carte (tâche 4.4) : zone (pluie, zone dorée) ou caisse.
export interface MinimapEvent {
  kind: number;
  x: number;
  y: number;
  radius: number;
  // Après l'annonce : zone pleine.
  active: boolean;
}

// Drapeau de la capture du drapeau : où il est, à qui, et sa base.
export interface MinimapFlag {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  ally: boolean;
  atBase: boolean;
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
  private allyFill: string;
  private foeFill: string;
  private rainColor: number;
  private goldColor: number;

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
    // Équipes : couleurs des anneaux (le sien, celui des autres).
    this.allyFill = rgba(theme.palette.playerLocal.accent, 1);
    this.foeFill = rgba(theme.palette.playerRemote.accent, 1);
    // Évènements : couleurs de rareté, comme leur zone au sol.
    this.rainColor = theme.palette.rarityColor[BladeRarity.Rare];
    this.goldColor = theme.palette.rarityColor[BladeRarity.Legendary];
  }

  // arenaRadius : rayon de l'arène du moment (resserrée en fin de manche,
  // à la taille de sa population). arenaTarget : rayon où un resserrement
  // annoncé arrêtera le mur (tâche 4.5), 0 sans annonce.
  draw(
    me: MinimapPlayer,
    others: MinimapPlayer[],
    legendaries: MinimapBlade[],
    arenaRadius = MAP_RADIUS,
    flags: MinimapFlag[] = [],
    events: MinimapEvent[] = [],
    arenaTarget = 0,
  ): void {
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

    // Portée : l'arène du moment autour de soi. Avant, toute la carte (250 u)
    // quelle que soit l'arène : à ~170 u, elle n'occupait que le milieu de
    // la minimap, cerclée de zone mortelle, et les joueurs s'y tassaient.
    const range = Math.min(MAP_RADIUS, Math.max(MIN_RANGE, arenaRadius));
    const scale = (S / 2 - 6) / range;
    // Bord de l'arène et zone mortelle au-delà. La minimap est centrée sur
    // le joueur : le cercle se rapproche du centre quand on approche du
    // bord, qui tuait jusqu'ici sans jamais apparaître sur la carte.
    const ax = S / 2 - me.x * scale;
    const ay = S / 2 - me.y * scale;
    const ar = Math.max(0, arenaRadius - WALL_KILL_THICKNESS) * scale;
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
    // Future limite d'un resserrement annoncé : en tirets, comme au sol.
    if (arenaTarget > 0) {
      ctx.beginPath();
      ctx.arc(ax, ay, Math.max(0, arenaTarget - WALL_KILL_THICKNESS) * scale, 0, Math.PI * 2);
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    // Évènements de carte, sous les joueurs.
    for (const ev of events) this.drawEvent(ev, me, scale);
    // Autres joueurs ; en équipe, les alliés en losange (la forme en plus
    // de la couleur, tâche 3.8).
    for (const p of others) {
      const dx = p.x - me.x;
      const dy = p.y - me.y;
      const screenX = S / 2 + dx * scale;
      const screenY = S / 2 + dy * scale;
      const d = Math.hypot(dx, dy);
      if (d > range) continue;
      ctx.fillStyle = p.side === "ally" ? this.allyFill : p.side === "foe" ? this.foeFill : this.othersFill;
      ctx.beginPath();
      if (p.side === "ally") {
        ctx.moveTo(screenX, screenY - 3.5);
        ctx.lineTo(screenX + 3.5, screenY);
        ctx.lineTo(screenX, screenY + 3.5);
        ctx.lineTo(screenX - 3.5, screenY);
        ctx.closePath();
      } else {
        ctx.arc(screenX, screenY, 2.5, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    // Drapeaux et bases : toujours sur la carte, ramenés au bord quand ils
    // sont hors de portée de la minimap (direction à suivre).
    for (const f of flags) this.drawFlag(f, me, scale);
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

  // Drapeau à la couleur de son équipe, et de forme différente (tâche
  // 3.8) : le sien carré, celui d'en face en fanion triangulaire. Sa base,
  // quand il n'y est pas : losange creux pour la sienne, cercle sinon.
  private drawFlag(f: MinimapFlag, me: MinimapPlayer, scale: number): void {
    const ctx = this.ctx;
    const S = this.size;
    const color = f.ally ? this.allyFill : this.foeFill;
    const edge = S / 2 - 8;
    const at = (x: number, y: number): [number, number] => {
      let dx = (x - me.x) * scale;
      let dy = (y - me.y) * scale;
      const d = Math.hypot(dx, dy);
      if (d > edge) {
        dx *= edge / d;
        dy *= edge / d;
      }
      return [S / 2 + dx, S / 2 + dy];
    };
    if (!f.atBase) {
      const [bx, by] = at(f.baseX, f.baseY);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (f.ally) {
        ctx.moveTo(bx, by - 5);
        ctx.lineTo(bx + 5, by);
        ctx.lineTo(bx, by + 5);
        ctx.lineTo(bx - 5, by);
        ctx.closePath();
      } else {
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    const [x, y] = at(f.x, f.y);
    ctx.strokeStyle = this.meFill;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 2, y + 5);
    ctx.lineTo(x - 2, y - 6);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    if (f.ally) {
      ctx.rect(x - 2, y - 6, 7, 5);
    } else {
      ctx.moveTo(x - 2, y - 6);
      ctx.lineTo(x + 6, y - 3);
      ctx.lineTo(x - 2, y);
      ctx.closePath();
    }
    ctx.fill();
  }

  // Pluie : cercle en pointillés ; zone dorée : double cercle ; caisse
  // légendaire : étoile. Pleins une fois actifs ; ramenés au bord quand ils
  // sont hors de portée de la minimap (direction à suivre).
  private drawEvent(ev: MinimapEvent, me: MinimapPlayer, scale: number): void {
    const ctx = this.ctx;
    const S = this.size;
    const edge = S / 2 - 8;
    let dx = (ev.x - me.x) * scale;
    let dy = (ev.y - me.y) * scale;
    const d = Math.hypot(dx, dy);
    const clamped = d > edge;
    if (clamped) {
      dx *= edge / d;
      dy *= edge / d;
    }
    const x = S / 2 + dx;
    const y = S / 2 + dy;
    const color = ev.kind === MapEventKind.Rain ? this.rainColor : this.goldColor;
    if (ev.kind === MapEventKind.Crate) {
      ctx.fillStyle = rgba(color, 1);
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 6 : 2.6;
        if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    const r = clamped ? 5 : Math.max(4, ev.radius * scale);
    ctx.strokeStyle = rgba(color, 1);
    ctx.lineWidth = 1.5;
    if (ev.kind === MapEventKind.Rain) ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (ev.active) {
      ctx.fillStyle = rgba(color, 0.3);
      ctx.fill();
    }
    if (ev.kind === MapEventKind.Golden) {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
