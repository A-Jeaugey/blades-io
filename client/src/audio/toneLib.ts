// Ce que SoundManager utilise de Tone.js, regroupé pour son import différé :
// importer « tone » en entier empêchait d'élaguer le reste (337 Ko au lieu
// de 241).
export {
  AmplitudeEnvelope,
  FMSynth,
  Filter,
  Frequency,
  Gain,
  MembraneSynth,
  MetalSynth,
  Noise,
  NoiseSynth,
  Reverb,
  Synth,
  now,
  setContext,
  start,
} from "tone";
