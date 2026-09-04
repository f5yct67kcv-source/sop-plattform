<?php
declare(strict_types=1);
// Echte Ausfuehrung der automatischen Personalnummer (ENT-387) gegen eine
// wirkliche Datenbank (SQLite im Arbeitsspeicher) -- gleiches Muster wie
// pruef_mitarbeiter_login_migration.php.
//
// WARUM HIER UND NICHT NUR IN EINER BROWSER-SUITE: Ob zwei Personen
// wirklich nie dieselbe Personalnummer bekommen, haengt an einer echten
// Abfrage gegen den Bestand -- das wird ausgefuehrt, nicht nachgebaut.

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
    $pdo->exec('CREATE TABLE aenderungslog (id INTEGER PRIMARY KEY, zeitpunkt TEXT, akteur_id INT,
                akteur_name TEXT, bereich TEXT, objekt_id INT, feld TEXT, wert_alt TEXT, wert_neu TEXT,
                werte_verborgen INT)');
    return $pdo;
}

$akteur = ['id' => 99, 'name' => 'verwaltung-test'];

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

// ── Der Plan: bestehende Nummern bleiben, fehlende werden ergaenzt,
//    keine zwei Zeilen bekommen dieselbe neue Nummer ────────────────────
{
    $pdo = neueDb();
    $pdo->exec("INSERT INTO mitarbeiter VALUES (1, 'adrian.vonarb', '1', 1, '2025-01-05 10:00:00')");
    $pdo->exec("INSERT INTO mitarbeiter VALUES (2, 'daniel.muccio', NULL, 1, '2025-02-01 09:00:00')");
    $pdo->exec("INSERT INTO mitarbeiter VALUES (3, 'test.hans', '', 0, '2025-03-01 09:00:00')");
    $pdo->exec("INSERT INTO mitarbeiter VALUES (4, 'test.rene', NULL, 1, '2025-04-01 09:00:00')");

    $plan = ma_personalnummer_migrationsplan($pdo);
    $von = fn($id) => current(array_filter($plan, fn($p) => $p['id'] === $id));

    pruef('Genau 4 Zeilen im Plan, eine je Person', count($plan) === 4);
    pruef('KRITISCH: die bestehende Personalnummer bleibt unveraendert',
        $von(1)['neu'] === '1' && $von(1)['alt'] === '1' && $von(1)['status'] === 'unveraendert');
    pruef('KRITISCH: fehlende Personalnummer (NULL) wird zugewiesen',
        $von(2)['status'] === 'zugewiesen' && preg_match('/^[1-9]\d{3}$/', $von(2)['neu']) === 1);
    pruef('KRITISCH: leere Personalnummer wird genauso behandelt wie NULL',
        $von(3)['status'] === 'zugewiesen' && preg_match('/^[1-9]\d{3}$/', $von(3)['neu']) === 1);
    pruef('Keine "uebersprungen" bei Personalnummern -- jede fehlende bekommt eine',
        !array_filter($plan, fn($p) => $p['status'] === 'uebersprungen'));
    pruef('KRITISCH: die beiden neu zugewiesenen Nummern sind verschieden',
        $von(2)['neu'] !== $von(4)['neu']);
    pruef('KRITISCH: keine neu zugewiesene Nummer kollidiert mit der bereits vergebenen "1"',
        $von(2)['neu'] !== '1' && $von(4)['neu'] !== '1');
    pruef('Status und Anlegedatum kommen mit', $von(3)['aktiv'] === false
        && $von(1)['erstellt_am'] === '2025-01-05 10:00:00');
}

// ── Die Ausfuehrung: schreibt nur die fehlenden, protokolliert nur diese ──
{
    $pdo = neueDb();
    $pdo->exec("INSERT INTO mitarbeiter VALUES (1, 'adrian.vonarb', '1', 1, '2025-01-05 10:00:00')");
    $pdo->exec("INSERT INTO mitarbeiter VALUES (2, 'daniel.muccio', NULL, 1, '2025-02-01 09:00:00')");

    ma_personalnummer_migrieren($pdo, $akteur);

    $pn = fn($id) => $pdo->query("SELECT personalnummer FROM mitarbeiter WHERE id=$id")->fetch()['personalnummer'];
    pruef('Die bestehende Nummer bleibt exakt "1", nicht neu gewuerfelt', $pn(1) === '1');
    pruef('KRITISCH: die fehlende Nummer steht jetzt wirklich in der Datenbank',
        preg_match('/^[1-9]\d{3}$/', (string)$pn(2)) === 1);

    $log = $pdo->query('SELECT * FROM aenderungslog')->fetchAll();
    pruef('KRITISCH: genau EIN Logbuch-Eintrag -- nur fuer die tatsaechliche Zuweisung',
        count($log) === 1);
    pruef('Der Eintrag betrifft die richtige Person und nennt den neuen Wert',
        count($log) === 1 && (int)$log[0]['objekt_id'] === 2
        && $log[0]['wert_alt'] === null && $log[0]['wert_neu'] === $pn(2));

    // ── Idempotenz: ein zweiter Lauf veraendert nichts mehr ───────────────
    $plan2 = ma_personalnummer_migrationsplan($pdo);
    pruef('KRITISCH: ein zweiter Lauf findet nichts mehr zu tun',
        !array_filter($plan2, fn($p) => $p['status'] === 'zugewiesen'));
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
