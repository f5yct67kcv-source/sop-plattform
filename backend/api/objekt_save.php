<?php
// Legt ein Objekt an oder aendert es (ENT-021). Ohne "id" wird angelegt.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'objekte_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];

$id        = isset($input['id']) ? (int)$input['id'] : 0;
$name      = trim((string)($input['name'] ?? ''));
$kundeName = trim((string)($input['kunde_name'] ?? ''));
$kundeId   = isset($input['kunde_id']) && $input['kunde_id'] !== '' ? (int)$input['kunde_id'] : null;
$strasse   = trim((string)($input['strasse'] ?? '')) ?: null;
// PLZ fuer eine eindeutige Adresse -- Grundlage der Wegstrecke nach
// Art. 18 Ziff. 2 (ENT-054).
$plz       = trim((string)($input['plz'] ?? '')) ?: null;
$ort       = trim((string)($input['ort'] ?? ''));
$kanton    = strtoupper(trim((string)($input['kanton'] ?? 'SO')));
$einsatzart = trim((string)($input['einsatzart'] ?? '')) ?: 'Revierdienst';
// Vorgabe des Objekts. Verbindlich ist die Sparte am einzelnen Einsatz;
// diese hier wird beim Erzeugen von Schichten vererbt (ENT-037).
$sparte     = sparte_pruefen($input['sparte'] ?? null);
$aktiv     = !empty($input['aktiv']) ? 1 : 0;
$bemerkung = trim((string)($input['bemerkung'] ?? '')) ?: null;

if ($name === '' || $kundeName === '' || $ort === '') {
    json_response(['status' => 'error', 'message' => 'Bezeichnung, Kunde und Ort erforderlich'], 400);
}
if (!preg_match('/^[A-Z]{2}$/', $kanton)) {
    json_response(['status' => 'error', 'message' => 'Kanton als zwei Buchstaben, z.B. SO'], 400);
}

// Kunde nur verknuepfen, wenn er wirklich existiert.
if ($kundeId !== null) {
    $chk = db()->prepare('SELECT id FROM kunden WHERE id = ?');
    $chk->execute([$kundeId]);
    if (!$chk->fetch()) {
        $kundeId = null;
    }
}

if ($id > 0) {
    $stmt = db()->prepare(
        'UPDATE objekte SET kunde_id = ?, kunde_name = ?, name = ?, strasse = ?, plz = ?, ort = ?,
                kanton = ?, einsatzart = ?, sparte = ?, aktiv = ?, bemerkung = ? WHERE id = ?'
    );
    $stmt->execute([$kundeId, $kundeName, $name, $strasse, $plz, $ort, $kanton, $einsatzart, $sparte, $aktiv, $bemerkung, $id]);
    $chk = db()->prepare('SELECT id FROM objekte WHERE id = ?');
    $chk->execute([$id]);
    if (!$chk->fetch()) {
        json_response(['status' => 'error', 'message' => 'Objekt nicht gefunden'], 404);
    }
} else {
    $stmt = db()->prepare(
        'INSERT INTO objekte (kunde_id, kunde_name, name, strasse, plz, ort, kanton, einsatzart, sparte, aktiv, bemerkung)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([$kundeId, $kundeName, $name, $strasse, $plz, $ort, $kanton, $einsatzart, $sparte, $aktiv, $bemerkung]);
    $id = (int)db()->lastInsertId();
}

json_response(['status' => 'ok', 'id' => $id]);
