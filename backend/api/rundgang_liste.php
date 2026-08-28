<?php
// Rundgaenge fuer die Einsatzleitung -- laufende und abgeschlossene, mit
// Fortschritt (ENT-180/ENT-182/ENT-183). Reine Uebersicht, kein Export --
// PDF/Excel bleibt ein eigener, spaeterer Schritt (ENT-156).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
require_recht($user, 'rundgang_einsehen');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

// Ohne Zeitraum: der heutige Tag -- eine Uebersicht ohne Eingrenzung waere
// bei wachsender Historie irgendwann alles auf einmal.
$von = trim((string)($_GET['von'] ?? '')) ?: date('Y-m-d');
$bis = trim((string)($_GET['bis'] ?? '')) ?: $von;
$objektId = isset($_GET['objekt_id']) && $_GET['objekt_id'] !== '' ? (int)$_GET['objekt_id'] : null;

$pdo = db();
$sql = "SELECT r.id, r.einsatz_id, r.objekt_id, r.mitarbeiter_id, r.status,
               r.rundgang_vorlage_id,
               r.vorbereitet_am, r.rohzeit_start, r.rohzeit_ende,
               r.pause_minuten, r.abbruch_grund, r.abbruch_freitext,
               e.datum, e.kunde_name, o.name AS objekt_name,
               m.vorname, m.nachname
          FROM rundgang r
          JOIN einsaetze e ON e.id = r.einsatz_id
          JOIN objekte o ON o.id = r.objekt_id
          JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
         WHERE e.datum BETWEEN ? AND ?";
$params = [$von, $bis];
if ($objektId !== null) {
    $sql .= ' AND r.objekt_id = ?';
    $params[] = $objektId;
}
$sql .= ' ORDER BY e.datum DESC, r.vorbereitet_am DESC';

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rundgaenge = $stmt->fetchAll();

foreach ($rundgaenge as &$r) {
    $vorlageId = $r['rundgang_vorlage_id'] !== null ? (int)$r['rundgang_vorlage_id'] : null;
    $r['fortschritt'] = rundgang_fortschritt($pdo, (int)$r['id'], (int)$r['objekt_id'], $vorlageId);
}
unset($r);

json_response(['status' => 'ok', 'rundgaenge' => $rundgaenge]);
