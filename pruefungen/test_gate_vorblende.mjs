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
//
// Drei Seiten mit derselben Bauweise: Cockpit (dashboard.html),
// Mitarbeiter-App (app.html) und Rapporterfassung (index.html).
//
// Die Gegenprobe ist gemacht und hat beim ersten Anlauf etwas aufgedeckt
// (CLAUDE.md, "Gegenprobe machen"): Nimmt man die Vorblende weg, MUSS die
// Suite rot werden. Ueber file:// tat sie das fuer index.html nicht -- die
// Seite ist klein genug, dass das erste Bild erst nach DOMContentLoaded
// entstand. Die Pruefung war also gruen, ohne etwas zu pruefen. Seither
// laeuft sie ueber einen eigenen Webserver mit verzoegerten Skripten
// (siehe unten); jetzt faellt jede der drei Seiten, wenn ihre Vorblende
// fehlt.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ÜBER HTTP, NICHT UEBER file://, UND MIT VERZOEGERTEN SKRIPTEN.
// Der Grund ist eine gescheiterte Gegenprobe: Ueber file:// laedt eine
// kleine Seite so schnell, dass das erste Bild erst NACH DOMContentLoaded
// entsteht -- die Maske ist dann laengst ausgeblendet, und die Pruefung
// bliebe gruen, auch wenn die Vorblende voellig fehlt. Gemessen waere
// damit nichts.
// Hier bekommt darum jede .js-Datei eine Verzoegerung. Das ist keine
// Schikane, sondern der Alltag: Genau in dieser Lage -- der Browser hat
// das Markup, wartet aber noch auf ein Skript -- zeichnet er, und genau
// das sieht der Mensch vor dem Bildschirm als Aufblitzen.
const TYPEN = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.mp4': 'video/mp4' };
const SKRIPT_VERZUG_MS = 400;

const server = createServer(async (req, res) => {
  const pfad = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const endung = extname(pfad).toLowerCase();
  let inhalt = null;
  try { inhalt = await readFile(join(WURZEL, pfad)); } catch (e) { inhalt = null; }
  const senden = () => {
    if (inhalt === null) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('weg'); return; }
    res.writeHead(200, { 'Content-Type': TYPEN[endung] || 'application/octet-stream' });
    res.end(inhalt);
  };
  if (endung === '.js') { setTimeout(senden, SKRIPT_VERZUG_MS); } else { senden(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASIS = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: browserPfad() });

// Bei jedem Bild nachsehen, ob die Maske sichtbar ist. Ein einzelner Blick
// nach dem Laden wuerde genau das verpassen, worum es geht: den kurzen
// Moment dazwischen.
const BEOBACHTER = (maske) => {
  window.__gateBilder = [];
  const sehen = () => {
    const g = document.querySelector(maske);
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

// Das Backend ist in dieser Pruefung nicht dabei -- der kleine Webserver
// oben liefert nur Dateien. Ohne eine Antwort auf me.php liefe die
// Oberflaeche in einen Fehler, der mit der Sache nichts zu tun hat.
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

// Drei Seiten, drei Namen fuer dieselbe Sache. Die Rapporterfassung
// (index.html) hat kein Video -- ihre Maske ist eine schlichte Flaeche.
const SEITEN = [
  { datei: 'dashboard.html', maske: '#gate',        video: true  },
  { datei: 'app.html',       maske: '#gate',        video: true  },
  { datei: 'index.html',     maske: '#loginScreen', video: false },
];

async function seite(datei, maske, { angemeldet }) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(5000);
  const videoAbrufe = [];
  p.on('request', r => { if (/anmeldung-nacht\.(webm|mp4)/.test(r.url())) videoAbrufe.push(r.url()); });
  await p.addInitScript(BEOBACHTER, maske);
  if (angemeldet) { await p.addInitScript(ANMELDUNG); await p.addInitScript(SERVER_STUMM); }
  await p.goto(`${BASIS}/${datei}`);
  await p.waitForTimeout(900);
  const bilder = await p.evaluate(() => window.__gateBilder || []);
  const quellen = await p.evaluate(() =>
    document.querySelectorAll('#gate-video source').length);
  const jetzt = await p.evaluate(m => {
    const g = document.querySelector(m);
    if (!g) return null;
    const s = getComputedStyle(g), r = g.getBoundingClientRect();
    return s.display !== 'none' && r.height > 0;
  }, maske);
  await p.close();
  return { bilder, quellen, jetzt, videoAbrufe };
}

for (const { datei, maske, video } of SEITEN) {
  // ── angemeldet: die Maske darf zu keinem Zeitpunkt erscheinen
  const a = await seite(datei, maske, { angemeldet: true });
  check(`${datei}: es wurde ueberhaupt waehrend des Ladens gemessen`, a.bilder.length > 0);
  check(`KRITISCH ${datei}: die Anmeldemaske blitzt beim Neuladen nicht auf`,
        a.bilder.length > 0 && !a.bilder.includes(true));
  check(`${datei}: sie ist auch nach dem Laden nicht da`, a.jetzt === false);
  if (video) {
    check(`${datei}: das Hintergrundvideo wird nicht eingebunden`, a.quellen === 0);
    check(`${datei}: und auch nicht abgerufen`, a.videoAbrufe.length === 0);
  }

  // ── nicht angemeldet: die Maske IST der Inhalt der Seite
  const b = await seite(datei, maske, { angemeldet: false });
  check(`KRITISCH ${datei}: ohne Anmeldung steht die Maske da`, b.jetzt === true);
  if (video) { check(`${datei}: ohne Anmeldung liegt das Video vor`, b.quellen === 2); }
}

// ── Token im Speicher, aber die Anmeldung traegt nicht.
// Hier darf die Vorblende nicht haengenbleiben: Wer kein Cockpit sieht,
// muss die Maske bekommen. Nachgestellt ueber einen halben Speicher
// (Token ohne Nutzer) -- genau der Fall, in dem der Start unten nicht in
// enter() fuehrt.
for (const { datei, maske } of SEITEN) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(5000);
  await p.addInitScript(() => {
    try { localStorage.setItem('rv3_token', 'x'.repeat(64));
          localStorage.removeItem('rv3_user'); } catch (e) {}
  });
  await p.goto(`${BASIS}/${datei}`);
  await p.waitForTimeout(600);
  const sichtbar = await p.evaluate(m => {
    const g = document.querySelector(m);
    return !!g && getComputedStyle(g).display !== 'none' && g.getBoundingClientRect().height > 0;
  }, maske);
  await p.close();
  check(`KRITISCH ${datei}: halber Speicher fuehrt zur Maske, nicht ins Leere`, sichtbar);
}

await browser.close();
server.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
