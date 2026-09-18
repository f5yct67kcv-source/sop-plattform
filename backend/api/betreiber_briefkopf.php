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
require_once __DIR__ . '/../qrrechnung.php';

$ich = require_betreiber_voll();

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'be_briefkopf')) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'briefkopf' => null]);
}

const BE_BRIEFKOPF_FELDER = ['firma', 'absender', 'uid', 'mwst_nr', 'iban',
                             'email', 'telefon', 'webseite',
                             // Zahlteil (ENT-616)
                             'qr_iban', 'qr_strasse', 'qr_hausnummer', 'qr_plz', 'qr_ort'];

// Welche davon gibt es in DIESER Anlage? Die fuenf Zahlungsfelder kommen
// ueber be_spalten_anlegen() nach; zwischen Deploy und Einrichtungslauf
// liegt ein Moment, in dem die Tabelle noch die alte ist. Ein Endpunkt, der
// dann mit einem SQL-Fehler abbricht, macht aus einer fehlenden Spalte einen
// unbenutzbaren Briefkopf.
function be_briefkopf_felder(PDO $pdo): array
{
    return array_values(array_filter(BE_BRIEFKOPF_FELDER,
        fn($f) => hat_spalte($pdo, 'be_briefkopf', $f)));
}

function be_briefkopf_lesen(PDO $pdo): array
{
    $felder = be_briefkopf_felder($pdo);
    $s = $pdo->query('SELECT * FROM be_briefkopf WHERE id = 1');
    $r = $s->fetch();
    if (!$r) {
        $leer = array_fill_keys(BE_BRIEFKOPF_FELDER, '');
        return $leer + ['logo' => null] + be_briefkopf_zahlteil([]);
    }
    $aus = [];
    foreach (BE_BRIEFKOPF_FELDER as $f) { $aus[$f] = (string)($r[$f] ?? ''); }
    $aus['logo'] = $r['logo'] !== null && $r['logo'] !== '' ? (string)$r['logo'] : null;
    $aus['felder_da'] = count($felder) === count(BE_BRIEFKOPF_FELDER);
    return $aus + be_briefkopf_zahlteil($aus);
}

// Was der Briefkopf ueber den Zahlteil aussagt -- gerechnet im Server, nicht
// im Browser: Ob eine IBAN eine QR-IBAN ist, entscheidet ihre Bankleitzahl,
// und diese Auskunft darf nicht davon abhaengen, welche Seite gerade fragt.
//
// DREI ZUSTAENDE, DREI AUSSAGEN (Hausregel): keine IBAN hinterlegt, eine
// hinterlegt aber unbrauchbar, oder brauchbar -- und dann mit welcher
// Referenzart. Ein blosses "kein Zahlteil" liesse offen, woran es liegt.
function be_briefkopf_zahlteil(array $b): array
{
    $iban = trim((string)($b['qr_iban'] ?? ''));
    if ($iban === '') {
        return ['zahlteil' => ['lage' => 'ohne_iban', 'art' => null, 'moeglich' => false]];
    }
    if (!iban_ch_li_gueltig($iban)) {
        return ['zahlteil' => ['lage' => 'iban_ungueltig', 'art' => null, 'moeglich' => false]];
    }
    $art = iban_ist_qr($iban) ? 'QRR' : 'NON';
    return ['zahlteil' => [
        'lage'     => qr_zahlteil_moeglich($b) ? 'bereit' : 'adresse_fehlt',
        'art'      => $art,
        'moeglich' => qr_zahlteil_moeglich($b),
    ]];
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_response(['status' => 'ok', 'eingerichtet' => true,
                   'briefkopf' => be_briefkopf_lesen($pdo)]);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];

$werte = [];
foreach (be_briefkopf_felder($pdo) as $f) {
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

// Eine unbrauchbare IBAN wird ABGEWIESEN, nicht still gespeichert: Sonst
// steht sie im Briefkopf, der Zahlteil bleibt trotzdem weg, und niemand
// erfaehrt warum. Leer bleiben darf sie -- dann gibt es eben keinen.
if (array_key_exists('qr_iban', $werte) && $werte['qr_iban'] !== ''
    && !iban_ch_li_gueltig($werte['qr_iban'])) {
    json_response(['status' => 'error',
        'message' => 'Diese IBAN ist keine gültige Schweizer oder Liechtensteiner IBAN. '
                   . 'Ohne sie bleibt die Rechnung ohne Einzahlungsschein.'], 400);
}

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
