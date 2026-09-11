<?php
// Einrichtungsstand aller Mandanten auf einen Blick (ENT-519, Schema-Drift).
//
// WARUM DIESER ENDPUNKT: Schema-Drift ist das Hauptrisiko der getrennten
// Datenhaltung. Läuft ein Update bei neunzehn Mandanten durch und beim
// zwanzigsten nicht, arbeitet dieser mit neuem Code auf altem Schema. Der
// Einrichtungsknopf meldet sich heute im Cockpit DES MANDANTEN -- der
// Betreiber sähe es also nie.
//
// WAS ER AUSDRÜCKLICH NICHT TUT: Er liest keine Betriebsdaten. Er zählt
// Tabellen und meldet, ob eine Verbindung zustande kommt. Der
// Support-Zugriff auf Inhalte ist eine eigene, noch nicht gebaute Sache und
// hängt an der Freigabe des Mandanten.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();
$pdo = betreiber_db();

if (!hat_tabelle($pdo, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

$zeilen = $pdo->query(
    'SELECT id, name, status, db_host, db_name, db_user, secret_name FROM mandant ORDER BY id'
)->fetchAll(PDO::FETCH_ASSOC);

$stand = array_map(static function (array $m): array {
    $s = mandant_stand($m);
    return [
        'id'         => (int)$m['id'],
        'name'       => $m['name'],
        'status'     => $m['status'],
        'erreichbar' => $s['erreichbar'],
        // Vier Lagen, vier Handlungen -- "nicht eingerichtet" darf nie wie
        // "kaputt" aussehen (Hausregel).
        'lage'       => $s['lage'],
        'tabellen'   => $s['tabellen'],
        'gesamt'     => count(MANDANT_KERNTABELLEN),
        'fehlend'    => $s['fehlend'],
    ];
}, $zeilen);

json_response([
    'status'    => 'ok',
    'mandanten' => $stand,
    'anzahl'    => count($stand),
    'unvollstaendig' => count(array_filter($stand,
        static fn($m) => $m['erreichbar'] && $m['fehlend'] && count($m['fehlend']) > 0)),
    'nicht_erreichbar' => count(array_filter($stand, static fn($m) => !$m['erreichbar'])),
]);
