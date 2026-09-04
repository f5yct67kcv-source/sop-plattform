<?php
declare(strict_types=1);
// Stellt bestehende Login-Namen auf das Muster aus ENT-376 um
// (vorname.nachname) -- auf ausdruecklichen Wunsch des Projektinhabers als
// harter Schnitt, keine Uebergangsfrist (ENT-381). Der Login-Name ist die
// einzige Anmeldekennung; wer umbenannt wird, kommt mit dem alten Namen
// nicht mehr hinein und muss den neuen kennen.
//
// GET ist reiner Vorschaumodus (kein Schreiben) -- dieselbe Berechnung wie
// POST, damit die Oberflaeche vor der Ausfuehrung genau das zeigen kann,
// was nachher tatsaechlich passiert. Gleiches Muster wie
// planung_einrichten.php.
//
// Das Recht "rechte" statt "personal_schreiben": Es aendert die Anmeldung
// JEDER Person, nicht nur Personaldaten, und ist ausschliesslich der Rolle
// Verwaltung vorbehalten (rollen_katalog() in rechte.php) -- dieselbe
// Ausschliesslichkeit wie bei der Rollenvergabe selbst.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../mitarbeiter.php';

$user = require_session();
require_recht($user, 'rechte');
$methode = $_SERVER['REQUEST_METHOD'];
if ($methode !== 'GET' && $methode !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

if ($methode === 'GET') {
    json_response(['status' => 'ok', 'plan' => ma_login_migrationsplan(db())]);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
// Eine ausdrueckliche Bestaetigung im Aufruf selbst, nicht nur ein Klick in
// der Oberflaeche -- eine Sperre gegen den Fall, dass dieser Endpunkt aus
// Versehen oder ohne die Vorschau gesehen zu haben aufgerufen wird. Was im
// Browser steht, ist nur Bequemlichkeit; die eigentliche Huerde steht hier.
if (($input['bestaetigt'] ?? null) !== true) {
    json_response(['status' => 'error', 'message' => 'Bestätigung erforderlich'], 400);
}

$plan = ma_login_migrieren(db(), $user);
json_response(['status' => 'ok', 'plan' => $plan]);
