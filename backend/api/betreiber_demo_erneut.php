<?php
// Zugangsdaten eines Demo-Zugangs erneut versenden -- vom Betreiber aus.
//
// WARUM NICHT demo_erneut_senden.php: Den gibt es schon, aber er ist die
// OEFFENTLICHE Selbstbedienung (ENT-601). Er antwortet auf JEDEN Fall
// gleich -- damit niemand herausfindet, welche Adresse einen Zugang hat --
// und laeuft ueber eine Bremse. Beides ist dort richtig und hier falsch:
// Wer angemeldet im Betreiber-Bereich auf eine bestimmte Zeile klickt,
// weiss laengst, dass es diesen Zugang gibt, und muss erfahren, ob das
// Senden geklappt hat. Eine Antwort, die immer gleich lautet, waere hier
// kein Schutz, sondern eine Auskunftsverweigerung an die eigene Seite.
//
// WAS DABEI PASSIERT: ein NEUES Passwort. Das bisherige gilt danach nicht
// mehr, und alle offenen Sitzungen fliegen raus (demo_zugang_neues_passwort()
// in demo_instanz.php -- derselbe Weg wie bei der Selbstbedienung, damit
// es nur einen Ort gibt, an dem ein Demo-Passwort neu gesetzt wird). Darum
// fragt die Oberflaeche vorher nach.
//
// NUR BEI LAUFENDEN ZUGAENGEN. Bei einem beendeten oder abgelaufenen Zugang
// gibt es kein Konto mehr, dem ein Passwort gehoeren koennte -- die Instanz
// ist geleert. Das ist etwas anderes als "Versand fehlgeschlagen" und
// bekommt darum einen eigenen Text (Hausregel).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../demo_instanz.php';
require_once __DIR__ . '/../mailer.php';

$ich = require_betreiber_voll();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'demo_zugang')) {
    json_response(['status' => 'error',
        'message' => 'Das Register der Demo-Zugänge ist noch nicht eingerichtet.'], 503);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id    = (int)($daten['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'Welcher Zugang?'], 400);
}

$stmt = $pdo->prepare('SELECT * FROM demo_zugang WHERE id = ?');
$stmt->execute([$id]);
$zugang = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$zugang) {
    json_response(['status' => 'error', 'message' => 'Diesen Zugang gibt es nicht.'], 404);
}
if ((string)$zugang['status'] !== 'aktiv') {
    json_response(['status' => 'error',
        'message' => 'Dieser Zugang läuft nicht mehr. Der Platz ist geleert, '
            . 'es gibt kein Konto, dem neue Zugangsdaten gehören könnten.'], 409);
}

// Passwort setzen und Mail bauen -- versendet wird erst danach.
$neu = demo_zugang_neues_passwort($pdo, $zugang);
if ($neu['fehler'] !== null) {
    // Der Grund geht an die eigene Seite, nicht nach aussen: Hier steht
    // jemand Angemeldetes davor, der ihn braucht, um zu handeln.
    error_log('betreiber_demo_erneut: ' . $neu['fehler']);
    json_response(['status' => 'error', 'message' => $neu['fehler']], 503);
}

try {
    smtp_senden((string)$zugang['email'], (string)$zugang['person'],
        $neu['mail']['betreff'], $neu['mail']['html'], $neu['mail']['text'],
        [], $neu['mail']['bilder'] ?? []);
} catch (Throwable $e) {
    // DAS PASSWORT IST TROTZDEM SCHON NEU. Das zu verschweigen waere der
    // schlimmere Fehler: Der Interessent kaeme mit seinem alten nicht mehr
    // hinein, und niemand wuesste warum.
    error_log('betreiber_demo_erneut: Versand fehlgeschlagen -- ' . $e->getMessage());
    json_response(['status' => 'error',
        'message' => 'Das Passwort wurde neu gesetzt, aber die E-Mail ging nicht raus. '
            . 'Der bisherige Zugang gilt damit nicht mehr — bitte erneut senden.'], 502);
}

// Die EINZIGE Spur. Die Zeile selbst merkt sich nichts davon (bewusst, es
// gibt keine Spalte dafuer), und ohne diesen Eintrag waere hinterher nicht
// feststellbar, wer einen laufenden Zugang ungueltig gemacht hat.
// Geschrieben wird am Mandanten des Platzes -- 'mandant' ist ein
// bestehender Bereich (LOGBUCH_BEREICHE_BE), ein eigener waere fuer diesen
// einen Vorgang zu viel. Ohne Werte: Das Passwort hat im Logbuch nichts
// verloren, und die Adresse steht ohnehin an der Zeile.
$mst = $pdo->prepare('SELECT id FROM mandant WHERE subdomain = ? LIMIT 1');
$mst->execute([(string)$zugang['platz']]);
$mandantId = (int)($mst->fetchColumn() ?: 0);
be_log($pdo, $ich, 'mandant', $mandantId, 'Demo-Zugangsdaten erneut versendet', null, null, true);

json_response([
    'status'  => 'ok',
    'id'      => $id,
    'message' => 'Neue Zugangsdaten an ' . (string)$zugang['email'] . ' verschickt.',
]);
