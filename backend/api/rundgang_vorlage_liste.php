<?php
// Kontrollrunden-Vorlagen eines Objekts samt zugeordneten Kontrollpunkten,
// je Vorlage nach Reihenfolge sortiert (ENT-204).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_verwalten');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$objektId = isset($_GET['objekt_id']) ? (int)$_GET['objekt_id'] : 0;
if ($objektId <= 0) {
    json_response(['status' => 'error', 'message' => 'objekt_id erforderlich'], 400);
}

$stmt = db()->prepare(
    'SELECT v.id AS vorlage_id, v.name, v.beschreibung, v.aktiv, v.erstellt_am,
            p.kontrollpunkt_id, p.reihenfolge, k.bezeichnung
     FROM rundgang_vorlage v
     LEFT JOIN rundgang_vorlage_punkt p ON p.vorlage_id = v.id
     LEFT JOIN kontrollpunkt k ON k.id = p.kontrollpunkt_id
     WHERE v.objekt_id = ?
     ORDER BY v.name, v.id, p.reihenfolge'
);
$stmt->execute([$objektId]);

// Gruppiert die flache Verbund-Abfrage zu einer Vorlage je Zeile mit
// eingebetteter Punkteliste -- vermeidet eine zweite Anfrage pro Vorlage.
$vorlagen = [];
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
    $vid = (int)$zeile['vorlage_id'];
    if (!isset($vorlagen[$vid])) {
        $vorlagen[$vid] = [
            'id' => $vid,
            'objekt_id' => $objektId,
            'name' => $zeile['name'],
            'beschreibung' => $zeile['beschreibung'],
            'aktiv' => (int)$zeile['aktiv'],
            'erstellt_am' => $zeile['erstellt_am'],
            'punkte' => [],
        ];
    }
    if ($zeile['kontrollpunkt_id'] !== null) {
        $vorlagen[$vid]['punkte'][] = [
            'id' => (int)$zeile['kontrollpunkt_id'],
            'bezeichnung' => $zeile['bezeichnung'],
            'reihenfolge' => (int)$zeile['reihenfolge'],
        ];
    }
}

json_response(['status' => 'ok', 'vorlagen' => array_values($vorlagen)]);
