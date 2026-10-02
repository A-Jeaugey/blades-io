import * as THREE from "three";
import { QualityConfig } from "../quality";
import { BladeTrails } from "./BladeTrails";
import { LightColumns } from "./LightColumns";
import { Shards } from "./Shards";
import { Shockwaves, WaveSpec } from "./Shockwaves";
import { SpeedLines } from "./SpeedLines";

// Effets de combat (tâche 4.9), réunis : ondes de choc, éclats de lame,
// colonnes de lumière, traînées des lames, lignes de vitesse. La
// dissolution des corps vit dans PlayerView (elle travaille sur leurs
// matériaux). Budget de chaque effet selon la qualité (q.fx) ; tous suivent
// le réglage des flashs. Un effet n'ajoute que de la lumière par-dessus la
// scène et s'éteint vite : il ne cache ni une lame ni un joueur.

// Clash : petit anneau à hauteur des lames, plus grand si une lame casse.
const CLASH_WAVE: WaveSpec = { radius: 1.6, width: 0.3, alpha: 0.5, duration: 0.28 };
// Élimination : large anneau au sol, doublé en haute qualité.
const KILL_WAVE: WaveSpec = { radius: 7, width: 0.9, alpha: 0.6, duration: 0.55 };
const KILL_ECHO: WaveSpec = { radius: 4.5, width: 0.4, alpha: 0.45, duration: 0.45 };
// Palier : au pied de la colonne.
const TIER_WAVE: WaveSpec = { radius: 4.2, width: 0.6, alpha: 0.55, duration: 0.5 };
const BLADE_Y = 0.9;
const GROUND_Y = 0.06;

export class CombatFx {
  readonly object = new THREE.Group();
  readonly trails: BladeTrails;
  readonly speedLines: SpeedLines;
  private shockwaves: Shockwaves;
  private shards: Shards;
  private columns: LightColumns;
  private readonly rich: boolean;
  private clashWave: WaveSpec = { ...CLASH_WAVE };
  // Préchauffage : à la première frame (au lobby), chaque effet dessine une
  // instance invisible (sous le sol, de taille ou d'opacité nulle). Son
  // shader se compile et son pipeline se prépare au chargement, et non au
  // premier clash : en rendu logiciel, à-coup de 50 à 230 ms mesuré à la
  // première élimination ; certains pilotes ne préparent aussi le pipeline
  // qu'au premier vrai dessin.
  private warm = true;

  constructor(q: QualityConfig) {
    const budget = q.fx;
    this.rich = budget.detail === "rich";
    this.shockwaves = new Shockwaves(budget);
    this.shards = new Shards(budget);
    this.columns = new LightColumns(budget);
    this.trails = new BladeTrails(budget);
    this.speedLines = new SpeedLines(budget);
    this.object.add(
      this.shockwaves.object,
      this.shards.object,
      this.columns.object,
      this.trails.object,
      this.speedLines.object,
    );
    this.object.matrixAutoUpdate = false;
  }

  // Clash entre deux lames en (x, z) : tier, le plus haut des deux ;
  // destroyed, lames brisées (0 à 2).
  clash(x: number, z: number, tier: number, destroyed: number, color: number): void {
    const w = this.clashWave;
    const k = destroyed > 0 ? 1.3 : 1;
    w.radius = (CLASH_WAVE.radius + Math.min(tier, 5) * 0.2) * k;
    w.alpha = CLASH_WAVE.alpha * (destroyed > 0 ? 1.2 : 1);
    this.shockwaves.spawn(x, BLADE_Y, z, color, w);
  }

  // Lame brisée en (x, z), projetée selon (dirX, dirZ).
  shatter(x: number, z: number, color: number, dirX: number, dirZ: number): void {
    this.shards.burst(x, z, color, dirX, dirZ);
  }

  // Joueur éliminé en (x, z).
  kill(x: number, z: number, color: number): void {
    this.shockwaves.spawn(x, GROUND_Y, z, color, KILL_WAVE);
    if (this.rich) this.shockwaves.spawn(x, GROUND_Y + 0.01, z, color, KILL_ECHO, 0.09);
  }

  // Palier atteint par un joueur.
  tierUp(playerId: string, x: number, z: number, tier: number, color: number): void {
    this.columns.spawn(playerId, x, z, tier, color);
    this.shockwaves.spawn(x, GROUND_Y, z, color, TIER_WAVE);
  }

  setFlashIntensity(k: number): void {
    this.shockwaves.setFlashIntensity(k);
    this.shards.setFlashIntensity(k);
    this.columns.setFlashIntensity(k);
    this.trails.setFlashIntensity(k);
    this.speedLines.setFlashIntensity(k);
  }

  // Après l'update des lames (qui alimente les traînées). now :
  // performance.now() ; posOf : position de rendu d'un joueur.
  update(dt: number, now: number, posOf: (id: string) => { x: number; z: number } | undefined): void {
    if (this.warm) {
      this.warm = false;
      this.shockwaves.prime();
      this.shards.prime();
      this.columns.prime();
      this.trails.prime(now);
      this.speedLines.prime();
    }
    this.shockwaves.update(dt);
    this.shards.update(dt);
    this.columns.update(dt, posOf);
    this.trails.finish(now);
    this.speedLines.update(dt);
  }

  clear(): void {
    this.shockwaves.clear();
    this.shards.clear();
    this.columns.clear();
    this.trails.clear();
    this.speedLines.clear();
  }
}
