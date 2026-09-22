// Welchen Server die App anspricht (ENT-663, behebt OP-662).
//
// ANLASS: Die Serveradresse der nativen App stand FEST im Quelltext --
// `https://cupi24.guardops.ch/api/`, nirgends ersetzt. Die App im Store
// sprach ausschliesslich mit einem einzigen Mandanten. Das widerspricht
// ENT-661, wo der Projektinhaber festgelegt hat, dass die App allen
// Mandanten offensteht.
//
// WARUM ES DAS FELD BRAUCHT (die Frage war: "bei Coredinate klappt es
// von Beginn ueber die normale Anmeldemaske"): Unsere Betriebstabellen
// haben keine Mandantenspalte. `mitarbeiter` traegt id, name,
// password_hash -- kein mandant_id. Jeder Mandant hat eine eigene
// Datenbank. Ein Server kennt darum nur seine eigenen Leute und kann
// gar nicht sagen, ob ein Name zu einem anderen Betrieb gehoert; ein
// Name ist firmenuebergreifend auch nicht eindeutig. Die App muss die
// Adresse also VOR der ersten Anfrage kennen.
//
// Die schaerfste Pruefung hier ist nicht die Bequemlichkeit, sondern
// Abschnitt "FREMDE ADRESSE": Der eingegebene Wert wandert in eine URL.
// Ohne strenge Pruefung schickte die App Name und Passwort an einen
// beliebigen Server, den jemand ins Feld schreibt.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });

/* Eine Seite in der HUELLE. Capacitor wird VOR dem Laden gesetzt --
   nativeAppHuelle() wird schon beim Auswerten des Skripts gebraucht
   (mandantUebernehmen laeuft dort). Wer es danach setzt, prueft eine
   Seite, die sich laengst fuer den Browser entschieden hat. */
async function huelle({ mandant = null, token = null, nativ = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const ziele = [];
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.addInitScript(([n, m, t]) => {
    if (n) {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    }
    try {
      localStorage.clear();
      if (m) { localStorage.setItem('sop_mandant', m); }
      if (t) { localStorage.setItem('rv3_token', t); }
    } catch (e) {}
  }, [nativ, mandant, token]);
  // Jede Anfrage an einen Mandantenserver wird mitgeschrieben statt
  // beantwortet -- so steht fest, WOHIN die App spricht.
  await page.route('**/api/**', route => {
    ziele.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false }) });
  });
  await page.goto(`file://${WURZEL}/app.html`);
  await page.waitForTimeout(400);
  return { page, ziele };
}

const sichtbar = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s);
  return !!e && e.style.display !== 'none' && e.offsetParent !== null;
}, sel);

// ══════════ IM BROWSER GIBT ES NICHTS ZU WAEHLEN ══════════════════════
{
  const { page } = await huelle({ nativ: false });
  check('KRITISCH: im Browser erscheint kein Betriebsfeld -- dort entscheidet die Adresszeile',
    (await sichtbar(page, '#gMandantFeld')) === false);
  check('Und auch keine Zeile zum Wechseln',
    (await sichtbar(page, '#gMandantWechsel')) === false);
  check('Der API-Pfad bleibt im Browser relativ',
    (await page.evaluate(() => apiBasis())) === 'api/');
  await page.close();
}

// ══════════ FRISCHE INSTALLATION FRAGT ════════════════════════════════
{
  const { page, ziele } = await huelle({});
  check('KRITISCH: eine frische Installation in der Huelle fragt nach dem Betrieb',
    (await sichtbar(page, '#gMandantFeld')) === true);
  check('Ohne Betrieb gibt es keine Adresse -- und damit keine Anfrage ins Leere',
    (await page.evaluate(() => apiBasis())) === '');
  // Anmelden ohne Betrieb darf gar nicht erst senden.
  await page.fill('#gName', 'm.muster');
  await page.fill('#gPass', 'geheim');
  await page.click('#gBtn');
  await page.waitForTimeout(300);
  check('KRITISCH: ohne Betrieb wird NICHTS gesendet -- kein Name, kein Passwort',
    ziele.length === 0);
  check('Und die Maske sagt, was fehlt',
    (await page.textContent('#gErr')).includes('Betrieb'));
  await page.close();
}

// ══════════ FREMDE ADRESSE: DER GEFAEHRLICHE FALL ═════════════════════
/* Der eingegebene Wert wird Teil einer URL. Wer hier "boese.example/x"
   oder "cupi24.guardops.ch.boese.example" unterbringt, bekaeme Name und
   Passwort geschickt. Geprueft wird darum BEIDES: dass solche Eingaben
   abgewiesen werden, UND dass in dem Fall wirklich nichts hinausgeht. */
{
  const { page, ziele } = await huelle({});
  const boese = ['boese.example/x', 'cupi24.guardops.ch.boese.example',
                 'a.b', 'cupi24/../evil', 'CUPI24 ', '-start', '',
                 'cupi24?x=1', 'cupi24#x', 'cupi24:8080', '../../etc'];
  const abgewiesen = await page.evaluate(l => l.filter(m => !mandantGueltig(m)).length, boese);
  check('KRITISCH: jede dieser elf gefaehrlichen Eingaben wird als Betrieb abgewiesen',
    abgewiesen === boese.length);
  check('Und ein gewoehnlicher Kurzname wird angenommen',
    await page.evaluate(() => mandantGueltig('cupi24') && mandantGueltig('muster-ag')
      && mandantGueltig('a')));
  // Und zwar nicht nur in der Pruefung, sondern im ganzen Weg:
  await page.fill('#gMandant', 'boese.example/x');
  await page.fill('#gName', 'm.muster');
  await page.fill('#gPass', 'geheim');
  await page.click('#gBtn');
  await page.waitForTimeout(300);
  check('KRITISCH: mit einer fremden Adresse im Feld geht keine einzige Anfrage hinaus',
    ziele.length === 0);
  check('KRITISCH: und sie wird auch nicht gemerkt',
    (await page.evaluate(() => mandantGemerkt())) === '');
  await page.close();
}

// ══════════ DIE ADRESSE ENTSTEHT WIRKLICH AUS DEM BETRIEB ═════════════
{
  const { page, ziele } = await huelle({});
  await page.fill('#gMandant', 'musterag');
  await page.fill('#gName', 'm.muster');
  await page.fill('#gPass', 'geheim');
  await page.click('#gBtn');
  await page.waitForTimeout(500);
  check('KRITISCH: die Anmeldung geht an den Server des eingegebenen Betriebs',
    ziele.length > 0 && ziele[0].startsWith('https://musterag.guardops.ch/api/login.php'));
  check('KRITISCH: und nicht an den frueher fest verdrahteten',
    ziele.every(u => !u.includes('cupi24')));
  check('Der Betrieb ist danach gemerkt',
    (await page.evaluate(() => mandantGemerkt())) === 'musterag');
  await page.close();
}

// ══════════ BESTEHENDE INSTALLATION MERKT NICHTS ══════════════════════
/* Entscheidung des Projektinhabers: "Gemerkte Adresse bleibt, nichts
   aendert sich." Kennzeichen einer bestehenden Installation ist ein
   bereits liegendes Anmeldetoken -- eine frische hat keins. */
{
  const { page } = await huelle({ token: 'alt' });
  check('KRITISCH: eine bestehende Installation uebernimmt die bisherige Adresse still',
    (await page.evaluate(() => mandantGemerkt())) === 'cupi24');
  check('KRITISCH: und sieht darum kein Betriebsfeld',
    (await sichtbar(page, '#gMandantFeld')) === false);
  check('Die Adresse ist dieselbe wie vor der Aenderung',
    (await page.evaluate(() => apiBasis())) === 'https://cupi24.guardops.ch/api/');
  await page.close();
}

// ══════════ WER SCHON GEWAEHLT HAT, SIEHT ES UND KANN WECHSELN ════════
{
  const { page } = await huelle({ mandant: 'musterag' });
  check('Mit gemerktem Betrieb ist das Feld weg',
    (await sichtbar(page, '#gMandantFeld')) === false);
  check('KRITISCH: dafuer steht da, welcher Betrieb gilt -- sonst waere ein Vertipper nur mit Neuinstallation zu beheben',
    (await sichtbar(page, '#gMandantWechsel')) === true
    && (await page.textContent('#gMandantWechsel')).includes('musterag'));
  await page.click('#gMandantWechsel');
  await page.waitForTimeout(200);
  check('KRITISCH: ein Tipp darauf oeffnet das Feld wieder',
    (await sichtbar(page, '#gMandantFeld')) === true);
  check('Und es ist mit dem bisherigen Wert vorbelegt',
    (await page.inputValue('#gMandant')) === 'musterag');
  await page.close();
}

// ══════════ KEINE ANTWORT IST NICHT DASSELBE WIE FALSCHES PASSWORT ════
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    try { localStorage.clear(); localStorage.setItem('sop_mandant', 'gibtsnicht'); } catch (e) {}
  });
  // Der Server antwortet gar nicht -- genau der Fall eines falsch
  // geschriebenen oder abgeschalteten Betriebs.
  await page.route('**/api/**', route => route.abort());
  await page.goto(`file://${WURZEL}/app.html`);
  await page.waitForTimeout(400);
  await page.fill('#gName', 'm.muster');
  await page.fill('#gPass', 'geheim');
  await page.click('#gBtn');
  await page.waitForTimeout(600);
  const meldung = (await page.textContent('#gErr')) || '';
  check('KRITISCH: bleibt die Antwort aus, nennt die Meldung den Betrieb',
    meldung.includes('gibtsnicht'));
  check('KRITISCH: und sie behauptet NICHT zu wissen, woran es liegt -- beide Moeglichkeiten stehen da',
    /nicht erreichbar/.test(meldung) && /antwortet/.test(meldung));
  check('KRITISCH: sie sagt insbesondere nicht "Name oder Passwort falsch"',
    !/Passwort falsch/.test(meldung));
  check('KRITISCH: und das Feld geht wieder auf, damit ein Vertipper zu beheben ist',
    (await sichtbar(page, '#gMandantFeld')) === true);
  await page.close();
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { console.log(bad.map(n => '  ✗ ' + n).join('\n')); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
