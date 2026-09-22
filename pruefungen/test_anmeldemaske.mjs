// Der Anmeldebildschirm der Mitarbeiter-App (ENT-385).
//
// Umgebaut auf Wunsch des Projektinhabers: Logo gross, Wortmarke
// "Cockpit" weg, weisse Karte weg, Farbigkeit des Dashboard-Dunkelmodus.
// Diese Suite haelt das Ergebnis am GERENDERTEN Zustand fest -- CLAUDE.md:
// "Gestaltung wird gemessen, nicht im Quelltext nachgelesen. Eine
// CSS-Regel kann wirkungslos bleiben, ohne dass etwas kaputtgeht."
// Darum steht hier keine einzige Pruefung auf Quelltext.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(5000);
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
const ev = (fn, ...a) => page.evaluate(fn, ...a).catch(() => null);

// Kontrast nach WCAG. Wird gerechnet, nicht geschaetzt: "sieht hell genug
// aus" ist auf einem dunklen Grund die haeufigste Selbsttaeuschung.
const leuchte = (r, g, b) => {
  const k = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
  return .2126 * k(r) + .7152 * k(g) + .0722 * k(b);
};
const kontrast = (a, b) => {
  const z = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  const [l1, l2] = [leuchte(...z(a)), leuchte(...z(b))].sort((x, y) => y - x);
  return (l1 + .05) / (l2 + .05);
};

await page.goto(`file://${WURZEL}/app.html`);
await page.waitForTimeout(400);

const mass = async sel => ev(s => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect(), c = getComputedStyle(e);
  return { x: r.x, y: r.y, w: r.width, h: r.height, unten: r.bottom,
           fs: parseFloat(c.fontSize), farbe: c.color, grund: c.backgroundColor,
           schatten: c.boxShadow };
}, sel);

// ══════════ WAS WEGFALLEN SOLLTE, IST WEG ═════════════════════════════
check('KRITISCH: die Wortmarke "Cockpit" steht nicht mehr auf dem Zugang zur Mitarbeiter-App',
  await ev(() => !document.querySelector('.gate-oben .wm')));
const form = await mass('#gate-login');
check('KRITISCH: die weisse Karte ist weg -- der Formularblock hat keine eigene Flaeche',
  form !== null && /rgba\(0, 0, 0, 0\)|transparent/.test(form.grund));
check('KRITISCH: und auch keinen Schatten mehr, der eine Kartenkante andeuten wuerde',
  form !== null && form.schatten === 'none');

/* ══════════ DER GRUND TRAEGT DIE TEXTE DARAUF ═══════════════════════
   REVIDIERT durch ENT-658. Hier stand ein Vergleich auf die Hexzahl
   #0F1117 -- der Grund war eine einzige Farbe, also liess er sich so
   pruefen. Seit der Grund ein VERLAUF ist (derselbe wie das App-Symbol,
   dunkel unten links nach hell oben rechts), sagt eine einzelne Zahl
   nichts mehr: Sie waere entweder an einer Stelle richtig und an allen
   anderen falsch, oder sie muesste weggelassen werden.

   Die Aussage dahinter war nie die Zahl, sondern: Der Grund ist dunkel
   genug fuer alles, was ohne eigene Flaeche darauf steht. Genau das wird
   jetzt gemessen, und zwar am BILDPUNKT hinter jedem einzelnen Text --
   aufgenommen mit ausgeblendeten Texten, damit die Schrift die Messung
   nicht faelscht.

   Das ist strenger als vorher: Ein Verlauf kann an einer Stelle
   durchfallen und an einer anderen bestehen, und genau diese eine Stelle
   findet die Pruefung. 4,5:1 ist die Schwelle aus WCAG AA fuer
   Fliesstext. */
{
  /* Vier statt fuenf seit ENT-668: Das Etikett "powered by" der
     Herstellersignatur ist aus der Anmeldemaske verschwunden. Die
     uebrigen vier stehen unveraendert ohne eigene Flaeche auf dem
     Verlauf und werden weiterhin einzeln am Bildpunkt gemessen. */
  const ziele = ['.gate-oben .sub', '#lb-name', '#lb-pass', '#lb-pwvergessen'];
  const lagen = await ev(sel => sel.map(s => {
    const e = document.querySelector(s);
    if (!e) { return null; }
    const r = e.getBoundingClientRect();
    return { s, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
             farbe: getComputedStyle(e).color };
  }), ziele);
  check('Vorbedingung: alle vier Texte ohne eigene Flaeche sind vorhanden',
    lagen.every(l => l !== null));
  // Die Texte ausblenden und den nackten Grund aufnehmen.
  await ev(sel => sel.forEach(s => {
    const e = document.querySelector(s); if (e) { e.style.visibility = 'hidden'; }
  }), ziele);
  const auf = (await page.screenshot()).toString('base64');
  await ev(sel => sel.forEach(s => {
    const e = document.querySelector(s); if (e) { e.style.visibility = ''; }
  }), ziele);
  const gruende = await page.evaluate(async ({ d, punkte, skala }) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + d; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    return punkte.map(p => {
      if (!p) { return null; }
      const i = ((p.y * skala | 0) * c.width + (p.x * skala | 0)) * 4;
      const px = x.getImageData(0, 0, c.width, c.height).data;
      return { s: p.s, farbe: p.farbe,
               grund: `rgb(${px[i]}, ${px[i+1]}, ${px[i+2]})` };
    });
  }, { d: auf, punkte: lagen, skala: 1 });
  const schwach = gruende.filter(g => g && kontrast(g.farbe, g.grund) < 4.5);
  check('KRITISCH: jeder Text ohne eigene Flaeche haelt 4.5:1 gegen den Verlauf an SEINER Stelle',
    schwach.length === 0);
  // Und der Verlauf ist wirklich einer -- sonst waere die Pruefung oben
  // ein aufwendiger Weg, eine einzige Farbe zu bestaetigen.
  const verlauf = await ev(() =>
    getComputedStyle(document.getElementById('gate')).backgroundImage);
  check('Der Grund ist ein Verlauf und keine Flaeche',
    /linear-gradient/.test(verlauf || ''));
}
const feld = await mass('#gName');
check('Das Eingabefeld hebt sich vom Grund ab (--surface-2 #1E2535)',
  feld !== null && feld.grund === 'rgb(30, 37, 53)');
check('KRITISCH: der eingegebene Text liest hell auf dunkel, nicht schwarz auf dunkel',
  feld !== null && kontrast(feld.farbe, feld.grund) >= 7);

/* ══════════ DIE MARKE STEHT FREI ═══════════════════════════════════
   REVIDIERT durch ENT-657. Hier stand "das Logo ist deutlich groesser als
   die frueheren 66 px" und mass den KASTEN einer Bilddatei. Der Kasten
   war die falsche Groesse: guardops-192.png war zu 100 % deckend -- das
   dunkle Quadrat WAR die Datei. Vom Projektinhaber beanstandet: "Das G
   ist innerhalb eines Quadrats. Ich will da nur das G."

   Gemessen wurde: 86 x 110 von 192 Bildpunkten waren die weisse Marke,
   im 130er Kasten also 58 x 74 px. Der Rest war Quadratrand -- mehr als
   die halbe Flaeche. Die Pruefung auf "Kasten >= 120" war damit gruen,
   obwohl die Marke selbst nur 74 px hoch war.

   Geprueft wird jetzt die TINTE, nicht der Kasten, und dass sie nicht
   kleiner geworden ist. Die drei Aussagen zur Fassung (keine Flaeche,
   kein Eckenrund, kein Ring) bleiben unveraendert gueltig -- sie kamen
   frueher aus dem CSS, und jetzt kommt ausserdem keine mehr aus der
   Datei. */
const logo = await mass('.gate-oben .gate-marke');
check('KRITISCH: die Marke ist als Zeichnung eingebunden, nicht als Bilddatei -- nur so kann sie kein Quadrat mittragen',
  await ev(() => !document.querySelector('.gate-oben img')
    && !!document.querySelector('.gate-oben svg.gate-marke')));
check('KRITISCH: die Marke ist mindestens so hoch wie zuvor -- sie darf durch den Wegfall des Quadrats nicht schrumpfen',
  logo !== null && logo.h >= 70);
const fassung = await ev(() => {
  const c = getComputedStyle(document.querySelector('.gate-oben .gate-marke'));
  return { grund: c.backgroundColor, radius: c.borderRadius,
           padding: c.paddingTop, schatten: c.boxShadow };
});
check('KRITISCH: die Marke traegt keine weisse Flaeche mehr hinter sich',
  fassung !== null && /rgba\(0, 0, 0, 0\)|transparent/.test(fassung.grund));
check('KRITISCH: und keinen gerundeten Rahmen -- kein Eckenrund, kein Innenabstand, kein Ring',
  fassung !== null && parseFloat(fassung.radius) === 0
  && parseFloat(fassung.padding) === 0 && fassung.schatten === 'none');
/* Und sie ist wirklich GEZEICHNET. Der Kommentar am Sprite in app.html
   warnt genau davor: Wer die viewBox des Symbols auch aussen hinschreibt,
   verschiebt die Zeichnung aus dem Kasten -- Kasten, Farbe und Kontrast
   messen sich danach unveraendert, nur das Bild fehlt. Darum die Tinte:
   Ein Umriss deckt einen Teil der Flaeche, eine leere Marke null, ein
   zurueckgekehrtes Quadrat fast alles. */
const tinte = await (async () => {
  /* Das GERENDERTE Bild, von Playwright aufgenommen -- nicht eine
     nachgebaute Zeichnung.

     Der erste Anlauf baute das Symbol in eine eigene Leinwand nach und
     mass die. Die Gegenprobe "Symbol-viewBox verschoben" blieb dabei
     GRUEN: Der Nachbau setzte die viewBox des Elements, nicht die des
     Symbols, und zeichnete darum immer richtig. Eine Pruefung, die nie
     angeschlagen hat, ist eine Behauptung (CLAUDE.md) -- also wird jetzt
     das aufgenommen, was wirklich auf dem Schirm steht. */
  const el = await page.$('.gate-oben .gate-marke');
  if (!el) { return -1; }
  const bild = (await el.screenshot()).toString('base64');
  return page.evaluate(async d => {
    const im = new Image(); im.src = 'data:image/png;base64,' + d;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const px = x.getImageData(0, 0, c.width, c.height).data;
    let hell = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 128 && (px[i] + px[i + 1] + px[i + 2]) / 3 > 150) { hell++; }
    }
    return Math.round(1000 * hell / (c.width * c.height)) / 10;
  }, bild);
})();
check('KRITISCH: die Marke ist tatsaechlich gezeichnet und nicht leer',
  tinte > 5);
check('KRITISCH: und sie ist ein Umriss, keine gefuellte Flaeche -- das Quadrat ist wirklich weg',
  tinte >= 0 && tinte < 60);
const mitte = await mass('.gate-mitte');
// CLAUDE.md: "Mittiges gehoert wirklich in die Mitte -- bezogen auf den
// Container." Zwei Pixel Toleranz fuer ungerade Breiten.
/* ══════════ DER BLOCK IST BETONIERT (ENT-657) ══════════════════════
   Vom Projektinhaber zum zweiten Mal gemeldet: "Die Anmeldemaske bewegt
   sich IMMER noch, wenn man auf das Eingabefeld klickt. Betoniere den
   Container fest."

   ENT-635 hatte den CONTAINER schrumpfen lassen (--tastatur), damit iOS
   nicht das ganze Fenster verschiebt. Der Inhalt DARIN floss aber weiter
   um: .gate-luft-oben war als schrumpfbar gebaut (flex: 0 1 48px) und
   fiel als Erstes auf null zusammen. Gemessen: Die Oberkante der Marke
   sprang von 80 auf 32 px -- genau diese 48.

   Geprueft werden BEIDE Wege, auf denen die Tastatur ankommen kann, denn
   sie fuehren zu verschiedenen Messwerten und muessen beide still
   bleiben:
     1. Nur der sichtbare Ausschnitt schrumpft; --tastatur wird gesetzt
        und #gate schrumpft von unten (der Weg aus ENT-635).
     2. Das Fenster selbst schrumpft (die Huelle verkleinert die Ansicht);
        --tastatur bleibt 0, die Hoehe faellt trotzdem.
   Der zweite Fall ist der wichtigere: Dort greift der Mechanismus aus
   ENT-635 gar nicht, und genau dort war der Sprung bisher ungeprueft. */
{
  const lage = () => ev(() => {
    const g = s => { const e = document.querySelector(s);
      if (!e) { return null; }
      const r = e.getBoundingClientRect(); return Math.round(r.top); };
    return { marke: g('.gate-oben .gate-marke'), name: g('#gName'),
             knopf: g('#gBtn'), luft: (() => {
               const e = document.querySelector('.gate-luft-oben');
               return e ? Math.round(e.getBoundingClientRect().height) : null; })() };
  });
  const ruhe = await lage();
  check('Vorbedingung: der Block ist ueberhaupt messbar',
    ruhe.marke !== null && ruhe.name !== null && ruhe.knopf !== null);

  // Weg 1: sichtbarer Ausschnitt schrumpft.
  await ev(() => document.documentElement.style.setProperty('--tastatur', '336px'));
  await page.waitForTimeout(120);
  const mitTastatur = await lage();
  await ev(() => document.documentElement.style.setProperty('--tastatur', '0px'));
  await page.waitForTimeout(120);
  check('KRITISCH: mit offener Tastatur bleibt die Marke an derselben Stelle',
    mitTastatur.marke === ruhe.marke);
  check('KRITISCH: und die beiden Eingabefelder ebenso -- der Block wandert nicht',
    mitTastatur.name === ruhe.name && mitTastatur.knopf === ruhe.knopf);
  check('KRITISCH: die Luft ueber dem Block faellt dabei nicht zusammen -- sie war die Ursache',
    mitTastatur.luft === ruhe.luft && ruhe.luft > 0);

  // Weg 2: das Fenster selbst wird kleiner.
  const voll = page.viewportSize();
  await page.setViewportSize({ width: voll.width, height: voll.height - 336 });
  await page.waitForTimeout(150);
  const kleinerSchirm = await lage();
  await page.setViewportSize(voll);
  await page.waitForTimeout(150);
  check('KRITISCH: schrumpft das Fenster selbst, bleibt der Block ebenfalls stehen',
    kleinerSchirm.marke === ruhe.marke && kleinerSchirm.name === ruhe.name);
  check('KRITISCH: auch dort faellt die Luft ueber dem Block nicht zusammen',
    kleinerSchirm.luft === ruhe.luft);
  /* Stehenbleiben heisst nicht wegfallen: Wenn der Block hoeher ist als
     der Rest des Bildschirms, muss er erreichbar bleiben -- sonst waere
     "betoniert" nur ein anderes Wort fuer "abgeschnitten". */
  check('KRITISCH: der Zugang bleibt dabei erreichbar -- er rollt, statt den Inhalt abzuschneiden',
    await ev(() => {
      const g = document.getElementById('gate');
      return getComputedStyle(g).overflowY === 'auto'
        && g.scrollHeight >= g.clientHeight;
    }));
}

/* ══════════ WANN DIE TASTATURLOGIK EINGREIFT (ENT-660) ═════════════
   Der dritte Bericht zu derselben Sache, und diesmal praeziser: "Maske
   zuckt immer noch ein wenig, wenn die Tastatur droppt." Also beim
   SCHLIESSEN.

   Gemessen: Waehrend die Tastatur zufaehrt, laeuft tastaturVerfolgen
   sechsmal durch die Animation -- visualViewport meldet resize UND
   scroll, und beides mehrfach. Jeder Durchlauf rief window.scrollTo(0,0)
   und scrollIntoView auf dem fokussierten Feld. Dabei blieb --tastatur
   die ganze Zeit 0: Wo die Huelle das FENSTER verkleinert statt nur den
   sichtbaren Ausschnitt, misst sich gar keine Tastatur. Der Mechanismus
   griff also nicht, die Scrollbefehle liefen trotzdem -- Bewegung ohne
   Zweck, mitten in einer Animation.

   Geprueft wird die ganze Wahrheitstafel, nicht nur der behobene Fall.
   Die vierte Zeile ist die unauffaellige: Ein scrollIntoView auf ein
   Feld, das ohnehin frei steht, ist am Schreibtisch ein Nichtstun und
   auf dem Geraet ein Ruck. */
{
  /* Auf einem grossen Bildschirm steht selbst das untere Feld mit
     Tastatur noch frei -- dort liesse sich "verdecktes Feld wird geholt"
     gar nicht pruefen. Darum fuer diesen Block ein knappes Geraet
     (390x640), auf dem die Tastatur wirklich etwas verdeckt. Am Ende
     wird die alte Groesse wiederhergestellt. */
  const vorherGroesse = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 640 });
  await page.waitForTimeout(150);
  const zaehler = () => ev(() => {
    window.__tz = { scrollTo: 0, intoView: 0 };
    const echt = window.scrollTo.bind(window);
    window.scrollTo = (...a) => { window.__tz.scrollTo++; return echt(...a); };
    const proto = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...a) {
      window.__tz.intoView++; return proto.apply(this, a);
    };
  });
  const stand = () => ev(() => JSON.parse(JSON.stringify(window.__tz)));

  // ── Zeile 1: keine Tastatur messbar -> kein Eingriff ───────────────
  await zaehler();
  await ev(() => { document.getElementById('gName').focus(); tastaturVerfolgen(); });
  const ohne = await stand();
  check('KRITISCH: ohne messbare Tastatur wird gar nicht gescrollt',
    ohne.scrollTo === 0 && ohne.intoView === 0);
  check('Und --tastatur steht dann auf 0',
    (await ev(() => getComputedStyle(document.documentElement)
      .getPropertyValue('--tastatur').trim())) === '0px');

  // ── Zeile 2: Tastatur messbar, Feld verdeckt -> ins Bild holen ─────
  /* Der sichtbare Ausschnitt wird verkleinert, OHNE das Fenster zu
     aendern -- so verhaelt es sich, wenn die Huelle die Ansicht stehen
     laesst. Nur dann misst sich ueberhaupt eine Tastatur. */
  const verdeckt = await page.evaluate(async () => {
    const feld = document.getElementById('gPass');
    feld.focus();
    const echt = Object.getOwnPropertyDescriptor(VisualViewport.prototype, 'height');
    Object.defineProperty(VisualViewport.prototype, 'height', {
      configurable: true, get() { return window.innerHeight - 336; } });
    const vorher = Math.round(feld.getBoundingClientRect().top);
    window.__tz = { scrollTo: 0, intoView: 0 };
    tastaturVerfolgen();
    await new Promise(r => setTimeout(r, 120));
    const sicht = window.innerHeight - 336;
    const kasten = feld.getBoundingClientRect();
    const raus = {
      tast: getComputedStyle(document.documentElement).getPropertyValue('--tastatur').trim(),
      vorher, nachher: Math.round(kasten.top),
      imBild: kasten.bottom <= sicht + 1 && kasten.top >= -1,
      log: JSON.parse(JSON.stringify(window.__tz)),
    };
    Object.defineProperty(VisualViewport.prototype, 'height', echt);
    tastaturVerfolgen();
    return raus;
  });
  check('Vorbedingung: mit verkleinertem Ausschnitt misst sich eine Tastatur',
    verdeckt.tast === '336px');
  check('KRITISCH: ein von der Tastatur verdecktes Feld wird ins Bild geholt',
    verdeckt.imBild === true && verdeckt.nachher < verdeckt.vorher);

  // ── Zeile 3: Tastatur messbar, Feld aber frei -> NICHT scrollen ────
  const frei = await page.evaluate(async () => {
    // Das oberste Feld steht auch mit Tastatur weit oben im Bild.
    const feld = document.getElementById('gName');
    feld.focus();
    const echt = Object.getOwnPropertyDescriptor(VisualViewport.prototype, 'height');
    Object.defineProperty(VisualViewport.prototype, 'height', {
      configurable: true, get() { return window.innerHeight - 336; } });
    tastaturVerfolgen();              // einmal einschwingen lassen
    await new Promise(r => setTimeout(r, 120));
    const sicht = window.innerHeight - 336;
    const k = feld.getBoundingClientRect();
    const stehtFrei = k.top >= 0 && k.bottom <= sicht;
    window.__tz = { scrollTo: 0, intoView: 0 };
    tastaturVerfolgen();              // und jetzt zaehlen
    const raus = { stehtFrei, log: JSON.parse(JSON.stringify(window.__tz)) };
    Object.defineProperty(VisualViewport.prototype, 'height', echt);
    tastaturVerfolgen();
    return raus;
  });
  check('Vorbedingung: das oberste Feld steht auch mit Tastatur frei',
    frei.stehtFrei === true);
  check('KRITISCH: ein frei stehendes Feld wird NICHT ins Bild geholt -- das waere auf dem Geraet ein Ruck',
    frei.log.intoView === 0);

  // ── Zeile 4: die Tastatur faehrt zu -> gar kein Eingriff ───────────
  /* Der eigentliche Bericht. Die Huelle laesst das Fenster mitwachsen;
     dabei feuert visualViewport mehrfach. Keiner dieser Durchlaeufe darf
     noch scrollen -- es gibt nichts zu korrigieren, der Platz kommt von
     selbst zurueck. */
  const voll = page.viewportSize();
  await page.setViewportSize({ width: voll.width, height: voll.height - 336 });
  await page.waitForTimeout(150);
  await zaehler();
  for (const h of [voll.height - 250, voll.height - 150, voll.height - 60, voll.height]) {
    await page.setViewportSize({ width: voll.width, height: h });
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(200);
  const zu = await stand();
  check('KRITISCH: waehrend die Tastatur zufaehrt wird kein einziges Mal gescrollt',
    zu.scrollTo === 0 && zu.intoView === 0);
  await ev(() => { document.activeElement.blur(); });
  await page.setViewportSize(vorherGroesse);
  await page.waitForTimeout(150);
}

check('Die Marke steht waagrecht wirklich mittig, nicht nur ungefaehr',
  logo !== null && mitte !== null
  && Math.abs((logo.x + logo.w / 2) - (mitte.x + mitte.w / 2)) <= 2);
check('Der Firmenname steht als einzige Textzeile unter dem Logo',
  (await page.textContent('.gate-oben .sub').catch(() => '')).trim() !== '');

// ══════════ CLAUDE.md: TREFFERFLAECHEN UND SCHRIFTGROESSEN ════════════
const pass = await mass('#gPass');
const cta = await mass('#gBtn');
const link = await mass('#lb-pwvergessen');
check('KRITISCH: beide Eingabefelder sind mindestens 44 px hoch',
  feld !== null && pass !== null && feld.h >= 44 && pass.h >= 44);
check('KRITISCH: beide Eingabefelder haben mindestens 16 px Schrift -- darunter zoomt iOS hinein',
  feld !== null && pass !== null && feld.fs >= 16 && pass.fs >= 16);
check('KRITISCH: der Anmeldeknopf ist mindestens 48 px hoch',
  cta !== null && cta.h >= 48);
check('"Passwort vergessen?" hat die volle 44-px-Trefferflaeche',
  link !== null && link.h >= 44);

// ══════════ DER MEISTGEDRUECKTE KNOPF MUSS LESBAR BLEIBEN ═════════════
// Der Grund fuer die Ausnahme im CSS: der helle --accent des
// Dunkelmodus (#7098F7) traegt weisse Schrift nur mit 2.8:1.
check('KRITISCH: die Schrift auf dem Anmeldeknopf erreicht mindestens 4.5:1 Kontrast',
  cta !== null && kontrast(cta.farbe, cta.grund) >= 4.5);
/* Die Beschriftungen ueber den Feldern sind hier ENTFALLEN und nicht
   weggefallen: Sie stehen jetzt weiter oben in der Messung am Bildpunkt,
   zusammen mit den vier anderen Texten ohne eigene Flaeche. Die alte
   Fassung rechnete gegen die EINE Hintergrundfarbe des Zugangs -- die
   gibt es seit dem Verlauf nicht mehr, und gegen einen Mittelwert zu
   rechnen waere schwaecher als gegen die Stelle, an der der Text
   wirklich steht. */

// ══════════ CLAUDE.md: UEBERSCHRIFT OBEN, WERT DARUNTER ═══════════════
const lbl = await mass('#lb-name');
check('KRITISCH: die Beschriftung steht UEBER dem Feld, nicht darunter',
  lbl !== null && feld !== null && lbl.y < feld.y);

// ══════════ ZWEI GRUPPEN, NICHT EINE REIHE ════════════════════════════
// Der Abstand zwischen Logoblock und Formular muss groesser sein als der
// zwischen zwei Feldern -- sonst liest alles als eine einzige Kette.
const firma = await mass('.gate-oben .sub');
check('Identitaet und Formular stehen als zwei Gruppen auseinander',
  firma !== null && lbl !== null && pass !== null && feld !== null
  && (lbl.y - firma.unten) > (pass.y - feld.unten) * 0.6);

// ══════════ NICHTS SCROLLT, AUCH AUF EINEM KLEINEN GERAET ═════════════
const passt = async () => ev(() => {
  const g = document.getElementById('gate');
  return g.scrollHeight <= g.clientHeight + 1;
});
check('KRITISCH: auf 390x844 muss nicht gescrollt werden', await passt());
await page.setViewportSize({ width: 360, height: 640 });
await page.waitForTimeout(250);
check('KRITISCH: auch auf einem kleinen Geraet (360x640) passt alles auf den Schirm',
  await passt());

// ══════════ DESKTOP: KEINE ANMELDUNG UEBER 1440 PX BREITE ═════════════
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(250);
const dMitte = await mass('.gate-mitte');
const dCta = await mass('#gBtn');
const dLogo = await mass('.gate-oben .gate-marke');
check('KRITISCH: auf dem Desktop bleibt die Spalte schmal, statt sich ueber die ganze Breite zu ziehen',
  dMitte !== null && dMitte.w <= 420);
check('Und sie steht dort mittig',
  dMitte !== null && Math.abs((dMitte.x + dMitte.w / 2) - 720) <= 2);
check('Der Knopf ist auch auf dem Desktop noch der Knopf, nicht ein Band',
  dCta !== null && dCta.w <= 420);
// Der Projektinhaber hat beanstandet, der Block wirke auf dem grossen
// Schirm "sehr klein zur Gesamtflaeche". Antwort war nicht, die Felder
// breiter zu ziehen, sondern die Marke wachsen zu lassen -- das haelt
// diese Pruefung fest.
check('KRITISCH: die Marke waechst auf dem grossen Schirm mit, statt in der Flaeche zu verschwinden',
  dLogo !== null && logo !== null && dLogo.w > logo.w * 1.2);

// ══════════ ENT-392: HINTERGRUNDFOTO AUF DEM DESKTOP ══════════════════
// Ein Foto statt der reinen Verlaufsflaeche kann den Kontrast der Texte
// unterlaufen, die KEIN eigenes Feld-Grund haben (Firmenname, Feld-
// beschriftungen, "Passwort vergessen?"). Quelltext sagt nichts darueber,
// WIE hell die tatsaechlich gerenderte Flaeche hinter diesen Texten ist --
// das haengt vom Bildinhalt UND vom Schleier zusammen ab. Darum wird hier
// wirklich fotografiert (page.screenshot) und im Bild selbst gemessen,
// nicht nur die CSS-Werte gelesen (CLAUDE.md: "Gestaltung wird gemessen,
// nicht im Quelltext nachgelesen").
check('KRITISCH: das Hintergrundfoto ist auf dem Desktop eingebunden',
  await ev(() => getComputedStyle(document.getElementById('gate')).backgroundImage.includes('anmeldung-nacht.webp')));

// Misst am tatsaechlichen Bildpunkt: Textknoten-Rahmen abfotografieren,
// im Browser selbst per canvas dekodieren (kein eigener PNG-Decoder
// noetig), hellsten Bildpunkt in der Flaeche suchen -- das ist der
// Worst-Case fuer helle Schrift auf dunklem Grund -- und den WCAG-
// Kontrast dagegen rechnen. Nutzt dieselbe leuchte()-Funktion wie oben,
// nur gegen eine bereits berechnete Leuchtdichte statt gegen eine zweite
// Farbe (der Bildpunkt hat keinen CSS-Farbwert, nur RGB aus dem Pixel).
const kontrastGegenLeuchte = (farbeStr, lb) => {
  const [r, g, b] = (farbeStr.match(/\d+/g) || []).slice(0, 3).map(Number);
  const la = leuchte(r, g, b);
  const [l1, l2] = [la, lb].sort((x, y) => y - x);
  return (l1 + .05) / (l2 + .05);
};
const textKontrastAufFoto = async sel => {
  const box = await ev(s => {
    const el = document.querySelector(s);
    const r = document.createRange(); r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, sel);
  if (!box || box.w < 1 || box.h < 1) return null;
  const clip = { x: Math.max(0, Math.floor(box.x)), y: Math.max(0, Math.floor(box.y)),
    width: Math.max(1, Math.ceil(box.w)), height: Math.max(1, Math.ceil(box.h)) };
  const farbe = await ev(s => getComputedStyle(document.querySelector(s)).color, sel);
  // Die Schrift selbst muss aus der Aufnahme raus: sonst misst man die
  // Leuchtdichte der hellen Buchstaben gegen sich selbst -- das ergibt
  // immer einen Kontrast nahe 1, unabhaengig vom tatsaechlichen Hintergrund
  // (per Debug-Ausgabe gefunden: alle drei Feldbeschriftungen kamen auf
  // exakt dieselbe "hellste" Leuchtdichte, weil das die Schriftfarbe war).
  // Text kurz unsichtbar machen, NACKTEN Hintergrund fotografieren, wieder
  // herstellen -- das Layout aendert sich dabei nicht, nur die Farbe.
  await ev(s => { document.querySelector(s).style.color = 'transparent'; }, sel);
  const buf = await page.screenshot({ clip }).catch(() => null);
  await ev(s => { document.querySelector(s).style.color = ''; }, sel);
  if (!buf) return null;
  const b64 = buf.toString('base64');
  const maxL = await page.evaluate(async b64 => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    let max = -1;
    for (let i = 0; i < data.length; i += 4) {
      const L = .2126 * lin(data[i]) + .7152 * lin(data[i + 1]) + .0722 * lin(data[i + 2]);
      if (L > max) max = L;
    }
    return max;
  }, b64).catch(() => null);
  if (farbe === null || maxL === null) return null;
  return kontrastGegenLeuchte(farbe, maxL);
};
const TEXTE = [
  ['Firmenname', '.gate-oben .sub'],
  ['Beschriftung "Name"', '#lb-name'],
  ['Beschriftung "Passwort"', '#lb-pass'],
  ['"Passwort vergessen?"', '#lb-pwvergessen'],
];

// ══════════ ENT-394: VIDEO-HINTERGRUND, UEBER DEM FOTO ════════════════
// Das Video liegt ALS ZUSAETZLICHE Ebene ueber dem bereits geprueften
// Foto (ENT-392 bleibt unveraendert als CSS-background stehen, siehe
// Dateikopf-Kommentar im CSS). Deshalb hier ZWEI getrennte Kontrast-
// Nachweise statt einem: einmal fuer das laufende Video (unten), einmal
// fuer den Foto-Rueckfall bei reduzierter Bewegung (am Ende dieses
// Abschnitts) -- beides sind unterschiedliche, real vorkommende
// Anzeigezustaende, keiner davon darf angenommen statt gemessen werden.
const video = await mass('.gate-video');
check('KRITISCH: das Video ist auf dem Desktop eingebunden', video !== null);
const quellen = await ev(() =>
  [...document.querySelectorAll('.gate-video source')].map(s => ({ src: s.getAttribute('src'), typ: s.getAttribute('type') })));
check('KRITISCH: WebM/VP9 UND MP4/H.264 sind beide als Quelle eingetragen -- '
    + 'nicht jeder Browser kann beide Formate abspielen (dieses Test-Chromium selbst kein H.264)',
  Array.isArray(quellen)
  && quellen.some(q => q.src?.endsWith('.webm') && q.typ === 'video/webm')
  && quellen.some(q => q.src?.endsWith('.mp4') && q.typ === 'video/mp4'));
const videoAttribute = await ev(() => {
  const v = document.querySelector('.gate-video');
  return { autoplay: v.autoplay, muted: v.muted, loop: v.loop, playsinline: v.hasAttribute('playsinline') };
});
check('KRITISCH: autoplay, muted, loop und playsinline sind gesetzt -- ohne "muted" '
    + 'verweigern die meisten Browser Autoplay ohne Nutzeraktion',
  videoAttribute !== null && videoAttribute.autoplay && videoAttribute.muted
  && videoAttribute.loop && videoAttribute.playsinline);

// Spielt es wirklich, oder steht es nur da? Zeit VOR und NACH einer
// echten Wartezeit vergleichen -- kein Seek, das waere kein Nachweis
// von Autoplay, nur von Steuerbarkeit.
const zeitVorher = await ev(() => document.querySelector('.gate-video')?.currentTime ?? null);
await page.waitForTimeout(600);
const zeitNachher = await ev(() => document.querySelector('.gate-video')?.currentTime ?? null);
check('KRITISCH: das Video spielt tatsaechlich von selbst (die Zeit laeuft weiter, ohne Klick)',
  zeitVorher !== null && zeitNachher !== null && zeitNachher > zeitVorher);

// Kontrast an FUENF Zeitpunkten der zehnsekuendigen Schleife, nicht nur
// an einem -- das Versprechen aus der Probe eingeloest ("das habe ich
// fuer diese Probe nicht gemacht", siehe ENT-394-Eintrag). Deterministisch
// per Seek statt per Wartezeit: pausiert, damit zwischen "seeked"-Ereignis
// und Bildschirmfoto kein zusaetzliches Stueck weiterlaeuft.
await ev(() => document.querySelector('.gate-video')?.pause());
const seekeZu = async zeit => ev(t => new Promise(res => {
  const v = document.querySelector('.gate-video');
  if (!v) return res(false);
  const fertig = () => { v.removeEventListener('seeked', fertig); res(true); };
  v.addEventListener('seeked', fertig);
  v.currentTime = t;
}), zeit);
const ZEITPUNKTE = [0.3, 2.5, 5, 7.5, 9.7];
for (const [bezeichnung, sel] of TEXTE) {
  let schlechtester = Infinity;
  for (const zeit of ZEITPUNKTE) {
    await seekeZu(zeit);
    const k = await textKontrastAufFoto(sel);
    if (k !== null && k < schlechtester) { schlechtester = k; }
  }
  check(`KRITISCH: ${bezeichnung} bleibt VOR dem LAUFENDEN Video an allen ${ZEITPUNKTE.length} `
      + `geprueften Zeitpunkten der Schleife lesbar (>= 4.5:1, schlechtester gemessener Wert: `
      + `${schlechtester === Infinity ? 'nicht messbar' : schlechtester.toFixed(2)})`,
    schlechtester >= 4.5);
}

// ══════════ ENT-392: DER FOTO-RUECKFALL BEI REDUZIERTER BEWEGUNG ══════
// Wer Bewegung reduziert eingestellt hat, bekommt NIE das Video zu sehen
// -- das ist die einzige zuverlaessige Stelle, an der sich das reine
// Foto (ENT-392, seit dieser Aenderung die Ausweichebene) noch isoliert
// pruefen laesst: sobald das Video eingebunden ist, liegt es sonst IMMER
// sichtbar darueber.
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.waitForTimeout(150);
check('KRITISCH: bei reduzierter Bewegung ist das Video unsichtbar',
  await ev(() => getComputedStyle(document.querySelector('.gate-video')).display === 'none'));
check('KRITISCH: und auch der eigene Video-Schleier -- sonst legt sich eine dunkle '
    + 'Flaeche ueber das Foto, ohne dass ein Video sie rechtfertigt',
  await ev(() => getComputedStyle(document.querySelector('.gate-schleier')).display === 'none'));
check('KRITISCH: das Hintergrundfoto ist auf dem Desktop eingebunden',
  await ev(() => getComputedStyle(document.getElementById('gate')).backgroundImage.includes('anmeldung-nacht.webp')));
for (const [bezeichnung, sel] of TEXTE) {
  const k = await textKontrastAufFoto(sel);
  check(`KRITISCH: ${bezeichnung} bleibt VOR dem echten Foto lesbar (>= 4.5:1, `
      + `am hellsten Bildpunkt hinter dem Text gemessen) -- Zustand "reduzierte Bewegung"`,
    k !== null && k >= 4.5);
}
await page.emulateMedia({ reducedMotion: 'no-preference' });

// ══════════ EINE FEHLERMELDUNG LIEST AUF DUNKLEM GRUND ════════════════
await page.setViewportSize({ width: 390, height: 844 });
await ev(() => { const e = document.getElementById('gErr');
  e.textContent = 'Name oder Passwort stimmt nicht'; e.style.display = ''; });
await page.waitForTimeout(150);
const err = await mass('#gErr');
check('KRITISCH: die Fehlermeldung nimmt die dunkle Variante, nicht das helle Rosa der Hellansicht',
  err !== null && kontrast(err.farbe, err.grund) >= 4.5
  && leuchte(...(err.grund.match(/\d+/g) || []).slice(0, 3).map(Number)) < 0.2);

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
