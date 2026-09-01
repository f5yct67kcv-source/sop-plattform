<?php
// Gemeldete Ereignisse für die Verwaltung (ENT-297).
//
// Bis hierher landeten die Vorfallmeldungen aus der App (ENT-295) in der
// Datenbank, ohne dass ein Planer sie je zu Gesicht bekam. Das ist der Ort
// zum Nachschlagen; der Feed auf der Übersicht (ereignisse.php) ist der Ort
// zum Bemerken -- beides zusammen, weil eine Liste allein niemand von
// selbst öffnet und ein Feed allein nichts wiederfinden lässt.
//
// Das Foto wird hier NICHT mitgeliefert, nur ob eines vorhanden ist: Ein
// Dutzend eingebettete Bilder in einer Listenantwort wären ein Vielfaches
// der übrigen Daten. Wer es sehen will, holt es einzeln über
// ereignis_foto.php.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_einsehen');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$pdo = db();
if (!hat_tabelle($pdo, 'ereignis_meldung')) {
    // Vor dem nächsten Einrichten gibt es die Tabelle noch nicht. Eine leere
    // Liste ist hier die ehrlichere Antwort als ein Fehler: Es sind
    // tatsächlich keine Meldungen da.
    json_response(['status' => 'ok', 'ereignisse' => [], 'gesamt' => 0]);
}

$wo = [];
$werte = [];

// Zeitraum auf den Erfassungszeitpunkt, nicht auf den Vorfallzeitpunkt: Der
// ist optional und wäre als Filtergrundlage löchrig.
$von = (string)($_GET['von'] ?? '');
$bis = (string)($_GET['bis'] ?? '');
if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $von)) { $wo[] = 'v.erfasst_am >= ?'; $werte[] = $von . ' 00:00:00'; }
if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $bis)) { $wo[] = 'v.erfasst_am <= ?'; $werte[] = $bis . ' 23:59:59'; }

$objektId = (int)($_GET['objekt_id'] ?? 0);
if ($objektId > 0) { $wo[] = 'v.objekt_id = ?'; $werte[] = $objektId; }

$artId = (int)($_GET['ereignisart_id'] ?? 0);
if ($artId > 0) { $wo[] = 'v.ereignisart_id = ?'; $werte[] = $artId; }

$sql =
    'SELECT v.id, v.erfasst_am, v.vorfall_am, v.uebermittelt_am, v.bemerkung,
            v.lat, v.lng, v.gesehen_am, v.foto_mime,
            v.objekt_id, o.name AS objekt_name, o.kunde_name, o.ort,
            v.ereignisart_id, a.bezeichnung AS art,
            v.rundgang_id, v.einsatz_id,
            m.id AS mitarbeiter_id, m.name AS benutzername, m.vorname, m.nachname
       FROM ereignis_meldung v
       JOIN objekte o     ON o.id = v.objekt_id
       JOIN mitarbeiter m ON m.id = v.mitarbeiter_id
       LEFT JOIN ereignisart a ON a.id = v.ereignisart_id'
    . ($wo ? ' WHERE ' . implode(' AND ', $wo) : '')
    . ' ORDER BY v.erfasst_am DESC LIMIT 500';

$stmt = $pdo->prepare($sql);
$stmt->execute($werte);

$liste = array_map(static function (array $r): array {
    $name = trim(($r['vorname'] ?? '') . ' ' . ($r['nachname'] ?? ''));
    return [
        'id'              => (int)$r['id'],
        'erfasst_am'      => $r['erfasst_am'],
        'vorfall_am'      => $r['vorfall_am'],
        'uebermittelt_am' => $r['uebermittelt_am'],
        'gesehen_am'      => $r['gesehen_am'],
        'art'             => $r['art'],
        'ereignisart_id'  => $r['ereignisart_id'] !== null ? (int)$r['ereignisart_id'] : null,
        'bemerkung'       => $r['bemerkung'],
        'objekt_id'       => (int)$r['objekt_id'],
        'objekt'          => $r['objekt_name'],
        'kunde'           => $r['kunde_name'],
        'ort'             => $r['ort'],
        'person'          => $name !== '' ? $name : $r['benutzername'],
        'mitarbeiter_id'  => (int)$r['mitarbeiter_id'],
        'rundgang_id'     => $r['rundgang_id'] !== null ? (int)$r['rundgang_id'] : null,
        'einsatz_id'      => $r['einsatz_id'] !== null ? (int)$r['einsatz_id'] : null,
        'hat_foto'        => $r['foto_mime'] !== null,
        'lat'             => $r['lat'] !== null ? (float)$r['lat'] : null,
        'lng'             => $r['lng'] !== null ? (float)$r['lng'] : null,
    ];
}, $stmt->fetchAll(PDO::FETCH_ASSOC));

json_response(['status' => 'ok', 'ereignisse' => $liste, 'gesamt' => count($liste)]);
