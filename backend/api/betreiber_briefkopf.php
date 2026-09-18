<?php
// Der Briefkopf der Betreiberin (ENT-605).
//
// GET  -> { status, briefkopf: {firma, absender, uid, mwst_nr, iban, email,
//           telefon, webseite, logo} }
// POST -> speichern; 'logo_weg' entfernt das Bild.
//
// WARUM EINE EIGENE TABELLE UND KEIN LITERAL IM QUELLTEXT: Im Code steht
// kein Firmenname und keine Adresse (Hausregel Vertraulichkeit), und der
// Briefkopf der Betreiberin hat in der Datenbank einer Mandantin nichts
// verloren -- dort liegt `betrieb`, und das ist deren eigener Briefkopf.
//
// GENAU EINE ZEILE, id = 1. Kein "welcher Briefkopf" -- es gibt eine
// Betreiberin.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'be_briefkopf')) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'briefkopf' => null]);
}

const BE_BRIEFKOPF_FELDER = ['firma', 'absender', 'uid', 'mwst_nr', 'iban',
                             'email', 'telefon', 'webseite'];

function be_briefkopf_lesen(PDO $pdo): array
{
    $s = $pdo->query('SELECT * FROM be_briefkopf WHERE id = 1');
    $r = $s->fetch();
    if (!$r) {
        $leer = array_fill_keys(BE_BRIEFKOPF_FELDER, '');
        return $leer + ['logo' => null];
    }
    $aus = [];
    foreach (BE_BRIEFKOPF_FELDER as $f) { $aus[$f] = (string)($r[$f] ?? ''); }
    $aus['logo'] = $r['logo'] !== null && $r['logo'] !== '' ? (string)$r['logo'] : null;
    return $aus;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_response(['status' => 'ok', 'eingerichtet' => true,
                   'briefkopf' => be_briefkopf_lesen($pdo)]);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];

$werte = [];
foreach (BE_BRIEFKOPF_FELDER as $f) {
    $roh = trim((string)($in[$f] ?? ''));
    // Steuerzeichen raus -- bis auf 'absender', der ist ein Adressblock und
    // traegt Zeilenumbrueche. Dieselbe Ueberlegung wie bei der Kundenadresse
    // in kunden.php (ENT-501): Diese Felder landen im Betreff und im Kopf
    // einer Mail; ein Zeilenumbruch darin waere der Anfang einer zweiten
    // SMTP-Zeile.
    $werte[$f] = $f === 'absender'
        ? (string)preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $roh)
        : (string)preg_replace('/[\x00-\x1F\x7F]/u', '', $roh);
}
$werte['absender'] = mb_substr($werte['absender'], 0, 500);

// Das Logo kommt als data:-URL und wird STRENG geprueft, nicht nur
// entgegengenommen: Es landet spaeter im src eines Bildes auf einer Seite,
// die ohne Anmeldung erreichbar ist. Erlaubt sind vier Rasterformate --
// kein SVG, weil SVG ein Dokument ist und kein Bild, und schon gar nicht
// 'data:text/html'.
$logoSetzen = false;
$logo = null;
if (!empty($in['logo_weg'])) {
    $logoSetzen = true;
} elseif (array_key_exists('logo', $in) && trim((string)$in['logo']) !== '') {
    $kandidat = trim((string)$in['logo']);
    if (!preg_match('~^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$~', $kandidat)) {
        json_response(['status' => 'error',
            'message' => 'Als Logo wird ein PNG, JPEG, GIF oder WEBP angenommen.'], 400);
    }
    // 1 MB Rohdaten reichen fuer ein Briefkopf-Logo mit Abstand. Groesser
    // hiesse: Es wandert in jede Vorschau und in jedes erzeugte PDF.
    if (strlen($kandidat) > 1400000) {
        json_response(['status' => 'error',
            'message' => 'Das Logo ist zu gross (höchstens rund 1 MB).'], 400);
    }
    $logoSetzen = true;
    $logo = $kandidat;
}

$spalten = array_keys($werte);
$satz    = implode(', ', array_map(fn($f) => "$f = ?", $spalten));
$werteL  = array_values($werte);
if ($logoSetzen) { $satz .= ', logo = ?'; $werteL[] = $logo; }

// Die Zeile kann fehlen (frisch angelegte Tabelle). INSERT ... ON DUPLICATE
// KEY UPDATE braeuchte hier zwei Wertelisten; ein Vorab-INSERT der leeren
// Zeile ist kuerzer und tut beim zweiten Aufruf nichts.
$pdo->prepare('INSERT IGNORE INTO be_briefkopf (id, firma) VALUES (1, ?)')->execute(['']);

// Stand vor der Aenderung, fuer das Logbuch (ENT-614). Das Logo bleibt
// aussen vor: Ein Bild gehoert nicht in eine Verlaufszeile -- dass es
// gewechselt wurde, steht als eigener Eintrag ohne Werte darunter.
$vor = $pdo->prepare('SELECT ' . implode(', ', $spalten) . ' FROM be_briefkopf WHERE id = 1');
$vor->execute();
$vorher = $vor->fetch(PDO::FETCH_ASSOC) ?: [];

$pdo->prepare("UPDATE be_briefkopf SET $satz WHERE id = 1")->execute($werteL);

be_log_vergleich($pdo, $ich, 'briefkopf', 1, $vorher, $werte);
if ($logoSetzen) {
    be_log($pdo, $ich, 'briefkopf', 1, 'logo', null, null, true);
}

json_response(['status' => 'ok', 'briefkopf' => be_briefkopf_lesen($pdo)]);
