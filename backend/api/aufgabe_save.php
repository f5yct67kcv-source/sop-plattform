<?php
// Legt eine Aufgabe im Katalog eines Objekts an oder aendert sie (ENT-300).
// Ohne "id" wird angelegt.
//
// Entfernt wird ueber aktiv = 0, nie per DELETE: Sobald die Erledigung einer
// Aufgabe protokolliert wird (eigener Schritt), haengt an ihr ein Nachweis.
// Gleiches Prinzip wie kontrollpunkt.aktiv.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_verwalten');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input       = json_decode(file_get_contents('php://input'), true) ?? [];
$id          = isset($input['id']) ? (int)$input['id'] : 0;
$objektId    = isset($input['objekt_id']) ? (int)$input['objekt_id'] : 0;
$bezeichnung = trim((string)($input['bezeichnung'] ?? ''));
$information = trim((string)($input['information'] ?? ''));
$information = $information === '' ? null : $information;
// Nur beim Aendern auswertbar; beim Anlegen ist eine inaktive Aufgabe sinnlos.
$aktiv = array_key_exists('aktiv', $input) ? (int)(bool)$input['aktiv'] : 1;

$pdo = db();
if (!hat_tabelle($pdo, 'objekt_aufgabe')) {
    json_response(['status' => 'error',
        'message' => 'Die Aufgaben-Tabellen fehlen. Einmal „Einrichtung" ausführen.'], 409);
}

// Beim Deaktivieren wird die Bezeichnung nicht verlangt -- sonst muesste die
// Oberflaeche sie mitschicken, nur um etwas zu entfernen.
$nurDeaktivieren = $id > 0 && $aktiv === 0 && $bezeichnung === '';
if (!$nurDeaktivieren && $bezeichnung === '') {
    json_response(['status' => 'error', 'message' => 'Bezeichnung erforderlich'], 400);
}
if (mb_strlen($bezeichnung) > 200) {
    json_response(['status' => 'error', 'message' => 'Bezeichnung höchstens 200 Zeichen'], 400);
}

if ($id > 0) {
    // objekt_id kommt aus der Datenbank, nicht aus der Anfrage -- eine
    // Aufgabe soll nicht durch eine mitgeschickte Zahl das Objekt wechseln.
    $stmt = $pdo->prepare('SELECT objekt_id FROM objekt_aufgabe WHERE id = ?');
    $stmt->execute([$id]);
    $vorhanden = $stmt->fetchColumn();
    if ($vorhanden === false) {
        json_response(['status' => 'error', 'message' => 'Aufgabe nicht gefunden'], 404);
    }
    if ($nurDeaktivieren) {
        $pdo->prepare('UPDATE objekt_aufgabe SET aktiv = 0 WHERE id = ?')->execute([$id]);
    } else {
        $pdo->prepare('UPDATE objekt_aufgabe SET bezeichnung = ?, information = ?, aktiv = ? WHERE id = ?')
            ->execute([$bezeichnung, $information, $aktiv, $id]);
    }
    json_response(['status' => 'ok', 'id' => $id]);
}

if ($objektId <= 0) {
    json_response(['status' => 'error', 'message' => 'objekt_id erforderlich'], 400);
}
$pdo->prepare('INSERT INTO objekt_aufgabe (objekt_id, bezeichnung, information) VALUES (?, ?, ?)')
    ->execute([$objektId, $bezeichnung, $information]);
json_response(['status' => 'ok', 'id' => (int)$pdo->lastInsertId()]);
