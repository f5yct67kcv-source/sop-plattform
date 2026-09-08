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
  // Die Wiederholung fehlt ganz -- der Server laesst die Aenderung nicht
  // durch, obwohl der Browser sie geschickt haben koennte (ENT-466).
  const ohneWdh = aufruf({ email_privat: 'neu@beispiel.invalid' });
  check('KRITISCH: neue E-Mail ohne Wiederholung wird abgelehnt',
    ohneWdh.pruefung.http === 400 && ohneWdh.mail_wiederholung === true
    && ohneWdh.pruefung.ich.email_privat === 'privat@beispiel.invalid');

  // Der Zahlendreher, der den Vorfall ausgeloest hat: zwei Adressen, die
  // sich um zwei Zeichen unterscheiden.
  const dreher = aufruf({ email_privat: 'neu@beispiel.invalid',
    email_privat2: 'nue@beispiel.invalid', passwort: PW });
  check('KRITISCH: ein Zahlendreher in der Wiederholung wird erkannt',
    dreher.pruefung.http === 400 && dreher.mail_wiederholung === true
    && dreher.pruefung.ich.email_privat === 'privat@beispiel.invalid');

  const ohne = aufruf({ email_privat: 'neu@beispiel.invalid',
    email_privat2: 'neu@beispiel.invalid', strasse: 'Mitgeschmuggelt' });
  check('KRITISCH: neue private E-Mail ohne Passwort wird abgelehnt',
    ohne.pruefung.http === 401 && ohne.passwort_noetig === true);
  check('KRITISCH: dabei wird die Adresse NICHT geaendert',
    ohne.pruefung.ich.email_privat === 'privat@beispiel.invalid');
  check('KRITISCH: und auch sonst nichts aus derselben Anfrage',
    ohne.pruefung.ich.strasse === 'Musterweg' && ohne.pruefung.logbuch.length === 0);

  const falsch = aufruf({ email_privat: 'neu@beispiel.invalid',
    email_privat2: 'neu@beispiel.invalid', passwort: 'falsch' });
  check('KRITISCH: falsches Passwort wird abgelehnt',
    falsch.pruefung.http === 401
    && falsch.pruefung.ich.email_privat === 'privat@beispiel.invalid');

  const richtig = aufruf({ email_privat: 'neu@beispiel.invalid',
    email_privat2: 'neu@beispiel.invalid', passwort: PW });
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

  const mail = aufruf({ email_privat: 'keineadresse',
    email_privat2: 'keineadresse', passwort: PW });
  check('Eine E-Mail ohne @ wird abgelehnt', mail.pruefung.http === 400);

  const nichts = aufruf({ ahv_nr: '756.9999.9999.99' });
  check('Eine Anfrage ganz ohne erlaubtes Feld wird als solche gemeldet',
    nichts.pruefung.http === 400 && /nichts/i.test(nichts.message));

  const frei = aufruf({ adresszusatz: '' });
  check('Der Adresszusatz darf geleert werden -- er ist das einzige freiwillige Feld',
    frei.status === 'ok' && frei.pruefung.ich.adresszusatz === '');

  const get = aufruf({ strasse: 'Egal' }, 'get');
  check('Ohne POST passiert nichts',
    get.pruefung.http === 405 && get.pruefung.ich.strasse === 'Musterweg');
} catch (e) { check('Abschnitt Eingabepruefung ohne Abbruch: ' + e.message, false); }

// ── Eine Nummer statt zwei (ENT-466) ─────────────────────────────────────
try {
  const a = aufruf({ mobil: '000 000 00 09' });
  check('KRITISCH: die eine Nummer landet in der Mobil-Spalte',
    a.status === 'ok' && a.pruefung.ich.mobil === '000 000 00 09');
  check('KRITISCH: die alte Festnetzspalte wird dabei geleert',
    a.pruefung.ich.telefon === '');
  const log = a.pruefung.logbuch;
  check('Beide Schritte stehen im Logbuch, nicht nur der eine',
    log.length === 2 && log.some(e => e.feld === 'mobil')
    && log.some(e => e.feld === 'telefon' && e.wert_neu === ''));
  check('Die Nummer der anderen Person bleibt unangetastet',
    a.pruefung.andere.telefon === '000 000 00 03'
    && a.pruefung.andere.mobil === '000 000 00 04');
  // Wer die Nummer nicht anfasst, dem wird auch nichts geleert.
  const b = aufruf({ strasse: 'Nurdieadresse' });
  check('Ohne Nummernaenderung bleibt die Festnetzspalte, wie sie war',
    b.pruefung.ich.telefon === '000 000 00 01');
} catch (e) { check('Abschnitt eine Nummer ohne Abbruch: ' + e.message, false); }

// ── Pflichtangaben (ENT-466) ─────────────────────────────────────────────
try {
  const pflicht = ['strasse', 'hausnummer', 'plz', 'ort', 'land', 'mobil',
    'email_privat', 'notfallkontakt', 'notfallkontakt_tel'];
  const durchgelassen = [];
  for (const f of pflicht) {
    const koerper = { [f]: '' };
    // Die E-Mail braucht zusaetzlich die Wiederholung, sonst greift die
    // andere Sperre zuerst und die Pflichtpruefung bliebe ungetestet.
    if (f === 'email_privat') { koerper.email_privat2 = ''; koerper.passwort = PW; }
    const r = aufruf(koerper);
    if (r.pruefung.http === 200) { durchgelassen.push(f); }
  }
  check('KRITISCH: kein Pflichtfeld laesst sich leeren', durchgelassen.length === 0);
  durchgelassen.forEach(f => bad.push('leerbar, obwohl Pflicht: ' + f));

  // Die Pflicht gilt fuer den Zustand NACH dem Speichern, nicht fuer den
  // Anfragerumpf: Ein Formular, das nur einen Abschnitt sendet, muss
  // durchkommen, solange der Datensatz danach vollstaendig ist.
  const teil = aufruf({ strasse: 'Nureinabschnitt' });
  check('Eine Teilanfrage geht durch, wenn der Datensatz danach vollstaendig ist',
    teil.status === 'ok' && teil.pruefung.ich.strasse === 'Nureinabschnitt');
} catch (e) { check('Abschnitt Pflichtangaben ohne Abbruch: ' + e.message, false); }

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

  // Sichtbar ist eine Untermenge von aenderbar, und der Unterschied ist
  // genau die alte Festnetzspalte (ENT-466). Waere sie auch sichtbar,
  // stuenden zwei Nummernfelder da; fehlte sie oben, koennte der Server
  // sie nicht mehr leeren.
  const sichtbar = namen(maQuelle, 'function ma_selbst_sichtbare_felder');
  const abgeleitet = rumpf(maQuelle, 'function ma_selbst_sichtbare_felder');
  check('KRITISCH: die sichtbaren Felder werden aus den aenderbaren ABGELEITET',
    /ma_selbst_aenderbare_felder\s*\(\)/.test(abgeleitet));
  check('KRITISCH: genau die alte Festnetzspalte ist nicht mehr sichtbar',
    sichtbar.length === 1 && sichtbar[0] === 'telefon');

  // Pflichtliste: der Server sperrt, der Browser erspart den Weg dorthin.
  // Laufen sie auseinander, blockiert einer von beiden etwas, das der
  // andere durchlaesst.
  // Eine const-Liste endet mit "];", nicht mit "\n}" -- rumpf() taugt hier
  // nicht und zoege sonst Namen aus dem halben Endpunkt mit herein.
  const listeAus = (text, name) => [...((text.match(
    new RegExp('const ' + name + '\\s*=\\s*\\[[^\\]]*\\]')) || [''])[0])
    .matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  const pflichtServer = listeAus(epQuelle, 'SELBST_PFLICHT');
  const pflichtBrowser = listeAus(appQuelle, 'MD_PFLICHT');
  check('Beide Pflichtlisten sind ueberhaupt lesbar',
    pflichtServer.length >= 6 && pflichtBrowser.length >= 6);
  check('KRITISCH: Pflichtliste im Server und im Browser sind dieselbe',
    JSON.stringify([...pflichtServer].sort()) === JSON.stringify([...pflichtBrowser].sort()));
  check('KRITISCH: der Adresszusatz ist in keiner der beiden Pflichtlisten',
    !pflichtServer.includes('adresszusatz') && !pflichtBrowser.includes('adresszusatz'));
  check('KRITISCH: die alte Festnetzspalte ist kein Pflichtfeld -- sie hat kein Eingabefeld mehr',
    !pflichtServer.includes('telefon'));
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
  notfallkontakt: '', notfallkontakt_tel: '', revierdienst_berechtigt: 0,
};
// Was der Server als BEARBEITBAR meldet (ma_selbst_sichtbare_felder): ohne
// die alte Festnetzspalte, seit ENT-466 gibt es nur noch eine Nummer.
const AENDERBAR = ['strasse', 'hausnummer', 'adresszusatz', 'plz', 'ort', 'land',
  'mobil', 'email_privat', 'notfallkontakt', 'notfallkontakt_tel'];

// Die Nachbildung oben BEHAUPTET, der Server gebe genau diese Felder frei.
// Stimmt das nicht mehr, prueft der ganze Oberflaechenteil eine Seite, die
// es so gar nicht gibt -- und bliebe dabei gruen. Genau das ist beim
// Trennen des Notfallkontakts passiert: Das Feld aus der weissen Liste zu
// nehmen machte NICHTS rot. Darum wird die Nachbildung hier gegen die
// Quelle gehalten.
{
  const serverAenderbar = namen(maQuelle, 'function ma_selbst_aenderbare_felder');
  const serverVerborgen = namen(maQuelle, 'function ma_selbst_sichtbare_felder');
  const serverSichtbar = serverAenderbar.filter(f => !serverVerborgen.includes(f));
  check('KRITISCH: die Nachbildung deckt sich mit dem, was der Server wirklich freigibt',
    serverSichtbar.length > 0
    && JSON.stringify([...serverSichtbar].sort()) === JSON.stringify([...AENDERBAR].sort()));
  const zuviel = AENDERBAR.filter(f => !serverSichtbar.includes(f));
  const zuwenig = serverSichtbar.filter(f => !AENDERBAR.includes(f));
  zuviel.forEach(f => bad.push('Nachbildung kennt ein Feld, das der Server nicht freigibt: ' + f));
  zuwenig.forEach(f => bad.push('Server gibt ein Feld frei, das die Nachbildung nicht prueft: ' + f));
}

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
    leere.length >= 1 && leere.every(z => z.wert.length > 3));
  // Eine Nummer, eine Adresse (ENT-466): kein zweites Telefonfeld, keine
  // Geschaeftsadresse mehr auf diesem Bildschirm.
  const titel = a.zeilen.map(z => z.titel.toLowerCase());
  // Gemeint ist die EIGENE Nummer (ENT-466). Die Notfallnummer ist seit
  // ENT-471 eine eigene Zeile und zaehlt hier nicht mit.
  check('KRITISCH: die eigene Nummer steht genau EINMAL da',
    titel.filter(t => /telefon|mobil/.test(t) && !/notfall/.test(t)).length === 1);
  // Name und Nummer des Notfallkontakts sind zwei Zeilen, damit jede fuer
  // sich "nicht erfasst" sagen kann (ENT-471).
  check('KRITISCH: Notfallkontakt und Notfallnummer stehen getrennt',
    titel.filter(t => /notfall/.test(t)).length === 2);
  check('KRITISCH: es steht genau EINE E-Mail-Zeile da',
    titel.filter(t => /mail/.test(t)).length === 1);
  // Die Nummer steht im Muster noch in der alten Festnetzspalte -- sie
  // muss trotzdem erscheinen, sonst waere sie fuer die Person verschwunden.
  const nummer = a.zeilen.find(z => /telefon/.test(z.titel.toLowerCase()));
  check('KRITISCH: eine Nummer aus der alten Spalte verschwindet nicht',
    !!nummer && nummer.wert.includes('000 000 00 01'));
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

  // Notfallkontakt getrennt (ENT-471): Im Notfall muss niemand eine Nummer
  // aus einem Satz herauslesen, und sie laesst sich anwaehlen.
  const notfall = await page.evaluate(() => {
    const nm = document.getElementById('md-notfallkontakt');
    const tl = document.getElementById('md-notfallkontakt_tel');
    return { beide: !!nm && !!tl,
             typ: tl ? tl.getAttribute('type') : null,
             nebeneinander: !!nm && !!tl
               && Math.abs(nm.getBoundingClientRect().top - tl.getBoundingClientRect().top) < 2
               || (window.innerWidth < 700) };
  });
  check('KRITISCH: Notfallkontakt hat ein eigenes Feld fuer Name und fuer Nummer',
    notfall.beide);
  check('Die Notfallnummer ist als Telefonnummer ausgezeichnet -- sie laesst sich anwaehlen',
    notfall.typ === 'tel');
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
  await page.fill('#md-notfallkontakt', 'Eine Person');
  await page.fill('#md-notfallkontakt_tel', '000 000 00 05');
  // Seit ENT-466 Pflicht und im Muster leer -- ohne sie sperrt schon der
  // Browser, und der Server bekaeme die Anfrage nie zu sehen.
  await page.fill('#md-land', 'Musterland');
  await page.click('#mdKnopfSpeichern');
  await page.waitForTimeout(400);
  const g = page.gesendet[0] || {};
  const zuviel = Object.keys(g).filter(k => !AENDERBAR.includes(k));
  check('KRITISCH: abgeschickt wird nur, was der Server freigegeben hat', zuviel.length === 0);
  if (zuviel.length) { bad.push('mitgeschickt, obwohl nicht freigegeben: ' + zuviel.join(', ')); }
  check('Die Eingaben kommen wirklich an',
    g.strasse === 'Neuweg' && g.notfallkontakt === 'Eine Person'
    && g.notfallkontakt_tel === '000 000 00 05');
  check('Ohne E-Mail-Aenderung wird kein Passwort mitgeschickt', !('passwort' in g));
  const zurueck = await page.evaluate(() =>
    !!document.getElementById('mdKnopfAuf') && !document.getElementById('mdKnopfSpeichern'));
  check('Nach dem Speichern steht wieder die Anzeige da', zurueck);
  await page.close();
} catch (e) { check('Abschnitt Absenden ohne Abbruch: ' + e.message, false); }

// ── Pflicht, Freiwilligkeit und die Wiederholung (ENT-466) ───────────────
try {
  const page = await seite(390, 844);
  await page.click('#mdKnopfAuf');
  await page.waitForTimeout(150);

  const marken = await page.evaluate(() => [...document.querySelectorAll('#md-bd .f label')]
    .map(l => ({ fuer: l.getAttribute('for') || '',
                 frei: !!l.querySelector('.md-frei') })));
  const freie = marken.filter(m => m.frei).map(m => m.fuer);
  check('KRITISCH: genau ein Feld ist als freiwillig ausgewiesen -- der Adresszusatz',
    freie.length === 1 && freie[0] === 'md-adresszusatz');

  // Im Muster fehlen Land und Notfallkontakt. Wer das erst beim Speichern
  // erfaehrt, haelt das Formular fuer kaputt.
  const hinweis = await page.evaluate(() =>
    (document.querySelector('#md-bd .md-fehlt') || { innerText: '' }).innerText.trim());
  check('KRITISCH: fehlende Pflichtangaben stehen OBEN im Formular, nicht erst nach dem Speichern',
    hinweis.length > 10 && hinweis.startsWith('3'));

  // Ein geleertes Pflichtfeld kommt gar nicht erst zum Server.
  await page.fill('#md-land', 'Musterland');
  await page.fill('#md-notfallkontakt', 'Jemand');
  await page.fill('#md-notfallkontakt_tel', '000 000 00 05');
  await page.fill('#md-ort', '');
  await page.click('#mdKnopfSpeichern');
  await page.waitForTimeout(300);
  check('KRITISCH: ein geleertes Pflichtfeld wird gar nicht erst abgeschickt',
    page.gesendet.length === 0);
  check('Die Meldung nennt das Feld, um das es geht',
    /ort/i.test(await page.evaluate(() => document.getElementById('toast').textContent)));
  await page.close();
} catch (e) { check('Abschnitt Pflicht/Freiwillig ohne Abbruch: ' + e.message, false); }

try {
  const page = await seite(390, 844);
  await page.click('#mdKnopfAuf');
  await page.waitForTimeout(150);
  await page.fill('#md-land', 'Musterland');
  await page.fill('#md-notfallkontakt', 'Jemand');
  await page.fill('#md-notfallkontakt_tel', '000 000 00 05');

  const wdhDa = () => page.evaluate(() => {
    const el = document.getElementById('md-email_privat2');
    return !!el && el.getBoundingClientRect().height > 0;
  });
  check('Das Wiederholfeld ist anfangs verborgen', !(await wdhDa()));
  await page.fill('#md-email_privat', 'anders@beispiel.invalid');
  await page.waitForTimeout(120);
  check('KRITISCH: bei geaenderter E-Mail erscheint das Wiederholfeld', await wdhDa());

  // Der Zahlendreher, der den Vorfall ausgeloest hat.
  await page.fill('#md-email_privat2', 'andrs@beispiel.invalid');
  await page.click('#mdKnopfSpeichern');
  await page.waitForTimeout(300);
  check('KRITISCH: bei abweichender Wiederholung wird nichts abgeschickt',
    page.gesendet.length === 0);
  check('Die Meldung sagt, dass die beiden nicht uebereinstimmen',
    /überein|uberein/i.test(await page.evaluate(() =>
      document.getElementById('toast').textContent)));

  await page.fill('#md-email_privat2', 'anders@beispiel.invalid');
  await page.fill('#mdPwInp', 'irgendein-passwort');
  await page.click('#mdKnopfSpeichern');
  await page.waitForTimeout(400);
  const g = page.gesendet[0] || {};
  check('Stimmen beide ueberein, geht die Anfrage raus', page.gesendet.length === 1);
  check('KRITISCH: die Wiederholung wird mitgeschickt -- der Server prueft sie noch einmal',
    g.email_privat2 === 'anders@beispiel.invalid' && g.email_privat === 'anders@beispiel.invalid');
  check('Das Passwort geht mit, weil die Adresse sich aendert', !!g.passwort);
  check('KRITISCH: die alte Festnetzspalte wird nie mitgeschickt', !('telefon' in g));
  await page.close();
} catch (e) { check('Abschnitt Wiederholung ohne Abbruch: ' + e.message, false); }

// ── Weist der Server ab, bleibt die Eingabe stehen ────────────────────────
try {
  const page = await seite(390, 844, 'fehler');
  await page.click('#mdKnopfAuf');
  await page.waitForTimeout(150);
  await page.fill('#md-strasse', 'Bleibtstehen');
  await page.fill('#md-land', 'Musterland');
  await page.fill('#md-notfallkontakt', 'Eine Person');
  await page.fill('#md-notfallkontakt_tel', '000 000 00 05');
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
