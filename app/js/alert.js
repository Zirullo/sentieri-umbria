// Avviso fuori percorso con vibrazione e suono, per quando lo schermo non si guarda (in bici).
// Il browser fa suonare la pagina solo dopo un tocco: unlockSound va chiamata da un gesto dell'utente.

let audio = null;

export function unlockSound() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* audio non disponibile */ }
}

// Sequenza di note brevi: [frequenza Hz, durata s].
function beep(notes) {
  if (!audio || audio.state !== 'running') return;
  let t = audio.currentTime;
  for (const [freq, dur] of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + dur);
    t += dur + 0.06;
  }
}

// Uscito dal percorso: tre impulsi lunghi e un suono acuto ripetuto.
export function alertOff() {
  navigator.vibrate?.([400, 150, 400, 150, 400]);
  beep([[880, 0.22], [660, 0.22], [880, 0.22], [660, 0.22]]);
}

// Rientrato: un impulso breve e due note che salgono.
export function alertBack() {
  navigator.vibrate?.(150);
  beep([[660, 0.12], [990, 0.18]]);
}
