// Unterschrift des Kunden auf dem ganzen Bildschirm (ENT-292).
//
// Geprueft wird die Aussage, nicht der Wortlaut: dass im Formular kein
// Zeichenfeld mehr steht, dass das Blatt den Bildschirm deckt und quer liegt,
// dass ein Strich dort landet, wo der Finger war -- auch wenn die Flaeche
// gedreht ist -- und dass gespeichert nur die Unterschrift wird, nicht das
// Papier.
//
// Die Drehung ist der heikle Teil. Hochkant steht die Buehne um 90 Grad
// gedreht (die Geraetedrehung laesst sich im Browser nicht erzwingen, Safari
// kennt screen.orientation.lock() nicht). Dieselbe Antwort rechnet die
// Fingerposition um. Waere sie falsch, wuerde der Strich quer zur Bewegung
// laufen -- und genau das prueft diese Suite: ein senkrechter Zug auf dem
// BILDSCHIRM muss eine waagrechte Unterschrift auf dem BLATT ergeben.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const rufe = [];
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), p = req.url().split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { /* egal */ }
  rufe.push({ p, body });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('rapport_create')) return send({ status: 'ok', id: 7 });
  return send({ status: 'ok', rapporte: [], mitarbeiter: [], kunden: [], objekte: [], stats: [] });
});

await page.goto(`file://${WURZEL}/index.html`);
await page.fill('#loginName', 'm.muster');
await page.fill('#loginPassword', 'egal');
await page.click('#btn-login');
await page.waitForTimeout(400);

// ── Das Formular: nur noch ein Knopf ────────────────────────────────────
check('Das Erfassungsformular ist offen', await page.isVisible('#formArea'));
check('KRITISCH: im Formular steht kein Zeichenfeld mehr',
  await page.evaluate(() => document.querySelectorAll('#formArea canvas').length === 0));
check('Stattdessen steht dort ein Knopf', await page.isVisible('#usigCta'));
check('Der Knopf sagt, was er tut',
  (await page.textContent('#usigCta')).includes('Unterschrift hinzufügen'));
check('KRITISCH: der Knopf ist mindestens 44px hoch',
  await page.evaluate(() => document.getElementById('usigCta').offsetHeight >= 44));
check('Der Knopf ist nicht ueber die volle Breite gestreckt',
  await page.evaluate(() => {
    const c = document.getElementById('usigCta');
    return c.offsetWidth < c.parentElement.getBoundingClientRect().width - 8;
  }));

await page.locator('#sigFeld').scrollIntoViewIfNeeded();
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/us-00-formular-knopf.png` });

await page.fill('#kunde', 'Kunde A');
await page.fill('#strasse', 'Dorfstrasse 1');
await page.fill('#ort', '5013 Musterort');
await page.fill('#sigName', 'R. Muster');

// ── Der Vollbild-Bereich ────────────────────────────────────────────────
await page.click('#usigCta');
await page.waitForTimeout(250);

const voll = await page.evaluate(() => {
  const v = document.getElementById('usigVoll');
  const b = document.getElementById('usigBuehne');
  const bl = document.getElementById('usigBlatt');
  const c = document.getElementById('usigCanvas');
  const r = v.getBoundingClientRect();
  return {
    sichtbar: getComputedStyle(v).display !== 'none',
    deckt: Math.abs(r.width - window.innerWidth) <= 1 && Math.abs(r.height - window.innerHeight) <= 1,
    gedreht: b.dataset.gedreht,
    // Innerhalb der gedrehten Buehne wird das LAYOUT gemessen; ein
    // getBoundingClientRect waere hier mitgedreht und haette Breite und
    // Hoehe vertauscht.
    buehneQuer: b.clientWidth > b.clientHeight,
    blattVerhaeltnis: bl.clientWidth / bl.clientHeight,
    leinwandDecktBlatt: Math.abs(c.clientWidth - bl.clientWidth) <= 1
                     && Math.abs(c.clientHeight - bl.clientHeight) <= 1,
    knoepfe44: [...document.querySelectorAll('.usig-btn')].every(x => x.offsetHeight >= 44),
    okGesperrt: document.getElementById('usigOk').disabled,
    hinweisDa: getComputedStyle(document.getElementById('usigHinweis')).display !== 'none',
    kontext: document.getElementById('usigKontext').textContent,
    name: document.getElementById('usigName').textContent,
    ueberAllem: parseInt(getComputedStyle(v).zIndex, 10),
  };
});
check('Antippen oeffnet den Vollbild-Bereich', voll.sichtbar);
check('KRITISCH: er deckt den ganzen Bildschirm', voll.deckt);
check('Er liegt ueber Anmeldeschirm, Schublade und Modalfenstern', voll.ueberAllem >= 1000);
check('KRITISCH: hochkant ist die Flaeche gedreht -- man muss quer halten', voll.gedreht === '1');
check('KRITISCH: die Buehne liegt quer', voll.buehneQuer);
check(`Das Blatt ist breiter als hoch (${voll.blattVerhaeltnis.toFixed(2)}:1)`, voll.blattVerhaeltnis > 1.6);
check('Die Zeichenflaeche deckt das ganze Blatt', voll.leinwandDecktBlatt);
check('Bedienelemente im Vollbild sind mindestens 44px hoch', voll.knoepfe44);
check('KRITISCH: "Bestaetigen" ist gesperrt, solange nichts gezeichnet ist', voll.okGesperrt);
check('Der Hinweis "Hier unterschreiben" steht auf dem leeren Blatt', voll.hinweisDa);
check('Der Kunde sieht, was er unterschreibt (Kunde, Datum, Stunden)',
  voll.kontext.includes('Kunde A') && voll.kontext.includes('h') && /\d{2}\.\d{2}\.\d{4}/.test(voll.kontext));
check('Der Name des Unterzeichners steht auf dem Blatt', voll.name.includes('R. Muster'));
check('KRITISCH: kein Seiten-Scroll bei offenem Vollbild @390',
  await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/us-01-vollbild-hochkant.png` });

// Unterschreiben. Hochkant liegt die X-Achse des Blattes auf der Y-Achse des
// Bildschirms: ein senkrechter Zug muss eine waagrechte Unterschrift ergeben.
async function unterschreiben() {
  const g = await page.evaluate(() => {
    const r = document.getElementById('usigCanvas').getBoundingClientRect();
    return { left: r.left, top: r.top, breite: r.width, hoehe: r.height };
  });
  const x = g.left + g.breite * 0.5;
  await page.mouse.move(x, g.top + g.hoehe * 0.30);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(x, g.top + g.hoehe * (0.30 + i * 0.03)); }
  await page.mouse.up();
  await page.waitForTimeout(80);
}
// Alles ab hier haengt daran, dass ueberhaupt ein Strich auf dem Blatt
// ankommt. Kommt keiner, bleibt "Bestaetigen" gesperrt -- dann wird der Grund
// gemeldet und abgebrochen, statt in einen Zeitablauf zu laufen, dessen
// Meldung nichts mehr ueber die Ursache sagt.
async function bestaetigen() {
  if (await page.evaluate(() => document.getElementById('usigOk').disabled)) {
    bad.push('KRITISCH: "Bestaetigen" blieb gesperrt -- es kam kein Strich auf dem Blatt an '
      + '(alles Weitere haengt daran und wurde nicht mehr geprueft)');
    await abschluss();
  }
  await page.click('#usigOk');
  await page.waitForTimeout(250);
  return true;
}

async function abschluss() {
  await browser.close();
  console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
  if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
  console.log('Alle Pruefungen bestanden.');
  process.exit(0);
}

await unterschreiben();

const gezeichnet = await page.evaluate(() => ({
  okFrei: !document.getElementById('usigOk').disabled,
  hinweisWeg: getComputedStyle(document.getElementById('usigHinweis')).display === 'none',
}));
check('Nach dem ersten Strich ist "Bestaetigen" frei', gezeichnet.okFrei);
check('Der Hinweis verschwindet, sobald geschrieben wird', gezeichnet.hinweisWeg);
await page.screenshot({ path: `${OUT}/us-02-unterschrieben.png` });

await bestaetigen();

const bild = await page.evaluate(async () => {
  const d = Unterschrift.daten();
  if (!d) { return { anfang: '', breite: 0, hoehe: 0, eckeAlpha: -1, anteilFarbe: 0,
    zu: false, vorschau: false, text: '', kein_cta: false }; }
  const img = new Image(); img.src = d; await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const k = c.getContext('2d'); k.drawImage(img, 0, 0);
  const daten = k.getImageData(0, 0, c.width, c.height).data;
  let dunkel = 0;
  for (let i = 3; i < daten.length; i += 4) { if (daten[i] > 40) { dunkel++; } }
  return {
    anfang: d.slice(0, 15), breite: img.width, hoehe: img.height,
    eckeAlpha: daten[3], anteilFarbe: dunkel / (c.width * c.height),
    zu: getComputedStyle(document.getElementById('usigVoll')).display === 'none',
    vorschau: !!document.getElementById('usigVorschau'),
    text: document.getElementById('sigFeld').textContent,
    kein_cta: !document.getElementById('usigCta'),
  };
});
check('Nach dem Bestaetigen ist der Vollbild-Bereich zu', bild.zu);
check('Im Formular steht jetzt die Vorschau statt des Knopfes', bild.vorschau && bild.kein_cta);
check('Die Vorschau nennt den Unterzeichner', bild.text.includes('R. Muster'));
check('KRITISCH: auch "Ändern" und "Entfernen" sind 44px -- danebengetippt kostet die Unterschrift',
  await page.evaluate(() => ['usigNeu', 'usigWeg']
    .every(i => document.getElementById(i).offsetHeight >= 44)));
await page.screenshot({ path: `${OUT}/us-04-formular-vorschau.png` });
check('Die Unterschrift ist ein PNG', bild.anfang.startsWith('data:image/png'));
check(`KRITISCH: der senkrechte Zug auf dem Bildschirm ist eine waagrechte Unterschrift (${bild.breite}×${bild.hoehe})`,
  bild.breite > bild.hoehe * 2);
check('KRITISCH: gespeichert wird nur der Strich, nicht das Papier (durchsichtiger Grund)',
  bild.eckeAlpha === 0 && bild.anteilFarbe > 0 && bild.anteilFarbe < 0.5);
check(`Das Bild ist auf die Unterschrift zugeschnitten, nicht auf das ganze Blatt (${bild.breite}px)`,
  bild.breite < 1400);

// ── Abbrechen laesst die erfasste Unterschrift stehen ───────────────────
const vorher = await page.evaluate(() => Unterschrift.daten());
await page.click('#usigNeu');
await page.waitForTimeout(200);
check('"Ändern" oeffnet dieselbe Flaeche wieder',
  await page.evaluate(() => getComputedStyle(document.getElementById('usigVoll')).display !== 'none'));
check('Die bisherige Unterschrift steht beim Wiederoeffnen noch da -- sie ist nicht weg, nur weil man nachsieht',
  await page.evaluate(() => !document.getElementById('usigOk').disabled));
await page.click('#usigAbbruch');
await page.waitForTimeout(200);
check('KRITISCH: Abbrechen aendert nichts an der erfassten Unterschrift',
  (await page.evaluate(() => Unterschrift.daten())) === vorher);

// ── Speichern ───────────────────────────────────────────────────────────
await page.check('#confirmCheck');
await page.click('#btn-save');
await page.waitForTimeout(400);
const gesendet = rufe.filter(r => r.p.includes('rapport_create')).pop();
check('Der Rapport wird gesendet', !!gesendet);
check('KRITISCH: die Unterschrift geht mit',
  gesendet && typeof gesendet.body.sig === 'string' && gesendet.body.sig.startsWith('data:image/png'));
check('Der Name des Unterzeichners geht mit', gesendet && gesendet.body.sigName === 'R. Muster');

// ── Neuer Rapport: die Unterschrift des Vorgaengers darf nicht stehen bleiben
await page.click('#btn-neuer');
await page.waitForTimeout(300);
check('KRITISCH: nach dem Zuruecksetzen ist die Unterschrift weg',
  await page.evaluate(() => Unterschrift.daten() === null));
check('Der Knopf steht wieder da', await page.isVisible('#usigCta'));

// ── Die Unterschrift bleibt freiwillig ──────────────────────────────────
await page.fill('#kunde', 'Kunde B');
await page.fill('#strasse', 'Dorfstrasse 2');
await page.fill('#ort', '5013 Musterort');
await page.check('#confirmCheck');
await page.click('#btn-save');
await page.waitForTimeout(400);
const ohne = rufe.filter(r => r.p.includes('rapport_create')).pop();
check('KRITISCH: ein Rapport ohne Unterschrift laesst sich weiterhin speichern',
  ohne && ohne.body.kunde === 'Kunde B' && ohne.body.sig === null);

// ── Entfernen ───────────────────────────────────────────────────────────
await page.click('#btn-neuer');
await page.waitForTimeout(300);
await page.click('#usigCta');
await page.waitForTimeout(200);
await unterschreiben();
await bestaetigen();
check('Erneut unterschrieben', await page.evaluate(() => Unterschrift.daten() !== null));
await page.click('#usigWeg');
await page.waitForTimeout(200);
check('"Entfernen" nimmt die Unterschrift zurueck und stellt den Knopf wieder her',
  await page.evaluate(() => Unterschrift.daten() === null) && await page.isVisible('#usigCta'));

// ── Quer mit Browserleisten: der Fall, der am echten iPhone auffiel ─────
// Dreht das Geraet die Seite mit (Drehsperre aus), hoert die Flaeche
// richtigerweise auf, selbst zu drehen -- aber Safaris Leisten kommen zurueck,
// und von 390 px Hoehe bleiben rund 270. Kopf- und Fussleiste UEBER und UNTER
// dem Blatt nahmen sich davon 123 px feste Hoehe: dem Blatt blieben 147 px,
// weniger als das kleine Feld, das hier abgeschafft wurde. Seither stehen sie
// in einer Spalte NEBEN dem Blatt. Gemessen wird die Aussage -- wie viel Hoehe
// beim Papier ankommt -- nicht, wo im Quelltext welche Regel steht.
await page.setViewportSize({ width: 844, height: 270 });
await page.waitForTimeout(200);
await page.click('#usigCta');
await page.waitForTimeout(250);
const flach = await page.evaluate(() => {
  const bu = document.getElementById('usigBuehne');
  const bl = document.getElementById('usigBlatt');
  const seite = document.querySelector('.usig-seite');
  const rb = bl.getBoundingClientRect(), rs = seite.getBoundingClientRect();
  return {
    gedreht: bu.dataset.gedreht,
    anteilHoehe: bl.clientHeight / bu.clientHeight,
    blatt: [bl.clientWidth, bl.clientHeight],
    // Ueberlappen die Bedienelemente das Papier? Ein Knopf dort, wo
    // unterschrieben wird, kostet danebengetippt die Unterschrift.
    ueberlappt: !(rs.right <= rb.left + 1 || rs.left >= rb.right - 1
               || rs.bottom <= rb.top + 1 || rs.top >= rb.bottom - 1),
    knoepfe44: [...document.querySelectorAll('.usig-btn')].every(x => x.offsetHeight >= 44),
  };
});
check('Quer wird nicht gedreht -- die Seite ist schon quer', flach.gedreht === '0');
check(`KRITISCH: quer mit Browserleisten bleibt dem Blatt fast die ganze Höhe `
  + `(${flach.blatt[0]}×${flach.blatt[1]}, ${Math.round(flach.anteilHoehe * 100)}%)`,
  flach.anteilHoehe >= 0.85);
check('KRITISCH: kein Bedienelement liegt auf dem Papier', !flach.ueberlappt);
check('Auch in der flachen Ansicht sind die Knöpfe 44px hoch', flach.knoepfe44);
await page.screenshot({ path: `${OUT}/us-05-quer-mit-browserleisten.png` });
await page.click('#usigAbbruch');
await page.waitForTimeout(150);

// ── Dasselbe am Desktop nachgemessen (CLAUDE.md: nie nur eine Seite) ─────
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(200);
await page.click('#usigCta');
await page.waitForTimeout(250);
const desk = await page.evaluate(() => {
  const b = document.getElementById('usigBuehne');
  const bl = document.getElementById('usigBlatt');
  const v = document.getElementById('usigVoll').getBoundingClientRect();
  return {
    gedreht: b.dataset.gedreht,
    deckt: Math.abs(v.width - window.innerWidth) <= 1 && Math.abs(v.height - window.innerHeight) <= 1,
    verhaeltnis: bl.clientWidth / bl.clientHeight,
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
check('KRITISCH: am Desktop wird NICHT gedreht -- quer ist er schon', desk.gedreht === '0');
check('Am Desktop deckt der Bereich ebenfalls den ganzen Bildschirm', desk.deckt);
check(`Auch am Desktop liegt das Blatt quer (${desk.verhaeltnis.toFixed(2)}:1)`, desk.verhaeltnis > 1.4);
check('Kein Seiten-Scroll am Desktop', desk.scroll <= 1);
await page.screenshot({ path: `${OUT}/us-03-vollbild-desktop.png` });

// Am Desktop zeigt der Zug direkt: waagrecht auf dem Bildschirm ist
// waagrecht auf dem Blatt. Gegenprobe zur Drehung oben.
const g = await page.evaluate(() => {
  const r = document.getElementById('usigCanvas').getBoundingClientRect();
  return { left: r.left, top: r.top, breite: r.width, hoehe: r.height };
});
const y = g.top + g.hoehe * 0.55;
await page.mouse.move(g.left + g.breite * 0.30, y);
await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(g.left + g.breite * (0.30 + i * 0.03), y); }
await page.mouse.up();
await bestaetigen();
const deskBild = await page.evaluate(async () => {
  const d = Unterschrift.daten();
  if (!d) { return { breite: 0, hoehe: 0 }; }
  const img = new Image(); img.src = d; await img.decode();
  return { breite: img.width, hoehe: img.height };
});
check(`KRITISCH: am Desktop ergibt der waagrechte Zug eine waagrechte Unterschrift (${deskBild.breite}×${deskBild.hoehe})`,
  deskBild.breite > deskBild.hoehe * 2);

// ── Beide Oberflaechen laden dieselbe Umsetzung ─────────────────────────
// Zwei Kopien waeren zwei verschiedene Unterschriften, je nachdem, ueber
// welchen Weg der Kunde unterschreibt.
const app = await browser.newPage({ viewport: { width: 390, height: 844 } });
await app.goto(`file://${WURZEL}/app.html`);
await app.waitForTimeout(400);
check('KRITISCH: auch die App laedt dieselbe Unterschrift-Umsetzung',
  await app.evaluate(() => !!(window.Unterschrift && window.Unterschrift.einrichten)));
await app.close();

await abschluss();
