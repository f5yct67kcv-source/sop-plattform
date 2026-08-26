<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../planung.php';   // einsatz_vollstaendig_rapportiert()

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$d = json_decode(file_get_contents('php://input'), true) ?? [];

$required = ['datum', 'kunde', 'strasse', 'ort', 'von', 'bis'];
foreach ($required as $f) {
    if (empty($d[$f])) {
        json_response(['status' => 'error', 'message' => "Pflichtfeld fehlt: $f"], 400);
    }
}

// Schicht-Rapport (ENT-082): einsatz_id verknuepft den Rapport mit der
// eigenen Zuteilung. Nur wer sie tatsaechlich hat, darf sie setzen -- eine
// Sperre gehoert an den Server, nicht an den Knopf in der Oberflaeche
// (CLAUDE.md, sop-plattform). Manueller Rapport traegt weiterhin NULL.
$einsatzId = (int)($d['einsatz_id'] ?? 0);
if ($einsatzId > 0) {
    $stmt = db()->prepare(
        'SELECT z.zusage, e.einsatzart
         FROM einsatz_zuteilung z
         JOIN einsaetze e ON e.id = z.einsatz_id
         WHERE z.einsatz_id = ? AND z.mitarbeiter_id = ?'
    );
    $stmt->execute([$einsatzId, $user['id']]);
    $zuteilung = $stmt->fetch();
    if (!$zuteilung) {
        json_response(['status' => 'error', 'message' => 'Diese Schicht gehoert nicht zu dir.'], 403);
    }
    if ($zuteilung['zusage'] !== 'zugesagt') {
        json_response(['status' => 'error', 'message' => 'Diese Schicht ist nicht zugesagt.'], 400);
    }
    if ($zuteilung['einsatzart'] !== 'Verkehrsdienst') {
        json_response(['status' => 'error', 'message' => 'Schicht rapportieren gibt es nur bei Verkehrsdienst.'], 400);
    }
}

// Nettostunden serverseitig berechnen, nicht dem Client vertrauen.
$von = DateTime::createFromFormat('H:i', $d['von']);
$bis = DateTime::createFromFormat('H:i', $d['bis']);
$pause = (int)($d['pause'] ?? 0);
if (!$von || !$bis) {
    json_response(['status' => 'error', 'message' => 'ungueltige Zeitangabe'], 400);
}
$diffMin = ($bis->getTimestamp() - $von->getTimestamp()) / 60;
if ($diffMin < 0) $diffMin += 24 * 60; // Ueber Mitternacht
$nettoH = round(($diffMin - $pause) / 60, 2);
if ($nettoH < 0) {
    json_response(['status' => 'error', 'message' => 'Pause groesser als Arbeitszeit'], 400);
}

// Unterschrift optional: nur ein data:image/png;base64,... akzeptieren, Groesse begrenzen.
$sig = $d['sig'] ?? null;
if ($sig !== null) {
    if (!is_string($sig) || strlen($sig) > 2_000_000 || !preg_match('#^data:image/png;base64,[A-Za-z0-9+/=]+$#', $sig)) {
        json_response(['status' => 'error', 'message' => 'ungueltige Unterschrift'], 400);
    }
}

$stmt = db()->prepare(
    'INSERT INTO rapporte (mitarbeiter_id, einsatz_id, datum, kunde, strasse, ort, auftrag_nr, einsatzart, von, bis, pause_min, netto_h, unterzeichner, unterschrift, bemerkung)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
$stmt->execute([
    $user['id'], $einsatzId > 0 ? $einsatzId : null, $d['datum'], $d['kunde'], $d['strasse'], $d['ort'],
    $d['auftragNr'] ?? null, $d['einsatzart'] ?? 'Verkehrsdienst',
    $d['von'], $d['bis'], $pause, $nettoH,
    $d['sigName'] ?? null, $sig, $d['bemerkung'] ?? null,
]);

// Die Unterschrift gehoert zum EINSATZ, nicht nur zu diesem einen Rapport
// (ENT-160). Sind zwei Leute am selben Auftrag, unterschreibt der Kunde sonst
// zweimal auf zwei Telefonen.
//
// Nur die ERSTE wird uebernommen -- `unterschrift IS NULL` in der Bedingung.
// Ohne das ueberschriebe der zweite Rapport die Unterschrift des ersten, und
// der Zeitstempel auf dem Kundenbericht wuerde wandern, obwohl der Kunde nur
// einmal unterschrieben hat. Am Rapport bleibt sie zusaetzlich stehen: Sie ist
// dort tatsaechlich erfasst worden, und ein Einzelrapport muss weiterhin fuer
// sich allein gueltig sein.
// `!einsatz_abgeglichen()` wie beim Status darunter: Eine abgeglichene Schicht
// ist festgeschrieben (ENT-045). Ohne diese Bedingung schriebe ein nachtraeglich
// eingehender Rapport noch eine Unterschrift in einen bereits geprueften und
// gesperrten Einsatz. Beim ersten Bauen genau das vergessen -- die
// ENT-128-Wache in test_schichtrapport.mjs hat es aufgedeckt.
if ($einsatzId > 0 && $sig !== null && !einsatz_abgeglichen(db(), $einsatzId)) {
    $st = db()->prepare(
        'UPDATE einsaetze
            SET unterschrift = ?, unterzeichner = ?, unterschrift_von = ?, unterschrift_am = NOW()
          WHERE id = ? AND unterschrift IS NULL'
    );
    $st->execute([$sig, $d['sigName'] ?? null, (int)$user['id'], $einsatzId]);
}

// Sobald ALLE zugesagten Zuteilungen dieses Einsatzes rapportiert haben, gilt
// er als abgeschlossen (ENT-128) -- nicht schon bei diesem einen Rapport.
// 'abgesagt' wird nie ueberschrieben: ein abgesagter Einsatz bleibt abgesagt,
// selbst wenn einzelne Rapporte trotzdem noch nachgetragen werden.
// Eine bereits abgeglichene Schicht ist festgeschrieben (ENT-045) -- auch ihr
// Status wird dann nicht mehr angefasst, selbst wenn nachtraeglich noch ein
// Rapport eingeht. Der Rapport selbst darf trotzdem entstehen, wie bisher.
if ($einsatzId > 0 && !einsatz_abgeglichen(db(), $einsatzId) && einsatz_vollstaendig_rapportiert(db(), $einsatzId)) {
    db()->prepare("UPDATE einsaetze SET status = 'abgeschlossen' WHERE id = ? AND status != 'abgesagt'")
        ->execute([$einsatzId]);
}

json_response(['status' => 'ok', 'netto_h' => $nettoH]);
