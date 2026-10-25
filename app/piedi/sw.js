// Service worker della versione a piedi. Mappe e tracce scaricate tengono i nomi di cache senza prefisso
// che avevano quando l'app stava nella cartella principale, così non vanno riscaricate.
self.APP = { prefix: '', shell: 'piedi-', shared: '../' };
importScripts('../sw-core.js');
