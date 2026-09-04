<?php
// Einen Einsatz einer Fahrzeugübernahme zuordnen oder die Zuordnung wieder
// lösen (ENT-381).
//
// POST { uebernahme_id, einsatz_id }  -> zuordnen
// POST { uebernahme_id, einsatz_id: null } -> Zuordnung lösen
//
// WARUM NACHTRÄGLICH UND NICHT NUR BEIM ERFASSEN: Die App setzt
// `einsatz_id` schon beim Erfassen (ENT-340), aber nur, wenn sie zu diesem
// Zeitpunkt eine passende eigene Schicht kennt. Wird die Schicht erst
// später angelegt oder zugeteilt -- oder greift jemand zum Fahrzeug, bevor
// die Planung steht --, bleibt das Feld leer, obwohl der Zusammenhang
// existiert. Genau dieser Fall trat im Betrieb auf.
//
// WER ES WAR, BLEIBT SICHTBAR: Dasselbe Feld `einsatz_id` kann auf zwei
// Wegen gefüllt worden sein -- von der fahrenden Person selbst beim
// Erfassen, oder hier vom Büro im Nachhinein. Beide sind zulässig, aber
// sie haben nicht dieselbe Beweiskraft (OP-314). Darum halten
// `einsatz_zugeordnet_von`/`-_am` den nachträglichen Weg fest; bleiben sie
// NULL, stammt die Zuordnung von der Person selbst.
//
// DER EINSATZ MUSS DER PERSON DER ÜBERNAHME GEHÖREN. Sonst liesse sich
// eine Fahrt an einen fremden Dienst hängen und damit eine Erklärung
// erfinden, die es nicht gibt. Geprüft wird im Server, nicht in der
// Oberfläche -- was im Browser steht, erspart nur den Umweg.
//
// KEINE SPERRPRÜFUNG NÖTIG (ENT-045): Geschrieben wird ausschliesslich an
// `fahrzeug_uebernahme`, nicht an `einsaetze`, `einsatz_zuteilung` oder
// `einsatz_position`. Eine festgeschriebene Schicht bleibt unberührt --
// sie wird hier nur gelesen.
//
// RECHT: 'betrieb', dasselbe wie fahrzeug_uebernahme_liste.php -- wer die
// Übernahmen sehen darf, ordnet sie auch zu.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../logbuch.php';
require_once __DIR__ . '/../fahrzeug.php';

$user = require_session();
require_recht($user, 'betrieb');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = db();
if (!hat_tabelle($pdo, 'fahrzeug_uebernahme')) {
    json_response(['status' => 'error', 'message' => 'Die Fahrzeugübernahmen sind noch nicht eingerichtet.'], 422);
}
if (!hat_spalte($pdo, 'fahrzeug_uebernahme', 'einsatz_zugeordnet_von')) {
    // Fehlende Einrichtung ist etwas anderes als ein abgewiesener Wunsch --
    // sie braucht ihren eigenen Text, damit niemand nach der Ursache raten
    // muss.
    json_response(['status' => 'error',
        'message' => 'Die Einrichtung ist noch nicht vollständig -- bitte die Datenbank aktualisieren.'], 422);
}

$input = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$uebernahmeId = (int)($input['uebernahme_id'] ?? 0);
if ($uebernahmeId <= 0) {
    json_response(['status' => 'error', 'message' => 'uebernahme_id erforderlich'], 422);
}

$s = $pdo->prepare('SELECT id, art, mitarbeiter_id, fahrzeug_id, einsatz_id, zeitpunkt
                      FROM fahrzeug_uebernahme WHERE id = ?');
$s->execute([$uebernahmeId]);
$ueb = $s->fetch(PDO::FETCH_ASSOC);
if (!$ueb) {
    json_response(['status' => 'error', 'message' => 'Diese Übernahme gibt es nicht.'], 404);
}

$altEinsatz = $ueb['einsatz_id'] !== null ? (string)(int)$ueb['einsatz_id'] : null;

// ── Zuordnung lösen ──────────────────────────────────────────────────
// Ein Fehlgriff muss sich zurücknehmen lassen, sonst wäre die erste
// falsche Zuordnung endgültig. Der Vermerk verschwindet mit ihr -- er
// gehört zur Zuordnung, nicht zur Übernahme.
$roh = $input['einsatz_id'] ?? null;
if ($roh === null || $roh === '' || (int)$roh === 0) {
    $u = $pdo->prepare('UPDATE fahrzeug_uebernahme
                           SET einsatz_id = NULL, einsatz_zugeordnet_von = NULL, einsatz_zugeordnet_am = NULL
                         WHERE id = ?');
    $u->execute([$uebernahmeId]);
    logbuch_schreiben($pdo, $user, 'fahrzeug', (int)($ueb['fahrzeug_id'] ?? 0),
        'uebernahme_einsatz', $altEinsatz, null);
    json_response(['status' => 'ok', 'einsatz_id' => null]);
}

$einsatzId = (int)$roh;
// Die Prüfung "gehört dieser Einsatz dieser Person?" liegt in fahrzeug.php
// (FZ_EINSATZ_GEHOERT_SQL), damit dieselbe Abfrage auch echt geprüft
// werden kann -- siehe dort.
$c = $pdo->prepare(FZ_EINSATZ_GEHOERT_SQL);
$c->execute([$einsatzId, (int)$ueb['mitarbeiter_id']]);
if ($c->fetchColumn() === false) {
    json_response(['status' => 'error',
        'message' => 'Dieser Einsatz gehört nicht zur Person, die das Fahrzeug übernommen hat.'], 422);
}

$u = $pdo->prepare('UPDATE fahrzeug_uebernahme
                       SET einsatz_id = ?, einsatz_zugeordnet_von = ?, einsatz_zugeordnet_am = NOW()
                     WHERE id = ?');
$u->execute([$einsatzId, (int)$user['id'], $uebernahmeId]);
logbuch_schreiben($pdo, $user, 'fahrzeug', (int)($ueb['fahrzeug_id'] ?? 0),
    'uebernahme_einsatz', $altEinsatz, (string)$einsatzId);

json_response(['status' => 'ok', 'einsatz_id' => $einsatzId]);
