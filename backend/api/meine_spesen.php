<?php
declare(strict_types=1);
// Die eigenen Spesenbelege lesen, erfassen, aendern, einreichen und
// (solange nicht eingereicht) loeschen (ENT-413).
//
// Nach demselben Muster wie meine_abwesenheit.php: nicht admin-only, aber
// strikt auf die eigene Person begrenzt -- steht darum namentlich in der
// NUR_EIGENE_DATEN-Liste von test_php.mjs statt hinter einem der acht
// Rechte. Jede Abfrage traegt mitarbeiter_id aus der SITZUNG, nie aus dem
// Rumpf: Eine id im Rumpf sagt nur, welchen der EIGENEN Belege es trifft.
//
// Der Beleg selbst geht hier nur HINEIN. Herausgegeben wird er von
// meine_spesen_beleg.php -- ein Endpunkt, der JSON liefert, kann nicht
// nebenbei Binaerdaten ausliefern, und eine Liste mit eingebetteten
// Belegen waere bei zwoelf Monaten Historie ein Vielfaches an Uebertragung
// fuer etwas, das man einzeln ansieht.
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

// Beleg NICHT mitlesen (siehe Kopf) -- nur, ob einer da ist und welcher Art.
const SPESEN_FELDER = 'id, datum, kategorie, betrag_rappen, notiz, status,
     erfasst_am, eingereicht_am, ablehnung_grund, entschieden_am, beleg_mime';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $s = $pdo->prepare('SELECT ' . SPESEN_FELDER . '
         FROM spesen WHERE mitarbeiter_id = ? ORDER BY datum DESC, id DESC');
    $s->execute([$ich]);
    json_response([
        'status' => 'ok',
        'eingerichtet' => true,
        'kategorien' => SPESEN_KATEGORIEN,
        'spesen' => array_map('spesen_zeile_ausgeben', $s->fetchAll()),
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);

// ── Loeschen ──────────────────────────────────────────────────────────
// Nur solange der Beleg noch in der eigenen Mappe liegt. Ein eingereichter
// Beleg ist bei der Verwaltung angekommen; ihn dort verschwinden zu lassen,
// waere dieselbe Luecke wie ein nachtraeglich geloeschter Abwesenheits-
// entscheid (meine_abwesenheit.php). Zurueckziehen geht ueber 'zurueckziehen'.
if (!empty($in['loeschen'])) {
    $st = $pdo->prepare("DELETE FROM spesen WHERE id = ? AND mitarbeiter_id = ? AND status = 'erfasst'");
    $st->execute([$id, $ich]);
    if ($st->rowCount() === 0) {
        json_response(['status' => 'error',
            'message' => 'Nicht gefunden oder bereits eingereicht — ein eingereichter Beleg lässt sich nicht löschen, nur zurückziehen.'], 400);
    }
    json_response(['status' => 'ok', 'geloescht' => $id]);
}

// ── Einreichen ────────────────────────────────────────────────────────
// Erst hier wird der Beleg fuer die Verwaltung sichtbar. Ein Beleg ohne
// Bild darf eingereicht werden -- die Quittung kann nachgereicht sein, und
// eine Sperre dagegen haette nur bedeutet, dass jemand ein leeres Blatt
// fotografiert.
if (!empty($in['einreichen'])) {
    $st = $pdo->prepare("UPDATE spesen SET status = 'eingereicht', eingereicht_am = NOW()
         WHERE id = ? AND mitarbeiter_id = ? AND status = 'erfasst'");
    $st->execute([$id, $ich]);
    if ($st->rowCount() === 0) {
        json_response(['status' => 'error',
            'message' => 'Nicht gefunden oder nicht mehr im Zustand „erfasst“.'], 400);
    }
    json_response(['status' => 'ok', 'eingereicht' => $id]);
}

// ── Zurueckziehen ─────────────────────────────────────────────────────
// Solange die Verwaltung nicht entschieden hat, darf der Beleg zurueck in
// die eigene Mappe -- etwa, weil der Betrag falsch abgetippt war. Nach
// einem Entscheid nicht mehr: Der Entscheid ist ein Beleg, keine Notiz.
if (!empty($in['zurueckziehen'])) {
    $st = $pdo->prepare("UPDATE spesen SET status = 'erfasst', eingereicht_am = NULL
         WHERE id = ? AND mitarbeiter_id = ? AND status = 'eingereicht'");
    $st->execute([$id, $ich]);
    if ($st->rowCount() === 0) {
        json_response(['status' => 'error',
            'message' => 'Nicht gefunden oder bereits entschieden — ein entschiedener Beleg lässt sich nicht zurückziehen.'], 400);
    }
    json_response(['status' => 'ok', 'zurueckgezogen' => $id]);
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

if ($id > 0) {
    // Geaendert wird nur, was noch in der eigenen Mappe liegt. Ein
    // eingereichter oder entschiedener Beleg ist fuer die Verwaltung eine
    // feste Groesse -- liesse er sich nachtraeglich umschreiben, waere die
    // Freigabe auf einen anderen Betrag erteilt worden als den, der danach
    // dasteht.
    $sql = 'UPDATE spesen SET datum = ?, kategorie = ?, betrag_rappen = ?, notiz = ?'
        . ($belegAendern ? ', beleg = ?, beleg_mime = ?' : '')
        . " WHERE id = ? AND mitarbeiter_id = ? AND status = 'erfasst'";
    $werte = [$datum, $kategorie, $betrag, $notiz !== '' ? $notiz : null];
    if ($belegAendern) { $werte[] = $belegNeu; $werte[] = $belegMime; }
    $werte[] = $id; $werte[] = $ich;
    $st = $pdo->prepare($sql);
    $st->execute($werte);
    if ($st->rowCount() === 0) {
        // rowCount 0 heisst hier zweierlei: nicht gefunden/nicht erlaubt --
        // oder gefunden und unveraendert gespeichert. Beides als Fehler zu
        // melden waere falsch, darum wird nachgesehen, ob es ihn gibt.
        $p = $pdo->prepare("SELECT status FROM spesen WHERE id = ? AND mitarbeiter_id = ?");
        $p->execute([$id, $ich]);
        $vorhanden = $p->fetchColumn();
        if ($vorhanden === false || $vorhanden !== 'erfasst') {
            json_response(['status' => 'error',
                'message' => 'Nicht gefunden oder bereits eingereicht — ein eingereichter Beleg lässt sich nicht mehr ändern.'], 400);
        }
    }
    json_response(['status' => 'ok', 'id' => $id]);
}

$pdo->prepare(
    'INSERT INTO spesen (mitarbeiter_id, datum, kategorie, betrag_rappen, notiz, beleg, beleg_mime, erfasst_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())'
)->execute([$ich, $datum, $kategorie, $betrag, $notiz !== '' ? $notiz : null, $belegNeu, $belegMime]);

json_response(['status' => 'ok', 'id' => (int)$pdo->lastInsertId()]);

// Der Datensatz, wie ihn die Oberflaeche braucht: hat_beleg statt des Belegs
// selbst, und die Art dazu -- ein PDF laesst sich nicht als Vorschaubild
// zeigen, die Oberflaeche muss das vorher wissen.
function spesen_zeile_ausgeben(array $r): array
{
    $r['betrag_rappen'] = (int)$r['betrag_rappen'];
    $r['hat_beleg'] = $r['beleg_mime'] !== null;
    $r['beleg_ist_pdf'] = $r['beleg_mime'] === 'application/pdf';
    unset($r['beleg_mime']);
    return $r;
}
