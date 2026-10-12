import {
  MatchPhase,
  MatchStanding,
  RANKED_LEAVE_PR,
  RANKED_MIN_PRESENCE_MS,
  RankedDelta,
  RankedResultEvent,
  rankedDelta,
  roundPresence,
} from "@bladeio/shared";
import type { Player } from "../state/Player";
import { applyRankedDelta, getRankedStatus } from "../ranked";
import { restartDeadline, trackWrite } from "../shutdown";
import { RoundsMode } from "./rounds";

// Mode classé (retours du 2026-10-12) : les règles des manches (5 minutes,
// arène qui se resserre, podium, réapparitions, bots), plus des points de
// rang (shared/src/ranked.ts) pour les comptes, dans la file publique
// seulement (rien ne compte en salon privé). Le gain dépend du score de la
// manche face à l'attente du rang du joueur ; quitter une manche commencée
// depuis plus d'une minute coûte la pire défaite.
export class RankedMode extends RoundsMode {
  readonly id = "ranked" as const;
  // Début de la présence de chaque humain dans la manche en cours : son
  // arrivée, ou le début de la manche s'il était déjà là.
  private presentSince = new Map<string, number>();
  // PR de chaque compte : lus en base à l'arrivée (null tant qu'ils ne sont
  // pas connus, ou si la base ne répond pas), suivis à chaque manche.
  private prs = new Map<string, number | null>();

  onJoin(p: Player): void {
    super.onJoin(p);
    if (p.isBot) return;
    this.presentSince.set(p.id, Date.now());
    if (!p.userId || this.host.isPrivate) return;
    // Lu sans retarder l'arrivée : la fin de la manche est loin.
    this.prs.set(p.id, null);
    void getRankedStatus(p.userId).then((s) => {
      if (this.prs.has(p.id)) this.prs.set(p.id, s ? s.pr : null);
    });
  }

  onMatchStart(now: number): void {
    super.onMatchStart(now);
    // Tous les présents commencent la manche ensemble ; les partis (et les
    // entrées sans départ connu) disparaissent.
    const next = new Map<string, number>();
    this.host.state.players.forEach((p) => {
      if (!p.isBot) next.set(p.id, now);
    });
    this.presentSince = next;
  }

  // Départ définitif (retour au menu, onglet fermé, connexion perdue sans
  // retour, expulsion) : en pleine manche, après plus d'une minute de jeu,
  // c'est une défaite. Pas pendant l'entracte, ni à l'arrêt du serveur.
  onLeave(p: Player): void {
    const since = this.presentSince.get(p.id);
    const pr = this.prs.get(p.id);
    this.presentSince.delete(p.id);
    this.prs.delete(p.id);
    if (p.isBot || !p.userId || this.host.isPrivate) return;
    if (pr == null || since === undefined) return;
    if (this.host.state.phase !== MatchPhase.Playing || restartDeadline() > 0) return;
    if (Date.now() - since < RANKED_MIN_PRESENCE_MS) return;
    trackWrite(applyRankedDelta(p.userId, RANKED_LEAVE_PR));
  }

  // Fin de manche : chaque humain encore là reçoit son résultat (PR, ou la
  // raison de leur absence). Le gain part de ses PR et de son rang (bots
  // compris), au prorata du temps joué s'il est arrivé en cours de manche.
  onMatchEnd(standings: readonly MatchStanding[], now: number): void {
    if (this.host.isPrivate) return;
    standings.forEach((row, rank) => {
      if (row.bot) return;
      const p = this.host.state.players.get(row.id);
      if (!p) return;
      const send = (ev: RankedResultEvent) => this.host.sendTo(p.id, "rankedResult", ev);
      if (!p.userId) return send({ status: "guest" });
      const played = now - (this.presentSince.get(p.id) ?? now);
      if (played < RANKED_MIN_PRESENCE_MS) return send({ status: "late" });
      const pr = this.prs.get(p.id);
      if (pr == null) return send({ status: "unavailable" });
      const d = rankedDelta({ pr, score: row.score, rank, presence: roundPresence(played) });
      trackWrite(this.settle(p, p.userId, d, row.score));
    });
  }

  // Écriture en base, puis le résultat au joueur : les PR affichés sont ceux
  // que la base a enregistrés, jamais un calcul qui n'aurait pas été écrit.
  private async settle(p: Player, userId: string, d: RankedDelta, score: number): Promise<void> {
    const res = await applyRankedDelta(userId, d.delta);
    const here = this.prs.has(p.id);
    if (!res) {
      if (here) this.host.sendTo(p.id, "rankedResult", { status: "unavailable" } satisfies RankedResultEvent);
      return;
    }
    if (!here) return;
    this.prs.set(p.id, res.after);
    const ev: RankedResultEvent = {
      status: "scored",
      before: res.before,
      after: res.after,
      score,
      expected: d.expected,
      podium: d.podium,
      season: res.season,
    };
    this.host.sendTo(p.id, "rankedResult", ev);
  }
}
