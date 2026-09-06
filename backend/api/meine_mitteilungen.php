<?php
declare(strict_types=1);
// Die Mitteilungen, die mich angehen -- lesen und als gelesen vermerken
// (ENT-421).
//
// Nicht hinter einem der Rechte, sondern strikt auf die eigene Person
// begrenzt: JEDE angemeldete Person bekommt Mitteilungen, das ist der Sinn
// der Sache. Die mitarbeiter_id stammt ausnahmslos aus der Sitzung, nie aus
// der Anfrage -- darum steht dieser Endpunkt namentlich in der
// NUR_EIGENE_DATEN-Liste von test_php.mjs, wie meine_abwesenheit.php und
// meine_schichten.php.
//
// Welche Mitteilungen jemand sieht, entscheidet mitteilungen.php und sonst
// nichts. Hier wird die Bedingung nicht nachgebaut.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../mitteilungen.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
$ich  = (int)$user['id'];
$pdo  = db();
$jetzt = date('Y-m-d H:i:s');

// Ohne die Tabellen (Einrichtung noch nicht gelaufen) ist die Antwort NICHT
// "keine Mitteilungen" -- das waere eine Falschauskunft. Sie sagt, dass die
// Funktion noch nicht eingerichtet ist; die Oberflaeche unterscheidet beides
// (Hausregel: "unbekannt" darf nie wie "keine" aussehen).
if (!hat_tabelle($pdo, 'mitteilungen')) {
    json_response(['status' => 'ok', 'eingerichtet' => false,
        'mitteilungen' => [], 'ungelesen' => 0, 'revier_ungelesen' => 0]);
}

// Dieselbe Quelle wie der Waechter-Reiter und die vier Revierdienst-
// Endpunkte (ENT-284): das in der Personalakte gesetzte Merkmal.
$revier = revierdienst_zugang($pdo, $ich);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int)($in['id'] ?? 0);
    // "bestaetigt" setzt der Wegklick-Knopf des Wichtig-Fensters. Blosses
    // Aufklappen in der Liste setzt ihn nicht -- sonst waere der Nachweis
    // "hat ausdruecklich bestaetigt" nichts mehr wert.
    $bestaetigt = !empty($in['bestaetigt']);

    // Es darf nur vermerkt werden, was diese Person auch sehen darf. Sonst
    // liesse sich ueber geratene Nummern herausfinden, welche Mitteilungen
    // es gibt -- und der Leser-Nachweis der Verwaltung waere erfunden.
    $st = $pdo->prepare('SELECT m.id FROM mitteilungen m WHERE m.id = ? AND ' . mitteilung_sql_sichtbar());
    $st->execute(array_merge([$id], mitteilung_sql_werte($revier, $jetzt)));
    if (!$st->fetchColumn()) {
        json_response(['status' => 'error', 'message' => 'Diese Mitteilung gibt es für dich nicht.'], 404);
    }
    mitteilung_gelesen_merken($pdo, $id, $ich, $bestaetigt, $jetzt);
    json_response(['status' => 'ok', 'id' => $id, 'bestaetigt' => $bestaetigt]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$liste = mitteilungen_fuer_person($pdo, $ich, $revier, $jetzt);

$ungelesen = 0;
$revierUngelesen = 0;
// "Offen" ist mehr als "ungelesen" (ENT-436): Ein gelesener Termin ohne
// Antwort will weiterhin etwas. Je Eintrag zaehlt er hoechstens einmal --
// ein ungelesener Termin ist EIN offener Punkt, nicht zwei.
$offen = 0;
$unterbrechen = [];
foreach ($liste as &$m) {
    $m['gelesen']    = $m['gelesen_am'] !== null;
    $m['bestaetigt'] = $m['bestaetigt_am'] !== null;
    // Die eigene Antwort auf einen Termin (ENT-436) -- 'offen', solange
    // keine vorliegt. Die Antworten der ANDEREN stehen hier bewusst nicht:
    // Wer zu- und wer abgesagt hat, sieht nur die Verwaltung im Cockpit.
    // Eine Absage hat oft einen persoenlichen Grund; sie vor der ganzen
    // Belegschaft abgeben zu muessen, treibt zu Zusagen, die nicht halten.
    $m['ist_termin'] = mitteilung_ist_termin($m);
    $m['antwort']    = $m['ist_termin'] ? termin_antwort($m) : null;
    if (!$m['gelesen']) {
        $ungelesen++;
        if ($m['zielgruppe'] === 'revier') { $revierUngelesen++; }
    }
    if (!$m['gelesen'] || ($m['ist_termin'] && $m['antwort'] === 'offen')) { $offen++; }
    // Was beim Oeffnen der App unterbrechen muss. Der Server entscheidet
    // das, nicht die Oberflaeche: Eine Regel, die nur im Browser steht,
    // laesst sich am Browser vorbei umgehen -- und der Nachweis
    // "bestaetigt" waere dann eine Behauptung.
    if (mitteilung_unterbricht($m)) { $unterbrechen[] = (int)$m['id']; }
}
unset($m);

json_response([
    'status'           => 'ok',
    'eingerichtet'     => true,
    'mitteilungen'     => $liste,
    'ungelesen'        => $ungelesen,
    'offen'            => $offen,
    'revier_ungelesen' => $revierUngelesen,
    'unterbrechen'     => $unterbrechen,
]);
