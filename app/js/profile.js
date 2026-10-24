// Profilo altimetrico su canvas, con marcatore della posizione.
import { fmtDist } from './geo.js';

export function drawProfile(canvas, track, posS = null) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pts = track.pts;
  const eles = pts.map((p) => p[2]).filter((e) => e != null);
  if (eles.length < 2) {
    ctx.fillStyle = '#888';
    ctx.font = '12px system-ui';
    ctx.fillText('Quote non disponibili', 8, h / 2);
    return;
  }
  let lo = Math.min(...eles);
  let hi = Math.max(...eles);
  if (hi - lo < 50) { const m = (hi + lo) / 2; lo = m - 25; hi = m + 25; }
  const padL = 34, padR = 6, padT = 6, padB = 16;
  const L = track.length || 1;
  const X = (s) => padL + (s / L) * (w - padL - padR);
  const Y = (e) => padT + (1 - (e - lo) / (hi - lo)) * (h - padT - padB);
  const css = getComputedStyle(canvas);
  const line = css.getPropertyValue('--profile-line').trim() || '#c62828';
  const fill = css.getPropertyValue('--profile-fill').trim() || 'rgba(198,40,40,.15)';
  const text = css.getPropertyValue('--profile-text').trim() || '#555';

  ctx.beginPath();
  ctx.moveTo(X(0), Y(lo));
  for (let i = 0; i < pts.length; i++) if (pts[i][2] != null) ctx.lineTo(X(track.cum[i]), Y(pts[i][2]));
  ctx.lineTo(X(L), Y(lo));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  let first = true;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i][2] == null) continue;
    if (first) { ctx.moveTo(X(track.cum[i]), Y(pts[i][2])); first = false; } else ctx.lineTo(X(track.cum[i]), Y(pts[i][2]));
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = text;
  ctx.font = '10px system-ui';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(hi)}`, 2, Y(hi));
  ctx.fillText(`${Math.round(lo)}`, 2, Y(lo));
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('0', X(0), h - 3);
  const lt = fmtDist(L);
  ctx.fillText(lt, w - padR - ctx.measureText(lt).width, h - 3);

  if (posS != null) {
    const p = track.pointAt(posS);
    const x = X(posS);
    ctx.strokeStyle = text;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
    ctx.setLineDash([]);
    if (p[2] != null) {
      ctx.beginPath(); ctx.arc(x, Y(p[2]), 5, 0, Math.PI * 2);
      ctx.fillStyle = '#1565c0'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
  }
}
