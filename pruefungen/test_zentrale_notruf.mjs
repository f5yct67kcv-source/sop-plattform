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

// Seit ENT-335 ist "Zentrale und Notruf" ein Klappblock (Wunsch des
// Projektinhabers: "um mehr Uebersicht zu erzeugen"). Alles, was den INHALT
// des Blocks misst, muss ihn darum aufklappen -- das Klappverhalten selbst
// wird weiter unten eigens geprueft.
const oeffne = async name => {
  await page.evaluate(() => { blattZu(); rgSeiteZu(); });
  await page.evaluate(() => rundgangUebersichtOeffnen());
  await page.waitForTimeout(300);
  await page.click(`#blBody button:has-text("${name}")`);
  await page.waitForTimeout(400);
};
const hilfeAuf = async () => {
  const zu = await page.evaluate(() => {
    const k = document.getElementById('rgsKlappHilfe');
    return !!k && !k.classList.contains('auf');
  });
  if (zu) { try { await page.click('#rgsKlappHilfe .rgs-klapp-kopf', { timeout: 2500 }); } catch (e) {} }
  await page.waitForTimeout(250);
};

// ══════════ MIT GEPFLEGTER ZENTRALE ═══════════════════════════════════
await oeffne('Runde mit Zentrale');
await hilfeAuf();
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
// REVIDIERT durch ENT-335: Der Block klappt jetzt zu. Was bleibt -- und was
// hier an seine Stelle tritt -- ist der Grund hinter der alten Pruefung:
// Die Notrufnummern duerfen nicht VERSTECKT sein. Sie stehen darum im
// zugeklappten Kopf, lesbar ohne einen einzigen Tipp; getippt wird nur zum
// Waehlen. Das eigentliche Klappverhalten steht im eigenen Abschnitt unten.
check('KRITISCH: aufgeklappt sind die Nummern erreichbar',
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
await hilfeAuf();
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
await hilfeAuf();
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


// ══════════ ENT-335: KLAPPBLOCK, UND KEIN ZUSAMMENGEDRÜCKTER RUMPF ═════
// Vom Projektinhaber: "Ich [würde] die Zentrale und Alarmnummer ebenfalls
// ausklappbar machen, um mehr Übersicht zu erzeugen."
await page.evaluate(() => { try { localStorage.removeItem('sop_rundgang_hilfe_offen'); } catch (e) {} });
await oeffne('Runde mit Zentrale');
check('KRITISCH: der Block ist von sich aus zugeklappt',
  await page.evaluate(() => {
    const k = document.getElementById('rgsKlappHilfe');
    const bd = k && k.querySelector('.rgs-klapp-bd');
    return !!k && !k.classList.contains('auf') && !!bd && getComputedStyle(bd).display === 'none';
  }));
// Ein Klappblock, der verschweigt, was er verbirgt, waere bei NOTRUFNUMMERN
// das Falsche: Wer 117 braucht, darf nicht erst suchen muessen, wo sie
// stecken. Sie stehen darum lesbar im zugeklappten Kopf.
check('KRITISCH: die Notrufnummern stehen trotzdem lesbar im zugeklappten Kopf',
  await page.evaluate(() => {
    const z = document.querySelector('#rgsKlappHilfe .rgs-klapp-nr');
    if (!z) return false;
    const t = z.textContent;
    const r = z.getBoundingClientRect();
    return t.includes('117') && t.includes('118') && t.includes('144') && r.width > 0 && r.height > 0;
  }));
check('Und der Kopf sagt weiterhin, worum es geht',
  (await page.textContent('#rgsHilfeLb')) === 'Zentrale und Notruf');
check('Der Kopf ist mindestens 44px hoch (CLAUDE.md)',
  await page.evaluate(() => document.querySelector('#rgsKlappHilfe .rgs-klapp-kopf')
    .getBoundingClientRect().height >= 44));
await page.click('#rgsKlappHilfe .rgs-klapp-kopf');
await page.waitForTimeout(250);
check('KRITISCH: ein Tipp öffnet ihn und die Nummern sind wählbar',
  await page.isVisible('#rgsNotruf a') && await page.isVisible('#rgsZentrale'));
// Wer ihn offen laesst, soll ihn offen wiederfinden -- sonst muesste er vor
// jeder Runde erneut aufgeklappt werden.
await page.evaluate(() => { blattZu(); rgSeiteZu(); });
await oeffne('Runde mit Zentrale');
check('KRITISCH: die Wahl überdauert das Schliessen und erneute Öffnen der Seite',
  await page.evaluate(() => {
    const k = document.getElementById('rgsKlappHilfe');
    return !!k && k.classList.contains('auf');
  }));
await page.click('#rgsKlappHilfe .rgs-klapp-kopf');
await page.waitForTimeout(250);
await page.evaluate(() => { blattZu(); rgSeiteZu(); });
await oeffne('Runde mit Zentrale');
check('Und das Zuklappen ebenso -- der Schalter kennt beide Richtungen',
  await page.evaluate(() => {
    const k = document.getElementById('rgsKlappHilfe');
    return !!k && !k.classList.contains('auf');
  }));

// ── In der LAUFENDEN Runde bleibt er offen ────────────────────────────
// ENT-299 Ziffer 4 wird nur zur Haelfte revidiert. Der Satz „Wer diese
// Nummern braucht, hat keine Hand frei zum Aufklappen" gilt dort, wo er
// gemeint war: waehrend der Runde. Dort gibt es keinen Schalter und der
// Block steht offen -- unveraendert seit ENT-299.
check('KRITISCH: in der laufenden Runde gibt es keinen Klappschalter für den Notruf',
  await page.evaluate(async () => {
    rgsModus = 'lauf';
    rgSeiteZeichnen(rgsDaten);
    await new Promise(r => setTimeout(r, 250));
    const klapp = document.getElementById('rgsKlappHilfe');
    const notruf = document.getElementById('rgsNotruf');
    const sichtbar = !!notruf && notruf.getBoundingClientRect().height > 0;
    const lb = document.getElementById('rgsHilfeLb');
    rgsModus = 'vorschau';
    rgSeiteZeichnen(rgsDaten);
    return !klapp && sichtbar && !!lb && lb.textContent === 'Zentrale und Notruf';
  }));
await page.waitForTimeout(250);

// ── Der zusammengedrückte Rumpf (der eigentliche Befund) ──────────────
// Vom Projektinhaber mit einem Bildschirmfoto gemeldet: Objekt, Kunde,
// Adresse, Zeitfenster und Ansprechpartner fehlten -- auf dem Handy, nicht
// im Test. Die Ursache war nicht fehlender Text, sondern Flexbox: .karte,
// .rgs-fakten und .rgs-klapp tragen `overflow: hidden`, damit faellt ihre
// automatische Mindesthoehe auf 0, und im Flex-Rumpf wurden sie auf wenige
// Pixel zusammengedrueckt, sobald der Inhalt nicht mehr auf den Bildschirm
// passte. Auf dem iPhone ist der sichtbare Bereich wegen der Safari-Leiste
// kuerzer als die 844px der Pruefung -- darum fiel es dort auf und hier
// nicht. Gemessen wird jetzt an mehreren Hoehen.
for (const hoehe of [844, 720, 660, 600]) {
  await page.setViewportSize({ width: 390, height: hoehe });
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => {
    const h = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().height : -1; };
    return { karte: h('.karte'), fakten: h('.rgs-fakten'), klapp: h('#rgsKlappAp'),
             hilfe: h('#rgsKlappHilfe'), name: h('.rgs-obj-name'), wert: h('.rgs-fakt-wert') };
  });
  check(`KRITISCH: bei ${hoehe}px Höhe wird kein Block zusammengedrückt`,
    m.karte > 100 && m.fakten > 44 && m.klapp >= 44 && m.hilfe >= 44
    && m.name > 12 && m.wert > 12);
}
// Und der Text steht wirklich da, nicht nur der Rahmen -- eine Huelle in
// voller Hoehe mit abgeschnittenem Inhalt waere derselbe Fehler.
await page.setViewportSize({ width: 390, height: 600 });
await page.waitForTimeout(250);
check('KRITISCH: Objekt, Kunde und Zeitfenster stehen auch auf dem kurzen Bildschirm im Kasten',
  await page.evaluate(() => {
    const drin = s => {
      const e = document.querySelector(s); if (!e) return false;
      const r = e.getBoundingClientRect();
      const k = e.closest('.karte, .rgs-fakten').getBoundingClientRect();
      return r.height > 12 && r.top >= k.top - 1 && r.bottom <= k.bottom + 1;
    };
    return drin('.rgs-obj-name') && drin('.rgs-obj-kunde') && drin('.rgs-fakt-wert');
  }));
await page.setViewportSize({ width: 390, height: 844 });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
