<?php
// Den eingerichteten zweiten Faktor bestaetigen (OP-517).
//
// Erst hier zaehlt er. Vorher steht zwar ein Geheimnis in der Tabelle, aber
// be_zf_ist_an() sagt nein -- sonst sperrte sich aus, wessen App den
// QR-Code nie gelesen hat.
//
// Die Notfallcodes entstehen genau EINMAL, hier, und werden genau EINMAL
// ausgeliefert. Gespeichert werden nur ihre Hashes: Ein Notfallcode ist ein
// Passwortersatz und wird wie einer verwahrt.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';   // PASSWORT_KOSTEN
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber();
$pdo = betreiber_db();
$id  = (int)$ich['id'];

if (be_zf_ist_an($pdo, $id)) {
    json_response(['status' => 'error',
        'message' => 'Der zweite Faktor ist bereits bestätigt.'], 409);
}

$geheim = be_zf_geheim($pdo, $id);
if ($geheim === null) {
    json_response(['status' => 'error',
        'message' => 'Es ist noch kein zweiter Faktor eingerichtet.'], 400);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$code  = zf_code_normalisieren((string)($daten['code'] ?? ''));

if (zf_pruefen($geheim, $code, time()) === null) {
    json_response(['status' => 'error',
        'message' => 'Der Code stimmt nicht. Stimmt die Uhrzeit auf dem Telefon?'], 401);
}

$codes  = [];
$hashes = [];
for ($i = 0; $i < ZF_NOTFALLCODES; $i++) {
    $c = zf_notfallcode();
    $codes[]  = $c;
    $hashes[] = password_hash($c, PASSWORD_BCRYPT, ['cost' => PASSWORT_KOSTEN]);
}

$pdo->prepare(
    'UPDATE betreiber_zwei_faktor SET bestaetigt_am = NOW(), notfallcodes = ? WHERE betreiber_id = ?'
)->execute([json_encode($hashes), $id]);

json_response([
    'status'       => 'ok',
    'notfallcodes' => $codes,
    'hinweis'      => 'Diese Codes werden nur jetzt angezeigt und sind je einmal verwendbar. '
                    . 'Bitte ausserhalb dieses Geräts aufbewahren.',
]);
