// Logica di guida: dato un fix GPS, decide verso dove puntare la freccia.
import { bearing, haversine } from './geo.js';

export const OFF_TRACK_M = 30;
const BACK_ON_M = 20;       // isteresi per tornare "sul sentiero"
const LOOKAHEAD_M = 35;     // la freccia punta a questo anticipo lungo la traccia
const ARRIVE_M = 25;
const MAX_ACCURACY_M = 60;  // fix peggiori non cambiano lo stato

export class Guide {
  constructor(track, offTrackM = OFF_TRACK_M) {
    this.track = track;
    this.offTrackM = offTrackM;
    this.reset();
  }

  reset() {
    this.s = null;          // progressiva sulla traccia
    this.joined = false;    // è già stato sul sentiero almeno una volta
    this.off = false;
    this.offCount = 0;
    this.arrived = false;
  }

  update(lat, lon, accuracy = 10) {
    const tr = this.track;
    const near = tr.nearest(lat, lon, this.s);
    const weak = accuracy > MAX_ACCURACY_M;
    const d = near.d;

    if (!weak) {
      if (d <= this.offTrackM) {
        // sul sentiero: la progressiva può solo crescere di poco o restare (evita salti indietro dovuti al rumore)
        if (this.s == null || near.s > this.s - 40) this.s = near.s;
        if (d <= BACK_ON_M || !this.off) {
          this.off = false;
          this.offCount = 0;
        }
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
      if (this.s == null) this.s = near.s;
    } else if (this.off) {
      mode = 'off';
      target = [near.lat, near.lon];
    } else {
      mode = 'on';
      target = tr.pointAt(this.s + LOOKAHEAD_M);
    }

    const s = this.s ?? near.s;
    const remaining = Math.max(0, tr.length - s);
    if (this.joined && !this.off && remaining < ARRIVE_M) this.arrived = true;
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
