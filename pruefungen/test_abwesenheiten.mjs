// Abwesenheitsplanung: Ferien, Krankheit, Unfall, Militaer-/Zivildienst,
// Schwangerschaft mit Antrags-/Genehmigungsworkflow (ENT-252).
//
// WORAUF DIESE SUITE BESONDERS ACHTET:
//
// 1. Der Ferienanspruch ist eine Geldrechnung (Ferientage sind
//    Lohnaequivalent, siehe Art. 20 Ziff. 2 fuer Kategorie C). Der
//    Rechenkern (backend/ferien.php) wird deshalb wirklich AUSGEFUEHRT
//    (pruef_ferien.php), nicht nur im Quelltext gelesen -- Playwright bildet
//    unten nur die Oberflaeche nach.
//
// 2. Die Kuerzungsregel bei langer Krankheit/Unfall (Art. 20 Ziff. 5) laeuft
//    auf einer ausdruecklich offenen Auslegungsfrage (GAV-AUS-012, siehe
//    sop-projekt/90-gav/auslegungsregister.md). Der Code muss das an jeder
//    Stelle, an der er die Kuerzung anwendet, auch so kennzeichnen -- eine
//    Annahme darf nie wie ein Beleg aussehen.
//
// 3. "abwesenheit" darf NICHT ueber den generischen ereignis_erledigt.php
//    abhakbar sein: dessen Rechtepruefung ist "plan", nicht
//    "personal_schreiben" -- sonst koennte eine Planungs-Person einen
//    unentschiedenen Antrag stillschweigend aus dem Feed nehmen, ohne ihn
//    entscheiden zu duerfen.
//
// 4. Kategorie C fuehrt keinen Tage-Saldo (Ziff. 2: Lohnzuschlag statt
//    Tage-Bezug) -- ein Kalendereintrag ist erlaubt, ein Saldo waere falsch.
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Der Rechenkern wird wirklich ausgefuehrt
// ══════════════════════════════════════════════════════════════════════════
let phpAusgabe = '', phpCode = 0;
try {
  phpAusgabe = execFileSync('php', [`${HIER}/pruef_ferien.php`], { encoding: 'utf8' });
} catch (e) {
  phpAusgabe = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAusgabe.match(/^(\d+) Pruefungen ausgefuehrt/m) || [0, 0])[1]);
const phpFehler = phpAusgabe.split('\n').filter(z => z.startsWith('X '));
check('KRITISCH: der Ferienanspruch-Rechenkern laeuft ueberhaupt durch', phpAnzahl > 0);
check('KRITISCH: alle Rechenkern-Pruefungen des Ferienanspruchs bestehen',
  phpCode === 0 && phpFehler.length === 0);
phpFehler.forEach(f => bad.push('PHP: ' + f));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Datenmodell, Rechte, Verdrahtung (Quelltext)
// ══════════════════════════════════════════════════════════════════════════
const EINRICHTEN = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const MEINE = readFileSync(`${WURZEL}/backend/api/meine_abwesenheit.php`, 'utf8');
const LISTE = readFileSync(`${WURZEL}/backend/api/abwesenheit_list.php`, 'utf8');
const ENTSCHEIDEN = readFileSync(`${WURZEL}/backend/api/abwesenheit_entscheiden.php`, 'utf8');
const SALDO = readFileSync(`${WURZEL}/backend/api/abwesenheit_saldo.php`, 'utf8');
const EREIGNISSE = readFileSync(`${WURZEL}/backend/ereignisse.php`, 'utf8');
const FERIEN = readFileSync(`${WURZEL}/backend/ferien.php`, 'utf8');

check('KRITISCH: die Tabelle abwesenheiten wird bei der Einrichtung angelegt',
  /'abwesenheiten' => "\s*CREATE TABLE IF NOT EXISTS abwesenheiten/.test(EINRICHTEN));
check('KRITISCH: Status und Zeitraum sind eigene Spalten, kein zusammengesetztes Feld',
  /status VARCHAR\(20\)/.test(EINRICHTEN) && /von DATE NOT NULL/.test(EINRICHTEN) && /bis DATE NOT NULL/.test(EINRICHTEN));

check('KRITISCH: die eigene Antragsverwaltung prueft KEIN Recht -- rein auf die eigene Person begrenzt',
  !/require_recht|require_verwaltung/.test(MEINE));
check('KRITISCH: Stornieren wirkt nur auf noch unentschiedene (beantragte) eigene Antraege',
  /status = 'beantragt'/.test(MEINE) && /mitarbeiter_id = \?/.test(MEINE));
check('KRITISCH: Ferien lassen sich nicht rueckwirkend beantragen',
  /\$typ === 'ferien' && \$von < date\('Y-m-d'\)/.test(MEINE));

check('KRITISCH: die Gesamtansicht verlangt das Recht personal_lesen',
  /require_recht\(\$user, 'personal_lesen'\)/.test(LISTE));

check('KRITISCH: Genehmigen/Ablehnen verlangt personal_schreiben, nicht nur irgendein Recht',
  /require_recht\(\$user, 'personal_schreiben'\)/.test(ENTSCHEIDEN));
check('KRITISCH: eine Ablehnung braucht zwingend eine Begruendung',
  /abgelehnt' && \$grund === ''/.test(ENTSCHEIDEN));

check('KRITISCH: der Saldo ist Selbstbedienung mit Ausweitung durch personal_lesen (wie rapport_list.php)',
  /!== \(int\)\$user\['id'\][\s\S]{0,40}darf\(\$user, 'personal_lesen'\)/.test(SALDO));
check('KRITISCH: Kategorie C bekommt ausdruecklich keinen Saldo angezeigt (Lohnzuschlag statt Tage)',
  /ferien_grundanspruch_tage_c|kategorie === 'C'/.test(FERIEN));

check('KRITISCH: "abwesenheit" ist NICHT ueber ereignis_erledigt.php abhakbar (dessen Recht ist nur "plan")',
  !/'abwesenheit'\s*=>\s*\[/.test(EREIGNISSE.split('function ereignisse_sammeln')[0]));
check('KRITISCH: ein offener Abwesenheitsantrag erscheint trotzdem im Ereignis-Feed',
  /status = 'beantragt' AND a\.gesehen_am IS NULL/.test(EREIGNISSE));

check('KRITISCH: die Kuerzungsregel ist im Rechenkern ausdruecklich als ANNAHME gekennzeichnet',
  /ANNAHME[\s\S]{0,200}GAV-AUS-012/.test(FERIEN));
check('KRITISCH: der Saldo-Endpunkt gibt die Kuerzung erkennbar als Annahme mit, nicht als Tatsache',
  /kuerzung_ist_annahme/.test(FERIEN));

check('ferien.php ist gegen direkten Web-Abruf gesperrt',
  /ferien/.test(readFileSync(`${WURZEL}/htaccess-hostpoint`, 'utf8')));
check('ferien.php wird auch tatsaechlich deployt',
  /cp backend\/ferien\.php dist\//.test(readFileSync(`${WURZEL}/.github/workflows/deploy-hostpoint.yml`, 'utf8')));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 3 — Oberflaeche: Dashboard (Gesamtansicht) und App (Selbstbedienung)
// ══════════════════════════════════════════════════════════════════════════
const browser = await chromium.launch({ executablePath: EXE });

// ── Dashboard: Gesamtansicht, Filter, Genehmigen ────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', e => bad.push('JS-Fehler (Dashboard): ' + e.message));
  const gesendet = [];
  let abwesenheiten = [
    { id: 10, mitarbeiter_id: 1, typ: 'ferien', von: iso(new Date()), bis: iso(new Date(Date.now() + 4 * 864e5)),
      status: 'genehmigt', bemerkung: null },
    { id: 11, mitarbeiter_id: 2, typ: 'krankheit', von: iso(new Date()), bis: iso(new Date(Date.now() + 864e5)),
      status: 'beantragt', bemerkung: 'Grippe' },
  ];
  await page.route('**/api/**', route => {
    const req = route.request(), u = req.url();
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
    const s = x => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('login')) return s({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (u.includes('me.php')) return s({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [],
      rechte: ['personal_lesen', 'personal_schreiben', 'betrieb'] });
    if (u.includes('mitarbeiter_list')) return s({ status: 'ok', mitarbeiter: [
      { id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'Muster', aktiv: 1, ist_admin: 1,
        funktion_id: null, abteilung_id: null, anstellungsort_id: null },
      { id: 2, name: 'sarah', vorname: 'Sarah', nachname: 'Beispiel', aktiv: 1, ist_admin: 0,
        funktion_id: null, abteilung_id: null, anstellungsort_id: null },
    ], listen: { funktion: [], abteilung: [] } });
    if (u.includes('anstellungsorte')) return s({ status: 'ok', orte: [] });
    if (u.includes('feiertage')) return s({ status: 'ok', feiertage: [] });
    if (u.includes('abwesenheit_entscheiden')) {
      gesendet.push(body);
      abwesenheiten = abwesenheiten.map(a => a.id === body.id
        ? { ...a, status: body.status, ablehnung_grund: body.ablehnung_grund || null } : a);
      return s({ status: 'ok', id: body.id, neuer_status: body.status });
    }
    if (u.includes('abwesenheit_list')) return s({ status: 'ok', von: '2000-01-01', bis: '2100-01-01',
      abwesenheiten, darf_entscheiden: true });
    if (u.includes('dashboard_stats')) return s({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [],
      pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
    return s({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: {}, gepflegt: {},
      sperren: [], adressen: [], wege: [], fahrzeuge: [], dokumente: [], positionen: [], orte: [] });
  });

  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on');
  await page.evaluate(() => { go('abwesenheiten'); });
  await page.waitForTimeout(500);

  check('Die Gesamtansicht zeigt beide Mitarbeitenden mit ihren Abwesenheiten',
    (await page.textContent('#awRaster')).includes('Adrian Muster')
    && (await page.textContent('#awRaster')).includes('Sarah Beispiel'));
  check('KRITISCH: eine genehmigte Ferien-Zelle ist NICHT schraffiert (aw-offen)',
    await page.evaluate(() => !!document.querySelector('.aw-blk.aw-ferien:not(.aw-offen)')));
  check('KRITISCH: eine beantragte Krankheits-Zelle IST schraffiert -- eine Vermutung sieht nie wie ein Beleg aus',
    await page.evaluate(() => !!document.querySelector('.aw-blk.aw-andere.aw-offen')));
  const legendeText = await page.textContent('#view-abwesenheiten .legende');
  check('Die Legende nennt beide Farbgruppen und erklaert die Schraffur',
    /Ferien/.test(legendeText) && /schraffiert/.test(legendeText));

  check('Der offene Antrag steht in der Warteschlange mit Genehmigen/Ablehnen',
    /Sarah Beispiel/.test(await page.textContent('#awOffeneListe'))
    && /Genehmigen/.test(await page.textContent('#awOffeneListe')));

  await page.click('#awOffeneListe .btn-primary');
  await page.waitForTimeout(400);
  check('KRITISCH: Genehmigen schickt den richtigen Antrag mit Status "genehmigt"',
    gesendet.some(g => g.id === 11 && g.status === 'genehmigt'));

  // ── Filter: nach Funktion/Abteilung/Anstellungsort gefiltert -----------
  await page.selectOption('#awFunktion', { index: 0 }); // zurueck auf "alle" -- Ausgangslage sichern
  check('Filter-Dropdowns sind vorhanden und bedienbar',
    await page.isVisible('#awFunktion') && await page.isVisible('#awAbteilung') && await page.isVisible('#awStandort'));

  await page.close();
}

// ── App: eigene Abwesenheit beantragen, ansehen, zurueckziehen ─────────────
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => bad.push('JS-Fehler (App): ' + e.message));
  let meine = [
    { id: 5, typ: 'krankheit', von: iso(new Date(Date.now() - 5 * 864e5)), bis: iso(new Date(Date.now() - 3 * 864e5)),
      status: 'abgelehnt', bemerkung: 'Grippe', ablehnung_grund: 'Bereits durch Ferien gedeckt' },
  ];
  const gesendet = [];
  await page.route('**/api/**', route => {
    const req = route.request(), u = req.url();
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
    const s = x => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('login')) return s({ status: 'ok', token: 't', name: 'sarah', ist_admin: false });
    if (u.includes('me.php')) return s({ status: 'ok', name: 'sarah', ist_admin: false, rollen: [], rechte: [] });
    if (u.includes('meine_abwesenheit.php')) {
      if (body && body.stornieren) {
        gesendet.push(body);
        const vorher = meine.length;
        meine = meine.filter(a => !(a.id === body.id && a.status === 'beantragt'));
        return s(meine.length < vorher ? { status: 'ok' } : { status: 'error', message: 'nicht gefunden' });
      }
      if (body && body.typ) {
        gesendet.push(body);
        const neu = { id: 99, ...body, status: 'beantragt' };
        meine.push(neu);
        return s({ status: 'ok', id: 99 });
      }
      return s({ status: 'ok', abwesenheiten: meine });
    }
    return s({ status: 'ok', schichten: [], rapporte: [], tage: [] });
  });

  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'sarah'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForTimeout(500);
  await page.click('#t-plan');
  await page.waitForTimeout(200);
  await page.click('#pu-abwesenheit');
  await page.waitForTimeout(200);

  check('KRITISCH: eine abgelehnte eigene Abwesenheit zeigt Status UND Begruendung',
    /Abgelehnt/.test(await page.textContent('#plan-inhalt-abwesenheit'))
    && /Bereits durch Ferien gedeckt/.test(await page.textContent('#plan-inhalt-abwesenheit')));
  check('Eine abgelehnte Abwesenheit bietet KEIN Zurueckziehen mehr an -- sie ist bereits entschieden',
    !(await page.locator('#plan-inhalt-abwesenheit button:has-text("Zurückziehen")').count()));

  await page.click('button:has-text("Neuer Antrag")');
  await page.waitForTimeout(200);
  check('Das Antragsformular oeffnet sich als Blatt mit Art/Von/Bis/Bemerkung',
    await page.isVisible('#awTyp') && await page.isVisible('#awVon') && await page.isVisible('#awBis') && await page.isVisible('#awBemerkung'));

  const inFuenfTagen = iso(new Date(Date.now() + 5 * 864e5));
  const inZehnTagen = iso(new Date(Date.now() + 10 * 864e5));
  await page.selectOption('#awTyp', 'ferien');
  await page.fill('#awVon', inFuenfTagen);
  await page.fill('#awBis', inZehnTagen);
  await page.fill('#awBemerkung', 'Sommerferien');
  await page.click('button:has-text("Senden")');
  await page.waitForTimeout(400);
  check('KRITISCH: der neue Antrag wird mit Art, Zeitraum und Bemerkung gesendet',
    gesendet.some(g => g.typ === 'ferien' && g.von === inFuenfTagen && g.bis === inZehnTagen && g.bemerkung === 'Sommerferien'));
  check('Der neue, noch unentschiedene Antrag erscheint sofort in der eigenen Liste',
    /Sommerferien/.test(await page.textContent('#plan-inhalt-abwesenheit')));

  // Ferien rueckwirkend beantragen wird schon im Browser abgefangen, nicht
  // erst am Server -- sofortige Rueckmeldung statt eines Umwegs.
  await page.click('button:has-text("Neuer Antrag")');
  await page.waitForTimeout(200);
  const gestern = iso(new Date(Date.now() - 864e5));
  await page.selectOption('#awTyp', 'ferien');
  await page.fill('#awVon', gestern);
  await page.fill('#awBis', gestern);
  const vorAnzahl = gesendet.length;
  await page.click('button:has-text("Senden")');
  await page.waitForTimeout(300);
  check('KRITISCH: eine rueckwirkende Ferien-Anfrage wird VOR dem Senden abgefangen',
    gesendet.length === vorAnzahl);
  await page.click('button:has-text("Abbrechen")');

  // Zurueckziehen eines noch offenen Antrags (des eben gestellten Ferien-Antrags).
  await page.click('#plan-inhalt-abwesenheit button:has-text("Zurückziehen")');
  await page.waitForTimeout(400);
  check('KRITISCH: Zurueckziehen storniert genau diesen Antrag',
    gesendet.some(g => g.stornieren === true && g.id === 99));
  check('Nach dem Zurueckziehen ist der Antrag aus der eigenen Liste verschwunden',
    !/Sommerferien/.test(await page.textContent('#plan-inhalt-abwesenheit')));

  const knopfHoeheApp = await page.evaluate(() => {
    const b = document.querySelector('#plan-inhalt-abwesenheit .btn-primary');
    return b ? b.getBoundingClientRect().height : 0;
  });
  check('KRITISCH: "Neuer Antrag"-Knopf in der App erreicht die 44px-Mindesttrefferflaeche',
    knopfHoeheApp >= 44);

  await page.close();
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
