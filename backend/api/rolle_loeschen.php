<?php
declare(strict_types=1);
// Ein eigenes Profil entfernen (ENT-440).
//
// Geht nicht, solange es jemand traegt: In mitarbeiter_rollen stuende sonst
// ein Schluessel, den es nicht mehr gibt, und die betroffene Person haette
// stillschweigend weniger Rechte als in ihrer Akte steht. Die Pruefung
// sitzt im Rechtekern, nicht hier.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../logbuch.php';

$user = require_session();
require_recht($user, 'rechte_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$fehler = rolle_loeschen(db(), trim((string)($input['schluessel'] ?? '')), $user);
if ($fehler) {
    json_response(['status' => 'error', 'message' => $fehler], 400);
}
json_response(['status' => 'ok']);
