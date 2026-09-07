<?php
declare(strict_types=1);
// Nachzuegler-Versand fuer vorbereitete Mitteilungen (ENT-424).
//
// Die eben veroeffentlichte Mitteilung loest den Versand direkt beim
// Speichern aus (mitteilung_save.php). Eine mit "sichtbar ab" in der
// Zukunft kann das nicht -- niemand ist zu diesem Zeitpunkt am Werkzeug.
// Dieser Endpunkt holt das nach.
//
// ZWEI WEGE HINEIN, und sie sind verschieden abgesichert:
//
//  1. ZEITGEBER (Hostpoint-Cronjob). Ruft die Adresse mit ?schluessel=…
//     auf. Der Schluessel wird beim Deploy gesetzt; ohne ihn ist dieser
//     Weg zu. KEINE Sitzung noetig -- ein Cronjob hat keine.
//  2. ANGEMELDETE PERSON mit dem Recht 'mitteilungen'. Damit sich der
//     Versand von Hand ausloesen und der Zustand ansehen laesst, ohne auf
//     den Zeitgeber zu warten.
//
// WARUM BEIDES: Ein Zeitgeber, den niemand eingerichtet hat, ist eine
// stille Luecke -- die vorbereitete Mitteilung erschiene in der App, aber
// das Telefon klingelte nie. Als Rueckfall holt darum die Mitteilungsseite
// im Cockpit den Nachlauf beilaeufig nach (mitteilung_list.php).
//
// BEWUSST NICHT in meine_mitteilungen.php: Dort wartete eine Mitarbeiterin
// beim Oeffnen der App darauf, dass ihr Telefon dreissig Push-Dienste
// anschreibt. Der Beilaeufer gehoert dorthin, wo ohnehin die Verwaltung
// sitzt und eine Sekunde nicht stoert -- nicht in den Weg der Leute
// draussen.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../push.php';

// Beim Deploy ersetzt. Ungesetzt heisst: Der Zeitgeber-Weg ist zu.
const PUSH_ZEITGEBER_SCHLUESSEL = '__PUSH_CRON_SCHLUESSEL__';

$mitgegeben = (string)($_GET['schluessel'] ?? '');
$lage = push_zeitgeber_lage(PUSH_ZEITGEBER_SCHLUESSEL, $mitgegeben);

// Die drei Fehlerlagen sagen, WAS zu tun ist -- jede verlangt einen
// anderen Handgriff an einer anderen Stelle. Beim Einrichten kamen sie
// alle als "kein Token" heraus (die Meldung der Sitzungspruefung, in die
// der Aufruf hineinlief), und das Suchen ging in die falsche Richtung.
//
// Nur wer einen Schluessel MITGIBT, bekommt diese Antworten. Wer keinen
// mitgibt, laeuft weiter in die Sitzungspruefung -- das ist der Weg fuer
// die angemeldete Person aus dem Cockpit, und der darf nicht erfahren,
// dass es einen zweiten Weg gibt.
if ($lage === 'nicht_eingerichtet' && $mitgegeben !== '') {
    json_response(['status' => 'error', 'zeitgeber' => $lage,
        'message' => 'Der Zeitgeber-Zugang ist auf dem Server nicht eingerichtet — '
            . 'das Secret PUSH_CRON_SCHLUESSEL fehlt, oder seit dem Setzen ist kein Deploy gelaufen.'], 401);
}
if ($lage === 'falscher_schluessel') {
    json_response(['status' => 'error', 'zeitgeber' => $lage,
        'message' => 'Der Schlüssel in der Adresse stimmt nicht mit dem hinterlegten überein.'], 401);
}

if ($lage !== 'ok') {
    // Kein Schluessel mitgegeben: dann muss es eine angemeldete Person mit
    // dem Recht sein. require_session() beendet mit 401, require_recht mit
    // 403 -- beides bevor irgendetwas verschickt wird.
    $user = require_session();
    require_recht($user, 'mitteilungen_schreiben');
}

$pdo = db();
$jetzt = date('Y-m-d H:i:s');

if (!hat_tabelle($pdo, 'mitteilungen') || !hat_tabelle($pdo, 'push_abo')) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'verschickt' => 0,
        'meldung' => 'Die Tabellen fehlen — einmal „Einrichtung" ausführen.']);
}
if (!push_konfiguriert()) {
    // NICHT als Fehler: Der Zeitgeber laeuft jede Viertelstunde, ein
    // Fehlschlag je Lauf fuellte das Protokoll ohne neuen Erkenntniswert.
    // Aber auch nicht als Erfolg -- die Antwort sagt ausdruecklich, dass
    // nichts eingerichtet ist.
    json_response(['status' => 'ok', 'eingerichtet' => false, 'verschickt' => 0,
        'meldung' => 'Auf dem Server fehlt der Push-Schlüssel.']);
}

$faellig = push_faellige_mitteilungen($pdo, $jetzt);
$bilanzen = [];
foreach ($faellig as $m) {
    $b = push_fuer_mitteilung($pdo, $m, $jetzt);
    // Auch dann vermerken, wenn es null Geraete waren: Sonst versuchte es
    // jeder Lauf erneut, und eine Mitteilung von vor drei Monaten
    // klingelte, sobald sich jemand neu anmeldet.
    push_mitteilung_vermerken($pdo, (int)$m['id'], $b, $jetzt);
    $bilanzen[] = ['id' => (int)$m['id'], 'bilanz' => $b];
}

json_response([
    'status'       => 'ok',
    'eingerichtet' => true,
    'verschickt'   => count($bilanzen),
    'mitteilungen' => $bilanzen,
]);
