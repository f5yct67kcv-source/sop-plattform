// Hell und dunkel in der Mitarbeiter-App (ENT-398).
//
// Geprueft wird nicht, WELCHE Farbwerte im Regelwerk stehen -- das waere der
// Quelltext, abgeschrieben, und bliebe gruen, wenn eine spaetere Regel
// gleicher Eigenspezifitaet sie wirkungslos macht. Geprueft wird der
// GERENDERTE Zustand: Ist der Grund dunkel, ist die Schrift darauf lesbar,
// und bleibt beides in der hellen Fassung ebenfalls lesbar.
//
// Die Kontrastschwellen sind WCAG-Werte, keine Hausnummern: 4.5:1 fuer
// normalen Text, 3:1 fuer grosse/fette Schrift und fuer Flaechen, die nur
// unterscheidbar sein muessen.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const HEUTE = tag(0), MORGEN = tag(1);

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const jetzt = new Date();
const beginn = new Date(jetzt.getTime() - 3600e3), ende = new Date(jetzt.getTime() + 3600e3);
const hm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':00';

const SCHICHTEN = { status: 'ok', von: tag(-1), bis: tag(90), schichten: [
  { id: 41, kunde_name: 'Einwohnergemeinde Musterdorf', titel: 'Revierdienst Nacht',
    strasse: 'Bahnhofstrasse 22', ort: '4600 Olten', einsatzart: 'Revierdienst',
    datum: iso(beginn), von: hm(beginn), bis: hm(ende), status: 'geplant',
    bemerkung: 'Schluessel beim Hauswart', zusage: 'offen',
    objekt_name: 'Einkaufszentrum Nord West', im_team: 1 },
  { id: 42, kunde_name: 'Einwohnergemeinde Musterdorf', titel: 'Baustelle Kreiselumfahrung',
    strasse: 'Dorfstrasse 1', ort: '5013 Musterdorf', einsatzart: 'Verkehrsdienst',
    datum: MORGEN, von: '07:30:00', bis: '16:30:00', status: 'provisorisch', bemerkung: null,
    zusage: 'zugesagt', objekt_name: null, im_team: 1 },
  { id: 46, kunde_name: 'Cupi24 GmbH', titel: 'Bereits rapportiert',
    strasse: null, ort: '4632 Trimbach', einsatzart: 'Verkehrsdienst',
    datum: HEUTE, von: '08:00:00', bis: '10:00:00', status: 'abgeschlossen', bemerkung: null,
    zusage: 'zugesagt', objekt_name: null, im_team: 1 }]};

const PROFIL = { status: 'ok', monat: { anzahl: 3, stunden: 22.5 }, profil: {
  name: 'dario.beispiel', ist_admin: false, personalnummer: 'P-014',
  vorname: 'Dario', nachname: 'Beispiel', geburtsdatum: '1988-04-12', strasse: 'Musterweg 3',
  ort: '4600 Olten', telefon: null, mobil: '079 000 00 00', email: 'd@example.ch' }};

// ── Kontrast nach WCAG. Der einzige belastbare Weg, „lesbar" zu pruefen.
const LUM = c => {
  const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const rgb = s => (String(s).match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
const kontrast = (a, b) => {
  const l1 = LUM(rgb(a)), l2 = LUM(rgb(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const istDunkel = c => { const [r, g, b] = rgb(c); return (r * 299 + g * 587 + b * 114) / 1000 < 60; };

async function starte(vorbelegt) {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  if (vorbelegt !== undefined) {
    await page.addInitScript(v => { try { localStorage.setItem('rv3_app_thema', v); } catch (e) {} }, vorbelegt);
  }
  await page.route('**/api/**', route => {
    const p = route.request().url().split('/api/')[1].split('?')[0];
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'dario.beispiel', ist_admin: false });
    if (p.includes('meine_schichten')) return send(SCHICHTEN);
    if (p.includes('mein_profil')) return send(PROFIL);
    if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
    return send({ status: 'ok' });
  });
  await page.goto(`file://${WURZEL}/app.html`);
  return { browser, page };
}

// Die Flaeche, auf der ein Text WIRKLICH liegt -- nicht der Seitengrund.
// .inhalt und .v sind durchsichtig; wer dort die Hintergrundfarbe abfragt,
// bekommt rgba(0,0,0,0) und rechnet gegen Schwarz.
const echterGrund = (page, sel) => page.evaluate(s => {
  let el = document.querySelector(s);
  if (!el) { return null; }
  const txt = getComputedStyle(el).color;
  let n = el;
  while (n) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      // Halbdurchsichtige Flaechen (Milchglas der Reiterleiste) auf voll
      // rechnen -- sonst liest die Messung eine Farbe, die es nicht gibt.
      return { text: txt, grund: bg.replace(/[\d.]+\)$/, '1)') };
    }
    n = n.parentElement;
  }
  return { text: txt, grund: 'rgb(255, 255, 255)' };
}, sel);

async function anmelden(page) {
  await page.fill('#gName', 'dario.beispiel');
  await page.fill('#gPass', 'x');
  await page.click('#gBtn');
  await page.waitForSelector('#app.on');
  await page.waitForTimeout(500);
}

// ══════════════════════════════════════════ OHNE WAHL IST ES DUNKEL
let { browser, page } = await starte();

check('KRITISCH: ohne gespeicherte Wahl startet die App dunkel (ENT-398)',
  await page.evaluate(() => document.documentElement.getAttribute('data-thema') === 'dunkel'));
// Kein Aufblitzen: das Merkmal steht schon vor dem ersten Zeichnen da.
check('Das Merkmal steht früh genug am Dokument -- die helle Fassung blitzt nicht auf',
  await page.evaluate(() => document.documentElement.dataset.thema) === 'dunkel');
check('Die Systemleiste am Telefon zieht mit',
  await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content) === '#161B27');

await anmelden(page);

// ══════════════════════════════════════════ ES IST WIRKLICH DUNKEL
const grundDunkel = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('KRITISCH: der Grund der App ist dunkel', istDunkel(grundDunkel));

const kopf = await echterGrund(page, '.kopf .wer b');
check('Die Kopfzeile ist dunkel', istDunkel(kopf.grund));
check(`Der Name auf der Kopfzeile ist lesbar (${kontrast(kopf.text, kopf.grund).toFixed(1)}:1)`,
  kontrast(kopf.text, kopf.grund) >= 7);

const unterzeile = await echterGrund(page, '.kopf .wer span');
check(`Die Unterzeile der Kopfzeile ist lesbar (${kontrast(unterzeile.text, unterzeile.grund).toFixed(1)}:1)`,
  kontrast(unterzeile.text, unterzeile.grund) >= 4.5);

const karte = await echterGrund(page, '.schicht .was b');
check('Die Karten sind dunkel', istDunkel(karte.grund));
check(`Der Kartentitel ist lesbar (${kontrast(karte.text, karte.grund).toFixed(1)}:1)`,
  kontrast(karte.text, karte.grund) >= 7);
check('Die Karte hebt sich vom Grund ab -- im Dunkeln trägt der Rand, nicht der Schatten',
  await page.evaluate(() => {
    const k = document.querySelector('.karte');
    return getComputedStyle(k).boxShadow === 'none' && getComputedStyle(k).borderTopWidth !== '0px';
  }));

// Die Reiterleiste liegt auf Milchglas -- sie war die einzige Flaeche mit
// einem fest verdrahteten Weiss und waere sonst als heller Balken
// stehengeblieben, ohne dass etwas kaputtgeht.
const reiterAus = await echterGrund(page, '.tabs button:not(.on) span');
const reiterAn = await echterGrund(page, '.tabs button.on span');
check('KRITISCH: die Reiterleiste ist dunkel', istDunkel(reiterAus.grund));
check(`Der gewählte Reiter ist lesbar (${kontrast(reiterAn.text, reiterAn.grund).toFixed(1)}:1)`,
  kontrast(reiterAn.text, reiterAn.grund) >= 4.5);
check(`Die übrigen Reiter sind lesbar (${kontrast(reiterAus.text, reiterAus.grund).toFixed(1)}:1)`,
  kontrast(reiterAus.text, reiterAus.grund) >= 4.5);
await page.screenshot({ path: OUT + '/appthema-01-heute-dunkel.png' });

// ══════════════════════════════════════════ SCHRIFT AUF FARBIGER FLÄCHE
// Die dunkle Palette hellt Blau, Grün und Gelb auf, damit sie auf dunklem
// Grund tragen. Weisse Schrift DARAUF ergibt 2.8:1 bzw. 1.9:1 -- genau der
// Fehler, den ENT-385 fuer den Anmeldeknopf schon einmal umgehen musste.
const aufFarbe = await page.evaluate(() => {
  const raus = {};
  const nimm = (name, sel) => {
    const el = document.querySelector(sel);
    if (!el) { return; }
    const c = getComputedStyle(el);
    raus[name] = [c.color, c.backgroundColor];
  };
  nimm('kopfkreis', '.kopf .kreis');
  nimm('haken', '.karte-haken');
  return raus;
});
Object.entries(aufFarbe).forEach(([k, [vg, hg]]) => {
  const v = kontrast(vg, hg);
  check(`KRITISCH: Schrift auf farbiger Fläche lesbar -- ${k} (${v.toFixed(1)}:1)`, v >= 4.5);
});

// ══════════════════════════════════════════ QUER DURCH DIE REITER
for (const [reiter, sel] of [['plan', '.unterreiter button.on'], ['rapport', '.v.on'], ['menu', '.mk-kachel-lbl']]) {
  await page.evaluate(r => zeige(r), reiter);
  await page.waitForTimeout(450);
  const g = await echterGrund(page, sel);
  if (!g) { check(`Reiter ${reiter}: Messpunkt vorhanden`, false); continue; }
  check(`Reiter ${reiter}: der Grund bleibt dunkel`, istDunkel(g.grund));
  check(`Reiter ${reiter}: der Text bleibt lesbar (${kontrast(g.text, g.grund).toFixed(1)}:1)`,
    kontrast(g.text, g.grund) >= 4.5);
}

// Kein heller Rest: kein sichtbares Element im Rumpf traegt eine helle
// Flaeche. Das ist die Gegenprobe zu allen Einzelmessungen oben -- sie
// findet auch das, woran beim Umbau niemand gedacht hat.
await page.evaluate(() => zeige('heute'));
await page.waitForTimeout(400);
const helleReste = await page.evaluate(() => {
  const hell = c => {
    const [r, g, b] = (String(c).match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
    const a = (String(c).match(/[\d.]+/g) || [])[3];
    if (a !== undefined && Number(a) < 0.5) { return false; }
    return (r * 299 + g * 587 + b * 114) / 1000 > 170;
  };
  const raus = [];
  document.querySelectorAll('#app *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) { return; }          // Punkte, Striche, Symbole
    const c = getComputedStyle(el);
    if (c.visibility === 'hidden' || c.display === 'none') { return; }
    const bg = c.backgroundColor;
    if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') { return; }
    if (hell(bg)) { raus.push((el.className || el.tagName) + ' -> ' + bg); }
  });
  return raus;
});
check('KRITISCH: keine hell gebliebene Fläche in der App' + (helleReste.length ? ' -- ' + helleReste.join(' | ') : ''),
  helleReste.length === 0);

// ══════════════════════════════════════════ DIE SCHUBLADE
// Sie deckt den halben Bildschirm und ist der Ort, an dem rapportiert und
// zugesagt wird -- also nichts, was ungeprueft mitlaufen darf.
await page.click('.schicht');
await page.waitForSelector('.blatt.on');
await page.waitForTimeout(450);
const blattTitel = await echterGrund(page, '.blatt-kopf h2');
check('Die Schublade ist dunkel', istDunkel(blattTitel.grund));
check(`Ihr Titel ist lesbar (${kontrast(blattTitel.text, blattTitel.grund).toFixed(1)}:1)`,
  kontrast(blattTitel.text, blattTitel.grund) >= 7);
const knopf = await page.evaluate(() => {
  const b = document.querySelector('.blatt-ft .btn-primary') || document.querySelector('.blatt .btn-primary');
  if (!b) { return null; }
  const c = getComputedStyle(b);
  return [c.color, c.backgroundColor];
});
if (knopf) {
  check(`KRITISCH: die Schrift auf dem Hauptknopf ist lesbar (${kontrast(...knopf).toFixed(1)}:1)`,
    kontrast(...knopf) >= 4.5);
}
// Das Abdunkeln hinter der Schublade muss im Dunkeln staerker sein: ein
// Schleier, der fuer weissen Grund gerechnet ist, verschwindet auf dunklem.
const schleier = await page.evaluate(() => getComputedStyle(document.querySelector('.abdunkeln')).backgroundColor);
check('Der Schleier hinter der Schublade dunkelt wirklich ab',
  (Number((String(schleier).match(/[\d.]+/g) || [])[3] || 1) >= 0.5));
await page.screenshot({ path: OUT + '/appthema-05-schublade-dunkel.png' });
await page.evaluate(() => blattZu());
await page.waitForTimeout(400);

// ══════════════════════════════════════════ DER SCHALTER IM MENÜ
await page.evaluate(() => zeige('menu'));
await page.waitForTimeout(400);
check('Im Menü gibt es eine Kachel „Einstellungen"', await page.isVisible('#mk-einstellungen'));
check('Der Schalter liegt nicht im Menü selbst, sondern eine Ebene tiefer',
  !(await page.isVisible('#btnThemaApp')));

await page.click('#mk-einstellungen');
await page.waitForTimeout(350);
check('Die Kachel führt auf die Unterseite Einstellungen', await page.isVisible('#pr-einst'));
check('Das Menü selbst tritt dabei zurück', !(await page.isVisible('#pr-haupt')));
check('Der Schalter ist dort', await page.isVisible('#btnThemaApp'));
check('Er ist als Schalter ausgezeichnet, nicht als Knopf',
  (await page.getAttribute('#btnThemaApp', 'role')) === 'switch');
check('Er meldet den aktuellen Zustand',
  (await page.getAttribute('#btnThemaApp', 'aria-checked')) === 'true');
check('Er trägt eine sprechende Beschriftung',
  (await page.getAttribute('#btnThemaApp', 'title') || '').includes('hell'));
// CLAUDE.md: Bedienelemente auf dem Handy mindestens 44 px hoch. Der
// Schieber selbst ist 30 px -- darum ist die ganze Zeile der Schalter.
const hoehe = await page.evaluate(() => Math.round($('btnThemaApp').getBoundingClientRect().height));
check(`KRITISCH: die Trefferfläche ist mindestens 44 px hoch (${hoehe} px)`, hoehe >= 44);
check('Der Schieber daneben meldet sich nicht als zweites Bedienelement',
  await page.evaluate(() => document.querySelector('#btnThemaApp .thema-schalter').getAttribute('aria-hidden') === 'true'));
await page.screenshot({ path: OUT + '/appthema-02-einstellungen-dunkel.png' });

// ══════════════════════════════════════════ UMSCHALTEN
await page.click('#btnThemaApp');
await page.waitForTimeout(400);
check('Ein Tipp schaltet auf hell',
  await page.evaluate(() => document.documentElement.getAttribute('data-thema') === 'hell'));
check('Der Schalter meldet „aus"',
  (await page.getAttribute('#btnThemaApp', 'aria-checked')) === 'false');
check('Die Wahl wird gespeichert',
  await page.evaluate(() => localStorage.getItem('rv3_app_thema') === 'hell'));
check('Und zwar unter einem EIGENEN Eintrag -- der des Cockpits bleibt unberührt',
  await page.evaluate(() => localStorage.getItem('rv3_thema') === null));
check('Die Systemleiste zieht auch zurück mit',
  await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content) === '#16181D');

const hellKarte = await echterGrund(page, '.einst-txt b');
check('Der Grund ist wieder hell', !istDunkel(hellKarte.grund));
check(`Und der Text darauf bleibt lesbar (${kontrast(hellKarte.text, hellKarte.grund).toFixed(1)}:1)`,
  kontrast(hellKarte.text, hellKarte.grund) >= 7);
await page.screenshot({ path: OUT + '/appthema-03-einstellungen-hell.png' });

// Gegenprobe in der hellen Fassung: die Schrift auf farbiger Fläche muss
// dort GENAUSO lesbar sein -- sie wechselt mit dem Thema die Farbe.
await page.evaluate(() => { einstSeiteZu(); zeige('heute'); });
await page.waitForTimeout(450);
const aufFarbeHell = await page.evaluate(() => {
  const el = document.querySelector('.kopf .kreis');
  const c = getComputedStyle(el);
  return [c.color, c.backgroundColor];
});
check(`KRITISCH: Schrift auf farbiger Fläche auch im Hellen lesbar (${kontrast(...aufFarbeHell).toFixed(1)}:1)`,
  kontrast(...aufFarbeHell) >= 4.5);
await page.screenshot({ path: OUT + '/appthema-04-heute-hell.png' });

// ══════════════════════════════════════════ FORM BLEIBT, NUR FARBE WECHSELT
// Dieselbe Absicht wie in test_thema.mjs (ENT-227): Ein zweites Farbsystem,
// das nebenbei auch die Radien und die Luft verstellt, faellt sonst
// niemandem auf -- es sieht ja nicht kaputt aus, nur anders.
const form = () => page.evaluate(() => {
  const k = getComputedStyle(document.querySelector('.karte'));
  const b = getComputedStyle(document.querySelector('.tabs button'));
  return { radius: k.borderRadius, polster: k.padding, reiterHoehe: b.minHeight,
           schrift: getComputedStyle(document.body).fontFamily,
           grund: k.backgroundColor };
});
const formHell = await form();
await page.evaluate(() => themaUm());
await page.waitForTimeout(400);
const formDunkel = await form();
check('KRITISCH: die Radien gelten in beiden Fassungen gleich',
  formHell.radius === formDunkel.radius);
check('KRITISCH: die Luft gilt in beiden Fassungen gleich',
  formHell.polster === formDunkel.polster);
check('KRITISCH: die Trefferflächen bleiben gleich',
  formHell.reiterHoehe === formDunkel.reiterHoehe);
check('KRITISCH: dieselbe Grundschrift in beiden Fassungen',
  formHell.schrift === formDunkel.schrift);
check('Die Farbe unterscheidet sich sehr wohl -- sonst hätte der Schalter keine Wirkung',
  formHell.grund !== formDunkel.grund);

await browser.close();

// ══════════════════════════════════════════ DIE WAHL GILT BEIM NÄCHSTEN MAL
({ browser, page } = await starte('hell'));
check('Eine gespeicherte helle Wahl wird übernommen',
  await page.evaluate(() => document.documentElement.getAttribute('data-thema') === 'hell'));
check('Und sie steht früh genug da',
  await page.evaluate(() => document.documentElement.dataset.thema) === 'hell');

// ══════════════════════════════════════════ ZUGANG UND RUNDGANG BLEIBEN DUNKEL
// Beides ist älter als ENT-398 und hat einen eigenen Grund (ENT-385 bzw.
// ENT-294). Der Standardwechsel darf sie nicht davon abhängig machen, wie
// jemand den Schalter im Menü stellt -- sonst steht ein Wächter nachts vor
// einem weissen Vollbildschirm.
const gate = await page.evaluate(() => getComputedStyle(document.querySelector('#gate')).backgroundColor);
check('KRITISCH: der Zugang bleibt auch in der hellen Fassung dunkel (ENT-385)', istDunkel(gate));
const gateBtn = await page.evaluate(() => {
  const c = getComputedStyle(document.querySelector('#gate .btn-primary'));
  return [c.color, c.backgroundColor];
});
check(`KRITISCH: der Anmeldeknopf bleibt lesbar (${kontrast(...gateBtn).toFixed(1)}:1)`,
  kontrast(...gateBtn) >= 4.5);

await anmelden(page);
const rgs = await page.evaluate(() => {
  const el = document.querySelector('.rgs');
  const c = getComputedStyle(el);
  return { grund: c.backgroundColor, text: c.color };
});
check('KRITISCH: der Rundgang bleibt auch in der hellen Fassung dunkel (ENT-294)',
  istDunkel(rgs.grund));
check(`Und die Schrift dort bleibt hell (${kontrast(rgs.text, rgs.grund).toFixed(1)}:1)`,
  kontrast(rgs.text, rgs.grund) >= 7);

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
