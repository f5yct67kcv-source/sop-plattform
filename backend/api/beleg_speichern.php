<?php
// Beleg anlegen oder aendern, samt Positionen (ENT-181).
//
// EIN Endpunkt fuer beides, wie bei produkt_speichern.php. Alles laeuft in
// EINER Transaktion: Kopfdaten, Positionen und die daraus gerechneten Summen
// gehoeren zusammen -- ein Beleg mit neuen Positionen und alten Summen waere
// schlimmer als gar kein Beleg.
//
// DIE SUMMEN AUS DER EINGABE WERDEN IGNORIERT. Der Browser schickt sie mit,
// weil er sie fuer die Live-Anzeige ohnehin gerechnet hat -- gespeichert wird
// aber ausschliesslich, was beleg_summen_schreiben() aus den tatsaechlich
// abgelegten Positionen ermittelt. Was auf ein Kundendokument geht, rechnet
// der Server.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../belege.php';

$user = require_session();
require_recht($user, 'offerten');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id  = (int)($in['id'] ?? 0);
$art = (string)($in['art'] ?? 'offerte');
if (!beleg_art_gueltig($art)) {
    json_response(['status' => 'error', 'message' => 'Unbekannte Belegart'], 400);
}

$status = (string)($in['status'] ?? 'entwurf');
if (!beleg_status_gueltig($status)) {
    json_response(['status' => 'error', 'message' => 'Unbekannter Status'], 400);
}

$datum = (string)($in['datum'] ?? '');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum)) {
    json_response(['status' => 'error', 'message' => 'Ein Offertendatum ist erforderlich.'], 400);
}
$gueltigBis = (string)($in['gueltig_bis'] ?? '');
$gueltigBis = preg_match('/^\d{4}-\d{2}-\d{2}$/', $gueltigBis) ? $gueltigBis : null;
// Ein Ablaufdatum VOR dem Offertendatum ist keine Frist, sondern ein
// Tippfehler -- und eine Offerte, die schon abgelaufen ist, bevor sie
// geschrieben wurde, wuerde in jeder Liste falsch einsortiert.
if ($gueltigBis !== null && $gueltigBis < $datum) {
    json_response(['status' => 'error',
        'message' => '„Gültig bis" liegt vor dem Offertendatum.'], 400);
}

$kopf = [
    'kunde_id'    => ($in['kunde_id'] ?? null) ? (int)$in['kunde_id'] : null,
    'person_id'   => ($in['person_id'] ?? null) ? (int)$in['person_id'] : null,
    'titel'       => mb_substr(trim((string)($in['titel'] ?? '')), 0, 200),
    'referenz'    => mb_substr(trim((string)($in['referenz'] ?? '')), 0, 100),
    'datum'       => $datum,
    'gueltig_bis' => $gueltigBis,
    'status'      => $status,
    'bemerkung'   => trim((string)($in['bemerkung'] ?? '')),
    'ist_vorlage' => !empty($in['ist_vorlage']) ? 1 : 0,
];
$rabattBp = max(0, min(10000, (int)round((float)($in['rabatt_bp'] ?? 0))));

// Positionen: leere Zeilen fallen weg. Eine Zeile gilt als leer, wenn sie
// weder Namen noch Beschreibung noch Preis traegt -- ein reiner Textblock
// (Preis 0, aber mit Text) muss bleiben, den gibt es auf jeder zweiten
// Offerte.
$positionen = [];
foreach ((array)($in['positionen'] ?? []) as $p) {
    $z = beleg_position_lesen((array)$p);
    if ($z['produkt_name'] === '' && $z['beschreibung'] === '' && $z['einzelpreis_rappen'] === 0) {
        continue;
    }
    $positionen[] = $z;
}

$pdo = db();
$pdo->beginTransaction();
try {
    if ($id > 0) {
        $chk = $pdo->prepare('SELECT id FROM belege WHERE id = ?');
        $chk->execute([$id]);
        if (!$chk->fetch()) {
            $pdo->rollBack();
            json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
        }
        $satz = implode(', ', array_map(fn($f) => "$f = ?", array_keys($kopf)));
        $pdo->prepare("UPDATE belege SET $satz WHERE id = ?")
            ->execute(array_merge(array_values($kopf), [$id]));
        $nummer = null;
    } else {
        // Die Nummer vergibt ausschliesslich der Server, fortlaufend und
        // danach unveraenderlich -- wie die Kundennummer (ENT-040). Ein
        // mitgeschicktes Feld wird bewusst nicht gelesen.
        $nummer = beleg_naechste_nummer($pdo, $art);
        $spalten = array_merge(['art', 'nummer'], array_keys($kopf));
        $werte   = array_merge([$art, $nummer], array_values($kopf));
        $pdo->prepare(
            'INSERT INTO belege (' . implode(', ', $spalten) . ') VALUES (?'
            . str_repeat(', ?', count($spalten) - 1) . ')'
        )->execute($werte);
        $id = (int)$pdo->lastInsertId();
    }

    beleg_positionen_schreiben($pdo, $id, $positionen);
    $summen = beleg_summen_schreiben($pdo, $id, $rabattBp);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

$antwort = ['status' => 'ok', 'id' => $id, 'summen' => $summen];
if ($nummer !== null) { $antwort['nummer'] = $nummer; }
json_response($antwort);
