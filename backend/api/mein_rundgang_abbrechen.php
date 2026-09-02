<?php
// Einen eigenen Rundgang endgueltig abbrechen (ENT-146). Anders als Pausieren
// nicht mehr fortsetzbar. Verlangt zwingend einen Grund aus einer der vier
// festen Kategorien (RUNDGANG_ABBRUCH_GRUENDE), optional ergaenzt durch
// Freitext -- das UX-Sicherheitsmuster (Beenden -> Dialog -> zweiter,
// expliziter Klick) liegt in app.html, nicht hier; der Server verlangt aber
// unabhaengig davon denselben Pflichtgrund, sonst waere die Sperre nur eine
// Oberflaechen-Hoeflichkeit. Bereits erfasste Kontrollpunkt-Scans bleiben
// unangetastet (ENT-146 Punkt 3).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$rundgangId = (int)($input['rundgang_id'] ?? 0);
$grund = (string)($input['grund'] ?? '');
$freitext = trim((string)($input['freitext'] ?? ''));
if ($rundgangId <= 0) {
    json_response(['status' => 'error', 'message' => 'rundgang_id erforderlich'], 422);
}
if (!array_key_exists($grund, RUNDGANG_ABBRUCH_GRUENDE)) {
    json_response(['status' => 'error', 'message' => 'Grund erforderlich'], 422);
}

$pdo = db();

$r = $pdo->prepare('SELECT * FROM rundgang WHERE id = ? AND mitarbeiter_id = ?');
$r->execute([$rundgangId, (int)$user['id']]);
$rundgang = $r->fetch();
if (!$rundgang) {
    json_response(['status' => 'error', 'message' => 'Dieser Rundgang gehoert nicht zu dir'], 404);
}
if (in_array($rundgang['status'], ['abgeschlossen', 'abgebrochen'], true)) {
    json_response(['status' => 'error', 'message' => 'Dieser Rundgang ist bereits beendet'], 409);
}

// War er gerade pausiert, zaehlt die laufende Pause noch zur Summe -- sonst
// wuerde die letzte, angebrochene Pause unter den Tisch fallen.
$pdo->prepare(
    "UPDATE rundgang SET status = 'abgebrochen',
      pause_minuten = pause_minuten + CASE WHEN pausiert_seit IS NOT NULL
        THEN GREATEST(0, TIMESTAMPDIFF(MINUTE, pausiert_seit, NOW())) ELSE 0 END,
      pausiert_seit = NULL, abbruch_grund = ?, abbruch_freitext = ?, abgebrochen_am = NOW()
     WHERE id = ?"
)->execute([$grund, $freitext !== '' ? $freitext : null, $rundgangId]);

/* Der Abbruch erscheint im Meldeweg (ENT-324).

   Vom Projektinhaber verlangt: „Ich habe vorhin noch einen Rundgang bewusst
   abgebrochen, diese Info muss ZWINGEND in die Ereignisse im Dashboard."

   Er hat recht: Bis hierher stand der Abbruch nur an der Runde selbst. Wer
   die Ereignisse durchsieht -- also den Ort, an dem im Betrieb nachgesehen
   wird, was in der Nacht vorgefallen ist --, sah davon nichts. Eine
   abgebrochene Runde ist aber genau so ein Vorfall.

   Scheitert das Ereignis, ist der Abbruch selbst trotzdem gueltig: Er steht
   mit Grund und Zeit an der Runde, die Auswertung zeigt ihn, es geht nichts
   verloren. Gemeldet wird das Scheitern zurueck, damit ein dauerhaft
   kaputter Meldeweg nicht still bleibt -- dieselbe Abwaegung wie in
   ENT-311. */
$ereignisFehler = null;
try {
    $artId = null;
    if (hat_tabelle($pdo, 'ereignisart')) {
        $aSt = $pdo->prepare('SELECT id FROM ereignisart WHERE bezeichnung = ? AND aktiv = 1');
        $aSt->execute([EREIGNISART_ABBRUCH]);
        $gefunden = $aSt->fetchColumn();
        if ($gefunden !== false) { $artId = (int)$gefunden; }
    }
    // Der Klartext des Grundes wird KOPIERT, nicht nur der Code abgelegt:
    // Wer das Ereignis spaeter liest, soll den Grund dort lesen koennen und
    // nicht eine Kennung nachschlagen muessen (Nachweis-Prinzip).
    $text = 'Rundgang abgebrochen — Grund: ' . RUNDGANG_ABBRUCH_GRUENDE[$grund]
        . ($freitext !== '' ? ' — ' . $freitext : '');
    $evt = $pdo->prepare(
        'INSERT INTO ereignis_meldung
           (objekt_id, rundgang_id, einsatz_id, mitarbeiter_id, ereignisart_id, erfasst_am, bemerkung)
         VALUES (?, ?, ?, ?, ?, NOW(), ?)'
    );
    $evt->execute([(int)$rundgang['objekt_id'], $rundgangId,
        $rundgang['einsatz_id'] !== null ? (int)$rundgang['einsatz_id'] : null,
        (int)$user['id'], $artId, $text]);
} catch (Throwable $e) {
    $ereignisFehler = 'Abbruch gespeichert, Ereignismeldung fehlgeschlagen';
}

json_response(['status' => 'ok', 'ereignis_fehler' => $ereignisFehler]);
