<?php
// Bewegungsspur EINER Runde auslesen (ENT-318).
//
// Bewusst ein eigener Endpunkt und nicht Teil von rundgang_scan_liste.php:
//
//   1. Datensparsamkeit im Betrieb. Wer die Auswertung eines Monats
//      oeffnet, bekommt nicht nebenbei die Aufenthaltsspuren aller
//      Mitarbeitenden geliefert. Die Spur wird nur geholt, wenn jemand sie
//      fuer eine bestimmte Runde ausdruecklich ansieht.
//   2. Menge. Eine Runde traegt leicht hundert Punkte; ein Monat traege
//      Zehntausende und machte die Auswertung unbenutzbar.
//
// Dasselbe Recht wie die Auswertung selbst (rundgang_einsehen) -- wer die
// Scans sehen darf, darf auch den Weg dazwischen sehen. Ein eigenes Recht
// waere sauberer, waere aber eine Rechte-Aenderung und gehoert dem
// Projektinhaber vorgelegt, nicht im Vorbeigehen eingefuehrt (OP dazu).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_einsehen');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$rundgangId = (int)($_GET['rundgang_id'] ?? 0);
if ($rundgangId <= 0) {
    json_response(['status' => 'error', 'message' => 'rundgang_id erforderlich'], 422);
}

// Fehlt die Tabelle (Einrichtung nach ENT-318 noch nicht gelaufen), ist die
// Antwort eine LEERE Spur mit einem eigenen Vermerk -- nicht ein Fehler.
// "Noch nicht eingerichtet" und "es gibt keine Spur" sind verschiedene
// Aussagen, und die Oberflaeche muss sie unterscheiden koennen.
if (!hat_tabelle(db(), 'rundgang_position')) {
    json_response(['status' => 'ok', 'punkte' => [], 'eingerichtet' => false]);
}

$stmt = db()->prepare(
    'SELECT p.lat, p.lng, p.genauigkeit_m, p.erfasst_am
       FROM rundgang_position p
      WHERE p.rundgang_id = ?
      ORDER BY p.erfasst_am, p.id'
);
$stmt->execute([$rundgangId]);
$punkte = $stmt->fetchAll(PDO::FETCH_ASSOC);

json_response(['status' => 'ok', 'punkte' => $punkte, 'eingerichtet' => true]);
