<?php
// Leistungsart je Zuteilung (ENT-721).
//
// Welche Leistung eine Person auf DIESEM Einsatz erbringt, etwa als
// Hundefuehrer. Daran haengt die Zulage je Leistungsart im Lohnlauf: Gezaehlt
// werden nur die Stunden der Schichten, an denen sie gewaehlt ist. Leer heisst:
// keine Leistungsart.
//
// POST { einsatz_id, mitarbeiter_id, leistungsart_id }   ('' oder 0 = keine)
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
// einsatz_sperre_pruefen() -- eine abgeglichene Schicht ist festgeschrieben
// (ENT-045). Die Leistungsart aendert den Lohn dieser Schicht; danach darf
// sie sich nicht mehr unbemerkt verschieben.
require_once __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'einsaetze_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
$pdo = db();
if (!hat_spalte($pdo, 'einsatz_zuteilung', 'leistungsart_id')) {
    json_response(['status' => 'error',
        'message' => 'Die Leistungsart an der Zuteilung fehlt noch — zuerst „Einrichtung“ ausführen.'], 503);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$einsatzId = (int)($in['einsatz_id'] ?? 0);
$maId = (int)($in['mitarbeiter_id'] ?? 0);
$laId = (int)($in['leistungsart_id'] ?? 0);
if ($einsatzId <= 0 || $maId <= 0) {
    json_response(['status' => 'error', 'message' => 'einsatz_id und mitarbeiter_id erforderlich'], 422);
}

$s = $pdo->prepare('SELECT leistungsart_id FROM einsatz_zuteilung WHERE einsatz_id = ? AND mitarbeiter_id = ?');
$s->execute([$einsatzId, $maId]);
$bisher = $s->fetch();
if (!$bisher) {
    json_response(['status' => 'error', 'message' => 'Diese Person ist auf diesem Einsatz nicht eingeteilt'], 404);
}

einsatz_sperre_pruefen($pdo, $einsatzId);

// Nur eine Lohnart der Art 'leistung'. Eine deaktivierte darf stehen
// bleiben, wenn sie schon gewaehlt war, aber nicht neu gewaehlt werden.
if ($laId > 0) {
    $l = $pdo->prepare("SELECT aktiv FROM lohnart WHERE id = ? AND art = 'leistung'");
    $l->execute([$laId]);
    $aktiv = $l->fetchColumn();
    if ($aktiv === false) {
        json_response(['status' => 'error', 'message' => 'Unbekannte Leistungsart'], 422);
    }
    if (!(int)$aktiv && (int)$bisher['leistungsart_id'] !== $laId) {
        json_response(['status' => 'error', 'message' => 'Diese Leistungsart ist deaktiviert'], 422);
    }
}

$pdo->prepare('UPDATE einsatz_zuteilung SET leistungsart_id = ? WHERE einsatz_id = ? AND mitarbeiter_id = ?')
    ->execute([$laId > 0 ? $laId : null, $einsatzId, $maId]);

json_response(['status' => 'ok', 'leistungsart_id' => $laId > 0 ? $laId : null]);
