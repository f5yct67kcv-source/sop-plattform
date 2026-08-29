// Mobile Navigationsstruktur (ENT-234): Wächter-Reiter (nur mit
// Revierdienst-Bezug), Menü-Reiter mit Kacheln (löst den früheren
// Profil-Reiter ab), Plan+Sperren als Unterreiter, Hinweis-Chip bei
// aktivem Rundgang auf "Heute". Prüft die Weiche selbst -- die Checkliste,
// das Scannen, Pausieren/Abbrechen usw. bleiben unveraendert und sind
// bereits an anderer Stelle abgedeckt.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
// Gestern, nicht heute: darfRundgang() prueft nur den Start, nicht das Ende --
// ein Datum von gestern ist unabhaengig von der Tageszeit beim Testlauf
// zuverlaessig "bereits begonnen", ohne ein festes Datum zu brauchen.
const GESTERN = iso(new Date(Date.now() - 864e5));
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const schicht = (overrides = {}) => ({
  id: 41, kunde_name: 'Borner AG', titel: 'Schliessrunde', strasse: 'Industriestrasse 1',
  ort: '4601 Olten', einsatzart: 'Revierdienst', datum: GESTERN, von: '22:00:00', bis: '22:30:00',
  status: 'geplant', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Gerolag Center',
  im_team: 1, hat_kontrollpunkte: true, ...overrides,
});

async function neueSeite(schichten, extraRoutes) {
  const rufe = [];
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', route => {
    const req = route.request(), u = req.url(), p = u.split('/api/')[1].split('?')[0];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
    rufe.push({ p, body, url: u });
    const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: false });
    if (p.includes('meine_schichten')) return send({ status: 'ok', schichten });
    if (p.includes('mein_profil')) return send({ status: 'ok', profil: { name: 'a', vorname: 'A', nachname: 'B' } });
    if (p.includes('meine_verfuegbarkeit')) return send({ status: 'ok', tage: [] });
    if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
    if (extraRoutes) {
      const r = extraRoutes(p, body, send);
      if (r) return r;
    }
    return send({ status: 'ok' });
  });
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#app.on'); await page.waitForTimeout(500);
  return { browser, page, rufe };
}

// ══════ TEIL 1: Wächter-Reiter erscheint mit Kontrollpunkten, mit zwei Kacheln
{
  const { browser, page } = await neueSeite([schicht()]);
  check('Wächter-Reiter ist sichtbar', await page.isVisible('#t-waechter'));
  check('Fünf sichtbare Reiter mit Revierdienst-Bezug',
    await page.evaluate(() => [...document.querySelectorAll('.tabs button')]
      .filter(b => getComputedStyle(b).display !== 'none').length === 5));
  await page.click('#t-waechter'); await page.waitForTimeout(250);
  check('Genau zwei Kacheln im Wächter-Bereich', await page.isVisible('#mk-rundgang') && await page.isVisible('#mk-schluessel'));
  await page.click('#mk-schluessel'); await page.waitForTimeout(200);
  check('Schlüsselverwaltung meldet sich ehrlich als noch nicht gebaut statt stumm nichts zu tun',
    (await page.textContent('#toast')).includes('späteren Schritt') && await page.evaluate(() => document.getElementById('toast').classList.contains('on')));
  await page.screenshot({ path: OUT + '/nav-01-waechter.png' });
  await browser.close();
}

// ══════ TEIL 2: Rundgang-Kachel öffnet die richtige Schicht direkt
{
  const { browser, page } = await neueSeite([schicht({ id: 55 })]);
  await page.click('#t-waechter'); await page.waitForTimeout(250);
  await page.click('#mk-rundgang'); await page.waitForTimeout(350);
  check('Ein startbarer Rundgang öffnet direkt das Schicht-Blatt',
    await page.evaluate(() => document.getElementById('blatt').classList.contains('on')));
  check('Der Start-Knopf für genau diese Schicht steht bereit',
    await page.evaluate(() => !!document.querySelector('#blRundgang button[onclick="rundgangStarten(55)"]')));
  await browser.close();
}

// ══════ TEIL 3: kein startbarer Rundgang -> ehrliche Meldung statt stiller Leere
// (hat_kontrollpunkte true, Reiter also sichtbar -- aber ohne Zusage lehnt
// darfRundgang() ab, siehe app.html)
{
  const { browser, page } = await neueSeite([schicht({ zusage: 'offen' })]);
  check('Wächter-Reiter bleibt trotz fehlender Zusage sichtbar (Kontrollpunkte allein entscheiden)',
    await page.isVisible('#t-waechter'));
  await page.click('#t-waechter'); await page.waitForTimeout(250);
  await page.click('#mk-rundgang'); await page.waitForTimeout(300);
  check('Kein Blatt öffnet sich ohne startbaren Rundgang',
    !(await page.evaluate(() => document.getElementById('blatt').classList.contains('on'))));
  check('Stattdessen ein Hinweis, kein stilles Nichts',
    await page.evaluate(() => document.getElementById('toast').classList.contains('on')));
  await browser.close();
}

// ══════ TEIL 4: ohne Kontrollpunkte bleibt der Reiter weg
{
  const { browser, page } = await neueSeite([schicht({ hat_kontrollpunkte: false })]);
  check('Wächter-Reiter bleibt ohne Kontrollpunkte verborgen', !(await page.isVisible('#t-waechter')));
  check('Vier sichtbare Reiter ohne Revierdienst-Bezug',
    await page.evaluate(() => [...document.querySelectorAll('.tabs button')]
      .filter(b => getComputedStyle(b).display !== 'none').length === 4));
  await browser.close();
}

// ══════ TEIL 5: Plan/Sperren-Unterreiter -- kein neuer Serveraufruf beim Wechsel
{
  const { browser, page, rufe } = await neueSeite([schicht({ hat_kontrollpunkte: false })]);
  await page.click('#t-plan'); await page.waitForTimeout(250);
  check('Der Plan-Inhalt ist zu Beginn sichtbar', await page.isVisible('#plan-inhalt-plan'));
  check('Der Sperren-Inhalt ist zu Beginn verborgen', !(await page.isVisible('#plan-inhalt-sperren')));
  const vorher = rufe.length;
  await page.click('#pu-sperren'); await page.waitForTimeout(150);
  check('Sperren-Inhalt wird nach dem Umschalten sichtbar', await page.isVisible('#plan-inhalt-sperren'));
  check('Plan-Inhalt wird dabei verborgen', !(await page.isVisible('#plan-inhalt-plan')));
  check('Der Unterreiter-Wechsel läuft ohne neuen Serveraufruf (Daten liegen schon vor)', rufe.length === vorher);
  await page.click('#pu-plan'); await page.waitForTimeout(150);
  check('Zurück zu Plan zeigt den Plan-Inhalt wieder', await page.isVisible('#plan-inhalt-plan'));
  await browser.close();
}

// ══════ TEIL 6: aktiver Rundgang zeigt einen Chip auf "Heute" und führt zurück
{
  const { browser, page } = await neueSeite([schicht({ id: 77 })], (p, body, send) => {
    if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: null });
    if (p.includes('mein_rundgang_vorlagen')) return send({ status: 'ok', vorlagen: [] });
    if (p.includes('mein_rundgang_starten')) return send({ status: 'ok', rundgang_id: 9, kontrollpunkte: [
      { id: 1, bezeichnung: 'Haupteingang', typ: 'nfc' }, { id: 2, bezeichnung: 'Tiefgarage', typ: 'nfc' }] });
  });
  await page.evaluate(() => blattAuf(77));
  await page.waitForTimeout(350);
  await page.click('#blRundgang button');
  await page.waitForTimeout(350);
  check('Die Checkliste öffnet sich nach dem Start', await page.isVisible('#rdListe'));
  await page.evaluate(() => blattZu());
  await page.waitForTimeout(250);
  await page.click('#t-heute'); await page.waitForTimeout(250);
  check('Auf Heute erscheint der Rundgang-Chip', await page.isVisible('.rd-chip'));
  const chipTxt = await page.textContent('.rd-chip');
  check('Der Chip nennt den Fortschritt (0 von 2)', /0/.test(chipTxt) && /2/.test(chipTxt));
  await page.click('.rd-chip');
  await page.waitForTimeout(300);
  check('Der Chip führt zurück in dieselbe Checkliste', await page.isVisible('#rdListe'));
  await page.screenshot({ path: OUT + '/nav-02-chip.png' });
  await browser.close();
}

// ══════ GEGENPROBE zu Teil 6: ohne aktiven Rundgang bleibt der Chip weg
// (CLAUDE.md: eine Prüfung, die nie angeschlagen hat, ist eine Behauptung --
// dieser Fall stellt sicher, dass rundgangChipHtml() tatsaechlich bedingt ist.)
{
  const { browser, page } = await neueSeite([schicht({ hat_kontrollpunkte: false })]);
  await page.click('#t-heute'); await page.waitForTimeout(200);
  check('KRITISCH: ohne aktiven Rundgang zeigt Heute keinen Chip', !(await page.isVisible('.rd-chip')));
  await browser.close();
}

// ══════ MOBIL/DESKTOP: neue Kacheln und Reiter halten die 44px-Regel ein
for (const [breite, bez] of [[360, 'Handy'], [1024, 'Desktop']]) {
  const { browser, page } = await neueSeite([schicht()]);
  await page.setViewportSize({ width: breite, height: 844 });
  await page.waitForTimeout(150);
  await page.click('#t-waechter'); await page.waitForTimeout(200);
  const kacheln = await page.evaluate(() => [...document.querySelectorAll('#v-waechter .mk-kachel')]
    .map(b => b.getBoundingClientRect().height));
  check(`Wächter-Kacheln mindestens 44px hoch @${bez}`, kacheln.every(h => h >= 44));
  await page.click('#t-menu'); await page.waitForTimeout(200);
  const menuKacheln = await page.evaluate(() => [...document.querySelectorAll('#v-menu .mk-kachel')]
    .map(b => b.getBoundingClientRect().height));
  check(`Menü-Kacheln mindestens 44px hoch @${bez}`, menuKacheln.every(h => h >= 44));
  const tabHoehen = await page.evaluate(() => [...document.querySelectorAll('.tabs button')]
    .filter(b => getComputedStyle(b).display !== 'none').map(b => b.getBoundingClientRect().height));
  check(`Alle sichtbaren Reiter mindestens 44px hoch @${bez}`, tabHoehen.every(h => h >= 44));
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`Kein Seiten-Scroll im Wächter/Menü-Bereich @${bez}`, scroll <= 1);
  await browser.close();
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
