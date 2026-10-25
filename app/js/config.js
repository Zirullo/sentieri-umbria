// Le due versioni dell'app, a piedi (sentieri) e in bici (percorsi), condividono il codice:
// la pagina sceglie quale con <html data-mode="bici">. Qui sta tutto ciò che le distingue.

export const BIKE = globalThis.document?.documentElement.dataset.mode === 'bici';

// Stesso sito per le due app: memoria del telefono e cache separate con un prefisso.
export const KEY_PREFIX = BIKE ? 'bici-' : '';
// chiave di localStorage o nome di cache che appartiene a questa versione
export const isOwnKey = (k) => (BIKE ? k.startsWith(KEY_PREFIX) : !k.startsWith('bici-'));

// Parole dell'interfaccia: "sentiero" e "percorso" hanno gli stessi articoli, basta sostituire il nome.
export const W = BIKE
  ? { one: 'percorso', many: 'percorsi', One: 'Percorso', Many: 'Percorsi' }
  : { one: 'sentiero', many: 'sentieri', One: 'Sentiero', Many: 'Sentieri' };

export const SCALE_LABEL = BIKE
  ? { // scala CAI del cicloescursionismo
    TC: 'Turistico',
    MC: 'Media capacità tecnica',
    BC: 'Buona capacità tecnica',
    OC: 'Ottima capacità tecnica',
    EC: 'Eccellente capacità tecnica',
  }
  : {
    T: 'Turistico',
    E: 'Escursionistico',
    EE: 'Escursionisti Esperti',
    EEA: 'Esperti con Attrezzatura',
  };

export const KIND_LABEL = { road: 'Ciclovia', mtb: 'MTB' };

// Colore dei tracciati sulla mappa generale: a piedi per difficoltà, in bici per tipo
// (molti percorsi in bici non hanno una difficoltà dichiarata).
export const NO_CLASS_COLOR = '#757575'; // grigio: non si confonde con l'arancione del selezionato
export const CLASSES = BIKE
  ? [
    { color: '#1565c0', label: '<b>Ciclovia</b> strada o sterrato facile', test: (t) => t.kind === 'road' },
    { color: '#8e24aa', label: '<b>MTB</b> sterrato e sentiero', test: (t) => t.kind === 'mtb' },
  ]
  : [
    { color: '#2e7d32', label: '<b>T</b> turistico', test: (t) => t.scale === 'T' },
    { color: '#c62828', label: '<b>E</b> escursionistico', test: (t) => t.scale === 'E' },
    { color: '#6a1b9a', label: '<b>EE</b> esperti', test: (t) => t.scale === 'EE' },
    { color: '#111111', label: '<b>EEA</b> attrezzato', test: (t) => t.scale === 'EEA' },
  ];

// Gruppi dell'elenco "Per zona", nell'ordine in cui compaiono.
export const SECTOR_ORDER = BIKE
  ? ['Ciclovie', 'Mountain bike', 'Itinerari a tappe', 'Regioni confinanti']
  : ['Alto Tevere', 'Alto Chiascio', 'Valle Umbra Nord', 'Valle Spoletina', 'Valnerina', 'Valle del Nera',
    'Amerino', 'Orvietano-Tuderte', 'Perugino-Trasimeno', 'Lunga percorrenza', 'Altri sentieri', 'Regioni confinanti'];

// Etichette col numero sulla mappa: i percorsi in bici sono pochi e lunghi, si leggono anche da più lontano.
export const LABEL_MIN_ZOOM = BIKE ? 10 : 12;

// Guida: in bici si va più veloci, quindi tra due fix GPS si fa più strada e la freccia guarda più avanti.
export const GUIDE = BIKE ? { maxSpeed: 14, lookahead: 60 } : { maxSpeed: 2.5, lookahead: 35 };

// In bici lo schermo si guarda poco: uscendo dal percorso il telefono vibra e suona.
export const ALERTS = BIKE;
