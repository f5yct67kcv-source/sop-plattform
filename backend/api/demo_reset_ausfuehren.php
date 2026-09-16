<?php
declare(strict_types=1);
// Verdrahtung fuer den naechtlichen Demo-Reset (ENT-523 Punkt 3, Stufe 4).
// Der Rechenkern steht in backend/demo_reset.php -- getrennt, damit er
// sich echt gegen eine Datenbank pruefen laesst, ohne require_demo_umgebung()
// im Weg zu haben (gleiches Prinzip wie demo_daten.php/api/demo_daten_erzeugen.php).
// Diese Datei tut nur noch: die Wache pruefen, den Zeitgeber-Schluessel
// pruefen, aufrufen.
//
// ENDPUNKT UND HILFSDATEI TRAGEN BEWUSST VERSCHIEDENE NAMEN
// (demo_reset_ausfuehren.php hier, demo_reset.php im Rechenkern): htaccess-
// hostpoint sperrt jede Hilfsdatei unter ihrem Dateinamen vor direktem
// Webzugriff, unabhaengig vom Verzeichnis (<FilesMatch> kennt keinen Pfad).
// Truege der Endpunkt denselben Namen, spraeche ihn dieselbe Regel mit --
// am 2026-09-09 geschah genau das mit api/lohnlauf.php, siehe test_php.mjs.
//
// AUSGELOEST UEBER EINEN GITHUB-ACTIONS-ZEITGEBER
// (.github/workflows/demo-reset.yml), NICHT ueber einen Hostpoint-Cronjob
// wie beim Vorbild push_versand.php: Demo ist eine einzelne, umgebungs-
// gebundene Instanz. Ein zweiter, nur fuer diese eine Umgebung
// eingerichteter Hostpoint-Cronjob waere reine Handarbeit; ein Workflow im
// selben Repository ist es nicht und wird an derselben Stelle gepflegt wie
// der Deploy selbst.
//
// EIN GEHEIMNIS STATT EINER SITZUNG -- gleiches Grundmuster wie
// push_zeitgeber_lage() in push.php: Ein Zeitgeber hat keine Anmeldung und
// darf auch keine brauchen. Waere der Zugang an ein Konto gebunden, koennte
// ein Interessent, der genau dieses Konto geloescht oder dessen Passwort
// geaendert hat, den naechsten Reset verhindern -- ausgerechnet der Fall,
// den der Reset beheben soll.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';     // system_rollen()
require_once __DIR__ . '/../demo_daten.php'; // demo_daten_erzeugen_ausfuehren()
require_once __DIR__ . '/../demo_reset.php'; // demo_reset_*()

// Wache VOR jeder anderen Pruefung (siehe require_demo_umgebung() in
// db.php): In Produktion und Staging existiert dieser Endpunkt aus Sicht
// eines Aufrufers nicht (404).
require_demo_umgebung();

// Beim Deploy ersetzt (sed -i, wie __PUSH_CRON_SCHLUESSEL__ in
// push_versand.php). Ungesetzt heisst: dieser Weg ist zu.
const DEMO_RESET_SCHLUESSEL = '__DEMO_RESET_TOKEN__';

$mitgegeben = (string)($_GET['schluessel'] ?? '');
$lage = demo_reset_zeitgeber_lage(DEMO_RESET_SCHLUESSEL, $mitgegeben);
if ($lage !== 'ok') {
    json_response(['status' => 'error', 'zeitgeber' => $lage,
        'message' => 'Der Zeitgeber-Zugang ist auf dem Server nicht eingerichtet -- '
            . 'das Secret DEMO_RESET_TOKEN fehlt, seit dem Setzen ist kein Deploy gelaufen, '
            . 'oder der Schluessel in der Adresse stimmt nicht.'], 401);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = db();

// 1. Alles leeren. 2. Systemrollen saeen. 3. Musterbetrieb neu erzeugen --
// kunden/objekte sind nach Schritt 1 garantiert leer, die eigene
// Vorbedingungspruefung in demo_daten_erzeugen_ausfuehren() kann also nie
// auf diesem Weg auslaufen. Ruft json_response() selbst auf und beendet
// damit diesen Aufruf.
demo_reset_alle_tabellen_leeren($pdo);
demo_reset_systemrollen_saeen($pdo);
demo_daten_erzeugen_ausfuehren($pdo);
