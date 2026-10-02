import { applyThemeCss } from "./themes";
import { applyI18n, t } from "./i18n";
import { LoginResult, LoginScreen } from "./ui/LoginScreen";
import { SettingsPanel } from "./ui/Settings";
import { ProfilePanel } from "./ui/ProfilePanel";
import { Onboarding } from "./ui/Onboarding";
import { showAlert } from "./ui/Dialog";
import { SoundManager } from "./audio/SoundManager";
import { bindBoutiqueButton } from "./boutique/entry";
import { auth } from "./auth/supabase";
import { ensureGuestToken } from "./auth/guestToken";
import type { Game, LobbyParts } from "./main";

// Point d'entrée de la page (tâche 2.7). Le lobby se monte tout de suite :
// formulaire, réglages, profil, aide, boutique et musique. Le moteur du jeu
// (three.js, Colyseus, scène et entités, main.ts) se charge en parallèle,
// le temps de choisir son pseudo ; avant, tout arrivait d'un seul bloc de
// 1,5 Mo, avant le premier clic possible.

// Téléchargement du moteur lancé avant tout le reste : il avance pendant la
// construction du lobby (la détection du GPU des réglages, entre autres).
const engineModule = import("./main");

// Variables CSS du thème et textes de la langue avant toute interface : les
// écrans créés ensuite prennent les bonnes couleurs dès leur premier rendu.
applyThemeCss();
applyI18n();
bindBoutiqueButton();

const sound = new SoundManager();
// Bloquée tant que le joueur n'a pas interagi : SoundManager retente au
// premier geste.
void sound.playLobbyMusic();
const settings = new SettingsPanel();
const profile = new ProfilePanel();
void profile.refreshBadge();
// Tactile ou non : d'après le pointeur, jusqu'à ce que le jeu suive le
// dernier périphérique utilisé.
const touch = { source: () => matchMedia("(pointer: coarse)").matches };
const onboarding = new Onboarding(() => touch.source());
// Jeton invité préparé dès l'arrivée : le transfert des trophées à la
// connexion et le crédit d'une partie en invité en ont besoin. Sans
// réponse du serveur, on continue sans.
if (!auth.getAccessToken()) void ensureGuestToken();

let game: Game | null = null;
let waiting = false;
const login = new LoginScreen((res) => void enter(res));
const parts: LobbyParts = { login, settings, profile, onboarding, sound, touch };
const engine = engineModule.then((m) => (game = new m.Game(parts)));
engine.catch((e) => console.warn("[blade.io] game failed to load", e));

// Entrée en partie ; si le moteur arrive encore, le bouton l'indique et
// on l'attend.
async function enter(res: LoginResult): Promise<void> {
  if (game) return void game.start(res);
  if (waiting) return;
  waiting = true;
  login.setStarting(true);
  try {
    const g = await engine;
    login.setStarting(false);
    void g.start(res);
  } catch {
    // Un import raté reste en échec jusqu'au rechargement de la page.
    await showAlert(t("lobby.loadFailed"));
    location.reload();
  } finally {
    waiting = false;
  }
}
