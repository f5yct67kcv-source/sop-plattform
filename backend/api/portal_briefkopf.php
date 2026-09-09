<?php
// Kundenportal: der Briefkopf fuer das Rapport-PDF (ENT-478).
//
// GET -> { status, briefkopf: { firma, zusatz, fusszeile, fusszeile2, logo } }
//
// Ein eigener, kleiner Endpunkt und NICHT Teil von
// portal_rundgang_detail.php: Das Logo ist ein Bild und wiegt mehr als die
// ganze uebrige Antwort. Es je aufgeklappter Runde mitzuschicken hiesse, es
// bei zehn Runden zehnmal zu uebertragen -- fuer eine Angabe, die sich nicht
// je Runde unterscheidet. Die Oberflaeche holt ihn EINMAL, und zwar erst
// beim ersten PDF; wer nur liest, laedt ihn nie.
//
// Der Zuschnitt ist bewusst schmal: firma, zusatz und die beiden
// Fusszeilen -- genau das, was auf einem Blatt an den Kunden steht. Die
// QR-Rechnungsfelder der Tabelle `betrieb` (IBAN, Zahladresse) bleiben
// draussen; sie gehoeren auf eine Rechnung, nicht auf einen Nachweis, und
// ein Endpunkt fuer Betriebsfremde liefert nichts, was er nicht braucht.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';

require_kundensession();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$betrieb = db()->query(
    'SELECT firma, zusatz, fusszeile, fusszeile2, logo, logo_mime FROM betrieb WHERE id = 1'
)->fetch(PDO::FETCH_ASSOC);

// Kein Briefkopf hinterlegt ist kein Fehler -- das Blatt traegt dann eben
// keinen. Leere Felder statt einer Fehlermeldung, damit das PDF trotzdem
// entsteht.
if (!$betrieb) { $betrieb = []; }

// Das Logo als Daten-Adresse, wie in beleg_oeffentlich.php (ENT-205): Ein
// zweiter Aufruf fuer das Bild braeuchte einen zweiten Endpunkt mit
// eigener Rechtepruefung, und html2pdf muesste ihn nachladen, waehrend es
// schon zeichnet.
$logo = ($betrieb['logo'] ?? null) !== null && ($betrieb['logo_mime'] ?? null)
    ? 'data:' . $betrieb['logo_mime'] . ';base64,' . base64_encode($betrieb['logo'])
    : null;

json_response(['status' => 'ok', 'briefkopf' => [
    'firma'      => (string)($betrieb['firma'] ?? ''),
    'zusatz'     => (string)($betrieb['zusatz'] ?? ''),
    'fusszeile'  => (string)($betrieb['fusszeile'] ?? ''),
    'fusszeile2' => (string)($betrieb['fusszeile2'] ?? ''),
    'logo'       => $logo,
]]);
