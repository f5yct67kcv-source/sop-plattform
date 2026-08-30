<?php
declare(strict_types=1);
// Die eigenen Abwesenheitsantraege lesen, stellen und (solange unentschieden)
// zurueckziehen (ENT-255). Nach demselben Muster wie meine_verfuegbarkeit.php:
// nicht admin-only, aber strikt auf die eigene Person begrenzt -- steht darum
// namentlich in der NUR_EIGENE_DATEN-Liste von test_php.mjs statt hinter
// einem der acht Rechte.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../ferien.php';

$user = require_session();
$ich = (int)$user['id'];

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $s = db()->prepare(
        'SELECT id, typ, von, bis, status, bemerkung, ablehnung_grund, beantragt_am, entschieden_am
         FROM abwesenheiten WHERE mitarbeiter_id = ? ORDER BY von DESC'
    );
    $s->execute([$ich]);
    json_response(['status' => 'ok', 'abwesenheiten' => $s->fetchAll()]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$pdo = db();

// Zurueckziehen eines eigenen, noch unentschiedenen Antrags -- kein
// Loeschen eines bereits entschiedenen: eine Entscheidung ist ein Beleg,
// keine Notiz, die man nachtraeglich verschwinden laesst.
if (!empty($in['stornieren'])) {
    $id = (int)($in['id'] ?? 0);
    $st = $pdo->prepare("DELETE FROM abwesenheiten WHERE id = ? AND mitarbeiter_id = ? AND status = 'beantragt'");
    $st->execute([$id, $ich]);
    if ($st->rowCount() === 0) {
        json_response(['status' => 'error',
            'message' => 'Nicht gefunden oder bereits entschieden -- ein entschiedener Antrag laesst sich nicht zurueckziehen.'], 400);
    }
    json_response(['status' => 'ok', 'storniert' => $id]);
}

$typ = trim((string)($in['typ'] ?? ''));
$von = trim((string)($in['von'] ?? ''));
$bis = trim((string)($in['bis'] ?? ''));
$bemerkung = trim((string)($in['bemerkung'] ?? ''));

if (!in_array($typ, FERIEN_ABWESENHEITSARTEN, true)) {
    json_response(['status' => 'error', 'message' => 'Unbekannte Abwesenheitsart'], 400);
}
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $von) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $bis)) {
    json_response(['status' => 'error', 'message' => 'Von/Bis im Format JJJJ-MM-TT erforderlich'], 400);
}
if ($bis < $von) {
    json_response(['status' => 'error', 'message' => 'Bis liegt vor Von'], 400);
}
// Nur Ferien ist ein VORAB-Antrag im eigentlichen Sinn -- Krankheit, Unfall,
// Militaer-/Zivilschutzdienst und Schwangerschaft werden ueblicherweise erst
// gemeldet, wenn sie eintreten oder bereits eingetreten sind, darum ohne
// Vergangenheits-Sperre.
if ($typ === 'ferien' && $von < date('Y-m-d')) {
    json_response(['status' => 'error', 'message' => 'Ferien lassen sich nicht rueckwirkend beantragen'], 400);
}
if (mb_strlen($bemerkung) > 500) {
    $bemerkung = mb_substr($bemerkung, 0, 500);
}

$pdo->prepare(
    'INSERT INTO abwesenheiten (mitarbeiter_id, typ, von, bis, bemerkung, beantragt_von, beantragt_am)
     VALUES (?, ?, ?, ?, ?, ?, NOW())'
)->execute([$ich, $typ, $von, $bis, $bemerkung !== '' ? $bemerkung : null, $ich]);

json_response(['status' => 'ok', 'id' => (int)$pdo->lastInsertId()]);
