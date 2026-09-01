<?php
// Startet einen Rundgang OHNE bestehenden Einsatz (ENT-279-Fortsetzung,
// Vorschlag des Projektinhabers): für den Fall, dass jemand spontan
// umdisponiert wird und eine Kontrollrunde an einem Objekt macht, dem er an
// diesem Tag nicht zugeteilt ist. Legt dafür automatisch einen Einsatz samt
// eigener Zuteilung an, damit die Zeit denselben Abgleich-Weg durchläuft
// wie jeder andere Rundgang -- kein eigener, unbeobachteter Zeitraum.
//
// Ein späteres Verschmelzen mit einer bereits geplanten Schicht (falls es
// sich herausstellt, dass es dieselbe war) ist als eigener Schritt
// vorgesehen, hier noch nicht gebaut (siehe OP-280 in sop-projekt).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require __DIR__ . '/../planung.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$vorlageId = (int)($input['vorlage_id'] ?? 0);
if ($vorlageId <= 0) {
    json_response(['status' => 'error', 'message' => 'vorlage_id erforderlich'], 422);
}

$pdo = db();

// Dieselbe Berechtigungsfrage wie in mein_rundgang_vorlagen_alle.php: nur
// wer ueberhaupt Revierdienst macht, darf hier ueberhaupt anfragen.
$chk = $pdo->prepare(
    'SELECT COUNT(*) FROM einsatz_zuteilung z
      JOIN einsaetze e ON e.id = z.einsatz_id
      JOIN kontrollpunkt k ON k.objekt_id = e.objekt_id AND k.aktiv = 1
     WHERE z.mitarbeiter_id = ?'
);
$chk->execute([(int)$user['id']]);
if ((int)$chk->fetchColumn() === 0) {
    json_response(['status' => 'error', 'message' => 'Kein Zugriff auf spontane Rundgänge'], 403);
}

$vStmt = $pdo->prepare(
    'SELECT v.id, v.name, v.fenster_von, v.fenster_bis, o.id AS objekt_id, o.kunde_id, o.kunde_name,
            o.strasse, o.ort, o.kanton, o.sparte
       FROM rundgang_vorlage v JOIN objekte o ON o.id = v.objekt_id
      WHERE v.id = ? AND v.aktiv = 1 AND o.aktiv = 1'
);
$vStmt->execute([$vorlageId]);
$v = $vStmt->fetch();
if (!$v) {
    json_response(['status' => 'error', 'message' => 'Diese Kontrollrunde gibt es nicht (mehr)'], 404);
}

// Zeitgate (ENT-279), dieselbe Regel wie beim schichtgebundenen Start --
// ohne Fenster an dieser Vorlage gibt es hier aber keinen Einsatz, an dessen
// Sollzeit sich ein Fallback orientieren koennte: ohne Fenster ist eine
// spontane Runde jederzeit startbar.
$ausnahmeGrund = isset($input['ausnahme_grund']) && $input['ausnahme_grund'] !== '' ? (string)$input['ausnahme_grund'] : null;
if ($v['fenster_von'] !== null && $v['fenster_bis'] !== null) {
    if (!rundgang_im_fenster(date('H:i'), $v['fenster_von'], $v['fenster_bis'], RUNDGANG_FENSTER_TOLERANZ_MIN)) {
        if ($ausnahmeGrund === null || !array_key_exists($ausnahmeGrund, RUNDGANG_AUSSERHALB_FENSTER_GRUENDE)) {
            json_response(['status' => 'error', 'message' => 'Ausserhalb des Zeitfensters dieser Kontrollrunde -- bitte einen Grund angeben.'], 422);
        }
    } else {
        $ausnahmeGrund = null;
    }
} else {
    $ausnahmeGrund = null;
}

$heute = date('Y-m-d');
$jetzt = date('H:i:s');
// Reine Platzhalter-Sollzeit fuer Doppelbelegung und Anzeige, bis zum
// Abgleich -- die tatsaechliche Arbeitszeit misst weiterhin die Rohzeit des
// Rundgangs (erster bestaetigter Scan, unveraendert seit ENT-145).
$bis = date('H:i:s', strtotime('+30 minutes'));

// Niemand darf zur selben Zeit an zwei Orten sein (ENT-022) -- dieselbe
// Prüfung wie beim regulären Einsatz-Anlegen (einsatz_save.php), hier für
// die eigene Person: eine spontane Runde darf niemanden ueberschreiben, der
// bereits anderswo eingeteilt ist.
$doppelt = doppelbelegungen(0, $heute, $jetzt, $bis, [(int)$user['id']]);
if ($doppelt) {
    // Ist die Kollision ausgerechnet mit der eigenen, noch offenen Runde
    // DERSELBEN Vorlage (ENT-290, gemeldeter Fehler: zweimal auf dieselbe
    // Kachel der objektuebergreifenden Uebersicht getippt, z.B. weil der
    // erste Versuch nur "vorbereitet" blieb)? Dann ist das kein echter
    // Konflikt, sondern dieselbe Runde, die schon laeuft -- die Oberflaeche
    // soll sie fortsetzen, statt an der eigenen Sperre zu scheitern und
    // keinen Weg mehr zurueck zu haben.
    $konfliktEinsatzId = (int)$doppelt[0]['einsatz_id'];
    $bestehendStmt = $pdo->prepare(
        "SELECT id FROM rundgang
          WHERE einsatz_id = ? AND mitarbeiter_id = ? AND rundgang_vorlage_id = ?
            AND status NOT IN ('abgeschlossen', 'abgebrochen')"
    );
    $bestehendStmt->execute([$konfliktEinsatzId, (int)$user['id'], $vorlageId]);
    $bestehendeRundgangId = $bestehendStmt->fetchColumn();
    if ($bestehendeRundgangId !== false) {
        json_response(['status' => 'laeuft_bereits',
            'einsatz_id' => $konfliktEinsatzId, 'rundgang_id' => (int)$bestehendeRundgangId]);
    }
    json_response(['status' => 'error',
        'message' => 'Du bist zu dieser Zeit bereits andernorts eingeteilt: ' . $doppelt[0]['was']], 409);
}

$pdo->beginTransaction();
try {
    $ins = $pdo->prepare(
        'INSERT INTO einsaetze (kunde_id, kunde_name, titel, strasse, ort, kanton, einsatzart, sparte,
                                datum, von, bis, bedarf, status, bemerkung, erstellt_von, spontan_erzeugt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1)'
    );
    $ins->execute([
        $v['kunde_id'], $v['kunde_name'], 'Spontaner Rundgang: ' . $v['name'],
        $v['strasse'], $v['ort'], $v['kanton'], 'Revierdienst', $v['sparte'],
        $heute, $jetzt, $bis, 'bestaetigt',
        'Automatisch angelegt durch spontanen Rundgang-Start in der App (ENT-279-Fortsetzung).',
        (int)$user['id'],
    ]);
    $einsatzId = (int)$pdo->lastInsertId();

    // Kein "offen": wer den Rundgang selbst spontan startet, hat damit
    // bereits zugesagt -- ein "wartet auf Rueckmeldung" waere hier falsch.
    $pdo->prepare('INSERT INTO einsatz_zuteilung (einsatz_id, mitarbeiter_id, zusage) VALUES (?, ?, ?)')
        ->execute([$einsatzId, (int)$user['id'], 'zugesagt']);

    $rIns = $pdo->prepare(
        "INSERT INTO rundgang (einsatz_id, mitarbeiter_id, objekt_id, rundgang_vorlage_id, status, vorbereitet_am, ausnahme_grund)
         VALUES (?, ?, ?, ?, 'vorbereitet', NOW(), ?)"
    );
    $rIns->execute([$einsatzId, (int)$user['id'], (int)$v['objekt_id'], $vorlageId, $ausnahmeGrund]);
    $rundgangId = (int)$pdo->lastInsertId();

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

$kontrollpunkte = rundgang_kontrollpunkte_uebrig($pdo, $rundgangId, (int)$v['objekt_id'], $vorlageId);
json_response(['status' => 'ok', 'einsatz_id' => $einsatzId, 'rundgang_id' => $rundgangId, 'kontrollpunkte' => $kontrollpunkte]);
