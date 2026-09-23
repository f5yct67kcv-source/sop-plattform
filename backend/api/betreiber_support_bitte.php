<?php
// Der Betreiber BITTET um eine Support-Freigabe (ENT-683).
//
// ANLASS: Bis hierher konnte er nur warten. Sah er eine Anfrage, für deren
// Klärung er in die Anlage hätte sehen müssen, blieb ihm das Telefon --
// und der Betrieb musste raten, wofür er die Tür aufmachen soll.
//
// DIE BITTE ÖFFNET NICHTS. Sie legt einen Grund in die Datenbank des
// Betriebs, mehr nicht. Erteilt wird die Freigabe ausschliesslich dort, im
// Cockpit, mit dem Recht 'rechte' (api/support_freigabe.php, ENT-526).
// Genau darum darf der Betreiber sie schreiben: Eine Bitte, die man sich
// selbst erfüllen kann, wäre keine.
//
// WARUM SIE BEIM BETRIEB LIEGT: Er soll nachlesen können, wer wann um
// Einblick gebeten hat, ohne den Betreiber zu fragen -- dieselbe
// Überlegung wie bei Freigabe und Protokoll. Bei einem Demo-Platz geht es
// ohnehin nicht anders, er erreicht den Stamm nicht (ENT-681).
//
// POST { id }                        -> bitten, mit Zweck
// POST { id, zuruecknehmen: true }   -> die eigene Bitte zurückziehen
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../support.php';

$ich   = require_betreiber_voll();
$stamm = betreiber_db();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$daten     = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$mandantId = (int)($daten['id'] ?? 0);
if ($mandantId <= 0) {
    json_response(['status' => 'error', 'message' => 'Welcher Mandant?'], 400);
}
if (!hat_tabelle($stamm, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

$s = $stamm->prepare('SELECT id, name, status, db_host, db_name, db_user, secret_name
                        FROM mandant WHERE id = ?');
$s->execute([$mandantId]);
$m = $s->fetch(PDO::FETCH_ASSOC);
if (!$m) {
    json_response(['status' => 'error', 'message' => 'Diesen Mandanten gibt es nicht.'], 404);
}

try {
    $pdo = mandant_db($m);
} catch (Throwable $e) {
    // Der Treibertext trägt Host und Benutzer und geht nicht nach aussen.
    json_response(['status' => 'error', 'lage' => mandant_verbindung_bereit($m),
        'message' => 'Diese Anlage ist nicht erreichbar.'], 502);
}

if (!support_bitte_da($pdo)) {
    // Eigener Grund statt eines allgemeinen Fehlers: "Noch nicht
    // eingerichtet" verlangt einen anderen Handgriff als "geht nicht".
    json_response(['status' => 'error', 'grund' => 'nicht_eingerichtet',
        'message' => 'Auf dieser Anlage ist die Support-Freigabe noch nicht eingerichtet. '
                   . 'Einmal die Einrichtung dort ausführen, dann lässt sich bitten.'], 409);
}

// Zurückziehen.
if (($daten['zuruecknehmen'] ?? false) === true) {
    $zahl = support_bitte_zuruecknehmen($pdo);
    json_response(['status' => 'ok', 'zurueckgezogen' => $zahl, 'bitte' => null]);
}

// Der Zweck ist Pflicht -- wie bei der Freigabe selbst. Eine Bitte ohne
// Grund verlangt vom Betrieb genau das Raten, das sie ersparen soll.
$zweck = trim((string)($daten['zweck'] ?? ''));
if ($zweck === '') {
    json_response(['status' => 'error',
        'message' => 'Bitte kurz angeben, wofür der Einblick gebraucht wird.'], 400);
}

// Wer bittet, kommt aus der SITZUNG -- nie aus der Anfrage. Derselbe
// Grundsatz wie beim Freigebenden in api/support_freigabe.php. Mit Name und
// Adresse, damit der Betrieb weiss, wem er die Tür öffnet.
$wer = trim((string)$ich['name']) . ' <' . (string)$ich['email'] . '>';

support_bitten($pdo, $wer, $zweck);

json_response(['status' => 'ok', 'bitte' => support_bitte_offen($pdo)]);
