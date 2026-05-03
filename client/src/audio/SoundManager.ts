import * as Tone from "tone";
import { BladeRarity } from "@bladeio/shared";
import { getActiveTheme } from "../themes";

// Musiques servies depuis client/public/ (synchronisées au build via le script
// sync-music). Préfixé par BASE_URL pour survivre aux déploiements en
// sous-chemin (ex: GitHub Pages). Les noms de fichiers viennent du thème
// actif — neon utilise lobby.mp3/battle.mp3, sanctuaire pointera sur
// lobby-sanctuaire.mp3/battle-sanctuaire.mp3 (à fournir via le script
// sync-music quand les Suno seront générées).
const BASE = (import.meta as any).env?.BASE_URL ?? "/";
const themeMusic = getActiveTheme().music;
const LOBBY_TRACK_URL = `${BASE}${themeMusic.lobby}`;
const BATTLE_TRACK_URL = `${BASE}${themeMusic.battle}`;

type MusicTrack = "lobby" | "battle";

// SFX procéduraux (Tone.js) + musiques via HTMLAudioElement (tracks bouclés).
// Deux tracks : lobby (chill, login/menu/death screen) et battle (in-game).
// Crossfade rapide entre les deux pour ne pas couper sec.
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
  private battleMusic: HTMLAudioElement | null = null;
  private currentTrack: MusicTrack | null = null;
  private fadeAbort: { cancelled: boolean } | null = null;
  private autoplayUnlocker: (() => void) | null = null;

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

  private getOrCreateTrack(track: MusicTrack): HTMLAudioElement {
    if (track === "lobby") {
      if (!this.lobbyMusic) {
        this.lobbyMusic = new Audio(LOBBY_TRACK_URL);
        this.lobbyMusic.loop = true;
        this.lobbyMusic.preload = "auto";
        this.lobbyMusic.volume = 0;
      }
      return this.lobbyMusic;
    }
    if (!this.battleMusic) {
      this.battleMusic = new Audio(BATTLE_TRACK_URL);
      this.battleMusic.loop = true;
      this.battleMusic.preload = "auto";
      this.battleMusic.volume = 0;
    }
    return this.battleMusic;
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
    if (this.battleMusic) { this.battleMusic.pause(); this.battleMusic.volume = 0; }
    this.currentTrack = null;
  }

  private async switchTrack(target: MusicTrack): Promise<void> {
    if (this.currentTrack === target) return;
    if (this.fadeAbort) this.fadeAbort.cancelled = true;
    const fade = { cancelled: false };
    this.fadeAbort = fade;

    const next = this.getOrCreateTrack(target);
    const prev = this.currentTrack
      ? (this.currentTrack === "lobby" ? this.lobbyMusic : this.battleMusic)
      : null;

    const targetVol = this.masterVol * this.musicVol;

    try {
      await next.play();
    } catch {
      this.armAutoplayUnlocker(target);
      return;
    }
    this.currentTrack = target;

    // Crossfade ~600ms : suffisant pour ne pas couper sec, court pour rester
    // réactif à l'entrée en jeu.
    const durationMs = 600;
    const steps = 20;
    const stepMs = durationMs / steps;
    const startNext = next.volume;
    const startPrev = prev ? prev.volume : 0;
    for (let i = 1; i <= steps; i++) {
      if (fade.cancelled) return;
      const t = i / steps;
      next.volume = Math.min(1, startNext + (targetVol - startNext) * t);
      if (prev && prev !== next) prev.volume = Math.max(0, startPrev * (1 - t));
      await new Promise((r) => setTimeout(r, stepMs));
    }
    if (prev && prev !== next) prev.pause();
  }

  // Si l'autoplay est bloqué (Chrome/Safari avant tout user gesture),
  // on attache un listener one-shot qui retente quand l'user clique/touche.
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
    const v = master * music;
    if (this.currentTrack === "lobby" && this.lobbyMusic) this.lobbyMusic.volume = v;
    if (this.currentTrack === "battle" && this.battleMusic) this.battleMusic.volume = v;
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
