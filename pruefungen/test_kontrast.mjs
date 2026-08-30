// Kontraste, GEMESSEN am gerenderten Zustand (ENT-239, Etappe 1).
//
// Anlass: Die Design-Bewertung vom 2026-08-30 fand drei Klassen von
// Lesbarkeitsfehlern, die im Quelltext plausibel aussahen und erst beim
// Messen auffielen -- Kacheltext mit 2.51:1, Diagrammbalken mit 1.12:1,
// Kleinbeschriftungen mit 3.17:1. Diese Suite misst die AUSSAGE
// ("das Element ist auf seinem Grund lesbar"), nicht den Wortlaut einer
// CSS-Regel: Sie rechnet das WCAG-Kontrastverhaeltnis aus den tatsaechlich
// gerenderten Farben, in beiden Themen und auf beiden Bildschirmbreiten.
//
// Gegenprobe am 2026-08-30 gemacht: --ink-3 absichtlich auf den alten Wert
// #8B919D zurueckgestellt -> "Balkenwert-Beschriftung" und "Kartennotiz"
// fielen in beiden Themen rot aus; ebenso .kw-Grund testweise zurueck auf
// #1e293b -> "Schnellzugriff-Kacheltext" rot. Danach zurueckgebaut.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ── WCAG-Rechnung. rgba wird ueber den angegebenen Grund gelegt, weil ein
// halbtransparenter Ton nur zusammen mit seinem Grund eine Leseaussage hat.
function linear(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function lum([r, g, b]) { return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b); }
function parse(s) {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const t = m[1].split(',').map(Number);
  return { rgb: t.slice(0, 3), a: t.length > 3 ? t[3] : 1 };
}
function komponiert(fg, grund) {
  const f = parse(fg), g = parse(grund);
  if (!f || !g) return null;
  const a = f.a;
  return f.rgb.map((v, i) => Math.round(v * a + g.rgb[i] * (1 - a)));
}
function kontrast(fgS, bgS, tiefererGrund) {
  const basis = tiefererGrund ? komponiert(bgS, tiefererGrund) : parse(bgS)?.rgb;
  if (!basis) return 0;
  const oben = komponiert(fgS, `rgb(${basis.join(',')})`);
  const [h, l] = [lum(oben), lum(basis)].sort((a, b) => b - a);
  return (h + 0.05) / (l + 0.05);
}

const STATS = { status: 'ok', kpi: { rapporte_monat: 12, rapporte_vormonat: 10, stunden_monat: 80, stunden_vormonat: 70,
  mitarbeiter: 2, kunden: 1, rapporte_total: 12 },
  verlauf: Array.from({ length: 8 }, (_, i) => ({ kw: 20 + i, stunden: i === 3 ? 0 : 10 + i, anzahl: 2 })),
  angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], ereignisse: [] };

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const u = route.request().url();
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  if (u.includes('dashboard_stats')) return send(STATS);
  return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [], mitarbeiter: [],
    feiertage: [], gepflegt: {}, sperren: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(400);

// Ein Messdurchlauf pro Thema. Die Werte kommen aus getComputedStyle des
// GERENDERTEN Elements -- eine wirkungslose Regel faellt hier durch, egal
// wie richtig sie im Quelltext aussieht.
async function messe(thema) {
  await page.evaluate(t => themaSetzen(t), thema);
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const cs = el => el ? getComputedStyle(el) : null;
    const karte = cs(document.querySelector('#view-uebersicht .card')).backgroundColor;
    const kw = document.querySelector('#kwGrid .kw');
    const kwSvg = kw ? kw.querySelector('svg') : null;
    const balken = document.querySelector('#chart .bar:not(.now) .bar-fill');
    const balkenWert = document.querySelector('#chart .bar .bar-val');
    const navLbl = document.querySelector('.nav-lbl');
    const shell = cs(document.querySelector('.side')).backgroundColor;
    const btn = document.querySelector('#btnDashBearbeiten');
    const note = document.querySelector('#view-uebersicht .card-hd .note');
    return {
      karte,
      shell,
      kwText: kw ? { fg: cs(kw).color, bg: cs(kw).backgroundColor } : null,
      kwSymbol: kwSvg ? { fg: cs(kwSvg).color, bg: cs(kwSvg).backgroundColor } : null,
      balken: balken ? cs(balken).backgroundColor : null,
      balkenWert: balkenWert ? cs(balkenWert).color : null,
      navLbl: navLbl ? cs(navLbl).color : null,
      note: note ? cs(note).color : null,
      btnPrimary: (() => {
        const b = document.querySelector('.btn-primary');
        return b ? { fg: cs(b).color, bg: cs(b).backgroundColor } : null;
      })(),
    };
  });
}

for (const thema of ['hell', 'dunkel']) {
  const m = await messe(thema);
  const T = `[${thema}] `;
  check(T + 'Messpunkte vorhanden (Karte, Kachel, Balken, Beschriftungen)',
    !!(m.kwText && m.kwSymbol && m.balken && m.balkenWert && m.navLbl && m.note));
  if (!m.kwText) continue;
  check(T + 'KRITISCH: Schnellzugriff-Kacheltext ist lesbar (>=4.5:1)',
    kontrast(m.kwText.fg, m.kwText.bg, m.karte) >= 4.5);
  check(T + 'Schnellzugriff-Symbol hebt sich von seinem Grund ab (>=3:1)',
    kontrast(m.kwSymbol.fg, m.kwSymbol.bg, m.kwText.bg) >= 3);
  check(T + 'KRITISCH: Diagrammbalken vergangener Wochen sind sichtbar (>=3:1 zur Karte)',
    kontrast(m.balken, m.karte) >= 3);
  check(T + 'Balkenwert-Beschriftung ist lesbar (>=4.5:1)',
    kontrast(m.balkenWert, m.karte) >= 4.5);
  check(T + 'Kartennotiz (Kleintext) ist lesbar (>=4.5:1)',
    kontrast(m.note, m.karte) >= 4.5);
  check(T + 'Gruppenbeschriftung der Seitenleiste ist lesbar (>=4.5:1)',
    kontrast(m.navLbl, m.shell) >= 4.5);
  if (m.btnPrimary) {
    check(T + 'Primaerknopf-Text auf Akzentgrund (>=4.5:1)',
      kontrast(m.btnPrimary.fg, m.btnPrimary.bg, m.karte) >= 4.5);
  }
}

// ── Handy: dieselbe Kachel-Aussage auf 390px -- eine Medienabfrage kann
// eine Regel verdraengen, ohne dass am Desktop etwas auffaellt.
await page.evaluate(() => themaSetzen('hell'));
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const mobil = await page.evaluate(() => {
  const cs = el => el ? getComputedStyle(el) : null;
  const karte = cs(document.querySelector('#view-uebersicht .card')).backgroundColor;
  const kw = document.querySelector('#kwGrid .kw');
  return kw ? { fg: cs(kw).color, bg: cs(kw).backgroundColor, karte,
    hoehe: Math.round(kw.getBoundingClientRect().height) } : null;
});
check('[mobil] Schnellzugriff-Kacheltext lesbar (>=4.5:1)',
  mobil && kontrast(mobil.fg, mobil.bg, mobil.karte) >= 4.5);
check('[mobil] Kachel bleibt Trefferflaeche (>=44px hoch)', mobil && mobil.hoehe >= 44);

await browser.close();

// ── Quelltext-Zaehlung: Harte Hex-Farben ausserhalb des Token-Blocks
// duerfen nicht ZUNEHMEN. Bewusst eine Obergrenze statt einer Liste --
// die Aussage ist "neue Farben gehoeren in die Tokens", nicht "genau diese
// alten stehen an genau diesen Stellen". Der Bestand (Skizzenmodus als
// eingebettete Kopie von skizze.js, Druck-/PDF-Ausgaben, die bewusst
// themenunabhaengig hell sind, Weiss auf Akzent) ist begruendet und in
// der Zahl enthalten.
const quelle = readFileSync(`${WURZEL}/dashboard.html`, 'utf8').split('\n');
const rootAb = quelle.findIndex(l => l.includes(':root'));
const dunkelAb = quelle.findIndex(l => l.includes('html[data-thema="dunkel"] {'));
let dunkelBis = dunkelAb;
for (let i = dunkelAb; i < quelle.length; i++) { if (quelle[i].trim() === '}') { dunkelBis = i; break; } }
let anzahl = 0;
quelle.forEach((l, i) => {
  if (i >= rootAb && i <= dunkelBis) return;
  const m = l.match(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g);
  if (m) anzahl += m.length;
});
const OBERGRENZE = 115;   // Bestand bei Einfuehrung (2026-08-30) -- darf sinken, nie steigen
check(`Keine neuen harten Farben ausserhalb des Token-Blocks (${anzahl} <= ${OBERGRENZE})`, anzahl <= OBERGRENZE);

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
