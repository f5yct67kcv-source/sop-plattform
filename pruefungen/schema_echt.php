<?php
declare(strict_types=1);
// ── Das ECHTE Schema einer Tabelle, in einer SQLite-Datenbank angelegt ───
//
// Warum es diese Datei gibt: Mehrere Pruefungen legten ihre Tabellen von
// HAND an. Damit blieben sie gruen, wenn der Code und das wirkliche Schema
// auseinanderliefen -- eine Absprache zwischen zwei Dateien, die niemand
// einhaelt. Genau diese Fehlerfamilie hat am 2026-09-09 einen Livefehler
// verursacht (ENT-451: 14 Felder, 13 Platzhalter; keine Pruefung fuehrte den
// INSERT aus). pruef_zustellnachweis.php hat daraufhin angefangen, das echte
// CREATE TABLE zu holen -- und die Umschrift nach SQLite wurde seither
// kopiert. Kopien laufen auseinander; darum steht sie ab jetzt hier.
//
// Das echte Schema kommt aus ZWEI Quellen, und beide sind noetig:
//
//   * planung_einrichten.php fuehrt die Tabellen als PHP-Literale und
//     ergaenzt spaeter hinzugekommene Spalten als ADD COLUMN. Wer nur das
//     CREATE liest, bekommt den Stand von damals -- `einsaetze.abgeglichen_am`
//     etwa entsteht erst im Nachtrag.
//   * schema.sql traegt die aelteren Tabellen (mitarbeiter, kunden) als
//     reines SQL.
//
// Umgeschrieben wird nur so viel, wie SQLite braucht. Spalten, Reihenfolge
// und Anzahl bleiben unangetastet: Sonst pruefte man die Umschrift.

function schema_quellen(): array
{
    static $q = null;
    if ($q !== null) { return $q; }
    $w = __DIR__ . '/..';
    $q = ['einrichten' => (string)@file_get_contents($w . '/backend/api/planung_einrichten.php')];
    foreach (['schema.sql', 'schema_planung.sql', 'schema_verfuegbarkeit.sql'] as $d) {
        $q['sql'] = ($q['sql'] ?? '') . "\n" . (string)@file_get_contents($w . '/backend/' . $d);
    }
    return $q;
}

// Das CREATE TABLE, wie es wirklich ausgefuehrt wird -- ohne Nachtraege.
function schema_create(string $tabelle): ?string
{
    $q = schema_quellen();
    if (preg_match("/'" . preg_quote($tabelle, '/') . "' => \"(.*?)\",\n/s", $q['einrichten'], $m)) {
        return $m[1];
    }
    // Im reinen SQL bis zum abschliessenden ");" der Anweisung.
    if (preg_match('/CREATE TABLE (?:IF NOT EXISTS )?' . preg_quote($tabelle, '/')
                   . '\s*\(.*?\n\)[^;]*;/s', $q['sql'], $m)) {
        return rtrim($m[0], ';');
    }
    return null;
}

// Die spaeter ergaenzten Spalten dieser Tabelle, in der Reihenfolge des
// Einrichtungslaufs.
function schema_nachtraege(string $tabelle): array
{
    $q = schema_quellen();
    preg_match_all('/ALTER TABLE ' . preg_quote($tabelle, '/')
                   . ' ADD COLUMN [^"\']+/', $q['einrichten'], $m);
    return $m[0] ?? [];
}

// Legt die Tabelle mit dem echten Schema an. Gibt null zurueck, wenn es
// geklappt hat, sonst die Fehlermeldung -- damit die aufrufende Pruefung
// eine BENANNTE Zusage rot machen kann statt abzustuerzen.
function schema_anlegen(PDO $pdo, string $tabelle): ?string
{
    $ddl = schema_create($tabelle);
    if ($ddl === null) { return "Schema fuer '$tabelle' nicht gefunden"; }

    $ddl = preg_replace('/\bINT(?:EGER)? AUTO_INCREMENT PRIMARY KEY\b/', 'INTEGER PRIMARY KEY', $ddl);
    $ddl = preg_replace('/,\s*UNIQUE KEY \w+ \(([^)]*)\)/', ', UNIQUE ($1)', $ddl);
    $ddl = preg_replace('/,\s*(?:UNIQUE )?KEY \w+ \([^)]*\)/', '', $ddl);
    $ddl = preg_replace('/,\s*FOREIGN KEY \([^)]*\) REFERENCES \w+\s*\([^)]*\)[^,)]*/', '', $ddl);
    $ddl = preg_replace('/\)\s*ENGINE=\w+[^;]*/', ')', $ddl);
    // SQLite kennt kein ENUM und keine Anzeigebreite; der TYP ist fuer diese
    // Pruefungen ohne Belang, die SPALTEN sind es nicht.
    $ddl = preg_replace('/\bENUM\s*\([^)]*\)/', 'TEXT', $ddl);
    $ddl = preg_replace('/\bCOMMENT\s+\'[^\']*\'/', '', $ddl);
    // MySQL-eigene Nachfuehrung eines Zeitstempels. Sie betrifft das
    // VERHALTEN der Spalte, nicht ihr Vorhandensein -- und darum geht es hier.
    $ddl = preg_replace('/\s+ON UPDATE CURRENT_TIMESTAMP\b/i', '', $ddl);

    try { $pdo->exec($ddl); } catch (Throwable $e) { return $e->getMessage(); }

    foreach (schema_nachtraege($tabelle) as $alter) {
        // SQLite kennt kein AFTER -- die Position ist hier ohne Belang, das
        // VORHANDENSEIN der Spalte ist der Punkt.
        $a = preg_replace('/\s+AFTER\s+\w+\s*$/', '', trim($alter));
        $a = preg_replace('/\bENUM\s*\([^)]*\)/', 'TEXT', $a);
        try { $pdo->exec($a); } catch (Throwable $e) { /* schon vorhanden: gut */ }
    }
    return null;
}
