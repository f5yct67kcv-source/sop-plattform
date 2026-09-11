<?php
// Statische Pruefung der PHP-Endpunkte.
//
// Anlass: Zwei Fehler standen produktiv im Werkzeug, die keine der
// Playwright-Suiten sehen konnte -- alle bilden die Schnittstelle nach,
// statt PHP auszufuehren. Beide waeren beim ersten echten Aufruf
// hochgegangen:
//   1. pensen.php rief hat_spalte() auf, ohne die Datei einzubinden, in der
//      sie definiert war  -> "Call to undefined function", Seite tot.
//   2. einsatz_zuteilen.php las $input, die Variable heisst dort aber $in
//      -> Umplanung entfernte niemanden mehr aus der alten Schicht.
//
// Geprueft wird darum genau das: Wird eine Funktion aufgerufen, die es im
// erreichbaren Code nicht gibt? Wird eine Variable gelesen, die in dieser
// Datei nie gesetzt wird?
declare(strict_types=1);
$WURZEL = __DIR__ . '/../backend';
$fehler = [];
$geprueft = 0;

// Welche Dateien bindet eine Datei ein? require __DIR__ . '/../db.php' usw.
function eingebunden(string $datei): array {
    $roh = file_get_contents($datei);
    $dir = dirname($datei);
    $treffer = [];
    if (preg_match_all('/require(?:_once)?\s+__DIR__\s*\.\s*[\'"]([^\'"]+)[\'"]/', $roh, $m)) {
        foreach ($m[1] as $rel) {
            $pfad = realpath($dir . $rel);
            if ($pfad) { $treffer[] = $pfad; }
        }
    }
    return $treffer;
}

// Alle erreichbaren Dateien, Einbindungen von Einbindungen eingeschlossen.
function erreichbar(string $datei, array $gesehen = []): array {
    $datei = realpath($datei);
    if (!$datei || isset($gesehen[$datei])) { return $gesehen; }
    $gesehen[$datei] = true;
    foreach (eingebunden($datei) as $w) { $gesehen = erreichbar($w, $gesehen); }
    return $gesehen;
}

/* Welche Konstanten kennt dieser Satz Dateien? Gesucht wird beides:
   "const NAME =" und "define('NAME'".

   Warum es das braucht: Eine Konstante, die in einem ANDEREN Endpunkt steht,
   ist von hier aus nicht erreichbar -- Endpunkte binden einander nie ein.
   PHP 8 wirft dafuer keinen Hinweis, sondern einen Error, und der kommt im
   Browser als "Unerwarteter Serverfehler" an, ohne zu sagen, woran es lag.

   Genau so ist es passiert (ENT-540): mein_ereignis_melden.php prueft die
   Fotogroesse gegen ERSATZSCAN_FOTO_MAX, definiert war die Konstante aber
   nur in mein_rundgang_scan.php. Die Zeile lief NUR, wenn ein Foto dabei
   war -- darum kamen Meldungen ohne Foto an und solche mit Foto nie. Ein
   Kommentar in fahrzeug.php behauptete sogar, sie stehe in rundgang.php;
   geglaubt hatte es also schon jemand. */
function konstanten_in(array $dateien): array {
    $namen = [];
    foreach ($dateien as $d => $_) {
        $roh = file_get_contents($d);
        if (preg_match_all('/\bconst\s+([A-Z_][A-Z0-9_]*)\s*=/', $roh, $m)) {
            foreach ($m[1] as $n) { $namen[$n] = true; }
        }
        if (preg_match_all('/\bdefine\s*\(\s*[\'"]([A-Z_][A-Z0-9_]*)[\'"]/', $roh, $m)) {
            foreach ($m[1] as $n) { $namen[$n] = true; }
        }
    }
    return $namen;
}

function funktionen_in(array $dateien): array {
    $namen = [];
    foreach ($dateien as $d => $_) {
        if (preg_match_all('/\bfunction\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/', file_get_contents($d), $m)) {
            foreach ($m[1] as $n) { $namen[strtolower($n)] = true; }
        }
    }
    return $namen;
}

$alleDateien = [];
foreach (array_merge(glob("$WURZEL/*.php"), glob("$WURZEL/api/*.php")) as $d) {
    $alleDateien[realpath($d)] = true;
}
$hauskonstanten = konstanten_in($alleDateien);

foreach (glob("$WURZEL/api/*.php") as $endpunkt) {
    $geprueft++;
    $dateien = erreichbar($endpunkt);
    $bekannt = funktionen_in($dateien);
    $erreichbareKonstanten = konstanten_in($dateien);
    $quelle = file_get_contents($endpunkt);

    // ── Aufrufe unbekannter Funktionen
    $marken = token_get_all($quelle);
    for ($i = 0; $i < count($marken); $i++) {
        $t = $marken[$i];
        if (!is_array($t) || $t[0] !== T_STRING) { continue; }
        // Nur echte Aufrufe: naechstes bedeutsames Zeichen ist "("
        $j = $i + 1;
        while ($j < count($marken) && is_array($marken[$j]) && $marken[$j][0] === T_WHITESPACE) { $j++; }
        if (!($j < count($marken) && $marken[$j] === '(')) { continue; }
        // Kein Methodenaufruf, keine Definition, kein new
        $k = $i - 1;
        while ($k >= 0 && is_array($marken[$k]) && $marken[$k][0] === T_WHITESPACE) { $k--; }
        if ($k >= 0) {
            $v = $marken[$k];
            if ($v === '->' || $v === '::' || (is_array($v) && in_array($v[0], [T_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION, T_NEW], true))) { continue; }
        }
        $name = strtolower($t[1]);
        if (isset($bekannt[$name]) || function_exists($name)) { continue; }
        if (in_array($name, ['array', 'list', 'isset', 'unset', 'empty', 'echo', 'print', 'exit', 'die',
                             'include', 'require', 'match', 'fn', 'static', 'int', 'string', 'float',
                             'bool', 'self', 'parent', 'catch', 'if', 'for', 'foreach', 'while', 'switch'], true)) { continue; }
        $fehler[] = sprintf('%s Zeile %d: Aufruf der unbekannten Funktion %s()',
            basename($endpunkt), $t[2], $t[1]);
    }

    // ── Konstanten des Hauses, die von hier aus nicht erreichbar sind
    $gemeldeteK = [];
    for ($i = 0; $i < count($marken); $i++) {
        $t = $marken[$i];
        if (!is_array($t) || $t[0] !== T_STRING) { continue; }
        $name = $t[1];
        if (!isset($hauskonstanten[$name]) || isset($erreichbareKonstanten[$name])) { continue; }
        if (isset($gemeldeteK[$name])) { continue; }
        // Kein Funktionsaufruf (naechstes Zeichen "(") und kein Klassen-
        // oder Objektzugriff -- beides waere etwas anderes als eine
        // Konstante, auch wenn der Name gleich geschrieben ist.
        $j = $i + 1;
        while ($j < count($marken) && is_array($marken[$j]) && $marken[$j][0] === T_WHITESPACE) { $j++; }
        if ($j < count($marken) && $marken[$j] === '(') { continue; }
        $k = $i - 1;
        while ($k >= 0 && is_array($marken[$k]) && $marken[$k][0] === T_WHITESPACE) { $k--; }
        if ($k >= 0) {
            $v = $marken[$k];
            if ($v === '->' || $v === '::'
                || (is_array($v) && in_array($v[0], [T_OBJECT_OPERATOR, T_DOUBLE_COLON, T_CONST], true))) { continue; }
        }
        $gemeldeteK[$name] = 1;
        $fehler[] = sprintf('%s Zeile %d: %s ist von hier nicht erreichbar '
            . '(im Haus definiert, aber nicht in einer eingebundenen Datei)',
            basename($endpunkt), $t[2], $name);
    }

    // ── Gelesene, aber nie gesetzte Variablen
    $gesetzt = ['_GET' => 1, '_POST' => 1, '_SERVER' => 1, '_FILES' => 1, '_ENV' => 1,
                'GLOBALS' => 1, '_SESSION' => 1, '_COOKIE' => 1, '_REQUEST' => 1, 'this' => 1];
    // Zuweisungen, foreach-Ziele, catch-Variablen, Funktionsparameter
    foreach ([
        '/\$([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=[^=]|\+\+|--|\[[^\]]*\]\s*=[^=])/',
        '/\bas\s+\$([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=>\s*\$([a-zA-Z_][a-zA-Z0-9_]*))?/',
        '/\bcatch\s*\([^)]*\$([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/',
        '/\bfunction\s*[a-zA-Z0-9_]*\s*\(([^)]*)\)/',
        '/\bfn\s*\(([^)]*)\)/',
        '/\buse\s*\(([^)]*)\)/',
        '/\blist\s*\(([^)]*)\)/',
        // Zerlegende Zuweisung: [$a, $b] = ... und foreach (... as [$a, $b])
        // Ohne diese beiden meldete die Pruefung eigenen, richtigen Code als
        // Fehler -- ein Fehlalarm ist nicht harmlos: Wer ihn zweimal sieht,
        // schaut beim dritten Mal nicht mehr hin.
        '/\bas\s*\[([^\]]*)\]/',
        '/\[([^\]]*\$[^\]]*)\]\s*=[^=]/',
    ] as $muster) {
        if (preg_match_all($muster, $quelle, $m)) {
            foreach (array_slice($m, 1) as $gruppe) {
                foreach ($gruppe as $treffer) {
                    if ($treffer === '') { continue; }
                    foreach (preg_split('/[^a-zA-Z0-9_$]+/', $treffer) as $stueck) {
                        $stueck = ltrim($stueck, '$');
                        if ($stueck !== '') { $gesetzt[$stueck] = 1; }
                    }
                }
            }
        }
    }
    // [$a, $b] = ... ebenfalls als Zuweisung werten
    if (preg_match_all('/\[([^\]]*)\]\s*=[^=]/', $quelle, $m)) {
        foreach ($m[1] as $inhalt) {
            if (preg_match_all('/\$([a-zA-Z_][a-zA-Z0-9_]*)/', $inhalt, $mm)) {
                foreach ($mm[1] as $n) { $gesetzt[$n] = 1; }
            }
        }
    }
    if (preg_match_all('/\$([a-zA-Z_][a-zA-Z0-9_]*)/', $quelle, $m, PREG_OFFSET_CAPTURE)) {
        $gemeldet = [];
        foreach ($m[1] as [$name, $pos]) {
            if (isset($gesetzt[$name]) || isset($gemeldet[$name])) { continue; }
            $gemeldet[$name] = 1;
            $zeile = substr_count(substr($quelle, 0, $pos), "\n") + 1;
            $fehler[] = sprintf('%s Zeile %d: $%s wird gelesen, aber in dieser Datei nie gesetzt',
                basename($endpunkt), $zeile, $name);
        }
    }
}

echo "$geprueft Endpunkte geprueft\n";
if ($fehler) {
    foreach ($fehler as $f) { echo "  X $f\n"; }
    echo count($fehler) . " Beanstandung(en)\n";
    exit(1);
}
echo "Keine Beanstandung.\n";
