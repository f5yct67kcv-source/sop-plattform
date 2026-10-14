<?php
// Auslagenersatz als Geldsicht (ENT-712, Punkt 11): Monatssummen je Person.
// Dieselben Zeilen wie die Kontrolle unter Auswertung -> Auslagenersatz
// (auslagen_list.php), am selben Recht, nur anders gebuendelt.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../lohnlauf.php';   // fin_* (ENT-712)

$user = require_session();
require_recht($user, 'auslagen_lesen');

$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));
if (!fin_monat_gueltig($von) || !fin_monat_gueltig($bis) || $von > $bis) {
    json_response(['status' => 'error', 'message' => 'von/bis als YYYY-MM angeben, von nicht nach bis'], 400);
}

$pdo = db();
if (!hat_tabelle($pdo, 'einsatz_auslagen')) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'von' => $von, 'bis' => $bis, 'personen' => []]);
}
json_response(['status' => 'ok', 'eingerichtet' => true, 'von' => $von, 'bis' => $bis,
               'personen' => fin_auslagen_personen($pdo, $von, $bis)]);
