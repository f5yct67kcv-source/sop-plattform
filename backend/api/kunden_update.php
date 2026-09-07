<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../kunden.php';

$user = require_session();
require_recht($user, 'kunden_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($input['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'Kunde erforderlich'], 400);
}

$pdo = db();
$s = $pdo->prepare('SELECT * FROM kunden WHERE id = ?');
$s->execute([$id]);
$alt = $s->fetch();
if (!$alt) {
    json_response(['status' => 'error', 'message' => 'Kunde nicht gefunden'], 404);
}

// Teiltolerant gegen den bisherigen Bestand: Felder, die die Anfrage nicht
// mitschickt, behalten ihren Wert. Der Admin-Bereich der Erfassung
// (index.html) kennt nur Name, Strasse, Ort, Telefon und E-Mail und wuerde
// die seit ENT-044 dazugekommenen Felder sonst bei jedem Speichern leeren.
$gelesen = kunden_eingabe_lesen($input, (array)$alt);
$spalten = $gelesen['spalten'];

if ($spalten['name'] === '') {
    json_response(['status' => 'error', 'message' => $spalten['art'] === 'privat'
        ? 'Vor- und Nachname erforderlich' : 'Name erforderlich'], 400);
}
if ($spalten['plz'] === '' || $spalten['ort'] === '') {
    json_response(['status' => 'error', 'message' => 'PLZ und Ort erforderlich'], 400);
}

// Die Kundennummer ist bewusst nicht Teil dieses Aufrufs -- sie wird einmalig
// bei Anlage vergeben und bleibt danach unveraendert (ENT-040).
$pdo->beginTransaction();
try {
    $zuweisung = implode(' = ?, ', array_keys($spalten)) . ' = ?';
    $pdo->prepare("UPDATE kunden SET $zuweisung WHERE id = ?")
        ->execute(array_merge(array_values($spalten), [$id]));

    if ($gelesen['kinder'] !== null) {
        kunden_kinder_speichern($pdo, $id, $gelesen['kinder']['kontaktwege'], $gelesen['kinder']['personen']);
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

json_response(['status' => 'ok']);
