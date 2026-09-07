// Eigene Kontaktangaben selbst pflegen (ENT-460).
//
// Der Projektinhaber: *"Ich moechte, dass man im Bereich meine Daten die
// wichtigsten Angaben selbst bearbeiten kann. Dies erspart vor allem mit der
// Administration Zeit."* Damit ist OP-21 entschieden -- sofort gueltig, ohne
// Freigabeschritt, dafuer mit Eintrag im Logbuch.
//
// Diese Suite hat zwei Haelften, und das mit Absicht:
//
//  A) Der Endpunkt wird WIRKLICH AUSGEFUEHRT (pruef_mein_profil_speichern.php,
//     SQLite im Arbeitsspeicher). Hier schreibt zum ersten Mal ein Endpunkt in
//     die Personalakte, OHNE dafuer ein Recht zu verlangen -- die Sitzung ist
//     die ganze Zugriffsregel. Ob dabei wirklich nur der eigene Datensatz und
//     wirklich nur die weisse Liste erreichbar ist, sind Aussagen ueber eine
//     Datenbank NACH dem Aufruf. Eine Quelltextsuche bliebe gruen, wenn
//     jemand eine Bedingung umdreht und die Formulierung stehen laesst.
//
//  B) Die Oberflaeche wird GEMESSEN, nicht nachgelesen: welche Felder
//     wirklich Eingabefelder sind, was wirklich abgeschickt wird, wie hoch
//     die Trefferflaechen wirklich sind.
//
// KEIN festes Datum in dieser Datei (test_datumsfest.mjs).
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Erfundene Angaben, keine echten Personen (CLAUDE.md, Vertraulichkeit).
const PW = 'richtig-langes-testpasswort';

function aufruf(koerper, lage = 'normal') {
  const roh = execFileSync('php', [`${HIER}/pruef_mein_profil_speichern.php`, lage],
    { input: JSON.stringify(koerper), encoding: 'utf8' });
  return JSON.parse(roh);
}

// ══════════════════════════════════════════ A) DER ENDPUNKT, AUSGEFUEHRT

// ── Der eigene Datensatz, und nur er ──────────────────────────────────────
try {
  // Der Rumpf traegt ABSICHTLICH Kennungen der anderen Person. Genau so
  // saehe der Versuch aus, ueber diesen Endpunkt fremde Daten zu erreichen.
  const a = aufruf({ id: 2, name: 'zweite.person', mitarbeiter_id: 2,
    strasse: 'Eingedrungen', ort: 'Anderswo' });
  const p = a.pruefung;
  check('Eine gewoehnliche Speicherung laeuft durch', a.status === 'ok' && p.http === 200);
  check('KRITISCH: geschrieben wird am EIGENEN Datensatz', p.ich.strasse === 'Eingedrungen');
  check('KRITISCH: die mitgeschickte fremde Kennung erreicht den fremden Datensatz nicht',
    p.andere.strasse === 'Andersweg' && p.andere.ort === 'Andersstadt');
  check('KRITISCH: am fremden Datensatz ist ueberhaupt nichts angeruehrt',
    JSON.stringify(p.andere) === JSON.stringify(aufruf({ land: 'Schweiz' }).pruefung.andere));
} catch (e) { check('Abschnitt eigener Datensatz ohne Abbruch: ' + e.message, false); }

// ── Was der Betrieb vergibt und was vertraulich ist, bleibt liegen ────────
try {
  const a = aufruf({ personalnummer: '9999', geburtsdatum: '2000-01-01',
    ahv_nr: '756.9999.9999.99', zivilstand: 'verheiratet',
    email: 'gekapert@beispiel.invalid', ist_admin: 1,
    telefon_geschaeft: '000 000 00 99', strasse: 'Nurdas' });
  const i = a.pruefung.ich;
  check('KRITISCH: die Personalnummer bleibt, obwohl mitgeschickt', i.personalnummer === '1001');
  check('KRITISCH: das Geburtsdatum bleibt (vertrauliches Feld)', i.geburtsdatum === '1980-02-03');
  check('KRITISCH: die AHV-Nummer bleibt (vertrauliches Feld)', i.ahv_nr === '756.0000.0000.00');
  check('KRITISCH: der Zivilstand bleibt (vertrauliches Feld)', i.zivilstand === 'ledig');
  check('KRITISCH: die Geschaeftsadresse bleibt', i.email === 'muster.person@beispiel.invalid');
  check('KRITISCH: die Geschaeftsnummer bleibt', i.telefon_geschaeft === null);
  check('KRITISCH: ist_admin bleibt -- niemand befoerdert sich selbst', Number(i.ist_admin) === 0);
  check('Das erlaubte Feld derselben Anfrage geht durch', i.strasse === 'Nurdas');
} catch (e) { check('Abschnitt vergeben/vertraulich ohne Abbruch: ' + e.message, false); }

// ── Die private E-Mail haengt am Passwort-Ruecksetzweg ────────────────────
try {
  const ohne = aufruf({ email_privat: 'neu@beispiel.invalid', strasse: 'Mitgeschmuggelt' });
  check('KRITISCH: neue private E-Mail ohne Passwort wird abgelehnt',
    ohne.pruefung.http === 401 && ohne.passwort_noetig === true);
  check('KRITISCH: dabei wird die Adresse NICHT geaendert',
    ohne.pruefung.ich.email_privat === 'privat@beispiel.invalid');
  check('KRITISCH: und auch sonst nichts aus derselben Anfrage',
    ohne.pruefung.ich.strasse === 'Musterweg' && ohne.pruefung.logbuch.length === 0);

  const falsch = aufruf({ email_privat: 'neu@beispiel.invalid', passwort: 'falsch' });
  check('KRITISCH: falsches Passwort wird abgelehnt',
    falsch.pruefung.http === 401
    && falsch.pruefung.ich.email_privat === 'privat@beispiel.invalid');

  const richtig = aufruf({ email_privat: 'neu@beispiel.invalid', passwort: PW });
  check('Mit richtigem Passwort geht die neue Adresse durch',
    richtig.status === 'ok' && richtig.pruefung.ich.email_privat === 'neu@beispiel.invalid');

  // Ein Formular schickt das unveraenderte Feld bei jedem Speichern mit --
  // eine Passwortabfrage beim Ummelden der Wohnadresse waere Theater.
  const adresse = aufruf({ email_privat: 'privat@beispiel.invalid', strasse: 'Ohnepasswort' });
  check('Unveraenderte E-Mail verlangt kein Passwort',
    adresse.status === 'ok' && adresse.pruefung.ich.strasse === 'Ohnepasswort');
} catch (e) { check('Abschnitt E-Mail/Passwort ohne Abbruch: ' + e.message, false); }

// ── Eingabepruefung ───────────────────────────────────────────────────────
try {
  const leerS = aufruf({ strasse: '', ort: 'Musterstadt' });
  check('Die Strasse laesst sich nicht leeren',
    leerS.pruefung.http === 400 && leerS.pruefung.ich.strasse === 'Musterweg');
  const leerO = aufruf({ ort: '' });
  check('Der Ort laesst sich nicht leeren',
    leerO.pruefung.http === 400 && leerO.pruefung.ich.ort === 'Musterstadt');

  // Eine zu lange Eingabe kommt nicht in die Schreibliste. Stuende der
  // Hinweis auf eine leere Anfrage davor, meldete der Endpunkt "nichts
  // mitgeschickt" -- eine falsche Begruendung schickt die Person auf die
  // Suche nach dem falschen Fehler.
  const lang = aufruf({ strasse: 'X'.repeat(300) });
  check('KRITISCH: zu lange Eingabe wird als ZU LANG gemeldet, nicht als leere Anfrage',
    lang.pruefung.http === 400 && /200/.test(lang.message) && !/nichts/i.test(lang.message));

  const mail = aufruf({ email_privat: 'keineadresse', passwort: PW });
  check('Eine E-Mail ohne @ wird abgelehnt', mail.pruefung.http === 400);

  const nichts = aufruf({ ahv_nr: '756.9999.9999.99' });
  check('Eine Anfrage ganz ohne erlaubtes Feld wird als solche gemeldet',
    nichts.pruefung.http === 400 && /nichts/i.test(nichts.message));

  const frei = aufruf({ notfallkontakt: '', adresszusatz: '' });
  check('Freiwillige Felder duerfen geleert werden',
    frei.status === 'ok' && frei.pruefung.ich.notfallkontakt === '');

  const get = aufruf({ strasse: 'Egal' }, 'get');
  check('Ohne POST passiert nichts',
    get.pruefung.http === 405 && get.pruefung.ich.strasse === 'Musterweg');
} catch (e) { check('Abschnitt Eingabepruefung ohne Abbruch: ' + e.message, false); }

// ── Logbuch: die Verwaltung sieht die Aenderung, ohne freigeben zu muessen ─
try {
  const a = aufruf({ strasse: 'Logweg', ort: 'Logstadt' });
  const log = a.pruefung.logbuch;
  const feld = f => log.find(e => e.feld === f);
  check('KRITISCH: jede geaenderte Angabe erzeugt einen Logbuch-Eintrag',
    log.length === 2 && !!feld('strasse') && !!feld('ort'));
  check('KRITISCH: als Akteur steht der Mitarbeitende selbst, mit Namen',
    log.every(e => Number(e.akteur_id) === 1 && e.akteur_name === 'muster.person'));
  check('Der Eintrag traegt alten UND neuen Wert',
    feld('strasse').wert_alt === 'Musterweg' && feld('strasse').wert_neu === 'Logweg');
  check('Der Eintrag haengt an der richtigen Personalakte',
    log.every(e => e.bereich === 'mitarbeiter' && Number(e.objekt_id) === 1));
  const unveraendert = aufruf({ strasse: 'Musterweg' });
  check('Ein Speichern ohne echte Aenderung schreibt nichts ins Logbuch',
    unveraendert.pruefung.logbuch.length === 0);
} catch (e) { check('Abschnitt Logbuch ohne Abbruch: ' + e.message, false); }

// ══════════════════════════════════════════ B) DIE LISTEN SELBST
//
// Geprueft wird die AUSSAGE, nicht der Wortlaut: Die Listen werden gelesen
// und als Daten verglichen. Wer ein Feld ergaenzt, das nicht hineingehoert,
// wird hier rot -- unabhaengig davon, wie er es formuliert.
const maQuelle  = readFileSync(`${WURZEL}/backend/mitarbeiter.php`, 'utf8');
const epQuelle  = readFileSync(`${WURZEL}/backend/api/mein_profil_speichern.php`, 'utf8');
const appQuelle = readFileSync(`${WURZEL}/app.html`, 'utf8');

const rumpf = (quelle, name) => {
  const i = quelle.indexOf(name);
  return i < 0 ? '' : quelle.slice(i, quelle.indexOf('\n}', i));
};
const namen = (quelle, fn) => [...rumpf(quelle, fn).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
const paare = (text, muster) => Object.fromEntries(
  [...text.matchAll(muster)].map(m => [m[1], Number(m[2])]));

try {
  const aenderbar   = namen(maQuelle, 'function ma_selbst_aenderbare_felder');
  const vertraulich = namen(maQuelle, 'function ma_vertrauliche_felder');
  const typen = Object.fromEntries([...rumpf(maQuelle, 'function ma_felder')
    .matchAll(/'([a-z_]+)'\s*=>\s*'([a-z]+)'/g)].map(m => [m[1], m[2]]));

  check('Die Liste der selbst aenderbaren Felder ist ueberhaupt lesbar',
    aenderbar.length >= 8 && vertraulich.length >= 10 && Object.keys(typen).length >= 30);
  const heikel = aenderbar.filter(f => vertraulich.includes(f));
  check('KRITISCH: kein selbst aenderbares Feld ist ein vertrauliches',
    heikel.length === 0);
  if (heikel.length) { bad.push('vertraulich und trotzdem selbst aenderbar: ' + heikel.join(', ')); }

  // Was der Betrieb VERGIBT, vergibt nicht die Person selbst.
  const vergeben = ['personalnummer', 'email', 'telefon_geschaeft', 'mobil_geschaeft',
    'funktion_id', 'abteilung_id', 'anstellungsort_id', 'eintritt', 'austritt',
    'pensum_stunden', 'anstellungskategorie', 'revierdienst_berechtigt',
    'waffentragberechtigt', 'diensthundefuehrer', 'zugang_bis'];
  const offen = vergeben.filter(f => aenderbar.includes(f));
  check('KRITISCH: kein vom Betrieb vergebenes Feld ist selbst aenderbar', offen.length === 0);
  if (offen.length) { bad.push('vom Betrieb vergeben, aber offen: ' + offen.join(', ')); }

  // Der Endpunkt behandelt jedes Feld als freien Text. Kaeme ein Datum oder
  // eine Auswahlliste dazu, liefe sie ungeprueft durch -- genau der Fall
  // "etwas Neues erbt die Regel nicht".
  const nichtText = aenderbar.filter(f => typen[f] !== 'text');
  check('KRITISCH: jedes selbst aenderbare Feld ist im Datenmodell ein Textfeld',
    nichtText.length === 0);
  if (nichtText.length) { bad.push('kein Textfeld: ' + nichtText.join(', ')); }

  // Server und Browser fuehren dieselben Laengen. Der Browser begrenzt nur
  // die Eingabe; laufen die beiden auseinander, tippt jemand munter weiter
  // und bekommt beim Speichern eine Abfuhr.
  const server  = paare(epQuelle,  /'([a-z_]+)'\s*=>\s*(\d+)/g);
  const browser = paare(appQuelle, /\b([a-z_]+):\s*(\d+)\b/g);
  const fehlend = aenderbar.filter(f => !(f in server));
  check('KRITISCH: der Server kennt fuer jedes aenderbare Feld eine Hoechstlaenge',
    fehlend.length === 0);
  if (fehlend.length) { bad.push('ohne Hoechstlaenge im Server: ' + fehlend.join(', ')); }
  const uneins = aenderbar.filter(f => f in server && f in browser && server[f] !== browser[f]);
  check('KRITISCH: Browser- und Serverlaengen stimmen ueberein', uneins.length === 0);
  if (uneins.length) {
    uneins.forEach(f => bad.push(`Laenge uneins bei ${f}: Server ${server[f]}, Browser ${browser[f]}`));
  }
} catch (e) { check('Abschnitt Listen ohne Abbruch: ' + e.message, false); }

// ══════════════════════════════════════════ C) DIE OBERFLAECHE, GEMESSEN
const EXE = browserPfad();
const browser = await chromium.launch({ executablePath: EXE });
const jsFehler = [];

const PROFIL = {
  name: 'muster.person', vorname: 'Eine', nachname: 'Person',
  personalnummer: '1001', geburtsdatum: '1980-02-03',
  strasse: 'Musterweg', hausnummer: '1', adresszusatz: '', plz: '9999',
  ort: 'Musterstadt', land: '', telefon: '000 000 00 01', mobil: '',
  email: 'muster.person@beispiel.invalid', email_privat: 'privat@beispiel.invalid',
  notfallkontakt: '', revierdienst_berechtigt: 0,
};
const AENDERBAR = ['strasse', 'hausnummer', 'adresszusatz', 'plz', 'ort', 'land',
  'telefon', 'mobil', 'email_privat', 'notfallkontakt'];

// art: 'normal' | 'ohne' (der Server gibt nichts frei) | 'fehler'
async function seite(breite, hoehe, art = 'normal') {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  page.on('pageerror', e => jsFehler.push(e.message));
  const gesendet = [];
  page.gesendet = gesendet;
  await page.route('**/api/**', r => {
    const u = new URL(r.request().url(), 'http://x');
    const s = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (u.pathname.includes('login'))  return s({ status: 'ok', token: 't', name: 'muster.person', rechte: [] });
    if (u.pathname.includes('me.php')) return s({ status: 'ok', name: 'muster.person', rechte: [] });
    if (u.pathname.includes('mein_profil_speichern')) {
      let koerper = {};
      try { koerper = JSON.parse(r.request().postData() || '{}'); } catch (e) { /* egal */ }
      gesendet.push(koerper);
      if (art === 'fehler') return r.fulfill({ status: 400, contentType: 'application/json',
        body: JSON.stringify({ status: 'error', message: 'Serverseitig abgelehnt' }) });
      return s({ status: 'ok', geaendert: Object.keys(koerper).length });
    }
    if (u.pathname.includes('mein_profil')) return s({ status: 'ok', profil: PROFIL,
      selbst_aenderbar: art === 'ohne' ? [] : AENDERBAR });
    return s({ status: 'ok', schichten: [], rapporte: [], abwesenheiten: [], sperren: [],
      mitteilungen: [], eintraege: [], vorlagen: [], fahrzeuge: [], ereignisarten: [], saldo: {} });
  });
  await page.goto(`file://${WURZEL}/app.html`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'muster.person');
  await page.fill('#gPass', 'x');
  await page.click('#gBtn');
  await page.waitForSelector('#app.on', { timeout: 8000 });
  await page.evaluate(() => { zeige('menu'); datenSeiteAuf(); });
  await page.waitForTimeout(300);
  return page;
}

const anzeigeLesen = page => page.evaluate(() => {
  const bd = document.getElementById('md-bd');
  const dt = [...bd.querySelectorAll('dl.dl dt')], dd = [...bd.querySelectorAll('dl.dl dd')];
  return {
    zeilen: dt.map((t, i) => ({ titel: t.textContent.trim(),
      wert: dd[i] ? dd[i].innerText.trim() : '',
      alsLeerAusgewiesen: !!(dd[i] && dd[i].querySelector('.md-leer')) })),
    knopf: !!document.getElementById('mdKnopfAuf'),
    hinweis: (bd.querySelector('.md-hinweis') || { innerText: '' }).innerText.trim(),
  };
});

// ── Anzeige: "nicht erfasst" ist kein leeres Feld ─────────────────────────
try {
  const page = await seite(390, 844);
  const a = await anzeigeLesen(page);
  check('Die Karte "Meine Daten" hat Zeilen', a.zeilen.length >= 6);
  const stumm = a.zeilen.filter(z => z.wert === '');
  check('KRITISCH: keine Zeile bleibt wortlos leer -- Unbekanntes wird benannt',
    stumm.length === 0);
  if (stumm.length) { bad.push('wortlos leer: ' + stumm.map(z => z.titel).join(', ')); }
  const leere = a.zeilen.filter(z => z.alsLeerAusgewiesen);
  check('KRITISCH: leere Angaben sind ausdruecklich als nicht erfasst gekennzeichnet',
    leere.length >= 2 && leere.every(z => z.wert.length > 3));
  check('Der Knopf zum Bearbeiten ist da', a.knopf);
  await page.close();
} catch (e) { check('Abschnitt Anzeige ohne Abbruch: ' + e.message, false); }

// ── Gibt der Server nichts frei, sagt die Karte etwas ANDERES ─────────────
try {
  const page = await seite(390, 844, 'ohne');
  const a = await anzeigeLesen(page);
  const p2 = await seite(390, 844);
  const normal = await anzeigeLesen(p2);
  await p2.close();
  check('KRITISCH: ohne freigegebene Felder gibt es keinen Knopf zum Bearbeiten', !a.knopf);
  check('KRITISCH: "noch nicht eingerichtet" und "macht die Verwaltung" sind zwei Texte',
    a.hinweis.length > 10 && a.hinweis !== normal.hinweis);
  check('Ohne freigegebene Felder erscheint auch keine Zeile fuer sie',
    !a.zeilen.some(z => /notfall/i.test(z.titel)));
  await page.close();
} catch (e) { check('Abschnitt ohne Freigabe ohne Abbruch: ' + e.message, false); }

// ── Das Formular: was Eingabefeld ist und was nicht ───────────────────────
const formularLesen = page => page.evaluate(() => {
  const bd = document.getElementById('md-bd');
  const felder = [...bd.querySelectorAll('input.inp')].map(el => ({
    id: el.id,
    hoehe: Math.round(el.getBoundingClientRect().height),
    schrift: Math.round(parseFloat(getComputedStyle(el).fontSize)),
    sichtbar: el.getBoundingClientRect().height > 0,
    maxlength: el.getAttribute('maxlength'),
  }));
  const pw = document.getElementById('mdPw');
  const knoepfe = [...bd.querySelectorAll('button')].map(b => ({
    id: b.id, hoehe: Math.round(b.getBoundingClientRect().height),
    breit: Math.round(b.getBoundingClientRect().width),
  }));
  return { felder, knoepfe,
    // Gemessen, nicht aus display gelesen: ein verborgener Vorfahr wuerde
    // sonst uebersehen (dieselbe Falle wie bei den Reitern).
    pwSichtbar: !!pw && pw.getBoundingClientRect().height > 0,
    breite: Math.round(bd.getBoundingClientRect().width) };
});

try {
  const page = await seite(390, 844);
  await page.click('#mdKnopfAuf');
  await page.waitForTimeout(150);
  const f = await formularLesen(page);
  const ids = f.felder.map(x => x.id);

  check('Fuer jedes freigegebene Feld gibt es ein Eingabefeld',
    AENDERBAR.every(n => ids.includes('md-' + n)));
  const verboten = ['md-personalnummer', 'md-geburtsdatum', 'md-email', 'md-ahv_nr',
    'md-telefon_geschaeft', 'md-ist_admin'].filter(n => ids.includes(n));
  check('KRITISCH: kein Eingabefeld fuer Vergebenes oder Vertrauliches', verboten.length === 0);
  if (verboten.length) { bad.push('Eingabefeld, das es nicht geben darf: ' + verboten.join(', ')); }

  const zuKlein = f.felder.filter(x => x.sichtbar && (x.hoehe < 44 || x.schrift < 16));
  check('KRITISCH: jedes Eingabefeld ist mindestens 44 px hoch und 16 px gross',
    zuKlein.length === 0);
  zuKlein.forEach(x => bad.push(`${x.id}: ${x.hoehe} px hoch, ${x.schrift} px Schrift`));

  const knopfKlein = f.knoepfe.filter(b => b.hoehe > 0 && b.hoehe < 44);
  check('Auch die Knoepfe sind mindestens 44 px hoch', knopfKlein.length === 0);
  knopfKlein.forEach(b => bad.push(`${b.id}: ${b.hoehe} px hoch`));
  // Ein Knopf wird nicht ueber die volle Breite gestreckt, nur weil er
  // allein in seiner Zeile steht (CLAUDE.md, Gestaltung).
  check('Kein Knopf ist ueber die ganze Kartenbreite gestreckt',
    f.knoepfe.every(b => b.breit < f.breite - 8));

  check('Das Passwortfeld ist anfangs verborgen', !f.pwSichtbar);
  await page.close();
} catch (e) { check('Abschnitt Formular ohne Abbruch: ' + e.message, false); }

// ── Die Passwortfrage kommt nur bei einer WIRKLICH neuen Adresse ──────────
try {
  const page = await seite(390, 844);
  await page.click('#mdKnopfAuf');
  await page.waitForTimeout(150);
  await page.fill('#md-email_privat', 'anders@beispiel.invalid');
  await page.waitForTimeout(120);
  check('KRITISCH: bei geaenderter privater E-Mail erscheint die Passwortfrage',
    (await formularLesen(page)).pwSichtbar);
  // Gemessen, solange es SICHTBAR ist. Waere es hier zu, haette das Auge
  // Hoehe 0 und jede Groessenpruefung ginge blind durch.
  const auge = await page.evaluate(() => {
    const b = document.querySelector('#mdPw .pw-toggle');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { hoehe: Math.round(r.height), breite: Math.round(r.width),
             beschriftet: (b.getAttribute('aria-label') || '').length > 3 };
  });
  check('KRITISCH: das Passwortfeld hat ein Auge zum Aufdecken (ENT-291)', !!auge);
  check('Das Auge ist gross genug zum Treffen und hat eine Beschriftung',
    !!auge && auge.hoehe >= 40 && auge.breite >= 40 && auge.beschriftet);
  const aufgedeckt = await page.evaluate(() => {
    document.querySelector('#mdPw .pw-toggle').click();
    return document.getElementById('mdPwInp').type;
  });
  check('Das Auge deckt wirklich auf', aufgedeckt === 'text');

  await page.fill('#md-email_privat', PROFIL.email_privat);
  await page.waitForTimeout(120);
  check('Wird die Adresse zurueckgesetzt, verschwindet sie wieder',
    !(await formularLesen(page)).pwSichtbar);
  await page.close();
} catch (e) { check('Abschnitt Passwortfrage ohne Abbruch: ' + e.message, false); }

// ── Was wirklich abgeschickt wird ─────────────────────────────────────────
try {
  const page = await seite(390, 844);
  await page.click('#mdKnopfAuf');
  await page.waitForTimeout(150);
  await page.fill('#md-strasse', 'Neuweg');
  await page.fill('#md-notfallkontakt', 'Zweite Person, 000 000 00 05');
  await page.click('#mdKnopfSpeichern');
  await page.waitForTimeout(400);
  const g = page.gesendet[0] || {};
  const zuviel = Object.keys(g).filter(k => !AENDERBAR.includes(k));
  check('KRITISCH: abgeschickt wird nur, was der Server freigegeben hat', zuviel.length === 0);
  if (zuviel.length) { bad.push('mitgeschickt, obwohl nicht freigegeben: ' + zuviel.join(', ')); }
  check('Die Eingaben kommen wirklich an',
    g.strasse === 'Neuweg' && /Zweite Person/.test(g.notfallkontakt || ''));
  check('Ohne E-Mail-Aenderung wird kein Passwort mitgeschickt', !('passwort' in g));
  const zurueck = await page.evaluate(() =>
    !!document.getElementById('mdKnopfAuf') && !document.getElementById('mdKnopfSpeichern'));
  check('Nach dem Speichern steht wieder die Anzeige da', zurueck);
  await page.close();
} catch (e) { check('Abschnitt Absenden ohne Abbruch: ' + e.message, false); }

// ── Weist der Server ab, bleibt die Eingabe stehen ────────────────────────
try {
  const page = await seite(390, 844, 'fehler');
  await page.click('#mdKnopfAuf');
  await page.waitForTimeout(150);
  await page.fill('#md-strasse', 'Bleibtstehen');
  await page.click('#mdKnopfSpeichern');
  await page.waitForTimeout(400);
  const zustand = await page.evaluate(() => ({
    nochImFormular: !!document.getElementById('mdKnopfSpeichern'),
    wert: (document.getElementById('md-strasse') || {}).value,
    knopfWiederNutzbar: !(document.getElementById('mdKnopfSpeichern') || {}).disabled,
    meldung: (document.getElementById('toast') || { textContent: '' }).textContent,
  }));
  check('KRITISCH: nach einer Abweisung bleibt das Formular offen', zustand.nochImFormular);
  check('KRITISCH: die eingetippte Angabe geht dabei nicht verloren',
    zustand.wert === 'Bleibtstehen');
  check('Der Speicherknopf ist danach wieder benutzbar', zustand.knopfWiederNutzbar);
  check('Die Begruendung des Servers wird angezeigt', /abgelehnt/i.test(zustand.meldung));
  await page.close();
} catch (e) { check('Abschnitt Abweisung ohne Abbruch: ' + e.message, false); }

// ── Am Schreibtisch dasselbe ──────────────────────────────────────────────
try {
  const page = await seite(1440, 900);
  await page.evaluate(() => zeigeTisch('daten'));
  await page.waitForTimeout(250);
  check('Am Schreibtisch fuehrt der Reiter "Meine Daten" auf dieselbe Karte',
    (await anzeigeLesen(page)).knopf);
  await page.click('#mdKnopfAuf');
  await page.waitForTimeout(150);
  const f = await formularLesen(page);
  check('Am Schreibtisch gibt es dieselben Eingabefelder',
    AENDERBAR.every(n => f.felder.some(x => x.id === 'md-' + n)));
  check('Auch am Schreibtisch bleiben die Felder ausreichend gross',
    f.felder.every(x => !x.sichtbar || (x.hoehe >= 44 && x.schrift >= 16)));
  await page.close();
} catch (e) { check('Abschnitt Schreibtisch ohne Abbruch: ' + e.message, false); }

check('Keine Skriptfehler', jsFehler.length === 0);
jsFehler.forEach(f => bad.push('JS-Fehler: ' + f));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
bad.forEach(b => console.log('  ✗ ' + b));
process.exit(bad.length ? 1 : 0);
