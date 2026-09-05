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
const ABG = readFileSync(`${WURZEL}/backend/api/einsatz_abgleich.php`, 'utf8');
const AUSL = readFileSync(`${WURZEL}/backend/auslagen.php`, 'utf8');
const PLA = readFileSync(`${WURZEL}/backend/planung.php`, 'utf8');
const DASH = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
const APP_Q = readFileSync(`${WURZEL}/app.html`, 'utf8');

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
    kunde_name: 'Muster AG', fenster_von: null, fenster_bis: null },
  // Zweite Vorlage MIT Zeitfenster -- und zwar einem, das garantiert nicht
  // jetzt ist (Fenster 03:00-03:30 mit 5 Minuten Toleranz, siehe
  // RUNDGANG_FENSTER_TOLERANZ_MIN). Nur so laeuft der Start ueber die
  // Grundmaske, und nur DIESER Weg hatte den gemeldeten Fehler.
  { id: 502, name: 'Musterrunde Fenster', objekt_id: 7, objekt_name: 'Objekt Nord',
    kunde_name: 'Muster AG', fenster_von: '03:00:00', fenster_bis: '03:30:00' }] };
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
    const vid = Number(new URL(req.url()).searchParams.get('vorlage_id') || 501);
    const v = (VORLAGEN.vorlagen.find(x => x.id === vid) || VORLAGEN.vorlagen[0]);
    return send({ status: 'ok',
      vorlage: { id: v.id, name: v.name, fenster_von: v.fenster_von, fenster_bis: v.fenster_bis },
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
// Seit ENT-347 hat die Bestaetigung eine echte FOLGE: Er wird aus der
// anderen Einteilung genommen. Wer das nicht liest, bestaetigt etwas, dessen
// Wirkung er nicht kennt -- darum steht es in der Frage, nicht erst danach.
check('Und sie nennt die Folge: er wird aus der anderen Einteilung genommen',
  frage.includes('aus der anderen Einteilung genommen')
  && frage.includes('unbesetzt'));
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

// ── Der Weg ÜBER die Grundmaske (ENT-345, gemeldeter Fehler) ─────────
// Vom Projektinhaber: „Wenn man einen Grund angibt für die
// außerordentliche Durchführung und auf 'Rundgang starten' klickt,
// passiert scheinbar nichts. Wenn man oben beim Kreuz die Maske schliesst,
// kommt das Warnfenster erst zum Vorschein."
//
// Ursache: Die Schublade liegt mit z-index 61 ÜBER der Rundgang-Seite (55),
// und die Rückfrage ist ein KIND dieser Seite -- ihr eigener z-index gilt
// nur innerhalb deren Stapelkontexts und kann die Schublade nie überholen.
//
// Dass mir das durchging, hat einen Grund, der hier festgehalten gehört:
// Die Prüfungen oben nehmen den DIREKTEN Weg (Runde ohne Zeitfenster). Der
// gemeldete Fehler sitzt auf dem ZWEITEN Weg. Zwei Einstiege, einer
// geprüft -- das reicht nicht.
startRufe = [];
await page.evaluate(() => { blattZu(); rgSeiteZu(); });
await page.waitForTimeout(150);
await page.evaluate(() => rundgangUebersichtOeffnen());
await page.waitForTimeout(350);
await klick(page, '#blBody button:has-text("Musterrunde Fenster")');
await page.waitForTimeout(400);
await klick(page, '#rgsStartBtn');
await page.waitForTimeout(400);
check('KRITISCH: ausserhalb des Fensters erscheint zuerst die Grundmaske',
  await page.evaluate(() => !!document.getElementById('rfsGrund')
    && document.getElementById('blatt').classList.contains('on')));
await page.selectOption('#rfsGrund', 'planer_freigabe').catch(() => {});
await klick(page, '#rfsBtn');
await page.waitForTimeout(500);
// Der eigentliche Befund: Die Rueckfrage darf nicht HINTER der Maske
// stehen. Gemessen wird am gerenderten Zustand -- ein hidden=false allein
// haette den Fehler nie gezeigt, die Rueckfrage war ja "offen", nur
// unsichtbar.
const sicht = await page.evaluate(() => {
  const dlg = document.getElementById('rgsDlg');
  const blatt = document.getElementById('blatt');
  if (!dlg || !blatt) return null;
  const box = dlg.querySelector('.rgs-dlg-box');
  const r = box ? box.getBoundingClientRect() : { width: 0, height: 0, left: 0, top: 0 };
  // Wer liegt an der Mitte des Dialogs wirklich oben?
  const oben = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { offen: !dlg.hidden, blattOffen: blatt.classList.contains('on'),
           flaeche: r.width * r.height,
           obenImDialog: !!oben && !!oben.closest('#rgsDlg') };
});
check('KRITISCH: nach dem Grund erscheint die Rückfrage — und zwar SICHTBAR',
  !!sicht && sicht.offen && sicht.flaeche > 1000 && sicht.obenImDialog);
check('KRITISCH: die Grundmaske ist dabei geschlossen, sie verdeckt nichts mehr',
  !!sicht && !sicht.blattOffen);
check('Der Grund wird beim zweiten Anlauf mitgeschickt, nicht verworfen',
  await page.evaluate(async () => {
    const ja = document.getElementById('rgsDlgJa');
    if (!ja) return false;
    ja.click();
    await new Promise(r => setTimeout(r, 600));
    return true;
  }) && startRufe.length === 2
    && startRufe[1].ausnahme_grund === 'planer_freigabe'
    && startRufe[1].trotz_doppelbelegung === true);
await page.screenshot({ path: `${OUT}/parallel-03-nach-grund.png` });

await browser.close();

// ══════════ COCKPIT: DIE MARKE AN DER GEPLANTEN SCHICHT ═══════════════
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
// Dieselbe Person, aber aus der Schicht entfallen (ENT-347) -- so sieht die
// geplante Schicht aus, nachdem der Waechter bestaetigt hat.
const A_ENTF = { ...A, zusage: 'entfallen' };
const EINSAETZE = { status: 'ok', einsaetze: [
  // Die GEPLANTE Schicht -- hier gehoert die Marke hin.
  { id: 11, kunde_id: 1, kunde_name: 'Muster AG', titel: 'Verkehrsdienst Kreisel', strasse: null,
    ort: '4632 Musterdorf', einsatzart: 'Verkehrsdienst', datum: HEUTE, von: '12:00:00', bis: '18:00:00',
    bedarf: 1, status: 'bestaetigt', bemerkung: null, mitarbeiter: [A_ENTF], spontan_erzeugt: false,
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
// Volle Leiste ausdruecklich erzwingen: Diese Suite prueft parallele
// Runden, nicht die Huelle (ENT-407) -- der Klick auf den Unterpunkt
// unten setzt die ausgeklappte Leiste voraus.
await dash.evaluate(() => huelleSetzen('voll'));
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

// ── Der eigentliche Schutz des Planers, gemessen ─────────────────────
// Nicht die Marke, sondern die UNTERBESETZUNG: Die Schicht muss von 1/1 auf
// 0/1 springen und als unterbesetzt markiert sein. Genau das war der Punkt
// des Projektinhabers -- eine still doppelt belegte Schicht sieht besetzt
// aus, eine unterbesetzte nicht.
const besetzung = await dash.evaluate(() => {
  const raus = {};
  document.querySelectorAll('#plTable table tbody tr').forEach(tr => {
    if (!tr.textContent.includes('Verkehrsdienst Kreisel')) return;
    const chips = [...tr.querySelectorAll('.chip')].map(c => ({
      txt: c.textContent.trim(), klasse: c.className }));
    const nm = tr.querySelector('.nm');
    raus.chips = chips;
    raus.name = nm ? { txt: nm.textContent.trim(), klasse: nm.className,
                       titel: nm.getAttribute('title') || '',
                       durchgestrichen: getComputedStyle(nm).textDecorationLine.includes('line-through') } : null;
  });
  return raus;
});
check('KRITISCH: die geplante Schicht zählt den Entfallenen NICHT als Besetzung (0/1, gemessen)',
  !!besetzung.chips && besetzung.chips.some(c => c.txt === '0/1'));
check('KRITISCH: und sie ist als unterbesetzt markiert, nicht als vollständig',
  !!besetzung.chips && besetzung.chips.some(c => c.txt === '0/1' && /chip-w/.test(c.klasse)));
check('Der Name steht weiterhin da -- die Zuteilung ist nicht gelöscht (Nachweis)',
  !!besetzung.name && besetzung.name.txt.includes('Muster'));
check('Er ist erkennbar entfallen, nicht als Absage ausgegeben',
  !!besetzung.name && /nm-entfallen/.test(besetzung.name.klasse)
  && besetzung.name.durchgestrichen
  && besetzung.name.titel.includes('Revierrunde'));
await dash.screenshot({ path: `${OUT}/parallel-02-cockpit.png` });
await browser2.close();

// ══════════ ENT-347: AUS DER SCHICHT ENTFALLEN, NICHT GELOESCHT ═══════
// Vom Projektinhaber: „Wenn ein Mitarbeiter deutlich bestaetigt, dass er an
// einem anderen Auftrag arbeitet, muss es ihn aus der anderen Schicht
// zwangsmaessig entfernen. Das schuetzt den Planer vor einem Fehler."
// Und auf Rueckfrage praezisiert: „seine schicht wird nicht rausgelöscht,
// er wird nur entfernt aus der schicht".
check('KRITISCH: die kollidierende Zuteilung wird auf "entfallen" gesetzt, nicht gelöscht',
  /UPDATE einsatz_zuteilung SET zusage = 'entfallen'/.test(EP)
  && !/DELETE FROM einsatz_zuteilung/.test(EP));
// „abgelehnt" ist eine Aussage der Person. Kein Automatismus darf sie
// ueberschreiben -- und dort ist der Platz ohnehin schon offen.
check('KRITISCH: eine bereits abgelehnte oder entfallene Einteilung wird nicht angetastet',
  /zusage NOT IN \('abgelehnt', 'entfallen'\)/.test(EP));
check('Das Ereignis nennt, was mit der geplanten Schicht geschehen ist',
  /aus dieser Einteilung entfallen/.test(EP)
  && /die Einteilung blieb unveraendert/.test(EP));
// Sonst meldete die Sperre denselben Konflikt bei jedem weiteren Versuch --
// gegen eine Zuteilung, die sie selbst aufgeloest hat.
check('KRITISCH: die Doppelbelegungs-Sperre zählt entfallene Zuteilungen nicht mehr mit',
  /AND z\.zusage NOT IN \('entfallen', 'abgelehnt'\)/.test(PLA));
// REVIDIERT durch ENT-350 (OP-348, vom Projektinhaber entschieden): 'abgelehnt'
// zaehlt jetzt ebenfalls nicht mehr mit. Vorher ein bewusster Widerspruch zur
// Planungsliste (dort zaehlt eine Absage seit ENT-113 nicht als besetzt) --
// jetzt sagen Anzeige und Sperre dasselbe.
check('KRITISCH: und ebenso abgelehnte Zuteilungen (ENT-350)',
  /AND z\.zusage NOT IN \('entfallen', 'abgelehnt'\)\s*\n\s*AND e\.datum BETWEEN/.test(PLA));
// Ohne das waere die halbe Wirkung verpufft: sichtbar unterbesetzt, aber der
// Auslagenersatz weiter gesperrt wegen einer Zuteilung, die es nicht gibt.
check('KRITISCH: die GAV-AUS-010-Tagesprüfung ebenso -- entfallen UND abgelehnt',
  /AND z\.zusage NOT IN \('entfallen', 'abgelehnt'\) AND e\.id != \?/.test(ABG));

// Eine Regel, was als Besetzung zaehlt -- nicht drei.
check('KRITISCH: das Cockpit hat EINE Regel für "zählt als Besetzung"',
  /const ZUSAGE_NICHT_BESETZT = \['abgelehnt', 'entfallen'\];/.test(DASH)
  && /const zaehltAlsBesetzt = /.test(DASH));
check('Und sowohl die Planungsliste als auch das Positionsraster benutzen sie',
  /const besetzt = e => \(e\.mitarbeiter \|\| \[\]\)\.filter\(m => zaehltAlsBesetzt\(zusageVon\(m\)\)\)/.test(DASH)
  && /const epBesetzt = p => !!p\.mitarbeiter_id && zaehltAlsBesetzt\(p\.zusage\)/.test(DASH));
check('Entfallen ist im Cockpit von "abgelehnt" unterscheidbar -- zwei verschiedene Lagen',
  /nm-entfallen/.test(DASH) && /ENTFALLEN — läuft eine Revierrunde/.test(DASH));
// Der Waechter darf sich nicht stillschweigend in eine Schicht
// zurueckklicken, aus der ihn das System bewusst genommen hat.
check('KRITISCH: in der App gibt es bei einer entfallenen Schicht keine Zusage-Knöpfe',
  /if \(e\.zusage === 'entfallen'\) \{/.test(APP_Q)
  && /entfallenTxt/.test(APP_Q));
check('KRITISCH: die Rückfrage nennt die Folge — er wird aus der anderen Einteilung genommen',
  /du wirst dann aus der anderen Einteilung genommen/.test(APP_Q));

// ══════════ OP-343: WAS DER ABGLEICH MIT ZWEI EINSAETZEN MACHT ════════
// Ausdruecklich geprueft, weil die Doppelbelegung seit ENT-342 bewusst
// entsteht und der naechste Monatsabschluss echtes Geld betrifft. Drei
// Zusicherungen -- jede einzeln nachgesehen, nicht angenommen:

// 1. Der Abgleich rechnet keine Arbeitszeit. Ohne diese Zusicherung koennte
//    ein zweiter Einsatz am selben Tag ueberhaupt zu doppeltem Lohn fuehren.
check('OP-343: der Abgleich leitet weiterhin KEINE Arbeitszeit und keine Zuschläge ab',
  /Bewusst KEINE Berechnung der ARBEITSZEIT/.test(ABG)
  && !/stunden|lohn_rappen|zuschlag_rappen/i.test(
       ABG.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));

// 2. Der spontane Einsatz traegt KEIN weg_km. Damit ist sein Auslagenersatz
//    "nicht bestimmbar" statt "0" oder gar eines zweiten Betrages -- der
//    entscheidende Grund, warum kein doppelter Auslagenersatz entsteht.
check('OP-343: der spontane Einsatz wird ohne Wegstrecke angelegt -- er erzeugt darum keinen zweiten Auslagenersatz',
  /INSERT INTO einsaetze \(kunde_id, kunde_name, titel, strasse, ort, kanton, einsatzart, sparte,\s*\n\s*datum, von, bis, bedarf, status, bemerkung, erstellt_von, spontan_erzeugt\)/.test(EP)
  && !/weg_km/.test(EP));

// 3. Die AUS-010-Sperre greift VOR jeder Betragsrechnung, aber NACH dem
//    Anstellungsgebiet (dort ist ohnehin nichts geschuldet). Genau diese
//    Reihenfolge entscheidet, ob der neue Fall heute schon Wirkung hat.
const iAnst = AUSL.indexOf("if (!$zone['entschaedigung'])");
const iAus010 = AUSL.indexOf("if ($gavAus010Blockiert)");
check('OP-343: das Anstellungsgebiet wird VOR der AUS-010-Sperre entschieden (heute ohne Wirkung)',
  iAnst > 0 && iAus010 > 0 && iAnst < iAus010);
check('OP-343: die AUS-010-Sperre setzt einen Grund und KEINEN Betrag',
  /\$zeile\['gesperrt_grund'\] = 'gav_aus_010';\s*\n\s*return \$zeile;/.test(AUSL));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
