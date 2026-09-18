<?php
// Rechnung der Betreiberin als bezahlt markieren oder zuruecknehmen (ENT-608).
//
// Einfache bezahlt/nicht-bezahlt-Markierung statt Teilzahlungen -- dieselbe
// Entscheidung wie im Cockpit (beleg_bezahlt.php, Entscheid des
// Projektinhabers vom 28.08.2026). "Offener Betrag" in der Liste ist damit
// entweder 0 oder der volle Rechnungsbetrag, nie etwas dazwischen.
//
// Eigener Endpunkt statt eines Feldes in betreiber_beleg_speichern.php,
// gleiches Muster wie betreiber_beleg_status.php und
// betreiber_beleg_archivieren.php: eine bewusste, einzelne Handlung, kein
// Feld, das beim routinemaessigen Speichern versehentlich mitwandert.
//
// NUR RECHNUNGEN. Eine Offerte wird nicht bezahlt; die Markierung an einer
// Offerte waere kein Zustand, sondern ein Tippfehler, und sie stuende
// danach in der Rechnungsliste-Logik als "Bezahlt" da, ohne dort je
// aufzutauchen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';

require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in      = json_decode(file_get_contents('php://input'), true) ?? [];
$id      = (int)($in['id'] ?? 0);
$bezahlt = !empty($in['bezahlt']) ? 1 : 0;
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'be_belege')) {
    json_response(['status' => 'error',
        'message' => 'Der Belegteil ist noch nicht eingerichtet.'], 503);
}

$s = $pdo->prepare('SELECT art FROM be_belege WHERE id = ?');
$s->execute([$id]);
$art = $s->fetchColumn();
if ($art === false) {
    json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
}
if ($art !== 'rechnung') {
    json_response(['status' => 'error',
        'message' => 'Nur eine Rechnung kann bezahlt sein.'], 400);
}

// Das Datum setzt der Server, nicht die Eingabe: Es ist der Tag, an dem die
// Markierung gesetzt wurde, und kein Feld, das jemand frei waehlt.
$bezahltAm = $bezahlt ? date('Y-m-d') : null;
$pdo->prepare('UPDATE be_belege SET bezahlt = ?, bezahlt_am = ? WHERE id = ?')
    ->execute([$bezahlt, $bezahltAm, $id]);

json_response(['status' => 'ok', 'bezahlt' => $bezahlt, 'bezahlt_am' => $bezahltAm]);
