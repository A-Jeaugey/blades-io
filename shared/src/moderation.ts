// Modération (tâche 5.6) : filtre de mots français et anglais pour le chat
// et les pseudos. Partagé : le serveur fait foi (messages masqués, pseudos
// remplacés), le client refuse un pseudo dès le lobby.
//
// Pas de recherche de sous-chaîne aveugle (« computer » contient « pute ») :
// les mots sont comparés entiers, et seules quelques racines sans faux
// positif connu sont cherchées à l'intérieur des mots (pseudos collés,
// mots composés).

// Comparaison sans casse ni accents, chiffres et symboles « leet » ramenés
// aux lettres qu'ils imitent (n1gg3r, sh1t, $alope…).
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "€": "e" };

export function foldText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[013457@$€]/g, (c) => LEET[c] ?? c);
}

// Mots entiers (formes repliées). Pas de « con », « retard » (le retard),
// « rape » (fromage râpé), « bite » (anglais) : trop de faux positifs entre
// les deux langues.
const WORDS = [
  // Anglais : insultes racistes, homophobes, validistes.
  "nigger", "niggers", "nigga", "niggas", "negro", "negros", "faggot", "faggots", "fag", "fags",
  "retarded", "tranny", "trannies", "dyke", "dykes", "kike", "kikes", "spic", "spics", "chink",
  "chinks", "gook", "gooks", "wetback", "wetbacks", "coon", "coons", "beaner", "beaners", "paki",
  "pakis", "raghead", "towelhead", "shemale",
  // Anglais : grossièretés, insultes, harcèlement.
  "bastard", "bastards", "dick", "dicks", "cock", "cocks", "pussy", "pussies", "twat", "twats",
  "wanker", "wankers", "jerkoff", "kys", "nazi", "nazis", "porn", "porno", "pornos", "pornhub",
  // Français : insultes racistes, homophobes.
  "negre", "negres", "negresse", "negresses", "bougnoule", "bougnoules", "bougnoul", "bicot",
  "bicots", "youpin", "youpins", "youpine", "bamboula", "chinetoque", "chinetoques", "pede", "pedes",
  "pd", "tapette", "tapettes", "tarlouze", "tarlouzes", "gouine", "gouines", "travelo", "travelos",
  // Français : grossièretés, insultes.
  "connard", "connards", "connasse", "connasses", "conasse", "salope", "salopes", "salaud", "salauds",
  "enfoire", "enfoires", "enfoiree", "batard", "batards", "batarde", "fdp", "ntm", "pute", "putes",
  "putain", "putains", "petasse", "petasses", "pouffiasse", "branleur", "branleurs", "branlette",
  "nique", "niquer", "niquez", "suceur", "suceuse", "merde", "merdes", "merdique", "chier",
];

// Racines cherchées à l'intérieur des mots : « motherfucker », « xXniggerXx ».
const ROOTS = [
  "fuck", "shit", "bitch", "cunt", "whore", "slut", "nigg", "fagg", "asshole", "cocksuck",
  "dickhead", "hitler", "encul", "connard", "connass", "pedophil",
];

// Expressions de harcèlement, mot à mot.
const PHRASES = [["kill", "yourself"], ["kill", "urself"], ["suicide", "toi"], ["te", "suicider"]];

// Pseudos réservés : se faire passer pour l'équipe du jeu.
const RESERVED = [
  "admin", "administrator", "administrateur", "modo", "mod", "moderator", "moderateur", "staff",
  "system", "systeme", "official", "officiel", "bladeio",
];

// Lettres répétées tolérées (fuuuck), mais les lettres doublées d'un mot
// restent exigées : « nigger » ne correspond pas au pays « Niger ».
function pattern(word: string): string {
  let out = "";
  for (let i = 0; i < word.length; ) {
    let j = i;
    while (j < word.length && word[j] === word[i]) j++;
    out += word[i] + (j - i === 1 ? "+" : `{${j - i},}`);
    i = j;
  }
  return out;
}

const WORD_RE = new RegExp(`^(?:${WORDS.map(pattern).join("|")})$`);
const ROOT_RE = new RegExp(ROOTS.map(pattern).join("|"));
const PHRASE_RES = PHRASES.map((p) => p.map((w) => new RegExp(`^${pattern(w)}$`)));
const RESERVED_RE = new RegExp(`^(?:${RESERVED.map(pattern).join("|")})$`);

function offensiveWord(folded: string): boolean {
  return WORD_RE.test(folded) || ROOT_RE.test(folded);
}

interface Token { start: number; end: number; folded: string }

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}@$€]+/gu)) {
    out.push({ start: m.index!, end: m.index! + m[0].length, folded: foldText(m[0]) });
  }
  return out;
}

// Passages à masquer : [début, fin) dans le texte d'origine.
function offensiveSpans(text: string): Array<[number, number]> {
  const toks = tokenize(text);
  const spans: Array<[number, number]> = [];
  for (const t of toks) if (offensiveWord(t.folded)) spans.push([t.start, t.end]);
  // Lettres espacées : « f u c k », « f.d.p ».
  for (let i = 0; i < toks.length; ) {
    let j = i;
    while (
      j + 1 < toks.length && toks[j].folded.length === 1 && toks[j + 1].folded.length === 1 &&
      /^[\s.\-_*]{1,2}$/.test(text.slice(toks[j].end, toks[j + 1].start))
    ) j++;
    if (j - i >= 2) {
      const joined = toks.slice(i, j + 1).map((t) => t.folded).join("");
      if (offensiveWord(joined)) spans.push([toks[i].start, toks[j].end]);
    }
    i = j + 1;
  }
  for (const phrase of PHRASE_RES) {
    for (let i = 0; i + phrase.length <= toks.length; i++) {
      if (phrase.every((re, k) => re.test(toks[i + k].folded))) spans.push([toks[i].start, toks[i + phrase.length - 1].end]);
    }
  }
  return spans;
}

// Message du chat : les passages offensants deviennent des astérisques.
// hits : nombre de passages masqués (récidive, cf. ArenaRoom).
export function censorChat(text: string): { text: string; hits: number } {
  const spans = offensiveSpans(text);
  if (spans.length === 0) return { text, hits: 0 };
  const chars = [...text];
  // Indices en unités UTF-16 → positions dans le tableau de caractères.
  const at: number[] = [];
  let u = 0;
  chars.forEach((ch, i) => { at[u] = i; u += ch.length; });
  at[u] = chars.length;
  for (const [s, e] of spans) {
    for (let i = at[s]; i < at[e]; i++) if (!/\s/.test(chars[i])) chars[i] = "*";
  }
  return { text: chars.join(""), hits: spans.length };
}

export type NameProblem = "offensive" | "reserved" | "mixed";

// Écritures dont les lettres imitent le latin (а cyrillique, ο grec) : un
// pseudo qui les mêle au latin sert à usurper un nom.
const LATIN_RE = /\p{Script=Latin}/u;
const LOOKALIKE_RE = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

// null si le pseudo est acceptable. Il est découpé en mots (séparateurs,
// casse en chameau), puis testé aussi d'un seul tenant (S_a_l_o_p_e).
export function nameProblem(raw: string): NameProblem | null {
  const name = raw.normalize("NFKC");
  if (LATIN_RE.test(name) && LOOKALIKE_RE.test(name)) return "mixed";
  const parts = name
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .split(/[\s_.\-]+/u)
    .filter((p) => p.length > 0)
    .map(foldText);
  const joined = parts.join("");
  if (parts.some(offensiveWord) || offensiveWord(joined)) return "offensive";
  if (parts.some((p) => RESERVED_RE.test(p)) || RESERVED_RE.test(joined)) return "reserved";
  return null;
}
