<?php
declare(strict_types=1);
// Ruft ein Endpunkt eine Funktion auf, BEVOR er die Datei laedt, in der sie
// steht? (Nachtrag zu ENT-612 und zur bestehenden pruef_ladepfad.php.)
//
// ANLASS, ein echter Fehlschlag am 2026-09-22: api/login.php rief
// ma_nur_menschen() in der Abfrage, mit der die Anmeldung beginnt -- und
// lud mitarbeiter.php erst sechzig Zeilen weiter unten, bei ma_stempel().
// PHP bricht dann mit "Call to undefined function" ab. Das ist keine
// PDOException, also blieb beim Anmeldenden nur "Unerwarteter
// Serverfehler". Auf JEDER Anlage, fuer JEDE Anmeldung.
//
// WARUM DIE BESTEHENDE PRUEFUNG DAS NICHT FAND: pruef_ladepfad.php laedt
// die ganze Kette eines Endpunkts und fragt danach, ob die Funktion
// existiert. Sie existierte -- nur eben zu spaet. Geprueft wird hier also
// nicht, OB der Ladepfad die Funktion kennt, sondern AB WANN.
//
// GEPRUEFT WIRD DIE AUSSAGE, nicht der Wortlaut: Verglichen werden
// Zeilennummern von Aufruf und require, ermittelt aus den PHP-Tokens. Eine
// Umbenennung, ein anderer Kommentar oder eine andere Schreibweise des
// require aendern daran nichts.
//
// NUR AUFRUFE AUF DER OBERSTEN EBENE. Was in einer Funktion des Endpunkts
// steht, laeuft erst, wenn sie gerufen wird -- die Zeilennummer sagt dort
// nichts ueber die Reihenfolge aus. Lieber diese Faelle auslassen als eine
// Warnung erzeugen, die man nach dem dritten Mal wegklickt.
require_once __DIR__ . '/ladepfad_aufrufe.php';

$wurzel = dirname(__DIR__);
$bestanden = 0;
$fehler = [];

// Alle Module unter backend/ (ohne die Endpunkte selbst).
$module = [];
foreach (glob($wurzel . '/backend/*.php') ?: [] as $datei) { $module[] = $datei; }

// Funktion -> Dateien, die sie definieren.
$wohnt = [];
foreach ($module as $datei) {
    foreach (ladepfad_definitionen($datei) as $f) { $wohnt[$f][] = $datei; }
}

// Welche Dateien zieht eine Datei nach -- ueber beliebig viele Stufen.
function kette_geschlossen(string $datei, array &$merker = []): array
{
    if (isset($merker[$datei])) { return $merker[$datei]; }
    $merker[$datei] = [$datei => true];   // Vorbelegt gegen Ringe
    $text = is_file($datei) ? (string)file_get_contents($datei) : '';
    preg_match_all('/require(?:_once)?\s+__DIR__\s*\.\s*[\'"]([^\'"]+)[\'"]/', $text, $t);
    $alles = [$datei => true];
    foreach ($t[1] as $ziel) {
        $pfad = realpath(dirname($datei) . '/' . $ziel);
        if ($pfad === false) { continue; }
        foreach (kette_geschlossen($pfad, $merker) as $p => $_) { $alles[$p] = true; }
    }
    $merker[$datei] = $alles;
    return $alles;
}

// Die requires eines Endpunkts MIT Zeilennummer, in Reihenfolge.
function requires_mit_zeile(string $pfad): array
{
    $tokens = token_get_all((string)file_get_contents($pfad));
    $anzahl = count($tokens);
    $treffer = [];
    for ($i = 0; $i < $anzahl; $i++) {
        if (!is_array($tokens[$i])
            || !in_array($tokens[$i][0], [T_REQUIRE, T_REQUIRE_ONCE], true)) { continue; }
        $zeile = (int)$tokens[$i][2];
        // Bis zum Semikolon einsammeln und den Dateinamen herausziehen.
        $roh = '';
        for ($j = $i + 1; $j < $anzahl && $tokens[$j] !== ';'; $j++) {
            $roh .= is_array($tokens[$j]) ? $tokens[$j][1] : $tokens[$j];
        }
        if (preg_match('/[\'"]([^\'"]+\.php)[\'"]/', $roh, $m)) {
            $ziel = realpath(dirname($pfad) . '/' . $m[1]);
            if ($ziel !== false) { $treffer[] = ['zeile' => $zeile, 'datei' => $ziel]; }
        }
    }
    return $treffer;
}

// Aufrufe auf der obersten Ebene, mit Zeilennummer.
function aufrufe_oberste_ebene(string $pfad): array
{
    $tokens = token_get_all((string)file_get_contents($pfad));
    $anzahl = count($tokens);
    $leer = [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT];
    $treffer = [];
    $tiefe = 0;
    $koerper = [];            // Klammertiefen, in denen ein Funktionsrumpf laeuft
    $wartetAufRumpf = false;  // zwischen "function" und seiner "{"
    for ($i = 0; $i < $anzahl; $i++) {
        $t = $tokens[$i];
        if (is_array($t) && in_array($t[0], [T_FUNCTION, T_FN], true)) { $wartetAufRumpf = true; }
        if ($t === '{') {
            $tiefe++;
            if ($wartetAufRumpf) { $koerper[] = $tiefe; $wartetAufRumpf = false; }
            continue;
        }
        if ($t === '}') {
            if ($koerper && end($koerper) === $tiefe) { array_pop($koerper); }
            $tiefe--;
            continue;
        }
        if ($koerper) { continue; }   // in einem Funktionsrumpf
        if (!is_array($t) || $t[0] !== T_STRING) { continue; }
        $j = $i + 1;
        while ($j < $anzahl && is_array($tokens[$j]) && in_array($tokens[$j][0], $leer, true)) { $j++; }
        if ($j >= $anzahl || $tokens[$j] !== '(') { continue; }
        $k = $i - 1;
        while ($k >= 0 && is_array($tokens[$k]) && in_array($tokens[$k][0], $leer, true)) { $k--; }
        if ($k >= 0 && is_array($tokens[$k])
            && in_array($tokens[$k][0], [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR,
                T_DOUBLE_COLON, T_FUNCTION, T_NEW, T_ATTRIBUTE], true)) { continue; }
        $name = strtolower((string)$t[1]);
        if (in_array($name, LADEPFAD_KONSTRUKTE, true)) { continue; }
        $treffer[] = ['zeile' => (int)$t[2], 'name' => $name];
    }
    return $treffer;
}

$merker = [];
foreach (glob($wurzel . '/backend/api/*.php') ?: [] as $pfad) {
    $rel = substr($pfad, strlen($wurzel) + 1);
    $eigene = array_flip(ladepfad_definitionen($pfad));
    $requires = requires_mit_zeile($pfad);
    $offen = [];

    foreach (aufrufe_oberste_ebene($pfad) as $auf) {
        if (isset($eigene[$auf['name']])) { continue; }
        if (!isset($wohnt[$auf['name']])) { continue; }   // kein Modul des Hauses
        $heimat = $wohnt[$auf['name']];

        // Ab welcher Zeile ist eine der Heimatdateien geladen?
        $ab = null;
        foreach ($requires as $r) {
            $geschlossen = kette_geschlossen($r['datei'], $merker);
            foreach ($heimat as $h) {
                if (isset($geschlossen[$h])) { $ab = $ab === null ? $r['zeile'] : min($ab, $r['zeile']); }
            }
        }
        // Gar nicht geladen: Das ist der Fall der bestehenden
        // pruef_ladepfad.php und wird dort mit dem echten Laden geprueft --
        // hier wuerde eine Textauswertung sonst ueber dynamische Pfade
        // stolpern und falschen Alarm schlagen.
        if ($ab === null) { continue; }
        if ($auf['zeile'] < $ab) {
            $offen[] = $auf['name'] . '() in Zeile ' . $auf['zeile']
                     . ', geladen erst ab Zeile ' . $ab;
        }
    }

    if ($offen) {
        $fehler[] = "$rel ruft auf, bevor geladen ist: " . implode('; ', array_unique($offen));
    } else {
        $bestanden++;
    }
}

echo "$bestanden bestanden\n";
foreach ($fehler as $f) { echo "x $f\n"; }
exit($fehler ? 1 : 0);
