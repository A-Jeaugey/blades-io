import * as THREE from "three";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";

// Traînée du joueur local (tâche 2.6) : ruban au sol qui couvre toujours
// les TRAIL_MS dernières millisecondes de déplacement, échantillonné dans
// le temps et non à chaque frame. Avant, une ligne de 1 px de N points pris
// toutes les ~30 ms de frames : plus longue quand le FPS tombait.
const TRAIL_MS = 400;
const TRAIL_SAMPLE_MS = 16;
const TRAIL_SAMPLES = Math.ceil(TRAIL_MS / TRAIL_SAMPLE_MS) + 2;
const TRAIL_HALF_WIDTH = 0.32;
const TRAIL_ALPHA = 0.7;
const TRAIL_Y = 0.05;
// Saut d'une frame à l'autre au-delà duquel la traînée repart de zéro
// (apparition, recalage) : sinon un long trait relierait les deux points.
const TRAIL_JUMP = 6;

export class PlayerView {
  root: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  ring: THREE.Mesh;
  protHalo!: THREE.Mesh | null;
  private protPhase = 0;
  private protected_ = false;
  trail: THREE.Mesh | THREE.Group;
  // Sous-ensembles pour l'animation. Null si playerDetail = "minimal".
  private leftLeg: THREE.Mesh | null = null;
  private rightLeg: THREE.Mesh | null = null;
  private leftArm: THREE.Mesh | null = null;
  private rightArm: THREE.Mesh | null = null;

  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private walkPhase = 0;
  // Échantillons de la traînée, du plus récent au plus ancien (horloge
  // propre en ms, avancée par dt).
  private trailX = new Float64Array(TRAIL_SAMPLES);
  private trailZ = new Float64Array(TRAIL_SAMPLES);
  private trailT = new Float64Array(TRAIL_SAMPLES);
  private trailCount = 0;
  private trailClock = 0;
  private trailHeadX = 0;
  private trailHeadZ = 0;
  private trailColor = new THREE.Color();
  // Points du ruban de la frame : x, z, âge (ms).
  private trailPts = new Float64Array((TRAIL_SAMPLES + 2) * 3);
  private prevRenderX = 0;
  private prevRenderY = 0;
  public renderX = 0;
  public renderY = 0;
  public targetX = 0;
  public targetY = 0;
  public prevX = 0;
  public prevY = 0;
  public prevTime = 0;
  public targetTime = 0;
  private hasTrail: boolean;

  constructor(isLocal: boolean, q: QualityConfig) {
    this.root = new THREE.Group();
    const simpleMaterials = q.simpleMaterials;
    const detail = q.playerDetail;
    this.hasTrail = q.playerTrail && isLocal;

    // Palette joueur tirée du thème actif : local vs remote différenciés
    // pour la lecture instantanée. Chaque thème définit ses propres teintes
    // (cf. themes/Theme.ts → palette.playerLocal/playerRemote).
    const t = getActiveTheme();
    const primary = isLocal ? t.palette.playerLocal.primary : t.palette.playerRemote.primary;
    const accent = isLocal ? t.palette.playerLocal.accent : t.palette.playerRemote.accent;
    const accentDim = isLocal ? t.palette.playerLocal.accentDim : t.palette.playerRemote.accentDim;

    const mkMat = (color: number, emissive: number, intensity: number) =>
      simpleMaterials
        ? new THREE.MeshBasicMaterial({ color: emissive })
        : new THREE.MeshStandardMaterial({
            color,
            emissive,
            emissiveIntensity: intensity,
            metalness: 0.35,
            roughness: 0.35,
          });

    // Tronc — segments capsule réduits selon detail.
    const torsoCapSeg = detail === "rich" ? 6 : detail === "low" ? 4 : 4;
    const torsoRadSeg = detail === "rich" ? 3 : 2;
    const torsoGeo = new THREE.CapsuleGeometry(0.28, 0.55, torsoRadSeg, torsoCapSeg);
    const torsoMat = mkMat(primary, accentDim, 0.5);
    this.body = new THREE.Mesh(torsoGeo, torsoMat);
    this.body.position.y = 0.95;
    this.root.add(this.body);
    this.disposables.push(torsoGeo, torsoMat);

    // Tête — sphère segments selon detail.
    const headSeg = detail === "rich" ? 14 : detail === "low" ? 8 : 6;
    const headRingSeg = Math.max(6, headSeg - 4);
    const headGeo = new THREE.SphereGeometry(0.26, headSeg, headRingSeg);
    const headMat = mkMat(primary, accentDim, 0.4);
    this.head = new THREE.Mesh(headGeo, headMat);
    this.head.position.y = 1.55;
    this.root.add(this.head);
    this.disposables.push(headGeo, headMat);

    // Membres — uniquement en rich/low. En minimal (ultra), on n'ajoute pas
    // les bras/jambes : le corps + tête suffit.
    if (detail !== "minimal") {
      const armCapSeg = detail === "rich" ? 6 : 4;
      const armRadSeg = detail === "rich" ? 3 : 2;
      const armGeo = new THREE.CapsuleGeometry(0.09, 0.45, armRadSeg, armCapSeg);
      const armMat = mkMat(primary, accentDim, 0.45);
      this.leftArm = new THREE.Mesh(armGeo, armMat);
      this.rightArm = new THREE.Mesh(armGeo, armMat);
      this.leftArm.position.set(-0.38, 1.05, 0);
      this.rightArm.position.set(0.38, 1.05, 0);
      this.root.add(this.leftArm);
      this.root.add(this.rightArm);
      this.disposables.push(armGeo, armMat);

      const legCapSeg = detail === "rich" ? 6 : 4;
      const legRadSeg = detail === "rich" ? 3 : 2;
      const legGeo = new THREE.CapsuleGeometry(0.12, 0.5, legRadSeg, legCapSeg);
      const legMat = mkMat(primary, accentDim, 0.35);
      this.leftLeg = new THREE.Mesh(legGeo, legMat);
      this.rightLeg = new THREE.Mesh(legGeo, legMat);
      this.leftLeg.position.set(-0.14, 0.35, 0);
      this.rightLeg.position.set(0.14, 0.35, 0);
      this.root.add(this.leftLeg);
      this.root.add(this.rightLeg);
      this.disposables.push(legGeo, legMat);
    }

    // Anneau néon au sol (cercle d'ancrage). Segments réduits en low/ultra.
    const ringSeg = detail === "rich" ? 32 : detail === "low" ? 20 : 16;
    const ringGeo = new THREE.RingGeometry(0.55, 0.72, ringSeg);
    const ringMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.root.add(this.ring);
    this.disposables.push(ringGeo, ringMat);

    // Halo de spawn protection : optionnel selon q.playerHalo.
    if (q.playerHalo) {
      const protSeg = detail === "rich" ? 36 : 20;
      const protGeo = new THREE.RingGeometry(1.0, 1.6, protSeg);
      const protMat = new THREE.MeshBasicMaterial({
        color: t.palette.playerLocal.accent,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
      });
      this.protHalo = new THREE.Mesh(protGeo, protMat);
      this.protHalo.rotation.x = -Math.PI / 2;
      this.protHalo.position.y = 0.04;
      this.protHalo.visible = false;
      this.root.add(this.protHalo);
      this.disposables.push(protGeo, protMat);
    } else {
      this.protHalo = null;
    }

    // Trail (world space). Si désactivé, on crée un Group vide (pour ne pas
    // changer l'API du PlayerView : main.ts ajoute trail à la scène, et c'est
    // OK qu'il soit vide).
    if (this.hasTrail) {
      // Deux sommets par point (tête, échantillons, bout interpolé) ; alpha
      // par sommet (couleur RGBA).
      const points = TRAIL_SAMPLES + 2;
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      trailGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(points * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage));
      const index: number[] = [];
      for (let i = 0; i < points - 1; i++) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      trailGeo.setIndex(index);
      trailGeo.setDrawRange(0, 0);
      const trailMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.trailColor.set(accent);
      const ribbon = new THREE.Mesh(trailGeo, trailMat);
      ribbon.frustumCulled = false;
      this.trail = ribbon;
      this.disposables.push(trailGeo, trailMat);
    } else {
      this.trail = new THREE.Group();
    }
  }

  setSnapshot(x: number, y: number, now: number): void {
    if (x === this.targetX && y === this.targetY) return;
    this.prevX = this.targetX;
    this.prevY = this.targetY;
    this.prevTime = this.targetTime;
    this.targetX = x;
    this.targetY = y;
    this.targetTime = now;
  }

  interpolate(now: number, renderDelay: number): void {
    const renderTime = now - renderDelay;
    const span = this.targetTime - this.prevTime;
    if (span <= 0) {
      this.renderX = this.targetX;
      this.renderY = this.targetY;
    } else {
      // Lerp linéaire : vélocité constante dans un segment, discontinue à
      // chaque transition de snapshot. Sur écran 240+Hz les kinks sont
      // visibles ("pas fluide" malgré 480fps). Le vrai fix demanderait
      // de stocker 3+ snapshots et faire Catmull-Rom (continuité de
      // vélocité). Smoothstep n'est pas la solution : il met la vélocité
      // à 0 aux extrémités → micro stop-and-go pire que les kinks.
      const alpha = Math.max(0, Math.min(1, (renderTime - this.prevTime) / span));
      this.renderX = this.prevX + (this.targetX - this.prevX) * alpha;
      this.renderY = this.prevY + (this.targetY - this.prevY) * alpha;
    }
    this.root.position.set(this.renderX, 0, this.renderY);
  }

  setLocalRender(x: number, y: number): void {
    this.renderX = x;
    this.renderY = y;
    this.root.position.set(x, 0, y);
  }

  get isProtectedShown(): boolean {
    return this.protected_;
  }

  setProtected(active: boolean): void {
    if (this.protected_ === active) return;
    this.protected_ = active;
    if (this.protHalo) {
      this.protHalo.visible = active;
      if (!active) (this.protHalo.material as THREE.MeshBasicMaterial).opacity = 0;
    }
  }

  animate(dt: number): void {
    if (this.protected_ && this.protHalo) {
      this.protPhase += dt * 4.5;
      const o = 0.25 + (Math.sin(this.protPhase) * 0.5 + 0.5) * 0.30;
      (this.protHalo.material as THREE.MeshBasicMaterial).opacity = o;
      const s = 1.0 + Math.sin(this.protPhase * 0.7) * 0.06 + 0.06;
      this.protHalo.scale.set(s, s, 1);
    }
    const vx = this.renderX - this.prevRenderX;
    const vy = this.renderY - this.prevRenderY;
    const speed = Math.hypot(vx, vy) / Math.max(1e-6, dt);
    const moving = speed > 0.5;

    if (moving) {
      const target = Math.atan2(vx, vy);
      const cur = this.root.rotation.y;
      let delta = target - cur;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.root.rotation.y = cur + delta * Math.min(1, dt * 12);
    }

    // Animation de marche : seulement si on a les membres.
    if (this.leftLeg && this.rightLeg && this.leftArm && this.rightArm) {
      const walkRate = moving ? Math.min(12, 3 + speed * 0.8) : 0;
      this.walkPhase += dt * walkRate;
      const amp = moving ? Math.min(0.35, speed * 0.03) : 0;
      const s = Math.sin(this.walkPhase);
      this.leftLeg.position.z = s * amp;
      this.rightLeg.position.z = -s * amp;
      this.leftArm.position.z = -s * amp * 0.7;
      this.rightArm.position.z = s * amp * 0.7;
      const bob = moving ? Math.abs(Math.sin(this.walkPhase * 2)) * 0.04 : 0;
      this.body.position.y = 0.95 + bob;
      this.head.position.y = 1.55 + bob;
    }

    this.prevRenderX = this.renderX;
    this.prevRenderY = this.renderY;
  }

  // Repart de zéro (apparition) : pas de trait depuis l'ancienne position.
  resetTrail(): void {
    this.trailCount = 0;
    if (this.hasTrail) (this.trail as THREE.Mesh).geometry.setDrawRange(0, 0);
  }

  updateTrail(dt: number): void {
    if (!this.hasTrail) return;
    const x = this.renderX;
    const z = this.renderY;
    if (Math.hypot(x - this.trailHeadX, z - this.trailHeadZ) > TRAIL_JUMP) this.trailCount = 0;
    this.trailHeadX = x;
    this.trailHeadZ = z;
    this.trailClock += dt * 1000;
    const now = this.trailClock;
    if (this.trailCount === 0 || now - this.trailT[0] >= TRAIL_SAMPLE_MS) {
      // Nouvel échantillon en tête ; le plus ancien sort si plein.
      const n = Math.min(this.trailCount, TRAIL_SAMPLES - 1);
      this.trailX.copyWithin(1, 0, n);
      this.trailZ.copyWithin(1, 0, n);
      this.trailT.copyWithin(1, 0, n);
      this.trailX[0] = x;
      this.trailZ[0] = z;
      this.trailT[0] = now;
      this.trailCount = n + 1;
    }
    this.buildTrail(now);
  }

  // Ruban : la tête (position courante), les échantillons plus récents que
  // TRAIL_MS, puis un dernier point interpolé à exactement TRAIL_MS. La
  // longueur ne dépend que de la vitesse, pas du FPS.
  private buildTrail(now: number): void {
    const mesh = this.trail as THREE.Mesh;
    const geo = mesh.geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const col = geo.getAttribute("color") as THREE.BufferAttribute;
    const px = pos.array as Float32Array;
    const cc = col.array as Float32Array;
    const cut = now - TRAIL_MS;
    let n = 0;
    let lastX = this.trailHeadX;
    let lastZ = this.trailHeadZ;
    let lastT = now;
    // Points du ruban, de la tête au bout, rangés dans px avant d'y
    // calculer les bords (x, z, âge dans px[0..2]).
    const pts = this.trailPts;
    pts[0] = lastX; pts[1] = lastZ; pts[2] = 0;
    n = 1;
    for (let i = 0; i < this.trailCount; i++) {
      const t = this.trailT[i];
      const sx = this.trailX[i];
      const sz = this.trailZ[i];
      if (t >= cut) {
        if (t < lastT || sx !== lastX || sz !== lastZ) {
          pts[n * 3] = sx; pts[n * 3 + 1] = sz; pts[n * 3 + 2] = now - t;
          n++;
          lastX = sx; lastZ = sz; lastT = t;
        }
        continue;
      }
      // Premier échantillon trop vieux : bout interpolé à `cut`, puis fin.
      const span = lastT - t;
      const k = span > 0 ? (lastT - cut) / span : 0;
      pts[n * 3] = lastX + (sx - lastX) * k;
      pts[n * 3 + 1] = lastZ + (sz - lastZ) * k;
      pts[n * 3 + 2] = TRAIL_MS;
      n++;
      break;
    }
    if (n < 2) {
      geo.setDrawRange(0, 0);
      return;
    }
    let perpX = 0;
    let perpZ = 0;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3];
      const z = pts[i * 3 + 1];
      // Direction locale du ruban : vers le point suivant (le précédent
      // pour le bout) ; un segment nul garde la normale d'avant.
      const j = i < n - 1 ? i + 1 : i - 1;
      const dx = (pts[j * 3] - x) * (i < n - 1 ? 1 : -1);
      const dz = (pts[j * 3 + 1] - z) * (i < n - 1 ? 1 : -1);
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) {
        perpX = -dz / len;
        perpZ = dx / len;
      }
      const f = Math.min(1, pts[i * 3 + 2] / TRAIL_MS);
      const w = TRAIL_HALF_WIDTH * (1 - f);
      const a = TRAIL_ALPHA * (1 - f) * (1 - f);
      const v = i * 2 * 3;
      px[v] = x + perpX * w; px[v + 1] = TRAIL_Y; px[v + 2] = z + perpZ * w;
      px[v + 3] = x - perpX * w; px[v + 4] = TRAIL_Y; px[v + 5] = z - perpZ * w;
      const c = i * 2 * 4;
      cc[c] = cc[c + 4] = this.trailColor.r;
      cc[c + 1] = cc[c + 5] = this.trailColor.g;
      cc[c + 2] = cc[c + 6] = this.trailColor.b;
      cc[c + 3] = cc[c + 7] = a;
    }
    geo.setDrawRange(0, (n - 1) * 6);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  // Longueur du ruban au sol (u), le long de son axe : contrôle de la
  // tâche 2.6 (identique à 30 et 144 FPS).
  trailLength(): number {
    const geo = (this.trail as THREE.Mesh).geometry;
    if (!geo) return 0;
    const segments = geo.drawRange.count / 6;
    let len = 0;
    for (let i = 0; i < segments; i++) {
      len += Math.hypot(this.trailPts[(i + 1) * 3] - this.trailPts[i * 3], this.trailPts[(i + 1) * 3 + 1] - this.trailPts[i * 3 + 1]);
    }
    return len;
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    for (const d of this.disposables) d.dispose();
  }
}
