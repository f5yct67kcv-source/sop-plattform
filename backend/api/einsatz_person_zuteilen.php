<?php
// Teilt EINE Person einem bestehenden Einsatz zu -- additiv (ENT-710,
// Disposition mit Vorschlag des Assistenten).
//
// Warum nicht einsatz_save.php: Das schreibt den ganzen Einsatz und legt alle
// Zuteilungen neu an. Ein Knopf, der dafuer den ganzen Einsatz mitschickt,
// koennte veraltete Angaben zurueckschreiben und die Zusagen der uebrigen
// Personen verlieren. Hier kommt nur eine Zeile dazu; alles andere bleibt.
//
// Dieselben Sperren wie beim Speichern eines Einsatzes, hier im Server:
// abgeglichene Schicht (ENT-045), nur aktive Menschen (ENT-631), niemand an
// zwei Orten (ENT-022), Revierdienst-Berechtigung als Warnung (ENT-284).
// Dazu: Wer schon auf dem Einsatz steht, kommt nicht doppelt dazu, und ein
// voll besetzter Einsatz nimmt niemanden mehr auf.
//
// Die Zusage bleibt "offen" (Vorgabe der Tabelle): Die Person bestaetigt
// wie bei jeder anderen Zuteilung selbst.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'einsaetze_schreiben');
require_once __DIR__ . '/../mitarbeiter.php';   // ma_nur_menschen() (ENT-631)
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$einsatzId = (int)($in['einsatz_id'] ?? 0);
$maId      = (int)($in['mitarbeiter_id'] ?? 0);
$trotzFehlenderBerechtigung = !empty($in['trotz_fehlender_berechtigung']);
if ($einsatzId <= 0 || $maId <= 0) {
    json_response(['status' => 'error', 'message' => 'einsatz_id und mitarbeiter_id erforderlich'], 400);
}

$pdo = db();
einsatz_sperre_pruefen($pdo, $einsatzId);

$e = $pdo->prepare('SELECT id, datum, von, bis, bedarf, status, einsatzart FROM einsaetze WHERE id = ?');
$e->execute([$einsatzId]);
$einsatz = $e->fetch(PDO::FETCH_ASSOC);
if (!$einsatz) {
    json_response(['status' => 'error', 'message' => 'Einsatz nicht gefunden'], 404);
}
if ($einsatz['status'] === 'abgesagt') {
    json_response(['status' => 'error', 'message' => 'Dieser Einsatz ist abgesagt.'], 409);
}

$m = $pdo->prepare('SELECT id FROM mitarbeiter WHERE id = ? AND aktiv = 1 AND ' . ma_nur_menschen($pdo));
$m->execute([$maId]);
if (!$m->fetch()) {
    json_response(['status' => 'error', 'message' => 'Diese Person ist nicht aktiv oder existiert nicht.'], 404);
}

// Ab hier unter Sperre auf die Einsatzzeile: Zwei Klicks gleichzeitig
// duerfen den Bedarf nicht gemeinsam ueberschreiten. Bricht eine Pruefung
// mit json_response ab, verwirft PDO die offene Transaktion beim Ende.
$pdo->beginTransaction();
$pdo->prepare('SELECT id FROM einsaetze WHERE id = ? FOR UPDATE')->execute([$einsatzId]);
// Auch die Zaehlung sperrend lesen: Ein gewoehnliches SELECT saehe den Stand
// vom Beginn der Transaktion und koennte eine eben bestaetigte Zuteilung
// uebersehen. Nachgemessen: ohne das war 1 von 10 Rennen ueberbucht.
$z = $pdo->prepare('SELECT mitarbeiter_id, zusage FROM einsatz_zuteilung WHERE einsatz_id = ? FOR UPDATE');
$z->execute([$einsatzId]);
$bisher = $z->fetchAll(PDO::FETCH_ASSOC);
foreach ($bisher as $b) {
    if ((int)$b['mitarbeiter_id'] === $maId) {
        json_response(['status' => 'error', 'schon_da' => true,
            'message' => 'Diese Person steht schon auf dem Einsatz (' . $b['zusage'] . ').'], 409);
    }
}
// Besetzt zaehlt wie im Cockpit (zaehltAlsBesetzt): alles ausser abgelehnt
// und entfallen.
$besetzt = count(array_filter($bisher, fn($b) => !in_array($b['zusage'], ['abgelehnt', 'entfallen'], true)));
if ($besetzt >= (int)$einsatz['bedarf']) {
    json_response(['status' => 'error', 'voll' => true,
        'message' => 'Der Einsatz ist bereits voll besetzt.'], 409);
}

if (!$trotzFehlenderBerechtigung) {
    $unberechtigt = ohneRevierdienstBerechtigung((string)$einsatz['einsatzart'], [$maId]);
    if ($unberechtigt) {
        json_response(['status' => 'error', 'unberechtigt' => true,
            'message' => 'Ohne Revierdienst-Berechtigung: ' . implode(', ', array_column($unberechtigt, 'name')),
            'personen' => $unberechtigt], 409);
    }
}

$doppelt = doppelbelegungen($einsatzId, (string)$einsatz['datum'], (string)$einsatz['von'], (string)$einsatz['bis'], [$maId]);
if ($doppelt) {
    $d = $doppelt[0];
    json_response(['status' => 'error', 'doppelbelegung' => array_values($doppelt),
        'message' => $d['name'] . ' ist am ' . date('d.m.Y', strtotime($d['datum'])) . ' bereits eingeteilt: ' . $d['was']], 409);
}

$pdo->prepare('INSERT INTO einsatz_zuteilung (einsatz_id, mitarbeiter_id) VALUES (?, ?)')->execute([$einsatzId, $maId]);
$pdo->commit();

json_response(['status' => 'ok', 'einsatz_id' => $einsatzId, 'mitarbeiter_id' => $maId,
               'besetzt' => $besetzt + 1, 'bedarf' => (int)$einsatz['bedarf']]);
