import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const app = new URL('../app/', import.meta.url);
const sw = readFileSync(new URL('sw.js', app), 'utf8');
const list = (name) => [...new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(sw)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const OWN = list('OWN').filter((f) => f !== './');
const SHARED = list('SHARED');

test('ogni file precaricato dal service worker esiste (altrimenti l\'installazione fallisce)', () => {
  assert.ok(SHARED.length > 10);
  for (const f of SHARED) assert.ok(existsSync(new URL(f, app)), `manca ${f}`);
  // i file propri servono sia alla versione a piedi sia a quella in bici
  for (const dir of ['', 'bici/']) {
    for (const f of OWN) assert.ok(existsSync(new URL(dir + f, app)), `manca ${dir}${f}`);
  }
});

test('ogni modulo JS è nel precache', () => {
  for (const f of readdirSync(new URL('js/', app))) {
    assert.ok(SHARED.includes(`js/${f}`), `js/${f} non precaricato`);
  }
});

test('la pagina della versione in bici ha la stessa struttura di quella a piedi', () => {
  const ids = (file) => [...readFileSync(new URL(file, app), 'utf8').matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids('bici/index.html'), ids('index.html'));
  assert.match(readFileSync(new URL('bici/index.html', app), 'utf8'), /<html lang="it" data-mode="bici">/);
  assert.match(readFileSync(new URL('bici/sw.js', app), 'utf8'), /importScripts\('\.\.\/sw\.js'\)/);
});
