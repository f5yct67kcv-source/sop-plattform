// Wächter-Status auf der Revierdienst-Hauptseite (ENT-232).
//
// Geprüft wird nicht das Aussehen, sondern die Aussagen, die still falsch
// werden können:
//
//   1. Es erscheinen ALLE heute Eingeteilten, nicht nur die mit laufendem
//      Rundgang. Das war der ausdrückliche Entscheid des Projektinhabers.
//      Fiele es auf "nur laufende" zurück, sähe die Seite normal aus --
//      nur wäre "eingeteilt, aber noch nicht losgelaufen" unsichtbar, und
//      genau das interessiert die Einsatzleitung.
//   2. Die drei Zustände hängen am Rundgang-Status.
//   3. Fehlende Angaben sagen, DASS sie fehlen. "Unbekannt darf nie wie
//      keine aussehen" ist die meistverletzte Hausregel -- eine leere
//      Rollenzeile sähe aus wie "hat keine Funktion" statt "nicht gepflegt".
//   4. Der Zähler mischt keine Einheiten: "aktiv" zählt laufende Rundgänge,
//      "eingeteilt" zählt Personen.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Vier Personen, die zusammen jeden Zustand und jede Lücke abdecken.
const LEUTE = { status: 'ok', datum: '2026-01-15', eingeteilt: 4, aktiv: 2, leute: [
  { mitarbeiter_id: 1, vorname: 'Anna', nachname: 'Muster', funktion: 'Revierführer',
    einsatz_id: 1, titel: 'Schliessrunde Nacht', objekt_id: 1, objekt_name: 'Objekt A',
    rundgang_id: 9, status: 'aktiv', letzter_punkt: 'Tor 4' },
  { mitarbeiter_id: 2, vorname: 'Beat', nachname: 'Beispiel', funktion: 'Wächter',
    einsatz_id: 2, titel: 'Kontrollgang', objekt_id: 2, objekt_name: 'Objekt B',
    rundgang_id: 10, status: 'pause', letzter_punkt: 'Eingang Süd' },
  { mitarbeiter_id: 3, vorname: 'Cara', nachname: 'Probe', funktion: null,
    einsatz_id: 3, titel: 'Revierdienst', objekt_id: 3, objekt_name: 'Objekt C',
    rundgang_id: null, status: 'frei', letzter_punkt: null },
  { mitarbeiter_id: 4, vorname: 'Dora', nachname: 'Test', funktion: 'Wächter',
    einsatz_id: 4, titel: 'Schliessrunde', objekt_id: null, objekt_name: null,
    rundgang_id: 11, status: 'aktiv', letzter_punkt: null },
]};

const gerufen = [];
async function starte(antwort, httpStatus = 200) {
  const browser = await chromium.launch({ executablePath: browserPfad() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', r => {
    const p = r.request().url().split('/api/')[1].split('?')[0];
    gerufen.push(p);
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
    if (p.includes('revierdienst_status')) {
      return r.fulfill({ status: httpStatus, contentType: 'application/json', body: JSON.stringify(antwort) });
    }
    if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    return send({ status: 'ok', mitarbeiter: [], kunden: [], einsaetze: [], objekte: [], rapporte: [], rundgaenge: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on');
  await page.evaluate(() => go('rundgaenge'));
  await page.waitForTimeout(600);
  return { browser, page };
}

let { browser, page } = await starte(LEUTE);
check('Die Seite fragt den Waechter-Status ab', gerufen.some(p => p.includes('revierdienst_status')));

const karten = await page.evaluate(() => [...document.querySelectorAll('.ws-karte')].map(k => ({
  name: k.querySelector('.ws-name').textContent,
  rolle: k.querySelector('.ws-rolle').textContent,
  status: k.querySelector('.ws-status').textContent.trim(),
  ort: k.querySelector('.ws-ort').textContent,
  avatar: k.querySelector('.ws-avatar').textContent,
})));

check('KRITISCH: alle vier Eingeteilten erscheinen, nicht nur die mit laufendem Rundgang',
  karten.length === 4);

// Fehlt eine Karte, sollen die folgenden Pruefungen SAGEN, was fehlt, statt
// mit einem TypeError abzustuerzen. Beim Gegenprobieren aufgefallen: Ohne
// diesen Rueckfall bricht die Suite bei der ersten fehlenden Person ab, und
// man sieht nur "Cannot read properties of undefined" -- richtig rot, aber
// ohne Aussage, und die restlichen Pruefungen laufen nicht mehr.
const FEHLT = { name: '(fehlt)', rolle: '', status: '', ort: '', avatar: '' };
const wer = n => karten.find(k => k.name === n) || FEHLT;
check('KRITISCH: wer eingeteilt ist, aber keinen offenen Rundgang hat, steht als "Frei" da',
  karten.some(k => k.name === 'Cara Probe' && k.status === 'Frei'));
check('Ein laufender Rundgang heisst "Aktiv"',
  karten.some(k => k.name === 'Anna Muster' && k.status === 'Aktiv'));
check('Ein pausierter Rundgang heisst "Pause"',
  karten.some(k => k.name === 'Beat Beispiel' && k.status === 'Pause'));

const ohneFunktion = wer('Cara Probe');
check('KRITISCH: fehlende Funktion sagt, DASS sie fehlt -- keine leere Zeile',
  ohneFunktion.rolle.includes('nicht hinterlegt'));
const ohneObjekt = wer('Dora Test');
check('KRITISCH: fehlendes Objekt sagt, DASS es fehlt -- keine leere Zeile',
  ohneObjekt.ort.includes('Kein Objekt hinterlegt'));
check('Ist ein Objekt da, steht es mit dem letzten Punkt dahinter',
  wer('Anna Muster').ort === 'Objekt A · Tor 4');
check('Ohne letzten Punkt steht das Objekt allein, ohne baumelnden Trenner',
  wer('Cara Probe').ort !== '' && !wer('Cara Probe').ort.includes('·'));
check('Die Initialen kommen aus Vor- und Nachname',
  wer('Anna Muster').avatar === 'AM');

const zaehler = await page.textContent('#wsZaehler');
check('KRITISCH: der Zaehler nennt beide Einheiten, nicht eine nackte Zahl',
  /\d+\s*von\s*\d+/.test(zaehler));
check('Der Zaehler stimmt inhaltlich (2 laufende von 4 Eingeteilten)',
  zaehler.includes('2') && zaehler.includes('4'));
await browser.close();

({ browser, page } = await starte({ status: 'ok', datum: '2026-01-15', leute: [], eingeteilt: 0, aktiv: 0 }));
const leer = await page.textContent('#wsListe');
check('KRITISCH: "niemand eingeteilt" ist ein eigener Text, nicht eine Fehlermeldung',
  leer.includes('Heute niemand eingeteilt') && !leer.includes('nicht verfügbar'));
check('Bei niemandem eingeteilt bleibt der Zaehler leer statt "0 von 0"',
  (await page.textContent('#wsZaehler')).trim() === '');
await browser.close();

({ browser, page } = await starte({ status: 'fehler', message: 'kaputt' }, 500));
const kaputt = await page.textContent('#wsListe');
check('KRITISCH: "nicht abrufbar" wird von "niemand eingeteilt" unterschieden',
  kaputt.includes('nicht verfügbar') && !kaputt.includes('niemand eingeteilt'));
await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
