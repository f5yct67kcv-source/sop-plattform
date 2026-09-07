<?php
// Legt Masterschichten in einem Zug auf einen Zeitraum (ENT-026).
//
// Bisher brauchte es dafuer fuenf Einzeldialoge mit Stichtag, danach eine
// getrennte Vorschau und ein zweites Bestaetigen. Hier ist beides ein Schritt:
// Bedarf je Wochentag setzen UND die fehlenden Schichten anlegen.
//
// Mit "nur_pruefen" wird gerechnet und wieder zurueckgerollt -- die Oberflaeche
// zeigt damit die genaue Zahl, bevor irgendetwas geschrieben ist (ENT-015).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'masterschichten_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$objektId  = (int)($in['objekt_id'] ?? 0);
$von       = trim((string)($in['von'] ?? ''));
$bis       = trim((string)($in['bis'] ?? ''));
$nurPruefen = !empty($in['nur_pruefen']);
$vorlagen  = (array)($in['vorlagen'] ?? []);

foreach (['von' => $von, 'bis' => $bis] as $feld => $wert) {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $wert)) {
        json_response(['status' => 'error', 'message' => "$feld im Format JJJJ-MM-TT erforderlich"], 400);
    }
}
if ($bis < $von) {
    json_response(['status' => 'error', 'message' => 'Das Enddatum liegt vor dem Beginn'], 400);
}
if ((int)(new DateTimeImmutable($von))->diff(new DateTimeImmutable($bis))->format('%a') > 400) {
    json_response(['status' => 'error', 'message' => 'Hoechstens 400 Tage auf einmal'], 400);
}
if (!$vorlagen) {
    json_response(['status' => 'error', 'message' => 'Keine Schichtvorlage uebergeben'], 400);
}

$o = db()->prepare('SELECT id FROM objekte WHERE id = ?');
$o->execute([$objektId]);
if (!$o->fetch()) {
    json_response(['status' => 'error', 'message' => 'Objekt nicht gefunden'], 404);
}

// Nur Vorlagen dieses Objekts -- ein fremder Wert im Rumpf darf nichts bewirken.
$eigene = db()->prepare('SELECT id FROM masterschichten WHERE objekt_id = ?');
$eigene->execute([$objektId]);
$erlaubt = array_map('intval', $eigene->fetchAll(PDO::FETCH_COLUMN));

$pdo = db();
$pdo->beginTransaction();
try {
    $geaendert = [];
    foreach ($vorlagen as $v) {
        $id = (int)($v['id'] ?? 0);
        if (!in_array($id, $erlaubt, true)) {
            continue;
        }
        $r = bedarf_fassung_setzen($id, (array)$v, $von);
        if (isset($r['fehler'])) {
            $pdo->rollBack();
            json_response(['status' => 'error', 'message' => $r['fehler']], 404);
        }
        if ($r['art'] !== 'unveraendert') {
            $geaendert[] = $r;
        }
    }

    $vorschlag = planung_vorschlag($objektId, $von, $bis);
    if (isset($vorschlag['fehler'])) {
        $pdo->rollBack();
        json_response(['status' => 'error', 'message' => $vorschlag['fehler']], 404);
    }

    $angelegt = count($vorschlag['neu']);
    // Was in den ersten Tagen entstuende -- als Beleg dafuer, dass die Zahlen
    // stimmen, nicht als vollstaendige Liste.
    $probe = array_slice($vorschlag['neu'], 0, 12);

    if ($nurPruefen) {
        $pdo->rollBack();
        json_response([
            'status' => 'ok',
            'nur_pruefen' => true,
            'wuerde_anlegen' => $angelegt,
            'vorhanden' => $vorschlag['uebersprungen'],
            'fassungen' => count($geaendert),
            'neue_fassungen' => count(array_filter($geaendert, fn($g) => $g['art'] === 'neue Fassung')),
            'probe' => $probe,
        ]);
    }

    schichten_anlegen($vorschlag, (int)$user['id']);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

json_response([
    'status' => 'ok',
    'angelegt' => $angelegt,
    'vorhanden' => $vorschlag['uebersprungen'],
    'fassungen' => count($geaendert),
    'neue_fassungen' => count(array_filter($geaendert, fn($g) => $g['art'] === 'neue Fassung')),
    'von' => $von,
    'bis' => $bis,
]);
