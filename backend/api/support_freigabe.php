<?php
// Support-Freigabe erteilen, ansehen oder widerrufen (ENT-526).
// Dies ist die Seite des BETRIEBS -- sie läuft im Cockpit, nicht beim
// Plattform-Betreiber.
//
// WARUM AM RECHT "Rollen & Berechtigungen" UND NICHT AN
// "Betriebseinstellungen": Eine Support-Freigabe pflegt keine Liste, sie
// bestimmt, dass ein Betriebsfremder Einblick bekommt. Das ist genau das,
// was der Bereich `rechte` beschreibt -- „bestimmen, wer an welche Daten
// kommt". Wer Briefkopf und Anstellungsorte pflegen darf, muss darum nicht
// Aussenstehenden die Tür öffnen dürfen; dieselbe Trennung wie bei den
// Kundenzugängen (ENT-441).
//
// GET  -> Lage, offene Freigabe, Fristen
// POST -> { stunden?, zweck } freigeben  |  { widerrufen: true }
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../support.php';

$user = require_session();
require_recht_nach_methode($user, 'rechte');

$pdo = db();

if (!support_tabellen_da($pdo)) {
    // Nicht eingerichtet ist etwas anderes als "keine Freigabe" und bekommt
    // eine eigene Aussage.
    json_response([
        'status'  => 'ok',
        'lage'    => 'nicht_eingerichtet',
        'message' => 'Die Support-Freigabe ist auf dieser Anlage noch nicht eingerichtet. '
                   . 'Einmal die Einrichtung ausführen.',
        'freigabe' => null,
    ]);
}

if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    $offen = support_freigabe_gueltig($pdo);
    json_response([
        'status'   => 'ok',
        'lage'     => support_lage($pdo),
        'freigabe' => $offen,
        'vorgabe_stunden' => SUPPORT_STUNDEN_VORGABE,
        'max_stunden'     => SUPPORT_STUNDEN_MAX,
        // Damit die Oberfläche sagen kann, was eine Freigabe bedeutet --
        // und was sie NICHT bedeutet. Der Text steht hier und nicht im
        // Browser, damit es einen Wortlaut gibt.
        'umfang' => 'Der Betreiber sieht während der Freigabe ausschliesslich Diagnosedaten: '
                  . 'wie viele Datensätze je Tabelle vorhanden sind, welche Tabellen fehlen '
                  . 'und wie die Rechteprofile aufgebaut sind. Keine Namen, keine Löhne, '
                  . 'keine Rapportinhalte, keine vertraulichen Personalangaben. '
                  . 'Jeder Zugriff wird protokolliert und ist hier einsehbar.',
    ]);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];

if (($daten['widerrufen'] ?? false) === true) {
    $wieviele = support_widerrufen($pdo);
    json_response(['status' => 'ok', 'widerrufen' => $wieviele, 'lage' => support_lage($pdo)]);
}

// Der Zweck ist Pflicht. Eine Freigabe ohne Grund lässt sich später nicht
// mehr einordnen -- weder vom Betrieb noch von jemandem, der die Historie
// prüft.
$zweck = trim((string)($daten['zweck'] ?? ''));
if ($zweck === '') {
    json_response(['status' => 'error',
        'message' => 'Bitte kurz angeben, wofür die Freigabe gilt.'], 400);
}

// Wer freigibt, kommt aus der SITZUNG -- nie aus der Anfrage. Ein Endpunkt,
// der den Freigebenden entgegennähme, wäre derselbe Fehler wie ein
// Portal-Endpunkt, der seine kunde_id aus der Anfrage liest.
$wer = trim((string)$user['name']);

$id = support_freigeben($pdo, (int)($daten['stunden'] ?? SUPPORT_STUNDEN_VORGABE), $wer, $zweck);
$offen = support_freigabe_gueltig($pdo);

json_response([
    'status'   => 'ok',
    'id'       => $id,
    'lage'     => support_lage($pdo),
    'freigabe' => $offen,
]);
