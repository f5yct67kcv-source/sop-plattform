import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';


const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();

const STATS = {
  status: 'ok',
  kpi: { rapporte_monat: 47, rapporte_vormonat: 39, stunden_monat: 386.25, stunden_vormonat: 341,
         mitarbeiter: 3, kunden: 2, rapporte_total: 284 },
  verlauf: Array.from({ length: 8 }, (_, i) => ({ kw: 26 + i, von: '2026-06-22', stunden: 80 + i * 6, anzahl: 10 })),
  angemeldet: [{ name: 'adrian', vorname: 'Adrian', nachname: 'Muster', letzte_anmeldung: '2026-08-17 17:53:00' }],
  pro_mitarbeiter: [{ name: 'adrian', vorname: 'Adrian', nachname: 'Muster', stunden: '96.00', anzahl: 12 }],
  letzte_rapporte: [{ id: 284, datum: '2026-08-17', mitarbeiter: 'adrian', kunde: 'Muster Immobilien AG', ort: '4632 Trimbach', einsatzart: 'Verkehrsdienst', netto_h: '8.50' }]
};

const RAPPORTE = { status: 'ok', rapporte: [
  { id: 284, datum: '2026-08-17', mitarbeiter: 'dario.beispiel', kunde: 'Muster Immobilien AG', strasse: 'Musterstrasse 12', ort: '4632 Trimbach', auftrag_nr: 'A-118', einsatzart: 'Verkehrsdienst', von: '07:00:00', bis: '16:00:00', pause_min: 30, netto_h: '8.50', unterzeichner: 'R. Muster', unterschrift: null, bemerkung: null, erfasst_am: '2026-08-17 16:12:00' }
]};

const MA = { status: 'ok', mitarbeiter: [
  { name: 'adrian', ist_admin: 1, personalnummer: '1001', anrede: 'Herr', vorname: 'Adrian', nachname: 'Muster', geburtsdatum: '1988-04-12', strasse: 'Hochgasse 7', ort: '4632 Trimbach', telefon: '062 555 11 22', mobil: '079 555 11 22', email: 'a@cupi24.ch', erstellt_am: '2026-01-05 10:00:00' },
  { name: 'dario.beispiel', ist_admin: 0, personalnummer: '1002', anrede: 'Herr', vorname: 'Dario', nachname: 'Beispiel', geburtsdatum: null, strasse: 'Bahnhofstrasse 9', ort: '4600 Olten', telefon: null, mobil: '079 444 33 22', email: null, erstellt_am: '2026-02-01 09:00:00' }
]};

const KU = { status: 'ok', naechste_kundennummer: 'K0003', kunden: [
  { id: 1, kundennummer: 'K0001', art: 'unternehmen', name: 'Muster Immobilien AG', strasse: 'Musterstrasse',
    hausnummer: '12', plz: '4632', ort: 'Trimbach', uid: 'CHE-100.200.300', telefon: '062 111 22 33',
    kontaktperson: null, email: 'info@muster.ch', notiz: null, aktiv: 1,
    kontaktwege: [{ art: 'telefon', wert: '062 111 22 33' }, { art: 'email', wert: 'info@muster.ch' }],
    personen: [] },
  { id: 2, kundennummer: 'K0002', art: 'unternehmen', name: 'Einwohnergemeinde Musterdorf', strasse: 'Dorfstrasse',
    hausnummer: '4', plz: '5013', ort: 'Musterdorf', telefon: '062 849 00 00', kontaktperson: null,
    email: null, notiz: null, aktiv: 1, kontaktwege: [{ art: 'telefon', wert: '062 849 00 00' }], personen: [] }
]};

let calls = [];
const writes = () => calls.filter(c => /create|update|delete|deactivate|reset|archivieren/.test(c.path));

async function setup(page) {
  await page.route('**/api/**', async route => {
    const req = route.request();
    const path = req.url().split('/api/')[1].split('?')[0];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
    calls.push({ path, body });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (path.includes('dashboard_stats')) return send(STATS);
    if (path.includes('rapport_list')) return send(RAPPORTE);
    // Seit ENT-072 traegt die Sammelabfrage nur die Listenfelder; das volle
    // Dossier kommt einzeln. Der Mock bildet genau das nach.
    if (path.includes('mitarbeiter_dossier')) {
      const n = decodeURIComponent((req.url().split('name=')[1] || '').split('&')[0]);
      const m = MA.mitarbeiter.find(x => x.name === n);
      return m ? send({ status: 'ok', mitarbeiter: m, eingerichtet: true })
               : send({ status: 'error', message: 'nicht gefunden' }, 404);
    }
    if (path.includes('anstellungsorte')) return send({ status: 'ok', orte: [] });
    if (path.includes('mitarbeiter_list')) return send(Object.assign({}, MA,
      { listen: { funktion: [], abteilung: [] }, eingerichtet: true }));
    if (path.includes('kunden_list')) return send(KU);
    if (path.includes('kunden_archivieren')) {
      const k = KU.kunden.find(x => x.id === body.id);
      if (k) k.aktiv = body.aktiv;
      return send({ status: 'ok', aktiv: body.aktiv });
    }
    // Der Login-Name kommt seit ENT-376 vom Server zurueck (er bildet ihn
    // aus Vorname/Nachname) -- ohne ihn wuesste die Oberflaeche nicht, wen
    // sie nach dem Anlegen oeffnen soll.
    if (path.includes('mitarbeiter_create')) {
      const login = `${(body && body.vorname) || ''}.${(body && body.nachname) || ''}`
        .toLowerCase().replace(/\s+/g, '');
      return send({ status: 'ok', name: login });
    }
    // Vereinheitlichter Router seit ENT-042 -- ein Endpunkt statt vier
    // einzelner Diktat-Endpunkte. Verzweigt hier im Test wie das echte KI-
    // Modell anhand des Textinhalts.
    if (path.includes('ki_router_parse')) {
      const t = (body.text || '').toLowerCase();
      if (t.includes('ändere')) return send({ status: 'ok', bereich: 'mitarbeiter', aktion: 'aendern',
        mitarbeiter_login_name: 'dario.beispiel', aenderungen: { strasse: 'Musterstrasse 1', ort: '3000 Bern' } });
      // Keine personalnummer im simulierten KI-Ergebnis (ENT-387): das
      // echte Schema in ai.php fragt sie fuer eine Neuanlage nicht mehr ab.
      if (t.includes('neuer mitarbeiter')) return send({ status: 'ok', bereich: 'mitarbeiter', aktion: 'neu', felder: {
        vorname: 'Hans', nachname: 'Muster', anrede: 'Herr',
        geburtsdatum: '1990-05-03', strasse: 'Musterweg 1', ort: '3000 Bern', mobil: '079 123 45 67' } });
      // Telefon absichtlich nicht erkannt -- prueft Hinweis auf offene Pflichtfelder
      if (t.includes('neuer kunde')) return send({ status: 'ok', bereich: 'kunde', aktion: 'neu', felder: {
        name: 'Muster Immobilien AG', strasse: 'Musterstrasse 12', ort: '4632 Trimbach', email: 'info@muster-immo.ch' } });
      return send({ status: 'error', message: 'nicht erkannt' });
    }
    // Recherche im Anlegen-Dialog selbst (ENT-042) -- unabhaengig vom Router.
    if (path.includes('ki_kunden_recherche')) return send({
      status: 'ok',
      felder: { name: 'Beispiel AG', strasse: 'Industriestrasse 4', ort: '4652 Musterdorf', telefon: '062 285 20 20' },
      recherchiert: ['strasse', 'ort', 'telefon'],
      quellen: ['https://www.zefix.ch/de/search/entity/list/firm/1234567'],
    });
    return send({ status: 'ok' });
  });
}

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await setup(page);

await page.goto(URL);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');

// ══════════ MITARBEITENDE: bearbeiten
// element.click() statt page.click(): der Knopf ist im Standard-
// Huellenzustand "aus" (Kopfleiste, ENT-407) in der Leiste selbst
// unsichtbar -- die Unterkategorien stehen dort in der Werkzeugleiste.
// element.click() loest denselben onclick aus wie ein echter Klick,
// unabhaengig vom Huellenzustand und ohne die Gruppe erst oeffnen zu muessen.
await page.evaluate(() => document.getElementById('nav-admin-mitarbeiter').click());
await page.waitForTimeout(250);
await page.waitForSelector('#maTable table');
check('Kein Diktat-Knopf mehr bei Mitarbeitenden -- Anlegen und Ändern laufen jetzt über den globalen Sprechen-Knopf (ENT-042)',
  (await page.$$('#view-mitarbeiter button:has-text("Diktat")')).length === 0);
calls = [];
// Seit ENT-048 fuehrt der Zeilenklick auf die Detailseite (Muster wie bei
// Kunden); Bearbeiten liegt dort als Knopf. Der Weg ist laenger, die
// Schublade dahinter unveraendert -- genau das pruefen die Zeilen unten.
await page.click('#maTable tbody tr:nth-child(2)');   // dario.beispiel
await page.waitForTimeout(300);
check('Zeile oeffnet die Detailseite (ENT-048)',
  await page.isVisible('#mv-detail') && !(await page.isVisible('#drawer.on')));
await page.click('#mv-detail .btn-primary');
await page.waitForSelector('#mv-bearbeiten.on');
await page.waitForTimeout(400);
check('Bearbeiten oeffnet die volle Flaeche statt einer Schublade (ENT-072)',
  await page.isVisible('#mv-bearbeiten.on') && !(await page.isVisible('#drawer.on')));
check('Titel = voller Name', (await page.textContent('#mbName')).includes('Dario Beispiel'));
check('Felder vorbefuellt', (await page.inputValue('#mb_strasse')) === 'Bahnhofstrasse 9');
check('Leeres Feld bleibt leer', (await page.inputValue('#mb_telefon')) === '');
check('Anrede-Auswahl gesetzt', (await page.inputValue('#mb_anrede')) === 'Herr');
check('Oeffnen schreibt nichts', writes().length === 0);
// Seit ENT-287 steht das Entfernen beim "Zugang" und nicht bei den
// Personalien -- ein Konto zu entfernen ist eine Zugangsfrage. Geprueft
// wird beides: dass es NICHT bei den Personalien steht und dass es auf
// dem Zugang-Reiter wirklich da ist. Nur "existiert irgendwo" waere seit
// der Aufteilung keine Aussage mehr.
check('Entfernen-Bereich steht nicht bei den Personalien',
  !(await page.isVisible('#mbKarten .zone.danger')));
await page.click('#mbtab-zugang');
await page.waitForTimeout(250);
check('Entfernen-Bereich vorhanden, beim Zugang', await page.isVisible('#mbKarten .zone.danger'));
await page.click('#mbtab-person');
await page.waitForTimeout(250);

// Speichern
await page.fill('#mb_telefon', '062 999 88 77');
await page.click('#mbSpeichern');
await page.waitForTimeout(400);
const upd = calls.find(c => c.path.includes('mitarbeiter_update'));
check('Speichern ruft mitarbeiter_update', !!upd);
check('Speichern sendet richtigen Login-Namen', upd && upd.body.name === 'dario.beispiel');
check('Speichern sendet geaenderte Nummer', upd && upd.body.telefon === '062 999 88 77');
check('Speichern sendet die alten zehn Felder weiterhin', upd && ['personalnummer','anrede','vorname','nachname','geburtsdatum','strasse','ort','telefon','mobil','email'].every(f => f in upd.body));
check('Speichern sendet auch die neuen Felder (ENT-072)',
  upd && ['ahv_nr','fachausweis','zivilstand','anstellungsort_id'].every(f => f in upd.body));
check('Nach dem Speichern steht wieder die Detailseite offen',
  await page.isVisible('#mv-detail.on') && !(await page.isVisible('#mv-bearbeiten.on')));

// Passwort -- seit ENT-072 in der Karte "Zugang" auf derselben Flaeche,
// seit ENT-287 auf deren eigenem Reiter. Passwort setzen und Konto
// entfernen liegen beide dort; ein Klick fuehrt hin, wie beim Planer.
calls = [];
await page.click('#mv-detail .btn-primary');
await page.waitForSelector('#mv-bearbeiten.on');
await page.waitForTimeout(400);
await page.click('#mbtab-zugang');
await page.waitForTimeout(250);
const setzen = () => page.click('#mbKarten .mb-bereich.on .zone button:has-text("Setzen")');

// Maskierung und Auge (ENT-291), am gerenderten Zustand gemessen.
// Bis hierher standen beide Felder auf type="text" -- wer jemandem ueber
// die Schulter sah, las das neue Passwort im Klartext mit, und bei einer
// Gegenbestaetigung stand es sogar zweimal offen da.
{
  const typ = id => page.getAttribute('#' + id, 'type');
  check('KRITISCH: beide Passwortfelder sind im Ausgangszustand maskiert',
    (await typ('maPw')) === 'password' && (await typ('maPw2')) === 'password');

  await page.fill('#maPw', 'geheimniskraemerei');
  await page.click('.pw-feld:has(#maPw) .pw-toggle');
  check('Das Auge deckt genau EIN Feld auf, nicht beide',
    (await typ('maPw')) === 'text' && (await typ('maPw2')) === 'password');
  check('Der eingegebene Wert ueberlebt das Umschalten',
    (await page.inputValue('#maPw')) === 'geheimniskraemerei');
  check('Die Beschriftung sagt jetzt das Gegenteil -- sonst liest eine Vorlesesoftware das Falsche',
    (await page.getAttribute('.pw-feld:has(#maPw) .pw-toggle', 'aria-label')) === 'Passwort verbergen');
  await page.click('.pw-feld:has(#maPw) .pw-toggle');
  check('Nochmals tippen verdeckt wieder', (await typ('maPw')) === 'password');

  // Das Auge darf nicht auf dem Text liegen: Der rechte Innenabstand des
  // Feldes muss mindestens so breit sein wie der Knopf.
  const mass = await page.evaluate(() => {
    const inp = document.getElementById('maPw');
    const btn = inp.parentElement.querySelector('.pw-toggle');
    const ri = inp.getBoundingClientRect(), rb = btn.getBoundingClientRect();
    return { polster: parseFloat(getComputedStyle(inp).paddingRight),
             breite: rb.width, hoehe: rb.height,
             innerhalb: rb.right <= ri.right + 1 && rb.top >= ri.top - 1 };
  });
  check('Der Knopf sitzt im Feld und nicht daneben', mass.innerhalb);
  check(`Das Auge verdeckt den Text nicht (Polster ${Math.round(mass.polster)} px >= Knopf ${Math.round(mass.breite)} px)`,
    mass.polster >= mass.breite);

  // Handy: mindestens 44 px Trefferflaeche (CLAUDE.md). Auf dem Handy ist
  // das Auge der einzige Weg, einen Vertipper zu finden -- ein Knopf, den
  // man nicht trifft, ist keiner.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const handy = await page.evaluate(() => {
    const b = document.getElementById('maPw').parentElement.querySelector('.pw-toggle')
      .getBoundingClientRect();
    return { w: b.width, h: b.height };
  });
  check(`KRITISCH: Auge auf dem Handy mindestens 44 px (gemessen ${Math.round(handy.w)}x${Math.round(handy.h)})`,
    handy.w >= 44 && handy.h >= 44);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(200);
  await page.fill('#maPw', '');
}

await page.fill('#maPw', 'ab');
await page.fill('#maPw2', 'ab');
await setzen();
await page.waitForTimeout(250);
check('Zu kurzes Passwort wird abgewiesen', !calls.some(c => c.path.includes('reset_password')));

// Gegenbestaetigung (ENT-289): Ein vertipptes Passwort sperrt die Person aus
// ihrem eigenen Konto aus, und gemerkt wird es erst beim naechsten Anmelden.
await page.fill('#maPw', 'blauerstuhl');
await page.fill('#maPw2', 'blauerstuhI');   // grosses i statt l -- der klassische Vertipper
await page.waitForTimeout(150);
check('KRITISCH: eine Abweichung wird schon beim Tippen benannt, nicht erst beim Setzen',
  await page.isVisible('#maPwErr')
  && /nicht überein/.test(await page.textContent('#maPwErr')));
await setzen();
await page.waitForTimeout(250);
check('KRITISCH: bei Abweichung wird NICHTS gesendet -- sonst haette die Person ein Passwort, das sie nicht kennt',
  !calls.some(c => c.path.includes('reset_password')));

await page.fill('#maPw2', 'blauerstuhl');
await page.waitForTimeout(150);
check('Stimmen beide ueberein, verschwindet die Meldung wieder',
  !(await page.isVisible('#maPwErr')));
await setzen();
await page.waitForTimeout(300);
const pw = calls.find(c => c.path.includes('reset_password'));
check('Gueltiges Passwort wird gesendet', pw && pw.body.password === 'blauerstuhl' && pw.body.name === 'dario.beispiel');
check('Beide Passwortfelder danach geleert',
  (await page.inputValue('#maPw')) === '' && (await page.inputValue('#maPw2')) === '');

// Oberflaeche und Server muessen dieselbe Mindestlaenge kennen (ENT-289).
// Laufen sie auseinander, laesst die Maske etwas zu, das der Server abweist
// -- oder schlimmer: sie verspricht eine Strenge, die es nicht gibt. Genau
// so ein Fall lag in app.html: Der Text sagte "mindestens 12 Zeichen",
// geprueft wurden 6.
{
  const { readFileSync } = await import('fs');
  const html = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
  const php  = readFileSync(`${WURZEL}/backend/anmeldung.php`, 'utf8');
  const zahl = (text, muster) => { const m = text.match(muster); return m ? Number(m[1]) : null; };
  const jsMin    = zahl(html, /const PW_MIN\s*=\s*(\d+)/);
  const jsAdmin  = zahl(html, /PW_MIN_ADMIN\s*=\s*(\d+)/);
  const phpMin   = zahl(php,  /const PASSWORT_MIN\s*=\s*(\d+)/);
  const phpAdmin = zahl(php,  /const PASSWORT_MIN_ADMIN\s*=\s*(\d+)/);
  check('KRITISCH: Oberflaeche und Server verlangen dieselbe Passwortlaenge',
    jsMin !== null && jsMin === phpMin && jsAdmin !== null && jsAdmin === phpAdmin);
  // Die Platzhalter selbst stehen nicht mehr hier: Seit ENT-291 setzen sie
  // die Zahl aus PW_MIN ein, statt sie abzuschreiben. Eine Suche nach
  // Ziffern faende hier also gar nichts mehr und waere still gruen. Wer
  // NENNT welche Zahl, prueft darum test_passwortfelder.mjs ueber alle vier
  // Oberflaechen -- inklusive index.html, die genau hier durchgerutscht ist.
  check('Die Mindestlaenge steht nicht mehrfach abgeschrieben in der Maske',
    !/placeholder="mind\.? \d+ Zeichen"/.test(html));
}

// Entfernen mit Rueckfrage
calls = [];
await page.click('#mbKarten .zone.danger .btn-danger');
await page.waitForSelector('#dlgConfirm.on');
check('Entfernen fragt zuerst nach', await page.isVisible('#dlgConfirm.on'));
check('Rueckfrage schreibt noch nichts', writes().length === 0);
await page.click('#dlgConfirm .btn-plain');   // Abbrechen
await page.waitForTimeout(200);
check('Abbrechen schreibt nichts', writes().length === 0);
await page.click('#mbKarten .zone.danger .btn-danger');
await page.waitForSelector('#dlgConfirm.on');
await page.click('#cfBtn');
await page.waitForTimeout(500);
const deact = calls.find(c => c.path.includes('deactivate'));
check('Bestaetigen deaktiviert den richtigen Namen', deact && deact.body.name === 'dario.beispiel');
check('KRITISCH: nach dem Entfernen steht die Liste offen, keine leere Detailseite',
  await page.isVisible('#mv-liste.on'));

// Eigenes Konto: kein Entfernen
await page.click('#maTable tbody tr:nth-child(1)');   // adrian = eigenes Konto
await page.waitForTimeout(250);
await page.click('#mv-detail .btn-primary');
await page.waitForSelector('#mv-bearbeiten.on');
await page.waitForTimeout(400);
check('Eigenes Konto ohne Entfernen-Bereich', (await page.$$('#mbKarten .zone.danger')).length === 0);
await page.click('#mv-bearbeiten .btn-plain');   // Abbrechen
await page.waitForTimeout(300);

// ══════════ MITARBEITENDE: neu anlegen
calls = [];
// "Neuer Mitarbeitender" gehoert seit ENT-048 zur Liste und ist auf der
// Detailseite ausgeblendet -- also zuerst dorthin zurueck.
await page.evaluate(() => maGoTab('liste'));
await page.waitForTimeout(200);
// Seit ENT-072 fuehrt "Neuer Mitarbeitender" auf dieselbe Flaeche wie
// "Bearbeiten" -- ein zweites, kuerzeres Formular gibt es nicht mehr.
await page.click('button:has-text("Neuer Mitarbeitender")');
await page.waitForSelector('#mv-bearbeiten.on');
await page.waitForTimeout(500);
check('Anlegen oeffnet die volle Flaeche, keinen Dialog',
  await page.isVisible('#mv-bearbeiten.on') && (await page.$$('#dlgMaNeu')).length === 0);
check('Titel ohne Diktat', (await page.textContent('#mbName')) === 'Neuer Mitarbeitender');
check('Kein Diktat-Hinweis ohne Diktat', (await page.textContent('#mbKi')).trim() === '');
check('Der Knopf sagt "anlegen", nicht "speichern"',
  (await page.textContent('#mbSpeichern')).includes('anlegen'));
await page.click('#mbSpeichern');
await page.waitForTimeout(200);
check('Ohne Vorname/Nachname kein Anlegen', writes().length === 0 && await page.isVisible('#mbErr'));
// Seit ENT-376 gibt es kein Login-Name-Feld mehr -- er wird aus Vorname und
// Nachname gebildet.
await page.fill('#mb_vorname', 'Hans');
await page.fill('#mb_nachname', 'Muster');
await page.waitForTimeout(150);
check('Der Login-Name wird schon vor dem Speichern angezeigt',
  (await page.inputValue('#mbNeuName')) === 'hans.muster');
await page.fill('#mbNeuPass', '123');
await page.click('#mbSpeichern');
await page.waitForTimeout(200);
check('Zu kurzes Passwort kein Anlegen', writes().length === 0);
await page.fill('#mbNeuPass', 'blauerstuhlamsee');
// Seit ENT-077 gibt es kein Admin-Haekchen mehr, sondern Rollen.
await page.check('#mbNeuRolle_verwaltung');
await page.click('#mbSpeichern');
await page.waitForTimeout(600);
const cr = calls.find(c => c.path.includes('mitarbeiter_create'));
check('Anlegen sendet Vorname, Nachname und Passwort',
  cr && cr.body.vorname === 'Hans' && cr.body.nachname === 'Muster' && cr.body.password === 'blauerstuhlamsee');
check('KRITISCH: der Login-Name kommt nicht vom Client -- der Server bildet ihn (ENT-376)',
  cr && !('name' in cr.body));
check('Die gewählte Rolle geht mit (ENT-077)',
  cr && Array.isArray(cr.body.rollen) && cr.body.rollen.includes('verwaltung'));
check('Detailfeld wird mitgesendet', cr && cr.body.vorname === 'Hans');
check('Auch die neuen Felder gehen beim Anlegen mit (ENT-072)',
  cr && ['ahv_nr', 'fachausweis', 'zivilstand', 'anstellungsort_id'].every(f => f in cr.body));
check('Die Anlegen-Flaeche schliesst nach dem Anlegen', !(await page.isVisible('#mv-bearbeiten.on')));

// ══════════ DIKTAT: Mitarbeiter anlegen -- über den globalen Sprechen-Knopf
// (ENT-042). Der eigene Diktat-Knopf ist weg, der Router deckt dieselbe
// Neuanlage ab wie zuvor der Einzel-Diktat.
calls = [];
await page.click('#btnSprechen');
await page.waitForSelector('#dlgSprechen.on');
await page.click('#gsBtn');
await page.waitForTimeout(200);
check('Leeres Diktat wird abgewiesen', !calls.some(c => c.path.includes('ki_router_parse')));
await page.fill('#gsText', 'Neuer Mitarbeiter Hans Muster, geboren am 3. Mai 1990');
await page.click('#gsBtn');
await page.waitForSelector('#mv-bearbeiten.on');
await page.waitForTimeout(500);
check('Diktat oeffnet dieselbe Flaeche zur Pruefung', await page.isVisible('#mv-bearbeiten.on'));
check('KRITISCH: Diktat speichert nichts', writes().length === 0);
check('Titel benennt die Neuanlage', (await page.textContent('#mbName')) === 'Neuer Mitarbeitender');
check('Diktat-Hinweis sichtbar', await page.isVisible('#mbKi .ki-hint.on'));
check('Der Hinweis sagt, dass das Passwort selbst zu setzen ist',
  /Passwort musst du selbst setzen/.test(await page.textContent('#mbKi')));
check('Vorname uebernommen', (await page.inputValue('#mb_vorname')) === 'Hans');
check('KRITISCH: die Personalnummer bleibt leer -- sie wird erst beim Anlegen automatisch vergeben (ENT-387)',
  (await page.inputValue('#mb_personalnummer')) === '');
check('Das Personalnummer-Feld ist gesperrt, auch auf der Anlegen-Flaeche', await page.isDisabled('#mb_personalnummer'));
check('Geburtsdatum uebernommen', (await page.inputValue('#mb_geburtsdatum')) === '1990-05-03');
check('Login-Name aus dem Diktat gebildet', (await page.inputValue('#mbNeuName')) === 'hans.muster');
check('Passwort NICHT vorbelegt', (await page.inputValue('#mbNeuPass')) === '');
check('Erkannte Felder blau markiert', (await page.$$('#mbKarten .inp.ki')).length >= 5);
check('Nicht erkanntes Feld unmarkiert', !(await page.getAttribute('#mb_telefon', 'class')).includes('ki'));
await page.click('#mbSpeichern');
await page.waitForTimeout(250);
check('Ohne Passwort kein Anlegen trotz Diktat', writes().length === 0);
await page.fill('#mbNeuPass', 'blauerstuhlamsee');
await page.click('#mbSpeichern');
await page.waitForTimeout(600);
const cr2 = calls.find(c => c.path.includes('mitarbeiter_create'));
check('Erst nach Klick wird angelegt', !!cr2);
check('Genau ein Schreibaufruf', writes().length === 1);
check('Diktatfelder landen im Aufruf', cr2 && cr2.body.mobil === '079 123 45 67');
check('KRITISCH: "3000 Bern" wird auch beim Anlegen in PLZ und Ort getrennt',
  cr2 && cr2.body.plz === '3000' && cr2.body.ort === 'Bern');
await page.screenshot({ path: `${OUT}/10-diktat-pruefen.png` });

// ══════════ DIKTAT: Mitarbeiter ändern -- ebenfalls über den globalen
// Sprechen-Knopf (ENT-042, neu): der Router erkennt jetzt auch eine
// AENDERUNG an einer bestehenden Person und öffnet die Bearbeiten-Schublade
// statt eines "Neu"-Dialogs.
calls = [];
await page.click('#btnSprechen');
await page.waitForSelector('#dlgSprechen.on');
await page.fill('#gsText', 'Ändere die Adresse von Dario Beispiel zu Musterstrasse 1');
await page.click('#gsBtn');
await page.waitForSelector('#mv-bearbeiten.on');
await page.waitForTimeout(400);
check('Diktat oeffnet die Bearbeitungsflaeche statt eines Neu-Dialogs', await page.isVisible('#mv-bearbeiten.on'));
check('KRITISCH: Aenderung speichert nichts', writes().length === 0);
check('Neue Strasse eingesetzt', (await page.inputValue('#mb_strasse')) === 'Musterstrasse 1');
// Seit ENT-072 sind PLZ und Ort zwei Felder. Ein Sprachmodell liefert sie
// trotzdem zusammen -- die Flaeche muss das trennen, sonst stuende eine alte
// PLZ neben einem neuen Ort.
check('KRITISCH: "3000 Bern" wird in PLZ und Ort getrennt',
  (await page.inputValue('#mb_plz')) === '3000' && (await page.inputValue('#mb_ort')) === 'Bern');
check('Unveraenderte Felder bleiben', (await page.inputValue('#mb_vorname')) === 'Dario');
check('Geaenderte Felder markiert', (await page.$$('#mbKarten .inp.ki')).length === 3);
check('Diktat-Hinweis steht ueber der Flaeche', await page.isVisible('#mbKi .ki-hint.on'));
check('Hinweis nennt Beschriftungen statt Feldnamen',
  /Strasse/.test(await page.textContent('#mbKi')) && /Ort/.test(await page.textContent('#mbKi')));
await page.screenshot({ path: `${OUT}/11-diktat-aendern.png`, fullPage: true });
await page.click('#mbSpeichern');
await page.waitForTimeout(400);
const upd2 = calls.find(c => c.path.includes('mitarbeiter_update'));
check('Erst nach Speichern-Klick geschrieben', upd2 && upd2.body.strasse === 'Musterstrasse 1');
check('Getrennte PLZ und Ort gehen so an den Server',
  upd2 && upd2.body.plz === '3000' && upd2.body.ort === 'Bern');

// ══════════ KUNDEN
await page.click('#nav-kunden');
await page.waitForSelector('#kuTable table');
calls = [];
await page.click('button:has-text("Neuer Kunde")');
await page.waitForSelector('#dlgKunde.on');
await page.fill('#ku_name', 'Testkunde AG');
await page.click('#kuBtn');
await page.waitForTimeout(200);
check('Kunde ohne Pflichtfelder wird abgewiesen', writes().length === 0 && await page.isVisible('#kuErr'));
await page.fill('#ku_strasse', 'Teststrasse');
await page.fill('#ku_hausnummer', '1');
await page.fill('#ku_plz', '4600');
await page.fill('#ku_ort', 'Olten');
// Telefon ist seit ENT-044 kein eigenes Feld mehr, sondern eine
// Kommunikationszeile -- und auch kein Pflichtfeld mehr.
await page.fill('#kuWegeListe .kw-reihe:nth-child(2) [data-kw="wert"]', '062 000 00 00');
await page.click('#kuBtn');
await page.waitForTimeout(400);
const kc = calls.find(c => c.path.includes('kunden_create'));
check('Kunde wird mit allen Pflichtfeldern angelegt',
  kc && kc.body.name === 'Testkunde AG' && kc.body.plz === '4600' && kc.body.ort === 'Olten');
check('Hausnummer getrennt uebergeben', kc && kc.body.strasse === 'Teststrasse' && kc.body.hausnummer === '1');
check('Telefon als Kommunikationszeile statt als Feld', kc
  && kc.body.kontaktwege.some(w => w.art === 'telefon' && w.wert === '062 000 00 00'));
check('Art wird mitgegeben', kc && kc.body.art === 'unternehmen');
check('Leere Kommunikationszeilen gehen gar nicht erst mit', kc && kc.body.kontaktwege.length === 1);
check('Leere Kontaktperson geht gar nicht erst mit',
  kc && kc.body.personen.every(p => p.vorname || p.nachname || p.kontaktwege.length));

// Klick auf eine Zeile fuehrt seit ENT-040 auf die Detailseite, nicht mehr
// direkt in die Bearbeiten-Schublade.
await page.click('#kuTable tbody tr:first-child');
await page.waitForTimeout(250);
check('Zeile oeffnet die Detailseite statt der Schublade', await page.evaluate(() => document.getElementById('kv-detail').classList.contains('on')));
check('Detailseite zeigt den Kundennamen', (await page.textContent('#kdName')) === 'Muster Immobilien AG');
check('Detailseite zeigt die Kundennummer', (await page.textContent('#kdSub')).includes('K0001'));

// Bearbeiten läuft seit ENT-044 durch denselben Dialog wie das Anlegen --
// die frühere zweite Kundenmaske in der Schublade gibt es nicht mehr.
calls = [];
await page.click('#kv-detail button:has-text("Bearbeiten")');
await page.waitForSelector('#dlgKunde.on');
await page.waitForTimeout(250);
check('Bearbeiten oeffnet denselben Dialog mit den Kundendaten', (await page.inputValue('#ku_name')) === 'Muster Immobilien AG');
check('Bearbeiten zeigt die vergebene Kundennummer', (await page.inputValue('#ku_kundennummer')) === 'K0001');
check('Kundennummer bleibt auch beim Bearbeiten unveraenderlich',
  (await page.getAttribute('#ku_kundennummer', 'readonly')) !== null);
check('Keine zweite Kundenmaske mehr in der Schublade', !(await page.isVisible('#drawer.on')));
check('Archivieren steht beim Bearbeiten zur Verfuegung', await page.isVisible('#kuArchivZone'));
check('Bestehende Kommunikationszeilen geladen',
  (await page.inputValue('#kuWegeListe .kw-reihe:nth-child(1) [data-kw="wert"]')) === '062 111 22 33');
await page.fill('#ku_ort', '');
await page.click('#kuBtn');
await page.waitForTimeout(250);
check('Kunde ohne Ort wird nicht gespeichert', !calls.some(c => c.path.includes('kunden_update')));
await page.fill('#ku_ort', 'Trimbach');
await page.fill('#kuWegeListe .kw-reihe:nth-child(1) [data-kw="wert"]', '062 111 00 00');
await page.click('#kuBtn');
await page.waitForTimeout(400);
const ku = calls.find(c => c.path.includes('kunden_update'));
check('Kunde wird mit id gespeichert', ku && ku.body.id === 1
  && ku.body.kontaktwege.some(w => w.wert === '062 111 00 00'));

// Archivieren statt endgueltigem Loeschen (ENT-040) -- Objekte, Einsaetze und
// Rapporte bleiben unangetastet, der Kunde verschwindet nur aus der aktiven Auswahl.
calls = [];
await page.click('#kdArchivBtn');
await page.waitForTimeout(400);
const karch = calls.find(c => c.path.includes('kunden_archivieren'));
check('Archivieren ruft den Archivieren-Endpunkt auf', karch && karch.body.id === 1 && karch.body.aktiv === 0);
check('Kein Loeschen mehr moeglich', !calls.some(c => c.path.includes('kunden_delete')));
check('Bleibt nach dem Archivieren auf der Detailseite', await page.evaluate(() => document.getElementById('kv-detail').classList.contains('on')));
check('Status zeigt archiviert an', (await page.textContent('#kdSub')).includes('archiviert'));
check('Knopf bietet jetzt das Wiederherstellen an', (await page.textContent('#kdArchivBtn')) === 'Wiederherstellen');
await page.click('#kv-detail .ku-zurueck');   // seit ENT-048 gibt es die Klasse auch im Mitarbeiterbereich
await page.waitForTimeout(200);

// ══════════ DIKTAT: Kunde anlegen -- über den globalen Sprechen-Knopf (ENT-042)
await page.click('#nav-kunden');
await page.waitForSelector('#kuTable table');
calls = [];
await page.click('#btnSprechen');
await page.waitForSelector('#dlgSprechen.on');
await page.fill('#gsText', 'Neuer Kunde Muster Immobilien AG, Musterstrasse 12, 4632 Trimbach');
await page.click('#gsBtn');
await page.waitForSelector('#dlgKunde.on');
await page.waitForTimeout(300);
check('Kunden-Diktat oeffnet das Pruef-Formular', await page.isVisible('#dlgKunde.on'));
check('KRITISCH: Kunden-Diktat speichert nichts', writes().length === 0);
check('Kunden-Titel weist auf Pruefung hin', (await page.textContent('#kuTitel')).includes('prüfen'));
check('Kundenname uebernommen', (await page.inputValue('#ku_name')) === 'Muster Immobilien AG');
check('Strasse uebernommen', (await page.inputValue('#ku_strasse')) === 'Musterstrasse 12');
// Das Diktat liefert "4632 Trimbach" in einem Stück -- der Dialog trennt es
// selbst, weil der Kundenstamm seit ENT-044 zwei Felder führt.
check('PLZ aus dem Diktat herausgeloest', (await page.inputValue('#ku_plz')) === '4632');
check('Ort ohne PLZ uebernommen', (await page.inputValue('#ku_ort')) === 'Trimbach');
check('E-Mail landet in einer Kommunikationszeile',
  (await page.inputValue('#kuWegeListe .kw-reihe:nth-child(1) [data-kw="wert"]')) === 'info@muster-immo.ch');
check('Nicht erkanntes Telefon bleibt leer',
  (await page.inputValue('#kuWegeListe .kw-reihe:nth-child(2) [data-kw="wert"]')) === '');
check('Erkannte Kundenfelder blau markiert',
  (await page.getAttribute('#ku_name', 'class')).includes('ki')
  && (await page.getAttribute('#ku_plz', 'class')).includes('ki')
  && (await page.getAttribute('#kuWegeListe .kw-reihe:nth-child(1) [data-kw="wert"]', 'class')).includes('ki'));
check('Telefonzeile unmarkiert',
  !(await page.getAttribute('#kuWegeListe .kw-reihe:nth-child(2) [data-kw="wert"]', 'class')).includes('ki'));
const kuHint = await page.textContent('#kuKiText');
check('Hinweis nennt uebernommene Felder', kuHint.includes('Name, Strasse, PLZ, Ort, E-Mail'));
check('Kein offenes Pflichtfeld mehr -- Telefon ist seit ENT-044 freiwillig',
  !kuHint.includes('Noch offen als Pflichtfeld'));
await page.fill('#kuWegeListe .kw-reihe:nth-child(2) [data-kw="wert"]', '062 111 22 33');
await page.click('#kuBtn');
await page.waitForTimeout(400);
const kcd = calls.find(c => c.path.includes('kunden_create'));
check('Kunde erst nach Klick angelegt', kcd && kcd.body.name === 'Muster Immobilien AG');
check('Genau ein Schreibaufruf beim Kunden-Diktat', writes().length === 1);
check('Diktat- und Handeingabe zusammen gesendet', kcd
  && kcd.body.kontaktwege.some(w => w.art === 'telefon' && w.wert === '062 111 22 33')
  && kcd.body.kontaktwege.some(w => w.art === 'email' && w.wert === 'info@muster-immo.ch'));
await page.screenshot({ path: `${OUT}/13-diktat-kunde.png` });
// Ohne Diktat bleibt der Dialog sauber
await page.click('#view-kunden button:has-text("Neuer Kunde")');
await page.waitForSelector('#dlgKunde.on');
check('Handeingabe ohne Diktat-Hinweis', !(await page.isVisible('#kuKiHint')));
check('Handeingabe ohne blaue Markierungen', (await page.$$('#dlgKunde .inp.ki')).length === 0);
check('Handeingabe mit leeren Feldern', (await page.inputValue('#ku_name')) === '');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ══════════ KUNDEN-RECHERCHE (Websuche) -- seit ENT-042 ein Knopf im
// Anlegen-Dialog selbst statt eines Häkchens im separaten Diktat-Dialog.
// Ergänzt nur leere Felder, was schon eingetragen ist, bleibt unangetastet.
calls = [];
await page.click('#view-kunden button:has-text("Neuer Kunde")');
await page.waitForSelector('#dlgKunde.on');
check('Kein Diktat-Hinweis vor jeder Eingabe', !(await page.isVisible('#kuKiHint')));
await page.click('#kuRechercheBtn');
await page.waitForTimeout(200);
check('Ohne Namen keine Recherche', !calls.some(c => c.path.includes('ki_kunden_recherche')));
await page.fill('#ku_name', 'Beispiel AG');
await page.click('#kuRechercheBtn');
await page.waitForSelector('#kuKiHint.on');
await page.waitForTimeout(300);
check('Recherche ruft den Recherche-Endpunkt', calls.some(c => c.path.includes('ki_kunden_recherche')));
check('KRITISCH: Recherche speichert nichts', writes().length === 0);
check('Von Hand eingegebener Name bleibt unangetastet', (await page.inputValue('#ku_name')) === 'Beispiel AG');
check('Recherchierte Adresse uebernommen', (await page.inputValue('#ku_strasse')) === 'Industriestrasse 4');
check('Recherchierte PLZ herausgeloest', (await page.inputValue('#ku_plz')) === '4652');
check('Recherchierter Ort ohne PLZ', (await page.inputValue('#ku_ort')) === 'Musterdorf');
check('Recherchiertes Telefon landet in einer Kommunikationszeile',
  (await page.inputValue('#kuWegeListe .kw-reihe:nth-child(2) [data-kw="wert"]')) === '062 285 20 20');
check('Name bleibt unmarkiert -- eingegeben, nicht recherchiert', !(await page.getAttribute('#ku_name', 'class') || '').includes('web'));
check('Recherchiertes Feld gelb markiert', (await page.getAttribute('#ku_strasse', 'class')).includes('web'));
check('Auch die herausgeloeste PLZ gilt als recherchiert', (await page.getAttribute('#ku_plz', 'class')).includes('web'));
check('Genau 4 gelbe Felder (Strasse, PLZ, Ort, Telefonzeile)', (await page.$$('#dlgKunde .inp.web')).length === 4);
check('Leere Zeile unmarkiert',
  !((await page.getAttribute('#kuWegeListe .kw-reihe:nth-child(1) [data-kw="wert"]', 'class')) || '').match(/\b(ki|web)\b/));
const rHint = await page.textContent('#kuKiText');
check('Hinweis nennt aus dem Netz ergaenzte Felder', rHint.includes('aus dem Netz ergänzt'));
check('Hinweis fordert Pruefung', rHint.includes('bitte prüfen'));
check('Hinweisbereich gelb eingefaerbt', (await page.getAttribute('#kuKiHint', 'class')).includes('web'));
const src = await page.getAttribute('#kuKiText a', 'href');
check('Quelle als anklickbarer Link', src === 'https://www.zefix.ch/de/search/entity/list/firm/1234567');
check('Quelle oeffnet in neuem Tab', (await page.getAttribute('#kuKiText a', 'target')) === '_blank');
check('Quelle mit noopener abgesichert', (await page.getAttribute('#kuKiText a', 'rel')).includes('noopener'));
await page.screenshot({ path: `${OUT}/14-recherche-kunde.png` });
await page.click('#kuBtn');
await page.waitForTimeout(400);
const rc = calls.find(c => c.path.includes('kunden_create'));
check('Erst nach Klick angelegt', !!rc);
check('Recherchierte Werte landen im Aufruf', rc && rc.body.strasse === 'Industriestrasse 4'
  && rc.body.plz === '4652' && rc.body.kontaktwege.some(w => w.wert === '062 285 20 20'));
check('Genau ein Schreibaufruf bei Recherche', writes().length === 1);

await page.evaluate(() => { go('kunden'); kuGoTab('rapporte'); });
await page.waitForSelector('#rapporteTable table');

// ══════════ RAPPORT LOESCHEN
await page.evaluate(() => { go('kunden'); kuGoTab('rapporte'); });
await page.waitForSelector('#rapporteTable table');
calls = [];
await page.click('#rapporteTable tbody tr:first-child');
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(250);
// Seit ENT-399 kommen "Herunterladen" und "Teilen" dazu (Anruf-Szenario,
// direkter PDF-Weg ohne den Systemdruckdialog) -- macht aus den bisher zwei
// Knoepfen vier. "Loeschen" wird seither ueber die eigene ID angeklickt,
// nicht mehr ueber ".btn-plain": Das traf zuvor eindeutig nur "Loeschen",
// seit den beiden neuen Knoepfen (dieselbe Klasse) waere es mehrdeutig.
check('Rapport-Schublade hat Herunterladen, Teilen, Drucken und Loeschen', (await page.$$('#drFoot button')).length === 4);
await page.click('#drDeleteBtn');
await page.waitForSelector('#dlgConfirm.on');
check('Rapport-Loeschen fragt nach', await page.isVisible('#dlgConfirm.on'));
check('Rueckfrage nennt die Nummer', (await page.textContent('#cfText')).includes('284'));
await page.click('#cfBtn');
await page.waitForTimeout(400);
const rd = calls.find(c => c.path.includes('rapport_delete'));
check('Rapport wird mit id geloescht', rd && rd.body.id === 284);

// ══════════ BEDIENUNG
// element.click() statt page.click(): der Knopf ist im Standard-
// Huellenzustand "aus" (Kopfleiste, ENT-407) in der Leiste selbst
// unsichtbar -- die Unterkategorien stehen dort in der Werkzeugleiste.
// element.click() loest denselben onclick aus wie ein echter Klick,
// unabhaengig vom Huellenzustand und ohne die Gruppe erst oeffnen zu muessen.
await page.evaluate(() => document.getElementById('nav-admin-mitarbeiter').click());
await page.waitForTimeout(250);
await page.waitForSelector('#maTable table');
// "Neuer Mitarbeitender" gehoert seit ENT-048 zur Liste und ist auf der
// Detailseite ausgeblendet -- also zuerst dorthin zurueck.
await page.evaluate(() => maGoTab('liste'));
await page.waitForTimeout(200);
// Der Mitarbeiter-Dialog ist seit ENT-072 weg; geprueft wird die Tastatur,
// nicht sein Inhalt -- der Feiertags-Dialog leistet dasselbe.
await page.evaluate(() => openDlg('dlgFeiertage'));
await page.waitForSelector('#dlgFeiertage.on');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Escape schliesst den Dialog', !(await page.isVisible('#dlgFeiertage.on')));
// Die Escape-Reihenfolge braucht eine offene Schublade. Fuer Mitarbeitende
// gibt es seit ENT-072 keine mehr -- die Rapport-Schublade tut es genauso,
// geprueft wird ja der Tastaturweg und nicht der Inhalt.
await page.evaluate(() => { go('kunden'); kuGoTab('rapporte'); });
await page.waitForSelector('#rapporteTable table');
await page.click('#rapporteTable tbody tr:first-child');
await page.waitForSelector('#drawer.on');
check('Werkzeugleiste bei offener Schublade abgeschirmt',
  await page.evaluate(() => getComputedStyle(document.getElementById('scrim')).pointerEvents !== 'none'));
await page.evaluate(() => openDlg('dlgFeiertage'));   // zweiter Dialog bei offener Schublade
await page.waitForSelector('#dlgFeiertage.on');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Escape schliesst erst den Dialog, nicht die Schublade', await page.isVisible('#drawer.on'));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Zweites Escape schliesst die Schublade', !(await page.isVisible('#drawer.on')));
// element.click() statt page.click(): der Knopf ist im Standard-
// Huellenzustand "aus" (Kopfleiste, ENT-407) in der Leiste selbst
// unsichtbar -- die Unterkategorien stehen dort in der Werkzeugleiste.
// element.click() loest denselben onclick aus wie ein echter Klick,
// unabhaengig vom Huellenzustand und ohne die Gruppe erst oeffnen zu muessen.
await page.evaluate(() => document.getElementById('nav-admin-mitarbeiter').click());
await page.waitForTimeout(250);
await page.waitForSelector('#maTable table');

// Kein Seiten-Scroll -- fuer den Dialog wie fuer die Anlegen-Flaeche. Beide
// muessen auf 390 px auskommen, ohne dass die Seite seitlich wandert.
for (const w of [390, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.evaluate(() => openDlg('dlgFeiertage'));
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: document.documentElement.clientWidth }));
  check(`Kein Seiten-Scroll mit Dialog bei ${w}px`, r.s <= r.i + 1);
  await page.evaluate(() => closeDlg('dlgFeiertage'));
  await page.evaluate(() => { go('mitarbeiter'); mbNeu(); });
  await page.waitForTimeout(400);
  const r2 = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: document.documentElement.clientWidth }));
  check(`Kein Seiten-Scroll auf der Anlegen-Flaeche bei ${w}px`, r2.s <= r2.i + 1);
  await page.evaluate(() => mbAbbrechen());
  await page.waitForTimeout(200);
}
await page.setViewportSize({ width: 1440, height: 1000 });
await page.evaluate(() => { go('mitarbeiter'); mbNeu(); });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/12-neuer-mitarbeiter.png`, fullPage: true });

await browser.close();

console.log(`\n✅ BESTANDEN (${ok.length})`);
ok.forEach(t => console.log('   · ' + t));
if (bad.length) { console.log(`\n❌ FEHLGESCHLAGEN (${bad.length})`); bad.forEach(t => console.log('   · ' + t)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
