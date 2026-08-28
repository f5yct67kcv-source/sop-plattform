<?php
// Verarbeitet einen oder mehrere Kontrollpunkt-Scans eines laufenden,
// eigenen Rundgangs (ENT-132/ENT-145/ENT-180). Mehrere auf einmal, weil ein
// Geraet ohne Netz zwischenspeichert und beim Wiederverbinden alles
// gesammelt nachliefert (Offline-Prinzip, ENT-132 Punkt 5) -- erfasst_am
// kommt darum vom Geraet, nicht vom Server.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$rundgangId = (int)($input['rundgang_id'] ?? 0);
$scans = is_array($input['scans'] ?? null) ? $input['scans'] : [];
if ($rundgangId <= 0 || !$scans) {
    json_response(['status' => 'error', 'message' => 'rundgang_id und scans erforderlich'], 422);
}

$pdo = db();

// Nur der eigene Rundgang -- mitarbeiter_id kommt aus der Sitzung.
$rChk = $pdo->prepare('SELECT * FROM rundgang WHERE id = ? AND mitarbeiter_id = ?');
$rChk->execute([$rundgangId, (int)$user['id']]);
$rundgang = $rChk->fetch();
if (!$rundgang) {
    json_response(['status' => 'error', 'message' => 'Dieser Rundgang gehoert nicht zu dir'], 404);
}
if (in_array($rundgang['status'], ['abgeschlossen', 'abgebrochen'], true)) {
    json_response(['status' => 'error', 'message' => 'Dieser Rundgang ist bereits beendet'], 409);
}
if ($rundgang['status'] === 'pausiert') {
    json_response(['status' => 'error', 'message' => 'Dieser Rundgang ist pausiert -- erst fortsetzen'], 409);
}

// Ersatzscan (Q-22 in sop-projekt): Fotobeleg statt technischer Pruefung,
// wenn NFC/Geofence nicht moeglich ist (Chip zerstoert, Punkt nicht
// auffindbar). Bewusst klein gehalten -- ein Fotobeleg fuer "war ich vor
// Ort" braucht keine Druckaufloesung, und die App komprimiert vor dem
// Versand (siehe rdEsKomprimieren in app.html). Gleiche Grössenordnung wie
// DOK_MAX/2 in einsatz_dokument.php, dort fuer PDF-Dokumente statt Fotos.
const ERSATZSCAN_FOTO_MAX = 2 * 1024 * 1024;

$ergebnisse = [];
foreach ($scans as $eintrag) {
    if (!is_array($eintrag)) { continue; }
    $kontrollpunktId = (int)($eintrag['kontrollpunkt_id'] ?? 0);
    $status = (string)($eintrag['status'] ?? '');
    $erfasstAm = trim((string)($eintrag['erfasst_am'] ?? ''));
    $chipId = isset($eintrag['chip_id']) ? trim((string)$eintrag['chip_id']) : null;
    $lat = isset($eintrag['lat']) && $eintrag['lat'] !== '' ? (float)$eintrag['lat'] : null;
    $lng = isset($eintrag['lng']) && $eintrag['lng'] !== '' ? (float)$eintrag['lng'] : null;
    $beschreibung = isset($eintrag['beschreibung']) ? trim((string)$eintrag['beschreibung']) : null;

    if ($kontrollpunktId <= 0 || !in_array($status, ['bestaetigt', 'nicht_verfuegbar', 'ersatzscan'], true) || $erfasstAm === '') {
        $ergebnisse[] = ['kontrollpunkt_id' => $kontrollpunktId, 'status' => 'fehler', 'message' => 'ungueltige Meldung'];
        continue;
    }

    $kp = $pdo->prepare('SELECT * FROM kontrollpunkt WHERE id = ? AND objekt_id = ?');
    $kp->execute([$kontrollpunktId, $rundgang['objekt_id']]);
    $kontrollpunkt = $kp->fetch();
    if (!$kontrollpunkt) {
        $ergebnisse[] = ['kontrollpunkt_id' => $kontrollpunktId, 'status' => 'fehler',
            'message' => 'Kontrollpunkt gehoert nicht zu diesem Objekt'];
        continue;
    }

    // Bereits erfasst -- idempotent statt Fehler, ein Geraet meldet nach
    // Verbindungsabbruch sonst denselben Scan mehrfach.
    $dup = $pdo->prepare('SELECT id FROM rundgang_scan WHERE rundgang_id = ? AND kontrollpunkt_id = ?');
    $dup->execute([$rundgangId, $kontrollpunktId]);
    if ($dup->fetch()) {
        $ergebnisse[] = ['kontrollpunkt_id' => $kontrollpunktId, 'status' => 'bereits_erfasst'];
        continue;
    }

    $foto = null; $fotoMime = null;
    if ($status === 'bestaetigt') {
        $fehler = rundgang_scan_pruefen($kontrollpunkt, $chipId, $lat, $lng);
        if ($fehler !== null) {
            $ergebnisse[] = ['kontrollpunkt_id' => $kontrollpunktId, 'status' => 'fehler', 'message' => $fehler];
            continue;
        }
    } elseif ($status === 'ersatzscan') {
        // Keine NFC-/Geofence-Pruefung -- das ist der ganze Sinn eines
        // Ersatzscans (Q-22). Dafuer Foto UND Begruendung zwingend, sonst
        // waere ein Ersatzscan ein unbelegter Klick ohne jeden Nachweis.
        if ($beschreibung === null || $beschreibung === '') {
            $ergebnisse[] = ['kontrollpunkt_id' => $kontrollpunktId, 'status' => 'fehler',
                'message' => 'Begründung erforderlich bei Ersatzscan'];
            continue;
        }
        $fotoRoh = isset($eintrag['foto']) ? base64_decode((string)$eintrag['foto'], true) : false;
        if ($fotoRoh === false || $fotoRoh === '') {
            $ergebnisse[] = ['kontrollpunkt_id' => $kontrollpunktId, 'status' => 'fehler',
                'message' => 'Foto erforderlich bei Ersatzscan'];
            continue;
        }
        if (strlen($fotoRoh) > ERSATZSCAN_FOTO_MAX) {
            $ergebnisse[] = ['kontrollpunkt_id' => $kontrollpunktId, 'status' => 'fehler',
                'message' => 'Foto zu gross (höchstens 2 MB)'];
            continue;
        }
        $fotoMime = ersatzscan_foto_mime($fotoRoh);
        if ($fotoMime === null) {
            $ergebnisse[] = ['kontrollpunkt_id' => $kontrollpunktId, 'status' => 'fehler',
                'message' => 'Nur JPEG- oder PNG-Fotos'];
            continue;
        }
        $foto = $fotoRoh;
    } elseif ($beschreibung === null || $beschreibung === '') {
        $ergebnisse[] = ['kontrollpunkt_id' => $kontrollpunktId, 'status' => 'fehler',
            'message' => 'Beschreibung erforderlich bei nicht verfuegbar'];
        continue;
    }

    $ins = $pdo->prepare(
        'INSERT INTO rundgang_scan (rundgang_id, kontrollpunkt_id, status, erfasst_am, beschreibung, foto, foto_mime)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $ins->execute([$rundgangId, $kontrollpunktId, $status, $erfasstAm, $beschreibung, $foto, $fotoMime]);

    // Rohzeit beginnt erst mit dem ersten BESTAETIGTEN Punkt -- weder "nicht
    // verfuegbar" (ENT-145) noch "ersatzscan" (Q-22, Projektinhaber-Entscheid
    // 2026-08-28) loesen sie aus. Beides hat keinen technischen Vor-Ort-
    // Nachweis wie NFC/Geofence, nur ein Foto ist schwaecher als das -- sonst
    // liesse sich der Start ohne echte Ortspruefung ausloesen.
    if ($status === 'bestaetigt' && $rundgang['rohzeit_start'] === null) {
        $pdo->prepare("UPDATE rundgang SET status = 'laeuft', rohzeit_start = ? WHERE id = ?")
            ->execute([$erfasstAm, $rundgangId]);
        $rundgang['rohzeit_start'] = $erfasstAm;
        $rundgang['status'] = 'laeuft';
    }

    $ergebnisse[] = ['kontrollpunkt_id' => $kontrollpunktId, 'status' => 'ok'];

    // Letzter offener Punkt erreicht -> der Rundgang schliesst automatisch
    // (ENT-132 Punkt 3, in diesem Teil unveraendert durch ENT-145 -- nur
    // der Start wurde dort revidiert, das Ende bleibt automatisch).
    $vorlageId = $rundgang['rundgang_vorlage_id'] !== null ? (int)$rundgang['rundgang_vorlage_id'] : null;
    $uebrig = rundgang_kontrollpunkte_uebrig($pdo, $rundgangId, (int)$rundgang['objekt_id'], $vorlageId);
    if (!$uebrig && $rundgang['status'] !== 'abgeschlossen') {
        $pdo->prepare("UPDATE rundgang SET status = 'abgeschlossen', rohzeit_ende = ? WHERE id = ?")
            ->execute([$erfasstAm, $rundgangId]);
        $rundgang['status'] = 'abgeschlossen';
        $rundgang['rohzeit_ende'] = $erfasstAm;
    }
}

json_response(['status' => 'ok', 'rundgang_status' => $rundgang['status'], 'ergebnisse' => $ergebnisse]);
