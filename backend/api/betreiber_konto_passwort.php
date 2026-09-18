<?php
// Das eigene Passwort auf der Betreiber-Ebene wechseln (ENT-615).
//
// NUR AM EIGENEN KONTO. Ein Weg, der das Passwort eines FREMDEN Kontos
// setzt, waere die Uebernahme dieses Kontos -- und damit der ganzen Ebene,
// weil es darueber keine weitere gibt, die das bemerken oder rueckgaengig
// machen koennte. Verliert jemand sein Passwort, legt ein zweites Konto ein
// neues an und legt das alte still; das ist derselbe Gedanke wie beim
// Zuruecksetzen des zweiten Faktors (betreiber_zf_zuruecksetzen.php) und
// genau der Grund, warum ein zweites Betreiber-Konto keine Bequemlichkeit
// ist, sondern Voraussetzung fuer den Betrieb.
//
// MIT DEM ALTEN PASSWORT ALS NACHWEIS. Eine offene Sitzung allein reicht
// nicht: Ein unbeaufsichtigter Bildschirm wuerde sonst genuegen, um das
// Konto zu uebernehmen. Der zweite Faktor deckt die Anmeldung ab, nicht den
// Wechsel danach.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../logbuch.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
$in  = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$alt = (string)($in['alt'] ?? '');
$neu = (string)($in['neu'] ?? '');

$s = $pdo->prepare('SELECT passwort_hash FROM betreiber WHERE id = ?');
$s->execute([(int)$ich['id']]);
$hash = (string)($s->fetchColumn() ?: '');

if ($hash === '' || !password_verify($alt, $hash)) {
    json_response(['status' => 'error',
        'message' => 'Das bisherige Passwort stimmt nicht.'], 403);
}

// istAdmin = true, also die Verwaltungsschwelle -- dieselbe wie beim
// Anlegen. Die Zahl steht in backend/anmeldung.php und nirgends sonst.
$fehler = passwort_pruefen($neu, (string)$ich['email'], true);
if ($fehler !== null) {
    json_response(['status' => 'error', 'message' => $fehler], 400);
}
if (password_verify($neu, $hash)) {
    json_response(['status' => 'error',
        'message' => 'Das ist das bisherige Passwort.'], 400);
}

$pdo->prepare('UPDATE betreiber SET passwort_hash = ? WHERE id = ?')
    ->execute([password_hash($neu, PASSWORD_BCRYPT, ['cost' => PASSWORT_KOSTEN]), (int)$ich['id']]);

// Alle anderen Sitzungen dieses Kontos verfallen. Wer das Passwort
// wechselt, weil er es fuer verraten haelt, hat damit sonst nichts
// gewonnen: Ein bereits ausgestellter Token gilt bis zum Ablauf weiter.
// Die EIGENE Sitzung bleibt -- sonst wirft der Wechsel einen aus dem
// Bereich, in dem man gerade arbeitet.
$meine = sitzung_abdruck((string)($_SERVER['HTTP_X_AUTH_TOKEN'] ?? ''));
$w = $pdo->prepare('DELETE FROM betreiber_sessions WHERE betreiber_id = ? AND token <> ?');
$w->execute([(int)$ich['id'], $meine]);

// OHNE WERTE: Im Logbuch steht, DASS das Passwort gewechselt wurde, nie
// womit -- dieselbe Regel wie bei den vertraulichen Personalfeldern.
be_log($pdo, $ich, 'konto', (int)$ich['id'], 'passwort', null, null, true);

json_response(['status' => 'ok', 'abgemeldet' => $w->rowCount()]);
