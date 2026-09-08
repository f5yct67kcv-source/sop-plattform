// Der Lohnbereich im Cockpit (ENT-451).
//
// Worauf diese Pruefungen zielen -- in dieser Reihenfolge, weil so auch der
// Schaden waere:
//  1. Ein Reiter, hinter dem ein 403 wartet, darf gar nicht erst erscheinen.
//     Der Lohn haengt am eigenen Recht, nicht am Personalrecht.
//  2. Was der GAV ergibt, wird ABGELEITET gezeigt und nicht als Eingabefeld
//     angeboten -- sonst driftet ein getippter Wert vom Anspruch weg.
//  3. "Unbekannt" darf nie wie "keine" aussehen. Ein nicht ermittelbarer
//     Mindestlohn zeigt den GRUND, kein Gedankenstrich und keine Null.
//  4. Ein Ansatz unter dem GAV-Mindestlohn wird sichtbar, bevor jemand
//     scrollt -- wer unter Tarif zahlt, soll es merken.
//  5. Ein fehlender Abzugssatz wird namentlich benannt. Eine unvollstaendige
//     Aufstellung darf nicht aussehen wie eine vollstaendige.
//
// Gemessen wird der gerenderte Zustand, nicht der Quelltext: eine Pruefung,
// die ein Wort im Code sucht, bleibt gruen, wenn die Formulierung sich
// aendert und die Sache verschwindet.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Datum bewusst weit weg von heute (CLAUDE.md / test_datumsfest.mjs): ein
// Datum nahe am heutigen Tag kippt beim Datumswechsel.
const STICHTAG = '2027-05-31';

const DOSSIER = { id: 42, name: 'muster.person', vorname: 'Eine', nachname: 'Person',
  personalnummer: 'P-0042', anstellungskategorie: 'C', eintritt: '2024-03-01', aktiv: 1 };

// Zwei Antworten desselben Endpunkts: einmal vollstaendig, einmal mit
// Luecken. Die zweite ist die eigentlich interessante -- sie prueft, dass
// Unbekanntes benannt und nicht verschwiegen wird.
const LOHN_VOLL = {
  status: 'ok',
  person: { id: 42, name: 'Eine Person', personalnummer: 'P-0042', kategorie: 'C',
    pensum_stunden: 800, eintritt: '2024-03-01', austritt: null, ahv_erfasst: true },
  abgeleitet: {
    stichtag: STICHTAG, lohnform: 'stunde', lohnform_text: 'Stundenlohn (Art. 8: Kategorie C)',
    dienstjahr: 4,
    mindestlohn: { wert: 2495, einheit: 'stunde', dienstjahr: 4, grund: null,
      text: 'Art. 16 i.V.m. Anhang 1, Kat. C, Dienstjahr 4, Gruppe uebrige — ohne Ferienentschaedigung' },
    ferienentschaedigung: { bp: 833, annahme: false, grund: null,
      text: 'Art. 20 Ziff. 2: 4 Wochen, Zuschlag 8,33 %' },
    bvg_pflichtig_ab: '2025-01-01',
  },
  ansaetze: [{ id: 1, mitarbeiter_id: 42, gueltig_ab: '2024-03-01', kategorie: 'C',
    ansatz_rappen: 2500, ferien_laufend: 1, ml13_bp: 833,
    zuschlag_fachausweis_art: null, zuschlag_fachausweis_rappen: null,
    zuschlag_hund_art: 'stunde', zuschlag_hund_rappen: 150,
    zuschlag_waffe_art: null, zuschlag_waffe_rappen: null, bemerkung: null }],
  ansatz_aktuell: { id: 1, gueltig_ab: '2024-03-01', ansatz_rappen: 2500 },
  abzuege: [
    { id: 5, mitarbeiter_id: 42, gueltig_ab: '2026-01-01', nbu_pflichtig: null,
      nbu_grund: null, nbu_von: null, nbu_am: null,
      ktg_pflichtig: 1, bvg_angeschlossen: 0, bvg_beitrag_rappen: null,
      qst_pflichtig: 0, qst_kanton: null, qst_tarifcode: null, qst_kinder: null },
    { id: 6, mitarbeiter_id: 42, gueltig_ab: '2024-03-01', nbu_pflichtig: 0,
      nbu_grund: 'Vom Versicherer schriftlich bestätigt', nbu_von: 3,
      nbu_am: '2024-03-02 09:15:00',
      ktg_pflichtig: 1, bvg_angeschlossen: 0, bvg_beitrag_rappen: null,
      qst_pflichtig: 0, qst_kanton: null, qst_tarifcode: null, qst_kinder: null }],
  // Was die Rechnung heute sagt -- steht NEBEN der Uebersteuerung, damit
  // niemand blind uebersteuert.
  nbu: { stand: 'versichert', quelle: 'gerechnet',
         text: 'Versichert nach Empfehlung 7/87 (Durchschnitt 11.50 Std.).',
         uebersteuert: null, fenster: {} },
  zahlungen: [{ id: 9, mitarbeiter_id: 42, reihenfolge: 1, art: 'rest', betrag_rappen: null,
    iban: 'CH9300762011623852957', empfaenger: null, bank: null, aktiv: 1 }],
  warnung: null,
};

// Dieselbe Person, aber ohne Kategorie und ohne Eintritt: Der Mindestlohn
// ist dann NICHT null Franken, sondern nicht ermittelbar -- und der Ansatz
// liegt unter Tarif.
const LOHN_LUECKIG = {
  status: 'ok',
  person: { id: 42, name: 'Eine Person', personalnummer: 'P-0042', kategorie: null,
    pensum_stunden: null, eintritt: null, austritt: null, ahv_erfasst: false },
  abgeleitet: {
    stichtag: STICHTAG, lohnform: null,
    lohnform_text: 'Unbekannt — ohne Anstellungskategorie nach Art. 8 keine Lohnform',
    dienstjahr: null,
    mindestlohn: { wert: null, grund: 'keine_kategorie',
      text: 'Ohne Anstellungskategorie nach Art. 8 kein Mindestlohn' },
    ferienentschaedigung: { bp: 1064, annahme: true, grund: 'kein_geburtsdatum',
      text: 'Ohne Geburtsdatum der hoehere Satz (10,64 %) — zugunsten der mitarbeitenden Person' },
    bvg_pflichtig_ab: null,
  },
  ansaetze: [], ansatz_aktuell: null, abzuege: [], zahlungen: [],
  warnung: { art: 'unter_mindestlohn', mindest_rappen: 2495,
    text: 'Der erfasste Ansatz liegt unter dem GAV-Mindestlohn (24.95 CHF pro Stunde).' },
};

const LOHNARTEN = {
  status: 'ok',
  lohnarten: [
    { id: 1, schluessel: 'grundlohn_stunde', bezeichnung: 'Grundlohn pro Stunde',
      art: 'stundensatz', basis_schluessel: null, satz_bp: null,
      ahv_pflichtig: 1, ferien_pflichtig: 1, ml13_pflichtig: 1, bvg_pflichtig: 1,
      uvg_pflichtig: 1, qst_pflichtig: 1, gav_grundlage: 'Art. 16 i.V.m. Anhang 1 GAV',
      system: 1, sortierung: 10, aktiv: 1 },
    // Der Auslagenersatz traegt KEIN einziges Kennzeichen -- er ist kein
    // Lohn (GAV-AUS-009, Art. 18 Ziff. 10). Genau das wird unten geprueft.
    { id: 2, schluessel: 'auslagenersatz', bezeichnung: 'Auslagenersatz',
      art: 'netto', basis_schluessel: null, satz_bp: null,
      ahv_pflichtig: 0, ferien_pflichtig: 0, ml13_pflichtig: 0, bvg_pflichtig: 0,
      uvg_pflichtig: 0, qst_pflichtig: 0, gav_grundlage: 'Art. 18 GAV',
      system: 1, sortierung: 40, aktiv: 1 },
    // Ohne GAV-Grundlage: betrieblich. Leer ist hier eine Aussage.
    { id: 3, schluessel: 'anteil_13ml', bezeichnung: 'Anteil 13. Monatslohn',
      art: 'prozent', basis_schluessel: 'grundlohn', satz_bp: null,
      ahv_pflichtig: 1, ferien_pflichtig: 0, ml13_pflichtig: 0, bvg_pflichtig: 1,
      uvg_pflichtig: 1, qst_pflichtig: 1, gav_grundlage: null,
      system: 1, sortierung: 21, aktiv: 1 },
  ],
  kennzeichen: { ahv_pflichtig: 'AHV', ferien_pflichtig: 'Ferien', ml13_pflichtig: '13.',
    bvg_pflichtig: 'BVG', uvg_pflichtig: 'UVG', qst_pflichtig: 'QSt' },
  arten: { stundensatz: 'Betrag je Stunde', prozent: 'Prozentsatz', netto: 'Weder Lohn noch Abzug' },
};

// Zwei von fuenf Saetzen erfasst -- die uebrigen drei muessen namentlich
// erscheinen, nicht stillschweigend fehlen.
const ABZUEGE = {
  status: 'ok',
  abzuege: [
    { id: 1, schluessel: 'ahv', bezeichnung: 'AHV/IV/EO — Arbeitnehmeranteil',
      gueltig_ab: '2026-01-01', gueltig_bis: null, satz_bp: 530, fix_rappen: null,
      hoechstlohn_rappen: null, quelle: 'Beitragsverfuegung Ausgleichskasse' },
    { id: 2, schluessel: 'alv', bezeichnung: 'ALV — Arbeitnehmeranteil',
      gueltig_ab: '2026-01-01', gueltig_bis: null, satz_bp: 110, fix_rappen: null,
      hoechstlohn_rappen: null, quelle: 'Beitragsverfuegung Ausgleichskasse' },
  ],
  katalog: { ahv: 'AHV/IV/EO', alv: 'ALV', nbu: 'NBU (Nichtberufsunfall)',
    ktg: 'Krankentaggeld', bvg: 'BVG' },
  fehlend: ['nbu', 'ktg', 'bvg'],
};

// Vorschau eines Lohnlaufs: eine gerechnete Person, eine gesperrte. Die
// zweite ist die eigentlich interessante -- sie darf nicht wie eine mit
// null Franken aussehen.
const LAUF_VORSCHAU = {
  status: 'ok', von: '2026-07-01', bis: '2026-07-31', bestehend: [],
  sperrgruende: {
    keine_kategorie: 'Ohne Anstellungskategorie nach Art. 8 steht die Lohnform nicht fest.',
    sparte_reinigung: 'Für Reinigungseinsätze gilt ein anderer, noch nicht geprüfter GAV (OP-32).',
  },
  vorschau: [
    { mitarbeiter_id: 42, name: 'Eine Person', personalnummer: 'P-0042', kategorie: 'C',
      lohnform: 'stunde', roh_min: 1080, netto_min: 1020, bonus_min: 42, bewertet_min: 1062,
      brutto_rappen: 51613, gesperrt: { sparte_reinigung: 1 }, nicht_abgeglichen: 1,
      gesperrt_grund: null, warnung: null,
      netto_rappen: null, auszahlung_rappen: null,
      nbu: { stand: 'versichert', quelle: 'gerechnet', text: 'Versichert nach Empfehlung 7/87.',
             uebersteuert: null,
             fenster: { 3: { wochen_total: 13, arbeitswochen: 9, schnitt_std: 11.5,
                             basis: 'nur_arbeitswochen',
                             zeitraum: { von: '2026-05-04', bis: '2026-07-26', monate: 3 } } } },
      zeilen: [
        { schluessel: 'geleistete_stunden', bezeichnung: 'Total geleistete Stunden', sortierung: 30,
          basis_rappen: 2916, satz_bp: null, menge: 17.7, betrag_rappen: 51613,
          gesperrt_grund: null, annahme: 0, hinweis: 'Bewertete Zeit nach Art. 12 Ziff. 2' },
        { schluessel: 'ahv', bezeichnung: 'AHV-, IV-, EO-Beitrag', sortierung: 50,
          basis_rappen: 51613, satz_bp: 530, menge: null, betrag_rappen: -2735,
          gesperrt_grund: null, annahme: 0, hinweis: 'Merkblatt 2.01' },
        { schluessel: 'ktg', bezeichnung: 'Krankentaggeld-Beitrag', sortierung: 53,
          basis_rappen: 51613, satz_bp: null, menge: null, betrag_rappen: null,
          gesperrt_grund: 'kein_ktg_satz', annahme: 0, hinweis: 'Kein Satz erfasst.' },
        { schluessel: 'nettolohn', bezeichnung: 'Nettolohn', sortierung: 60,
          basis_rappen: null, satz_bp: null, menge: null, betrag_rappen: null,
          gesperrt_grund: 'abzug_fehlt', annahme: 0,
          hinweis: 'Kein Nettolohn, solange ein Abzug fehlt: Krankentaggeld-Beitrag.' },
        { schluessel: 'pako', bezeichnung: 'Vollzugskostenbeitrag PaKo', sortierung: 61,
          basis_rappen: null, satz_bp: null, menge: null, betrag_rappen: -26,
          gesperrt_grund: null, annahme: 0, hinweis: 'Art. 6 Ziff. 2 GAV' },
        { schluessel: 'auszahlung', bezeichnung: 'Auszahlungsbetrag', sortierung: 70,
          basis_rappen: null, satz_bp: null, menge: null, betrag_rappen: null,
          gesperrt_grund: 'abzug_fehlt', annahme: 0,
          hinweis: 'Kein Auszahlungsbetrag ohne Nettolohn.' },
      ] },
    { mitarbeiter_id: 43, name: 'Zweite Person', personalnummer: 'P-0043', kategorie: null,
      lohnform: null, roh_min: 480, netto_min: 480, bonus_min: 0, bewertet_min: 480,
      brutto_rappen: 0, gesperrt: {}, nicht_abgeglichen: 0,
      gesperrt_grund: 'keine_kategorie', warnung: null, zeilen: [] },
  ],
};

let lohnAntwort = LOHN_VOLL;
let rechte = ['personal_lesen', 'lohn_lesen', 'lohn_schreiben'];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
page.setDefaultTimeout(5000);
const jsFehler = [];
page.on('pageerror', e => jsFehler.push(e.message));

await page.route('**/api/**', async r => {
  const u = r.request().url();
  const send = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'a', rechte });
  if (u.includes('me.php')) return send({ status: 'ok', name: 'a', rechte });
  if (u.includes('lohn_person')) return send(lohnAntwort);
  if (u.includes('lohnlauf')) {
    // Ohne Zeitraum die Liste, mit Zeitraum die Vorschau.
    return u.includes('von=') ? send(LAUF_VORSCHAU) : send({ status: 'ok', laeufe: [] });
  }
  if (u.includes('lohnarten')) return send(LOHNARTEN);
  if (u.includes('lohn_abzuege')) return send(ABZUEGE);
  if (u.includes('mitarbeiter_dossier')) return send({ status: 'ok', eingerichtet: true, mitarbeiter: DOSSIER });
  if (u.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [DOSSIER], listen: {}, eingerichtet: true });
  return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], mitarbeiter: [], kunden: [],
    einsaetze: [], objekte: [], rapporte: [], orte: [], feiertage: [], gepflegt: {},
    lohnarten: [], abzuege: [], fehlend: [] });
});

// Vor jedem Anmelden den Speicher leeren: Sonst ist die zweite Anmeldung
// gar keine -- die Seite kommt mit der alten Sitzung hoch, und die Pruefung
// mit den ENTZOGENEN Rechten liefe gegen die alten weiter.
const anmelden = async () => {
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForSelector('#gName', { state: 'visible' });
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on');
  await page.waitForTimeout(400);
};
const sichtbar = id => page.evaluate(i => {
  const el = document.getElementById(i);
  if (!el) { return false; }
  const s = getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
}, id);

await anmelden();

// ── 1. Der Reiter haengt am eigenen Recht ────────────────────────────────
check('Mit dem Recht "Lohn" steht die Rubrik in der Navigation', await sichtbar('navg-lohn'));
// Die Unterpunkte liegen in der eingeklappten Rubrik -- gemessen wird
// darum nicht, ob sie GERADE zu sehen sind, sondern ob rechteAnwenden()
// sie freigegeben hat. Ein per style ausgeblendeter Knopf bliebe auch nach
// dem Aufklappen fort.
const freigegeben = id => page.evaluate(i =>
  !!document.getElementById(i) && document.getElementById(i).style.display !== 'none', id);
check('Mit dem Recht "Lohn" sind beide Unterpunkte freigegeben',
  await freigegeben('nav-lohn-lohnarten') && await freigegeben('nav-lohn-saetze'));

// ── 2. Lohnarten: die sechs Kennzeichen ──────────────────────────────────
await page.evaluate(() => go('lohnarten'));
await page.waitForTimeout(400);
const laText = (await page.textContent('#view-lohnarten')).replace(/\s+/g, ' ');
check('Die Lohnarten-Ansicht nennt jede erfasste Lohnart',
  /Grundlohn pro Stunde/.test(laText) && /Auslagenersatz/.test(laText));
// Gezaehlt werden die KENNZEICHEN-Spalten, nicht alle Spalten: Eine feste
// Gesamtzahl braeche bei jeder kosmetischen Spalte, ohne dass die Aussage
// sich aendert. Die sechs sind an ihrem Titel erkennbar -- er traegt die
// Erklaerung aus lohnart_kennzeichen() vom Server.
const kzSpalten = await page.evaluate(() =>
  [...document.querySelectorAll('#laListe thead th')]
    .filter(t => ['AHV', 'Ferien', '13.', 'BVG', 'UVG', 'QSt'].includes(t.textContent.trim())).length);
check('KRITISCH: die Tabelle zeigt alle sechs Bemessungsgrundlagen als eigene Spalten',
  kzSpalten === 6);
// Der Auslagenersatz ist kein Lohn: keine einzige Bemessungsgrundlage.
// GAV-AUS-009 und Art. 18 Ziff. 10 -- er gehoert in eine getrennte
// Spesenabrechnung, nicht in die Arbeitszeitabrechnung.
const auslagenPunkte = await page.evaluate(() => {
  const zeile = [...document.querySelectorAll('#laListe tbody tr')]
    .find(t => /Auslagenersatz/.test(t.textContent));
  return zeile ? [...zeile.querySelectorAll('td')].filter(td => td.textContent.trim() === '●').length : -1;
});
check('KRITISCH: der Auslagenersatz zaehlt in keine einzige Bemessungsgrundlage (GAV-AUS-009)',
  auslagenPunkte === 0);
const grundlohnPunkte = await page.evaluate(() => {
  const zeile = [...document.querySelectorAll('#laListe tbody tr')]
    .find(t => /Grundlohn pro Stunde/.test(t.textContent));
  return zeile ? [...zeile.querySelectorAll('td')].filter(td => td.textContent.trim() === '●').length : -1;
});
check('Der Grundlohn dagegen zaehlt in alle sechs -- die Spalten sagen also etwas aus',
  grundlohnPunkte === 6);
// Eine Lohnart ohne GAV-Artikel ist BETRIEBLICH -- das ist eine Aussage,
// kein Gedankenstrich. Der 13. Monatslohn ist keine GAV-Pflicht.
check('KRITISCH: eine Lohnart ohne GAV-Artikel wird als "betrieblich" benannt, nicht als Luecke',
  /betrieblich/.test(laText));

// ── 3. Abzugssaetze: fehlende werden namentlich benannt ──────────────────
await page.evaluate(() => go('lohnsaetze'));
await page.waitForTimeout(400);
const lsText = (await page.textContent('#view-lohnsaetze')).replace(/\s+/g, ' ');
check('KRITISCH: die drei noch nicht erfassten Abzuege stehen namentlich da',
  /NBU/.test(lsText) && /Krankentaggeld/.test(lsText) && /BVG/.test(lsText));
check('KRITISCH: und es steht dabei, dass fuer sie nicht gerechnet wird -- nicht mit null',
  /nicht gerechnet/.test(lsText) && /unbekannt/i.test(lsText));
check('Die Zahl der fehlenden steht im Verhaeltnis zur Gesamtzahl, nicht allein',
  /3 von 5/.test(lsText));
check('Die erfassten Saetze erscheinen mit ihrer Quelle',
  /5.30 %/.test(lsText) && /Ausgleichskasse/.test(lsText));
check('Was aus dem GAV kommt, steht getrennt und wird nicht als erfassbar ausgegeben',
  /Aus dem GAV/.test(lsText) && /Anhang 1/.test(lsText) && /Art. 6 Ziff. 2/.test(lsText));

// ── 4. Der Lohnbereich in der Personalakte ───────────────────────────────
await page.evaluate(() => { go('mitarbeiter'); openMaDetail('muster.person'); });
await page.waitForTimeout(400);
check('In der Personalakte steht ein Reiter "Lohn"', await sichtbar('mdtab-lohn'));
await page.evaluate(() => mdGoTab('lohn'));
await page.waitForTimeout(500);
const akte = (await page.textContent('#mdBereich_lohn')).replace(/\s+/g, ' ');
check('Die abgeleiteten GAV-Groessen stehen als eigener Block',
  /Aus dem GAV abgeleitet/.test(akte));
check('Die Lohnform wird aus der Kategorie hergeleitet und benannt',
  /Stundenlohn/.test(akte) && /Kategorie C/.test(akte));
check('Der GAV-Mindestlohn steht mit seiner Fundstelle',
  /24.95/.test(akte) && /Anhang 1/.test(akte));
check('Die Ferienentschaedigung steht als abgeleiteter Satz, nicht als Eingabefeld',
  /8.33 %/.test(akte) && /Art. 20 Ziff. 2/.test(akte));
check('Der erfasste Ansatz erscheint mit seiner Gueltigkeit',
  /25.00/.test(akte) && /gilt heute/.test(akte));
check('Ein Zuschlag nach Art. 19 erscheint mit Betrag und Einheit',
  /Diensthund/.test(akte) && /1.50/.test(akte));
check('Die IBAN des Zahlungsempfaengers erscheint',
  /CH9300762011623852957/.test(akte));

// ── 5. Der eigentliche Kern: Unbekanntes sieht nicht aus wie Nichts ──────
lohnAntwort = LOHN_LUECKIG;
await page.evaluate(() => { lohnAkte = null; lohnAkteFuer = null; mdGoTab('lohn'); });
await page.waitForTimeout(500);
const luecke = (await page.textContent('#mdBereich_lohn')).replace(/\s+/g, ' ');
check('KRITISCH: ein nicht ermittelbarer Mindestlohn zeigt den GRUND, keine Null und keinen Strich',
  /Ohne Anstellungskategorie/.test(luecke) && !/0.00 CHF/.test(luecke));
check('KRITISCH: eine fehlende Lohnform wird als unbekannt benannt, nicht als Stundenlohn geraten',
  /Unbekannt/.test(luecke) && /keine Lohnform/.test(luecke));
check('KRITISCH: ein fehlendes Dienstjahr nennt den Grund (Art. 16 Ziff. 2)',
  /Ohne Eintrittsdatum/.test(luecke));
check('KRITISCH: die fehlende AHV-Nummer wird als Hindernis benannt, nicht als leeres Feld',
  /fehlt/.test(luecke) && /keine Abrechnung/.test(luecke));
check('KRITISCH: der Ansatz unter dem GAV-Mindestlohn wird als Warnung sichtbar',
  /unter dem GAV-Mindestlohn/.test(luecke));
check('Die Warnung sagt zugleich, dass sie keine Sperre ist -- Anhang 1 laesst einen Fall zu',
  /Warnung, keine Sperre/.test(luecke));
check('Ein noch nicht erfasster Ansatz sagt, was daraus folgt',
  /nicht abgerechnet werden/.test(luecke));
// Der Betriebsentscheid aus ENT-451: im Zweifel zugunsten der Person. Ohne
// Geburtsdatum gilt der HOEHERE Satz, und das wird gesagt.
check('KRITISCH: ohne Geburtsdatum steht der hoehere Ferien-Satz da, mit Begruendung',
  /10.64 %/.test(luecke) && /zugunsten/.test(luecke));

// ── 5c. Die NBU-Uebersteuerung: dreiwertig, begruendet, vergleichbar ─────
//
// Bis Etappe 4 war das ein Haken mit Vorgabewert "gesetzt". Der haette die
// Berechnung nach Empfehlung 7/87 bei JEDER Person still ueberstimmt, und
// zwar in Richtung Abzug -- genau das Denken, das BGer 8C_644/2025 verwirft.
// Der vorige Abschnitt hat auf die Lueckenfassung umgeschaltet -- und die
// Akte merkt sich, was sie geladen hat. Ohne Zuruecksetzen praefte diese
// Suite die Daten des vorigen Abschnitts.
lohnAntwort = LOHN_VOLL;
await page.evaluate(() => { go('mitarbeiter'); openMaDetail('muster.person'); });
await page.waitForTimeout(400);
await page.evaluate(() => { lohnAkte = null; lohnAkteFuer = null; mdGoTab('lohn'); });
await page.waitForTimeout(500);
const nbuAkte = (await page.textContent('#mdBereich_lohn')).replace(/\s+/g, ' ');
check('KRITISCH: ein Zeitraum ohne Uebersteuerung steht als "automatisch" da, nicht als ja/nein',
  /automatisch/.test(nbuAkte));
check('Eine Uebersteuerung steht als solche da, mit ihrer Begruendung',
  /nicht versichert/.test(nbuAkte) && /Vom Versicherer schriftlich bestätigt/.test(nbuAkte)
  && /von Hand/.test(nbuAkte));

await page.evaluate(() => lohnAbzugOeffnen(5));
await page.waitForTimeout(300);
check('Die Maske bietet drei Zustaende, nicht zwei',
  (await page.locator('#lpbNbu option').count()) === 3);
check('KRITISCH: ohne Eintrag ist "automatisch" vorgewaehlt, nicht "versichert"',
  (await page.inputValue('#lpbNbu')) === 'automatisch');
check('Bei "automatisch" ist kein Begruendungsfeld da -- es gaebe nichts zu begruenden',
  !(await page.isVisible('#lpbNbuGrundFeld')));
// KRITISCH: Der gerechnete Stand steht DANEBEN. Ohne ihn uebersteuert man
// blind -- man sieht nicht, ob man der Rechnung widerspricht.
const standText = (await page.textContent('#lpbNbuStand')).replace(/\s+/g, ' ');
check('KRITISCH: was die Rechnung heute sagt, steht in der Maske daneben',
  /Die Rechnung sagt heute/.test(standText) && /versichert/.test(standText)
  && /7\/87/.test(standText));

await page.selectOption('#lpbNbu', 'nicht');
await page.waitForTimeout(200);
check('Wird von Hand entschieden, verlangt die Maske eine Begruendung',
  await page.isVisible('#lpbNbuGrundFeld'));
// KRITISCH: Wer der Rechnung widerspricht, soll es sehen. Die Rechnung sagt
// "versichert", von Hand gewaehlt ist "nicht versichert".
check('KRITISCH: ein Widerspruch zur Rechnung wird benannt, nicht verschwiegen',
  /widersprechen/.test((await page.textContent('#lpbNbuStand')).replace(/\s+/g, ' ')));
await page.selectOption('#lpbNbu', 'versichert');
await page.waitForTimeout(200);
check('Stimmt die Wahl mit der Rechnung ueberein, steht kein Widerspruch da',
  !/widersprechen/.test((await page.textContent('#lpbNbuStand')).replace(/\s+/g, ' ')));
await page.evaluate(() => closeDlg('dlgLohnAbzug'));
await page.waitForTimeout(200);

// ── 5b. Der Lohnlauf: Stunden und Franken getrennt, Gesperrtes benannt ───
await page.evaluate(() => go('lohnlaeufe'));
await page.waitForTimeout(600);
const lauf = (await page.textContent('#view-lohnlaeufe')).replace(/\s+/g, ' ');
// Die LISTE beantwortet die Frage des Laufs: was kostet der Monat. Darum
// stehen dort Brutto, Abzuege und Auszahlung -- und von der Zeit nur die
// Groesse, auf der der Lohn beruht.
check('Die Liste zeigt Brutto, Abzuege und Auszahlung nebeneinander',
  /Brutto CHF/.test(lauf) && /Abzüge CHF/.test(lauf) && /Auszahlung CHF/.test(lauf));
// KRITISCH: Fehlt ein Abzug, darf in der Liste KEINE Auszahlungssumme
// stehen. Eine Zahl, die den fehlenden Abzug als null behandelt, waere
// plausibel und zu hoch -- und wer sie ausbezahlt, zahlt zu viel.
const auszSpalte = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('#llVorschau tbody tr')]
    .find(r => /Eine Person/.test(r.textContent));
  const td = tr && tr.querySelectorAll('td');
  return td ? { abzuege: td[4].textContent.trim(), auszahlung: td[5].textContent.trim() } : null;
});
check('KRITISCH: ohne vollstaendige Abzuege steht in der Liste "offen", keine Summe',
  auszSpalte.abzuege === 'offen' && auszSpalte.auszahlung === 'offen');
check('KRITISCH: und dort steht auch keine 0.00',
  !/0\.00/.test(auszSpalte.abzuege) && !/0\.00/.test(auszSpalte.auszahlung));
// "Einheiten nie vermischen": Rohzeit, Nettozeit, Zeitbonus und bewertete
// Zeit stehen EINZELN -- nie nur ein fertiger Stundenwert (CLAUDE.md).
// Seit Etappe 4 stehen sie in der ABRECHNUNG statt in der Liste; die Aussage
// ist dieselbe, der Ort ein anderer. Darum wird sie hier auch dort geprueft
// und nicht bloss im Text der Seite gesucht -- die Woerter stehen inzwischen
// auch in einem Erklaersatz, und eine Pruefung, die den findet, prueft nichts.
await page.click('#view-lohnlaeufe button:has-text("Abrechnung")');
await page.waitForTimeout(300);
const abr = (await page.textContent('#llAbrechnung')).replace(/\s+/g, ' ');
check('KRITISCH: die Abrechnung zeigt Rohzeit, Nettozeit, Zeitbonus und bewertete Zeit getrennt',
  /Rohzeit/.test(abr) && /Nettozeit/.test(abr) && /Zeitbonus/.test(abr) && /Bewertet/.test(abr));
check('Die Zeiten stehen als Stunden da, nicht als Minuten',
  /18:00/.test(abr) && /17:00/.test(abr) && /17:42/.test(abr));
check('Die Abrechnung trennt Bruttoseite, Abzuege und Auszahlung in eigene Bloecke',
  /Bruttoseite/.test(abr) && /Abzüge/.test(abr) && /Auszahlung/.test(abr));
// KRITISCH: Ein nicht gerechneter Abzug darf nicht als 0.00 dastehen.
//
// Diese Pruefung stand zuerst als Textsuche nach "nicht gerechnet" da -- und
// blieb in der Gegenprobe GRUEN, weil dieselbe Wortfolge im Erklaersatz des
// Abzugsblocks steht ("was nicht gerechnet werden konnte"). Sie prueft jetzt
// die ZELLE: ein Merkzeichen in der Betragsspalte, und nirgends ein Nullwert.
const ktgZelle = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('#llAbrechnung tr')]
    .find(r => /Krankentaggeld/.test(r.textContent));
  const td = tr && tr.querySelectorAll('td')[4];
  return { text: td ? td.textContent.trim() : null,
           merkzeichen: !!(td && td.querySelector('.chip')) };
});
check('KRITISCH: der fehlende KTG-Satz steht als Merkzeichen in der Betragsspalte',
  ktgZelle.merkzeichen === true && ktgZelle.text === 'nicht gerechnet');
check('KRITISCH: nirgends in der Abrechnung steht ein Abzug von 0.00',
  !/\b0\.00\b/.test(abr));
check('Die Herleitung der NBU-Unterstellung steht dabei, nicht nur das Ergebnis',
  /Empfehlung 7\/87/.test(abr) && /11.50/.test(abr) && /nur Wochen mit Einsatz/.test(abr));
check('Die Abrechnung laesst sich wieder schliessen',
  await page.isVisible('#llAbrechnung button:has-text("Schliessen")'));
await page.click('#llAbrechnung button:has-text("Schliessen")');
await page.waitForTimeout(200);
check('Nach dem Schliessen ist die Liste wieder allein da',
  (await page.textContent('#llAbrechnung')).trim() === '');
check('Der Bruttolohn der gerechneten Person erscheint', /516.13/.test(lauf));
// Der Kern: Eine gesperrte Person darf NICHT wie eine mit null Franken
// aussehen. "Unbekannt" und "keine" sind zwei Aussagen.
check('KRITISCH: eine gesperrte Person zeigt "nicht gerechnet" statt eines Betrags',
  /nicht gerechnet/.test(lauf) && !/0\.00/.test(lauf));
check('KRITISCH: der Sperrgrund steht namentlich da, nicht nur als leere Zelle',
  /keine_kategorie/.test(lauf));
check('Ausgenommene Einzelschichten werden gezaehlt und benannt',
  /sparte_reinigung/.test(lauf));
check('KRITISCH: noch nicht abgeglichene Schichten werden als offen ausgewiesen, nicht verschwiegen',
  /1 offen/.test(lauf));
// Eine gefilterte Zahl allein sieht aus wie die Gesamtzahl.
check('KRITISCH: die Summe sagt, wie viele Personen sie umfasst -- "1 von 2", nicht nur "1"',
  /1 von 2 Personen/.test(lauf));

// ── 5c. Nur lesen heisst: sehen ja, ändern nein ──────────────────────────
// Der dritte Rechtezustand, und der leicht zu übersehende: Wer den
// Lohnbereich lesen, aber nicht schreiben darf, hat bisher alle
// Erfassen-Knöpfe gesehen und wäre beim Klick in ein 403 gelaufen.
// Die eigentliche Sperre sitzt im Server -- das hier erspart den Umweg.
rechte = ['personal_lesen', 'lohn_lesen'];
// Zurueck auf die vollstaendige Antwort: Der Block davor hat den Mock auf
// die lueckenhafte gestellt. Ohne das waere hier gar kein Ansatz zu sehen,
// und die Pruefung "die Werte sind weiterhin da" haette nichts geprueft --
// sie waere gruen geworden, weil nichts da ist, statt weil etwas fehlt.
lohnAntwort = LOHN_VOLL;
await anmelden();
await page.evaluate(() => go('lohnarten'));
await page.waitForTimeout(500);
check('KRITISCH: mit reinem Leserecht ist "Lohnart erfassen" nicht sichtbar',
  !(await sichtbar('laNeuKnopf')));
check('Die Lohnarten selbst sind aber weiterhin zu sehen -- gesperrt ist das Ändern, nicht das Lesen',
  /Grundlohn pro Stunde/.test(await page.textContent('#view-lohnarten')));
check('KRITISCH: und auch kein "Ändern" an den einzelnen Zeilen',
  !/Ändern/.test(await page.textContent('#laListe')));

await page.evaluate(() => go('lohnsaetze'));
await page.waitForTimeout(500);
check('KRITISCH: mit reinem Leserecht ist "Satz erfassen" nicht sichtbar',
  !(await sichtbar('lsNeuKnopf')));

await page.evaluate(() => go('lohnlaeufe'));
await page.waitForTimeout(600);
check('KRITISCH: mit reinem Leserecht lässt sich kein Lauf anlegen',
  !(await sichtbar('llErzeugen')));

await page.evaluate(() => { go('mitarbeiter'); openMaDetail('muster.person'); });
await page.waitForTimeout(400);
await page.evaluate(() => { lohnAkte = null; lohnAkteFuer = null; mdGoTab('lohn'); });
await page.waitForTimeout(500);
const nurLesen = (await page.textContent('#mdBereich_lohn')).replace(/\s+/g, ' ');
check('KRITISCH: in der Personalakte fehlen die Erfassen-Knöpfe',
  !/Ansatz erfassen/.test(nurLesen) && !/Empfänger erfassen/.test(nurLesen));
check('Die erfassten Werte sind aber weiterhin zu sehen',
  /25.00/.test(nurLesen) && /Aus dem GAV abgeleitet/.test(nurLesen));

// Und mit Schreibrecht sind sie wieder da -- sonst prüfte der Block oben
// nur, dass irgendetwas fehlt.
rechte = ['personal_lesen', 'lohn_lesen', 'lohn_schreiben'];
await anmelden();
await page.evaluate(() => go('lohnarten'));
await page.waitForTimeout(500);
check('KRITISCH: mit Schreibrecht ist der Knopf wieder da -- die Prüfung oben misst also etwas',
  await sichtbar('laNeuKnopf'));

// ── 6. Ohne das Recht ist nichts davon da ────────────────────────────────
rechte = ['personal_lesen'];
lohnAntwort = LOHN_VOLL;
await anmelden();
check('KRITISCH: ohne das Recht "Lohn" fehlt die Rubrik in der Navigation',
  !(await sichtbar('navg-lohn')));
check('KRITISCH: auch der Lohnlauf-Eintrag ist ohne das Recht fort',
  await page.evaluate(() => !document.getElementById('nav-lohn-laeufe')
    || document.getElementById('nav-lohn-laeufe').style.display === 'none'));
await page.evaluate(() => { go('mitarbeiter'); openMaDetail('muster.person'); });
await page.waitForTimeout(400);
check('KRITISCH: ohne das Recht "Lohn" fehlt auch der Reiter in der Personalakte',
  !(await sichtbar('mdtab-lohn')));
// Wer die Personalakte lesen darf, sieht sie weiterhin -- die Sperre
// betrifft den Lohn, nicht die Akte.
check('Die uebrige Personalakte bleibt erreichbar', await sichtbar('mdtab-person'));

check('Keine JavaScript-Fehler auf der Seite', jsFehler.length === 0);

await browser.close();
console.log(`${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) {
  console.log('  ✗ ' + bad.join('\n  ✗ '));
  if (jsFehler.length) { console.log('\nJS-Fehler:\n  ' + jsFehler.join('\n  ')); }
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
