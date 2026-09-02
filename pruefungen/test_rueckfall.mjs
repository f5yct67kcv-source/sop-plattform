// Zwei Fehler aus dem ersten echten Rundgang (ENT-321).
//
// Vom Projektinhaber gemeldet, nachdem seine erste Runde im Feld
// durchgelaufen war: „Der Rundgang läuft aber weiter in der Zeit, obwohl
// ‚Rundgang abgeschlossen' steht. Was jetzt noch weiter passiert ist, als
// ich mich wieder entfernte, fiel der Kontrollpunkt wieder zurück, obwohl
// vorhin bestätigt."
//
// Der zweite ist der schwerere: Ein offline bestaetigter Punkt fiel beim
// Laden auf „offen" zurueck, weil der Server nur weiss, was bei ihm
// angekommen ist. Der Nachweis lag die ganze Zeit im Geraet -- falsch war
// die ANZEIGE, und zwar in der gefaehrlichen Richtung: Sie sagte „nicht
// erledigt", wo erledigt war. Der Waechter haette denselben Punkt ein
// zweites Mal bestaetigt.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const APP = readFileSync(`${WURZEL}/app.html`, 'utf8');
const textVon = async sel => (await page.$(sel)) ? (await page.textContent(sel)) : null;

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
// Ortszeit als "YYYY-MM-DD HH:MM:SS" -- so schreibt es die App (jetztDatetime).
const orts = ms => {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// ══════════ QUELLTEXT ═════════════════════════════════════════════════
check('KRITISCH: es gibt eine Stelle, die die Warteschlange über die Serverdaten legt',
  /function rdWarteschlangeUeberlagern/.test(APP));
check('KRITISCH: sie wird beim Fortsetzen auch angewendet',
  /r\.kontrollpunkte = rdWarteschlangeUeberlagern\(r\.kontrollpunkte, r\.id\)/.test(APP));
// Der Server hat recht, wenn er etwas weiss -- ein angekommener Scan darf
// nicht von einem noch nicht aufgeraeumten Warteschlangen-Eintrag
// ueberschrieben werden.
check('KRITISCH: ein bereits angekommener Scan wird NICHT überschrieben',
  /if \(k\.erledigt\) \{ return; \}/.test(APP));
check('Es gibt eine Stelle, die das Ende der Runde bestimmt',
  /function rgLaufEndeMs/.test(APP));

const JETZT = Date.now();
const START = JETZT - 20 * 60000;      // Runde begann vor 20 Minuten
const SCAN1 = JETZT - 8 * 60000;       // Punkt 1 vor 8 Minuten
const SCAN2 = JETZT - 6 * 60000;       // Punkt 2 vor 6 Minuten

const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache',
    strasse: 'Musterweg 4', ort: '9999 Musterdorf', einsatzart: 'Revierdienst',
    sparte: 'sicherheit', datum: tag(0), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt',
    objekt_name: 'Musterobjekt', objekt_id: 7, hat_kontrollpunkte: true, im_team: 1 }]};

// Der Server kennt NUR Punkt 2 -- Punkt 1 liegt noch in der Warteschlange.
// Genau die Lage des Projektinhabers.
const RUNDE = () => ({ id: 951, status: 'laeuft', pausiert_seit: null,
  vorbereitet_am: orts(START), pause_minuten: 0, rohzeit_ende: null,
  objekt: { id: 7, name: 'Musterobjekt' }, kunde_name: 'Musterliegenschaften AG',
  ansprechpartner: [], zentrale: null,
  kontrollpunkte: [
    { id: 1, bezeichnung: 'Kreuzung Hochgasse', reihenfolge: 1, typ: 'geofence',
      lat: 47.35, lng: 7.9, geofence_radius_m: 25, erledigt: null, aufgaben: [] },
    { id: 2, bezeichnung: 'Türe Hochgasse 7', reihenfolge: 2, typ: 'geofence',
      lat: 47.351, lng: 7.9, geofence_radius_m: 25,
      erledigt: { status: 'bestaetigt', erfasst_am: orts(SCAN2), beschreibung: null },
      aufgaben: [] },
  ] });

const EXE = browserPfad();
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
// Der Scan-Endpunkt antwortet NICHT -- der Eintrag bleibt in der
// Warteschlange, so wie ohne Netz.
await page.route('**/api/**', route => {
  const p = new URL(route.request().url()).pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send({ status: 'ok', monat: { anzahl: 0, stunden: 0 },
    profil: { name: 'm.muster', ist_admin: false, vorname: 'Max', nachname: 'Muster',
      erstellt_am: tag(-30) + ' 10:00:00' } });
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: RUNDE() });
  if (p.includes('mein_rundgang_scan')) return route.abort();   // kein Netz
  return send({ status: 'ok' });
});
await page.route('**maps.googleapis.com/**', route => route.abort());

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster');
await page.fill('#gPass', 'x');
await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

// Punkt 1 in die Warteschlange legen -- als waere er offline bestaetigt
// worden und noch nicht uebermittelt.
await page.evaluate(([rid, kid, am]) => {
  localStorage.setItem('sop_rundgang_warteschlange', JSON.stringify([{
    rundgang_id: rid, kontrollpunkt_id: kid, status: 'bestaetigt', erfasst_am: am,
    lat: 47.35, lng: 7.9, beschreibung: null, foto: null,
  }]));
}, [951, 1, orts(SCAN1)]);

await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await page.waitForTimeout(1400);

// ══════════ DER RÜCKFALL ══════════════════════════════════════════════
check('KRITISCH: der offline bestätigte Punkt fällt NICHT auf "offen" zurück',
  await page.evaluate(() => {
    const k = rundgangAktiv.kontrollpunkte.find(x => Number(x.id) === 1);
    return !!(k && k.erledigt && k.erledigt.status === 'bestaetigt');
  }));
check('KRITISCH: der Zähler zeigt 2 / 2, nicht 1 / 2',
  (await textVon('#rgsZaehler')) === '2 / 2');
check('Er ist als "wartet auf Übermittlung" gekennzeichnet, nicht als fertig übermittelt',
  await page.evaluate(() => {
    const k = rundgangAktiv.kontrollpunkte.find(x => Number(x.id) === 1);
    return k.wartend === true;
  }));
await page.click('#rgsRt-punkte');
await page.waitForTimeout(400);
const liste = await textVon('#rdListe');
check('In der Liste steht bei ihm, dass die Übermittlung noch aussteht',
  liste !== null && liste.includes('wird übermittelt'));
// Der Server hat recht, wenn er etwas weiss.
check('KRITISCH: der bereits angekommene Punkt behält seine Server-Zeit',
  await page.evaluate(am => {
    const k = rundgangAktiv.kontrollpunkte.find(x => Number(x.id) === 2);
    return k.erledigt && k.erledigt.erfasst_am === am;
  }, orts(SCAN2)));
await page.screenshot({ path: `${OUT}/rueckfall-01-liste.png` });

// ══════════ DER TIMER ═════════════════════════════════════════════════
// Beide Punkte sind erledigt -- die Runde ist faktisch fertig, auch wenn
// der Server sie noch als "laeuft" fuehrt.
const t1 = await textVon('#rgsTimer');
await page.waitForTimeout(2500);
const t2 = await textVon('#rgsTimer');
check('KRITISCH: auf einer fertigen Runde zählt die Uhr nicht weiter',
  t1 !== null && t1 === t2);
// Sie zeigt die tatsaechliche Dauer bis zum letzten Punkt, nicht bis jetzt.
// Sollwert aus den Konstanten gerechnet, nicht hingeschrieben: Beim
// ersten Anlauf stand hier 00:12:00, weil ich den FRUEHEREN Scan im Kopf
// hatte. Ein von Hand gesetzter Erwartungswert prueft die eigene
// Kopfrechnung mit, nicht nur den Code.
const sollSek = Math.floor((SCAN2 - START) / 1000);
const pp = n => String(n).padStart(2, '0');
const soll = `${pp(Math.floor(sollSek / 3600))}:${pp(Math.floor(sollSek / 60) % 60)}:${pp(sollSek % 60)}`;
check('KRITISCH: sie zeigt die Dauer bis zum letzten Punkt, nicht bis jetzt',
  t1 === soll);
check('Der Zeitgeber läuft nicht unsichtbar weiter',
  await page.evaluate(() => rgsTimerLauf === null));

// ══════════ EINE LAUFENDE RUNDE ZÄHLT WEITER ══════════════════════════
// Die Gegenprobe im laufenden Betrieb: Nur weil eine fertige Runde steht,
// darf eine laufende nicht ebenfalls stehenbleiben.
await page.evaluate(() => {
  rundgangAktiv.kontrollpunkte[0].erledigt = null;
  rundgangAktiv.status = 'laeuft';
  rgTimerStarten();
});
const l1 = await textVon('#rgsTimer');
await page.waitForTimeout(2500);
const l2 = await textVon('#rgsTimer');
check('KRITISCH: eine laufende Runde zählt sehr wohl weiter', l1 !== l2);
check('Und der Zähler steht wieder auf 1 / 2',
  (await textVon('#rgsZaehler')) === '1 / 2');

// ══════════ DIE ENDZEIT DES SERVERS HAT VORRANG ══════════════════════
await page.evaluate(am => {
  rundgangAktiv.kontrollpunkte.forEach(k => {
    if (!k.erledigt) { k.erledigt = { status: 'bestaetigt', erfasst_am: am, beschreibung: null }; }
  });
  rundgangAktiv.status = 'abgeschlossen';
  // Der Server meldet ein Ende, das SPAETER liegt als der letzte Scan --
  // etwa weil die Uebermittlung erst danach ankam.
  rundgangAktiv.rohzeit_ende = am;
  rgTimerStarten();
  rgLaufKopfZeichnen();
}, orts(START + 15 * 60000));
await page.waitForTimeout(300);
check('KRITISCH: liegt eine Server-Endzeit vor, gilt sie und nicht der letzte Scan',
  (await textVon('#rgsTimer')) === '00:15:00' && soll !== '00:15:00');

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
