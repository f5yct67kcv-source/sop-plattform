// Fahrzeugübernahme in der App (ENT-340).
//
// Der Auftrag des Projektinhabers war nicht "ein Formular", sondern ein
// RIEGEL: *„bevor ein Rundgang angeklickt wird, die Frage kommt, ob ein
// Dienstfahrzeug im Einsatz ist … dass der Mitarbeiter nicht schon losfährt
// zum Objekt, in die Rundgänge geht und der Prozess der Fahrzeugübernahme
// vergisst. Wir müssen das so bauen."*
//
// Geprüft wird darum vor allem, was am Riegel still kaputtgehen kann:
//
//   1. Er sitzt vor BEIDEN Wegen in den Rundgang. Ein Riegel, um den ein
//      Weg herumführt, ist keiner -- und der zweite Weg fällt bei einer
//      Erweiterung als Erstes hinten runter.
//   2. Er fragt EINMAL pro Tag, nicht bei jedem Antippen.
//   3. "Kein Dienstfahrzeug" wird GESPEICHERT, nicht bloss durchgelassen.
//      Sonst liesse sich später nicht unterscheiden, ob jemand ohne
//      Fahrzeug fuhr oder die Frage nie gesehen hat.
//   4. Er blockiert NIE: Netzfehler, fehlende Einrichtung und "kein
//      Fahrzeug erfasst" lassen den Wächter weiterarbeiten -- und sind
//      drei verschiedene Aussagen mit drei verschiedenen Texten.
//   5. "Zurück" im Formular führt zur Frage zurück, nicht an ihr vorbei.
//   6. Die Kennung des Aufklebers verlässt die Adresszeile sofort.
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Die Regeln laufen wirklich (PHP, SQLite im Arbeitsspeicher)
// ══════════════════════════════════════════════════════════════════════════
// Welcher Kilometerstand angenommen und welcher abgewiesen wird, entscheidet
// über echte Fahrten. Eine im Browser nachgebaute Fassung bewiese nur, dass
// der Nachbau stimmt.
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_fahrzeug_uebernahme.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpBeanstandet = phpAus.split('\n').filter(z => z.trim().startsWith('X '));
check('KRITISCH: die Uebernahme-Regeln laufen fehlerfrei durch',
  phpCode === 0 && phpBeanstandet.length === 0);
check('Sie werden in mindestens 20 Faellen geprueft',
  Number((phpAus.match(/^(\d+) Pruefungen bestanden/m) || [0, 0])[1]) >= 20);
phpBeanstandet.forEach(z => bad.push('PHP: ' + z.trim()));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Was sich nur am Quelltext zeigt
// ══════════════════════════════════════════════════════════════════════════
const ohneKommentar = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const UEB  = ohneKommentar(readFileSync(`${WURZEL}/backend/api/meine_fahrzeug_uebernahme.php`, 'utf8'));
const LIST = ohneKommentar(readFileSync(`${WURZEL}/backend/api/meine_fahrzeuge.php`, 'utf8'));
const HELF = ohneKommentar(readFileSync(`${WURZEL}/backend/fahrzeug.php`, 'utf8'));

// Die Kennung ist das Geheimnis hinter dem Aufkleber. Geht sie hinaus, kann
// jeder, der sie einmal gesehen hat, Uebernahmen buchen, ohne je vor dem
// Fahrzeug gestanden zu haben -- und der Aufkleber verliert genau die
// Eigenschaft, fuer die er da ist. Geprueft wird die Aussage, nicht der
// Wortlaut: Steht qr_kennung unter den GELESENEN SPALTEN oder in einer
// Antwort dieser beiden Endpunkte, ist etwas faul. Sie im WHERE zu
// verwenden ist dagegen genau richtig -- dort loest der Server den
// Aufkleber auf, ohne ihn herauszugeben.
const geleseneSpalten = q => [...q.matchAll(/SELECT\s+([\s\S]*?)\s+FROM/gi)].map(m => m[1]);
const kennungRaus = [UEB, LIST].some(q =>
  geleseneSpalten(q).some(sp => /qr_kennung/i.test(sp)) || /['"]qr_kennung['"]\s*=>/.test(q));
check('KRITISCH: die Aufkleber-Kennung verlaesst die Endpunkte der App nie', !kennungRaus);

// Die Person kommt aus der Sitzung, nie aus der Anfrage -- sonst liesse sich
// eine Fahrt einem anderen anhaengen.
check('KRITISCH: die Person der Uebernahme stammt aus der Sitzung, nicht aus dem Rumpf',
  /\$user\['id'\]/.test(UEB) && !/input\['mitarbeiter_id'\]/.test(UEB));

// Der mitgeschickte Einsatz wird gegen die EIGENE Zuteilung geprueft.
check('KRITISCH: ein mitgeschickter Einsatz wird gegen die eigene Zuteilung geprueft',
  /einsatz_zuteilung/.test(UEB) && /z\.mitarbeiter_id = \?/.test(UEB));

// Das Foto wird am Dateianfang erkannt, nicht am mitgeschickten Typ.
check('KRITISCH: das Bildformat wird am Dateianfang geprueft, nicht am behaupteten Typ',
  /ersatzscan_foto_mime\s*\(/.test(UEB));

// Nur EINE Stelle erzeugt Aufkleber-Schluessel, und sie nimmt echten Zufall.
check('KRITISCH: der Aufkleber-Schluessel kommt aus random_bytes, nicht aus mt_rand/uniqid',
  /random_bytes\s*\(/.test(HELF) && !/\b(mt_rand|uniqid|rand)\s*\(/.test(HELF));

// Vor dem Einrichtungslauf gibt es die Tabellen nicht. Das ist etwas
// anderes als "keine Fahrzeuge" und muss unterscheidbar herauskommen.
check('Fehlende Einrichtung wird eigens gemeldet, nicht als leere Liste',
  /eingerichtet['"]\s*=>\s*false/.test(LIST));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 3 — Der Riegel in der App
// ══════════════════════════════════════════════════════════════════════════

const HEUTE = new Date().toISOString().slice(0, 10);
// Der zuletzt bekannte Stand liegt ein paar Tage zurueck -- ausgerechnet,
// nicht festgenagelt: Ein festes Datum nahe beim heutigen Tag kippt beim
// naechsten Datumswechsel (test_datumsfest.mjs achtet darauf).
const VORTAGE = new Date(Date.now() - 4 * 864e5).toISOString().slice(0, 10);

// Erfundene Kontrollschilder mit hoher Nummer -- kein echtes Fahrzeug.
const FAHRZEUGE = [
  { id: 1, kennzeichen: 'SO 999001', bezeichnung: 'Patrouille 1',
    letzter_stand: { quelle: 'uebernahme', tacho_km: 61000, zeitpunkt: VORTAGE + ' 06:12:00',
                     datum: VORTAGE, person: 'Vorname Nachname' } },
  { id: 2, kennzeichen: 'SO 999002', bezeichnung: null, letzter_stand: null },
];

const SCHICHTEN = { status: 'ok', schichten: [
  { id: 61, kunde_name: 'Muster AG', titel: 'Revierdienst', strasse: 'Weg 1', ort: '4600 Olten',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: HEUTE, von: '22:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Objekt A',
    objekt_id: 1, im_team: 1, team: [], kanton: 'SO', fahrzeug: null },
]};

// Was der Server bei meine_fahrzeuge.php antwortet, steuert jeder Fall
// einzeln -- das ist die Weiche, an der die vier Zustände auseinandergehen.
let fahrzeugAntwort = { status: 'ok', eingerichtet: true, fahrzeuge: FAHRZEUGE, heute_beantwortet: false };
let fahrzeugStatus = 200;
let gesendet = [];
let gerufen = [];

const browser = await chromium.launch({ executablePath: browserPfad() });

async function appStarten(url) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', route => {
    const voll = route.request().url();
    const p = voll.split('/api/')[1].split('?')[0];
    gerufen.push(voll.split('/api/')[1]);
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'amuster', ist_admin: false });
    if (p.includes('meine_schichten')) return send(SCHICHTEN);
    if (p.includes('mein_profil')) return send({ status: 'ok', profil: { name: 'amuster', revierdienst_berechtigt: 1 } });
    if (p.includes('meine_fahrzeug_uebernahme')) {
      gesendet.push(JSON.parse(route.request().postData() || '{}'));
      return send({ status: 'ok', art: 'uebernahme', id: 5, tacho_km: 61200, km_seither: 200,
                    fahrzeug: { id: 1, kennzeichen: 'SO 999001', bezeichnung: 'Patrouille 1' } });
    }
    if (p.includes('meine_fahrzeuge')) {
      return route.fulfill({ status: fahrzeugStatus, contentType: 'application/json',
                             body: JSON.stringify(fahrzeugAntwort) });
    }
    if (p.includes('mein_rundgang_vorlagen_alle')) {
      return send({ status: 'ok', vorlagen: [
        { id: 3, name: 'Schliessrunde', objekt_name: 'Objekt A', kunde_name: 'Muster AG',
          fenster_von: null, fenster_bis: null }] });
    }
    if (p.includes('mein_rundgang_vorlagen')) return send({ status: 'ok', vorlagen: [] });
    if (p.includes('mein_rundgang_starten')) return send({ status: 'ok', rundgang_id: 9, kontrollpunkte: [] });
    return send({ status: 'ok' });
  });
  await page.goto(`file://${WURZEL}/${url || 'app.html'}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`file://${WURZEL}/${url || 'app.html'}`);
  await page.fill('#gName', 'amuster');
  await page.fill('#gPass', 'x');
  await page.click('#gBtn');
  await page.waitForSelector('#app.on');
  await page.waitForTimeout(400);
  return page;
}

const blattText = async page => (await page.textContent('#blBody')).replace(/\s+/g, ' ');
// Knopfbeschriftungen der Wegwahl/Anleitung stehen in der Fussleiste, nicht
// im Rumpf -- eine eigene Auslesefunktion, damit die Pruefungen die
// richtige Stelle lesen statt zufaellig im Rumpf danach zu suchen.
const blattFussText = async page => (await page.textContent('#blFuss')).replace(/\s+/g, ' ');
const blattOffen = page => page.evaluate(() => document.getElementById('blatt').classList.contains('on'));
const frageDa = async page => /Nimmst du/.test(await blattText(page));
const wegwahlDa = async page => /Aufkleber scannen/.test(await blattFussText(page));

// Bleibt die Frage aus, sind die daran haengenden Pruefungen gegenstandslos.
// Sie duerfen dann NICHT an einem fehlenden Knopf abstuerzen: Ein Absturz
// sagt "irgendetwas ist kaputt", diese Meldung sagt, was.
function entfaellt(grund, namen) { namen.forEach(n => bad.push(n + ' — ' + grund)); }

// ══ 1. Der Riegel vor dem Kachelweg ═════════════════════════════════════
let page = await appStarten();
await page.evaluate(() => zeige('waechter'));
await page.waitForTimeout(200);

check('KRITISCH: der Waechter-Bereich hat eine Kachel fuer die Fahrzeuguebernahme',
  await page.locator('#mk-fahrzeug').count() === 1);

gerufen = [];
await page.click('#mk-rundgang');
await page.waitForTimeout(400);
let text = await blattText(page);
check('KRITISCH: vor dem Rundgang kommt zuerst die Frage nach dem Dienstfahrzeug',
  /Dienstfahrzeug/.test(text) && /Nimmst du/.test(text));
check('KRITISCH: die Rundgangliste wird noch gar nicht geholt, solange die Frage offen ist',
  !gerufen.some(p => p.includes('mein_rundgang_vorlagen_alle')));

// ── "Ja" fuehrt zur Wegwahl (Aufkleber/manuell), nicht direkt ins Formular ──
// Vom Projektinhaber verlangt, nachdem er die Kachel getestet hatte: Sie
// sprang direkt zur manuellen Liste, ohne je auf den Aufkleber hinzuweisen.
if (!await frageDa(page)) {
  entfaellt('die Frage kam gar nicht erst', [
    'KRITISCH: "Ja" fuehrt zur Wegwahl, nicht direkt ins Formular',
    'KRITISCH: "Aufkleber scannen" zeigt eine Anleitung, keinen eigenen Scanner im Browser',
    'Von der Anleitung "Zurueck" fuehrt zur Wegwahl zurueck',
    'Das Formular (ueber "Kein Aufkleber verfuegbar") nennt den zuletzt bekannten Stand',
    'KRITISCH: "Zurueck" im Formular fuehrt zur Wegwahl zurueck, nicht in den Rundgang',
    'KRITISCH: Von der Wegwahl "Zurueck" fuehrt zur Frage zurueck, nicht in den Rundgang',
    'KRITISCH: "kein Dienstfahrzeug" wird als Antwort GESPEICHERT, nicht nur durchgelassen',
    'KRITISCH: danach geht es in den Rundgang weiter',
    'KRITISCH: nach der Antwort kommt die Frage nicht erneut']);
} else {
await page.locator('#blFuss button.btn-primary').click();
await page.waitForTimeout(200);
check('KRITISCH: "Ja" fuehrt zur Wegwahl, nicht direkt ins Formular',
  /Aufkleber scannen/.test(await blattFussText(page)) && /Kein Aufkleber verfügbar/.test(await blattFussText(page))
  && await page.locator('#fzuWahl').count() === 0);

// Faellt die Wegwahl aus (siehe Gegenprobe), duerfen die folgenden Klicks
// nicht auf nie erschienene Knoepfe warten und den Lauf abbrechen -- sie
// sollen SAGEN, was fehlt.
if (!await wegwahlDa(page)) {
  entfaellt('die Wegwahl kam gar nicht erst', [
    'KRITISCH: "Aufkleber scannen" zeigt eine Anleitung, keinen eigenen Scanner im Browser',
    'Von der Anleitung "Zurueck" fuehrt zur Wegwahl zurueck',
    'Das Formular (ueber "Kein Aufkleber verfuegbar") nennt den zuletzt bekannten Stand',
    'KRITISCH: "Zurueck" im Formular fuehrt zur Wegwahl zurueck, nicht in den Rundgang',
    'KRITISCH: Von der Wegwahl "Zurueck" fuehrt zur Frage zurueck, nicht in den Rundgang']);
} else {
// ── "Aufkleber scannen" ist eine Anleitung, kein In-App-Scanner ────────
// Eine Webseite kann die native Kamera-App nicht im Scan-Modus starten --
// das kann nur der Mensch selbst. Ein <video>-Element waere das Zeichen
// einer eigenen Kamera-Vorschau im Browser; die soll es nicht geben.
await page.locator('#blFuss button.btn-primary').click();
await page.waitForTimeout(200);
text = await blattText(page);
check('KRITISCH: "Aufkleber scannen" zeigt eine Anleitung, keinen eigenen Scanner im Browser',
  /Kamera-App/.test(text) && await page.locator('video').count() === 0
  && await page.locator('input[type=file]').count() === 0);

// Zeigt die Anleitung nicht die erwartete Seite, ist auch die Fussleiste
// nicht die der Anleitung (dort steht genau ein Knopf) -- ein blinder Klick
// waere mehrdeutig und liesse den Lauf abstuerzen statt rot zu werden.
if (!/Kamera-App/.test(text)) {
  entfaellt('die Anleitung kam gar nicht erst', [
    'Von der Anleitung "Zurueck" fuehrt zur Wegwahl zurueck',
    'Das Formular (ueber "Kein Aufkleber verfuegbar") nennt den zuletzt bekannten Stand',
    'KRITISCH: "Zurueck" im Formular fuehrt zur Wegwahl zurueck, nicht in den Rundgang',
    'KRITISCH: Von der Wegwahl "Zurueck" fuehrt zur Frage zurueck, nicht in den Rundgang']);
} else {
await page.locator('#blFuss button').click();
await page.waitForTimeout(200);
check('Von der Anleitung "Zurueck" fuehrt zur Wegwahl zurueck',
  /Aufkleber scannen/.test(await blattFussText(page)));

// ── "Kein Aufkleber verfügbar" fuehrt zum bestehenden Formular ─────────
await page.locator('#blFuss button', { hasText: 'Kein Aufkleber' }).click();
await page.waitForTimeout(200);
check('Das Formular (ueber "Kein Aufkleber verfuegbar") nennt den zuletzt bekannten Stand',
  /61.?000/.test(await blattText(page)) || await page.locator('#fzuWahl').count() === 1);

await page.evaluate(() => fzuZurueck());
await page.waitForTimeout(200);
check('KRITISCH: "Zurueck" im Formular fuehrt zur Wegwahl zurueck, nicht in den Rundgang',
  /Aufkleber scannen/.test(await blattFussText(page))
  && !gerufen.some(p => p.includes('mein_rundgang_vorlagen_alle')));

await page.evaluate(() => fzuWegWahlZurueck());
await page.waitForTimeout(200);
check('KRITISCH: Von der Wegwahl "Zurueck" fuehrt zur Frage zurueck, nicht in den Rundgang',
  /Nimmst du/.test(await blattText(page))
  && !gerufen.some(p => p.includes('mein_rundgang_vorlagen_alle')));
}
}

// ══ 2. "Kein Dienstfahrzeug" wird gespeichert und laesst weiter ═════════
if (!await frageDa(page)) {
  entfaellt('"Zurueck" hatte den Riegel schon uebersprungen', [
    'KRITISCH: "kein Dienstfahrzeug" wird als Antwort GESPEICHERT, nicht nur durchgelassen',
    'KRITISCH: danach geht es in den Rundgang weiter',
    'KRITISCH: nach der Antwort kommt die Frage nicht erneut']);
} else {
gesendet = [];
await page.click('#fzuNeinBtn');
await page.waitForTimeout(500);
check('KRITISCH: "kein Dienstfahrzeug" wird als Antwort GESPEICHERT, nicht nur durchgelassen',
  gesendet.length === 1 && gesendet[0].art === 'ohne_fahrzeug');
check('KRITISCH: danach geht es in den Rundgang weiter',
  gerufen.some(p => p.includes('mein_rundgang_vorlagen_alle')));

// ══ 3. Die Frage kommt einmal am Tag, nicht bei jedem Antippen ══════════
gerufen = [];
await page.evaluate(() => { blattZu(); zeige('waechter'); });
await page.waitForTimeout(150);
await page.click('#mk-rundgang');
await page.waitForTimeout(400);
check('KRITISCH: nach der Antwort kommt die Frage nicht erneut',
  !/Nimmst du/.test(await blattText(page))
  && gerufen.some(p => p.includes('mein_rundgang_vorlagen_alle')));
}
}
await page.close();

// ══ 4. Der Riegel sitzt AUCH vor dem zweiten Weg (eigene Schicht) ═══════
page = await appStarten();
gerufen = [];
await page.evaluate(() => rundgangStarten(61));
await page.waitForTimeout(400);
check('KRITISCH: auch der Weg ueber die eigene Schicht geht durch die Frage',
  /Nimmst du/.test(await blattText(page)));
check('KRITISCH: und holt die Kontrollrunden erst danach',
  !gerufen.some(p => p.includes('mein_rundgang_vorlagen?')
                  || p.startsWith('mein_rundgang_vorlagen.php')));

// ── Die Uebernahme selbst ──────────────────────────────────────────────
if (!await frageDa(page)) {
  entfaellt('die Frage kam gar nicht erst', [
    'KRITISCH: die Uebernahme sendet Fahrzeug und Kilometerstand',
    'Die laufende Schicht wird mitgegeben, damit sich die Fahrt zuordnen laesst',
    'KRITISCH: nach der Uebernahme geht es in den Rundgang weiter',
    'KRITISCH: ohne Kilometerstand wird nichts gesendet -- die Kette braucht die Zahl']);
} else {
// Die Navigation Frage -> Wegwahl -> Formular ist bereits in Abschnitt 1
// geprueft; hier zaehlt nur noch das Senden selbst -- direkter Einstieg
// ins Formular, wie schon beim ersten Test dieses Abschnitts.
gesendet = [];
await page.evaluate(() => fzuFormular());
await page.waitForTimeout(250);
await page.selectOption('#fzuWahl', '1');
await page.fill('#fzuKm', '61200');
await page.click('#fzuBtn');
await page.waitForTimeout(500);
check('KRITISCH: die Uebernahme sendet Fahrzeug und Kilometerstand',
  gesendet.length === 1 && gesendet[0].art === 'uebernahme'
  && gesendet[0].fahrzeug_id === 1 && gesendet[0].tacho_km === 61200);
check('Die laufende Schicht wird mitgegeben, damit sich die Fahrt zuordnen laesst',
  gesendet[0].einsatz_id === 61);
check('KRITISCH: nach der Uebernahme geht es in den Rundgang weiter',
  gerufen.some(p => p.startsWith('mein_rundgang_vorlagen.php')));

// ── Ohne Kilometerstand wird nichts gesendet ───────────────────────────
// Diesmal ueber die echten Knoepfe (Kachel -> Wegwahl -> "Kein Aufkleber
// verfuegbar"), damit auch dieser Weg zum Formular mindestens einmal echt
// angeklickt und nicht nur direkt aufgerufen wird.
gesendet = [];
await page.evaluate(() => { fzuHeuteBeantwortet = false; fzuOeffnen(); });
await page.waitForTimeout(300);
await page.locator('#blFuss button', { hasText: 'Kein Aufkleber' }).click();
await page.waitForTimeout(200);
await page.selectOption('#fzuWahl', '2');
await page.click('#fzuBtn');
await page.waitForTimeout(300);
check('KRITISCH: ohne Kilometerstand wird nichts gesendet -- die Kette braucht die Zahl',
  gesendet.length === 0 && await page.locator('#fzuErr').isVisible());
}
await page.close();

// ══ 5. Vier Zustaende, vier Texte -- und nie ein blockierter Waechter ═══
// (a) Einrichtung fehlt
fahrzeugAntwort = { status: 'ok', eingerichtet: false, fahrzeuge: [], heute_beantwortet: false };
page = await appStarten();
gerufen = [];
await page.evaluate(() => { blattZu(); zeige('waechter'); });
await page.waitForTimeout(150);
await page.click('#mk-rundgang');
await page.waitForTimeout(500);
check('KRITISCH: ohne eingerichtete Uebernahme wird nicht gefragt und der Rundgang geht auf',
  gerufen.some(p => p.includes('mein_rundgang_vorlagen_alle')));
await page.evaluate(() => fzuOeffnen());
await page.waitForTimeout(400);
text = await blattText(page);
check('"Nicht eingerichtet" wird als solches benannt, nicht als "kein Fahrzeug"',
  /nicht eingerichtet/i.test(text) && !/Kein Dienstfahrzeug im Betrieb/.test(text));
await page.close();

// (b) eingerichtet, aber kein Fahrzeug erfasst
fahrzeugAntwort = { status: 'ok', eingerichtet: true, fahrzeuge: [], heute_beantwortet: false };
page = await appStarten();
gerufen = [];
await page.evaluate(() => { blattZu(); zeige('waechter'); });
await page.waitForTimeout(150);
await page.click('#mk-rundgang');
await page.waitForTimeout(500);
check('KRITISCH: ohne erfasstes Fahrzeug wird nicht gefragt und der Rundgang geht auf',
  gerufen.some(p => p.includes('mein_rundgang_vorlagen_alle')));
await page.evaluate(() => fzuOeffnen());
await page.waitForTimeout(400);
text = await blattText(page);
check('"Kein Fahrzeug erfasst" ist ein anderer Text als "nicht eingerichtet"',
  /Kein Dienstfahrzeug im Betrieb/.test(text) && !/nicht eingerichtet/i.test(text));
await page.close();

// (c) Netzfehler -- der Riegel darf niemanden aussperren
fahrzeugAntwort = { status: 'error', message: 'kaputt' };
fahrzeugStatus = 500;
page = await appStarten();
gerufen = [];
await page.evaluate(() => { blattZu(); zeige('waechter'); });
await page.waitForTimeout(150);
await page.click('#mk-rundgang');
await page.waitForTimeout(600);
check('KRITISCH: ein Netzfehler sperrt den Waechter nicht aus -- der Rundgang geht trotzdem auf',
  gerufen.some(p => p.includes('mein_rundgang_vorlagen_alle')));
check('Der Netzfehler wird benannt, statt still zu verschwinden',
  /nicht laden|nachholen/i.test(await page.textContent('#toast')));
await page.close();
fahrzeugStatus = 200;
fahrzeugAntwort = { status: 'ok', eingerichtet: true, fahrzeuge: FAHRZEUGE, heute_beantwortet: false };

// ══ 6. Der Aufkleber ════════════════════════════════════════════════════
// Die Kennung kommt in der Adresse an und muss sofort daraus verschwinden:
// Sie ist das Geheimnis hinter dem Aufkleber und gehoert weder in den
// Verlauf noch in einen weitergegebenen Link.
fahrzeugAntwort = { status: 'ok', eingerichtet: true,
  fahrzeug: { id: 1, kennzeichen: 'SO 999001', bezeichnung: 'Patrouille 1', status: 'aktiv',
              letzter_stand: { quelle: 'uebernahme', tacho_km: 61000, zeitpunkt: VORTAGE + ' 06:12:00',
                               datum: VORTAGE, person: 'Vorname Nachname' } } };
page = await appStarten('app.html?fz=abc123');
await page.waitForTimeout(700);
check('KRITISCH: der gescannte Aufkleber oeffnet die Uebernahme fuer genau dieses Fahrzeug',
  await blattOffen(page) && /SO 999001/.test(await blattText(page)));
check('KRITISCH: die Kennung wird sofort aus der Adresszeile entfernt',
  !(await page.evaluate(() => location.search)).includes('fz='));
check('KRITISCH: die Kennung wird SERVERSEITIG aufgeloest, nicht im Geraet',
  gerufen.some(p => p.includes('meine_fahrzeuge.php?kennung=abc123')));
check('Beim gescannten Fahrzeug gibt es keine Auswahlliste -- man steht davor',
  await page.locator('#fzuWahl').count() === 0);

gesendet = [];
await page.fill('#fzuKm', '61500');
await page.click('#fzuBtn');
await page.waitForTimeout(400);
check('KRITISCH: die Uebernahme ueber den Aufkleber sendet die Kennung, nicht die Fahrzeug-ID',
  gesendet.length === 1 && gesendet[0].kennung === 'abc123' && gesendet[0].fahrzeug_id === undefined);
await page.close();

// ══════════════════════════════════════════════════════════════════════════
// TEIL 4 — Der Aufkleber im Cockpit
// ══════════════════════════════════════════════════════════════════════════
// Der QR-Code wird IM COCKPIT erzeugt und als fertiges SVG ins Druckfenster
// geschrieben. Der frühere Weg -- qrcode.js im Druckfenster per <script src>
// nachladen -- ergab einen leeren Aufkleber: Ein mit window.open('')
// geöffnetes Fenster ist about:blank, dort wird ein eingehängtes Skript
// nicht ausgeführt. Es gab dabei keine Fehlermeldung; sichtbar wurde es
// erst am gerenderten Fenster. Diese Pruefung haelt das fest.
const FZ_COCKPIT = [{ id: 1, kennzeichen: 'SO 999001', bezeichnung: 'Patrouille 1',
  marke: 'Marke', modell: 'Modell', art: 'personenwagen', status: 'aktiv',
  besitzart: 'eigentum', standort_id: null, standort_name: null,
  tacho_km: 61000, tacho_am: VORTAGE, mfk_naechste: null, vignette_jahr: null,
  qr_kennung: 'a'.repeat(32) }];

const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const cockpit = await ctx.newPage();
cockpit.on('pageerror', e => bad.push('JS-Fehler (Cockpit): ' + e.message));
await cockpit.route('**/api/**', r => {
  const p = r.request().url().split('/api/')[1].split('?')[0];
  const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  if (p.includes('fahrzeuge')) return send({ status: 'ok', eingerichtet: true, fahrzeuge: FZ_COCKPIT });
  if (p.includes('anstellungsorte')) return send({ status: 'ok', orte: [] });
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  return send({ status: 'ok', mitarbeiter: [], kunden: [], einsaetze: [], objekte: [], rapporte: [], rundgaenge: [] });
});
await cockpit.goto(`file://${WURZEL}/dashboard.html`);
await cockpit.evaluate(() => localStorage.clear());
await cockpit.goto(`file://${WURZEL}/dashboard.html`);
await cockpit.fill('#gName', 'a'); await cockpit.fill('#gPass', 'x'); await cockpit.click('#gBtn');
await cockpit.waitForSelector('#shell.on');
await cockpit.evaluate(() => go('betrieb'));
await cockpit.waitForTimeout(400);
await cockpit.evaluate(() => bkAbschnittZeigen('fz'));
await cockpit.waitForTimeout(600);

check('Am Fahrzeug gibt es einen Weg zum Aufkleber',
  await cockpit.evaluate(() => [...document.querySelectorAll('button')]
    .some(b => b.textContent.trim() === 'Aufkleber' && !b.disabled)));

// window.print() wuerde den Lauf anhalten.
const [druck] = await Promise.all([
  ctx.waitForEvent('page'),
  cockpit.evaluate(() => { window.print = () => {}; fzAufkleber(1); }),
]);
await druck.waitForTimeout(1500);
const kleber = await druck.evaluate(() => ({
  svg: !!document.querySelector('#qr svg'),
  breite: Math.round((document.querySelector('#qr svg') || { getBoundingClientRect: () => ({ width: 0 }) })
    .getBoundingClientRect().width),
  text: document.body.innerText.replace(/\s+/g, ' '),
}));
check('KRITISCH: der Aufkleber traegt einen wirklich gezeichneten QR-Code, kein leeres Feld',
  kleber.svg && kleber.breite > 100);
check('Der Aufkleber nennt das Kontrollschild -- ein Code allein sagt niemandem, zu welchem Auto er gehoert',
  /SO 999001/.test(kleber.text));
await druck.close();
await ctx.close();

await browser.close();

console.log(`${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log(); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
