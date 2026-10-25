import { Track, bearing, cardinal, fmtDist, haversine } from './geo.js';
import { Guide } from './nav.js';
import { Compass } from './compass.js';
import { drawProfile } from './profile.js';
import { MAX_NATIVE_ZOOM, TILE_URL, deleteTrail, downloadTrail, isDownloaded, registry, syncDataVersion } from './offline.js';
import { SCALE_LABEL, directionsUrl, fmtHours, fmtTime, parseDuration, sunset, walkHours } from './plan.js';
import { CUSTOM_SECTOR, importFromHash, loadCustom, removeCustom } from './custom.js';
import { CLIMBS, DURATIONS, NO_FILTERS, SCALES, activeCount, isLoop, loadFilters, matches, saveFilters } from './filters.js';

const $ = (s) => document.querySelector(s);
const SIM = new URLSearchParams(location.search).has('sim');
const SCALE_COLOR = { T: '#2e7d32', E: '#c62828', EE: '#6a1b9a', EEA: '#111111' };
const ACTIVE_KEY = 'active-nav';
const ATTRIB = 'Mappa © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · Dati © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

let trails = [];
let byId = new Map();
let map;
let selectedLayer = null;
let myPos = null;        // [lat, lon] ultima posizione nota
let listSort = 'zone';
let filters = loadFilters();
let currentId = null;    // sentiero in anteprima o nella scheda

const trailUrl = (id) => `data/trails/${id}.json`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Nomi OSM generici come "Sentiero 501" o "CAI 501" non dicono nulla: meglio "partenza – arrivo".
const genericName = (n) => !n || /^(sentiero|cai|percorso)[\s\w.°-]*\d+[a-z]?$/i.test(n.trim());
const title = (t) => (!genericName(t.name) && t.name) || [t.from, t.to].filter(Boolean).join(' – ') || t.name || `Sentiero ${t.ref}`;

function toast(msg, ms = 2500) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, ms);
}

function tileLayer() {
  return L.tileLayer(TILE_URL, { subdomains: 'abc', maxNativeZoom: MAX_NATIVE_ZOOM, maxZoom: 18, attribution: ATTRIB, crossOrigin: true });
}

function hoursOf(t, reversed = false) {
  const tag = t.tags?.[reversed ? 'duration:backward' : 'duration:forward'];
  const h = parseDuration(tag);
  if (h) return { h, src: 'CAI' };
  const up = reversed ? t.down : t.up;
  const down = reversed ? t.up : t.down;
  return { h: walkHours(t.len, up, down), src: 'stima' };
}

/* ---------- Mappa generale ---------- */

const LABEL_MIN_ZOOM = 12;
const LABEL_MAX = 120;
const TAP_PX = 28; // raggio di tocco: circa un polpastrello

const shown = (t) => matches(t, filters, hoursOf(t).h);

function initMap() {
  map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([42.95, 12.55], 9);
  tileLayer().addTo(map);
  const renderer = L.canvas({ padding: 0.3 });
  for (const t of trails) {
    t.layer = L.polyline(t.geom, { color: SCALE_COLOR[t.scale] || '#e65100', weight: 3, opacity: 0.85, renderer, interactive: false });
  }
  labels = L.layerGroup().addTo(map);
  map.on('click', (e) => pickTrail(e.containerPoint, e.latlng));
  map.on('moveend', renderLabels);
  applyFilters();
  if (SIM) window.appMap = map;
}

function applyFilters() {
  for (const t of trails) {
    const show = shown(t);
    if (show && !map.hasLayer(t.layer)) t.layer.addTo(map);
    if (!show && map.hasLayer(t.layer)) t.layer.remove();
  }
  renderLabels();
  const n = activeCount(filters);
  $('#filter-badge').hidden = !n;
  $('#filter-badge').textContent = n;
}

/* ---------- Filtri ---------- */

function renderFilters() {
  const count = trails.filter(shown).length;
  const opt = (group, value, label, on) => `<button data-g="${group}" data-v="${value}" class="${on ? 'on' : ''}">${label}</button>`;
  $('#filters-body').innerHTML = `
    <h2>Filtri</h2>
    <div class="f-title">Difficoltà</div>
    <div class="f-opts">${Object.entries(SCALES).map(([s, label]) => opt('scale', s, `<b>${s}</b> ${label}`, filters.scales.includes(s))).join('')}</div>
    <div class="f-title">Durata stimata</div>
    <div class="f-opts">${DURATIONS.map(([, , label], i) => opt('dur', i, label, filters.dur === i)).join('')}</div>
    <div class="f-title">Salita totale</div>
    <div class="f-opts">${CLIMBS.map(([, label], i) => opt('climb', i, label, filters.climb === i)).join('')}</div>
    <label class="f-check"><input type="checkbox" data-g="loop" ${filters.loop ? 'checked' : ''}> Solo anelli (torni alla partenza)</label>
    <label class="f-check"><input type="checkbox" data-g="cai" ${filters.cai ? 'checked' : ''}> Solo sentieri CAI</label>
    <div class="actions">
      <button id="f-reset" ${activeCount(filters) ? '' : 'disabled'}>Azzera</button>
      <button id="f-done" class="primary">${count ? `Mostra ${count}` : 'Nessun sentiero'}</button>
    </div>`;
}

function setFilters(f) {
  filters = f;
  saveFilters(f);
  applyFilters();
  renderFilters();
  if (!$('#list').hidden) renderList();
}

function onFilterClick(e) {
  if (e.target.id === 'f-done') { $('#filters').hidden = true; return; }
  if (e.target.id === 'f-reset') { setFilters({ ...NO_FILTERS }); return; }
  const b = e.target.closest('[data-g]');
  if (!b) return;
  const f = { ...filters };
  const g = b.dataset.g;
  if (g === 'scale') {
    const s = b.dataset.v;
    f.scales = f.scales.includes(s) ? f.scales.filter((x) => x !== s) : [...f.scales, s];
  } else if (g === 'dur' || g === 'climb') f[g] = Number(b.dataset.v);
  else f[g] = b.checked;
  setFilters(f);
}

function showFilters() {
  closePeek();
  $('#sheet').hidden = true;
  renderFilters();
  $('#filters').hidden = false;
}

/* Etichette col numero del sentiero, solo da uno zoom in cui si leggono.
   Ogni sentiero visibile ha la sua etichetta sulla parte inquadrata, senza sovrapposizioni. */
let labels;
function renderLabels() {
  labels.clearLayers();
  if (map.getZoom() < LABEL_MIN_ZOOM) return;
  const size = map.getSize();
  const view = map.getBounds();
  const placed = [];
  const free = (p) => placed.every((q) => Math.abs(q.x - p.x) > 38 || Math.abs(q.y - p.y) > 22);
  for (const t of trails) {
    if (!shown(t) || !t.ref) continue;
    const [s, w, n, e] = t.bbox;
    if (!view.intersects([[s, w], [n, e]])) continue;
    const vis = [];
    for (const seg of t.geom) for (const ll of seg) {
      const p = map.latLngToContainerPoint(ll);
      if (p.x > 24 && p.y > 16 && p.x < size.x - 24 && p.y < size.y - 16) vis.push([ll, p]);
    }
    const spot = [0.5, 0.3, 0.7, 0.15, 0.85].map((f) => vis[Math.floor(f * (vis.length - 1))]).find((c) => c && free(c[1]));
    if (!spot) continue;
    placed.push(spot[1]);
    const icon = L.divIcon({
      className: 'trail-label',
      html: `<span style="border-color:${SCALE_COLOR[t.scale] || '#e65100'}">${esc(t.ref)}</span>`,
      iconSize: null,
    });
    L.marker(spot[0], { icon, keyboard: false }).on('click', (ev) => {
      L.DomEvent.stop(ev);
      previewTrail(t.id);
    }).addTo(labels);
    if (placed.length >= LABEL_MAX) break;
  }
}

// Distanza in pixel da un punto dello schermo a un sentiero.
function pxDistance(t, pt) {
  let best = Infinity;
  for (const seg of t.geom) {
    let prev = null;
    for (const ll of seg) {
      const p = map.latLngToContainerPoint(ll);
      if (prev) best = Math.min(best, L.LineUtil.pointToSegmentDistance(pt, prev, p));
      prev = p;
    }
  }
  return best;
}

// Tocco sulla mappa: anteprima del sentiero più vicino, o scelta se ce n'è più d'uno sotto il dito.
// Un tocco nel vuoto chiude l'anteprima.
function pickTrail(pt, latlng) {
  const view = map.getBounds().pad(0.1);
  const near = [];
  for (const t of trails) {
    if (!shown(t)) continue;
    const [s, w, n, e] = t.bbox;
    if (!view.intersects([[s, w], [n, e]])) continue;
    const d = pxDistance(t, pt);
    if (d <= TAP_PX) near.push([d, t]);
  }
  near.sort((a, b) => a[0] - b[0]);
  if (!near.length) return closePeek();
  if (near.length === 1) return previewTrail(near[0][1].id);
  const html = `<div class="pick"><b>Quale sentiero?</b>${near.slice(0, 6).map(([, t]) =>
    `<button data-id="${t.id}"><span class="ref"><span>${esc(t.ref || '–')}</span></span> ${esc(title(t))}</button>`).join('')}</div>`;
  const popup = L.popup({ closeButton: false, maxWidth: 280, className: 'pick-popup' }).setLatLng(latlng).setContent(html).openOn(map);
  popup.getElement().addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-id]');
    if (!b) return;
    map.closePopup();
    previewTrail(Number(b.dataset.id));
  });
}

let selectedDir = null;
function clearSelection() {
  selectedLayer?.remove();
  selectedDir?.remove();
  selectedLayer = selectedDir = null;
  dimOthers(false);
}

// Con un sentiero selezionato gli altri si attenuano, così spicca anche dove sono fitti.
function dimOthers(on) {
  if (dimOthers.on === on) return;
  dimOthers.on = on;
  for (const t of trails) t.layer?.setStyle({ opacity: on ? 0.35 : 0.85 });
}

// Verso scelto nella scheda: frecce ed estremi anche sulla mappa principale.
function showDirection(d, reversed) {
  selectedDir?.remove();
  selectedDir = directionLayer(buildTrack(d, reversed), map).addTo(map);
}

function highlight(t) {
  clearSelection();
  selectedLayer = L.layerGroup([
    L.polyline(t.geom, { color: '#fff', weight: 9, opacity: 0.9, interactive: false }),
    L.polyline(t.geom, { color: '#ff6f00', weight: 5, interactive: false }),
  ]).addTo(map);
  dimOthers(true);
}

/* ---------- Anteprima: sentiero evidenziato e riquadro con i dati principali ---------- */

function previewTrail(id, { zoom = false } = {}) {
  const t = byId.get(id);
  if (!t) return;
  showList(false);
  $('#sheet').hidden = true;
  $('#filters').hidden = true;
  map.closePopup();
  currentId = id;
  highlight(t);
  renderPeek(t);
  fitTrail(t, { cover: $('#peek'), gentle: !zoom });
}

function renderPeek(t) {
  const loop = isLoop(t);
  const route = genericName(t.name) ? '' : [t.from, t.to].filter(Boolean).join(' → ');
  const sub = [route, t.sector].filter(Boolean).join(' · ');
  const chips = [
    t.scale ? `<span class="chip scale" style="background:${SCALE_COLOR[t.scale] || '#e65100'}">${esc(t.scale)} · ${esc(SCALE_LABEL[t.scale] || '')}</span>` : '',
    `<span class="chip">${fmtDist(t.len)}</span>`,
    t.up != null ? `<span class="chip">↑ ${t.up} m</span>` : '',
    `<span class="chip">⏱ ${fmtHours(hoursOf(t).h)}</span>`,
    loop ? '<span class="chip">↻ anello</span>' : '',
    myPos ? `<span class="chip">📍 ${fmtDist(distToTrail(t, myPos))} da te</span>` : '',
    isDownloaded(t.id) ? '<span class="chip ok">✓ offline</span>' : '',
  ].join('');
  $('#peek').innerHTML = `
    <div class="peek-head">
      <span class="ref"><span>${esc(t.ref || '–')}</span></span>
      <div class="peek-title"><b>${esc(title(t))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
      <button class="icon-btn peek-close" aria-label="Chiudi">✕</button>
    </div>
    <div class="chips">${chips}</div>
    <button class="peek-open">Dettagli e partenza ›</button>`;
  $('#peek').hidden = false;
  $('#btn-locate').style.bottom = `${$('#peek').offsetHeight + 24}px`;
}

function closePeek() {
  if ($('#peek').hidden) return;
  $('#peek').hidden = true;
  $('#btn-locate').style.bottom = '';
  clearSelection();
}

/* ---------- Elenco e ricerca ---------- */

function distToTrail(t, p) {
  let d = Infinity;
  for (const seg of t.geom) for (const q of seg) d = Math.min(d, haversine(p, q));
  return d;
}

function itemHtml(t, extra = '') {
  const h = hoursOf(t).h;
  const sub = [t.scale, fmtDist(t.len), t.up != null ? `↑${t.up} m` : null, fmtHours(h), extra].filter(Boolean).join(' · ');
  const saved = isDownloaded(t.id) ? ' ✓' : '';
  return `<button class="item" data-id="${t.id}">
    <span class="ref"><span>${esc(t.ref || '–')}</span></span>
    <span class="item-main"><div class="item-name">${esc(title(t))}${saved}</div><div class="item-sub">${esc(sub)}</div></span>
  </button>`;
}

function renderList() {
  const body = $('#list-body');
  const q = normalize($('#search').value.trim());
  const n = activeCount(filters);
  $('#list-note').hidden = !n || !!q || listSort === 'saved';
  $('#list-note').textContent = `${n} ${n === 1 ? 'filtro attivo' : 'filtri attivi'} · modifica`;
  let pool = trails.filter(shown);
  if (q) {
    pool = trails.filter((t) => (t.search ??= normalize(`${t.ref} ${t.name} ${t.from} ${t.to} ${t.sector}`)).includes(q));
    pool.sort((a, b) => (normalize(b.ref) === q) - (normalize(a.ref) === q) || (normalize(b.ref).startsWith(q)) - (normalize(a.ref).startsWith(q)));
    body.innerHTML = pool.length ? pool.slice(0, 100).map((t) => itemHtml(t)).join('') : '<div class="empty">Nessun sentiero trovato</div>';
    return;
  }
  if (listSort === 'near') {
    if (!myPos) {
      body.innerHTML = '<div class="empty">Cerco la tua posizione…</div>';
      locate(() => renderList());
      return;
    }
    const near = pool.map((t) => [t, distToTrail(t, myPos)]).sort((a, b) => a[1] - b[1]).slice(0, 60);
    body.innerHTML = near.map(([t, d]) => itemHtml(t, `${fmtDist(d)} da te`)).join('');
    return;
  }
  if (listSort === 'saved') {
    const ids = Object.keys(registry()).map(Number);
    const saved = ids.map((id) => byId.get(id)).filter(Boolean);
    body.innerHTML = saved.length ? saved.map((t) => itemHtml(t)).join('')
      : '<div class="empty">Nessun sentiero scaricato.<br>Apri un sentiero e premi «Scarica offline».</div>';
    return;
  }
  const groups = new Map();
  for (const t of pool) {
    if (!groups.has(t.sector)) groups.set(t.sector, []);
    groups.get(t.sector).push(t);
  }
  const order = [CUSTOM_SECTOR, 'Alto Tevere', 'Alto Chiascio', 'Valle Umbra Nord', 'Valle Spoletina', 'Valnerina', 'Valle del Nera',
    'Amerino', 'Orvietano-Tuderte', 'Perugino-Trasimeno', 'Lunga percorrenza', 'Altri sentieri', 'Regioni confinanti'];
  body.innerHTML = order.filter((g) => groups.has(g))
    .map((g) => `<div class="group-title">${esc(g)} (${groups.get(g).length})</div>${groups.get(g).map((t) => itemHtml(t)).join('')}`)
    .join('');
}

function showList(show) {
  $('#list').hidden = !show;
  $('#btn-view').textContent = show ? '🗺' : '☰';
  $('#btn-view').setAttribute('aria-label', show ? 'Mostra mappa' : 'Mostra elenco');
  if (show) renderList();
  else map.invalidateSize();
}

function locate(cb) {
  if (!navigator.geolocation) return toast('GPS non disponibile');
  navigator.geolocation.getCurrentPosition(
    (p) => { myPos = [p.coords.latitude, p.coords.longitude]; cb?.(myPos); },
    () => toast('Posizione non disponibile: controlla i permessi'),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

let meMarker = null;
function showMe(p) {
  if (!meMarker) meMarker = L.circleMarker(p, { radius: 8, color: '#fff', weight: 3, fillColor: '#1565c0', fillOpacity: 1 }).addTo(map);
  else meMarker.setLatLng(p);
  map.setView(p, Math.max(map.getZoom(), 13));
  if (!$('#peek').hidden) renderPeek(byId.get(currentId)); // aggiunge la distanza da te
}

/* ---------- Scheda sentiero ---------- */

async function loadDetail(id) {
  const t = byId.get(id);
  if (t?.custom) return t;
  const r = await fetch(trailUrl(id));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function openTrail(id) {
  const t = byId.get(id);
  if (!t) return;
  showList(false);
  $('#peek').hidden = true;
  $('#btn-locate').style.bottom = '';
  currentId = id;
  highlight(t);
  const sheet = $('#sheet');
  sheet.hidden = false;
  $('#sheet-body').innerHTML = `<h2>${esc(t.ref)} · ${esc(title(t))}</h2><div class="sub">Caricamento…</div>`;
  let d;
  try {
    d = await loadDetail(id);
  } catch {
    $('#sheet-body').innerHTML = `<h2>${esc(t.ref)} · ${esc(title(t))}</h2>
      <div class="warn">Traccia non disponibile offline. Scaricala quando hai rete.</div>`;
    return;
  }
  renderSheet(d);
  fitTrail(t);
}

// Inquadra il sentiero nella parte di mappa non coperta dalla scheda (o dall'anteprima).
// gentle: la mappa si muove solo se il sentiero non è già tutto visibile, e senza avvicinarsi.
function fitTrail(t, { cover = $('#sheet'), gentle = false } = {}) {
  const coverH = cover.hidden ? 0 : cover.offsetHeight;
  const top = $('#map').getBoundingClientRect().top;
  const visibleBottom = window.innerHeight - coverH - top;
  const size = map.getSize();
  const pad = Math.max(20, size.y - visibleBottom + 20);
  const b = L.latLngBounds([t.bbox[0], t.bbox[1]], [t.bbox[2], t.bbox[3]]);
  if (gentle) {
    const nw = map.latLngToContainerPoint(b.getNorthWest());
    const se = map.latLngToContainerPoint(b.getSouthEast());
    if (nw.x >= 0 && nw.y >= 0 && se.x <= size.x && se.y <= size.y - pad + 20) return;
  }
  map.fitBounds(b, { paddingTopLeft: [20, 20], paddingBottomRight: [20, pad], maxZoom: gentle ? map.getZoom() : 16 });
}

function renderSheet(d) {
  const tags = d.tags || {};
  // verso predefinito: parti dall'estremo più vicino a te
  let reversed = false;
  if (myPos && !tags.roundtrip) reversed = haversine(myPos, d.end) < haversine(myPos, d.start);
  const fromLabel = tags.from || 'Inizio';
  const toLabel = tags.to || 'Fine';
  const loop = isLoop(d);
  // senso di un anello: segno dell'area (formula di Gauss) con x = longitudine, y = latitudine
  const ring = d.segments.flat();
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [y1, x1] = ring[i];
    const [y2, x2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  const ccw = area > 0;

  const render = () => {
    const { h, src } = hoursOf(d, reversed);
    const saved = isDownloaded(d.id);
    const desc = tags['description:it'] || tags.description || tags['note:it'] || '';
    $('#sheet-body').innerHTML = `
      <h2>${esc(d.ref)} · ${esc(title(d))}</h2>
      <div class="sub">${esc(reversed ? toLabel : fromLabel)} → ${esc(reversed ? fromLabel : toLabel)}${loop ? ' (anello)' : ''} · ${esc(d.sector)}</div>
      <div class="chips">
        ${d.scale ? `<span class="chip scale" title="${esc(SCALE_LABEL[d.scale] || '')}">${esc(d.scale)}</span>` : ''}
        <span class="chip">${fmtDist(d.len)}</span>
        ${d.up != null ? `<span class="chip">↑ ${reversed ? d.down : d.up} m · ↓ ${reversed ? d.up : d.down} m</span>` : ''}
        <span class="chip">⏱ ${fmtHours(h)} <small>(${src})</small></span>
      </div>
      <div class="plan" id="plan"></div>
      ${d.gaps ? `<div class="warn">La traccia ha ${d.gaps} ${d.gaps === 1 ? 'interruzione' : 'interruzioni'} nei dati: lì segui la segnaletica.</div>` : ''}
      ${!saved && !navigator.onLine ? '<div class="warn">Sei offline e questo sentiero non è scaricato: la mappa potrebbe mancare.</div>' : ''}
      ${desc ? `<div class="desc">${esc(desc.length > 280 ? `${desc.slice(0, 280)}…` : desc)}</div>` : ''}
      <div class="dir-title">Verso di percorrenza${loop ? ' (anello)' : ''}</div>
      <div class="dir-choice">
        <button data-rev="0" class="${reversed ? '' : 'on'}">${loop ? (ccw ? '↺ antiorario' : '↻ orario') : `${esc(fromLabel)} → ${esc(toLabel)}`}</button>
        <button data-rev="1" class="${reversed ? 'on' : ''}">${loop ? (ccw ? '↻ orario' : '↺ antiorario') : `${esc(toLabel)} → ${esc(fromLabel)}`}</button>
      </div>
      <div class="actions">
        <button id="btn-dl" class="${saved ? 'ok' : ''}">${saved ? '✓ Offline' : '⬇ Scarica offline'}</button>
        <a href="${directionsUrl(...(reversed ? d.end : d.start))}" target="_blank" rel="noopener">🚗 Come arrivare</a>
      </div>
      <div class="progress" id="dl-progress" hidden><div></div></div>
      <div class="actions"><button id="btn-go" class="primary">▶ Inizia</button></div>
      ${d.custom ? `<div class="src">Sentiero personale, salvato solo su questo telefono ·
        <a href="#" id="btn-del-custom">elimina</a></div>`
    : `<div class="src">Dati © OpenStreetMap contributors (ODbL) ·
        <a href="https://www.openstreetmap.org/relation/${d.id}" target="_blank" rel="noopener">relazione ${d.id}</a>
        ${tags['survey:date'] ? ` · rilievo ${esc(tags['survey:date'])}` : ''}</div>`}`;
    $('#btn-del-custom')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!confirm(`Eliminare il sentiero «${d.name}»?`)) return;
      removeCustom(d.name);
      location.reload();
    });
    renderPlan(d, h, reversed);
    showDirection(d, reversed);
    for (const b of document.querySelectorAll('.dir-choice button')) b.onclick = () => { reversed = b.dataset.rev === '1'; render(); };
    $('#btn-go').onclick = () => startNav(d, reversed);
    $('#btn-dl').onclick = () => (isDownloaded(d.id) ? removeDownload(d, render) : download(d, render));
  };
  render();
}

function renderPlan(d, hours, reversed) {
  const el = $('#plan');
  const start = reversed ? d.end : d.start;
  const draw = (date) => {
    const ss = sunset(date, start[0], start[1]);
    const latest = ss ? new Date(ss.getTime() - (hours + 0.5) * 3600000) : null;
    const today = new Date().toDateString() === date.toDateString();
    const late = today && latest && Date.now() > latest.getTime();
    const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    el.innerHTML = `📅 <input type="date" id="plan-date" value="${ymd}">
      tramonto <b>${fmtTime(ss)}</b> · parti entro le <b>${fmtTime(latest)}</b>
      ${late ? '<div class="warn">Oggi è tardi per completarlo con la luce.</div>' : ''}`;
    $('#plan-date').onchange = (e) => {
      const [y, m, dd] = e.target.value.split('-').map(Number);
      if (y) draw(new Date(y, m - 1, dd, 12));
    };
  };
  draw(new Date());
}

async function download(d, rerender) {
  const btn = $('#btn-dl');
  const bar = $('#dl-progress');
  if (!navigator.onLine) return toast('Serve una connessione per scaricare');
  btn.disabled = true;
  bar.hidden = false;
  try {
    const res = await downloadTrail(d, d.custom ? null : trailUrl(d.id), (n, tot) => {
      btn.textContent = `⬇ ${Math.round((n / tot) * 100)}%`;
      bar.firstElementChild.style.width = `${(n / tot) * 100}%`;
    });
    toast(res.failed ? `Scaricato con ${res.failed} riquadri mancanti: riprova` : `Pronto offline (${(res.bytes / 1e6).toFixed(1)} MB)`);
  } catch (e) {
    toast(`Download non riuscito: ${e.message}`);
  }
  rerender();
}

async function removeDownload(d, rerender) {
  if (!confirm('Eliminare la mappa offline di questo sentiero?')) return;
  await deleteTrail(d.id, d.custom ? null : trailUrl(d.id));
  toast('Mappa offline eliminata');
  rerender();
}

/* ---------- Navigazione ---------- */

const nav = { map: null, guide: null, track: null, watch: null, compass: null, wake: null, follow: true, last: null, layers: {} };

const endName = (d, reversed) => (reversed ? d.tags?.from : d.tags?.to) || 'Arrivo';

function buildTrack(d, reversed) {
  const pts = [];
  for (const seg of d.segments) for (const p of seg) {
    const prev = pts[pts.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) pts.push(p);
  }
  const tr = new Track(pts);
  return reversed ? tr.reversed() : tr;
}

async function startNav(d, reversed) {
  $('#sheet').hidden = true;
  $('#nav').hidden = false;
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: d.id, reversed, at: Date.now() })); } catch { /* ignorato */ }
  nav.detail = d;
  nav.reversed = reversed;
  nav.track = buildTrack(d, reversed);
  nav.guide = new Guide(nav.track);
  nav.endName = endName(d, reversed);
  nav.follow = true;
  nav.last = null;

  if (!nav.map) {
    // in navigazione i crediti stanno su una riga sola, per lasciare spazio alla mappa
    nav.map = L.map('nav-map', { zoomControl: false, preferCanvas: true, attributionControl: false });
    L.control.attribution({ prefix: false }).addAttribution('© OpenTopoMap · © OpenStreetMap').addTo(nav.map);
    L.tileLayer(TILE_URL, { subdomains: 'abc', maxNativeZoom: MAX_NATIVE_ZOOM, maxZoom: 18, crossOrigin: true }).addTo(nav.map);
    nav.map.on('dragstart', () => { nav.follow = false; });
    if (SIM) {
      nav.map.on('click', (e) => onFix({ coords: { latitude: e.latlng.lat, longitude: e.latlng.lng, accuracy: 5 } }));
      window.simFix = (lat, lon, accuracy = 5) => onFix({ coords: { latitude: lat, longitude: lon, accuracy } });
      window.simTrack = () => nav.track;
    }
  }
  drawNavTrack();
  nav.map.invalidateSize();
  nav.map.fitBounds(nav.layers.line.getBounds(), { padding: [30, 30] });
  setBanner('approach', 'In attesa del GPS…');

  nav.compass?.stop();
  nav.compass = new Compass(scheduleArrow);
  nav.compass.start();
  if (!SIM && navigator.geolocation) {
    nav.watch = navigator.geolocation.watchPosition(onFix, onGeoError, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }
  keepAwake();
  drawProfile($('#profile'), nav.track, null);
}

// Frecce del verso di percorrenza lungo la traccia (una ogni ~90 px, ricalcolate a ogni zoom)
// ed etichette Partenza / Arrivo agli estremi.
function directionLayer(track, m) {
  const arrows = L.layerGroup();
  const metersPerPx = (40075016 * Math.cos((track.pts[0][0] * Math.PI) / 180)) / 256;
  const draw = () => {
    arrows.clearLayers();
    const step = Math.max(track.length / 200, 10, (metersPerPx / 2 ** m.getZoom()) * 75);
    for (let s = step / 2; s < track.length - step / 4; s += step) {
      const a = track.pointAt(s);
      // direzione media su ~30 m: le piccole curve non fanno ruotare la freccia a caso
      const dir = bearing(track.pointAt(Math.max(0, s - 15)), track.pointAt(Math.min(track.length, s + 15)));
      const html = `<span style="transform:translate(-50%,-50%) rotate(${dir.toFixed(0)}deg)">`
        + '<svg viewBox="0 0 12 12"><path d="M6 1 L11 10.5 L6 8 L1 10.5 Z"/></svg></span>';
      L.marker([a[0], a[1]], { icon: L.divIcon({ className: 'dir-arrow', html, iconSize: null }), interactive: false, keyboard: false }).addTo(arrows);
    }
  };
  const a = track.pts[0];
  const z = track.pts[track.pts.length - 1];
  const ep = (p, cls, text) => L.marker([p[0], p[1]], {
    icon: L.divIcon({ className: 'ep-wrap', html: `<span class="ep ${cls}">${text}</span>`, iconSize: null }),
    interactive: false, keyboard: false, zIndexOffset: 1000,
  });
  const group = L.layerGroup([
    arrows,
    L.circleMarker([a[0], a[1]], { radius: 8, color: '#fff', weight: 3, fillColor: '#2e7d32', fillOpacity: 1, interactive: false }),
    L.circleMarker([z[0], z[1]], { radius: 8, color: '#fff', weight: 3, fillColor: '#111', fillOpacity: 1, interactive: false }),
    ep(a, 'start', 'Partenza'),
    ep(z, 'end', '🏁 Arrivo'),
  ]);
  group.on('add', () => { m.on('zoomend', draw); draw(); });
  group.on('remove', () => m.off('zoomend', draw));
  return group;
}

function drawNavTrack() {
  const m = nav.map;
  for (const l of Object.values(nav.layers)) l.remove();
  const latlngs = nav.track.pts.map((p) => [p[0], p[1]]);
  const segs = nav.detail.segments.map((s) => s.map((p) => [p[0], p[1]]));
  // dove i dati OSM sono interrotti il collegamento è solo indicativo: tratteggiato
  const gaps = segs.slice(1).map((s, i) => [segs[i][segs[i].length - 1], s[0]]);
  nav.layers = {
    casing: L.polyline(segs, { color: '#fff', weight: 10, opacity: 0.9, interactive: false }).addTo(m),
    line: L.polyline(segs, { color: '#d50000', weight: 6, interactive: false }).addTo(m),
    gaps: L.polyline(gaps, { color: '#d50000', weight: 4, dashArray: '2 10', opacity: 0.8, interactive: false }).addTo(m),
    extras: L.layerGroup((nav.detail.extras || []).map((x) => L.polyline(x.pts, { color: '#d50000', weight: 3, dashArray: '6 8', opacity: 0.7, interactive: false }))).addTo(m),
    done: L.polyline([], { color: '#9e9e9e', weight: 6, interactive: false }).addTo(m),
    direction: directionLayer(nav.track, m).addTo(m),
    toTarget: L.polyline([], { color: '#1565c0', weight: 3, dashArray: '4 8', interactive: false }).addTo(m),
    me: L.marker(latlngs[0], { icon: L.divIcon({ className: 'me', html: '<div class="cone"></div><div class="dot"></div>', iconSize: [0, 0] }), interactive: false, opacity: 0 }).addTo(m),
  };
}

function onFix(p) {
  const { latitude: lat, longitude: lon, accuracy, heading, speed } = p.coords;
  myPos = [lat, lon];
  nav.compass?.gps(heading, speed);
  const r = nav.guide.update(lat, lon, accuracy ?? 10);
  nav.last = r;

  nav.layers.me.setLatLng(myPos).setOpacity(1);
  // tratto già percorso in grigio: resta rosso solo quello che manca
  if (r.mode !== 'approach') {
    const tr = nav.track;
    const i = tr.indexAt(r.done);
    const p = tr.pointAt(r.done);
    nav.layers.done.setLatLngs([...tr.pts.slice(0, i + 1).map((q) => [q[0], q[1]]), [p[0], p[1]]]);
  }
  nav.layers.toTarget.setLatLngs(r.mode === 'approach' || r.mode === 'off' ? [myPos, r.target] : []);
  if (nav.follow) nav.map.setView(myPos, Math.max(nav.map.getZoom(), 16), { animate: false });

  const dir = cardinal(r.targetBearing);
  if (r.weak) setBanner('weak', `Segnale GPS debole (±${Math.round(accuracy)} m)`);
  else if (r.mode === 'off') setBanner('off', `⚠ FUORI SENTIERO · ${fmtDist(r.distToTrack)}`);
  else if (r.mode === 'approach') setBanner('approach', `Raggiungi il sentiero · ${fmtDist(r.distToTrack)} verso ${dir}`);
  else if (r.mode === 'arrived') setBanner('arrived', '🏁 Arrivato!');
  else setBanner('on', '✓ Sul sentiero');

  $('#nav-target').textContent = r.mode === 'on' ? `${fmtDist(r.remaining)}` : r.mode === 'arrived' ? 'Arrivo' : fmtDist(r.targetDist);
  nav.hint = r.mode === 'on' ? `all'arrivo · ↑${r.climb[0]} m ↓${r.climb[1]} m`
    : r.mode === 'arrived' ? 'Percorso completato'
    : `Torna sul sentiero verso ${dir}`;
  $('#nav-done').textContent = r.mode === 'approach' ? '–' : fmtDist(r.done);
  $('#nav-left').textContent = fmtDist(r.remaining);
  $('#nav-ele').textContent = r.ele != null ? `${Math.round(r.ele)} m` : '–';
  drawProfile($('#profile'), nav.track, r.done);
  renderArrow();
}

function onGeoError(e) {
  const msg = e.code === 1 ? 'Permesso GPS negato: abilitalo nelle impostazioni del browser' : 'GPS non disponibile, riprovo…';
  setBanner('weak', msg);
}

function setBanner(cls, text) {
  const b = $('#nav-banner');
  b.className = `banner ${cls}`;
  b.textContent = text;
}

// La bussola può emettere decine di eventi al secondo: un solo aggiornamento per fotogramma.
let arrowQueued = false;
function scheduleArrow() {
  if (arrowQueued) return;
  arrowQueued = true;
  requestAnimationFrame(() => { arrowQueued = false; renderArrow(); });
}

function renderArrow() {
  const r = nav.last;
  const c = nav.compass;
  const box = $('#compass');
  box.className = `compass ${r ? r.mode : 'approach'}${c?.heading == null ? ' north' : ''}`;
  const heading = c?.heading ?? 0;
  if (!r) return;
  const rot = r.mode === 'arrived' ? 0 : r.targetBearing - heading;
  const arrow = $('#arrow');
  // ruota per la via più breve evitando giri completi nell'animazione CSS
  const prev = renderArrow.prev ?? rot;
  const next = prev + ((((rot - prev) % 360) + 540) % 360) - 180;
  renderArrow.prev = next;
  arrow.style.transform = `rotate(${next}deg)`;
  $('#dest-arrow').style.transform = `rotate(${r.destBearing - heading}deg)`;
  $('#nav-dest-text').textContent = `🏁 ${nav.endName} · ${fmtDist(r.destDist)} ${cardinal(r.destBearing)} in linea d'aria`;
  const cone = document.querySelector('.me .cone');
  if (cone) { cone.style.display = c?.heading == null ? 'none' : ''; cone.style.transform = `rotate(${heading}deg)`; }
  $('#nav-hint').textContent = nav.hint + (c?.heading == null && r.mode !== 'arrived' ? ' · senza bussola: in alto = nord' : '');
}

async function keepAwake() {
  try {
    nav.wake = await navigator.wakeLock?.request('screen');
  } catch { /* non supportato o negato */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#nav').hidden) keepAwake();
});

function stopNav() {
  if (nav.watch != null) navigator.geolocation.clearWatch(nav.watch);
  nav.watch = null;
  nav.compass?.stop();
  nav.wake?.release().catch(() => {});
  nav.wake = null;
  try { localStorage.removeItem(ACTIVE_KEY); } catch { /* ignorato */ }
  $('#nav').hidden = true;
  $('#sheet').hidden = false;
  map.invalidateSize();
}

/* ---------- Avvio ---------- */

function bind() {
  $('#btn-view').onclick = () => showList($('#list').hidden);
  $('#search').addEventListener('input', () => { if ($('#list').hidden) showList(true); else renderList(); });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = normalize(e.target.value.trim());
    const exact = trails.find((t) => normalize(t.ref) === q);
    if (exact) { e.target.blur(); previewTrail(exact.id, { zoom: true }); }
  });
  for (const b of document.querySelectorAll('.seg button')) {
    b.onclick = () => {
      listSort = b.dataset.sort;
      document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
      $('#search').value = '';
      renderList();
    };
  }
  $('#btn-filter').onclick = () => ($('#filters').hidden ? showFilters() : ($('#filters').hidden = true));
  $('#filters').addEventListener('click', onFilterClick);
  $('#filters .sheet-close').onclick = () => { $('#filters').hidden = true; };
  $('#list-note').onclick = showFilters;
  $('#list-body').addEventListener('click', (e) => {
    const it = e.target.closest('.item');
    if (it) previewTrail(Number(it.dataset.id), { zoom: true });
  });
  $('#peek').addEventListener('click', (e) => {
    if (e.target.closest('.peek-close')) closePeek();
    else if (e.target.closest('.peek-open')) openTrail(currentId);
  });
  // chiusa la scheda si torna all'anteprima dello stesso sentiero
  $('#sheet .sheet-close').onclick = () => { $('#sheet').hidden = true; previewTrail(currentId); };
  $('#btn-locate').onclick = () => locate(showMe);
  $('#nav-exit').onclick = stopNav;
  $('#nav-reverse').onclick = () => {
    nav.reversed = !nav.reversed;
    nav.track = buildTrack(nav.detail, nav.reversed);
    nav.guide = new Guide(nav.track);
    nav.endName = endName(nav.detail, nav.reversed);
    drawNavTrack();
    try { localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: nav.detail.id, reversed: nav.reversed, at: Date.now() })); } catch { /* ignorato */ }
    drawProfile($('#profile'), nav.track, null);
    toast('Verso invertito');
    if (myPos) onFix({ coords: { latitude: myPos[0], longitude: myPos[1], accuracy: 10 } });
  };
  $('#nav-center').onclick = () => { nav.follow = true; if (myPos) nav.map.setView(myPos, Math.max(nav.map.getZoom(), 16)); };
  window.addEventListener('resize', () => { if (!$('#nav').hidden && nav.track) drawProfile($('#profile'), nav.track, nav.last?.done ?? null); });
}

async function resumeIfActive() {
  let a;
  try { a = JSON.parse(localStorage.getItem(ACTIVE_KEY)); } catch { return; }
  if (!a || Date.now() - a.at > 12 * 3600000 || !byId.has(a.id)) return;
  try {
    const d = await loadDetail(a.id);
    currentId = a.id;
    highlight(byId.get(a.id));
    renderSheet(d);
    $('#sheet').hidden = false;
    startNav(d, a.reversed);
    toast('Navigazione ripresa');
  } catch { /* traccia non disponibile */ }
}

async function main() {
  bind();
  if ('serviceWorker' in navigator) {
    // nuova versione installata: ricarica, ma mai durante una navigazione
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && $('#nav').hidden) location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  try {
    const r = await fetch('data/index.json');
    const idx = await r.json();
    const added = importFromHash();
    if (added) setTimeout(() => toast(`Sentiero «${added}» aggiunto`), 500);
    trails = [...loadCustom(), ...idx.trails];
    syncDataVersion(idx.generated).catch(() => {});
  } catch {
    toast('Impossibile caricare l\'elenco dei sentieri', 6000);
    return;
  }
  byId = new Map(trails.map((t) => [t.id, t]));
  initMap();
  await resumeIfActive();
}

main();
