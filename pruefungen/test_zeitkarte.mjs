// Datum & Zeit und das Kontomenue am Logo (ENT-410).
//
// Beides kam mit derselben Ansage des Projektinhabers: Die Begruessung nahm
// die ganze Breite ein, daneben soll die Kalenderwoche stehen; das Logo
// wandert nach rechts aussen, und die Symbole, die dort standen, klappen
// darunter auf.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });

// Anordnung vorbelegen? Dann kommt sie in den Speicher, BEVOR die Seite
// laedt -- der Umzug aus ENT-410 soll sie ja gerade beim Laden vorfinden.
async function seite(breite = 1600, vorbelegt, umzugSchonGelaufen = false) {
  const p = await browser.newPage({ viewport: { width: breite, height: 1000 } });
  p.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  if (vorbelegt !== undefined) {
    await p.addInitScript(v => { try { localStorage.setItem('rv3_dash_layout', v); } catch (e) {} }, vorbelegt);
  }
  if (umzugSchonGelaufen) {
    await p.addInitScript(() => { try { localStorage.setItem('rv3_dash_zeit_umzug', '1'); } catch (e) {} });
  }
  await p.route('**/api/**', r => {
    const u = r.request().url();
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'a.muster', ist_admin: true });
    if (u.includes('dashboard_stats')) return send({ status: 'ok',
      kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0,
             mitarbeiter: 1, kunden: 1, rapporte_total: 0 },
      verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
    return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [],
      mitarbeiter: [], feiertage: [], gepflegt: {}, sperren: [] });
  });
  await p.goto(`file://${WURZEL}/dashboard.html`);
  await p.fill('#gName', 'a'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(400);
  return p;
}

// ══════════════════════════════ DIE KARTE ZEIGT, WAS SIE SOLL
try {
  const p = await seite();
  const w = await p.evaluate(() => ({
    kw: document.getElementById('zeitKw').textContent.trim(),
    spanne: document.getElementById('zeitSpanne').textContent.trim(),
    datum: document.getElementById('zeitDatum').textContent.trim(),
    uhr: document.getElementById('zeitUhr').textContent.trim(),
  }));

  // Die Wochenzahl wird NICHT aus dem Dashboard uebernommen, sondern hier
  // unabhaengig gerechnet -- und bewusst anders herum als dort: kalenderwoche()
  // geht ueber den Donnerstag der Woche, diese Rechnung ueber den Montag der
  // Woche, die den 4. Januar enthaelt (nach ISO 8601 immer die Woche 1).
  // Beide muessen dasselbe Ergebnis liefern. Schriebe die Pruefung die
  // Formel des Dashboards ab, waere sie auch dann gruen, wenn beide
  // gemeinsam falsch rechnen.
  const jetzt = new Date();
  const montagVon = d => { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };
  const mo = montagVon(jetzt);
  // Das Jahr der Woche ist das Jahr ihres Donnerstags, nicht das ihres Montags.
  const do_ = new Date(mo); do_.setDate(do_.getDate() + 3);
  const wocheEins = montagVon(new Date(do_.getFullYear(), 0, 4));
  const sollKw = Math.round((mo - wocheEins) / (7 * 864e5)) + 1;
  check('KRITISCH: die Kalenderwoche stimmt mit einer unabhaengigen Rechnung ueberein',
    Number(w.kw) === sollKw);
  check('Sie steht als blosse Zahl da, ohne "KW" davor', /^\d{1,2}$/.test(w.kw));

  // Die Spanne muss den heutigen Tag einschliessen -- ohne Bezug ist eine
  // Wochenzahl nur eine Zahl.
  const so = new Date(mo); so.setDate(so.getDate() + 6);
  check('Die Wochenspanne nennt den Montag dieser Woche', w.spanne.startsWith(mo.getDate() + '.'));
  check('Und endet am Sonntag', new RegExp(`\\b${so.getDate()}\\.`).test(w.spanne.split('–')[1]));
  check('Sie nennt ein Jahr, damit die Woche datiert ist', /\b20\d\d$/.test(w.spanne));

  check('Das Datum nennt den Wochentag',
    ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
      .some(t => w.datum.startsWith(t)));
  check('KRITISCH: und es ist der heutige Tag',
    w.datum.includes(jetzt.getDate() + '.') && w.datum.includes(String(jetzt.getFullYear())));
  check('Die Uhrzeit steht als HH:MM da', /^\d{2}:\d{2}$/.test(w.uhr));
  check('KRITISCH: die Uhrzeit ist die jetzige, nicht irgendeine',
    Math.abs((Number(w.uhr.slice(0, 2)) * 60 + Number(w.uhr.slice(3)))
      - (jetzt.getHours() * 60 + jetzt.getMinutes())) <= 2);
  check('Keine Sekunden -- eine Ziffer, die jede Sekunde springt, zieht den Blick weg',
    !/\d{2}:\d{2}:\d{2}/.test(w.uhr));
  await p.close();
} catch (e) { bad.push('Inhalt: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ DIE WOCHENSPANNE UEBER MONATS- UND JAHRESGRENZEN
//
// Feste Daten, aber weit von heute weg (2021) -- sie werden nie mit "heute"
// verglichen, sondern nur formatiert. Genau die Faelle, die man von Hand
// selten nachstellt und die deshalb lange falsch bleiben.
try {
  const p = await seite();
  const f = await p.evaluate(() => ({
    imMonat: zeitSpanne(new Date(2021, 8, 6), new Date(2021, 8, 12)),
    ueberMonat: zeitSpanne(new Date(2021, 8, 27), new Date(2021, 9, 3)),
    ueberJahr: zeitSpanne(new Date(2021, 11, 27), new Date(2022, 0, 2)),
  }));
  check('Innerhalb eines Monats steht der Monat nur einmal',
    f.imMonat === '6. – 12. September 2021');
  check('KRITISCH: ueber den Monatswechsel stehen beide Monate',
    f.ueberMonat === '27. September – 3. Oktober 2021');
  check('KRITISCH: ueber den Jahreswechsel stehen beide Jahre',
    f.ueberJahr === '27. Dezember 2021 – 2. Januar 2022');
  await p.close();
} catch (e) { bad.push('Wochenspanne: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ GESTALTUNG: UEBERSCHRIFT OBEN, WERT DARUNTER
try {
  const p = await seite();
  const g = await p.evaluate(() => {
    const zeilen = [...document.querySelectorAll('.zeit-zeile')].map(z => {
      const l = z.querySelector('.lb').getBoundingClientRect();
      const v = z.querySelector('.wert').getBoundingClientRect();
      return { lblOben: l.bottom <= v.top + 1,
               lblKlein: parseFloat(getComputedStyle(z.querySelector('.lb')).fontSize),
               wertGross: parseFloat(getComputedStyle(z.querySelector('.wert')).fontSize),
               versal: getComputedStyle(z.querySelector('.lb')).textTransform };
    });
    const karte = document.querySelector('.zeit-karte').getBoundingClientRect();
    const letzte = [...document.querySelectorAll('.zeit-zeile')].pop().getBoundingClientRect();
    return { zeilen, ueberlauf: letzte.bottom - karte.bottom };
  });
  check('Es sind drei Zeilen: Woche, Tag, Uhrzeit', g.zeilen.length === 3);
  check('KRITISCH: in jeder Zeile steht die Ueberschrift ueber dem Wert',
    g.zeilen.every(z => z.lblOben));
  check('Die Ueberschrift ist kleiner als der Wert', g.zeilen.every(z => z.lblKlein < z.wertGross));
  check('Und versal gesetzt, wie ueberall sonst', g.zeilen.every(z => z.versal === 'uppercase'));
  check('KRITISCH: nichts laeuft unten aus der Karte heraus', g.ueberlauf <= 1);
  await p.screenshot({ path: OUT + '/90-zeitkarte.png',
    clip: { x: 800, y: 130, width: 790, height: 340 } });
  await p.close();
} catch (e) { bad.push('Gestaltung: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ AM HANDY NICHT
//
// Entscheid des Projektinhabers: Kalenderwoche, Datum und Uhrzeit stehen auf
// dem Handy schon in der Statusleiste des Geraets. Der Container bleibt in
// der Liste -- ausgeblendet ist nur die Anzeige, nicht der Container.
try {
  const p = await seite(390);
  check('KRITISCH: am Handy steht die Karte nicht in der Uebersicht',
    !(await p.isVisible('.dash-item[data-widget="zeit"]')));
  check('Der Container bleibt aber in der Liste, damit die Anordnung nicht verrutscht',
    await p.evaluate(() => DASH_WIDGETS.some(w => w.id === 'zeit')
      && !!document.querySelector('.dash-item[data-widget="zeit"]')));
  await p.setViewportSize({ width: 1500, height: 1000 });
  await p.waitForTimeout(300);
  check('KRITISCH: am Desktop ist sie da — "ausgeblendet" heisst nicht "weg"',
    await p.isVisible('.dash-item[data-widget="zeit"]'));
  await p.close();
} catch (e) { bad.push('Handy: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ DER EINMALIGE UMZUG GESPEICHERTER ANORDNUNGEN
//
// Wer die Uebersicht schon einmal angepasst hat, hat die Begruessung meist
// auf voller Breite stehen. Ein neuer Container reiht sich laut
// ordAbgleichen() ganz hinten ein -- ohne Umzug landete "Datum & Zeit" also
// unter allem anderen, waehrend oben weiter die breite Begruessung stuende.
try {
  const alt = JSON.stringify([
    { id: 'begruessung', sichtbar: true, breite: 'voll' },
    { id: 'kpi', sichtbar: true, breite: 'voll' },
    { id: 'letzte', sichtbar: true },
  ]);
  const p = await seite(1600, alt);
  const nach = await p.evaluate(() => ordStand('uebersicht').map(x => ({ id: x.id, breite: x.breite })));
  const i = nach.findIndex(x => x.id === 'begruessung');
  check('KRITISCH: die Begruessung steht danach auf halber Breite',
    nach[i] && nach[i].breite === 'halb');
  check('KRITISCH: und "Datum & Zeit" direkt daneben, nicht am Ende der Liste',
    nach[i + 1] && nach[i + 1].id === 'zeit' && nach[i + 1].breite === 'halb');
  const nebeneinander = await p.evaluate(() => {
    const r = w => document.querySelector(`[data-widget="${w}"]`).getBoundingClientRect();
    return Math.abs(r('begruessung').top - r('zeit').top) < 1 && r('zeit').left >= r('begruessung').right - 1;
  });
  check('KRITISCH: gemessen stehen die beiden auch wirklich nebeneinander', nebeneinander);
  check('Die uebrige Anordnung bleibt, wie sie war',
    nach.filter(x => x.id === 'kpi')[0].breite === 'voll'
    && nach.findIndex(x => x.id === 'kpi') > i + 1);

  // Gegenprobe: Ist der Umzug einmal gelaufen, greift er nicht noch einmal.
  // Sonst spraenge jede spaeter von Hand gesetzte Breite bei jedem Laden
  // zurueck -- und der Benutzer haette keinen Anhaltspunkt warum.
  const p2 = await seite(1600, JSON.stringify([
    { id: 'begruessung', sichtbar: true, breite: 'voll' },
    { id: 'zeit', sichtbar: true, breite: 'voll' },
  ]), true);
  const nach2 = await p2.evaluate(() => ordStand('uebersicht').map(x => ({ id: x.id, breite: x.breite })));
  check('KRITISCH: ein zweites Mal zieht der Umzug nicht mehr um',
    nach2[0].id === 'begruessung' && nach2[0].breite === 'voll');
  await p.close(); await p2.close();
} catch (e) { bad.push('Umzug: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ DAS KONTOMENUE AM LOGO
try {
  const p = await seite();
  await p.evaluate(() => huelleSetzen('aus'));
  await p.waitForTimeout(300);

  const zu = await p.evaluate(() => ({
    anzeige: getComputedStyle(document.querySelector('#sideFoot')).display,
    aria: document.getElementById('btnMarke').getAttribute('aria-expanded'),
  }));
  check('Zu Beginn ist das Menue geschlossen', zu.anzeige === 'none' && zu.aria === 'false');

  await p.click('#btnMarke'); await p.waitForTimeout(200);
  const auf = await p.evaluate(() => {
    const f = document.querySelector('#sideFoot');
    return { anzeige: getComputedStyle(f).display,
             aria: document.getElementById('btnMarke').getAttribute('aria-expanded'),
             // Reihenfolge auf dem Bildschirm, nicht im Markup: Der
             // Benutzerblock steht oben, das Abmelden unten -- gemacht mit
             // "order", damit das Markup und mit ihm test_wege.mjs stehen
             // bleiben konnte.
             reihe: [...f.children].filter(e => e.getBoundingClientRect().height > 0)
               .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
               .map(e => e.id || e.className) };
  });
  check('KRITISCH: ein Klick aufs Logo oeffnet es', auf.anzeige !== 'none' && auf.aria === 'true');
  check('KRITISCH: alle vier Eintraege der alten Symbolreihe sind darin',
    ['side-user', 'nav-einrichtung', 'nav-zurapp', 'nav-abmelden']
      .every(x => auf.reihe.some(r => r.includes(x))));
  check('Der Benutzerblock steht oben', auf.reihe[0].includes('side-user'));
  check('Und das Abmelden zuunterst', auf.reihe[auf.reihe.length - 1].includes('nav-abmelden'));
  check('Es traegt Namen und Rolle, nicht nur das Kuerzel',
    await p.evaluate(() => document.querySelector('#sideFoot .side-user .who')
      .getBoundingClientRect().height > 0));

  // Danebentippen, Escape und ein Klick IM Menue schliessen alle drei.
  await p.mouse.click(400, 500); await p.waitForTimeout(200);
  check('KRITISCH: danebentippen schliesst es',
    await p.evaluate(() => getComputedStyle(document.querySelector('#sideFoot')).display === 'none'));
  await p.click('#btnMarke'); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  check('Escape schliesst es ebenfalls',
    await p.evaluate(() => getComputedStyle(document.querySelector('#sideFoot')).display === 'none'));
  await p.click('#btnMarke'); await p.waitForTimeout(150);
  await p.click('#sideFoot #nav-einrichtung'); await p.waitForTimeout(250);
  check('KRITISCH: nach der Wahl eines Eintrags steht es nicht offen und verdeckt das Ergebnis',
    await p.evaluate(() => getComputedStyle(document.querySelector('#sideFoot')).display === 'none'));
  await p.evaluate(() => closeDlg('dlgEinrichtung'));

  // In den beiden Seitenleisten-Zustaenden steht der Fussteil ohnehin
  // sichtbar da. Ein Menue waere dort ein zweiter Weg zum selben Ziel --
  // der Knopf tut deshalb nichts, statt eine Klasse zu setzen, die man
  // nirgends sieht.
  await p.evaluate(() => huelleSetzen('voll')); await p.waitForTimeout(250);
  await p.click('#btnMarke'); await p.waitForTimeout(200);
  const inLeiste = await p.evaluate(() => ({
    klasse: document.getElementById('shell').classList.contains('menue-offen'),
    fussDa: document.querySelector('#sideFoot').getBoundingClientRect().height > 0,
  }));
  check('KRITISCH: in der Seitenleiste oeffnet das Logo kein zweites Menue', !inLeiste.klasse);
  check('Dort steht der Fussteil ohnehin sichtbar da', inLeiste.fussDa);

  // Und beim Wechsel zurueck bleibt kein offener Zustand haengen.
  await p.evaluate(() => huelleSetzen('aus')); await p.waitForTimeout(250);
  await p.click('#btnMarke'); await p.waitForTimeout(200);
  await p.evaluate(() => huelleSetzen('schmal')); await p.waitForTimeout(250);
  check('KRITISCH: ein Huellenwechsel laesst kein offenes Menue zurueck',
    await p.evaluate(() => !document.getElementById('shell').classList.contains('menue-offen')
      && document.getElementById('btnMarke').getAttribute('aria-expanded') === 'false'));
  await p.close();
} catch (e) { bad.push('Kontomenue: ' + String(e).split('\n')[0].slice(0, 120)); }

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
