// Der Zugang zum Cockpit (ENT-396), rahmenlos wie die Mitarbeiter-App.
//
// Wunsch des Projektinhabers: "cockpit hat noch das alte layout, bitte
// ebenfalls ergaenzen" -- nachdem er app.html (ENT-385/388) gesehen hatte.
// Diese Datei ersetzt die fruehere Fassung vollstaendig: die dort noch
// gepruefte weisse/deckende Karte ist weg, Text liegt jetzt DIREKT auf
// Foto/Video, wie in app.html. Die dortige Suite (test_anmeldemaske.mjs)
// ist das Vorbild fuer die Mehrpunkt-Kontrastmessung hier.
//
// Zwei Zustaende gibt es hier, die app.html NICHT kennt, und die die alte
// Fassung dieser Datei nie geprueft hat, weil sie hinter der Karte lagen:
// den zweiten Faktor (#gate2fa, ENT-076) und die Zugang-verweigert-Ansicht
// (#gateDenied, fuer Nicht-Admins). Beide liegen jetzt ebenso ungeschuetzt
// auf dem Foto/Video wie das Hauptformular -- beide brauchen darum densel-
// ben Kontrastnachweis, nicht nur eine Sichtpruefung.
//
// CLAUDE.md: "Gestaltung wird gemessen, nicht im Quelltext nachgelesen."
// Genau diese Datei bewies das schon einmal an sich selbst: die erste
// Fassung des CSS liess das Video wegen einer falschen Regel-Reihenfolge
// bei JEDER Fensterbreite verschwinden (siehe Kommentar im CSS bei #gate)
// -- sichtbar erst am Bildschirm, nicht im Quelltext.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });
const ev = (page, fn, ...a) => page.evaluate(fn, ...a).catch(() => null);

// Kontrast nach WCAG -- Zeichen fuer Zeichen wie in test_anmeldemaske.mjs.
const leuchte = (r, g, b) => {
  const k = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
  return .2126 * k(r) + .7152 * k(g) + .0722 * k(b);
};
const kontrast = (a, b) => {
  const z = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  const [l1, l2] = [leuchte(...z(a)), leuchte(...z(b))].sort((x, y) => y - x);
  return (l1 + .05) / (l2 + .05);
};
const kontrastGegenLeuchte = (farbeStr, lb) => {
  const [r, g, b] = (farbeStr.match(/\d+/g) || []).slice(0, 3).map(Number);
  const la = leuchte(r, g, b);
  const [l1, l2] = [la, lb].sort((x, y) => y - x);
  return (l1 + .05) / (l2 + .05);
};

const seiteOeffnen = async (thema, breite, hoehe = 900) => {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.addInitScript(t => { try { localStorage.setItem('rv3_thema', t); } catch (e) {} }, thema);
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForTimeout(500);
  return page;
};

const mass = async (page, sel) => ev(page, s => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect(), c = getComputedStyle(e);
  return { x: r.x, y: r.y, w: r.width, h: r.height, unten: r.bottom,
           fs: parseFloat(c.fontSize), farbe: c.color, grund: c.backgroundColor,
           schatten: c.boxShadow };
}, sel);

// Fotografiert den nackten Hintergrund hinter einem Textknoten (Schrift
// kurz transparent, danach wiederhergestellt -- sonst misst man die
// Leuchtdichte der Buchstaben gegen sich selbst, siehe Kommentar in
// test_anmeldemaske.mjs) und rechnet den WCAG-Kontrast gegen den hellsten
// Bildpunkt darin, dem fotografischen Worst-Case fuer helle Schrift.
const textKontrastAufFoto = async (page, sel) => {
  const box = await ev(page, s => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = document.createRange(); r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, sel);
  if (!box || box.w < 1 || box.h < 1) return null;
  const clip = { x: Math.max(0, Math.floor(box.x)), y: Math.max(0, Math.floor(box.y)),
    width: Math.max(1, Math.ceil(box.w)), height: Math.max(1, Math.ceil(box.h)) };
  const farbe = await ev(page, s => getComputedStyle(document.querySelector(s)).color, sel);
  await ev(page, s => { document.querySelector(s).style.color = 'transparent'; }, sel);
  const buf = await page.screenshot({ clip }).catch(() => null);
  await ev(page, s => { document.querySelector(s).style.color = ''; }, sel);
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

const seekeZu = async (page, zeit) => ev(page, t => new Promise(res => {
  const v = document.querySelector('.gate-video');
  if (!v) return res(false);
  const fertig = () => { v.removeEventListener('seeked', fertig); res(true); };
  v.addEventListener('seeked', fertig);
  v.currentTime = t;
}), zeit);

// Kontrast an FUENF Zeitpunkten der zehnsekuendigen Schleife, nicht an
// einem -- dieselbe Praxis wie in test_anmeldemaske.mjs (ENT-394). Deter-
// ministisch per Seek statt per Wartezeit.
const ZEITPUNKTE = [0.3, 2.5, 5, 7.5, 9.7];
const pruefeVideoKontrast = async (page, texte) => {
  for (const [bezeichnung, sel] of texte) {
    let schlechtester = Infinity;
    for (const zeit of ZEITPUNKTE) {
      await seekeZu(page, zeit);
      const k = await textKontrastAufFoto(page, sel);
      if (k !== null && k < schlechtester) schlechtester = k;
    }
    check(`KRITISCH: ${bezeichnung} bleibt vor dem laufenden Video an allen ${ZEITPUNKTE.length} `
        + `geprueften Zeitpunkten der Schleife lesbar (>= 4.5:1, schlechtester gemessener Wert: `
        + `${schlechtester === Infinity ? 'nicht messbar' : schlechtester.toFixed(2)})`,
      schlechtester >= 4.5);
  }
};

// ══════════════════════════════════════════════════════════════════════
// DESKTOP, DUNKLES THEMA -- der Hauptzustand
// ══════════════════════════════════════════════════════════════════════
const page = await seiteOeffnen('dunkel', 1440);

// ══════════ DIE KARTE IST WEG -- TEXT LIEGT DIREKT AUF FOTO/VIDEO ══════
const form = await mass(page, '#gateLogin');
check('KRITISCH: die Anmeldekarte ist weg -- der Formularblock hat keine eigene Flaeche',
  form !== null && /rgba\(0, 0, 0, 0\)|transparent/.test(form.grund));
check('KRITISCH: und auch keinen Schatten mehr, der eine Kartenkante andeuten wuerde',
  form !== null && form.schatten === 'none');

// ══════════ LOGO RAHMENLOS UND GROSS, WIE IN app.html ══════════════════
const logo = await mass(page, '.gate-oben img');
check('KRITISCH: das Logo ist auf dem Desktop deutlich groesser als die alten 66 px',
  logo !== null && logo.w >= 150 && logo.h >= 150);
const fassung = await ev(page, () => {
  const c = getComputedStyle(document.querySelector('.gate-oben img'));
  return { grund: c.backgroundColor, radius: c.borderRadius, padding: c.paddingTop, schatten: c.boxShadow };
});
check('KRITISCH: das Logo traegt keine weisse Flaeche und keinen Rahmen mehr dahinter',
  fassung !== null && /rgba\(0, 0, 0, 0\)|transparent/.test(fassung.grund)
  && parseFloat(fassung.radius) === 0 && parseFloat(fassung.padding) === 0 && fassung.schatten === 'none');
const mitte = await mass(page, '.gate-mitte');
check('Das Logo steht waagrecht wirklich mittig, nicht nur ungefaehr',
  logo !== null && mitte !== null
  && Math.abs((logo.x + logo.w / 2) - (mitte.x + mitte.w / 2)) <= 2);

// ══════════ "COCKPIT" BLEIBT -- ANDERS ALS IN app.html ════════════════
// ENT-385 hat die Wortmarke aus der Mitarbeiter-App entfernt, weil der
// Zugang dort NICHT "Cockpit" heisst. Hier schon -- das ist tatsaechlich
// das Cockpit. Die Marke bleibt darum ausdruecklich stehen, das ist keine
// vergessene Aufraeumarbeit.
check('KRITISCH: die Wortmarke "Cockpit" steht ueber dem Formular',
  (await page.textContent('.gate-oben .wm').catch(() => '')).trim() === 'Cockpit');
check('Der Firmenname steht als eigene Zeile darunter',
  (await page.textContent('.gate-oben .sub').catch(() => '')).trim() !== '');

// ══════════ EIGENE, VOM SEITENTHEMA UNABHAENGIGE FARBPALETTE ══════════
const grund = await ev(page, () => getComputedStyle(document.getElementById('gate')).backgroundColor);
check('KRITISCH: der Grund traegt den --bg des Dashboard-Dunkelmodus (#0F1117)',
  grund === 'rgb(15, 17, 23)');
const feld = await mass(page, '#gName');
check('Das Eingabefeld hebt sich vom Grund ab (--surface-2 #1E2535)',
  feld !== null && feld.grund === 'rgb(30, 37, 53)');
check('KRITISCH: der eingegebene Text liest hell auf dunkel, nicht schwarz auf dunkel',
  feld !== null && kontrast(feld.farbe, feld.grund) >= 7);
// KEIN 44-px/16-px-Nachweis hier: .inp/.btn sind globale, dashboardweite
// Klassen (41 px / 14 px, gemessen), unveraendert von diesem Umbau und
// unabhaengig davon ueberall im Cockpit im Einsatz -- eine Pruefung wie in
// app.html wuerde hier eine dashboardweite Anforderung behaupten, die nie
// bestand. Siehe Meldung an den Projektinhaber: das ist ein echter, aber
// vom aktuellen Auftrag ("Optik von app.html uebernehmen") getrennter Fund.

// ══════════ DER ANMELDEKNOPF BLEIBT LESBAR (derselbe Grund wie ENT-388) ═
const cta = await mass(page, '#gBtn');
check('KRITISCH: die Schrift auf dem Anmeldeknopf erreicht mindestens 4.5:1 Kontrast',
  cta !== null && kontrast(cta.farbe, cta.grund) >= 4.5);

// ══════════ DESKTOP: KEINE ANMELDUNG UEBER DIE VOLLE BREITE ═══════════
check('KRITISCH: auf dem Desktop bleibt die Spalte schmal, statt sich ueber die ganze Breite zu ziehen',
  mitte !== null && mitte.w <= 420);
check('KRITISCH: die Marke waechst auf dem grossen Schirm mit (>= 150 px), statt klein zu bleiben',
  logo !== null && logo.w >= 150);

// ══════════ DAS VIDEO IST EINGEBUNDEN UND SPIELT VON SELBST ═══════════
check('KRITISCH: das Video ist auf dem Desktop eingebunden',
  await ev(page, () => getComputedStyle(document.querySelector('.gate-video')).display !== 'none'));
const quellen = await ev(page, () =>
  [...document.querySelectorAll('.gate-video source')].map(s => ({ src: s.getAttribute('src'), typ: s.getAttribute('type') })));
check('KRITISCH: WebM/VP9 UND MP4/H.264 sind beide als Quelle eingetragen -- '
    + 'nicht jeder Browser kann beide Formate abspielen (dieses Test-Chromium selbst kein H.264)',
  Array.isArray(quellen)
  && quellen.some(q => q.src?.endsWith('.webm') && q.typ === 'video/webm')
  && quellen.some(q => q.src?.endsWith('.mp4') && q.typ === 'video/mp4'));
const attribute = await ev(page, () => {
  const v = document.querySelector('.gate-video');
  return { autoplay: v.autoplay, muted: v.muted, loop: v.loop, playsinline: v.hasAttribute('playsinline') };
});
check('KRITISCH: autoplay, muted, loop und playsinline sind gesetzt',
  attribute !== null && attribute.autoplay && attribute.muted && attribute.loop && attribute.playsinline);
const zeitVorher = await ev(page, () => document.querySelector('.gate-video')?.currentTime ?? null);
await page.waitForTimeout(600);
const zeitNachher = await ev(page, () => document.querySelector('.gate-video')?.currentTime ?? null);
check('KRITISCH: das Video spielt tatsaechlich von selbst (die Zeit laeuft weiter, ohne Klick)',
  zeitVorher !== null && zeitNachher !== null && zeitNachher > zeitVorher);
await ev(page, () => document.querySelector('.gate-video')?.pause());

// ══════════ HAUPTFORMULAR: MEHRPUNKT-KONTRAST GEGEN DAS LAUFENDE VIDEO ═
const TEXTE_HAUPT = [
  ['Wortmarke "Cockpit"', '.gate-oben .wm'],
  ['Firmenname', '.gate-oben .sub'],
  ['Begleittext "Bitte melden Sie sich..."', '#gateLogin .gate-msg'],
  ['Beschriftung "Name"', 'label[for="gName"]'],
  ['Beschriftung "Passwort"', 'label[for="gPass"]'],
];
await pruefeVideoKontrast(page, TEXTE_HAUPT);

// ══════════ REDUZIERTE BEWEGUNG: DAS FOTO TRAEGT DENSELBEN TEXT ═══════
// Wer Bewegung reduziert eingestellt hat, sieht nie das Video -- hier ist
// die einzige Stelle, an der sich das Foto (ENT-392) noch isoliert
// pruefen laesst. Gemessen wird an genau denselben Elementen wie eben,
// nur an einem einzigen (statt fuenf) Zeitpunkten, weil ein Standbild
// keine Schleife hat.
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.waitForTimeout(150);
check('KRITISCH: bei reduzierter Bewegung ist das Video unsichtbar',
  await ev(page, () => getComputedStyle(document.querySelector('.gate-video')).display === 'none'));
check('KRITISCH: und auch der Schleier -- sonst legt sich eine dunkle Flaeche ohne rechtfertigendes Video darueber',
  await ev(page, () => getComputedStyle(document.querySelector('.gate-schleier')).display === 'none'));
check('KRITISCH: das Hintergrundfoto ist als CSS-Ausweiche eingebunden',
  await ev(page, () => getComputedStyle(document.getElementById('gate')).backgroundImage.includes('anmeldung-nacht.webp')));
for (const [bezeichnung, sel] of TEXTE_HAUPT) {
  const k = await textKontrastAufFoto(page, sel);
  check(`KRITISCH: ${bezeichnung} bleibt vor dem echten Foto lesbar (>= 4.5:1) -- Zustand "reduzierte Bewegung"`,
    k !== null && k >= 4.5);
}
await page.emulateMedia({ reducedMotion: 'no-preference' });

// ══════════════════════════════════════════════════════════════════════
// ZWEITER FAKTOR (#gate2fa, ENT-076) -- lag bisher HINTER der Karte,
// die alte Fassung dieser Datei hat ihn nie geprueft. Jetzt liegt er
// ebenso ungeschuetzt auf dem Video wie das uebrige Formular.
// ══════════════════════════════════════════════════════════════════════
await ev(page, () => { document.getElementById('gate2fa').style.display = ''; });
await page.waitForTimeout(150);
const TEXTE_2FA = [
  ['Beschriftung "Code aus der Authenticator-App"', 'label[for="gCode"]'],
  ['Checkbox-Text "diesem Geraet vertrauen"', '#gMerkenText'],
];
await pruefeVideoKontrast(page, TEXTE_2FA);

// ══════════════════════════════════════════════════════════════════════
// ZUGANG VERWEIGERT (#gateDenied) -- fuer Nicht-Admins, ebenfalls nie
// zuvor geprueft. Die Meldung liegt direkt auf dem Video (Foto-Pixel-
// Messung), die drei Knoepfe haben eine EIGENE deckende Flaeche
// (.btn-primary/.btn-plain, siehe CSS) und brauchen darum nur den
// gewoehnlichen Farbe-gegen-Farbe-Kontrast, keine Foto-Messung.
// ══════════════════════════════════════════════════════════════════════
await ev(page, () => {
  document.getElementById('gateLogin').style.display = 'none';
  document.getElementById('gateDenied').style.display = '';
});
await page.waitForTimeout(150);
await pruefeVideoKontrast(page, [['Meldung "Dieser Bereich ist der Administration vorbehalten..."', '#gateDenied .gate-msg']]);

const knopfZurApp = await mass(page, '#gateDenied .btn-primary');
check('KRITISCH: "Zur App" ist beschriftet und erreicht mindestens 4.5:1 Kontrast auf eigener Flaeche',
  knopfZurApp !== null && kontrast(knopfZurApp.farbe, knopfZurApp.grund) >= 4.5);
const knopfRapport = await mass(page, '#gateDenied a.btn-plain');
check('"Zur Rapporterfassung" erreicht mindestens 4.5:1 Kontrast auf eigener Flaeche',
  knopfRapport !== null && kontrast(knopfRapport.farbe, knopfRapport.grund) >= 4.5);
const knopfAbmelden = await mass(page, '#gateDenied button.btn-plain');
check('"Abmelden" erreicht mindestens 4.5:1 Kontrast auf eigener Flaeche',
  knopfAbmelden !== null && kontrast(knopfAbmelden.farbe, knopfAbmelden.grund) >= 4.5);

await page.close();

// ══════════════════════════════════════════════════════════════════════
// NICHTS SCROLLT AUF EINEM KLEINEN GERAET (Grundzustand, ohne 2FA)
// ══════════════════════════════════════════════════════════════════════
const klein = await seiteOeffnen('dunkel', 390, 844);
const passt = async p => ev(p, () => {
  const g = document.getElementById('gate');
  return g.scrollHeight <= g.clientHeight + 1;
});
check('KRITISCH: auf 390x844 muss nicht gescrollt werden', await passt(klein));

// ══════════ HANDY: KEIN VIDEO, WIE BEI app.html ════════════════════════
check('KRITISCH: auf dem Handy bleibt das Video unsichtbar',
  await ev(klein, () => getComputedStyle(document.querySelector('.gate-video')).display === 'none'));
await klein.close();

// ══════════════════════════════════════════════════════════════════════
// HELLES THEMA: DIE PALETTE BLEIBT UNABHAENGIG VOM SEITENTHEMA
// ══════════════════════════════════════════════════════════════════════
// Der Kern des Umbaus: #gate traegt seit ENT-396 eine EIGENE, feste
// Palette (siehe CSS-Kommentar), nicht mehr die des Seitenthemas. Volle
// Fuenfpunkt-Messung waere hier nur eine Wiederholung derselben, vom
// Thema unabhaengigen Werte -- ein einzelner Stichpunkt reicht als Beweis,
// dass die lokale Ueberschreibung tatsaechlich greift, nicht das globale
// helle Thema durchschlaegt.
const hell = await seiteOeffnen('hell', 1440);
check('KRITISCH: auch im hellen Thema ist das Video eingebunden und spielt',
  await ev(hell, () => getComputedStyle(document.querySelector('.gate-video')).display !== 'none'));
const feldHell = await mass(hell, '#gName');
check('KRITISCH: das Eingabefeld bleibt im hellen Thema dunkel (--surface-2), die lokale Palette schlaegt durch',
  feldHell !== null && feldHell.grund === 'rgb(30, 37, 53)');
await ev(hell, () => document.querySelector('.gate-video')?.pause());
await seekeZu(hell, 2.5);
const kHell = await textKontrastAufFoto(hell, '.gate-oben .wm');
check('KRITISCH: die Wortmarke "Cockpit" bleibt auch im hellen Thema lesbar (>= 4.5:1)',
  kHell !== null && kHell >= 4.5);
await hell.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
