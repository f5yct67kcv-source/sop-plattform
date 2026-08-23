// Ereignis-Feed der Übersicht (ENT-089).
//
// Der teuerste Fehler wäre hier nicht ein fehlendes Ereignis, sondern eines,
// das sich abhaken lässt, obwohl die Arbeit noch aussteht -- oder eine leere
// Liste, die "nichts passiert" sagt, obwohl in Wahrheit eine Abfrage
// gescheitert ist. Mehrere Prüfungen zielen genau darauf.
//
// Alle Testdaten sind erfunden.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const isoDat = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const MORGEN  = isoDat(new Date(Date.now() + 864e5));
// Zeitstempel relativ zu JETZT. Ein festes Datum in einer Pruefung ist eine
// Zeitbombe: Es wandert mit dem Kalender aus dem erwarteten Bereich, und die
// Suite wird rot, ohne dass sich am Produkt etwas geaendert hat.
const vorMin = m => new Date(Date.now() - m * 6e4).toISOString().slice(0, 19).replace('T', ' ');
const GESTERN = isoDat(new Date(Date.now() - 864e5));

const EREIGNISSE = [
  { typ: 'rapport', id: 7, zeit: vorMin(5),
    person: { id: 3, name: 'anna', vorname: 'Anna', nachname: 'Muster' },
    titel: 'Rapport eingegangen', datum: GESTERN, kunde: 'Muster AG', ort: 'Musterstadt',
    einsatzart: 'Verkehrsdienst', netto_h: '7.50' },
  { typ: 'sperrtag', id: 4, zeit: vorMin(65),
    person: { id: 5, name: 'beat', vorname: 'Beat', nachname: 'Beispiel' },
    titel: 'Tag gesperrt', datum: MORGEN, bemerkung: 'Weiterbildung' },
  { typ: 'zusage', id: 11, mitarbeiter_id: 3, zeit: vorMin(130),
    person: { id: 3, name: 'anna', vorname: 'Anna', nachname: 'Muster' },
    titel: 'Schicht zugesagt', zusage: 'zugesagt', datum: MORGEN,
    von: '07:00', bis: '16:00', kunde: 'Muster AG', ort: 'Musterstadt' },
  { typ: 'abgleich', id: 22, zeit: GESTERN + ' 23:59:59',
    titel: 'Abgleich offen', datum: GESTERN, von: '05:15', bis: '05:30',
    kunde: 'Beispiel GmbH', ort: 'Beispielstadt' },
];

const browser = await chromium.launch({ executablePath: EXE });
const gesendet = [];

async function seite(daten = {}) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p.setDefaultTimeout(5000);
  p.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await p.route('**/api/**', r => {
    const pf = r.request().url().split('/api/')[1].split('?')[0];
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (pf.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (pf.includes('ereignis_erledigt')) {
      gesendet.push(JSON.parse(r.request().postData() || '{}'));
      return send({ status: 'ok' });
    }
    if (pf.includes('dashboard_stats')) return send({
      status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
      ereignisse: EREIGNISSE, ereignisse_gesamt: EREIGNISSE.length,
      ereignisse_gekuerzt: false, ereignisse_unvollstaendig: [], ...daten });
    return send({ status: 'ok', rapporte: [], objekte: [], masterschichten: [], einsaetze: [],
      kunden: [], mitarbeiter: [], orte: [], feiertage: [], gepflegt: {} });
  });
  await p.goto(URL);
  await p.evaluate(() => localStorage.removeItem('rv3_dash_layout'));
  await p.fill('#gName', 'adrian'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(700);
  return p;
}

// ══════════════════════════════ DIE VIER ARTEN
try {
  const p = await seite();
  const zeilen = await p.$$eval('#ereignisFeed .rank', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check('KRITISCH: alle vier Ereignisse stehen im Feed', zeilen.length === 4);
  check('Der Rapport nennt Person und Kunde',
    /Anna Muster.*Rapport gesendet.*Muster AG/.test(zeilen[0] || ''));
  check('Der Sperrtag nennt den Grund', /Beat Beispiel.*gesperrt.*Weiterbildung/.test(zeilen[1] || ''));
  check('Die Zusage sagt, dass zugesagt wurde', /Anna Muster.*hat zugesagt/.test(zeilen[2] || ''));
  check('KRITISCH: der offene Abgleich steht drin', /nicht abgeglichen/.test(zeilen[3] || ''));

  // Der offene Abgleich verschwindet erst, wenn abgeglichen wurde --
  // ihn abhaken zu koennen hiesse: weg, obwohl die Arbeit aussteht.
  const haken = await p.$$eval('#ereignisFeed .rank', els => els.map(e => !!e.querySelector('.rank-erledigt')));
  check('KRITISCH: drei Arten lassen sich abhaken', haken.slice(0, 3).every(Boolean));
  check('KRITISCH: der offene Abgleich NICHT', haken[3] === false);
  await p.screenshot({ path: `${OUT}/ereignisse.png` });
  await p.close();
} catch (e) { bad.push('Vier Arten: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ AUFKLAPPEN UND WEITERGEHEN
try {
  const p = await seite();
  let sichtbar = await p.isVisible('#ergDetail0');
  check('Zu Beginn ist nichts aufgeklappt', sichtbar === false);

  await p.click('#ereignisFeed .rank'); await p.waitForTimeout(300);
  check('KRITISCH: ein Klick klappt die Zeile auf', await p.isVisible('#ergDetail0'));
  const txt = (await p.textContent('#ergDetail0')).replace(/\s+/g, ' ');
  check('Die Einzelheiten stehen drin', /Muster AG/.test(txt) && /7.50 h/.test(txt));
  const wege = await p.$$eval('#ergDetail0 .erg-wege .btn', b => b.map(x => x.textContent.trim()));
  check('KRITISCH: der Weg zur Person ist da', wege.includes('Zur Person'));
  check('KRITISCH: der Weg zu den Rapporten ist da', wege.includes('Zu den Rapporten'));
  check('Und zum Tagesplan', wege.includes('Zum Tagesplan'));

  await p.click('#ereignisFeed .rank'); await p.waitForTimeout(300);
  check('Ein zweiter Klick klappt sie wieder zu', (await p.isVisible('#ergDetail0')) === false);

  // Der Weg fuehrt wirklich hin
  await p.click('#ereignisFeed .rank'); await p.waitForTimeout(250);
  await p.click('#ergDetail0 .erg-wege .btn >> nth=2'); await p.waitForTimeout(400);
  check('KRITISCH: "Zum Tagesplan" wechselt in die Planung',
    (await p.textContent('#pgTitle')) === 'Planung');
  await p.close();
} catch (e) { bad.push('Aufklappen: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ ABHAKEN
try {
  const p = await seite();
  gesendet.length = 0;
  await p.click('#ereignisFeed .rank .rank-erledigt'); await p.waitForTimeout(400);
  check('KRITISCH: die Zeile verschwindet sofort',
    (await p.$$('#ereignisFeed .rank')).length === 3);
  check('KRITISCH: der Server bekommt Art UND Nummer',
    gesendet.length === 1 && gesendet[0].typ === 'rapport' && gesendet[0].id === 7);

  // Die Zusage haengt an Einsatz UND Person -- ohne beides wuerden die
  // Rueckmeldungen aller Zugeteilten dieser Schicht weggewischt.
  gesendet.length = 0;
  await p.click('#ereignisFeed .rank >> nth=1'); await p.waitForTimeout(200);
  await p.click('#ereignisFeed .rank >> nth=1 >> .rank-erledigt').catch(() => {});
  await p.waitForTimeout(400);
  check('KRITISCH: bei der Zusage geht die Person mit',
    gesendet.length === 1 && gesendet[0].typ === 'zusage' && gesendet[0].mitarbeiter_id === 3);
  await p.close();
} catch (e) { bad.push('Abhaken: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ LEER IST NICHT GLEICH LEER
try {
  const p = await seite({ ereignisse: [], ereignisse_gesamt: 0, ereignisse_unvollstaendig: [] });
  const t = (await p.textContent('#ereignisFeed')).replace(/\s+/g, ' ');
  check('Ohne Ereignisse steht "Nichts Neues"', /Nichts Neues/.test(t));
  await p.close();

  const q = await seite({ ereignisse: [], ereignisse_gesamt: 0,
                          ereignisse_unvollstaendig: ['rapport', 'zusage'] });
  const t2 = (await q.textContent('#ereignisFeed')).replace(/\s+/g, ' ');
  const note = (await q.textContent('#ereignisNote')).replace(/\s+/g, ' ');
  check('KRITISCH: eine gescheiterte Abfrage sieht NICHT aus wie "nichts passiert"',
    /Nicht abfragbar/.test(t2) && !/Nichts Neues/.test(t2));
  check('Und sie benennt, welche Arten fehlen', /rapport/.test(t2) && /zusage/.test(t2));
  check('Die Kopfzeile weist ebenfalls darauf hin', /unvollständig/.test(note));
  await q.close();
} catch (e) { bad.push('Leerzustaende: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ GEKUERZT IST NICHT VOLLSTAENDIG
try {
  const p = await seite({ ereignisse_gesamt: 31, ereignisse_gekuerzt: true });
  const note = (await p.textContent('#ereignisNote')).replace(/\s+/g, ' ').trim();
  check('KRITISCH: eine gekuerzte Liste sagt es -- "4 von 31"', note === '4 von 31');
  await p.close();
  const q = await seite();
  check('Eine vollstaendige Liste behauptet nichts',
    (await q.textContent('#ereignisNote')).trim() === '');
  await q.close();
} catch (e) { bad.push('Gekuerzt: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ DIE ALTE ANORDNUNG FINDET DIE KACHEL
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.route('**/api/**', r => {
    const pf = r.request().url().split('/api/')[1].split('?')[0];
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (pf.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (pf.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [],
      pro_mitarbeiter: [], letzte_rapporte: [], ereignisse: EREIGNISSE, ereignisse_gesamt: 4,
      ereignisse_gekuerzt: false, ereignisse_unvollstaendig: [] });
    return send({ status: 'ok', rapporte: [], objekte: [], masterschichten: [], einsaetze: [],
      kunden: [], mitarbeiter: [], orte: [], feiertage: [], gepflegt: {} });
  });
  await p.goto(URL);
  // Eine Anordnung von gestern, mit dem alten Namen
  await p.evaluate(() => localStorage.setItem('rv3_dash_layout', JSON.stringify(
    [{ id: 'begruessung', sichtbar: true }, { id: 'sperrfeed', sichtbar: true }])));
  await p.fill('#gName', 'adrian'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(700);
  const da = await p.evaluate(() => {
    const e = document.querySelector('[data-widget="ereignisse"]');
    return !!e && e.getBoundingClientRect().height > 0;
  });
  check('KRITISCH: eine gespeicherte Anordnung mit dem alten Namen findet die Kachel', da);
  await p.close();
} catch (e) { bad.push('Anordnung: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ UEBERNOMMEN AUS test_sperrfeed.mjs
//
// Diese Suite ersetzt test_sperrfeed.mjs -- die Kachel "Neue Sperrtage" ist
// im Ereignis-Feed aufgegangen (ENT-089). Die folgenden Pruefungen stammen
// von dort; ihre Absicht gilt unveraendert weiter, nur die Kachel heisst
// anders. Sie hier zu wiederholen ist kein Zufall, sondern der Grund, warum
// die alte Suite geloescht werden durfte.
try {
  const OHNE_NOTIZ = [{ typ: 'sperrtag', id: 9, zeit: vorMin(3),
    person: { id: 5, name: 'beat', vorname: 'Beat', nachname: 'Beispiel' },
    titel: 'Tag gesperrt', datum: MORGEN }];
  const p = await seite({ ereignisse: OHNE_NOTIZ, ereignisse_gesamt: 1 });
  const t = (await p.textContent('#ereignisFeed')).replace(/\s+/g, ' ');
  check('KRITISCH: ohne Notiz kein Gedankenstrich ins Leere', !/gesperrt\s*—\s*(<|$|\s*vor)/.test(t));
  check('Die relative Zeit wird ausgeschrieben', /vor \d+ Min\./.test(t));
  await p.close();
} catch (e) { bad.push('Ohne Notiz: ' + String(e).split('\n')[0].slice(0, 120)); }

try {
  const p = await seite();
  // Reihenfolge: neuestes zuerst. Der Feed mischt vier Quellen -- ohne
  // gemeinsame Sortierung stuende die aelteste Art zuoberst, je nachdem,
  // welche Abfrage zufaellig zuerst lief.
  const zeiten = await p.$$eval('#ereignisFeed .rank', els =>
    els.map(e => e.lastElementChild.previousElementSibling.textContent.trim()));
  check('KRITISCH: das Neueste steht oben', /Min/.test(zeiten[0] || ''));

  // Der Erledigt-Knopf sitzt in einer anklickbaren Zeile. Ohne
  // stopPropagation wuerde er zusaetzlich die Zeile aufklappen.
  await p.click('#ereignisFeed .rank .rank-erledigt'); await p.waitForTimeout(350);
  check('KRITISCH: der Erledigt-Knopf klappt die Zeile nicht zusaetzlich auf',
    (await p.$$('.erg-detail:visible')).length === 0);
  check('Und er wechselt auch nicht die Ansicht',
    (await p.textContent('#pgTitle')) === 'Übersicht');

  // Die uebrigen Kacheln duerfen nicht mithaengen, wenn der Feed leer ist.
  const q = await seite({ ereignisse: [], ereignisse_gesamt: 0 });
  check('Auch ohne Ereignisse laden die uebrigen Kacheln',
    (await q.$$('.dash-item')).length >= 6);
  await q.close();
  await p.close();
} catch (e) { bad.push('Reihenfolge/Knopf: ' + String(e).split('\n')[0].slice(0, 120)); }

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
