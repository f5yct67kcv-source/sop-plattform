<?php
declare(strict_types=1);
// Auf einen Termin zu- oder absagen (ENT-436).
//
// Kein Recht, sondern strikt eigene Daten: Wer einen Termin sieht, darf auf
// ihn antworten -- das ist der Sinn der Sache. Die mitarbeiter_id stammt
// ausnahmslos aus der Sitzung, nie aus der Anfrage. Darum steht dieser
// Endpunkt namentlich in der NUR_EIGENE_DATEN-Liste von test_php.mjs, wie
// meine_mitteilungen.php und meine_zusage.php.
//
// EIGENER ENDPUNKT und kein Zusatzschalter in meine_mitteilungen.php: Dort
// wird ein Lesestand vermerkt -- etwas, das beim blossen Anzeigen
// geschieht. Hier gibt jemand eine Erklaerung ab, auf die sich die
// Verwaltung verlaesst. Zwei verschiedene Vorgaenge hinter einem Schalter
// waeren die Sorte Stelle, an der aus "hat die Liste geoeffnet" eine
// Zusage wird.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../mitteilungen.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
$ich  = (int)$user['id'];
$pdo  = db();
$jetzt = date('Y-m-d H:i:s');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
if (!hat_tabelle($pdo, 'mitteilungen')) {
    json_response(['status' => 'error', 'message' => 'Die Mitteilungen sind noch nicht eingerichtet.'], 400);
}

$in      = json_decode(file_get_contents('php://input'), true) ?? [];
$id      = (int)($in['id'] ?? 0);
$antwort = trim((string)($in['antwort'] ?? ''));

// 'offen' wird ABGEWIESEN, nicht durchgereicht: Es ist der Ausgangszustand,
// keine Erklaerung. Waere es hier erlaubt, liesse sich eine abgegebene
// Zusage still zuruecknehmen -- "hat nie geantwortet" und "hat zugesagt und
// es sich anders ueberlegt" sind zwei verschiedene Sachverhalte.
if (!termin_antwort_gueltig($antwort)) {
    json_response(['status' => 'error', 'message' => "Antwort muss 'zugesagt' oder 'abgesagt' sein"], 400);
}

// Dieselbe Quelle wie ueberall (ENT-284) -- ob jemand einen Revier-Termin
// sehen darf, entscheidet die Personalakte.
$revier = revierdienst_zugang($pdo, $ich);

// Geantwortet werden darf nur auf einen Termin, den diese Person auch sieht.
// Ohne diese Bedingung liesse sich ueber geratene Nummern herausfinden,
// welche Termine es gibt -- und in der Verwaltung stuende eine Zusage von
// jemandem, der gar nicht eingeladen war.
$st = $pdo->prepare('SELECT m.id, m.art FROM mitteilungen m
                      WHERE m.id = ? AND ' . mitteilung_sql_sichtbar());
$st->execute(array_merge([$id], mitteilung_sql_werte($revier, $jetzt)));
$m = $st->fetch();
if (!$m) {
    json_response(['status' => 'error', 'message' => 'Diesen Termin gibt es für dich nicht.'], 404);
}
// Eine Mitteilung ist kein Termin. Die Antwort stuende sonst in der
// Verwaltung an etwas, das nie eine Frage war.
if (!mitteilung_ist_termin($m)) {
    json_response(['status' => 'error',
        'message' => 'Das ist eine Mitteilung, kein Termin — darauf lässt sich nicht zu- oder absagen.'], 400);
}

// Eine Antwort laesst sich aendern, solange der Termin sichtbar ist: Wer
// zusagt und dann doch krank wird, soll das melden koennen. Nach dem
// Termin ist er nicht mehr sichtbar (siehe mitteilung_save.php) -- dann
// greift schon die Bedingung oben.
termin_antwort_merken($pdo, $id, $ich, $antwort, $jetzt);

json_response(['status' => 'ok', 'id' => $id, 'antwort' => $antwort]);
