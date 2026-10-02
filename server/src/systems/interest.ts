import { Client } from "@colyseus/core";
import { $changes, StateView } from "@colyseus/schema";
import {
  BUSH_REVEAL_MARGIN,
  VIEW_RADIUS_DEFAULT,
  VIEW_RADIUS_MARGIN,
  VIEW_RADIUS_MAX,
  VIEW_RADIUS_MIN,
  isInBush,
  outerOrbitRadius,
  tierBladeHitbox,
  sameTeam,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { OWNER_VIEW_TAG, Player } from "../state/Player";

// Zone d'intérêt (tâche 2.4) : chaque client ne reçoit que les joueurs et
// les lames proches de lui (StateView de Colyseus 0.16), et jamais un
// joueur caché dans un buisson tant que leurs orbites ne peuvent pas se
// toucher. Avant, l'état complet partait à tout le monde : ~95 Ko/s par
// client à 60 joueurs, et un client modifié voyait à travers les buissons.
//
// Les vues sont recalculées à chaque tick, après la simulation : diff entre
// ce que le client voyait et ce qu'il doit voir, puis view.add / remove.

// Portée d'un joueur : orbite extérieure + hitbox d'une lame.
export function reachOf(p: Player): number {
  return outerOrbitRadius(p.bladeCount) + tierBladeHitbox(p.tier);
}

// Évènement positionnel : à qui l'envoyer. Un client le reçoit s'il est
// destinataire direct (to), s'il voit l'un des joueurs ou la lame
// concernés, ou si la position est dans sa zone.
export interface EventScope {
  to?: Array<string | null | undefined>;
  players?: Array<string | null | undefined>;
  blade?: string;
  at?: { x: number; y: number };
}

interface Viewer {
  client: Client;
  view: StateView;
  playerId: string;
  // Rayon annoncé par le client (borné), marge non comprise.
  radius: number;
  // Centre de la zone au dernier calcul.
  cx: number;
  cy: number;
  // Ce que le client voit (instances de l'état : comparaison par référence,
  // moins coûteuse que par id), et les ids des joueurs pour les évènements.
  players: Set<Player>;
  blades: Set<Blade>;
  playerIds: Set<string>;
  // Ensembles de travail, échangés avec les précédents à chaque calcul.
  nextPlayers: Set<Player>;
  nextBlades: Set<Blade>;
}

// Fiche d'un joueur, calculée une fois par tick pour tous les clients.
interface PlayerEntry {
  p: Player;
  x: number;
  y: number;
  reach: number;
  inBush: boolean;
  alive: boolean;
  team: number;
}

// Lames au sol et en vol, rangées par case pour ne parcourir que les cases
// proches de chaque client.
const CELL = 24;
const cellKey = (cx: number, cy: number): number => (cx + 512) * 1024 + (cy + 512);

export class InterestManager {
  private viewers = new Map<string, Viewer>();
  private bladesByOwner = new Map<string, Blade[]>();
  private grid = new Map<number, Blade[]>();
  private entries: PlayerEntry[] = [];
  private entryById = new Map<string, PlayerEntry>();
  private bladeById = new Map<string, Blade>();

  addViewer(client: Client, player: Player): void {
    const view = new StateView();
    view.add(player);
    // Ses propres champs réservés (recul, dernier input acquitté, effets…) :
    // lui seul les reçoit.
    view.add(player, OWNER_VIEW_TAG);
    client.view = view;
    this.viewers.set(client.sessionId, {
      client,
      view,
      playerId: player.id,
      radius: VIEW_RADIUS_DEFAULT,
      cx: player.x,
      cy: player.y,
      players: new Set([player]),
      blades: new Set(),
      playerIds: new Set([player.id]),
      nextPlayers: new Set(),
      nextBlades: new Set(),
    });
  }

  // Reconnexion : nouvelle connexion, nouvelle vue (l'état complet lui est
  // renvoyé) ; le prochain calcul y remet ce qui est visible.
  reattach(client: Client, player: Player): void {
    const radius = this.viewers.get(client.sessionId)?.radius ?? VIEW_RADIUS_DEFAULT;
    this.addViewer(client, player);
    this.viewers.get(client.sessionId)!.radius = radius;
  }

  removeViewer(sessionId: string): void {
    this.viewers.delete(sessionId);
  }

  // Rayon annoncé par le client (ViewMessage), borné : un client modifié
  // n'obtient pas plus qu'un écran de téléphone en portrait.
  setRadius(sessionId: string, r: unknown): void {
    const v = this.viewers.get(sessionId);
    if (!v || typeof r !== "number" || !Number.isFinite(r)) return;
    v.radius = Math.max(VIEW_RADIUS_MIN, Math.min(VIEW_RADIUS_MAX, r));
  }

  update(state: ArenaState): void {
    if (this.viewers.size === 0) return;
    for (const list of this.bladesByOwner.values()) list.length = 0;
    for (const list of this.grid.values()) list.length = 0;
    this.bladeById.clear();
    state.blades.forEach((b) => {
      this.bladeById.set(b.id, b);
      if (b.ownerId) {
        let list = this.bladesByOwner.get(b.ownerId);
        if (!list) this.bladesByOwner.set(b.ownerId, (list = []));
        list.push(b);
      } else {
        const key = cellKey(Math.floor(b.x / CELL), Math.floor(b.y / CELL));
        let list = this.grid.get(key);
        if (!list) this.grid.set(key, (list = []));
        list.push(b);
      }
    });
    this.entries.length = 0;
    this.entryById.clear();
    state.players.forEach((p) => {
      const inBush = !p.revealed && isInBush(p.x, p.y);
      const e: PlayerEntry = { p, x: p.x, y: p.y, reach: reachOf(p), inBush, alive: p.alive, team: p.team };
      this.entries.push(e);
      this.entryById.set(p.id, e);
    });
    for (const v of this.viewers.values()) this.updateViewer(v);
    // Index des propriétaires partis : on n'en garde pas les listes vides.
    if (this.bladesByOwner.size > state.players.size * 2 + 16) {
      for (const [id, list] of this.bladesByOwner) if (list.length === 0) this.bladesByOwner.delete(id);
    }
  }

  private updateViewer(v: Viewer): void {
    const me = this.entryById.get(v.playerId);
    if (!me) return;
    // Mort : la zone reste sur le lieu de la mort (caméra sur le tueur,
    // côté client, tant qu'il y reste visible).
    const cx = me.x;
    const cy = me.y;
    v.cx = cx;
    v.cy = cy;
    const r = v.radius + VIEW_RADIUS_MARGIN;
    const players = v.nextPlayers;
    const blades = v.nextBlades;
    players.clear();
    blades.clear();
    v.playerIds.clear();
    players.add(me.p);
    v.playerIds.add(me.p.id);
    for (const e of this.entries) {
      if (e === me || !e.alive) continue;
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d2 = dx * dx + dy * dy;
      // Un joueur juste hors zone dont l'orbite y entre reste visible.
      const lim = r + e.reach;
      if (d2 > lim * lim) continue;
      // Caché dans un buisson tant que les orbites ne peuvent pas se
      // toucher (même règle que isHiddenFrom, qui sert aux bots), sauf
      // pour ses alliés (modes équipe).
      if (e.inBush && !sameTeam(me.team, e.team)) {
        const reveal = me.reach + e.reach + BUSH_REVEAL_MARGIN;
        if (d2 > reveal * reveal) continue;
      }
      players.add(e.p);
      v.playerIds.add(e.p.id);
    }
    for (const p of players) {
      const owned = this.bladesByOwner.get(p.id);
      if (owned) for (const b of owned) blades.add(b);
    }
    const x0 = Math.floor((cx - r) / CELL);
    const x1 = Math.floor((cx + r) / CELL);
    const y0 = Math.floor((cy - r) / CELL);
    const y1 = Math.floor((cy + r) / CELL);
    const r2 = r * r;
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const list = this.grid.get(cellKey(gx, gy));
        if (!list) continue;
        for (const b of list) {
          const dx = b.x - cx;
          const dy = b.y - cy;
          if (dx * dx + dy * dy <= r2) blades.add(b);
        }
      }
    }

    for (const p of players) {
      if (v.players.has(p)) continue;
      // Retour dans la vue après des changements manqués : Colyseus 0.16
      // (« invisible ») renverrait alors tous ses champs, y compris ceux
      // réservés à son propriétaire (OWNER_VIEW_TAG). Les champs publics
      // repartent de toute façon en entier. À revoir avec Colyseus 0.18 (T.6).
      const tree = p[$changes];
      if (tree) v.view.invisible.delete(tree);
      v.view.add(p);
    }
    for (const p of v.players) {
      // Retiré de l'état entre-temps : l'encodeur transmet la suppression.
      if (!players.has(p) && this.entryById.get(p.id)?.p === p) v.view.remove(p);
    }
    for (const b of blades) if (!v.blades.has(b)) v.view.add(b);
    for (const b of v.blades) {
      if (!blades.has(b) && this.bladeById.get(b.id) === b) v.view.remove(b);
    }
    v.nextPlayers = v.players;
    v.nextBlades = v.blades;
    v.players = players;
    v.blades = blades;
  }

  // Le joueur de ce client voit-il ce joueur ?
  sees(sessionId: string, playerId: string): boolean {
    return this.viewers.get(sessionId)?.playerIds.has(playerId) ?? false;
  }

  // Envoie un évènement aux seuls clients concernés (cf. EventScope).
  send(type: string, message: object, scope: EventScope): void {
    for (const v of this.viewers.values()) {
      if (this.concerns(v, scope)) v.client.send(type, message);
    }
  }

  private concerns(v: Viewer, scope: EventScope): boolean {
    if (scope.to && scope.to.includes(v.playerId)) return true;
    if (scope.players) {
      for (const id of scope.players) if (id && v.playerIds.has(id)) return true;
    }
    if (scope.blade) {
      const b = this.bladeById.get(scope.blade);
      if (b && v.blades.has(b)) return true;
    }
    if (scope.at) {
      const r = v.radius + VIEW_RADIUS_MARGIN;
      const dx = scope.at.x - v.cx;
      const dy = scope.at.y - v.cy;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }
}
