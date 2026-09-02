// Speicherung und Anzeige der Bewegungsspur (ENT-318, Schritt 2 zu ENT-317).
//
// Vom Projektinhaber beauftragt: "ja, Schritt 2 bauen mit Speicherung."
//
// Das ist der heikelste Datenbestand des ganzen Werkzeugs -- er zeigt, wo
// sich ein echter Mitarbeitender wann aufgehalten hat. Diese Suite prueft
// darum nicht nur, DASS gespeichert wird, sondern vor allem die Grenzen:
//   - keine Spur ausserhalb einer laufenden Runde, serverseitig durchgesetzt
//   - gedrosselt, damit nicht mehr anfaellt als noetig
//   - Aufbewahrung begrenzt
//   - die Spur wird nicht nebenbei mitgeliefert, sondern nur auf Abruf
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const POS = readFileSync(`${WURZEL}/backend/api/mein_rundgang_position.php`, 'utf8');
const SPUR = readFileSync(`${WURZEL}/backend/api/rundgang_spur.php`, 'utf8');
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const RG = readFileSync(`${WURZEL}/backend/rundgang.php`, 'utf8');
const LISTE = readFileSync(`${WURZEL}/backend/api/rundgang_scan_liste.php`, 'utf8');
const APP = readFileSync(`${WURZEL}/app.html`, 'utf8');
const DASH = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');

// ══════════ DATENMODELL ═══════════════════════════════════════════════
check('KRITISCH: es gibt eine eigene Tabelle für die Spur',
  /CREATE TABLE rundgang_position/.test(EINR));
// Die Spur haengt am RUNDGANG, nicht am Mitarbeitenden -- es soll keine
// Spur ausserhalb einer Runde geben koennen.
check('KRITISCH: die Spur hängt am Rundgang und verschwindet mit ihm',
  /rundgang_id INT NOT NULL/.test(EINR)
  && /FOREIGN KEY \(rundgang_id\) REFERENCES rundgang\(id\) ON DELETE CASCADE[\s\S]{0,200}rundgang_position|rundgang_position[\s\S]{0,700}ON DELETE CASCADE/.test(EINR));
check('KRITISCH: die Genauigkeit wird mitgeschrieben — ohne sie sieht ungenau aus wie genau',
  /genauigkeit_m INT NULL/.test(EINR));
check('Geräte- und Serverzeit bleiben getrennt, wie bei den Scans (ENT-132)',
  /rundgang_position[\s\S]{0,600}erfasst_am DATETIME NOT NULL,\s*\n\s*uebermittelt_am/.test(EINR));

// ══════════ DER RIEGEL: KEINE SPUR AUSSERHALB EINER RUNDE ════════════
check('KRITISCH: nur die EIGENE Runde — mitarbeiter_id kommt aus der Sitzung',
  /WHERE id = \? AND mitarbeiter_id = \?/.test(POS)
  && !/mitarbeiter_id.*\$input|\$input.*mitarbeiter_id/.test(POS));
// Die App stoppt die Ortung selbst -- aber ein Geraet darf nicht die
// einzige Instanz sein, die das durchsetzt.
check('KRITISCH: der Server weist Positionen auf einer beendeten Runde ab',
  /\$rundgang\['status'\] !== 'laeuft'/.test(POS)
  && /nicht_laufend/.test(POS));
check('KRITISCH: eine Anfrage kann den Server nicht mit Positionen überfluten',
  /count\(\$punkte\) > 500/.test(POS));
// 0/0 ist der Nullpunkt eines kaputten Sensors, nicht ein Ort in der Schweiz.
check('Unsinnige Koordinaten werden verworfen statt gespeichert',
  /\$lat === 0\.0 && \$lng === 0\.0/.test(POS)
  && /\$lat < -90 \|\| \$lat > 90/.test(POS));

// ══════════ AUFBEWAHRUNG ══════════════════════════════════════════════
check('KRITISCH: es gibt eine Aufbewahrungsgrenze, nicht "für immer"',
  /const RUNDGANG_SPUR_TAGE = \d+;/.test(RG));
check('KRITISCH: alte Spuren werden auch tatsächlich gelöscht',
  /DELETE FROM rundgang_position/.test(POS)
  && /RUNDGANG_SPUR_TAGE/.test(POS));
// Ein Loeschauftrag, den jemand von Hand starten muss, wird nie gestartet.
check('Das Aufräumen läuft von selbst mit, nicht auf Zuruf',
  POS.indexOf('DELETE FROM rundgang_position') > POS.indexOf('INSERT INTO rundgang_position'));
check('Ein Fehler beim Aufräumen lässt die Übermittlung nicht scheitern',
  /catch \(Throwable \$e\) \{[\s\S]{0,200}\}\s*\n\s*json_response\(\['status' => 'ok', 'gespeichert'/.test(POS));

// ══════════ DIE SPUR WIRD NICHT NEBENBEI MITGELIEFERT ═════════════════
check('KRITISCH: die Auswertung liefert die Spur NICHT mit — nur die Rundgang-Nummer',
  /r\.id AS rundgang_id/.test(LISTE) && !/rundgang_position/.test(LISTE));
check('Die Spur hat einen eigenen Endpunkt, der einzeln abgerufen wird',
  /rundgang_id = \?/.test(SPUR) && /ORDER BY p\.erfasst_am/.test(SPUR));
check('KRITISCH: der Spur-Endpunkt verlangt dasselbe Recht wie die Auswertung',
  /require_recht\(\$user, 'rundgang_einsehen'\)/.test(SPUR));
// "Noch nicht eingerichtet" und "es gibt keine Spur" sind verschiedene
// Aussagen -- die Oberflaeche muss sie unterscheiden koennen.
check('KRITISCH: "nicht eingerichtet" ist von "keine Spur vorhanden" unterscheidbar',
  /'eingerichtet' => false/.test(SPUR) && /'eingerichtet' => true/.test(SPUR)
  && /eingerichtet === false/.test(DASH));

// ══════════ DROSSELUNG (REINE FUNKTION) ══════════════════════════════
check('Die Drosselung steht als eigene Funktion da, prüfbar ohne Gerät',
  /function rgSpurNehmen/.test(APP));
check('KRITISCH: die App verwirft die Spur, wenn der Server sie dauerhaft nicht annimmt',
  /code === 'nicht_laufend' \|\| code === 'keine_tabelle'/.test(APP));
check('Eine Position kann keinen Scan blockieren — eigene Warteschlange',
  /const RD_POSITIONEN = /.test(APP)
  && /RD_POSITIONEN/.test(APP) && !/RD_WARTESCHLANGE[^\n]*RD_POSITIONEN/.test(APP));

const EXE = browserPfad();
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => route.fulfill({ status: 200,
  contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }));
await page.route('**maps.googleapis.com/**', route => route.abort());
await page.goto(`file://${WURZEL}/app.html`);
await page.waitForTimeout(300);

// Die Drosselung entscheidet, wie viele Aufenthaltsdaten ueberhaupt
// entstehen -- sie ist Datensparsamkeit in Zahlen, nicht nur Technik.
const d = await page.evaluate(() => {
  const t0 = 1000000;
  const p = (lat, lng, zeit, gen) => ({ lat, lng, zeit, genauigkeit: gen });
  return {
    ersterImmer: rgSpurNehmen(null, p(47.35, 7.9, t0, 8)),
    zuSchnell: rgSpurNehmen(p(47.35, 7.9, t0, 8), p(47.36, 7.9, t0 + 5000, 8)),
    zuNah: rgSpurNehmen(p(47.35, 7.9, t0, 8), p(47.350005, 7.9, t0 + 60000, 8)),
    weitGenug: rgSpurNehmen(p(47.35, 7.9, t0, 8), p(47.3505, 7.9, t0 + 60000, 8)),
    ungenau: rgSpurNehmen(p(47.35, 7.9, t0, 8), p(47.36, 7.9, t0 + 60000, 500)),
    kaputt: rgSpurNehmen(null, p(NaN, 7.9, t0, 8)),
    sekunden: RG_SPUR_SEKUNDEN, meter: RG_SPUR_METER,
  };
});
check('Der erste Punkt einer Runde wird immer aufgenommen', d.ersterImmer === true);
check('KRITISCH: zu kurz nach dem letzten Punkt wird NICHT aufgenommen', d.zuSchnell === false);
// Wer zwanzig Minuten an einem Tor steht, erzeugt EINEN Punkt, nicht achtzig.
check('KRITISCH: Stillstand erzeugt keine Punktwolke', d.zuNah === false);
check('Nach genug Zeit UND genug Bewegung wird aufgenommen', d.weitGenug === true);
check('KRITISCH: eine ungenaue Messung wird verworfen, statt Schärfe vorzutäuschen', d.ungenau === false);
check('Eine kaputte Messung wird verworfen', d.kaputt === false);
check('Die Drosselung ist mit nachvollziehbaren Werten gesetzt',
  d.sekunden >= 10 && d.sekunden <= 60 && d.meter >= 5 && d.meter <= 50);

// ══════════ DASHBOARD: DIE ANZEIGE ════════════════════════════════════
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.waitForTimeout(400);
// Seit ENT-322 ist das Spur-Fenster in die Rundgang-Detailansicht
// aufgegangen -- ein Fenster statt zwei, der Weg ist ein Teil dessen, was
// in der Runde geschah. Die Datensparsamkeit von ENT-318 bleibt: Er wird
// erst auf Knopfdruck geladen, nicht mit der Ansicht.
check('KRITISCH: es gibt ein Fenster, in dem der Weg gezeigt wird',
  await page.evaluate(() => !!document.getElementById('dlgRundgang')));
check('Das Fenster ist geschlossen, solange niemand es öffnet',
  await page.evaluate(() => !document.getElementById('dlgRundgang').classList.contains('on')));
check('KRITISCH: der Weg wird NICHT mit der Ansicht geladen, sondern erst auf Knopfdruck',
  /rgdWegHuelle[\s\S]{0,300}onclick="rgdWegZeigen\(\)"/.test(DASH)
  && /function rgdWegZeigen\(\)[\s\S]{0,400}rundgang_spur\.php/.test(DASH));
// Drei verschiedene Aussagen, drei verschiedene Texte -- sie sehen sonst
// alle gleich aus wie "es gibt nichts".
check('KRITISCH: "nicht eingerichtet", "kein Weg" und "Ladefehler" sind drei verschiedene Texte',
  /Wege werden noch nicht aufgezeichnet/.test(DASH)
  && /kein Weg aufgezeichnet/.test(DASH)
  && /Der Weg liess sich nicht laden/.test(DASH));
check('KRITISCH: die Genauigkeit wird ausgewiesen, nicht verschwiegen',
  /Genauigkeit im Schnitt/.test(DASH));
check('Die Aufbewahrungsfrist steht dort, wo die Spur angesehen wird',
  /aufbewahrt für 90 Tage/.test(DASH));
// Eine Linie allein sagt nicht, in welche Richtung gelaufen wurde.
check('Anfang und Ende sind markiert, nicht nur die Linie',
  /'Anfang: '/.test(DASH) && /'Ende: '/.test(DASH));
check('Beim Schliessen bleibt die Spur nicht im Speicher liegen',
  /function rgdZu\(\)[\s\S]{0,300}rgdKarte = null/.test(DASH));
await page.screenshot({ path: `${OUT}/spur-01-dashboard.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
