<?php
// Alle aktiven Kontrollrunden-Vorlagen objektübergreifend, für die mobile
// "Rundgänge"-Übersicht (ENT-279-Fortsetzung): damit eine spontan
// umdisponierte Person gezielt ein Objekt/eine Runde wählen kann, statt an
// die eigene, an diesem Tag zugeteilte Schicht gebunden zu bleiben.
//
// Bewusst NICHT admin-only (anders als rundgang_vorlage_liste_alle.php,
// Recht rundgang_verwalten) -- das ist die Einsatzleitungs-Ansicht.
// Trotzdem keine Person ohne jeden Bezug zum Revierdienst: dieselbe
// Berechtigungsfrage wie beim Sichtbar-Werden des Wächter-Reiters selbst
// (waechterSichtbar() in app.html), hier serverseitig nachgezogen (Sperren
// gehören in den Server, nicht nur in die Oberfläche).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$pdo = db();

// Ein Gate fuer alle Revierdienst-Endpunkte (ENT-338): das in der
// Personalakte gesetzte Merkmal `revierdienst_berechtigt`, dasselbe, das
// in app.html den Waechter-Reiter sichtbar macht. Hier stand bis dahin
// die alte, von ENT-284 abgeloeste Herleitung "jemals einem Objekt mit
// Kontrollpunkten zugeteilt" -- Begruendung bei revierdienst_zugang().
if (!revierdienst_zugang($pdo, (int)$user['id'])) {
    json_response(['status' => 'error', 'message' => 'Kein Zugriff auf die Rundgänge-Übersicht',
                   'code' => 'keine_revierdienst_berechtigung'], 403);
}

$stmt = $pdo->prepare(
    'SELECT v.id, v.name, v.fenster_von, v.fenster_bis,
            o.id AS objekt_id, o.name AS objekt_name, o.kunde_name, o.ort
       FROM rundgang_vorlage v
       JOIN objekte o ON o.id = v.objekt_id
      WHERE v.aktiv = 1 AND o.aktiv = 1
      ORDER BY o.name, v.name'
);
$stmt->execute();
json_response(['status' => 'ok', 'vorlagen' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
