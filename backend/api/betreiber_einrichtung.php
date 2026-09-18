<?php
// Stand der Betreiber-Tabellen, und auf Wunsch das Nachziehen (ENT-605).
//
// WARUM ES DIESEN ENDPUNKT NEBEN betreiber_einrichten.php GIBT: Jener
// verlangt zuerst require_session(), also eine Anmeldung im Cockpit des
// Mandanten. Auf betreiber.guardops.ch gibt es die nicht -- die Seite kennt
// nur Betreiber-Konten. Kommt eine Tabelle dazu (hier: die sieben fuer
// Offerten), haette die Betreiberin sonst keinen Weg, sie anzulegen, ohne
// sich in das Cockpit einer Mandantin anzumelden. Genau das soll die
// Trennung der Ebenen verhindern.
//
// GET ist reiner Pruefmodus, POST legt an. Angelegt wird ausschliesslich,
// was fehlt: be_tabellen_anlegen() loescht nichts und leert nichts.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();

$pdo        = betreiber_db();
$nurPruefen = in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true);

$ergebnis = be_tabellen_anlegen($pdo, $nurPruefen);

json_response([
    'status'     => $ergebnis['fehler'] ? 'error' : 'ok',
    'modus'      => $nurPruefen ? 'pruefung' : 'ausgefuehrt',
    'getan'      => $ergebnis['getan'],
    'offen'      => $ergebnis['offen'],
    'fehler'     => $ergebnis['fehler'],
    // Die eine Frage, die die Oberflaeche wirklich stellt: Steht der
    // Offertenteil? Sie wird hier beantwortet und nicht aus 'offen'
    // erraten -- eine Liste von Texten ist keine Zusage.
    'offerten_bereit' => hat_tabelle($pdo, 'be_belege', true)
                      && hat_tabelle($pdo, 'be_kunden', true),
]);
