import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const app = new URL('../app/', import.meta.url);

test('ogni file precaricato dal service worker esiste (altrimenti l\'installazione fallisce)', () => {
  const sw = readFileSync(new URL('sw.js', app), 'utf8');
  const list = /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1];
  const files = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((f) => f !== './');
  assert.ok(files.length > 10);
  for (const f of files) assert.ok(existsSync(new URL(f, app)), `manca ${f}`);
});

test('ogni modulo JS importato è nel precache', () => {
  const sw = readFileSync(new URL('sw.js', app), 'utf8');
  for (const f of ['app', 'geo', 'nav', 'compass', 'offline', 'plan', 'profile']) {
    assert.ok(sw.includes(`'js/${f}.js'`), `js/${f}.js non precaricato`);
  }
});
