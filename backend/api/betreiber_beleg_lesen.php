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

// Der Faden am Beleg kommt mit (ENT-677). Kein eigener Aufruf: Wer den
// Beleg oeffnet, sieht das Gespraech an derselben Stelle -- und eine zweite
// Anfrage waere ein zweiter Weg, auf dem sie auseinanderlaufen koennen.
//
// `faden_da` sagt, ob die Tabelle ueberhaupt steht. Ohne diese Angabe waere
// "noch nicht eingerichtet" von "noch nichts geschrieben" nicht zu
// unterscheiden, und die Oberflaeche boete ein Eingabefeld an, das nichts
// entgegennimmt (Hausregel: Unbekannt darf nie wie keine aussehen).
// Der Stand der Fassungen (ENT-688): welche versendet sind, ob der Entwurf
// seither geaendert wurde und ob der Beleg nach einer Annahme gesperrt ist.
// Scheitert das Lesen, fehlt die Angabe ganz -- und die Oberflaeche zeigt
// keinen Fassungs-Chip statt eines falschen.
try {
    $fassung = beleg_fassung_stand($pdo, $beleg, 'be_', be_beleg_absender($pdo));
} catch (Throwable $e) {
    $fassung = null;
}

json_response(['status' => 'ok', 'beleg' => $beleg, 'kunde' => $kunde, 'person' => $person,
    'fassung' => $fassung,
    'faden_da' => be_beleg_nachricht_tabelle_da($pdo),
    'nachrichten' => be_beleg_nachrichten($pdo, $id)]);
