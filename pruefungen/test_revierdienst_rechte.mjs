// Die Revierdienst-Einrichtung muss der Rolle offenstehen, fuer die sie
// gebaut wurde (ENT-227).
//
// DER FEHLER, DEN DIESE SUITE BEWACHT
//
// Das Menue gibt "Revierdienst -> Einrichtung" mit 'rundgang_verwalten'
// frei. Genau dieses Recht traegt die Rolle "Waechtersystem" -- ohne 'plan'.
// Die Seite holte ihre Objekte aber ueber objekt_list.php, und der verlangt
// 'plan'. Wer nur die Waechter-Rolle hatte, kam also hinein und fand einen
// leeren Objekt-Waehler vor.
//
// Der Fehler ist STILL: kein Absturz, keine Meldung, nur eine Auswahl ohne
// Eintraege, die aussieht wie "es gibt keine Objekte". Genau deshalb faellt
// er niemandem auf, der die Rolle nicht selbst benutzt -- und genau deshalb
// braucht es eine Pruefung statt eines Kommentars.
//
// Der entscheidende Fall unten stellt das nach: objekt_list.php antwortet
// mit 403 (wie es der Server fuer diese Rolle tut), und trotzdem muss der
// Waehler Objekte zeigen.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const OBJEKTE = { status: 'ok', objekte: [
  { id: 1, kunde_id: 1, kunde_name: 'Kunde A', name: 'Objekt A', strasse: 'Musterweg 1',
    plz: '4600', ort: 'Ort A', kanton: 'SO', einsatzart: 'Revierdienst', sparte: 'sicherheit',
    aktiv: 1, bemerkung: null, erstellt_am: null, masterschichten: 0, stunden_je_einsatz: 0, distanzen: {} },
  { id: 2, kunde_id: 1, kunde_name: 'Kunde A', name: 'Objekt B', strasse: 'Musterweg 2',
    plz: '4600', ort: 'Ort A', kanton: 'SO', einsatzart: 'Reinigung', sparte: 'reinigung',
    aktiv: 1, bemerkung: null, erstellt_am: null, masterschichten: 0, stunden_je_einsatz: 0, distanzen: {} },
]};

const gerufen = [];

async function anmelden(page, rechte) {
  gerufen.length = 0;
  await page.route('**/api/**', route => {
    const pfad = route.request().url().split('/api/')[1].split('?')[0];
    gerufen.push(pfad);
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    const login = { status: 'ok', token: 't', name: 'a', ist_admin: !rechte };
    if (rechte) { login.rechte = rechte; login.rollen = ['waechter']; }
    if (pfad.includes('login')) return send(login);
    // Der Kern der Nachstellung: Fuer eine Rolle ohne 'plan' antwortet der
    // Server hier mit 403. Wer objekt_list.php benutzt, bekommt nichts.
    if (pfad.includes('objekt_list') && rechte) {
      return route.fulfill({ status: 403, contentType: 'application/json',
        body: JSON.stringify({ status: 'fehler', message: 'Keine Berechtigung' }) });
    }
    if (pfad.includes('objekt_list')) return send(OBJEKTE);
    if (pfad.includes('objekte_revierdienst')) return send(OBJEKTE);
    if (pfad.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    if (pfad.includes('kontrollpunkt')) return send({ status: 'ok', kontrollpunkte: [] });
    if (pfad.includes('rundgang_vorlage')) return send({ status: 'ok', vorlagen: [] });
    if (pfad.includes('rundgang_liste')) return send({ status: 'ok', rundgaenge: [] });
    if (pfad.includes('pensen')) return send({ status: 'ok', jahr: 2026, mitarbeiter: [] });
    return send({ status: 'ok', mitarbeiter: [], kunden: [], einsaetze: [], objekte: [], rapporte: [], masterschichten: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on');
  await page.waitForTimeout(300);
}

const browser = await chromium.launch({ executablePath: browserPfad() });

// ══════════ DER ENTSCHEIDENDE FALL: NUR WAECHTER-RECHTE
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await anmelden(page, ['rundgang_verwalten', 'rundgang_einsehen', 'alarmempfaenger']);

// Die Rechte-Sichtbarkeit wird am Element gemessen, nicht am Klick: Die
// Kinder liegen in einer eingeklappten Gruppe, ein fehlgeschlagener Klick
// hiesse also "zugeklappt", nicht "kein Recht". Geprueft wird darum, ob das
// Rechte-Gating das Element ausblendet (display:none), nicht ob es gerade
// im Bild ist.
const sichtbarkeit = await page.evaluate(() => ({
  gruppe: getComputedStyle(document.getElementById('navg-revierdienst')).display,
  einrichtung: getComputedStyle(document.getElementById('nav-revierdienst-einrichtung')).display,
  uebersicht: getComputedStyle(document.getElementById('nav-revierdienst-uebersicht')).display,
}));
check('Die Rubrik Revierdienst ist mit Waechter-Rechten freigegeben',
  sichtbarkeit.gruppe !== 'none');
check('Der Menuepunkt Einrichtung ist mit rundgang_verwalten freigegeben',
  sichtbarkeit.einrichtung !== 'none');

await page.evaluate(() => go('revierdienst'));
await page.waitForTimeout(600);

check('Die Einrichtung oeffnet sich', await page.isVisible('#view-revierdienst'));
check('KRITISCH: sie fragt objekte_revierdienst.php, nicht objekt_list.php',
  gerufen.some(p => p.includes('objekte_revierdienst')));

const waehler = await page.evaluate(() => {
  const sel = document.getElementById('rdObjektWahl');
  return { anzahl: sel.querySelectorAll('option[value]:not([value=""])').length,
           text: sel.textContent, erste: sel.options[0] && sel.options[0].textContent };
});
check('KRITISCH: der Objekt-Waehler ist NICHT leer -- genau der stille Fehler (ENT-227)',
  waehler.anzahl === 2);
check('Der Waehler zeigt dieselbe Menge wie bisher, nicht auf Revierdienst gekuerzt',
  waehler.text.includes('Objekt A') && waehler.text.includes('Objekt B'));
check('Er sagt nicht "nicht verfuegbar", wenn Objekte da sind',
  !waehler.text.includes('nicht verfügbar'));

await page.close();

// ══════════ GEGENSTUECK: VOLLE RECHTE VERHALTEN SICH UNVERAENDERT
const page2 = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page2.on('pageerror', e => bad.push('JS-Fehler (Admin): ' + e.message));
await anmelden(page2, null);
await page2.evaluate(() => go('revierdienst'));
await page2.waitForTimeout(600);
const waehler2 = await page2.evaluate(() => {
  const sel = document.getElementById('rdObjektWahl');
  return sel.querySelectorAll('option[value]:not([value=""])').length;
});
check('Mit vollen Rechten steht derselbe Waehler mit denselben Objekten', waehler2 === 2);
await page2.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
