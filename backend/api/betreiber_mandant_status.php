<?php
// Status eines Mandanten setzen: aktiv, gesperrt, gekuendigt (ENT-519).
//
// Eigener Endpunkt und nicht Teil der Sammel-Speicherung: Der Status ist
// eine Vertragsaussage, keine Stammdatenpflege. "gekuendigt" zieht spaeter
// Fristen und einen Datenexport nach sich (siehe betreiber-adminbereich.md,
// Abschnitt 5) -- das soll nicht nebenbei in einem Formular passieren, in
// dem jemand eigentlich die Adresse korrigiert.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();
$pdo = betreiber_db();

if (!hat_tabelle($pdo, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

$daten  = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id     = (int)($daten['id'] ?? 0);
$status = (string)($daten['status'] ?? '');

if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'Welcher Mandant?'], 400);
}
if (!be_mandant_status_gueltig($status)) {
    json_response(['status' => 'error',
        'message' => 'Unbekannter Status. Möglich sind: ' . implode(', ', BE_STATUS) . '.'], 400);
}

// Erst lesen, dann schreiben: Ohne den alten Wert stuende im Logbuch nur,
// worauf der Status gesetzt wurde, nicht, was er vorher war -- und genau
// der Unterschied ist die Vertragsaussage.
$vor = $pdo->prepare('SELECT status, name FROM mandant WHERE id = ?');
$vor->execute([$id]);
$alt = $vor->fetch(PDO::FETCH_ASSOC);
if (!$alt) {
    json_response(['status' => 'error', 'message' => 'Diesen Mandanten gibt es nicht.'], 404);
}

// ── Der Vorrat (ENT-686) ──────────────────────────────────────────────
//
// HINEIN NIE VON HAND: "vorrat" steht nicht in BE_STATUS und faellt darum
// schon oben durch. Ein laufender Mandant, von Hand in den Vorrat gestellt,
// saehe aus wie eine freie Anlage -- mit den Personaldaten eines Kunden
// darin, bereit zur Uebergabe an den naechsten. Zurueck in den Vorrat kommt
// eine Anlage erst, wenn sie geleert ist (ENT-686, Klaerung 6).
//
// HERAUS NUR AUF "AKTIV": Das ist die Zuteilung. Eine Vorratsanlage zu
// sperren oder zu kuendigen ergibt keinen Sinn -- es gibt keinen Vertrag und
// keinen Kunden, dem das gaelte.
if ((string)$alt['status'] === MANDANT_STATUS_VORRAT && $status !== 'aktiv') {
    json_response(['status' => 'error',
        'message' => 'Diese Anlage liegt im Vorrat und gehört noch keinem Kunden. '
                   . 'Sie wird aktiv, indem sie einem Kunden zugeteilt wird — '
                   . 'sperren oder kündigen lässt sie sich nicht.'], 409);
}

$stmt = $pdo->prepare('UPDATE mandant SET status = ?, geaendert_am = NOW() WHERE id = ?');
$stmt->execute([$status, $id]);

be_log($pdo, $ich, 'mandant', $id, 'status', (string)$alt['status'], $status);
// Die Zuteilung bekommt einen eigenen Eintrag: "status: vorrat -> aktiv"
// ist richtig, aber wer spaeter nachsieht, sucht nach dem Moment, in dem
// eine Anlage einem Kunden uebergeben wurde, nicht nach einem Statuswechsel.
if ((string)$alt['status'] === MANDANT_STATUS_VORRAT) {
    be_log($pdo, $ich, 'mandant', $id, 'aus dem Vorrat zugeteilt', null, (string)$alt['name']);
}

json_response(['status' => 'ok', 'id' => $id, 'neuer_status' => $status]);
