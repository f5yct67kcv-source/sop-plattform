<?php
declare(strict_types=1);
// Echte Ausfuehrung der automatischen Personalnummer (ENT-387) gegen eine
// wirkliche Datenbank (SQLite im Arbeitsspeicher) -- gleiches Muster wie
// pruef_mitarbeiter_login_migration.php.
//
// WARUM HIER UND NICHT NUR IN EINER BROWSER-SUITE: Ob zwei Personen
// wirklich nie dieselbe Personalnummer bekommen, haengt an einer echten
// Abfrage gegen den Bestand -- das wird ausgefuehrt, nicht nachgebaut.
//
// Der Nachtrag im Bestand (Vorschau/Ausfuehrung) ist mit ENT-684 entfallen:
// Seit jeder Anlegeweg die Nummer selbst vergibt, gibt es nichts mehr
// nachzutragen. Die Ziehung und die Formpruefung bleiben -- sie tragen die
// Zusage, auf der das beruht.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    $r = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name=" . $pdo->quote($t));
    return (bool)$r->fetch();
}

require __DIR__ . '/../backend/mitarbeiter.php';

function neueDb(): PDO {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                                   PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT, personalnummer TEXT,
                aktiv INTEGER DEFAULT 1, erstellt_am TEXT)');
    return $pdo;
}

// ── Einzelziehung: vierstellig, weicht einer Kollision aus ────────────────
{
    $pdo = neueDb();
    $pdo->exec("INSERT INTO mitarbeiter VALUES (1, 'schon.da', '4200', 1, '2025-01-01 00:00:00')");
    $treffer = [];
    for ($i = 0; $i < 30; $i++) {
        $n = ma_personalnummer_generieren($pdo);
        pruef("Vierstellig und im Bereich 1000-9999 (Lauf $i)", preg_match('/^[1-9]\d{3}$/', $n) === 1);
        $treffer[] = $n;
    }
    pruef('KRITISCH: die bereits vergebene Nummer 4200 wird nie gezogen',
        !in_array('4200', $treffer, true));
}

// ── Von Hand eingetragene Korrektur: dasselbe Muster (ENT-393) ───────────
{
    $pdo = neueDb();
    for ($i = 0; $i < 20; $i++) {
        pruef('KRITISCH: eine automatisch gezogene Nummer gilt auch als gueltige Korrektur',
            ma_personalnummer_gueltig(ma_personalnummer_generieren($pdo)));
    }
    pruef('KRITISCH: dreistellig wird abgelehnt', !ma_personalnummer_gueltig('999'));
    pruef('KRITISCH: fuenfstellig wird abgelehnt', !ma_personalnummer_gueltig('10000'));
    pruef('KRITISCH: eine fuehrende Null wird abgelehnt', !ma_personalnummer_gueltig('0123'));
    pruef('KRITISCH: Text wird abgelehnt', !ma_personalnummer_gueltig('abcd'));
    pruef('Leer wird abgelehnt', !ma_personalnummer_gueltig(''));
    pruef('Eine gueltige Nummer am unteren Rand des Bereichs', ma_personalnummer_gueltig('1000'));
    pruef('Eine gueltige Nummer am oberen Rand des Bereichs', ma_personalnummer_gueltig('9999'));
}

echo "$ok Pruefungen bestanden\n";
foreach ($bad as $b) { echo "X $b\n"; }
exit($bad ? 1 : 0);
