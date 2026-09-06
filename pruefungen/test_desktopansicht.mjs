// Desktop-Ansicht am Handy als Notfalloption (ENT-427).
//
// Am Handy sind Abgleich, Stammdaten, Revierdienst, Auswertung,
// Administration und Einrichtung bewusst ausgeblendet (ENT-235). Der
// Notfallweg dorthin stellt die Viewport-Angabe auf eine feste Breite --
// dieselbe Mechanik wie "Desktop-Website anfordern" im Browser.
//
// Gemessen wird der gerenderte Zustand, nicht der Quelltext: ob die Seite
// nach dem Umschalten TATSAECHLICH 1280 px breit liegt, ob die
// ausgeblendeten Bereiche dann DA sind, und wie gross der Rueckweg-Knopf auf
// dem Geraet ANKOMMT. Ein "steht so im CSS" sagt hier nichts -- der ganze
// Umbau haengt daran, dass eine Meta-Angabe zur Laufzeit greift.
//
// Chromium braucht dafuer "isMobile: true". Ohne das ignoriert der Browser
// die Viewport-Angabe komplett (wie jeder Schreibtisch-Browser), und die
// Suite waere gruen, ohne irgendetwas zu beweisen.
//
// NICHT geprueft, weil hier nicht pruefbar: der Abstand zum unteren Rand
// unter der iOS-Adressleiste (env(safe-area-inset-bottom) ist im Testbrowser
// immer 0) und ob das Zoomen mit zwei Fingern auf einem echten Geraet
// angenehm ist. Beides gehoert am Geraet angesehen.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const GERAET = 390;          // Breite des gespielten Handys
const SOLL_BREITE = 1280;    // was die Notfallansicht setzen soll

const LUM = c => {
  const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const rgb = s => (String(s).match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
const kontrast = (a, b) => {
  const l1 = LUM(rgb(a)), l2 = LUM(rgb(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

async function starte({ breite = GERAET, hoehe = 844, handy = true, speicher = null, anmelden = true } = {}) {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({
    viewport: { width: breite, height: hoehe },
    deviceScaleFactor: handy ? 3 : 1,
    isMobile: handy, hasTouch: handy,
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', route => {
    const p = route.request().url().split('/api/')[1].split('?')[0];
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'hansmuster', ist_admin: true });
    if (p.includes('dashboard_stats')) return send({ status: 'ok',
      kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0,
             mitarbeiter: 0, kunden: 0, rapporte_total: 0 },
      verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    return send({ status: 'ok' });
  });
  // Ein gemerkter Wert muss VOR dem ersten Laden im Speicher liegen -- der
  // Kopf der Datei liest ihn, bevor irgendetwas gezeichnet wird.
  if (speicher) {
    await page.addInitScript(v => {
      try { localStorage.setItem('rv3_desktop', v); } catch (e) {}
    }, speicher);
  }
  await page.goto(`file://${WURZEL}/dashboard.html`);
  if (anmelden) {
    await page.fill('#gName', 'hansmuster');
    await page.fill('#gPass', 'x');
    await page.click('#gBtn');
    await page.waitForSelector('#shell.on');
    await page.waitForTimeout(400);
  }
  return { browser, page };
}

// Antippen, ohne die Suite an einem Zeitablauf sterben zu lassen. Ist der
// Knopf nicht da, ist das ein Befund mit Namen -- und die uebrigen Zeilen
// werden trotzdem noch gemessen und berichtet. Ohne das endete die Suite bei
// einem kaputten Umschalter in einem "Timeout 30000ms exceeded", das nicht
// sagt, WAS kaputt ist.
async function tippe(page, wahl, wozu) {
  try { await page.click(wahl, { timeout: 5000 }); await page.waitForTimeout(500); return true; }
  catch { check(`Antippbar: ${wahl} — ${wozu}`, false); return false; }
}

// Der gerenderte Zustand in einem Griff. "schrumpf" ist der Faktor, mit dem
// die Seite auf dem Geraet ankommt: 390/1280 = 0.30.
const lage = page => page.evaluate(() => {
  const el = document.getElementById('desktopZurueck');
  const r = el ? el.getBoundingClientRect() : null;
  const geraet = Math.min(...[window.screen && window.screen.width, window.outerWidth].filter(w => w > 0));
  const schrumpf = geraet / document.documentElement.clientWidth;
  const sichtbar = id => {
    const e = document.getElementById(id);
    return !!e && !!e.offsetParent;
  };
  return {
    breite: document.documentElement.clientWidth,
    schmal: window.matchMedia('(max-width: 900px)').matches,
    kennung: document.documentElement.getAttribute('data-desktop'),
    meta: document.getElementById('metaViewport').getAttribute('content'),
    gemerkt: (() => { try { return localStorage.getItem('rv3_desktop'); } catch (e) { return 'unlesbar'; } })(),
    // Vier Stellvertreter fuer die am Handy ausgeblendeten Bereiche (ENT-235)
    admin: sichtbar('nav-admin'),
    einrichtung: sichtbar('nav-einrichtung'),
    abgleich: sichtbar('nav-abgleich'),
    auswertung: sichtbar('nav-kontrolle'),
    eintrag: sichtbar('nav-desktop'),
    eintragText: (document.getElementById('navDesktopLbl') || {}).textContent || '',
    eintragHoehe: (() => {
      const e = document.getElementById('nav-desktop');
      return e && e.offsetParent ? Math.round(e.getBoundingClientRect().height) : 0;
    })(),
    zurueckSichtbar: !!el && !!r && r.width > 0 && getComputedStyle(el).display !== 'none',
    // Auf dem Geraet ankommende Groesse, nicht die im Layout gesetzte
    zurueckHoehe: r ? +(r.height * schrumpf).toFixed(1) : 0,
    zurueckBreite: r ? +(r.width * schrumpf).toFixed(1) : 0,
    zurueckImBild: !!r && r.left >= 0 && r.right <= document.documentElement.clientWidth + 1
                   && r.top >= 0 && r.bottom <= document.documentElement.clientHeight + 1,
    schublade: !!document.getElementById('side') && document.getElementById('side').classList.contains('on'),
    querlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

// ══════════════ 1. AM HANDY: HIN UND ZURUECK
let { browser, page } = await starte();

let l = await lage(page);
check(`Handy-Ansicht beim Start (${l.breite} px)`, l.breite === GERAET && l.schmal);
check('Die ausgeblendeten Bereiche sind ausgeblendet (ENT-235 gilt unveraendert)',
  !l.admin && !l.einrichtung && !l.abgleich && !l.auswertung);
check('Der Rueckweg-Knopf steht nicht herum, solange es nichts zurueckzugehen gibt',
  !l.zurueckSichtbar);

await page.click('#btnBurger'); await page.waitForTimeout(350);
l = await lage(page);
check('KRITISCH: der Eintrag steht im Menue', l.eintrag);
check(`Und heisst "Desktop-Ansicht" (gefunden: "${l.eintragText}")`, l.eintragText === 'Desktop-Ansicht');
check(`CLAUDE.md: Trefferflaeche mindestens 44 px (${l.eintragHoehe} px)`, l.eintragHoehe >= 44);
await page.screenshot({ path: OUT + '/desktopansicht-01-menue.png' });

await tippe(page, '#nav-desktop', 'der Umschalter im Menue');
l = await lage(page);
check(`KRITISCH: die Seite liegt jetzt ${SOLL_BREITE} px breit (gemessen: ${l.breite} px)`,
  l.breite === SOLL_BREITE);
check('KRITISCH: die Handy-Regeln greifen nicht mehr', !l.schmal);
// Der eigentliche Zweck der ganzen Uebung. Ohne diese Zeile prueft die Suite
// nur, dass sich eine Zahl geaendert hat.
check('KRITISCH: Administration, Einrichtung, Abgleich und Auswertung sind erreichbar',
  l.admin && l.einrichtung && l.abgleich && l.auswertung);
check('Die Schublade ist dabei zugegangen -- sie waere sonst eine haengende Seitenleiste',
  !l.schublade);
check(`Zoomen ist wieder erlaubt (Angabe: "${l.meta}")`,
  !/user-scalable\s*=\s*no/.test(l.meta) && !/maximum-scale/.test(l.meta));
check('Der Zustand steht am Dokument', l.kennung === 'an');
check(`Und ist gemerkt (${l.gemerkt})`, l.gemerkt === 'an');
await page.screenshot({ path: OUT + '/desktopansicht-02-desktop.png' });

// ── Der Rueckweg muss auf dem GERAET treffbar sein, nicht im Layout
check('KRITISCH: der Rueckweg-Knopf ist da', l.zurueckSichtbar);
check(`KRITISCH: und kommt mit mindestens 44 px an (${l.zurueckHoehe} × ${l.zurueckBreite} px physisch)`,
  l.zurueckHoehe >= 44 && l.zurueckBreite >= 44);
check('Er liegt vollstaendig im Bild', l.zurueckImBild);
check(`Der Menueeintrag heisst jetzt "Handy-Ansicht" (gefunden: "${l.eintragText}")`,
  l.eintragText === 'Handy-Ansicht');

// ── Gegenprobe zur Lupe: ohne sie waere der Knopf zu klein.
// Ohne diese Probe waere die 44-px-Zeile oben eine Behauptung -- sie koennte
// auch dann gruen sein, wenn die Hochrechnung gar nichts tut.
const ohneLupe = await page.evaluate(() => {
  const wurz = document.documentElement, el = document.getElementById('desktopZurueck');
  const vorher = wurz.style.getPropertyValue('--desktop-lupe');
  wurz.style.setProperty('--desktop-lupe', '1');
  const r = el.getBoundingClientRect();
  const geraet = Math.min(...[window.screen.width, window.outerWidth].filter(w => w > 0));
  const h = r.height * (geraet / wurz.clientWidth);
  wurz.style.setProperty('--desktop-lupe', vorher);
  return +h.toFixed(1);
});
check(`Gegenprobe: ohne die Hochrechnung waere er nur ${ohneLupe} px hoch -- die Pruefung oben greift`,
  ohneLupe < 44);

// ── Auch im Dunkeln lesbar
// Der Knopf ist eine neue Flaeche und traegt darum die Farbmarken statt
// eigener Werte. Gemessen statt nachgelesen: Ein fest eingetragener heller
// Grund faellt im Hellmodus nicht auf und wird erst im Dunkeln zum Fleck.
for (const thema of ['dunkel', 'hell']) {
  await page.evaluate(t => themaSetzen(t), thema);
  await page.waitForTimeout(200);
  const f = await page.evaluate(() => {
    const c = getComputedStyle(document.getElementById('desktopZurueck'));
    return { vorn: c.color, grund: c.backgroundColor, rand: c.borderTopColor };
  });
  const kText = kontrast(f.vorn, f.grund);
  check(`Beschriftung im ${thema}en Modus lesbar (${kText.toFixed(1)}:1)`, kText >= 4.5);
  check(`Der Grund ist gesetzt und nicht durchsichtig (${thema}: ${f.grund})`,
    !/transparent|rgba\([^)]*,\s*0\)/.test(f.grund));
  // Im Durchlauf und nicht danach: Nach der Schleife steht wieder "hell" da,
  // und das Bild zeigte dann den falschen Zustand.
  await page.screenshot({ path: OUT + `/desktopansicht-06-${thema}.png` });
}

// ── Ueberlebt das Neuladen (die Wahl bleibt, bis man zurueckschaltet)
await page.reload();
await page.waitForTimeout(400);
l = await lage(page);
check(`KRITISCH: nach dem Neuladen steht die Desktop-Ansicht noch (${l.breite} px)`,
  l.breite === SOLL_BREITE && l.kennung === 'an');
check('Der Rueckweg ist auch ohne Anmeldung da -- sonst sitzt man auf der Anmeldemaske fest',
  l.zurueckSichtbar && l.zurueckHoehe >= 44);
await page.screenshot({ path: OUT + '/desktopansicht-03-nach-neuladen.png' });

// ── Und wieder zurueck, ueber den Knopf am Bildschirmrand
await tippe(page, '#desktopZurueck', 'der Rueckweg am Bildschirmrand');
l = await lage(page);
check(`KRITISCH: zurueck in der Handy-Ansicht (${l.breite} px)`, l.breite === GERAET && l.schmal);
check('Die ausgeblendeten Bereiche sind wieder weg', !l.admin && !l.einrichtung);
check('Der Rueckweg-Knopf verschwindet mit', !l.zurueckSichtbar);
check(`Die Ruecknahme ist ebenfalls gemerkt (${l.gemerkt})`, l.gemerkt === 'aus');
check(`Kein Querlauf danach (${l.querlauf} px)`, l.querlauf <= 1);
await browser.close();

// ══════════════ 2. GEGENPROBE: iOS meldet outerWidth wie innerWidth
// Auf manchen iOS-Fassungen ist window.outerWidth dasselbe wie innerWidth --
// nach dem Umschalten also 1280. Wer die Geraetebreite daraus ableitet,
// verliert genau dann den Rueckweg, wenn er gebraucht wird. Hier wird der
// Fall nachgestellt.
({ browser, page } = await starte());
await page.evaluate(() => {
  Object.defineProperty(window, 'outerWidth', { configurable: true, get: () => window.innerWidth });
});
await tippe(page, '#btnBurger', 'das Menue');
await tippe(page, '#nav-desktop', 'der Umschalter im Menue');
const ios = await page.evaluate(() => {
  const el = document.getElementById('desktopZurueck');
  const r = el.getBoundingClientRect();
  return {
    outer: window.outerWidth,
    breite: document.documentElement.clientWidth,
    hoehe: +(r.height * (390 / document.documentElement.clientWidth)).toFixed(1),
    eintrag: !!document.getElementById('nav-desktop').offsetParent,
  };
});
check(`Der Fall ist wirklich nachgestellt (outerWidth meldet ${ios.outer})`, ios.outer === SOLL_BREITE);
check('KRITISCH: der Rueckweg-Knopf bleibt trotzdem gross genug ('
  + ios.hoehe + ' px physisch)', ios.hoehe >= 44);
check('Und der Menueeintrag bleibt sichtbar', ios.eintrag);
await browser.close();

// ══════════════ 3. AM SCHREIBTISCH: nichts davon taucht auf
// CLAUDE.md: jede Aenderung am Handy-Layout zusaetzlich am Desktop pruefen.
({ browser, page } = await starte({ breite: 1440, hoehe: 900, handy: false }));
l = await lage(page);
check('Am Desktop steht der Eintrag nicht im Fussteil -- dort bewirkt die Angabe nichts',
  !l.eintrag);
check('Und kein Knopf klebt in der Ecke', !l.zurueckSichtbar);
check('Die Seitenleiste ist im Uebrigen unveraendert', l.admin && l.einrichtung && l.abgleich);
await page.screenshot({ path: OUT + '/desktopansicht-04-desktop-unveraendert.png' });
await browser.close();

// ══════════════ 4. GEMERKTE WAHL AUF EINEM GERAET, DAS SIE NICHT UMSETZT
// Ein Schreibtisch-Browser ignoriert die Viewport-Angabe. Bliebe die
// Kennzeichnung stehen, klebte dort dauerhaft ein Knopf ohne Bedeutung.
({ browser, page } = await starte({ breite: 1440, hoehe: 900, handy: false, speicher: 'an' }));
l = await lage(page);
check('Eine gemerkte Wahl wird am Schreibtisch still zurueckgenommen',
  l.kennung !== 'an' && !l.zurueckSichtbar);
check(`Und auch aus dem Speicher genommen (${l.gemerkt})`, l.gemerkt !== 'an');
await browser.close();

// ══════════════ 5. GEMERKTE WAHL AM HANDY, OHNE ANMELDUNG
// Der Kopf der Datei setzt die Angabe vor dem ersten Zeichnen. Ohne das
// spraenge das Raster nach dem Laden sichtbar um.
({ browser, page } = await starte({ speicher: 'an', anmelden: false }));
l = await lage(page);
check(`KRITISCH: schon die Anmeldemaske liegt in der Desktop-Breite (${l.breite} px)`,
  l.breite === SOLL_BREITE);
check('Mit Rueckweg, gross genug zum Treffen',
  l.zurueckSichtbar && l.zurueckHoehe >= 44);
await page.screenshot({ path: OUT + '/desktopansicht-05-anmeldung.png' });
await tippe(page, '#desktopZurueck', 'der Rueckweg auf der Anmeldemaske');
l = await lage(page);
check('Er fuehrt auch von dort zurueck', l.breite === GERAET && !l.zurueckSichtbar);
await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
