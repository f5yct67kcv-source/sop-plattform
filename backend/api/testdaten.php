<?php
// Testdaten der Testseite leeren und neu befuellen (ENT-714).
//
// NUR AUF STAGING. ist_staging() haengt am exakten Wert "staging" aus dem
// Deploy (fail-safe, siehe db.php) -- auf Produktion, Mandanten, Demo und
// beim Betreiber antwortet dieser Weg mit "nicht gefunden", wie es
// require_demo_umgebung() fuer die Demo tut. Die Kachel in der Oberflaeche
// erspart nur den Umweg; die Sperre sitzt hier.
//
// RECHT: rechte_schreiben. Das Leeren entfernt alle Personen ohne Cockpit-
// Zugang -- das darf nur, wer Rollen vergeben darf.
//
// IN SCHRITTEN (POST {schritt}):
//   start      Bestaetigungswort pruefen, leeren, Stammdaten anlegen.
//              Antwort: die Monate, die danach einzeln folgen.
//   monat      {monat: 'YYYY-MM'} Einsaetze, Abgleich, Auslagenersatz,
//              Rechnungen und Lohnlauf dieses Monats.
//   abschluss  Planung ueber das Monatsende, Offerten, Sonderfaelle,
//              Zusammenfassung.
// Jeder Schritt ist eine eigene Transaktion. Bricht es mittendrin ab,
// beginnt ein neuer Klick wieder bei "start", und das leert zuerst.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../demo_daten.php';

if (!ist_staging()) {
    json_response(['status' => 'error', 'message' => 'Nicht gefunden.'], 404);
}
$user = require_session();
require_recht($user, 'rechte_schreiben');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_response(['status' => 'error', 'message' => 'Nur POST.'], 405);
}

$eingabe = json_decode((string)file_get_contents('php://input'), true) ?: [];
$schritt = (string)($eingabe['schritt'] ?? '');
$pdo = db();
@set_time_limit(120);

try {
    if ($schritt === 'start') {
        if (trim((string)($eingabe['bestaetigung'] ?? '')) !== TD_BESTAETIGUNG) {
            json_response(['status' => 'error', 'message' => 'Zum Bestätigen „' . TD_BESTAETIGUNG . '“ eintippen.'], 400);
        }
        foreach (['mitarbeiter', 'einsaetze', 'belege', 'lohnlauf', 'einsatz_auslagen', 'produkte'] as $t) {
            if (!hat_tabelle($pdo, $t)) {
                json_response(['status' => 'error', 'message' => "Einrichtung fehlt noch (Tabelle $t). Zuerst die Einrichtung ausführen."], 503);
            }
        }
        // TRUNCATE schliesst in MySQL eine Transaktion implizit ab -- darum
        // das Leeren VOR der Transaktion der Stammdaten.
        $geleert = td_leeren($pdo);
        $pdo->beginTransaction();
        $stamm = td_stammdaten($pdo);
        $pdo->commit();
        json_response(['status' => 'ok', 'geleert' => $geleert, 'stamm' => $stamm, 'monate' => td_monate()]);
    }
    if ($schritt === 'monat') {
        $monat = (string)($eingabe['monat'] ?? '');
        if (!in_array($monat, td_monate(), true)) {
            json_response(['status' => 'error', 'message' => 'Unbekannter Monat.'], 400);
        }
        $pdo->beginTransaction();
        $erg = td_monat($pdo, $monat);
        $pdo->commit();
        json_response(['status' => 'ok', 'monat' => $monat, 'ergebnis' => $erg]);
    }
    if ($schritt === 'abschluss') {
        $pdo->beginTransaction();
        $erg = td_abschluss($pdo);
        $pdo->commit();
        json_response(['status' => 'ok', 'ergebnis' => $erg, 'zusammenfassung' => td_zusammenfassung($pdo)]);
    }
    json_response(['status' => 'error', 'message' => 'Unbekannter Schritt.'], 400);
} catch (TestdatenFehler $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    json_response(['status' => 'error', 'message' => $e->getMessage()], 409);
}
