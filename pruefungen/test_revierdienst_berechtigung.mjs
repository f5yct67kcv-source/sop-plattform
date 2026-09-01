// Warnung beim Zuteilen ohne Revierdienst-Berechtigung (ENT-284).
//
// Der teuerste Fehler waere hier eine Warnung, die nie erscheint (ein
// unberechtigt zugeteilter Waechter faellt niemandem auf) oder eine, die
// stumm blockiert (der Planer kann nicht mehr speichern und weiss nicht,
// warum). Beides wird hier geprueft, ueber den echten Schubladen-Weg
// (openEinsatzDrawer/saveEinsatz), nicht durch Aufrufen interner Funktionen.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Aus HEUTE berechnet statt fest hingeschrieben (test_datumsfest.mjs): das
// genaue Datum ist dem Einsatz hier egal, ein festes Datum waere trotzdem
// eine Zeitbombe.
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const IN_10_TAGEN = iso(new Date(Date.now() + 10 * 864e5));

const MA_BERECHTIGT   = { id: 1, name: 'wächter-a', vorname: 'Erste', nachname: 'Wächterin' };
const MA_UNBERECHTIGT = { id: 2, name: 'waechter-b', vorname: 'Zweite', nachname: 'Wächterin' };

const EINSATZ_REVIER = { id: 70, kunde_id: 1, kunde_name: 'Testkunde', objekt_id: null,
  titel: 'Nachtkontrolle', strasse: null, ort: 'Testort', kanton: null,
  einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: IN_10_TAGEN,
  von: '20:00:00', bis: '22:00:00', bedarf: 2, status: 'geplant', bemerkung: null,
  mitarbeiter: [{ id: 2, name: 'waechter-b', vorname: 'Zweite', nachname: 'Wächterin', zusage: 'zugesagt' }] };
// Dieselbe unberechtigte Person, aber Verkehrsdienst -- die Pruefung greift
// nur bei Revierdienst, das muss stimmen, nicht nur die Existenz der Warnung.
const EINSATZ_VERKEHR = { ...EINSATZ_REVIER, id: 71, einsatzart: 'Verkehrsdienst', titel: 'Verkehrsregelung' };

let gesendet = [];

async function seite(einsatz) {
  gesendet = [];
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', route => {
    const req = route.request();
    const p = req.url().split('/api/')[1].split('?')[0];
    const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (p.includes('einsatz_list')) return send({ status: 'ok', eingegrenzt: false, einsaetze: [einsatz] });
    if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [MA_BERECHTIGT, MA_UNBERECHTIGT], listen: {} });
    if (p.includes('einsatz_save') && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      gesendet.push(body);
      // Dieselbe Weiche wie ohneRevierdienstBerechtigung() im Backend: nur
      // bei Revierdienst wird ueberhaupt geprueft (ENT-284) -- ein Mock, der
      // das nicht nachbildet, koennte diese Abgrenzung nie widerlegen.
      if (body.einsatzart === 'Revierdienst' && !body.trotz_fehlender_berechtigung) {
        return send({ status: 'error', unberechtigt: true,
          message: 'Ohne Revierdienst-Berechtigung: Zweite Wächterin',
          personen: [{ mitarbeiter_id: 2, name: 'Zweite Wächterin', login_name: 'waechter-b' }] }, 409);
      }
      return send({ status: 'ok', id: einsatz.id });
    }
    return send({ status: 'ok', mitarbeiter: [], kunden: [], einsaetze: [], objekte: [], rapporte: [],
      orte: [], feiertage: [], gepflegt: {}, masterschichten: [], kpi: {}, verlauf: [], angemeldet: [],
      pro_mitarbeiter: [], letzte_rapporte: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(400);
  await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
  await page.evaluate(() => loadEinsaetze());
  await page.waitForTimeout(300);
  return { browser, page };
}

// ══════════════ WARNFENSTER ERSCHEINT, NENNT DIE RICHTIGE PERSON
{
  const { browser, page } = await seite(EINSATZ_REVIER);
  await page.evaluate((id) => openEinsatzDrawer(id), EINSATZ_REVIER.id);
  await page.waitForTimeout(300);
  await page.click('#drFoot button:has-text("Speichern")');
  await page.waitForTimeout(400);
  check('KRITISCH: das Warnfenster oeffnet sich',
    await page.evaluate(() => document.getElementById('dlgRevierWarnung').classList.contains('on')));
  check('KRITISCH: es nennt die unberechtigte Person',
    (await page.textContent('#rwText')).includes('Zweite Wächterin'));
  check('Ohne Bestaetigung wird NICHT gespeichert -- der erste Versuch bleibt ohne Override',
    gesendet.length === 1 && !gesendet[0].trotz_fehlender_berechtigung);
  await browser.close();
}

// ══════════════ "ZUR MITARBEITER-AKTE" FRAGT DIE RICHTIGE PERSON AN
{
  const { browser, page } = await seite(EINSATZ_REVIER);
  await page.evaluate((id) => openEinsatzDrawer(id), EINSATZ_REVIER.id);
  await page.waitForTimeout(300);
  await page.click('#drFoot button:has-text("Speichern")');
  await page.waitForTimeout(400);
  let dossierUrl = null;
  page.on('request', req => { if (req.url().includes('mitarbeiter_dossier')) dossierUrl = req.url(); });
  await page.click('#rwZurAkte');
  await page.waitForTimeout(400);
  check('KRITISCH: "Zur Mitarbeiter-Akte" fragt genau die unberechtigte Person an, nicht irgendeine',
    !!dossierUrl && dossierUrl.includes('waechter-b'));
  check('Das Warnfenster schliesst sich dabei',
    !(await page.evaluate(() => document.getElementById('dlgRevierWarnung').classList.contains('on'))));
  await browser.close();
}

// ══════════════ "TROTZDEM ZUTEILEN" SENDET MIT BESTAETIGUNG UND SPEICHERT
{
  const { browser, page } = await seite(EINSATZ_REVIER);
  await page.evaluate((id) => openEinsatzDrawer(id), EINSATZ_REVIER.id);
  await page.waitForTimeout(300);
  await page.click('#drFoot button:has-text("Speichern")');
  await page.waitForTimeout(400);
  await page.click('#rwTrotzdem');
  await page.waitForTimeout(400);
  check('KRITISCH: der zweite Versuch traegt die Bestaetigung',
    gesendet.length === 2 && gesendet[1].trotz_fehlender_berechtigung === true);
  check('KRITISCH: danach ist die Schublade zu -- die Zuteilung ist wirklich gespeichert',
    !(await page.evaluate(() => document.getElementById('drawer').classList.contains('on'))));
  check('Das Warnfenster erscheint beim zweiten Versuch nicht nochmal',
    !(await page.evaluate(() => document.getElementById('dlgRevierWarnung').classList.contains('on'))));
  await browser.close();
}

// ══════════════ KEINE WARNUNG BEI ANDERER EINSATZART (dieselbe Person)
{
  const { browser, page } = await seite(EINSATZ_VERKEHR);
  await page.evaluate((id) => openEinsatzDrawer(id), EINSATZ_VERKEHR.id);
  await page.waitForTimeout(300);
  await page.click('#drFoot button:has-text("Speichern")');
  await page.waitForTimeout(400);
  check('KRITISCH: bei Verkehrsdienst bleibt dieselbe unberechtigte Person ohne Warnung',
    !(await page.evaluate(() => document.getElementById('dlgRevierWarnung').classList.contains('on')))
    && gesendet.length === 1 && !gesendet[0].unberechtigt);
  check('Die Schublade schliesst sich normal',
    !(await page.evaluate(() => document.getElementById('drawer').classList.contains('on'))));
  await browser.close();
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
