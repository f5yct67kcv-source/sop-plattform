<?php
declare(strict_types=1);
// Echte Ausfuehrung von einsatz_vollstaendig_rapportiert() (ENT-128) gegen
// eine wirkliche Datenbank (SQLite im Arbeitsspeicher), gleiches Muster wie
// pruef_rechte.php. Die Playwright-Suiten taeuschen die Serverantwort vor und
// pruefen nie die eigentliche SQL-Abfrage -- die laeuft nur hier.
require __DIR__ . '/../backend/planung.php';

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE einsatz_zuteilung (einsatz_id INT, mitarbeiter_id INT, zusage TEXT)');
$pdo->exec('CREATE TABLE rapporte (id INTEGER PRIMARY KEY AUTOINCREMENT, einsatz_id INT, mitarbeiter_id INT)');

pruef('KRITISCH: kein einziger vorhandener Rapport heisst nicht vollstaendig',
    einsatz_vollstaendig_rapportiert($pdo, 1) === false);

// ── Einsatz 1: eine zugesagte Person, kein Rapport ──────────────────────
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (1, 10, 'zugesagt')");
pruef('KRITISCH: zugesagt, aber noch kein Rapport -- nicht vollstaendig',
    einsatz_vollstaendig_rapportiert($pdo, 1) === false);

$pdo->exec('INSERT INTO rapporte (einsatz_id, mitarbeiter_id) VALUES (1, 10)');
pruef('KRITISCH: die eine zugesagte Person hat rapportiert -- jetzt vollstaendig',
    einsatz_vollstaendig_rapportiert($pdo, 1) === true);

// ── Einsatz 2: zwei zugesagte Personen ───────────────────────────────────
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (2, 20, 'zugesagt')");
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (2, 21, 'zugesagt')");
$pdo->exec('INSERT INTO rapporte (einsatz_id, mitarbeiter_id) VALUES (2, 20)');
pruef('KRITISCH: erst EINE von zwei zugesagten Personen rapportiert -- NICHT vollstaendig (nicht "irgendeine")',
    einsatz_vollstaendig_rapportiert($pdo, 2) === false);

$pdo->exec('INSERT INTO rapporte (einsatz_id, mitarbeiter_id) VALUES (2, 21)');
pruef('KRITISCH: jetzt haben BEIDE rapportiert -- vollstaendig',
    einsatz_vollstaendig_rapportiert($pdo, 2) === true);

// ── Einsatz 3: eine abgelehnte Person blockiert nicht ────────────────────
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (3, 30, 'zugesagt')");
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (3, 31, 'abgelehnt')");
$pdo->exec('INSERT INTO rapporte (einsatz_id, mitarbeiter_id) VALUES (3, 30)');
pruef('KRITISCH: eine abgelehnte Zuteilung ohne Rapport verhindert den Abschluss NICHT',
    einsatz_vollstaendig_rapportiert($pdo, 3) === true);

// ── Einsatz 4: nur eine offene (nicht beantwortete) Zuteilung ───────────
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (4, 40, 'offen')");
pruef('KRITISCH: ohne jede zugesagte Zuteilung ist ein Einsatz NIE vollstaendig (kein Vakuum-Wahr)',
    einsatz_vollstaendig_rapportiert($pdo, 4) === false);

// ── Ein Rapport fuer einen ANDEREN Einsatz zaehlt nicht mit ─────────────
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (5, 50, 'zugesagt')");
$pdo->exec('INSERT INTO rapporte (einsatz_id, mitarbeiter_id) VALUES (1, 50)');   // gehoert zu Einsatz 1, nicht 5
pruef('KRITISCH: ein Rapport eines anderen Einsatzes zaehlt nicht mit',
    einsatz_vollstaendig_rapportiert($pdo, 5) === false);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
