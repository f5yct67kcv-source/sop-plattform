// Rundgang trotz anderer Einteilung (ENT-342) -- die Sperre faellt, die
// Sichtbarkeit tritt an ihre Stelle.
//
// Vom Projektinhaber: „Das Problem ist allerdings, wenn der Disponent ganz
// kurzfristig umgeplant hat und den Mitarbeiter auf eine Objektrunde
// delegiert hat [er stand auf dem Verkehrsdienst], hat er nicht die
// Moeglichkeit, den Rundgang zu starten. Das ist nicht optimal, vor allem
// wenn der Planer telefonisch nicht erreichbar ist. Deshalb muss diese
// Sperre raus. [...] Muss dies aber bei der geplanten Schicht einen
// deutlichen Warnhinweis hinterlegen."
//
// Geprueft wird beides zusammen, weil nur beides zusammen vertretbar ist:
// Ohne die Sperre ist die Marke an der geplanten Schicht die einzige
// Auskunft, die der Disposition noch bleibt.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const klick = async (page, s) => {
  // Kurze Frist und kein Absturz: In der Gegenprobe fehlt der Knopf, den
  // hier jemand anklickt -- eine abgestuerzte Suite meldet keine rote
  // Pruefung, sondern gar nichts.
  try { await page.click(s, { timeout: 2500 }); return true; } catch (e) { return false; }
};

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// ══════════ SERVER: DIE SPERRE IST WEG, DIE MELDUNG IST DA ════════════
const EP = readFileSync(`${WURZEL}/backend/api/mein_rundgang_spontan_starten.php`, 'utf8');
const RG = readFileSync(`${WURZEL}/backend/rundgang.php`, 'utf8');
const LIST = readFileSync(`${WURZEL}/backend/api/einsatz_list.php`, 'utf8');
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');

check('KRITISCH: der Start ist nicht mehr unbedingt gesperrt -- er fragt nur noch nach',
  /empty\(\$input\['trotz_doppelbelegung'\]\)/.test(EP));
check('KRITISCH: die Rückfrage nennt einen Code, nicht nur einen Satz',
  /'code' => 'doppelbelegung'/.test(EP));
check('Und den Klartext der Kollision, damit die App fragen kann',
  /'kollision' => \['was' => \$doppelt\[0\]\['was'\]/.test(EP));
// Nicht nur "die Zeichenkette steht da": Eine erste Fassung dieser Pruefung
// suchte bloss nach EREIGNISART_PARALLELRUNDE und dem INSERT -- sie blieb
// gruen, als die Gegenprobe die Bedingung `if ($doppelt)` auf `if (false)`
// setzte, der Block also nie mehr erreicht wurde. Geprueft wird darum die
// VERDRAHTUNG: Der Meldungsblock haengt an der Kollision.
check('KRITISCH: mit Bestätigung entsteht eine Ereignismeldung',
  /\$ereignisFehler = null;\s*\nif \(\$doppelt\) \{[\s\S]{0,2000}?EREIGNISART_PARALLELRUNDE[\s\S]{0,2000}?INSERT INTO ereignis_meldung/.test(EP));
check('KRITISCH: der Klartext der Kollision wird in die Meldung KOPIERT, nicht nur die Einsatz-Id',
  /\$doppelt\[0\]\['was'\]/.test(EP) && /gestartet, obwohl zur selben Zeit eingeteilt/.test(EP));
// Der Start ist zu diesem Zeitpunkt bereits festgeschrieben. Scheitert die
// Meldung, darf das den Rundgang nicht mitreissen -- aber es muss gesagt
// werden.
check('KRITISCH: eine fehlgeschlagene Meldung reisst den Start nicht mit',
  /catch \(Throwable \$e\) \{\s*\n\s*\$ereignisFehler = 'Rundgang gestartet, Ereignismeldung fehlgeschlagen'/.test(EP));
check('Und sie wird nach aussen gemeldet, nicht verschluckt',
  /'ereignis_fehler' => \$ereignisFehler/.test(EP));
check('Die Ereignisart ist als Konstante hinterlegt, nicht als Zeichenkette im Endpunkt',
  /const EREIGNISART_PARALLELRUNDE = /.test(RG));
check('KRITISCH: die Einrichtung legt sie an -- sonst bliebe jede Meldung ohne Art',
  /EREIGNISART_PARALLELRUNDE, 97/.test(EINR));
// Der Endpunkt SUCHT die Art, er legt sie nicht an (Muster aus ENT-311/324).
// Fehlt sie, entsteht die Meldung trotzdem -- ohne Art, aber auffindbar.
check('KRITISCH: fehlt die Ereignisart, entsteht die Meldung trotzdem (ohne Art)',
  /\$artId = null;/.test(EP) && /hat_tabelle\(\$pdo, 'ereignisart'\)/.test(EP));

check('KRITISCH: die geplante Schicht bekommt die Runden ABGELEITET, ohne neue Spalte',
  /\$e\['parallel_runden'\] = \[\];/.test(LIST) && /spontan_erzeugt = 1/.test(LIST));
check('Die Ableitung läuft in EINER Abfrage, nicht einer je Einsatz',
  /Eine Abfrage fuer die ganze Liste/.test(LIST));
check('KRITISCH: nur an der geplanten Schicht, nicht am spontanen Einsatz selbst',
  /if \(!\$e\['spontan_erzeugt'\]\) \{/.test(LIST));

// ══════════ APP: FRAGEN STATT SPERREN ════════════════════════════════
const VORLAGEN = { status: 'ok', vorlagen: [
  { id: 501, name: 'Musterrunde Nord', objekt_id: 7, objekt_name: 'Objekt Nord',
    kunde_name: 'Muster AG', fenster_von: null, fenster_bis: null }] };
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001', vorname: 'Max',
  nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00', revierdienst_berechtigt: true } };

let startRufe = [];
let mitBestaetigung = null;   // was der Server beim zweiten Anlauf liefert
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request();
  const p = new URL(req.url()).pathname.split('/api/')[1];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send({ status: 'ok', von: tag(-30), bis: tag(90), schichten: [] });
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_vorlagen_alle')) return send(VORLAGEN);
  if (p.includes('mein_rundgang_uebersicht')) {
    return send({ status: 'ok',
      vorlage: { id: 501, name: 'Musterrunde Nord', fenster_von: null, fenster_bis: null },
      objekt: { id: 7, name: 'Objekt Nord', strasse: 'Musterweg 4', ort: '9999 Musterdorf', kanton: 'SO', bemerkung: null },
      kunde_name: 'Muster AG', kontrollpunkte: [{ id: 1, bezeichnung: 'Eingang', typ: 'geofence' }],
      ansprechpartner: [], zentrale: null });
  }
  if (p.includes('mein_rundgang_spontan_starten')) {
    startRufe.push(body || {});
    if (!body || !body.trotz_doppelbelegung) {
      return send({ status: 'error', code: 'doppelbelegung',
        message: 'Du bist zu dieser Zeit bereits andernorts eingeteilt: Muster AG 12:00-18:00',
        kollision: { was: 'Muster AG 12:00-18:00', einsatz_id: 88 } }, 409);
    }
    return send(mitBestaetigung || { status: 'ok', einsatz_id: 99, rundgang_id: 7,
      kontrollpunkte: [{ id: 1, bezeichnung: 'Eingang', typ: 'geofence', lat: null, lng: null,
        geofence_radius_m: 20, aufgaben: [] }] });
  }
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: null });
  return send({ status: 'ok' });
});
await page.route('**maps.googleapis.com/**', r => r.abort());

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

const starten = async () => {
  startRufe = [];
  await page.evaluate(() => { blattZu(); rgSeiteZu(); });
  await page.waitForTimeout(150);
  await page.evaluate(() => rundgangUebersichtOeffnen());
  await page.waitForTimeout(350);
  await klick(page, '#blBody button:has-text("Musterrunde Nord")');
  await page.waitForTimeout(400);
  await klick(page, '#rgsStartBtn');
  await page.waitForTimeout(500);
};

await starten();
check('KRITISCH: der Start endet NICHT stumm in einer Fehlermeldung, sondern fragt',
  await page.evaluate(() => !document.getElementById('rgsDlg').hidden));
const frage = await page.textContent('#rgsDlg');
check('KRITISCH: die Frage nennt, WOGEGEN gestartet wird -- nicht nur "Konflikt"',
  frage.includes('Muster AG') && frage.includes('12:00'));
check('Und sie nennt die Folge: die Einsatzleitung sieht es an der geplanten Schicht',
  frage.includes('Einsatzleitung') && frage.includes('geplanten Schicht'));
// Die Kollision und der Erklaersatz duerfen nicht ineinanderlaufen -- der
// Umbruch steht im Text, er muss auch gerendert werden (am Bildschirm
// gemessen, nicht im Quelltext nachgelesen).
check('KRITISCH: Kollision und Erklärung stehen auf getrennten Zeilen (gemessen)',
  await page.evaluate(() => {
    const el = document.getElementById('rgsDlgTxt');
    if (!el) return false;
    const zeilen = el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight);
    return getComputedStyle(el).whiteSpace === 'pre-line' && zeilen >= 4;
  }));
check('KRITISCH: es gibt einen Weg vorbei -- "Trotzdem starten"',
  frage.includes('Trotzdem starten'));
check('Und einen zurück, der nicht startet',
  await page.evaluate(() => !document.getElementById('rgsDlgNein').hidden));
await page.screenshot({ path: `${OUT}/parallel-01-frage.png` });

// Abbrechen darf NICHT starten -- sonst waere die Rueckfrage eine Attrappe.
await klick(page, '#rgsDlgNein');
await page.waitForTimeout(300);
check('KRITISCH: "Abbrechen" startet nichts',
  startRufe.length === 1 && !startRufe[0].trotz_doppelbelegung);
check('Und die Vorschau bleibt bedienbar, statt mit gesperrten Knöpfen zurückzubleiben',
  await page.evaluate(() => {
    const b = document.getElementById('rgsStartBtn');
    return !!b && !b.disabled;
  }));

// Bestaetigen startet wirklich.
await starten();
await klick(page, '#rgsDlgJa');
await page.waitForTimeout(700);
check('KRITISCH: "Trotzdem starten" sendet die Bestätigung mit',
  startRufe.length === 2 && startRufe[1].trotz_doppelbelegung === true);
check('KRITISCH: und die Runde läuft danach wirklich',
  await page.evaluate(() => rundgangAktiv !== null && Number(rundgangAktiv.rundgang_id || rundgangAktiv.id) === 7));

// Scheitert die Meldung an die Disposition, muss das gesagt werden -- sonst
// glaubt der Waechter, die Umplanung sei dokumentiert.
mitBestaetigung = { status: 'ok', einsatz_id: 99, rundgang_id: 7, kontrollpunkte: [],
  ereignis_fehler: 'Rundgang gestartet, Ereignismeldung fehlgeschlagen' };
await starten();
await klick(page, '#rgsDlgJa');
await page.waitForTimeout(700);
check('KRITISCH: eine fehlgeschlagene Meldung an die Disposition wird dem Wächter gesagt',
  (await page.textContent('body')).includes('Ereignismeldung fehlgeschlagen'));
mitBestaetigung = null;

await browser.close();

// ══════════ COCKPIT: DIE MARKE AN DER GEPLANTEN SCHICHT ═══════════════
const DASH = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
check('KRITISCH: alle Marken hinter dem Status-Chip stehen an EINER Stelle',
  /function einsatzMarken\(e\) \{/.test(DASH));
// Vier Ansichten benutzen sie. Vorher stand dieselbe Kette viermal da --
// eine neue Marke haette man dreimal richtig und einmal falsch eingebaut.
check('KRITISCH: und alle vier Ansichten benutzen sie',
  (DASH.match(/\$\{einsatzMarken\(e\)\}/g) || []).length === 4);
check('KRITISCH: die Marke für die parallele Runde ist dabei',
  /parallel_runden/.test(DASH) && /Revierrunde während dieser Schicht/.test(DASH));
check('Sie nennt Namen und Runde, nicht nur ein Zeichen',
  /\$\{wer\(p\)\}: \$\{p\.titel \|\| p\.kunde_name/.test(DASH));
check('Der Titel ist gegen Anführungszeichen im Namen abgesichert',
  /title="\$\{esc\('Revierrunde während dieser Schicht/.test(DASH));

// ── Und die Marke wirklich am Bildschirm, nicht nur im Quelltext ─────
// CLAUDE.md: Gestaltung wird GEMESSEN. Ein Regex auf dashboard.html sagt
// nur, dass die Zeichenkette dasteht -- nicht, dass der Planer sie sieht.
const HEUTE = iso(new Date());
const A = { id: 1, name: 'm.muster', vorname: 'Max', nachname: 'Muster', zusage: 'zugesagt' };
const EINSAETZE = { status: 'ok', einsaetze: [
  // Die GEPLANTE Schicht -- hier gehoert die Marke hin.
  { id: 11, kunde_id: 1, kunde_name: 'Muster AG', titel: 'Verkehrsdienst Kreisel', strasse: null,
    ort: '4632 Musterdorf', einsatzart: 'Verkehrsdienst', datum: HEUTE, von: '12:00:00', bis: '18:00:00',
    bedarf: 1, status: 'bestaetigt', bemerkung: null, mitarbeiter: [A], spontan_erzeugt: false,
    parallel_runden: [{ einsatz_id: 12, mitarbeiter_id: 1, titel: 'Spontaner Rundgang: Musterrunde Nord',
                        kunde_name: 'Muster AG', von: '13:00:00', bis: '13:30:00' }] },
  // Die spontane Runde selbst -- hier waere die Marke eine Selbstauskunft.
  { id: 12, kunde_id: 1, kunde_name: 'Muster AG', titel: 'Spontaner Rundgang: Musterrunde Nord',
    strasse: null, ort: '4632 Musterdorf', einsatzart: 'Revierdienst', datum: HEUTE,
    von: '13:00:00', bis: '13:30:00', bedarf: 1, status: 'bestaetigt', bemerkung: null,
    mitarbeiter: [A], spontan_erzeugt: true, parallel_runden: [] },
]};
const browser2 = await chromium.launch({ executablePath: EXE });
const dash = await browser2.newPage({ viewport: { width: 1440, height: 1000 } });
dash.on('pageerror', e => bad.push('JS-Fehler (Cockpit): ' + e.message));
await dash.route('**/api/**', route => {
  const path = route.request().url().split('/api/')[1].split('?')[0];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (path.includes('einsatz_list')) return send(EINSAETZE);
  if (path.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [
    { id: 1, name: 'm.muster', vorname: 'Max', nachname: 'Muster', personalnummer: 'P-001', aktiv: 1 }] });
  if (path.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
  if (path.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (path.includes('dashboard_stats')) return send({ status: 'ok',
    kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0,
           mitarbeiter: 1, kunden: 1, rapporte_total: 0 },
    verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  if (path.includes('anstellungsorte')) return send({ status: 'ok', orte: [] });
  if (path.includes('objekt_list')) return send({ status: 'ok', objekte: [] });
  if (path.includes('masterschicht_list')) return send({ status: 'ok', masterschichten: [] });
  if (path.includes('feiertage_list')) return send({ status: 'ok', feiertage: [], gepflegt: {} });
  return send({ status: 'ok' });
});
await dash.route('**maps.googleapis.com/**', r => r.abort());
await dash.goto(`file://${WURZEL}/dashboard.html`);
await dash.fill('#gName', 'adrian'); await dash.fill('#gPass', 'x'); await dash.click('#gBtn');
await dash.waitForSelector('#kpiGrid .kpi-val', { timeout: 15000 }).catch(() => {});
await klick(dash, '#nav-planung');
await klick(dash, '#nav-planung-einsaetze');
await dash.waitForSelector('#plTable table', { timeout: 15000 }).catch(() => {});
await dash.waitForTimeout(400);
const zeilen = await dash.evaluate(() => {
  const raus = {};
  document.querySelectorAll('#plTable table tbody tr').forEach(tr => {
    const marken = [...tr.querySelectorAll('.rap-abw')];
    const txt = tr.textContent;
    if (txt.includes('Verkehrsdienst Kreisel')) {
      raus.geplant = { zeichen: marken.map(m => m.textContent).join(''),
                       titel: marken.map(m => m.getAttribute('title') || '').join(' | '),
                       sichtbar: marken.some(m => m.getBoundingClientRect().width > 0) };
    }
    if (txt.includes('Spontaner Rundgang')) {
      raus.spontan = { zeichen: marken.map(m => m.textContent).join('') };
    }
  });
  return raus;
});
check('KRITISCH: an der geplanten Schicht steht die Marke wirklich am Bildschirm',
  !!zeilen.geplant && zeilen.geplant.zeichen.includes('🔀') && zeilen.geplant.sichtbar);
check('KRITISCH: sie nennt beim Darüberfahren Person und Runde',
  !!zeilen.geplant && zeilen.geplant.titel.includes('Max Muster')
  && zeilen.geplant.titel.includes('Musterrunde Nord') && zeilen.geplant.titel.includes('13:00'));
check('KRITISCH: am spontanen Einsatz selbst steht sie NICHT -- das wäre eine Selbstauskunft',
  !!zeilen.spontan && !zeilen.spontan.zeichen.includes('🔀'));
check('Das Blitz-Zeichen für "spontan erzeugt" bleibt daneben erhalten',
  !!zeilen.spontan && zeilen.spontan.zeichen.includes('⚡'));
await dash.screenshot({ path: `${OUT}/parallel-02-cockpit.png` });
await browser2.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
