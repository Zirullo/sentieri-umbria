import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const app = new URL('../app/', import.meta.url);
const read = (f) => readFileSync(new URL(f, app), 'utf8');
const sw = read('sw-core.js');
const list = (name) => [...new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(sw)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const OWN = list('OWN').filter((f) => f !== './');
const SHARED = list('SHARED');
const APPS = ['piedi/', 'bici/'];

test('ogni file precaricato dal service worker esiste (altrimenti l\'installazione fallisce)', () => {
  assert.ok(SHARED.length > 10);
  for (const f of SHARED) assert.ok(existsSync(new URL(f, app)), `manca ${f}`);
  for (const dir of APPS) {
    for (const f of OWN) assert.ok(existsSync(new URL(dir + f, app)), `manca ${dir}${f}`);
    assert.match(read(`${dir}sw.js`), /importScripts\('\.\.\/sw-core\.js'\)/);
  }
});

test('ogni modulo JS è nel precache', () => {
  for (const f of readdirSync(new URL('js/', app))) {
    assert.ok(SHARED.includes(`js/${f}`), `js/${f} non precaricato`);
  }
});

test('le due app hanno la stessa struttura e cartelle sorelle', () => {
  const ids = (file) => [...read(file).matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids('bici/index.html'), ids('piedi/index.html'));
  assert.match(read('bici/index.html'), /<html lang="it" data-mode="bici">/);
  // nessuna app nella cartella principale: conterrebbe l'altra e Chrome le confonderebbe all'installazione
  assert.ok(!existsSync(new URL('manifest.webmanifest', app)));
  for (const dir of APPS) {
    const m = JSON.parse(read(`${dir}manifest.webmanifest`));
    assert.equal(m.scope, './');
    assert.equal(m.start_url, './');
  }
});
