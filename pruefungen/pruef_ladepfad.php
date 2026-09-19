<?php
declare(strict_types=1);
// Ruft ein Endpunkt eine Funktion auf, die in SEINEM Ladepfad gar nicht
// definiert ist? (Nachtrag zu ENT-612, 2026-09-18.)
//
// ANLASS, ein echter Fehlschlag: Der oeffentliche Demo-Zugang beantwortete
// sieben Anlaeufe lang jede Anfrage mit "Unerwarteter Serverfehler".
// Ursache war kein Datenbank- und kein Logikfehler, sondern ein stiller
// Vertrag: demo_reset.php benutzt system_rollen() aus rechte.php und hielt
// im Kopfkommentar fest, der Aufrufer habe rechte.php "bereits geladen".
// Fuer seine damaligen Aufrufer stimmte das. demo_anfordern.php erbte
// diese Annahme nicht -- und brach mit "Call to undefined function
// system_rollen()" ab. Ein solcher Fehler ist keine PDOException, also
// blieb beim Anfragenden nur die nichtssagende Sammelmeldung uebrig.
//
// WARUM NICHT IM QUELLTEXT NACHLESEN: Ein Blick auf die require-Zeilen
// haette den Fehler nicht gezeigt -- die Funktion stand ja da, nur in
// einer Datei, die diese eine Kette nicht laedt. Diese Pruefung LAEDT
// darum wirklich, was der Endpunkt laedt, und fragt PHP selbst, welche
// Funktionen danach existieren. Geprueft wird die Aussage ("der Aufruf
// findet sein Ziel"), nicht der Wortlaut.
//
// Absichtlich NUR die Ketten, nicht die Endpunktkoerper: Ein Endpunkt
// ausgefuehrt braucht Anfrage, Sitzung und Datenbank. Die Kette allein
// genuegt fuer diese Frage vollstaendig.

require_once __DIR__ . '/ladepfad_aufrufe.php';

$wurzel = dirname(__DIR__);
$bestanden = 0;
$fehler = [];

// Die require-Zeilen eines Endpunkts, in seiner Reihenfolge.
function kette_des_endpunkts(string $pfad): array
{
    $text = (string)file_get_contents($pfad);
    preg_match_all('/require(?:_once)?\s+__DIR__\s*\.\s*[\'"]([^\'"]+)[\'"]/', $text, $t);
    return $t[1];
}

// Geprueft werden die Endpunkte, die OHNE Anmeldung von aussen erreichbar
// sind -- dort trifft ein solcher Abbruch einen Interessenten, nicht einen
// angemeldeten Betreiber, der nachfragen kann.
$endpunkte = [
    'backend/api/demo_anfordern.php',
    'backend/api/demo_erneut_senden.php',
];

foreach ($endpunkte as $rel) {
    $pfad = $wurzel . '/' . $rel;
    if (!is_file($pfad)) { $fehler[] = "$rel gibt es nicht"; continue; }

    $kette = kette_des_endpunkts($pfad);
    if (!$kette) { $fehler[] = "$rel laedt gar nichts -- Kette nicht erkannt"; continue; }

    // In einem EIGENEN Prozess laden: Sonst faerbte die Kette des einen
    // Endpunkts die des naechsten ein, und ein echtes Loch bliebe gruen.
    $laden = '';
    foreach ($kette as $ziel) {
        $laden .= 'require_once ' . var_export(dirname($pfad) . '/' . $ziel, true) . ';';
    }
    // Gefragt wird ueber ALLES, was die Kette nachzieht, nicht nur ueber
    // die Dateien, die der Endpunkt namentlich nennt. Sonst benennt die
    // Pruefung im Fehlerfall irgendeine Folgewirkung statt der Ursache:
    // system_rollen() steht in demo_reset.php, und dorthin kommt man erst
    // ueber demo_instanz.php -- zwei Stufen tief.
    $skript = '<?php ' . $laden
        . 'require_once ' . var_export(__DIR__ . '/ladepfad_aufrufe.php', true) . ';'
        . '$offen = [];'
        . '$dateien = array_merge(get_included_files(), [' . var_export($pfad, true) . ']);'
        // Was der Endpunkt SELBST definiert, ist fuer ihn vorhanden -- er
        // wird hier bewusst nicht ausgefuehrt (siehe Kopf), also kennt
        // function_exists() diese Namen nicht. Ohne diese Liste meldete die
        // Pruefung jede Helferfunktion eines Endpunkts als Loch und waere
        // damit genau die Sorte Warnung, die man nach dem dritten Mal
        // wegklickt.
        . '$eigene = array_flip(ladepfad_definitionen(' . var_export($pfad, true) . '));'
        . 'foreach ($dateien as $datei) {'
        . '  if (strpos($datei, ' . var_export($wurzel . '/backend/', true) . ') !== 0) { continue; }'
        . '  foreach (ladepfad_aufrufe($datei) as $f) {'
        . '    if (!function_exists($f) && !isset($eigene[$f])) { $offen[$f] = true; }'
        . '  }'
        . '}'
        . 'echo implode(",", array_keys($offen));';
    $tmp = tempnam(sys_get_temp_dir(), 'ladepfad') . '.php';
    file_put_contents($tmp, $skript);
    $ausgabe = [];
    $status = 0;
    exec('php ' . escapeshellarg($tmp) . ' 2>&1', $ausgabe, $status);
    unlink($tmp);

    $roh = trim(implode("\n", $ausgabe));
    if ($status !== 0) {
        $fehler[] = "$rel: Kette laesst sich nicht laden -- $roh";
        continue;
    }
    // Die Ketten der Endpunkte laden ihrerseits weiter; erfasst sind hier
    // die Dateien, die der Endpunkt selbst nennt. Alles, was danach noch
    // fehlt, ist genau der gesuchte Fall.
    $offen = array_values(array_filter(explode(',', $roh), fn($f) => $f !== ''));
    if ($offen) {
        $fehler[] = "$rel ruft auf, was sein Ladepfad nicht kennt: " . implode(', ', $offen);
    } else {
        $bestanden++;
    }
}

echo "$bestanden bestanden\n";
foreach ($fehler as $f) { echo "x $f\n"; }
exit($fehler ? 1 : 0);
