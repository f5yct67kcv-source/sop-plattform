// betreiber_demo_nutzung.php (ENT-653) durchbricht bewusst die sonst
// geltende Regel "kein Zugriff auf eine Mandanten-Instanz ohne deren
// Freigabe" (siehe betreiber_support.php/ENT-526). Das ist nur vertretbar,
// weil dieser eine Endpunkt selbst zusaetzlich JEDEN Mandanten abweist, der
// kein Demo-Platz ist -- eine zweite, unabhaengige Absicherung neben der
// serverseitigen Schreibsperre in demo_nutzung_melden.php. Diese Datei
// prueft GENAU diese zweite Absicherung gegen den echten Quelltext:
// vorhanden, vor der Verbindung zum Mandanten, nicht nur als Kommentar.
import { WURZEL } from './pfade.mjs';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const endpunkt = readFileSync(`${WURZEL}/backend/api/betreiber_demo_nutzung.php`, 'utf8');

check('KRITISCH: der Endpunkt prueft die Mitgliedschaft in DEMO_PLAETZE',
  /in_array\(\(string\)\$m\['subdomain'\], DEMO_PLAETZE, true\)/.test(endpunkt));
check('KRITISCH: ein Nicht-Demo-Platz wird ausdruecklich abgewiesen (nicht nur uebersprungen)',
  /if \(!in_array\(\(string\)\$m\['subdomain'\], DEMO_PLAETZE, true\)\)\s*\{[\s\S]{0,300}json_response\(\['status' => 'error'/.test(endpunkt));

// Reihenfolge zaehlt: die Pruefung muss VOR mandant_db($m) stehen, sonst
// ist die Verbindung schon offen, bevor abgewiesen wird.
const iPruefung = endpunkt.indexOf('in_array((string)$m[\'subdomain\']');
const iVerbindung = endpunkt.indexOf('mandant_db($m)');
check('KRITISCH: die DEMO_PLAETZE-Pruefung steht VOR der Verbindung zum Mandanten',
  iPruefung > -1 && iVerbindung > -1 && iPruefung < iVerbindung);

// KEINE Support-Freigabe -- bewusst, aber der Verzicht muss im Code auch
// erklaert sein, nicht nur beschlossen. Nachgewiesen ueber den Verweis auf
// die Rueckfrage/Entscheidung, nicht ueber ein einzelnes Schlagwort.
check('KRITISCH: die bewusste Abweichung von der Freigabe-Regel ist im Code begruendet (ENT-653)',
  /ENT-653/.test(endpunkt) && /ohne Support-Freigabe|OHNE SUPPORT-FREIGABE/i.test(endpunkt));
check('KRITISCH: kein support_freigabe_gueltig()-Aufruf -- der Verzicht ist absichtlich, kein Rest',
  !/support_freigabe_gueltig\(/.test(endpunkt));

// Die Erlaubnisliste in test_betreiber.mjs muss den Endpunkt kennen --
// gegen den echten Quelltext dieser Testdatei geprueft, nicht behauptet.
const testBetreiber = readFileSync(`${WURZEL}/pruefungen/test_betreiber.mjs`, 'utf8');
check('KRITISCH: betreiber_demo_nutzung.php steht in DARF_VERBINDEN (test_betreiber.mjs)',
  /'betreiber_demo_nutzung\.php':\s*'/.test(testBetreiber));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
