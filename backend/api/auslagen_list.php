<?php
// Chronologisches Auslagenersatz-Protokoll je Mitarbeitendem (ENT-125).
//
// Erfuellt Art. 18 Ziff. 10: "Jeden Monat mit Auslagenersatz erhalten
// Mitarbeitende eine schriftliche, nachvollziehbare Spesenabrechnung mit
// Einsatzdatum, -ort, Pauschal- bzw. Regiezone fuer den Fahrzeitersatz sowie
// allfaelligen Fahrtkosten und weiteren Aufwaenden." Eine EIGENE Abrechnung
// neben der Arbeitszeitabrechnung nach Art. 12 Ziff. 5 -- nicht dieselbe
// (siehe 90-gav/regelmatrix.md).
//
// Liefert ROHZEILEN, keine Monatssumme: Die Summierung ist Sache der
// Oberflaeche, damit gesperrte Zeilen (GAV-AUS-010, unbekanntes
// Verkehrsmittel, ...) nicht heimlich als 0 in eine Summe einfliessen.
//
// Nur was tatsaechlich im Abgleich einen Schnappschuss bekommen hat --
// keine Live-Berechnung hier. Der Betrag entsteht ausschliesslich in
// einsatz_abgleich.php/backend/auslagen.php und wird hier nur gelesen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'abgleich');

$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $von) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $bis)) {
    json_response(['status' => 'error', 'message' => 'von/bis als YYYY-MM-DD angeben'], 400);
}
$maId = isset($_GET['mitarbeiter_id']) && $_GET['mitarbeiter_id'] !== '' ? (int)$_GET['mitarbeiter_id'] : null;

$sql = "SELECT a.einsatz_id, a.mitarbeiter_id, m.name, m.vorname, m.nachname,
               e.datum, e.kunde_name, e.ort, e.titel,
               a.zone_schluessel, a.zone_name, a.zone_quelle, a.weg_km,
               a.verkehrsmittel, a.fahrzeitersatz_rappen, a.fahrkostenersatz_rappen,
               a.gesperrt_grund, a.regelwerk, a.erzeugt_am
        FROM einsatz_auslagen a
        JOIN einsaetze e ON e.id = a.einsatz_id
        JOIN mitarbeiter m ON m.id = a.mitarbeiter_id
        WHERE e.datum BETWEEN ? AND ?"
     . ($maId ? ' AND a.mitarbeiter_id = ?' : '')
     . ' ORDER BY m.nachname, m.vorname, m.name, e.datum, e.von';
// Kein eigenes catch: Fehlt einsatz_auslagen noch (Einrichtung nicht
// ausgefuehrt), formuliert der globale Fehlerhandler in db.php die Meldung
// -- dieselbe Behandlung wie bei einsatz_list.php, das dieselbe Situation
// mit "Datenbank jetzt einrichten" abfaengt.
$stmt = db()->prepare($sql);
$stmt->execute($maId ? [$von, $bis, $maId] : [$von, $bis]);
$rows = $stmt->fetchAll();

json_response(['status' => 'ok', 'von' => $von, 'bis' => $bis, 'zeilen' => array_map(fn($r) => [
    'einsatz_id'      => (int)$r['einsatz_id'],
    'mitarbeiter_id'  => (int)$r['mitarbeiter_id'],
    'mitarbeiter'     => trim(($r['vorname'] ?? '') . ' ' . ($r['nachname'] ?? '')) ?: $r['name'],
    'datum'           => $r['datum'],
    'kunde_name'      => $r['kunde_name'],
    'ort'             => $r['ort'],
    'titel'           => $r['titel'],
    'zone_schluessel' => $r['zone_schluessel'],
    'zone_name'       => $r['zone_name'],
    'zone_quelle'     => $r['zone_quelle'],
    'weg_km'          => $r['weg_km'] === null ? null : (float)$r['weg_km'],
    'verkehrsmittel'  => $r['verkehrsmittel'],
    'fahrzeitersatz_rappen'   => $r['fahrzeitersatz_rappen'] === null ? null : (int)$r['fahrzeitersatz_rappen'],
    'fahrkostenersatz_rappen' => $r['fahrkostenersatz_rappen'] === null ? null : (int)$r['fahrkostenersatz_rappen'],
    'gesperrt_grund'  => $r['gesperrt_grund'],
    'regelwerk'       => $r['regelwerk'],
    'erzeugt_am'      => $r['erzeugt_am'],
], $rows)]);
