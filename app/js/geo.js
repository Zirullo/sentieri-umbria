// Funzioni geometriche su coordinate [lat, lon].
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversine(a, b) {
  const dp = rad(b[0] - a[0]);
  const dl = rad(b[1] - a[1]);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Rotta iniziale da a verso b, in gradi 0..360 (0 = nord).
export function bearing(a, b) {
  const p1 = rad(a[0]);
  const p2 = rad(b[0]);
  const dl = rad(b[1] - a[1]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export const norm360 = (a) => ((a % 360) + 360) % 360;
// Differenza angolare con segno in -180..180.
export const angleDiff = (a, b) => ((b - a + 540) % 360) - 180;

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
export const cardinal = (b) => DIRS[Math.round(norm360(b) / 45) % 8];

export function fmtDist(m) {
  if (m == null || !isFinite(m)) return '–';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`;
}

// Traccia ordinata con distanze progressive e ricerca del punto più vicino.
export class Track {
  // pts: [[lat, lon, ele], ...]
  constructor(pts) {
    this.pts = pts;
    const lat0 = pts[0][0];
    this.kx = Math.cos(rad(lat0)) * 111320;
    this.ky = 110540;
    this.lon0 = pts[0][1];
    this.lat0 = lat0;
    this.xy = pts.map((p) => [(p[1] - this.lon0) * this.kx, (p[0] - lat0) * this.ky]);
    this.cum = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) this.cum[i] = this.cum[i - 1] + haversine(pts[i - 1], pts[i]);
    this.length = this.cum[pts.length - 1];
  }

  reversed() {
    return new Track([...this.pts].reverse());
  }

  toXY(lat, lon) {
    return [(lon - this.lon0) * this.kx, (lat - this.lat0) * this.ky];
  }

  // Punto della traccia più vicino a (lat, lon). Se la traccia passa più volte vicino
  // (andata e ritorno, anelli) preferisce la proiezione più coerente con sHint;
  // senza storico preferisce l'inizio (negli anelli partenza e arrivo coincidono).
  nearest(lat, lon, sHint = 0) {
    const [px, py] = this.toXY(lat, lon);
    const xy = this.xy;
    const cands = [];
    let dmin = Infinity;
    for (let i = 0; i < xy.length - 1; i++) {
      const [ax, ay] = xy[i];
      const bx = xy[i + 1][0] - ax;
      const by = xy[i + 1][1] - ay;
      const len2 = bx * bx + by * by;
      let t = len2 > 0 ? ((px - ax) * bx + (py - ay) * by) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = ax + bx * t - px;
      const dy = ay + by * t - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < dmin) dmin = d;
      if (d < dmin + 25) cands.push([d, i, t]);
    }
    let best = null;
    let bestScore = Infinity;
    for (const [d, i, t] of cands) {
      if (d > dmin + 15) continue;
      const s = this.cum[i] + (this.cum[i + 1] - this.cum[i]) * t;
      // tra tratti ugualmente vicini (tornanti, andata e ritorno) preferisce la continuità:
      // penalizza i salti all'indietro e quelli in avanti oltre 30 m
      const score = d + (s < sHint ? sHint - s : Math.max(0, s - sHint - 30)) * 0.2;
      if (score < bestScore) {
        bestScore = score;
        best = { d, i, t, s };
      }
    }
    const p = this.pointAt(best.s);
    return { ...best, lat: p[0], lon: p[1] };
  }

  indexAt(s) {
    const c = this.cum;
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  pointAt(s) {
    s = Math.max(0, Math.min(this.length, s));
    const i = this.indexAt(s);
    const a = this.pts[i];
    const b = this.pts[Math.min(i + 1, this.pts.length - 1)];
    const seg = this.cum[i + 1] - this.cum[i] || 1;
    const t = (s - this.cum[i]) / seg;
    const ea = a[2] ?? b[2];
    const eb = b[2] ?? a[2];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ea == null ? null : ea + (eb - ea) * t];
  }

  // Dislivello positivo/negativo rimanente da s alla fine (isteresi 5 m come nei dati).
  climbFrom(s) {
    let up = 0;
    let down = 0;
    let ref = this.pointAt(s)[2];
    for (let i = this.indexAt(s) + 1; i < this.pts.length; i++) {
      const e = this.pts[i][2];
      if (e == null || ref == null) continue;
      if (e - ref >= 5) { up += e - ref; ref = e; }
      else if (ref - e >= 5) { down += ref - e; ref = e; }
    }
    return [Math.round(up), Math.round(down)];
  }
}

// Riquadri mappa (schema XYZ) che coprono un punto.
export function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
export function latToTileY(lat, z) {
  const r = rad(lat);
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}
