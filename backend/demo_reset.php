<?php
declare(strict_types=1);
// Rechenkern des naechtlichen Demo-Resets (ENT-523 Punkt 3, Stufe 4).
// Getrennt vom Endpunkt backend/api/demo_reset.php, damit sich Zeitgeber-
// Pruefung und Ausfuehrung echt gegen eine Datenbank pruefen lassen, ohne
// require_demo_umgebung() im Weg zu haben -- gleiches Prinzip wie
// backend/demo_daten.php/api/demo_daten_erzeugen.php.
//
// BINDET RECHTE.PHP SELBST EIN, statt es vom Aufrufer zu erwarten. Bis
// 2026-09-18 stand hier "Erwartet, dass rechte.php (system_rollen())
// bereits geladen ist" -- ein stiller Vertrag, den jeder neue Aufrufer
// erben musste, ohne dass ihn etwas daran erinnert haette. Genau daran ist
// der oeffentliche Demo-Zugang gescheitert: demo_anfordern.php laedt
// rechte.php in seiner Kette nicht, also brach demo_reset_systemrollen_-
// saeen() mit "Call to undefined function system_rollen()" ab. Das ist
// kein Datenbankfehler, also blieb davon beim Anfragenden nur das
// nichtssagende "Unerwarteter Serverfehler" uebrig (db.php). Eine Datei,
// die eine fremde Funktion braucht, laedt sie ab jetzt selbst.
require_once __DIR__ . '/rechte.php';

// ── Zeitgeber-Geheimnis ─────────────────────────────────────────────
// Zeitsicherer Vergleich (hash_equals) des beim Deploy per sed-Ersetzung
// gesetzten Platzhalters, wie "__PUSH_CRON" + "_SCHLUESSEL__" in
// push_versand.php. Eigene, kleine Kopie statt eines Aufrufs von
// push_zeitgeber_lage() (push.php) -- jene ist fest an das Praefix
// "__PUSH_CRON" gebunden, und push.php ist ein produktiv genutztes Modul,
// das fuer eine reine Demo-Angelegenheit nicht angefasst werden muss.
//
// KEIN FREMDER PLATZHALTERNAME IN DIESER DATEI, auch nicht in einem
// Kommentar: Seit ENT-589 geht sie auch nach dist-cupi24/ mit, und der Bau
// des dortigen Buendels weist jeden Platzhalter ab, der dort nicht ersetzt
// wird -- derselbe Fehler wie bei mailer.php/Lauf 474 hat das hier in
// Lauf 521 ausgeloest (siehe push.php fuer die Parallel-Ursache).
function demo_reset_zeitgeber_lage(string $erwartet, string $mitgegeben): string
{
    if ($erwartet === '' || str_starts_with($erwartet, '__DEMO_RESET')) {
        return 'nicht_eingerichtet';
    }
    if ($mitgegeben === '') { return 'kein_schluessel_in_der_adresse'; }
    return hash_equals($erwartet, $mitgegeben) ? 'ok' : 'falscher_schluessel';
}

// ── Alles leeren ─────────────────────────────────────────────────────
// Generisch ueber JEDE Tabelle der verbundenen Datenbank, nicht ueber eine
// von Hand gepflegte Liste: Eine neue Tabelle, die irgendein spaeteres
// Feature anlegt, wuerde auf einer solchen Liste vergessen und sammelte
// unbemerkt Spuren frueherer Interessenten an -- das genaue Gegenteil
// dessen, was dieser Lauf leisten soll. DATABASE() grenzt das zuverlaessig
// auf die verbundene (Demo-)Datenbank ein, nie auf andere Datenbanken
// desselben Hostpoint-Kontos.
//
// NICHT gegen SQLite pruefbar (information_schema gibt es dort nicht) --
// bewusst kurz und ohne eigene Verzweigung gehalten, damit sich die Aussage
// beim Lesen allein tragen laesst. Die Aussage selbst (nichts bleibt
// stehen) wird stattdessen am echten Lauf gegen die Demo-Datenbank
// bestaetigt, wie schon bei demo_daten_erzeugen_ausfuehren() selbst.
//
// TRUNCATE statt DELETE: schneller bei grossen Tabellen und setzt
// AUTO_INCREMENT zurueck. TRUNCATE loest in MySQL einen impliziten COMMIT
// aus und laesst sich darum nicht in eine Transaktion einschliessen; das
// ist hier unproblematisch, weil jeder einzelne TRUNCATE-Befehl fuer sich
// atomar ist und ein Abbruch mittendrin (leere Tabellen bleiben leer)
// durch einen erneuten Lauf folgenlos heilt.
function demo_reset_alle_tabellen_leeren(PDO $pdo): void
{
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
    $tabellen = $pdo->query(
        "SELECT TABLE_NAME FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
    )->fetchAll(PDO::FETCH_COLUMN);
    foreach ($tabellen as $tabelle) {
        $pdo->exec('TRUNCATE TABLE `' . str_replace('`', '', (string)$tabelle) . '`');
    }
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
}

// ── Systemrollen saeen ───────────────────────────────────────────────
// Dieselbe Aussage wie der Systemrollen-Block in api/planung_einrichten.php
// (ENT-440): system_rollen() aus rechte.php bleibt die einzige Quelle, die
// Datenbank-Fassung folgt dem Code, nie umgekehrt. Eigene, einfache
// Fassung statt eines Aufrufs von dort -- jener Block kann sowohl pruefen
// als auch nachfuehren (Knopf "Pruefen und einrichten") und ist mit
// lokalen Variablen einer ueber 3000 Zeilen langen Datei verwoben. Hier
// gibt es nur den einen Fall, den demo_reset_alle_tabellen_leeren() vorher
// garantiert: frisch geleerte Tabellen, jetzt fuellen -- kein Nachfuehren
// bestehender Zeilen noetig.
function demo_reset_systemrollen_saeen(PDO $pdo): void
{
    foreach (system_rollen() as $schluessel => $rolle) {
        $pdo->prepare('INSERT INTO rollen (schluessel, titel, text, system) VALUES (?, ?, ?, 1)')
            ->execute([$schluessel, $rolle['titel'], $rolle['text']]);
        $rolleId = (int)$pdo->lastInsertId();
        $einRecht = $pdo->prepare('INSERT INTO rollen_rechte (rolle_id, bereich, stufe) VALUES (?, ?, ?)');
        foreach ($rolle['stufen'] as $bereich => $stufe) { $einRecht->execute([$rolleId, $bereich, $stufe]); }
    }
}
