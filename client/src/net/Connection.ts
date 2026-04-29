import { Client, Room } from "colyseus.js";

export type RoomState = any;

export class Connection {
  private client: Client;
  public room: Room<RoomState> | null = null;
  private reconnectAttempts = 0;

  constructor(endpoint: string) {
    this.client = new Client(endpoint);
  }

  // opts.code : "" pour public, 5 chars pour private. Grâce au filterBy
  // côté serveur, un joinOrCreate avec code = "ABC12" retrouve (ou crée)
  // LA room privée avec ce code.
  // opts.bots : override bots enabled (sinon default serveur : true en
  // public, false en privé).
  async join(
    name: string,
    opts: { code?: string; bots?: boolean } = {},
  ): Promise<Room<RoomState>> {
    const maxAttempts = 3;
    let backoff = 500;
    const joinOpts: any = { name };
    if (opts.code !== undefined) joinOpts.code = opts.code.toUpperCase();
    if (opts.bots !== undefined) joinOpts.bots = opts.bots;
    while (this.reconnectAttempts < maxAttempts) {
      try {
        const room = await this.client.joinOrCreate<RoomState>("arena", joinOpts);
        this.room = room;
        this.reconnectAttempts = 0;
        return room;
      } catch (e) {
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
