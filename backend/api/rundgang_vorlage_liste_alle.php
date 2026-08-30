<?php
// Aktive Kontrollrunden-Vorlagen ueber ALLE Objekte hinweg -- Uebersicht fuer
// die Kachel "Rundgaenge" (ENT-242). Die vollstaendige Verwaltung inklusive
// inaktiver Vorlagen bleibt Objekt fuer Objekt unter Einrichtung
// (rundgang_vorlage_liste.php, unveraendert).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_verwalten');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$stmt = db()->prepare(
    'SELECT v.id AS vorlage_id, v.objekt_id, v.name, v.aktiv, v.erstellt_am,
            o.kunde_name, o.name AS objekt_name,
            p.kontrollpunkt_id, p.reihenfolge, k.bezeichnung
     FROM rundgang_vorlage v
     JOIN objekte o ON o.id = v.objekt_id
     LEFT JOIN rundgang_vorlage_punkt p ON p.vorlage_id = v.id
     LEFT JOIN kontrollpunkt k ON k.id = p.kontrollpunkt_id
     WHERE v.aktiv = 1
     ORDER BY o.kunde_name, o.name, v.name, v.id, p.reihenfolge'
);
$stmt->execute();

// Gleiches Gruppierungsmuster wie rundgang_vorlage_liste.php: die flache
// Verbund-Abfrage wird zu einer Vorlage je Zeile mit eingebetteter
// Punkteliste zusammengefasst -- vermeidet eine zweite Anfrage pro Vorlage.
$vorlagen = [];
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
    $vid = (int)$zeile['vorlage_id'];
    if (!isset($vorlagen[$vid])) {
        $vorlagen[$vid] = [
            'id' => $vid,
            'objekt_id' => (int)$zeile['objekt_id'],
            'kunde_name' => $zeile['kunde_name'],
            'objekt_name' => $zeile['objekt_name'],
            'name' => $zeile['name'],
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
