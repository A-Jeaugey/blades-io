import { CHAMPION_NAME_MARK } from "./constants";
import { foldText } from "./moderation";

// Noms des bots (retour de jeu du 2026-10-12 : avec 12 noms, une partie
// avait souvent deux bots du même nom, « ça porte à confusion »). Même
// esprit qu'avant, drôle et français : aliments, animaux, objets du
// quotidien, clins d'œil de joueur. Le jeu est public : aucun personnage
// ni aucune marque protégés (pas de dessin animé, de jeu vidéo ni de
// produit déposé), aucune personne réelle, pas de mot qui sonne comme une
// insulte (« Andouille », « Dinde »). Chaque nom tient avec la marque de
// champion dans NAME_MAX_LENGTH et passe nameProblem
// (server/test/botNames.test.ts).
export const BOT_NAMES: readonly string[] = [
  // Aliments
  "Courgette", "Ananas", "Poulet", "Saucisson", "Baguette", "Fromage",
  "Tomate", "Brocoli", "Fraise", "Steak", "Raclette", "Croissant",
  "Cornichon", "Radis", "Navet", "Poireau", "Artichaut", "Aubergine",
  "Patate", "Topinambour", "Betterave", "Citrouille", "Haricot", "Petit Pois",
  "Pois Chiche", "Champignon", "Échalote", "Ciboulette", "Clémentine", "Kiwi",
  "Mangue", "Litchi", "Myrtille", "Framboise", "Cerise", "Pastèque",
  "Abricot", "Pruneau", "Noisette", "Cacahuète", "Pistache", "Châtaigne",
  "Quiche", "Crêpe", "Gaufre", "Tartiflette", "Fondue", "Cassoulet",
  "Choucroute", "Pot-au-Feu", "Bouillabaisse", "Gratin", "Hachis", "Omelette",
  "Clafoutis", "Éclair", "Macaron", "Madeleine", "Canelé", "Chouquette",
  "Brioche", "Bretzel", "Churros", "Beignet", "Pain Perdu", "Mille-Feuille",
  "Profiterole", "Tiramisu", "Nugget", "Kebab", "Tacos", "Burrito",
  "Nachos", "Sushi", "Ramen", "Raviole", "Gnocchi", "Lasagne",
  "Tartine", "Croque", "Muffin", "Cookie", "Donut", "Pancake",
  "Couscous", "Falafel", "Houmous", "Samoussa", "Nem", "Wasabi",
  "Ketchup", "Moutarde", "Mayo", "Yaourt", "Camembert", "Merguez",
  "Chipolata", "Rillettes", "Cordon Bleu", "Vol-au-Vent", "Crevette", "Bigorneau",
  "Calamar", "Sardine", "Anchois", "Surimi", "Tofu", "Popcorn",
  "Guimauve", "Réglisse", "Caramel", "Nougat", "Berlingot", "Barbe à Papa",
  "Chocolatine", "Frites",
  // Animaux
  "Hérisson", "Loutre", "Raton Laveur", "Pingouin", "Manchot", "Lama",
  "Alpaga", "Capybara", "Paresseux", "Ornithorynque", "Axolotl", "Wombat",
  "Koala", "Tatou", "Suricate", "Marmotte", "Hamster", "Cochon d'Inde",
  "Escargot", "Limace", "Mouette", "Pigeon", "Canard", "Poussin",
  "Taupe", "Moustique", "Coccinelle", "Bourdon", "Lombric", "Homard",
  "Morse", "Phoque", "Narval", "Méduse", "Hippocampe", "Pélican",
  "Toucan", "Flamant Rose", "Autruche", "Kangourou", "Panda Roux", "Yack",
  "Gnou", "Okapi", "Fennec", "Lémurien", "Tapir", "Caribou",
  "Écureuil", "Furet", "Chinchilla", "Perruche", "Ouistiti", "Dromadaire",
  "Tortue", "Grenouille", "Têtard", "Hibou", "Poisson-Lune", "Cachalot",
  "Plancton", "Mammouth", "Diplodocus", "Dodo", "Licorne", "Yéti",
  "Kraken",
  // Objets du quotidien
  "Chaussette", "Pantoufle", "Parapluie", "Grille-Pain", "Bouilloire", "Passoire",
  "Spatule", "Louche", "Cafetière", "Théière", "Tire-Bouchon", "Ouvre-Boîte",
  "Agrafeuse", "Trombone", "Gomme", "Taille-Crayon", "Éponge", "Serpillière",
  "Aspirateur", "Radiateur", "Lampadaire", "Tabouret", "Coussin", "Oreiller",
  "Peignoir", "Bigoudi", "Brosse à Dents", "Savonnette", "Moufle", "Bonnet",
  "Nœud Pap", "Parasol", "Transat", "Bouée", "Tuba", "Brouette",
  "Arrosoir", "Râteau", "Nain de Jardin", "Autocuiseur", "Marmite", "Salière",
  "Torchon", "Ventilo", "Réveil", "Boussole", "Pince à Linge", "Cintre",
  "Équerre", "Cartable", "Paillasson", "Abat-Jour", "Allumette", "Multiprise",
  "Télécommande", "Ventouse", "Trottinette", "Boomerang", "Yoyo", "Toupie",
  "Cerf-Volant", "Bilboquet", "Ukulélé", "Maracas", "Sifflet", "Kazoo",
  // Clins d'œil de joueur
  "Pixel", "Octet", "Bug", "Ping", "Lag", "Modem",
  "Disquette", "Captcha", "Erreur 404", "Ctrl Z", "Alt F4", "Clavier",
  "Joystick", "Manette", "Routeur", "Binaire", "Boucle Infinie", "Point-Virgule",
  "Accolade", "Pare-Feu", "Mot de Passe", "Pop-Up", "Spoiler", "Glitch",
  "Hitbox", "Respawn", "Combo", "Speedrun", "Checkpoint", "Boss Final",
  "PNJ", "Loot", "Patch", "Easter Egg", "Sauvegarde", "Chargement",
  "Tutoriel", "Écran Bleu", "Mode Avion", "Copier-Coller", "Fond d'Écran", "Touche Échap",
  "Câble Emmêlé", "Mise à Jour", "Bêta Test", "Batterie Vide",
];

// Clé de comparaison de deux noms de la room : sans la marque de champion,
// sans casse, sans accents ni séparateurs (« ★ Raclette », « raclette » et
// un humain « Raton-Laveur » face au bot « Raton Laveur » se confondent à
// l'écran).
export function botNameKey(name: string): string {
  const bare = name.startsWith(CHAMPION_NAME_MARK) ? name.slice(CHAMPION_NAME_MARK.length) : name;
  return foldText(bare).replace(/[^\p{L}\p{N}]/gu, "");
}
