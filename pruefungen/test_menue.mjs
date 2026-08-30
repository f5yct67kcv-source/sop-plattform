// Das mobile Aufklappmenue (ENT-067).
//
// Vier Beschwerden des Projektinhabers, vier Messungen. Wichtig: hier wird
// GEMESSEN, nicht im Quelltext nachgelesen. Ob eine Schrift gross genug ist
// und ob der Hintergrund stillsteht, sagt nur der gerenderte Zustand.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';


const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });

async function seite(w, h, thema) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.setDefaultTimeout(5000);
  // Die Wahl muss VOR dem ersten Zeichnen stehen, sonst blitzt die andere
  // Fassung auf (siehe der Vorab-Block in dashboard.html).
  if (thema) { await p.addInitScript(t => localStorage.setItem('rv3_thema', t), thema); }
  await p.route('**/api/**', r => {
    const pf = r.request().url().split('/api/')[1].split('?')[0];
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (pf.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (pf.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
    if (pf.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
    if (pf.includes('objekt_list')) return send({ status: 'ok', objekte: [] });
    if (pf.includes('anstellungsorte')) return send({ status: 'ok', orte: [] });
    if (pf.includes('feiertag')) return send({ status: 'ok', kanton: 'SO', feiertage: [], gepflegt: {} });
    return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [],
      letzte_rapporte: [], rapporte: [], objekte: [], masterschichten: [], einsaetze: [] });
  });
  await p.goto(URL);
  await p.fill('#gName', 'adrian'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(600);
  return p;
}

// ══════════════════════════════════════════ HANDY
const m = await seite(390, 844);
const jsFehler = [];
m.on('pageerror', e => jsFehler.push(e.message));

check('Der Burger ist auf dem Handy da', await m.isVisible('#btnBurger'));
check('Das Menue ist zunaechst zu', !(await m.isVisible('#side.on')));

await m.click('#btnBurger');
await m.waitForTimeout(400);
check('Der Burger oeffnet das Menue', await m.isVisible('#side.on'));

// ── 1) Vollbild
const mass = await m.evaluate(() => {
  const s = document.getElementById('side');
  const r = s.getBoundingClientRect();
  return { top: r.top, unten: r.bottom, hoehe: r.height, breite: r.width,
           fensterH: window.innerHeight, fensterB: window.innerWidth };
});
check('KRITISCH: das Menue reicht bis zum unteren Bildschirmrand',
  Math.abs(mass.unten - mass.fensterH) <= 2);
check('Es nutzt die volle Breite', Math.abs(mass.breite - mass.fensterB) <= 1);
check('Es beginnt unter der Kopfzeile, verdeckt sie also nicht', mass.top > 40 && mass.top < 90);
check('KRITISCH: es fuellt die Flaeche unter der Kopfzeile ganz aus',
  mass.hoehe >= mass.fensterH - mass.top - 2);

// ── 2) Hintergrund steht still
await m.evaluate(() => { document.getElementById('side').classList.remove('on'); document.documentElement.classList.remove('menue-offen'); });
await m.evaluate(() => window.scrollTo(0, 0));
const scrollbarUeberhaupt = await m.evaluate(() =>
  document.documentElement.scrollHeight > window.innerHeight + 20);
check('Vorbedingung: die Seite ist ueberhaupt scrollbar', scrollbarUeberhaupt);

await m.click('#btnBurger');
await m.waitForTimeout(300);
const gesperrt = await m.evaluate(() => {
  const vorher = window.scrollY;
  window.scrollBy(0, 400);
  const nachher = window.scrollY;
  return { vorher, nachher,
    htmlOv: getComputedStyle(document.documentElement).overflow,
    bodyOv: getComputedStyle(document.body).overflow };
});
check('KRITISCH: der Hintergrund scrollt bei offenem Menue nicht mehr',
  gesperrt.vorher === gesperrt.nachher);
check('Die Sperre sitzt auf html und body', gesperrt.htmlOv === 'hidden' && gesperrt.bodyOv === 'hidden');

// ── Sperre wird wieder geloest -- und zwar auf JEDEM Weg
await m.click('#btnBurger');
await m.waitForTimeout(300);
check('KRITISCH: nach dem Schliessen scrollt der Hintergrund wieder',
  await m.evaluate(() => {
    const v = window.scrollY; window.scrollBy(0, 200); const n = window.scrollY;
    window.scrollTo(0, v); return n !== v;
  }));

// Der gefaehrlichste Weg: schliessen durch Navigieren. Genau hier entfernte
// go() frueher die Klasse von Hand und haette die Sperre haengen lassen.
await m.click('#btnBurger');
await m.waitForTimeout(250);
await m.click('#nav-planung');
await m.waitForTimeout(400);
check('Navigieren schliesst das Menue', !(await m.isVisible('#side.on')));
check('KRITISCH: nach dem Navigieren ist die Sperre wieder weg',
  await m.evaluate(() => !document.documentElement.classList.contains('menue-offen')
    && getComputedStyle(document.body).overflow !== 'hidden'));

// Danebentippen. Achtung: Seit dem Vollbild gibt es unterhalb der Kopfzeile
// kein "daneben" mehr -- die einzige freie Flaeche ist die Kopfzeile selbst.
// Ein Klick weiter unten traefe einen Menuepunkt, im Fussbereich sogar
// "Abmelden". Genau darauf ist dieser Test hereingefallen, bevor er auf die
// Kopfzeile umgestellt wurde.
await m.click('#btnBurger');
await m.waitForTimeout(250);
const kopfMitte = await m.evaluate(() => {
  const t = document.querySelector('.topbar').getBoundingClientRect();
  return { x: Math.round(t.left + t.width * 0.42), y: Math.round(t.top + t.height / 2) };
});
await m.mouse.click(kopfMitte.x, kopfMitte.y);
await m.waitForTimeout(350);
check('Ein Tipp auf die Kopfzeile schliesst das Menue', !(await m.isVisible('#side.on')));
check('KRITISCH: auch danach ist die Sperre weg',
  await m.evaluate(() => !document.documentElement.classList.contains('menue-offen')));
// Deckt das Menue die Flaeche darunter wirklich ab? Bewusst mit echtem
// Oeffnen und Warten geprueft: Die Ein-/Ausblendung laeuft ueber visibility
// mit Uebergang, ein sofortiges Ablesen direkt nach dem Klick liest den
// Zustand von vorher.
await m.click('#btnBurger');
await m.waitForTimeout(350);
check('KRITISCH: unter der Kopfzeile deckt das Menue alles ab -- ein Tipp dort'
      + ' trifft nie den Hintergrund',
  await m.evaluate(() => {
    const s = document.getElementById('side');
    const r = s.getBoundingClientRect();
    return s.contains(document.elementFromPoint(window.innerWidth / 2, r.top + r.height * 0.6));
  }));
await m.click('#btnBurger');
await m.waitForTimeout(350);
check('Vorbedingung fuer den naechsten Abschnitt: das Menue ist zu',
  !(await m.isVisible('#side.on')));

// Die Scrollposition darf durch das Oeffnen nicht verloren gehen -- der Grund,
// warum die Sperre mit overflow und nicht mit position:fixed gebaut ist.
// Zurueck auf die Uebersicht: Die Planungsansicht von vorhin ist kuerzer als
// der Bildschirm, dort laesst sich gar nicht scrollen -- der Test haette
// stillschweigend nichts geprueft.
await m.evaluate(() => go('uebersicht'));
await m.waitForTimeout(500);
check('Vorbedingung: die Uebersicht ist lang genug zum Scrollen',
  await m.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 320));
await m.evaluate(() => window.scrollTo(0, 300));
const vorOeffnen = await m.evaluate(() => window.scrollY);
await m.click('#btnBurger'); await m.waitForTimeout(250);
await m.click('#btnBurger'); await m.waitForTimeout(300);
check('KRITISCH: die Scrollposition ueberlebt das Oeffnen und Schliessen',
  vorOeffnen > 0 && Math.abs((await m.evaluate(() => window.scrollY)) - vorOeffnen) <= 2);

// ── 3) Schriftgroessen
await m.click('#btnBurger');
await m.waitForTimeout(300);
const schrift = await m.evaluate(() => {
  const px = el => el ? parseFloat(getComputedStyle(el).fontSize) : 0;
  return {
    punkt: px(document.querySelector('#side .side-nav .nav-item')),
    gruppe: px(document.querySelector('#side .side-nav .nav-lbl')),
    fuss: px(document.querySelector('#side .side-foot .nav-item')),
    hoehe: document.querySelector('#side .side-nav .nav-item').getBoundingClientRect().height,
  };
});
check('KRITISCH: die Menuepunkte sind mindestens 16 px gross', schrift.punkt >= 16);
check('Sie sind groesser als am Desktop (13.5 px)', schrift.punkt > 13.5);
check('Die Gruppentitel sind mitgewachsen', schrift.gruppe >= 11);
check('Auch der Fussbereich ist gross genug', schrift.fuss >= 15);
check('Die Trefferflaeche erreicht die uebliche Mindesthoehe', schrift.hoehe >= 44);

// ── 4) Desktop-Hinweis ist weg
const txt = await m.textContent('#side');
check('KRITISCH: der Desktop-Hinweis ist verschwunden', !/am Desktop gepflegt/.test(txt));
check('Er steht auch nicht mehr im Quelltext',
  !readFileSync(`${WURZEL}/dashboard.html`, 'utf8').includes('mobil-hinweis'));

// ── 5) Hell/Dunkel als Schalter oben rechts
const sch = await m.evaluate(() => {
  const b = document.getElementById('btnThemaMob');
  if (!b) { return null; }
  const r = b.getBoundingClientRect(), k = document.getElementById('side').getBoundingClientRect();
  const cs = getComputedStyle(b);
  return { sichtbar: cs.display !== 'none' && cs.visibility !== 'hidden'
                     && b.getClientRects().length > 0 && r.width > 0,
           rolle: b.getAttribute('role'), obenIm: r.top - k.top,
           rechtsAb: k.right - r.right, klasse: b.className };
});
check('KRITISCH: der Hell/Dunkel-Schalter steht im Menue', sch && sch.sichtbar);
check('Er ist ein Schalter, keine Menuezeile', sch && sch.rolle === 'switch' && /thema-schalter/.test(sch.klasse));
check('KRITISCH: er sitzt oben', sch && sch.obenIm < 60);
check('KRITISCH: er sitzt rechts', sch && sch.rechtsAb < 30);
check('Die alte Themen-ZEILE gibt es nicht mehr', (await m.$$('#nav-thema')).length === 0);

// Er muss auch schalten, nicht nur dastehen.
const vorher = await m.evaluate(() => document.documentElement.getAttribute('data-thema'));
await m.click('#btnThemaMob');
await m.waitForTimeout(200);
const nachher = await m.evaluate(() => document.documentElement.getAttribute('data-thema'));
check('KRITISCH: der Schalter schaltet die Darstellung wirklich um', vorher !== nachher);
check('Sein Zustand wird mitgefuehrt',
  (await m.getAttribute('#btnThemaMob', 'aria-checked')) === (nachher === 'dunkel' ? 'true' : 'false'));
check('KRITISCH: der verborgene Schalter der Kopfzeile steht auf demselben Stand',
  (await m.getAttribute('#btnThema', 'aria-checked')) === (nachher === 'dunkel' ? 'true' : 'false'));
await m.click('#btnThemaMob'); await m.waitForTimeout(150);

// ── 6) Benutzerblock unten rechts
const nutzer = await m.evaluate(() => {
  const u = document.querySelector('#side .side-foot .side-user');
  if (!u) { return null; }
  const r = u.getBoundingClientRect();
  const fuss = document.querySelector('#side .side-foot').getBoundingClientRect();
  const geschwister = [...u.parentElement.children]
    .filter(e => getComputedStyle(e).display !== 'none')
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const name = u.querySelector('.who b').getBoundingClientRect();
  return {
    istLetzter: geschwister[geschwister.length - 1] === u,
    untenImFuss: fuss.bottom - r.bottom,
    richtung: getComputedStyle(u).flexDirection,
    ausrichtung: getComputedStyle(u).textAlign,
    nameRechtsAb: r.right - name.right,
    nameBreite: name.width,
  };
});
check('KRITISCH: der Benutzerblock steht ganz unten', nutzer && nutzer.istLetzter);
check('Er sitzt am unteren Rand des Fussbereichs', nutzer && nutzer.untenImFuss < 30);
check('KRITISCH: er ist nach rechts ausgerichtet',
  nutzer && nutzer.richtung === 'row-reverse' && nutzer.ausrichtung === 'right');
check('Der Name steht rechts, nicht links', nutzer && nutzer.nameRechtsAb < 60 && nutzer.nameBreite > 20);

await m.screenshot({ path: `${OUT}/men-01-handy.png` });
check('KRITISCH: keine JavaScript-Fehler', jsFehler.length === 0);
await m.close();

// ══════════════════════════════════════════ DESKTOP BLEIBT WIE ER WAR
const d = await seite(1440, 900);
check('Desktop: kein Burger', !(await d.isVisible('#btnBurger')));
check('Desktop: die Seitenleiste steht dauerhaft da', await d.isVisible('#side'));
check('Desktop: der Hell/Dunkel-Schalter bleibt in der Kopfzeile', await d.isVisible('#btnThema'));
check('Desktop: der Menuekopf des Handys bleibt verborgen',
  await d.evaluate(() => {
    const k = document.querySelector('#side .side-kopf');
    return !k || getComputedStyle(k).display === 'none';
  }));
check('KRITISCH: Desktop scrollt normal, keine Sperre',
  await d.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden'));
check('Desktop: die Menueschrift bleibt zurueckhaltend',
  await d.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#side .nav-item')).fontSize)) < 15);
check('Desktop: der Benutzerblock bleibt linksbuendig',
  await d.evaluate(() => getComputedStyle(document.querySelector('#side .side-user')).flexDirection === 'row'));
await d.screenshot({ path: `${OUT}/men-02-desktop.png` });
await d.close();

// ══════════════════════════════════════════ SCHUBLADE FOLGT HELL/DUNKEL (ENT-071)
//
// Am Schreibtisch ist die Seitenleiste bewusst der dunkelste Bereich. Auf dem
// Handy ist sie seit ENT-067 der GANZE Bildschirm -- ein schwarzes Vollbild
// mitten in der hellen Darstellung ist dort kein Kontrast, sondern ein Bruch.
//
// Gemessen wird die tatsaechliche Helligkeit des gerenderten Hintergrunds,
// nicht die Farbmarke im Quelltext: Eine Marke kann gesetzt sein und von
// einer spaeteren Regel ueberstimmt werden, ohne dass etwas kaputtgeht.
const helligkeit = (p, sel) => p.evaluate(s => {
  const e = document.querySelector(s);
  if (!e) { return null; }
  const c = getComputedStyle(e).backgroundColor.match(/\d+/g);
  return c ? Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) : null;
}, sel);
const textHelligkeit = (p, sel) => p.evaluate(s => {
  const e = document.querySelector(s);
  if (!e) { return null; }
  const c = getComputedStyle(e).color.match(/\d+/g);
  return c ? Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) : null;
}, sel);

// Echtes Kontrastverhaeltnis nach WCAG statt eines selbstgebauten
// Helligkeitsabstands. Der erste Anlauf dieser Suite nutzte "Differenz > 60"
// -- damit rutschte eine Beschriftung mit 3.1:1 durch, also genau der Fall,
// den die Pruefung verhindern sollte. Eine Schwelle, die man sich ausdenkt,
// misst nichts; 4.5:1 ist die Schwelle fuer kleinen Text.
const kontrast = (p, selText, selGrund) => p.evaluate(([st, sg]) => {
  const kanal = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const leuchte = c => 0.2126 * kanal(c[0]) + 0.7152 * kanal(c[1]) + 0.0722 * kanal(c[2]);
  const lies = (sel, eigenschaft) => {
    const e = document.querySelector(sel);
    if (!e) { return null; }
    const c = getComputedStyle(e)[eigenschaft].match(/\d+/g);
    return c ? c.slice(0, 3).map(Number) : null;
  };
  const a = lies(st, 'color'), b = lies(sg, 'backgroundColor');
  if (!a || !b) { return null; }
  const la = leuchte(a), lb = leuchte(b);
  return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 10) / 10;
}, [selText, selGrund]);

for (const thema of ['hell', 'dunkel']) {
  const s = await seite(390, 844, thema);
  await s.click('#btnBurger');
  await s.waitForTimeout(400);

  const grund = await helligkeit(s, '.side');
  const eintrag = await textHelligkeit(s, '.side-nav .nav-item');
  const gruppe = await textHelligkeit(s, '.side-nav .nav-lbl');
  const nutzer = await textHelligkeit(s, '.side-user .who b');
  const karte = await helligkeit(s, '.card');

  if (thema === 'hell') {
    check('KRITISCH: im Hellmodus ist die Schublade hell, nicht schwarz', grund > 200);
    check('KRITISCH: der Text darin ist dunkel, sonst wäre er unlesbar', eintrag < 80);
    check('Sie trägt denselben Grund wie die Karten der Arbeitsfläche',
      karte !== null && Math.abs(grund - karte) <= 4);
  } else {
    check('KRITISCH: im Dunkelmodus bleibt die Schublade dunkel', grund < 60);
    check('KRITISCH: der Text darin ist hell', eintrag > 180);
  }
  // In beiden Faellen zaehlt nicht der Farbunterschied, sondern die
  // Lesbarkeit -- gemessen als Kontrastverhaeltnis nach WCAG.
  const kEintrag = await kontrast(s, '.side-nav .nav-item', '.side');
  const kGruppe = await kontrast(s, '.side-nav .nav-lbl', '.side');
  const kNutzer = await kontrast(s, '.side-user .who b', '.side');
  check(`KRITISCH: die Menüeinträge sind im ${thema}en Menü lesbar (${kEintrag}:1)`, kEintrag >= 4.5);
  check(`KRITISCH: die Gruppenüberschrift ist im ${thema}en Menü lesbar (${kGruppe}:1, 11px)`,
    kGruppe >= 4.5);
  check(`Der Benutzername ist im ${thema}en Menü lesbar (${kNutzer}:1)`, kNutzer >= 4.5);
  check(`Grund und Text stehen im ${thema}en Menü weit genug auseinander`,
    Math.abs(grund - eintrag) > 140);
  // Der Schalter selbst sitzt im Menue und darf nicht mit dem Grund verschmelzen
  check(`Der Hell/Dunkel-Schalter hebt sich im ${thema}en Menü ab`,
    Math.abs((await helligkeit(s, '#btnThemaMob')) - grund) > 3);
  await s.screenshot({ path: `${OUT}/men-03-${thema}.png` });
  await s.close();
}

// Der Desktop bleibt, wie er war: dunkle Leiste neben heller Arbeitsflaeche.
// Das ist Absicht und keine Nachlaessigkeit -- sie steht dort dauerhaft
// daneben und grenzt die Arbeitsflaeche ab, statt sie zu ersetzen.
const dh = await seite(1440, 900, 'hell');
const leisteHell = await helligkeit(dh, '.side');
const inhaltHell = await helligkeit(dh, '.card');
check('KRITISCH: am Desktop bleibt die Leiste im Hellmodus dunkel', leisteHell < 60);
check('KRITISCH: ... und hebt sich damit weiterhin von der Arbeitsfläche ab',
  inhaltHell - leisteHell > 150);
// Frueher wurde hier der exakte Helligkeitswert festgenagelt ("bleibt
// unveraendert"). Das prueft den Wortlaut, nicht die Aussage -- und fiel
// rot aus, als die Gruppenueberschrift fuer besseren Kontrast bewusst
// aufgehellt wurde (ENT-239, Etappe 1). Die Aussage ist: auch am Desktop
// lesbar, aber zurueckhaltender als die Menuepunkte selbst.
const kGruppeDesk = await kontrast(dh, '.side-nav .nav-lbl', '.side');
check(`KRITISCH: die Gruppenüberschrift ist auch am Desktop lesbar (${kGruppeDesk}:1)`,
  kGruppeDesk >= 4.5);
check('Sie bleibt dabei zurückhaltender als die Menüpunkte',
  (await textHelligkeit(dh, '.side-nav .nav-lbl')) <
  (await textHelligkeit(dh, '.side-nav .nav-item')));
await dh.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
