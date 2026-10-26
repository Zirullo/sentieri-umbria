// Pianificazione minima dell'escursione: tempo di percorrenza e luce disponibile.
import { LOCALE } from './i18n.js';

// Tempo di percorrenza (ore) secondo DIN 33466, usato anche da CAI/DAV:
// 4 km/h in piano, 300 m/h in salita, 500 m/h in discesa;
// tempo = maggiore + metà del minore tra componente orizzontale e verticale.
export function walkHours(lenM, up, down) {
  const h = lenM / 1000 / 4;
  const v = (up || 0) / 300 + (down || 0) / 500;
  return Math.max(h, v) + Math.min(h, v) / 2;
}

// Tempo in bici (ore), stima per chi pedala con calma e qualche sosta:
// in piano 15 km/h su ciclovia e 12 km/h in MTB, più il tempo della salita (600 o 500 m/h).
export function rideHours(lenM, up, mtb = false) {
  return lenM / 1000 / (mtb ? 12 : 15) + (up || 0) / (mtb ? 500 : 600);
}

// "2:30" / "PT2H30M" / "02:30:00" → ore decimali
export function parseDuration(s) {
  if (!s) return null;
  const iso = /^P?T?(?:(\d+)H)?(?:(\d+)M)?$/i.exec(s.trim());
  if (iso && (iso[1] || iso[2])) return (+iso[1] || 0) + (+iso[2] || 0) / 60;
  const hm = /^(\d+):(\d{1,2})(?::\d{2})?$/.exec(s.trim());
  if (hm) return +hm[1] + +hm[2] / 60;
  return null;
}

export function fmtHours(h) {
  if (h == null || !isFinite(h)) return '–';
  if (h < 5 / 60) return '< 5 min';
  let hh = Math.floor(h);
  let mm = Math.round(((h - hh) * 60) / 5) * 5;
  if (mm === 60) { hh++; mm = 0; }
  return `${hh}h${String(mm).padStart(2, '0')}`;
}

export const fmtTime = (d) => (d ? d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) : '–');

// Tramonto (algoritmo NOAA semplificato, precisione ~1-2 minuti), funziona offline.
export function sunset(date, lat, lon) {
  const rad = Math.PI / 180;
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const n = Math.round((day - Date.UTC(2000, 0, 1, 12)) / 86400000);
  const Jstar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * Jstar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const Jtransit = Jstar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const decl = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  if (cosH < -1 || cosH > 1) return null;
  const H = Math.acos(cosH) / rad / 360;
  return new Date(Date.UTC(2000, 0, 1, 12) + (Jtransit + H) * 86400000);
}

export const directionsUrl = (lat, lon) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(5)},${lon.toFixed(5)}&travelmode=driving`;
