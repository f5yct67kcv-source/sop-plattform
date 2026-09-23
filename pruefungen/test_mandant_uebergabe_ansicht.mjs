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

// Eine Zeile aufklappen, ueber ihren Namen angesprochen (nicht ueber die
// Position: Seit 2026-09-23 hat jede Zeile eine Leibzeile darunter).
async function aufklappen(page, name) {
  await page.evaluate(n => {
    const kopf = [...document.querySelectorAll('tr.auf-kopf')]
      .find(tr => tr.querySelector('strong') && tr.querySelector('strong').textContent === n);
    kopf.querySelector('.auf-knopf').click();
  }, name);
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
  //
  // NUR AM DESKTOP: Der Betreiber-Bereich bekommt keine mobile Fassung
  // (ENT-697). Die Abschnitte 1 bis 3 darueber betreffen die Einloeseseite
  // des KUNDEN -- die oeffnet er am Handy, und sie ist von ENT-697
  // ausdruecklich ausgenommen. Darum laufen sie weiter auf beiden Breiten.
  if (art !== 'Desktop') { continue; }
  {
    const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
    const protokoll = [];
    await aufbauen(page, {
      'betreiber_mandant_list.php': { status: 'ok', mandanten: [
        { id: 1, name: 'Beispielwache AG', subdomain: 'beispielwache', status: 'aktiv', ist_demo: false,
          uebergabe: { lage: 'keine', datum: null } },
        { id: 2, name: 'Vorrat A', subdomain: '', status: 'vorrat', ist_demo: false,
          uebergabe: { lage: 'keine', datum: null } },
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

    // ── Aufklappen (Festlegung vom 2026-09-23) ──
    // DER ZWECK DES UMBAUS, gemessen: Zugeklappt steht in der Tabelle kein
    // einziger Handlungsknopf -- nur der Pfeil.
    const zu = await page.evaluate(() => [...document.querySelectorAll('#m-inhalt button')]
      .filter(b => b.offsetParent !== null && !b.classList.contains('auf-knopf')).length);
    check(`${art}: KRITISCH: zugeklappt steht kein Handlungsknopf in der Tabelle`, zu === 0);
    // Ein Klick irgendwo in die Zeile klappt auf -- nicht nur auf den Pfeil.
    await page.click('#m-inhalt tr.auf-kopf >> nth=0 >> td >> nth=3');
    const nachZeilenklick = await page.evaluate(() => {
      const k = document.querySelector('#m-inhalt tr.auf-kopf .auf-knopf');
      return { auf: k.getAttribute('aria-expanded'),
               leibSichtbar: !document.getElementById(k.getAttribute('aria-controls')).classList.contains('versteckt'),
               titel: [...document.getElementById(k.getAttribute('aria-controls')).querySelectorAll('.auf-titel')]
                 .map(x => x.textContent.trim()) };
    });
    check(`${art}: KRITISCH: ein Klick in die Zeile klappt sie auf`,
      nachZeilenklick.auf === 'true' && nachZeilenklick.leibSichtbar);
    check(`${art}: aufgeklappt stehen die vier Bereiche in der festgelegten Reihenfolge`,
      nachZeilenklick.titel.join('|') === 'Stammdaten|GAV|Zugang|Support');
    // GEMESSEN (2026-09-23): Am Handy scrollt die Tabelle waagrecht. Die
    // erste Fassung zeigte die aufgeklappte Flaeche so breit wie die ganze
    // Tabelle -- GAV und Zugang lagen rechts ausserhalb. Jeder Bereich muss
    // vollstaendig im Sichtbaren liegen, auf beiden Breiten.
    const lage = await page.evaluate(() => {
      const k = document.querySelector('#m-inhalt tr.auf-kopf .auf-knopf');
      const leib = document.getElementById(k.getAttribute('aria-controls'));
      return {
        bereiche: [...leib.querySelectorAll('.auf-bereich')].map(b => {
          const r = b.getBoundingClientRect(); return { l: r.left, r: r.right }; }),
        knopfOben: [...leib.querySelectorAll('.auf-zeile button')].map(b => Math.round(b.getBoundingClientRect().top)),
        knopfHoehe: [...leib.querySelectorAll('.auf-zeile button')].map(b => b.getBoundingClientRect().height),
        breite: innerWidth,
      };
    });
    check(`${art}: KRITISCH: jeder aufgeklappte Bereich liegt vollstaendig im sichtbaren Bildschirm`,
      lage.bereiche.length === 4 && lage.bereiche.every(b => b.l >= 0 && b.r <= lage.breite));
    // Kein Knopf bricht um: dann waere er hoeher als die uebrigen.
    check(`${art}: kein Knopf in der aufgeklappten Zeile bricht um`,
      Math.max(...lage.knopfHoehe) - Math.min(...lage.knopfHoehe) < 2);

    // Immer nur eine offen: die zweite aufklappen, die erste schliesst sich.
    await aufklappen(page, 'Vorrat A');
    const offen = await page.evaluate(() =>
      [...document.querySelectorAll('#m-inhalt .auf-knopf[aria-expanded="true"]')]
        .map(k => k.closest('tr').querySelector('strong').textContent));
    check(`${art}: KRITISCH: es ist immer nur eine Zeile offen`,
      offen.length === 1 && offen[0] === 'Vorrat A');
    const vorratZugang = await page.evaluate(() =>
      document.querySelector('#m-inhalt tr.auf-kopf.offen').nextElementSibling.innerText);
    check(`${art}: eine Vorratsanlage sagt beim Zugang, dass erst zugeteilt wird`,
      /erst nach der Zuteilung/.test(vorratZugang));
    // Nochmals klicken schliesst.
    await aufklappen(page, 'Vorrat A');
    check(`${art}: ein zweiter Klick schliesst die Zeile wieder`,
      await page.evaluate(() => !document.querySelector('#m-inhalt .auf-knopf[aria-expanded="true"]')));

    await aufklappen(page, 'Beispielwache AG');
    const zugangKnopf = await page.evaluate(() => document.querySelector('[data-zugang="1"]').textContent.trim());
    check(`${art}: ohne Vermerk heisst der Knopf "Einladen"`, zugangKnopf === 'Einladen');
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

// ── 5. Der Uebergabestand in der Spalte "Einrichtung" ─────────────────
// Nur am Desktop (ENT-697, siehe Abschnitt 4).
//
// Vier Aussagen, vier Texte, und Farbe traegt allein "ueberfaellig" (ENT-686,
// Klaerung 7). "Keine Einladung erfasst" steht nur bei aktiven Mandanten --
// und heisst so, weil ein Bestandsmandant ohne Vermerk trotzdem ein Konto
// haben kann.
for (const [breite, hoehe, art] of [[1280, 900, 'Desktop']]) {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  const protokoll = [];
  const m = (id, name, status, uebergabe) => ({ id, name, subdomain: 's' + id, status, ist_demo: false, uebergabe });
  await aufbauen(page, { 'betreiber_mandant_list.php': { status: 'ok', mandanten: [
    m(1, 'Ohne Vermerk AG', 'aktiv', { lage: 'keine', datum: null }),
    m(2, 'Eingeladen AG', 'aktiv', { lage: 'offen', datum: '2031-05-07' }),
    m(3, 'Eingeloest AG', 'aktiv', { lage: 'eingeloest', datum: '2030-02-03' }),
    m(4, 'Ueberfaellig AG', 'aktiv', { lage: 'ueberfaellig', datum: '2030-01-02' }),
    m(5, 'Vorrat A', 'vorrat', { lage: 'keine', datum: null }),
    m(6, 'Gekuendigt AG', 'gekuendigt', { lage: 'eingeloest', datum: '2029-04-05' }),
    m(7, 'Frisch AG', 'aktiv', { lage: 'nicht_eingerichtet', datum: null }),
  ] } }, protokoll);
  await page.goto(BASIS + 'betreiber.html');
  await page.evaluate(async () => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    document.getElementById('b-mandanten').classList.remove('versteckt');
    await ladeMandanten();
  });
  await page.waitForSelector('#m-inhalt table');
  const zeilen = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('#m-inhalt tbody tr:not(.auf-leib)')].map(tr => {
      const zelle = tr.children[6];
      const warn = [...zelle.querySelectorAll('.m-warn')].map(s => s.textContent);
      return [tr.querySelector('strong').textContent, { text: zelle.innerText, warn }];
    })));
  check(`${art}: ohne Vermerk steht "keine Einladung erfasst"`,
    /keine Einladung erfasst/.test(zeilen['Ohne Vermerk AG'].text));
  // Die Aussage, fuer die diese Zeile ueberhaupt so heisst: Sie behauptet
  // nicht, dass niemand Zugang hat.
  check(`${art}: KRITISCH: nirgends steht bloss "keine Einladung" oder "nicht übergeben"`,
    Object.values(zeilen).every(z => !/keine Einladung(?! erfasst)|nicht übergeben/.test(z.text)));
  check(`${art}: eine offene Einladung nennt ihr Fristende mit Jahr`,
    /eingeladen, offen bis 07\.05\.2031/.test(zeilen['Eingeladen AG'].text));
  check(`${art}: eine eingeloeste nennt ihr Datum`,
    /eingelöst am 03\.02\.2030/.test(zeilen['Eingeloest AG'].text));
  check(`${art}: eine ueberfaellige nennt, seit wann`,
    /überfällig seit 02\.01\.2030/.test(zeilen['Ueberfaellig AG'].text));
  check(`${art}: KRITISCH: Farbe traegt allein "ueberfaellig"`,
    zeilen['Ueberfaellig AG'].warn.some(w => /überfällig/.test(w))
    && Object.entries(zeilen).filter(([n]) => n !== 'Ueberfaellig AG')
         .every(([, z]) => !z.warn.some(w => /Einladung|eingel|überfällig|Übergabe/.test(w))));
  check(`${art}: KRITISCH: bei einer Vorratsanlage steht kein "keine Einladung erfasst"`,
    !/Einladung/.test(zeilen['Vorrat A'].text));
  check(`${art}: ein vorhandener Vermerk bleibt auch nach der Kuendigung sichtbar`,
    /eingelöst am 05\.04\.2029/.test(zeilen['Gekuendigt AG'].text));
  check(`${art}: KRITISCH: "nicht eingerichtet" sieht anders aus als "keine Einladung erfasst"`,
    /Übergabe nicht eingerichtet/.test(zeilen['Frisch AG'].text)
    && !/keine Einladung/.test(zeilen['Frisch AG'].text));
  const ueberlauf = await page.evaluate(() => ({
    seite: document.documentElement.scrollWidth - innerWidth }));
  check(`${art}: die Seite laeuft nicht waagrecht ueber`, ueberlauf.seite <= 0);
  await page.close();
}

// ── 6. Nach dem Einladen steht der neue Stand sofort da ───────────────
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const protokoll = [];
  await aufbauen(page, {
    'betreiber_mandant_list.php': { status: 'ok', mandanten: [
      { id: 1, name: 'Beispielwache AG', subdomain: 'b', status: 'aktiv', ist_demo: false,
        uebergabe: { lage: 'keine', datum: null } }] },
    'betreiber_mandant_einladen.php': { status: 'ok', gueltig_tage: 7 },
  }, protokoll);
  await page.goto(BASIS + 'betreiber.html');
  await page.evaluate(async () => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    document.getElementById('b-mandanten').classList.remove('versteckt');
    await ladeMandanten();
  });
  await aufklappen(page, 'Beispielwache AG');
  await page.click('[data-zugang="1"]');
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'z_vorname');
  await page.fill('#z_nachname', 'Beispiel');
  await page.fill('#z_email', 'alex@example.org');
  const vorher = protokoll.filter(p => p.name === 'betreiber_mandant_list.php').length;
  await page.click('#zSaveBtn');
  await bis(() => protokoll.filter(p => p.name === 'betreiber_mandant_list.php').length > vorher);
  check('KRITISCH: nach dem Einladen wird die Liste neu geladen',
    protokoll.filter(p => p.name === 'betreiber_mandant_list.php').length > vorher);
  await page.close();
}

// ── 7. Der Zugang in der aufgeklappten Zeile, je Stand ────────────────
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const u = (lage, extra) => Object.assign({ lage, datum: '2031-05-07' }, extra || {});
  await aufbauen(page, { 'betreiber_mandant_list.php': { status: 'ok', mandanten: [
    { id: 1, name: 'Offen AG', subdomain: 'o', status: 'aktiv', ist_demo: false,
      uebergabe: u('offen', { person: 'Alex Beispiel', email: 'alex@example.org',
        anrede: 'Frau', vorname: 'Alex', nachname: 'Beispiel' }) },
    { id: 2, name: 'Eingeloest AG', subdomain: 'e', status: 'aktiv', ist_demo: false,
      uebergabe: u('eingeloest', { person: 'Kim Muster', email: 'kim@example.org' }) },
    { id: 3, name: 'Ueberfaellig AG', subdomain: 'u', status: 'aktiv', ist_demo: false,
      uebergabe: u('ueberfaellig', { person: 'Sam Probe', email: 'sam@example.org' }) },
  ] } }, []);
  await page.goto(BASIS + 'betreiber.html');
  await page.evaluate(async () => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    document.getElementById('b-mandanten').classList.remove('versteckt');
    await ladeMandanten();
  });
  const knopfText = id => page.evaluate(i => {
    const b = document.querySelector('[data-zugang="' + i + '"]'); return b ? b.textContent.trim() : null; }, id);
  check('eine offene Einladung heisst "Neu einladen"', (await knopfText(1)) === 'Neu einladen');
  check('KRITISCH: nach dem Einloesen gibt es keinen Einladeknopf mehr', (await knopfText(2)) === null);
  check('eine ueberfaellige Einladung heisst "Neu einladen"', (await knopfText(3)) === 'Neu einladen');
  await aufklappen(page, 'Offen AG');
  const leib = await page.evaluate(() =>
    document.querySelector('#m-inhalt tr.auf-kopf.offen').nextElementSibling.innerText);
  // GEMESSEN, und zwar HIER: Nur in dieser Zeile hat der Zugang einen
  // zweizeiligen Stand (Frist UND Person) -- genau der Fall, in dem ein
  // mittig ausgerichteter Knopf tiefer rutschte. In Abschnitt 4 gibt es ihn
  // nicht, und dort blieb die Messung in der Gegenprobe gruen (2026-09-23).
  const oben = await page.evaluate(() =>
    [...document.querySelector('#m-inhalt tr.auf-kopf.offen').nextElementSibling
      .querySelectorAll('.auf-zeile button')].map(b => Math.round(b.getBoundingClientRect().top)));
  check('Desktop: die Knoepfe nebeneinander stehen auf einer Linie, auch neben zweizeiligem Stand',
    oben.length === 4 && Math.max(...oben) - Math.min(...oben) <= 2);
  check('KRITISCH: neben dem Knopf steht, an wen der letzte Link ging',
    /Alex Beispiel · alex@example\.org/.test(leib) && /offen bis 07\.05\.2031/.test(leib));
  await page.click('[data-zugang="1"]');
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'z_vorname');
  const vorbelegt = await page.evaluate(() =>
    ['z_anrede', 'z_vorname', 'z_nachname', 'z_email'].map(i => document.getElementById(i).value).join('|'));
  check('KRITISCH: "Neu einladen" belegt den Dialog mit der letzten Person vor',
    vorbelegt === 'Frau|Alex|Beispiel|alex@example.org');

  // Der Not-Aus im Demo-Reiter: zuletzt und abgesetzt. Ausgefuehrt wird die
  // Funktion der Seite selbst, mit einem laufenden Zugang.
  const demo = await page.evaluate(() => {
    const html = demoZugangBereiche({ id: 9, platz: 'demo1', status: 'aktiv',
      email: 'x@example.org', nachgefasst_am: null }, true).filter(Boolean);
    const d = document.createElement('div'); d.innerHTML = html.join('');
    return [...d.querySelectorAll('.auf-bereich')].map(b => ({
      titel: b.querySelector('.auf-titel').textContent, gefahr: b.classList.contains('gefahr') }));
  });
  check('KRITISCH: der Not-Aus steht zuletzt und als einziger abgesetzt',
    demo.length === 4 && demo[3].titel === 'Not-Aus' && demo[3].gefahr
    && demo.slice(0, 3).every(b => !b.gefahr));
  const zuDemo = await page.evaluate(() => demoZugangBereiche({ id: 9, platz: 'demo1',
    status: 'beendet', email: 'x@example.org', nachgefasst_am: null }, true).filter(Boolean).length);
  check('KRITISCH: ein beendeter Zugang hat keinen Not-Aus, kein Erneut senden, keine Nutzung',
    zuDemo === 1);
  await page.close();
}

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
