<?php
// Die Datei an einer Ausgabe (ENT-725, Punkt 7): eine je Ausgabe, PDF oder
// Bild, hoechstens 5 MB.
//
//   GET  ?id=…                        Datei holen (base64 in JSON)
//   POST {id, name, typ, inhalt}      anhaengen oder ersetzen
//   POST {id, entfernen: true}        entfernen
//
// ALS JSON UND NICHT ALS DIREKTER LINK: Der Betreiber-Bereich weist sich mit
// einem Kopf aus (X-Auth-Token), nicht mit einem Cookie. Ein blosser Link
// kaeme ohne Ausweis an. Der Browser baut aus der Antwort selbst eine Datei.
//
// Der Typ wird am INHALT geprueft, nicht an der Angabe des Browsers: Eine
// Datei, die sich "application/pdf" nennt, ist darum noch keine.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();
$pdo = betreiber_db();
if (!be_aus_eingerichtet($pdo)) {
    json_response(['status' => 'error', 'message' => 'Die Ausgaben sind noch nicht eingerichtet.'], 503);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $id = (int)($_GET['id'] ?? 0);
    $s = $pdo->prepare('SELECT name, typ, groesse, inhalt FROM be_ausgabe_datei WHERE ausgabe_id = ?');
    $s->execute([$id]);
    $d = $s->fetch(PDO::FETCH_ASSOC);
    if (!$d) {
        json_response(['status' => 'error', 'message' => 'An dieser Ausgabe hängt keine Datei.'], 404);
    }
    json_response(['status' => 'ok', 'name' => $d['name'], 'typ' => $d['typ'],
                   'groesse' => (int)$d['groesse'], 'inhalt' => base64_encode((string)$d['inhalt'])]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}
$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
$chk = $pdo->prepare('SELECT 1 FROM be_ausgabe WHERE id = ?');
$chk->execute([$id]);
if (!$chk->fetchColumn()) {
    json_response(['status' => 'error', 'message' => 'Ausgabe nicht gefunden'], 404);
}
$alt = $pdo->prepare('SELECT name FROM be_ausgabe_datei WHERE ausgabe_id = ?');
$alt->execute([$id]);
$altName = $alt->fetchColumn();
$altName = $altName === false ? null : (string)$altName;

if (!empty($in['entfernen'])) {
    $pdo->prepare('DELETE FROM be_ausgabe_datei WHERE ausgabe_id = ?')->execute([$id]);
    if ($altName !== null) { be_log($pdo, $ich, 'ausgabe', $id, 'datei', $altName, null); }
    json_response(['status' => 'ok']);
}

$roh = base64_decode((string)($in['inhalt'] ?? ''), true);
if ($roh === false || $roh === '') {
    json_response(['status' => 'error', 'message' => 'Die Datei ist leer oder beschädigt.'], 400);
}
if (strlen($roh) > BE_AUS_DATEI_MAX) {
    json_response(['status' => 'error', 'message' => 'Die Datei ist grösser als 5 MB.'], 400);
}
$typ = be_aus_datei_typ($roh);
if ($typ === null) {
    json_response(['status' => 'error', 'message' => 'Nur PDF, PNG, JPEG oder WebP.'], 400);
}
$name = mb_substr(trim(str_replace(['/', '\\', "\0"], '', (string)($in['name'] ?? ''))), 0, 200);
if ($name === '') { $name = 'beleg'; }

$pdo->prepare('DELETE FROM be_ausgabe_datei WHERE ausgabe_id = ?')->execute([$id]);
$neu = $pdo->prepare('INSERT INTO be_ausgabe_datei (ausgabe_id, name, typ, groesse, inhalt) VALUES (?, ?, ?, ?, ?)');
$neu->bindValue(1, $id, PDO::PARAM_INT);
$neu->bindValue(2, $name);
$neu->bindValue(3, $typ);
$neu->bindValue(4, strlen($roh), PDO::PARAM_INT);
$neu->bindValue(5, $roh, PDO::PARAM_LOB);
$neu->execute();
be_log($pdo, $ich, 'ausgabe', $id, 'datei', $altName, $name);
json_response(['status' => 'ok', 'name' => $name, 'typ' => $typ, 'groesse' => strlen($roh)]);
