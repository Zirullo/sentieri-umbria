// Direzione del telefono (0 = nord) dalla bussola, con ripiego sulla rotta GPS.
import { angleDiff, norm360 } from './geo.js';

export class Compass {
  constructor(onChange) {
    this.onChange = onChange;
    this.heading = null;
    this.source = 'none'; // 'compass' | 'gps' | 'none'
    this.lastCompassAt = 0;
    this._onAbs = (e) => this._handle(e, true);
    this._onRel = (e) => this._handle(e, false);
  }

  async start() {
    // iOS: serve un permesso esplicito (qui per completezza; l'app è pensata per Android)
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      try { await DeviceOrientationEvent.requestPermission(); } catch { /* ignorato */ }
    }
    window.addEventListener('deviceorientationabsolute', this._onAbs);
    window.addEventListener('deviceorientation', this._onRel);
  }

  stop() {
    window.removeEventListener('deviceorientationabsolute', this._onAbs);
    window.removeEventListener('deviceorientation', this._onRel);
  }

  _handle(e, absolute) {
    let h = null;
    if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
    else if ((absolute || e.absolute) && e.alpha != null) h = 360 - e.alpha;
    if (h == null) return;
    const screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    this._set(norm360(h + screenAngle), 'compass');
    this.lastCompassAt = Date.now();
  }

  // Rotta dal GPS: usata solo se la bussola tace e ci si sta muovendo.
  gps(course, speed) {
    if (course == null || isNaN(course) || !(speed > 0.8)) return;
    if (Date.now() - this.lastCompassAt < 3000) return;
    this._set(course, 'gps');
  }

  _set(h, source) {
    if (this.heading == null || this.source !== source) this.heading = h;
    else this.heading = norm360(this.heading + angleDiff(this.heading, h) * 0.25); // filtro passa-basso circolare
    this.source = source;
    this.onChange(this.heading, source);
  }
}
