<?php
// Loest eine Einladung ein: Die Person setzt ihr Passwort selbst (ENT-663).
//
// STEHT IN OHNE_ANMELDUNG (pruefungen/test_php.mjs): derselbe Grund wie bei
// betreiber_einladung_pruefen.php -- wer eingeladen ist, hat noch keinen
// Zugang. Der Ausweis ist der Token, und er liegt als Abdruck in der
// Datenbank (ENT-501).
//
// WAS DIESER ENDPUNKT NICHT TUT, und das ist der Punkt: Er meldet NICHT an.
// Er setzt das Passwort und schaltet das Konto frei, danach fuehrt der
// gewoehnliche Weg ueber betreiber_anmelden.php -- mitsamt Bremse und dem
// zweiten Faktor, der dort beim ersten Mal eingerichtet wird. Eine Sitzung
// gleich hier auszustellen waere ein zweiter Eingang in die Ebene, der die
// Zwei-Faktor-Pflicht (ENT-521) umginge: Der Link aus einem Postfach
// alleine wuerde dann genuegen.
//
// NUR POST. Ein GET wuerde die Vorschau eines Mailprogramms ausloesen --
// dieselbe Ueberlegung wie bei betreiber_beleg_entscheidung.php (ENT-605).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../logbuch.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in    = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$token = (string)($in['token'] ?? '');
$pass  = (string)($in['passwort'] ?? '');

$adresse = anmeld_adresse();
[$fehlerName, $fehlerAdresse] = anmeld_zaehlen(db(), 'be-einladung:', $adresse);
$sperre = anmeld_sperre(0, $fehlerAdresse);
if ($sperre > 0) {
    json_response(['status' => 'error',
        'message' => 'Zu viele Versuche. Bitte in ' . $sperre . ' Minuten erneut versuchen.'], 429);
}

$pdo = betreiber_db();
if (!be_einladung_tabelle_da($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Der Betreiber-Bereich ist noch nicht eingerichtet.'], 503);
}

$konto = be_einladung_konto($pdo, $token);
if ($konto === null) {
    anmeld_fehlversuch(db(), 'be-einladung:', $adresse);
    json_response(['status' => 'error',
        'message' => 'Dieser Link gilt nicht mehr. Bitte eine neue Einladung anfordern '
                   . 'bei der Person, die den Zugang eingerichtet hat.'], 404);
}

// istAdmin = true, also die Verwaltungsschwelle -- dieselbe wie beim
// Anlegen und beim Wechseln. Die Zahl steht in backend/anmeldung.php und
// nirgends sonst; ein Kommentar, der sie abschreibt, wird beim naechsten
// Bemessen zur Falschaussage.
$fehler = passwort_pruefen($pass, (string)$konto['email'], true);
if ($fehler !== null) {
    // KEIN Fehlversuch: Der Link war richtig, nur das Passwort zu schwach.
    // Wer daran gezaehlt wuerde, sperrte sich beim Ausprobieren selbst aus.
    json_response(['status' => 'error', 'message' => $fehler], 400);
}

$id = (int)$konto['id'];

// Setzen, freischalten und die Einladung entfernen -- in einer Transaktion.
// Bliebe die Zeile in betreiber_einladung stehen, waere der Link nach dem
// Einloesen weiter gueltig und setzte das Passwort ein zweites Mal.
$pdo->beginTransaction();
try {
    $pdo->prepare('UPDATE betreiber SET passwort_hash = ?, aktiv = 1 WHERE id = ?')
        ->execute([password_hash($pass, PASSWORD_BCRYPT, ['cost' => PASSWORT_KOSTEN]), $id]);
    $pdo->prepare('DELETE FROM betreiber_einladung WHERE betreiber_id = ?')->execute([$id]);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    json_response(['status' => 'error',
        'message' => 'Das Passwort konnte nicht gesetzt werden.'], 500);
}

// Logbuch (ENT-614). AKTEUR IST DAS KONTO SELBST: Es gibt hier keinen
// angemeldeten Betreiber, der handelte -- die eingeladene Person hat
// gehandelt, und genau das soll dastehen. Zusammen mit dem Eintrag aus
// betreiber_einladen.php ergibt sich, wer eingeladen hat und wer eingeloest
// hat.
be_log($pdo, ['id' => $id, 'name' => (string)$konto['name']],
       'konto', $id, 'eingeloest', null, (string)$konto['name']);

json_response(['status' => 'ok', 'email' => $konto['email']]);
