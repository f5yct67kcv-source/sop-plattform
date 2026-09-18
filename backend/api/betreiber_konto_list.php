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

// Die Namensteile (ENT-615) kommen nur mit, wenn die Spalten schon da sind:
// Der Nachtrag laeuft ueber be_spalten_anlegen(), und zwischen Deploy und
// Einrichtungslauf liegt ein Moment, in dem die Tabelle noch die alte ist.
// Ein Endpunkt, der in diesem Moment mit einem SQL-Fehler abbricht, macht aus
// einer fehlenden Spalte einen unbenutzbaren Bereich.
$geteilt = hat_spalte($pdo, 'betreiber', 'vorname');
$felder  = $geteilt
    ? 'id, name, anrede, vorname, nachname, email, aktiv, angelegt_am, letzte_anmeldung'
    : 'id, name, email, aktiv, angelegt_am, letzte_anmeldung';

$zeilen = $pdo->query('SELECT ' . $felder . ' FROM betreiber ORDER BY id')
              ->fetchAll(PDO::FETCH_ASSOC);

$liste = array_map(static function (array $k) use ($ich, $pdo, $geteilt): array {
    $k['id']       = (int)$k['id'];
    $k['aktiv']    = (int)$k['aktiv'] === 1;
    $k['ich']      = $k['id'] === (int)$ich['id'];
    // "Noch nie angemeldet" ist etwas anderes als "vor langer Zeit" und
    // darf in der Oberflaeche nicht als leeres Feld erscheinen.
    $k['nie_angemeldet'] = $k['letzte_anmeldung'] === null;
    if (!$geteilt) {
        // Nicht raten und nicht leer lassen: Solange die Spalten fehlen,
        // steht der ganze Name im Nachnamen, und die Oberflaeche zeigt
        // dasselbe wie bisher.
        $k['anrede']   = '';
        $k['vorname']  = '';
        $k['nachname'] = (string)$k['name'];
    }
    // Stand des zweiten Faktors je Konto. Wer eine fremde Anmeldung wieder
    // flottmachen soll, muss vorher sehen, ob ueberhaupt ein Faktor
    // eingerichtet ist -- sonst zeigt die Oberflaeche einen Knopf, der
    // nichts zuruecksetzen kann.
    $k['zwei_faktor'] = be_zf_tabelle_da($pdo) ? be_zf_ist_an($pdo, $k['id']) : null;
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
