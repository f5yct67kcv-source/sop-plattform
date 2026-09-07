<?php
declare(strict_types=1);
// Pflegen der Listen "Funktion" und "Abteilung" (ENT-072).
//
// Ein Endpunkt fuer beide, weil sie gleich gebaut sind. Der Tabellenname
// kommt NIE aus der Anfrage, sondern aus einer festen Zuordnung -- sonst
// waere die Art ein Einfallstor in beliebige Tabellen.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../mitarbeiter.php';

$user = require_session();
require_recht($user, 'betrieb_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$tabelle = ma_listen_tabelle((string)($input['art'] ?? ''));
if ($tabelle === null) {
    json_response(['status' => 'error', 'message' => 'unbekannte Liste'], 400);
}

$pdo = db();
if (!hat_tabelle_ma($pdo, $tabelle)) {
    json_response(['status' => 'error',
        'message' => 'Die Listen sind noch nicht angelegt — bitte einmal „Einrichtung“ ausführen.'], 409);
}

$id = (int)($input['id'] ?? 0);
$bezeichnung = trim((string)($input['bezeichnung'] ?? ''));
$loeschen = !empty($input['loeschen']);

if ($loeschen) {
    if ($id <= 0) { json_response(['status' => 'error', 'message' => 'kein Eintrag gewaehlt'], 400); }
    // Nicht wirklich loeschen, sondern stilllegen: An einem Eintrag koennen
    // Mitarbeitende haengen, und deren Funktion soll nicht verschwinden, nur
    // weil sie kuenftig nicht mehr vergeben wird (gleiches Vorgehen wie bei
    // objekte.aktiv und kunden.aktiv).
    $pdo->prepare("UPDATE $tabelle SET aktiv = 0 WHERE id = ?")->execute([$id]);
    json_response(['status' => 'ok', 'id' => $id, 'stillgelegt' => true]);
}

if ($bezeichnung === '') {
    json_response(['status' => 'error', 'message' => 'Bezeichnung erforderlich'], 400);
}
$sortierung = (int)($input['sortierung'] ?? 0);

try {
    if ($id > 0) {
        $pdo->prepare("UPDATE $tabelle SET bezeichnung = ?, sortierung = ?, aktiv = 1 WHERE id = ?")
            ->execute([$bezeichnung, $sortierung, $id]);
    } else {
        // Ein bereits stillgelegter Eintrag mit demselben Namen wird wieder
        // aufgeweckt, statt am eindeutigen Schluessel zu scheitern.
        $vorhanden = $pdo->prepare("SELECT id FROM $tabelle WHERE bezeichnung = ?");
        $vorhanden->execute([$bezeichnung]);
        $alt = $vorhanden->fetchColumn();
        if ($alt) {
            $pdo->prepare("UPDATE $tabelle SET aktiv = 1, sortierung = ? WHERE id = ?")
                ->execute([$sortierung, (int)$alt]);
            $id = (int)$alt;
        } else {
            $pdo->prepare("INSERT INTO $tabelle (bezeichnung, sortierung) VALUES (?, ?)")
                ->execute([$bezeichnung, $sortierung]);
            $id = (int)$pdo->lastInsertId();
        }
    }
} catch (PDOException $e) {
    if ($e->getCode() === '23000') {
        json_response(['status' => 'error', 'message' => "„$bezeichnung“ gibt es bereits"], 409);
    }
    throw $e;
}

json_response(['status' => 'ok', 'id' => $id]);
