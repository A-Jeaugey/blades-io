import * as THREE from "three";

// Shaders compilés d'avance, au lobby. Sans ça, chaque objet d'un genre
// nouveau à l'écran (caisse, power-up, lames d'un joueur qui entre dans le
// champ…) compilait le sien à sa première image : sous Windows (ANGLE passe
// par Direct3D), de 50 à 300 ms de gel par shader, le « ça bug dès que
// quelqu'un arrive » des machines modestes.
//
// Deux temps :
//  1. compile() de three.js crée tous les programmes d'un coup. Avec
//     KHR_parallel_shader_compile (Chrome, Edge, Opera, Firefox), le pilote
//     les compile en parallèle, sans bloquer la page.
//  2. Chaque programme prêt est utilisé une première fois (lecture de ses
//     uniforms et attributs : des allers-retours synchrones avec le GPU,
//     quelques millisecondes par programme), quelques-uns par image dans
//     la limite d'un budget, pendant que le joueur est au menu.
//
// Un programme reste en cache tant qu'un matériau vivant l'utilise : les
// échantillons (joueurs, caisses…) gardés par l'appelant le retiennent.
// Sinon, le dernier joueur d'un genre sorti du champ emportait le shader,
// recompilé à l'arrivée du suivant.

interface WarmProgram {
  isReady(): boolean;
  getUniforms(): unknown;
  getAttributes(): unknown;
}

export class ShaderWarmup {
  private pending: WarmProgram[] = [];

  // target : la cible où la scène est rendue (null : l'écran). La sortie
  // d'un matériau dépend de sa destination, donc son programme aussi.
  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    target: THREE.WebGLRenderTarget | null,
  ) {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const materials = renderer.compile(scene, camera);
    renderer.setRenderTarget(previous);
    const seen = new Set<WarmProgram>();
    for (const m of materials) {
      const programs = renderer.properties.get(m).programs as Map<string, WarmProgram> | undefined;
      if (!programs) continue;
      for (const p of programs.values()) {
        if (seen.has(p)) continue;
        seen.add(p);
        this.pending.push(p);
      }
    }
  }

  get done(): boolean {
    return this.pending.length === 0;
  }

  // À chaque image : première utilisation des programmes prêts, dans la
  // limite de budgetMs.
  step(budgetMs: number): void {
    if (this.pending.length === 0) return;
    const start = performance.now();
    let write = 0;
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      if (performance.now() - start < budgetMs && p.isReady()) {
        p.getUniforms();
        p.getAttributes();
      } else {
        this.pending[write++] = p;
      }
    }
    this.pending.length = write;
  }
}
