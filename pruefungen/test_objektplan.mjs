// Objektplanung nach dem Umbau (ENT-024): Soll immer sichtbar, Einteilen
// erzeugt die Schicht, Dichte am Schreibtisch, Tagesliste auf dem Handy.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const HEUTE = iso(new Date()), M = HEUTE.slice(0, 7);
const T = n => `${M}-${String(n).padStart(2, '0')}`;
const LETZTER = new Date(Number(M.slice(0, 4)), Number(M.slice(5, 7)), 0).getDate();

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const MA = { status: 'ok', mitarbeiter: [
  { id: 1, name: 'adrian', ist_admin: 1, vorname: 'Adrian', nachname: 'Muster', aktiv: 1 },
  { id: 2, name: 'dario.beispiel', ist_admin: 0, vorname: 'Dario', nachname: 'Beispiel', aktiv: 1 },
  { id: 3, name: 'vito', ist_admin: 0, vorname: 'Vito', nachname: 'Muster', aktiv: 1 }]};
const OBJEKT = { id: 1, kunde_id: 1, kunde_name: 'Beispiel AG', name: 'Muster Center',
  strasse: 'Industriestrasse 78', ort: '4601 Olten', kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 1 };
const OB = { status: 'ok', objekte: [OBJEKT, { ...OBJEKT, id: 2, name: 'Kirche Wangen', masterschichten: 0 }] };
const V = (id, name, kuerzel, von, bis, h, art, abruf) => ({ id, name, kuerzel, art: art || 'arbeit',
  von, bis, arbeitszeit_h: h, auf_abruf: abruf || 0, farbe: null, gueltig_ab: '2026-01-01', gueltig_bis: null });
const VORLAGEN = [
  V(1, 'Revierdienst Öffnungsrunde', 'ÖF', '05:15', '05:30', 0.25),
  V(2, 'Fahrtzeit', 'FZ', '06:00', '06:15', 0.25, 'fahrtzeit'),
  V(3, 'Revierdienst Schliessrunde', 'SR', '22:00', '22:30', 0.5),
  V(4, 'Patrouille auf Abruf', 'PA', '14:00', '16:00', 2, 'arbeit', 1),
];
// Bedarf: die drei festen Vorlagen an jedem Tag, die Abruf-Schicht nur am 5.
const BEDARF = [];
for (let t = 1; t <= LETZTER; t++) {
  VORLAGEN.slice(0, 3).forEach(v => BEDARF.push({ datum: T(t), masterschicht_id: v.id, name: v.name,
    kuerzel: v.kuerzel, von: v.von, bis: v.bis, bedarf: v.id === 3 ? 2 : 1, status: 'geplant',
    feiertag: null, art: v.art, arbeitszeit_h: v.arbeitszeit_h }));
}
BEDARF.push({ datum: T(5), masterschicht_id: 4, name: 'Patrouille auf Abruf', kuerzel: 'PA',
  von: '14:00', bis: '16:00', bedarf: 1, status: 'provisorisch', feiertag: null, art: 'arbeit', arbeitszeit_h: 2 });

const P = (id, vn, nn) => ({ id, name: vn.toLowerCase(), vorname: vn, nachname: nn, zusage: 'offen' });
let EINSAETZE = [
  // 3. — Schliessrunde voll besetzt (2 von 2)
  { id: 101, kunde_id: 1, kunde_name: 'Beispiel AG', objekt_id: 1, masterschicht_id: 3,
    titel: 'SR · Revierdienst Schliessrunde', strasse: 'Industriestrasse 78', ort: '4601 Olten',
    einsatzart: 'Revierdienst', datum: T(3), von: '22:00:00', bis: '22:30:00', bedarf: 2,
    status: 'geplant', bemerkung: null, mitarbeiter: [P(2, 'Dario', 'Beispiel'), P(3, 'Vito', 'Muster')] },
  // 4. — Schliessrunde nur halb besetzt
  { id: 102, kunde_id: 1, kunde_name: 'Beispiel AG', objekt_id: 1, masterschicht_id: 3,
    titel: 'SR · Revierdienst Schliessrunde', strasse: 'Industriestrasse 78', ort: '4601 Olten',
    einsatzart: 'Revierdienst', datum: T(4), von: '22:00:00', bis: '22:30:00', bedarf: 2,
    status: 'geplant', bemerkung: null, mitarbeiter: [P(3, 'Vito', 'Muster')] },
  // 5. — auf Abruf, niemand drauf
  { id: 103, kunde_id: 1, kunde_name: 'Beispiel AG', objekt_id: 1, masterschicht_id: 4,
    titel: 'PA · Patrouille auf Abruf', strasse: 'Industriestrasse 78', ort: '4601 Olten',
    einsatzart: 'Revierdienst', datum: T(5), von: '14:00:00', bis: '16:00:00', bedarf: 1,
    status: 'provisorisch', bemerkung: null, mitarbeiter: [] },
  // 6. — abgesagt
  { id: 104, kunde_id: 1, kunde_name: 'Beispiel AG', objekt_id: 1, masterschicht_id: 1,
    titel: 'ÖF · Revierdienst Öffnungsrunde', strasse: 'Industriestrasse 78', ort: '4601 Olten',
    einsatzart: 'Revierdienst', datum: T(6), von: '05:15:00', bis: '05:30:00', bedarf: 1,
    status: 'abgesagt', bemerkung: null, mitarbeiter: [] },
];
const plan = () => ({ status: 'ok', objekt: OBJEKT, von: T(1), bis: T(LETZTER),
  vorlagen: VORLAGEN, bedarf: BEDARF, feiertage: {},
  einsaetze: EINSAETZE.filter(e => Number(e.objekt_id) === 1) });

const rufe = [];
let zuAntwort = null;

// ══════════════ VERTRAG ZWISCHEN MOCK UND SERVER
// Diese Suite spielt den Server nach. Liefert der echte Endpunkt ein Feld
// nicht, das der Mock liefert, ist die Suite gruen und die Oberflaeche
// trotzdem blind -- genau so ist das Schloss im Raster zuerst untergegangen.
// Darum hier ein direkter Blick in die PHP-Quelle.
const OPL_PHP = readFileSync(`${WURZEL}/backend/api/objektplan.php`, 'utf8');
check('Der Endpunkt liefert ist_status der Zuteilung mit',
  /z\.ist_status/.test(OPL_PHP) && /'ist_status' => \$r\['ist_status'\]/.test(OPL_PHP));
check('Der Endpunkt liefert ist_status der Schicht mit',
  /ist_status, abgeglichen_am\s*\n\s*FROM einsaetze/.test(OPL_PHP));

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request();
  const u = req.url(), p = u.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { body = req.postData(); }
  rufe.push({ p, body, u });
  const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'hansmuster', ist_admin: true });
  if (p.includes('objektplan')) return send(plan());
  if (p.includes('einsatz_zuteilen')) return zuAntwort ? send(zuAntwort[0], zuAntwort[1])
    : send({ status: 'ok', id: 999, zugeteilt: (body.mitarbeiter || []).length, angelegt: true });
  if (p.includes('mitarbeiter_list')) return send(MA);
  if (p.includes('objekt_list')) return send(OB);
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EINSAETZE });
  if (p.includes('masterschicht_list')) return send({ status: 'ok', masterschichten: [] });
  if (p.includes('feiertage_list')) return send({ status: 'ok', kanton: 'SO', feiertage: [], gepflegt: {} });
  return send({ status: 'ok', kunden: [], rapporte: [], kpi: {}, verlauf: [], angemeldet: [],
    pro_mitarbeiter: [], letzte_rapporte: [] });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'hansmuster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(400);
await page.evaluate(() => huelleSetzen('aus'));
await page.evaluate(() => go('planung'));
await page.waitForTimeout(250);
await page.evaluate(() => goTab('objektplan'));
await page.waitForTimeout(700);

// ══════════════ PLATZ
const mass = await page.evaluate(() => {
  const tab = document.querySelector('#pv-objektplan .gr.dicht table');
  const r = tab.getBoundingClientRect();
  const zeilen = [...document.querySelectorAll('#pv-objektplan tbody tr:not(.grp)')]
    .map(t => Math.round(t.getBoundingClientRect().height));
  return { oben: Math.round(r.top), breite: Math.round(r.width), innen: window.innerWidth,
    zeilen, sichtbar: [...document.querySelectorAll('#pv-objektplan tbody tr')]
      .filter(t => t.getBoundingClientRect().top < window.innerHeight).length };
});
// Diese Zahl ist ein HILFSMASS, nicht der Schutzzweck. Bindend ist die
// Dichte-Pruefung weiter unten ("Platz fuer mehr als 25 Zeilen") -- sie
// misst, was ENT-024 tatsaechlich sichern will: dass auf einem Bildschirm
// genug Zeilen stehen.
//
// 260 -> 280 mit dem Skizzen-Umbau vom 21.08.2026 (ede2f04): Die Leiste ist
// jetzt bewusst zweizeilig, und die Bedienelemente sind 45 px hoch. Beides
// ist eine Gestaltungsentscheidung des Projektinhabers, keine Nachlaessigkeit
// -- gemessen 271 px.
//
// 280 -> 335 mit ENT-408 (2026-09-04): Der bisher hier verwendete schmale
// Huellenzustand (64 px, nur Symbole) entfaellt. Die kompakteste verbliebene
// Alternative ist "aus" (Kopfleiste) -- sie gewinnt zwar mehr Breite als
// "schmal" (0 statt 64 px Seitenleiste), legt sich dafuer aber selbst
// waagrecht ueber den Kopf und kostet so an dieser Stelle rund 53 px mehr
// Hoehe (gemessen 324 statt vormals 271 px). Die Dichte-Pruefung blieb dabei
// gruen (Platz fuer 30 statt 24 Zeilen bei 1080 px Fensterhoehe); waere sie
// es nicht, muesste das Layout nachgeben und nicht diese Zahl.
check(`Kopf unter 335px (ist ${mass.oben}, vorher 280 / 200 / ganz ursprünglich 352)`, mass.oben <= 335);
check(`Tabelle nutzt die Breite (${mass.breite} von ${mass.innen})`, mass.breite >= mass.innen - 140);
check(`Datenzeilen unter 34px (max ${Math.max(...mass.zeilen)})`, Math.max(...mass.zeilen) <= 34);
// Nicht die tatsaechlichen Zeilen zaehlen -- die Testdaten haben nur wenige --
// sondern wie viele auf den Bildschirm passen wuerden.
const platz = Math.floor((1080 - mass.oben) / Math.max(...mass.zeilen));
check(`Platz fuer mehr als 25 Zeilen (${platz}, vorher 14)`, platz > 25);

// ══════════════ SOLL IST IMMER DA
const text = await page.textContent('#pv-objektplan .gr.dicht');
check('Unbesetzter Tag zeigt 0/1 statt eines Punktes', text.includes('0/1'));
check('Voll besetzter Tag zeigt 2/2', text.includes('2/2'));
check('Halb besetzter Tag zeigt 1/2', text.includes('1/2'));
const soll = await page.evaluate(() => document.querySelectorAll('#pv-objektplan .s-soll').length);
check('Bedarf ohne erzeugte Schicht ist eigens gekennzeichnet', soll > 20);
const zahlen = await page.textContent('#oplZahlen');
check('Soll-Stunden stehen im Kopf und sind nicht 0', /(\d+\.\d+)\s*h Soll/.test(zahlen) && !/^0\.00 h Soll/.test(zahlen.trim()));
check('Besetzte Stunden stehen im Kopf', zahlen.includes('h besetzt'));
// Seit ENT-058 heisst es Schichten, nicht Stellen.
check('Offene Schichten stehen im Kopf', /Schichten?/.test(zahlen));
check('KRITISCH: die alte Benennung taucht nicht wieder auf', !/Stellen?\b/.test(zahlen));
const sollH = Number((zahlen.match(/([\d.]+) h Soll/) || [])[1]);
// 3 feste Vorlagen: 0.25 + 0.25 + 2×0.5 = 1.5 h je Tag, plus 2 h am 5.
// 3 feste Vorlagen ergeben 1.5 h je Tag, dazu 2 h am 5. Die abgesagte
// Öffnungsrunde am 6. faellt weg: eine Absage nimmt den Bedarf des Tages weg,
// sonst stuende dort dauerhaft eine Luecke, die niemand fuellen soll.
const erwartet = LETZTER * 1.5 + 2 - 0.25;
check(`Soll-Stunden gerechnet (${sollH} statt ${erwartet.toFixed(2)})`,
  Math.abs(sollH - erwartet) < 0.01);

// ══════════════ ABGESAGT UND AUF ABRUF
check('Abgesagte Schicht ist als solche markiert',
  await page.evaluate(() => document.querySelectorAll('#pv-objektplan .s-ab').length >= 1));
check('Schicht auf Abruf ist eigens markiert',
  await page.evaluate(() => document.querySelectorAll('#pv-objektplan .s-prov').length >= 1));

// ══════════════ EINTEILEN AUS DER ZELLE
const vorher = rufe.filter(r => r.p.includes('einsatz_zuteilen')).length;
const T7 = T(7);
await page.evaluate(d => oplZelleAuf(1, d), T7);
await page.waitForTimeout(300);
check('Zuteilungsdialog geht auf', await page.isVisible('#dlgZuteilen .dlg'));
check('Dialog nennt die Schicht', (await page.textContent('#zuTitel')).includes('Öffnungsrunde'));
check('Dialog sagt, dass die Schicht erst angelegt wird',
  (await page.textContent('#zuText')).includes('angelegt'));
check('Alle Mitarbeitenden stehen zur Wahl',
  await page.evaluate(() => document.querySelectorAll('#zuMa label').length === 3));
check('Noch niemand ist angehakt',
  await page.evaluate(() => document.querySelectorAll('#zuMa input:checked').length === 0));
check('Fussnote nennt den Bedarf', (await page.textContent('#zuFuss')).includes('0/1'));
await page.check('#zuMa input[value="2"]');
await page.waitForTimeout(120);
check('Fussnote zählt mit', (await page.textContent('#zuFuss')).includes('1/1'));
check('Bedarf gilt als gedeckt', (await page.textContent('#zuFuss')).includes('gedeckt'));
await page.click('#zuBtn');
await page.waitForTimeout(500);
const zt = rufe.filter(r => r.p.includes('einsatz_zuteilen'));
check('Zuteilung wird genau einmal gesendet', zt.length === vorher + 1);
check('Zuteilung sendet Objekt, Vorlage und Datum',
  zt.at(-1).body.objekt_id === 1 && zt.at(-1).body.masterschicht_id === 1 && zt.at(-1).body.datum === T7);
check('Zuteilung sendet die gewählte Person',
  JSON.stringify(zt.at(-1).body.mitarbeiter) === JSON.stringify([2]));
check('Dialog schliesst nach dem Speichern', !(await page.isVisible('#dlgZuteilen .dlg')));
check('Objektplan wird danach neu geladen',
  rufe.filter(r => r.p.includes('objektplan')).length >= 2);

// ══════════════ DOPPELBELEGUNG BLEIBT GESPERRT (ENT-022)
// Vito ist am 3. um 22:00 eingeteilt — auf der Schliessrunde desselben Tages
// muss er wählbar sein (er ist ja drauf), auf einer anderen Schicht nicht.
await page.evaluate(d => oplZelleAuf(3, d), T(3));
await page.waitForTimeout(300);
check('Bereits Zugeteilte sind angehakt',
  await page.evaluate(() => document.querySelectorAll('#zuMa input:checked').length === 2));
check('Bereits Zugeteilte bleiben bedienbar',
  await page.evaluate(() => !document.querySelector('#zuMa input[value="3"]').disabled));
await page.evaluate(() => closeDlg('dlgZuteilen'));

// Eine Schicht, die zeitlich mit dem Einsatz vom 3. kollidiert, gibt es in den
// Vorlagen nicht — darum wird die Sperre über einen Fremdeinsatz geprüft.
EINSAETZE = EINSAETZE.concat([{ id: 105, kunde_id: 1, kunde_name: 'Fremdkunde', objekt_id: 9,
  masterschicht_id: null, titel: 'Nachtdienst anderswo', strasse: null, ort: '4600 Olten',
  einsatzart: 'Verkehrsdienst', datum: T(8), von: '05:00:00', bis: '06:00:00', bedarf: 1,
  status: 'geplant', bemerkung: null, mitarbeiter: [P(3, 'Vito', 'Muster')] }]);
await page.evaluate(() => loadEinsaetze());
await page.waitForTimeout(600);
await page.evaluate(d => oplZelleAuf(1, d), T(8));
await page.waitForTimeout(300);
check('Zeitlich belegte Person ist gesperrt',
  await page.evaluate(() => document.querySelector('#zuMa input[value="3"]').disabled));
check('Die Sperre wird begründet',
  (await page.textContent('#zuMa')).includes('Nicht verfügbar'));
check('Die Fussnote zählt die Sperren', (await page.textContent('#zuFuss')).includes('zeitlich belegt'));
check('Freie Personen bleiben wählbar',
  await page.evaluate(() => !document.querySelector('#zuMa input[value="2"]').disabled));

// Fehler vom Server wird angezeigt, nicht verschluckt
zuAntwort = [{ status: 'error', message: 'Doppelbelegung: Dario Beispiel ist bereits eingeteilt' }, 409];
await page.check('#zuMa input[value="2"]');
await page.click('#zuBtn');
await page.waitForTimeout(400);
check('Serverfehler steht im Dialog',
  (await page.textContent('#zuErr')).includes('Doppelbelegung'));
check('Dialog bleibt bei einem Fehler offen', await page.isVisible('#dlgZuteilen .dlg'));
zuAntwort = null;
await page.evaluate(() => closeDlg('dlgZuteilen'));

// ══════════════ ABGEGLICHENE SCHICHT IST FESTGESCHRIEBEN (ENT-045, OP-42)
// Der Server wuerde die Zuteilung mit 409 abweisen. Ein Dialog, dessen
// Speichern von vornherein scheitert, waere vergeudete Arbeit -- darum fuehrt
// der Klick direkt in die schreibgeschuetzte Ansicht.
EINSAETZE = EINSAETZE.map(e => Number(e.id) === 101
  ? Object.assign({}, e, { mitarbeiter: e.mitarbeiter.map((m, i) =>
      i === 0 ? Object.assign({}, m, { ist_status: 'anwesend', ist_von: '22:00:00', ist_bis: '22:35:00' }) : m) })
  : e);
await page.evaluate(() => loadEinsaetze());
await page.waitForTimeout(600);
check('Festgeschriebene Schicht traegt im Raster ein Schloss',
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#pv-objektplan .blk')]
      .find(x => x.getAttribute('onclick') === 'openEinsatz(101)');
    return !!b && b.classList.contains('zu') && !!b.querySelector('.i-schloss');
  }));
check('Der Grund steht im Tooltip',
  await page.evaluate(() => [...document.querySelectorAll('#pv-objektplan .blk')]
    .find(x => x.getAttribute('onclick') === 'openEinsatz(101)').title.includes('festgeschrieben')));
check('Offene Schichten bleiben ohne Schloss',
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#pv-objektplan .blk')]
      .find(x => x.getAttribute('onclick') === 'openEinsatz(102)');
    return !!b && !b.classList.contains('zu');
  }));
check('Auch die Belegungszelle der Schicht traegt das Schloss',
  await page.evaluate(d => {
    const b = [...document.querySelectorAll('#pv-objektplan .stand')]
      .find(x => (x.getAttribute('onclick') || '').includes(`oplZelleAuf(3,'${d}')`));
    return !!b && b.classList.contains('zu') && !!b.querySelector('.i-schloss');
  }, T(3)));
check('Belegungszellen offener Tage bleiben ohne Schloss',
  await page.evaluate(d => {
    const b = [...document.querySelectorAll('#pv-objektplan .stand')]
      .find(x => (x.getAttribute('onclick') || '').includes(`oplZelleAuf(3,'${d}')`));
    return !!b && !b.classList.contains('zu');
  }, T(4)));
const vorZu = rufe.filter(r => r.p.includes('einsatz_zuteilen')).length;
await page.evaluate(d => oplZelleAuf(3, d), T(3));
await page.waitForTimeout(400);
check('KRITISCH: der Zuteilungsdialog geht fuer eine gesperrte Schicht gar nicht erst auf',
  !(await page.isVisible('#dlgZuteilen .dlg')));
// Seit dem Umbau (3392470) fuehrt eine festgeschriebene Schicht in die
// Vollbild-Ansicht "Einsatz planen" statt in die Schublade. Die alte Fassung
// dieser Pruefung sah nur nach, ob IRGENDEINE Schublade offen steht -- sie
// blieb dadurch gruen, obwohl laengst eine andere Ansicht davor lag. Ein
// falsches Gruen ist schlimmer als ein Rot.
check('Stattdessen steht die Schicht in der Einsatzplan-Ansicht offen',
  await page.evaluate(() => document.getElementById('view-einsatzplan')
    && getComputedStyle(document.getElementById('view-einsatzplan')).display !== 'none'));
check('KRITISCH: dort steht, dass sie festgeschrieben ist',
  (await page.textContent('#epKopf')).includes('festgeschrieben'));
check('KRITISCH: eine Aenderung geht gar nicht erst an den Server',
  await page.evaluate(() => epSenden({ aktion: 'loesen', position_id: 1 })) === false);
check('KRITISCH: es wurde nichts zugeteilt',
  rufe.filter(r => r.p.includes('einsatz_zuteilen')).length === vorZu
  && rufe.filter(r => r.p.includes('einsatz_position') && r.body).length === 0);
// Zurueck in die Objektplanung -- die naechsten Pruefungen spielen dort.
await page.evaluate(() => { closeDrawer(); go('planung'); goTab('objektplan'); });
await page.waitForTimeout(400);
EINSAETZE = EINSAETZE.map(e => Number(e.id) === 101
  ? Object.assign({}, e, { mitarbeiter: e.mitarbeiter.map(m => Object.assign({}, m, { ist_status: 'offen' })) })
  : e);
await page.evaluate(() => loadEinsaetze());
await page.waitForTimeout(600);

// ══════════════ FILTER
await page.fill('#oplSuche', 'schliess');
await page.waitForTimeout(300);
const gefiltert = await page.textContent('#pv-objektplan .gr.dicht');
check('Filter lässt die passende Schicht stehen', gefiltert.includes('Schliessrunde'));
check('Filter blendet andere Schichten aus', !gefiltert.includes('Fahrtzeit'));
await page.fill('#oplSuche', '');
await page.waitForTimeout(300);
// Das Kaestchen "nur Eingeteilte" ist mit dem Skizzen-Umbau (ede2f04) aus
// der Werkzeugleiste verschwunden. Die Logik dahinter steht noch im Code
// und laeuft dauerhaft auf "aus". Ob das Absicht war, entscheidet der
// Projektinhaber (offener Punkt) -- bis dahin haelt diese Pruefung den
// Zustand fest, statt ihn zu verdecken: Sie schlaegt an, sobald das
// Bedienelement zurueckkommt, damit dann auch wieder geprueft wird, ob es
// wirkt.
const nurTeilDa = await page.evaluate(() => !!document.getElementById('oplNurTeil'));
check('BEFUND: „nur Eingeteilte" fehlt seit dem Skizzen-Umbau in der Leiste '
    + '(kommt es zurück, gehört diese Prüfung wieder auf Wirkung umgestellt)',
  nurTeilDa === false);
if (nurTeilDa) {
  await page.check('#oplNurTeil');
  await page.waitForTimeout(300);
  const nurTeil = await page.textContent('#pv-objektplan .gr.dicht');
  check('„nur Eingeteilte" blendet Adrian aus', !nurTeil.includes('Adrian Muster'));
  check('„nur Eingeteilte" behält Vito', nurTeil.includes('Vito Muster'));
  await page.uncheck('#oplNurTeil');
  await page.waitForTimeout(300);
}

// ══════════════ MONATSWECHSEL
const vorMonat = rufe.filter(r => r.p.includes('objektplan')).length;
await page.click('#pv-objektplan .btn-quiet');   // ‹ Vormonat
await page.waitForTimeout(600);
check('Monatswechsel lädt neu', rufe.filter(r => r.p.includes('objektplan')).length > vorMonat);
check('Der neue Monat steht im Feld', !(await page.inputValue('#oplVon')).startsWith(M));
await page.selectOption('#oplSchnell', 'monat');
await page.waitForTimeout(600);
check('„Dieser Monat" führt zurück', (await page.inputValue('#oplVon')).startsWith(M));

await page.screenshot({ path: OUT + '/51-objektplan-neu.png' });

// ══════════════ MOBIL: TAGESLISTE STATT MATRIX
for (const breite of [320, 360, 390, 414]) {
  await page.setViewportSize({ width: breite, height: 844 });
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    const matrixSichtbar = !!document.querySelector('#pv-objektplan .gr.dicht')?.offsetParent;
    const liste = document.querySelector('#oplTage');
    const ueber = [];
    const scrollbar = el => {
      for (let p = el.parentElement; p && p !== d; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
      }
      return false;
    };
    document.querySelectorAll('#view-planung *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > window.innerWidth + 1 && !scrollbar(el)) ueber.push((el.id ? '#' + el.id : el.className) + ' ' + Math.round(r.right));
    });
    return { scroll: d.scrollWidth - d.clientWidth, matrixSichtbar,
      listeSichtbar: !!(liste && liste.offsetParent), posten: document.querySelectorAll('.opl-posten').length,
      ueber: ueber.slice(0, 3) };
  });
  check(`Matrix ist ausgeblendet @${breite}`, !m.matrixSichtbar);
  check(`Tagesliste ist sichtbar @${breite}`, m.listeSichtbar);
  check(`Tagesliste hat Einträge @${breite}`, m.posten > 20);
  check(`Kein Seiten-Scroll @${breite}`, m.scroll <= 1);
  check(`Nichts ragt heraus @${breite}`, m.ueber.length === 0);
  if (m.ueber.length) bad.push(`   ↳ @${breite}: ${m.ueber.join(' | ')}`);
}

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const listeTxt = await page.textContent('#oplTage');
check('Tagesliste nennt die Schicht', listeTxt.includes('Schliessrunde'));
check('Tagesliste nennt die eingeteilten Namen', listeTxt.includes('Vito Muster'));
check('Tagesliste benennt Unbesetztes', listeTxt.includes('niemand eingeteilt'));
check('Tagesliste zeigt den Stand je Posten', listeTxt.includes('2/2'));
// Tippflächen
const klein = await page.evaluate(() => [...document.querySelectorAll('.opl-posten')]
  .filter(b => b.getBoundingClientRect().height < 44).length);
check('Posten sind mit dem Daumen bedienbar', klein === 0);
// Auch auf dem Handy darf der Kopf den Plan nicht verdrängen.
const kopfMobil = await page.evaluate(() =>
  Math.round(document.querySelector('.opl-tag').getBoundingClientRect().top));
// Seit ENT-068 gemessen erneut angehoben: Kopfzeile, Reiterleiste und
// Werkzeugleiste bekamen application-weit auf dem Handy mehr Luft (groessere
// Ueberschrift, mehr Abstand) -- das schiebt auch diesen Kopf ein Stueck
// weiter runter. Der alte Wert von 410px liess kaum noch Spielraum (409px
// gemessen ohne die neuen Abstaende); 440px liess wieder eine Reserve.
// Seit OP-111 erneut angehoben: ‹, › und Diktat in der Werkzeugleiste sind
// .btn-quiet .btn-sm ohne eigene Hoehe und hatten bisher keine 44px --
// jetzt gilt die neue app-weite Mindest-Trefferflaeche auch fuer sie, das
// ist der Zweck von OP-111 und keine Nebenwirkung, die es zu vermeiden
// gaelte. Gemessen 449px auf dem Handy; 470px laesst wieder eine Reserve.
check(`Kopf auf dem Handy unter 470px (ist ${kopfMobil}, vorher 410, dann 440)`, kopfMobil <= 470);
// Und der Dialog funktioniert auch hier
await page.click('.opl-posten');
await page.waitForTimeout(350);
check('Tagesliste öffnet denselben Dialog', await page.isVisible('#dlgZuteilen .dlg'));
const mDlg = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('Dialog schiebt die Seite nicht @390', mDlg <= 1);
await page.evaluate(() => closeDlg('dlgZuteilen'));
await page.screenshot({ path: OUT + '/52-objektplan-mobil.png' });

// ══════════════ OHNE VORLAGEN
await page.setViewportSize({ width: 1920, height: 1080 });
await page.waitForTimeout(200);
VORLAGEN.length = 0; BEDARF.length = 0; EINSAETZE = [];
await page.evaluate(() => ladeObjektplan(true).then(renderObjektplan));
await page.waitForTimeout(600);
const leer = await page.textContent('#pv-objektplan');
check('Objekt ohne Vorlagen wird erklärt', leer.includes('Keine Masterschicht'));
check('Der Hinweis nennt den Weg', leer.includes('Masterschichten'));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
