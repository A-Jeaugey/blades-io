import * as Tone from "tone";
import { BladeRarity } from "@bladeio/shared";

// Musique servie depuis client/public/ (synchronisée au build via npm script
// sync-music, qui copie Hardline_Pursuit.mp4 depuis la racine du repo).
// Préfixé par BASE_URL pour survivre aux déploiements en sous-chemin.
const MUSIC_TRACK_URL = `${((import.meta as any).env?.BASE_URL ?? "/")}Hardline_Pursuit.mp4`;

// SFX procéduraux (Tone.js) + musique via HTMLAudioElement (track enregistré).
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

  // Volumes logiques 0..1 conservés pour recomposer audio.volume à chaque maj.
  private masterVol = 0.7;
  private musicVol = 0.5;
  private music: HTMLAudioElement | null = null;

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

    // Musique : track enregistré, bouclé. HTMLAudioElement gère le decoding
    // et le streaming, plus léger que createMediaElementSource pour ce besoin.
    this.music = new Audio(MUSIC_TRACK_URL);
    this.music.loop = true;
    this.music.preload = "auto";
    this.music.volume = this.masterVol * this.musicVol;
    // Play peut rejeter si l'utilisateur n'a pas interagi, mais init() est
    // appelé depuis le clic "Enter the grid", donc c'est bon.
    try {
      await this.music.play();
    } catch (e) {
      console.warn("music autoplay blocked", e);
    }
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.masterVol = master;
    this.musicVol = music;
    this.master.gain.rampTo(master, 0.05);
    this.sfxGain.gain.rampTo(sfx, 0.05);
    if (this.music) this.music.volume = master * music;
  }

  pickup(rarity: BladeRarity): void {
    if (!this.started) return;
    const notes = ["C5", "E5", "G5", "B5"];
    const n = notes[Math.min(3, rarity)];
    this.pickupSynth.triggerAttackRelease(n, 0.12);
  }

  hit(rarity: BladeRarity): void {
    if (!this.started) return;
    const freq = [200, 260, 340, 440][Math.min(3, rarity)];
    this.hitSynth.triggerAttackRelease(freq, 0.06);
  }

  // Son de lancer de lame : note glissante aiguë → grave pour suggérer le
  // "swoosh" du projectile. Hauteur de départ ↑ avec la rareté.
  throwBlade(rarity: BladeRarity): void {
    if (!this.started) return;
    const note = ["A4", "C5", "E5", "G5"][Math.min(3, rarity)];
    this.pickupSynth.triggerAttackRelease(note, 0.18);
    this.hitSynth.triggerAttackRelease([180, 220, 280, 360][Math.min(3, rarity)], 0.05);
  }

  kill(): void {
    if (!this.started) return;
    this.killSynth.triggerAttackRelease("C2", 0.25);
  }

  death(): void {
    if (!this.started) return;
    this.deathSynth.triggerAttackRelease(0.4);
    this.killSynth.triggerAttackRelease("A1", 0.4, undefined, 0.9);
  }

  lowBlades(): void {
    if (!this.started) return;
    this.lowSynth.triggerAttackRelease("E4", 0.08);
  }

  setBoost(on: boolean): void {
    if (!this.started) return;
    if (on) this.boostEnv.triggerAttack();
    else this.boostEnv.triggerRelease();
  }
}
