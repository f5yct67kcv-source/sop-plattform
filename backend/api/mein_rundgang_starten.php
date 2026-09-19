<?php
// Startet einen Rundgang fuer den eigenen, zugeteilten Einsatz
// (ENT-132/ENT-145/ENT-180). Die Rohzeit beginnt NICHT hier, sondern erst
// mit dem ersten bestaetigten Kontrollpunkt -- siehe mein_rundgang_scan.php.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$einsatzId = (int)($input['einsatz_id'] ?? 0);
if ($einsatzId <= 0) {
    json_response(['status' => 'error', 'message' => 'einsatz_id erforderlich'], 422);
}

$pdo = db();

// Nur die eigene Zuteilung -- mitarbeiter_id kommt aus der Sitzung, nie aus
// dem Rumpf (gleiches Prinzip wie meine_zusage.php).
$chk = $pdo->prepare(
    'SELECT e.objekt_id FROM einsaetze e
      JOIN einsatz_zuteilung z ON z.einsatz_id = e.id
     WHERE e.id = ? AND z.mitarbeiter_id = ?'
);
$chk->execute([$einsatzId, (int)$user['id']]);
$einsatz = $chk->fetch();
if (!$einsatz) {
    json_response(['status' => 'error', 'message' => 'Dieser Einsatz gehoert nicht zu dir'], 404);
}
$objektId = $einsatz['objekt_id'] !== null ? (int)$einsatz['objekt_id'] : 0;
if ($objektId <= 0) {
    json_response(['status' => 'error', 'message' => 'Dieser Einsatz hat kein Objekt -- kein Rundgang moeglich'], 422);
}

// Optionale Kontrollrunde (ENT-204). Ohne Angabe: unveraendertes Verhalten
// von vor ENT-204 (alle aktiven Kontrollpunkte des Objekts). Serverseitig
// geprueft, nicht nur in der App -- sonst liesse sich eine Vorlage eines
// fremden Objekts unterschieben (Sperren gehoeren in den Server).
$vorlageId = isset($input['vorlage_id']) && $input['vorlage_id'] !== '' ? (int)$input['vorlage_id'] : null;
$fensterVon = null; $fensterBis = null; $vorlageName = null;
if ($vorlageId !== null) {
    // Der NAME der Runde geht mit heraus (ENT-541): Der Kopf der laufenden
    // Runde nennt sie beim Namen -- an einem Objekt mit "Nacht A" und
    // "Nacht B" ist das der einzige Unterschied, den der Waechter sieht.
    $vChk = $pdo->prepare('SELECT name, fenster_von, fenster_bis FROM rundgang_vorlage WHERE id = ? AND objekt_id = ? AND aktiv = 1');
    $vChk->execute([$vorlageId, $objektId]);
    $vRow = $vChk->fetch();
    if (!$vRow) {
        json_response(['status' => 'error', 'message' => 'Diese Kontrollrunde gibt es an diesem Objekt nicht (mehr)'], 404);
    }
    $fensterVon = $vRow['fenster_von'];
    $fensterBis = $vRow['fenster_bis'];
    $vorlageName = $vRow['name'];
}

// Zeitgate (ENT-279), serverseitig -- bisher stand die Zeitpruefung nur in
// der App (darfRundgang()), hier nachgezogen (Sperren gehoeren in den
// Server, nicht nur in die Oberflaeche). Mit einer Vorlage, die ein Fenster
// hat, gilt das Fenster (+Toleranz) statt der Einsatz-Sollzeit; sonst gilt
// unveraendert die Einsatz-Sollzeit wie vor ENT-279.
$ausnahmeGrund = isset($input['ausnahme_grund']) && $input['ausnahme_grund'] !== '' ? (string)$input['ausnahme_grund'] : null;
if ($fensterVon !== null && $fensterBis !== null) {
    if (!rundgang_im_fenster(date('H:i'), $fensterVon, $fensterBis, RUNDGANG_FENSTER_TOLERANZ_MIN)) {
        if ($ausnahmeGrund === null || !array_key_exists($ausnahmeGrund, RUNDGANG_AUSSERHALB_FENSTER_GRUENDE)) {
            json_response(['status' => 'error', 'message' => 'Ausserhalb des Zeitfensters dieser Kontrollrunde -- bitte einen Grund angeben.'], 422);
        }
    } else {
        // Innerhalb des Fensters: kein Ausnahmefall, ein trotzdem
        // mitgeschickter Grund wird nicht gespeichert -- er waere irrefuehrend.
        $ausnahmeGrund = null;
    }
} else {
    $eZeit = $pdo->prepare('SELECT datum, von FROM einsaetze WHERE id = ?');
    $eZeit->execute([$einsatzId]);
    $ez = $eZeit->fetch();
    if ($ez && strtotime($ez['datum'] . ' ' . $ez['von']) > time()) {
        json_response(['status' => 'error', 'message' => 'Dieser Einsatz hat noch nicht begonnen.'], 422);
    }
    $ausnahmeGrund = null;
}

/* Steht DIESELBE Runde noch offen? (ENT-630, Revision von ENT-629)

   ENT-629 sperrte jeden zweiten Start, egal welche Runde offen war. Der
   Projektinhaber hat das am Geraet verworfen: „Andere Rundgaenge lassen
   sich normal starten. Nur wenn es der pausierte Rundgang betrifft,
   braucht es eine Entscheidung." Genau danach faellt die Entscheidung
   hier -- und nur hier.

   ZWEI FAELLE, ZWEI ANTWORTEN:

   PAUSIERT: Der Waechter waehlt dieselbe Runde noch einmal an, waehrend
   sie pausiert liegt. Das ist der Fall aus den Bildschirmfotos des
   Projektinhabers: Beim Wettbewerb entsteht dort auf Wunsch eine ZWEITE
   pausierte Runde derselben Patrouille, und dieselbe Runde steht danach
   gleichzeitig als „ausgefuehrt" und zweimal als „pausiert" da. Solche
   Leichen entstehen hier nicht: Es gibt nur fortsetzen oder mit Grund
   abbrechen und neu starten. Die offene Runde kommt mit der Absage MIT,
   damit die App beides anbieten kann, statt einen roten Satz zu zeigen.

   LAEUFT ODER ERST VORBEREITET: Das ist kein Konflikt, sondern derselbe
   Startknopf ein zweites Mal (ENT-180/ENT-290) -- etwa weil der erste
   Versuch nur „vorbereitet" blieb. Antwort wie bisher.

   ABGRENZUNG ZU ENT-342: Dort ist eine Startsperre bewusst GEFALLEN, weil
   sie den Waechter vor einem Planungsfehler stehen liess, den er draussen
   gar nicht beheben konnte. Das gilt hier nicht: Die Sperre haengt an
   seiner eigenen Runde, und der Ausweg liegt im selben Fenster. */
$offen = rundgang_offener($pdo, (int)$user['id'])['rundgang'];
if (rundgang_gleiche_runde($offen, $objektId, $vorlageId)) {
    if ($offen['status'] === 'pausiert') {
        json_response(['status' => 'error', 'code' => 'runde_offen',
            'message' => 'Dieser Rundgang ist pausiert. Er muss zuerst fortgesetzt oder abgebrochen werden.',
            'offen' => $offen], 409);
    }
    json_response(['status' => 'error', 'message' => 'Es laeuft bereits ein Rundgang fuer diesen Einsatz'], 409);
}

$ins = $pdo->prepare(
    "INSERT INTO rundgang (einsatz_id, mitarbeiter_id, objekt_id, rundgang_vorlage_id, status, vorbereitet_am, ausnahme_grund)
     VALUES (?, ?, ?, ?, 'vorbereitet', NOW(), ?)"
);
$ins->execute([$einsatzId, (int)$user['id'], $objektId, $vorlageId, $ausnahmeGrund]);
$rundgangId = (int)$pdo->lastInsertId();

$kontrollpunkte = rundgang_kontrollpunkte_uebrig($pdo, $rundgangId, $objektId, $vorlageId);

json_response(['status' => 'ok', 'rundgang_id' => $rundgangId, 'kontrollpunkte' => $kontrollpunkte,
    'vorlage_name' => $vorlageName, 'fenster_von' => $fensterVon, 'fenster_bis' => $fensterBis]);
