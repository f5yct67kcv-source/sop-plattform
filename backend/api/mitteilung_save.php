<?php
declare(strict_types=1);
// Eine Mitteilung anlegen oder aendern (ENT-421). Ohne "id" wird angelegt.
//
// Recht 'mitteilungen' -- vergeben an Verwaltung und Personal (rechte.php).
// Eine Mitteilung geht an alle Mitarbeitenden und traegt den Namen des
// Betriebs; sie gehoert nicht in dieselbe Hand wie das Pflegen einer
// Kundenadresse.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../mitteilungen.php';

$user = require_session();
require_recht($user, 'mitteilungen');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = db();
if (!hat_tabelle($pdo, 'mitteilungen')) {
    json_response(['status' => 'error',
        'message' => 'Die Mitteilungen sind noch nicht eingerichtet — einmal „Einrichten" in der Einrichtung ausführen.'], 400);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];

$id         = isset($in['id']) ? (int)$in['id'] : 0;
$titel      = trim((string)($in['titel'] ?? ''));
$text       = trim((string)($in['text'] ?? ''));
$zielgruppe = trim((string)($in['zielgruppe'] ?? 'alle'));
$stufe      = trim((string)($in['stufe'] ?? 'normal'));

// Leere Zeitangaben sind NULL, nicht ''. NULL heisst hier "keine Grenze"
// (sofort sichtbar / laeuft nicht ab) -- ein leerer Text waere in der
// Datumsspalte ein ungueltiger Wert und in MySQL je nach Betriebsart
// entweder ein Fehler oder ein stilles 0000-00-00.
$ab  = trim((string)($in['sichtbar_ab'] ?? ''))  ?: null;
$bis = trim((string)($in['sichtbar_bis'] ?? '')) ?: null;

if ($titel === '' || $text === '') {
    json_response(['status' => 'error', 'message' => 'Titel und Text erforderlich'], 400);
}
if (mb_strlen($titel) > 120) {
    json_response(['status' => 'error', 'message' => 'Der Titel ist zu lang (höchstens 120 Zeichen).'], 400);
}
if (!mitteilung_zielgruppe_gueltig($zielgruppe)) {
    json_response(['status' => 'error', 'message' => "Zielgruppe muss 'alle' oder 'revier' sein"], 400);
}
if (!mitteilung_stufe_gueltig($stufe)) {
    json_response(['status' => 'error', 'message' => "Stufe muss 'normal' oder 'wichtig' sein"], 400);
}

// JJJJ-MM-TT HH:MM (die Oberflaeche schickt genau das) oder JJJJ-MM-TT.
// Ein Datum ohne Zeit meint den Tagesbeginn beim Start und das Tagesende
// beim Ablauf -- sonst verschwaende eine Mitteilung mit "sichtbar bis
// heute" schon um Mitternacht des Vortages.
function mitteilung_zeit(?string $wert, bool $tagesende): ?string
{
    if ($wert === null) { return null; }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $wert)) {
        return $wert . ($tagesende ? ' 23:59:59' : ' 00:00:00');
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/', $wert)) {
        return str_replace('T', ' ', $wert) . ':00';
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/', $wert)) {
        return str_replace('T', ' ', $wert);
    }
    json_response(['status' => 'error',
        'message' => 'Zeitangabe im Format JJJJ-MM-TT oder JJJJ-MM-TT HH:MM erwartet'], 400);
}

$ab  = mitteilung_zeit($ab, false);
$bis = mitteilung_zeit($bis, true);

if ($ab !== null && $bis !== null && $bis < $ab) {
    json_response(['status' => 'error',
        'message' => '„Sichtbar bis" liegt vor „sichtbar ab" — so erscheint die Mitteilung nie.'], 400);
}

// Der Verfassername wird MITGESCHRIEBEN, nicht nur die id. Eine Mitteilung
// ist ein Beleg: Wer sie in zwei Jahren liest, soll sehen, von wem sie kam,
// auch wenn die Person den Betrieb verlassen hat und ihr Konto geloescht
// wurde (dann steht die id auf NULL, der Name bleibt).
//
// Die Sitzung fuehrt nur id/name/Rollen (require_session in db.php) -- der
// buergerliche Name wird darum hier geholt und nicht aus $user geraten.
$vn = $pdo->prepare('SELECT vorname, nachname FROM mitarbeiter WHERE id = ?');
$vn->execute([(int)$user['id']]);
$p = $vn->fetch() ?: [];
$verfasser = trim((string)($p['vorname'] ?? '') . ' ' . (string)($p['nachname'] ?? ''));
// Kein Name gepflegt: dann der Anmeldename. Leer bliebe es nie -- eine
// Mitteilung ohne erkennbaren Absender ist genau das, was sie von einem
// Gruppenchat unterscheiden soll.
if ($verfasser === '') { $verfasser = (string)($user['name'] ?? ''); }

if ($id > 0) {
    $st = $pdo->prepare(
        'UPDATE mitteilungen
            SET titel = ?, text = ?, zielgruppe = ?, stufe = ?, sichtbar_ab = ?, sichtbar_bis = ?
          WHERE id = ?'
    );
    $st->execute([$titel, $text, $zielgruppe, $stufe, $ab, $bis, $id]);
    json_response(['status' => 'ok', 'id' => $id, 'angelegt' => false]);
}

$st = $pdo->prepare(
    'INSERT INTO mitteilungen
       (titel, text, zielgruppe, stufe, sichtbar_ab, sichtbar_bis, verfasser_id, verfasser_name, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
$st->execute([$titel, $text, $zielgruppe, $stufe, $ab, $bis,
    (int)$user['id'], $verfasser, date('Y-m-d H:i:s')]);

json_response(['status' => 'ok', 'id' => (int)$pdo->lastInsertId(), 'angelegt' => true]);
