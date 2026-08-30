<?php
// Legt eine Kontrollrunden-Vorlage an oder aendert Name/Status (ENT-204).
// Ohne "id" wird angelegt. Die Punktzuordnung selbst laeuft ueber den
// eigenen Endpunkt rundgang_vorlage_punkte_setzen.php -- eine Vorlage kann
// ohne Punkte existieren (frisch angelegt, bevor sie gefuellt wird).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_verwalten');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];

$id          = isset($input['id']) ? (int)$input['id'] : 0;
$objektId    = isset($input['objekt_id']) ? (int)$input['objekt_id'] : 0;
$name        = trim((string)($input['name'] ?? ''));
$aktiv       = !empty($input['aktiv']) ? 1 : 0;
// Optionale Notiz (ENT-255) -- leerer String wird als NULL gespeichert,
// nicht als leere Zeichenkette, damit "keine Beschreibung" eindeutig bleibt.
$beschreibung = trim((string)($input['beschreibung'] ?? ''));
$beschreibung = $beschreibung === '' ? null : $beschreibung;

if ($objektId <= 0 || $name === '') {
    json_response(['status' => 'error', 'message' => 'Objekt und Name erforderlich'], 400);
}

$objektChk = db()->prepare('SELECT id FROM objekte WHERE id = ?');
$objektChk->execute([$objektId]);
if (!$objektChk->fetch()) {
    json_response(['status' => 'error', 'message' => 'Objekt nicht gefunden'], 404);
}

if ($id > 0) {
    $stmt = db()->prepare('UPDATE rundgang_vorlage SET objekt_id = ?, name = ?, aktiv = ?, beschreibung = ? WHERE id = ?');
    $stmt->execute([$objektId, $name, $aktiv, $beschreibung, $id]);
    $chk = db()->prepare('SELECT id FROM rundgang_vorlage WHERE id = ?');
    $chk->execute([$id]);
    if (!$chk->fetch()) {
        json_response(['status' => 'error', 'message' => 'Vorlage nicht gefunden'], 404);
    }
} else {
    $stmt = db()->prepare('INSERT INTO rundgang_vorlage (objekt_id, name, aktiv, beschreibung) VALUES (?, ?, ?, ?)');
    $stmt->execute([$objektId, $name, $aktiv, $beschreibung]);
    $id = (int)db()->lastInsertId();
}

json_response(['status' => 'ok', 'id' => $id]);
