<?php
// Die Konten der Betreiber-Ebene (ENT-519).
//
// Ohne passwort_hash. Der Hash verlaesst den Server nie -- auch nicht
// gegenueber jemandem, der ohnehin alles darf: Ein Hash in einer Antwort
// landet im Browserverlauf, in Protokollen und in jedem Werkzeug, das
// unterwegs mitschneidet.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();
$pdo = betreiber_db();

$zeilen = $pdo->query(
    'SELECT id, name, email, aktiv, angelegt_am, letzte_anmeldung
       FROM betreiber ORDER BY id'
)->fetchAll(PDO::FETCH_ASSOC);

$liste = array_map(static function (array $k) use ($ich): array {
    $k['id']       = (int)$k['id'];
    $k['aktiv']    = (int)$k['aktiv'] === 1;
    $k['ich']      = $k['id'] === (int)$ich['id'];
    // "Noch nie angemeldet" ist etwas anderes als "vor langer Zeit" und
    // darf in der Oberflaeche nicht als leeres Feld erscheinen.
    $k['nie_angemeldet'] = $k['letzte_anmeldung'] === null;
    return $k;
}, $zeilen);

json_response([
    'status'  => 'ok',
    'konten'  => $liste,
    'anzahl'  => count($liste),
    // Damit die Oberflaeche den letzten Schalter ausgrauen kann, statt den
    // Fehler erst nach dem Klick zu zeigen. Der Server prueft trotzdem
    // selbst -- eine Sperre, die man am Browser vorbei umgehen kann, ist
    // keine (CLAUDE.md).
    'aktive'  => count(array_filter($liste, static fn($k) => $k['aktiv'])),
]);
