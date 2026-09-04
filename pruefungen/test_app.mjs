import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

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

// ENT-134: ein Tag, der eindeutig VOR heute liegt, aber noch im laufenden
// Monat -- gibt es ihn nicht (heute ist der Monatserste), entfaellt der
// betroffene Testfall weiter unten, statt einen falschen Tag zu erfinden.
const gesternDatum = new Date(jetzt.getTime() - 864e5);
const frueherImMonat = gesternDatum.getMonth() === jetzt.getMonth() ? GESTERN : null;

// Ein Tag sicher im VORHERGEHENDEN Kalendermonat -- der 15. reicht, unabhaengig
// von der Laenge des laufenden Monats.
const VORMONAT = iso(new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 15));

// Fuer die Zwei-Stunden-Schwelle der Ueberfaellig-Warnung: vor ueber 2 Std.
// zu Ende ist ueberfaellig, vor weniger als 2 Std. noch nicht.
const vorEinerStunde = new Date(jetzt.getTime() - 3600e3);
const vorZweiStunden = new Date(jetzt.getTime() - 2 * 3600e3);

const SCHICHTEN = () => ({ status: 'ok', von: GESTERN, bis: tag(90), schichten: [
  { id: 41, kunde_name: 'Einwohnergemeinde Musterdorf', titel: 'Revierdienst Nacht',
    strasse: 'Sehr Lange Hauptstrasse 44', ort: '4632 Trimbach', einsatzart: 'Revierdienst',
    datum: LAUF_DATUM, von: hm(beginn), bis: hm(ende), status: 'geplant', bemerkung: 'Schluessel beim Hauswart',
    zusage: 'offen', objekt_name: 'Einkaufszentrum Nord West', im_team: 3,
    // ENT-121: die Namen der Eingeteilten -- und NUR die Namen.
    team: [{ name: 'Dario Beispiel', bin_ich: true },
           { name: 'Berta Beispiel', bin_ich: false },
           { name: 'Carlo Muster', bin_ich: false }],
    // ENT-115: Angaben, die vor Ort gebraucht werden.
    kanton: 'SO', treffpunkt: 'Haupteingang Nord', taetigkeit: 'Rundgang alle zwei Stunden',
    qualifikation: 'Revierdienstausweis',
    kontakt_vorname: 'Petra', kontakt_nachname: 'Muster', kontakt_telefon: '079 111 22 33' },
  { id: 42, kunde_name: 'Einwohnergemeinde Musterdorf', titel: 'Baustelle Kreiselumfahrung',
    strasse: 'Dorfstrasse 1', ort: '5013 Musterdorf', einsatzart: 'Verkehrsdienst',
    datum: MORGEN, von: '07:30:00', bis: '16:30:00', status: 'bestaetigt', bemerkung: null,
    zusage: 'zugesagt', objekt_name: null, im_team: 1,
    team: [{ name: 'Dario Beispiel', bin_ich: true }] },
  { id: 43, kunde_name: 'Einwohnergemeinde Musterdorf', titel: 'Schliessrunde',
    strasse: null, ort: '4632 Trimbach', einsatzart: 'Revierdienst',
    datum: tag(2), von: '22:00:00', bis: '05:30:00', status: 'provisorisch', bemerkung: null,
    zusage: 'offen', objekt_name: 'Einkaufszentrum Nord West', im_team: 1 },
  { id: 44, kunde_name: 'Einwohnergemeinde Musterdorf', titel: 'Abgesagter Einsatz',
    strasse: null, ort: '5013 Musterdorf', einsatzart: 'Verkehrsdienst',
    datum: tag(3), von: '08:00:00', bis: '12:00:00', status: 'abgesagt', bemerkung: null,
    zusage: 'offen', objekt_name: null, im_team: 1 },
  // Anzahl sagt 2, aber es kommt keine Namensliste -- so antwortet ein Server,
  // der die Erweiterung aus ENT-121 noch nicht hat. Die App darf dann KEINEN
  // Aufklapper zeigen, der nichts aufklappt. Bewusst zuunterst angehaengt:
  // Weiter oben eingefuegt verschiebt es die Reihenfolge, an der andere
  // Pruefungen dieser Suite haengen.
  { id: 45, kunde_name: 'Einwohnergemeinde Musterdorf', titel: 'Ohne Namensliste',
    strasse: null, ort: '4632 Trimbach', einsatzart: 'Revierdienst',
    datum: tag(6), von: '06:00:00', bis: '10:00:00', status: 'geplant', bemerkung: null,
    zusage: 'offen', objekt_name: null, im_team: 2, team: [] },
  // ENT-128/130: vom Server gesetzt, sobald alle zugesagten Personen
  // rapportiert haben -- app.html fuehrt seine eigene STATUS_MARKE-Kopie und
  // hatte "abgeschlossen" zunaechst vergessen (fiel still auf "Geplant" zurueck).
  { id: 46, kunde_name: 'Cupi24 GmbH', titel: 'Bereits rapportiert',
    strasse: null, ort: '4632 Trimbach', einsatzart: 'Verkehrsdienst',
    datum: HEUTE, von: '08:00:00', bis: '10:00:00', status: 'abgeschlossen', bemerkung: null,
    zusage: 'zugesagt', objekt_name: null, im_team: 1 }]});

const PROFIL = { status: 'ok', monat: { anzahl: 3, stunden: 22.5 }, profil: {
  name: 'dario.beispiel', ist_admin: false, personalnummer: 'P-014', anrede: 'Herr',
  vorname: 'Dario', nachname: 'Beispiel', geburtsdatum: '1988-04-12', strasse: 'Musterweg 3',
  ort: '4600 Olten', telefon: null, mobil: '079 000 00 00', email: 'd@example.ch',
  erstellt_am: '2026-01-04 10:00:00' }};

const RAP = { status: 'ok', rapporte: [{ id: 1, datum: GESTERN, mitarbeiter: 'dario.beispiel',
  kunde: 'Einwohnergemeinde Musterdorf', strasse: 'Dorfstrasse 1', ort: '5013 Musterdorf',
  auftrag_nr: 'A-118', einsatzart: 'Verkehrsdienst', von: '07:00:00', bis: '16:00:00',
  pause_min: 30, netto_h: '8.50', unterzeichner: 'R. Muster', unterschrift: null,
  bemerkung: null, erfasst_am: GESTERN + ' 16:12:00' },
  // Zu Schicht 46 (status 'abgeschlossen'), fuer die Kartenanzeige (ENT-133).
  { id: 2, einsatz_id: 46, datum: GESTERN, mitarbeiter: 'dario.beispiel',
    kunde: 'Cupi24 GmbH', strasse: null, ort: '4632 Trimbach',
    auftrag_nr: null, einsatzart: 'Verkehrsdienst', von: '08:00:00', bis: '10:00:00',
    pause_min: 0, netto_h: '2.00', unterzeichner: null, unterschrift: null,
    bemerkung: null, erfasst_am: GESTERN + ' 15:30:00' }]};

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

let schichtenDaten = SCHICHTEN();
// ENT-134: eine bereits vergangene Schicht des laufenden Monats -- lange
// genug her, dass sie zugleich als "ueberfaellig, nie rapportiert" dient.
if (frueherImMonat) {
  schichtenDaten.schichten.push({ id: 47, kunde_name: 'Cupi24 GmbH', titel: 'Frueher im Monat, nie rapportiert',
    strasse: null, ort: '4632 Trimbach', einsatzart: 'Verkehrsdienst',
    datum: frueherImMonat, von: '08:00:00', bis: '10:00:00', status: 'bestaetigt', bemerkung: null,
    zusage: 'zugesagt', objekt_name: null, im_team: 1 });
}
// Gegenprobe zur Monatsansicht: liegt ausserhalb des laufenden Monats und
// darf im Plan nicht auftauchen.
schichtenDaten.schichten.push({ id: 48, kunde_name: 'Cupi24 GmbH', titel: 'Schicht aus dem Vormonat',
  strasse: null, ort: '4632 Trimbach', einsatzart: 'Verkehrsdienst',
  datum: VORMONAT, von: '08:00:00', bis: '10:00:00', status: 'bestaetigt', bemerkung: null,
  zusage: 'zugesagt', objekt_name: null, im_team: 1 });
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
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'dario.beispiel', ist_admin: false });
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

await page.fill('#gName', 'dario.beispiel');
await page.fill('#gPass', 'geheim');
await page.click('#gBtn');
await page.waitForSelector('#app.on');
await page.waitForTimeout(400);
check('Nach der Anmeldung ist die App sichtbar', await page.isVisible('#v-heute'));
check('Anmeldemaske ist weg', !(await page.isVisible('#gate')));
check('Name steht in der Kopfzeile', (await T('#kName')) === 'dario.beispiel');
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
// Zwei statt einer, seit Schicht 46 (status 'abgeschlossen', ENT-133) HEUTE
// datiert ist -- absichtlich derselbe Tag wie die laufende Schicht, genau
// das Bild aus der gemeldeten Situation (zwei Karten unter Heute, eine davon
// abgeschlossen).
check('Zwei Schichtkarten unter Heute (die laufende und die abgeschlossene)', karten === 2);

// ══════════════ ABGESCHLOSSENE KARTE (ENT-133)
// Auf einen Blick erkennbar: eigene Kartenfarbe, Haken-Abzeichen, und der
// eigene Rapport samt Zeitpunkt -- ohne erst in die Schicht hineinklicken zu
// muessen.
check('KRITISCH: die Karte traegt die Abgeschlossen-Kennzeichnung',
  await page.evaluate(() => !!document.querySelector('#v-heute .karte.abgeschlossen')));
check('KRITISCH: sie zeigt einen Haken',
  await page.evaluate(() => !!document.querySelector('#v-heute .karte.abgeschlossen .karte-haken svg polyline')));
check('KRITISCH: der eigene Rapport samt Zeitpunkt steht auf der Karte',
  await page.evaluate(() => {
    const k = document.querySelector('#v-heute .karte.abgeschlossen');
    return !!k && /Bereits rapportiert am.*15:30/.test(k.textContent);
  }));
check('Eine nicht abgeschlossene Karte traegt die Kennzeichnung NICHT',
  await page.evaluate(() => {
    const alle = [...document.querySelectorAll('#v-heute .karte')];
    return alle.length === 2 && alle.filter(k => k.classList.contains('abgeschlossen')).length === 1;
  }));
// Am gerenderten Zustand gemessen (CLAUDE.md, Gestaltung): Rahmenfarbe und
// Hintergrund muessen sich tatsaechlich vom Regelfall unterscheiden.
check('Die Karte hebt sich farblich vom Regelfall ab',
  await page.evaluate(() => {
    const normal = [...document.querySelectorAll('#v-heute .karte')].find(k => !k.classList.contains('abgeschlossen'));
    const fertig = document.querySelector('#v-heute .karte.abgeschlossen');
    if (!normal || !fertig) return false;
    const a = getComputedStyle(normal), b = getComputedStyle(fertig);
    return a.borderColor !== b.borderColor || a.backgroundColor !== b.backgroundColor;
  }));

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
// Ueber die Struktur pruefen, nicht ueber einen Vorwaertsblick im Text: Der
// alte Ausdruck suchte ab "Abgesagter Einsatz" beliebig weit nach "1 Schicht"
// und wurde rot, sobald IRGENDEIN spaeterer Tag eine Schicht hatte. Gemeint
// ist die Tagesueberschrift, zu der die abgesagte Schicht gehoert.
check('Abgesagte Schicht zaehlt nicht als Schicht des Tages',
  await page.evaluate(() => {
    // Auf der Ebene der direkten Kinder von #plan-inhalt-plan suchen (seit
    // ENT-234 eine Ebene unter #v-plan, wegen des Plan/Sperren-Unterreiters):
    // Dort stehen Tagesueberschrift und Karte als Geschwister. Die
    // Schaltflaeche .schicht liegt eine Ebene tiefer -- von ihr aus gibt es
    // keinen Geschwisterweg zur Ueberschrift.
    const kinder = [...document.getElementById('plan-inhalt-plan').children];
    const i = kinder.findIndex(x => x.textContent.includes('Abgesagter Einsatz')
      && !x.classList.contains('tag-kopf'));
    if (i < 1) { return false; }
    let j = i - 1;
    while (j >= 0 && !kinder[j].classList.contains('tag-kopf')) { j--; }
    return j >= 0 && !/1 Schicht/.test(kinder[j].textContent);
  }));

// ══════════════ MONATSANSICHT + UEBERFAELLIG (ENT-134)
// Bisher zeigte "Plan" nur Schichten ab heute -- eine bereits vergangene
// Schicht des laufenden Monats verschwand daraus, sobald der Tag um war.
if (frueherImMonat) {
  check('Plan zeigt eine bereits vergangene Schicht des laufenden Monats',
    planText.includes('Frueher im Monat, nie rapportiert'));
} else {
  check('Kein Testfall fuer "frueher im Monat" moeglich, weil heute der Monatserste ist', true);
}
check('Plan zeigt KEINE Schicht aus dem Vormonat',
  !planText.includes('Schicht aus dem Vormonat'));

if (frueherImMonat) {
  check('KRITISCH: die ueberfaellige Karte traegt die Ueberfaellig-Kennzeichnung',
    await page.evaluate(() => {
      const k = [...document.querySelectorAll('#v-plan .karte')]
        .find(x => x.textContent.includes('Frueher im Monat, nie rapportiert'));
      return !!k && k.classList.contains('ueberfaellig');
    }));
  check('KRITISCH: sie zeigt das Warnzeichen',
    await page.evaluate(() => {
      const k = [...document.querySelectorAll('#v-plan .karte')]
        .find(x => x.textContent.includes('Frueher im Monat, nie rapportiert'));
      return !!k && !!k.querySelector('.karte-warn');
    }));
  // ENT-135: das Warnzeichen allein sagt nicht, WAS zu tun ist -- ohne Text
  // dazu weiss die eingeteilte Person nicht, worum es geht.
  check('KRITISCH: sie erklaert in Textform, was zu tun ist',
    await page.evaluate(() => {
      const k = [...document.querySelectorAll('#v-plan .karte')]
        .find(x => x.textContent.includes('Frueher im Monat, nie rapportiert'));
      return !!k && k.textContent.includes('Rapport noch ausfüllen');
    }));
  // Am gerenderten Zustand gemessen (CLAUDE.md, Gestaltung).
  check('Die ueberfaellige Karte hebt sich farblich vom Regelfall ab',
    await page.evaluate(() => {
      const alle = [...document.querySelectorAll('#v-plan .karte')];
      const normal = alle.find(k => !k.classList.contains('ueberfaellig') && !k.classList.contains('abgeschlossen'));
      const spaet = alle.find(k => k.classList.contains('ueberfaellig'));
      if (!normal || !spaet) return false;
      const a = getComputedStyle(normal), b = getComputedStyle(spaet);
      return a.borderColor !== b.borderColor || a.backgroundColor !== b.backgroundColor;
    }));
}

// Die Zwei-Stunden-Schwelle selbst, direkt an der Funktion gemessen -- ein
// DOM-Test dafuer haenge von der Testlaufzeit ab (jetzt +/- Sekunden), die
// Funktion selbst nicht.
const zp = await page.evaluate(({ gestern, geradeEbenDatum, geradeEbenVon, geradeEbenBis }) => {
  const laengstVorbei = { id: 9001, einsatzart: 'Verkehrsdienst', zusage: 'zugesagt', status: 'bestaetigt',
    datum: gestern, von: '08:00:00', bis: '10:00:00' };
  const geradeEbenVorbei = { id: 9002, einsatzart: 'Verkehrsdienst', zusage: 'zugesagt', status: 'bestaetigt',
    datum: geradeEbenDatum, von: geradeEbenVon, bis: geradeEbenBis };
  return {
    laengstUeberfaellig: schichtUeberfaellig(laengstVorbei),
    geradeEbenNochNicht: schichtUeberfaellig(geradeEbenVorbei),
    keinVerkehrsdienst: schichtUeberfaellig({ ...laengstVorbei, id: 9003, einsatzart: 'Revierdienst' }),
    nichtZugesagt: schichtUeberfaellig({ ...laengstVorbei, id: 9004, zusage: 'offen' }),
    abgesagt: schichtUeberfaellig({ ...laengstVorbei, id: 9005, status: 'abgesagt' }),
    schonRapportiertFall: schichtUeberfaellig({ ...laengstVorbei, id: 46 }),
  };
}, { gestern: GESTERN, geradeEbenDatum: iso(vorZweiStunden), geradeEbenVon: hm(vorZweiStunden), geradeEbenBis: hm(vorEinerStunde) });
check('KRITISCH: ueberfaellig, wenn seit ueber 2 Std. zu Ende und nicht rapportiert', zp.laengstUeberfaellig);
check('Noch NICHT ueberfaellig, wenn erst vor 1 Std. zu Ende (< 2 Std.)', !zp.geradeEbenNochNicht);
check('Kein Verkehrsdienst -- keine Ueberfaellig-Warnung', !zp.keinVerkehrsdienst);
check('Nicht zugesagt -- keine Ueberfaellig-Warnung', !zp.nichtZugesagt);
check('Abgesagte Schicht -- keine Ueberfaellig-Warnung', !zp.abgesagt);
check('Bereits eigener Rapport vorhanden (Schicht 46) -- keine Ueberfaellig-Warnung', !zp.schonRapportiertFall);

// ══════════════ BLATT + ZUSAGE
await page.click('#v-plan .schicht[onclick="blattAuf(42)"]');
await page.waitForTimeout(250);
check('Blatt geht auf', await page.evaluate(() => document.getElementById('blatt').classList.contains('on')));
check('Blatt zeigt den Titel', (await T('#blTitel')) === 'Baustelle Kreiselumfahrung');
const blText = await T('#blBody');
check('Blatt zeigt Kunde und Ort', blText.includes('Musterdorf'));
check('Blatt zeigt die Einsatzart', blText.includes('Verkehrsdienst'));

// ══════════════ WER SONST EINGETEILT IST (ENT-121)
//
// Bis dahin gab es ausdruecklich nur die Anzahl, keinen Namen -- so stand es
// in ENT-023 und so stand es im Endpunkt. Der Projektinhaber hat das fuer die
// Absprache vor Ort revidiert, und zwar eng: NUR die Namen.
//
// Diese Suite haelt genau diese Grenze. Waechst sie je zu "und die
// Telefonnummer", ist das keine Pruefung, die angepasst werden muss, sondern
// eine Entscheidung, die getroffen werden muss.
const MS = readFileSync(`${WURZEL}/backend/api/meine_schichten.php`, 'utf8');
const teamAbfrage = (MS.match(/SELECT z\.einsatz_id[\s\S]*?ORDER BY[^"]*/) || [''])[0];
check('KRITISCH: der Endpunkt gibt Namen der Eingeteilten heraus',
  /m\.vorname, m\.nachname/.test(teamAbfrage));
check('KRITISCH: aber keine Telefonnummer und keine E-Mail',
  !/telefon|mobil|email/i.test(teamAbfrage));
check('KRITISCH: und keine Personalnummer und keinen Anmeldenamen als Schluessel',
  !/personalnummer/i.test(teamAbfrage));
check('KRITISCH: die mitarbeiter_id fremder Personen geht nicht mit',
  !/'mitarbeiter_id'|\bmitarbeiter_id\b\s*=>/.test(MS.split('$team[$eid][] =')[1] || ''));
check('KRITISCH: der Rueckmeldestand der anderen geht nicht mit',
  !/z\.zusage/.test(teamAbfrage));
check('KRITISCH: die Abfrage laeuft nur ueber die eigenen Einsatznummern',
  /WHERE z\.einsatz_id IN \(\$marken\)/.test(teamAbfrage));
check('Die eigene Person ist als solche gekennzeichnet',
  /z\.mitarbeiter_id = \?\) AS bin_ich/.test(MS));

await page.evaluate(() => blattZu());
await page.waitForTimeout(150);
await page.evaluate(() => blattAuf(41));
await page.waitForTimeout(300);
check('KRITISCH: die Anzahl im Team steht weiterhin da',
  /3 im Team/.test(await T('#blBody')));
check('KRITISCH: die Namen sind zunaechst eingeklappt',
  !(await page.isVisible('#blBody .team-liste')));
check('Aber im Blatt vorhanden',
  await page.evaluate(() => !!document.querySelector('#blBody .team-liste')));
check('KRITISCH: der Aufklapper haelt die Trefferflaeche von 44 px ein',
  await page.evaluate(() => {
    const b = document.querySelector('#blBody .team-auf');
    return !!b && b.getBoundingClientRect().height >= 44;
  }));
// Ein fehlender Aufklapper muss eine ROTE PRUEFUNG geben, nicht die Suite
// abbrechen -- ein Abbruch sieht im Sammellauf aus wie ein Fehler im
// Pruefwerkzeug, nicht wie einer im Produkt.
check('Der Aufklapper ist da und laesst sich druecken',
  await page.evaluate(() => {
    const b = document.querySelector('#blBody .team-auf');
    if (!b) { return false; }
    b.click();
    return true;
  }));
await page.waitForTimeout(250);
check('KRITISCH: aufgeklappt stehen die Namen da',
  await page.isVisible('#blBody .team-liste'));
// Nicht ueber page.textContent holen: Fehlt die Liste, wirft das und bricht
// die ganze Suite ab, statt die Pruefungen darunter rot werden zu lassen.
const teamTxt = await page.evaluate(() => {
  const l = document.querySelector('#blBody .team-liste');
  return l ? l.textContent : '';
});
check('KRITISCH: und zwar alle drei',
  /Dario Beispiel/.test(teamTxt) && /Berta Beispiel/.test(teamTxt) && /Carlo Muster/.test(teamTxt));
check('Die eigene Person ist erkennbar',
  await page.evaluate(() => {
    const ich = document.querySelector('#blBody .team-liste li.ich');
    return !!ich && /Dario Beispiel/.test(ich.textContent) && /du/.test(ich.textContent);
  }));
check('KRITISCH: keine Telefonnummer in der Liste', !/\+41|07\d/.test(teamTxt));
check('Nochmaliges Tippen klappt wieder zu',
  await page.evaluate(() => {
    const b = document.querySelector('#blBody .team-auf');
    const l = document.querySelector('#blBody .team-liste');
    if (!b || !l) { return false; }
    b.click();
    return !l.classList.contains('auf');
  }));

// Allein auf der Schicht: kein Aufklapper, der nichts aufklappt
await page.evaluate(() => blattZu());
await page.waitForTimeout(150);
await page.evaluate(() => blattAuf(42));
await page.waitForTimeout(300);
check('KRITISCH: wer allein eingeteilt ist, bekommt keinen Aufklapper',
  await page.evaluate(() => !document.querySelector('#blBody .team-auf')));

// Anzahl da, Namensliste nicht -- der Fall, den ein Server ohne die
// Erweiterung liefert. Das ist der Fall, der die Absicherung im Code wirklich
// prueft: Bei "allein eingeteilt" faellt die ganze Zeile schon vorher weg,
// dort waere die Pruefung leer erfuellt.
await page.evaluate(() => blattZu());
await page.waitForTimeout(150);
await page.evaluate(() => blattAuf(45));
await page.waitForTimeout(300);
check('KRITISCH: ohne Namensliste steht nur die Anzahl da',
  /2 im Team/.test(await T('#blBody')));
check('KRITISCH: und kein Aufklapper, der nichts aufklappt',
  await page.evaluate(() => !document.querySelector('#blBody .team-auf')
    && !document.querySelector('#blBody .team-liste')));

// ══════════════ DAS BLATT NUTZT DIE VOLLE HOEHE (ENT-121)
const hoehe = await page.evaluate(() => {
  const b = document.getElementById('blatt').getBoundingClientRect();
  const fuss = document.getElementById('blFuss').getBoundingClientRect();
  return { blatt: Math.round(b.height), fenster: window.innerHeight,
           oben: Math.round(b.top), fussUnten: Math.round(fuss.bottom),
           ueberlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
check('KRITISCH: das Blatt nutzt die volle Fensterhoehe',
  hoehe.blatt >= hoehe.fenster - 2);
check('Oben bleibt kein Platz mehr liegen', hoehe.oben <= 1);
check('KRITISCH: der Fussbereich bleibt trotzdem im Bild — die Knoepfe duerfen nicht unter den Rand rutschen',
  hoehe.fussUnten <= hoehe.fenster + 1);
check('Kein Querlauf durch das volle Blatt', hoehe.ueberlauf <= 1);
await page.evaluate(() => blattZu());
await page.waitForTimeout(200);
// Zurueck zu Schicht 42: Die Pruefungen zum Antwortzustand darunter setzen
// voraus, dass genau diese Schicht offen ist.
await page.click('#v-plan .schicht[onclick="blattAuf(42)"]');
await page.waitForTimeout(250);

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

// ══════════════ MENÜ (ENT-234, vormals PROFIL)
await page.click('#t-menu');
await page.waitForTimeout(200);
const menuText = await T('#v-menu');
check('Menü zeigt den vollen Namen', menuText.includes('Dario Beispiel'));
// Seit ENT-370 steht eine dritte Kachel dabei (Abwesenheit) -- die
// Zusicherung gilt weiterhin: mindestens diese beiden sind da, genau die
// bekannten drei insgesamt (nicht "irgendeine Zahl").
check('Menü zeigt die Kacheln Meine Daten/Meine Stunden',
  await page.evaluate(() => !!document.getElementById('mk-daten') && !!document.getElementById('mk-stunden')));
check('Menü zeigt genau drei Kacheln, keine vergessene oder ueberzaehlige',
  await page.evaluate(() => document.querySelectorAll('#v-menu .mk-kachel').length === 3));
await page.evaluate(() => datenSeiteAuf());
await page.waitForTimeout(150);
const datenText = await T('#pr-daten');
check('Meine Daten zeigt die Personalnummer', datenText.includes('P-014'));
check('Meine Daten zeigt die Adresse', datenText.includes('4600 Olten'));
check('Meine Daten zeigt leere Felder nicht an', !datenText.includes('Telefon'));
check('Meine Daten ist nur lesend',
  await page.evaluate(() => document.querySelectorAll('#pr-daten input, #pr-daten textarea').length === 0));
check('Meine Daten erklaert, wie Daten geaendert werden', datenText.length > 100);
await page.evaluate(() => datenSeiteZu());
await page.waitForTimeout(150);
check('Nicht-Admin sieht keinen Cockpit-Verweis',
  await page.evaluate(() => !document.querySelector('#v-menu a[href="dashboard.html"]')));

// ══════════════ PASSWORT
await page.click('#v-menu button[onclick="passwortBlatt()"]');
await page.waitForTimeout(250);
check('Passwortblatt geht auf', await page.isVisible('#pwAlt'));
check('Passwortblatt fragt das bisherige Passwort', await page.isVisible('#pwAlt'));

// Maskierung und Auge (ENT-291), am gerenderten Zustand gemessen. Die App
// laeuft auf dem Handy im Einsatz -- da steht oft jemand daneben.
{
  check('KRITISCH: beide Passwortfelder sind maskiert',
    (await page.getAttribute('#pwAlt', 'type')) === 'password'
    && (await page.getAttribute('#pwNeu', 'type')) === 'password');
  await page.fill('#pwNeu', 'probeweise');
  await page.click('.pw-feld:has(#pwNeu) .pw-toggle');
  check('Das Auge deckt genau EIN Feld auf',
    (await page.getAttribute('#pwNeu', 'type')) === 'text'
    && (await page.getAttribute('#pwAlt', 'type')) === 'password');
  check('Der eingegebene Wert ueberlebt das Umschalten',
    (await page.inputValue('#pwNeu')) === 'probeweise');
  await page.click('.pw-feld:has(#pwNeu) .pw-toggle');
  check('Nochmals tippen verdeckt wieder',
    (await page.getAttribute('#pwNeu', 'type')) === 'password');
  const mass = await page.evaluate(() => {
    const inp = document.getElementById('pwNeu');
    const b = inp.parentElement.querySelector('.pw-toggle').getBoundingClientRect();
    const ri = inp.getBoundingClientRect();
    return { w: b.width, h: b.height,
             polster: parseFloat(getComputedStyle(inp).paddingRight),
             innerhalb: b.right <= ri.right + 1 };
  });
  check(`KRITISCH: Auge mindestens 44 px (gemessen ${Math.round(mass.w)}x${Math.round(mass.h)})`,
    mass.w >= 44 && mass.h >= 44);
  check(`Das Auge verdeckt den Text nicht (Polster ${Math.round(mass.polster)} px >= Knopf ${Math.round(mass.w)} px)`,
    mass.polster >= mass.w && mass.innerhalb);
  await page.fill('#pwNeu', '');
}
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
await page.click('#v-menu button[onclick="passwortBlatt()"]');
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
check('Das Menü hat keinen Sprachbereich mehr',
  !(await T('#v-menu')).includes('Sprache'));
check('Vier sichtbare Reiter unten (kein Revierdienst-Bezug in dieser Suite, ENT-234)',
  await page.evaluate(() => [...document.querySelectorAll('.tabs button')]
    .filter(b => getComputedStyle(b).display !== 'none').length === 4));

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
  for (const [name, id] of [['Heute', 't-heute'], ['Plan', 't-plan'], ['Rapport', 't-rapport'], ['Menü', 't-menu']]) {
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

// ══════════════ STATUS "ABGESCHLOSSEN" (ENT-128/130)
// app.html fuehrt STATUS_MARKE unabhaengig vom Dashboard -- der Fehler
// (Rueckfall auf "Geplant") war nur hier, nicht im Rechenkern selbst.
await page.evaluate(() => blattAuf(46));
await page.waitForTimeout(300);
check('KRITISCH: das Schichtblatt zeigt "Abgeschlossen", faellt nicht auf "Geplant" zurueck',
  (await T('#blBody')).includes('Abgeschlossen'));
check('Kein Rueckfall auf "Geplant" fuer einen abgeschlossenen Einsatz',
  !(await page.evaluate(() =>
    [...document.querySelectorAll('#blBody .marke')].some(m => /^Geplant$/i.test(m.textContent.trim())))));
await page.evaluate(() => blattZu());
await page.waitForTimeout(200);

// ══════════════ ABMELDEN
await page.click('#t-menu'); await page.waitForTimeout(200);
await page.evaluate(() => { localStorage.setItem('rv3_token', 'x'); });
await page.evaluate(() => { window.__reload = false; });
check('Abmelden ist erreichbar',
  await page.evaluate(() => [...document.querySelectorAll('#v-menu button')].some(b => /Abmelden/.test(b.textContent))));

await page.screenshot({ path: OUT + '/40-app-menu.png' });
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
