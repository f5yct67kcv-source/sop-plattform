// Ein Fenster statt fuenf Dialogen (ENT-026): Bedarf setzen und Schichten
// anlegen in einem Schritt, Massen-Zuteilung, und beides per Diktat mit
// Pruefschritt.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const M = iso(new Date()).slice(0, 7);
const LETZTER = new Date(Number(M.slice(0, 4)), Number(M.slice(5, 7)), 0).getDate();
const T = n => `${M}-${String(n).padStart(2, '0')}`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const OBJ = { id: 1, kunde_id: 1, kunde_name: 'Beispiel AG', name: 'Muster Center',
  strasse: 'Industriestrasse 78', ort: '4601 Olten', kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 1 };
const V = (id, name, kuerzel, von, bis, h) => ({ id, name, kuerzel, art: 'arbeit', von, bis,
  arbeitszeit_h: h, auf_abruf: 0, farbe: null, gueltig_ab: '2026-08-01', gueltig_bis: null });
const VORLAGEN = [
  V(1, 'Revierdienst Öffnungsrunde', 'ÖF', '05:15', '05:30', 0.25),
  V(3, 'Revierdienst Schliessrunde', 'SR', '22:00', '22:30', 0.5),
];
// Volle Vorlagensaetze fuer masterschicht_list (Bedarf steht hier auf 0)
const MSL = VORLAGEN.map(v => ({ ...v, objekt_id: 1, von: v.von + ':00', bis: v.bis + ':00',
  pause_von: null, pause_bis: null, pause_min: 0, rhythmus: 'woche',
  bedarf_mo: 0, bedarf_di: 0, bedarf_mi: 0, bedarf_do: 0, bedarf_fr: 0, bedarf_sa: 0,
  bedarf_so: 0, bedarf_feiertag: 0, intervall_tage: null, intervall_start: null,
  bedarf_intervall: 0, ersetzt_id: null, laeuft: true }));
const MA = [
  { id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'Muster', aktiv: 1, ist_admin: 1 },
  { id: 2, name: 'vito', vorname: 'Vito', nachname: 'Muster', aktiv: 1, ist_admin: 0 },
  { id: 3, name: 'dario.beispiel', vorname: 'Dario', nachname: 'Beispiel', aktiv: 1, ist_admin: 0 },
];

const rufe = [];
let kiAntwort = null;
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), u = req.url(), p = u.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body });
  const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  if (p.includes('objektplan')) return send({ status: 'ok', objekt: OBJ, von: T(1), bis: T(LETZTER),
    vorlagen: VORLAGEN, bedarf: [], einsaetze: [], feiertage: {} });
  if (p.includes('masterschicht_anwenden')) {
    // Die Zahl haengt an den uebergebenen Werten -- so laesst sich pruefen,
    // dass die Oberflaeche wirklich das schickt, was in den Feldern steht.
    const summe = (body.vorlagen || []).reduce((a, v) =>
      a + ['mo','di','mi','do','fr','sa','so'].reduce((b, t) => b + Number(v['bedarf_' + t] || 0), 0), 0);
    return send(body.nur_pruefen
      ? { status: 'ok', nur_pruefen: true, wuerde_anlegen: summe * 4, vorhanden: 0,
          fassungen: summe ? 2 : 0, neue_fassungen: 0, probe: [] }
      : { status: 'ok', angelegt: summe * 4, vorhanden: 0, fassungen: 2, neue_fassungen: 0 });
  }
  if (p.includes('zuteilung_masse')) {
    const n = (body.mitarbeiter || []).length;
    return send({ status: 'ok', nur_pruefen: !!body.nur_pruefen, tage: 31, gesetzt: n * 29,
      schon_da: 0, neue_schichten: 29, konflikte: [
        { datum: T(3), name: 'Vito Muster', was: 'Nachtdienst anderswo 22:00–23:00' },
        { datum: T(9), name: 'Vito Muster', was: 'Baustelle 21:30–23:30' }],
      konflikte_gesamt: 2, schicht: 'SR · Revierdienst Schliessrunde',
      personen: ['Vito Muster'], von: body.von, bis: body.bis });
  }
  if (p.includes('ki_planung_parse')) return kiAntwort ? send(kiAntwort[0], kiAntwort[1])
    : send({ status: 'error', message: 'kein Mock' }, 502);
  if (p.includes('masterschicht_list')) return send({ status: 'ok', masterschichten: MSL });
  if (p.includes('objekt_list')) return send({ status: 'ok', objekte: [OBJ] });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA });
  return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], feiertage: [], gepflegt: {},
    kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(400);
await page.evaluate(() => go('planung')); await page.waitForTimeout(250);
await page.evaluate(() => goTab('objektplan')); await page.waitForTimeout(700);

// ══════════ DER WEG IST EIN KNOPF
check('„Schichten setzen" steht in der Leiste',
  await page.evaluate(() => [...document.querySelectorAll('#pv-objektplan .bar-tools button')]
    .some(b => b.textContent.includes('Schichten setzen'))));
check('„Einteilen" steht in der Leiste',
  await page.evaluate(() => [...document.querySelectorAll('#pv-objektplan .bar-tools button')]
    .some(b => b.textContent.includes('Einteilen'))));
check('„Diktat" steht in der Leiste',
  await page.evaluate(() => [...document.querySelectorAll('#pv-objektplan .bar-tools button')]
    .some(b => b.textContent.includes('Diktat'))));
// Geprueft wird die ERREICHBARKEIT, nicht der Platz in der Leiste: Seit dem
// Skizzen-Umbau (ede2f04) steht die Vorlagenpflege als eigener Knopf unter
// der Tabelle statt in der Werkzeugleiste, und sie heisst dort
// "Masterschichten bearbeiten". Die erste Fassung dieser Pruefung suchte das
// Wort "Vorlagen" an einer festen Stelle -- sie hat damit eine Umgestaltung
// als Funktionsverlust gemeldet, obwohl nichts verloren ging.
check('Vorlagenpflege bleibt erreichbar', await page.evaluate(() => {
  const knopf = [...document.querySelectorAll('#pv-objektplan button')]
    .find(b => /msSeiteAuf|oplStammdaten/.test(b.getAttribute('onclick') || ''));
  return !!knopf && knopf.offsetParent !== null;
}));

// ══════════ FENSTER: MASTERSCHICHTEN AUF DEN ZEITRAUM LEGEN
await page.evaluate(() => awAuf());
await page.waitForTimeout(800);
check('Fenster geht auf', await page.isVisible('#dlgAnwenden .dlg'));
check('Fenster nennt das Objekt', (await page.textContent('#awText')).includes('Muster Center'));
check('Eine Zeile je Vorlage',
  await page.evaluate(() => document.querySelectorAll('#awTabelle tbody tr').length === 2));
check('Acht Zahlenfelder je Zeile',
  await page.evaluate(() => document.querySelectorAll('#awTabelle tbody tr:first-child input').length === 8));
check('Feiertag ist eigens ausgewiesen',
  await page.evaluate(() => !!document.querySelector('#awTabelle thead th.fei')));
// Alle acht Spalten muessen auch sichtbar sein, nicht nur vorhanden.
check('Alle acht Spalten sind im Fenster sichtbar', await page.evaluate(() => {
  const dlg = document.querySelector('#dlgAnwenden .dlg').getBoundingClientRect();
  return [...document.querySelectorAll('#awTabelle thead th')]
    .every(t => t.getBoundingClientRect().right <= dlg.right + 1);
}));
check('Zeitraum ist auf den Monat vorbelegt',
  (await page.inputValue('#awVon')) === T(1) && (await page.inputValue('#awBis')) === T(LETZTER));
check('Bisheriger Bedarf wird gezeigt (hier 0)',
  await page.evaluate(() => $('aw_1_mo').value === '0'));

// Schnell setzen
await page.click('#dlgAnwenden button:has-text("Jeden Tag 1")');
await page.waitForTimeout(700);
check('„Jeden Tag 1" füllt alle Felder',
  await page.evaluate(() => [...document.querySelectorAll('#awTabelle input')].every(i => i.value === '1')));
await page.click('#dlgAnwenden button:has-text("Mo–Fr 1")');
await page.waitForTimeout(700);
check('„Mo–Fr 1" lässt das Wochenende auf 0',
  await page.evaluate(() => $('aw_1_mo').value === '1' && $('aw_1_sa').value === '0' && $('aw_1_so').value === '0'));
await page.click('#dlgAnwenden button:has-text("Nur Sa/So 1")');
await page.waitForTimeout(700);
check('„Nur Sa/So 1" lässt die Woche auf 0',
  await page.evaluate(() => $('aw_1_mo').value === '0' && $('aw_1_sa').value === '1'));

// Live-Rechnung
await page.click('#dlgAnwenden button:has-text("Jeden Tag 1")');
await page.waitForTimeout(800);
const pruefRufe = rufe.filter(r => r.p.includes('masterschicht_anwenden') && r.body.nur_pruefen);
check('Es wird vorab gerechnet', pruefRufe.length > 0);
check('Die Rechnung schreibt nichts', pruefRufe.every(r => r.body.nur_pruefen === true));
check('Die Rechnung schickt die Werte aus den Feldern',
  pruefRufe.at(-1).body.vorlagen.every(v => v.bedarf_mo === 1 && v.bedarf_feiertag === 1));
check('Die Rechnung schickt beide Vorlagen', pruefRufe.at(-1).body.vorlagen.length === 2);
const fuss = await page.textContent('#awFuss');
check('Die Zahl steht im Fenster', /\d+ neu/.test(fuss));
check('Es wird gesagt, dass nichts gespeichert ist', fuss.includes('noch nichts gespeichert'));
check('Der Knopf nennt die Zahl', (await page.textContent('#awBtn')).includes('Schichten anlegen'));
await page.screenshot({ path: OUT + '/56-anwenden.png' });

// Speichern
const vorSpeichern = rufe.filter(r => r.p.includes('masterschicht_anwenden') && !r.body.nur_pruefen).length;
await page.click('#awBtn');
await page.waitForTimeout(700);
const echt = rufe.filter(r => r.p.includes('masterschicht_anwenden') && !r.body.nur_pruefen);
check('Speichern sendet genau einmal echt', echt.length === vorSpeichern + 1);
check('Speichern sendet den Zeitraum', echt.at(-1).body.von === T(1) && echt.at(-1).body.bis === T(LETZTER));
check('Fenster schliesst nach dem Speichern', !(await page.isVisible('#dlgAnwenden .dlg')));
check('Der Objektplan wird danach neu geladen',
  rufe.filter(r => r.p.includes('objektplan')).length >= 2);

// ══════════ FENSTER: EINTEILEN
await page.evaluate(() => mzAuf());
await page.waitForTimeout(700);
check('Einteilen-Fenster geht auf', await page.isVisible('#dlgMasse .dlg'));
check('Alle Vorlagen stehen zur Wahl',
  await page.evaluate(() => document.querySelectorAll('#mzSchicht option').length === 2));
check('Alle Mitarbeitenden stehen zur Wahl',
  await page.evaluate(() => document.querySelectorAll('#mzMa label').length === 3));
check('Ohne Auswahl bleibt der Knopf gesperrt', await page.evaluate(() => $('mzBtn').disabled));
check('Ohne Auswahl wird das gesagt', (await page.textContent('#mzVorschau')).includes('Niemand ausgewählt'));
await page.check('#mzMa input[value="2"]');
await page.waitForTimeout(800);
const mzPruef = rufe.filter(r => r.p.includes('zuteilung_masse') && r.body.nur_pruefen);
check('Auch hier wird vorab gerechnet', mzPruef.length > 0);
check('Die Vorschau schreibt nichts', mzPruef.every(r => r.body.nur_pruefen === true));
const vor = await page.textContent('#mzVorschau');
check('Vorschau nennt die Zahl der Einteilungen', /\d+ neu/.test(vor));
check('Vorschau nennt entstehende Schichten', vor.includes('Schichten entstehen'));
check('Vorschau benennt, was nicht geht', vor.includes('nicht möglich'));
check('Die Konflikttage werden einzeln aufgezählt', vor.includes('Vito Muster') && vor.includes('schon eingeteilt'));
check('Es wird gesagt, dass nichts gespeichert ist', vor.includes('noch nichts gespeichert'));
await page.screenshot({ path: OUT + '/57-einteilen.png' });
const vorMz = rufe.filter(r => r.p.includes('zuteilung_masse') && !r.body.nur_pruefen).length;
await page.click('#mzBtn');
await page.waitForTimeout(700);
const mzEcht = rufe.filter(r => r.p.includes('zuteilung_masse') && !r.body.nur_pruefen);
check('Einteilen sendet genau einmal echt', mzEcht.length === vorMz + 1);
check('Einteilen sendet Person, Schicht und Zeitraum',
  JSON.stringify(mzEcht.at(-1).body.mitarbeiter) === JSON.stringify([2])
  && mzEcht.at(-1).body.masterschicht_id === 1 && mzEcht.at(-1).body.von === T(1));
check('Fenster schliesst nach dem Einteilen', !(await page.isVisible('#dlgMasse .dlg')));

// ══════════ DIKTAT: SCHICHTEN SETZEN
await page.evaluate(() => planDiktat('masterplan'));
await page.waitForTimeout(400);
check('Diktatfenster geht auf', await page.isVisible('#dlgPlanDiktat .dlg'));
check('Es sagt, worauf es sich bezieht', (await page.textContent('#pdWo')).includes('Muster Center'));
check('Es gibt ein Beispiel', (await page.textContent('#pdText')).includes('Schliessrunde'));
await page.click('#pdBtn');
await page.waitForTimeout(300);
check('Leerer Befehl wird abgefangen', await page.isVisible('#pdErr'));
check('Leerer Befehl geht nicht ans Modell', !rufe.some(r => r.p.includes('ki_planung_parse')));

kiAntwort = [{ status: 'ok', art: 'masterplan', von: T(1), bis: T(LETZTER), vorlagen: [
  { id: 3, bedarf_mo: 2, bedarf_di: 2, bedarf_mi: 2, bedarf_do: 2, bedarf_fr: 2,
    bedarf_sa: 1, bedarf_so: 1, bedarf_feiertag: 1 }] }, 200];
await page.fill('#pdText2', 'Setze die Schliessrunde unter der Woche mit zwei Leuten auf den ganzen Monat');
await page.click('#pdBtn');
await page.waitForTimeout(900);
check('Das Diktat geht ans Modell', rufe.some(r => r.p.includes('ki_planung_parse')));
const kiRuf = rufe.filter(r => r.p.includes('ki_planung_parse')).at(-1);
check('Objekt und Monat kommen vom Bildschirm',
  kiRuf.body.objekt_id === 1 && kiRuf.body.monat === M);
check('Die Art des Befehls wird mitgegeben', kiRuf.body.art === 'masterplan');
check('Das heutige Datum kommt vom Gerät', kiRuf.body.heute === iso(new Date()));
check('Diktatfenster schliesst', !(await page.isVisible('#dlgPlanDiktat .dlg')));
check('Das Anwenden-Fenster geht auf', await page.isVisible('#dlgAnwenden .dlg'));
check('Erkanntes steht in den Feldern', await page.evaluate(() => $('aw_3_mo').value === '2'));
check('Das Wochenende wurde richtig erkannt', await page.evaluate(() => $('aw_3_sa').value === '1'));
check('Nicht genannte Vorlage bleibt auf ihrem Wert', await page.evaluate(() => $('aw_1_mo').value === '0'));
check('Erkanntes ist sichtbar markiert',
  await page.evaluate(() => $('aw_3_mo').classList.contains('ki')));
check('Es wird gesagt, dass nichts gespeichert ist',
  (await page.textContent('#awKiText')).includes('gespeichert ist noch nichts'));
check('Der Prüfschritt schreibt nichts',
  rufe.filter(r => r.p.includes('masterschicht_anwenden') && !r.body.nur_pruefen).length === echt.length);
await page.screenshot({ path: OUT + '/58-diktat-schichten.png' });
await page.evaluate(() => closeDlg('dlgAnwenden'));

// ══════════ DIKTAT: EINTEILEN
kiAntwort = [{ status: 'ok', art: 'zuteilung', masterschicht_id: 3, mitarbeiter: [2],
  von: T(1), bis: T(15) }, 200];
await page.evaluate(() => planDiktat('zuteilung'));
await page.waitForTimeout(300);
check('Das Beispiel passt zur Befehlsart', (await page.textContent('#pdText')).includes('Vito'));
await page.fill('#pdText2', 'Setze Vito vom 1. bis 15. auf die Schliessrunde');
await page.click('#pdBtn');
await page.waitForTimeout(900);
check('Die Art des Befehls wird mitgegeben',
  rufe.filter(r => r.p.includes('ki_planung_parse')).at(-1).body.art === 'zuteilung');
check('Das Einteilen-Fenster geht auf', await page.isVisible('#dlgMasse .dlg'));
check('Die erkannte Schicht ist gewählt', (await page.inputValue('#mzSchicht')) === '3');
check('Die erkannte Person ist angehakt',
  await page.evaluate(() => document.querySelector('#mzMa input[value="2"]').checked));
check('Niemand sonst ist angehakt',
  await page.evaluate(() => document.querySelectorAll('#mzMa input:checked').length === 1));
check('Der erkannte Zeitraum steht drin',
  (await page.inputValue('#mzVon')) === T(1) && (await page.inputValue('#mzBis')) === T(15));
check('Es wird gesagt, dass nichts gespeichert ist',
  (await page.textContent('#mzKiText')).includes('gespeichert ist noch nichts'));
await page.screenshot({ path: OUT + '/59-diktat-einteilen.png' });

// Ein Fehler des Modells wird gezeigt, nicht verschluckt
await page.evaluate(() => closeDlg('dlgMasse'));
kiAntwort = [{ status: 'error', message: 'Aus dem Befehl liess sich keine bekannte Person zuordnen.' }, 422];
await page.evaluate(() => planDiktat('zuteilung'));
await page.waitForTimeout(300);
await page.fill('#pdText2', 'Setze den Hausmeister auf irgendwas');
await page.click('#pdBtn');
await page.waitForTimeout(700);
check('Fehler des Modells steht im Fenster',
  (await page.textContent('#pdErr')).includes('keine bekannte Person'));
check('Das Fenster bleibt offen', await page.isVisible('#dlgPlanDiktat .dlg'));
check('Es öffnet sich kein Folgefenster', !(await page.isVisible('#dlgMasse .dlg')));
await page.evaluate(() => closeDlg('dlgPlanDiktat'));

// ══════════ MOBIL
for (const breite of [360, 390]) {
  await page.setViewportSize({ width: breite, height: 844 });
  await page.evaluate(() => awAuf());
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    return { scroll: d.scrollWidth - d.clientWidth,
      dlg: Math.round(document.querySelector('#dlgAnwenden .dlg').getBoundingClientRect().width) };
  });
  check(`Anwenden-Fenster schiebt die Seite nicht @${breite}`, m.scroll <= 1);
  check(`Anwenden-Fenster passt in die Breite @${breite}`, m.dlg <= breite);
  await page.evaluate(() => closeDlg('dlgAnwenden'));
  await page.evaluate(() => mzAuf());
  await page.waitForTimeout(600);
  const m2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`Einteilen-Fenster schiebt die Seite nicht @${breite}`, m2 <= 1);
  await page.evaluate(() => closeDlg('dlgMasse'));
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
