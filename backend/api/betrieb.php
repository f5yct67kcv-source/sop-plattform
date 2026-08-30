<?php
// Briefkopf des eigenen Betriebs fuer den Rapport-Ausdruck (ENT-155).
//
// GET  -> { status, betrieb: {firma, zusatz, fusszeile, fusszeile2, logo_mime,
//           logo_groesse, logo(dataURL|null), domizil_strasse, domizil_plz, domizil_ort} }
// POST -> speichern {firma, zusatz, fusszeile, fusszeile2, qr_*}
//         Logo setzen     {logo: base64, logo_mime, logo_dateiname?}
//         Logo weg        {logo_weg: true}
//         Hauptdomizil    {domizil_strasse, domizil_plz, domizil_ort} -- ENT-236,
//         eigener Zweig wie beim Logo: Ein Speichern aus der neuen
//         "Betrieb"-Kachel darf Firma/Zusatz/Fusszeile/QR-Felder NICHT
//         stillschweigend leeren, weil das Formular dort sie gar nicht kennt.
//
// Warum das Logo in der Datenbank und nicht im Dateisystem liegt: dieselbe
// Entscheidung wie bei den Einsatz-Dokumenten (ENT-117). Ein Verzeichnis mit
// hochgeladenen Dateien braucht eine .htaccess, die greifen muss; die
// Datenbank braucht das nicht. Ein Firmenlogo ist zwar nicht vertraulich --
// aber zwei verschiedene Wege fuer hochgeladene Dateien waeren zwei Wege, die
// beide richtig sein muessen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../qrrechnung.php';

$user = require_session();

// Lesen darf jeder angemeldete Zugang: Der Briefkopf erscheint auf jedem
// Rapport-Ausdruck, und wer einen Rapport drucken darf, braucht ihn. Aendern
// ist eine Betriebseinstellung -- dafuer weiter unten das Recht "betrieb"
// (dasselbe Muster wie in anstellungsorte.php, ENT-077).

// 512 KB, nicht mehr: Das Logo steht im Briefkopf und wird dort hoechstens
// ein paar hundert Pixel breit gezeigt. Alles darueber ist Ballast, der bei
// jedem Ausdruck durch die Leitung geht -- und base64 waechst beim Transport
// ohnehin um rund ein Drittel.
const LOGO_MAX = 512 * 1024;
const LOGO_MIME_ERLAUBT = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

function betrieb_lesen(bool $mitLogo): array {
    $r = db()->query(
        'SELECT firma, zusatz, fusszeile, fusszeile2, qr_iban, qr_strasse, qr_hausnummer,
                qr_plz, qr_ort, logo_mime, logo_groesse, logo,
                domizil_strasse, domizil_plz, domizil_ort
         FROM betrieb WHERE id = 1'
    )->fetch();
    if (!$r) {
        return ['firma' => '', 'zusatz' => '', 'fusszeile' => null, 'fusszeile2' => null,
                'qr_iban' => null, 'qr_strasse' => null, 'qr_hausnummer' => null,
                'qr_plz' => null, 'qr_ort' => null, 'qr_iban_gueltig' => false,
                'logo_mime' => null, 'logo_groesse' => null, 'logo' => null,
                'domizil_strasse' => null, 'domizil_plz' => null, 'domizil_ort' => null];
    }
    $roh = $r['logo'];
    return [
        'firma'        => (string)$r['firma'],
        'zusatz'       => (string)$r['zusatz'],
        'fusszeile'    => $r['fusszeile'],
        'fusszeile2'   => $r['fusszeile2'],
        'qr_iban'      => $r['qr_iban'],
        'qr_strasse'   => $r['qr_strasse'],
        'qr_hausnummer' => $r['qr_hausnummer'],
        'qr_plz'       => $r['qr_plz'],
        'qr_ort'       => $r['qr_ort'],
        // Massgeblich ist diese, serverseitig gerechnete Pruefung -- nicht
        // eine zweite in dashboard.html, die aus dem Takt geraten koennte.
        // Das QR-Zahlteil auf der Kundenseite (beleg_oeffentlich.php) prueft
        // eigenstaendig noch einmal nach, verlaesst sich hier nicht drauf.
        'qr_iban_gueltig' => $r['qr_iban'] ? iban_ist_qr((string)$r['qr_iban']) : false,
        'logo_mime'    => $r['logo_mime'],
        'logo_groesse' => $r['logo_groesse'] === null ? null : (int)$r['logo_groesse'],
        // Als Daten-URL, damit der Ausdruck es ohne zweiten Abruf einbauen
        // kann. Ein <img src="…"> auf einen eigenen Endpunkt waere beim
        // Drucken ein Rennen: window.print() wartet nicht zuverlaessig auf
        // ein noch ladendes Bild, und dann fehlt das Logo genau auf dem Blatt.
        'logo' => ($mitLogo && $roh !== null && $r['logo_mime'])
            ? 'data:' . $r['logo_mime'] . ';base64,' . base64_encode($roh)
            : null,
        'domizil_strasse' => $r['domizil_strasse'],
        'domizil_plz'     => $r['domizil_plz'],
        'domizil_ort'     => $r['domizil_ort'],
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    json_response(['status' => 'ok', 'betrieb' => betrieb_lesen(true)]);
}

require_recht($user, 'betrieb');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$pdo = db();
// Die Zeile kann fehlen, wenn die Einrichtung nach dem Anlegen der Tabelle
// nicht durchlief. Ohne sie liefe jedes UPDATE ins Leere und meldete
// trotzdem Erfolg -- der stillste aller Fehler.
$pdo->exec("INSERT IGNORE INTO betrieb (id, firma, zusatz) VALUES (1, '', '')");

if (!empty($in['logo_weg'])) {
    $pdo->prepare('UPDATE betrieb SET logo = NULL, logo_mime = NULL, logo_groesse = NULL,
                   geaendert_am = NOW(), geaendert_von = ? WHERE id = 1')
        ->execute([(int)$user['id']]);
    json_response(['status' => 'ok', 'betrieb' => betrieb_lesen(true)]);
}

if (isset($in['logo'])) {
    $mime = (string)($in['logo_mime'] ?? '');
    if (!in_array($mime, LOGO_MIME_ERLAUBT, true)) {
        json_response(['status' => 'error',
            'message' => 'Nur PNG, JPEG, SVG oder WebP.'], 400);
    }
    $roh = base64_decode((string)$in['logo'], true);
    if ($roh === false || $roh === '') {
        json_response(['status' => 'error', 'message' => 'Das Bild liess sich nicht lesen.'], 400);
    }
    if (strlen($roh) > LOGO_MAX) {
        json_response(['status' => 'error',
            'message' => 'Das Logo ist zu gross — höchstens 512 KB.'], 400);
    }
    $st = $pdo->prepare('UPDATE betrieb SET logo = ?, logo_mime = ?, logo_groesse = ?,
                         geaendert_am = NOW(), geaendert_von = ? WHERE id = 1');
    $st->bindValue(1, $roh, PDO::PARAM_LOB);
    $st->bindValue(2, $mime);
    $st->bindValue(3, strlen($roh), PDO::PARAM_INT);
    $st->bindValue(4, (int)$user['id'], PDO::PARAM_INT);
    $st->execute();
    json_response(['status' => 'ok', 'betrieb' => betrieb_lesen(true)]);
}

// Hauptdomizil (ENT-236): eigener, frueh zurueckkehrender Zweig wie beim
// Logo -- ausgeloest durch array_key_exists statt isset, weil ein geleertes
// Feld absichtlich als leerer String ankommt und trotzdem gespeichert werden
// muss. Ein einziger kombinierter Speicher-Aufruf mit den Textfeldern unten
// waere hier FALSCH: Die neue "Betrieb"-Kachel kennt Firma/Zusatz/Fusszeile/
// QR-Felder gar nicht, und deren Formular kennt Hauptdomizil nicht -- ein
// gemeinsamer Zweig wuerde beim Speichern des jeweils anderen Formulars die
// hier nicht mitgeschickten Felder mit einem leeren String ueberschreiben.
if (array_key_exists('domizil_strasse', $in)) {
    $dStrasse = trim((string)($in['domizil_strasse'] ?? ''));
    $dPlz     = trim((string)($in['domizil_plz'] ?? ''));
    $dOrt     = trim((string)($in['domizil_ort'] ?? ''));
    if (mb_strlen($dStrasse) > 200 || mb_strlen($dOrt) > 200) {
        json_response(['status' => 'error',
            'message' => 'Strasse/Ort des Hauptdomizils sind zu lang.'], 400);
    }
    if (mb_strlen($dPlz) > 10) {
        json_response(['status' => 'error', 'message' => 'Die PLZ ist zu lang.'], 400);
    }
    $pdo->prepare('UPDATE betrieb SET domizil_strasse = ?, domizil_plz = ?, domizil_ort = ?,
                   geaendert_am = NOW(), geaendert_von = ? WHERE id = 1')
        ->execute([$dStrasse === '' ? null : $dStrasse, $dPlz === '' ? null : $dPlz,
                   $dOrt === '' ? null : $dOrt, (int)$user['id']]);
    json_response(['status' => 'ok', 'betrieb' => betrieb_lesen(true)]);
}

// Textfelder. Getrimmt, damit ein versehentliches Leerzeichen nicht als
// gepflegter Briefkopf durchgeht.
$firma  = trim((string)($in['firma'] ?? ''));
$zusatz = trim((string)($in['zusatz'] ?? ''));
$fuss   = trim((string)($in['fusszeile'] ?? ''));
// Zweiter Fusszeilen-Block fuer einen Zweitsitz (ENT-169) -- optional, leer
// erlaubt, derselbe Umgang wie der erste Block.
$fuss2  = trim((string)($in['fusszeile2'] ?? ''));
if (mb_strlen($firma) > 200 || mb_strlen($zusatz) > 200) {
    json_response(['status' => 'error',
        'message' => 'Firma und Zusatz dürfen höchstens 200 Zeichen haben.'], 400);
}

// QR-Rechnung (ENT-205): alles optional, leer erlaubt -- aber eine
// EINGETRAGENE IBAN wird geprueft, nicht ungesehen gespeichert. Eine QR-
// Rechnung mit ungueltiger IBAN wuerde in einer Banking-App gar nicht oder
// falsch lesen; das faellt hier auf, statt erst beim Kunden.
$qrIban = trim((string)($in['qr_iban'] ?? ''));
$qrStrasse = trim((string)($in['qr_strasse'] ?? ''));
$qrHausnummer = trim((string)($in['qr_hausnummer'] ?? ''));
$qrPlz = trim((string)($in['qr_plz'] ?? ''));
$qrOrt = trim((string)($in['qr_ort'] ?? ''));
if ($qrIban !== '') {
    $qrIban = iban_normalisieren($qrIban);
    if (!iban_ch_li_gueltig($qrIban)) {
        json_response(['status' => 'error',
            'message' => 'Diese IBAN ist ungültig (Schweizer/liechtensteinische IBAN mit korrekter Prüfziffer erwartet).'], 400);
    }
    if (!iban_ist_qr($qrIban)) {
        json_response(['status' => 'error',
            'message' => 'Das ist eine gültige IBAN, aber keine QR-IBAN (die Bank weist QR-IBANs eigens zu). Ohne QR-IBAN kann keine QR-Rechnung erzeugt werden.'], 400);
    }
}
if (mb_strlen($qrStrasse) > 200 || mb_strlen($qrOrt) > 100) {
    json_response(['status' => 'error',
        'message' => 'Strasse/Ort für die QR-Rechnung sind zu lang.'], 400);
}

$pdo->prepare('UPDATE betrieb SET firma = ?, zusatz = ?, fusszeile = ?, fusszeile2 = ?,
               qr_iban = ?, qr_strasse = ?, qr_hausnummer = ?, qr_plz = ?, qr_ort = ?,
               geaendert_am = NOW(), geaendert_von = ? WHERE id = 1')
    ->execute([$firma, $zusatz, $fuss === '' ? null : $fuss, $fuss2 === '' ? null : $fuss2,
               $qrIban === '' ? null : $qrIban, $qrStrasse === '' ? null : $qrStrasse,
               $qrHausnummer === '' ? null : $qrHausnummer, $qrPlz === '' ? null : $qrPlz,
               $qrOrt === '' ? null : $qrOrt, (int)$user['id']]);

json_response(['status' => 'ok', 'betrieb' => betrieb_lesen(true)]);
