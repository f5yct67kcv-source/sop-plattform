<?php
// Zerlegt einen diktierten Planungsbefehl (ENT-026). Schreibt nichts --
// das Ergebnis fuellt nur den jeweiligen Dialog vor, bestaetigt wird dort
// (Pruefschritt nach ENT-015).
//
// Zwei Befehlsarten, ueber "art" gewaehlt:
//   masterplan  — "setze die Schliessrunde jeden Tag auf den August"
//   zuteilung   — "setze Vito vom 1. bis 15. auf die Schliessrunde"
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../ai.php';
require __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'plan');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$text     = trim((string)($in['text'] ?? ''));
$art      = ($in['art'] ?? '') === 'zuteilung' ? 'zuteilung' : 'masterplan';
$objektId = (int)($in['objekt_id'] ?? 0);
$monat    = trim((string)($in['monat'] ?? ''));

if ($text === '') {
    json_response(['status' => 'error', 'message' => 'Text erforderlich'], 400);
}
if (!preg_match('/^\d{4}-\d{2}$/', $monat)) {
    $monat = date('Y-m');
}
// "morgen" richtet sich nach der Uhr des Admins, nicht nach der des Servers.
$heute = trim((string)($in['heute'] ?? ''));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $heute)) {
    $heute = date('Y-m-d');
}

$o = db()->prepare('SELECT id, name FROM objekte WHERE id = ?');
$o->execute([$objektId]);
$objekt = $o->fetch();
if (!$objekt) {
    json_response(['status' => 'error', 'message' => 'Objekt nicht gefunden'], 404);
}

// Nur Vorlagen, die im gezeigten Monat gelten -- eine abgelaufene Fassung
// vorzuschlagen waere irrefuehrend.
$monatsEnde = date('Y-m-t', strtotime($monat . '-01'));
$ms = db()->prepare(
    'SELECT id, name, kuerzel, von, bis FROM masterschichten
     WHERE objekt_id = ? AND gueltig_ab <= ? AND (gueltig_bis IS NULL OR gueltig_bis >= ?)
     ORDER BY von, name'
);
$ms->execute([$objektId, $monatsEnde, $monat . '-01']);
$vorlagen = $ms->fetchAll();
if (!$vorlagen) {
    json_response([
        'status' => 'error',
        'message' => 'Fuer diesen Monat gilt keine Masterschicht dieses Objekts.',
    ], 400);
}
$erlaubteIds = array_map('intval', array_column($vorlagen, 'id'));

if ($art === 'masterplan') {
    $e = anthropic_extract_masterplan($text, $vorlagen, $heute, $monat);
    if ($e === null) {
        json_response(['status' => 'error', 'message' => 'Erkennung nicht verfuegbar'], 502);
    }
    $felder = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so', 'feiertag'];
    $raus = [];
    foreach ((array)($e['vorlagen'] ?? []) as $v) {
        $id = (int)($v['id'] ?? 0);
        if (!in_array($id, $erlaubteIds, true)) {
            continue;   // erfundene ID faellt weg
        }
        $satz = ['id' => $id];
        foreach ($felder as $f) {
            $satz['bedarf_' . $f] = max(0, min(99, (int)($v['bedarf_' . $f] ?? 0)));
        }
        $raus[] = $satz;
    }
    if (!$raus) {
        json_response([
            'status' => 'error',
            'message' => 'Aus dem Befehl liess sich keine Schichtvorlage zuordnen.',
        ], 422);
    }
    json_response([
        'status' => 'ok',
        'art' => 'masterplan',
        'vorlagen' => $raus,
        'von' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($e['von'] ?? '')) ? $e['von'] : null,
        'bis' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($e['bis'] ?? '')) ? $e['bis'] : null,
    ]);
}

// ── Zuteilung
$mitarbeiter = db()->query(
    'SELECT id, name, vorname, nachname FROM mitarbeiter WHERE aktiv = 1 ORDER BY name'
)->fetchAll();

$e = anthropic_extract_zuteilung($text, $vorlagen, $mitarbeiter, $heute, $monat);
if ($e === null) {
    json_response(['status' => 'error', 'message' => 'Erkennung nicht verfuegbar'], 502);
}

$msId = (int)($e['masterschicht_id'] ?? 0);
if (!in_array($msId, $erlaubteIds, true)) {
    json_response([
        'status' => 'error',
        'message' => 'Aus dem Befehl liess sich keine Schicht dieses Objekts zuordnen.',
    ], 422);
}

// Nur Login-Namen durchlassen, die es wirklich gibt.
$nachName = [];
foreach ($mitarbeiter as $m) {
    $nachName[$m['name']] = (int)$m['id'];
}
$ids = [];
foreach ((array)($e['mitarbeiter_login_namen'] ?? []) as $n) {
    if (isset($nachName[(string)$n])) {
        $ids[] = $nachName[(string)$n];
    }
}
$ids = array_values(array_unique($ids));
if (!$ids) {
    json_response([
        'status' => 'error',
        'message' => 'Aus dem Befehl liess sich keine bekannte Person zuordnen.',
    ], 422);
}

json_response([
    'status' => 'ok',
    'art' => 'zuteilung',
    'masterschicht_id' => $msId,
    'mitarbeiter' => $ids,
    'von' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($e['von'] ?? '')) ? $e['von'] : null,
    'bis' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($e['bis'] ?? '')) ? $e['bis'] : null,
]);
