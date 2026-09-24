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
// Dieselbe Ueberlegung wie bei den Namensteilen eine Zeile darueber, fuer
// das Archiv (ENT-672): Zwischen Deploy und Einrichtungslauf gibt es die
// Spalte noch nicht, und ein Endpunkt, der dann mit einem SQL-Fehler
// abbricht, macht aus einer fehlenden Spalte einen unbenutzbaren Bereich.
$hatArchiv = hat_spalte($pdo, 'betreiber', 'archiviert_am');
$felder  = $geteilt
    ? 'id, name, anrede, vorname, nachname, email, aktiv, angelegt_am, letzte_anmeldung'
    : 'id, name, email, aktiv, angelegt_am, letzte_anmeldung';
if ($hatArchiv) { $felder .= ', archiviert_am'; }

$zeilen = $pdo->query('SELECT ' . $felder . ' FROM betreiber ORDER BY id')
              ->fetchAll(PDO::FETCH_ASSOC);

$liste = array_map(static function (array $k) use ($ich, $pdo, $geteilt, $hatArchiv): array {
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
    // Eingeladen und noch nicht eingeloest (ENT-667). Ohne dieses Feld
    // saehe so ein Konto in der Liste wie ein stillgelegtes aus -- zwei
    // verschiedene Aussagen unter einer Darstellung, und die Oberflaeche
    // boete einen Schalter "aktivieren" an, den der Server zu Recht
    // zurueckweist. "Unbekannt darf nie wie keine aussehen" (CLAUDE.md).
    $k['eingeladen'] = be_einladung_offen($pdo, $k['id']);
    // Archiviert heisst: aus der Liste genommen, nicht geloescht (ENT-672).
    // Ohne die Spalte gilt "nicht archiviert" -- das ist der Zustand, den
    // eine Anlage vor dem Nachtrag tatsaechlich hat, keine Annahme.
    $k['archiviert'] = $hatArchiv && ($k['archiviert_am'] ?? null) !== null;
    // Die Unterschrift (ENT-704): null = nicht eingerichtet, sonst ob
    // gezeichnet. Das Bild selbst nur am eigenen Konto -- es ist die
    // Unterschrift einer Person, keine Angabe fuer die ganze Liste.
    $bild = be_unterschrift_von($pdo, $k['id']);
    $k['unterschrift_da'] = $bild === null ? null : $bild !== '';
    $k['unterschrift'] = ($k['ich'] && $bild !== null && $bild !== '') ? $bild : null;
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
    // Damit die Oberflaeche den Reiter "Archiviert" nur dann zeigt, wenn es
    // dort etwas zu sehen gibt -- und ihn zeigt, SOBALD es das gibt. Ein
    // archiviertes Konto, das nirgends mehr auftaucht, waere geloescht in
    // allem ausser dem Namen (ENT-672, Risiken).
    'archivierte' => count(array_filter($liste, static fn($k) => $k['archiviert'])),
]);
