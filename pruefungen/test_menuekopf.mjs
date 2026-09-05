// Der Menue-Reiter nach ENT-402: keine doppelte Namensanzeige, Abmelden als
// Sinnbild oben in der Profilkarte, alles andere als Kachel.
//
// Gemessen wird der gerenderte Zustand, nicht das Regelwerk. Zwei Rollen,
// weil sich die Kachelliste danach unterscheidet: "Zum Cockpit" gibt es nur
// mit Verwaltungsrecht.
//
// NICHT geprueft, weil hier nicht pruefbar: ob der Inhalt bei fehlender
// Kopfzeile unter der Kerbe (Notch) durchlaeuft. env(safe-area-inset-top)
// ist im Testbrowser immer 0 -- eine Pruefung darauf waere gruen, ohne
// etwas auszusagen. Das gehoert am Geraet angesehen.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const SCHICHTEN = { status: 'ok', von: tag(-1), bis: tag(90), schichten: [
  { id: 41, kunde_name: 'Einwohnergemeinde Musterdorf', titel: 'Revierdienst Nacht',
    strasse: 'Bahnhofstrasse 22', ort: '4600 Olten', einsatzart: 'Revierdienst',
    datum: tag(1), von: '20:00:00', bis: '23:00:00', status: 'geplant', bemerkung: null,
    zusage: 'offen', objekt_name: null, im_team: 1 }]};

const profil = admin => ({ status: 'ok', monat: { anzahl: 3, stunden: 22.5 }, profil: {
  name: 'dario.beispiel', ist_admin: admin, personalnummer: 'P-014',
  vorname: 'Dario', nachname: 'Beispiel', geburtsdatum: '1988-04-12',
  strasse: 'Musterweg 3', ort: '4600 Olten', mobil: '079 000 00 00', email: 'd@example.ch' }});

const LUM = c => {
  const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const rgb = s => (String(s).match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
const kontrast = (a, b) => {
  const l1 = LUM(rgb(a)), l2 = LUM(rgb(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

async function starte(admin) {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', route => {
    const p = route.request().url().split('/api/')[1].split('?')[0];
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'dario.beispiel', ist_admin: admin });
    if (p.includes('meine_schichten')) return send(SCHICHTEN);
    if (p.includes('mein_profil')) return send(profil(admin));
    if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
    return send({ status: 'ok' });
  });
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'dario.beispiel');
  await page.fill('#gPass', 'x');
  await page.click('#gBtn');
  await page.waitForSelector('#app.on');
  await page.waitForTimeout(500);
  return { browser, page };
}

// ══════════════ OHNE VERWALTUNGSRECHT
let { browser, page } = await starte(false);

// ── Die Kopfzeile verschwindet NUR im Menue
check('Auf „Heute" steht die Kopfzeile', await page.isVisible('.kopf'));
await page.click('#t-menu'); await page.waitForTimeout(350);
check('KRITISCH: im Menü ist die Kopfzeile weg (ENT-402)', !(await page.isVisible('.kopf')));
await page.click('#t-plan'); await page.waitForTimeout(350);
check('KRITISCH: auf „Plan" ist sie wieder da -- sie fällt nur im Menü weg, nicht in der App',
  await page.isVisible('.kopf'));
check('Und trägt dort weiterhin das Datum -- auf dem Handy sagt nur sie, wo man ist',
  (await page.textContent('#kDatum') || '').trim().length > 6);
await page.click('#t-menu'); await page.waitForTimeout(350);

// ── Der Name steht genau EINMAL
// Der Anlass der ganzen Änderung: derselbe Mensch stand zweimal da, oben
// mit dem Anmeldenamen, darunter mit dem vollen Namen. Gezählt wird, was
// tatsächlich SICHTBAR ist -- die Kopfzeile trägt den Namen weiterhin im
// Bauplan, sie ist nur ausgeblendet.
const sichtbareNamen = await page.evaluate(() => {
  const treffer = [];
  document.querySelectorAll('#app *').forEach(el => {
    if (el.children.length) { return; }                 // nur Blätter, sonst zählt jeder Vorfahre mit
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') { return; }
    if ((el.textContent || '').includes('dario.beispiel')) { treffer.push(el.className || el.tagName); }
  });
  return treffer;
});
check(`KRITISCH: der Anmeldename steht im Menü genau einmal (gefunden: ${sichtbareNamen.length})`,
  sichtbareNamen.length === 1);
check('Und der volle Name steht darüber',
  (await page.textContent('.pr-kopf-name') || '').trim() === 'Dario von Arb'
  || (await page.textContent('.pr-kopf-name') || '').trim() === 'Dario Beispiel');

// ── Abmelden oben in der Karte
const ab = await page.evaluate(() => {
  const b = document.getElementById('mk-abmelden');
  if (!b) { return null; }
  const r = b.getBoundingClientRect();
  const karte = document.querySelector('#pr-haupt .karte').getBoundingClientRect();
  return { hoehe: Math.round(r.height), breite: Math.round(r.width),
           inKarte: r.top >= karte.top - 1 && r.bottom <= karte.bottom + 1,
           rechts: Math.round(karte.right - r.right),
           label: b.getAttribute('aria-label'), text: (b.textContent || '').trim() };
});
check('Abmelden liegt in der Profilkarte', !!ab && ab.inKarte);
check(`KRITISCH: Trefferfläche mindestens 44 px (${ab && ab.hoehe}×${ab && ab.breite})`,
  !!ab && ab.hoehe >= 44 && ab.breite >= 44);
check(`Er sitzt am rechten Rand der Karte (${ab && ab.rechts} px Abstand)`, !!ab && ab.rechts <= 12);
check('Er zeigt nur ein Sinnbild, keinen Text', !!ab && ab.text === '');
check('KRITISCH: trotzdem benannt -- sonst wäre er für ein Vorleseprogramm namenlos',
  !!ab && /Abmelden/.test(ab.label || ''));

// ── Kacheln ohne Verwaltungsrecht
const kachelnMA = await page.evaluate(() =>
  [...document.querySelectorAll('#pr-haupt .mk-kachel')].map(k => k.id));
check(`KRITISCH: genau die sechs Kacheln ohne Verwaltungsrecht (${kachelnMA.join(', ')})`,
  kachelnMA.join(',') === 'mk-daten,mk-stunden,mk-abwesenheit,mk-spesen,mk-passwort,mk-einstellungen');
check('KRITISCH: „Zum Cockpit" fehlt ohne Verwaltungsrecht', !kachelnMA.includes('mk-cockpit'));
check('Die Knopfreihe unter den Kacheln ist ersatzlos weg',
  await page.evaluate(() => document.querySelectorAll('#pr-haupt .btn-wide').length === 0));
const kachelHoehen = await page.evaluate(() =>
  [...document.querySelectorAll('#pr-haupt .mk-kachel')].map(k => Math.round(k.getBoundingClientRect().height)));
check(`Alle Kacheln mindestens 44 px hoch (${Math.min(...kachelHoehen)} px kleinste)`,
  kachelHoehen.every(h => h >= 44));
check('Kein Querlauf im Menü',
  await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 1);
await page.screenshot({ path: OUT + '/menue-01-mitarbeiter.png' });

// ── Spesen: Gerüst, aber ehrlich
await page.click('#mk-spesen'); await page.waitForTimeout(350);
check('Die Spesen-Kachel führt auf die Unterseite', await page.isVisible('#pr-spesen'));
check('Das Menü tritt dabei zurück', !(await page.isVisible('#pr-haupt')));
const spesenTxt = (await page.textContent('#pr-spesen') || '').toLowerCase();
check('KRITISCH: die Seite sagt, dass sie noch nicht eingerichtet ist',
  spesenTxt.includes('noch nicht eingerichtet'));
check('Sie sagt auch, was hierher gehört -- sonst weiss niemand, wofür die Kachel da ist',
  spesenTxt.includes('quittung'));
// CLAUDE.md, die wichtigste Regel der Liste: „unbekannt" darf nie wie
// „keine" aussehen. Wer eine Tankquittung in der Tasche hat und „keine
// Spesen" liest, glaubt, sie sei verschwunden.
check('KRITISCH: sie behauptet NICHT, es gebe keine Spesen',
  !/keine spesen|keine belege|nichts vorhanden/.test(spesenTxt));
check('Und sie sagt, was bis dahin zu tun ist', spesenTxt.includes('aufbewahren'));
await page.screenshot({ path: OUT + '/menue-02-spesen.png' });
await page.click('#pr-spesen .seiten-kopf .btn'); await page.waitForTimeout(300);
check('Zurück führt ins Menü', await page.isVisible('#pr-haupt') && !(await page.isVisible('#pr-spesen')));

// ── Passwort-Kachel öffnet die bekannte Schublade
await page.click('#mk-passwort'); await page.waitForTimeout(400);
check('Die Passwort-Kachel öffnet die Passwort-Schublade',
  await page.isVisible('.blatt.on') && (await page.textContent('.blatt.on')).includes('Passwort'));
await page.evaluate(() => blattZu()); await page.waitForTimeout(300);

// ── Im Dunkeln lesbar (ENT-398 gilt weiter)
const farben = await page.evaluate(() => {
  const c = getComputedStyle(document.getElementById('mk-abmelden'));
  const karte = getComputedStyle(document.querySelector('#pr-haupt .karte-bd').parentElement);
  const name = getComputedStyle(document.querySelector('.pr-kopf-name'));
  const sub = getComputedStyle(document.querySelector('.pr-kopf-sub'));
  return { icon: c.color, grund: karte.backgroundColor, name: name.color, sub: sub.color };
});
check(`Das Abmelde-Sinnbild hebt sich vom Kartengrund ab (${kontrast(farben.icon, farben.grund).toFixed(1)}:1)`,
  kontrast(farben.icon, farben.grund) >= 3);
check(`Der Name ist gut lesbar (${kontrast(farben.name, farben.grund).toFixed(1)}:1)`,
  kontrast(farben.name, farben.grund) >= 7);
check(`Der Anmeldename ist lesbar (${kontrast(farben.sub, farben.grund).toFixed(1)}:1)`,
  kontrast(farben.sub, farben.grund) >= 4.5);

await browser.close();

// ══════════════ MIT VERWALTUNGSRECHT
({ browser, page } = await starte(true));
await page.click('#t-menu'); await page.waitForTimeout(400);
const kachelnAdmin = await page.evaluate(() =>
  [...document.querySelectorAll('#pr-haupt .mk-kachel')].map(k => k.id));
check(`KRITISCH: mit Verwaltungsrecht kommt „Zum Cockpit" dazu (${kachelnAdmin.join(', ')})`,
  kachelnAdmin.join(',') === 'mk-daten,mk-stunden,mk-abwesenheit,mk-spesen,mk-passwort,mk-einstellungen,mk-cockpit');
check('Sie steht zuletzt -- der Übergang in die Verwaltung ist kein Alltagspunkt',
  kachelnAdmin[kachelnAdmin.length - 1] === 'mk-cockpit');
const cockpit = await page.evaluate(() => {
  const a = document.getElementById('mk-cockpit');
  return { tag: a.tagName, ziel: a.getAttribute('href'),
           hoehe: Math.round(a.getBoundingClientRect().height),
           unterstrichen: getComputedStyle(a).textDecorationLine };
});
check('Sie ist ein Verweis und führt ins Cockpit',
  cockpit.tag === 'A' && cockpit.ziel === 'dashboard.html');
check('Sie sieht aus wie eine Kachel, nicht wie ein Verweis',
  cockpit.unterstrichen === 'none' && cockpit.hoehe >= 44);
check('Auch mit Verwaltungsrecht keine Knopfreihe',
  await page.evaluate(() => document.querySelectorAll('#pr-haupt .btn-wide').length === 0));
await page.screenshot({ path: OUT + '/menue-03-verwaltung.png' });
await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
