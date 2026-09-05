<?php
declare(strict_types=1);
// Einen eingereichten Spesenbeleg freigeben oder ablehnen (ENT-413).
//
// require_recht('personal_schreiben') aus demselben Grund wie in
// spesen_list.php und abwesenheit_entscheiden.php: Der Entscheid betrifft
// den Anspruch einer einzelnen Person, das ist Personalarbeit -- und der
// Rechtekatalog bleibt bewusst grob (rechte.php).
//
// Was hier NICHT passiert: Es wird kein Betrag berechnet, nichts an einen
// Lohnlauf uebergeben und nichts als bezahlt vermerkt. Eine Freigabe sagt
// "der Beleg ist anerkannt", nicht "das Geld ist geflossen" -- zwei
// verschiedene Aussagen, und die zweite hat noch niemand entschieden.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../spesen.php';

$user = require_session();
require_recht($user, 'personal_schreiben');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
$status = trim((string)($in['status'] ?? ''));
$grund = trim((string)($in['ablehnung_grund'] ?? ''));

if (!in_array($status, ['freigegeben', 'abgelehnt'], true)) {
    json_response(['status' => 'error', 'message' => 'Status muss freigegeben oder abgelehnt sein'], 400);
}
// Eine Ablehnung ohne Begruendung waere fuer die betroffene Person nicht
// nachvollziehbar -- dieselbe Regel wie beim Abwesenheitsentscheid.
if ($status === 'abgelehnt' && $grund === '') {
    json_response(['status' => 'error', 'message' => 'Eine Ablehnung braucht eine Begründung'], 400);
}
if (mb_strlen($grund) > 500) { $grund = mb_substr($grund, 0, 500); }

$pdo = db();
if (!hat_tabelle($pdo, 'spesen')) {
    json_response(['status' => 'error', 'message' => 'Der Spesenbereich ist noch nicht eingerichtet'], 404);
}

// Ein Beleg im Zustand 'erfasst' liegt noch in der Mappe der Person und ist
// kein Antrag -- er laesst sich darum auch nicht entscheiden. Ein bereits
// entschiedener dagegen schon: Erneutes Entscheiden ueberschreibt bewusst,
// statt eine eigene Korrektur-Historie zu verlangen (gleiche Handhabung wie
// abwesenheit_entscheiden.php und beleg_status.php, keine neue Ausnahme).
$s = $pdo->prepare('SELECT status FROM spesen WHERE id = ?');
$s->execute([$id]);
$vorher = $s->fetchColumn();
if ($vorher === false) {
    json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
}
if ($vorher === 'erfasst') {
    json_response(['status' => 'error',
        'message' => 'Dieser Beleg ist noch nicht eingereicht.'], 400);
}

$pdo->prepare(
    'UPDATE spesen SET status = ?, ablehnung_grund = ?, entschieden_von = ?, entschieden_am = NOW()
     WHERE id = ?'
)->execute([$status, $status === 'abgelehnt' ? $grund : null, (int)$user['id'], $id]);

json_response(['status' => 'ok', 'id' => $id, 'neuer_status' => $status]);
