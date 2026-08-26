// Reihen sichtbar machen und Route zur Schicht (ENT-119).
//
// Zwei Dinge, die aus derselben Rueckmeldung stammen, aber nichts miteinander
// zu tun haben -- ausser dass beide an der Adresse bzw. am Zusammenhang von
// Einsaetzen haengen.
//
// WORAUF DIESE SUITE BESONDERS ACHTET:
//
// 1. Die Serienkennung wird vom SERVER vergeben. Eine im Browser gewuerfelte
//    Zahl koennte sich mit einer anderen Sitzung ueberschneiden, und zwei
//    fremde Reihen waeren danach nicht mehr auseinanderzuhalten.
//
// 2. Das Bearbeiten eines einzelnen Tages darf ihn NICHT aus seiner Reihe
//    loesen. Die UPDATE-Anweisung fuehrt serie_id darum nicht.
//
// 3. "Tag 2 von 3" bezieht sich auf die GANZE Reihe, nie auf die gerade
//    gefilterte Liste. Eine Zahl, die still vom Filter abhaengt, ist falsch.
//
// 4. Der Klick auf die Marke zeigt die Reihe OHNE die uebrigen Filter. Die
//    Vorgabe der Liste ist "Nur Einsätze" (ENT-106) -- eine Reihe aus einer
//    Masterschicht waere damit sofort wieder unsichtbar, und ein Klick, der
//    nichts zeigt, sieht aus wie "gibt es nicht".
//
// 5. Der Routenlink in der App hat NICHTS mit der GAV-Wegstrecke zu tun
//    (ENT-116). Dort geht es um die kuerzeste Strecke ab Hauptanstellungsort
//    als Grundlage fuer Geld; hier nur darum, dass jemand den Ort findet.
//    Darum ausdruecklich KEIN origin im Link.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Datenbank und Endpunkte (Quelltext)
// ══════════════════════════════════════════════════════════════════════════
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const SAVE = readFileSync(`${WURZEL}/backend/api/einsatz_save.php`, 'utf8');
const LIST = readFileSync(`${WURZEL}/backend/api/einsatz_list.php`, 'utf8');

check('KRITISCH: die Spalte serie_id steht im Schema',
  /CREATE TABLE IF NOT EXISTS einsaetze[\s\S]*?serie_id INT NULL[\s\S]*?ENGINE=InnoDB/.test(EINR)
  || /serie_id INT NULL/.test(EINR));
check('KRITISCH: bestehende Datenbanken bekommen die Spalte nachgereicht',
  EINR.includes("ALTER TABLE einsaetze ADD COLUMN serie_id INT NULL"));
check('KRITISCH: die Liste liefert serie_id mit — sonst sieht die Oberfläche keine Reihe',
  /SELECT[\s\S]{0,200}serie_id/.test(LIST));
check('KRITISCH: das Anlegen schreibt serie_id in die Zeile',
  /INSERT INTO einsaetze[\s\S]*?serie_id, erstellt_von/.test(SAVE));
check('KRITISCH: der erste Tag einer Reihe wird selbst zur Kennung',
  SAVE.includes("UPDATE einsaetze SET serie_id = id WHERE id = ?"));
// Das ist der Punkt, an dem eine Reihe still zerfallen könnte.
check('KRITISCH: das Bearbeiten eines Tages fasst serie_id NICHT an',
  !/UPDATE einsaetze SET[\s\S]*?serie_id = \?[\s\S]*?WHERE id = \?/.test(SAVE));
check('Die Kennung wird als Zahl behandelt, nicht als Text',
  /\(int\)\$input\['serie_id'\]/.test(SAVE));
check('Eine unsinnige Kennung wird verworfen statt gespeichert',
  /\$serieId <= 0.*\$serieId = null/.test(SAVE));
check('Die Antwort gibt die Kennung zurück — sonst kennt der zweite Tag sie nicht',
  /'serie_id' => \$serieId/.test(SAVE));
check('Die Kennung entsteht in derselben Transaktion wie der Einsatz',
  SAVE.indexOf('beginTransaction') < SAVE.indexOf('SET serie_id = id')
  && SAVE.indexOf('SET serie_id = id') < SAVE.indexOf('$pdo->commit()'));

// Die App darf keine Wegstrecke aus dem GAV zeigen -- das ist Planungssache.
const APP = readFileSync(`${WURZEL}/app.html`, 'utf8');
check('KRITISCH: der Routenlink trägt kein origin — der Standort der Person geht uns nichts an',
  /maps\/dir\/\?api=1&destination=/.test(APP) && !/maps\/dir\/\?api=1&origin=/.test(APP));
check('KRITISCH: die App vermengt den Routenlink nicht mit der GAV-Wegstrecke',
  !/weg_km/.test(APP) && !/gavZone/.test(APP));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Anlegen: wer bekommt welche Kennung
// ══════════════════════════════════════════════════════════════════════════
const MA = [{ id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'von Arb', aktiv: 1, ist_admin: 1 }];
const KU = [{ id: 1, name: 'Stranag', strasse: 'Kantonsstrasse 3', ort: '6000 Luzern' }];
const EINSAETZE = [];
let idSeq = 600;
const rufe = [];
let speicherFehlerBei = null;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

const mock = route => {
  const req = route.request(), url = req.url(), p = url.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body, url });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: KU });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EINSAETZE });
  if (p.includes('einsatz_dokument')) return body ? send({ status: 'ok', id: 1 }) : send({ status: 'ok', dokumente: [] });
  if (p.includes('einsatz_position')) return send({ status: 'ok', positionen: [] });
  if (p.includes('einsatz_save')) {
    if (speicherFehlerBei && body && body.datum === speicherFehlerBei) {
      return send({ status: 'error', message: 'Speichern fehlgeschlagen.' });
    }
    const id = ++idSeq;
    // Nachbau der Serverregel: serie_neu ohne Kennung macht den Einsatz selbst
    // zur Kennung; eine mitgegebene Kennung wird uebernommen.
    const serie = body.serie_id ? Number(body.serie_id) : (body.serie_neu ? id : null);
    EINSAETZE.push(Object.assign({ id, mitarbeiter: [], bedarf: 1, status: 'geplant',
      objekt_id: null, masterschicht_id: null, serie_id: serie },
      body, { serie_id: serie, von: (body.von || '') + ':00', bis: (body.bis || '') + ':00' }));
    return send({ status: 'ok', id, serie_id: serie });
  }
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0,
    rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 1, kunden: 1,
    rapporte_total: 0 }, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
    sperr_ereignisse: [] });
  return send({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [],
    gepflegt: {}, sperren: [], adressen: [], wege: [], fahrzeuge: [] });
};
await page.route('**/api/**', mock);

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);

const speicher = () => rufe.filter(r => r.p.includes('einsatz_save'));

async function anlegen(von, bis) {
  await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => openEinsatzNeu());
  await page.waitForTimeout(350);
  await page.evaluate(({ von }) => {
    $('enNKunde_name').value = 'Stranag';
    $('enNStrasse').value = 'Kantonsstrasse 3';
    $('enNOrt').value = '6000 Luzern';
    $('enNKanton').value = 'LU';
    $('enNDatum').value = von;
    $('enNVon').value = '07:30'; $('enNBis').value = '16:30';
  }, { von });
  if (bis) { await page.fill('#enNDatumBis', bis); }
  await page.evaluate(() => createEinsatz());
  await page.waitForTimeout(bis ? 1600 : 800);
}

// ── Ein einzelner Einsatz gehoert zu keiner Reihe
let vor = speicher().length;
await anlegen(tag(3), '');
const einzeln = speicher().slice(vor);
check('KRITISCH: ein einzelner Einsatz bekommt keine Serienkennung',
  einzeln.length === 1 && !einzeln[0].body.serie_neu && einzeln[0].body.serie_id === undefined);

// ── Eine Reihe: der erste Tag eroeffnet, die uebrigen haengen sich an
vor = speicher().length;
await anlegen(tag(10), tag(12));
const reihe = speicher().slice(vor);
check('KRITISCH: aus drei Tagen werden drei Einsätze', reihe.length === 3);
check('KRITISCH: der erste Tag eröffnet die Reihe und gibt KEINE Kennung vor',
  reihe[0].body.serie_neu === true && reihe[0].body.serie_id === undefined);
const kennung = EINSAETZE[EINSAETZE.length - 3].id;
check('KRITISCH: die folgenden Tage tragen die vom Server vergebene Kennung',
  Number(reihe[1].body.serie_id) === kennung && Number(reihe[2].body.serie_id) === kennung);
check('Die folgenden Tage eröffnen keine zweite Reihe',
  !reihe[1].body.serie_neu && !reihe[2].body.serie_neu);
check('KRITISCH: alle drei Tage tragen am Ende dieselbe Kennung',
  new Set(EINSAETZE.slice(-3).map(e => e.serie_id)).size === 1);
check('Und die Kennung ist die Nummer des ersten Tages',
  EINSAETZE[EINSAETZE.length - 3].serie_id === EINSAETZE[EINSAETZE.length - 3].id);

// ── Scheitert der erste Tag, uebernimmt der naechste
speicherFehlerBei = tag(20);
vor = speicher().length;
await anlegen(tag(20), tag(22));
const nachFehler = speicher().slice(vor);
check('KRITISCH: scheitert der erste Tag, eröffnet der nächste die Reihe',
  nachFehler.length === 3 && nachFehler[1].body.serie_neu === true);
check('Und der dritte hängt sich an diesen an',
  Number(nachFehler[2].body.serie_id) === EINSAETZE[EINSAETZE.length - 2].id);
speicherFehlerBei = null;

// ══════════════════════════════════════════════════════════════════════════
// TEIL 3 — Darstellung in der Übersicht
// ══════════════════════════════════════════════════════════════════════════
// Feste Ausgangslage, unabhaengig vom bisher Angelegten.
await page.evaluate(({ a, b, c, d, e1, e2 }) => {
  einsaetze = [
    { id: 1, kunde_name: 'Reihe AG', ort: '6000 Luzern', strasse: 'Weg 1', einsatzart: 'Verkehrsdienst',
      sparte: 'sicherheit', datum: a, von: '07:30:00', bis: '16:30:00', bedarf: 1, status: 'geplant',
      mitarbeiter: [], serie_id: 1, objekt_id: null, masterschicht_id: null },
    { id: 2, kunde_name: 'Reihe AG', ort: '6000 Luzern', strasse: 'Weg 1', einsatzart: 'Verkehrsdienst',
      sparte: 'sicherheit', datum: b, von: '07:30:00', bis: '16:30:00', bedarf: 1, status: 'geplant',
      mitarbeiter: [], serie_id: 1, objekt_id: null, masterschicht_id: null },
    { id: 3, kunde_name: 'Reihe AG', ort: '6000 Luzern', strasse: 'Weg 1', einsatzart: 'Verkehrsdienst',
      sparte: 'sicherheit', datum: c, von: '07:30:00', bis: '16:30:00', bedarf: 1, status: 'geplant',
      mitarbeiter: [], serie_id: 1, objekt_id: null, masterschicht_id: null },
    // Einzelgaenger
    { id: 4, kunde_name: 'Allein GmbH', ort: '4500 Solothurn', strasse: 'Gasse 2', einsatzart: 'Revierdienst',
      sparte: 'sicherheit', datum: d, von: '20:00:00', bis: '04:00:00', bedarf: 1, status: 'geplant',
      mitarbeiter: [], serie_id: null, objekt_id: null, masterschicht_id: null },
    // Objektschichten aus derselben Masterschicht -- fuer den Planer auch eine Reihe
    { id: 5, kunde_name: 'Objekt AG', ort: '3000 Bern', strasse: 'Platz 3', einsatzart: 'Revierdienst',
      sparte: 'sicherheit', datum: e1, von: '06:00:00', bis: '10:00:00', bedarf: 1, status: 'geplant',
      mitarbeiter: [], serie_id: null, objekt_id: 7, masterschicht_id: 44 },
    { id: 6, kunde_name: 'Objekt AG', ort: '3000 Bern', strasse: 'Platz 3', einsatzart: 'Revierdienst',
      sparte: 'sicherheit', datum: e2, von: '06:00:00', bis: '10:00:00', bedarf: 1, status: 'geplant',
      mitarbeiter: [], serie_id: null, objekt_id: 7, masterschicht_id: 44 },
    // Eine Masterschicht, aus der bisher EIN Tag entstanden ist -- keine Reihe
    { id: 7, kunde_name: 'Einmal AG', ort: '2500 Biel', strasse: 'Ring 4', einsatzart: 'Revierdienst',
      sparte: 'sicherheit', datum: d, von: '12:00:00', bis: '14:00:00', bedarf: 1, status: 'geplant',
      mitarbeiter: [], serie_id: null, objekt_id: 8, masterschicht_id: 55 },
  ];
  $('pHerkunft').value = '';
  $('pSchnell').value = 'alle'; pSchnellSetzen();
  renderPlanung();
}, { a: tag(1), b: tag(2), c: tag(3), d: tag(4), e1: tag(5), e2: tag(6) });
await page.waitForTimeout(400);

const marken = () => page.evaluate(() =>
  [...document.querySelectorAll('#plTable table .serie-marke')].map(b => b.textContent.trim()));

const m = await marken();
check('KRITISCH: jeder Tag einer Reihe sagt, der wievielte er ist',
  m.includes('Tag 1 von 3') && m.includes('Tag 2 von 3') && m.includes('Tag 3 von 3'));
check('KRITISCH: Objektschichten derselben Masterschicht gelten auch als Reihe',
  m.filter(x => x === 'Tag 1 von 2').length === 1 && m.filter(x => x === 'Tag 2 von 2').length === 1);
check('KRITISCH: ein einzelner Einsatz bekommt keine Marke', m.length === 5);
check('Eine Masterschicht mit nur einem Tag ist keine Reihe',
  await page.evaluate(() => !serieStand(einsaetze.find(e => e.id === 7))));

// ── Die Zeile ist eingefaerbt, und zwar NICHT in einer belegten Farbe
const farben = await page.evaluate(() => {
  const zeilen = [...document.querySelectorAll('#plTable table tbody tr.click')];
  const serie = zeilen.find(z => z.classList.contains('serie'));
  const normal = zeilen.find(z => !z.classList.contains('serie'));
  const gs = el => getComputedStyle(el.querySelector('td')).backgroundColor;
  const wurzel = getComputedStyle(document.documentElement);
  const tok = n => wurzel.getPropertyValue(n).trim();
  return { serie: serie ? gs(serie) : null, normal: normal ? gs(normal) : null,
    streifen: serie ? getComputedStyle(serie.querySelector('td')).boxShadow : null,
    belegt: ['--accent-soft', '--pos-soft', '--warn-soft', '--neg-soft'].map(tok),
    serieToken: tok('--serie-soft') };
});
check('KRITISCH: eine Reihe ist farblich abgesetzt', farben.serie !== farben.normal);
check('KRITISCH: die Farbe ist keine der bereits vergebenen',
  !farben.belegt.includes(farben.serieToken) && farben.serieToken !== '');
check('KRITISCH: der linke Streifen bleibt für heute und festgeschrieben reserviert',
  !farben.streifen || farben.streifen === 'none');

// ── Klick auf die Marke zeigt nur die Reihe
// Gezielt die dreitaegige Reihe, nicht "die erste Marke": Bei Zeitraum "Alle"
// steht das Neueste zuoberst, und das ist hier die Objektschicht-Reihe.
//
// Klicken ueber klick(): Ein fehlendes Element muss eine ROTE PRUEFUNG geben
// und nicht die Suite abbrechen. Genau das ist in einer Gegenprobe passiert --
// die Suite starb an einem null.click(), meldete keine einzige rote Pruefung,
// und alles danach lief nie. Ein Abbruch sieht in einem Sammellauf aus wie ein
// Fehler im Pruefwerkzeug, nicht wie ein Fehler im Produkt.
const klick = (name, wahl) => page.evaluate(w => {
  const el = document.querySelector(w.sel);
  const ziel = w.text
    ? [...document.querySelectorAll(w.sel)].find(x => x.textContent.trim() === w.text)
    : el;
  if (!ziel) { return false; }
  ziel.click();
  return true;
}, wahl).then(g => { check(name, g); return g; });

await klick('Die Marke der dreitägigen Reihe ist da und lässt sich klicken',
  { sel: '#plTable table .serie-marke', text: 'Tag 1 von 3' });
await page.waitForTimeout(400);
check('KRITISCH: der Klick zeigt nur die Reihe', (await marken()).length === 3);
check('KRITISCH: der Klick öffnet NICHT zugleich den Einsatz',
  await page.isVisible('#view-planung') && !(await page.isVisible('#view-einsatzplan')));
check('KRITISCH: es steht sichtbar da, dass gerade nur eine Reihe gezeigt wird',
  await page.isVisible('#pSerieFilter'));
const hinweis = await page.textContent('#pSerieFilter');
check('Der Hinweis nennt die Anzahl', /3\s/.test(hinweis));
check('KRITISCH: die Kopfzeile nennt den Bezug — nicht nur eine nackte Zahl',
  /3 von 7 Einsätzen/.test(await page.textContent('#pgCrumb')));
check('KRITISCH: "Tag 2 von 3" bleibt "von 3", auch wenn nur die Reihe dasteht',
  (await marken()).includes('Tag 2 von 3'));

// ── Auch ein Zeitraumfilter darf die Zahl nicht verbiegen
await page.evaluate(() => { serieFilterWeg(); });
await page.waitForTimeout(300);
await page.evaluate(({ a }) => { $('pVon').value = a; $('pBis').value = a; renderPlanung(); }, { a: tag(1) });
await page.waitForTimeout(300);
check('KRITISCH: ein Zeitraumfilter ändert die Reihenlänge nicht',
  (await marken()).join('|') === 'Tag 1 von 3');
await page.evaluate(() => { $('pSchnell').value = 'alle'; pSchnellSetzen(); });
await page.waitForTimeout(300);

// ── Eine Masterschicht-Reihe muss sich trotz Herkunftsfilter zeigen lassen
await page.evaluate(() => { $('pHerkunft').value = 'einsatz'; renderPlanung(); });
await page.waitForTimeout(300);
check('Mit "Nur Einsätze" sind die Objektschichten ausgeblendet',
  !(await marken()).some(x => x.endsWith('von 2')));
await page.evaluate(() => serieZeigen('m44'));
await page.waitForTimeout(400);
check('KRITISCH: eine Objektschicht-Reihe zeigt sich trotz Herkunftsfilter — ein Klick, der nichts zeigt, sieht aus wie "gibt es nicht"',
  (await marken()).length === 2);
await klick('Der Hinweis trägt einen Weg zurück zur ganzen Planung',
  { sel: '#pSerieFilter .btn' });
await page.waitForTimeout(400);
check('KRITISCH: "Ganze Planung zeigen" hebt den Filter wieder auf',
  !(await page.isVisible('#pSerieFilter')));
check('Und die Vorgabe-Filter greifen danach wieder',
  !(await marken()).some(x => x.endsWith('von 2')));

// ── Handy: Marke ist ein Bedienelement und hält die Trefferfläche ein
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => { $('pHerkunft').value = ''; renderPlanung(); });
await page.waitForTimeout(400);
const handy = await page.evaluate(() => {
  const b = document.querySelector('#plTable .nur-schmal .serie-marke');
  if (!b) { return null; }
  const r = b.getBoundingClientRect();
  const karte = b.closest('.ag-karte').getBoundingClientRect();
  return { hoehe: Math.round(r.height), breite: Math.round(r.width),
           kartenBreite: Math.round(karte.width),
           ueberlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
check('KRITISCH: auf dem Handy trägt die Karte die Marke ebenfalls', !!handy);
check('KRITISCH: sie hält die Trefferfläche von 44 px ein', handy && handy.hoehe >= 44);
check('Sie wird nicht über die volle Kartenbreite gezogen',
  handy && handy.breite < handy.kartenBreite * 0.8);
check('Kein Querlauf auf dem Handy', handy && handy.ueberlauf <= 1);
await page.setViewportSize({ width: 1500, height: 1000 });
await page.close();

// ══════════════════════════════════════════════════════════════════════════
// TEIL 4 — Routenlink in der App
// ══════════════════════════════════════════════════════════════════════════
const SCHICHTEN = [
  { id: 501, kunde_name: 'Stranag', objekt_name: null, titel: null, strasse: 'Kantonsstrasse 3',
    ort: '6000 Luzern', kanton: 'LU', einsatzart: 'Verkehrsdienst', datum: tag(1),
    von: '07:30:00', bis: '16:30:00', status: 'geplant', zusage: 'offen', im_team: 1,
    treffpunkt: null, taetigkeit: null, qualifikation: null, bemerkung: null,
    kontakt_vorname: null, kontakt_nachname: null, kontakt_telefon: null },
  // Ohne Strasse: der Ort allein muss als Ziel genügen.
  { id: 502, kunde_name: 'Nur Ort AG', objekt_name: null, titel: null, strasse: null,
    ort: '3000 Bern', kanton: null, einsatzart: 'Revierdienst', datum: tag(2),
    von: '09:00:00', bis: '12:00:00', status: 'geplant', zusage: 'offen', im_team: 1,
    treffpunkt: null, taetigkeit: null, qualifikation: null, bemerkung: null,
    kontakt_vorname: null, kontakt_nachname: null, kontakt_telefon: null },
];
const app = await browser.newPage({ viewport: { width: 390, height: 844 } });
app.on('pageerror', e => bad.push('JS-Fehler (App): ' + e.message));
await app.route('**/api/**', route => {
  const u = route.request().url();
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'daniele', ist_admin: false });
  if (u.includes('meine_schichten')) return send({ status: 'ok', schichten: SCHICHTEN });
  if (u.includes('mein_profil')) return send({ status: 'ok', monat: { anzahl: 0, stunden: 0 },
    profil: { name: 'daniele', ist_admin: false } });
  if (u.includes('einsatz_dokument')) return send({ status: 'ok', dokumente: [] });
  return send({ status: 'ok', schichten: [], rapporte: [], sperren: [] });
});
await app.goto(`file://${WURZEL}/app.html`);
await app.fill('#gName', 'daniele'); await app.fill('#gPass', 'x'); await app.click('#gBtn');
await app.waitForTimeout(900);
await app.evaluate(() => { zeige('plan'); });
await app.waitForTimeout(400);
await app.evaluate(() => blattAuf(501));
await app.waitForTimeout(500);

const knopf = await app.evaluate(() => {
  const a = document.querySelector('#blBody .route-knopf');
  if (!a) { return null; }
  const r = a.getBoundingClientRect();
  return { href: a.getAttribute('href'), ziel: a.getAttribute('target'),
           rel: a.getAttribute('rel'), text: a.textContent.trim(),
           hoehe: Math.round(r.height), breite: Math.round(r.width),
           blattBreite: Math.round(document.getElementById('blBody').getBoundingClientRect().width) };
});
check('KRITISCH: die Schicht bietet einen Weg zur Route', !!knopf);
check('KRITISCH: die Zieladresse ist die Adresse der Schicht',
  knopf && decodeURIComponent((knopf.href.split('destination=')[1] || '')) === 'Kantonsstrasse 3, 6000 Luzern, LU');
check('KRITISCH: der Link trägt kein origin — der Standort der Person bleibt bei ihr',
  knopf && !knopf.href.includes('origin='));
check('Er öffnet ausserhalb der App', knopf && knopf.ziel === '_blank' && /noopener/.test(knopf.rel || ''));
check('KRITISCH: er hält die Trefferfläche von 44 px ein', knopf && knopf.hoehe >= 44);
check('Er wird nicht über die volle Breite gezogen',
  knopf && knopf.breite < knopf.blattBreite * 0.8);
check('Die Beschriftung sagt, was passiert', knopf && /Route/.test(knopf.text));

await app.evaluate(() => blattAuf(502));
await app.waitForTimeout(400);
const ohneStrasse = await app.evaluate(() => {
  const a = document.querySelector('#blBody .route-knopf');
  return a ? decodeURIComponent((a.getAttribute('href').split('destination=')[1] || '')) : null;
});
check('KRITISCH: auch ohne Strasse führt der Ort als Ziel', ohneStrasse === '3000 Bern');
check('KRITISCH: eine Schicht ohne jede Adresse bietet keinen Routenknopf',
  await app.evaluate(() => schichtAdresse({ strasse: null, ort: '', kanton: null }) === ''));
check('Kein Querlauf durch den Knopf',
  await app.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 1);

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(x => console.log('  ✗ ' + x)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
