<?php
// Ein einzelner Beleg mit allen Positionen (ENT-181) -- fuer das Formular
// und fuer die Druckvorlage.
//
// Die Summen kommen frisch gerechnet mit, nicht nur aus den abgelegten
// Spalten: Weichen beide ab, ist etwas an den Positionen vorbeigelaufen, und
// dann soll das Formular die Wahrheit zeigen, nicht den Abdruck.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../belege.php';
require __DIR__ . '/../kunden.php';
require_once __DIR__ . '/../logbuch.php';

$user = require_session();
require_recht($user, 'offerten_lesen');

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$pdo = db();
$beleg = beleg_lesen($pdo, $id);
if (!$beleg) {
    json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
}

// Empfaenger: Kunde und, falls genannt, die Ansprechperson. LIVE gelesen --
// der Beleg haelt heute keinen Adress-Schnappschuss (siehe OP-108).
$kunde = null;
if ($beleg['kunde_id']) {
    $s = $pdo->prepare(
        'SELECT id, kundennummer, art, name, zusatzfeld, strasse, hausnummer,
                adresszusatz, plz, ort, uid, mwst_nr,
                re_name, re_zusatz, re_strasse, re_hausnummer, re_plz, re_ort
           FROM kunden WHERE id = ?'
    );
    $s->execute([(int)$beleg['kunde_id']]);
    $kunde = $s->fetch() ?: null;
}

$person = null;
if ($beleg['person_id']) {
    $s = $pdo->prepare('SELECT * FROM kunden_person WHERE id = ?');
    $s->execute([(int)$beleg['person_id']]);
    $person = $s->fetch() ?: null;
}

// Der Stand der Fassungen (ENT-688), siehe betreiber_beleg_lesen.php.
try {
    $fassung = beleg_fassung_stand($pdo, $beleg, '', beleg_absender_betrieb($pdo));
} catch (Throwable $e) {
    $fassung = null;
}

// Der Verlauf (ENT-697). Scheitert er, fehlt er ganz (null) -- die Karte
// sagt dann "nicht abrufbar" statt "nichts passiert".
try {
    $verlauf = beleg_verlauf($pdo, $beleg, '');
} catch (Throwable $e) {
    $verlauf = null;
}

json_response(['status' => 'ok', 'beleg' => $beleg, 'kunde' => $kunde, 'person' => $person,
    'fassung' => $fassung, 'verlauf' => $verlauf]);
