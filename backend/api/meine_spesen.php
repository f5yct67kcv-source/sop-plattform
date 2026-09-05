<?php
declare(strict_types=1);
// Die eigenen Spesenbelege lesen, erfassen, aendern, einreichen,
// zurueckziehen und (solange nicht eingereicht) loeschen (ENT-413).
//
// Nach demselben Muster wie meine_abwesenheit.php: nicht admin-only, aber
// strikt auf die eigene Person begrenzt -- steht darum namentlich in der
// NUR_EIGENE_DATEN-Liste von test_php.mjs statt hinter einem der acht
// Rechte. Die mitarbeiter_id stammt aus der SITZUNG, nie aus dem Rumpf:
// Eine id im Rumpf sagt nur, welchen der EIGENEN Belege es trifft.
//
// DIESE DATEI ENTSCHEIDET NICHTS. Sie prueft die Eingabe auf Form und
// Grenzen und reicht sie an die Regeln in backend/spesen.php weiter -- die
// laufen dort gegen eine echte Datenbank in pruef_spesen.php. Was hier
// steht, ist die Uebersetzung zwischen HTTP und Regel, nicht die Regel.
//
// Der Beleg geht hier nur HINEIN. Herausgegeben wird er von
// meine_spesen_beleg.php -- ein Endpunkt, der JSON liefert, kann nicht
// nebenbei Binaerdaten ausliefern.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../spesen.php';

$user = require_session();
$ich = (int)$user['id'];
$pdo = db();

// Der Bereich ist neu: Wer die Einrichtung noch nicht laufen liess, hat die
// Tabelle nicht. Das ist "nicht eingerichtet" und NICHT "keine Belege" --
// zwei verschiedene Aussagen, die die Oberflaeche auseinanderhalten muss
// (CLAUDE.md: „unbekannt" darf nie wie „keine" aussehen).
if (!hat_tabelle($pdo, 'spesen')) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'spesen' => []]);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    json_response([
        'status' => 'ok',
        'eingerichtet' => true,
        'kategorien' => SPESEN_KATEGORIEN,
        'spesen' => spesen_eigene($pdo, $ich),
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);

// Was die Regel zurueckgibt, in Worte und HTTP-Status uebersetzt. Jede
// Absage nennt den Grund beim Namen -- "nicht gefunden" und "dafuer ist es
// zu spaet" sind verschiedene Aussagen.
function spesen_absage(string $schluessel): void
{
    $texte = [
        'nicht_gefunden'     => ['Diesen Beleg gibt es nicht (mehr).', 404],
        'nicht_mehr_erfasst' => ['Der Beleg ist bereits eingereicht — ändern und löschen geht dann nicht mehr. Zurückziehen schon.', 409],
        'nicht_eingereicht'  => ['Der Beleg ist nicht eingereicht.', 409],
    ];
    [$text, $code] = $texte[$schluessel] ?? ['Das ist so nicht möglich.', 400];
    json_response(['status' => 'error', 'grund' => $schluessel, 'message' => $text], $code);
}

foreach ([['loeschen', 'spesen_loeschen'], ['einreichen', 'spesen_einreichen'],
          ['zurueckziehen', 'spesen_zurueckziehen']] as [$schalter, $regel]) {
    if (empty($in[$schalter])) { continue; }
    $ergebnis = $regel($pdo, $ich, $id);
    if ($ergebnis !== 'ok') { spesen_absage($ergebnis); }
    json_response(['status' => 'ok', $schalter => $id]);
}

// ── Erfassen und Aendern ──────────────────────────────────────────────
$datum = trim((string)($in['datum'] ?? ''));
$kategorie = trim((string)($in['kategorie'] ?? ''));
$notiz = trim((string)($in['notiz'] ?? ''));

if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum)) {
    json_response(['status' => 'error', 'message' => 'Datum im Format JJJJ-MM-TT erforderlich'], 400);
}
// Ein Belegdatum in der Zukunft gibt es nicht -- die Quittung ist gedruckt,
// bevor sie fotografiert wird. Rueckwirkend ist dagegen der Normalfall.
if ($datum > date('Y-m-d')) {
    json_response(['status' => 'error', 'message' => 'Das Belegdatum liegt in der Zukunft'], 400);
}
if (!spesen_kategorie_gueltig($kategorie)) {
    json_response(['status' => 'error', 'message' => 'Unbekannte Kategorie'], 400);
}

// Der Betrag kommt bereits in Rappen -- die Oberflaeche rechnet Franken um,
// damit hier keine zweite Kommastellen-Auslegung entsteht.
$betrag = (int)($in['betrag_rappen'] ?? 0);
if ($betrag <= 0) {
    json_response(['status' => 'error', 'message' => 'Ein Beleg braucht einen Betrag grösser als null'], 400);
}
if ($betrag > SPESEN_BETRAG_MAX_RAPPEN) {
    json_response(['status' => 'error',
        'message' => 'Betrag über CHF ' . number_format(SPESEN_BETRAG_MAX_RAPPEN / 100, 2) . ' — bitte prüfen.'], 400);
}
if (mb_strlen($notiz) > 500) { $notiz = mb_substr($notiz, 0, 500); }

// Beleg: drei Zustaende, nicht zwei. Fehlt der Schluessel ganz, bleibt ein
// vorhandener Beleg unangetastet (Aendern von Betrag oder Notiz soll das
// Bild nicht wegwerfen). 'beleg_entfernen' loescht ihn ausdruecklich.
$belegNeu = null; $belegMime = null; $belegAendern = false;
if (!empty($in['beleg'])) {
    $roh = base64_decode((string)$in['beleg'], true);
    if ($roh === false || $roh === '') {
        json_response(['status' => 'error', 'message' => 'Beleg nicht lesbar'], 400);
    }
    if (strlen($roh) > SPESEN_BELEG_MAX) {
        json_response(['status' => 'error',
            'message' => 'Der Beleg ist grösser als ' . (SPESEN_BELEG_MAX / 1024 / 1024) . ' MB.'], 413);
    }
    $belegMime = spesen_beleg_mime($roh);
    if ($belegMime === null) {
        json_response(['status' => 'error', 'message' => 'Nur JPEG, PNG oder PDF.'], 400);
    }
    $belegNeu = $roh; $belegAendern = true;
} elseif (!empty($in['beleg_entfernen'])) {
    $belegAendern = true;   // beide bleiben null -> Beleg wird geloescht
}

$felder = ['datum' => $datum, 'kategorie' => $kategorie,
           'betrag_rappen' => $betrag, 'notiz' => $notiz];

if ($id > 0) {
    $ergebnis = spesen_aendern($pdo, $ich, $id, $felder, $belegAendern, $belegNeu, $belegMime);
    if ($ergebnis !== 'ok') { spesen_absage($ergebnis); }
    json_response(['status' => 'ok', 'id' => $id]);
}

$felder['beleg'] = $belegNeu;
$felder['beleg_mime'] = $belegMime;
json_response(['status' => 'ok', 'id' => spesen_anlegen($pdo, $ich, $felder)]);
