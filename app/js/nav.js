// Logica di guida: dato un fix GPS, decide verso dove puntare la freccia.
import { bearing, haversine } from './geo.js';

export const OFF_TRACK_M = 30;
const BACK_ON_M = 20;       // isteresi per tornare "sul sentiero"
const LOOKAHEAD_M = 35;     // la freccia punta a questo anticipo lungo la traccia
const ARRIVE_M = 25;
const MAX_ACCURACY_M = 60;  // fix peggiori non cambiano lo stato
const MAX_FWD_M = 60;       // avanzamento accettato subito tra due fix
const MAX_BACK_M = 40;      // arretramento accettato subito (rumore, piccoli ritorni)
const JUMP_CONFIRM = 3;     // fix coerenti necessari per un salto più grande
const WALK_MPS = 2.5;       // velocità massima plausibile a piedi, per fix distanziati nel tempo

export class Guide {
  constructor(track, offTrackM = OFF_TRACK_M) {
    this.track = track;
    this.offTrackM = offTrackM;
    this.reset();
  }

  reset() {
    this.s = null;          // progressiva sulla traccia
    this.joined = false;    // è già stato sul sentiero almeno una volta
    this.joinS = null;      // progressiva del primo ingresso sul sentiero
    this.pending = null;    // salto di progressiva in attesa di conferma
    this.lastT = null;      // istante dell'ultima progressiva accettata
    this.off = false;
    this.offCount = 0;
    this.arrived = false;
  }

  // Aggiorna la progressiva. Piccoli spostamenti si accettano subito; un salto grande
  // (un punto GPS anomalo vicino a un altro tratto, un'ansa, un tornante) solo se
  // confermato da JUMP_CONFIRM fix consecutivi coerenti tra loro.
  _advance(s, now) {
    const accept = () => {
      this.s = s;
      this.lastT = now;
      this.pending = null;
    };
    if (!this.joined) return accept();
    // se il GPS manda fix radi (risparmio energetico) in mezzo si cammina di più
    const maxFwd = MAX_FWD_M + WALK_MPS * Math.max(0, (now - (this.lastT ?? now)) / 1000);
    const jump = s - this.s;
    if (jump >= -MAX_BACK_M && jump <= maxFwd) return accept();
    if (this.pending && Math.abs(s - this.pending.s) < maxFwd) this.pending = { s, n: this.pending.n + 1 };
    else this.pending = { s, n: 1 };
    if (this.pending.n >= JUMP_CONFIRM) accept();
  }

  update(lat, lon, accuracy = 10, now = Date.now()) {
    const tr = this.track;
    const near = tr.nearest(lat, lon, this.s ?? 0);
    const weak = accuracy > MAX_ACCURACY_M;
    const d = near.d;

    if (!weak) {
      if (d <= this.offTrackM) {
        // sul sentiero: la progressiva può solo crescere di poco o restare (evita salti indietro dovuti al rumore)
        this._advance(near.s, now);
        if (d <= BACK_ON_M || !this.off) {
          this.off = false;
          this.offCount = 0;
        }
        if (!this.joined) this.joinS = this.s;
        this.joined = true;
      } else if (this.joined) {
        this.offCount++;
        // due fix consecutivi oltre soglia, o uno molto oltre, per evitare falsi allarmi
        if (this.offCount >= 2 || d > this.offTrackM * 2) this.off = true;
      }
    }

    const here = [lat, lon];
    let mode;
    let target;
    if (!this.joined) {
      mode = 'approach';
      target = [near.lat, near.lon];
      this.s = near.s;
    } else if (this.off) {
      mode = 'off';
      target = [near.lat, near.lon];
    } else {
      mode = 'on';
      target = tr.pointAt(this.s + LOOKAHEAD_M);
    }

    const s = this.s ?? near.s;
    const remaining = Math.max(0, tr.length - s);
    // l'arrivo conta solo dopo aver percorso almeno metà del sentiero (negli anelli si parte già "vicino all'arrivo")
    const walked = s - (this.joinS ?? s);
    if (this.joined && !this.off && remaining < ARRIVE_M && walked > (tr.length - this.joinS) * 0.5) this.arrived = true;
    if (this.arrived) mode = 'arrived';

    const end = tr.pts[tr.pts.length - 1];
    return {
      mode,
      destBearing: bearing(here, end),
      destDist: haversine(here, end),
      weak,
      accuracy,
      distToTrack: d,
      nearest: [near.lat, near.lon],
      target,
      targetBearing: bearing(here, target),
      targetDist: haversine(here, target),
      done: s,
      remaining,
      ele: tr.pointAt(s)[2],
      climb: tr.climbFrom(s),
    };
  }
}
