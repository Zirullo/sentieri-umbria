// Lingua dell'interfaccia: italiano o inglese. Il codice scrive le frasi in italiano dentro tr():
// la frase italiana è la chiave del dizionario (en.js) e, se manca la traduzione, resta com'è.
// Prima apertura: italiano se il telefono è in italiano, altrimenti inglese. La scelta si cambia dalla legenda
// e vale per le due app (stesso sito, chiave senza prefisso). Fuori dal browser (test Node) sempre italiano.
import { EN } from './en.js';

const KEY = 'lang';
export const LANGS = { it: 'Italiano', en: 'English' };

function detect() {
  if (!globalThis.document) return 'it';
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS[saved]) return saved;
  } catch { /* ignorato */ }
  return (navigator.languages?.[0] || navigator.language || 'it').toLowerCase().startsWith('it') ? 'it' : 'en';
}

export const LANG = detect();
export const LOCALE = LANG === 'en' ? 'en-GB' : 'it-IT';
if (globalThis.document) document.documentElement.lang = LANG;

// Parole della versione (sentiero o percorso, vedi config.js), disponibili in ogni frase come {one}, {Many}, …
let words = {};
export const setWords = (w) => (words = w);

// tr('{d} da te', { d: '2 km' }) → "2 km da te" / "2 km from you"
export function tr(s, params = {}) {
  const out = (LANG === 'en' && EN[s]) || s;
  const p = { ...words, ...params };
  return out.replace(/\{(\w+)\}/g, (m, k) => (k in p ? p[k] : m));
}

// numero con i decimali indicati e la virgola in italiano
export const dec = (x, digits) => (LANG === 'it' ? x.toFixed(digits).replace('.', ',') : x.toFixed(digits));

// Descrizioni: scritte in italiano, tradotte al momento. Col traduttore del telefono (Translator API di Chrome,
// dove c'è) senza rete né chiavi: 'available' traduce subito, 'downloadable' scarica prima la lingua e il
// browser lo permette solo dopo un tocco. Altrimenti si apre Google Traduttore.
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

export const googleTranslateUrl = (text) =>
  `https://translate.google.com/?sl=it&tl=${LANG}&op=translate&text=${encodeURIComponent(text)}`;

// cambia lingua e ricarica: le etichette si costruiscono all'avvio (una navigazione in corso riprende da sola)
export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch { /* ignorato */ }
  location.reload();
}
