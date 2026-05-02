import * as Tone from "tone";
import { BladeRarity } from "@bladeio/shared";

// Musiques servies depuis client/public/ (synchronisées au build via le script
// sync-music). Préfixé par BASE_URL pour survivre aux déploiements en
// sous-chemin (ex: GitHub Pages).
const BASE = (import.meta as any).env?.BASE_URL ?? "/";
const LOBBY_TRACK_URL = `${BASE}lobby.mp3`;
const STEM_NAMES = ["vocals", "drums", "bass", "percussion", "synth", "other"] as const;
type StemName = (typeof STEM_NAMES)[number];
const STEM_URL = (name: StemName) => `${BASE}stems/battle/${name}.mp3`;

type MusicTrack = "lobby" | "battle";

// Mapping intensité (0..1) → volume cible par stem (0..1). Interpolation
// linéaire entre keypoints pour des transitions douces. Le morceau monte par
// couches : à l'idle on n'a que le pad/bass + un peu de choeur ; à fond, tout
// joue à plein.
type StemMix = Record<StemName, number>;
const INTENSITY_KEYPOINTS: { score: number; vols: StemMix }[] = [
  { score: 0.0,  vols: { vocals: 0.6, drums: 0.0, bass: 0.3, percussion: 0.0, synth: 0.0, other: 0.5 } },
  { score: 0.3,  vols: { vocals: 0.6, drums: 0.6, bass: 1.0, percussion: 0.0, synth: 0.4, other: 0.7 } },
  { score: 0.6,  vols: { vocals: 0.5, drums: 1.0, bass: 1.0, percussion: 0.5, synth: 0.8, other: 0.7 } },
  { score: 0.85, vols: { vocals: 0.6, drums: 1.0, bass: 1.0, percussion: 1.0, synth: 1.0, other: 0.8 } },
  { score: 1.0,  vols: { vocals: 0.9, drums: 1.0, bass: 1.0, percussion: 1.0, synth: 1.0, other: 1.0 } },
];

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function mixForIntensity(score: number): StemMix {
  const s = Math.min(1, Math.max(0, score));
  for (let i = 1; i < INTENSITY_KEYPOINTS.length; i++) {
    const a = INTENSITY_KEYPOINTS[i - 1];
    const b = INTENSITY_KEYPOINTS[i];
    if (s <= b.score) {
      const t = (s - a.score) / (b.score - a.score || 1);
      const out = {} as StemMix;
      for (const n of STEM_NAMES) out[n] = lerp(a.vols[n], b.vols[n], t);
      return out;
    }
  }
  return INTENSITY_KEYPOINTS[INTENSITY_KEYPOINTS.length - 1].vols;
}

// SFX procéduraux (Tone.js) + musiques via HTMLAudioElement.
// Lobby : track unique bouclée. Battle : 6 stems lus en parallèle, mixés
// dynamiquement par setBattleIntensity(0..1) pour suivre l'action de jeu.
export class SoundManager {
  private master = new Tone.Gain(0.7).toDestination();
  private sfxGain = new Tone.Gain(0.8).connect(this.master);
  private started = false;
  private pickupSynth!: Tone.Synth;
  private hitSynth!: Tone.MetalSynth;
  private killSynth!: Tone.MembraneSynth;
  private deathSynth!: Tone.NoiseSynth;
  private lowSynth!: Tone.Synth;
  private boostNoise!: Tone.Noise;
  private boostFilter!: Tone.Filter;
  private boostEnv!: Tone.AmplitudeEnvelope;

  private masterVol = 0.7;
  private musicVol = 0.5;
  private lobbyMusic: HTMLAudioElement | null = null;
  private battleStems: Map<StemName, HTMLAudioElement> = new Map();
  private currentTrack: MusicTrack | null = null;
  private fadeAbort: { cancelled: boolean } | null = null;
  private autoplayUnlocker: (() => void) | null = null;

  // Intensité battle (lissée). targetIntensity reflète ce que le code de jeu
  // demande ; smoothedIntensity converge vers la cible (lerp à chaque tick)
  // pour éviter le "pumping" si l'action saute brutalement.
  private targetIntensity = 0;
  private smoothedIntensity = 0;
  private intensityTimer: ReturnType<typeof setInterval> | null = null;

  // Tone.js exige des `start()` strictement croissants par voix (sinon
  // FMOscillator throw "Start time must be strictly greater..."). Plusieurs
  // collisions/throws dans la même frame déclenchent des appels back-to-back
  // → on planifie chaque trigger à `max(now, lastTime + epsilon)`.
  private lastTriggerTime = new WeakMap<object, number>();

  async init(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.started = true;

    // SFX bus
    const reverb = new Tone.Reverb({ decay: 1.8, wet: 0.18 }).connect(this.sfxGain);

    this.pickupSynth = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0, release: 0.1 },
    }).connect(reverb);

    this.hitSynth = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.08, release: 0.05 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.2,
    }).connect(reverb);
    this.hitSynth.volume.value = -14;

    this.killSynth = new Tone.MembraneSynth({
      pitchDecay: 0.1,
      octaves: 4,
      envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.3 },
    }).connect(reverb);
    this.killSynth.volume.value = -6;

    this.deathSynth = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.01, decay: 0.4, sustain: 0, release: 0.4 },
    }).connect(reverb);
    this.deathSynth.volume.value = -10;

    this.lowSynth = new Tone.Synth({
      oscillator: { type: "square" },
      envelope: { attack: 0.01, decay: 0.15, sustain: 0, release: 0.1 },
    }).connect(reverb);
    this.lowSynth.volume.value = -16;

    this.boostNoise = new Tone.Noise("pink");
    this.boostFilter = new Tone.Filter(900, "lowpass");
    this.boostEnv = new Tone.AmplitudeEnvelope({
      attack: 0.08,
      decay: 0.1,
      sustain: 0.8,
      release: 0.3,
    });
    this.boostNoise.connect(this.boostFilter);
    this.boostFilter.connect(this.boostEnv);
    this.boostEnv.connect(this.sfxGain);
    this.boostNoise.volume.value = -22;
    this.boostNoise.start();
  }

  private getOrCreateLobby(): HTMLAudioElement {
    if (!this.lobbyMusic) {
      this.lobbyMusic = new Audio(LOBBY_TRACK_URL);
      this.lobbyMusic.loop = true;
      this.lobbyMusic.preload = "auto";
      this.lobbyMusic.volume = 0;
    }
    return this.lobbyMusic;
  }

  private getOrCreateStems(): HTMLAudioElement[] {
    if (this.battleStems.size === 0) {
      for (const name of STEM_NAMES) {
        const a = new Audio(STEM_URL(name));
        a.loop = true;
        a.preload = "auto";
        a.volume = 0;
        this.battleStems.set(name, a);
      }
    }
    return [...this.battleStems.values()];
  }

  async playLobbyMusic(): Promise<void> {
    await this.switchTrack("lobby");
  }

  async playBattleMusic(): Promise<void> {
    await this.switchTrack("battle");
  }

  stopMusic(): void {
    if (this.fadeAbort) this.fadeAbort.cancelled = true;
    this.fadeAbort = null;
    if (this.lobbyMusic) { this.lobbyMusic.pause(); this.lobbyMusic.volume = 0; }
    for (const s of this.battleStems.values()) { s.pause(); s.volume = 0; }
    this.stopIntensityLoop();
    this.currentTrack = null;
  }

  // setBattleIntensity : appelé par le code de jeu (kills récents, threats…).
  // 0 = idle, 1 = combat à fond. La valeur est lissée en interne ; appels
  // fréquents OK, c'est l'intensityTimer qui applique aux volumes.
  setBattleIntensity(level: number): void {
    this.targetIntensity = Math.min(1, Math.max(0, level));
  }

  private startIntensityLoop(): void {
    if (this.intensityTimer) return;
    // 100ms tick : alpha 0.06 → ~2.5s pour atteindre 90% de la cible.
    // Suffisant pour suivre l'action sans pomper sur chaque kill.
    this.intensityTimer = setInterval(() => {
      this.smoothedIntensity = lerp(this.smoothedIntensity, this.targetIntensity, 0.06);
      this.applyStemVolumes();
    }, 100);
  }

  private stopIntensityLoop(): void {
    if (this.intensityTimer) {
      clearInterval(this.intensityTimer);
      this.intensityTimer = null;
    }
  }

  private applyStemVolumes(): void {
    if (this.currentTrack !== "battle") return;
    const mix = mixForIntensity(this.smoothedIntensity);
    const base = this.masterVol * this.musicVol;
    for (const [name, a] of this.battleStems) {
      a.volume = Math.min(1, Math.max(0, base * mix[name]));
    }
  }

  private async switchTrack(target: MusicTrack): Promise<void> {
    if (this.currentTrack === target) return;
    if (this.fadeAbort) this.fadeAbort.cancelled = true;
    const fade = { cancelled: false };
    this.fadeAbort = fade;

    const baseVol = this.masterVol * this.musicVol;
    const prevTrack = this.currentTrack;

    try {
      if (target === "battle") {
        const stems = this.getOrCreateStems();
        // Sync : tous les currentTime à 0 puis play() en parallèle. Le
        // navigateur démarre tous les buffers ensemble — drift négligeable
        // sur la durée d'une partie (<10 min).
        for (const s of stems) s.currentTime = 0;
        await Promise.all(stems.map((s) => s.play()));
      } else {
        await this.getOrCreateLobby().play();
      }
    } catch {
      this.armAutoplayUnlocker(target);
      return;
    }
    this.currentTrack = target;

    // Crossfade ~600ms. Pour la battle, on ramp les stems vers leur cible
    // (qui dépend de l'intensité courante) ; pour le lobby, fade simple.
    const durationMs = 600;
    const steps = 20;
    const stepMs = durationMs / steps;
    const targetMix = target === "battle" ? mixForIntensity(this.smoothedIntensity) : null;
    const startStems: number[] = target === "battle"
      ? this.getOrCreateStems().map((s) => s.volume)
      : [];
    const startLobby = this.lobbyMusic ? this.lobbyMusic.volume : 0;
    const prevWasLobby = prevTrack === "lobby" && this.lobbyMusic;
    const prevWasBattle = prevTrack === "battle";
    const prevStartStems: number[] = prevWasBattle ? [...this.battleStems.values()].map((s) => s.volume) : [];

    for (let i = 1; i <= steps; i++) {
      if (fade.cancelled) return;
      const t = i / steps;
      if (target === "battle" && targetMix) {
        const stems = [...this.battleStems.values()];
        const names = [...this.battleStems.keys()];
        for (let k = 0; k < stems.length; k++) {
          const goal = baseVol * targetMix[names[k]];
          stems[k].volume = Math.min(1, Math.max(0, lerp(startStems[k], goal, t)));
        }
      } else if (target === "lobby" && this.lobbyMusic) {
        this.lobbyMusic.volume = Math.min(1, lerp(startLobby, baseVol, t));
      }
      if (prevWasLobby && this.lobbyMusic && target !== "lobby") {
        this.lobbyMusic.volume = Math.max(0, startLobby * (1 - t));
      }
      if (prevWasBattle && target !== "battle") {
        const stems = [...this.battleStems.values()];
        for (let k = 0; k < stems.length; k++) {
          stems[k].volume = Math.max(0, prevStartStems[k] * (1 - t));
        }
      }
      await new Promise((r) => setTimeout(r, stepMs));
    }

    if (prevWasLobby && this.lobbyMusic && target !== "lobby") this.lobbyMusic.pause();
    if (prevWasBattle && target !== "battle") {
      for (const s of this.battleStems.values()) s.pause();
    }

    if (target === "battle") this.startIntensityLoop();
    else this.stopIntensityLoop();
  }

  private armAutoplayUnlocker(pendingTrack: MusicTrack): void {
    if (this.autoplayUnlocker) return;
    const unlock = () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      this.autoplayUnlocker = null;
      void this.switchTrack(pendingTrack);
    };
    this.autoplayUnlocker = unlock;
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
  }

  private nextTime(synth: object): number {
    const now = Tone.now();
    const last = this.lastTriggerTime.get(synth) ?? 0;
    const t = Math.max(now, last + 0.001);
    this.lastTriggerTime.set(synth, t);
    return t;
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.masterVol = master;
    this.musicVol = music;
    this.master.gain.rampTo(master, 0.05);
    this.sfxGain.gain.rampTo(sfx, 0.05);
    if (this.currentTrack === "lobby" && this.lobbyMusic) {
      this.lobbyMusic.volume = master * music;
    } else if (this.currentTrack === "battle") {
      this.applyStemVolumes();
    }
  }

  pickup(rarity: BladeRarity, gain = 1): void {
    if (!this.started || gain <= 0) return;
    const notes = ["C5", "E5", "G5", "B5"];
    const n = notes[Math.min(3, rarity)];
    this.pickupSynth.triggerAttackRelease(n, 0.12, this.nextTime(this.pickupSynth), gain);
  }

  hit(rarity: BladeRarity, gain = 1): void {
    if (!this.started || gain <= 0) return;
    const freq = [200, 260, 340, 440][Math.min(3, rarity)];
    this.hitSynth.triggerAttackRelease(freq, 0.06, this.nextTime(this.hitSynth), gain);
  }

  // Son de lancer de lame : note glissante aiguë → grave pour suggérer le
  // "swoosh" du projectile. Hauteur de départ ↑ avec la rareté.
  throwBlade(rarity: BladeRarity, gain = 1): void {
    if (!this.started || gain <= 0) return;
    const note = ["A4", "C5", "E5", "G5"][Math.min(3, rarity)];
    this.pickupSynth.triggerAttackRelease(note, 0.18, this.nextTime(this.pickupSynth), gain);
    this.hitSynth.triggerAttackRelease([180, 220, 280, 360][Math.min(3, rarity)], 0.05, this.nextTime(this.hitSynth), gain);
  }

  kill(gain = 1): void {
    if (!this.started || gain <= 0) return;
    this.killSynth.triggerAttackRelease("C2", 0.25, this.nextTime(this.killSynth), gain);
  }

  death(): void {
    if (!this.started) return;
    this.deathSynth.triggerAttackRelease(0.4, this.nextTime(this.deathSynth));
    this.killSynth.triggerAttackRelease("A1", 0.4, this.nextTime(this.killSynth), 0.9);
  }

  lowBlades(): void {
    if (!this.started) return;
    this.lowSynth.triggerAttackRelease("E4", 0.08, this.nextTime(this.lowSynth));
  }

  setBoost(on: boolean): void {
    if (!this.started) return;
    if (on) this.boostEnv.triggerAttack();
    else this.boostEnv.triggerRelease();
  }
}
