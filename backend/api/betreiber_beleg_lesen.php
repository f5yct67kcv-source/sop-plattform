<?php
// Ein einzelner Beleg der Betreiberin mit allen Positionen (ENT-605) --
// fuer das Formular und fuer die Druckvorlage.
//
// Die Summen kommen frisch gerechnet mit, nicht nur aus den abgelegten
// Spalten: Weichen beide ab, ist etwas an den Positionen vorbeigelaufen,
// und dann soll das Formular die Wahrheit zeigen, nicht den Abdruck.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';

require_betreiber_voll();

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'be_belege')) {
    json_response(['status' => 'error',
        'message' => 'Der Offertenteil ist noch nicht eingerichtet.'], 503);
}

$beleg = beleg_lesen($pdo, $id, 'be_');
if (!$beleg) {
    json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
}

// Empfaenger LIVE gelesen, kein Adress-Schnappschuss am Beleg -- gleiche
// Entscheidung wie im Cockpit (OP-108): Zieht ein Betrieb um, soll der
// Nachdruck die neue Adresse zeigen.
$kunde = null;
if ($beleg['kunde_id']) {
    $s = $pdo->prepare(
        'SELECT id, kundennummer, art, name, zusatzfeld, strasse, hausnummer,
                adresszusatz, plz, ort, uid, mwst_nr, email,
                re_name, re_zusatz, re_strasse, re_hausnummer, re_plz, re_ort
           FROM be_kunden WHERE id = ?'
    );
    $s->execute([(int)$beleg['kunde_id']]);
    $kunde = $s->fetch() ?: null;
}

$person = null;
if ($beleg['person_id']) {
    $s = $pdo->prepare('SELECT * FROM be_kunden_person WHERE id = ?');
    $s->execute([(int)$beleg['person_id']]);
    $person = $s->fetch() ?: null;
}

json_response(['status' => 'ok', 'beleg' => $beleg, 'kunde' => $kunde, 'person' => $person]);
