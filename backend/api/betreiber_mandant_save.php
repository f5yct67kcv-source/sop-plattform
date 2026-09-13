<?php
// Mandant anlegen oder aendern (ENT-519).
//
// Geschrieben wird nur, was in BE_MANDANT_FELDER steht -- eine geschlossene
// Liste. Ausdruecklich NICHT ueber diesen Weg: der Status (eigener
// Endpunkt, weil "gekuendigt" eine Vertragsaussage ist) und die
// GAV-Unterstellung (eigener Endpunkt, weil sie bestaetigt und nicht
// gesetzt wird).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();
$pdo = betreiber_db();

if (!hat_tabelle($pdo, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id    = (int)($daten['id'] ?? 0);
$name  = trim((string)($daten['name'] ?? ''));

if ($name === '') {
    json_response(['status' => 'error', 'message' => 'Der Name wird gebraucht.'], 400);
}

$kantonRoh = (string)($daten['kanton'] ?? '');
$kanton    = be_kanton_normal($kantonRoh);
if (trim($kantonRoh) !== '' && $kanton === null) {
    json_response(['status' => 'error',
        'message' => 'Der Kanton wird als zweistelliges Kürzel erwartet, zum Beispiel BE.'], 400);
}

$werte = [
    'name'        => $name,
    'kanton'      => $kanton,
    'db_host'     => trim((string)($daten['db_host'] ?? '')),
    'db_name'     => trim((string)($daten['db_name'] ?? '')),
    'db_user'     => trim((string)($daten['db_user'] ?? '')),
    'secret_name' => trim((string)($daten['secret_name'] ?? '')),
];

// Ein Passwort kommt hier nie an, und wenn doch, wird es nicht gespeichert:
// Der Mandantenstamm traegt kein Passwortfeld (ENT-519). Wer eines mitsendet,
// bekommt eine klare Antwort statt stillem Verschlucken.
foreach (['db_pass', 'db_passwort', 'passwort', 'secret'] as $verboten) {
    if (array_key_exists($verboten, $daten)) {
        json_response(['status' => 'error',
            'message' => 'Datenbank-Passwörter werden hier nicht gespeichert — sie kommen aus dem Deploy. '
                       . 'Im Feld „secret_name" steht nur, welches Secret gemeint ist.'], 400);
    }
}

if ($id > 0) {
    $stmt = $pdo->prepare(
        'UPDATE mandant SET name = ?, kanton = ?, db_host = ?, db_name = ?, db_user = ?,
                            secret_name = ?, geaendert_am = NOW()
          WHERE id = ?'
    );
    $stmt->execute([...array_values($werte), $id]);
    if ($stmt->rowCount() === 0) {
        // Kein Treffer heisst hier zweierlei: Es gibt den Mandanten nicht,
        // oder es hat sich nichts geaendert. Beides ist kein Fehler, aber
        // "gibt es nicht" muss man wissen.
        $da = (int)$pdo->query('SELECT COUNT(*) FROM mandant WHERE id = ' . $id)->fetchColumn();
        if ($da === 0) {
            json_response(['status' => 'error', 'message' => 'Diesen Mandanten gibt es nicht.'], 404);
        }
    }
    json_response(['status' => 'ok', 'id' => $id, 'angelegt' => false]);
}

$stmt = $pdo->prepare(
    'INSERT INTO mandant (name, kanton, db_host, db_name, db_user, secret_name)
     VALUES (?, ?, ?, ?, ?, ?)'
);
$stmt->execute(array_values($werte));
json_response(['status' => 'ok', 'id' => (int)$pdo->lastInsertId(), 'angelegt' => true]);
