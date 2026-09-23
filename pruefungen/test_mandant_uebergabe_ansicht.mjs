// Uebergabe eines Mandantenkontos in der Oberflaeche (ENT-686), GEMESSEN am
// gerenderten Zustand und im Browser DURCHGESPIELT.
//
// Zwei Flaechen: der Knopf "Zugang" mit seinem Dialog im Betreiber-Bereich,
// und die Einloeseseite, auf der der KUNDE landet. Die zweite ist die
// heiklere: Sie steht im selben Tor wie die Betreiber-Anmeldung, und genau
// darum darf auf ihr nichts nach Betreiber aussehen -- kein "du", kein
// "jeden Mandanten", kein Browser-Tab "Betreiber", und danach kein Weg zur
// Betreiber-Anmeldung, sondern in die eigene Anlage des Kunden.
//
// Die Serverantworten werden abgefangen: Die Seite laeuft unter einer
// erfundenen Adresse, damit ihre fetch()-Aufrufe ueberhaupt abfangbar sind
// (unter file:// blockt Chromium sie). Es laeuft der Code der Seite selbst,
// kein Nachbau.
//
// Gemessen auf BEIDEN Breiten (CLAUDE.md): Handy 390 px, Desktop 1280 px.
import { chromium } from 'playwright';
import { WURZEL, browserPfad } from './pfade.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const SEITE = readFileSync(join(WURZEL, 'betreiber.html'), 'utf8');
const BASIS = 'http://pruef.invalid/';
// Erfundene Werte (CLAUDE.md, Vertraulichkeit).
const TOKEN = 'a'.repeat(64);

async function aufbauen(page, antworten, protokoll) {
  await page.route(BASIS + '**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/betreiber.html') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SEITE });
    }
    const name = url.pathname.replace(/^\/api\//, '');
    protokoll.push({ name, body: route.request().postData() || '' });
    const a = antworten[name] || { status: 'error', message: 'in dieser Pruefung nicht vorgesehen' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(a) });
  });
  // Die Anlage des Kunden: Wer dorthin geht, wird hier festgehalten statt
  // wirklich zu navigieren.
  await page.route('https://beispielwache.guardops.ch/**', route => {
    protokoll.push({ name: 'NAVIGATION', body: route.request().url() });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Anlage</p>' });
  });
}

// Auf ein Ereignis warten statt eine feste Zeit: Am Handy dauert derselbe
// Weg laenger, und eine feste Wartezeit machte die Pruefung dort wackelig
// (erste Fassung: 200 ms, am Handy zu kurz). Hoechstens fuenf Sekunden.
async function bis(bedingung) {
  for (let i = 0; i < 50 && !bedingung(); i++) { await new Promise(r => setTimeout(r, 100)); }
}

const browser = await chromium.launch({ executablePath: browserPfad() });

for (const [breite, hoehe, art] of [[390, 844, 'Handy'], [1280, 900, 'Desktop']]) {
  // ── 1. Die Einloeseseite des Kunden ────────────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
    const protokoll = [];
    await aufbauen(page, {
      'mandant_einladung_pruefen.php': { status: 'ok', betrieb: 'Beispielwache AG',
        person: 'Alex Beispiel', email: 'alex@example.org', mindestlaenge: 12 },
      'mandant_einladung_einloesen.php': { status: 'ok', name: 'Alex Beispiel',
        betrieb: 'Beispielwache AG', adresse: 'https://beispielwache.guardops.ch' },
    }, protokoll);
    await page.goto(BASIS + 'betreiber.html?uebergabe=' + TOKEN);
    await page.waitForFunction(() => !document.getElementById('ein-form').classList.contains('versteckt'));

    const vorher = await page.evaluate(() => ({
      titel: document.title,
      sub: document.getElementById('ein-sub').textContent,
      hinweis: document.getElementById('ein-hinweis').textContent,
      url: location.href,
      torSichtbar: !document.getElementById('tor').classList.contains('versteckt'),
      text: document.getElementById('ein-tor').innerText,
    }));
    check(`${art}: KRITISCH: der Browser-Tab heisst nicht "Betreiber"`,
      !/Betreiber/.test(vorher.titel) && /Zugang einrichten/.test(vorher.titel));
    check(`${art}: die Karte nennt Betrieb und Adresse, fuer die der Zugang gilt`,
      vorher.sub.includes('Beispielwache AG') && vorher.sub.includes('alex@example.org'));
    check(`${art}: KRITISCH: kein "du" und kein "jeden Mandanten" auf der Karte des Kunden`,
      !/\b(du|dein|deine)\b/i.test(vorher.text) && !/jeden Mandanten/.test(vorher.text)
      && /Betrieb/.test(vorher.hinweis));
    check(`${art}: die Mindestlaenge kommt vom Server`, /12 Zeichen/.test(vorher.hinweis));
    check(`${art}: KRITISCH: der Token steht nicht mehr in der Adresszeile`,
      !vorher.url.includes(TOKEN));
    check(`${art}: die Betreiber-Anmeldung ist ausgeblendet`, !vorher.torSichtbar);
    check(`${art}: KRITISCH: gefragt wird der Uebergabe-Endpunkt, nicht der Betreiber-Einladung`,
      protokoll.some(p => p.name === 'mandant_einladung_pruefen.php')
      && !protokoll.some(p => p.name.startsWith('betreiber_einladung')));

    // Gemessen: Eingabefelder und Knopf am Handy (Hausregel 16 px / 44 px).
    const mass = await page.evaluate(() => {
      const f = document.getElementById('ein-pass');
      const k = document.getElementById('knopf-einloesen');
      return { schrift: parseFloat(getComputedStyle(f).fontSize),
               knopfH: k.getBoundingClientRect().height,
               feldH: f.getBoundingClientRect().height,
               ueberlauf: document.documentElement.scrollWidth - innerWidth };
    });
    if (art === 'Handy') {
      check('Handy: Passwortfeld mit mindestens 16 px Schrift', mass.schrift >= 16);
      check('Handy: Knopf mindestens 44 px hoch', mass.knopfH >= 44);
      check('Handy: Passwortfeld mindestens 44 px hoch', mass.feldH >= 44);
    }
    check(`${art}: kein waagrechter Ueberlauf`, mass.ueberlauf <= 0);

    // Durchspielen: Tippfehler, dann richtig.
    await page.fill('#ein-pass', 'einlanges-passwort-1');
    await page.fill('#ein-pass2', 'einlanges-passwort-2');
    await page.click('#knopf-einloesen');
    const tippfehler = await page.evaluate(() => document.getElementById('ein-meldung').textContent);
    check(`${art}: ein Tippfehler in der Wiederholung wird gemeldet, ohne den Server zu fragen`,
      /stimmen nicht/.test(tippfehler)
      && !protokoll.some(p => p.name === 'mandant_einladung_einloesen.php'));
    await page.fill('#ein-pass2', 'einlanges-passwort-1');
    await page.click('#knopf-einloesen');
    await page.waitForFunction(() => !document.getElementById('ein-fertig').classList.contains('versteckt'));

    const nachher = await page.evaluate(() => ({
      adresse: document.getElementById('ein-adresse').textContent,
      adresseSichtbar: !document.getElementById('ein-adresse').classList.contains('versteckt'),
      knopf: document.getElementById('knopf-ein-weiter').textContent,
      meldung: document.getElementById('ein-meldung').textContent,
    }));
    const eingeloest = protokoll.find(p => p.name === 'mandant_einladung_einloesen.php');
    check(`${art}: KRITISCH: eingeloest wird ueber den Uebergabe-Endpunkt, mit Token und Passwort`,
      !!eingeloest && eingeloest.body.includes(TOKEN) && eingeloest.body.includes('einlanges-passwort-1'));
    check(`${art}: danach steht die Adresse des Betriebs ausgeschrieben da`,
      nachher.adresseSichtbar && nachher.adresse === 'beispielwache.guardops.ch');
    check(`${art}: der Knopf sagt "Zur Anmeldung"`, nachher.knopf === 'Zur Anmeldung');
    await page.click('#knopf-ein-weiter');
    await bis(() => protokoll.some(p => p.name === 'NAVIGATION'));
    // DIE WICHTIGSTE AUSSAGE DIESER SUITE: Der Kunde geht in seine Anlage,
    // nicht zur Betreiber-Anmeldung, auf der diese Karte steht.
    check(`${art}: KRITISCH: der Knopf fuehrt in die Anlage des Kunden, nicht zur Betreiber-Anmeldung`,
      protokoll.some(p => p.name === 'NAVIGATION' && p.body.startsWith('https://beispielwache.guardops.ch')));
    await page.close();
  }

  // ── 2. Ohne Subdomain: kein Knopf ins Leere ────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
    const protokoll = [];
    await aufbauen(page, {
      'mandant_einladung_pruefen.php': { status: 'ok', betrieb: 'Beispielwache AG',
        email: 'alex@example.org', mindestlaenge: 12 },
      'mandant_einladung_einloesen.php': { status: 'ok', betrieb: 'Beispielwache AG', adresse: null },
    }, protokoll);
    await page.goto(BASIS + 'betreiber.html?uebergabe=' + TOKEN);
    await page.waitForFunction(() => !document.getElementById('ein-form').classList.contains('versteckt'));
    await page.fill('#ein-pass', 'einlanges-passwort-1');
    await page.fill('#ein-pass2', 'einlanges-passwort-1');
    await page.click('#knopf-einloesen');
    await page.waitForFunction(() => /gesetzt/.test(document.getElementById('ein-meldung').textContent));
    const z = await page.evaluate(() => ({
      fertig: !document.getElementById('ein-fertig').classList.contains('versteckt'),
      meldung: document.getElementById('ein-meldung').textContent,
    }));
    // "Unbekannt darf nie wie keine aussehen": Die Adresse steht noch nicht
    // fest -- das sagt die Seite, statt einen Knopf zu zeigen, der ins Leere
    // oder zur falschen Anmeldung fuehrt.
    check(`${art}: KRITISCH: ohne Adresse gibt es keinen Knopf, sondern den Hinweis, woher sie kommt`,
      !z.fertig && /erhalten Sie von/.test(z.meldung));
    await page.close();
  }

  // ── 3. Ein toter Link ──────────────────────────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
    await aufbauen(page, {
      'mandant_einladung_pruefen.php': { status: 'error', message: 'Dieser Link gilt nicht mehr.' },
    }, []);
    await page.goto(BASIS + 'betreiber.html?uebergabe=' + TOKEN);
    await page.waitForFunction(() => /nicht mehr/.test(document.getElementById('ein-meldung').textContent));
    const formZu = await page.evaluate(() =>
      document.getElementById('ein-form').classList.contains('versteckt'));
    check(`${art}: ein toter Link zeigt kein Passwortformular`, formZu);
    await page.close();
  }

  // ── 4. Der Knopf "Zugang" und sein Dialog ──────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
    const protokoll = [];
    await aufbauen(page, {
      'betreiber_mandant_list.php': { status: 'ok', mandanten: [
        { id: 1, name: 'Beispielwache AG', subdomain: 'beispielwache', status: 'aktiv', ist_demo: false },
        { id: 2, name: 'Vorrat A', subdomain: '', status: 'vorrat', ist_demo: false },
        { id: 3, name: 'Musterdienst GmbH', subdomain: 'muster', status: 'gesperrt', ist_demo: false },
      ] },
      'betreiber_mandant_einladen.php': { status: 'ok', gueltig_tage: 7 },
    }, protokoll);
    await page.goto(BASIS + 'betreiber.html');
    await page.evaluate(async () => {
      document.getElementById('tor').classList.add('versteckt');
      document.getElementById('haus').classList.remove('versteckt');
      document.getElementById('b-mandanten').classList.remove('versteckt');
      await ladeMandanten();
    });
    await page.waitForSelector('#m-inhalt table');
    const knoepfe = await page.evaluate(() =>
      [...document.querySelectorAll('[data-zugang]')].map(b => b.dataset.zugang));
    check(`${art}: KRITISCH: "Zugang" steht nur beim aktiven Mandanten, nicht bei Vorrat oder gesperrt`,
      knoepfe.length === 1 && knoepfe[0] === '1');
    const zeilenKnoepfe = await page.evaluate(() => {
      const zelle = document.querySelector('[data-zugang]').closest('td');
      return [...zelle.querySelectorAll('button')].map(b => b.textContent.trim());
    });
    check(`${art}: er steht als vierter neben Ändern · GAV · Support`,
      zeilenKnoepfe.slice(0, 4).join('|') === 'Ändern|GAV|Support|Zugang');

    await page.click('[data-zugang="1"]');
    await page.waitForFunction(() => document.getElementById('dlgZugang').classList.contains('on')
      || getComputedStyle(document.getElementById('dlgZugang')).display !== 'none');
    // FERTIG GEOEFFNET heisst: der Fokus steht auf "Vorname". Die Seite setzt
    // ihn 30 ms nach dem Oeffnen (wie beim Konto-Dialog). Wer vorher tippt,
    // dem springt der Fokus mitten in der Eingabe weg -- die erste Fassung
    // dieser Pruefung tat genau das und war darum wackelig: Die E-Mail landete
    // im Vornamenfeld und wurde dort ueberschrieben (Befund 2026-09-23,
    // Wertaenderungen des Felds protokolliert). Fuer einen Menschen ist das
    // kein Fehler; niemand tippt 30 ms nach dem Oeffnen.
    await page.waitForFunction(() => document.activeElement
      && document.activeElement.id === 'z_vorname');
    const dlg = await page.evaluate(() => {
      const d = document.getElementById('dlgZugang');
      const r = d.querySelector('.of-dlg').getBoundingClientRect();
      return { unter: document.getElementById('zDlgUnter').textContent,
               text: d.innerText, links: r.left, rechts: innerWidth - r.right,
               schrift: parseFloat(getComputedStyle(document.getElementById('z_email')).fontSize) };
    });
    check(`${art}: der Dialog nennt den Betrieb`, dlg.unter.includes('Beispielwache AG'));
    check(`${art}: KRITISCH: der Dialog hat kein Passwortfeld`,
      !(await page.$('#dlgZugang input[type="password"]')));
    check(`${art}: KRITISCH: der Dialog schreibt keine Frist selbst aus`,
      !/\d+\s*(Tage|Stunden)/.test(dlg.text));
    check(`${art}: der Dialog passt in die Breite`, dlg.links >= 0 && dlg.rechts >= 0);
    if (art === 'Handy') { check('Handy: E-Mail-Feld im Dialog mit mindestens 16 px Schrift', dlg.schrift >= 16); }

    // Ohne Nachname: kein Aufruf.
    await page.fill('#z_email', 'alex@example.org');
    await page.click('#zSaveBtn');
    check(`${art}: ohne Nachname geht nichts hinaus`,
      !protokoll.some(p => p.name === 'betreiber_mandant_einladen.php'));
    await page.fill('#z_vorname', 'Alex');
    await page.fill('#z_nachname', 'Beispiel');
    await page.click('#zSaveBtn');
    await bis(() => protokoll.some(p => p.name === 'betreiber_mandant_einladen.php'));
    await page.waitForFunction(() => /Tage gültig/.test(document.body.innerText), null, { timeout: 5000 })
      .catch(() => {});
    const gesendet = protokoll.find(p => p.name === 'betreiber_mandant_einladen.php');
    const koerper = gesendet ? JSON.parse(gesendet.body) : {};
    check(`${art}: KRITISCH: eingeladen wird fuer DIESEN Mandanten, mit benannter Person`,
      koerper.mandant_id === 1 && koerper.nachname === 'Beispiel'
      && koerper.email === 'alex@example.org' && !('passwort' in koerper));
    const bestaetigung = await page.evaluate(() => document.body.innerText);
    check(`${art}: die Bestaetigung nennt die Frist VOM SERVER`,
      /7 Tage gültig/.test(bestaetigung));
    await page.close();
  }
}

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
