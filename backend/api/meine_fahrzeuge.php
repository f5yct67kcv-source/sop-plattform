<?php
// Fahrzeuge für die eigene Übernahme (ENT-340).
//
// GET ?kennung=…  -> das EINE Fahrzeug hinter dem gescannten Aufkleber
// GET             -> die Liste der Fahrzeuge im Betrieb (Rückfallweg, wenn
//                    der Aufkleber fehlt oder die Kamera streikt), dazu die
//                    Auskunft, ob die Person heute schon geantwortet hat
//
// NICHT admin-only, wie meine_schichten.php: Jede eingeteilte Person nimmt
// Fahrzeuge. Herausgegeben wird nur, was für die Übernahme nötig ist --
// Kontrollschild und Bezeichnung. Insbesondere geht die qr_kennung NIE
// hinaus: Wer sie kennt, könnte eine Übernahme für ein Fahrzeug buchen, vor
// dem er nie gestanden hat. Aufgelöst wird ausschliesslich hier im Server.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../fahrzeug.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$pdo = db();
// Vor dem naechsten Einrichtungslauf gibt es weder Tabelle noch Spalte. Das
// ist kein Fehler -- aber auch NICHT dasselbe wie "keine Fahrzeuge". Die App
// muss beides verschieden benennen koennen.
$eingerichtet = hat_tabelle($pdo, 'fahrzeuge') && hat_tabelle($pdo, 'fahrzeug_uebernahme');
if (!$eingerichtet) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'fahrzeuge' => [],
                   'heute_beantwortet' => false]);
}
$hatKennung = hat_spalte($pdo, 'fahrzeuge', 'qr_kennung');

$kennung = trim((string)($_GET['kennung'] ?? ''));
if ($kennung !== '') {
    if (!$hatKennung) {
        json_response(['status' => 'error', 'message' => 'Aufkleber sind noch nicht eingerichtet.'], 422);
    }
    $s = $pdo->prepare('SELECT id, kennzeichen, bezeichnung, status FROM fahrzeuge WHERE qr_kennung = ?');
    $s->execute([$kennung]);
    $f = $s->fetch(PDO::FETCH_ASSOC);
    if (!$f) {
        // Bewusst dieselbe Meldung fuer "gibt es nicht" wie fuer "gehoert
        // nicht uns": Wer Kennungen durchprobiert, soll daraus nichts lernen.
        json_response(['status' => 'error', 'message' => 'Dieser Aufkleber gehört zu keinem Fahrzeug.'], 404);
    }
    json_response(['status' => 'ok', 'eingerichtet' => true, 'fahrzeug' => [
        'id' => (int)$f['id'], 'kennzeichen' => $f['kennzeichen'],
        'bezeichnung' => $f['bezeichnung'], 'status' => $f['status'],
        'letzter_stand' => fz_bezugsstand($pdo, (int)$f['id'], (int)$user['id']),
    ]]);
}

// Nur Fahrzeuge im Betrieb -- ein verkauftes oder stillgelegtes laesst sich
// nicht uebernehmen, und es zur Wahl anzubieten hiesse, einen Fehler
// einzuladen.
$liste = $pdo->query(
    "SELECT id, kennzeichen, bezeichnung FROM fahrzeuge WHERE status = 'aktiv' ORDER BY kennzeichen"
)->fetchAll(PDO::FETCH_ASSOC);

// Hat diese Person heute schon geantwortet? Danach richtet sich, ob die
// Frage vor dem Rundgang noch einmal kommt. Beide Antwortarten zaehlen --
// wer ausdruecklich "kein Fahrzeug" gesagt hat, soll nicht erneut gefragt
// werden.
$b = $pdo->prepare('SELECT COUNT(*) FROM fahrzeug_uebernahme
                    WHERE mitarbeiter_id = ? AND DATE(zeitpunkt) = CURDATE()');
$b->execute([(int)$user['id']]);

// Der bekannte Stand kommt bei JEDEM Fahrzeug gleich mit, statt beim
// Umschalten der Auswahl einzeln nachgeladen zu werden. Zwei Gruende: Ein
// Betrieb hat eine Handvoll Fahrzeuge, nicht Tausende -- und ein Nachladen
// je Auswahl waere ein Wettlauf, an dessen Ende der Stand des VORIGEN
// Fahrzeugs neben dem neuen stehen kann. Eine Zahl am falschen Auto ist
// schlimmer als keine.
// Das eigene aktuell aktive Fahrzeug (ENT-354) -- rein informativ fuer die
// eigene Maske, siehe fz_meine_aktiv() in fahrzeug.php.
$meinAktiv = fz_meine_aktiv($pdo, (int)$user['id']);

json_response([
    'status' => 'ok',
    'eingerichtet' => true,
    'fahrzeuge' => array_map(fn($f) => [
        'id' => (int)$f['id'], 'kennzeichen' => $f['kennzeichen'], 'bezeichnung' => $f['bezeichnung'],
        'letzter_stand' => fz_bezugsstand($pdo, (int)$f['id'], (int)$user['id']),
    ], $liste),
    'heute_beantwortet' => (int)$b->fetchColumn() > 0,
    'mein_aktives_fahrzeug' => $meinAktiv,
]);
