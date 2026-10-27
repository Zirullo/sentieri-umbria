// Le due versioni dell'app, a piedi (sentieri) e in bici (percorsi), condividono il codice:
// la pagina sceglie quale con <html data-mode="bici">. Qui sta tutto ciò che le distingue.
import { setMode, tr } from './i18n.js';

export const BIKE = globalThis.document?.documentElement.dataset.mode === 'bici';

// Versione delle due app (escono sempre insieme), mostrata nel pannello della legenda.
// A ogni rilascio: 1.01, 1.02, … (tests/shell.test.mjs controlla il formato).
export const VERSION = '1.11';

// Stesso sito per le due app: memoria del telefono e cache separate con un prefisso.
export const KEY_PREFIX = BIKE ? 'bici-' : '';
// chiave di localStorage o nome di cache che appartiene a questa versione
export const isOwnKey = (k) => (BIKE ? k.startsWith(KEY_PREFIX) : !k.startsWith('bici-'));

// Parole dell'interfaccia: "sentiero" e "percorso" hanno gli stessi articoli (in inglese "trail" e "route"),
// basta sostituire il nome: nelle frasi di tr() sono {one}, {many}, {One}, {Many}. Nelle lingue dove articoli e
// casi cambiano (tedesco: der Weg, die Route) il dizionario ha la frase per ciascuna versione (vedi i18n.js).
export const W = setMode(BIKE, BIKE
  ? { one: tr('percorso'), many: tr('percorsi'), One: tr('Percorso'), Many: tr('Percorsi') }
  : { one: tr('sentiero'), many: tr('sentieri'), One: tr('Sentiero'), Many: tr('Sentieri') });

export const SCALE_LABEL = BIKE
  ? { // scala CAI del cicloescursionismo
    TC: tr('Turistico'),
    MC: tr('Media capacità tecnica'),
    BC: tr('Buona capacità tecnica'),
    OC: tr('Ottima capacità tecnica'),
    EC: tr('Eccellente capacità tecnica'),
  }
  : {
    T: tr('Turistico'),
    E: tr('Escursionistico'),
    EE: tr('Escursionisti Esperti'),
    EEA: tr('Esperti con Attrezzatura'),
  };

export const KIND_LABEL = { road: tr('Ciclovia'), mtb: 'MTB' };

// Colore dei tracciati sulla mappa generale: a piedi per difficoltà, in bici per tipo
// (molti percorsi in bici non hanno una difficoltà dichiarata).
export const NO_CLASS_COLOR = '#757575'; // grigio: non si confonde con l'arancione del selezionato
export const CLASSES = BIKE
  ? [
    { color: '#1565c0', label: tr('<b>Ciclovia</b> strada o sterrato facile'), test: (t) => t.kind === 'road' },
    // non viola: sulla topografica il viola sottile è il confine di regione
    { color: '#c62828', label: tr('<b>MTB</b> sterrato e sentiero'), test: (t) => t.kind === 'mtb' },
  ]
  : [
    { color: '#2e7d32', label: tr('<b>T</b> turistico'), test: (t) => t.scale === 'T' },
    { color: '#c62828', label: tr('<b>E</b> escursionistico'), test: (t) => t.scale === 'E' },
    { color: '#6a1b9a', label: tr('<b>EE</b> esperti'), test: (t) => t.scale === 'EE' },
    { color: '#111111', label: tr('<b>EEA</b> attrezzato'), test: (t) => t.scale === 'EEA' },
  ];

// Gruppi dell'elenco "Per zona", nell'ordine in cui compaiono. Sono i valori di "sector" nei dati, in italiano:
// a schermo passano da tr() (i nomi di luogo restano uguali, i gruppi generici si traducono).
export const SECTOR_ORDER = BIKE
  ? ['Ciclovie', 'Mountain bike', 'Itinerari a tappe', 'Regioni confinanti']
  : ['Alto Tevere', 'Alto Chiascio', 'Valle Umbra Nord', 'Valle Spoletina', 'Valnerina', 'Valle del Nera',
    'Amerino', 'Orvietano-Tuderte', 'Perugino-Trasimeno', 'Lunga percorrenza', 'Altri sentieri', 'Regioni confinanti'];

// Etichette col numero sulla mappa, senza sovrapposizioni: a piedi anche con tutta l'Umbria inquadrata,
// in bici (pochi percorsi, lunghi) anche con tutta l'Italia centrale inquadrata.
export const LABEL_MIN_ZOOM = BIKE ? 7 : 8;

// Guida: in bici si va più veloci, quindi tra due fix GPS si fa più strada e la freccia guarda più avanti.
export const GUIDE = BIKE ? { maxSpeed: 14, lookahead: 60 } : { maxSpeed: 2.5, lookahead: 35 };

// In bici lo schermo si guarda poco: uscendo dal percorso il telefono vibra e suona.
export const ALERTS = BIKE;
