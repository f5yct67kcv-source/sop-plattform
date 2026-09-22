<?php
declare(strict_types=1);
// Bestaetigt den Demo-Hinweis (erfundene Daten, keine echten Personendaten)
// fuer GENAU DIESES Mitarbeiterkonto (Projektinhaber-Auftrag, 2026-09-21).
//
// ANDERE SACHE als die Zustimmung zu den Nutzungsbedingungen bei der
// Demo-Anfrage (demo_bestaetigung.php, liegt beim Betreiber): Jene
// bestaetigt die Person, die den Demo-Zugang angefordert hat. Diese Zeile
// haelt fest, dass die Person, die sich TATSAECHLICH in dieses Konto
// einloggt, den Hinweis gesehen hat -- das muss nicht dieselbe sein, wenn
// derselbe Zugang mehrfach gezeigt oder weitergegeben wird.
//
// Nur in der Demo sinnvoll: In einer echten Instanz sind die Daten nicht
// erfunden, der Hinweis waere dort falsch.
require __DIR__ . '/../db.php';

// Fassung der Nutzungsbedingungen, die der Hinweis vorlegt. Wie
// DEMO_BEDINGUNGEN_FASSUNG in demo_bestaetigung.php: Eine spaetere
// Textaenderung aendert diesen Wert, alte Bestaetigungen bleiben dadurch
// auf die Fassung datiert, der tatsaechlich zugestimmt wurde.
//
// GEHALTEN WIRD DER WERT VON test_demo_hinweis.mjs gegen die Fassung in
// nutzungsbedingungen.html -- bis zum 2026-09-22 stand er frei und ohne
// Pruefung da. Ein Abdruck, dessen Fassungsangabe beim naechsten
// Textwechsel stehen bleibt, datiert die Zustimmung auf einen Text, den
// niemand gesehen hat; er beweist dann das Gegenteil dessen, wofuer er da
// ist. Genau davor warnt nutzungsbedingungen.html im eigenen Kopf, und
// genau dafuer gibt es die Zwillingspruefung in test_recht.mjs.
const DEMO_HINWEIS_FASSUNG = '2026-09-21';

// Die Datenschutzerklaerung ist ein ZWEITER Text mit EIGENEM Datum, und es
// gibt zwei davon: datenschutz-demo-platz.html fuer einen Demo-Platz
// (ENT-600/601) und datenschutz-demo.html fuer die eine ENT-523-Umgebung.
// Eine Fassungsangabe, die nur die Nutzungsbedingungen nennt, beweist fuer
// die Datenschutzerklaerung nichts -- und welche der beiden jemand gesehen
// hat, schon gar nicht. Beide Daten und die Kennung des Dokuments stehen
// darum mit im Abdruck.
const DEMO_HINWEIS_DS_PLATZ     = '2026-09-21';
const DEMO_HINWEIS_DS_GEMEINSAM = '2026-09-17';

// WELCHES DOKUMENT GEZEIGT WURDE, ENTSCHEIDET DER SERVER -- nicht der
// Browser und auch nicht ein mitgeschicktes Feld. Der Abdruck ist ein
// Beleg; was darin steht, darf nicht von dem abhaengen, was der Aufrufer
// behauptet. ist_demo_platz() kommt aus dem Deploy (db.php), also aus
// derselben Quelle, aus der dashboard.html seine Verzweigung speist.
function demo_hinweis_fassung(): string
{
    return ist_demo_platz()
        ? 'nb:' . DEMO_HINWEIS_FASSUNG . ',ds-platz:' . DEMO_HINWEIS_DS_PLATZ
        : 'nb:' . DEMO_HINWEIS_FASSUNG . ',ds-demo:' . DEMO_HINWEIS_DS_GEMEINSAM;
}

$user = require_session();
$ich  = (int)$user['id'];
$pdo  = db();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
if (!ist_demo()) {
    json_response(['status' => 'error', 'message' => 'Nur in der Demo-Umgebung.'], 400);
}
if (!hat_tabelle($pdo, 'demo_hinweis_bestaetigung')) {
    json_response(['status' => 'error', 'message' => 'Die Einrichtung ist noch nicht auf dem neusten Stand.'], 400);
}

$st = $pdo->prepare(
    'INSERT INTO demo_hinweis_bestaetigung (mitarbeiter_id, fassung, bestaetigt_am)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE fassung = VALUES(fassung), bestaetigt_am = VALUES(bestaetigt_am)'
);
$st->execute([$ich, demo_hinweis_fassung(), date('Y-m-d H:i:s')]);

json_response(['status' => 'ok']);
