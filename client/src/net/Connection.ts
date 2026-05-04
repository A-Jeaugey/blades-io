import { Client, Room } from "colyseus.js";

export type RoomState = any;

// Erreur jetée quand client.join() échoue parce qu'aucune room ne matche
// le code fourni (cf. opts.mustExist). main.ts attrape ce type pour
// afficher un message clair à l'user au lieu d'un retry réseau.
export class RoomNotFoundError extends Error {
  constructor(public readonly code: string) {
    super(`No private room found with code "${code}"`);
    this.name = "RoomNotFoundError";
  }
}

// Heuristique : Colyseus retourne soit un MatchMakeError avec un code
// précis, soit une erreur dont le message contient "no rooms found".
// On capture les deux variantes pour rester robuste aux mises à jour
// de la lib.
function isNoRoomFoundError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: number; message?: string };
  // MatchMakeError code 4212 = ERR_MATCHMAKE_INVALID_CRITERIA / no match.
  if (err.code === 4212) return true;
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("no rooms found") || msg.includes("matchmake");
}

export class Connection {
  private client: Client;
  public room: Room<RoomState> | null = null;
  private reconnectAttempts = 0;

  constructor(endpoint: string) {
    this.client = new Client(endpoint);
  }

  // opts.code : "" pour public, 5 chars pour private. Grâce au filterBy
  // côté serveur, joinOrCreate("arena", { code: "ABC12" }) retrouve LA
  // room privée qui existe avec ce code, ou en crée une.
  // opts.mustExist : si true, on utilise client.join() (failfast) au lieu
  //   de joinOrCreate. Utilisé par le mode JOIN CODE — un user qui tape
  //   un code ne doit PAS provoquer la création d'une nouvelle room s'il
  //   se trompe de code (sinon il se retrouve seul dans une room neuve
  //   en pensant avoir rejoint celle de quelqu'un d'autre).
  // opts.bots : override bots enabled (sinon default serveur : true en
  // public, false en privé).
  // opts.token : JWT Supabase. Si présent, la room appelle onAuth, valide
  // le token, et stocke userId sur le Player → score persisté à la mort.
  // opts.guestToken : token guest signé (HMAC) pour les joueurs non
  // authentifiés. Sans aucun des deux, le joueur joue mais ses trophées
  // ne sont pas trackés.
  async join(
    name: string,
    opts: {
      code?: string;
      bots?: boolean;
      token?: string;
      guestToken?: string | null;
      mustExist?: boolean;
    } = {},
  ): Promise<Room<RoomState>> {
    const maxAttempts = 3;
    let backoff = 500;
    // code TOUJOURS envoyé (string vide = public). Si on l'omet, filterBy
    // l'ignore dans la requête matchmaker → un client public peut
    // matcher une room privée (et vice-versa). En forçant code = "" pour
    // le public, l'égalité stricte du filtre garantit l'isolation.
    const joinOpts: any = { name, code: (opts.code ?? "").toUpperCase() };
    if (opts.bots !== undefined) joinOpts.bots = opts.bots;
    if (opts.token) joinOpts.token = opts.token;
    else if (opts.guestToken) joinOpts.guestToken = opts.guestToken;
    while (this.reconnectAttempts < maxAttempts) {
      try {
        // mustExist=true (mode JOIN CODE) → client.join() qui throw si
        // aucune room ne matche le filterBy. Sinon → joinOrCreate
        // classique qui crée une room privée à la demande pour CREATE
        // et matche la lobby publique pour le mode public.
        const room = opts.mustExist
          ? await this.client.join<RoomState>("arena", joinOpts)
          : await this.client.joinOrCreate<RoomState>("arena", joinOpts);
        this.room = room;
        this.reconnectAttempts = 0;
        return room;
      } catch (e) {
        // En mode JOIN CODE, on NE retry PAS sur "no room found" — c'est
        // une erreur définitive (l'user a tapé un mauvais code), pas un
        // hoquet réseau. Le retry ne ferait que masquer l'erreur réelle
        // pendant 1.5s avant de finalement la propager.
        if (opts.mustExist && isNoRoomFoundError(e)) {
          throw new RoomNotFoundError(joinOpts.code);
        }
        this.reconnectAttempts++;
        if (this.reconnectAttempts >= maxAttempts) throw e;
        await new Promise((r) => setTimeout(r, backoff));
        backoff *= 2;
      }
    }
    throw new Error("Could not join arena");
  }

  // Réutilisé par main.ts quand room.onLeave fire avec un code non-consent
  // (1006 typiquement). Combiné avec allowReconnection côté serveur, ça
  // absorbe les hoquets réseau sans renvoyer l'utilisateur au menu.
  async reconnect(token: string): Promise<Room<RoomState>> {
    const room = await this.client.reconnect(token);
    this.room = room;
    return room;
  }

  async leave(): Promise<void> {
    const r = this.room;
    this.room = null;
    if (!r) return;
    // Await la fermeture effective : sinon en prod (proxy Caddy), le close
    // peut traîner et ses callbacks fire après qu'une nouvelle session ait
    // démarré → race condition. On bloque pendant ~50-200ms le temps de
    // l'aller-retour close, on retourne ensuite. Catch large (timeout +
    // erreur réseau + tout le reste) pour ne pas bloquer un retour menu.
    try {
      await Promise.race([
        r.leave(true),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch { /* noop */ }
  }
}

export function resolveServerEndpoint(): string {
  const override = (import.meta as any).env?.VITE_SERVER_URL as string | undefined;
  if (override) return override;
  const { protocol, hostname } = window.location;
  const wsProto = protocol === "https:" ? "wss:" : "ws:";
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${wsProto}//${hostname}:2567`;
  }
  const baseUrl = ((import.meta as any).env?.BASE_URL as string | undefined) ?? "/";
  const basePath = baseUrl.replace(/\/$/, "");
  return `${wsProto}//${hostname}${basePath}`;
}
