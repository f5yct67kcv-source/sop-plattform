<?php
declare(strict_types=1);
// Eigene Einstellungen am Konto lesen und schreiben (Einstellungsseite, ENT-722).
//
// GET   -- {einstellungen: {...}|null}. null heisst: Fuer dieses Konto ist
//          noch nichts gespeichert. Die Oberflaeche uebernimmt dann einmal,
//          was ihr Browser bisher wusste (Entscheid des Projektinhabers:
//          "einmal uebernehmen", niemand soll ploetzlich eine andere
//          Oberflaeche vorfinden).
// POST  {einstellungen: {...}} -- fuehrt die genannten Schluessel mit dem
//          Gespeicherten zusammen. Nur was in EINSTELLUNGEN_ERLAUBT steht.
//
// SITZUNG STATT RECHT, wie neuerungen_stand.php und mein_passwort.php: Wie
// jemand seine Oberflaeche sehen will, betrifft niemand sonst. Geschrieben
// wird ausschliesslich am eigenen Konto -- die Zeile "WHERE id = ?" mit der
// ID aus der Sitzung ist die ganze Zugriffsregel; eine ID aus der Anfrage
// wird nie gelesen. Darum steht der Endpunkt in NUR_EIGENE_DATEN
// (test_php.mjs).
//
// Die Einstellungen FUER DEN BETRIEB (E-Mail-Designer, System) gehen NICHT
// hier durch. Sie gelten fuer alle Konten eines Betriebs und bekommen einen
// eigenen Endpunkt mit dem Recht "betrieb", sobald sie gebaut werden.
require __DIR__ . '/../db.php';

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

// Schluessel => erlaubte Werte. 'dichte' gehoert zum Versuch "kompakte
// Darstellung" (Branch test, 2026-10-14) -- er steht hier schon, damit
// derselbe Endpunkt den Versuch traegt, sobald er dazukommt. Ein Wert, den
// keine Oberflaeche setzt, schadet nicht; ein fehlender wuerde still
// verworfen.
const EINSTELLUNGEN_ERLAUBT = [
    'thema'  => ['hell', 'dunkel'],
    'glas'   => ['an', 'aus'],
    'dichte' => ['normal', 'kompakt'],
    // Die App der Mitarbeitenden hat seit ENT-398 bewusst eine EIGENE
    // Hell/Dunkel-Wahl (dort dunkel als Vorgabe, weil sie nachts im Revier
    // laeuft). Zwei Entscheidungen, zwei Schluessel -- auch am Konto.
    'app_thema' => ['hell', 'dunkel'],
    // Farbthema des Cockpits (ENT-726). Gilt nur am Desktop; hell/dunkel
    // bleibt der eigene Schluessel "thema".
    'farbe' => ['graphit', 'marine', 'hell'],
    // Benachrichtigungen: welche Arten die eigene Glocke zeigt. Dieselben
    // Arten wie GLOCKE_SCHALTBAR in backend/ereignisse.php -- Vorfall und
    // Supportantwort fehlen absichtlich, sie lassen sich nicht ausschalten.
    // pruef_meine_einstellungen.php haelt beide Listen gleich.
    'glocke_rapport'          => ['an', 'aus'],
    'glocke_sperrtag'         => ['an', 'aus'],
    'glocke_zusage'           => ['an', 'aus'],
    'glocke_offerte'          => ['an', 'aus'],
    'glocke_rundgang_spontan' => ['an', 'aus'],
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

$user = require_session();
$ich  = (int)$user['id'];
$pdo  = db();
$methode = $_SERVER['REQUEST_METHOD'];

// Die Spalte bringt erst die Einrichtung. Fehlt sie, ist unbekannt, was
// gespeichert waere -- das ist etwas anderes als "nichts gespeichert" und
// bekommt darum eine eigene Antwort. Die Oberflaeche bleibt dann beim
// Browser-Wert und versucht nicht, ihn hochzuladen.
if (!hat_spalte($pdo, 'mitarbeiter', 'einstellungen')) {
    if ($methode === 'POST') {
        json_response(['status' => 'error', 'stand_unbekannt' => true,
            'message' => 'Die Einrichtung ist noch nicht auf dem neusten Stand.'], 409);
    }
    json_response(['status' => 'ok', 'einstellungen' => null, 'stand_unbekannt' => true]);
}

$lesen = function () use ($pdo, $ich): ?array {
    $s = $pdo->prepare('SELECT einstellungen FROM mitarbeiter WHERE id = ?');
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
$pdo->prepare('UPDATE mitarbeiter SET einstellungen = ? WHERE id = ?')
    ->execute([json_encode($zusammen, JSON_UNESCAPED_UNICODE), $ich]);

json_response(['status' => 'ok', 'einstellungen' => $zusammen]);
