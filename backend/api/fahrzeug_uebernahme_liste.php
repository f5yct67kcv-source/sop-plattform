<?php
// Fahrzeugübernahmen im Zeitraum, für die Auswertung "Arbeitsergebnisse"
// (ENT-346). Reine Anzeige, keine Berechnung -- gleiches Muster wie
// rundgang_scan_liste.php für die Kontrollpunktscans desselben Bereichs.
//
// WARUM HIER UND NICHT UNTER DIENSTFAHRZEUGE (ENT-313): Dort steht
// ausdrücklich "Hier wird nichts kontrolliert und nichts gerechnet" -- die
// Übernahmen sind Betriebsablauf, kein Stammdatenfeld, und gehören darum
// zu den übrigen Zeitraum-Auswertungen (Wachbuch, Scans, Ereignisse), nicht
// in die Fahrzeug-Einstellungen.
//
// RECHT: 'betrieb', dasselbe wie fahrzeug_logbuch.php -- wer die Fahrzeuge
// pflegen darf, muss auch sehen können, wer sie zuletzt übernommen hat.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'betrieb');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$pdo = db();
if (!hat_tabelle($pdo, 'fahrzeug_uebernahme')) {
    // Fehlende Einrichtung ist etwas anderes als "im Zeitraum nichts
    // passiert" -- die Oberfläche muss beides verschieden benennen können.
    json_response(['status' => 'ok', 'eingerichtet' => false, 'eintraege' => []]);
}

// Ohne Zeitraum: der heutige Tag -- dieselbe Regel wie rundgang_liste.php
// und rundgang_scan_liste.php.
$von = trim((string)($_GET['von'] ?? '')) ?: date('Y-m-d');
$bis = trim((string)($_GET['bis'] ?? '')) ?: $von;
$fahrzeugId = isset($_GET['fahrzeug_id']) && $_GET['fahrzeug_id'] !== '' ? (int)$_GET['fahrzeug_id'] : null;

// einsaetze.kunde_name steht direkt am Einsatz (wie in rundgang_scan_liste.php
// genutzt) -- kein zweiter Weg über die Kundentabelle nötig. LEFT JOIN, weil
// eine spontane Fahrt ohne Einsatz gültig ist (siehe meine_fahrzeug_uebernahme.php)
// und dann keinen Zusammenhang zu zeigen hat, statt einen zu erfinden.
$sql = 'SELECT u.id, u.art, u.zeitpunkt, u.tacho_km, u.quelle,
               u.foto IS NOT NULL AS hat_foto,
               f.id AS fahrzeug_id, f.kennzeichen, f.bezeichnung AS fz_bezeichnung,
               m.vorname, m.nachname, m.name,
               e.kunde_name, e.titel
          FROM fahrzeug_uebernahme u
          LEFT JOIN fahrzeuge f ON f.id = u.fahrzeug_id
          JOIN mitarbeiter m ON m.id = u.mitarbeiter_id
          LEFT JOIN einsaetze e ON e.id = u.einsatz_id
         WHERE DATE(u.zeitpunkt) BETWEEN ? AND ?';
$werte = [$von, $bis];
if ($fahrzeugId !== null) {
    $sql .= ' AND u.fahrzeug_id = ?';
    $werte[] = $fahrzeugId;
}
$sql .= ' ORDER BY u.zeitpunkt DESC, u.id DESC';

$stmt = $pdo->prepare($sql);
$stmt->execute($werte);
$eintraege = array_map(function (array $r): array {
    $r['id'] = (int)$r['id'];
    $r['fahrzeug_id'] = $r['fahrzeug_id'] !== null ? (int)$r['fahrzeug_id'] : null;
    $r['tacho_km'] = $r['tacho_km'] !== null ? (int)$r['tacho_km'] : null;
    $r['hat_foto'] = (bool)$r['hat_foto'];
    $name = trim(($r['vorname'] ?? '') . ' ' . ($r['nachname'] ?? ''));
    $r['person'] = $name !== '' ? $name : (string)($r['name'] ?? '?');
    unset($r['vorname'], $r['nachname'], $r['name']);
    return $r;
}, $stmt->fetchAll(PDO::FETCH_ASSOC));

json_response(['status' => 'ok', 'eingerichtet' => true, 'eintraege' => $eintraege]);
