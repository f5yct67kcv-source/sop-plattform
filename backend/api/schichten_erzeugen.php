<?php
// Legt die Schichten an, die schichten_vorschau.php gezeigt hat (ENT-021).
//
// Der Vorschlag wird hier NEU berechnet und nicht vom Aufrufer uebernommen --
// so entscheidet immer der Server, was entsteht, und eine veraltete Vorschau
// kann nichts Falsches anlegen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'einsaetze_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$objektId = (int)($in['objekt_id'] ?? 0);
$von = trim((string)($in['von'] ?? ''));
$bis = trim((string)($in['bis'] ?? ''));

foreach (['von' => $von, 'bis' => $bis] as $feld => $wert) {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $wert)) {
        json_response(['status' => 'error', 'message' => "$feld im Format JJJJ-MM-TT erforderlich"], 400);
    }
}
if ($bis < $von) {
    json_response(['status' => 'error', 'message' => 'Das Enddatum liegt vor dem Beginn'], 400);
}
$tage = (int)(new DateTimeImmutable($von))->diff(new DateTimeImmutable($bis))->format('%a');
if ($tage > 400) {
    json_response(['status' => 'error', 'message' => 'Hoechstens 400 Tage auf einmal'], 400);
}

$v = planung_vorschlag($objektId, $von, $bis);
if (isset($v['fehler'])) {
    json_response(['status' => 'error', 'message' => $v['fehler']], 404);
}
if (!$v['neu']) {
    json_response(['status' => 'ok', 'angelegt' => 0, 'uebersprungen' => $v['uebersprungen']]);
}

$o = $v['objekt'];
$pdo = db();
$pdo->beginTransaction();
try {
    $ins = $pdo->prepare(
        'INSERT INTO einsaetze (kunde_id, kunde_name, objekt_id, masterschicht_id, titel,
                                strasse, ort, einsatzart, sparte, datum, von, bis, bedarf, status, erstellt_von)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    foreach ($v['neu'] as $s) {
        // Fahrtzeit bleibt als eigene Einsatzart sichtbar. Ob sie bezahlte
        // Arbeitszeit ist, entscheidet dieses Werkzeug nicht (GAV).
        $einsatzart = $s['art'] === 'fahrtzeit' ? 'Fahrtzeit' : $o['einsatzart'];
        // Vorlage schlaegt Objekt (ENT-037).
        $sparte = sparte_pruefen($s['sparte'] ?? null, sparte_pruefen($o['sparte'] ?? null));
        $ins->execute([
            $o['kunde_id'], $o['kunde_name'], $o['id'], $s['masterschicht_id'], $s['name'],
            $o['strasse'], $o['ort'], $einsatzart, $sparte, $s['datum'], $s['von'], $s['bis'],
            $s['bedarf'], $s['status'], (int)$user['id'],
        ]);
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    // Die einheitliche Fehlerbehandlung in db.php formuliert die Meldung --
    // so erfaehrt der Admin z.B., dass eine Tabelle noch fehlt.
    throw $e;
}

json_response([
    'status' => 'ok',
    'angelegt' => count($v['neu']),
    'uebersprungen' => $v['uebersprungen'],
    'von' => $von,
    'bis' => $bis,
]);
