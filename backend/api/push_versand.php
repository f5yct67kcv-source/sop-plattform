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

function push_zeitgeber_offen(): bool
{
    $s = PUSH_ZEITGEBER_SCHLUESSEL;
    return $s !== '' && !str_starts_with($s, '__PUSH_CRON');
}

$mitgegeben = (string)($_GET['schluessel'] ?? '');
// hash_equals statt === : Ein Vergleich, der beim ersten falschen Zeichen
// abbricht, verraet ueber die Antwortzeit, wie viele Zeichen stimmen.
$perZeitgeber = push_zeitgeber_offen() && $mitgegeben !== ''
    && hash_equals(PUSH_ZEITGEBER_SCHLUESSEL, $mitgegeben);

if (!$perZeitgeber) {
    // Kein gueltiger Schluessel: dann muss es eine angemeldete Person mit
    // dem Recht sein. require_session() beendet mit 401, require_recht mit
    // 403 -- beides bevor irgendetwas verschickt wird.
    $user = require_session();
    require_recht($user, 'mitteilungen');
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
