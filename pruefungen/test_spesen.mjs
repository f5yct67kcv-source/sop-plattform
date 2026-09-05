// Spesen: Quittungsbelege erfassen, einreichen, entscheiden (ENT-413).
//
// WORAUF DIESE SUITE BESONDERS ACHTET:
//
// 1. Die ABGRENZUNG aus OP-392. "Spesen" sind Quittungsbelege (Tanken,
//    Einkauf, Parkgebuehr) -- ausdruecklich NICHT der Auslagenersatz nach
//    Art. 18 GAV, der in backend/auslagen.php aus Zone und Wegstrecke
//    gerechnet wird. Wer beides vermengt, baut eine GAV-Abrechnung, wo eine
//    Quittungsablage gemeint war. Geprueft wird darum ausdruecklich, dass
//    hier nichts gerechnet wird.
//
// 2. Die Belegannahme ist sicherheitsrelevant und wird AUSGEFUEHRT, nicht
//    gelesen (pruef_spesen.php): Mimetyp aus den ersten Bytes, PDF nur als
//    Download.
//
// 3. "Nicht eingerichtet", "noch keine Belege" und "kein Treffer" sind DREI
//    verschiedene Aussagen und brauchen drei verschiedene Texte -- die
//    Regel aus CLAUDE.md, die in diesem Projekt am haeufigsten verletzt
//    wurde. Geprueft wird, dass die Texte sich unterscheiden, nicht wie sie
//    lauten.
//
// 4. Der Betrag geht in RAPPEN zum Server. Die Pruefung fängt den echten
//    Rumpf der Anfrage ab -- eine Oberflaeche, die 12.50 als 12 oder 1250.0
//    schickt, faellt hier auf und nicht erst in der Buchhaltung.
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Feste Daten im Vormonat statt nahe am heutigen Tag: ein Datum neben dem
// Stichtag kippt beim Datumswechsel (test_datumsfest.mjs achtet darauf).
const T = n => `2026-03-${String(n).padStart(2, '0')}`;

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Die Belegannahme wird wirklich ausgefuehrt
// ══════════════════════════════════════════════════════════════════════════
let phpAusgabe = '', phpCode = 0;
try {
  phpAusgabe = execFileSync('php', [`${HIER}/pruef_spesen.php`], { encoding: 'utf8' });
} catch (e) {
  phpAusgabe = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAusgabe.match(/^(\d+) Pruefungen ausgefuehrt/m) || [0, 0])[1]);
const phpFehler = phpAusgabe.split('\n').filter(z => z.startsWith('X '));
check('KRITISCH: der Kern der Belegannahme laeuft ueberhaupt durch', phpAnzahl > 0);
check('KRITISCH: alle Pruefungen der Belegannahme bestehen',
  phpCode === 0 && phpFehler.length === 0);
phpFehler.forEach(f => bad.push('PHP: ' + f));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Rechte, Datenmodell, Verdrahtung
// ══════════════════════════════════════════════════════════════════════════
const EINRICHTEN = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const MEINE = readFileSync(`${WURZEL}/backend/api/meine_spesen.php`, 'utf8');
const MEIN_BELEG = readFileSync(`${WURZEL}/backend/api/meine_spesen_beleg.php`, 'utf8');
const LISTE = readFileSync(`${WURZEL}/backend/api/spesen_list.php`, 'utf8');
const ENTSCHEIDEN = readFileSync(`${WURZEL}/backend/api/spesen_entscheiden.php`, 'utf8');
const BELEG = readFileSync(`${WURZEL}/backend/api/spesen_beleg.php`, 'utf8');
const PHPTEST = readFileSync(`${HIER}/test_php.mjs`, 'utf8');
const DEPLOY = readFileSync(`${WURZEL}/.github/workflows/deploy-hostpoint.yml`, 'utf8');
const KERN = readFileSync(`${WURZEL}/backend/spesen.php`, 'utf8');

check('Die Tabelle entsteht bei der Einrichtung', /CREATE TABLE IF NOT EXISTS spesen/.test(EINRICHTEN));
// Rappen und nicht Franken: Nachkommastellen summieren sich ueber viele
// Belege zu Rundungsdrift. Geprueft wird der Spaltentyp, nicht ein Kommentar.
check('KRITISCH: der Betrag steht als ganzzahlige Rappen in der Tabelle',
  /betrag_rappen\s+INT/.test(EINRICHTEN) && !/betrag[_a-z]*\s+(DECIMAL|FLOAT|DOUBLE)/i.test(
    (EINRICHTEN.match(/CREATE TABLE IF NOT EXISTS spesen[\s\S]*?ENGINE=InnoDB/) || [''])[0]));
// Der Beleg haengt am Datensatz, nicht im Dateisystem -- ein Beleg ohne
// seinen Datensatz waere wertlos.
check('Der Beleg liegt neben dem Datensatz und traegt seinen Mimetyp',
  /beleg\s+LONGBLOB/.test(EINRICHTEN) && /beleg_mime\s+VARCHAR/.test(EINRICHTEN));

// Die Rechtefrage. Die Mitarbeiter-Endpunkte duerfen KEIN Recht verlangen
// (jede Person reicht eigene Belege ein), muessen dafuer aber namentlich in
// der Ausnahmeliste stehen und ausschliesslich mit der Sitzung arbeiten.
check('KRITISCH: die eigenen Endpunkte stehen benannt in der Ausnahmeliste',
  /'meine_spesen\.php'/.test(PHPTEST) && /'meine_spesen_beleg\.php'/.test(PHPTEST));
check('KRITISCH: die Verwaltungs-Endpunkte stehen NICHT in der Ausnahmeliste',
  !/'spesen_list\.php'/.test(PHPTEST) && !/'spesen_entscheiden\.php'/.test(PHPTEST)
  && !/'spesen_beleg\.php'/.test(PHPTEST));
check('KRITISCH: alle drei Verwaltungs-Endpunkte pruefen dasselbe Recht',
  [LISTE, ENTSCHEIDEN, BELEG].every(q => /require_recht\(\$user,\s*'personal_schreiben'\)/.test(q)));
// Die eigene Person kommt aus der SITZUNG, nie aus dem Rumpf -- sonst
// koennte jemand fremde Belege lesen, indem er eine andere id schickt.
check('KRITISCH: die eigenen Endpunkte binden jede Abfrage an die Sitzung',
  [MEINE, MEIN_BELEG].every(q => /\$ich = \(int\)\$user\['id'\]/.test(q)
    && /mitarbeiter_id = \?/.test(q)));
check('KRITISCH: der eigene Belegabruf filtert schon in der Abfrage auf die eigene Person',
  /WHERE id = \? AND mitarbeiter_id = \?/.test(MEIN_BELEG));
// Ein Beleg im Zustand 'erfasst' liegt noch in der Mappe der Person -- die
// Verwaltung bekommt ihn nicht zu sehen, auch nicht mit Recht.
// Der Ausschluss steht einmal in doppelten und einmal in einfachen
// Anfuehrungszeichen (dort mit Gegenschraegstrich) -- geprueft wird die
// Aussage, nicht die Schreibweise.
const ohneErfasst = q => /status\s*<>\s*\\?'erfasst\\?'/.test(q);
check('KRITISCH: die Verwaltung sieht keine Belege, die noch nicht eingereicht sind',
  ohneErfasst(BELEG) && ohneErfasst(LISTE));

// Der Deploy kopiert nur namentlich gelistete Dateien aus backend/ --
// api/*.php geht per Platzhalter, backend/spesen.php nicht.
check('KRITISCH: backend/spesen.php steht in der Deploy-Liste',
  /cp backend\/spesen\.php dist\/spesen\.php/.test(DEPLOY));

// Die Abgrenzung aus OP-392, hier als Aussage ueber den Code: In der
// Spesen-Ablage wird NICHTS gerechnet. Taucht hier je eine Zonenschwelle
// oder ein Frankensatz auf, ist aus der Quittungsablage eine GAV-
// Abrechnung geworden.
check('KRITISCH: die Spesen-Ablage rechnet keine GAV-Betraege (OP-392)',
  !/gav|zone|fahrzeit|fahrkosten|pauschal/i.test(
    KERN.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')));
check('Der Auslagenersatz bleibt eine eigene Sache mit eigenem Rechenkern',
  readFileSync(`${WURZEL}/backend/auslagen.php`, 'utf8').includes('auslagen_zeile'));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 3 — Mitarbeiter-App (390 px)
// ══════════════════════════════════════════════════════════════════════════
const BELEGE = [
  { id: 5, datum: T(26), kategorie: 'tanken', betrag_rappen: 8540, notiz: 'Dieselbetankung',
    status: 'erfasst', hat_beleg: true, beleg_ist_pdf: false, ablehnung_grund: null, entschieden_am: null },
  { id: 4, datum: T(22), kategorie: 'einkauf', betrag_rappen: 2390, notiz: null,
    status: 'eingereicht', hat_beleg: true, beleg_ist_pdf: true, ablehnung_grund: null, entschieden_am: null },
  { id: 3, datum: T(18), kategorie: 'parkgebuehr', betrag_rappen: 500, notiz: null,
    status: 'freigegeben', hat_beleg: false, beleg_ist_pdf: false, ablehnung_grund: null, entschieden_am: T(19) },
  { id: 2, datum: T(12), kategorie: 'sonstiges', betrag_rappen: 12000, notiz: 'Werkzeug',
    status: 'abgelehnt', hat_beleg: false, beleg_ist_pdf: false,
    ablehnung_grund: 'Bitte über den Materialantrag laufen lassen.', entschieden_am: T(13) },
];
const KATEGORIEN = { tanken: 'Tanken', einkauf: 'Geschäftlicher Einkauf',
  parkgebuehr: 'Parkgebühr', sonstiges: 'Sonstiges' };

const browser = await chromium.launch({ executablePath: EXE });

// Was der Browser beim Speichern tatsaechlich abschickt -- daran haengt die
// Rappen-Pruefung weiter unten.
let letzterRumpf = null;

async function appStarten(antwort) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => bad.push('JS-Fehler (App): ' + e.message));
  await page.route('**/api/**', route => {
    const p = route.request().url().split('/api/')[1].split('?')[0];
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'dario.beispiel', ist_admin: false });
    if (p.includes('mein_profil')) return send({ status: 'ok', monat: { anzahl: 0, stunden: 0 },
      profil: { name: 'dario.beispiel', ist_admin: false, vorname: 'Dario', nachname: 'Beispiel' } });
    if (p === 'meine_spesen.php') {
      if (route.request().method() === 'POST') {
        letzterRumpf = JSON.parse(route.request().postData() || '{}');
        return send({ status: 'ok', id: 9 });
      }
      return send(antwort);
    }
    if (p.includes('meine_schichten')) return send({ status: 'ok', schichten: [] });
    if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
    return send({ status: 'ok' });
  });
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'dario.beispiel');
  await page.fill('#gPass', 'x');
  await page.click('#gBtn');
  await page.waitForSelector('#app.on');
  await page.waitForTimeout(400);
  await page.click('#t-menu');
  await page.waitForTimeout(300);
  await page.click('#mk-spesen');
  await page.waitForTimeout(500);
  return page;
}

// ── Drei Zustaende, drei Texte ────────────────────────────────────────────
// Der Kern der CLAUDE.md-Regel: "nicht eingerichtet" darf nie wie "keine
// Belege" aussehen. Geprueft wird, dass die Texte sich UNTERSCHEIDEN --
// nicht, wie sie lauten.
// Verglichen wird ausschliesslich der LEERTEXT (.leer), nicht der ganze
// Container: Der traegt im einen Fall zusaetzlich den Knopf „Beleg
// erfassen" und unterscheidet sich damit auch dann, wenn beide Meldungen
// wortgleich sind. Genau daran ist diese Pruefung in der Gegenprobe
// zuerst vorbeigelaufen.
const leertext = async seite => (await seite.evaluate(() => {
  const el = document.querySelector('#spesenInhalt .leer');
  return el ? el.textContent : '';
})).replace(/\s+/g, ' ').trim();

let p = await appStarten({ status: 'ok', eingerichtet: false, spesen: [] });
const textNichtEingerichtet = await leertext(p);
check('Bei fehlender Einrichtung sagt die Seite das', textNichtEingerichtet.length > 0);
check('Und bietet dann nicht an, einen Beleg zu erfassen',
  !(await p.isVisible('#spesenInhalt .btn-primary')));
await p.close();

p = await appStarten({ status: 'ok', eingerichtet: true, kategorien: KATEGORIEN, spesen: [] });
const textLeer = await leertext(p);
check('KRITISCH: „nicht eingerichtet" und „noch keine Belege" sind verschiedene Texte',
  textLeer.length > 0 && textNichtEingerichtet !== textLeer);
check('Ohne Belege laesst sich trotzdem einer erfassen',
  await p.isVisible('#spesenInhalt .btn-primary'));

// ── Der Betrag geht in Rappen ─────────────────────────────────────────────
await p.click('#spesenInhalt .btn-primary');
await p.waitForTimeout(300);
check('Das Formular oeffnet sich', await p.isVisible('#spBetrag'));
// Eingabefelder mindestens 16 px, sonst zoomt iOS hinein und bleibt dort
// (CLAUDE.md). Gemessen am gerenderten Zustand, nicht im Quelltext gelesen.
const zuKleineSchrift = await p.evaluate(() =>
  ['spDatum', 'spKategorie', 'spBetrag', 'spNotiz']
    .filter(id => parseFloat(getComputedStyle(document.getElementById(id)).fontSize) < 16));
check(`Die Eingabefelder tragen mindestens 16 px Schrift (${zuKleineSchrift.join(', ') || 'alle ok'})`,
  zuKleineSchrift.length === 0);

await p.fill('#spBetrag', '12.50');
await p.fill('#spNotiz', 'Tankstelle A1');
await p.selectOption('#spKategorie', 'tanken');
await p.fill('#spDatum', T(20));
letzterRumpf = null;
await p.click('#blFuss .btn-primary');
await p.waitForTimeout(400);
check('KRITISCH: 12.50 Franken gehen als 1250 Rappen zum Server',
  letzterRumpf && letzterRumpf.betrag_rappen === 1250);
check('Datum, Kategorie und Notiz gehen unveraendert mit',
  letzterRumpf && letzterRumpf.datum === T(20)
  && letzterRumpf.kategorie === 'tanken' && letzterRumpf.notiz === 'Tankstelle A1');

// Das Komma ist auf einer Schweizer Tastatur so schnell getippt wie der
// Punkt -- ein Betrag, der deswegen als 0 ankommt, faellt erst spaeter auf.
await p.click('#spesenInhalt .btn-primary');
await p.waitForTimeout(300);
await p.fill('#spBetrag', '7,25');
letzterRumpf = null;
await p.click('#blFuss .btn-primary');
await p.waitForTimeout(400);
check('KRITISCH: ein Komma statt eines Punktes ergibt denselben Betrag',
  letzterRumpf && letzterRumpf.betrag_rappen === 725);

// Ohne Betrag darf nichts abgeschickt werden -- ein Beleg ohne Zahl liesse
// sich nicht summieren.
await p.click('#spesenInhalt .btn-primary');
await p.waitForTimeout(300);
await p.fill('#spBetrag', '');
letzterRumpf = null;
await p.click('#blFuss .btn-primary');
await p.waitForTimeout(400);
check('KRITISCH: ohne Betrag wird nichts gespeichert', letzterRumpf === null);
await p.close();

// ── Die Liste ─────────────────────────────────────────────────────────────
p = await appStarten({ status: 'ok', eingerichtet: true, kategorien: KATEGORIEN, spesen: BELEGE });
const karten = await p.evaluate(() => [...document.querySelectorAll('#spesenInhalt .karte')]
  .map(k => k.textContent.replace(/\s+/g, ' ').trim()));
check(`Je Beleg eine Karte (${karten.length})`, karten.length === 4);
check('KRITISCH: der Betrag steht in Franken mit zwei Nachkommastellen da',
  /85\.40/.test(karten[0]) && /23\.90/.test(karten[1]) && /5\.00/.test(karten[2]));
check('Datum und Kategorie stehen bei jedem Beleg',
  /26\.03\.2026/.test(karten[0]) && /Tanken/.test(karten[0])
  && /Geschäftlicher Einkauf/.test(karten[1]));
check('Der Ablehnungsgrund steht beim abgelehnten Beleg',
  /Materialantrag/.test(karten[3]));
// Ein erfasster Beleg ist NICHT eingereicht -- ohne diesen Satz wartet man
// auf eine Antwort, die niemand geben kann.
check('KRITISCH: ein erfasster Beleg sagt, dass er noch bei einem selbst liegt',
  /noch nicht eingereicht/i.test(karten[0]));
check('Ein Beleg ohne Datei sagt das ausdruecklich, statt die Zeile wegzulassen',
  /kein beleg/i.test(karten[2]));

// Die Handlungen haengen am Zustand: einreichen nur, was erfasst ist;
// zurueckziehen nur, was eingereicht ist; an entschiedenem nichts.
const tasten = await p.evaluate(() => [...document.querySelectorAll('#spesenInhalt .karte')]
  .map(k => [...k.querySelectorAll('.btn')].map(b => b.textContent.trim())));
check('KRITISCH: nur der erfasste Beleg laesst sich einreichen',
  tasten[0].some(t => /Einreichen/.test(t))
  && !tasten[1].some(t => /Einreichen/.test(t))
  && !tasten[2].some(t => /Einreichen/.test(t)));
check('KRITISCH: nur der eingereichte Beleg laesst sich zurueckziehen',
  tasten[1].some(t => /Zurückziehen/.test(t))
  && !tasten[0].some(t => /Zurückziehen/.test(t)));
check('KRITISCH: ein entschiedener Beleg bietet weder Aendern noch Loeschen',
  !tasten[2].some(t => /Ändern|Löschen/.test(t))
  && !tasten[3].some(t => /Ändern|Löschen/.test(t)));
check('Ein Beleg mit Datei laesst sich ansehen, einer ohne nicht',
  tasten[0].some(t => /ansehen/i.test(t)) && !tasten[2].some(t => /ansehen/i.test(t)));

// Bedienelemente mindestens 44 px (CLAUDE.md), am gerenderten Zustand
// gemessen.
const zuFlach = await p.evaluate(() =>
  [...document.querySelectorAll('#spesenInhalt .btn')]
    .filter(b => b.getBoundingClientRect().height < 43.9).length);
check('Die Knoepfe der Spesenseite sind mindestens 44 px hoch', zuFlach === 0);

// Einreichen schickt wirklich etwas ab -- und zwar zu dem Beleg, auf dem
// der Knopf steht.
letzterRumpf = null;
await p.evaluate(() => {
  const b = [...document.querySelectorAll('#spesenInhalt .karte')][0]
    .querySelector('.btn-primary');
  b.click();
});
await p.waitForTimeout(400);
check('KRITISCH: „Einreichen" schickt genau diesen Beleg ab',
  letzterRumpf && letzterRumpf.einreichen === true && letzterRumpf.id === 5);
await p.close();

// ══════════════════════════════════════════════════════════════════════════
// TEIL 4 — Cockpit (1440 px)
// ══════════════════════════════════════════════════════════════════════════
const COCKPIT_BELEGE = BELEGE.filter(b => b.status !== 'erfasst').map(b => ({
  ...b, mitarbeiter_id: 7, person: 'Dario Beispiel',
}));

let cockpitRumpf = null;
async function cockpitStarten(spesenAntwort) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => bad.push('JS-Fehler (Cockpit): ' + e.message));
  await page.route('**/api/**', route => {
    const u = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'verwaltung.beispiel', ist_admin: true });
    if (u.includes('me.php')) return send({ status: 'ok', name: 'verwaltung.beispiel', ist_admin: true, rollen: [],
      rechte: ['plan', 'kunden', 'abgleich', 'personal_lesen', 'personal_schreiben', 'betrieb'] });
    if (u.includes('spesen_entscheiden')) {
      cockpitRumpf = JSON.parse(route.request().postData() || '{}');
      return send({ status: 'ok', id: cockpitRumpf.id, neuer_status: cockpitRumpf.status });
    }
    if (u.includes('spesen_list')) return send(spesenAntwort);
    return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [],
      letzte_rapporte: [], rapporte: [], kunden: [], belege: [], produkte: [], feiertage: [],
      gepflegt: {}, orte: [], mitarbeiter: [], einsaetze: [], objekte: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on');
  await page.waitForTimeout(600);
  await page.evaluate(() => go('spesen'));
  await page.waitForTimeout(600);
  return page;
}

let d = await cockpitStarten({ status: 'ok', eingerichtet: true, kategorien: KATEGORIEN,
  spesen: COCKPIT_BELEGE });

check('KRITISCH: die Spesenansicht ist im Cockpit erreichbar',
  await d.isVisible('#view-spesen'));
check('Der Navigationspunkt steht unter Auswertung, neben dem Auslagenersatz',
  await d.evaluate(() => !!document.querySelector('#navg-kontrolle #nav-kontrolle-spesen')));
// Die beiden duerfen nie dasselbe heissen -- der eine ist eine
// GAV-Berechnung, der andere eine Quittungsablage (OP-392).
check('KRITISCH: „Spesen" und „Auslagenersatz" bleiben zwei verschiedene Punkte',
  await d.evaluate(() => {
    const a = document.getElementById('nav-kontrolle-spesen');
    const b = document.getElementById('nav-kontrolle-auslagen');
    return !!a && !!b && a.textContent.trim() !== b.textContent.trim();
  }));

const zeilen = await d.evaluate(() => [...document.querySelectorAll('#spTable tbody tr')]
  .map(r => r.textContent.replace(/\s+/g, ' ').trim()));
check(`Je eingereichtem Beleg eine Zeile (${zeilen.length})`, zeilen.length === 3);
check('Person, Betrag und Kategorie stehen in der Zeile',
  /Dario Beispiel/.test(zeilen[0]) && /23\.90/.test(zeilen[0]) && /Einkauf/.test(zeilen[0]));

// Eine gefilterte Zahl allein sieht aus wie die Gesamtzahl (CLAUDE.md) --
// die Summe muss sagen, worauf sie sich bezieht.
const summe = (await d.textContent('#spSumme')).replace(/\s+/g, ' ').trim();
check('KRITISCH: die Summe nennt Anzahl und Betrag, nicht nur eine Zahl',
  /3/.test(summe) && /148\.90/.test(summe));

const cTasten = await d.evaluate(() => [...document.querySelectorAll('#spTable tbody tr')]
  .map(r => [...r.querySelectorAll('.btn')].map(b => b.textContent.trim())));
check('KRITISCH: nur ein eingereichter Beleg laesst sich entscheiden',
  cTasten[0].some(t => /Freigeben/.test(t))
  && !cTasten[1].some(t => /Freigeben/.test(t))
  && !cTasten[2].some(t => /Freigeben/.test(t)));

cockpitRumpf = null;
await d.evaluate(() => {
  const b = [...document.querySelectorAll('#spTable tbody tr')][0]
    .querySelector('.btn-primary');
  b.click();
});
await d.waitForTimeout(400);
check('KRITISCH: „Freigeben" schickt genau diesen Beleg mit dem richtigen Status',
  cockpitRumpf && cockpitRumpf.id === 4 && cockpitRumpf.status === 'freigegeben');

// Eine Ablehnung ohne Begruendung darf nicht durchgehen -- weder hier noch
// am Server. Geprueft wird die Oberflaeche: ein leerer prompt() sendet nicht.
//
// Der Knopf wird ueber seine AUFSCHRIFT gesucht und nicht ueber seine
// Stelle in der Zeile: Die Zeile traegt je nach Beleg noch einen Knopf zum
// Oeffnen der Datei, und eine Pruefung, die auf Position 1 zeigt, klickt
// dann still auf "Freigeben" und behauptet trotzdem, sie habe abgelehnt.
const ablehnenKlicken = () => d.evaluate(() => {
  const b = [...document.querySelectorAll('#spTable tbody tr')][0]
    .querySelectorAll('.btn');
  const ziel = [...b].find(x => /Ablehnen/.test(x.textContent));
  if (ziel) { ziel.click(); return true; }
  return false;
});

cockpitRumpf = null;
await d.evaluate(() => { window.prompt = () => '   '; });
check('Die Zeile traegt ueberhaupt einen Ablehnen-Knopf', await ablehnenKlicken());
await d.waitForTimeout(300);
check('KRITISCH: eine Ablehnung ohne Begruendung wird nicht abgeschickt', cockpitRumpf === null);

cockpitRumpf = null;
await d.evaluate(() => { window.prompt = () => 'Bitte über den Materialantrag.'; });
await ablehnenKlicken();
await d.waitForTimeout(400);
check('Mit Begruendung geht die Ablehnung samt Text hinaus',
  cockpitRumpf && cockpitRumpf.status === 'abgelehnt'
  && /Materialantrag/.test(cockpitRumpf.ablehnung_grund || ''));
await d.close();

// Drei Zustaende, drei Texte -- auch im Cockpit.
d = await cockpitStarten({ status: 'ok', eingerichtet: false, spesen: [] });
const cNichtEingerichtet = (await d.textContent('#spTable')).replace(/\s+/g, ' ').trim();
await d.close();
d = await cockpitStarten({ status: 'ok', eingerichtet: true, kategorien: KATEGORIEN, spesen: [] });
const cLeer = (await d.textContent('#spTable')).replace(/\s+/g, ' ').trim();
check('KRITISCH: auch im Cockpit sind „nicht eingerichtet" und „nichts offen" verschieden',
  cNichtEingerichtet !== cLeer && cNichtEingerichtet.length > 0 && cLeer.length > 0);
check('Ohne offene Belege steht keine Summe da, die wie null Franken aussieht',
  (await d.textContent('#spSumme')).trim() === '');
await d.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
