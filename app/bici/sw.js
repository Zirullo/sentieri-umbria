// Service worker della versione in bici: stesso codice della versione a piedi, con cache proprie.
self.APP = { prefix: 'bici-', shared: '../' };
importScripts('../sw.js');
