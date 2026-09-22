<?php
// Das Mandanten-Schema als JSON: {"tabelle": ["spalte", ...], ...}
//
// Wozu: Damit eine Pruefung in JavaScript nachsehen kann, ob eine Abfrage im
// Backend eine Spalte nennt, die es im Schema der Mandanten-Datenbank gibt.
// Die Angaben stammen aus kern_tabellen() und kern_spalten() selbst -- nicht
// aus einer zweiten, hier nachgebauten Liste. Eine zweite Liste waere in dem
// Moment falsch, in dem jemand die erste aendert, und wuerde ausgerechnet
// dann gruen bleiben.
declare(strict_types=1);
require __DIR__ . '/../backend/planung_einrichten_kern.php';

$schema = [];

foreach (kern_tabellen() as $tabelle => $sql) {
    // Nur der Rumpf zwischen der ersten Klammer und der letzten -- danach
    // stehen ENGINE und CHARSET.
    $auf = strpos($sql, '(');
    $zu  = strrpos($sql, ')');
    if ($auf === false || $zu === false || $zu <= $auf) { continue; }
    $spalten = [];
    foreach (explode("\n", substr($sql, $auf + 1, $zu - $auf - 1)) as $zeile) {
        $zeile = trim($zeile);
        if ($zeile === '') { continue; }
        // Schluessel und Fremdschluessel sind keine Spalten.
        if (preg_match('/^(PRIMARY|UNIQUE|KEY|INDEX|FOREIGN|CONSTRAINT|FULLTEXT)\b/i', $zeile)) { continue; }
        if (preg_match('/^`?([a-z_][a-z0-9_]*)`?\s/i', $zeile, $t)) { $spalten[] = strtolower($t[1]); }
    }
    $schema[strtolower((string)$tabelle)] = $spalten;
}

// Die nachtraeglich angelegten Spalten gehoeren dazu: Eine Anlage, die den
// Einrichtungslauf hinter sich hat, hat sie -- und eine Abfrage, die sie
// nennt, ist darum nicht falsch.
foreach (kern_spalten() as [$tabelle, $spalte, ]) {
    $t = strtolower((string)$tabelle);
    $schema[$t] = $schema[$t] ?? [];
    if (!in_array(strtolower((string)$spalte), $schema[$t], true)) {
        $schema[$t][] = strtolower((string)$spalte);
    }
}

echo json_encode($schema, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
