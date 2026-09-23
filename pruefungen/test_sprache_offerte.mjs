// Offerte und Rechnung per Spracheingabe (ENT-695).
//
// Die Antworten des Routers kommen aus der echten Auswertung des Servers
// (ki_felder_auswerten() in ai.php), nicht aus einer hier ausgedachten --
// sonst prueft der Test eine Antwort, die der Server gar nicht gibt.
// Ausgedacht ist nur, was das Modell liefert.
//
// Geprueft wird die Aussage der Oberflaeche:
//  - blau heisst uebernommen, orange heisst gesagt, aber nicht zugeordnet;
//  - ein Preis kommt nur aus dem Katalog, nie aus dem Diktat;
//  - ein unbekannter Kunde wird nicht still angelegt, sondern angeboten;
//  - nichts wird gespeichert.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const KU = [
  { id: 7, name: 'Beispiel AG', strasse: 'Bahnhofstrasse 1', ort: '4600 Olten', aktiv: 1 },
  { id: 9, name: 'Muster GmbH', strasse: 'Ringweg 2', ort: '4600 Olten', aktiv: 1 },
];
const PR = [
  { id: 3, nummer: 'L-1', name: 'Verkehrsdienst', beschreibung: 'Verkehrsregelung durch ausgebildetes Personal',
    einzelpreis_rappen: 8500, einheit: 'Std.', mwst_satz_bp: 810, sortierung: 1, aktiv: 1 },
  { id: 4, nummer: 'L-2', name: 'Objektschutz', beschreibung: '', einzelpreis_rappen: 7200,
    einheit: 'Std.', mwst_satz_bp: 810, sortierung: 2, aktiv: 1 },
];
const LISTEN = {
  kunden: KU.map(k => ({ id: k.id, name: k.name })),
  produkte: PR.map(p => ({ id: p.id, name: p.name, einheit: p.einheit })),
};
const serverAntwort = modell => JSON.parse(execFileSync('php', ['-r',
  `require '${WURZEL}/backend/ai.php'; [$c, $a] = ki_felder_auswerten('beleg_neu', json_decode($argv[1], true), json_decode($argv[2], true)); echo json_encode([$c, $a]);`,
  JSON.stringify(modell), JSON.stringify(LISTEN)]).toString());

const rufe = [];
let routerAntwort = null;
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), p = req.url().split('/api/')[1].split('?')[0];
  rufe.push(p);
  const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'hansmuster', ist_admin: true });
  if (p.includes('ki_router_parse')) return routerAntwort ? send(routerAntwort[1], routerAntwort[0])
    : send({ status: 'error', message: 'kein Mock' }, 502);
  if (p.includes('produkt_list')) return send({ status: 'ok', produkte: PR });
  if (p.includes('beleg_list')) return send({ status: 'ok', belege: [], naechste_nummer: 'OF-2000-001' });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: KU });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [
    { id: 1, name: 'hansmuster', vorname: 'Hans', nachname: 'Muster', aktiv: 1, ist_admin: 1 }] });
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0,
    stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 1, kunden: 2, rapporte_total: 0 },
    verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
  return send({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], gepflegt: {}, sperren: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'hansmuster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);

const diktieren = async (modell, text) => {
  routerAntwort = serverAntwort(modell);
  await page.fill('#rtText', text);
  await page.click('#rtBtn');
  await page.waitForTimeout(600);
};
// Gemessen im Ruhezustand: ohne Fokus (der Fokusrahmen hat eine eigene
// Farbe) und nach der Ueberblendung der Randfarbe.
const farbe = async sel => {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(250);
  return page.evaluate(s => getComputedStyle(document.querySelector(s)).borderTopColor, sel);
};
const tokens = await page.evaluate(() => {
  // Die Farben der beiden Markierungen, gemessen an Probe-Feldern -- nicht
  // aus dem Quelltext gelesen.
  const probe = k => { const i = document.createElement('input'); i.className = 'inp ' + k;
    document.body.appendChild(i); const c = getComputedStyle(i).borderTopColor; i.remove(); return c; };
  return { blau: probe('ki'), orange: probe('ki-offen'), normal: probe('') };
});
check('Blau und orange sind sichtbar verschieden, und beide anders als ein normales Feld',
  tokens.blau !== tokens.orange && tokens.blau !== tokens.normal && tokens.orange !== tokens.normal);

// ══════════ BEKANNTER KUNDE, EINE POSITION IM KATALOG, EINE NICHT
await diktieren({ art: 'offerte', kunde_name: 'beispiel ag', titel: 'Umzug am Samstag', positionen: [
  { produkt_id: 3, leistung: 'Verkehrsdienst', menge: 16, einheit: 'Tag' },
  { leistung: 'Absperrgitter', menge: 10, einheit: 'Stk.' },
] }, 'Offerte für die Beispiel AG, 16 Stunden Verkehrsdienst und 10 Absperrgitter, Umzug am Samstag');

check('KRITISCH: die Offerte geht auf, nicht der Einsatz', await page.isVisible('#view-offerte.on')
  && !(await page.isVisible('#view-einsatzneu.on')));
check('Empfänger steht in der Schreibweise der Kundenliste', (await page.inputValue('#of_kunde')) === 'Beispiel AG');
check('Empfänger ist blau (übernommen)', (await farbe('#of_kunde')) === tokens.blau);
check('Der Empfänger ist wirklich gewählt, nicht nur hingeschrieben (Ansprechpersonen hängen daran)',
  await page.evaluate(() => ofFormKundeId === 7));
check('Kein Hinweis „nicht in der Kundenliste" bei einem bekannten Kunden', !(await page.isVisible('#ofKundeHinweis')));
check('Titel ist übernommen und blau', (await page.inputValue('#of_titel')) === 'Umzug am Samstag'
  && (await farbe('#of_titel')) === tokens.blau);

check('Zwei Positionen', await page.evaluate(() => ofPos.length === 2));
check('Katalogposition: Name aus dem Katalog, blau', (await page.inputValue('#ofp_name0')) === 'Verkehrsdienst'
  && (await farbe('#ofp_name0')) === tokens.blau);
check('KRITISCH: der Preis der Katalogposition kommt aus dem Katalog', (await page.inputValue('#ofp_preis0')) === '85.00');
check('Die Einheit gehört zum Katalogeintrag, nicht zur gesagten („Tag" hätte den Betrag verfälscht)',
  await page.evaluate(() => ofPos[0].einheit === 'Std.'));
check('Menge ist übernommen', (await page.inputValue('#ofp_menge0')) === '16');
check('Freitextposition: gesagter Text, orange', (await page.inputValue('#ofp_name1')) === 'Absperrgitter'
  && (await farbe('#ofp_name1')) === tokens.orange);
check('KRITISCH: der Preis der Freitextposition ist leer, nicht 0.00 (sähe aus wie gratis)',
  (await page.inputValue('#ofp_preis1')) === '');
check('Unter der Freitextposition steht, was zu tun ist', await page.isVisible('#ofp_hint1'));
check('Unter der Katalogposition steht kein solcher Hinweis', !(await page.isVisible('#ofp_hint0')));

check('Das Band oben ist da', await page.isVisible('#ofKiHint'));
const band = await page.textContent('#ofKiText');
check('Das Band nennt Übernommenes und Offenes getrennt', /übernommen/.test(band) && /Noch offen/.test(band)
  && /nicht im Katalog/.test(band));
check('Das Band sagt, dass nichts gespeichert ist', /nichts gespeichert/.test(band));
check('KRITISCH: gespeichert wurde nichts', !rufe.some(r => /beleg_speichern|beleg_(neu|anlegen)/.test(r)));
await page.screenshot({ path: OUT + '/sprache-offerte-desktop.png' });

// Wird die offene Zeile einem Katalogprodukt zugeordnet, ist sie nicht mehr offen.
await page.fill('#ofp_name1', 'Objektschutz');
await page.dispatchEvent('#ofp_name1', 'change');
await page.waitForTimeout(150);
check('Nach der Zuordnung ist die Zeile nicht mehr orange und der Hinweis weg',
  (await farbe('#ofp_name1')) !== tokens.orange && !(await page.isVisible('#ofp_hint1')));
check('... und der Preis kommt jetzt aus dem Katalog', (await page.inputValue('#ofp_preis1')) === '72.00');

// ══════════ UNBEKANNTER KUNDE
await page.evaluate(() => go('uebersicht')); await page.waitForTimeout(200);
await diktieren({ art: 'offerte', kunde_name: 'Beispiel Neubau AG', positionen: [{ produkt_id: 4, leistung: 'Objektschutz', menge: 8 }] },
  'Offerte für die Beispiel Neubau AG, 8 Stunden Objektschutz');
check('Unbekannter Kunde: der gesagte Name steht im Feld', (await page.inputValue('#of_kunde')) === 'Beispiel Neubau AG');
check('KRITISCH: ... orange, nicht blau', (await farbe('#of_kunde')) === tokens.orange);
check('KRITISCH: ... und nicht als gewählter Kunde behandelt', await page.evaluate(() => ofFormKundeId === null));
check('Unter dem Feld steht „nicht in der Kundenliste"', await page.isVisible('#ofKundeHinweis'));
check('Das Band nennt den Namen und den Weg', /Beispiel Neubau AG/.test(await page.textContent('#ofKiText'))
  && /Neue Adresse erstellen/.test(await page.textContent('#ofKiText')));
// Gemessen: der Hinweis steht UNTER dem Feld, nicht daneben.
const lage = await page.evaluate(() => {
  const f = document.getElementById('of_kunde').getBoundingClientRect();
  const h = document.getElementById('ofKundeHinweis').getBoundingClientRect();
  return { unter: h.top >= f.bottom - 1, links: Math.abs(h.left - f.left) <= 2 };
});
check('Der Hinweis steht unter dem Feld, bündig links (gemessen)', lage.unter && lage.links);

await page.click('button[onclick="ofNeueAdresse()"]');
await page.waitForTimeout(300);
check('„Neue Adresse erstellen" öffnet den Kundendialog', await page.isVisible('#dlgKunde.on'));
check('KRITISCH: ... mit dem gesagten Namen vorbefüllt', (await page.inputValue('#ku_name')) === 'Beispiel Neubau AG');
await page.evaluate(() => closeDlg('dlgKunde'));

// Wird ein bekannter Kunde gewählt, ist die Warnung erledigt.
await page.fill('#of_kunde', 'Muster GmbH');
await page.dispatchEvent('#of_kunde', 'input');
check('Nach Wahl eines bekannten Kunden: nicht mehr orange, Hinweis weg',
  (await farbe('#of_kunde')) !== tokens.orange && !(await page.isVisible('#ofKundeHinweis')));

// ══════════ RECHNUNG, OHNE POSITIONEN
await page.evaluate(() => go('uebersicht')); await page.waitForTimeout(200);
await diktieren({ art: 'rechnung', kunde_name: 'Muster GmbH' }, 'Rechnung an die Muster GmbH');
check('Rechnung: das Formular steht auf Rechnung', await page.evaluate(() => ofArt === 'rechnung'));
check('Ohne Positionen: eine leere Zeile, und das Band nennt sie als offen',
  await page.evaluate(() => ofPos.length === 1 && !ofPos[0].produkt_name)
  && /Noch offen: Positionen/.test(await page.textContent('#ofKiText')));

// ══════════ VON HAND DANACH: KEINE RESTE
await page.evaluate(() => ofNeu('offerte')); await page.waitForTimeout(150);
check('KRITISCH: eine von Hand begonnene Offerte trägt keine Markierung der vorigen Spracheingabe',
  !(await page.isVisible('#ofKiHint')) && !(await page.isVisible('#ofKundeHinweis'))
  && (await farbe('#of_kunde')) === tokens.normal && (await farbe('#ofp_name0')) === tokens.normal);

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
await browser.close();
