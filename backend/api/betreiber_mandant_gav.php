<?php
// GAV-Unterstellung eines Mandanten bestaetigen (ENT-519).
//
// KEINE EIGENSTAENDIGE AUSLEGUNG. Das System stellt die Frage und haelt die
// Antwort fest -- mit Zeitpunkt und mit der Person, die sie gegeben hat, so
// wie das Auslegungsregister jede Annahme mit Herkunft fuehrt. Es leitet die
// Unterstellung NICHT selbst her: nicht aus dem Kanton, nicht aus der
// Betriebsgroesse, nicht aus der Branche. Wo der Wortlaut des GAV nicht
// eindeutig ist, gehoert ein Eintrag ins Auslegungsregister
// (90-gav/auslegungsregister.md im Projekt-Repository) und keine Annahme in
// dieses Feld.
//
// Die Bestaetigung ist ausdruecklich und nicht ableitbar: Ohne
// `bestaetigt: true` passiert nichts. Ein Klick auf "Ja" ohne gelesenen
// Hinweis waere derselbe Fehler wie ein Vorgabewert -- die Antwort saehe
// aus wie eine Entscheidung, ohne eine zu sein.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();
$pdo = betreiber_db();

if (!hat_tabelle($pdo, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

// GET liefert den Hinweistext, den der Bestaetigende gesehen haben muss.
// Er steht hier und nicht in der Oberflaeche, damit es EINEN Wortlaut gibt
// -- eine zweite Fassung im Browser waere eine zweite Wahrheit darueber,
// was jemand bestaetigt hat.
const GAV_HINWEIS =
    'Der Gesamtarbeitsvertrag für die private Sicherheitsdienstleistungsbranche regelt '
  . 'unter anderem Arbeitszeit, Zeitzuschläge und Auslagenersatz. Ob ein Betrieb ihm '
  . 'untersteht, entscheidet sich nach dem Geltungsbereich des GAV und der '
  . 'Allgemeinverbindlicherklärung — nicht nach einer Einschätzung dieser Software. '
  . 'Diese Angabe wird nicht hergeleitet, sondern von Ihnen bestätigt und mit Zeitpunkt '
  . 'festgehalten. Im Zweifelsfall ist die Unterstellung vor der Bestätigung abzuklären; '
  . 'sie bestimmt, gegen welches Regelwerk für diesen Betrieb gerechnet wird.';

if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    json_response([
        'status'       => 'ok',
        'hinweis'      => GAV_HINWEIS,
        'bezugsfassung' => 'Ausgabe 2026, AVE gültig bis 31.12.2026',
    ]);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id    = (int)($daten['id'] ?? 0);

if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'Welcher Mandant?'], 400);
}
if (!array_key_exists('unterstellt', $daten) || !is_bool($daten['unterstellt'])) {
    // Kein Vorgabewert. "Nicht beantwortet" bleibt "nicht beantwortet" --
    // dieselbe Familie wie die dreiwertige Lage in be_gav_lage().
    json_response(['status' => 'error',
        'message' => 'Die Frage ist mit Ja oder Nein zu beantworten.'], 400);
}
if (($daten['bestaetigt'] ?? false) !== true) {
    json_response(['status' => 'error',
        'message' => 'Die Angabe muss ausdrücklich bestätigt werden.',
        'hinweis' => GAV_HINWEIS], 400);
}

// Festgehalten wird, WER bestaetigt hat -- Name und Adresse des
// Betreiber-Kontos aus der Sitzung, nie aus der Anfrage. Ein Endpunkt, der
// den Bestaetigenden entgegennimmt, waere derselbe Fehler wie ein
// Portal-Endpunkt, der seine kunde_id aus der Anfrage liest.
$wer = trim((string)$ich['name']) . ' <' . (string)$ich['email'] . '>';

if (!be_gav_bestaetigen($pdo, $id, (bool)$daten['unterstellt'], $wer)) {
    json_response(['status' => 'error', 'message' => 'Diesen Mandanten gibt es nicht.'], 404);
}

json_response([
    'status'      => 'ok',
    'id'          => $id,
    'unterstellt' => (bool)$daten['unterstellt'],
    'bestaetigt_von' => $wer,
]);
