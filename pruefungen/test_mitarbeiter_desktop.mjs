// Schreibtisch-Zuschnitt der Mitarbeiter-App (ENTWURF, noch nicht entschieden).
//
// Der Projektinhaber will fuer Mitarbeitende eine Desktopansicht neben der
// App -- Dienstplaene auch am grossen Bildschirm. Statt einer zweiten
// Oberflaeche wandert die Reiterleiste ab Notebook-Breite von unten nach
// links; Auszeichnung, Knoepfe und zeige() bleiben dieselben. Damit gibt es
// weiterhin EINE Quelle fuer die Mitarbeiter-Ansichten.
//
// Gemessen wird der gerenderte Zustand, nicht das CSS: ob die Leiste
// TATSAECHLICH links steht, ob der Inhalt die Breite bekommt, und -- das
// Wichtigste -- ob das HANDY unangetastet bleibt. Eine Media Query, die
// zwei Zeilen zu frueh greift, macht die Bedienung am Telefon kaputt, ohne
// dass am Schreibtisch etwas auffaellt.
//
// NICHT hier geprueft: der Einsatzmodus. Der bleibt bewusst eine schmale
// Saeule (ENT-294) und wird in test_rundgang_einsatzmodus.mjs gemessen.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const GRENZE = 1080;   // ab hier der Schreibtisch-Zuschnitt

// Datum bewusst weit weg von heute (CLAUDE.md / test_datumsfest): ein
// Datum nahe am heutigen Tag kippt beim Datumswechsel.
const SCHICHTEN = [
  { id: 1, datum: '2027-04-06', von: '06:00', bis: '14:00', objekt: 'Objekt Nord' },
  { id: 2, datum: '2027-04-06', von: '18:00', bis: '22:00', objekt: 'Objekt West' },
  { id: 3, datum: '2027-04-08', von: '22:00', bis: '06:00', objekt: 'Objekt Sued' },
];
const PROFIL = { name: 'muster.person', vorname: 'Eine', nachname: 'Person',
  revierdienst_berechtigt: 1 };

const browser = await chromium.launch({ executablePath: EXE });
const jsFehler = [];

async function seite(breite, hoehe, mobil) {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe },
    isMobile: mobil, hasTouch: mobil });
  page.on('pageerror', e => jsFehler.push(e.message));
  await page.route('**/api/**', r => {
    const u = r.request().url();
    const s = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('login'))        return s({ status: 'ok', token: 't', name: 'muster.person', rechte: [] });
    if (u.includes('me.php'))       return s({ status: 'ok', name: 'muster.person', rechte: [] });
    if (u.includes('mein_profil'))  return s({ status: 'ok', profil: PROFIL });
    if (u.includes('meine_schichten')) return s({ status: 'ok', schichten: SCHICHTEN });
    return s({ status: 'ok', schichten: [], rapporte: [], abwesenheiten: [], sperren: [],
      mitteilungen: [], eintraege: [], vorlagen: [], fahrzeuge: [], ereignisarten: [], saldo: {} });
  });
  await page.goto(`file://${WURZEL}/app.html`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'muster.person');
  await page.fill('#gPass', 'x');
  await page.click('#gBtn');
  await page.waitForSelector('#app.on', { timeout: 6000 });
  await page.waitForTimeout(500);
  return page;
}

const lage = page => page.evaluate(() => {
  const app = document.getElementById('app');
  const tabs = document.querySelector('.tabs');
  const main = document.querySelector('main');
  const a = app.getBoundingClientRect(), t = tabs.getBoundingClientRect(), m = main.getBoundingClientRect();
  const knoepfe = [...tabs.querySelectorAll('button')];
  return {
    steht: getComputedStyle(tabs).position,
    richtung: getComputedStyle(tabs).flexDirection,
    leisteLinks: Math.round(t.left - a.left),
    leisteOben: Math.round(t.top - a.top),
    leisteBreite: Math.round(t.width),
    inhaltBreite: Math.round(m.width),
    inhaltLinks: Math.round(m.left - a.left),
    knopfHoehe: Math.round(knoepfe[0].getBoundingClientRect().height),
    knopfZahl: knoepfe.length,
    // Stehen die Knoepfe untereinander oder nebeneinander? Aus den
    // tatsaechlichen Kaesten gelesen, nicht aus flex-direction -- eine
    // Richtungsangabe kann von einer spaeteren Regel ueberschrieben sein.
    untereinander: knoepfe[1].getBoundingClientRect().top > knoepfe[0].getBoundingClientRect().bottom - 1,
    quer: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    // Reserviert der Inhalt unten Platz fuer die Reiterleiste? Am Handy MUSS
    // er das (die Leiste liegt darueber), am Schreibtisch DARF er es nicht
    // (dort steht sie links). Gegen die tatsaechliche Leistenhoehe gemessen
    // und nicht gegen eine abgeschriebene Zahl -- sonst prueft der Test die
    // Formulierung statt die Aussage.
    polsterUnten: Math.round(parseFloat(getComputedStyle(main).paddingBottom)),
    polsterSeite: Math.round(parseFloat(getComputedStyle(main).paddingLeft)),
    // NICHT t.height: am Schreibtisch ist das die Hoehe der SPALTE, nicht die
    // Dicke der Leiste -- eine Pruefung dagegen bliebe auch mit dem Fehler
    // gruen (bei der Gegenprobe genau so passiert). --tab-h ist die Dicke
    // der unteren Leiste und damit die richtige Bezugsgroesse.
    leistenDicke: Math.round(parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--tab-h'))),
  };
});

// ══════════════ SCHREIBTISCH
try {
  const page = await seite(1440, 900, false);
  await page.evaluate(() => zeige('plan'));
  await page.waitForTimeout(300);
  const d = await lage(page);
  check('KRITISCH: am Schreibtisch steht die Leiste links, nicht am unteren Rand',
    d.leisteLinks === 0 && d.leisteOben > 0 && d.steht === 'static');
  check('KRITISCH: die Knoepfe stehen untereinander', d.untereinander);
  check('Es sind dieselben fuenf Reiter wie am Handy -- keine zweite Navigation',
    d.knopfZahl === 5);
  check('KRITISCH: der Inhalt bekommt die Breite und steht neben der Leiste',
    d.inhaltBreite > 700 && d.inhaltLinks === d.leisteBreite);
  check('Die Leiste bleibt schmal genug, dass der Inhalt der Hauptteil ist',
    d.leisteBreite >= 180 && d.leisteBreite <= 280);
  // Die 44-px-Regel aus CLAUDE.md gilt dem Handy. Am Schreibtisch trifft
  // man mit der Maus genauer -- eine Zeile darf trotzdem nicht auf
  // Textzeilenhoehe zusammenfallen, sonst ist die Leiste eine Liste ohne
  // Trefferflaeche.
  check('KRITISCH: auch am Schreibtisch bleiben die Reiter anfassbar hoch',
    d.knopfHoehe >= 36);
  check('KRITISCH: kein waagrechter Seiten-Scroll', d.quer);
  // Diese beiden Zeilen sind nachtraeglich entstanden: Die Polsterungsregel
  // im Schreibtisch-Block stand zuerst auf "main" und war damit wirkungslos
  // -- ".inhalt" ist ein Klassenselektor und schlaegt jedes blosse "main",
  // egal in welcher Media Query. Nichts ging kaputt, es blieb nur die
  // Handy-Polsterung stehen: 88 px Leere unter dem Inhalt fuer eine Leiste,
  // die am Schreibtisch links steht. Genau die Fehlerfamilie aus CLAUDE.md
  // ("eine CSS-Regel kann wirkungslos bleiben, ohne dass etwas kaputtgeht").
  check('KRITISCH: am Schreibtisch KEIN Platzhalter fuer die untere Leiste',
    d.polsterUnten < d.leistenDicke);
  check('Der Inhalt bekommt am Schreibtisch mehr seitliche Luft als am Handy',
    d.polsterSeite > 16);
  await page.screenshot({ path: `${OUT}/ma-desktop-01-plan.png` });
  await page.close();
} catch (e) { check('Abschnitt Schreibtisch ohne Abbruch: ' + e.message, false); }

// ══════════════ HANDY -- MUSS UNANGETASTET BLEIBEN
try {
  const page = await seite(390, 844, true);
  await page.evaluate(() => zeige('plan'));
  await page.waitForTimeout(300);
  const h = await lage(page);
  check('KRITISCH: am Handy haengt die Leiste weiterhin unten am Bildschirm',
    h.steht === 'fixed');
  check('KRITISCH: und die Knoepfe stehen nebeneinander, nicht untereinander',
    !h.untereinander);
  check('KRITISCH: die Trefferflaeche bleibt bei mindestens 44 px (Projektregel)',
    h.knopfHoehe >= 44);
  check('KRITISCH: kein waagrechter Seiten-Scroll', h.quer);
  check('KRITISCH: am Handy bleibt der Platz fuer die untere Leiste reserviert',
    h.polsterUnten >= h.leistenDicke);
  await page.screenshot({ path: `${OUT}/ma-desktop-02-handy.png` });
  await page.close();
} catch (e) { check('Abschnitt Handy ohne Abbruch: ' + e.message, false); }

// ══════════════ DIE GRENZE SELBST
// Ein Tablet quer (1024) soll die vertraute Handy-Bedienung behalten. Die
// Grenze wird von BEIDEN Seiten angefasst -- eine Media Query, die nur von
// einer Seite geprueft wird, kann um 200 px daneben liegen.
try {
  const knapp = await seite(GRENZE - 1, 800, false);
  const k = await lage(knapp);
  check(`KRITISCH: knapp unter ${GRENZE} px gilt noch der Handy-Zuschnitt`,
    k.steht === 'fixed' && !k.untereinander);
  await knapp.close();
  const drueber = await seite(GRENZE, 800, false);
  const g = await lage(drueber);
  check(`KRITISCH: ab genau ${GRENZE} px greift der Schreibtisch-Zuschnitt`,
    g.steht === 'static' && g.untereinander);
  await drueber.close();
} catch (e) { check('Abschnitt Grenze ohne Abbruch: ' + e.message, false); }

check('Keine Skriptfehler', jsFehler.length === 0);
jsFehler.forEach(f => bad.push('JS-Fehler: ' + f));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
bad.forEach(b => console.log('  ✗ ' + b));
process.exit(bad.length ? 1 : 0);
