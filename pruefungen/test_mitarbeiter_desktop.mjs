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
  // Es gibt ZWEI Leisten -- eine fuers Handy, eine fuer den Schreibtisch
  // (ENT-447). Gemessen wird die, die tatsaechlich zu sehen ist; die
  // verborgene hat weder Lage noch Groesse und wuerde jede Messung
  // verfaelschen.
  const tabs = [...document.querySelectorAll('.tabs')]
    .find(n => n.getBoundingClientRect().height > 0) || document.querySelector('.tabs');
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
    sichtbareLeisten: [...document.querySelectorAll('.tabs')]
      .filter(n => n.getBoundingClientRect().height > 0).length,
    // Liegt die Leiste UEBER dem Inhalt? Am Schreibtisch ja -- sie steht
    // oben quer. Am Handy nein: dort klebt sie unten und ueberlagert ihn.
    ueberInhalt: t.bottom <= m.top + 1,
    // Nutzt die Seite die Fensterbreite, oder sitzt sie in einem Korsett?
    appBreite: Math.round(a.width),
    fenster: window.innerWidth,
    // Reserviert der Inhalt unten Platz fuer die Reiterleiste? Am Handy MUSS
    // er das (die Leiste liegt darueber), am Schreibtisch DARF er es nicht
    // (dort steht sie oben). Gegen die tatsaechliche Leistendicke gemessen
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
  // Diese Zeilen waren zuvor auf eine LINKE Spalte formuliert und wurden
  // durch den Umbau zu Recht rot. Die Leiste steht jetzt oben quer: eine
  // linke Spalte kostet 236 px, und die braucht die Monatstabelle.
  check('KRITISCH: am Schreibtisch steht die Leiste im Fluss, nicht am Fensterrand',
    d.steht === 'static');
  check('KRITISCH: und sie liegt OBEN -- ueber dem Inhalt, nicht darunter',
    d.ueberInhalt && d.leisteOben > 0);
  // ENT-447 revidiert die fruehere Aussage "dieselben fuenf Reiter": Am
  // Handy und am Schreibtisch wird NICHT dasselbe getan. Geblieben ist,
  // dass beide Leisten auf dieselben Abschnitte fuehren -- eine Quelle,
  // zwei Zugaenge. Geprueft wird darum die Anzahl und dass es genau EINE
  // sichtbare Leiste gibt, nicht zwei uebereinander.
  check('Am Schreibtisch fuehren fuenf Reiter', d.knopfZahl === 5);
  check('KRITISCH: es ist genau EINE Leiste sichtbar, nicht beide',
    d.sichtbareLeisten === 1);
  check('KRITISCH: die Leiste laeuft ueber die ganze Seitenbreite',
    d.leisteBreite >= d.appBreite - 2);
  // Der eigentliche Zweck des Umbaus: die Seite sitzt nicht mehr in einem
  // 1180-px-Korsett. Gemessen am Fenster, nicht an einer Zahl im Regelwerk.
  check('KRITISCH: die Seite nutzt die Fensterbreite statt eines festen Korsetts',
    d.appBreite >= d.fenster - 2);
  check('KRITISCH: der Inhalt bekommt die Breite',
    d.inhaltBreite >= d.fenster - 2);
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
  check('KRITISCH: und sie liegt dort NICHT ueber dem Inhalt, sondern darunter',
    !h.ueberInhalt);
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
  // "untereinander" taugt hier nicht mehr als Unterscheidung: seit die
  // Leiste oben quer steht, stehen die Knoepfe auf BEIDEN Seiten der
  // Grenze nebeneinander. Unterschieden wird jetzt an Fluss und Lage.
  check(`KRITISCH: knapp unter ${GRENZE} px gilt noch der Handy-Zuschnitt`,
    k.steht === 'fixed' && !k.ueberInhalt);
  await knapp.close();
  const drueber = await seite(GRENZE, 800, false);
  const g = await lage(drueber);
  check(`KRITISCH: ab genau ${GRENZE} px greift der Schreibtisch-Zuschnitt`,
    g.steht === 'static' && g.ueberInhalt);
  await drueber.close();
} catch (e) { check('Abschnitt Grenze ohne Abbruch: ' + e.message, false); }

// ══════════════ JEDER REITER IST EINE EIGENE SEITE
// Vom Projektinhaber gemeldet: "Mitteilung ist buggy. laesst sich auch
// nicht schliessen." Ursache war eine bestehende Regel bei 700 px, die
// alle Ueberlagerungen in einer 560-px-Saeule haelt. Der Schreibtisch-
// Block hob sie fuer die App auf, nicht fuer die Mitteilungen -- die
// standen als 560 px breiter Streifen mitten ueber der Monatstabelle, die
// dahinter sichtbar blieb, und sahen darum aus wie ein Fehler.
//
// Geprueft wird die AUSSAGE "jeder Reiter ist eine eigene Seite":
// gleiche linke Kante, volle Breite fuer die Seite, genau ein Reiter
// hervorgehoben, und man kommt wieder heraus.
try {
  const page = await seite(1440, 900, false);
  const kanten = {}, breiten = {};
  for (const t of ['plan', 'mitteilungen', 'stunden', 'abwesenheit', 'daten']) {
    await page.evaluate(x => zeigeTisch(x), t);
    await page.waitForTimeout(300);
    const d = await page.evaluate(() => {
      const sicht = e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.width > 0; };
      const mit = document.querySelector('.mit-seite.on');
      const seite = mit && sicht(mit) ? mit : document.querySelector('main.inhalt .v.on');
      const r = seite.getBoundingClientRect();
      // Wo beginnt die INHALTSSPALTE? Zwei Anlaeufe waren daneben: die
      // aeussere Huelle (bei den Mitteilungen laeuft sie ueber die volle
      // Breite, die Polsterung sitzt im Kind) und der erste Textknoten
      // (der steckt in Kaesten mit je eigener Innenpolsterung -- 30, 49,
      // 26, 42, 43 px, also fuenf verschiedene Zahlen fuer dasselbe).
      // Richtig ist die Polsterungskante des Kastens, der die
      // SEITENpolsterung traegt.
      // Wo beginnt der Inhalt? Gemessen als linkeste Kante aller sichtbaren
      // Bloecke, die man als Flaeche wahrnimmt -- Karten, Knoepfe,
      // Tabellen, also alles mit Hintergrund oder Rahmen. Drei feinere
      // Anlaeufe (Huelle, erster Textknoten, Polsterungstraeger) lieferten
      // je nach Seite verschiedene Zahlen fuer dasselbe, weil jeder Kasten
      // seine eigene Innenpolsterung hat. Die linkeste Flaeche ist das,
      // was das Auge als Seitenkante liest.
      const bloecke = [...seite.querySelectorAll('*')].filter(e => {
        if (!sicht(e)) return false;
        const c = getComputedStyle(e);
        const flaeche = c.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(c.backgroundColor);
        const rahmen = parseFloat(c.borderLeftWidth) > 0 || parseFloat(c.borderTopWidth) > 0;
        return (flaeche || rahmen) && e.getBoundingClientRect().width > 120;
      });
      return { links: bloecke.length
                 ? Math.round(Math.min(...bloecke.map(e => e.getBoundingClientRect().left)))
                 : Math.round(seite.getBoundingClientRect().left),
               breite: Math.round(r.width), fenster: window.innerWidth,
               aktiv: [...document.querySelectorAll('.tabs button.on')].filter(sicht).length };
    });
    kanten[t] = d.links; breiten[t] = d.breite;
    check(`KRITISCH: auf "${t}" ist genau EIN Reiter hervorgehoben`, d.aktiv === 1);
    // Kein Weg "zurueck zum Menü": Am Schreibtisch gibt es keinen
    // Menue-Reiter, in den man zurueckkoennte -- der Knopf zeigte auf
    // einen Ort, den es dort nicht gibt. Spesen und Einstellungen sind
    // davon nicht betroffen; die oeffnet man ueber "Konto", nicht ueber
    // einen Reiter, und dorthin muss man zurueckfinden.
    const rueck = await page.evaluate(() => [...document.querySelectorAll('button')]
      .filter(b => b.getBoundingClientRect().height > 0)
      .filter(b => /men(ü|ue)/i.test(b.getAttribute('aria-label') || ''))
      .map(b => b.getAttribute('aria-label')));
    check(`KRITISCH: "${t}" zeigt keinen Rueckweg ins Menue`, rueck.length === 0);
    rueck.forEach(r => bad.push(`Rueckweg auf "${t}": ${r}`));
  }
  const einzig = [...new Set(Object.values(kanten))];
  check('KRITISCH: alle fuenf Seiten beginnen an derselben linken Kante',
    einzig.length === 1);
  if (einzig.length !== 1) bad.push('linke Kanten: ' + JSON.stringify(kanten));
  check('KRITISCH: die Mitteilungen sind eine Seite, kein schmaler Streifen',
    breiten.mitteilungen > 1000);
  // "Ein Knopf wird nicht ueber die volle Breite gestreckt, nur weil er
  // allein in seiner Zeile steht" (CLAUDE.md). "Neuer Antrag" lief ueber
  // die vollen 1590 px, weil die Breite als Inline-Stil am Knopf stand
  // und darum von keiner Regel einzufangen war.
  await page.evaluate(() => zeigeTisch('abwesenheit'));
  await page.waitForTimeout(300);
  const gestreckt = await page.evaluate(() => {
    const sicht = e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.width > 0; };
    const seite = document.querySelector('main.inhalt .v.on');
    const b = seite.getBoundingClientRect().width;
    return [...seite.querySelectorAll('button')].filter(sicht)
      .filter(e => e.getBoundingClientRect().width > b * 0.6)
      .map(e => `${e.textContent.trim().slice(0, 20)} (${Math.round(e.getBoundingClientRect().width)}px)`);
  });
  check('KRITISCH: kein Knopf ist ueber die Seitenbreite gestreckt',
    gestreckt.length === 0);
  gestreckt.forEach(g => bad.push('gestreckter Knopf: ' + g));
  // Und man kommt wieder heraus: ein anderer Reiter schliesst sie.
  await page.evaluate(() => zeigeTisch('mitteilungen'));
  await page.waitForTimeout(250);
  const offen = await page.evaluate(() => !!document.querySelector('.mit-seite.on'));
  await page.evaluate(() => zeigeTisch('plan'));
  await page.waitForTimeout(250);
  const zu = await page.evaluate(() => !document.querySelector('.mit-seite.on'));
  check('KRITISCH: die Mitteilungen lassen sich ueber einen anderen Reiter schliessen',
    offen && zu);
  await page.close();
} catch (e) { check('Abschnitt Seiten ohne Abbruch: ' + e.message, false); }

// ══════════════ HINTER DEN MITTEILUNGEN SCROLLT NICHTS
// Vom Projektinhaber gemeldet: "Bei Mitteilungen scrollt der Hintergrund
// weiter." Die Mitteilungen liegen als feste Ebene ueber der Seite --
// scrollt die Seite darunter, wandern Kopfzeile und Leiste weg, waehrend
// die Ebene stehenbleibt. Gemessen: nach 600 px Scrollen klaffte eine
// 600-px-Luecke, durch die der Plan schaute.
//
// Geprueft wird die AUSSAGE, nicht der Weg dorthin: Nach dem Scrollen
// sitzt die Ebene unveraendert an der Leiste, und die Kopfzeile steht
// noch da. Wer das spaeter anders loest, bleibt zu Recht gruen.
try {
  const page = await seite(1440, 900, false);
  await page.evaluate(() => zeigeTisch('plan'));
  await page.waitForTimeout(500);
  await page.evaluate(() => zeigeTisch('mitteilungen'));
  await page.waitForTimeout(400);
  const lage = () => page.evaluate(() => {
    const m = document.querySelector('.mit-seite.on');
    const leiste = [...document.querySelectorAll('.tabs')].find(n => n.getBoundingClientRect().height > 0);
    const kopf = document.querySelector('.kopf');
    return { luecke: Math.round(m.getBoundingClientRect().top - leiste.getBoundingClientRect().bottom),
             kopfOben: Math.round(kopf.getBoundingClientRect().top) };
  });
  const vorher = await lage();
  await page.mouse.move(1300, 500);          // ausserhalb der Ebene
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(400);
  const nachher = await lage();
  check('KRITISCH: hinter den Mitteilungen scrollt nichts weg',
    nachher.luecke === vorher.luecke && Math.abs(nachher.luecke) <= 1);
  check('KRITISCH: und die Kopfzeile bleibt dabei stehen', nachher.kopfOben >= -1);
  if (nachher.luecke !== vorher.luecke) bad.push(`Luecke ${vorher.luecke} -> ${nachher.luecke} px`);
  // Der Hintergrund muss zurueckkommen, sobald man die Seite verlaesst --
  // sonst waere der Plan nach einem Besuch der Mitteilungen leer.
  await page.evaluate(() => zeigeTisch('plan'));
  await page.waitForTimeout(400);
  check('KRITISCH: und er ist wieder da, sobald man die Seite verlaesst',
    await page.evaluate(() => document.querySelector('main.inhalt').getBoundingClientRect().height > 0));
  await page.close();
} catch (e) { check('Abschnitt Hintergrund ohne Abbruch: ' + e.message, false); }

// ══════════════ DIE KOPFZEILE STEHT AUF JEDEM REITER GLEICH
// Zweimal hintereinander war der Konto-Knopf weg: erst ganz (kein
// Menue-Reiter mehr), dann auf drei Reitern (im Menue faellt die
// Kopfzeile weg, ENT-402 -- eine Handy-Regel). Und die Glocke sprang je
// nach Reiter vor oder hinter das Konto, weil beide Verort-Funktionen sie
// vor denselben Anker setzen.
try {
  const page = await seite(1440, 900, false);
  const folgen = [];
  for (const t of ['plan', 'stunden', 'mitteilungen', 'daten', 'abwesenheit']) {
    await page.evaluate(x => zeigeTisch(x), t);
    await page.waitForTimeout(250);
    folgen.push(await page.evaluate(() => [...document.querySelectorAll('.kopf button')]
      .filter(b => b.getBoundingClientRect().height > 0)
      .map(b => b.id || b.className.split(' ')[0]).join(',')));
  }
  const gleich = [...new Set(folgen)];
  check('KRITISCH: die Kopfzeile sieht auf jedem Reiter gleich aus', gleich.length === 1);
  if (gleich.length !== 1) bad.push('Kopfzeilen: ' + JSON.stringify(folgen));
  check('KRITISCH: und sie traegt auf JEDEM Reiter den Weg zum Konto',
    folgen.every(f => f.includes('kKonto')));
  check('Die Glocke steht dabei ebenfalls ueberall', folgen.every(f => f.includes('mitGlocke')));
  await page.close();
} catch (e) { check('Abschnitt Kopfzeile ohne Abbruch: ' + e.message, false); }

// ══════════════ NICHTS DARF AM SCHREIBTISCH UNERREICHBAR WERDEN
// ENT-447 nimmt den Reiter "Menü" aus der Schreibtisch-Leiste. Dahinter
// liegen aber Spesen, Passwort, Einstellungen, das Cockpit und das
// ABMELDEN. Ohne einen anderen Weg waeren sie schlicht weg -- gemessen
// war das zwischenzeitlich der Fall: keine der fuenf Beschriftungen war
// am Schreibtisch anklickbar, man konnte sich nicht einmal abmelden.
//
// Geprueft wird die Aussage "erreichbar", nicht ein bestimmter Knopf:
// ueber den Konto-Knopf gehen und nachsehen, was dann sichtbar ist.
try {
  const page = await seite(1440, 900, false);
  const kontoDa = await page.evaluate(() => {
    const k = document.getElementById('kKonto');
    return !!k && k.getBoundingClientRect().height > 0;
  });
  check('KRITISCH: am Schreibtisch gibt es einen Weg zum Konto', kontoDa);
  if (kontoDa) await page.click('#kKonto');
  await page.waitForTimeout(300);
  const erreichbar = await page.evaluate(() => {
    const sichtbar = e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.width > 0; };
    // Zuerst TRIMMEN, dann ausweichen: Ein reiner Symbolknopf hat als
    // textContent Leerzeichen -- die sind "wahr", und mit "||" kaeme das
    // aria-label nie zum Zug. Genau daran ist diese Pruefung zuerst
    // falsch rot geworden, obwohl der Knopf sichtbar dastand.
    const txt = [...document.querySelectorAll('button, a[href]')].filter(sichtbar)
      .map(b => {
        const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
        return t || (b.getAttribute('aria-label') || '').trim();
      });
    return ['Abmelden', 'Spesen', 'Passwort', 'Einstellungen']
      .filter(k => !txt.some(t => new RegExp(k, 'i').test(t)));
  });
  check('KRITISCH: Abmelden, Spesen, Passwort und Einstellungen sind erreichbar',
    erreichbar.length === 0);
  erreichbar.forEach(k => bad.push('am Schreibtisch unerreichbar: ' + k));
  // Und was oben ein Reiter ist, steht im Konto nicht noch einmal.
  const doppelt = await page.evaluate(() => {
    const sichtbar = e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.width > 0; };
    return ['mk-daten', 'mk-stunden', 'mk-abwesenheit']
      .filter(id => { const e = document.getElementById(id); return e && sichtbar(e); });
  });
  check('Kein zweiter sichtbarer Weg zu dem, was schon ein Reiter ist',
    doppelt.length === 0);
  await page.close();
} catch (e) { check('Abschnitt Erreichbarkeit ohne Abbruch: ' + e.message, false); }

// ══════════════ [hidden] MUSS AUCH AM SCHREIBTISCH VERBERGEN
// Dieselbe Wache steht in test_app -- aber die Suite laeuft bei 390 px,
// wo die Schreibtisch-Leiste ohnehin verborgen ist. Die Marke im Reiter
// hat dort keine Groesse, und die Pruefung konnte gar nicht anschlagen
// (bei der Gegenprobe genau so herausgekommen: gruen trotz Fehler).
// Geprueft wird darum HIER, wo die Elemente wirklich stehen.
try {
  const page = await seite(1440, 900, false);
  const sichtbarTrotzHidden = await page.evaluate(() =>
    [...document.querySelectorAll('[hidden]')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 || r.width > 0; })
      .map(e => e.id || e.className || e.tagName));
  check('KRITISCH: am Schreibtisch ist nichts mit [hidden] sichtbar',
    sichtbarTrotzHidden.length === 0);
  sichtbarTrotzHidden.forEach(n => bad.push('trotz [hidden] sichtbar: ' + n));
  await page.close();
} catch (e) { check('Abschnitt [hidden] ohne Abbruch: ' + e.message, false); }

check('Keine Skriptfehler', jsFehler.length === 0);
jsFehler.forEach(f => bad.push('JS-Fehler: ' + f));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
bad.forEach(b => console.log('  ✗ ' + b));
process.exit(bad.length ? 1 : 0);
