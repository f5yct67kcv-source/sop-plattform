// Pensen-Kontrolle nach Art. 8 GAV (ENT-065).
//
// Der gefaehrlichste Fehler hier waere ein Balken, der Sicherheit
// vortaeuscht: Die Zahl ist unvollstaendig (Feiertagsbonus, Zeitzuschlag und
// Ferien fehlen), sie ist also ein MINDESTWERT. Mehrere Pruefungen zielen
// darauf, dass das an der Oberflaeche steht -- und zwar SICHTBAR.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const J = new Date().getFullYear();

// n Schichten a 8 h -> n*8 Stunden. Tagsueber, also ohne Zeitbonus.
const sch = (n, sparte = 'sicherheit') => Array.from({ length: n }, (_, i) => ({
  datum: `${J}-0${1 + (i % 9)}-${String(1 + (i % 27)).padStart(2, '0')}`,
  von: '08:00', bis: '16:00', pause_min: null, pause_bezahlt_ma: null, sparte,
}));
const MA = [
  // 120 x 8 h = 960 h -> ueber 900, aber unter 945? Nein: 960 > 945 -> ueber_toleranz
  { id: 1, name: 'anna', vorname: 'Anna', nachname: 'Muster', personalnummer: '1',
    kategorie: 'C', pensum: 900, schichten: sch(120), offen: 4 },
  // 60 x 8 = 480 h -> ok
  { id: 2, name: 'beat', vorname: 'Beat', nachname: 'Muster', personalnummer: '2',
    kategorie: 'C', pensum: 900, schichten: sch(60), offen: 0 },
  // 105 x 8 = 840 h -> 93 % von 900 -> nahe
  { id: 3, name: 'cara', vorname: 'Cara', nachname: 'Beispiel', personalnummer: '3',
    kategorie: 'C', pensum: 900, schichten: sch(105), offen: 1 },
  // ohne Kategorie -> keine Grenze
  { id: 4, name: 'dino', vorname: 'Dino', nachname: 'Muster', personalnummer: '4',
    kategorie: null, pensum: null, schichten: sch(30), offen: 0 },
  // 40 Sicherheit + 50 Reinigung: nur 320 h zaehlen
  { id: 5, name: 'eva', vorname: 'Eva', nachname: 'Beispiel', personalnummer: '5',
    kategorie: 'C', pensum: 900, schichten: sch(40).concat(sch(50, 'reinigung')), offen: 1 },
];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(5000);
await page.route('**/api/**', r => {
  const u = r.request().url();
  const send = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (u.includes('pensen')) return send({ status: 'ok', jahr: J, eingerichtet: true, mitarbeiter: MA });
  return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [],
    letzte_rapporte: [], mitarbeiter: [], kunden: [], einsaetze: [], objekte: [], rapporte: [],
    orte: [], feiertage: [], gepflegt: {} });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(700);

// ══════════════ DIE REGEL
const st = (k, bewertetStd, rohStd) => page.evaluate(([a, b, c]) => {
  const s = gavKatStand(a, b * 60, c * 60);
  return s ? { stufe: s.stufe, grenze: s.grenze, toleranz: s.toleranz, rohUeber: s.rohUeber } : null;
}, [k, bewertetStd, rohStd]);

check('Kategorie C hat die Grenze 900', (await st('C', 500, 500)).grenze === 900);
check('Kategorie B hat die Grenze 1800', (await st('B', 500, 500)).grenze === 1800);
check('Kategorie A hat die Grenze 2300', (await st('A', 500, 500)).grenze === 2300);
check('Die 5-%-Toleranz ergibt 945 bei C', (await st('C', 500, 500)).toleranz === 945);
check('500 h in C sind unauffaellig', (await st('C', 500, 500)).stufe === 'ok');
check('810 h in C (90 %) gelten als nahe', (await st('C', 810, 810)).stufe === 'nahe');
check('KRITISCH: genau 900 h ist noch nicht ueber der Grenze', (await st('C', 900, 900)).stufe === 'nahe');
check('KRITISCH: 901 h ist ueber der Grenze', (await st('C', 901, 901)).stufe === 'ueber_grenze');
check('945 h liegt noch in der Toleranz', (await st('C', 945, 945)).stufe === 'ueber_grenze');
check('KRITISCH: 946 h sprengt die Toleranz', (await st('C', 946, 946)).stufe === 'ueber_toleranz');
check('KRITISCH: ohne Kategorie gibt es keine Grenze, nicht eine geratene',
  (await st(null, 500, 500)) === null);

// Art. 8 Ziff. 4: eigener Ausloeser auf der ROHZEIT, nur Kategorie C.
check('KRITISCH: 1010 geleistete Stunden loesen Ziff. 4 aus, auch wenn bewertet alles ok ist',
  (await st('C', 800, 1010)).rohUeber === true && (await st('C', 800, 1010)).stufe === 'ok');
check('Die Rohzeit-Schwelle gilt nicht fuer Kategorie B',
  (await st('B', 800, 1010)).rohUeber === false);

// ══════════════ DIE SEITE
await page.evaluate(() => go('pensen'));
await page.waitForTimeout(900);
check('Die Rubrik Kontrolle existiert', await page.evaluate(() => !!document.getElementById('navg-kontrolle')));
check('Die Seite Pensen ist offen', await page.isVisible('#view-pensen.on'));
check('Die Kopfzeile nennt die Seite', (await page.textContent('#pgTitle')) === 'Pensen');

const zeilen = await page.evaluate(() => [...document.querySelectorAll('.pn-zeile')].map(z => ({
  name: z.querySelector('b').textContent.trim(),
  klasse: [...z.classList].find(c => c.startsWith('pn-') && c !== 'pn-zeile'),
  zahl: z.querySelector('.zahl').textContent.replace(/\s+/g, ' ').trim(),
  sub: z.querySelector('.sub').textContent.replace(/\s+/g, ' ').trim(),
  bar: !!z.querySelector('.pn-bar'),
})));
const nach = n => zeilen.find(z => z.name === n);

check('Alle fuenf Personen erscheinen', zeilen.length === 5);
check('KRITISCH: 960 h in Kategorie C sind rot markiert', nach('Anna Muster').klasse === 'pn-ueber_toleranz');
check('840 h gelten als nahe der Grenze', nach('Cara Beispiel').klasse === 'pn-nahe');
check('480 h sind unauffaellig', nach('Beat Muster').klasse === 'pn-ok');
check('KRITISCH: ohne Kategorie kein Balken und keine Farbe',
  nach('Dino Muster').klasse === 'pn-ohne' && nach('Dino Muster').bar === false);
check('Ohne Kategorie steht da, warum nicht geprueft wird',
  /keine Grenze prüfen/.test(await page.textContent('#pnListe')));

check('KRITISCH: die Zahl ist als Mindestwert gekennzeichnet', /mind\./.test(nach('Anna Muster').zahl));
check('Die Grenze steht neben der Zahl', /von 900/.test(nach('Anna Muster').zahl));
// 40 Schichten Sicherheit (320 h) + 50 Schichten Reinigung (400 h). Zaehlen
// duerfen nur die 320 h plus deren Zeitbonus -- nie die 720 h zusammen.
const evaStd = Number((nach('Eva Beispiel').zahl.match(/(\d+):\d\d h/) || [])[1] || 0);
check('KRITISCH: Reinigungsstunden zaehlen nicht in die Grenze',
  evaStd >= 320 && evaStd < 340);
check('KRITISCH: die 400 Reinigungsstunden sind nirgends mitaddiert', evaStd < 700);
check('Sie werden aber ausgewiesen, nicht verschwiegen',
  /Reinigung \(zählt nicht\)/.test(nach('Eva Beispiel').sub));
check('Nicht abgeglichene Schichten werden benannt',
  /4 Schichten noch nicht abgeglichen/.test(nach('Anna Muster').sub));
check('Bei einer einzelnen Schicht steht Einzahl',
  /1 Schicht noch nicht abgeglichen/.test(nach('Cara Beispiel').sub));

// Die Meldung darf keine Pflicht behaupten, die Art. 8 Ziff. 3 so nicht kennt.
const meldung = await page.textContent('#pnListe');
check('KRITISCH: die Meldung nennt die Entschaedigung des ganzen Pensums',
  /ganze Pensum/.test(meldung));
check('KRITISCH: sie sagt, dass die Ueberfuehrungspflicht erst im Wiederholungsfall greift',
  /erst im Wiederholungsfall/.test(meldung));

// ══════════════ DER VORBEHALT MUSS SICHTBAR SEIN
const hinweis = await page.evaluate(() => {
  const e = document.querySelector('#pnHinweis .ki-hint');
  return (e && e.getClientRects().length) ? e.textContent.replace(/\s+/g, ' ').trim() : null;
});
if (!hinweis) { bad.push('KRITISCH: der Vorbehalt ist nicht sichtbar'); }
else {
  check('KRITISCH: der Vorbehalt ist sichtbar', true);
  check('Er sagt, dass die Zahlen Mindestwerte sind', /Mindestwerte/.test(hinweis));
  check('Er nennt den fehlenden Feiertagsbonus', /Feiertagsbonus/.test(hinweis));
  check('Er nennt den fehlenden Zeitzuschlag', /Zeitzuschlag/.test(hinweis));
  check('Er nennt die fehlenden Ferien', /Ferien/.test(hinweis));
  check('KRITISCH: er sagt, dass der Balken zu SPAET ausschlaegt, nicht zu frueh',
    /zu spät/.test(hinweis));
}

// ══════════════ SORTIERUNG
await page.selectOption('#pnSort', 'std_auf');
await page.waitForTimeout(300);
const auf = await page.evaluate(() => [...document.querySelectorAll('.pn-zeile b')].map(b => b.textContent.trim()));
check('Aufsteigend sortiert steht die kleinste Zahl zuoberst', auf[0] === 'Dino Muster');
await page.selectOption('#pnSort', 'std_ab');
await page.waitForTimeout(300);
const ab = await page.evaluate(() => [...document.querySelectorAll('.pn-zeile b')].map(b => b.textContent.trim()));
check('Absteigend sortiert steht die groesste Zahl zuoberst', ab[0] === 'Anna Muster');
check('Beide Richtungen kehren einander um', auf[0] === ab[ab.length - 1]);

await page.check('#pnNurKat');
await page.waitForTimeout(300);
check('Der Filter blendet Personen ohne Kategorie aus',
  (await page.evaluate(() => document.querySelectorAll('.pn-zeile').length)) === 4);
await page.uncheck('#pnNurKat');
await page.waitForTimeout(300);

// ══════════════ QUELLEN UND VERTRAG
const gavQ = readFileSync(`${WURZEL}/gav.js`, 'utf8');
const dashQ = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
const pensenPhp = readFileSync(`${WURZEL}/backend/api/pensen.php`, 'utf8');
check('Die Kategorien stehen in gav.js', /GAV_KATEGORIEN/.test(gavQ));
check('KRITISCH: das Dashboard haelt keine eigene Kopie der Grenzen',
  !/grenze: 900/.test(dashQ));
check('Der Wortlaut von Art. 8 Ziff. 1c ist als Beleg im Code zitiert',
  /inkl\. Ferien und Zeitbonus/.test(gavQ));
check('KRITISCH: der Endpunkt rechnet NICHT selbst, sondern liefert Rohdaten',
  !/gavBonusMin|bonus_min/.test(pensenPhp) && /schichten/.test(pensenPhp));
check('SERVER: die Pensenuebersicht braucht das Planungsrecht (ENT-077)',
  /require_recht\(\$user, 'plan'\)/.test(pensenPhp));
check('SERVER: nur abgeglichene Schichten zaehlen, offene werden gezaehlt',
  /ist_status/.test(pensenPhp) && /'offen'/.test(pensenPhp));
check('EINRICHTUNG: die Kategoriespalten werden nachgetragen',
  /anstellungskategorie/.test(readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8')));

await page.screenshot({ path: `${OUT}/pn-02.png`, fullPage: true });
await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
