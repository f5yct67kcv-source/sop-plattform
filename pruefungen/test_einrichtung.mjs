// Die Einrichtung muss dauerhaft erreichbar sein -- nicht nur, wenn ein
// Laden bereits fehlgeschlagen ist. Genau das hatte der Projektinhaber
// nicht gefunden: bei ihm laeuft die Planung, darum erschien der Knopf nie.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const rufe = [];
// POST (echtes Einrichten) und GET (stiller Pruef-Aufruf fuer den Update-Punkt,
// ENT-033) sind derselbe Endpunkt -- getrennte Mock-Antworten, wie es der
// echte Server auch getrennt beantwortet.
let ANTWORT = { status: 'ok', message: 'Einrichtung abgeschlossen.',
  getan: ['Tabelle verfuegbarkeiten angelegt'],
  unveraendert: ['Tabelle objekte war bereits vorhanden', 'Tabelle einsaetze war bereits vorhanden'],
  ausstehend: 1 };
let PRUEFUNG = { status: 'ok', message: 'Alles ist eingerichtet.', getan: [], unveraendert: [], ausstehend: 0 };
// Gesetzt = der Endpunkt antwortet mit etwas, das KEIN JSON ist (schwerer
// PHP-Abbruch). Wie ANTWORT/PRUEFUNG umschaltbar, statt die Route zu tauschen.
let ROH = null;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), u = req.url(), p = u.split('/api/')[1].split('?')[0];
  rufe.push({ p, methode: req.method() });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  // Alles laedt normal durch -- genau der Fall, in dem der Knopf bisher fehlte.
  if (p.includes('planung_einrichten')) {
    if (ROH && req.method() !== 'GET') {
      return route.fulfill({ status: ROH.status, contentType: 'text/html', body: ROH.body });
    }
    return send(req.method() === 'GET' ? PRUEFUNG : ANTWORT);
  }
  return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [], mitarbeiter: [],
    feiertage: [], gepflegt: {}, sperren: [], kpi: {}, verlauf: [], angemeldet: [],
    pro_mitarbeiter: [], letzte_rapporte: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(400);

// ══════════ IMMER SICHTBAR, AUCH WENN ALLES LÄUFT
check('Der Weg zur Einrichtung ist immer da', await page.isVisible('#nav-einrichtung'));
check('Er heisst „Einrichtung“', (await page.textContent('#nav-einrichtung')).includes('Einrichtung'));
check('Nicht bei der Übersicht versteckt -- auch bei Planung sichtbar', await page.evaluate(() => {
  go('planung');
  return !!document.getElementById('nav-einrichtung').offsetParent;
}));
await page.evaluate(() => go('uebersicht'));
await page.waitForTimeout(200);

// ══════════ UPDATE-PUNKT (ENT-033) -- derselbe Knopf, nur die Optik ändert sich
check('Zu Beginn kein Update-Punkt, wenn alles eingerichtet ist',
  !(await page.evaluate(() => document.getElementById('nav-einrichtung').classList.contains('hat-update'))));
PRUEFUNG = { status: 'ok', message: '2 Punkt(e) stehen noch aus.', getan: ['x', 'y'], unveraendert: [], ausstehend: 2 };
await page.evaluate(() => pruefeUpdate());
await page.waitForTimeout(300);
check('Der Knopf hebt sich farblich ab, wenn etwas aussteht',
  await page.evaluate(() => document.getElementById('nav-einrichtung').classList.contains('hat-update')));
check('Die Beschriftung wechselt zu „Update“',
  (await page.textContent('#navEinrichtungLbl')) === 'Update');
check('Der Punkt ist sichtbar', await page.isVisible('#updatePunkt'));
check('Es gibt keinen zweiten Mechanismus -- derselbe Endpunkt wie die Einrichtung',
  rufe.filter(r => r.p.includes('planung_einrichten')).every(r => r.methode === 'GET' || r.methode === 'POST'));

// ══════════ DIALOG
await page.click('#nav-einrichtung');
await page.waitForTimeout(300);
check('Der Dialog geht auf', await page.evaluate(() => document.getElementById('dlgEinrichtung').classList.contains('on')));
check('Er erklärt sich, bevor man klickt',
  (await page.textContent('#eiInhalt')).includes('Prüfen und einrichten'));
check('Er sagt, dass nichts gelöscht wird',
  (await page.textContent('#dlgEinrichtung .dlg-hd')).includes('nichts gelöscht'));
check('Er nennt beide Bereiche',
  (await page.textContent('#dlgEinrichtung .dlg-hd')).includes('Sperrtage'));

// ══════════ EINRICHTEN
PRUEFUNG = { status: 'ok', message: 'Alles ist eingerichtet.', getan: [], unveraendert: [], ausstehend: 0 };
await page.click('#eiBtn');
await page.waitForTimeout(500);
check('Der Aufruf geht an den richtigen Endpunkt', rufe.some(r => r.p.includes('planung_einrichten')));
const inhalt = await page.textContent('#eiInhalt');
check('Das Ergebnis steht im Dialog, nicht nur als Toast', inhalt.includes('Einrichtung abgeschlossen'));
check('Was ergänzt wurde, wird aufgelistet', inhalt.includes('verfuegbarkeiten'));
check('Was schon da war, wird auch genannt', inhalt.includes('bereits vorhanden'));
check('Der Dialog bleibt offen, damit man es nachlesen kann',
  await page.evaluate(() => document.getElementById('dlgEinrichtung').classList.contains('on')));
check('Nach erfolgreichem Einrichten verschwindet der Update-Punkt von selbst',
  !(await page.evaluate(() => document.getElementById('nav-einrichtung').classList.contains('hat-update'))));
check('Die Beschriftung ist wieder „Einrichtung“',
  (await page.textContent('#navEinrichtungLbl')) === 'Einrichtung');
await page.screenshot({ path: OUT + '/69-einrichtung.png' });

// ══════════ ERNEUTES AUSFÜHREN IST GEFAHRLOS UND ZEIGT DAS
ANTWORT = { status: 'ok', message: 'Alles war bereits eingerichtet.', getan: [],
  unveraendert: ['Tabelle objekte war bereits vorhanden', 'Tabelle verfuegbarkeiten war bereits vorhanden'] };
await page.click('#eiBtn');
await page.waitForTimeout(500);
check('Ein zweiter Lauf meldet, dass nichts mehr zu tun war',
  (await page.textContent('#eiInhalt')).includes('bereits eingerichtet'));
check('Kein leerer „Jetzt ergänzt“-Abschnitt ohne Inhalt',
  !(await page.textContent('#eiInhalt')).includes('Jetzt ergänztTabelle'));

// ══════════ FEHLER BLEIBT LESBAR
ANTWORT = { status: 'error', message: 'Diese Tabellen fehlen weiterhin: masterschichten' };
await page.click('#eiBtn');
await page.waitForTimeout(500);
check('Ein Fehler wird als solcher gezeigt',
  (await page.textContent('#eiInhalt')).includes('fehlen weiterhin'));
check('Der Knopf bleibt bedienbar', !(await page.evaluate(() => $('eiBtn').disabled)));

// ══════════ EIN FEHLGESCHLAGENER SCHRITT REISST DEN REST NICHT MIT
//
// Vorgefallen am 22.08.2026: Ein einzelner fehlgeschlagener ALTER lief in den
// Ausnahmehandler, der Endpunkt antwortete mit 500, und im Dialog stand
// "Einrichtung fehlgeschlagen." ohne Grund -- obwohl die Schritte davor
// bereits gewirkt hatten. Die Ursache war dadurch nicht zu erkennen.
ANTWORT = { status: 'error',
  message: '1 Schritt(e) sind fehlgeschlagen — die uebrigen sind gelaufen.',
  getan: ['Spalte rapporte.einsatz_id ergaenzt'],
  unveraendert: ['Tabelle objekte war bereits vorhanden'],
  fehler: ['Verweis rapporte.einsatz_id — SQLSTATE[HY000]: 1215 Cannot add foreign key constraint'] };
await page.click('#eiBtn');
await page.waitForTimeout(500);
const fehlText = await page.textContent('#eiInhalt');
check('KRITISCH: der Grund des Fehlschlags steht im Dialog, nicht nur "fehlgeschlagen"',
  fehlText.includes('foreign key constraint'));
check('KRITISCH: der fehlgeschlagene Schritt wird namentlich genannt',
  fehlText.includes('Verweis rapporte.einsatz_id'));
check('KRITISCH: was trotzdem lief, wird weiterhin ausgewiesen -- der Lauf bricht nicht ab',
  fehlText.includes('Spalte rapporte.einsatz_id ergaenzt'));
check('Der Kasten ist rot, nicht gruen -- ein Teilerfolg ist kein Erfolg',
  await page.evaluate(() => {
    const k = document.querySelector('#eiInhalt .msg-err');
    return getComputedStyle(k).backgroundColor === getComputedStyle(document.documentElement)
      .getPropertyValue('--neg-soft').trim()
      || k.style.background.includes('neg');
  }));
check('Fehlgeschlagenes steht VOR dem Gelungenen',
  fehlText.indexOf('Fehlgeschlagen') < fehlText.indexOf('Jetzt ergänzt'));
check('Die erste Liste sitzt buendig am Kasten, ohne doppelten Abstand',
  await page.evaluate(() =>
    document.querySelector('#eiInhalt [data-ei-liste]').style.marginTop === '0px'));

// ══════════ UNLESBARE ANTWORT IST EINE SACKGASSE -- ES SEI DENN, SIE SAGT WAS
//
// Bricht PHP schwer ab (Zeitueberschreitung, Speicher), kommt kein JSON an.
// Dann stand hier nur "Einrichtung fehlgeschlagen." -- ohne Statuscode war
// nicht zu unterscheiden, ob ein Recht fehlt, der Server abgebrochen ist oder
// gar keine Verbindung bestand.
ROH = { status: 500, body: '<b>Fatal error</b>: Maximum execution time exceeded' };
await page.click('#eiBtn');
await page.waitForTimeout(500);
const kaputt = await page.textContent('#eiInhalt');
check('KRITISCH: eine unlesbare Antwort nennt wenigstens den Statuscode',
  kaputt.includes('500'));
check('Sie sagt auch, dass die Antwort selbst das Problem ist',
  kaputt.toLowerCase().includes('keine lesbare antwort'));
check('Der Knopf bleibt auch danach bedienbar',
  !(await page.evaluate(() => $('eiBtn').disabled)));

// ══════════ KOMPAKTER ZUSTAND (KOPFLEISTE, ENT-086/ENT-396)
await page.evaluate(() => closeDlg('dlgEinrichtung'));
await page.evaluate(() => huelleSetzen('aus'));
await page.waitForTimeout(300);
check('Auch mit ausgeblendeter Seitenleiste erreichbar',
  await page.isVisible('#nav-einrichtung'));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
