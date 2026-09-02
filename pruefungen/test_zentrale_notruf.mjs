// Zentrale und Notruf im Einsatzmodus (ENT-299).
//
// Der Projektinhaber: der Waechter soll bei einem Vorfall telefonisch
// eingreifen koennen -- "abgesehen von 117 und 118 wo man hinzufuegen
// koennte". Entschieden: eigene Zentrale zuoberst, Notruf darunter. Die
// Zentralnummer kommt aus den Betrieb-Stammdaten, nicht aus dem Quelltext.
//
// Die beiden Punkte, auf die es hier ankommt:
//  1. Die Pikettnummer ist eine EIGENE Angabe, nicht die Buero-Nummer vom
//     Briefkopf. Wer nachts anruft, muss jemanden erreichen. Es gibt darum
//     KEINEN stillen Rueckfall von pikett_telefon auf telefon -- ohne
//     gepflegte Pikettnummer erscheint gar keine Zentrale.
//  2. Die Notrufnummern sind fest und nicht pflegbar: gesetzlich vorgegeben,
//     fuer jeden Betrieb dieselben (CLAUDE.md).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: tag(-1), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Musterobjekt Industrie', objekt_id: 7,
    hat_kontrollpunkte: true, im_team: 1 },
]};

const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

const VORLAGEN_ALLE = [
  { id: 701, name: 'Runde mit Zentrale', objekt_id: 7, objekt_name: 'Musterobjekt Industrie',
    kunde_name: 'Musterliegenschaften AG', fenster_von: null, fenster_bis: null },
  { id: 702, name: 'Runde ohne Zentrale', objekt_id: 7, objekt_name: 'Musterobjekt Industrie',
    kunde_name: 'Musterliegenschaften AG', fenster_von: null, fenster_bis: null },
];

const objekt = { id: 7, name: 'Musterobjekt Industrie', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
  kanton: 'SO', bemerkung: null };
const punkte = [{ id: 1, bezeichnung: 'Eingang Nord', typ: 'geofence' }];

const UEBERSICHT = {
  701: { status: 'ok',
    vorlage: { id: 701, name: 'Runde mit Zentrale', fenster_von: null, fenster_bis: null },
    objekt, kunde_name: 'Musterliegenschaften AG', kontrollpunkte: punkte,
    ansprechpartner: [{ name: 'Vreni Beispiel', anrede: 'Frau',
      wege: [{ art: 'telefon', wert: '062 000 00 00' }] }],
    laufend: null,
    // Nummer mit Leerzeichen -- sie muss lesbar bleiben UND als Wahlziel
    // ohne Leerzeichen ankommen.
    zentrale: { name: 'Musterbetrieb GmbH', telefon: '079 111 22 33' } },
  702: { status: 'ok',
    vorlage: { id: 702, name: 'Runde ohne Zentrale', fenster_von: null, fenster_bis: null },
    objekt, kunde_name: 'Musterliegenschaften AG', kontrollpunkte: punkte,
    ansprechpartner: [], laufend: null, zentrale: null },
};

let rufe = [];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const url = new URL(route.request().url());
  const p = url.pathname.split('/api/')[1];
  rufe.push({ p, query: Object.fromEntries(url.searchParams) });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: null });
  if (p.includes('mein_rundgang_uebersicht')) {
    return send(UEBERSICHT[Number(url.searchParams.get('vorlage_id'))] || { status: 'error', message: 'unbekannt' });
  }
  if (p.includes('mein_rundgang_vorlagen_alle')) return send({ status: 'ok', vorlagen: VORLAGEN_ALLE });
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

const oeffne = async name => {
  await page.evaluate(() => { blattZu(); rgSeiteZu(); });
  await page.evaluate(() => rundgangUebersichtOeffnen());
  await page.waitForTimeout(300);
  await page.click(`#blBody button:has-text("${name}")`);
  await page.waitForTimeout(400);
};

// ══════════ MIT GEPFLEGTER ZENTRALE ═══════════════════════════════════
await oeffne('Runde mit Zentrale');
check('KRITISCH: die eigene Zentrale steht mit ihrer Nummer da',
  await page.isVisible('#rgsZentrale')
  && (await page.textContent('#rgsZentrale')).includes('079 111 22 33'));
check('Der Betriebsname steht dabei, damit klar ist, wen man anruft',
  (await page.textContent('#rgsZentrale')).includes('Musterbetrieb GmbH'));
check('KRITISCH: sie ist ein Anruf-Ziel, mit der Nummer ohne Leerzeichen',
  await page.evaluate(() => document.getElementById('rgsZentrale').getAttribute('href') === 'tel:0791112233'));
check('KRITISCH: Beschriftung steht ÜBER der Nummer, nicht darunter (CLAUDE.md)',
  await page.evaluate(() => document.querySelector('.rgs-zentrale-lb').getBoundingClientRect().top
    < document.querySelector('.rgs-zentrale-nr').getBoundingClientRect().top));

// ══════════ NOTRUF: FEST, VOLLSTÄNDIG, DARUNTER ═══════════════════════
const notruf = await page.evaluate(() => [...document.querySelectorAll('#rgsNotruf a')]
  .map(a => ({ href: a.getAttribute('href'), text: a.textContent, h: a.getBoundingClientRect().height })));
check('KRITISCH: die drei Schweizer Notrufnummern stehen da -- 117, 118, 144',
  notruf.length === 3 && notruf[0].href === 'tel:117'
  && notruf[1].href === 'tel:118' && notruf[2].href === 'tel:144');
check('Jede Nummer trägt ihr Wort, nicht nur die Ziffern',
  notruf[0].text.includes('Polizei') && notruf[1].text.includes('Feuerwehr')
  && notruf[2].text.includes('Sanität'));
check('KRITISCH: jede Notruf-Kachel ist mindestens 44px hoch (CLAUDE.md)',
  notruf.every(n => n.h >= 44));
check('KRITISCH: die eigene Zentrale steht ÜBER dem Notruf -- so vom Projektinhaber entschieden (gemessen)',
  await page.evaluate(() => document.getElementById('rgsZentrale').getBoundingClientRect().top
    < document.getElementById('rgsNotruf').getBoundingClientRect().top));
check('Der ganze Block steht über den Funktionen, nicht darunter (gemessen)',
  await page.evaluate(() => document.getElementById('rgsNotruf').getBoundingClientRect().top
    < document.getElementById('rgsModKp').getBoundingClientRect().top));
check('Der Block braucht kein Aufklappen -- die Nummern sind sofort sichtbar',
  await page.isVisible('#rgsNotruf a'));
// Die beiden Beschriftungen teilen sich die Klasse .rgs-mod-lb. Beim Bauen
// hat genau das test_rundgang_pausieren.mjs rot gemacht: Dort griff ein
// Zugriff ueber die Klasse plötzlich die neue, weiter oben stehende
// Beschriftung. Beide tragen darum eine eigene ID -- und das wird hier
// festgehalten, damit die naechste Aenderung nicht denselben Weg geht.
check('KRITISCH: die beiden Beschriftungen sind eindeutig ansprechbar, nicht nur über die gemeinsame Klasse',
  (await page.textContent('#rgsHilfeLb')) === 'Zentrale und Notruf'
  && (await page.textContent('#rgsFunktionenLb')) === 'Funktionen');
check('Und "Zentrale und Notruf" steht dabei über "Funktionen" (gemessen)',
  await page.evaluate(() => document.getElementById('rgsHilfeLb').getBoundingClientRect().top
    < document.getElementById('rgsFunktionenLb').getBoundingClientRect().top));
check('Der Ansprechpartner-Block bleibt daneben zugeklappt -- er ist etwas anderes',
  await page.evaluate(() => getComputedStyle(document.querySelector('#rgsKlappAp .rgs-klapp-bd')).display === 'none'));
check('Zentrale und Notruf sind auch ohne Farbe unterscheidbar (eine breite Zeile gegen drei Kacheln)',
  await page.evaluate(() => {
    const z = document.getElementById('rgsZentrale').getBoundingClientRect();
    const k = document.querySelector('#rgsNotruf a').getBoundingClientRect();
    return z.width > k.width * 2;
  }));
await page.screenshot({ path: `${OUT}/zentrale-01-mobil.png` });

// ══════════ OHNE GEPFLEGTE ZENTRALE ═══════════════════════════════════
await oeffne('Runde ohne Zentrale');
check('KRITISCH: ohne gepflegte Pikettnummer erscheint KEINE Zentrale -- kein stiller Rückfall auf eine andere Nummer',
  !(await page.isVisible('#rgsZentrale')));
check('KRITISCH: stattdessen steht da, warum sie fehlt und wer sie einträgt -- nicht eine leere Fläche',
  await page.isVisible('#rgsKeineZentrale')
  && (await page.textContent('#rgsKeineZentrale')).includes('Betriebsdaten'));
check('KRITISCH: der Notruf bleibt trotzdem vollständig da -- er hängt an nichts Gepflegtem',
  await page.evaluate(() => document.querySelectorAll('#rgsNotruf a').length === 3));

// ══════════ KEIN SEITEN-SCROLL, DESKTOP MITGEPRÜFT ════════════════════
check('KRITISCH: kein waagrechter Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
check('Die drei Notruf-Kacheln sind gleich breit (CLAUDE.md: gleiches Muster nebeneinander)',
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#rgsNotruf a')].map(a => Math.round(a.getBoundingClientRect().width));
    return b.length === 3 && b[0] === b[1] && b[1] === b[2];
  }));

await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(250);
await oeffne('Runde mit Zentrale');
check('Am Desktop bleibt der Block innerhalb der App-Breite',
  await page.evaluate(() => {
    const n = document.getElementById('rgsNotruf').getBoundingClientRect();
    const s = document.getElementById('rgSeite').getBoundingClientRect();
    return n.width <= s.width && s.width <= 561;
  }));
check('Auch am Desktop sind die Kacheln gleich breit',
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#rgsNotruf a')].map(a => Math.round(a.getBoundingClientRect().width));
    return b[0] === b[1] && b[1] === b[2];
  }));
check('KRITISCH: am Desktop kein waagrechter Seiten-Scroll', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/zentrale-02-desktop.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
