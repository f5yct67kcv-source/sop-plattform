// Schicht rapportieren (ENT-082).
//
// Der Mitarbeitende beendet eine zugesagte Verkehrsdienst-Schicht mit einem
// Rapport, der aus der Schicht vorbefuellt ist. Beim Planer haengt der
// Rapport an der Zeile; ein Klick holt die Zeiten in den Abgleich.
//
// Geprueft wird vor allem, was NICHT passiert:
//  - Der Rapport schreibt nichts fest (ENT-045 -- das tut der Abgleich).
//  - Aus einer fehlenden Pausenangabe wird NICHTS gerechnet. Die Automatik
//    ab 5½ Stunden ist in ENT-082 ausdruecklich gesperrt, solange
//    GAV-AUS-007 offen ist; es gibt nur einen Hinweis.
//  - Die Bezahlt-Kennzeichen setzt der Mitarbeitende nie (ENT-046,
//    GAV-AUS-004: nirgends vorbelegt).
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { zeitSetzen } from './zeitfeld.mjs';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const GESTERN = tag(-1), MORGEN = tag(1);

// Vier Schichten, die genau die vier Faelle der Regel abdecken.
const SCHICHTEN = () => ({ status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  // Rapportierbar: Verkehrsdienst, zugesagt, gestern gelaufen. 9 Std. Rohzeit.
  { id: 51, kunde_name: 'Kunde A', titel: 'Baustelle Kreisel', strasse: 'Dorfstrasse 1',
    ort: '5013 Musterort', einsatzart: 'Verkehrsdienst', sparte: 'sicherheit',
    datum: GESTERN, von: '08:00:00', bis: '17:00:00', status: 'bestaetigt', bemerkung: null,
    zusage: 'zugesagt', objekt_name: null, im_team: 1 },
  // Falsche Einsatzart -- Objektrundgaenge werden nicht rapportiert.
  { id: 52, kunde_name: 'Kunde B', titel: 'Nachtrunde', strasse: null, ort: '4632 Musterstadt',
    einsatzart: 'Revierdienst', sparte: 'sicherheit',
    datum: GESTERN, von: '22:00:00', bis: '23:00:00', status: 'geplant', bemerkung: null,
    zusage: 'zugesagt', objekt_name: 'Objekt Nord', im_team: 1 },
  // Nicht zugesagt.
  { id: 53, kunde_name: 'Kunde C', titel: 'Umleitung', strasse: null, ort: '4600 Musterdorf',
    einsatzart: 'Verkehrsdienst', sparte: 'sicherheit',
    datum: GESTERN, von: '08:00:00', bis: '12:00:00', status: 'geplant', bemerkung: null,
    zusage: 'offen', objekt_name: null, im_team: 1 },
  // Noch nicht begonnen -- rapportiert wird, was geschah.
  { id: 54, kunde_name: 'Kunde D', titel: 'Morgen', strasse: null, ort: '4600 Musterdorf',
    einsatzart: 'Verkehrsdienst', sparte: 'sicherheit',
    datum: MORGEN, von: '08:00:00', bis: '12:00:00', status: 'bestaetigt', bemerkung: null,
    zusage: 'zugesagt', objekt_name: null, im_team: 1 },
]});

const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: GESTERN + ' 10:00:00' }};

let rapporte = [];
let rufe = [];

// ══════════════════════════════════════════════════════════════════════
// TEIL 1 -- DIE APP
// ══════════════════════════════════════════════════════════════════════
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler (App): ' + e.message));

await page.route('**/api/**', route => {
  const req = route.request();
  const p = req.url().split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
  rufe.push({ p, body });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN());
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte });
  if (p.includes('rapport_create')) {
    // Wie der Server: legt eine Zeile an, einsatz_id wird uebernommen.
    rapporte = [{ id: rapporte.length + 1, datum: body.datum, mitarbeiter_id: 10,
      einsatz_id: body.einsatz_id || null, mitarbeiter: 'm.muster',
      kunde: body.kunde, strasse: body.strasse, ort: body.ort, auftrag_nr: null,
      einsatzart: body.einsatzart, von: body.von + ':00', bis: body.bis + ':00',
      pause_min: Number(body.pause || 0), netto_h: '0.00', unterzeichner: body.sigName || null,
      unterschrift: body.sig || null, bemerkung: body.bemerkung || null,
      erfasst_am: body.datum + ' 17:05:00' }, ...rapporte];
    return send({ status: 'ok', netto_h: 0 });
  }
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

const knopfDa = async id => {
  await page.evaluate(i => blattAuf(i), id);
  await page.waitForTimeout(200);
  const da = await page.evaluate(() =>
    [...document.querySelectorAll('#blatt button')].some(b => b.textContent.includes('Schicht rapportieren')));
  await page.evaluate(() => blattZu());
  await page.waitForTimeout(150);
  return da;
};

check('Knopf erscheint an der zugesagten Verkehrsdienst-Schicht', await knopfDa(51));
check('KRITISCH: kein Knopf bei Revierdienst -- Objektrundgaenge werden nicht rapportiert',
  !(await knopfDa(52)));
check('KRITISCH: kein Knopf ohne Zusage', !(await knopfDa(53)));
check('KRITISCH: kein Knopf, bevor die Schicht begonnen hat', !(await knopfDa(54)));

// ── Das Formular ist aus der Schicht vorbefuellt (ENT-082 Punkt 2)
await page.evaluate(() => blattAuf(51));
await page.waitForTimeout(200);
await page.click('#blatt button:has-text("Schicht rapportieren")');
await page.waitForTimeout(300);
check('Die Schublade traegt den Titel der Aufgabe',
  (await page.textContent('#blTitel')).includes('Schicht rapportieren'));
check('KRITISCH: Kunde kommt aus der Schicht', (await page.inputValue('#srKunde')) === 'Kunde A');
check('KRITISCH: Strasse kommt aus der Schicht', (await page.inputValue('#srStrasse')) === 'Dorfstrasse 1');
check('KRITISCH: Ort kommt aus der Schicht', (await page.inputValue('#srOrt')) === '5013 Musterort');
check('KRITISCH: Einsatzart kommt aus der Schicht',
  (await page.inputValue('#srEinsatzart')) === 'Verkehrsdienst');
check('KRITISCH: Von und Bis kommen aus der Schicht',
  (await page.inputValue('#srVon')) === '08:00' && (await page.inputValue('#srBis')) === '17:00');
check('Die Pausendauer ist anpassbar -- Planzeiten sind Richtwerte',
  await page.isEnabled('#srPause'));
check('KRITISCH: die Pause ist NICHT vorbelegt -- aus 9 Std. wird nichts gerechnet (ENT-082 Sperre)',
  (await page.inputValue('#srPause')) === '0');
check('Unterschrift des Kunden bleibt moeglich', await page.isVisible('#sigCanvas'));
check('Eingabefelder mindestens 16px -- sonst zoomt iOS hinein',
  await page.evaluate(() => ['srKunde', 'srVon', 'srPause']
    .every(i => parseFloat(getComputedStyle(document.getElementById(i)).fontSize) >= 16)));
// Gemessen am gerenderten Zustand, nicht im Quelltext nachgelesen: eine
// CSS-Regel kann wirkungslos bleiben, ohne dass etwas kaputtgeht.
check('Bedienelemente mindestens 44px hoch',
  await page.evaluate(() => [...document.querySelectorAll('#blFuss .btn')]
    .every(b => b.getBoundingClientRect().height >= 44)));
// srVon ist seit ENT-110 ein Auswahl-Bedienelement: Das Feld mit der Kennung
// traegt nur noch den Wert, zu sehen und zu tippen ist die Huelle daneben.
// Gemessen wird darum, was der Finger trifft.
check('Auch die Eingabefelder sind mindestens 44px hoch',
  await page.evaluate(() => ['srKunde', 'srPause', 'srSigName']
    .every(i => document.getElementById(i).getBoundingClientRect().height >= 44)
    && [...document.querySelectorAll('[data-zeitwahl-fuer="srVon"] select')]
      .every(s => s.getBoundingClientRect().height >= 44)));
check('KRITISCH: auch "Loeschen" unter der Unterschrift ist 44px -- danebengetippt kostet die Unterschrift',
  await page.evaluate(() =>
    document.querySelector('.sig-clear').getBoundingClientRect().height >= 44));
check('Das Unterschriftfeld laeuft nicht aus seinem Rahmen',
  await page.evaluate(() => {
    const c = document.getElementById('sigCanvas');
    return c.getBoundingClientRect().right <= c.parentElement.getBoundingClientRect().right + 1;
  }));
check('KRITISCH: kein Seiten-Scroll bei 390px',
  await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
check('KRITISCH: das blosse Oeffnen des Formulars sendet nichts',
  !rufe.some(r => r.p.includes('rapport_create')));
await page.screenshot({ path: `${OUT}/sr-01-formular.png` });

// ── Abweichung erfassen und senden
rufe = [];
await zeitSetzen(page, '#srVon', '08:15');
await zeitSetzen(page, '#srBis', '17:30');
await page.fill('#srBemerkung', 'Baustelle laenger offen');
await page.click('#srBtn');
await page.waitForTimeout(500);
const gesendet = rufe.find(r => r.p.includes('rapport_create'));
check('Senden ruft rapport_create -- kein zweiter Meldeweg', !!gesendet);
check('KRITISCH: die einsatz_id der Schicht geht mit', gesendet && gesendet.body.einsatz_id === 51);
check('Die geaenderten Zeiten gehen mit',
  gesendet && gesendet.body.von === '08:15' && gesendet.body.bis === '17:30');
check('Das Datum kommt aus der Schicht, nicht aus dem Kalender von heute',
  gesendet && gesendet.body.datum === GESTERN);
check('Die Bemerkung geht mit', gesendet && gesendet.body.bemerkung.includes('Baustelle'));
check('KRITISCH: der Mitarbeitende setzt keine Bezahlt-Kennzeichen (ENT-046)',
  gesendet && !('ist_pause_bezahlt_ma' in gesendet.body)
  && !('ist_pause_bezahlt_kunde' in gesendet.body));
check('KRITISCH: die App gleicht nicht selbst ab -- der Rapport ist ein Beleg (ENT-045)',
  !rufe.some(r => r.p.includes('einsatz_abgleich')));
check('Die Schublade schliesst nach dem Senden',
  !(await page.evaluate(() => document.getElementById('blatt').classList.contains('on'))));

// ── Korrektur: erneut rapportieren ist moeglich, der Stand wird benannt
await page.evaluate(() => blattAuf(51));
await page.waitForTimeout(250);
const nachher = await page.textContent('#blBody');
check('Die Schicht sagt, dass sie bereits rapportiert ist', nachher.includes('Bereits rapportiert'));
check('KRITISCH: der Knopf bleibt -- eine Korrektur muss moeglich sein',
  await page.evaluate(() =>
    [...document.querySelectorAll('#blatt button')].some(b => b.textContent.includes('Schicht rapportieren'))));
await page.click('#blatt button:has-text("Schicht rapportieren")');
await page.waitForTimeout(300);
check('Die Korrektur sagt, dass sie den bisherigen Stand ersetzt',
  (await page.textContent('#blBody')).includes('Erneutes Senden korrigiert'));
check('KRITISCH: die Korrektur startet vom zuletzt Gemeldeten, nicht wieder vom Plan',
  (await page.inputValue('#srVon')) === '08:15' && (await page.inputValue('#srBis')) === '17:30');
await page.evaluate(() => blattZu());

// Wer das Recht "abgleich" hat, sieht ueber rapport_list.php ALLE Rapporte.
// Auf einer Schicht zu zweit darf der Rapport der Kollegin nicht als der
// eigene erscheinen -- sonst korrigiert man fremde Angaben unter eigenem Namen.
await page.evaluate(() => {
  rapporte = [{ id: 99, datum: schichten[0].datum, mitarbeiter_id: 77, einsatz_id: 51,
    mitarbeiter: 'e.beispiel', kunde: 'Kunde A', strasse: 'Dorfstrasse 1', ort: '5013 Musterort',
    auftrag_nr: null, einsatzart: 'Verkehrsdienst', von: '06:00:00', bis: '12:00:00',
    pause_min: 45, netto_h: '5.25', unterzeichner: null, unterschrift: null,
    bemerkung: 'Rapport der Kollegin', erfasst_am: schichten[0].datum + ' 12:10:00' }];
});
await page.evaluate(() => blattAuf(51));
await page.waitForTimeout(250);
check('KRITISCH: der Rapport einer anderen Person gilt nicht als der eigene',
  !(await page.textContent('#blBody')).includes('Bereits rapportiert'));
await page.click('#blatt button:has-text("Schicht rapportieren")');
await page.waitForTimeout(300);
check('KRITISCH: die eigene Erfassung wird nicht mit fremden Angaben vorbefuellt',
  (await page.inputValue('#srVon')) === '08:00'
  && !(await page.inputValue('#srBemerkung')).includes('Kollegin'));
await page.evaluate(() => blattZu());

// Der manuelle Rapport bleibt bestehen (vom Projektinhaber ausgeschlossen,
// ihn zu ersetzen).
await page.evaluate(() => zeige('rapport'));
await page.waitForTimeout(300);
check('KRITISCH: der manuelle Rapport bleibt erreichbar',
  await page.evaluate(() =>
    [...document.querySelectorAll('#v-rapport a')].some(a => a.getAttribute('href') === 'index.html')));

// Dieselbe Aenderung am Desktop nachgemessen -- eine Handy-Aenderung wird
// zusaetzlich am Desktop geprueft, und umgekehrt (CLAUDE.md).
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => { zeige('heute'); blattAuf(51); });
await page.waitForTimeout(250);
await page.click('#blatt button:has-text("Schicht rapportieren")');
await page.waitForTimeout(350);
check('Am Desktop bleibt das Formular vollstaendig bedienbar',
  await page.isVisible('#srKunde') && await page.isVisible('#sigCanvas'));
check('KRITISCH: am Desktop kein Seiten-Scroll',
  await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
check('Das Unterschriftfeld bleibt auch am Desktop im Rahmen',
  await page.evaluate(() => {
    const c = document.getElementById('sigCanvas');
    return c.getBoundingClientRect().right <= c.parentElement.getBoundingClientRect().right + 1;
  }));
await browser.close();

// ══════════════════════════════════════════════════════════════════════
// TEIL 2 -- DER PLANER
// ══════════════════════════════════════════════════════════════════════
const person = (id, vorname, nachname, nr) => ({
  id, name: `${vorname[0]}.${nachname}`.toLowerCase(), vorname, nachname, personalnummer: nr,
  zusage: 'zugesagt', ist_status: 'offen', ist_von: null, ist_bis: null,
  ist_pause_von: null, ist_pause_min: null,
  ist_pause_bezahlt_ma: null, ist_pause_bezahlt_kunde: null,
  ist_bemerkung: null, abgeglichen_am: null,
});

const einsaetze = [
  { id: 51, kunde_name: 'Kunde A', titel: 'Baustelle Kreisel', ort: '5013 Musterort',
    strasse: 'Dorfstrasse 1', einsatzart: 'Verkehrsdienst', sparte: 'sicherheit',
    datum: GESTERN, von: '08:00:00', bis: '17:00:00', bedarf: 1, status: 'geplant',
    bemerkung: null, ist_status: 'offen', ist_von: null, ist_bis: null, ist_bemerkung: null,
    abgeglichen_am: null, mitarbeiter: [person(10, 'Max', 'Muster', 'P-001')] },
  // Ohne Rapport -- die Zeile darf nichts von einem behaupten.
  { id: 52, kunde_name: 'Kunde B', titel: 'Nachtrunde', ort: '4632 Musterstadt', strasse: '',
    einsatzart: 'Revierdienst', sparte: 'sicherheit',
    datum: GESTERN, von: '22:00:00', bis: '23:00:00', bedarf: 1, status: 'geplant',
    bemerkung: null, ist_status: 'offen', ist_von: null, ist_bis: null, ist_bemerkung: null,
    abgeglichen_am: null, mitarbeiter: [person(11, 'Eva', 'Beispiel', 'P-002')] },
];

// Der Rapport aus Teil 1: 08:15-17:30 statt 08:00-17:00, keine Pause
// gemeldet. 9 Std. 15 Min. Rohzeit -- ueber der Schwelle von 5½ Std.
const RAPPORTE = [{ id: 1, datum: GESTERN, mitarbeiter_id: 10, einsatz_id: 51,
  mitarbeiter: 'm.muster', kunde: 'Kunde A', strasse: 'Dorfstrasse 1', ort: '5013 Musterort',
  auftrag_nr: null, einsatzart: 'Verkehrsdienst', von: '08:15:00', bis: '17:30:00',
  pause_min: 0, netto_h: '9.25', unterzeichner: 'R. Muster', unterschrift: null,
  bemerkung: 'Baustelle laenger offen', erfasst_am: GESTERN + ' 17:35:00' }];

let dRufe = [];
const schreibt = () => dRufe.filter(r => /create|update|delete|abgleich|zuteil|save/.test(r.p));

const br2 = await chromium.launch({ executablePath: EXE });
const p2 = await br2.newPage({ viewport: { width: 1600, height: 950 } });
p2.on('pageerror', e => bad.push('JS-Fehler (Dashboard): ' + e.message));
await p2.route('**/api/**', route => {
  const req = route.request(), p = req.url().split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
  dRufe.push({ p, body });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze });
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: RAPPORTE });
  if (p.includes('einsatz_abgleich')) return send({ status: 'ok', geschrieben: (body.zeilen || []).length });
  return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [], mitarbeiter: [],
    feiertage: [], gepflegt: {}, sperren: [], kpi: {}, verlauf: [], angemeldet: [],
    pro_mitarbeiter: [], letzte_rapporte: [] });
});
await p2.goto(`file://${WURZEL}/dashboard.html`);
await p2.fill('#gName', 'a'); await p2.fill('#gPass', 'x'); await p2.click('#gBtn');
await p2.waitForSelector('#shell.on');
await p2.waitForTimeout(300);
await p2.click('#nav-abgleich');
await p2.waitForTimeout(600);

const tab = await p2.textContent('#agTable');
check('KRITISCH: die Abweichung wird an der Zeile gemeldet', tab.includes('Rapport weicht ab'));
check('Die Meldung nennt die abweichenden Zeiten', tab.includes('08:15') && tab.includes('17:30'));
check('KRITISCH: eine Zeile ohne Rapport behauptet keinen',
  await p2.evaluate(() => {
    const zeilen = [...document.querySelectorAll('#agTable tbody tr')];
    const eva = zeilen.find(t => t.textContent.includes('Eva Beispiel'));
    return !!eva && !eva.textContent.includes('Rapport');
  }));
check('KRITISCH: das Anzeigen des Rapports schreibt nichts', schreibt().length === 0);

// ── Die Schublade
await p2.click('#agTable tbody tr:first-child .stift');
await p2.waitForSelector('#drawer.on');
await p2.waitForTimeout(300);
const dr = await p2.textContent('#drBody');
check('Die Schublade zeigt den Rapport', dr.includes('Rapport des Mitarbeitenden'));
check('Sie nennt die gemeldeten Zeiten', dr.includes('08:15') && dr.includes('17:30'));
check('Sie nennt die Bemerkung des Mitarbeitenden', dr.includes('Baustelle'));
check('KRITISCH: sie sagt, dass der Rapport ein Beleg ist und nichts festschreibt (ENT-045)',
  dr.includes('Beleg'));

// ── Die SPERRE aus ENT-082: Hinweis statt Automatik
check('KRITISCH: der Pausenhinweis erscheint bei Rohzeit ueber 5½ Std. ohne gemeldete Pause',
  dr.includes('5½') && dr.includes('keine Pause gemeldet'));
check('KRITISCH: der Hinweis nennt die offene Auslegungsfrage', dr.includes('GAV-AUS-007'));
check('KRITISCH: der Hinweis sagt ausdruecklich, dass nichts vorbelegt wird',
  dr.includes('nichts vorbelegt'));

// ── Uebernehmen
dRufe = [];
await p2.click('#drBody button:has-text("Rapportzeiten übernehmen")');
await p2.waitForTimeout(400);
check('KRITISCH: Uebernehmen setzt die Zeiten des Rapports',
  (await p2.inputValue('#agdVon')) === '08:15' && (await p2.inputValue('#agdBis')) === '17:30');
check('Der Status springt auf anwesend', (await p2.inputValue('#agdStatus')) === 'anwesend');
check('Die Bemerkung des Mitarbeitenden wird uebernommen',
  (await p2.inputValue('#agdBemerkung')).includes('Baustelle'));
check('KRITISCH: die Pausendauer bleibt bei 0 -- es wird NICHTS gerechnet (ENT-082 Sperre)',
  (await p2.inputValue('#agdPause')) === '0');
check('KRITISCH: Uebernehmen setzt die Bezahlt-Kennzeichen nicht (GAV-AUS-004, ENT-046)',
  await p2.evaluate(() => !document.getElementById('agdBezMa').checked
    && !document.getElementById('agdBezKunde').checked));
check('KRITISCH: Uebernehmen allein speichert nichts -- erst der Knopf darunter',
  !dRufe.some(r => r.p.includes('einsatz_abgleich')));
await p2.screenshot({ path: `${OUT}/sr-02-schublade.png` });

// ── Erst das Speichern schreibt, und zwar ueber den bestehenden Abgleich
dRufe = [];
await p2.click('#drFoot .btn-primary');
await p2.waitForTimeout(500);
const gespeichert = dRufe.find(r => r.p.includes('einsatz_abgleich'));
check('Speichern laeuft ueber einsatz_abgleich -- kein zweiter Schreibweg (ENT-045)', !!gespeichert);
check('Die uebernommenen Zeiten werden gespeichert',
  gespeichert && gespeichert.body.zeilen[0].ist_von === '08:15'
  && gespeichert.body.zeilen[0].ist_bis === '17:30');
check('Die Zeile traegt ihre Person', gespeichert && gespeichert.body.zeilen[0].mitarbeiter_id === 10);
check('KRITISCH: der Plan wird nicht angefasst', !dRufe.some(r => r.p.includes('einsatz_save')));

// ── Handy: der Abgleich ist dort bewusst lesend (ENT-057). Lesend heisst
// aber nicht blind -- eine Schicht mit abweichendem Rapport darf nicht
// aussehen wie eine ohne ("unbekannt" nie wie "keine").
await p2.evaluate(() => closeDrawer());
await p2.setViewportSize({ width: 390, height: 844 });
await p2.evaluate(() => go('abgleich'));
await p2.waitForTimeout(600);
check('KRITISCH: die Handy-Karte nennt den abweichenden Rapport',
  await p2.evaluate(() => {
    const k = [...document.querySelectorAll('#agTable .nur-schmal .ag-karte')]
      .find(x => x.textContent.includes('Max Muster'));
    return !!k && k.textContent.includes('Rapport weicht ab');
  }));
check('KRITISCH: eine Karte ohne Rapport behauptet auf dem Handy keinen',
  await p2.evaluate(() => {
    const k = [...document.querySelectorAll('#agTable .nur-schmal .ag-karte')]
      .find(x => x.textContent.includes('Eva Beispiel'));
    return !!k && !k.textContent.includes('Rapport');
  }));
check('KRITISCH: kein Seiten-Scroll bei 390px im Abgleich',
  await p2.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await p2.screenshot({ path: `${OUT}/sr-03-mobil.png` });
await br2.close();

// ══════════════════════════════════════════════════════════════════════
// TEIL 3 -- DIE SPERRE LIEGT IM SERVER, NICHT IM BROWSER
// ══════════════════════════════════════════════════════════════════════
// Was im Browser steht, erspart nur den Umweg. Wer rapport_create.php direkt
// aufruft, muss dieselben Grenzen vorfinden -- sonst haengt die Regel "nur
// bei Verkehrsdienst, nur die eigene, nur zugesagt" an einem Knopf.
const erstellen = readFileSync(`${WURZEL}/backend/api/rapport_create.php`, 'utf8');
const ohneKommentar = t => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter(z => !/^\s*(\/\/|#)/.test(z)).join('\n');
const q = ohneKommentar(erstellen);

// NUR der Block hinter "if ($einsatzId > 0)" zaehlt, nicht die ganze Datei.
// Sonst genuegt der Vorgabewert 'Verkehrsdienst' im INSERT weiter unten, um
// die Pruefung gruen zu halten -- gemessen: genau das ist bei der Gegenprobe
// passiert, die Pruefung blieb gruen, obwohl die Sperre entfernt war.
const wache = (() => {
  const start = q.search(/if\s*\(\s*\$einsatzId\s*>\s*0\s*\)\s*\{/);
  if (start < 0) return '';
  let tiefe = 0, i = q.indexOf('{', start);
  for (let j = i; j < q.length; j++) {
    if (q[j] === '{') tiefe++;
    else if (q[j] === '}' && --tiefe === 0) return q.slice(i, j + 1);
  }
  return '';
})();

check('KRITISCH: der Server prueft, ob die Zuteilung der anfragenden Person gehoert',
  /FROM einsatz_zuteilung/.test(wache) && /mitarbeiter_id\s*=\s*\?/.test(wache)
  && /\$user\['id'\]/.test(wache));
check('KRITISCH: der Server weist eine fremde Schicht mit 403 ab',
  /json_response\([\s\S]{0,200}403\)/.test(wache));
check('KRITISCH: der Server prueft die Zusage und weist ab',
  /zugesagt/.test(wache) && /json_response/.test(wache));
check('KRITISCH: der Server prueft die Einsatzart und weist ab',
  /einsatzart/.test(wache) && /Verkehrsdienst/.test(wache));
check('Alle drei Grenzen antworten mit einem Fehler, nicht mit einem stillen NULL',
  (wache.match(/json_response/g) || []).length >= 3);
check('einsatz_id wird tatsaechlich in die Tabelle geschrieben',
  /INSERT INTO rapporte[\s\S]{0,200}einsatz_id/.test(q));

// Der Rapport bleibt grundsaetzlich ein Beleg, kein Full-Override des Plans:
// er schreibt weiterhin NICHT an einsatz_zuteilung/einsatz_position -- die
// Ist-Zeiten und die Zuteilung selbst aendert er nie, genau darum braucht
// er dafuer auch keine Sperrpruefung (ENT-045, test_php.mjs bewacht das).
//
// Seit ENT-128 gibt es EINE gezielte, bewusste Ausnahme (Revision der
// urspruenglichen ENT-082-Abgrenzung "der Rapport schreibt nichts"): er darf
// an einsaetze den Status auf "abgeschlossen" setzen, sobald ALLE zugesagten
// Personen rapportiert haben. Das ist eine reine Statusanzeige, keine
// Festschreibung von Zeiten -- und die ENT-045-Sperre bleibt trotzdem
// respektiert (siehe !einsatz_abgeglichen() in rapport_create.php).
check('KRITISCH: der Rapport schreibt nicht an einsatz_zuteilung/einsatz_position',
  !/(UPDATE|DELETE FROM|INSERT INTO)\s+(einsatz_zuteilung|einsatz_position)\b/.test(q));
const einsaetzeUpdates = q.match(/UPDATE\s+einsaetze\s+SET\s+[^;]*?(?=\s+WHERE)/g) || [];
check('Es gibt ueberhaupt eine UPDATE-Anweisung an einsaetze, sonst prueft das Folgende nichts',
  einsaetzeUpdates.length > 0);
// Seit ENT-160 gibt es eine ZWEITE, ebenso eng gefasste Ausnahme: die
// Kundenunterschrift. Sie gehoert zum Auftrag, nicht zur einzelnen Person --
// sonst unterschreibt der Kunde bei zwei Eingeteilten zweimal. Sie ist keine
// Zeit und keine Zuteilung, veraendert also nichts, woran Lohn oder GAV
// haengen.
//
// Die Liste bleibt ABSCHLIESSEND: erlaubt sind genau diese beiden Muster,
// alles andere faellt weiterhin durch. Eine Wache, die man bei jeder neuen
// Spalte aufweicht, bewacht am Ende nichts mehr.
const ERLAUBTE_EINSATZ_UPDATES = [
  /^UPDATE einsaetze SET status = '[a-z]+'$/,
  /^UPDATE einsaetze SET unterschrift = \?, unterzeichner = \?, unterschrift_von = \?, unterschrift_am = NOW\(\)$/,
];
check('KRITISCH: an einsaetze schreibt er nur Status und Kundenunterschrift, sonst nichts (ENT-128/156)',
  !/(DELETE FROM|INSERT INTO)\s+einsaetze\b/.test(q)
  && einsaetzeUpdates.every(u =>
    ERLAUBTE_EINSATZ_UPDATES.some(m => m.test(u.trim().replace(/\s+/g, ' ')))));
// Beide Ausnahmen muessen dieselbe Sperre respektieren. Beim Bauen von
// ENT-160 zuerst vergessen: die Unterschrift wurde auch in einen bereits
// abgeglichenen, festgeschriebenen Einsatz geschrieben. Diese Pruefung haelt
// den Fehler dauerhaft fern.
check('KRITISCH: auch die Unterschrift respektiert die Sperre einer abgeglichenen Schicht (ENT-045)',
  /\$sig !== null && !einsatz_abgeglichen\(db\(\), \$einsatzId\)/.test(q));
check('KRITISCH: die Unterschrift wird nur EINMAL gesetzt und nie ueberschrieben',
  /WHERE id = \? AND unterschrift IS NULL/.test(q));

// Die Spalte muss auch tatsaechlich angelegt werden -- eine Abfrage auf eine
// Spalte, die die Einrichtung nie ergaenzt, faellt erst im Betrieb auf.
const einrichten = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
check('KRITISCH: die Einrichtung legt rapporte.einsatz_id an',
  /'rapporte',\s*'einsatz_id'/.test(einrichten)
  && /ALTER TABLE rapporte ADD COLUMN einsatz_id/.test(einrichten));
check('Der Rapport ueberlebt das Loeschen seiner Schicht -- er ist ein Dokument ueber einen Tag',
  /REFERENCES einsaetze\(id\) ON DELETE SET NULL/.test(einrichten));
check('rapport_list liefert die Zuordnung mit',
  /r\.einsatz_id/.test(readFileSync(`${WURZEL}/backend/api/rapport_list.php`, 'utf8')));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
