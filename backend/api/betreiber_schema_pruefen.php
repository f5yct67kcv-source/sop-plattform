<?php
// Fehlende Betreiber-Tabellen und -Spalten selbst nachtragen (ENT-524),
// aufrufbar direkt aus dem Betreiber-Bereich -- ohne den Umweg über das
// Cockpit eines Mandanten.
//
// WARUM ES DAS SCHON GEBAUTE api/betreiber_einrichten.php NICHT TUT: Jener
// Endpunkt verlangt bewusst eine Mandanten-Verwaltungssitzung
// (require_session() + require_verwaltung()), weil er die EINMALIGE
// Erstanlage einer Betreiber-Ebene absichert, die es noch nicht gibt --
// ein Betreiber-Token kann zu diesem Zeitpunkt gar nicht existieren (siehe
// Kommentar dort). Sobald ein Betreiber-Konto aber schon steht -- wie hier,
// jemand ist bereits im Betreiber-Bereich angemeldet --, ist diese Sitzung
// selbst der Ausweis, und ein Umweg über ein fremdes Mandanten-Cockpit ist
// weder noetig noch naheliegend: Wer den Betreiber-Bereich schon aufrufen
// darf, darf auch dessen eigene Tabellen nachtragen.
//
// Ergaenzt nur Fehlendes, loescht nichts, leert nichts -- gefahrlos
// mehrfach aufrufbar, dasselbe Muster wie api/planung_einrichten.php und
// api/betreiber_einrichten.php.
//
// GET ist reiner Pruefmodus (kein exec), POST fuehrt aus -- dieselbe
// Konvention wie bei den beiden anderen Einrichtungsendpunkten.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
// Der Rechenkern der Mandanten-eigenen Einrichtung (ENT-612) -- dieselbe
// Funktion, die api/planung_einrichten.php gegen die eigene Verbindung
// eines Mandanten aufruft, hier gegen JEDE Mandanten-Datenbank aufgerufen,
// zu der der Betreiber die Zugangsdaten hat. "Eine Definition, nicht
// zwei": Die rund 50 Tabellen des Rapport-Tools stehen nur an einer
// Stelle, dieser Endpunkt richtet sie nur ein, er definiert sie nicht neu.
require_once __DIR__ . '/../planung_einrichten_kern.php';

require_betreiber_voll();
$pdo = betreiber_db();

$nurPruefen = in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true);

$tabellenErgebnis = be_tabellen_anlegen($pdo, $nurPruefen);
$spaltenErgebnis  = be_spalten_anlegen($pdo, $nurPruefen);

$getan  = [...$tabellenErgebnis['getan'],  ...$spaltenErgebnis['getan']];
$offen  = [...$tabellenErgebnis['offen'],  ...$spaltenErgebnis['offen']];
$fehler = [...$tabellenErgebnis['fehler'], ...$spaltenErgebnis['fehler']];

// ── Der Bestandsmandant ─────────────────────────────────────────────
// Dieselbe Ergaenzung wie in api/betreiber_einrichten.php: traegt weder
// nur eine frisch angelegte Tabelle mit dem ersten Betrieb ein, sondern
// auch die Subdomain nach, wenn die Spalte erst nachtraeglich entstanden
// ist (be_bestandsmandant_eintragen() deckt beide Faelle ab).
if (!$nurPruefen) {
    $name = be_bestandsmandant_eintragen($pdo, db());
    if ($name !== null) { $getan[] = 'Bestandsbetrieb als Mandant 1 eingetragen'; }
} elseif (hat_tabelle($pdo, 'mandant')
       && (int)$pdo->query('SELECT COUNT(*) FROM mandant')->fetchColumn() === 0) {
    $offen[] = 'Bestandsbetrieb als Mandant 1';
}

// ── Die Betriebstabellen JEDES Mandanten (ENT-612) ───────────────────
//
// ANLASS: Bis hierher richtete diesen Teil ausschliesslich der Mandant
// selbst ein, im eigenen Cockpit -- fuer die zehn Demo-Plaetze (ENT-600/
// 601/603) heisst das: eine leere, frisch angelegte Datenbank, in der
// nie jemand eingeloggt war, weil der erste Zugang ja erst die Demo-
// Anforderung selbst erzeugt. Die Mandanten-Liste zeigte "5 von 5
// Tabellen" -- eine Falschmeldung, verursacht durch einen inzwischen
// behobenen Fehler in hat_tabelle() (siehe db.php), der das Ergebnis
// EINES Mandanten faelschlich fuer JEDEN anderen in derselben Anfrage
// wiederverwendete. Die Datenbanken selbst waren nie eingerichtet, und
// niemand konnte das ohne FTP-Zugriff auf jede einzelne Adresse nachholen.
//
// Jeder Mandant fuer sich: Ein Fehlschlag bei einem darf die uebrigen
// nicht verhindern -- dieselbe Ueberlegung wie bei schritt() im Kern
// selbst. $mitBetreiberEbene = false: Die Betreiber-Ebene ist oben bereits
// EINMAL zentral eingerichtet, nicht ein zweites Mal je Mandant.
$mandanten = $pdo->query('SELECT id, name, db_host, db_name, db_user, secret_name FROM mandant ORDER BY id')
    ->fetchAll(PDO::FETCH_ASSOC);
foreach ($mandanten as $m) {
    $lage = mandant_verbindung_bereit($m);
    $bezug = 'Mandant „' . $m['name'] . '“';
    if ($lage !== 'bereit' && $lage !== 'standardverbindung') {
        // Vier Lagen, vier Texte (Hausregel) -- dieselbe Wortwahl wie in
        // betreiber.html (STAND_TEXT), damit dieselbe Lage ueberall
        // gleich heisst.
        $text = [
            'unvollstaendig' => 'Datenbank-Angaben unvollständig',
            'secret_fehlt'   => 'Zugangsdaten fehlen im Deploy',
        ][$lage] ?? $lage;
        $offen[] = $bezug . ': ' . $text;
        continue;
    }
    try {
        $mpdo = mandant_db($m);
        $ergebnis = planung_einrichten_ausfuehren($mpdo, $nurPruefen, false);
        foreach ($ergebnis['getan'] as $g)  { $getan[]  = $bezug . ': ' . $g; }
        foreach ($ergebnis['fehler'] as $f) { $fehler[] = $bezug . ': ' . $f; }
    } catch (Throwable $e) {
        // Der Treibertext kann Host und Benutzer tragen und geht nicht
        // nach aussen -- dieselbe Ueberlegung wie bei mandant_stand().
        $fehler[] = $bezug . ': Verbindung fehlgeschlagen';
    }
}

json_response([
    'status' => $fehler ? 'error' : 'ok',
    'modus'  => $nurPruefen ? 'pruefung' : 'ausgefuehrt',
    'getan'  => $getan,
    'offen'  => $offen,
    'fehler' => $fehler,
    'message' => $fehler
        ? 'Einrichtung teilweise fehlgeschlagen — siehe Liste.'
        : ($getan
            ? 'Einrichtung ergänzt.'
            : ($offen ? 'Noch offen — mit „Prüfen und einrichten" ergänzen.' : 'Alles vollständig eingerichtet.')),
]);
