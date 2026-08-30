<?php
declare(strict_types=1);
// Ferien-Anspruch und -Restsaldo einer Person fuer ein Kalenderjahr
// (ENT-252). Rechenkern in ferien.php -- dieser Endpunkt liest nur die
// Eingabedaten zusammen und liefert das Ergebnis aus.
//
// Selbstbedienung UND Fremdsicht im selben Endpunkt (Muster aus
// rapport_list.php, siehe Recherche zu ENT-252): mit personal_lesen jede
// Person, sonst nur die eigene -- everyone darf den eigenen Stand kennen,
// unabhaengig von Rollen.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../mitarbeiter.php';
require_once __DIR__ . '/../ferien.php';

$user = require_session();
$pdo = db();

$mitarbeiterId = (int)($_GET['mitarbeiter_id'] ?? $user['id']);
if ($mitarbeiterId !== (int)$user['id'] && !darf($user, 'personal_lesen')) {
    json_response(['status' => 'error', 'message' => 'Dafür fehlt dir die Berechtigung.'], 403);
}

$jahr = (int)($_GET['jahr'] ?? date('Y'));
if ($jahr < 2000 || $jahr > 2100) {
    json_response(['status' => 'error', 'message' => 'Ungueltiges Jahr'], 400);
}

$vorhanden = ma_vorhandene_felder($pdo);
foreach (['geburtsdatum', 'eintritt', 'anstellungskategorie'] as $feld) {
    if (!array_key_exists($feld, $vorhanden)) {
        // "Nicht eingerichtet" ist etwas anderes als "kein Saldo" -- ein
        // fehlendes Feld darf nie wie eine Null-Zahl aussehen.
        json_response(['status' => 'ok', 'eingerichtet' => false,
            'hinweis' => 'Die Mitarbeitenden-Grunddaten (Geburtsdatum, Eintritt, Anstellungskategorie) sind noch nicht eingerichtet.']);
    }
}

$s = $pdo->prepare('SELECT geburtsdatum, eintritt, austritt, anstellungskategorie
                     FROM mitarbeiter WHERE id = ?');
$s->execute([$mitarbeiterId]);
$ma = $s->fetch(PDO::FETCH_ASSOC);
if (!$ma) {
    json_response(['status' => 'error', 'message' => 'Mitarbeitende(r) nicht gefunden'], 404);
}
if (!$ma['geburtsdatum'] || !$ma['eintritt'] || !$ma['anstellungskategorie']) {
    json_response(['status' => 'ok', 'eingerichtet' => false,
        'hinweis' => 'Geburtsdatum, Eintritt oder Anstellungskategorie fehlen im Personaldatensatz -- kein Saldo berechenbar.']);
}

// Genehmigte lange Abwesenheiten des Jahres fuer die Kuerzung nach Ziff. 5
// (GAV-AUS-012, vorlaeufige Annahme -- siehe ferien_kuerzung_zwoelftel()).
$s = $pdo->prepare(
    "SELECT typ, von, bis FROM abwesenheiten
     WHERE mitarbeiter_id = ? AND status = 'genehmigt'
       AND typ IN ('krankheit','unfall','militaer','schwangerschaft')
       AND von <= ? AND bis >= ?"
);
$s->execute([$mitarbeiterId, "$jahr-12-31", "$jahr-01-01"]);
$kuerzungsZeitraeume = $s->fetchAll(PDO::FETCH_ASSOC);

$ergebnis = ferien_anspruch_jahr(
    (string)$ma['anstellungskategorie'],
    (string)$ma['geburtsdatum'],
    (string)$ma['eintritt'],
    $ma['austritt'],
    $jahr,
    $kuerzungsZeitraeume
);

$bezogen = 0.0;
if ($ergebnis['anspruch_tage'] !== null) {
    // Bezogene Ferientage: genehmigte Ferien-Antraege des Jahres, in
    // Arbeitstagen gezaehlt wie der Anspruch selbst -- kalendarische Tage
    // waeren nicht dieselbe Einheit (ein Wochenende in einem Ferienblock
    // zaehlt nicht als Ferientag).
    $s = $pdo->prepare(
        "SELECT von, bis FROM abwesenheiten
         WHERE mitarbeiter_id = ? AND typ = 'ferien' AND status = 'genehmigt'
           AND von <= ? AND bis >= ?"
    );
    $s->execute([$mitarbeiterId, "$jahr-12-31", "$jahr-01-01"]);
    foreach ($s->fetchAll(PDO::FETCH_ASSOC) as $z) {
        $von = new DateTime(max($z['von'], "$jahr-01-01"));
        $bis = new DateTime(min($z['bis'], "$jahr-12-31"));
        if ($von > $bis) { continue; }
        // Arbeitstage = Kalendertage minus Wochenenden (Sa/So). Feiertage
        // bleiben unberuecksichtigt -- dieselbe vereinfachte Zaehlung, die
        // auch der GAV-Wortlaut selbst benutzt ("Arbeitstage" ohne separate
        // Feiertagsregel in Art. 20).
        for ($d = clone $von; $d <= $bis; $d->modify('+1 day')) {
            $wd = (int)$d->format('N');
            if ($wd < 6) { $bezogen++; }
        }
    }
}

json_response(['status' => 'ok', 'eingerichtet' => true, 'jahr' => $jahr,
    'mitarbeiter_id' => $mitarbeiterId] + $ergebnis + [
    'bezogen_tage' => $bezogen,
    'rest_tage' => $ergebnis['anspruch_tage'] !== null ? round($ergebnis['anspruch_tage'] - $bezogen, 1) : null,
]);
