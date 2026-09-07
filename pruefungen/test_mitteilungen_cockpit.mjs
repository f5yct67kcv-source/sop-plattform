// Mitteilungen im Cockpit (ENT-421) -- die Seite, auf der sie entstehen.
//
// Geprüft wird, was still falsch werden kann:
//
//   1. Der Zugang hängt am Recht 'mitteilungen'. Wer es nicht hat, sieht
//      den Navigationseintrag nicht -- was jemand nicht darf, steht nicht
//      als Knopf da.
//   2. Was das Formular abschickt, ist das, was oben eingetragen wurde --
//      besonders Zielgruppe und Stufe. Eine vertauschte Zuordnung sähe
//      normal aus und schickte eine interne Revier-Info an alle.
//   3. "12 von 18 gelesen" statt "12" -- eine Zahl ohne Bezug sieht aus
//      wie die Gesamtzahl (CLAUDE.md).
//   4. Ist der Nenner unbekannt, wird er NICHT als Zahl behauptet.
//   5. "Läuft", "geplant", "abgelaufen" und "zurückgezogen" sind vier
//      verschiedene Sachverhalte und bekommen vier verschiedene Wörter.
//   6. Die Bestätigungszahl erscheint nur bei "wichtig" -- bei einer
//      normalen Mitteilung gibt es kein Fenster und damit nichts zu
//      bestätigen; eine 0 dort wäre eine erfundene Aussage.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const klick = async s => { try { await page.click(s, { timeout: 2000 }); return true; }
                           catch { return false; } };
const ev = (fn, ...a) => page.evaluate(fn, ...a).catch(() => null);

// Kein festes Datum nahe beim heutigen Tag (Projektregel): Der Server
// entscheidet über laeuft/geplant/abgelaufen und liefert das Ergebnis mit;
// die Oberfläche rechnet nichts nach.
const LISTE = [
  { id: 5, titel: 'Mitarbeitersitzung', text: 'Am Dienstag um 17 Uhr.',
    zielgruppe: 'alle', stufe: 'wichtig', sichtbar_ab: null, sichtbar_bis: null,
    erstellt_am: '2029-03-01 09:00:00', archiviert_am: null, verfasser_name: 'Die Geschäftsleitung',
    gelesen_anzahl: 12, bestaetigt_anzahl: 9, empfaenger_anzahl: 18,
    archiviert: false, laeuft: true, geplant: false, im_archiv: false, abgelaufen: false },
  { id: 4, titel: 'Ferien eintragen', text: 'Bitte bis Ende Monat.',
    zielgruppe: 'alle', stufe: 'normal', sichtbar_ab: '2029-05-01 00:00:00', sichtbar_bis: null,
    erstellt_am: '2029-02-20 08:00:00', archiviert_am: null, verfasser_name: 'Das Personalbüro',
    gelesen_anzahl: 0, bestaetigt_anzahl: 0, empfaenger_anzahl: 18,
    archiviert: false, laeuft: false, geplant: true, im_archiv: false, abgelaufen: false },
  { id: 3, titel: 'Alte Meldung', text: 'Längst vorbei.',
    zielgruppe: 'alle', stufe: 'normal', sichtbar_ab: null, sichtbar_bis: '2029-01-01 23:59:59',
    erstellt_am: '2028-12-01 08:00:00', archiviert_am: null, verfasser_name: 'Das Personalbüro',
    gelesen_anzahl: 4, bestaetigt_anzahl: 0, empfaenger_anzahl: 18,
    archiviert: false, laeuft: false, geplant: false, im_archiv: true, abgelaufen: true },
  { id: 2, titel: 'Zurückgezogen', text: 'War ein Irrtum.',
    zielgruppe: 'alle', stufe: 'normal', sichtbar_ab: null, sichtbar_bis: null,
    erstellt_am: '2029-01-15 08:00:00', archiviert_am: '2029-01-16 08:00:00',
    verfasser_name: 'Das Personalbüro',
    gelesen_anzahl: 1, bestaetigt_anzahl: 0, empfaenger_anzahl: 18,
    archiviert: true, laeuft: false, geplant: false, im_archiv: true, abgelaufen: false },
  { id: 7, titel: 'Mitarbeitersitzung', text: 'Traktanden folgen.',
    zielgruppe: 'alle', stufe: 'normal', art: 'termin', ist_termin: true,
    beginn: '2029-09-24 17:00:00', ende: '2029-09-24 19:00:00', ort: 'Aufenthaltsraum',
    sichtbar_ab: null, sichtbar_bis: '2029-09-24 19:00:00',
    erstellt_am: '2029-09-01 08:00:00', archiviert_am: null, verfasser_name: 'Die Geschäftsleitung',
    gelesen_anzahl: 5, bestaetigt_anzahl: 0, empfaenger_anzahl: 18,
    zugesagt_anzahl: 3, abgesagt_anzahl: 1,
    archiviert: false, laeuft: true, geplant: false, im_archiv: false, abgelaufen: false },
  { id: 6, titel: 'Doppelt erledigt', text: 'Zurückgezogen und längst abgelaufen.',
    zielgruppe: 'alle', stufe: 'normal', sichtbar_ab: null, sichtbar_bis: '2029-01-01 23:59:59',
    erstellt_am: '2028-11-01 08:00:00', archiviert_am: '2028-12-05 08:00:00',
    verfasser_name: 'Das Personalbüro',
    gelesen_anzahl: 3, bestaetigt_anzahl: 0, empfaenger_anzahl: 18,
    archiviert: true, laeuft: false, geplant: false, im_archiv: true, abgelaufen: true },
  { id: 1, titel: 'Schlüsselkasten', text: 'Ab sofort im Revierfahrzeug.',
    zielgruppe: 'revier', stufe: 'normal', sichtbar_ab: null, sichtbar_bis: null,
    erstellt_am: '2029-02-10 08:00:00', archiviert_am: null, verfasser_name: 'Die Einsatzleitung',
    gelesen_anzahl: 2, bestaetigt_anzahl: 0, empfaenger_anzahl: -1,
    archiviert: false, laeuft: true, geplant: false, im_archiv: false, abgelaufen: false },
];

let meineRechte = ['einsaetze_lesen', 'einsaetze_schreiben', 'objekte_lesen',
      'objekte_schreiben', 'masterschichten_lesen',
      'masterschichten_schreiben', 'verfuegbarkeit_lesen', 'fahrzeuge_lesen',
      'kunden_lesen', 'kunden_schreiben', 'abgleich_lesen',
      'abgleich_schreiben', 'auslagen_lesen', 'personal_lesen',
      'abwesenheiten_lesen', 'personal_schreiben', 'abwesenheiten_schreiben',
      'personal_vertraulich_lesen', 'personal_vertraulich_schreiben',
      'betrieb_lesen', 'betrieb_schreiben', 'fahrzeuge_schreiben',
      'rechte_lesen', 'rechte_schreiben', 'logbuch_lesen', 'offerten_lesen',
      'offerten_schreiben', 'leistungen_lesen', 'leistungen_schreiben',
      'mitteilungen_lesen', 'mitteilungen_schreiben'];
let meineRollen = ['verwaltung'];
let listenAntwort = { status: 'ok', eingerichtet: true, mitteilungen: LISTE };
let gesendet = null, archiviert = null, geloescht = null;
// Die Rueckfrage vor dem endgueltigen Loeschen (ENT-433). Playwright
// weist Dialoge sonst stillschweigend ab -- dann liefe die Pruefung an
// der Rueckfrage vorbei, ohne dass es auffiele.
let dialogText = '', dialogAnnehmen = true;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
page.setDefaultTimeout(5000);
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
page.on('dialog', d => { dialogText = d.message(); return dialogAnnehmen ? d.accept() : d.dismiss(); });

await page.route('**/api/**', r => {
  const u = r.request().url();
  const send = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) {
    return send({ status: 'ok', token: 't', name: 'chefin',
      ist_admin: meineRollen.includes('verwaltung'), rollen: meineRollen, rechte: meineRechte });
  }
  if (u.includes('mitteilung_list')) {
    if (u.includes('id=7')) {
      // Beim Termin zaehlt die Antwort ALLER Empfaenger -- auch derer, die
      // die App nie geoeffnet haben (ENT-436).
      return send({ status: 'ok', eingerichtet: true, ist_termin: true, vollzaehlig: true, leser: [
        { vorname: 'Max', nachname: 'Muster', name: 'm.muster',
          gelesen_am: '2029-09-02 10:00:00', bestaetigt_am: null,
          antwort: 'zugesagt', antwort_am: '2029-09-02 10:01:00' },
        { vorname: 'Rita', nachname: 'Beispiel', name: 'r.beispiel',
          gelesen_am: '2029-09-02 11:00:00', bestaetigt_am: null,
          antwort: 'abgesagt', antwort_am: '2029-09-02 11:05:00' },
        { vorname: 'Ohne', nachname: 'Beispiel', name: 'o.beispiel',
          gelesen_am: null, bestaetigt_am: null, antwort: 'offen', antwort_am: null },
      ] });
    }
    if (u.includes('id=')) {
      return send({ status: 'ok', eingerichtet: true, leser: [
        { vorname: 'Max', nachname: 'Muster', name: 'm.muster',
          gelesen_am: '2029-03-01 10:00:00', bestaetigt_am: '2029-03-01 10:00:00' },
        { vorname: '', nachname: '', name: 'zweitkonto',
          gelesen_am: '2029-03-02 11:30:00', bestaetigt_am: null },
      ] });
    }
    return send(listenAntwort);
  }
  if (u.includes('mitteilung_save')) {
    gesendet = JSON.parse(r.request().postData() || '{}');
    return send({ status: 'ok', id: 9, angelegt: true });
  }
  if (u.includes('mitteilung_loeschen')) {
    geloescht = JSON.parse(r.request().postData() || '{}');
    return send({ status: 'ok', id: geloescht.id, lesestand_entfernt: 4 });
  }
  if (u.includes('mitteilung_archivieren')) {
    archiviert = JSON.parse(r.request().postData() || '{}');
    return send({ status: 'ok', id: archiviert.id, archiviert: !archiviert.zurueck });
  }
  if (u.includes('dashboard_stats')) {
    return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  }
  return send({ status: 'ok', mitarbeiter: [], kunden: [], einsaetze: [], objekte: [],
    rapporte: [], rundgaenge: [], ereignisse: [], produkte: [], belege: [] });
});

async function anmelden() {
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'chefin'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on');
  await page.waitForTimeout(500);
}

// ══════════════ 1. DER ZUGANG HAENGT AM RECHT ═════════════════════════
await anmelden();
check('KRITISCH: mit dem Recht steht "Mitteilungen" in der Navigation',
  await ev(() => { const e = document.getElementById('nav-admin-mitteilungen');
    return !!e && e.style.display !== 'none'; }));

meineRechte = ['einsaetze_lesen', 'einsaetze_schreiben', 'objekte_lesen',
      'objekte_schreiben', 'masterschichten_lesen',
      'masterschichten_schreiben', 'verfuegbarkeit_lesen', 'fahrzeuge_lesen',
      'kunden_lesen', 'kunden_schreiben', 'abgleich_lesen',
      'abgleich_schreiben', 'auslagen_lesen'];
meineRollen = ['planung'];
await anmelden();
check('KRITISCH: ohne das Recht steht der Eintrag NICHT da',
  await ev(() => { const e = document.getElementById('nav-admin-mitteilungen');
    return !e || e.style.display === 'none'; }));

meineRechte = ['personal_lesen', 'abwesenheiten_lesen', 'personal_schreiben',
      'abwesenheiten_schreiben', 'personal_vertraulich_lesen',
      'personal_vertraulich_schreiben', 'mitteilungen_lesen',
      'mitteilungen_schreiben'];
meineRollen = ['personal'];
await anmelden();
check('KRITISCH: die Rolle Personal darf Mitteilungen verfassen (ENT-421)',
  await ev(() => { const e = document.getElementById('nav-admin-mitteilungen');
    return !!e && e.style.display !== 'none'; }));

// ══════════════ 2. DIE LISTE ══════════════════════════════════════════
meineRechte = ['einsaetze_lesen', 'einsaetze_schreiben', 'objekte_lesen',
      'objekte_schreiben', 'masterschichten_lesen',
      'masterschichten_schreiben', 'verfuegbarkeit_lesen', 'fahrzeuge_lesen',
      'kunden_lesen', 'kunden_schreiben', 'abgleich_lesen',
      'abgleich_schreiben', 'auslagen_lesen', 'personal_lesen',
      'abwesenheiten_lesen', 'personal_schreiben', 'abwesenheiten_schreiben',
      'personal_vertraulich_lesen', 'personal_vertraulich_schreiben',
      'betrieb_lesen', 'betrieb_schreiben', 'fahrzeuge_schreiben',
      'rechte_lesen', 'rechte_schreiben', 'logbuch_lesen', 'offerten_lesen',
      'offerten_schreiben', 'leistungen_lesen', 'leistungen_schreiben',
      'mitteilungen_lesen', 'mitteilungen_schreiben'];
meineRollen = ['verwaltung'];
await anmelden();
await ev(() => go('mitteilungen'));
await page.waitForTimeout(600);

check('Die Ansicht ist offen',
  await ev(() => document.getElementById('view-mitteilungen')?.classList.contains('on')));

// Die Liste ist seit ENT-433 zweigeteilt: Laufend und Archiv. Was
// angezeigt wird, haengt also an der Ansicht -- darum wird sie hier
// ausdruecklich gewaehlt und nicht angenommen.
const eintraegeLesen = () => ev(() => [...document.querySelectorAll('#mtlListe .mtl-eintrag')].map(e => ({
  id: e.dataset.id,
  marken: [...e.querySelectorAll('.mtl-marken .chip')].map(c => c.textContent.trim()),
  meta: e.querySelector('.mtl-meta')?.textContent || '',
  knoepfe: [...e.querySelectorAll('.mtl-akt button')].map(b => b.textContent.trim()),
})));
async function ansicht(welche) {
  await ev(w => mtlAnsichtSetzen(w), welche);
  await page.waitForTimeout(200);
  return await eintraegeLesen();
}

const laufende = await ansicht('laufend');
const archivierte = await ansicht('archiv');
const eintraege = [...(laufende || []), ...(archivierte || [])];

check('KRITISCH: die laufende Ansicht zeigt NUR, was in der App zu sehen ist',
  Array.isArray(laufende) && laufende.length === 4
  && !laufende.some(e => ['2', '3'].includes(e.id)));
check('KRITISCH: das Archiv zeigt das Zurueckgezogene UND das Abgelaufene',
  Array.isArray(archivierte) && archivierte.length === 3
  && archivierte.some(e => e.id === '2') && archivierte.some(e => e.id === '3'));
check('KRITISCH: keine Mitteilung verschwindet zwischen den beiden Ansichten',
  eintraege.length === 7 && new Set(eintraege.map(e => e.id)).size === 7);

// Beide Zahlen stehen am Umschalter -- eine gefilterte Liste ohne die
// andere Zahl sieht aus wie die ganze (Hausregel).
const umschalter = await ev(() => ({
  laufend: document.getElementById('mtlAnsichtLaufend')?.textContent.trim() || '',
  archiv:  document.getElementById('mtlAnsichtArchiv')?.textContent.trim() || '',
  anLaufend: !!document.getElementById('mtlAnsichtLaufend')?.classList.contains('on'),
  anArchiv:  !!document.getElementById('mtlAnsichtArchiv')?.classList.contains('on'),
}));
check('KRITISCH: der Umschalter nennt BEIDE Zahlen, nicht nur die angezeigte',
  /\b4\b/.test(umschalter.laufend) && /\b3\b/.test(umschalter.archiv));
check('KRITISCH: die offene Ansicht ist als solche gekennzeichnet -- und nur sie',
  umschalter.anArchiv && !umschalter.anLaufend);

await ansicht('laufend');
const finde = id => (eintraege || []).find(e => e.id === String(id)) || { marken: [], meta: '', knoepfe: [] };

// Vier Zustaende, vier verschiedene Woerter -- "nicht sichtbar" waere fuer
// alle vier dasselbe und fuer keinen richtig.
const zustand = e => e.marken.find(m => /Läuft|Geplant|Abgelaufen|Zurückgezogen/.test(m)) || '';
check('KRITISCH: die laufende heisst "Läuft"',        zustand(finde(5)) === 'Läuft');
check('KRITISCH: die kuenftige heisst "Geplant"',     zustand(finde(4)) === 'Geplant');
check('KRITISCH: die abgelaufene heisst "Abgelaufen"', zustand(finde(3)) === 'Abgelaufen');
check('KRITISCH: die zurueckgezogene heisst "Zurückgezogen"', zustand(finde(2)) === 'Zurückgezogen');
check('KRITISCH: vier verschiedene Zustaende, vier verschiedene Woerter',
  new Set([zustand(finde(5)), zustand(finde(4)), zustand(finde(3)), zustand(finde(2))]).size === 4);

check('Die Zielgruppe steht an der Mitteilung',
  finde(1).marken.some(m => /Revier/.test(m)) && finde(5).marken.some(m => /Alle/.test(m)));
check('Die Stufe "wichtig" ist gekennzeichnet', finde(5).marken.some(m => /Wichtig/.test(m)));
check('Eine normale Mitteilung traegt KEINE Wichtig-Marke',
  !finde(4).marken.some(m => /Wichtig/.test(m)));

// ══════════════ 3./4. DIE ZAHLEN ══════════════════════════════════════
check('KRITISCH: der Lesestand nennt den Bezug ("12 von 18"), nicht nur die Zahl',
  /12 von 18 gelesen/.test(finde(5).meta));
check('KRITISCH: ist der Empfaengerkreis unbekannt, wird er NICHT als Zahl behauptet',
  /unbekannt/i.test(finde(1).meta) && !/von -1/.test(finde(1).meta));
check('Bei "wichtig" steht zusaetzlich die Zahl der Bestaetigungen',
  /9 bestätigt/.test(finde(5).meta));
check('KRITISCH: bei einer normalen Mitteilung steht KEINE Bestaetigungszahl -- '
    + 'dort gibt es kein Fenster, eine 0 waere erfunden',
  !/bestätigt/.test(finde(4).meta));
check('Der Verfasser steht dabei', /Geschäftsleitung/.test(finde(5).meta));

// ══════════════ 5. WER HAT GELESEN ════════════════════════════════════
await klick('#mtlListe .mtl-eintrag[data-id="5"] .mtl-akt button:nth-child(2)');
await page.waitForTimeout(500);
const leser = ((await ev(() => document.getElementById('mtlLeser5')?.textContent || '')) || '');
check('Die Leserliste laesst sich aufklappen und nennt Namen', /Max Muster/.test(leser));
check('Sie unterscheidet gelesen von bestaetigt', /bestätigt/.test(leser));
check('Ein Konto ohne gepflegten Namen erscheint mit dem Anmeldenamen, nicht als Luecke',
  /zweitkonto/.test(leser));

// ══════════════ 6. DAS FORMULAR SCHICKT, WAS DASTEHT ══════════════════
await page.fill('#mtlTitel', 'Neue Regelung');
await page.fill('#mtlText', 'Gilt ab sofort für alle Reviere.');
await page.selectOption('#mtlZielgruppe', 'revier');
await page.selectOption('#mtlStufe', 'wichtig');
await page.fill('#mtlBis', '2029-12-24T18:00');
gesendet = null;
await klick('#mtlSpeichern');
await page.waitForTimeout(500);
check('Das Formular schickt etwas ab', !!gesendet);
check('KRITISCH: der Titel kommt unveraendert an', gesendet && gesendet.titel === 'Neue Regelung');
check('KRITISCH: die gewaehlte Zielgruppe kommt an -- nicht die Voreinstellung',
  gesendet && gesendet.zielgruppe === 'revier');
check('KRITISCH: die gewaehlte Stufe kommt an', gesendet && gesendet.stufe === 'wichtig');
check('Das Ablaufdatum kommt mit', gesendet && String(gesendet.sichtbar_bis).startsWith('2029-12-24'));
check('Das Formular ist danach leer -- die naechste Mitteilung faengt bei null an',
  (await ev(() => document.getElementById('mtlTitel')?.value)) === '');

// Leere Pflichtfelder werden nicht abgeschickt: Eine Mitteilung ohne Text
// ist eine Benachrichtigung ohne Inhalt.
gesendet = null;
await klick('#mtlSpeichern');
await page.waitForTimeout(400);
check('KRITISCH: ohne Titel und Text wird nichts abgeschickt', gesendet === null);

// ══════════════ 7. BEARBEITEN UEBERNIMMT DEN BESTAND ══════════════════
await klick('#mtlListe .mtl-eintrag[data-id="1"] .mtl-akt button:nth-child(1)');
await page.waitForTimeout(400);
check('Beim Bearbeiten steht der bestehende Titel im Formular',
  (await ev(() => document.getElementById('mtlTitel')?.value)) === 'Schlüsselkasten');
check('KRITISCH: und die bestehende Zielgruppe, nicht die Voreinstellung',
  (await ev(() => document.getElementById('mtlZielgruppe')?.value)) === 'revier');
gesendet = null;
await klick('#mtlSpeichern');
await page.waitForTimeout(400);
check('KRITISCH: die Aenderung geht an DIESELBE Mitteilung, sie legt keine zweite an',
  gesendet && Number(gesendet.id) === 1);

// ══════════════ 8. ZURUECKZIEHEN UND WIEDER AUFNEHMEN ═════════════════
archiviert = null;
await klick('#mtlListe .mtl-eintrag[data-id="5"] .mtl-akt button:nth-child(3)');
await page.waitForTimeout(400);
check('KRITISCH: eine laufende Mitteilung wird zurueckgezogen, nicht geloescht',
  archiviert && Number(archiviert.id) === 5 && archiviert.zurueck === false);
archiviert = null;
// Die zurueckgezogene steht seit ENT-433 im Archiv, nicht mehr in der
// laufenden Liste.
await ansicht('archiv');
await klick('#mtlListe .mtl-eintrag[data-id="2"] .mtl-akt button:nth-child(3)');
await page.waitForTimeout(400);
check('Eine zurueckgezogene laesst sich wieder aufnehmen',
  archiviert && Number(archiviert.id) === 2 && archiviert.zurueck === true);

// ══════════════ 8b. ENDGUELTIG LOESCHEN (ENT-433) ═════════════════════
// Zwei verschiedene Folgen, zwei verschiedene Handgriffe: Zurueckziehen
// nimmt aus der App, Loeschen aus der Datenbank -- samt Lesestand. Der
// zweite steht darum NUR im Archiv, und die Sperre dazu steht im Server
// (mitteilung_loeschen.php); hier wird geprueft, dass das Cockpit sie
// nicht unterlaeuft.
const knoepfeArchiv = await ansicht('archiv');
const knopfNamen = id => (knoepfeArchiv || []).find(e => e.id === String(id))?.knoepfe || [];
const knopfNamenLaufend = id => (laufende || []).find(e => e.id === String(id))?.knoepfe || [];
check('KRITISCH: an einer laufenden Mitteilung gibt es KEIN "Endgültig löschen"',
  !knopfNamenLaufend(5).some(k => /löschen/i.test(k))
  && !knopfNamenLaufend(4).some(k => /löschen/i.test(k))
  && !knopfNamenLaufend(7).some(k => /löschen/i.test(k))
  && !knopfNamenLaufend(1).some(k => /löschen/i.test(k)));
check('KRITISCH: an einer laufenden steht stattdessen "Zurückziehen"',
  knopfNamenLaufend(5).some(k => /Zurückziehen/.test(k)));
check('KRITISCH: im Archiv steht "Endgültig löschen" -- bei der zurueckgezogenen',
  knopfNamen(2).some(k => /Endgültig löschen/.test(k)));
check('KRITISCH: und bei der abgelaufenen, die nie zurueckgezogen wurde',
  knopfNamen(3).some(k => /Endgültig löschen/.test(k)));
check('Im Archiv wird nicht noch einmal "Zurückziehen" angeboten',
  !knopfNamen(2).some(k => /Zurückziehen/.test(k)) && !knopfNamen(3).some(k => /Zurückziehen/.test(k)));
check('"Wieder aufnehmen" steht bei der zurueckgezogenen, die noch gilt',
  knopfNamen(2).some(k => /Wieder aufnehmen/.test(k)));
check('Bei der nie zurueckgezogenen, abgelaufenen gibt es nichts aufzunehmen',
  !knopfNamen(3).some(k => /Wieder aufnehmen/.test(k)));
check('KRITISCH: bei einer zurueckgezogenen UND abgelaufenen fehlt "Wieder aufnehmen" -- '
    + 'sie käme dadurch nicht zurück, das Datum ist vorbei',
  !knopfNamen(6).some(k => /Wieder aufnehmen/.test(k)));
check('KRITISCH: loeschen laesst sie sich trotzdem',
  knopfNamen(6).some(k => /Endgültig löschen/.test(k)));

// GEMESSEN, nicht im Quelltext nachgelesen (CLAUDE.md): Eine CSS-Regel
// kann wirkungslos bleiben, ohne dass etwas kaputtgeht. Ein Handgriff ohne
// Rückweg darf sich nicht wie "Bearbeiten" anfühlen.
const loeschMass = await ev(() => {
  const e = document.querySelector('#mtlListe .mtl-eintrag[data-id="2"]');
  const l = e?.querySelector('button.mtl-loeschen');
  const n = e?.querySelector('.mtl-akt button');
  if (!l || !n) { return null; }
  const r = l.getBoundingClientRect();
  return { farbe: getComputedStyle(l).color, normal: getComputedStyle(n).color,
           hoehe: r.height, breite: r.width,
           zeile: e.querySelector('.mtl-akt').getBoundingClientRect().width };
});
check('KRITISCH: der Loeschknopf hebt sich farblich vom harmlosen Nachbarn ab',
  !!loeschMass && loeschMass.farbe !== loeschMass.normal);
check('Er wird nicht ueber die volle Breite gestreckt',
  !!loeschMass && loeschMass.breite < loeschMass.zeile * 0.8);

// Die Rueckfrage muss die FOLGE benennen, nicht nur die Handlung.
geloescht = null; dialogText = ''; dialogAnnehmen = false;
await klick('#mtlListe .mtl-eintrag[data-id="3"] .mtl-akt button.mtl-loeschen');
await page.waitForTimeout(400);
check('KRITISCH: vor dem Loeschen wird zurueckgefragt', dialogText.length > 20);
check('KRITISCH: die Rueckfrage nennt die Mitteilung beim Titel',
  /Alte Meldung/.test(dialogText));
check('KRITISCH: sie sagt, dass der Lesestand mitgeht -- '
    + '"Wirklich löschen?" allein verschweigt genau das',
  /Lesestand/.test(dialogText) && /4 /.test(dialogText));
check('KRITISCH: sie sagt, dass es keinen Rueckweg gibt',
  /nicht rückgängig/i.test(dialogText));
check('KRITISCH: wer die Rueckfrage ablehnt, loescht NICHTS', geloescht === null);

// Und beim Annehmen geht die richtige Mitteilung weg.
dialogAnnehmen = true;
await klick('#mtlListe .mtl-eintrag[data-id="3"] .mtl-akt button.mtl-loeschen');
await page.waitForTimeout(500);
check('KRITISCH: nach dem Annehmen wird geloescht -- und zwar diese Mitteilung',
  geloescht && Number(geloescht.id) === 3);
check('KRITISCH: das Loeschen geht an einen EIGENEN Endpunkt, nicht ans Archivieren',
  archiviert === null || Number(archiviert.id) !== 3);

// Eine Mitteilung ohne Leser: Dort waere "der Lesestand geht mit" eine
// erfundene Drohung -- die Rueckfrage sagt dann etwas anderes.
listenAntwort = { status: 'ok', eingerichtet: true, push_eingerichtet: true, push_geraete: 1,
  mitteilungen: [{ ...LISTE[3], gelesen_anzahl: 0 }] };
await anmelden();
await ev(() => go('mitteilungen'));
await page.waitForTimeout(500);
await ansicht('archiv');
dialogText = ''; dialogAnnehmen = false;
await klick('#mtlListe .mtl-eintrag[data-id="2"] .mtl-akt button.mtl-loeschen');
await page.waitForTimeout(400);
check('KRITISCH: hat niemand gelesen, wird kein Nachweisverlust behauptet',
  /niemand/i.test(dialogText) && !/Lesestand/.test(dialogText));
listenAntwort = { status: 'ok', eingerichtet: true, mitteilungen: LISTE };

// ══════════════ 9. DIE DREI NICHT-FAELLE ══════════════════════════════
async function leerText(a) {
  listenAntwort = a;
  await anmelden();
  await ev(() => go('mitteilungen'));
  await page.waitForTimeout(500);
  return ((await ev(() => document.getElementById('mtlListe')?.textContent || '')) || '')
    .replace(/\s+/g, ' ').trim();
}
const tLeer = await leerText({ status: 'ok', eingerichtet: true, mitteilungen: [] });
const tUneing = await leerText({ status: 'ok', eingerichtet: false, mitteilungen: [] });
const tFehler = await leerText({ status: 'error', message: 'kaputt' });
check('KRITISCH: "nicht eingerichtet" sagt etwas anderes als "keine Mitteilungen"', tUneing !== tLeer);
check('KRITISCH: "nicht abrufbar" sagt etwas anderes als "keine Mitteilungen"', tFehler !== tLeer);
check('KRITISCH: und etwas anderes als "nicht eingerichtet"', tFehler !== tUneing);
check('Bei einem Fehler wird nicht behauptet, es gebe keine Mitteilungen',
  !/keine mitteilung/i.test(tFehler));

// Zwei weitere Nicht-Faelle seit ENT-433. Ein Filter, der alles
// ausblendet, darf nie wie "nichts vorhanden" aussehen (CLAUDE.md) -- und
// ein leeres Archiv heisst etwas anderes als eine leere Gegenwart.
async function leerInAnsicht(mitteilungen, welche) {
  listenAntwort = { status: 'ok', eingerichtet: true, mitteilungen };
  await anmelden();
  await ev(() => go('mitteilungen'));
  await page.waitForTimeout(500);
  await ev(w => mtlAnsichtSetzen(w), welche);
  await page.waitForTimeout(200);
  return ((await ev(() => document.getElementById('mtlListe')?.textContent || '')) || '')
    .replace(/\s+/g, ' ').trim();
}
const tArchivLeer = await leerInAnsicht(LISTE.filter(m => !m.im_archiv), 'archiv');
const tNichtsLauft = await leerInAnsicht(LISTE.filter(m => m.im_archiv), 'laufend');
check('KRITISCH: ein leeres Archiv sagt etwas anderes als "keine Mitteilungen"',
  tArchivLeer !== tLeer && !/noch keine Mitteilung verfasst/.test(tArchivLeer));
check('KRITISCH: "nichts Laufendes" sagt etwas anderes als "keine Mitteilungen"',
  tNichtsLauft !== tLeer && !/noch keine Mitteilung verfasst/.test(tNichtsLauft));
check('KRITISCH: und die beiden sagen nicht dasselbe',
  tArchivLeer !== tNichtsLauft);
check('Das leere Archiv verweist auf die Mitteilungen, die es sehr wohl gibt',
  /\b4\b/.test(tArchivLeer));
check('"Nichts Laufendes" verweist auf das, was im Archiv liegt',
  /Archiv/.test(tNichtsLauft) && /\b3\b/.test(tNichtsLauft));
listenAntwort = { status: 'ok', eingerichtet: true, mitteilungen: LISTE };

// ══════════════ 9b. WARUM PUSH NICHT EINGERICHTET IST ═════════════════
// Fünf Ursachen, fünf verschiedene Handgriffe an verschiedenen Stellen --
// "fehlt" allein liesse offen, ob das Secret gar nicht ankommt oder nur
// unlesbar ist. Nachgetragen, nachdem beim ersten echten Einrichten genau
// das gefehlt hat und eine halbe Stunde Raten kostete.
async function pushSatz(grund) {
  listenAntwort = { status: 'ok', eingerichtet: true, mitteilungen: LISTE,
                    push_eingerichtet: false, push_geraete: 0, push_grund: grund };
  await anmelden();
  await ev(() => go('mitteilungen'));
  await page.waitForTimeout(500);
  return ((await ev(() => document.getElementById('mtlPushHinweis')?.textContent || '')) || '')
    .replace(/\s+/g, ' ').trim();
}
const gruende = {};
for (const g of ['keine_tabelle', 'kein_schluessel', 'schluessel_unlesbar',
                 'schluessel_ungueltig', 'falsche_kurve', 'kein_kontakt']) {
  gruende[g] = await pushSatz(g);
  check(`Der Grund "${g}" wird erklaert`, gruende[g].length > 40);
}
check('KRITISCH: alle sechs Gruende sagen etwas VERSCHIEDENES (CLAUDE.md)',
  new Set(Object.values(gruende)).size === 6);
check('KRITISCH: "kein Schluessel angekommen" nennt das Secret und den noetigen Deploy',
  /VAPID_PRIVATE_PEM_B64/.test(gruende.kein_schluessel) && /Deploy/.test(gruende.kein_schluessel));
check('KRITISCH: "unlesbar" nennt den haeufigsten Fall beim Namen',
  /%/.test(gruende.schluessel_unlesbar));
check('KRITISCH: "kein Kontakt" verweist nicht auf den Schluessel',
  /VAPID_KONTAKT/.test(gruende.kein_kontakt));
check('"Tabelle fehlt" verweist auf die Einrichtung',
  /Einrichtung/.test(gruende.keine_tabelle));

// Ein unbekannter Grund darf nicht wie ein bekannter aussehen.
const unbekannt = await pushSatz('irgendwas-neues');
check('KRITISCH: ein unbekannter Grund sagt, dass er unbekannt ist -- '
    + 'statt einen falschen Handgriff zu nennen',
  /nicht ermitteln/i.test(unbekannt)
  && !Object.values(gruende).some(g => g === unbekannt));

// ══════════════ 10. GESTALTUNG, GEMESSEN ══════════════════════════════
// Die Hausregel verlangt Messen am gerenderten Zustand, nicht Nachlesen im
// Quelltext: Eine CSS-Regel kann wirkungslos bleiben, ohne dass etwas
// kaputtgeht.
listenAntwort = { status: 'ok', eingerichtet: true, mitteilungen: LISTE,
                  push_eingerichtet: true, push_geraete: 3, push_grund: 'ok' };
await anmelden();
await ev(() => go('mitteilungen'));
await page.waitForTimeout(500);
check('Ist Push eingerichtet, steht die Zahl der erreichbaren Geraete da',
  /3 Geräten/.test((await ev(() => document.getElementById('mtlPushHinweis')?.textContent || '')) || ''));
const mass = await ev(() => {
  const raster = document.querySelector('.mtl-raster');
  const knoepfe = document.querySelector('.mtl-knoepfe');
  const speichern = document.getElementById('mtlSpeichern');
  if (!raster || !knoepfe || !speichern) { return null; }
  const kinder = [...raster.children].map(k => k.getBoundingClientRect());
  return {
    spalten: getComputedStyle(raster).gridTemplateColumns.split(' ').length,
    nebeneinander: kinder.length === 2 && Math.abs(kinder[0].top - kinder[1].top) < 4,
    abstand: parseFloat(getComputedStyle(knoepfe).gap || '0'),
    knopfBreite: speichern.getBoundingClientRect().width,
    zeileBreite: knoepfe.getBoundingClientRect().width,
  };
});
check('Auf dem Desktop stehen Formular und Liste nebeneinander',
  !!mass && mass.spalten === 2 && mass.nebeneinander);
check('Die Knopfgruppe haelt den Hausabstand von 10 px (ENT-174)',
  !!mass && mass.abstand === 10);
check('KRITISCH: der Knopf wird nicht ueber die volle Breite gestreckt (CLAUDE.md)',
  !!mass && mass.knopfBreite < mass.zeileBreite * 0.8);

// Dieselbe Ansicht am schmalen Fenster: untereinander statt zweispaltig.
// Jede Aenderung am Desktop-Layout wird zusaetzlich schmal geprueft.
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(400);
const schmal = await ev(() => {
  const raster = document.querySelector('.mtl-raster');
  if (!raster) { return null; }
  const kinder = [...raster.children].map(k => k.getBoundingClientRect());
  return { spalten: getComputedStyle(raster).gridTemplateColumns.split(' ').length,
           untereinander: kinder.length === 2 && kinder[1].top > kinder[0].bottom - 1,
           ueberlauf: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 };
});
check('Am schmalen Fenster stehen sie untereinander',
  !!schmal && schmal.spalten === 1 && schmal.untereinander);
check('Und die Seite laeuft dabei nicht seitlich ueber', !!schmal && !schmal.ueberlauf);

// ══════════════ 11. TERMINE (ENT-436) ═════════════════════════════════
// Ein Termin ist eine Mitteilung mit Zeit, Ort und Antwort. Zwei Dinge
// koennen hier still falsch werden: Die Termin-Felder gelten fuer eine
// Mitteilung mit (dann stuende an einer Info eine Uhrzeit, die niemand
// gesetzt hat), und "offen" wird aus Zahlen gerechnet, die es gar nicht
// hergeben.
listenAntwort = { status: 'ok', eingerichtet: true, mitteilungen: LISTE,
                  push_eingerichtet: true, push_geraete: 3, push_grund: 'ok' };
await anmelden();
await ev(() => go('mitteilungen'));
await page.waitForTimeout(600);

const terminEintrag = await ev(() => {
  const e = document.querySelector('#mtlListe .mtl-eintrag[data-id="7"]');
  return e ? {
    marken: [...e.querySelectorAll('.mtl-marken .chip')].map(c => c.textContent.trim()),
    termin: e.querySelector('.mtl-termin')?.textContent || '',
    antworten: e.querySelector('.mtl-antworten')?.textContent || '',
  } : null;
});
check('Der Termin ist in der Liste als solcher gekennzeichnet',
  !!terminEintrag && terminEintrag.marken.some(m => /Termin/.test(m)));
check('KRITISCH: Datum, Zeit und Ort stehen daran',
  !!terminEintrag && /24\.09\.2029/.test(terminEintrag.termin)
  && /17:00/.test(terminEintrag.termin) && /Aufenthaltsraum/.test(terminEintrag.termin));
check('KRITISCH: die Antworten stehen mit Bezug da -- zugesagt, abgesagt UND offen',
  !!terminEintrag && /3 zugesagt/.test(terminEintrag.antworten)
  && /1 abgesagt/.test(terminEintrag.antworten) && /14 von 18/.test(terminEintrag.antworten));
check('KRITISCH: an einer gewoehnlichen Mitteilung steht keine Antwortzeile',
  (await ev(() => !document.querySelector('#mtlListe .mtl-eintrag[data-id="5"] .mtl-antworten'))) === true);

// Unbekannter Empfaengerkreis: Dann wird "offen" NICHT behauptet.
listenAntwort = { status: 'ok', eingerichtet: true, push_eingerichtet: true, push_geraete: 3,
  mitteilungen: [{ ...LISTE[0], id: 7, ist_termin: true, art: 'termin',
    beginn: '2029-09-24 17:00:00', ende: null, ort: '', empfaenger_anzahl: -1,
    zugesagt_anzahl: 2, abgesagt_anzahl: 0 }] };
await anmelden();
await ev(() => go('mitteilungen'));
await page.waitForTimeout(500);
const ohneNenner = (await ev(() => document.querySelector('#mtlListe .mtl-antworten')?.textContent)) || '';
check('KRITISCH: ist der Empfaengerkreis unbekannt, wird KEINE Zahl offener Antworten behauptet',
  /unbekannt/i.test(ohneNenner) && !/von -1/.test(ohneNenner) && !/0 (von )?noch offen/.test(ohneNenner));
check('Die abgegebenen Antworten stehen trotzdem da', /2 zugesagt/.test(ohneNenner));

// Die Namensliste: alle Empfaenger, auch wer nie geoeffnet hat.
listenAntwort = { status: 'ok', eingerichtet: true, mitteilungen: LISTE,
                  push_eingerichtet: true, push_geraete: 3, push_grund: 'ok' };
await anmelden();
await ev(() => go('mitteilungen'));
await page.waitForTimeout(600);
await klick('#mtlListe .mtl-eintrag[data-id="7"] .mtl-akt button:nth-child(2)');
await page.waitForTimeout(600);
const liste7 = ((await ev(() => document.getElementById('mtlLeser7')?.textContent || '')) || '')
  .replace(/\s+/g, ' ').trim();
check('KRITISCH: die Namensliste nennt die Zusage', /Max Muster/.test(liste7) && /zugesagt/.test(liste7));
check('KRITISCH: und die Absage', /Rita Beispiel/.test(liste7) && /abgesagt/.test(liste7));
check('KRITISCH: wer nicht geantwortet hat, steht MIT NAMEN da -- '
    + 'sonst bliebe die Frage "wen muss ich noch fragen?" unbeantwortet',
  /Ohne Beispiel/.test(liste7) && /noch nicht geantwortet/.test(liste7));
check('KRITISCH: "noch nicht geoeffnet" ist etwas anderes als ein leeres Feld',
  /noch nicht geöffnet/.test(liste7));

// ── Das Formular
await klick('#mtlAbbrechen');
await page.waitForTimeout(200);
check('KRITISCH: die Termin-Felder sind bei einer Mitteilung ausgeblendet',
  !(await page.isVisible('#mtlBeginn')));
await klick('#mtlArtTermin');
await page.waitForTimeout(300);
check('KRITISCH: nach dem Umschalten stehen Beginn, Ende und Ort da',
  (await page.isVisible('#mtlBeginn')) && (await page.isVisible('#mtlEnde'))
  && (await page.isVisible('#mtlOrt')));
check('Die Überschrift des Formulars zieht mit',
  /Termin/.test((await ev(() => document.getElementById('mtlFormTitel')?.textContent)) || ''));

// Ohne Beginn wird nichts abgeschickt -- der Server weist es ebenfalls ab.
await page.fill('#mtlTitel', 'Sitzung');
await page.fill('#mtlText', 'Bitte alle.');
gesendet = null;
await klick('#mtlSpeichern');
await page.waitForTimeout(400);
check('KRITISCH: ein Termin ohne Beginn wird gar nicht erst abgeschickt', gesendet === null);

await page.fill('#mtlBeginn', '2029-11-05T17:00');
await page.fill('#mtlEnde', '2029-11-05T19:00');
await page.fill('#mtlOrt', 'Aufenthaltsraum');
gesendet = null;
await klick('#mtlSpeichern');
await page.waitForTimeout(500);
check('KRITISCH: der Termin wird als Termin abgeschickt', gesendet && gesendet.art === 'termin');
check('KRITISCH: Beginn, Ende und Ort kommen mit',
  gesendet && String(gesendet.beginn).startsWith('2029-11-05')
  && String(gesendet.ende).startsWith('2029-11-05') && gesendet.ort === 'Aufenthaltsraum');

// Zurueckschalten OHNE zwischendurch zu speichern: Die eingetippten
// Termin-Angaben stehen dann noch in den (ausgeblendeten) Feldern und
// dürfen trotzdem nicht mitgehen. Ohne diese Reihenfolge prüfte der
// Abschnitt nichts -- nach einem erfolgreichen Speichern ist das Formular
// ohnehin leer. (Genau daran ist die Gegenprobe zuerst grün geblieben.)
await klick('#mtlArtTermin');
await page.waitForTimeout(200);
await page.fill('#mtlTitel', 'Doch nur eine Mitteilung');
await page.fill('#mtlText', 'Ohne Zeit.');
await page.fill('#mtlBeginn', '2029-11-05T17:00');
await page.fill('#mtlOrt', 'Aufenthaltsraum');
await klick('#mtlArtInfo');
await page.waitForTimeout(200);
check('Die Termin-Felder sind nach dem Zurueckschalten wieder ausgeblendet',
  !(await page.isVisible('#mtlBeginn')));
gesendet = null;
await klick('#mtlSpeichern');
await page.waitForTimeout(500);
check('KRITISCH: zurueckgeschaltet geht sie als Mitteilung hinaus',
  gesendet && gesendet.art === 'info');
check('KRITISCH: und ohne die Termin-Angaben -- sonst stuende an einer Mitteilung eine Uhrzeit',
  gesendet && !gesendet.beginn && !gesendet.ende && !gesendet.ort);

// Bearbeiten eines Termins holt die Felder zurueck.
await klick('#mtlListe .mtl-eintrag[data-id="7"] .mtl-akt button:nth-child(1)');
await page.waitForTimeout(400);
check('KRITISCH: beim Bearbeiten steht der Termin wieder als Termin da',
  (await page.isVisible('#mtlBeginn'))
  && (await ev(() => document.getElementById('mtlBeginn')?.value)) === '2029-09-24T17:00');
check('Ort und Ende kommen mit',
  (await ev(() => document.getElementById('mtlOrt')?.value)) === 'Aufenthaltsraum'
  && (await ev(() => document.getElementById('mtlEnde')?.value)) === '2029-09-24T19:00');

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
