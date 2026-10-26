// Lingua dell'interfaccia. Il codice scrive le frasi in italiano dentro tr(): la frase italiana è la chiave
// dei dizionari (en.js, de.js, …) e, se manca la traduzione, resta com'è.
// Prima apertura: la lingua del telefono se c'è, altrimenti inglese. La scelta si cambia dalla barra in basso
// a sinistra sulla mappa e vale per le due app (stesso sito, chiave senza prefisso). Fuori dal browser (test
// Node) sempre italiano.
import { EN } from './en.js';
import { DE } from './de.js';

const KEY = 'lang';
// nome di ogni lingua scritto nella lingua stessa
export const LANGS = { it: 'Italiano', en: 'English', de: 'Deutsch' };
// Una voce di dizionario è una frase, oppure:
//   { piedi: …, bici: … }               frase diversa nelle due versioni (articoli e casi di sentiero/percorso)
//   { one: …, few: …, many: …, other: … } forme del plurale secondo {n} (categorie di Intl.PluralRules)
// Le voci di IT servono solo per i plurali dell'italiano.
const IT = {
  '{n} filtri attivi': { one: '{n} filtro attivo', other: '{n} filtri attivi' },
};
export const DICTS = { it: IT, en: EN, de: DE };
const LOCALES = { it: 'it-IT', en: 'en-GB', de: 'de-DE' };

function detect() {
  if (!globalThis.document) return 'it';
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS[saved]) return saved;
  } catch { /* ignorato */ }
  const phone = (navigator.languages?.[0] || navigator.language || 'it').toLowerCase().slice(0, 2);
  return LANGS[phone] ? phone : 'en';
}

export const LANG = detect();
export const LOCALE = LOCALES[LANG];
if (globalThis.document) document.documentElement.lang = LANG;

// Versione dell'app e sue parole (sentiero o percorso, vedi config.js), in ogni frase come {one}, {Many}, …
let bike = false;
let words = {};
export function setMode(isBike, w) {
  bike = isBike;
  words = w;
  return w;
}

const plural = new Intl.PluralRules(LOCALE);
function pick(v, p) {
  if (typeof v === 'string') return v;
  if ('piedi' in v) return pick(bike ? v.bici : v.piedi, p);
  return v[plural.select(p.n)] ?? v.other;
}

// tr('{d} da te', { d: '2 km' }) → "2 km da te" / "2 km from you"
export function tr(s, params = {}) {
  const v = DICTS[LANG][s];
  const out = v == null ? s : pick(v, params);
  const p = { ...words, ...params };
  return out.replace(/\{(\w+)\}/g, (m, k) => (k in p ? p[k] : m));
}

// numero con i decimali indicati, separatore della lingua (3,4 in italiano, 3.4 in inglese)
export const dec = (x, digits) => x.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });

// Descrizioni: scritte in italiano, tradotte al momento. Col traduttore del telefono (Translator API di Chrome,
// dove c'è) senza rete né chiavi: 'available' traduce subito, 'downloadable' scarica prima la lingua e il
// browser lo permette solo dopo un tocco. Altrimenti, su richiesta, Google Traduttore dentro l'app.
export async function machineAvailability() {
  if (LANG === 'it' || !globalThis.Translator) return 'unavailable';
  try {
    return await Translator.availability({ sourceLanguage: 'it', targetLanguage: LANG });
  } catch {
    return 'unavailable';
  }
}

let translator = null;
// da chiamare subito nel gestore del tocco (nessun await prima di create) quando la lingua va scaricata
export async function machineTranslate(text) {
  translator ??= Translator.create({ sourceLanguage: 'it', targetLanguage: LANG });
  try {
    return await (await translator).translate(text);
  } catch (e) {
    translator = null;
    throw e;
  }
}

// Google Traduttore dentro l'app: indirizzo pubblico senza chiave (quello delle estensioni del browser), non
// documentato, quindi può smettere di funzionare: in quel caso resta il link alla pagina di Google Traduttore.
export async function googleTranslate(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=it&tl=${LANG}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const parts = (await r.json())?.[0];
  if (!Array.isArray(parts)) throw new Error('risposta inattesa');
  return parts.map((s) => s[0]).join('');
}

export const googleTranslateUrl = (text) =>
  `https://translate.google.com/?sl=it&tl=${LANG}&op=translate&text=${encodeURIComponent(text)}`;

// cambia lingua e ricarica: le etichette si costruiscono all'avvio (una navigazione in corso riprende da sola)
export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch { /* ignorato */ }
  location.reload();
}
