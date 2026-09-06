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
    archiviert: false, laeuft: true, geplant: false },
  { id: 4, titel: 'Ferien eintragen', text: 'Bitte bis Ende Monat.',
    zielgruppe: 'alle', stufe: 'normal', sichtbar_ab: '2029-05-01 00:00:00', sichtbar_bis: null,
    erstellt_am: '2029-02-20 08:00:00', archiviert_am: null, verfasser_name: 'Das Personalbüro',
    gelesen_anzahl: 0, bestaetigt_anzahl: 0, empfaenger_anzahl: 18,
    archiviert: false, laeuft: false, geplant: true },
  { id: 3, titel: 'Alte Meldung', text: 'Längst vorbei.',
    zielgruppe: 'alle', stufe: 'normal', sichtbar_ab: null, sichtbar_bis: '2029-01-01 23:59:59',
    erstellt_am: '2028-12-01 08:00:00', archiviert_am: null, verfasser_name: 'Das Personalbüro',
    gelesen_anzahl: 4, bestaetigt_anzahl: 0, empfaenger_anzahl: 18,
    archiviert: false, laeuft: false, geplant: false },
  { id: 2, titel: 'Zurückgezogen', text: 'War ein Irrtum.',
    zielgruppe: 'alle', stufe: 'normal', sichtbar_ab: null, sichtbar_bis: null,
    erstellt_am: '2029-01-15 08:00:00', archiviert_am: '2029-01-16 08:00:00',
    verfasser_name: 'Das Personalbüro',
    gelesen_anzahl: 1, bestaetigt_anzahl: 0, empfaenger_anzahl: 18,
    archiviert: true, laeuft: false, geplant: false },
  { id: 1, titel: 'Schlüsselkasten', text: 'Ab sofort im Revierfahrzeug.',
    zielgruppe: 'revier', stufe: 'normal', sichtbar_ab: null, sichtbar_bis: null,
    erstellt_am: '2029-02-10 08:00:00', archiviert_am: null, verfasser_name: 'Die Einsatzleitung',
    gelesen_anzahl: 2, bestaetigt_anzahl: 0, empfaenger_anzahl: -1,
    archiviert: false, laeuft: true, geplant: false },
];

let meineRechte = ['plan', 'kunden', 'abgleich', 'personal_lesen', 'personal_schreiben',
  'personal_vertraulich', 'betrieb', 'rechte', 'offerten', 'mitteilungen'];
let meineRollen = ['verwaltung'];
let listenAntwort = { status: 'ok', eingerichtet: true, mitteilungen: LISTE };
let gesendet = null, archiviert = null;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
page.setDefaultTimeout(5000);
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', r => {
  const u = r.request().url();
  const send = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) {
    return send({ status: 'ok', token: 't', name: 'chefin',
      ist_admin: meineRollen.includes('verwaltung'), rollen: meineRollen, rechte: meineRechte });
  }
  if (u.includes('mitteilung_list')) {
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

meineRechte = ['plan', 'kunden', 'abgleich'];
meineRollen = ['planung'];
await anmelden();
check('KRITISCH: ohne das Recht steht der Eintrag NICHT da',
  await ev(() => { const e = document.getElementById('nav-admin-mitteilungen');
    return !e || e.style.display === 'none'; }));

meineRechte = ['personal_lesen', 'personal_schreiben', 'personal_vertraulich', 'mitteilungen'];
meineRollen = ['personal'];
await anmelden();
check('KRITISCH: die Rolle Personal darf Mitteilungen verfassen (ENT-421)',
  await ev(() => { const e = document.getElementById('nav-admin-mitteilungen');
    return !!e && e.style.display !== 'none'; }));

// ══════════════ 2. DIE LISTE ══════════════════════════════════════════
meineRechte = ['plan', 'kunden', 'abgleich', 'personal_lesen', 'personal_schreiben',
  'personal_vertraulich', 'betrieb', 'rechte', 'offerten', 'mitteilungen'];
meineRollen = ['verwaltung'];
await anmelden();
await ev(() => go('mitteilungen'));
await page.waitForTimeout(600);

check('Die Ansicht ist offen',
  await ev(() => document.getElementById('view-mitteilungen')?.classList.contains('on')));

const eintraege = await ev(() => [...document.querySelectorAll('#mtlListe .mtl-eintrag')].map(e => ({
  id: e.dataset.id,
  marken: [...e.querySelectorAll('.mtl-marken .chip')].map(c => c.textContent.trim()),
  meta: e.querySelector('.mtl-meta')?.textContent || '',
})));
check('KRITISCH: alle fuenf Mitteilungen erscheinen, auch die zurueckgezogene',
  Array.isArray(eintraege) && eintraege.length === 5);

const finde = id => (eintraege || []).find(e => e.id === String(id)) || { marken: [], meta: '' };

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
await klick('#mtlListe .mtl-eintrag[data-id="2"] .mtl-akt button:nth-child(3)');
await page.waitForTimeout(400);
check('Eine zurueckgezogene laesst sich wieder aufnehmen',
  archiviert && Number(archiviert.id) === 2 && archiviert.zurueck === true);

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

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
