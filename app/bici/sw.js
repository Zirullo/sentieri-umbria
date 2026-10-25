// Service worker della versione in bici: stesso codice della versione a piedi, con cache proprie.
self.APP = { prefix: 'bici-', shell: 'bici-', shared: '../' };
importScripts('../sw-core.js');
