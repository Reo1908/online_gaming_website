import { prisma } from './prisma.js';

/**
 * Ein Startsatz an Themengebieten.
 *
 * Anders als die Spielarten sind Etiketten *Inhalt*, nicht Struktur: Sie
 * gehoeren der Verwaltung, nicht dem Quelltext. Deshalb werden sie nur ein
 * einziges Mal angelegt -- auf einem Server, auf dem noch kein einziges
 * Gebiet steht.
 *
 * Wuerde hier bei jedem Start abgeglichen wie bei den Spielarten, kaeme ein
 * geloeschtes Gebiet nach dem naechsten Neustart wieder und eine geaenderte
 * Wortliste waere weg. Beides waere aus Sicht eines Administrators ein Fehler.
 */
const START_ETIKETTEN = [
  {
    slug: 'pokemon',
    name: 'Pokémon',
    color: '#f0b429',
    woerter: [
      'Pikachu', 'Glumanda', 'Bisasam', 'Schiggy', 'Evoli', 'Enton', 'Mauzi',
      'Relaxo', 'Magikarp', 'Onix', 'Gengar', 'Arktos', 'Pummeluff', 'Taubsi',
      'Rattfratz', 'Digda', 'Kleinstein', 'Tentacha', 'Knogga', 'Lapras',
      'Aerodactyl', 'Mewtu', 'Glurak', 'Turtok', 'Bisaflor', 'Nachtara',
      'Meisterball', 'Pokéball', 'Team Rocket', 'Arenaorden',
    ],
  },
  {
    slug: 'league-of-legends',
    name: 'League of Legends',
    color: '#4f8ef7',
    woerter: [
      'Teemo', 'Lux', 'Yasuo', 'Thresh', 'Blitzcrank', 'Ashe', 'Garen',
      'Darius', 'Jinx', 'Ezreal', 'Zed', 'Lee Sin', 'Nautilus', 'Malphite',
      'Baron', 'Drache', 'Nexus', 'Turm', 'Minion', 'Rift Herald',
      'Inhibitor', 'Dschungel', 'Sichtstein', 'Rückruf', 'Hexentechkanone',
      'Bot Lane', 'Ranked', 'Pentakill', 'Sommoner', 'Poro',
    ],
  },
  {
    slug: 'tiere',
    name: 'Tiere',
    color: '#4caf7d',
    woerter: [
      'Elefant', 'Giraffe', 'Pinguin', 'Krokodil', 'Schmetterling', 'Igel',
      'Eichhörnchen', 'Waschbär', 'Faultier', 'Oktopus', 'Seepferdchen',
      'Flamingo', 'Erdmännchen', 'Nashorn', 'Wal', 'Fledermaus', 'Biber',
      'Chamäleon', 'Papagei', 'Marienkäfer', 'Qualle', 'Schnecke', 'Eule',
      'Zebra', 'Koala', 'Ameise', 'Hai', 'Storch', 'Dachs', 'Luchs',
    ],
  },
  {
    slug: 'essen',
    name: 'Essen & Trinken',
    color: '#e8743b',
    woerter: [
      'Pizza', 'Spaghetti', 'Brezel', 'Eiscreme', 'Croissant', 'Sushi',
      'Hamburger', 'Pommes', 'Wassermelone', 'Ananas', 'Käse', 'Popcorn',
      'Donut', 'Suppe', 'Salat', 'Kaffee', 'Bier', 'Apfelstrudel',
      'Schokolade', 'Bratwurst', 'Toast', 'Spiegelei', 'Paprika', 'Zwiebel',
      'Kürbis', 'Honig', 'Marmelade', 'Nudelsuppe', 'Muffin', 'Taco',
    ],
  },
  {
    slug: 'filme-serien',
    name: 'Filme & Serien',
    color: '#9b5de5',
    woerter: [
      'Titanic', 'Star Wars', 'Der Pate', 'Jurassic Park', 'Matrix',
      'Herr der Ringe', 'Harry Potter', 'Ghostbusters', 'Findet Nemo',
      'König der Löwen', 'Shrek', 'Zurück in die Zukunft', 'Der weiße Hai',
      'Toy Story', 'Die Simpsons', 'Breaking Bad', 'Stranger Things',
      'Game of Thrones', 'Die Eiskönigin', 'Batman', 'Spider-Man',
      'Indiana Jones', 'Terminator', 'E.T.', 'Pulp Fiction',
    ],
  },
  {
    slug: 'alltag',
    name: 'Alltag',
    color: '#6b7a90',
    woerter: [
      'Zahnbürste', 'Regenschirm', 'Wecker', 'Staubsauger', 'Bügeleisen',
      'Schlüsselbund', 'Waschmaschine', 'Kaffeemaschine', 'Fahrradschloss',
      'Briefkasten', 'Ampel', 'Einkaufswagen', 'Taschenlampe', 'Leiter',
      'Gießkanne', 'Besen', 'Schere', 'Klebeband', 'Sonnenbrille',
      'Rucksack', 'Handtuch', 'Kerze', 'Bilderrahmen', 'Topfpflanze',
      'Mülltonne', 'Schraubenzieher', 'Gartenzwerg', 'Hängematte',
    ],
  },
] as const;

/**
 * Legt den Startsatz an -- aber nur auf einem Server, der noch keine
 * Themengebiete hat. Danach ruehrt diese Funktion nichts mehr an.
 */
export async function etikettenSicherstellen(): Promise<void> {
  const vorhanden = await prisma.tag.count();
  if (vorhanden > 0) return;

  for (const etikett of START_ETIKETTEN) {
    await prisma.tag.create({
      data: {
        slug: etikett.slug,
        name: etikett.name,
        color: etikett.color,
        words: { create: etikett.woerter.map((text) => ({ text })) },
      },
    });
  }
}

/**
 * Macht aus einem Namen eine Kurzform fuer die URL.
 * Umlaute werden ausgeschrieben, alles Uebrige faellt auf Bindestriche
 * zusammen -- "Filme & Serien" wird zu "filme-serien".
 */
export function slugAus(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
