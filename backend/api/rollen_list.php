<?php
declare(strict_types=1);
// Alles, was die zentrale Seite "Rollen & Berechtigungen" braucht, in EINER
// Antwort (ENT-440).
//
// Warum in einer: Die Seite zeigt drei Dinge, die nur zusammen eine Aussage
// ergeben -- welche Profile es gibt, was jedes darf, und wer welches traegt.
// Drei Aufrufe hiessen drei Zeitpunkte; waehrend der Luecke stuende auf dem
// Schirm eine Zuteilung zu einem Profil, das die Maske noch nicht kennt.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../mitarbeiter.php';

$user = require_session();
require_recht($user, 'rechte_lesen');

$pdo = db();

// "Noch nicht eingerichtet" ist eine eigene Aussage und darf nie wie "keine
// Profile" aussehen (Projektregel). Die Oberflaeche unterscheidet beides.
$eingerichtet = rollen_tabellen_da($pdo);
$defs = rollen_definitionen($pdo);

// Wer traegt welches Profil? Eine Abfrage statt einer je Profil.
$traeger = [];
foreach (rechte_rollen_alle($pdo) as $maId => $rollen) {
    foreach ($rollen as $r) { $traeger[$r][] = (int)$maId; }
}

$profile = [];
foreach ($defs as $schluessel => $d) {
    $profile[] = [
        'schluessel' => $schluessel,
        'titel'      => $d['titel'],
        'text'       => $d['text'],
        'system'     => (bool)($d['system'] ?? ist_systemrolle($schluessel)),
        'stufen'     => (object)$d['stufen'],
        'traeger'    => count($traeger[$schluessel] ?? []),
    ];
}

// Die Bereiche kommen vom Server und nicht aus einer zweiten Liste im
// Browser: Der Server weist ab, was er nicht kennt -- eine eigene Liste im
// Cockpit waere eine zweite Wahrheit, die beim naechsten neuen Bereich
// auseinanderlaeuft.
$bereiche = [];
foreach (bereiche_katalog() as $schluessel => $d) {
    $bereiche[] = [
        'schluessel' => $schluessel,
        'gruppe'     => $d['gruppe'],
        'titel'      => $d['titel'],
        'text'       => $d['text'],
        'stufen'     => $d['stufen'],
    ];
}

// Die Personen mit ihren Profilen UND den drei Einsatzmerkmalen. Die
// Bewilligungsdaten kommen mit, damit die Seite ein gesetztes Haekchen ohne
// gueltige Bewilligung beanstanden kann -- das Datum selbst wird weiterhin
// in der Personalakte gepflegt (ENT-440).
$leute = $pdo->query(
    'SELECT id, name, vorname, nachname, personalnummer, aktiv, ist_admin,
            diensthundefuehrer, waffentragberechtigt, revierdienst_berechtigt,
            diensthund_bewilligung_bis, waffe_bewilligung_bis
       FROM mitarbeiter ORDER BY nachname, vorname, name'
)->fetchAll();
$rollenAlle = rechte_rollen_alle($pdo);
foreach ($leute as &$p) {
    $p['rollen'] = $rollenAlle[(int)$p['id']]
        ?? [$p['ist_admin'] ? ROLLE_VERWALTUNG : ROLLE_MITARBEITEND];
}
unset($p);

json_response([
    'status'        => 'ok',
    'eingerichtet'  => $eingerichtet,
    'bereiche'      => $bereiche,
    'profile'       => $profile,
    'personen'      => $leute,
    // Getrennt ausgewiesen: Die Seite zeigt den Zuteil- und den
    // Profilteil auch dem, der nur zusehen darf -- aber ohne Schalter.
    'darf_aendern'  => darf($user, 'rechte_schreiben'),
    'darf_merkmale' => darf($user, 'personal_schreiben'),
]);
