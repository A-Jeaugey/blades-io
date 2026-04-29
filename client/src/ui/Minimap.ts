import { MAP_RADIUS } from "@bladeio/shared";

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

  constructor() {
    this.canvas = document.getElementById("minimap") as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;
    this.size = this.canvas.width;
  }

  draw(me: MinimapPlayer, others: MinimapPlayer[], legendaries: MinimapBlade[]): void {
    const ctx = this.ctx;
    const S = this.size;
    ctx.clearRect(0, 0, S, S);
    // Fond
    ctx.fillStyle = "rgba(5, 6, 12, 0.7)";
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 229, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const scale = (S / 2 - 6) / MAP_RADIUS;
    // Autres joueurs
    ctx.fillStyle = "#00e5ff";
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
    ctx.fillStyle = "#ff2ea8";
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
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
