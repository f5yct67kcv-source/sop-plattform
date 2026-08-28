<?php
// Ersetzt die komplette, geordnete Punktzuordnung einer Kontrollrunden-
// Vorlage (ENT-204). Die eigentliche Pruefung und das atomare Ersetzen
// stehen in rundgang.php, damit sie sich echt gegen eine Datenbank testen
// lassen -- gleiches Muster wie rundgang_kontrollpunkte_uebrig().
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
require_recht($user, 'rundgang_verwalten');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];

$vorlageId = isset($input['vorlage_id']) ? (int)$input['vorlage_id'] : 0;
$kontrollpunktIds = is_array($input['kontrollpunkt_ids'] ?? null) ? $input['kontrollpunkt_ids'] : [];

if ($vorlageId <= 0) {
    json_response(['status' => 'error', 'message' => 'vorlage_id erforderlich'], 400);
}

$fehler = rundgang_vorlage_punkte_setzen(db(), $vorlageId, $kontrollpunktIds);
if ($fehler !== null) {
    json_response(['status' => 'error', 'message' => $fehler], $fehler === 'Vorlage nicht gefunden.' ? 404 : 400);
}

json_response(['status' => 'ok']);
