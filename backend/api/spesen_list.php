<?php
declare(strict_types=1);
// Die eingereichten Spesenbelege fuer die Verwaltung (ENT-413).
//
// require_recht('personal_schreiben') und KEIN neuntes Recht: Eine
// Spesenfreigabe ist dieselbe Art Vorgang wie ein Abwesenheitsentscheid
// (abwesenheit_entscheiden.php begruendet es dort gleich) -- sie betrifft
// den Anspruch einer einzelnen Person. Der Rechtekatalog ist bewusst grob
// geschnitten ("acht Rechte, nicht sechzig", rechte.php); ein eigenes
// Spesenrecht waere eine weitere Kombination, die jemand pruefen muesste.
//
// Belege im Zustand 'erfasst' erscheinen hier NICHT: Sie liegen noch in der
// Mappe der Person und sind kein Antrag. Das ist der ganze Zweck der
// Trennung zwischen erfasst und eingereicht.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../spesen.php';

$user = require_session();
require_recht($user, 'personal_schreiben');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$pdo = db();
// "Nicht eingerichtet" ist etwas anderes als "keine Belege" -- die Ansicht
// muss beides unterscheiden koennen (CLAUDE.md).
if (!hat_tabelle($pdo, 'spesen')) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'spesen' => []]);
}

// Voreinstellung sind die offenen Faelle: Wer die Ansicht oeffnet, will
// wissen, was zu entscheiden ist. Die entschiedenen bleiben ueber den
// Filter erreichbar, damit eine Freigabe nachvollziehbar bleibt.
$filter = (string)($_GET['status'] ?? 'eingereicht');
if (!in_array($filter, ['eingereicht', 'freigegeben', 'abgelehnt', 'alle'], true)) {
    json_response(['status' => 'error', 'message' => 'Unbekannter Status'], 400);
}

json_response([
    'status' => 'ok',
    'eingerichtet' => true,
    'kategorien' => SPESEN_KATEGORIEN,
    'spesen' => spesen_liste_verwaltung($pdo, $filter),
]);
