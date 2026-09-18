<?php
// Fehlende Betreiber-Tabellen und -Spalten selbst nachtragen (ENT-524),
// aufrufbar direkt aus dem Betreiber-Bereich -- ohne den Umweg über das
// Cockpit eines Mandanten.
//
// WARUM ES DAS SCHON GEBAUTE api/betreiber_einrichten.php NICHT TUT: Jener
// Endpunkt verlangt bewusst eine Mandanten-Verwaltungssitzung
// (require_session() + require_verwaltung()), weil er die EINMALIGE
// Erstanlage einer Betreiber-Ebene absichert, die es noch nicht gibt --
// ein Betreiber-Token kann zu diesem Zeitpunkt gar nicht existieren (siehe
// Kommentar dort). Sobald ein Betreiber-Konto aber schon steht -- wie hier,
// jemand ist bereits im Betreiber-Bereich angemeldet --, ist diese Sitzung
// selbst der Ausweis, und ein Umweg über ein fremdes Mandanten-Cockpit ist
// weder noetig noch naheliegend: Wer den Betreiber-Bereich schon aufrufen
// darf, darf auch dessen eigene Tabellen nachtragen.
//
// Ergaenzt nur Fehlendes, loescht nichts, leert nichts -- gefahrlos
// mehrfach aufrufbar, dasselbe Muster wie api/planung_einrichten.php und
// api/betreiber_einrichten.php.
//
// GET ist reiner Pruefmodus (kein exec), POST fuehrt aus -- dieselbe
// Konvention wie bei den beiden anderen Einrichtungsendpunkten.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();
$pdo = betreiber_db();

$nurPruefen = in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true);

$tabellenErgebnis = be_tabellen_anlegen($pdo, $nurPruefen);
$spaltenErgebnis  = be_spalten_anlegen($pdo, $nurPruefen);

$getan  = [...$tabellenErgebnis['getan'],  ...$spaltenErgebnis['getan']];
$offen  = [...$tabellenErgebnis['offen'],  ...$spaltenErgebnis['offen']];
$fehler = [...$tabellenErgebnis['fehler'], ...$spaltenErgebnis['fehler']];

// ── Der Bestandsmandant ─────────────────────────────────────────────
// Dieselbe Ergaenzung wie in api/betreiber_einrichten.php: traegt weder
// nur eine frisch angelegte Tabelle mit dem ersten Betrieb ein, sondern
// auch die Subdomain nach, wenn die Spalte erst nachtraeglich entstanden
// ist (be_bestandsmandant_eintragen() deckt beide Faelle ab).
if (!$nurPruefen) {
    $name = be_bestandsmandant_eintragen($pdo, db());
    if ($name !== null) { $getan[] = 'Bestandsbetrieb als Mandant 1 eingetragen'; }
} elseif (hat_tabelle($pdo, 'mandant')
       && (int)$pdo->query('SELECT COUNT(*) FROM mandant')->fetchColumn() === 0) {
    $offen[] = 'Bestandsbetrieb als Mandant 1';
}

json_response([
    'status' => $fehler ? 'error' : 'ok',
    'modus'  => $nurPruefen ? 'pruefung' : 'ausgefuehrt',
    'getan'  => $getan,
    'offen'  => $offen,
    'fehler' => $fehler,
    'message' => $fehler
        ? 'Einrichtung teilweise fehlgeschlagen — siehe Liste.'
        : ($getan
            ? 'Einrichtung ergänzt.'
            : ($offen ? 'Noch offen — mit „Prüfen und einrichten" ergänzen.' : 'Alles vollständig eingerichtet.')),
]);
