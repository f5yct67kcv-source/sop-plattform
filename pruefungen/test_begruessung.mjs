// Begrüssungs-Container mit Diktat-Router und Bild-Erfassung (ENT-032).
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
// Ein winziges Testbild, im Lauf erzeugt statt als Binaerdatei im
// Repository. Es muss nur ein gueltiges PNG sein -- was darauf zu sehen
// ist, spielt keine Rolle; geprueft wird der Weg vom Auswaehlen bis zur
// Anfrage, nicht der Inhalt.
const BILD = OUT + '/testbild.png';
{
  const { writeFileSync, existsSync } = await import('fs');
  if (!existsSync(BILD)) {
    // 1x1 Pixel, PNG, transparent.
    writeFileSync(BILD, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'
      + 'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  }
}
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const jetzt = new Date();
const hm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':00';
const NAECHSTES = { status: 'ok',
  naechster_einsatz: { id: 41, kunde_name: 'Borner AG', titel: 'Schliessrunde', ort: '4601 Olten',
    datum: tag(0), von: hm(new Date(jetzt.getTime() + 3600e3)), bis: '23:00:00', bedarf: 2, zugeteilt: 1,
    objekt_name: 'Gerolag Center' },
  offene_zusagen: 3, neue_sperrtage: 2 };

const MA = [{ id: 1, name: 'adrianvonarb', vorname: 'Adrian', nachname: 'von Arb', aktiv: 1, ist_admin: 1 }];
const KU = [{ id: 1, name: 'Borner AG', strasse: 'Bahnhofstrasse 1', ort: '4600 Olten', telefon: null, email: null }];

const rufe = [];
let routerAntwort = null, bildAntwort = null;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), u = req.url(), p = u.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body });
  const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrianvonarb', ist_admin: true });
  if (p.includes('naechstes')) return send(NAECHSTES);
  if (p.includes('ki_router_parse')) return routerAntwort ? send(routerAntwort[0], routerAntwort[1])
    : send({ status: 'error', message: 'kein Mock' }, 502);
  if (p.includes('ki_einsatz_bild')) return bildAntwort ? send(bildAntwort[0], bildAntwort[1])
    : send({ status: 'error', message: 'kein Mock' }, 502);
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: KU });
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0,
    stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 1, kunden: 1, rapporte_total: 0 },
    verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
  return send({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], gepflegt: {}, sperren: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrianvonarb'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);

// ══════════ BEGRÜSSUNG
check('Der Container ist als erster da',
  await page.evaluate(() => document.querySelector('.dash-item').dataset.widget === 'begruessung'));
check('Die Begrüssung nennt den Vornamen', (await page.textContent('#begrGruss')).includes('Adrian'));
check('„Was steht an" wird geladen', rufe.some(r => r.p.includes('naechstes')));
const naechstesTxt = await page.textContent('#begrNaechstes');
check('Der nächste Einsatz wird genannt', naechstesTxt.includes('Gerolag Center'));
check('Heute wird als „heute" erkannt', /heute/i.test(naechstesTxt));
// Seit ENT-058 heisst es Schichten, nicht Stellen.
check('Offene Schichten werden genannt', naechstesTxt.includes('1 Schicht offen'));
check('KRITISCH: die alte Benennung taucht nicht wieder auf', !/Stelle/.test(naechstesTxt));
check('Sperrtage werden genannt', naechstesTxt.includes('2 neue Sperrtage'));
check('Offene Rückmeldungen werden genannt', naechstesTxt.includes('3 offene Rückmeldungen'));

// ── Kurzes Platzhalter-Beispiel im Diktatfeld (Projektinhaber-Vorgabe,
// 2026-08-28: der volle Beispielsatz inkl. "Bild einfügen"/"Screenshot"
// wirkte auf dem Handy ueberladen, das sagt bereits der "Bild"-Knopf
// darunter) -- kurz, aber weiterhin mit einem konkreten Beispiel.
const platzhalter = await page.getAttribute('#rtText', 'placeholder');
check('Der Platzhaltertext im Diktatfeld ist kurz gehalten', platzhalter.length < 100);
check('KRITISCH: kein doppelt genannter Hinweis auf Bild/Screenshot im Platzhalter (steht schon im Bild-Knopf)',
  !/Screenshot/i.test(platzhalter));

await page.screenshot({ path: OUT + '/80-begruessung.png' });

// Wechselnde Formulierung: neu laden, Text darf sich unterscheiden koennen
const grussTexte = new Set();
for (let i = 0; i < 12; i++) {
  await page.evaluate(() => renderBegruessung());
  grussTexte.add(await page.textContent('#begrGruss'));
}
check('Die Begrüssung variiert über mehrere Aufrufe', grussTexte.size > 1);

// ══════════ DER GRUSS RICHTET SICH NACH DER UHRZEIT
await page.evaluate(() => { window.__zeitFest = 9; Date.prototype.getHours = function () { return window.__zeitFest; }; renderBegruessung(); });
check('Morgens ein anderer Gruss als abends',
  (await page.textContent('#begrGruss')).match(/Morgen|Start/));
await page.evaluate(() => { window.__zeitFest = 20; renderBegruessung(); });
check('Abends ein Abend-Gruss', ['Guten Abend', 'Noch spät unterwegs?'].includes(await page.textContent('#begrGruss').then(t => t.split(',')[0].trim())));
// Nicht auf /Abend/ pruefen: eine der drei Abend-Formen lautet "Noch spät
// unterwegs?" und enthaelt das Wort gar nicht. Die alte Fassung dieser Zeile
// fiel darum in einem von drei Laeufen durch -- ein Fehler im Test, nicht im
// Produkt. Geprueft wird stattdessen, dass es kein Tag-/Morgengruss ist.
check('Abends kein Morgen- oder Taggruss',
  !(await page.textContent('#begrGruss')).match(/Morgen|Guten Tag|Willkommen zurück|Start/));

// ══════════ MIKROFON IST WIEDERVERWENDET
check('Der Sprechen-Knopf ist im Router da', await page.isVisible('#rtMik'));
check('Die Pegelanzeige ist da', await page.evaluate(() => document.querySelectorAll('#rtViz i').length === 22));

// ══════════ ROUTER: LEERE EINGABE
await page.click('#rtBtn');
await page.waitForTimeout(200);
check('Leere Eingabe wird abgefangen', await page.isVisible('#rtErr'));
check('Leere Eingabe geht nicht ans Modell', !rufe.some(r => r.p.includes('ki_router_parse')));

// ══════════ ROUTER: MITARBEITER
routerAntwort = [{ status: 'ok', bereich: 'mitarbeiter',
  felder: { vorname: 'Hans', nachname: 'Meier', mobil: '079 111 22 33' } }, 200];
await page.fill('#rtText', 'Neuer Mitarbeiter Hans Meier, Mobil 079 111 22 33');
await page.click('#rtBtn');
await page.waitForTimeout(500);
// Seit ENT-072 fuehrt der Router auf die volle Anlegen-Flaeche statt in
// einen kurzen Dialog -- dieselbe, auf der auch bearbeitet wird.
check('Anlegen-Flaeche geht auf', await page.isVisible('#mv-bearbeiten.on'));
check('Vorname ist vorbefüllt', (await page.inputValue('#mb_vorname')) === 'Hans');
check('Diktat-Herkunft ist markiert',
  await page.evaluate(() => document.getElementById('mb_vorname').classList.contains('ki')));
check('Das Eingabefeld ist danach leer', (await page.inputValue('#rtText')) === '');
// Die Flaeche ist eine Seite, kein Ueberlagerungsdialog: Der Router wechselt
// dafuer den Bereich. Zurueck auf die Uebersicht, wo das Diktatfeld steht.
await page.evaluate(() => { mbAbbrechen(); go('uebersicht'); });
await page.waitForTimeout(300);
routerAntwort = null;

// ══════════ ROUTER: KUNDE
routerAntwort = [{ status: 'ok', bereich: 'kunde', felder: { name: 'Studer Immobilien AG', ort: '4632 Trimbach' } }, 200];
await page.fill('#rtText', 'Neuer Kunde Studer Immobilien AG in Trimbach');
await page.click('#rtBtn');
await page.waitForTimeout(500);
check('Kunden-Dialog geht auf', await page.isVisible('#dlgKunde.on'));
check('Firmenname ist vorbefüllt', (await page.inputValue('#ku_name')) === 'Studer Immobilien AG');
await page.evaluate(() => closeDlg('dlgKunde'));
routerAntwort = null;

// ══════════ ROUTER: EINSATZ
routerAntwort = [{ status: 'ok', bereich: 'einsatz',
  felder: { kunde_name: 'Borner AG', datum: tag(1), von: '07:00', bis: '16:00', bedarf: 1 },
  mitarbeiter_login_namen: ['adrianvonarb'] }, 200];
await page.fill('#rtText', 'Neuer Einsatz für die Borner AG morgen 7 bis 16 Uhr');
await page.click('#rtBtn');
await page.waitForTimeout(500);
check('Die Anlegen-Ansicht geht auf', await page.isVisible('#view-einsatzneu.on'));
check('Kunde ist vorbefüllt', (await page.inputValue('#enNKunde_name')) === 'Borner AG');
check('Zugeteilte Person ist angehakt',
  await page.evaluate(() => document.querySelector('#enNMa input[value="1"]').checked));
await page.screenshot({ path: OUT + '/81-router-einsatz.png' });
await page.evaluate(() => enNeuAbbrechen());
routerAntwort = null;

// ══════════ ROUTER: FEHLER DES MODELLS
routerAntwort = [{ status: 'error', message: 'Konnte keinem Bereich zugeordnet werden -- bitte im jeweiligen Bereich direkt diktieren.' }, 422];
await page.fill('#rtText', 'irgendwas Unklares');
await page.click('#rtBtn');
await page.waitForTimeout(400);
check('Fehler des Modells wird gezeigt', (await page.textContent('#rtErr')).includes('keinem Bereich'));
check('Kein Dialog öffnet sich dabei',
  !(await page.isVisible('#mv-bearbeiten.on')) && !(await page.isVisible('#dlgKunde.on')) && !(await page.isVisible('#view-einsatzneu.on')));
check('Der Text bleibt für eine Korrektur stehen', (await page.inputValue('#rtText')) === 'irgendwas Unklares');
routerAntwort = null;
await page.fill('#rtText', '');

// ══════════ BILD: AUSWAHL ÜBER DEN DATEIDIALOG
await page.setInputFiles('#rtDatei', BILD);
await page.waitForTimeout(400);
check('Die Vorschau erscheint', await page.isVisible('#rtBildVorschau'));
check('Ein Vorschaubild ist gesetzt',
  (await page.getAttribute('#rtBildImg', 'src') || '').startsWith('data:image/jpeg'));
await page.screenshot({ path: OUT + '/82-bild-vorschau.png' });

bildAntwort = [{ status: 'ok', felder: { kunde_name: 'Borner AG', titel: 'Baustelle Kreisel',
  datum: tag(2), von: '08:00', bis: '17:00', bedarf: 1 }, mitarbeiter_login_namen: [], unsicher: false }, 200];
await page.click('#rtBtn');
await page.waitForTimeout(500);
const bildRuf = rufe.filter(r => r.p.includes('ki_einsatz_bild'));
check('Bild wird statt Text gesendet, wenn beides da wäre', bildRuf.length === 1);
check('Der Bild-Rumpf enthält base64 und Mime',
  typeof bildRuf[0].body.bild === 'string' && bildRuf[0].body.bild.length > 0 && bildRuf[0].body.mime === 'image/jpeg');
check('Die Anlegen-Ansicht geht nach Bild-Erkennung auf', await page.isVisible('#view-einsatzneu.on'));
check('Titel aus dem Bild ist vorbefüllt', (await page.inputValue('#enNTitel')) === 'Baustelle Kreisel');
check('Die Bildvorschau ist danach wieder leer', !(await page.isVisible('#rtBildVorschau')));
await page.evaluate(() => enNeuAbbrechen());
bildAntwort = null;

// ══════════ BILD: ENTFERNEN VOR DEM SENDEN
await page.setInputFiles('#rtDatei', BILD);
await page.waitForTimeout(300);
await page.click('#rtBildVorschau button');
await page.waitForTimeout(150);
check('Entfernen blendet die Vorschau aus', !(await page.isVisible('#rtBildVorschau')));
const vorSenden = rufe.filter(r => r.p.includes('ki_einsatz_bild')).length;
await page.click('#rtBtn');
await page.waitForTimeout(200);
check('Ohne Bild und ohne Text passiert nichts', rufe.filter(r => r.p.includes('ki_einsatz_bild')).length === vorSenden);
check('Stattdessen erscheint die Text-Fehlermeldung', await page.isVisible('#rtErr'));

// ══════════ BILD: FEHLER "KEIN AUFTRAG ERKENNBAR"
await page.setInputFiles('#rtDatei', BILD);
await page.waitForTimeout(300);
bildAntwort = [{ status: 'error', message: 'Im Bild liess sich kein Auftrag erkennen. Bitte die Felder von Hand eintragen.' }, 422];
await page.click('#rtBtn');
await page.waitForTimeout(400);
check('Erklärung bei unlesbarem Bild', (await page.textContent('#rtErr')).includes('kein Auftrag erkennen'));
check('Kein Dialog bei Fehler', !(await page.isVisible('#view-einsatzneu.on')));
bildAntwort = null;
await page.evaluate(() => rtBildEntfernen('rt'));

// ══════════ EINFÜGEN AUS DER ZWISCHENABLAGE
await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], 'einfuegung.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.getElementById('rtText').dispatchEvent(ev);
}, (await (await import('fs')).promises.readFile(BILD)).toString('base64'));
await page.waitForTimeout(400);
check('Ein eingefügtes Bild erzeugt ebenfalls eine Vorschau', await page.isVisible('#rtBildVorschau'));
await page.evaluate(() => rtBildEntfernen('rt'));

// ══════════ ZIEHEN UND FALLENLASSEN
await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], 'gezogen.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const zone = document.getElementById('rtDropzone');
  zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, (await (await import('fs')).promises.readFile(BILD)).toString('base64'));
await page.waitForTimeout(400);
check('Ein gezogenes Bild erzeugt ebenfalls eine Vorschau', await page.isVisible('#rtBildVorschau'));
await page.evaluate(() => rtBildEntfernen('rt'));

// ══════════════════════════════ DIE DREI KNOEPFE (ENT-100)
//
// Skizze des Projektinhabers vom 2026-08-23 (1728 x 971 px), dazu woertlich:
// "cta button alle in selben eckigen design. sprechen blau, rest neutral je
// nach hell/dunkel". Aus der Skizze: 140 x 40 px, links, Reihenfolge
// Sprechen, Erkennen, Bild.
//
// Gemessen am gerenderten Zustand: Eine Gestaltungsregel kann wirkungslos
// bleiben, ohne dass etwas kaputtgeht.
try {
  await page.setViewportSize({ width: 1728, height: 971 });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const g = s => { const e = document.querySelector(s), r = e.getBoundingClientRect(), c = getComputedStyle(e);
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
               radius: c.borderRadius, bg: c.backgroundColor }; };
    return { sprechen: g('#rtMik'), erkennen: g('#rtBtn'), bild: g('#rtSprach button[title="Bild auswählen"]'),
             akzent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
             flaeche: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() };
  });
  check('KRITISCH: alle drei Knöpfe sind 140 x 40 px',
    [m.sprechen, m.erkennen, m.bild].every(k => k.w === 140 && k.h === 40));
  check('KRITISCH: alle drei tragen dieselbe eckige Form',
    m.sprechen.radius === m.erkennen.radius && m.erkennen.radius === m.bild.radius
    && parseFloat(m.sprechen.radius) > 0 && parseFloat(m.sprechen.radius) < 20);
  check('KRITISCH: die Reihenfolge ist Sprechen, Erkennen, Bild',
    m.sprechen.x < m.erkennen.x && m.erkennen.x < m.bild.x);
  check('Sie stehen auf einer Höhe',
    m.sprechen.y === m.erkennen.y && m.erkennen.y === m.bild.y);
  check('Und links, nicht am rechten Rand', m.sprechen.x < 400);
  await page.screenshot({ path: `${OUT}/begr-knoepfe.png` });
} catch (e) { bad.push('Knöpfe: ' + String(e).split('\n')[0].slice(0, 120)); }

// Farbe traegt die Unterscheidung, nicht die Form -- in BEIDEN Themen. Ein
// fester Farbwert saehe in einem der beiden falsch aus.
for (const thema of ['hell', 'dunkel']) {
  try {
    await page.evaluate(t => themaSetzen(t), thema);
    await page.waitForTimeout(200);
    const f = await page.evaluate(() => {
      const bg = s => getComputedStyle(document.querySelector(s)).backgroundColor;
      const wurzel = getComputedStyle(document.documentElement);
      const alsRgb = w => { const d = document.createElement('div'); d.style.color = w;
        document.body.appendChild(d); const r = getComputedStyle(d).color; d.remove(); return r; };
      return { sprechen: bg('#rtMik'), erkennen: bg('#rtBtn'),
               bild: bg('#rtSprach button[title="Bild auswählen"]'),
               akzent: alsRgb(wurzel.getPropertyValue('--accent').trim()),
               flaeche: alsRgb(wurzel.getPropertyValue('--surface').trim()) };
    });
    check(`KRITISCH: ${thema} — Sprechen trägt die Akzentfarbe`, f.sprechen === f.akzent);
    check(`KRITISCH: ${thema} — Erkennen und Bild sind neutral`,
      f.erkennen === f.flaeche && f.bild === f.flaeche);
    check(`${thema} — und heben sich vom Sprechen-Knopf ab`, f.erkennen !== f.sprechen);
  } catch (e) { bad.push(`Farben ${thema}: ` + String(e).split('\n')[0].slice(0, 110)); }
}
// Nach dem Themenwechsel abwarten: Auch er laeuft ueber einen Uebergang, und
// ein Wert mitten darin ist weder der alte noch der neue.
await page.evaluate(() => themaSetzen('hell'));
await page.waitForTimeout(400);

// Der laufende Zustand muss sichtbar bleiben. Der Knopf ist jetzt von Haus
// aus blau -- eine Regel in der falschen Reihenfolge wuerde das Rot der
// Aufnahme still ueberschreiben.
try {
  // ABWARTEN, bevor gemessen wird: Der Knopf hat einen Farbuebergang von
  // 0.13 s. Wer direkt nach dem Klassenwechsel liest, bekommt noch den ALTEN
  // Wert und haelt eine wirksame Regel faelschlich fuer wirkungslos -- genau
  // das ist hier zuerst passiert.
  const vorher = await page.evaluate(() => getComputedStyle(document.querySelector('#rtMik')).backgroundColor);
  await page.evaluate(() => document.querySelector('#rtMik').classList.add('laeuft'));
  await page.waitForTimeout(300);
  const laeuft = await page.evaluate(() => getComputedStyle(document.querySelector('#rtMik')).backgroundColor);
  await page.evaluate(() => document.querySelector('#rtMik').classList.remove('laeuft'));
  await page.waitForTimeout(400);
  check('KRITISCH: während der Aufnahme wechselt der Sprechen-Knopf die Farbe', laeuft !== vorher);
  check('KRITISCH: und danach wieder zurück auf blau',
    (await page.evaluate(() => getComputedStyle(document.querySelector('#rtMik')).backgroundColor)) === vorher);
} catch (e) { bad.push('Aufnahmezustand: ' + String(e).split('\n')[0].slice(0, 110)); }

// Auf dem Handy passen drei Knoepfe zu 140 px nicht in eine Zeile. Sie
// duerfen dann umbrechen -- aber nicht unter die Trefferflaeche fallen, die
// ein Finger zuverlaessig erwischt.
try {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const g = s => { const r = document.querySelector(s).getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) }; };
    return { sprechen: g('#rtMik'), erkennen: g('#rtBtn'), bild: g('#rtSprach button[title="Bild auswählen"]'),
             quer: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  check('KRITISCH: auf dem Handy mindestens 44 px hoch',
    [m.sprechen, m.erkennen, m.bild].every(k => k.h >= 44));
  check('KRITISCH: kein Querscrollen auf dem Handy', m.quer === false);
  check('Sie füllen die schmale Zeile aus, statt bei 140 px zu bleiben',
    m.sprechen.w !== 140 || m.erkennen.w !== 140);

  // ── Kurzueberblick ("naechster Einsatz, Sperrtage, Rueckmeldungen") macht
  // die Uebersicht auf dem Handy ueberladen -- bis zu den eigentlichen
  // Kennzahlen musste weit gescrollt werden (Projektinhaber-Vorgabe,
  // 2026-08-28). Auf dem Handy weg, der DATENSATZ bleibt aber unveraendert
  // (kein Feature entfernt, siehe naechstesTxt-Pruefungen oben bei 1500px).
  check('KRITISCH: der Kurzueberblick unter der Grussformel ist auf dem Handy ausgeblendet',
    !(await page.isVisible('#begrNaechstes')));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.waitForTimeout(250);
  check('KRITISCH: auf dem Desktop bleibt der Kurzueberblick sichtbar',
    await page.isVisible('#begrNaechstes'));
} catch (e) { bad.push('Handy: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════ DER CONTAINER GEHÖRT ZUM KONFIGURIERBAREN DASHBOARD (ENT-031)
await page.click('#btnDashBearbeiten');
await page.waitForTimeout(200);
check('Der Container hat ebenfalls ein Werkzeug',
  await page.evaluate(() => !!document.querySelector('.dash-item[data-widget="begruessung"] .dash-werk')));
await page.click('.dash-item[data-widget="begruessung"] .dash-auge');
await page.waitForTimeout(150);
check('Auch die Begrüssung lässt sich ausblenden',
  await page.evaluate(() => document.querySelector('.dash-item[data-widget="begruessung"]').classList.contains('versteckt')));
await page.click('#dashEditleiste button:has-text("Speichern")');
await page.waitForTimeout(200);
const gespeichert = JSON.parse(await page.evaluate(() => localStorage.getItem('rv3_dash_layout')));
check('Der Zustand wird mitgespeichert wie jeder andere Container',
  gespeichert.find(x => x.id === 'begruessung').sichtbar === false);

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
await browser.close();
