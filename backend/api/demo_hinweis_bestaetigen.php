<?php
declare(strict_types=1);
// Bestaetigt den Demo-Hinweis (erfundene Daten, keine echten Personendaten)
// fuer GENAU DIESES Mitarbeiterkonto (Projektinhaber-Auftrag, 2026-09-21).
//
// ANDERE SACHE als die Zustimmung zu den Nutzungsbedingungen bei der
// Demo-Anfrage (demo_bestaetigung.php, liegt beim Betreiber): Jene
// bestaetigt die Person, die den Demo-Zugang angefordert hat. Diese Zeile
// haelt fest, dass die Person, die sich TATSAECHLICH in dieses Konto
// einloggt, den Hinweis gesehen hat -- das muss nicht dieselbe sein, wenn
// derselbe Zugang mehrfach gezeigt oder weitergegeben wird.
//
// Nur in der Demo sinnvoll: In einer echten Instanz sind die Daten nicht
// erfunden, der Hinweis waere dort falsch.
require __DIR__ . '/../db.php';

// Fassung des Hinweistexts, den dashboard.html gerade anzeigt (siehe dort,
// #demoHinweisText). Wie DEMO_BEDINGUNGEN_FASSUNG in demo_bestaetigung.php:
// eine spaetere Textaenderung aendert diesen Wert, alte Bestaetigungen
// bleiben dadurch auf die Fassung datiert, der tatsaechlich zugestimmt wurde.
const DEMO_HINWEIS_FASSUNG = '2026-09-21';

$user = require_session();
$ich  = (int)$user['id'];
$pdo  = db();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
if (!ist_demo()) {
    json_response(['status' => 'error', 'message' => 'Nur in der Demo-Umgebung.'], 400);
}
if (!hat_tabelle($pdo, 'demo_hinweis_bestaetigung')) {
    json_response(['status' => 'error', 'message' => 'Die Einrichtung ist noch nicht auf dem neusten Stand.'], 400);
}

$st = $pdo->prepare(
    'INSERT INTO demo_hinweis_bestaetigung (mitarbeiter_id, fassung, bestaetigt_am)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE fassung = VALUES(fassung), bestaetigt_am = VALUES(bestaetigt_am)'
);
$st->execute([$ich, DEMO_HINWEIS_FASSUNG, date('Y-m-d H:i:s')]);

json_response(['status' => 'ok']);
