// Testdaten der Testseite (ENT-714) -- die Kachel und der Ablauf in Schritten.
//
// Die Sperre selbst sitzt im Server (pruef_testdaten.php prueft die
// Umgebungsweiche, api/testdaten.php verlangt Staging und rechte_schreiben).
// Hier geht es um das, was die Oberflaeche zusagt:
//  - Die Kachel erscheint NUR auf der Testseite UND nur mit dem Recht.
//  - Ohne das eingetippte Wort laesst sich nichts ausloesen.
//  - Die Schritte laufen in der richtigen Reihenfolge, jeder Monat einzeln.
//  - Bricht ein Schritt ab, steht dort WO und WARUM, es folgt kein weiterer
//    Schritt, und der Knopf ist wieder frei.
//  - Die Kachel traegt gemessen den violetten Testton, nicht die Farbe der
//    echten Einstellungen daneben.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const MONATE = ['2000-01', '2000-02', '2000-03'];   // nur Beschriftung, kein Kalender

async function seite(browser, { rechte, staging = true, fehlerBei = null }) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const schritte = [];
  page.on('pageerror', e => { if (!/rapporte_monat/.test(e.message)) { bad.push('JS-Fehler: ' + e.message); } });
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    const send = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('login.php')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: false, rollen: [], rechte });
    if (url.includes('me.php')) return send({ status: 'ok', name: 'adrian', ist_admin: false, rollen: [], rechte });
    if (url.includes('testdaten.php')) {
      const b = JSON.parse(route.request().postData() || '{}');
      schritte.push(b.schritt === 'monat' ? 'monat:' + b.monat : b.schritt + (b.bestaetigung ? ':' + b.bestaetigung : ''));
      if (fehlerBei && b.monat === fehlerBei) return send({ status: 'error', message: 'Zeitlimit erreicht' }, 500);
      if (b.schritt === 'start') return send({ status: 'ok', monate: MONATE });
      if (b.schritt === 'monat') return send({ status: 'ok', monat: b.monat, ergebnis: {} });
      if (b.schritt === 'abschluss') return send({ status: 'ok', zusammenfassung: {
        mitarbeitende: 30, kunden: 12, objekte: 18, einsaetze: 6400, rechnungen: 210, offerten: 7, lohnlaeufe: 10 } });
    }
    return send({ status: 'ok' });
  });
  await page.goto(URL);
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on');
  await page.evaluate(s => { window.APP_UMGEBUNG_STAGING = s; go('betrieb'); }, staging);
  await page.waitForTimeout(300);
  page.schritte = schritte;
  return page;
}

const browser = await chromium.launch({ executablePath: browserPfad() });
const MIT = ['betrieb_lesen', 'betrieb_schreiben', 'rechte_lesen', 'rechte_schreiben'];

try {
  const p0 = await seite(browser, { rechte: MIT, staging: false });
  check('KRITISCH: ausserhalb der Testseite gibt es die Kachel nicht', !(await p0.isVisible('#bkKachelTd')));
  await p0.close();

  const p1 = await seite(browser, { rechte: ['betrieb_lesen', 'betrieb_schreiben'] });
  check('KRITISCH: ohne das Recht, Rollen zu vergeben, gibt es die Kachel nicht', !(await p1.isVisible('#bkKachelTd')));
  await p1.close();

  const page = await seite(browser, { rechte: MIT });
  check('Auf der Testseite mit dem Recht steht die Kachel', await page.isVisible('#bkKachelTd'));
  check('Die Kachel sagt "nur Testseite"', /nur Testseite/.test(await page.textContent('#bkKachelTd')));
  const farbe = await page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('#bkKachelTd .bk-kachel-ic'));
    const n = getComputedStyle(document.querySelector('.bk-kachel:not(#bkKachelTd) .bk-kachel-ic'));
    return { t: t.color, n: n.color, tb: t.backgroundColor, nb: n.backgroundColor };
  });
  check('Gemessen: das Symbol der Testkachel traegt eine andere Farbe als die echten Einstellungen',
    farbe.t !== farbe.n && farbe.tb !== farbe.nb);

  await page.click('#bkKachelTd');
  await page.waitForTimeout(150);
  check('Die Karte oeffnet sich', await page.isVisible('#bkAb-td'));
  check('Sie sagt, was geloescht wird und was bleibt',
    /Gelöscht wird/.test(await page.textContent('#bkAb-td')) && /Bleibt stehen/.test(await page.textContent('#bkAb-td')));
  check('KRITISCH: ohne Bestaetigungswort ist der Knopf gesperrt', await page.isDisabled('#tdKnopf'));
  await page.fill('#tdWort', 'testdaten');
  check('KRITISCH: das Wort in Kleinbuchstaben genuegt nicht', await page.isDisabled('#tdKnopf'));
  await page.fill('#tdWort', 'TESTDATEN');
  check('Mit dem Wort ist der Knopf frei', !(await page.isDisabled('#tdKnopf')));
  await page.click('#tdKnopf');
  await page.waitForFunction(() => /Fertig/.test(document.getElementById('tdStand').textContent), null, { timeout: 5000 });
  check('KRITISCH: Reihenfolge start -> jeder Monat einzeln -> abschluss',
    page.schritte.join('|') === 'start:TESTDATEN|monat:2000-01|monat:2000-02|monat:2000-03|abschluss');
  const stand = await page.textContent('#tdStand');
  check('Die Zusammenfassung nennt die Zahlen', /210/.test(stand) && /Lohnläufe/.test(stand));
  check('Sie bietet das Neuladen an', /Seite neu laden/.test(stand));
  await page.close();

  const p2 = await seite(browser, { rechte: MIT, fehlerBei: '2000-02' });
  await p2.click('#bkKachelTd');
  await p2.fill('#tdWort', 'TESTDATEN');
  await p2.click('#tdKnopf');
  await p2.waitForFunction(() => /Abgebrochen/.test(document.getElementById('tdStand').textContent), null, { timeout: 5000 });
  const s2 = await p2.textContent('#tdStand');
  check('KRITISCH: ein Abbruch nennt den Schritt und den Grund', /Februar 2000/.test(s2) && /Zeitlimit erreicht/.test(s2));
  check('KRITISCH: nach dem Abbruch folgt kein weiterer Schritt', !p2.schritte.includes('monat:2000-03') && !p2.schritte.includes('abschluss'));
  check('Er sagt, dass ein neuer Klick wieder mit dem Leeren beginnt', /wieder mit dem Leeren/.test(s2));
  check('Der Knopf ist nach dem Abbruch wieder frei', !(await p2.isDisabled('#tdKnopf')));
  await p2.close();
} catch (e) { bad.push('Ablauf: ' + String(e).split('\n')[0].slice(0, 200)); }

await browser.close();
console.log(`test_testdaten: ${ok.length} bestanden, ${bad.length} rot`);
bad.forEach(b => console.log('  ROT: ' + b));
process.exit(bad.length ? 1 : 0);
