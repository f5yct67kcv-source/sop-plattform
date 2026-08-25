import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const HEUTE = tag(0), GESTERN = tag(-1), MORGEN = tag(1);

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Eine Nachtschicht von gestern, die jetzt gerade noch laeuft: sie beginnt vor
// einer Stunde und endet in einer Stunde. Damit liegt der Beginn moeglicherweise
// schon auf gestern -- genau der Fall, den "Heute" abdecken muss.
const jetzt = new Date();
const beginn = new Date(jetzt.getTime() - 3600e3), ende = new Date(jetzt.getTime() + 3600e3);
const hm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':00';
const LAUF_DATUM = iso(beginn);

const SCHICHTEN = () => ({ status: 'ok', von: GESTERN, bis: tag(90), schichten: [
  { id: 41, kunde_name: 'Einwohnergemeinde Niedergösgen', titel: 'Revierdienst Nacht',
    strasse: 'Sehr Lange Hauptstrasse 44', ort: '4632 Trimbach', einsatzart: 'Revierdienst',
    datum: LAUF_DATUM, von: hm(beginn), bis: hm(ende), status: 'geplant', bemerkung: 'Schluessel beim Hauswart',
    zusage: 'offen', objekt_name: 'Einkaufszentrum Nord West', im_team: 2,
    // ENT-115: Angaben, die vor Ort gebraucht werden.
    kanton: 'SO', treffpunkt: 'Haupteingang Nord', taetigkeit: 'Rundgang alle zwei Stunden',
    qualifikation: 'Revierdienstausweis',
    kontakt_vorname: 'Petra', kontakt_nachname: 'Muster', kontakt_telefon: '079 111 22 33' },
  { id: 42, kunde_name: 'Einwohnergemeinde Niedergösgen', titel: 'Baustelle Kreiselumfahrung',
    strasse: 'Dorfstrasse 1', ort: '5013 Niedergösgen', einsatzart: 'Verkehrsdienst',
    datum: MORGEN, von: '07:30:00', bis: '16:30:00', status: 'bestaetigt', bemerkung: null,
    zusage: 'zugesagt', objekt_name: null, im_team: 1 },
  { id: 43, kunde_name: 'Einwohnergemeinde Niedergösgen', titel: 'Schliessrunde',
    strasse: null, ort: '4632 Trimbach', einsatzart: 'Revierdienst',
    datum: tag(2), von: '22:00:00', bis: '05:30:00', status: 'provisorisch', bemerkung: null,
    zusage: 'offen', objekt_name: 'Einkaufszentrum Nord West', im_team: 1 },
  { id: 44, kunde_name: 'Einwohnergemeinde Niedergösgen', titel: 'Abgesagter Einsatz',
    strasse: null, ort: '5013 Niedergösgen', einsatzart: 'Verkehrsdienst',
    datum: tag(3), von: '08:00:00', bis: '12:00:00', status: 'abgesagt', bemerkung: null,
    zusage: 'offen', objekt_name: null, im_team: 1 }]});

const PROFIL = { status: 'ok', monat: { anzahl: 3, stunden: 22.5 }, profil: {
  name: 'daniele.ciardo', ist_admin: false, personalnummer: 'P-014', anrede: 'Herr',
  vorname: 'Daniele', nachname: 'Ciardo', geburtsdatum: '1988-04-12', strasse: 'Musterweg 3',
  ort: '4600 Olten', telefon: null, mobil: '079 000 00 00', email: 'd@example.ch',
  erstellt_am: '2026-01-04 10:00:00' }};

const RAP = { status: 'ok', rapporte: [{ id: 1, datum: GESTERN, mitarbeiter: 'daniele.ciardo',
  kunde: 'Einwohnergemeinde Niedergösgen', strasse: 'Dorfstrasse 1', ort: '5013 Niedergösgen',
  auftrag_nr: 'A-118', einsatzart: 'Verkehrsdienst', von: '07:00:00', bis: '16:00:00',
  pause_min: 30, netto_h: '8.50', unterzeichner: 'R. Muster', unterschrift: null,
  bemerkung: null, erfasst_am: GESTERN + ' 16:12:00' }]};

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

let schichtenDaten = SCHICHTEN();
const rufe = [];           // welche Endpunkte mit welchem Rumpf aufgerufen wurden
let zusageAntwort = null;  // erlaubt es, eine Fehlerantwort zu erzwingen
let passwortAntwort = null;

await page.route('**/api/**', route => {
  const req = route.request();
  const p = req.url().split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { body = req.postData(); }
  rufe.push({ p, body });
  const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'daniele.ciardo', ist_admin: false });
  if (p.includes('meine_schichten')) return send(schichtenDaten);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send(RAP);
  if (p.includes('meine_zusage')) return zusageAntwort
    ? send(zusageAntwort[0], zusageAntwort[1])
    : send({ status: 'ok', zusage: body && body.zusage });
  if (p.includes('mein_passwort')) return passwortAntwort
    ? send(passwortAntwort[0], passwortAntwort[1])
    : send({ status: 'ok' });
  return send({ status: 'ok' });
});

const T = s => page.textContent(s).then(x => (x || '').trim());
const sicht = () => page.evaluate(() => document.querySelector('.v.on').id);

// ══════════════ ANMELDUNG
await page.goto(`file://${WURZEL}/app.html`);
check('Anmeldung wird zuerst gezeigt', await page.isVisible('#gate'));
check('App ist vor der Anmeldung verborgen', !(await page.isVisible('#v-heute')));

// Deutsch ist seit ENT-028 die einzige Sprache
check('Kein Sprachumschalter mehr', await page.evaluate(() => !document.getElementById('spSq')));
check('Die Anmeldung ist deutsch beschriftet', (await T('#lb-pass')) === 'Passwort');

// Leere Eingabe wird abgefangen, ohne die Schnittstelle zu belasten
await page.click('#gBtn');
await page.waitForTimeout(120);
check('Leere Anmeldung meldet einen Fehler', await page.isVisible('#gErr'));
check('Leere Anmeldung ruft die Schnittstelle nicht', !rufe.some(r => r.p.includes('login')));

await page.fill('#gName', 'daniele.ciardo');
await page.fill('#gPass', 'geheim');
await page.click('#gBtn');
await page.waitForSelector('#app.on');
await page.waitForTimeout(400);
check('Nach der Anmeldung ist die App sichtbar', await page.isVisible('#v-heute'));
check('Anmeldemaske ist weg', !(await page.isVisible('#gate')));
check('Name steht in der Kopfzeile', (await T('#kName')) === 'daniele.ciardo');
check('Alle drei Datenquellen wurden geladen',
  ['meine_schichten', 'mein_profil', 'rapport_list'].every(e => rufe.some(r => r.p.includes(e))));

// ══════════════ HEUTE
const heuteText = await T('#v-heute');
check('Laufende Schicht steht unter Heute', heuteText.includes('Revierdienst Nacht'));
check('Laufende Schicht ist als laufend markiert', heuteText.toLowerCase().includes('läuft'));
check('Heute zeigt den Arbeitsort', heuteText.includes('4632 Trimbach'));
check('Heute zeigt die Teamgroesse', /2\s/.test(heuteText) && heuteText.includes('Team'));
check('Morgen gehoert nicht zu Heute', !heuteText.includes('Baustelle Kreiselumfahrung'));
const karten = await page.evaluate(() => document.querySelectorAll('#v-heute .schicht').length);
check('Genau eine Schichtkarte unter Heute', karten === 1);

// ══════════════ PLAN
await page.click('#t-plan');
await page.waitForTimeout(200);
check('Plan ist die aktive Ansicht', (await sicht()) === 'v-plan');
check('Plan-Reiter ist markiert', await page.evaluate(() => document.getElementById('t-plan').classList.contains('on')));
const planText = await T('#v-plan');
check('Plan zeigt die kommende Schicht', planText.includes('Baustelle Kreiselumfahrung'));
check('Plan zeigt die Schicht auf Abruf', planText.includes('Auf Abruf'));
check('Plan zeigt die abgesagte Schicht', planText.includes('Abgesagter Einsatz'));
const koepfe = await page.evaluate(() => [...document.querySelectorAll('#v-plan .tag-kopf')].length);
check('Plan gruppiert nach Tagen', koepfe >= 3);
check('Abgesagte Schicht zaehlt nicht als Schicht des Tages',
  !/Abgesagter Einsatz[\s\S]*?1 Schicht/.test(planText));

// ══════════════ BLATT + ZUSAGE
await page.click('#v-plan .schicht[onclick="blattAuf(42)"]');
await page.waitForTimeout(250);
check('Blatt geht auf', await page.evaluate(() => document.getElementById('blatt').classList.contains('on')));
check('Blatt zeigt den Titel', (await T('#blTitel')) === 'Baustelle Kreiselumfahrung');
const blText = await T('#blBody');
check('Blatt zeigt Kunde und Ort', blText.includes('Niedergösgen'));
check('Blatt zeigt die Einsatzart', blText.includes('Verkehrsdienst'));

// Knoepfe im Fussbereich ueber ihre Beschriftung treffen, nicht ueber eine
// Klasse: Nach ENT-120 ist ".btn-plain" mal "Ablehnen" und mal "Antwort
// ändern". Und ein fehlender Knopf muss eine ROTE PRUEFUNG geben statt die
// Suite abzubrechen -- ein Abbruch sieht im Sammellauf aus wie ein Fehler im
// Pruefwerkzeug, nicht wie einer im Produkt. Genau das ist in einer
// Gegenprobe passiert.
const fussKlick = (name, beschriftung) => page.evaluate(t => {
  const b = [...document.querySelectorAll('#blFuss button')]
    .find(x => x.textContent.trim().includes(t));
  if (!b) { return false; }
  b.click();
  return true;
}, beschriftung).then(g => { check(name, g); return g; });

// ── Eine bereits beantwortete Schicht verlangt die Antwort nicht noch einmal
//    (ENT-120). Schicht 42 steht in den Testdaten auf "zugesagt".
const fussJa = await T('#blFuss');
check('KRITISCH: eine beantwortete Schicht zeigt keine Zusagen/Ablehnen-Knoepfe mehr',
  !/Zusagen|Ablehnen/.test(fussJa));
check('KRITISCH: stattdessen steht da, was beantwortet wurde', /Du hast zugesagt/.test(fussJa));
check('Die Marke sagt es auch kurz',
  await page.evaluate(() => !!document.querySelector('#blFuss .ft-stand .m-p')));
check('KRITISCH: die Antwort laesst sich aendern — ein Fehlgriff auf dem Telefon darf nicht endgueltig sein',
  /Antwort ändern/.test(fussJa));
check('Der Knopf zum Aendern wird nicht ueber die volle Breite gezogen',
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#blFuss .btn')].find(x => /ändern/.test(x.textContent));
    return !!b && b.getBoundingClientRect().width
      < document.getElementById('blFuss').getBoundingClientRect().width * 0.8;
  }));
check('Beide Knoepfe halten die Trefferflaeche von 44 px ein',
  await page.evaluate(() => [...document.querySelectorAll('#blFuss .btn')]
    .every(b => b.getBoundingClientRect().height >= 44)));

// Eine noch nicht beantwortete Schicht bekommt sehr wohl beide Knoepfe.
await page.evaluate(() => blattZu());
await page.evaluate(() => blattAuf(43));
await page.waitForTimeout(250);
const fussOffen = await T('#blFuss');
check('KRITISCH: eine unbeantwortete Schicht fragt weiterhin',
  /Zusagen/.test(fussOffen) && /Ablehnen/.test(fussOffen) && !/Antwort ändern/.test(fussOffen));
await page.evaluate(() => blattZu());

// Blatt vorsichtshalber schliessen: Liegt es noch offen, faengt es den Klick
// auf die Liste ab, und aus einer roten Pruefung wird eine
// Zeitueberschreitung, die die ganze Suite abbricht.
await page.evaluate(() => blattZu());
await page.waitForTimeout(150);
await page.click('#v-plan .schicht[onclick="blattAuf(42)"]');
await page.waitForTimeout(250);
const vorher = rufe.filter(r => r.p.includes('meine_zusage')).length;
// Nicht "es wurde nichts gesendet" pruefen -- das waere hier leer erfuellbar,
// weil niemand geklickt hat. Gemeint ist: Es gibt gar keinen Knopf, der eine
// Rueckmeldung ausloesen koennte, solange die Antwort nicht geoeffnet wurde.
check('KRITISCH: solange die Antwort steht, gibt es keinen Knopf, der sie ueberschreibt',
  await page.evaluate(() => [...document.querySelectorAll('#blFuss button')]
    .every(b => !/melden\(/.test(b.getAttribute('onclick') || ''))));
await page.evaluate(() => antwortAendern());
await page.waitForTimeout(200);
check('KRITISCH: nach "Antwort ändern" stehen beide Knoepfe wieder da',
  /Zusagen/.test(await T('#blFuss')) && /Ablehnen/.test(await T('#blFuss')));
await fussKlick('Der Ablehnen-Knopf ist da und lässt sich drücken', 'Ablehnen');
await page.waitForTimeout(300);
const zRufe = rufe.filter(r => r.p.includes('meine_zusage'));
// Ueber einen leeren Ruf stolpern statt ihn zu pruefen waere ein Abbruch der
// ganzen Suite -- und ein Abbruch sieht im Sammellauf aus wie ein Fehler im
// Pruefwerkzeug, nicht wie einer im Produkt.
const letzterZ = (zRufe.at(-1) || {}).body || {};
check('Rueckmeldung wird genau einmal gesendet', zRufe.length === vorher + 1);
check('Rueckmeldung sendet die richtige Schicht', letzterZ.einsatz_id === 42);
check('Rueckmeldung sendet den richtigen Wert', letzterZ.zusage === 'abgelehnt');
check('Blatt schliesst nach der Rueckmeldung',
  !(await page.evaluate(() => document.getElementById('blatt').classList.contains('on'))));
check('Liste zeigt die Ablehnung sofort', (await T('#v-plan')).includes('Abgelehnt'));

// Beim naechsten Oeffnen ist der geaenderte Stand da -- und wieder zugeklappt.
await page.evaluate(() => blattZu());
await page.waitForTimeout(150);
await page.click('#v-plan .schicht[onclick="blattAuf(42)"]');
await page.waitForTimeout(250);
const fussNein = await T('#blFuss');
check('KRITISCH: die geaenderte Antwort steht beim naechsten Oeffnen da',
  /Du hast abgelehnt/.test(fussNein));
check('KRITISCH: "Antwort ändern" wirkt nur fuer dieses eine Oeffnen',
  !/Zusagen|Ablehnen/.test(fussNein));
check('Die Marke der Ablehnung ist die negative',
  await page.evaluate(() => !!document.querySelector('#blFuss .ft-stand .m-x')));

// Ein Fehler der Schnittstelle darf die Anzeige nicht faelschen
zusageAntwort = [{ status: 'error', message: 'Diese Schicht gehoert nicht zu dir' }, 404];
await page.evaluate(() => antwortAendern());
await page.waitForTimeout(200);
await fussKlick('Der Zusagen-Knopf ist da und lässt sich drücken', 'Zusagen');
await page.waitForTimeout(300);
check('Fehler der Schnittstelle wird gemeldet',
  await page.evaluate(() => document.getElementById('toast').classList.contains('on')));
check('Ablehnung bleibt nach dem Fehler bestehen', (await T('#v-plan')).includes('Abgelehnt'));
zusageAntwort = null;
await page.evaluate(() => blattZu());

// Bei einer abgesagten Schicht gibt es nichts zurueckzumelden
await page.evaluate(() => blattAuf(44));
await page.waitForTimeout(200);
const fussAb = await T('#blFuss');
check('Abgesagte Schicht bietet keine Rueckmeldung', !/Zusagen|Ablehnen/.test(fussAb));
check('Abgesagte Schicht wird erklaert', (await T('#blBody')).length > 0);
await page.evaluate(() => blattZu());

// ══════════════ RAPPORT
await page.click('#t-rapport');
await page.waitForTimeout(200);
const rapText = await T('#v-rapport');
// Seit ENT-049 steht im Rapport-Reiter KEINE Stundensumme mehr: massgeblich
// ist die abgeglichene Zeit unter Profil > Meine Stunden. Zwei Zahlen fuer
// denselben Monat waeren fuer Mitarbeitende nicht aufloesbar gewesen.
check('KRITISCH: keine konkurrierende Stundensumme mehr im Rapport-Reiter (ENT-049)',
  (await page.$$('#v-rapport .zahlen')).length === 0);
check('Rapport listet den bestehenden Rapport', rapText.includes('8.50') || rapText.includes('8.5'));
check('Rapport verweist auf die Erfassung',
  await page.evaluate(() => !!document.querySelector('#v-rapport a[href="index.html"]')));
check('Kein Diktat im Rapport-Bereich', !/[Dd]iktat|[Mm]ikrofon/.test(await page.innerHTML('#v-rapport')));

// ══════════════ PROFIL
await page.click('#t-profil');
await page.waitForTimeout(200);
const proText = await T('#v-profil');
check('Profil zeigt den vollen Namen', proText.includes('Daniele Ciardo'));
check('Profil zeigt die Personalnummer', proText.includes('P-014'));
check('Profil zeigt die Adresse', proText.includes('4600 Olten'));
check('Profil zeigt leere Felder nicht an', !proText.includes('Telefon'));
check('Profil ist nur lesend',
  await page.evaluate(() => document.querySelectorAll('#v-profil input, #v-profil textarea').length === 0));
check('Profil erklaert, wie Daten geaendert werden', proText.length > 100);
check('Nicht-Admin sieht keinen Cockpit-Verweis',
  await page.evaluate(() => !document.querySelector('#v-profil a[href="dashboard.html"]')));

// ══════════════ PASSWORT
await page.click('#v-profil button[onclick="passwortBlatt()"]');
await page.waitForTimeout(250);
check('Passwortblatt geht auf', await page.isVisible('#pwAlt'));
check('Passwortblatt fragt das bisherige Passwort', await page.isVisible('#pwAlt'));
await page.fill('#pwNeu', '123');
await page.click('#pwBtn');
await page.waitForTimeout(200);
check('Zu kurzes Passwort wird abgefangen', await page.isVisible('#pwErr'));
check('Zu kurzes Passwort wird nicht gesendet', !rufe.some(r => r.p.includes('mein_passwort')));
await page.fill('#pwAlt', 'geheim');
await page.fill('#pwNeu', 'neuesGeheim');
await page.click('#pwBtn');
await page.waitForTimeout(300);
const pw = rufe.filter(r => r.p.includes('mein_passwort'));
check('Passwortwechsel wird gesendet', pw.length === 1);
check('Passwortwechsel sendet beide Passwoerter',
  pw.length === 1 && pw[0].body.alt === 'geheim' && pw[0].body.neu === 'neuesGeheim');
check('Blatt schliesst nach dem Passwortwechsel',
  !(await page.evaluate(() => document.getElementById('blatt').classList.contains('on'))));

// Falsches altes Passwort: Meldung bleibt im Blatt stehen
passwortAntwort = [{ status: 'error', message: 'Das bisherige Passwort stimmt nicht' }, 401];
await page.click('#v-profil button[onclick="passwortBlatt()"]');
await page.waitForTimeout(200);
await page.fill('#pwAlt', 'falsch');
await page.fill('#pwNeu', 'neuesGeheim');
await page.click('#pwBtn');
await page.waitForTimeout(300);
check('Falsches altes Passwort wird gemeldet',
  (await T('#pwErr')).includes('bisherige Passwort'));
check('Blatt bleibt bei falschem Passwort offen',
  await page.evaluate(() => document.getElementById('blatt').classList.contains('on')));
passwortAntwort = null;
await page.evaluate(() => blattZu());

// ══════════════ KEINE SPRACHUMSCHALTUNG MEHR
check('Kein albanischer Text mehr in der App',
  await page.evaluate(() => !/Shqip|Punonjës|Raporti|Turni|Klienti/.test(document.body.innerHTML)));
check('Das Profil hat keinen Sprachbereich mehr',
  !(await T('#v-profil')).includes('Sprache'));
check('Fünf Reiter unten',
  await page.evaluate(() => document.querySelectorAll('.tabs button').length === 5));

// ══════════════ LEERER ZUSTAND
schichtenDaten = { status: 'ok', von: GESTERN, bis: tag(90), schichten: [] };
await page.evaluate(() => allesLaden());
await page.waitForTimeout(400);
await page.click('#t-heute');
await page.waitForTimeout(200);
check('Ohne Schichten bleibt Heute verstaendlich', (await T('#v-heute')).length > 20);
check('Ohne Schichten keine leere Karte', await page.evaluate(() => document.querySelectorAll('#v-heute .schicht').length === 0));
await page.click('#t-plan');
await page.waitForTimeout(200);
check('Ohne Schichten bleibt der Plan verstaendlich', (await T('#v-plan')).length > 20);
schichtenDaten = SCHICHTEN();
await page.evaluate(() => allesLaden());
await page.waitForTimeout(400);

// ══════════════ NACHTSCHICHT ueber Mitternacht
await page.click('#t-plan');
await page.waitForTimeout(200);
check('Nachtschicht wird als Folgetag gekennzeichnet',
  /Folgetag|\+1/.test(await page.innerHTML('#v-plan')));

// ══════════════ MOBIL: kein waagrechtes Schieben
const messen = () => page.evaluate(() => {
  const d = document.documentElement, ueber = [];
  const scrollbar = el => {
    for (let p = el.parentElement; p && p !== d; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
    }
    return false;
  };
  document.querySelectorAll('.app *, .blatt *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.right > window.innerWidth + 1 && !scrollbar(el)) {
      ueber.push((el.id ? '#' + el.id : el.className || el.tagName) + ' bis ' + Math.round(r.right));
    }
  });
  return { scroll: d.scrollWidth - d.clientWidth, ueber: ueber.slice(0, 4) };
});
for (const breite of [320, 360, 390, 414]) {
  await page.setViewportSize({ width: breite, height: 844 });
  for (const [name, id] of [['Heute', 't-heute'], ['Plan', 't-plan'], ['Rapport', 't-rapport'], ['Profil', 't-profil']]) {
    await page.click('#' + id);
    await page.waitForTimeout(160);
    const m = await messen();
    check(`Kein Seiten-Scroll – ${name} @${breite}`, m.scroll <= 1);
    check(`Nichts ragt heraus – ${name} @${breite}`, m.ueber.length === 0);
    if (m.ueber.length) bad.push(`   ↳ ${name} @${breite}: ${m.ueber.join(' | ')}`);
  }
}
// Auch mit offenem Blatt und langen Angaben
await page.setViewportSize({ width: 320, height: 844 });
await page.click('#t-plan'); await page.waitForTimeout(150);
await page.evaluate(() => blattAuf(41));
await page.waitForTimeout(250);
const mBlatt = await messen();
check('Kein Seiten-Scroll – offenes Blatt @320', mBlatt.scroll <= 1);
check('Nichts ragt heraus – offenes Blatt @320', mBlatt.ueber.length === 0);
if (mBlatt.ueber.length) bad.push('   ↳ Blatt @320: ' + mBlatt.ueber.join(' | '));
check('Blatt zeigt die Bemerkung', (await T('#blBody')).includes('Hauswart'));

// ══════════ ANGABEN FÜR VOR ORT (ENT-115)
// Sie werden in der Verwaltung erfasst und nützen nur, wenn sie hier ankommen.
const blatt = await T('#blBody');
check('KRITISCH: der Treffpunkt steht in der App', blatt.includes('Haupteingang Nord'));
check('KRITISCH: die Ansprechperson vor Ort steht in der App', blatt.includes('Petra Muster'));
check('Die Tätigkeit steht in der App', blatt.includes('Rundgang alle zwei Stunden'));
check('Die Qualifikation steht in der App', blatt.includes('Revierdienstausweis'));
check('Der Kanton steht beim Arbeitsort', blatt.includes('SO'));
// Auf dem Handy muss die Nummer wählbar sein -- ein Fliesstext ist sie nicht.
check('KRITISCH: die Telefonnummer ist wählbar hinterlegt',
  await page.evaluate(() => {
    const a = document.querySelector('#blBody a[href^="tel:"]');
    return !!a && a.getAttribute('href').replace('tel:', '').replace(/\D/g, '') === '0791112233';
  }));
await page.evaluate(() => blattZu());

// ══════════════ TIPPFLAECHEN
await page.setViewportSize({ width: 390, height: 844 });
const klein = await page.evaluate(() => {
  const zu = [];
  document.querySelectorAll('.app button, .app a.btn').forEach(b => {
    const r = b.getBoundingClientRect();
    if (r.height > 0 && r.height < 40) zu.push((b.id || b.className) + ' ' + Math.round(r.height));
  });
  return zu;
});
check('Alle Schaltflaechen sind mit dem Daumen bedienbar', klein.length === 0);
if (klein.length) bad.push('   ↳ zu klein: ' + klein.join(' | '));

// ══════════════ ABMELDEN
await page.click('#t-profil'); await page.waitForTimeout(200);
await page.evaluate(() => { localStorage.setItem('rv3_token', 'x'); });
await page.evaluate(() => { window.__reload = false; });
check('Abmelden ist erreichbar',
  await page.evaluate(() => [...document.querySelectorAll('#v-profil button')].some(b => /Abmelden/.test(b.textContent))));

await page.screenshot({ path: OUT + '/40-app-profil.png' });
await page.click('#t-heute'); await page.waitForTimeout(250);
await page.screenshot({ path: OUT + '/41-app-heute.png' });
await page.click('#t-plan'); await page.waitForTimeout(250);
await page.screenshot({ path: OUT + '/42-app-plan.png' });
await page.evaluate(() => blattAuf(41)); await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '/43-app-blatt.png' });

// ══════════ DAS ÖFFNEN EINER SCHICHT WIRD QUITTIERT (ENT-113)
// Der Planung soll ein Auge zeigen, dass die Person hineingeschaut hat.
// Gestempelt wird beim Öffnen, nicht beim Laden der Liste.
const vorGesehen = rufe.filter(r => r.p.includes('meine_gesehen')).length;
await page.evaluate(() => blattAuf(42));
await page.waitForTimeout(400);
const gesehenRufe = rufe.filter(r => r.p.includes('meine_gesehen'));
check('KRITISCH: das Öffnen einer Schicht meldet sich zurück', gesehenRufe.length > vorGesehen);
check('KRITISCH: und nennt die Schicht',
  gesehenRufe.some(r => r.body && Number(r.body.einsatz_id) === 42));
check('KRITISCH: die eigene Kennung wird NICHT mitgeschickt — sie kommt aus der Sitzung',
  gesehenRufe.every(r => !r.body || r.body.mitarbeiter_id === undefined));
// Ein zweites Öffnen quittiert nicht noch einmal.
const nachErstem = rufe.filter(r => r.p.includes('meine_gesehen')).length;
await page.evaluate(() => { blattZu(); });
await page.waitForTimeout(200);
await page.evaluate(() => blattAuf(42));
await page.waitForTimeout(400);
check('Ein zweites Öffnen meldet sich nicht erneut',
  rufe.filter(r => r.p.includes('meine_gesehen')).length === nachErstem);

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
