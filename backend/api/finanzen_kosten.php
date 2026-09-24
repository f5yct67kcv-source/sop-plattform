<?php
// Kostenseite der Finanz-Uebersicht (ENT-712): Bruttolohn und
// Auslagenersatz je Monat, dazu die letzten Lohnlaeufe.
//
// Der Zugang zum Endpunkt haengt an der Verwaltung, jeder BLOCK darin an
// seinem eigenen Recht (lohn_lesen, auslagen_lesen) -- entschieden in
// fin_kosten() ueber darf(). Ein Block ohne Recht kommt als
// {zugriff:false} zurueck, nie als 0.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../lohnlauf.php';   // fin_* (ENT-712)

$user = require_session();
require_verwaltung($user);

$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));
if (!fin_monat_gueltig($von) || !fin_monat_gueltig($bis) || $von > $bis) {
    json_response(['status' => 'error', 'message' => 'von/bis als YYYY-MM angeben, von nicht nach bis'], 400);
}

$pdo = db();
json_response(fin_kosten($pdo, $user, $von, $bis, [
    'lohnlauf'         => hat_tabelle($pdo, 'lohnlauf') && hat_tabelle($pdo, 'lohnlauf_person'),
    'einsatz_auslagen' => hat_tabelle($pdo, 'einsatz_auslagen'),
], date('Y-m-d')));
