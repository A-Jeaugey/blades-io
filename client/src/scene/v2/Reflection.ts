import * as THREE from "three";

// Reflet du monde dans les flaques (rendu v2, qualité haute) : la scène est
// rendue une seconde fois, à demi-résolution, par une caméra symétrique de
// la vraie par rapport au sol. Le sol lit ensuite cette image aux
// coordonnées projetées de chacun de ses points (GroundV2.ts) : un obélisque
// se retrouve tête en bas dans la flaque à son pied, les lames aussi.
//
// La cible est du même genre que celle de la scène (demi-flottants, espace
// linéaire) : les matériaux y gardent leurs programmes, rien ne se compile.

// Part de la résolution du canvas.
const RESOLUTION = 0.5;

const BIAS = new THREE.Matrix4().set(
  0.5, 0, 0, 0.5,
  0, 0.5, 0, 0.5,
  0, 0, 0.5, 0.5,
  0, 0, 0, 1,
);

export class GroundReflection {
  // Image du reflet, matrice monde -> coordonnées de cette image, et force
  // (0 : pas de reflet, l'image n'est pas à jour).
  readonly uniforms: {
    uGRefl: THREE.IUniform<THREE.Texture>;
    uGReflMat: THREE.IUniform<THREE.Matrix4>;
    uGReflK: THREE.IUniform<number>;
  };
  // Ce qui ne doit pas se refléter : le sol lui-même (il lit l'image
  // pendant qu'on la dessine), la météo.
  readonly hidden: THREE.Object3D[] = [];

  private readonly target: THREE.WebGLRenderTarget;
  private readonly mirror = new THREE.PerspectiveCamera();
  private readonly size = new THREE.Vector2();
  private readonly eye = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly wasVisible: boolean[] = [];

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly strength: number) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    // Niveaux réduits : un sol rugueux lit le reflet flou (DistrictView.ts).
    this.target.texture.generateMipmaps = true;
    this.target.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.target.texture.magFilter = THREE.LinearFilter;
    this.uniforms = {
      uGRefl: { value: this.target.texture },
      uGReflMat: { value: new THREE.Matrix4() },
      uGReflK: { value: 0 },
    };
  }

  // À appeler juste avant le rendu de la scène. active faux (mode allégé du
  // moniteur de fluidité) : pas de second rendu, le sol n'affiche plus de
  // reflet.
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, active: boolean): void {
    this.uniforms.uGReflK.value = active ? this.strength : 0;
    if (!active) return;
    const renderer = this.renderer;
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(this.size.x * RESOLUTION));
    const h = Math.max(1, Math.round(this.size.y * RESOLUTION));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    // Caméra symétrique : œil, point regardé et haut passés sous le sol
    // (plan y = 0). C'est une vraie caméra (pas une image retournée) : le
    // sens des faces ne change pas.
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    this.eye.set(e[12], -e[13], e[14]);
    this.look.set(e[12] - e[8], -(e[13] - e[9]), e[14] - e[10]);
    this.up.set(e[4], -e[5], e[6]);
    const m = this.mirror;
    m.position.copy(this.eye);
    m.up.copy(this.up);
    m.lookAt(this.look);
    // Recalcule aussi matrixWorldInverse.
    m.updateMatrixWorld(true);
    m.projectionMatrix.copy(camera.projectionMatrix);
    m.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.uniforms.uGReflMat.value.multiplyMatrices(BIAS, m.projectionMatrix).multiply(m.matrixWorldInverse);

    for (let i = 0; i < this.hidden.length; i++) {
      this.wasVisible[i] = this.hidden[i].visible;
      this.hidden[i].visible = false;
    }
    // Les ombres de la frame précédente suffisent : pas de second rendu de
    // la carte d'ombres.
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, m);
    renderer.setRenderTarget(previous);
    renderer.shadowMap.autoUpdate = shadowAuto;
    for (let i = 0; i < this.hidden.length; i++) this.hidden[i].visible = this.wasVisible[i];
  }
}
