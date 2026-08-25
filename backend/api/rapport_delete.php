<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../planung.php';   // einsatz_vollstaendig_rapportiert()

$user = require_session();
require_recht($user, 'abgleich');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($input['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'ungueltige id'], 400);
}

$vorher = db()->prepare('SELECT einsatz_id FROM rapporte WHERE id = ?');
$vorher->execute([$id]);
$einsatzId = (int)($vorher->fetchColumn() ?: 0);

db()->prepare('DELETE FROM rapporte WHERE id = ?')->execute([$id]);

// Wird durch das Loeschen ein zuvor vollstaendig rapportierter Einsatz wieder
// unvollstaendig, gilt er nicht mehr als abgeschlossen (ENT-128) -- sonst
// zeigte die Planung "abgeschlossen" fuer einen Einsatz, dem jetzt wieder ein
// Rapport fehlt. Zurueck auf 'bestaetigt': ein Einsatz, der schon so weit
// gekommen war (zugesagte Zuteilung, mindestens ein Rapport), war das mit an
// Sicherheit grenzender Wahrscheinlichkeit vorher -- nicht bloss "geplant".
// Auch hier gilt die Festschreibung aus ENT-045: eine bereits abgeglichene
// Schicht wird nicht zurueckgestuft, selbst wenn ihr im Nachhinein ein
// Rapport entzogen wird.
if ($einsatzId > 0 && !einsatz_abgeglichen(db(), $einsatzId) && !einsatz_vollstaendig_rapportiert(db(), $einsatzId)) {
    db()->prepare("UPDATE einsaetze SET status = 'bestaetigt' WHERE id = ? AND status = 'abgeschlossen'")
        ->execute([$einsatzId]);
}

json_response(['status' => 'ok']);
