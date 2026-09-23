// Kein Aufblitzen der Anmeldemaske beim Neuladen (Befund des
// Projektinhabers, 2026-09-23).
//
// Wer angemeldet war und die Seite neu lud, sah fuer den Bruchteil einer
// Sekunde die Anmeldemaske und danach wieder das Cockpit. Die Ursache lag
// nicht in der Sitzung, sondern in der Reihenfolge: Die Maske steht im
// Markup und wird gezeichnet, lange bevor das Skript am Dateiende
// nachsieht, ob eine Anmeldung im Speicher liegt. Gegenmittel ist dieselbe
// Vorblende, die hell/dunkel schon laenger benutzt -- eine Klasse am
// <html>, gesetzt im Kopf.
//
// GEMESSEN, NICHT NACHGELESEN (CLAUDE.md): Eine Pruefung, die im Quelltext
// nach der Klasse sucht, bliebe gruen, wenn die Regel spaeter von einer
// staerkeren ueberschrieben wird. Darum wird hier bei JEDEM Bild waehrend
// des Ladens nachgesehen, ob die Maske sichtbar ist -- genau das, was das
// Auge sieht.
//
// Die Vorblende ist ausdruecklich KEINE Sperre: Sie entscheidet nicht, wer
// hereinkommt, sondern nur, was gezeichnet wird. Der Fall "Token im
// Speicher, aber Anmeldung traegt nicht" wird darum mitgeprueft -- dort
// MUSS die Maske kommen.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });

// Bei jedem Bild nachsehen, ob die Maske sichtbar ist. Ein einzelner Blick
// nach dem Laden wuerde genau das verpassen, worum es geht: den kurzen
// Moment dazwischen.
const BEOBACHTER = () => {
  window.__gateBilder = [];
  const sehen = () => {
    const g = document.getElementById('gate');
    if (g) {
      const s = getComputedStyle(g);
      const r = g.getBoundingClientRect();
      window.__gateBilder.push(s.display !== 'none' && s.visibility !== 'hidden'
        && r.width > 0 && r.height > 0);
    }
    if (document.readyState !== 'complete') { requestAnimationFrame(sehen); }
  };
  requestAnimationFrame(sehen);
};

// Eine abgelegte Anmeldung, wie sie nach dem ersten Anmelden im Speicher
// steht. Frei erfunden und ohne Bezug zu einem echten Konto.
const ANMELDUNG = () => {
  try {
    localStorage.setItem('rv3_token', 'x'.repeat(64));
    localStorage.setItem('rv3_user', JSON.stringify({
      name: 'Pruefkonto', ist_admin: true, rollen: ['verwaltung'],
      rechte: ['personal_lesen', 'einsaetze_lesen']
    }));
  } catch (e) {}
};

// Der Server ist in dieser Pruefung nicht dabei (file://). Ohne eine
// Antwort auf me.php liefe die Oberflaeche in einen Fehler, der mit der
// Sache nichts zu tun hat.
const SERVER_STUMM = () => {
  const echt = window.fetch;
  window.fetch = (u, o) => {
    const pfad = String(u);
    if (pfad.includes('me.php')) {
      return Promise.resolve(new Response(JSON.stringify({
        status: 'ok', name: 'Pruefkonto', ist_admin: true, rollen: ['verwaltung'],
        rechte: ['personal_lesen', 'einsaetze_lesen'], sparten: ['sicherheit']
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (pfad.startsWith('http') || pfad.startsWith('file')) {
      return Promise.resolve(new Response('{}', { status: 200,
        headers: { 'Content-Type': 'application/json' } }));
    }
    return echt(u, o);
  };
};

async function seite(datei, { angemeldet }) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(5000);
  const videoAbrufe = [];
  p.on('request', r => { if (/anmeldung-nacht\.(webm|mp4)/.test(r.url())) videoAbrufe.push(r.url()); });
  await p.addInitScript(BEOBACHTER);
  if (angemeldet) { await p.addInitScript(ANMELDUNG); await p.addInitScript(SERVER_STUMM); }
  await p.goto(`file://${WURZEL}/${datei}`);
  await p.waitForTimeout(900);
  const bilder = await p.evaluate(() => window.__gateBilder || []);
  const quellen = await p.evaluate(() =>
    document.querySelectorAll('#gate-video source').length);
  const jetzt = await p.evaluate(() => {
    const g = document.getElementById('gate');
    if (!g) return null;
    const s = getComputedStyle(g), r = g.getBoundingClientRect();
    return s.display !== 'none' && r.height > 0;
  });
  await p.close();
  return { bilder, quellen, jetzt, videoAbrufe };
}

for (const datei of ['dashboard.html', 'app.html']) {
  // ── angemeldet: die Maske darf zu keinem Zeitpunkt erscheinen
  const a = await seite(datei, { angemeldet: true });
  check(`${datei}: es wurde ueberhaupt waehrend des Ladens gemessen`, a.bilder.length > 0);
  check(`KRITISCH ${datei}: die Anmeldemaske blitzt beim Neuladen nicht auf`,
        a.bilder.length > 0 && !a.bilder.includes(true));
  check(`${datei}: sie ist auch nach dem Laden nicht da`, a.jetzt === false);
  check(`${datei}: das Hintergrundvideo wird nicht eingebunden`, a.quellen === 0);
  check(`${datei}: und auch nicht abgerufen`, a.videoAbrufe.length === 0);

  // ── nicht angemeldet: die Maske IST der Inhalt der Seite
  const b = await seite(datei, { angemeldet: false });
  check(`KRITISCH ${datei}: ohne Anmeldung steht die Maske da`, b.jetzt === true);
  check(`${datei}: ohne Anmeldung liegt das Video vor`, b.quellen === 2);
}

// ── Token im Speicher, aber die Anmeldung traegt nicht.
// Hier darf die Vorblende nicht haengenbleiben: Wer kein Cockpit sieht,
// muss die Maske bekommen. Nachgestellt ueber einen halben Speicher
// (Token ohne Nutzer) -- genau der Fall, in dem der Start unten nicht in
// enter() fuehrt.
for (const datei of ['dashboard.html', 'app.html']) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(5000);
  await p.addInitScript(() => {
    try { localStorage.setItem('rv3_token', 'x'.repeat(64));
          localStorage.removeItem('rv3_user'); } catch (e) {}
  });
  await p.goto(`file://${WURZEL}/${datei}`);
  await p.waitForTimeout(600);
  const sichtbar = await p.evaluate(() => {
    const g = document.getElementById('gate');
    return !!g && getComputedStyle(g).display !== 'none' && g.getBoundingClientRect().height > 0;
  });
  await p.close();
  check(`KRITISCH ${datei}: halber Speicher fuehrt zur Maske, nicht ins Leere`, sichtbar);
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
