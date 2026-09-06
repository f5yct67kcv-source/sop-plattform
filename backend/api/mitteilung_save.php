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
require_once __DIR__ . '/../push.php';

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
// Art und die drei Termin-Felder (ENT-436). Ein Termin ist eine Mitteilung,
// die zusaetzlich eine Antwort verlangt -- darum dieselbe Tabelle und
// derselbe Endpunkt.
$art        = trim((string)($in['art'] ?? 'info'));
$ort        = mb_substr(trim((string)($in['ort'] ?? '')), 0, 120);

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
if (!mitteilung_art_gueltig($art)) {
    json_response(['status' => 'error', 'message' => "Art muss 'info' oder 'termin' sein"], 400);
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

// ── Termin (ENT-436)
$beginn = mitteilung_zeit(trim((string)($in['beginn'] ?? '')) ?: null, false);
$ende   = mitteilung_zeit(trim((string)($in['ende'] ?? ''))   ?: null, true);
if ($art !== 'termin') {
    // Wer die Art zurueckstellt, soll keine Zeitangaben behalten, die
    // nirgends mehr stehen -- sie kaemen beim naechsten Umschalten
    // unerwartet wieder hervor.
    $beginn = null; $ende = null; $ort = '';
} else {
    if ($beginn === null) {
        json_response(['status' => 'error',
            'message' => 'Ein Termin braucht einen Beginn — ohne ihn lässt sich nicht zu- oder absagen.'], 400);
    }
    if ($ende !== null && $ende < $beginn) {
        json_response(['status' => 'error', 'message' => 'Das Ende liegt vor dem Beginn.'], 400);
    }
    // Ein Termin verschwindet von selbst, wenn er vorbei ist: Danach gibt
    // es nichts mehr zuzusagen, und er stuende sonst in der App wie eine
    // offene Frage. Ausdruecklich gesetzt statt als Sonderregel im Lesen --
    // so gilt fuer Termine dieselbe Sichtbarkeitsregel wie fuer alles
    // andere (mitteilungen.php), und die Verwaltung kann sie ueberschreiben.
    if ($bis === null) { $bis = $ende ?? $beginn; }
}

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
            SET titel = ?, text = ?, zielgruppe = ?, stufe = ?, art = ?,
                beginn = ?, ende = ?, ort = ?, sichtbar_ab = ?, sichtbar_bis = ?
          WHERE id = ?'
    );
    $st->execute([$titel, $text, $zielgruppe, $stufe, $art, $beginn, $ende, $ort, $ab, $bis, $id]);
    json_response(['status' => 'ok', 'id' => $id, 'angelegt' => false]);
}

$jetzt = date('Y-m-d H:i:s');
$st = $pdo->prepare(
    'INSERT INTO mitteilungen
       (titel, text, zielgruppe, stufe, art, beginn, ende, ort,
        sichtbar_ab, sichtbar_bis, verfasser_id, verfasser_name, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
$st->execute([$titel, $text, $zielgruppe, $stufe, $art, $beginn, $ende, $ort, $ab, $bis,
    (int)$user['id'], $verfasser, $jetzt]);
$neueId = (int)$pdo->lastInsertId();

// ── Benachrichtigung (ENT-424)
// NUR beim Anlegen, nicht beim Aendern: Eine korrigierte Schreibweise darf
// nicht ein zweites Mal das Telefon klingeln lassen. Und NUR, wenn die
// Mitteilung jetzt schon sichtbar ist -- eine vorbereitete holt der
// Nachzuegler-Versand ab (api/push_versand.php), sonst klingelte es zu
// etwas, das in der App noch gar nicht steht.
//
// Der Versand haengt am selben Aufruf wie das Speichern. Das ist Absicht:
// Die Person, die gerade auf "Veroeffentlichen" gedrueckt hat, soll in der
// Antwort sehen, ob es hinausging. Ein misslungener Versand darf das
// Speichern aber NICHT zuruecknehmen -- die Mitteilung steht dann in der
// App, nur ohne Klingeln, und das ist der bessere der beiden Fehler.
$bilanz = null;
if (push_konfiguriert() && hat_tabelle($pdo, 'push_abo')
    && mitteilung_sichtbar_fuer(
        ['archiviert_am' => null, 'zielgruppe' => $zielgruppe,
         'sichtbar_ab' => $ab, 'sichtbar_bis' => $bis], true, $jetzt)) {
    try {
        $bilanz = push_fuer_mitteilung($pdo, [
            'zielgruppe' => $zielgruppe, 'stufe' => $stufe, 'verfasser_id' => (int)$user['id'],
        ], $jetzt);
        push_mitteilung_vermerken($pdo, $neueId, $bilanz, $jetzt);
    } catch (Throwable $e) {
        // Bewusst verschluckt und NICHT als Fehler zurueckgegeben: siehe
        // oben. Die Mitteilung bleibt gespeichert; push_gesendet_am bleibt
        // leer, damit der Nachzuegler-Lauf es erneut versucht.
        $bilanz = null;
    }
}

json_response(['status' => 'ok', 'id' => $neueId, 'angelegt' => true, 'push' => $bilanz]);
