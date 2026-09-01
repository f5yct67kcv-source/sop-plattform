// Zeitraum und Filter in der Planungs-Uebersicht (ENT-034).
//
// Drei Wuensche des Projektinhabers: freier Zeitraum ueber den Kalender,
// Monat und Jahr als eigene Auswahlfelder, und zwei Filter (Belegung,
// einzelnes Objekt). Vorbild war die Leiste von SecPlanNet.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Fester Bezugsmonat, damit die Erwartungen nicht vom Testtag abhaengen.
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const M = iso(new Date()).slice(0, 7);
const t = n => `${M}-${String(n).padStart(2, '0')}`;
// Tage relativ zu heute, nicht auf den Testmonat beschraenkt wie t() --
// fuer einen Zeitraum, der zuverlaessig ueber die Kappung (MX_MAX_TAGE)
// hinausreicht, egal an welchem Tag/Monat der Test laeuft (CLAUDE.md,
// gleiches Prinzip wie test_datumsfest.mjs).
const relTag = n => iso(new Date(Date.now() + n * 86400000));

const OBJEKTE = [
  { id: 1, kunde_id: 1, kunde_name: 'Beispiel AG', name: 'Muster Center', ort: '4601 Olten', kanton: 'SO', aktiv: 1 },
  { id: 2, kunde_id: 1, kunde_name: 'Beispiel AG', name: 'Werkhof Nord', ort: '4600 Olten', kanton: 'SO', aktiv: 1 },
  { id: 3, kunde_id: 2, kunde_name: 'Werkmuster', name: 'Lagerhalle Sued', ort: '4632 Trimbach', kanton: 'SO', aktiv: 1 },
];
const ma = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'p' + i, vorname: 'P', nachname: String(i), zusage: 'ja' }));
// Muster: durchgehend voll besetzt.  Werkhof: eine Luecke.  Lagerhalle: gar
// nichts -- damit ist jeder der drei Belegungszustaende genau einmal vertreten.
const EINS = [
  { id: 1, objekt_id: 1, kunde_name: 'Beispiel AG', titel: 'Revier', ort: 'Olten', datum: t(3),
    von: '18:00:00', bis: '22:00:00', bedarf: 1, status: 'geplant', mitarbeiter: ma(1) },
  { id: 2, objekt_id: 1, kunde_name: 'Beispiel AG', titel: 'Revier', ort: 'Olten', datum: t(4),
    von: '18:00:00', bis: '22:00:00', bedarf: 2, status: 'geplant', mitarbeiter: ma(2) },
  { id: 3, objekt_id: 2, kunde_name: 'Beispiel AG', titel: 'Werkhof', ort: 'Olten', datum: t(5),
    von: '20:00:00', bis: '23:00:00', bedarf: 3, status: 'geplant', mitarbeiter: ma(1) },
  // Alle uebrigen Zellenzustaende, damit die Rasterlinie auf jeder Feldfarbe
  // gemessen werden kann. Alle auf Werkhof, der ohnehin schon "luecke" ist --
  // so aendert sich an den Erwartungen der Zeilenfilter nichts.
  { id: 5, objekt_id: 2, kunde_name: 'Beispiel AG', titel: 'Werkhof', ort: 'Olten', datum: t(6),
    von: '20:00:00', bis: '23:00:00', bedarf: 2, status: 'geplant', mitarbeiter: [] },
  { id: 6, objekt_id: 2, kunde_name: 'Beispiel AG', titel: 'Werkhof', ort: 'Olten', datum: t(7),
    von: '20:00:00', bis: '23:00:00', bedarf: 2, status: 'provisorisch', mitarbeiter: ma(1) },
  { id: 7, objekt_id: 2, kunde_name: 'Beispiel AG', titel: 'Werkhof', ort: 'Olten', datum: t(8),
    von: '20:00:00', bis: '23:00:00', bedarf: 2, status: 'abgesagt', mitarbeiter: [] },
  // Liegt ausserhalb des Standardmonats -- prueft, dass der Zeitraum wirklich schneidet.
  { id: 4, objekt_id: 3, kunde_name: 'Werkmuster', titel: 'Lager', ort: 'Trimbach', datum: '2027-03-09',
    von: '08:00:00', bis: '12:00:00', bedarf: 1, status: 'geplant', mitarbeiter: [] },
];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), p = req.url().split('/api/')[1].split('?')[0];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  if (p.includes('objekt_list')) return send({ status: 'ok', objekte: OBJEKTE });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EINS });
  if (p.includes('planung_einrichten')) return send({ status: 'ok', message: 'ok', getan: [], unveraendert: [], ausstehend: 0 });
  return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [], mitarbeiter: [],
    feiertage: [], gepflegt: {}, sperren: [], kpi: {}, verlauf: [], angemeldet: [],
    pro_mitarbeiter: [], letzte_rapporte: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');
await page.evaluate(() => go('planung'));
await page.waitForTimeout(700);

const spalten = () => page.evaluate(() => document.querySelectorAll('#mxTable thead th').length - 1);
const zeilen = () => page.evaluate(() =>
  [...document.querySelectorAll('#mxTable tbody tr td.obj')].map(td => td.textContent.trim()));
const info = () => page.textContent('#mxInfo');

// ══════════════════════════════════════════ START: GANZER LAUFENDER MONAT
const tageImMonat = new Date(Number(M.slice(0, 4)), Number(M.slice(5, 7)), 0).getDate();
check('Beim Öffnen steht der laufende Monat als Zeitraum',
  (await page.inputValue('#mxVon')) === M + '-01');
check('… und endet am letzten Tag des Monats',
  (await page.inputValue('#mxBis')) === `${M}-${tageImMonat}`);
check('Die Tabelle zeigt genau so viele Tagesspalten', (await spalten()) === tageImMonat);
check('Der Hinweis nennt den Zeitraum', (await info()).includes('Tage'));
check('Alle drei Objekte sind da', (await zeilen()).length === 3);
// Der erste Entwurf zeigte hier "Januar", weil die Felder beim ersten
// Zeichnen nie an den Zeitraum angeglichen wurden.
check('Das Monatsfeld zeigt schon beim Öffnen den richtigen Monat',
  (await page.inputValue('#mxMon')) === M.slice(5, 7));
check('Das Jahresfeld zeigt schon beim Öffnen das richtige Jahr',
  (await page.inputValue('#mxJahr')) === M.slice(0, 4));
// ── Heute/Woche/Monat-Auswahl und Suche (ENT-038)
check('Die Schnellauswahl zeigt „Dieser Monat“, weil der Zeitraum genau dazu passt',
  (await page.inputValue('#mxSchnell')) === 'monat');
check('Die Schnellauswahl bietet Heute/Woche/Monat',
  (await page.evaluate(() => [...document.getElementById('mxSchnell').options].map(o => o.value))).join(',')
  === ',heute,woche,monat');
check('Es gibt ein Suchfeld in der Übersicht', await page.isVisible('#mxSuche'));
check('Der Feiertage-Knopf sitzt auf der Reiter-Trennlinie, nicht mehr in der Werkzeugleiste',
  !(await page.$('.bar-tools button:has-text("Feiertage")'))
  && await page.isVisible('.tabs button:has-text("Feiertage")'));
await page.screenshot({ path: OUT + '/74-mx-start.png' });

// ══════════════════════════════════════════ FREIER ZEITRAUM MIT KALENDER
await page.fill('#mxVon', t(3));
await page.fill('#mxBis', t(9));
await page.waitForTimeout(400);
check('Ein freier Zeitraum ist möglich, nicht nur ganze Monate', (await spalten()) === 7);
check('Der Hinweis zeigt die gewählte Länge', (await info()).includes('7 Tage'));

// Ein Zeitraum über eine Monats- und Jahresgrenze hinweg -- das ging mit
// dem alten Monatsfeld ueberhaupt nicht. "bis" bewusst relativ zu heute
// (relTag), nicht als festes Kalenderdatum: ein fest eingetragenes Datum
// (z. B. "2027-03-10") wird mit jedem Monat, der seit dem Schreiben
// dieses Tests vergeht, kuerzer zum "von" hin -- irgendwann unter die
// MX_MAX_TAGE-Schwelle und die Kappung greift nicht mehr (am 2026-09-01
// beobachtet: Pruefung faelschlich rot). +400 Tage liegt so weit ueber
// MX_MAX_TAGE (186), dass die Kappung unabhaengig vom Testtag greift, und
// jedes 366-Tage-Fenster enthaelt zwangslaeufig einen Jahreswechsel.
await page.fill('#mxVon', t(25));
await page.fill('#mxBis', relTag(400));
await page.waitForTimeout(400);
const langeSpalten = await spalten();
check('Ein Zeitraum über Monats- und Jahresgrenzen wird angezeigt', langeSpalten > 31);
check('Sehr lange Zeiträume werden gekappt statt unlesbar zu werden', langeSpalten === 186);
check('Die Kappung wird offen gesagt, nicht stillschweigend gemacht',
  (await info()).includes('gekürzt'));

// Verdrehte Eingabe: bis vor von. Muss sich selbst zurechtruecken.
await page.fill('#mxVon', t(20));
await page.fill('#mxBis', t(10));
await page.waitForTimeout(400);
check('Ein verdrehter Zeitraum wird stillschweigend richtig herum gelesen',
  (await spalten()) === 11);

// ══════════════════════════════════════════ MONAT UND JAHR ALS EIGENE FELDER
check('Es gibt ein eigenes Auswahlfeld für den Monat', await page.isVisible('#mxMon'));
check('Es gibt ein eigenes Auswahlfeld für das Jahr', await page.isVisible('#mxJahr'));
check('Alle zwölf Monate stehen zur Wahl',
  (await page.evaluate(() => document.getElementById('mxMon').options.length)) === 12);
check('Die Monate stehen ausgeschrieben da, nicht als Zahl',
  (await page.evaluate(() => document.getElementById('mxMon').options[7].textContent)) === 'August');
check('Das Jahr eines vorhandenen Einsatzes steht zur Wahl, auch wenn es in der Zukunft liegt',
  await page.evaluate(() => [...document.getElementById('mxJahr').options].some(o => o.value === '2027')));

await page.selectOption('#mxMon', '03');
await page.selectOption('#mxJahr', '2027');
await page.click('button:has-text("Monat anzeigen")');
await page.waitForTimeout(400);
check('„Monat anzeigen“ setzt den Zeitraum auf den ganzen Monat',
  (await page.inputValue('#mxVon')) === '2027-03-01' && (await page.inputValue('#mxBis')) === '2027-03-31');
check('Der März 2027 hat 31 Spalten', (await spalten()) === 31);
check('Der Einsatz vom 09.03.2027 taucht jetzt auf',
  (await page.textContent('#mxTable')).includes('Lagerhalle Sued'));

// Die Auswahlfelder duerfen nichts anderes behaupten als die Tabelle zeigt.
await page.fill('#mxVon', '2027-05-04');
await page.fill('#mxBis', '2027-05-06');
await page.waitForTimeout(400);
check('Ein freier Zeitraum zieht Monat und Jahr nach',
  (await page.inputValue('#mxMon')) === '05' && (await page.inputValue('#mxJahr')) === '2027');

// ══════════════════════════════════════════ BLÄTTERN
await page.selectOption('#mxSchnell', 'monat');
await page.waitForTimeout(400);
check('„Dieser Monat“ führt zurück auf den laufenden Monat',
  (await page.inputValue('#mxVon')) === M + '-01');
await page.click('button[title="Weiter, um die Länge des Zeitraums"]');
await page.waitForTimeout(400);
const naechster = new Date(Number(M.slice(0, 4)), Number(M.slice(5, 7)), 1);
check('Ein Monat weiter blättert auf den Folgemonat',
  (await page.inputValue('#mxVon')) === iso(naechster));
check('Der Folgemonat ist wieder ein ganzer Monat',
  (await page.inputValue('#mxBis')) === iso(new Date(naechster.getFullYear(), naechster.getMonth() + 1, 0)));
await page.click('button[title="Zurück, um die Länge des Zeitraums"]');
await page.waitForTimeout(400);
check('Und wieder zurück', (await page.inputValue('#mxVon')) === M + '-01');

// Bei einem freien Zeitraum verschiebt das Blättern den Zeitraum als Ganzes.
await page.fill('#mxVon', t(3));
await page.fill('#mxBis', t(9));
await page.waitForTimeout(300);
await page.click('button[title="Weiter, um die Länge des Zeitraums"]');
await page.waitForTimeout(400);
check('Ein freier Zeitraum wird beim Blättern um seine eigene Länge verschoben',
  (await spalten()) === 7);

// ══════════════════════════════════════════ FILTER: BELEGUNG
await page.selectOption('#mxSchnell', 'monat');
await page.waitForTimeout(400);
check('Ohne Filter sind alle drei Zeilen da', (await zeilen()).length === 3);

await page.selectOption('#mxBeleg', 'luecke');
await page.waitForTimeout(400);
let z = await zeilen();
check('„Nur mit Lücken“ zeigt genau das unterbesetzte Objekt',
  z.length === 1 && z[0].includes('Werkhof Nord'));
check('Der Hinweis sagt, dass gefiltert wird', (await info()).includes('von 3 Zeilen'));

await page.selectOption('#mxBeleg', 'voll');
await page.waitForTimeout(400);
z = await zeilen();
check('„Nur vollständig besetzte“ zeigt genau das volle Objekt',
  z.length === 1 && z[0].includes('Muster Center'));

await page.selectOption('#mxBeleg', 'ohne');
await page.waitForTimeout(400);
z = await zeilen();
check('„Nur ohne Einsätze“ zeigt das Objekt ohne jede Planung',
  z.length === 1 && z[0].includes('Lagerhalle Sued'));

// Ein Filter, auf den nichts passt, muss das erklaeren statt leer zu wirken.
await page.fill('#mxVon', t(3));
await page.fill('#mxBis', t(4));
await page.waitForTimeout(400);
await page.selectOption('#mxBeleg', 'luecke');
await page.waitForTimeout(400);
check('Passt nichts zum Filter, wird das erklärt statt einfach leer zu bleiben',
  (await page.textContent('#mxTable')).includes('Kein Objekt passt zum Filter'));

await page.selectOption('#mxBeleg', '');
await page.selectOption('#mxSchnell', 'monat');
await page.waitForTimeout(400);

// ══════════════════════════════════════════ FILTER: EINZELNES OBJEKT
check('Jedes Objekt steht im Auswahlfeld',
  (await page.evaluate(() => document.getElementById('mxObj').options.length)) === 5);
await page.selectOption('#mxObj', 'o2');
await page.waitForTimeout(400);
z = await zeilen();
check('Ein einzelnes Objekt lässt sich gezielt anzeigen',
  z.length === 1 && z[0].includes('Werkhof Nord'));
check('Die Tagesspalten bleiben dabei erhalten', (await spalten()) === tageImMonat);

// Beide Filter zusammen duerfen sich nicht gegenseitig aufheben.
await page.selectOption('#mxBeleg', 'voll');
await page.waitForTimeout(400);
check('Beide Filter greifen zusammen: Werkhof ist nicht voll besetzt',
  (await page.textContent('#mxTable')).includes('Kein Objekt passt zum Filter'));

await page.selectOption('#mxObj', '');
await page.selectOption('#mxBeleg', '');
await page.waitForTimeout(400);
check('Filter zurücksetzen bringt alle Zeilen wieder', (await zeilen()).length === 3);
await page.screenshot({ path: OUT + '/75-mx-filter.png' });

// ══════════════════════════════════════════ SUCHE (ENT-038)
await page.fill('#mxSuche', 'Lagerhalle');
await page.waitForTimeout(400);
z = await zeilen();
check('Die Suche findet ein Objekt über seinen Namen', z.length === 1 && z[0].includes('Lagerhalle Sued'));
await page.fill('#mxSuche', 'trimbach');
await page.waitForTimeout(400);
z = await zeilen();
check('Die Suche findet auch über den Ort (Gross-/Kleinschreibung egal)',
  z.length === 1 && z[0].includes('Lagerhalle Sued'));
check('Der Hinweis nennt die Suche', (await info()).includes('trimbach'));
// "p0" steckt sowohl bei Muster als auch bei Werkhof in der Zuteilung --
// "p1" kommt nur bei Muster vor (Einsatz 2, zwei Personen).
await page.fill('#mxSuche', 'p1');
await page.waitForTimeout(400);
z = await zeilen();
check('Die Suche findet auch über eine zugeteilte Person',
  z.length === 1 && z[0].includes('Muster Center'));
await page.fill('#mxSuche', 'niemand-passt-hier');
await page.waitForTimeout(400);
check('Eine erfolglose Suche erklärt sich, statt leer zu wirken',
  (await page.textContent('#mxTable')).includes('Kein Objekt passt zum Filter'));
await page.fill('#mxSuche', '');
await page.waitForTimeout(400);
check('Leere Suche zeigt wieder alles', (await zeilen()).length === 3);

// ══════════════════════════════════════════ RASTER: FELDER GANZ GEFÜLLT (ENT-035)
// Gemessen statt geglaubt: die Farbfläche muss das Feld wirklich ausfüllen.
const fuellung = await page.evaluate(() => {
  const td = [...document.querySelectorAll('#mxTable td.d')].find(x => x.classList.contains('z-voll'));
  if (!td) return null;
  const knopf = td.querySelector('.zelle');
  const r = td.getBoundingClientRect(), k = knopf.getBoundingClientRect();
  const g = getComputedStyle(td), gk = getComputedStyle(knopf);
  return {
    tdBg: g.backgroundColor, knopfBg: gk.backgroundColor,
    padding: g.paddingTop + ' ' + g.paddingLeft,
    radius: gk.borderRadius,
    // clientWidth/Height: Inhaltsfläche ohne den Rahmen -- der Rahmen ist ja
    // gerade die gewünschte Rasterlinie und darf nicht als Lücke zählen.
    hoehe: Math.round(td.clientHeight), knopfHoehe: Math.round(k.height),
    breite: Math.round(td.clientWidth), knopfBreite: Math.round(k.width),
    rechts: g.borderRightWidth, unten: g.borderBottomWidth,
  };
});
check('Ein voll besetztes Feld ist auffindbar', !!fuellung);
check('Das Tagesfeld selbst trägt die Farbe, nicht nur der Knopf',
  fuellung.tdBg !== 'rgba(0, 0, 0, 0)' && fuellung.tdBg === fuellung.knopfBg);
check('Kein Innenabstand mehr, der als Rand stehen bliebe', fuellung.padding === '0px 0px');
check('Die Farbfläche füllt das Feld auf ganzer Breite',
  fuellung.knopfBreite === fuellung.breite);
check('Die Farbfläche füllt das Feld auf ganzer Höhe',
  fuellung.knopfHoehe === fuellung.hoehe);
check('Keine abgerundeten Ecken mehr — die Felder stossen aneinander',
  fuellung.radius === '0px');
check('Feine senkrechte Linie zwischen den Tagen', fuellung.rechts === '1px');
check('Feine waagrechte Linie zwischen den Zeilen', fuellung.unten === '1px');

// ── Die Linie muss auch AUF den gefärbten Feldern zu sehen sein (ENT-036).
// Gemessen wird, was nach dem Überblenden der halbdurchsichtigen Linie über
// die Feldfarbe herauskommt -- eine deckende Linie in Flächenfarbe waere
// unsichtbar, und genau das war vorher der Fall.
const linienProbe = async () => page.evaluate(() => {
  const zahl = s => (s.match(/[\d.]+/g) || []).map(Number);
  const mischen = (linie, grund) => {
    const l = zahl(linie), g = zahl(grund);
    const a = l.length > 3 ? l[3] : 1;
    return [0, 1, 2].map(i => l[i] * a + g[i] * (1 - a));
  };
  // Wahrnehmbare Helligkeit nach WCAG
  const leucht = ([r, g, b]) => {
    const f = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
    return .2126 * f(r) + .7152 * f(g) + .0722 * f(b);
  };
  const kontrast = (a, b) => {
    const [h, d] = [leucht(a), leucht(b)].sort((x, y) => y - x);
    return (h + .05) / (d + .05);
  };
  const messe = k => {
    const td = [...document.querySelectorAll('#mxTable td.d')].find(x => x.classList.contains(k));
    if (!td) return null;
    const s = getComputedStyle(td);
    const grund = s.backgroundColor;
    const linie = s.borderRightColor;
    // Halbdurchsichtig? Sonst kann die Linie auf keinem Grund funktionieren.
    const alpha = zahl(linie).length > 3 ? zahl(linie)[3] : 1;
    return { alpha, kontrast: kontrast(mischen(linie, grund), zahl(grund)) };
  };
  return { voll: messe('z-voll'), teil: messe('z-teil'), leer: messe('z-leer'),
    prov: messe('z-prov'), ab: messe('z-ab'), nix: messe('z-nix') };
});

const hell = await linienProbe();
for (const [name, m] of Object.entries(hell)) {
  check(`Hell: die Linie ist auf „${name}“ halbdurchsichtig`, m && m.alpha > 0.05 && m.alpha < 0.5);
  check(`Hell: die Linie hebt sich auf „${name}“ sichtbar ab`, m && m.kontrast >= 1.12);
}

await page.evaluate(() => themaUm());
await page.waitForTimeout(400);
const dunkel = await linienProbe();
for (const [name, m] of Object.entries(dunkel)) {
  check(`Dunkel: die Linie ist auf „${name}“ halbdurchsichtig`, m && m.alpha > 0.05 && m.alpha < 0.5);
  check(`Dunkel: die Linie hebt sich auf „${name}“ sichtbar ab`, m && m.kontrast >= 1.12);
}
await page.screenshot({ path: OUT + '/81-mx-raster-dunkel.png' });
await page.evaluate(() => themaUm());
await page.waitForTimeout(400);

// Leere Tage duerfen die Wochenendtoenung weiterhin durchscheinen lassen --
// sonst waere die Woche im Raster nicht mehr ablesbar.
const weLeer = await page.evaluate(() => {
  const td = [...document.querySelectorAll('#mxTable td.d.we')].find(x => x.classList.contains('z-nix'));
  return td ? getComputedStyle(td).backgroundColor : null;
});
check('Ein leeres Wochenendfeld behält seine Tönung',
  weLeer && weLeer !== 'rgba(0, 0, 0, 0)');

// Die Farben selbst duerfen sich nicht veraendert haben.
const farben = await page.evaluate(() => {
  const holen = k => {
    const td = [...document.querySelectorAll('#mxTable td.d')].find(x => x.classList.contains(k));
    return td ? getComputedStyle(td).backgroundColor : null;
  };
  const p = getComputedStyle(document.documentElement);
  return { voll: holen('z-voll'), teil: holen('z-teil'),
    posSoft: p.getPropertyValue('--pos-soft').trim(), warnSoft: p.getPropertyValue('--warn-soft').trim() };
});
const alsRgb = async hex => page.evaluate(h => {
  const d = document.createElement('div'); d.style.backgroundColor = h;
  document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c;
}, hex);
check('„Voll besetzt“ hat unverändert die Farbe --pos-soft',
  farben.voll === await alsRgb(farben.posSoft));
check('„Teilweise besetzt“ hat unverändert die Farbe --warn-soft',
  farben.teil === await alsRgb(farben.warnSoft));
await page.screenshot({ path: OUT + '/77-mx-raster.png' });

// ══════════════════════════════════════════ SPARTEN STRIKT GETRENNT (ENT-037)
// Der Baustellenfall: dasselbe Objekt trägt Sicherheit und Reinigung, zeitweise
// parallel. Beides muss als eigene Spur erscheinen, nicht vermischt.
await page.evaluate(() => {
  const heute = new Date();
  const M = new Date(heute.getTime() - heute.getTimezoneOffset() * 6e4).toISOString().slice(0, 7);
  const t = n => `${M}-${String(n).padStart(2, '0')}`;
  const ma = n => Array.from({ length: n }, (_, i) => ({ id: 90 + i, name: 'r' + i, vorname: 'R', nachname: String(i), zusage: 'ja' }));
  // Muster (Objekt 1) bekommt zusätzlich Reinigung -- am 3. sogar parallel
  // zur bereits vorhandenen Sicherheitsschicht.
  einsaetze.push(
    { id: 201, objekt_id: 1, kunde_name: 'Beispiel AG', titel: 'Endreinigung', ort: 'Olten',
      datum: t(3), von: '07:00:00', bis: '11:00:00', bedarf: 2, status: 'geplant',
      sparte: 'reinigung', mitarbeiter: ma(2) },
    { id: 202, objekt_id: 1, kunde_name: 'Beispiel AG', titel: 'Endreinigung', ort: 'Olten',
      datum: t(10), von: '07:00:00', bis: '11:00:00', bedarf: 3, status: 'geplant',
      sparte: 'reinigung', mitarbeiter: ma(1) });
  renderMatrix();
});
await page.waitForTimeout(400);

check('Es gibt einen Sparten-Filter', await page.isVisible('#mxSparte'));
check('Er bietet beide Sparten und „beide“ an',
  (await page.evaluate(() => [...document.getElementById('mxSparte').options].map(o => o.value))).join(',') === ',sicherheit,reinigung');

let zz = await zeilen();
check('Das Objekt mit beiden Sparten bekommt zwei getrennte Zeilen',
  zz.filter(x => x.includes('Muster Center')).length === 2);
check('Die Reinigungsspur ist als solche gekennzeichnet',
  zz.some(x => x.includes('Muster Center') && x.includes('Reinigung')));
check('Die Sicherheitsspur ist ebenfalls gekennzeichnet, wenn beide da sind',
  zz.some(x => x.includes('Muster Center') && x.includes('Sicherheit')));
check('Objekte mit nur einer Sparte tragen keine überflüssige Marke',
  zz.some(x => x.includes('Werkhof Nord') && !x.includes('Sicherheit')));

// Die Zahlen dürfen sich zwischen den Spuren nicht vermischen.
const spurZahlen = async (name, sparte) => page.evaluate(([n, sp]) => {
  const tr = [...document.querySelectorAll('#mxTable tbody tr')].find(r => {
    const t = r.querySelector('td.obj').textContent;
    return t.includes(n) && (sp ? t.includes(sp) : true);
  });
  return tr ? [...tr.querySelectorAll('td.d .zelle')].map(z => z.textContent.trim()).filter(x => x !== '·').join(',') : null;
}, [name, sparte]);
check('Die Sicherheitsspur zeigt nur ihre eigenen Zahlen',
  (await spurZahlen('Muster Center', 'Sicherheit')) === '1,2');
check('Die Reinigungsspur zeigt nur ihre eigenen Zahlen',
  (await spurZahlen('Muster Center', 'Reinigung')) === '2,1');

// ── Filter auf eine Sparte
await page.selectOption('#mxSparte', 'reinigung');
await page.waitForTimeout(400);
zz = await zeilen();
check('„Nur Reinigung“ zeigt genau die eine Reinigungsspur', zz.length === 1);
check('… und zwar die von Muster', zz[0].includes('Muster Center'));
check('Der Hinweis nennt die gewählte Sparte', (await info()).includes('nur'));
check('Reine Sicherheitsobjekte fallen weg',
  !(await page.textContent('#mxTable')).includes('Werkhof Nord'));

await page.selectOption('#mxSparte', 'sicherheit');
await page.waitForTimeout(400);
zz = await zeilen();
check('„Nur Sicherheit“ blendet die Reinigungsspur aus',
  zz.filter(x => x.includes('Muster Center')).length === 1);
check('… und die verbleibende Muster-Zeile ist die Sicherheitsspur',
  (await spurZahlen('Muster Center', null)) === '1,2');
check('Die reinen Sicherheitsobjekte sind wieder da',
  (await page.textContent('#mxTable')).includes('Werkhof Nord'));

// ── Sparte und Belegung greifen zusammen
await page.selectOption('#mxSparte', 'reinigung');
await page.selectOption('#mxBeleg', 'voll');
await page.waitForTimeout(400);
check('Sparte und Belegung zusammen: die Reinigungsspur hat eine Lücke am 10.',
  (await page.textContent('#mxTable')).includes('Kein Objekt passt zum Filter'));
await page.selectOption('#mxBeleg', 'luecke');
await page.waitForTimeout(400);
check('Als „mit Lücken“ wird sie gefunden', (await zeilen()).length === 1);

await page.selectOption('#mxBeleg', '');
await page.selectOption('#mxSparte', '');
await page.waitForTimeout(400);
check('Beide Filter zurückgesetzt: alle Spuren wieder da', (await zeilen()).length === 4);
await page.screenshot({ path: OUT + '/82-mx-sparten.png' });

// Aufräumen, damit die folgenden Prüfungen auf dem alten Stand aufsetzen
await page.evaluate(() => { einsaetze = einsaetze.filter(e => e.id < 200); renderMatrix(); });
await page.waitForTimeout(300);

// ══════════════════════════════════════════ DIE ZELLEN FUNKTIONIEREN WEITER
await page.click(`#mxTable .zelle.z-voll`);
await page.waitForTimeout(400);
check('Ein Klick auf eine Zelle führt weiterhin in den Tagesplan',
  await page.evaluate(() => document.getElementById('pv-tag').classList.contains('on')));

// ══════════════════════════════════════════ AUF DEM HANDY
// Bis ENT-057 wurde hier geprueft, dass Zeitraum und Filter der Monatsmatrix
// auch auf 390 px erreichbar sind. Die Matrix gibt es dort nicht mehr -- ein
// Raster mit einer Zeile je Objekt ist auf einem Handy nicht lesbar. Geprueft
// wird jetzt, dass der Aufruf im Tagesplan landet und die Filter am Desktop
// unveraendert da sind.
await page.setViewportSize({ width: 390, height: 850 });
await page.evaluate(() => goTab('uebersicht'));
await page.waitForTimeout(500);
// Seit ENT-058 landet man dabei in der Einsatzliste (Kartenoptik, Filter).
check('KRITISCH: auf dem Handy fuehrt die Monatsuebersicht in die Einsatzliste',
  await page.evaluate(() => document.getElementById('pv-einsaetze').classList.contains('on')));
check('Kein waagrechtes Schieben der ganzen Seite bei 390px',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await page.setViewportSize({ width: 1600, height: 1000 });
await page.waitForTimeout(300);
await page.evaluate(() => goTab('uebersicht'));
await page.waitForTimeout(500);
check('Am Desktop ist der Zeitraum weiterhin erreichbar', await page.isVisible('#mxVon'));
check('Am Desktop sind die Filter weiterhin erreichbar', await page.isVisible('#mxBeleg'));
await page.setViewportSize({ width: 390, height: 850 });
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '/76-mx-mobil.png' });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
