import * as THREE from "three";
import kitUrl from "../../assets3d/cyber_kit.glb?url";
import { GFX_V2_REQUESTED } from "../../gfx";
import { QualityConfig } from "../../quality";
import { getActiveTheme } from "../../themes";

// Kit de modèles du rendu v2, généré par art/kit/build_kit.py (Blender).
// Chaque pièce est une suite de morceaux, un par matériau ; le matériau du
// fichier ne sert qu'à nommer un RÔLE (« body », « e_neon »…) : les couleurs
// viennent du thème actif (scene/v2/DecorV2.ts), jamais du fichier.
export interface KitPart {
  geometry: THREE.BufferGeometry;
  role: string;
  // Masque d'émission du fichier (grille de LED des racks), s'il y en a un.
  emissiveMap: THREE.Texture | null;
}

export interface Kit {
  parts(name: string): KitPart[];
  // Pièce à un seul matériau (corps des joueurs).
  geometry(name: string): THREE.BufferGeometry;
}

let kit: Kit | null = null;

// Chargé avant la construction du moteur (preloadGraphics, main.ts) : le
// décor, les joueurs d'échantillon du préchauffage des shaders et le sol en
// ont besoin dès le constructeur de Game.
export async function loadKit(): Promise<void> {
  // Le lecteur de glTF n'arrive qu'avec le kit : sans ?gfx=v2, le moteur ne
  // pèse pas un octet de plus.
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(kitUrl);
  const pieces = new Map<string, KitPart[]>();
  for (const node of gltf.scene.children) {
    const parts: KitPart[] = [];
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      parts.push({ geometry: mesh.geometry, role: mat.name, emissiveMap: mat.emissiveMap ?? null });
    });
    pieces.set(node.name, parts);
  }
  kit = {
    parts(name) {
      const p = pieces.get(name);
      if (!p) throw new Error(`kit : pièce « ${name} » absente`);
      return p;
    },
    geometry(name) {
      return this.parts(name)[0].geometry;
    },
  };
}

export function getKit(): Kit | null {
  return kit;
}

// Le rendu v2 remplace-t-il l'ancien ? Demandé par l'adresse, kit chargé,
// matériaux éclairés (qualités haute et moyenne : en basse et potato, tout
// est en MeshBasic, sans lumière ni ombre) et thème de la famille « cyber »
// (le kit n'a pas encore les pièces du Sanctuaire).
export function gfxV2Active(q: QualityConfig): boolean {
  return kitFor(q.simpleMaterials) !== null;
}

// Le kit si le rendu v2 est actif, null sinon. Pour les modules qui ne
// reçoivent que simpleMaterials (lames, power-ups, aperçu de la boutique).
export function kitFor(simpleMaterials: boolean): Kit | null {
  return GFX_V2_REQUESTED && kit !== null && !simpleMaterials && getActiveTheme().decor.kind === "cyber" ? kit : null;
}
