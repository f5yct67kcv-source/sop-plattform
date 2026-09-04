<?php
// Fahrzeugübernahmen im Zeitraum, für die Auswertung "Arbeitsergebnisse"
// (ENT-346) -- gleiches Muster wie rundgang_scan_liste.php für die
// Kontrollpunktscans desselben Bereichs.
//
// WARUM HIER UND NICHT UNTER DIENSTFAHRZEUGE (ENT-313): Dort steht
// ausdrücklich "Hier wird nichts kontrolliert und nichts gerechnet" -- die
// Übernahmen sind Betriebsablauf, kein Stammdatenfeld, und gehören darum
// zu den übrigen Zeitraum-Auswertungen (Wachbuch, Scans, Ereignisse), nicht
// in die Fahrzeug-Einstellungen.
//
// SEIT ENT-356/ENT-361 KEINE REINE ANZEIGE MEHR: Drei Feststellungen
// ("auffaellig", "wiederholt", "abweichend", siehe fz_uebernahme_feststellungen()
// in fahrzeug.php) werden hier berechnet -- ENT-313s "Lücke" (kein
// Erwartungswert nötig) UND "Abweichung" (Erwartungswert aus weg_km,
// ENT-116). Bewusst weiterhin keine Beanstandung mit Konsequenz -- das
// bleibt durch OP-314 blockiert, bis die Privatnutzungs-Regel schriftlich
// vorliegt und den Mitarbeitenden bekannt ist (Inhalt bereits entschieden,
// ENT-356).
//
// RECHT: 'betrieb', dasselbe wie fahrzeug_logbuch.php -- wer die Fahrzeuge
// pflegen darf, muss auch sehen können, wer sie zuletzt übernommen hat.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../fahrzeug.php';

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
//
// Abfrage und "voriger"-Bezug liegen in fahrzeug.php (FZ_UEBERNAHME_LISTE_SQL),
// nicht hier -- damit dieselbe Abfrage auch in pruef_fahrzeug_uebernahme.php
// echt gegen SQLite laufen kann (ENT-356).
$sql = FZ_UEBERNAHME_LISTE_SQL . ' WHERE DATE(u.zeitpunkt) BETWEEN ? AND ?';
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

    // Drei Feststellungen aus dem Vorwert (ENT-356/ENT-361) -- Berechnung in
    // fz_uebernahme_feststellungen() (fahrzeug.php), damit sie isoliert
    // (ohne Datenbank) geprüft werden kann.
    $vorigerKm = $r['voriger_km'] !== null ? (int)$r['voriger_km'] : null;
    $vorigerMa = $r['voriger_mitarbeiter_id'] !== null ? (int)$r['voriger_mitarbeiter_id'] : null;
    $eigeneMa = $r['eigene_mitarbeiter_id'] !== null ? (int)$r['eigene_mitarbeiter_id'] : null;
    $sollEinsaetze = (int)($r['soll_einsaetze'] ?? 0);
    $sollEinsaetzeMitWegKm = (int)($r['soll_einsaetze_mit_weg_km'] ?? 0);
    $sollKmSumme = $r['soll_km_summe'] !== null ? (float)$r['soll_km_summe'] : null;
    $r += fz_uebernahme_feststellungen($r['tacho_km'], $vorigerKm, $vorigerMa, $eigeneMa,
        $sollEinsaetze, $sollEinsaetzeMitWegKm, $sollKmSumme);
    unset($r['voriger_km'], $r['voriger_mitarbeiter_id'], $r['eigene_mitarbeiter_id'],
        $r['soll_einsaetze'], $r['soll_einsaetze_mit_weg_km'], $r['soll_km_summe']);
    return $r;
}, $stmt->fetchAll(PDO::FETCH_ASSOC));

json_response(['status' => 'ok', 'eingerichtet' => true, 'eintraege' => $eintraege]);
