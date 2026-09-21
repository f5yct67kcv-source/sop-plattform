<?php
// Die Sparte "Reinigung" gibt es nur bei CUPI 24 (ENT-650) -- wirklich
// ausgefuehrt, nicht im Quelltext nachgelesen.
//
// WARUM DIESE REIHE: Fuer die Reinigung gilt nicht der GAV der privaten
// Sicherheitsdienstleistungen, sondern ein eigener, bislang ungepruefter
// Gesamtarbeitsvertrag. Das Regelwerk in 90-gav/ deckt ihn nicht ab. Bote
// die Anlage einem fremden Mandanten -- einem Demo-Platz oder einem
// kuenftigen echten Kunden -- diese Sparte an, wuerde sie dessen Leute
// nach dem falschen Vertrag abrechnen. Das ist kein Anzeigefehler, das ist
// ein Lohnfehler.
//
// SPARTE_REINIGUNG ist eine PHP-Konstante (beim Deploy gesetzt) und laesst
// sich nach der Definition nicht mehr aendern -- ein Test kaeme an
// reinigung_angeboten() selbst also nur an EINEM Zustand vorbei (hier
// immer der unersetzte Platzhalter, weil diese Suite nie ueber den
// Deploy-Workflow laeuft). Darum wird die Entscheidungsregel als eigene,
// reine Funktion sparte_reinigung_frei(string $wert) mit frei gewaehlten
// Werten geprueft -- genau wie umgebung_ist_produktion() in
// pruef_staging.php und aus demselben Grund.
//
// GEGENPROBE (CLAUDE.md: "den behobenen Fehler absichtlich wieder
// einbauen"): sparte_pruefen() wird gegen BEIDE Zustaende gefahren, den
// erlaubten und den gesperrten -- nicht nur gegen den, der in dieser
// Umgebung zufaellig gilt. Die Zustandsumschaltung geschieht ueber
// sparten_erlaubt(), das in einem eigenen Unterprozess mit gesetzter
// Konstante laeuft (siehe unten). Ohne diesen zweiten Lauf bliebe die
// Reihe gruen, auch wenn die Sperre gar nicht greift.
declare(strict_types=1);

$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// ── Unterprozess mit frei gesetzter Konstante ─────────────────────────
//
// db.php selbst laesst sich hier nicht laden: es definiert SPARTE_REINIGUNG
// fest auf den Platzhalter und setzt beim Laden Kopfzeilen. Geprueft wird
// darum planung.php -- die Datei, in der sparte_pruefen() wirklich steht --
// zusammen mit einer nachgebauten reinigung_angeboten(). Genau diesen
// Vertrag ("function_exists, sonst nur Sicherheit") beschreibt planung.php.
function sparten_lauf(?bool $angeboten, string $wert, string $vorgabe = 'sicherheit'): string
{
    $wurzel = __DIR__ . '/../backend/planung.php';
    $stub = $angeboten === null ? ''
        : 'function reinigung_angeboten(): bool { return ' . ($angeboten ? 'true' : 'false') . '; }';
    $code = '<?php ' . $stub
        . ' require ' . var_export($wurzel, true) . ';'
        . ' echo sparte_pruefen(' . var_export($wert, true) . ', ' . var_export($vorgabe, true) . ');';
    $datei = tempnam(sys_get_temp_dir(), 'sparte') . '.php';
    file_put_contents($datei, $code);
    $aus = shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($datei) . ' 2>&1');
    unlink($datei);
    return trim((string)$aus);
}

function sparten_liste(?bool $angeboten): array
{
    $wurzel = __DIR__ . '/../backend/planung.php';
    $stub = $angeboten === null ? ''
        : 'function reinigung_angeboten(): bool { return ' . ($angeboten ? 'true' : 'false') . '; }';
    $code = '<?php ' . $stub . ' require ' . var_export($wurzel, true) . ';'
        . ' echo implode(",", sparten_erlaubt());';
    $datei = tempnam(sys_get_temp_dir(), 'sparte') . '.php';
    file_put_contents($datei, $code);
    $aus = trim((string)shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($datei) . ' 2>&1'));
    unlink($datei);
    return $aus === '' ? [] : explode(',', $aus);
}

// ── Die Entscheidungsregel selbst, mit frei gewaehlten Werten ─────────
require __DIR__ . '/../backend/db.php';

check('KRITISCH: der exakte Wert "1" gibt die Reinigung frei',
    sparte_reinigung_frei('1'));
check('KRITISCH: "0" gibt sie NICHT frei',
    !sparte_reinigung_frei('0'));
check('KRITISCH: ein leerer Wert gibt sie NICHT frei (sichere Richtung)',
    !sparte_reinigung_frei(''));
check('KRITISCH: der unersetzte Platzhalter selbst gibt sie NICHT frei',
    !sparte_reinigung_frei('__SPARTE_REINIGUNG__'));
check('KRITISCH: ein wohlmeinendes "true" gibt sie NICHT frei -- nur der eine Wert zaehlt',
    !sparte_reinigung_frei('true'));
check('KRITISCH: ein wohlmeinendes "ja" gibt sie NICHT frei',
    !sparte_reinigung_frei('ja'));
check('"cupi24" allein genuegt nicht -- der Wert ist ein Schalter, kein Name',
    !sparte_reinigung_frei('cupi24'));

// ── Gesperrter Zustand: Reinigung faellt auf Sicherheit zurueck ───────
check('KRITISCH: gesperrt wird "reinigung" zu "sicherheit"',
    sparten_lauf(false, 'reinigung') === 'sicherheit');
check('KRITISCH: auch in Grossschreibung -- kein Schlupfloch ueber die Schreibweise',
    sparten_lauf(false, 'REINIGUNG') === 'sicherheit');
check('KRITISCH: gesperrt kennt sparten_erlaubt() nur Sicherheit',
    sparten_liste(false) === ['sicherheit']);
check('KRITISCH: eine Vorgabe "reinigung" traegt den alten Wert NICHT weiter',
    sparten_lauf(false, '', 'reinigung') === 'sicherheit');
check('Sicherheit bleibt im gesperrten Zustand unveraendert erlaubt',
    sparten_lauf(false, 'sicherheit') === 'sicherheit');

// ── Fehlt db.php ganz, gilt ebenfalls nur Sicherheit ──────────────────
check('KRITISCH: ohne reinigung_angeboten() gilt nur Sicherheit (fail-safe)',
    sparten_liste(null) === ['sicherheit']);
check('KRITISCH: ohne reinigung_angeboten() wird "reinigung" zu "sicherheit"',
    sparten_lauf(null, 'reinigung') === 'sicherheit');

// ── GEGENPROBE: freigegebener Zustand ─────────────────────────────────
//
// Ohne diese vier Faelle waere die ganze Reihe wertlos: Eine Funktion, die
// IMMER "sicherheit" zurueckgibt, bestuende alle Pruefungen oben -- und
// CUPI 24 haette still seine Sparte verloren.
check('GEGENPROBE: freigegeben bleibt "reinigung" erhalten',
    sparten_lauf(true, 'reinigung') === 'reinigung');
check('GEGENPROBE: freigegeben kennt sparten_erlaubt() beide Sparten',
    sparten_liste(true) === ['sicherheit', 'reinigung']);
check('GEGENPROBE: freigegeben traegt auch die Vorgabe "reinigung"',
    sparten_lauf(true, '', 'reinigung') === 'reinigung');
check('GEGENPROBE: freigegeben bleibt Gross-/Kleinschreibung egal',
    sparten_lauf(true, 'Reinigung') === 'reinigung');

// ── Unbekannte Werte verhalten sich in BEIDEN Zustaenden gleich ───────
check('Ein unbekannter Wert wird freigegeben zu "sicherheit"',
    sparten_lauf(true, 'bewachung') === 'sicherheit');
check('Ein unbekannter Wert wird gesperrt zu "sicherheit"',
    sparten_lauf(false, 'bewachung') === 'sicherheit');
check('KRITISCH: ein Teilwort greift nicht -- "reinigungsdienst" ist keine Sparte',
    sparten_lauf(true, 'reinigungsdienst') === 'sicherheit');

echo "\n" . $ok . ' bestanden, ' . count($bad) . " nicht bestanden\n";
if ($bad) { foreach ($bad as $b) { echo '  x ' . $b . "\n"; } exit(1); }
echo "Alle Pruefungen bestanden.\n";
