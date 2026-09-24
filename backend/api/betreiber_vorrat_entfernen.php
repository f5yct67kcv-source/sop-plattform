<?php
// Einen Vorratsplatz entfernen (ENT-705).
//
// NUR EINE ZEILE MIT STATUS VORRAT, und das steht in der Anweisung selbst
// ("AND status = vorrat"), nicht in einer Pruefung davor: So kann zwischen
// Nachsehen und Loeschen niemand die Zeile zu einem Kunden machen, der dann
// geloescht wuerde. Ein Kunde laesst sich auf diesem Weg nie entfernen.
//
// ENTFERNT WIRD NUR DER EINTRAG IM MANDANTENSTAMM. Die Datenbank beim Hoster
// und der Eintrag in MANDANT_SECRETS bleiben -- beides liegt ausserhalb
// dieser Anlage, und die Rueckfrage in der Oberflaeche sagt das.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_response(['status' => 'error', 'message' => 'Nur POST.'], 405);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id    = (int)($daten['id'] ?? 0);

$s = $pdo->prepare('SELECT name, status FROM mandant WHERE id = ?');
$s->execute([$id]);
$m = $s->fetch(PDO::FETCH_ASSOC);
if (!$m) {
    json_response(['status' => 'error', 'message' => 'Diesen Platz gibt es nicht.'], 404);
}

$stmt = $pdo->prepare('DELETE FROM mandant WHERE id = ? AND status = ?');
$stmt->execute([$id, MANDANT_STATUS_VORRAT]);
if ($stmt->rowCount() === 0) {
    json_response(['status' => 'error',
        'message' => 'Diese Anlage liegt nicht im Vorrat — ein Kunde lässt sich hier nicht entfernen.'], 409);
}

be_log($pdo, $ich, 'mandant', $id, 'aus dem Vorrat entfernt', (string)$m['name'], null);

json_response(['status' => 'ok', 'id' => $id]);
