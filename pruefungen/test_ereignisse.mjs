// Ereignis-Feed der Übersicht (ENT-090).
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

// Drei Arten, mehr nicht: Rapport, Sperrtag, Rueckmeldung zu einer Schicht.
// Ein vierter Eintrag "offener Abgleich" wurde am 23.08.2026 entfernt -- er
// war ein Zustand, kein Ereignis.
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
];

// Eine Ablehnung -- bewusst NICHT im gemeinsamen Bestand: Die uebrigen
// Pruefungen zaehlen dort drei Ereignisse, und eine vierte Zeile haette sie
// alle rot gefaerbt, ohne dass am Produkt etwas falsch waere.
const ABLEHNUNG = { typ: 'zusage', id: 12, mitarbeiter_id: 4, zeit: vorMin(20),
  person: { id: 4, name: 'urs', vorname: 'Urs', nachname: 'Beispiel' },
  titel: 'Schicht abgelehnt', zusage: 'abgelehnt', datum: MORGEN,
  von: '07:00', bis: '16:00', kunde: 'Borner AG', ort: 'Olten' };

// Vierte Art (ENT-192/ENT-197): eine Kundenentscheidung im Portal, ohne
// eigenen Login. Kein 'person' -- der Kunde ist keine Mitarbeiterin, der
// Absender kommt aus 'kunde'.
const OFFERTE_ANGENOMMEN = { typ: 'offerte', id: 55, zeit: vorMin(8),
  titel: 'Offerte angenommen', nummer: 'OF-0055', kunde: 'pzu Consulting GmbH', status: 'bestaetigt' };
const OFFERTE_ABGELEHNT  = { typ: 'offerte', id: 56, zeit: vorMin(9),
  titel: 'Offerte abgelehnt', nummer: 'OF-0056', kunde: 'Gemeinde Läufelfingen', status: 'abgelehnt' };

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
    // Fuer den Weg "Zur Offerte" aus dem Ereignis-Detail (ENT-197): eine
    // minimale, aber vollstaendige Antwort, damit ofOeffnen() nicht an einem
    // fehlenden Feld scheitert und einen echten Fehler ins Protokoll wirft.
    if (pf.includes('beleg_lesen')) return send({ status: 'ok', kunde: null, person: null, beleg: {
      id: 55, art: 'offerte', nummer: 'OF-0055', kunde_id: null, person_id: null,
      titel: 'Testeinsatz', referenz: '', datum: GESTERN, gueltig_bis: MORGEN,
      status: 'bestaetigt', rabatt_bp: 0, aktiv: 1, ist_vorlage: 0, unterschriftsseite: 0,
      oeffentliche_notizen: '', bedingungen: '', fusszeile_text: '', bemerkung: '', positionen: [],
    }});
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

// ══════════════════════════════ DIE DREI ARTEN
try {
  const p = await seite();
  const zeilen = await p.$$eval('#ereignisFeed .rank', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check('KRITISCH: alle drei Ereignisse stehen im Feed', zeilen.length === 3);
  check('Der Rapport nennt Person und Kunde',
    /Anna Muster.*Rapport gesendet.*Muster AG/.test(zeilen[0] || ''));
  check('Der Sperrtag nennt den Grund', /Beat Beispiel.*gesperrt.*Weiterbildung/.test(zeilen[1] || ''));
  check('Die Zusage sagt, dass zugesagt wurde', /Anna Muster.*hat zugesagt/.test(zeilen[2] || ''));

  // Ein Ereignis ist etwas, das GESCHEHEN ist. Eine offene, noch nicht
  // abgeglichene Schicht ist ein andauernder Zustand und stand bis zum
  // 23.08.2026 faelschlich mit drin: "fehlende, noch nicht abgeschlossene
  // Schichten sollen nicht in die Ereignisse kommen. nur ereignisse, die neu
  // hinzukommen." Der Feed darf so etwas auch dann nicht anzeigen, wenn der
  // Server es eines Tages wieder mitschickt.
  const mitAbgleich = await seite({ ereignisse: [...EREIGNISSE,
    { typ: 'abgleich', id: 22, zeit: vorMin(200), titel: 'Abgleich offen', datum: GESTERN,
      von: '05:15', bis: '05:30', kunde: 'Beispiel GmbH', ort: 'Beispielstadt' }],
    ereignisse_gesamt: 4 });
  const woerter = (await mitAbgleich.textContent('#ereignisFeed')).replace(/\s+/g, ' ');
  check('KRITISCH: eine offene Schicht taucht nirgends als Ereignis auf',
    !/nicht abgeglichen/.test(woerter) && !/Abgleich offen/.test(woerter));
  check('KRITISCH: sie hinterlaesst auch keine leere Zeile',
    (await mitAbgleich.$$('#ereignisFeed .rank')).length === 3);
  check('KRITISCH: und sie bekommt schon gar keinen Weg "Zum Abgleich"',
    !/Zum Abgleich/.test(await mitAbgleich.innerHTML('#ereignisFeed')));
  await mitAbgleich.close();

  const haken = await p.$$eval('#ereignisFeed .rank', els => els.map(e => !!e.querySelector('.rank-erledigt')));
  check('KRITISCH: alle drei Arten lassen sich abhaken', haken.length === 3 && haken.every(Boolean));
  await p.screenshot({ path: `${OUT}/ereignisse.png` });
  await p.close();
} catch (e) { bad.push('Vier Arten: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ SPALTEN MIT UEBERSCHRIFTEN
//
// Vom Projektinhaber am 2026-08-23: "die ereigniss spalte noch mit
// überchriften Absender, Beschreibung und Datum ganz rechts."
//
// Eine Ueberschrift, die nicht ueber ihrer Spalte steht, ist schlimmer als
// keine -- sie behauptet eine Zuordnung, die nicht stimmt. Darum wird die
// Ausrichtung GEMESSEN, nicht im Quelltext nachgelesen.
try {
  const p = await seite();
  const kopf = (await p.textContent('#ereignisFeed .erg-kopf')).replace(/\s+/g, ' ').trim();
  check('KRITISCH: die drei Ueberschriften stehen da', kopf === 'Absender Beschreibung Datum');

  const m = await p.evaluate(() => {
    const q = s => document.querySelector(s).getBoundingClientRect();
    const zeile = document.querySelector('#ereignisFeed .rank.erg');
    const inZeile = s => zeile.querySelector(s).getBoundingClientRect();
    return { kAbs: q('.erg-kopf .k-abs'), kTxt: q('.erg-kopf .k-txt'), kDat: q('.erg-kopf .k-datum'),
             abs: inZeile('.erg-abs'), txt: inZeile('.erg-txt'), dat: inZeile('.erg-datum'),
             kopfUnten: q('#ereignisFeed .erg-kopf').bottom, zeileOben: zeile.getBoundingClientRect().top,
             feld: q('#ereignisFeed').right };
  });
  check('KRITISCH: "Absender" steht genau über dem Namen', Math.abs(m.kAbs.left - m.abs.left) < 1);
  check('KRITISCH: "Beschreibung" steht genau über der Beschreibung', Math.abs(m.kTxt.left - m.txt.left) < 1);
  check('KRITISCH: "Datum" steht genau über dem Datum', Math.abs(m.kDat.right - m.dat.right) < 1);
  check('KRITISCH: das Datum steht ganz rechts', m.dat.left > m.txt.right && m.dat.right < m.feld);
  check('Die Beschreibung steht rechts vom Absender, nicht darunter',
    m.txt.left > m.abs.right - 1 && Math.abs(m.txt.top - m.abs.top) < 3);
  check('Die Kopfzeile steht ÜBER der ersten Zeile', m.kopfUnten <= m.zeileOben + 1);

  // Der Feed zeigt zwei Zeitangaben: "vor 18 Min." liest sich schnell, das
  // Datum sagt, welcher Tag gemeint ist. Ohne das Datum stuende unter der
  // Ueberschrift "Datum" gar keines.
  const dat = (await p.textContent('#ereignisFeed .rank.erg .erg-datum')).replace(/\s+/g, ' ');
  check('KRITISCH: unter "Datum" steht auch wirklich ein Datum', /\d{2}\.\d{2}\.\d{4}/.test(dat));
  check('Und daneben die gelesene Zeitspanne', /vor \d+ Min\./.test(dat));
  await p.screenshot({ path: `${OUT}/ereignisse-spalten.png` });
  await p.close();

  // Ohne Ereignisse keine Kopfzeile: Ueberschriften ueber einer leeren Liste
  // versprechen eine Tabelle, die es nicht gibt.
  const q = await seite({ ereignisse: [], ereignisse_gesamt: 0 });
  check('Über einem Leerzustand steht keine Kopfzeile',
    (await q.$$('#ereignisFeed .erg-kopf')).length === 0);
  await q.close();
} catch (e) { bad.push('Spalten: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ SCHMAL: KEINE SPALTEN, KEINE UEBERSCHRIFTEN
try {
  const p = await seite();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(250);
  const m = await p.evaluate(() => {
    const zeile = document.querySelector('#ereignisFeed .rank.erg');
    const abs = zeile.querySelector('.erg-abs').getBoundingClientRect();
    const txt = zeile.querySelector('.erg-txt').getBoundingClientRect();
    const kopf = document.querySelector('#ereignisFeed .erg-kopf');
    return { kopfWeg: getComputedStyle(kopf).display === 'none', absU: abs.bottom, txtO: txt.top,
             quer: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  check('KRITISCH: auf dem Handy verschwinden die Überschriften', m.kopfWeg);
  check('KRITISCH: und die Beschreibung rückt UNTER den Absender', m.txtO >= m.absU - 1);
  check('KRITISCH: kein Querscrollen auf dem Handy', m.quer === false);
  await p.close();
} catch (e) { bad.push('Schmal: ' + String(e).split('\n')[0].slice(0, 120)); }

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
    (await p.$$('#ereignisFeed .rank')).length === 2);
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
    /Unvollständig/.test(t2) && !/Nichts Neues/.test(t2));
  check('Und sie benennt, welche Arten fehlen', /rapport/.test(t2) && /zusage/.test(t2));
  check('Und sie sagt, was zu tun ist', /Einrichtung/.test(t2));
  check('Die Kopfzeile weist ebenfalls darauf hin', /unvollständig/.test(note));
  await q.close();

  // Der teuerste Fall ist NICHT die leere Liste, sondern die gefuellte mit
  // einer Luecke darin: Sie sieht vollstaendig aus. Genau das ist am
  // 23.08.2026 passiert -- ein gesendeter Rapport fehlte, weil die Spalte
  // rapporte.gesehen_am nicht angelegt war, und der Feed zeigte trotzdem
  // ungeruehrt seine anderen Zeilen. Der Hinweis muss deshalb IM Feed
  // stehen, ueber der Liste, nicht nur als graue Notiz in der Kopfzeile.
  const l = await seite({ ereignisse_unvollstaendig: ['rapport'] });
  const banner = await l.$('#ereignisFeed .erg-luecke');
  check('KRITISCH: die Luecke wird auch bei gefuellter Liste angezeigt', !!banner);
  const oben = await l.evaluate(() => {
    const b = document.querySelector('#ereignisFeed .erg-luecke');
    const z = document.querySelector('#ereignisFeed .rank');
    return b && z ? b.getBoundingClientRect().top < z.getBoundingClientRect().top : false;
  });
  check('KRITISCH: und zwar UEBER der Liste, nicht darunter versteckt', oben);
  const sichtbarG = await l.evaluate(() => {
    const b = document.querySelector('#ereignisFeed .erg-luecke');
    const r = b.getBoundingClientRect();
    return r.height > 20 && r.width > 100 && getComputedStyle(b).display !== 'none';
  });
  check('Sie ist auch wirklich sichtbar -- gemessen, nicht nachgelesen', sichtbarG);
  await l.close();
} catch (e) { bad.push('Leerzustaende: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ GEKUERZT IST NICHT VOLLSTAENDIG
try {
  const p = await seite({ ereignisse_gesamt: 31, ereignisse_gekuerzt: true });
  const note = (await p.textContent('#ereignisNote')).replace(/\s+/g, ' ').trim();
  check('KRITISCH: eine gekuerzte Liste sagt es -- "3 von 31"', note === '3 von 31');
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
      pro_mitarbeiter: [], letzte_rapporte: [], ereignisse: EREIGNISSE, ereignisse_gesamt: 3,
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
// im Ereignis-Feed aufgegangen (ENT-090). Die folgenden Pruefungen stammen
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
  // Reihenfolge: neuestes zuerst. Der Feed mischt drei Quellen -- ohne
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

// ══════════ EINE ABLEHNUNG IST KEINE ZUSAGE (ENT-113)
// Der Vergleich lief gegen 'abgesagt' -- diesen Wert kennt meine_zusage.php
// nicht (offen | zugesagt | abgelehnt). Jede Ablehnung stand darum als
// Zusage im Feed: das Gegenteil dessen, was passiert war.
const seiteAbl = await seite({ ereignisse: [...EREIGNISSE, ABLEHNUNG],
                               ereignisse_gesamt: EREIGNISSE.length + 1 });
const abl = await seiteAbl.evaluate(() => {
  const z = [...document.querySelectorAll('#ereignisFeed .erg')]
    .find(r => r.textContent.includes('Urs'));
  return z ? { txt: z.textContent.replace(/\s+/g, ' '), klasse: z.className,
               punkt: (z.querySelector('.dot') || {}).className || '' } : null;
});
check('KRITISCH: eine Ablehnung wird als Ablehnung ausgewiesen',
  abl && abl.txt.includes('HAT ABGELEHNT'));
check('KRITISCH: und nicht mehr als Zusage', abl && !/hat zugesagt/.test(abl.txt));
check('KRITISCH: die Zeile ist hervorgehoben', abl && abl.klasse.includes('erg-abgelehnt'));
check('KRITISCH: ihr Punkt ist nicht grün', abl && abl.punkt.includes('neg'));
// Nach der Zusage-Zeile suchen, nicht nach der Person: Anna steht auch mit
// einem Rapport im Feed, und der traf beim ersten Versuch zuerst zu.
const anna = await seiteAbl.evaluate(() => {
  const z = [...document.querySelectorAll('#ereignisFeed .erg')]
    .find(r => r.textContent.includes('hat zugesagt'));
  return z ? { txt: z.textContent.replace(/\s+/g, ' '), klasse: z.className } : null;
});
check('Die Zusage daneben bleibt unverändert',
  anna && anna.txt.includes('hat zugesagt') && !anna.klasse.includes('erg-abgelehnt'));
await seiteAbl.close();

// ══════════════ VIERTE ART: KUNDENENTSCHEIDUNG ZU EINER OFFERTE (ENT-192/ENT-197)
try {
  const p = await seite({ ereignisse: [OFFERTE_ANGENOMMEN, OFFERTE_ABGELEHNT],
                          ereignisse_gesamt: 2 });
  const zeilen = await p.$$eval('#ereignisFeed .erg', els => els.map(e =>
    ({ txt: e.textContent.replace(/\s+/g, ' '), klasse: e.className,
       punkt: (e.querySelector('.dot') || {}).className || '' })));
  check('KRITISCH: eine angenommene Offerte nennt Nummer und "hat angenommen"',
    /hat angenommen.*OF-0055/.test(zeilen[0]?.txt || ''));
  check('Ihr Punkt ist grün', !zeilen[0]?.punkt.includes('neg') && !zeilen[0]?.punkt.includes('warn'));
  check('KRITISCH: eine abgelehnte Offerte steht als Ablehnung da, nicht als Annahme',
    /HAT ABGELEHNT.*OF-0056/.test(zeilen[1]?.txt || '') && !/hat angenommen/.test(zeilen[1]?.txt || ''));
  check('KRITISCH: die Ablehnung ist hervorgehoben wie eine abgelehnte Schicht',
    zeilen[1]?.klasse.includes('erg-abgelehnt') && zeilen[1]?.punkt.includes('neg'));

  const haken = await p.$$eval('#ereignisFeed .rank', els => els.map(e => !!e.querySelector('.rank-erledigt')));
  check('KRITISCH: auch die Offerten-Art laesst sich abhaken', haken.every(Boolean));

  // Abhaken zuerst -- der Weg "Zur Offerte" verlaesst die Uebersicht danach,
  // und #ereignisFeed ist ab dann nicht mehr sichtbar.
  gesendet.length = 0;
  await p.click('#ereignisFeed .rank >> nth=1 >> .rank-erledigt'); await p.waitForTimeout(300);
  check('KRITISCH: das Abhaken einer Offerte schickt typ und id',
    gesendet.length === 1 && gesendet[0].typ === 'offerte' && gesendet[0].id === 56);

  await p.click('#ereignisFeed .rank >> nth=0'); await p.waitForTimeout(250);
  const detail = (await p.textContent('#ergDetail0')).replace(/\s+/g, ' ');
  check('Das Aufklappen nennt die Offertennummer', /Offerte.*OF-0055/.test(detail));
  const wege = await p.$$eval('#ergDetail0 .erg-wege .btn', b => b.map(x => x.textContent.trim()));
  check('KRITISCH: der Weg "Zur Offerte" ist da', wege.includes('Zur Offerte'));
  await p.click('#ergDetail0 .erg-wege .btn:has-text("Zur Offerte")'); await p.waitForTimeout(400);
  check('KRITISCH: er fuehrt wirklich zur richtigen Offerte',
    (await p.inputValue('#of_nummer')) === 'OF-0055');
  await p.close();
} catch (e) { bad.push('Offerte-Ereignis: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════ GLOCKE (ENT-197)
try {
  const p = await seite();
  check('Die Glocke zeigt die Gesamtzahl als Zaehler',
    (await p.textContent('#glockeBadge')).trim() === '3');
  check('Das Dropdown ist zu Beginn geschlossen',
    (await p.evaluate(() => getComputedStyle(document.getElementById('glockePanel')).display)) === 'none');

  await p.click('#btnGlocke'); await p.waitForTimeout(200);
  check('KRITISCH: ein Klick oeffnet das Dropdown',
    (await p.evaluate(() => getComputedStyle(document.getElementById('glockePanel')).display)) !== 'none');
  check('KRITISCH: es zeigt dieselbe Anzahl Zeilen wie die Uebersicht',
    (await p.$$('#glockeListe .glocke-row')).length === 3);

  // Daneben klicken schliesst es wieder (dasselbe Muster wie die Seitenleiste).
  await p.click('#pgTitle'); await p.waitForTimeout(200);
  check('KRITISCH: ein Klick daneben schliesst das Dropdown',
    (await p.evaluate(() => getComputedStyle(document.getElementById('glockePanel')).display)) === 'none');

  await p.click('#btnGlocke'); await p.waitForTimeout(200);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  check('Escape schliesst es ebenfalls',
    (await p.evaluate(() => getComputedStyle(document.getElementById('glockePanel')).display)) === 'none');

  // Ein Klick auf eine Zeile springt zur Uebersicht und klappt sie dort auf --
  // dieselbe Liste, zwei Ansichten, keine zweite Detailanzeige.
  await p.click('#nav-planung'); await p.waitForTimeout(200);
  await p.click('#btnGlocke'); await p.waitForTimeout(150);
  await p.click('#glockeListe .glocke-row >> nth=0'); await p.waitForTimeout(300);
  check('KRITISCH: ein Klick auf eine Zeile fuehrt zur Uebersicht',
    (await p.textContent('#pgTitle')) === 'Übersicht');
  check('Und klappt dort dieselbe Zeile auf', await p.isVisible('#ergDetail0'));
  check('Das Dropdown ist danach zu',
    (await p.evaluate(() => getComputedStyle(document.getElementById('glockePanel')).display)) === 'none');

  // Abhaken direkt aus dem Dropdown, ohne es vorher zu verlassen.
  await p.click('#btnGlocke'); await p.waitForTimeout(150);
  gesendet.length = 0;
  await p.click('#glockeListe .glocke-row >> nth=0 >> .rank-erledigt'); await p.waitForTimeout(300);
  check('KRITISCH: das Abhaken aus dem Dropdown sendet Art und Nummer',
    gesendet.length === 1 && gesendet[0].typ === 'rapport' && gesendet[0].id === 7);
  check('KRITISCH: der Zaehler sinkt sofort mit',
    (await p.textContent('#glockeBadge')).trim() === '2');
  check('Und die Zeile verschwindet auch aus dem Dropdown',
    (await p.$$('#glockeListe .glocke-row')).length === 2);
  await p.close();
} catch (e) { bad.push('Glocke: ' + String(e).split('\n')[0].slice(0, 120)); }

// Ohne Ereignisse bleibt der Zaehler versteckt -- eine "0" waere eine Zahl
// ohne Aussage, kein Hinweis auf etwas Ungesehenes.
try {
  const p = await seite({ ereignisse: [], ereignisse_gesamt: 0 });
  check('KRITISCH: der Zaehler ist ohne Ereignisse unsichtbar',
    (await p.evaluate(() => getComputedStyle(document.getElementById('glockeBadge')).display)) === 'none');
  await p.click('#btnGlocke'); await p.waitForTimeout(150);
  check('Das Dropdown sagt, dass nichts Neues da ist',
    (await p.textContent('#glockeListe')).includes('Nichts Neues'));
  await p.close();
} catch (e) { bad.push('Glocke leer: ' + String(e).split('\n')[0].slice(0, 120)); }

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
