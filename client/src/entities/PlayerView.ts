import * as THREE from "three";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";

export class PlayerView {
  root: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  ring: THREE.Mesh;
  protHalo!: THREE.Mesh | null;
  private protPhase = 0;
  private protected_ = false;
  trail: THREE.Line | THREE.Group;
  // Sous-ensembles pour l'animation. Null si playerDetail = "minimal".
  private leftLeg: THREE.Mesh | null = null;
  private rightLeg: THREE.Mesh | null = null;
  private leftArm: THREE.Mesh | null = null;
  private rightArm: THREE.Mesh | null = null;

  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private walkPhase = 0;
  private trailPoints: { x: number; y: number; z: number }[] = [];
  private trailAccum = 0;
  private readonly trailInterval = 0.03;
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
      const trailLen = q.playerDetail === "rich" ? 20 : 12;
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * trailLen), 3));
      const trailMat = new THREE.LineBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.55,
      });
      const line = new THREE.Line(trailGeo, trailMat);
      line.frustumCulled = false;
      this.trail = line;
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

  updateTrail(dt: number): void {
    if (!this.hasTrail) return;
    this.trailAccum += dt;
    if (this.trailAccum < this.trailInterval) return;
    this.trailAccum = 0;
    const line = this.trail as THREE.Line;
    const trailLen = (line.geometry.getAttribute("position") as THREE.BufferAttribute).count;
    if (this.trailPoints.length < trailLen) {
      this.trailPoints.unshift({ x: this.renderX, y: 0.05, z: this.renderY });
    } else {
      const last = this.trailPoints.pop()!;
      last.x = this.renderX;
      last.y = 0.05;
      last.z = this.renderY;
      this.trailPoints.unshift(last);
    }
    const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const len = this.trailPoints.length;
    for (let i = 0; i < trailLen; i++) {
      const pt = i < len ? this.trailPoints[i] : this.trailPoints[len - 1];
      if (pt) pos.setXYZ(i, pt.x, pt.y, pt.z);
    }
    pos.needsUpdate = true;
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    for (const d of this.disposables) d.dispose();
  }
}
