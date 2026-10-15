<?php
declare(strict_types=1);
// Eigene Einstellungen am BETREIBER-Konto lesen und schreiben (ENT-722).
// Gegenstueck zu meine_einstellungen.php im Cockpit, gleiche Bauart, aber
// gegen die Tabelle betreiber in der Betreiber-Datenbank und mit der
// Betreiber-Anmeldung samt zweitem Faktor.
//
// GET   -- {einstellungen: {...}|null}. null heisst: Fuer dieses Konto ist
//          noch nichts gespeichert. Die Oberflaeche uebernimmt dann einmal,
//          was ihr Browser bisher wusste (Entscheid des Projektinhabers:
//          "einmal uebernehmen", niemand soll ploetzlich eine andere
//          Oberflaeche vorfinden).
// POST  {einstellungen: {...}} -- fuehrt die genannten Schluessel mit dem
//          Gespeicherten zusammen. Nur was in EINSTELLUNGEN_ERLAUBT steht.
//
// ANMELDUNG STATT RECHT, wie betreiber_neuerungen.php: Wie jemand seine
// Oberflaeche sehen will, betrifft niemand sonst. Geschrieben wird
// ausschliesslich am eigenen Konto -- "WHERE id = ?" mit der ID aus der
// Anmeldung ist die ganze Zugriffsregel; eine ID aus der Anfrage wird nie
// gelesen.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

// Die erlaubten Schluessel stehen HIER und nicht in einem eigenen Modul unter
// backend/: Ein neues Modul muesste in den Deploy und in die Sperrliste der
// .htaccess, und die ist fuer Staging von Hand bei Hostpoint nachzutragen
// (ENT-384). Fuer drei Zeilen Liste lohnt das nicht. Gibt es spaeter einen
// zweiten Leser, wandert die Liste in ein Modul.
//
// WEISSE LISTE MIT FESTEN WERTEN, kein freies JSON: Was hier nicht steht,
// wird verworfen. Eine Spalte, in die jeder Browser beliebige Schluessel
// schreiben darf, waere nach einem Jahr ein Sammelbecken, von dem niemand
// mehr weiss, was davon noch gelesen wird -- und ein beliebig grosser Wert
// pro Konto.

// Schluessel => erlaubte Werte. Im Betreiberbereich gibt es nur die beiden
// Wahlen, die dort einen Schalter haben.
const EINSTELLUNGEN_ERLAUBT = [
    'thema' => ['hell', 'dunkel'],
    'glas'  => ['an', 'aus'],
];

// Nimmt, was aus der Anfrage kommt, und gibt nur zurueck, was erlaubt ist.
// Unbekannte Schluessel und unbekannte Werte fallen weg, ohne Fehler: Ein
// aelterer oder neuerer Browser soll nicht am Speichern scheitern, nur weil
// er einen Schluessel mehr oder weniger kennt.
function einstellungen_bereinigen($roh): array
{
    if (!is_array($roh)) { return []; }
    $sauber = [];
    foreach (EINSTELLUNGEN_ERLAUBT as $schluessel => $werte) {
        if (!array_key_exists($schluessel, $roh)) { continue; }
        $wert = $roh[$schluessel];
        if (is_string($wert) && in_array($wert, $werte, true)) {
            $sauber[$schluessel] = $wert;
        }
    }
    return $sauber;
}

// Liest den gespeicherten Wert der Spalte. NULL heisst "noch nie
// gespeichert" -- das ist etwas anderes als ein leeres Objekt, und die
// Oberflaeche braucht den Unterschied: Nur bei NULL uebernimmt sie einmal,
// was der Browser bisher wusste.
function einstellungen_lesen(?string $gespeichert): ?array
{
    if ($gespeichert === null) { return null; }
    $roh = json_decode($gespeichert, true);
    return einstellungen_bereinigen(is_array($roh) ? $roh : []);
}

$user = require_betreiber_voll();
$ich  = (int)$user['id'];
$pdo  = betreiber_db();
$methode = $_SERVER['REQUEST_METHOD'];

// Die Spalte bringt erst die Einrichtung. Fehlt sie, ist unbekannt, was
// gespeichert waere -- das ist etwas anderes als "nichts gespeichert" und
// bekommt darum eine eigene Antwort. Die Oberflaeche bleibt dann beim
// Browser-Wert und versucht nicht, ihn hochzuladen.
if (!hat_spalte($pdo, 'betreiber', 'einstellungen')) {
    if ($methode === 'POST') {
        json_response(['status' => 'error', 'stand_unbekannt' => true,
            'message' => 'Die Einrichtung ist noch nicht auf dem neusten Stand.'], 409);
    }
    json_response(['status' => 'ok', 'einstellungen' => null, 'stand_unbekannt' => true]);
}

$lesen = function () use ($pdo, $ich): ?array {
    $s = $pdo->prepare('SELECT einstellungen FROM betreiber WHERE id = ?');
    $s->execute([$ich]);
    $wert = $s->fetchColumn();
    return einstellungen_lesen($wert === false || $wert === null ? null : (string)$wert);
};

if ($methode === 'GET') {
    json_response(['status' => 'ok', 'einstellungen' => $lesen()]);
}
if ($methode !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$in  = json_decode((string)file_get_contents('php://input'), true) ?? [];
$neu = einstellungen_bereinigen($in['einstellungen'] ?? null);
if (!$neu) {
    json_response(['status' => 'error', 'message' => 'Keine gültige Einstellung übergeben.'], 400);
}

// Zusammenfuehren statt ersetzen: Ein Browser, der nur das Thema kennt,
// soll nicht die Glas-Wahl loeschen, die ein anderes Geraet gespeichert hat.
$alt = $lesen() ?? [];
$zusammen = array_merge($alt, $neu);
$pdo->prepare('UPDATE betreiber SET einstellungen = ? WHERE id = ?')
    ->execute([json_encode($zusammen, JSON_UNESCAPED_UNICODE), $ich]);

json_response(['status' => 'ok', 'einstellungen' => $zusammen]);
