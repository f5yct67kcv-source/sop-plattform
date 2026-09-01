<?php
// Vorfallmeldung aus dem Revierdienst entgegennehmen (ENT-295).
//
// Nimmt MEHRERE Meldungen auf einmal entgegen -- gleiches Muster wie
// mein_rundgang_scan.php und aus demselben Grund: Wer ohne Netz meldet,
// sammelt lokal und reicht beim naechsten Netzkontakt alles zusammen nach
// (ENT-132). Ein Endpunkt fuer genau eine Meldung wuerde diese
// Warteschlange zu vielen Einzelanfragen zwingen.
//
// erfasst_am kommt vom GERAET, nicht vom Server: Der Nachweiswert einer
// Vorfallmeldung haengt am Moment der Beobachtung, nicht am Moment der
// Uebermittlung. uebermittelt_am haelt letzteren separat fest (Standardwert
// der Spalte), damit eine lange Offline-Phase sichtbar bleibt.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = db();
if (!hat_tabelle($pdo, 'ereignis_meldung')) {
    json_response(['status' => 'error', 'message' => 'Ereignisse sind noch nicht eingerichtet'], 503);
}

$input = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$meldungen = isset($input['meldungen']) && is_array($input['meldungen']) ? $input['meldungen'] : [];
if (!$meldungen) {
    json_response(['status' => 'error', 'message' => 'meldungen erforderlich'], 422);
}

// Dasselbe Gate wie fuer die Rundgaenge-Uebersicht (ENT-279/293): Wer nie
// Revierdienst macht, meldet hier auch nichts.
$chk = $pdo->prepare(
    'SELECT COUNT(*) FROM einsatz_zuteilung z
      JOIN einsaetze e ON e.id = z.einsatz_id
      JOIN kontrollpunkt k ON k.objekt_id = e.objekt_id AND k.aktiv = 1
     WHERE z.mitarbeiter_id = ?'
);
$chk->execute([(int)$user['id']]);
if ((int)$chk->fetchColumn() === 0) {
    json_response(['status' => 'error', 'message' => 'Kein Zugriff auf Ereignismeldungen'], 403);
}

$mysqlZeit = static function ($wert): ?string {
    if (!is_string($wert) || $wert === '') { return null; }
    return preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $wert) === 1 ? $wert : null;
};

$ins = $pdo->prepare(
    'INSERT INTO ereignis_meldung
       (objekt_id, rundgang_id, einsatz_id, mitarbeiter_id, ereignisart_id,
        erfasst_am, vorfall_am, bemerkung, foto, foto_mime, lat, lng)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

$ergebnisse = [];
foreach ($meldungen as $m) {
    $lokal = isset($m['lokal_id']) ? (string)$m['lokal_id'] : '';
    $objektId = (int)($m['objekt_id'] ?? 0);
    $artId    = (int)($m['ereignisart_id'] ?? 0);
    $erfasst  = $mysqlZeit($m['erfasst_am'] ?? null);

    if ($objektId <= 0 || $erfasst === null) {
        $ergebnisse[] = ['lokal_id' => $lokal, 'status' => 'fehler',
            'message' => 'Objekt und Erfassungszeitpunkt sind erforderlich.'];
        continue;
    }
    // Die Art muss es geben und aktiv sein -- eine Meldung auf eine
    // zwischenzeitlich entfernte Art waere spaeter nicht auswertbar.
    $aStmt = $pdo->prepare('SELECT COUNT(*) FROM ereignisart WHERE id = ? AND aktiv = 1');
    $aStmt->execute([$artId]);
    if ((int)$aStmt->fetchColumn() === 0) {
        $ergebnisse[] = ['lokal_id' => $lokal, 'status' => 'fehler',
            'message' => 'Diese Ereignisart gibt es nicht (mehr).'];
        continue;
    }

    // Foto: identisch behandelt wie beim Ersatzscan (ENT-182-Fortsetzung) --
    // Groesse begrenzt und der Typ aus den ersten Bytes bestimmt, nicht aus
    // einer mitgeschickten Angabe, der man glauben muesste.
    $foto = null; $fotoMime = null;
    if (!empty($m['foto'])) {
        $roh = base64_decode((string)$m['foto'], true);
        if ($roh === false || $roh === '') {
            $ergebnisse[] = ['lokal_id' => $lokal, 'status' => 'fehler',
                'message' => 'Das Foto liess sich nicht lesen.'];
            continue;
        }
        if (strlen($roh) > ERSATZSCAN_FOTO_MAX) {
            $ergebnisse[] = ['lokal_id' => $lokal, 'status' => 'fehler',
                'message' => 'Das Foto ist zu gross.'];
            continue;
        }
        $fotoMime = ersatzscan_foto_mime($roh);
        if ($fotoMime === null) {
            $ergebnisse[] = ['lokal_id' => $lokal, 'status' => 'fehler',
                'message' => 'Nur JPEG oder PNG.'];
            continue;
        }
        $foto = $roh;
    }

    $bemerkung = isset($m['bemerkung']) ? trim((string)$m['bemerkung']) : '';
    $lat = isset($m['lat']) && is_numeric($m['lat']) ? (float)$m['lat'] : null;
    $lng = isset($m['lng']) && is_numeric($m['lng']) ? (float)$m['lng'] : null;

    try {
        $ins->execute([
            $objektId,
            !empty($m['rundgang_id']) ? (int)$m['rundgang_id'] : null,
            !empty($m['einsatz_id'])  ? (int)$m['einsatz_id']  : null,
            (int)$user['id'],
            $artId,
            $erfasst,
            $mysqlZeit($m['vorfall_am'] ?? null),
            $bemerkung !== '' ? $bemerkung : null,
            $foto, $fotoMime, $lat, $lng,
        ]);
        $ergebnisse[] = ['lokal_id' => $lokal, 'status' => 'ok', 'id' => (int)$pdo->lastInsertId()];
    } catch (Throwable $e) {
        $ergebnisse[] = ['lokal_id' => $lokal, 'status' => 'fehler',
            'message' => 'Die Meldung liess sich nicht speichern.'];
    }
}

json_response(['status' => 'ok', 'ergebnisse' => $ergebnisse]);
