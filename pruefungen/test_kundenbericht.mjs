// Gemeinsamer Kundenbericht fuer einen Einsatz (ENT-160).
//
// WORAUF DIESE SUITE BESONDERS ACHTET:
//
// 1. Es wird NICHTS zusammengelegt. Der Projektinhaber hatte vorgeschlagen,
//    im Rapport eine zweite Person mitzuerfassen und EINEN Rapport zu senden.
//    Das waere falsch: Der Rapport traegt Lohn und die Abrechnung nach
//    Art. 12 Ziff. 5 GAV, niemand darf die Arbeitszeit eines anderen
//    behaupten. Zusammengefuegt wird nur das DOKUMENT.
//
// 2. Unterschiedliche Zeiten sind der Normalfall, nicht die Ausnahme. Im
//    Beispiel des Projektinhabers endete eine Person 15:15, die andere 16:15.
//    Das Blatt muss beide Zeiten zeigen, nicht eine geglaettete.
//
// 3. Die Unterschrift gehoert zum EINSATZ, und nur die ERSTE zaehlt. Wuerde
//    der zweite Rapport sie ueberschreiben, wanderte der Zeitstempel, obwohl
//    der Kunde nur einmal unterschrieben hat.
//
// 4. Der Zeitstempel der Unterschrift steht auf dem Blatt. Wer zuerst fertig
//    ist, laesst unterschreiben; wer laenger bleibt, rapportiert danach. Die
//    Unterschrift deckt dann eine Zeit, die es beim Unterschreiben noch nicht
//    gab -- datiert ist das sichtbar statt stillschweigend behauptet.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const HEUTE = iso(new Date());

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Server (Quelltext)
// ══════════════════════════════════════════════════════════════════════════
const BER = readFileSync(`${WURZEL}/backend/api/einsatz_bericht.php`, 'utf8');
const CRE = readFileSync(`${WURZEL}/backend/api/rapport_create.php`, 'utf8');
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const MEIN = readFileSync(`${WURZEL}/backend/api/meine_schichten.php`, 'utf8');

check('KRITISCH: die Unterschrift-Spalten liegen am EINSATZ, nicht nur am Rapport',
  ['unterschrift', 'unterzeichner', 'unterschrift_von', 'unterschrift_am']
    .every(s => new RegExp(`\\['einsaetze', '${s}',`).test(EINR)));
check('KRITISCH: nur die ERSTE Unterschrift wird uebernommen — sonst wandert der Zeitstempel',
  /UPDATE einsaetze[\s\S]{0,400}WHERE id = \? AND unterschrift IS NULL/.test(CRE));
check('KRITISCH: sie wird nur bei einem Schicht-Rapport mit Unterschrift gesetzt',
  // Die Sperre der abgeglichenen Schicht (ENT-045) steht mit in der Bedingung.
  // Sie hier mitzupruefen ist Absicht: Wer die Bedingung kuerzt, faellt hier auf,
  // nicht erst in test_schichtrapport.mjs.
  /if \(\$einsatzId > 0 && \$sig !== null && !einsatz_abgeglichen\(db\(\), \$einsatzId\)\)/.test(CRE));
check('Die einholende Person und der Zeitpunkt werden mitgeschrieben',
  /unterschrift_von = \?, unterschrift_am = NOW\(\)/.test(CRE));
check('KRITISCH: am Rapport bleibt die Unterschrift zusaetzlich stehen — ein Einzelrapport gilt weiterhin fuer sich',
  /INSERT INTO rapporte[\s\S]{0,300}unterzeichner, unterschrift/.test(CRE));

check('KRITISCH: der Bericht verlangt das Recht "abgleich" — auf dem Blatt stehen fremde Zeiten',
  /require_recht\(\$user, 'abgleich'\)/.test(BER));
check('KRITISCH: je Person zaehlt der NEUESTE Rapport (dieselbe Regel wie im Abgleich)',
  /ORDER BY r\.mitarbeiter_id, r\.erfasst_am DESC, r\.id DESC/.test(BER)
  && /if \(isset\(\$proPerson\[\$mid\]\)\) \{ continue; \}/.test(BER));
check('KRITISCH: der Bericht legt KEINE Rapporte zusammen — er liest sie nur',
  !/INSERT INTO rapporte/.test(BER) && !/UPDATE rapporte/.test(BER));
check('Die Personen stehen nach Arbeitsbeginn sortiert, nicht nach Erfassungsreihenfolge',
  /usort\(\$personen, fn\(\$a, \$b\) => strcmp\(\(string\)\$a\['von'\], \(string\)\$b\['von'\]\)\)/.test(BER));
check('KRITISCH: die App erfaehrt, ob schon unterschrieben wurde — aber NICHT das Unterschriftsbild',
  /\(e\.unterschrift IS NOT NULL\) AS schon_unterschrieben/.test(MEIN)
  && !/e\.unterschrift\b(?! IS NOT NULL)/.test(MEIN.replace(/--[^\n]*/g, '')));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Das Blatt
// ══════════════════════════════════════════════════════════════════════════
const MA = [{ id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'Von Arb', aktiv: 1, ist_admin: 1 }];
const EINSAETZE = [
  { id: 79, kunde_id: 1, kunde_name: 'pzu Consulting GmbH', titel: null, strasse: 'Mustergasse 2',
    ort: '8200 Schaffhausen', einsatzart: 'Verkehrsdienst', datum: HEUTE, von: '07:15:00',
    bis: '15:30:00', bedarf: 2, status: 'abgeschlossen', bemerkung: null, objekt_id: null,
    mitarbeiter: [{ id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'Von Arb' },
                  { id: 2, name: 'daniele', vorname: 'Daniele', nachname: 'Ciardo' }],
    hat_unterschrift: 1, unterzeichner: 'M. Bauleiter', unterschrift_am: HEUTE + ' 15:20:00' },
];
// Genau der Fall aus dem Bildschirmfoto: gleicher Einsatz, VERSCHIEDENE Zeiten.
const BERICHT = {
  einsatz: { id: 79, kunde_name: 'pzu Consulting GmbH', titel: null, veranstaltung: null,
    strasse: 'Mustergasse 2', ort: '8200 Schaffhausen', einsatzart: 'Verkehrsdienst',
    datum: HEUTE, von: '07:15:00', bis: '15:30:00', bemerkung: null },
  kunde: { kunde_id: 1, kunde_nr: 'K0001', k_name: 'pzu Consulting GmbH', k_strasse: 'Mustergasse',
    k_hausnummer: '2', k_adresszusatz: null, k_plz: '8200', k_ort: 'Schaffhausen',
    re_name: null, re_zusatz: null, re_strasse: null, re_hausnummer: null, re_plz: null, re_ort: null },
  unterschrift: { bild: null, name: 'M. Bauleiter', am: HEUTE + ' 15:20:00', holte: 'adrian' },
  personen: [
    { id: 10, name: 'Adrian Von Arb', von: '07:15:00', bis: '15:15:00', pause_min: 30,
      netto_h: 7.5, bemerkung: null, erfasst_am: HEUTE + ' 15:17:00' },
    { id: 11, name: 'Daniele Ciardo', von: '07:15:00', bis: '16:15:00', pause_min: 45,
      netto_h: 8.25, bemerkung: 'Verlängerung durch Bauleitung angeordnet.', erfasst_am: HEUTE + ' 16:20:00' },
  ],
};

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

let berichtRufe = 0;
await page.route('**/api/**', route => {
  const u = route.request().url();
  const s = x => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return s({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (u.includes('me.php')) return s({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [], rechte: ['abgleich', 'betrieb'] });
  if (u.includes('einsatz_bericht')) { berichtRufe++; return s({ status: 'ok', bericht: BERICHT }); }
  if (u.includes('betrieb.php')) return s({ status: 'ok', betrieb: { firma: 'CUPI 24 GmbH',
    zusatz: 'Sicherheits- und Verkehrsdienst', fusszeile: 'Musterweg 1 · 4600 Olten',
    fusszeile2: 'Zweitsitz · Bahnhofstrasse 3', logo: null,
    logo_mime: null, logo_groesse: null } });
  if (u.includes('mitarbeiter_list')) return s({ status: 'ok', mitarbeiter: MA });
  if (u.includes('einsatz_list')) return s({ status: 'ok', einsaetze: EINSAETZE });
  if (u.includes('dashboard_stats')) return s({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [],
    pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
  return s({ status: 'ok', einsaetze: [], rapporte: [], kunden: [], objekte: [], feiertage: [],
    gepflegt: {}, sperren: [], adressen: [], wege: [], fahrzeuge: [], dokumente: [], positionen: [], orte: [] });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(600);
await page.evaluate(() => { window.__gedruckt = 0; window.print = () => { window.__gedruckt++; }; });

const blatt = await page.evaluate(b => epBerichtBlatt(b), BERICHT);
check('KRITISCH: das Blatt heisst Kundenrapport und nennt den Einsatz', /Kundenrapport/.test(blatt) && /Einsatz-Nr\. 79/.test(blatt));
check('KRITISCH: BEIDE Personen stehen darauf', /Adrian Von Arb/.test(blatt) && /Daniele Ciardo/.test(blatt));
check('KRITISCH: jede mit IHREN eigenen Zeiten — verschiedene Zeiten werden nicht geglättet',
  /15:15/.test(blatt) && /16:15/.test(blatt));
check('KRITISCH: auch die unterschiedlichen Pausen stehen einzeln da',
  /30′/.test(blatt) && /45′/.test(blatt));
check('KRITISCH: die Summe der Nettostunden stimmt (7.50 + 8.25 = 15.75)', /15\.75 h/.test(blatt));
check('Die Kunden-Nr. steht auf dem Blatt', /K0001/.test(blatt));
check('Der Briefkopf aus den Betriebseinstellungen ist da', /CUPI 24 GmbH/.test(blatt));
check('Die Fusszeile ebenfalls', /Musterweg 1/.test(blatt));
check('KRITISCH: der zweite Fusszeilen-Block (Zweitsitz, ENT-169) steht daneben', /Bahnhofstrasse 3/.test(blatt));
check('KRITISCH: eine Bemerkung wird der Person zugeordnet, nicht anonym angehängt',
  /Daniele Ciardo:<\/b> Verlängerung/.test(blatt));
check('Eine Person ohne Bemerkung erscheint dort nicht',
  !/Adrian Von Arb:<\/b>/.test(blatt));
check('KRITISCH: der Zeitpunkt der Unterschrift steht auf dem Blatt — sie deckt nicht mehr, als sie deckt',
  /Unterschrift erfasst am/.test(blatt) && /durch adrian/.test(blatt));
check('Der Name des Unterzeichners steht da', /M\. Bauleiter/.test(blatt));

// ── Der Knopf im Einsatzplan
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(400);
await page.evaluate(() => epAuf(79));
await page.waitForTimeout(700);
check('KRITISCH: der abgeschlossene Einsatz bietet "Kundenrapport drucken"',
  await page.evaluate(() => !!([...document.querySelectorAll('#epKopf button')]
    .find(b => b.textContent.includes('Kundenrapport drucken')))));
await page.evaluate(() => [...document.querySelectorAll('#epKopf button')]
  .find(b => b.textContent.includes('Kundenrapport drucken')).click());
await page.waitForTimeout(600);
check('KRITISCH: der Knopf holt den Bericht frisch vom Server', berichtRufe > 0);
check('KRITISCH: und loest das Drucken aus', await page.evaluate(() => window.__gedruckt > 0));
check('Das Gedruckte ist der gemeinsame Bericht, nicht der Einzelrapport',
  await page.evaluate(() => /Kundenrapport/.test($('printArea').innerHTML)
    && /Daniele Ciardo/.test($('printArea').innerHTML)));

// ── Kein leeres zweites Blatt beim Drucken (ENT-179): @page setzt einen
// festen Rand, statt ihn dem Browser-Standard plus dem eigenen CSS-Padding
// zu ueberlassen -- die doppelte Randbreite hatte ein knapp einseitiges
// Blatt zuvor auf eine fast leere zweite Seite gedraengt (in Safari
// gemeldet, hier ueber die Druck-Medienabfrage nachgebildet).
await page.emulateMedia({ media: 'print' });
const seitenrand = await page.evaluate(() => {
  // @page steckt in @media print -- eine flache Suche in cssRules findet nur
  // die CSSMediaRule selbst, nicht die darin verschachtelte @page-Regel.
  function alle(regeln) {
    let out = [];
    for (const r of regeln) { out.push(r); if (r.cssRules) { out = out.concat(alle(r.cssRules)); } }
    return out;
  }
  const regel = [...document.styleSheets].flatMap(s => {
    try { return alle(s.cssRules); } catch { return []; }
  }).find(r => r instanceof CSSPageRule);
  return {
    pageRuleMargin: regel ? regel.style.margin : null,
    printAreaPadding: getComputedStyle(document.getElementById('printArea')).padding,
  };
});
check('KRITISCH: @page setzt einen eigenen Seitenrand (12mm)', seitenrand.pageRuleMargin === '12mm');
check('KRITISCH: #printArea verdoppelt den Rand im Druck nicht mehr mit eigenem Padding',
  seitenrand.printAreaPadding === '0px');
await page.emulateMedia({ media: 'screen' });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
