// Das Kundenportal (ENT-441) -- die Seite, die beim Kunden landet.
//
// Geprüft wird am gerenderten Zustand, nicht im Quelltext:
//   1. Der Anmeldeweg: Adresse, Code, Liste. Und dass die Antwort auf eine
//      Code-Anforderung NICHT verrät, ob es den Zugang gibt.
//   2. Die drei leeren Zustände sagen drei VERSCHIEDENE Dinge -- und keiner
//      davon sagt "keine Rundgänge", wenn in Wahrheit kein Revierdienst
//      eingerichtet ist (Hausregel: „unbekannt darf nie wie keine aussehen").
//   3. Die Masse für das Handy: Bedienelemente mindestens 44 px hoch,
//      Eingabefelder mindestens 16 px Schrift (darunter zoomt iOS hinein).
//      Zusätzlich am Desktop geprüft, wie CLAUDE.md es verlangt.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const SEITE = `file://${WURZEL}/portal.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const vorTagen = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

const VOLL = {
  status: 'ok', kunde: 'Muster Liegenschaften AG', person: 'A. Beispielperson',
  zeitraum: { von: vorTagen(30), bis: vorTagen(0) },
  objekte: [{ id: 1, name: 'Testliegenschaft Nord', strasse: 'Musterweg 1', ort: 'Musterort' }],
  rundgaenge: [
    { id: 10, datum: vorTagen(2), objekt_id: 1, objekt_name: 'Testliegenschaft Nord',
      status: 'abgeschlossen', beginn: `${vorTagen(2)} 22:04:00`,
      dauer: { sekunden: 2220, quelle: 'ende' },
      fortschritt: { gesamt: 6, erledigt: 6, bestaetigt: 6, ersatzscan: 0 } },
    { id: 11, datum: vorTagen(5), objekt_id: 1, objekt_name: 'Testliegenschaft Nord',
      status: 'abgebrochen', beginn: `${vorTagen(5)} 21:30:00`,
      dauer: { sekunden: 600, quelle: 'ende' },
      fortschritt: { gesamt: 6, erledigt: 2, bestaetigt: 2, ersatzscan: 0 } },
  ],
};
const leer = grund => ({
  status: 'ok', kunde: 'Muster Liegenschaften AG', person: 'A. Beispielperson',
  zeitraum: { von: vorTagen(30), bis: vorTagen(0) },
  objekte: [], rundgaenge: [], leer_grund: grund,
});

let antwort = VOLL;
let anmeldeFehler = false;
let calls = [];

function setup(page) {
  return page.route('**/api/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname.split('/api/')[1];
    calls.push({ path, rumpf: req.postData() });
    const send = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('portal_code_anfordern')) {
      // Der echte Endpunkt antwortet IMMER so -- auch für eine Adresse, zu
      // der es gar keinen Zugang gibt.
      return send({ status: 'ok', gueltig_minuten: 15,
        message: 'Wenn zu dieser Adresse ein Zugang besteht, ist der Code unterwegs.' });
    }
    if (path.includes('portal_anmelden')) {
      if (anmeldeFehler) {
        return send({ status: 'error',
          message: 'Der Code stimmt nicht oder gilt nicht mehr. Bitte einen neuen Code anfordern.' }, 401);
      }
      return send({ status: 'ok', token: 't', name: 'A. Beispielperson', kunde: 'Muster Liegenschaften AG' });
    }
    if (path.includes('portal_rundgaenge')) return send(antwort);
    if (path.includes('portal_abmelden')) return send({ status: 'ok' });
    return send({ status: 'ok' });
  });
}

// ── Die Farbkopie darf nicht auslaufen ───────────────────────────────
// portal.html traegt bewusst keinen Cockpit-Code (ENT-441 Punkt 8), die
// Verlaufs- und Glaswerte stehen darum als Kopie darin. Eine Kopie, die
// niemand vergleicht, laeuft beim naechsten Palettenwechsel auseinander --
// und man sieht es erst beim Kunden. Verglichen werden die WERTE, nicht der
// Wortlaut: Wo dashboard.html sie hinschreibt, ist ihm ueberlassen.
{
  const dash = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
  const portal = readFileSync(`${WURZEL}/portal.html`, 'utf8');
  const werte = (text, name) => {
    const treffer = [...text.matchAll(new RegExp('--' + name + ':\\s*([^;]+);', 'g'))]
      .map(m => m[1].trim().replace(/\s+/g, ''));
    return [...new Set(treffer)].sort();
  };
  for (const name of ['glas-grund-1', 'glas-grund-2', 'glas-grund-3', 'glas-kachel',
                      'accent', 'accent-hi']) {
    const d = werte(dash, name), p = werte(portal, name);
    check(`KRITISCH: --${name} ist im Portal derselbe Wert wie im Cockpit`,
      p.length > 0 && d.length > 0 && JSON.stringify(d) === JSON.stringify(p));
  }
  // Und die drei Kreise selbst: Groesse und Lage machen den Verlauf aus, die
  // Farbe allein waere ein anderer Grund.
  const kreise = t => [...t.matchAll(/radial-gradient\((\d+px \d+px at [^,]+),/g)].map(m => m[1].replace(/\s+/g, ' '));
  check('KRITISCH: die drei Verlaufskreise sitzen an derselben Stelle wie im Cockpit',
    JSON.stringify(kreise(portal)) === JSON.stringify(kreise(dash).slice(0, 3)));
}

const browser = await chromium.launch({ executablePath: EXE });

// ══ Handy ═══════════════════════════════════════════════════════════════
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await setup(page);
await page.goto(SEITE);
await page.evaluate(() => localStorage.clear());
await page.goto(SEITE);

check('Die Seite beginnt bei der Adresseingabe', await page.isVisible('#schritt-adresse'));
check('Die Rundgangliste ist vor der Anmeldung nicht sichtbar', !(await page.isVisible('#inhalt')));

// ── Masse auf dem Handy (CLAUDE.md) ──────────────────────────────────
const masse = await page.evaluate(() => {
  const el = s => document.querySelector(s);
  const h = s => Math.round(el(s).getBoundingClientRect().height);
  const f = s => parseFloat(getComputedStyle(el(s)).fontSize);
  return { email: { h: h('#email'), f: f('#email') }, knopf: h('#code-holen') };
});
check('KRITISCH: das Eingabefeld ist auf dem Handy mindestens 44 px hoch', masse.email.h >= 44);
check('KRITISCH: es hat mindestens 16 px Schrift (darunter zoomt iOS hinein)', masse.email.f >= 16);
check('KRITISCH: der Knopf ist mindestens 44 px hoch', masse.knopf >= 44);
// Ein Knopf wird nicht über die volle Breite gestreckt, nur weil er allein
// in seiner Zeile steht (Hausregel).
check('Der Knopf ist nicht über die volle Breite gestreckt',
  await page.evaluate(() => {
    const b = document.getElementById('code-holen').getBoundingClientRect();
    return b.width < document.body.getBoundingClientRect().width - 40;
  }));

// ── Anmeldeweg ───────────────────────────────────────────────────────
await page.fill('#email', 'a.beispiel@example.invalid');
await page.click('#code-holen');
await page.waitForTimeout(200);
check('Nach dem Anfordern kommt die Code-Eingabe', await page.isVisible('#schritt-code'));
// KRITISCH: Die Seite darf nicht verraten, ob es den Zugang gibt -- sonst
// liesse sich über sie herausfinden, welche Adressen hinterlegt sind.
const hinweis = await page.textContent('#code-hinweis');
check('KRITISCH: der Hinweis behauptet nicht, dass der Zugang existiert',
  /kein Zugang hinterlegt/.test(hinweis) && !/wurde gesendet|haben wir gesendet/.test(hinweis));
check('Der Code-Eingabe ist die Adresse zu entnehmen',
  (await page.textContent('#code-an')).includes('a.beispiel@example.invalid'));
check('KRITISCH: das Code-Feld ist mindestens 44 px hoch und hat mindestens 16 px Schrift',
  await page.evaluate(() => {
    const e = document.getElementById('code');
    return e.getBoundingClientRect().height >= 44 && parseFloat(getComputedStyle(e).fontSize) >= 16;
  }));

// Falscher Code: die Meldung erscheint, die Anmeldung bleibt stehen
anmeldeFehler = true;
await page.fill('#code', '000000');
await page.click('#anmelden');
await page.waitForTimeout(200);
check('Ein falscher Code wird gemeldet und führt nicht weiter',
  await page.isVisible('#fehler-code') && await page.isVisible('#schritt-code'));

anmeldeFehler = false;
await page.fill('#code', '123456');
await page.click('#anmelden');
await page.waitForTimeout(300);
check('Ein richtiger Code führt in die Liste', await page.isVisible('#inhalt'));
check('KRITISCH: der Kunde steht in der Kopfzeile — auf dem Handy sagt nur sie, wo man ist',
  (await page.textContent('#titel')).includes('Muster Liegenschaften AG'));

// ── Die Liste ────────────────────────────────────────────────────────
const liste = await page.textContent('#liste');
check('Eine abgeschlossene Runde ist als solche erkennbar', liste.includes('Abgeschlossen'));
// Ein Abbruch wird NICHT verschwiegen -- ein Nachweis, in dem das Fehlende
// fehlt, ist keiner.
check('KRITISCH: eine abgebrochene Runde erscheint ebenfalls', liste.includes('Abgebrochen'));
check('Die Kontrollpunkte stehen mit Bezug da, nicht als nackte Zahl',
  /6 von 6 Kontrollpunkten/.test(liste) && /2 von 6 Kontrollpunkten/.test(liste));
// Zwei Einheiten, zwei Zeilen: "Rundgänge" zählt Runden, "Kontrollpunkte"
// zählt Punkte darin (Hausregel: Einheiten nie vermischen).
const anzahl = await page.textContent('#anzahl');
check('KRITISCH: die Zahl bekommt einen Bezug, weil ein Zeitraum greift',
  /2 Rundgänge vom/.test(anzahl) && /1 Objekt/.test(anzahl));

// ── Gemessen: gleiches Muster auf beiden Seiten (CLAUDE.md) ──────────
// Der Zustand gehoert RECHTS und nicht unter das Datum. Ohne die
// ausdrueckliche Rasterzuweisung rutscht das dritte Kind auf dem Handy in
// die naechste Zeile und steht linksbuendig da -- es sieht nicht kaputt aus,
// ist aber ein zweites Muster neben dem am Desktop.
const lage = async (p) => p.evaluate(() => {
  const z = document.querySelector('#liste .zeile');
  const d = z.querySelector('.datum').getBoundingClientRect();
  const r = z.querySelector('.rechts').getBoundingClientRect();
  return { datumRechts: d.right, markeLinks: r.left,
           datumMitte: d.top + d.height / 2, markeOben: r.top, markeUnten: r.bottom };
});
const lHandy = await lage(page);
check('KRITISCH: der Zustand steht rechts vom Datum, nicht darunter (Handy)',
  lHandy.markeLinks > lHandy.datumRechts);
check('KRITISCH: und auf derselben Hoehe wie das Datum (Handy)',
  lHandy.datumMitte >= lHandy.markeOben && lHandy.datumMitte <= lHandy.markeUnten);
// Der Abmeldeknopf gehoert auf beiden Breiten an dieselbe Stelle -- rechts.
check('Der Abmeldeknopf steht auch auf dem Handy rechts',
  await page.evaluate(() => {
    const k = document.getElementById('abmelden').getBoundingClientRect();
    const b = document.querySelector('.buehne').getBoundingClientRect();
    return b.right - k.right < 30;
  }));

await page.screenshot({ path: `${OUT}/portal-01-handy.png` });

// ── Die drei leeren Zustände ─────────────────────────────────────────
const texte = {};
for (const grund of ['kein_revierdienst', 'noch_nichts_erfasst', 'kein_treffer_im_zeitraum']) {
  antwort = leer(grund);
  await page.evaluate(() => laden());
  await page.waitForTimeout(200);
  texte[grund] = await page.textContent('#liste');
}
check('KRITISCH: "kein Revierdienst eingerichtet" sagt genau das',
  /Kein Revierdienst eingerichtet/.test(texte.kein_revierdienst));
// Und es sagt ausdrücklich, dass daraus KEINE Aussage über die Leistung folgt.
check('KRITISCH: und es behauptet nicht, es sei nicht gearbeitet worden',
  /keine Leistung erbracht/.test(texte.kein_revierdienst));
check('KRITISCH: "noch nichts erfasst" ist eine eigene Aussage',
  /Noch keine Rundgänge erfasst/.test(texte.noch_nichts_erfasst));
check('KRITISCH: "kein Treffer im Zeitraum" ist eine eigene Aussage',
  /Keine Rundgänge im gewählten Zeitraum/.test(texte.kein_treffer_im_zeitraum));
check('KRITISCH: die drei sagen drei VERSCHIEDENE Dinge',
  texte.kein_revierdienst !== texte.noch_nichts_erfasst
  && texte.noch_nichts_erfasst !== texte.kein_treffer_im_zeitraum
  && texte.kein_revierdienst !== texte.kein_treffer_im_zeitraum);
// Keiner der drei darf wie der andere klingen -- vor allem darf bei
// fehlendem Revierdienst nicht "keine Rundgänge" stehen.
check('KRITISCH: bei fehlendem Revierdienst steht nicht "keine Rundgänge"',
  !/[Kk]eine Rundgänge/.test(texte.kein_revierdienst));

// ── Abmelden ─────────────────────────────────────────────────────────
antwort = VOLL;
await page.evaluate(() => laden());
await page.waitForTimeout(200);
calls = [];
await page.click('#abmelden');
await page.waitForTimeout(250);
check('Das Abmelden erreicht den Server (der Token wird dort gelöscht)',
  calls.some(c => c.path.includes('portal_abmelden')));
check('Nach dem Abmelden steht wieder die Adresseingabe da', await page.isVisible('#schritt-adresse'));
check('KRITISCH: der Token ist danach auch im Browser weg',
  await page.evaluate(() => !localStorage.getItem('portal_token')));

// ══ Desktop ═════════════════════════════════════════════════════════════
// Jede Änderung am Handy-Layout wird zusätzlich am Desktop geprüft, und
// umgekehrt (CLAUDE.md).
const gross = await browser.newPage({ viewport: { width: 1440, height: 900 } });
gross.on('pageerror', e => bad.push('JS-Fehler (Desktop): ' + e.message));
await setup(gross);
await gross.goto(SEITE);
await gross.evaluate(() => localStorage.clear());
await gross.goto(SEITE);
await gross.fill('#email', 'a.beispiel@example.invalid');
await gross.click('#code-holen');
await gross.waitForTimeout(150);
await gross.fill('#code', '123456');
await gross.click('#anmelden');
await gross.waitForTimeout(300);
check('Die Liste erscheint auch am Desktop', await gross.isVisible('#inhalt'));
// Die Seite darf am breiten Bildschirm nicht über die volle Breite laufen --
// eine Textzeile über 1440 px ist unlesbar.
const breite = await gross.evaluate(() =>
  Math.round(document.querySelector('.buehne').getBoundingClientRect().width));
check('KRITISCH: der Inhalt bleibt am Desktop auf lesbarer Breite', breite <= 940);
const lDesktop = await lage(gross);
check('KRITISCH: auch am Desktop steht der Zustand rechts vom Datum',
  lDesktop.markeLinks > lDesktop.datumRechts);
check('KRITISCH: und dort ebenfalls auf derselben Hoehe -- dasselbe Muster auf beiden Breiten',
  lDesktop.datumMitte >= lDesktop.markeOben && lDesktop.datumMitte <= lDesktop.markeUnten);
// Und nichts läuft seitlich aus dem Bild (weder hier noch auf dem Handy).
check('KRITISCH: die Seite scrollt nicht waagrecht',
  await gross.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
check('KRITISCH: auch auf dem Handy scrollt sie nicht waagrecht',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await gross.screenshot({ path: `${OUT}/portal-02-desktop.png` });

// ══ Dunkle Fassung ══════════════════════════════════════════════════════
// Die Seite folgt dem Geraet und hat keinen Umschalter -- also muessen
// BEIDE Fassungen stimmen. Gemessen wird am gerenderten Zustand: ob die
// Kachel wirklich durchscheint und die Schrift darauf noch traegt.
const dunkel = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
dunkel.on('pageerror', e => bad.push('JS-Fehler (dunkel): ' + e.message));
await setup(dunkel);
await dunkel.goto(SEITE);
await dunkel.evaluate(() => localStorage.clear());
await dunkel.goto(SEITE);
check('Der Empfang steht auch in der dunklen Fassung', await dunkel.isVisible('#empfang'));
await dunkel.screenshot({ path: `${OUT}/portal-04-empfang.png` });
const dunkelWerte = await dunkel.evaluate(() => {
  const koerper = getComputedStyle(document.body);
  const vor = getComputedStyle(document.body, '::before');
  return {
    grund: koerper.backgroundColor,
    tinte: koerper.color,
    verlauf: vor.backgroundImage,
    karte: getComputedStyle(document.querySelector('.karte')).backgroundColor,
  };
});
// Der dunkle Grund ist wirklich dunkel -- und nicht der helle, weil eine
// Medienabfrage danebengegriffen hat.
const kanaele = t => (t.match(/\d+/g) || []).slice(0, 3).map(Number);
const [gr, gg, gb] = kanaele(dunkelWerte.grund);
check('KRITISCH: in der dunklen Fassung ist der Grund wirklich dunkel',
  gr < 60 && gg < 60 && gb < 60);
const [tr, tg, tb] = kanaele(dunkelWerte.tinte);
check('KRITISCH: und die Schrift darauf hell', tr > 200 && tg > 200 && tb > 200);
// Der Verlauf ist die halbe Miete: Ohne ihn gibt es nichts zu brechen, und
// die Glaskante saehe bloss blass aus.
check('KRITISCH: die Verlaufsebene liegt hinter der Seite (drei Kreise)',
  (dunkelWerte.verlauf.match(/radial-gradient/g) || []).length === 3);
// Und die Kachel scheint wirklich durch -- eine deckende Flaeche waere kein
// Glas, sondern nur eine Karte mit runden Ecken.
check('KRITISCH: die Kachel ist durchscheinend, nicht deckend',
  /^rgba\(/.test(dunkelWerte.karte) && parseFloat(dunkelWerte.karte.split(',')[3]) < 0.95);
await dunkel.fill('#email', 'a.beispiel@example.invalid');
await dunkel.click('#code-holen');
await dunkel.waitForTimeout(150);
await dunkel.fill('#code', '123456');
await dunkel.click('#anmelden');
await dunkel.waitForTimeout(300);
check('Die Liste erscheint auch in der dunklen Fassung', await dunkel.isVisible('#inhalt'));
await dunkel.screenshot({ path: `${OUT}/portal-03-dunkel.png` });
await dunkel.evaluate(() => localStorage.clear());

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
