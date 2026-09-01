import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';


const URL = `file://${WURZEL}/dashboard.html`;

const STATS = {
  status: 'ok', stand: '2026-08-17T18:00:00+02:00',
  kpi: { rapporte_monat: 47, rapporte_vormonat: 39, stunden_monat: 386.25, stunden_vormonat: 341.0,
         mitarbeiter: 5, kunden: 12, rapporte_total: 284 },
  verlauf: [
    { kw: 26, von: '2026-06-22', stunden: 88.5, anzahl: 11 },
    { kw: 27, von: '2026-06-29', stunden: 102.0, anzahl: 13 },
    { kw: 28, von: '2026-07-06', stunden: 76.25, anzahl: 9 },
    { kw: 29, von: '2026-07-13', stunden: 0, anzahl: 0 },
    { kw: 30, von: '2026-07-20', stunden: 121.5, anzahl: 15 },
    { kw: 31, von: '2026-07-27', stunden: 95.0, anzahl: 12 },
    { kw: 32, von: '2026-08-03', stunden: 133.75, anzahl: 17 },
    { kw: 33, von: '2026-08-10', stunden: 108.5, anzahl: 14 }
  ],
  angemeldet: [
    { name: 'adrian', vorname: 'Adrian', nachname: 'Muster', letzte_anmeldung: '2026-08-17 17:53:00', sitzungen: 2 },
    { name: 'dario.beispiel', vorname: 'Dario', nachname: 'Beispiel', letzte_anmeldung: '2026-08-17 06:12:00', sitzungen: 1 }
  ],
  pro_mitarbeiter: [
    { name: 'dario.beispiel', vorname: 'Dario', nachname: 'Beispiel', stunden: '142.50', anzahl: 18 },
    { name: 'adrian', vorname: 'Adrian', nachname: 'Muster', stunden: '96.00', anzahl: 12 },
    { name: 'm.muster', vorname: 'Marco', nachname: 'Muster', stunden: '88.75', anzahl: 11 },
    { name: 'neu', vorname: 'Sara', nachname: 'Beispiel', stunden: '0.00', anzahl: 0 }
  ],
  letzte_rapporte: [
    { id: 284, datum: '2026-08-17', mitarbeiter: 'dario.beispiel', kunde: 'Muster Immobilien AG', ort: '4632 Trimbach', einsatzart: 'Verkehrsdienst', netto_h: '8.50' },
    { id: 283, datum: '2026-08-16', mitarbeiter: 'adrian', kunde: 'Einwohnergemeinde Musterdorf', ort: '5013 Musterdorf', einsatzart: 'Revierdienst', netto_h: '6.00' },
    { id: 282, datum: '2026-08-15', mitarbeiter: 'm.muster', kunde: 'Muster Immobilien AG', ort: '4632 Trimbach', einsatzart: 'Verkehrsdienst', netto_h: '7.25' }
  ]
};

const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAYAAACqNX6+AAAAOklEQVR4nO3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwbXwAAAd0i9wAAAAAASUVORK5CYII=';

const RAPPORTE = {
  status: 'ok',
  rapporte: [
    { id: 284, einsatz_id: 501, datum: '2026-08-17', mitarbeiter: 'dario.beispiel', kunde: 'Muster Immobilien AG', strasse: 'Musterstrasse 12', ort: '4632 Trimbach', auftrag_nr: 'A-2026-118', einsatzart: 'Verkehrsdienst', von: '07:00:00', bis: '16:00:00', pause_min: 30, netto_h: '8.50', unterzeichner: 'R. Muster', unterschrift: SIG, bemerkung: 'Baustellenverkehr wie vereinbart geregelt.', erfasst_am: '2026-08-17 16:12:00' },
    { id: 283, einsatz_id: 502, datum: '2026-08-16', mitarbeiter: 'adrian', kunde: 'Einwohnergemeinde Musterdorf', strasse: 'Dorfstrasse 4', ort: '5013 Musterdorf', auftrag_nr: null, einsatzart: 'Revierdienst', von: '22:00:00', bis: '04:00:00', pause_min: 0, netto_h: '6.00', unterzeichner: null, unterschrift: null, bemerkung: null, erfasst_am: '2026-08-16 04:20:00' },
    { id: 282, einsatz_id: 503, datum: '2026-08-15', mitarbeiter: 'm.muster', kunde: 'Muster Immobilien AG', strasse: 'Musterstrasse 12', ort: '4632 Trimbach', auftrag_nr: 'A-2026-117', einsatzart: 'Verkehrsdienst', von: '08:00:00', bis: '15:45:00', pause_min: 30, netto_h: '7.25', unterzeichner: 'M. Frei', unterschrift: null, bemerkung: null, erfasst_am: '2026-08-15 16:02:00' }
  ]
};

const MA = { status: 'ok', mitarbeiter: [
  { name: 'adrian', ist_admin: 1, personalnummer: '1001', anrede: 'Herr', vorname: 'Adrian', nachname: 'Muster', geburtsdatum: '1988-04-12', strasse: 'Musterstrasse 1', ort: '4632 Trimbach', telefon: '062 555 11 22', mobil: '079 555 11 22', email: 'a.vonarb@cupi24.ch' },
  { name: 'dario.beispiel', ist_admin: 0, personalnummer: '1002', anrede: 'Herr', vorname: 'Dario', nachname: 'Beispiel', geburtsdatum: null, strasse: 'Bahnhofstrasse 9', ort: '4600 Olten', telefon: null, mobil: '079 444 33 22', email: null },
  { name: 'neu', ist_admin: 0, personalnummer: null, anrede: null, vorname: null, nachname: null, geburtsdatum: null, strasse: null, ort: null, telefon: null, mobil: null, email: null }
]};

const KU = { status: 'ok', kunden: [
  { id: 1, name: 'Muster Immobilien AG', strasse: 'Musterstrasse 12', ort: '4632 Trimbach', telefon: '062 111 22 33', email: 'info@muster-immo.ch' },
  { id: 2, name: 'Einwohnergemeinde Musterdorf', strasse: 'Dorfstrasse 4', ort: '5013 Musterdorf', telefon: '062 849 00 00', email: null }
]};

const calls = [];
let berichtRufe = [];

async function setup(page, { admin = true } = {}) {
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    calls.push(url.split('/api/')[1]);
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('login.php'))            return send({ status: 'ok', token: 'tok', name: 'adrian', ist_admin: admin });
    // Volle Rechteliste eines echten Admin-Kontos (NAV_RECHTE-Werte) -- sonst
    // sperrt rechteAnwenden() nach dieser Antwort die Admin-Navigation, die
    // Abschnitt 8 weiter unten noch braucht. Vor ENT-178 blieb me.php hier
    // unbeantwortet (me === null), rechteAnwenden() lief darum nie und die
    // Navigation stand offen -- der Mock muss das jetzt aktiv nachbilden.
    if (url.includes('me.php'))               return send({ status: 'ok', name: 'adrian', ist_admin: admin, rollen: [],
      rechte: admin ? ['kunden', 'abgleich', 'personal_lesen', 'betrieb', 'plan'] : [] });
    if (url.includes('dashboard_stats.php'))  return send(STATS);
    if (url.includes('rapport_list.php'))     return send(RAPPORTE);
    if (url.includes('mitarbeiter_list.php')) return send(MA);
    if (url.includes('kunden_list.php'))      return send(KU);
    if (url.includes('logout.php'))           return send({ status: 'ok' });
    if (url.includes('einsatz_bericht')) {
      berichtRufe.push((url.split('einsatz_id=')[1] || '').split('&')[0]);
      return send({ status: 'ok', bericht: { einsatz: { id: 500, kunde_name: 'Muster Immobilien AG', datum: '2026-08-17' },
        kunde: {}, unterschrift: {}, personen: [{ name: 'Hans Muster', von: '07:00', bis: '16:00', pause_min: 0, netto_h: 8 }] } });
    }
    return send({ status: 'ok' });
  });
}

const ok = [], bad = [];
const check = (name, cond) => (cond ? ok : bad).push(name);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await setup(page);

// ── 1. Gate erscheint ohne Token
await page.goto(URL);
check('Gate sichtbar ohne Token', await page.isVisible('#gate'));
check('Shell verborgen ohne Token', !(await page.isVisible('#shell')));
await page.screenshot({ path: `${OUT}/01-login.png` });

// ── 2. Login als Admin
await page.fill('#gName', 'adrian');
await page.fill('#gPass', 'geheim');
await page.click('#gBtn');
await page.waitForSelector('#shell.on', { timeout: 5000 });
await page.waitForSelector('#kpiGrid .kpi-val', { timeout: 5000 });
check('Shell nach Login sichtbar', await page.isVisible('#shell'));
check('dashboard_stats.php aufgerufen', calls.some(c => c.includes('dashboard_stats')));

// ── 3. KPI-Werte
const kpis = await page.$$eval('#kpiGrid .kpi-val', els => els.map(e => e.textContent.trim()));
check('KPI Rapporte = 47', kpis[0] === '47');
check('KPI Stunden = 386.3 h', /386[.,]3/.test(kpis[1]));
check('KPI Mitarbeitende = 5', kpis[2] === '5');
check('KPI Kunden = 12', kpis[3] === '12');
const d0 = await page.textContent('#kpiGrid .kpi:first-child .delta');
check('Delta Rapporte positiv (+21%)', /21/.test(d0) && (await page.getAttribute('#kpiGrid .kpi:first-child .delta', 'class')).includes('up'));

// ── 4. Diagramm
check('8 Balken gerendert', (await page.$$('#chart .bar')).length === 8);
check('Letzte KW hervorgehoben', (await page.getAttribute('#chart .bar:last-child', 'class')).includes('now'));
// Gemessen statt am style-Attribut abgelesen: Seit dem 23.08.2026 steht die
// Balkenhoehe als Anteil in flex-basis, damit das Bild mit der Kartenhoehe
// waechst (ENT-099). Die Aussage bleibt dieselbe -- eine Woche ohne Stunden
// ist trotzdem SICHTBAR, sonst sieht "0" aus wie "kein Balken gezeichnet".
const leerBar = await page.$eval('#chart .bar:nth-child(4) .bar-fill',
  e => Math.round(e.getBoundingClientRect().height));
check('Leere Woche hat Mindesthöhe', leerBar >= 2);

// ── 5. Angemeldete + Ranking
check('2 angemeldete Benutzer', (await page.$$('#angemeldet .rank')).length === 2);
check('Voller Name statt Login', (await page.textContent('#angemeldet .rank:first-child b')).includes('Adrian Muster'));
check('4 Zeilen Stunden/Mitarbeitende', (await page.$$('#proMa .rank')).length === 4);
await page.screenshot({ path: `${OUT}/02-uebersicht.png`, fullPage: true });

// ── 6. Rapporte-Ansicht (seit ENT-043 Unterpunkt von Kunden)
await page.evaluate(() => { go('kunden'); kuGoTab('rapporte'); });
await page.waitForSelector('#kv-rapporte.on');
check('Rapporte-Tabelle 3 Zeilen', (await page.$$('#rapporteTable tbody tr')).length === 3);
check('Krümel zeigt Summe', /3 von 3 Rapporten/.test(await page.textContent('#pgCrumb')));
await page.fill('#rQ', 'einwohner');
await page.waitForTimeout(120);
check('Suche filtert auf 1 Treffer', (await page.$$('#rapporteTable tbody tr')).length === 1);
await page.fill('#rQ', 'zzzz');
await page.waitForTimeout(120);
check('Leerzustand bei 0 Treffern', await page.isVisible('#rapporteTable .empty'));
await page.click('#kv-rapporte button:has-text("Zurücksetzen")');
await page.waitForTimeout(120);
check('Zurücksetzen stellt 3 Zeilen her', (await page.$$('#rapporteTable tbody tr')).length === 3);
await page.screenshot({ path: `${OUT}/03-rapporte.png`, fullPage: true });

// ── 7. Schublade
await page.click('#rapporteTable tbody tr:first-child');
await page.waitForSelector('#drawer.on');
check('Schublade offen', await page.isVisible('#drawer.on'));
check('Titel = Rapport Nr. 284', (await page.textContent('#drTitle')).includes('284'));
const dd = await page.$$eval('#drBody .dl dd', e => e.map(x => x.textContent.trim()));
check('Nettostunden 8.50 h in Schublade', dd.some(x => x.includes('8.50 h')));
check('Unterschrift-Bild vorhanden', (await page.$$('#drBody .sig-box img')).length === 1);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/04-schublade.png` });
check('Schublade vollstaendig im Bild', await page.$eval('#drawer', e => Math.round(e.getBoundingClientRect().right) <= window.innerWidth + 1));
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('Escape schliesst Schublade', !(await page.isVisible('#drawer.on')));

// Rapport ohne Unterschrift
await page.click('#rapporteTable tbody tr:nth-child(2)');
await page.waitForSelector('#drawer.on');
check('Ohne Unterschrift: Hinweistext statt Bild', (await page.$$('#drBody .sig-box img')).length === 0);
await page.click('#drawer .drawer-hd button');
await page.waitForTimeout(250);
// ── 7b. Klammer und Kundenrapport-Knopf in der GLOBALEN, kundenuebergreifenden
// Liste (ENT-178 -- dieselbe Logik wie im Kunden-Detail seit ENT-173, hier
// zusaetzlich mit der dort zurueckgestellten Frage: bleibt die Gruppierung
// stumm, wenn eine fremde Zeile eines anderen Einsatzes dazwischenrutscht?
// window.rapporte bleibt absichtlich auf diesem 5-Zeilen-Stand: der spaetere
// Seiten-Scroll-Test (Abschnitt weiter unten, mehrere Breiten inkl. 360px)
// prueft dadurch genau das Layout mit Klammer, Knopf und Gruppen-Flaeche --
// nicht mehr die urspruengliche, schmalere 3-Zeilen-Tabelle ohne beides.
await page.evaluate(() => {
  // Zwei Zeilen desselben Einsatzes (500), direkt benachbart -- muss klammern.
  // Danach eine Zeile eines ANDEREN Einsatzes (900) zwischen zwei weiteren
  // Zeilen von Einsatz 501, um zu pruefen, dass keine Gruppe ueber die
  // fremde Zeile hinweg entsteht.
  // Bewusst OHNE "window."-Praefix: rapporte ist ein Top-Level "let" im
  // eingebetteten Skript, kein window-Property -- window.rapporte waere
  // eine zweite, fuer renderRapporte() unsichtbare Variable.
  rapporte = [
    { id: 601, einsatz_id: 500, datum: '2026-08-18', mitarbeiter: 'Hans Muster', kunde: 'Muster Immobilien AG', strasse: 'Musterstrasse 12', ort: '4632 Trimbach', auftrag_nr: 'A-500', einsatzart: 'Verkehrsdienst', von: '07:00:00', bis: '16:00:00', pause_min: 30, netto_h: 8, unterzeichner: null },
    { id: 602, einsatz_id: 500, datum: '2026-08-18', mitarbeiter: 'Anna Muster', kunde: 'Muster Immobilien AG', strasse: 'Musterstrasse 12', ort: '4632 Trimbach', auftrag_nr: 'A-500', einsatzart: 'Verkehrsdienst', von: '07:00:00', bis: '15:30:00', pause_min: 30, netto_h: 7.5, unterzeichner: null },
    { id: 603, einsatz_id: 501, datum: '2026-08-17', mitarbeiter: 'Hans Muster', kunde: 'Muster Immobilien AG', strasse: 'Musterstrasse 12', ort: '4632 Trimbach', auftrag_nr: 'A-501', einsatzart: 'Verkehrsdienst', von: '07:00:00', bis: '16:00:00', pause_min: 30, netto_h: 8, unterzeichner: null },
    { id: 900, einsatz_id: 999, datum: '2026-08-17', mitarbeiter: 'Fremd', kunde: 'Einwohnergemeinde Musterdorf', strasse: 'Dorfstrasse 4', ort: '5013 Musterdorf', auftrag_nr: null, einsatzart: 'Revierdienst', von: '22:00:00', bis: '04:00:00', pause_min: 0, netto_h: 6, unterzeichner: null },
    { id: 604, einsatz_id: 501, datum: '2026-08-17', mitarbeiter: 'Anna Muster', kunde: 'Muster Immobilien AG', strasse: 'Musterstrasse 12', ort: '4632 Trimbach', auftrag_nr: 'A-501', einsatzart: 'Verkehrsdienst', von: '07:00:00', bis: '15:30:00', pause_min: 30, netto_h: 7.5, unterzeichner: null },
  ];
  go('kunden'); kuGoTab('rapporte'); renderRapporte();
});
await page.waitForTimeout(150);
const globZeilen = await page.evaluate(() => [...document.querySelectorAll('#rapporteTable tbody tr')].map(r => ({
  zellen: r.children.length, klasse: r.className,
  hatKlammer: !!r.querySelector('.rapp-klammer'), hatKnopf: !!r.querySelector('.rapp-klammer button'),
})));
check('KRITISCH: fuenf Zeilen in der globalen Liste', globZeilen.length === 5);
check('KRITISCH: die erste Zeile (Einsatz 500) traegt Klammer und Knopf, Gruppe offen',
  globZeilen[0].hatKlammer && globZeilen[0].hatKnopf && globZeilen[0].klasse.includes('rapp-gruppe-offen'));
check('KRITISCH: die zweite Zeile derselben Gruppe hat keine eigene Klammer-Zelle mehr',
  !globZeilen[1].hatKlammer && !globZeilen[1].klasse.includes('rapp-gruppe-offen'));
check('KRITISCH: Einsatz 501 klammert NICHT ueber die fremde Zwischenzeile (Einsatz 999) hinweg -- '
  + 'Zeile 3 (erste Haelfte 501) bleibt ohne Knopf', globZeilen[2].hatKlammer && !globZeilen[2].hatKnopf);
check('Die fremde Zwischenzeile (Einsatz 999) ist ebenfalls nur eine stumme Einzelzeile',
  globZeilen[3].hatKlammer && !globZeilen[3].hatKnopf);
check('Die zweite Haelfte von Einsatz 501 (nach der fremden Zeile) ist ebenso eine Einzelzeile ohne Gruppe',
  globZeilen[4].hatKlammer && !globZeilen[4].hatKnopf);
check('Kopfzeile hat eine Spalte mehr fuer die Klammer (10 statt 9)',
  (await page.$$eval('#rapporteTable thead th', th => th.length)) === 10);

await page.evaluate(() => { window.__gedruckt = 0; window.print = () => window.__gedruckt++; });
await page.click('#rapporteTable .rapp-klammer button');
await page.waitForTimeout(400);
check('KRITISCH: der Knopf in der globalen Liste ruft denselben Endpunkt mit der richtigen einsatz_id auf',
  berichtRufe.includes('500'));
check('KRITISCH: und loest das Drucken aus', await page.evaluate(() => window.__gedruckt > 0));

// Zurueck auf Adressen -- sonst haengt kuTab auf 'rapporte' und der spaetere
// Klick auf #nav-kunden zeigt nicht die erwartete Standardansicht.
await page.evaluate(() => kuGoTab('uebersicht'));

// ── 8. Mitarbeitende
await page.evaluate(() => { if (!document.getElementById('navg-admin').classList.contains('offen')) { document.getElementById('nav-admin').click(); } });
await page.waitForTimeout(250);
await page.click('#nav-admin-mitarbeiter');
await page.waitForSelector('#maTable table', { timeout: 5000 });
check('mitarbeiter_list.php aufgerufen', calls.some(c => c.includes('mitarbeiter_list')));
check('MA-Tabelle 3 Zeilen', (await page.$$('#maTable tbody tr')).length === 3);
const th = await page.$$eval('#maTable th', e => e.map(x => x.textContent.trim()));
// Seit ENT-072 statt "Anrede" die Spalten "Funktion" und "Berechtigt": Wer
// einteilt, braucht in der Liste die Funktion und die Berechtigungen: die
// Anrede identifiziert niemanden, den Vor- und Nachname nicht schon nennen.
check('Spalten wie im Vorbild', ['Pers-Nr.','Vorname','Nachname','Funktion','Anschrift','Ort','Telefon','Mobil','E-Mail','Berechtigt','Rolle'].every(h => th.includes(h)));
check('Die Anrede ist aus der Liste raus, nicht aus der Akte', !th.includes('Anrede'));
check('Admin-Kennzeichnung', (await page.textContent('#maTable tbody tr:first-child')).includes('Admin'));
check('Leere Felder als Gedankenstrich', (await page.$$('#maTable tbody tr:last-child td span')).length > 3);
await page.screenshot({ path: `${OUT}/05-mitarbeitende.png`, fullPage: true });

// ── 9. Kunden
await page.click('#nav-kunden');
await page.waitForSelector('#kuTable table', { timeout: 5000 });
check('Kunden-Tabelle 2 Zeilen', (await page.$$('#kuTable tbody tr')).length === 2);
check('Rapport-Zähler je Kunde', (await page.textContent('#kuTable tbody tr:first-child')).includes('2'));
await page.screenshot({ path: `${OUT}/06-kunden.png`, fullPage: true });

// ── 10. Objekte sind kein eigener Menuepunkt mehr, sondern ein Unterpunkt
// des aufklappbaren Kunden-Bereichs (ENT-039) -- nicht in der Planung.
// Schon auf Kunden (Schritt 9) -- das Untermenü ist entsprechend offen.
check('Kein eigener Objekte-Menuepunkt', (await page.$$('#nav-objekte')).length === 0);
check('Objekte als Unterpunkt von Kunden', await page.isVisible('#nav-kunden-objekte'));
// Erneuter Klick auf "Kunden", während der Bereich schon aktiv ist, klappt
// das Untermenü zu statt es (nutzlos) wieder zu öffnen.
await page.click('#nav-kunden');
await page.waitForTimeout(200);
check('Klick auf Kunden bei aktivem Bereich klappt das Untermenü zu',
  !(await page.evaluate(() => document.getElementById('navg-kunden').classList.contains('offen'))));
await page.click('#nav-kunden');
await page.waitForTimeout(200);
check('Nochmaliger Klick klappt es wieder auf',
  await page.evaluate(() => document.getElementById('navg-kunden').classList.contains('offen')));
await page.click('#nav-planung');
await page.waitForTimeout(300);
check('Kein Objekte-Reiter mehr in der Planung', (await page.$$('#ptab-objekte')).length === 0);

// ── 11. Kein Schreibaufruf passiert
check('Nur Lese-Endpunkte aufgerufen', !calls.some(c => /create|update|delete|deactivate|reset/.test(c)));

// ── 12. Mobil
await page.evaluate(() => go('uebersicht'));
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(350);
// Seit ENT-059 ist die Leiste auf dem Handy ein Aufklappmenue.
check('Menue mobil zunaechst zu',
  await page.evaluate(() => getComputedStyle(document.getElementById('side')).visibility === 'hidden'));
check('Burger-Knopf sichtbar', await page.isVisible('.btn-burger'));
// Kein horizontaler Seiten-Scroll — jede Ansicht, mehrere Breiten
for (const w of [360, 390, 768, 1024, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const v of ['uebersicht', 'mitarbeiter', 'kunden', 'planung']) {
    await page.evaluate(view => go(view), v);
    await page.waitForTimeout(90);
    const r = await page.evaluate(() => ({
      s: document.documentElement.scrollWidth, i: document.documentElement.clientWidth
    }));
    check(`Kein Seiten-Scroll bei ${w}px – ${v}`, r.s <= r.i + 1);
  }
  await page.evaluate(() => { go('kunden'); kuGoTab('rapporte'); });
  await page.waitForTimeout(90);
  const rr = await page.evaluate(() => ({
    s: document.documentElement.scrollWidth, i: document.documentElement.clientWidth
  }));
  check(`Kein Seiten-Scroll bei ${w}px – kunden/rapporte`, rr.s <= rr.i + 1);
}
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => go('uebersicht'));
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/07-mobil.png` });
await page.click('.btn-burger');
await page.waitForTimeout(350);
check('Burger öffnet das Menue',
  await page.evaluate(() => document.getElementById('side').classList.contains('on')));
// Seit ENT-057 ist der Kundenbereich mobil nicht mehr im Menue -- er ist
// Schreibtischarbeit. Geprueft wird jetzt das Gegenteil von frueher: dass er
// dort NICHT steht, und dass stattdessen erklaert wird, wo er geblieben ist.
check('Mobil: Kunden stehen nicht mehr im Menue',
  await page.evaluate(() => !document.getElementById('nav-kunden').getClientRects().length));
// Der erklaerende Kasten ist mit ENT-067 wieder verschwunden: Der Projekt-
// inhaber wollte den Platz fuer die Navigation, und ein Hinweis, der bei
// jedem Oeffnen dasteht, ist nach dem zweiten Mal nur noch Moebelstueck.
check('Mobil: der Desktop-Hinweis ist entfernt',
  await page.evaluate(() => !document.querySelector('.mobil-hinweis')
    && !/am Desktop gepflegt/.test(document.getElementById('side').textContent)));
check('Mobil: der frei gewordene Platz gehoert der Navigation',
  await page.evaluate(() => {
    const n = document.querySelector('#side .side-nav');
    const letzte = [...n.querySelectorAll('.nav-item')].filter(e => e.getClientRects().length).pop();
    return !!letzte && n.getBoundingClientRect().bottom - letzte.getBoundingClientRect().bottom < 400;
  }));
// Seit ENT-235 ist auch der Abgleich mobil nicht mehr im Menue -- die Seite
// selbst und ihre gezielten Einstiege (z.B. "Zum Abgleich" beim Aufheben
// einer Sperre) bleiben erreichbar, gehoeren aber nicht in die Hauptnavigation.
check('Mobil: Abgleich steht nicht mehr im Menue',
  await page.evaluate(() => !document.getElementById('nav-abgleich').getClientRects().length));
// Was mobil bleibt, muss auch mobil funktionieren.
await page.click('#nav-planung');
await page.waitForTimeout(350);
check('Auswahl schliesst das Menue wieder',
  await page.evaluate(() => !document.getElementById('side').classList.contains('on')));
check('Mobil: die Planung laesst sich oeffnen', await page.isVisible('#view-planung.on'));
await page.screenshot({ path: `${OUT}/07b-mobil-rapporte.png` });

await browser.close();

// ── 13. Nicht-Admin wird abgewiesen
const b2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p2 = await b2.newPage({ viewport: { width: 1280, height: 800 } });
await setup(p2, { admin: false });
await p2.goto(URL);
await p2.fill('#gName', 'dario.beispiel');
await p2.fill('#gPass', 'geheim');
await p2.click('#gBtn');
await p2.waitForTimeout(500);
// Mitarbeitende werden nicht abgewiesen, sondern in die App geschickt.
check('Nicht-Admin: Weiterleitung in die App', p2.url().endsWith('/app.html'));
check('Nicht-Admin: App ist da', await p2.isVisible('#gate') || await p2.isVisible('#app'));
check('Nicht-Admin: Shell bleibt zu', !(await p2.isVisible('#shell')));
await p2.screenshot({ path: `${OUT}/08-kein-zugang.png` });
await b2.close();

console.log('\n✅ BESTANDEN (' + ok.length + ')');
ok.forEach(t => console.log('   · ' + t));
if (bad.length) { console.log('\n❌ FEHLGESCHLAGEN (' + bad.length + ')'); bad.forEach(t => console.log('   · ' + t)); process.exit(1); }
console.log('\nAlle Prüfungen bestanden.');
