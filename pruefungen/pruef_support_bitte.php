<?php
declare(strict_types=1);
// Die Bitte um eine Freigabe wirklich ausfuehren (ENT-683, backend/support.php)
// -- gegen eine echte Datenbank, nicht gegen ihren Quelltext.
//
// WARUM DIESE DATEI: Drei Aussagen der Bitte sind Entscheidungen und keine
// Formulierungen, und genau die kann eine Textsuche nicht pruefen:
//
//   1. Eine Bitte oeffnet NICHTS. Nach dem Bitten gibt es keine gueltige
//      Freigabe -- sonst haette sich der Betreiber selbst hereingelassen.
//   2. Zwei Bitten nebeneinander gibt es nicht. Wer zweimal bittet,
//      ueberschreibt seinen Grund; sonst stuende die alte weiter da, wenn
//      der Betrieb der neuen nachkommt.
//   3. Eine Freigabe erledigt die offene Bitte. Bleibt sie stehen, sieht
//      der Betrieb eine Bitte, der er laengst nachgekommen ist.
//
// SQLite statt MySQL: Geprueft wird die Logik, nicht der Treiber. NOW() und
// DATE_ADD gibt es dort nicht -- die beiden Ausdruecke werden fuer diesen
// Lauf uebersetzt, der Rest der Funktionen laeuft unveraendert.
$ok = 0; $bad = [];
function pruef(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// Eine PDO-Huelle, die MySQL-Ausdruecke fuer SQLite uebersetzt. Nur die
// beiden, die hier vorkommen -- eine allgemeine Uebersetzung waere eine
// zweite Datenbank und niemand wuesste mehr, was wirklich lief.
class BittePdo extends PDO {
    private function um(string $q): string {
        $q = str_replace('NOW()', "datetime('now')", $q);
        return preg_replace('/DATE_ADD\(datetime\(\'now\'\), INTERVAL \? HOUR\)/',
            "datetime('now', '+' || ? || ' hours')", $q) ?? $q;
    }
    public function prepare(string $query, array $options = []): PDOStatement|false {
        return parent::prepare($this->um($query), $options);
    }
    public function query(string $query, ?int $fetchMode = null, mixed ...$args): PDOStatement|false {
        return parent::query($this->um($query));
    }
}

function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    $s = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?");
    $s->execute([$t]);
    return (bool)$s->fetchColumn();
}
function hat_spalte(PDO $pdo, string $tabelle, string $spalte): bool { return true; }

require __DIR__ . '/../backend/support.php';

$pdo = new BittePdo('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE support_freigabe (id INTEGER PRIMARY KEY AUTOINCREMENT,
    freigegeben_von TEXT, freigegeben_am TEXT DEFAULT (datetime(\'now\')),
    gilt_bis TEXT, zweck TEXT, widerrufen_am TEXT NULL)');
$pdo->exec('CREATE TABLE support_zugriff (id INTEGER PRIMARY KEY AUTOINCREMENT,
    freigabe_id INTEGER, zeitpunkt TEXT DEFAULT (datetime(\'now\')), wer TEXT, was TEXT)');
$pdo->exec('CREATE TABLE support_bitte (id INTEGER PRIMARY KEY AUTOINCREMENT,
    gebeten_von TEXT, gebeten_am TEXT DEFAULT (datetime(\'now\')), zweck TEXT,
    erledigt_am TEXT NULL, zurueckgezogen_am TEXT NULL)');

// ── Ausgangslage ─────────────────────────────────────────────────────
pruef('ohne Bitte ist keine offen', support_bitte_offen($pdo) === null);
pruef('und ohne Freigabe ist nichts gueltig', support_freigabe_gueltig($pdo) === null);

// ── 1. Bitten oeffnet nichts ─────────────────────────────────────────
support_bitten($pdo, 'Support <s@g.ch>', 'Rundgaenge fehlen nach dem Update');
$b = support_bitte_offen($pdo);
pruef('die Bitte steht da', $b !== null && $b['zweck'] === 'Rundgaenge fehlen nach dem Update');
// DIE WICHTIGSTE PRUEFUNG DIESER DATEI: Wer bitten kann, darf damit nicht
// hereinkommen.
pruef('KRITISCH: nach dem Bitten gibt es KEINE gueltige Freigabe',
    support_freigabe_gueltig($pdo) === null);
pruef('KRITISCH: und die Lage bleibt "nie freigegeben"', support_lage($pdo) === 'nie_freigegeben');

// ── 2. Eine offene Bitte, nicht zwei ─────────────────────────────────
$ersteId = (int)$b['id'];
$zweiteId = support_bitten($pdo, 'Support <s@g.ch>', 'Jetzt doch etwas anderes');
pruef('die zweite Bitte ueberschreibt die erste', $zweiteId === $ersteId);
pruef('es steht genau eine offene Bitte da',
    (int)$pdo->query('SELECT COUNT(*) FROM support_bitte
                       WHERE erledigt_am IS NULL AND zurueckgezogen_am IS NULL')
             ->fetchColumn() === 1);
pruef('und sie traegt den neuen Grund',
    (support_bitte_offen($pdo)['zweck'] ?? '') === 'Jetzt doch etwas anderes');

// ── 3. Zuruecknehmen ─────────────────────────────────────────────────
pruef('das Zuruecknehmen greift genau eine Bitte', support_bitte_zuruecknehmen($pdo) === 1);
pruef('danach ist keine mehr offen', support_bitte_offen($pdo) === null);
// Zurueckgezogen ist nicht geloescht: Der Betrieb soll nachlesen koennen,
// dass gefragt wurde.
pruef('die zurueckgezogene Bitte bleibt in der Tabelle',
    (int)$pdo->query('SELECT COUNT(*) FROM support_bitte')->fetchColumn() === 1);

// ── 4. Die Freigabe erledigt die Bitte ───────────────────────────────
support_bitten($pdo, 'Support <s@g.ch>', 'Einsatzplan laedt nicht');
pruef('eine neue Bitte steht offen', support_bitte_offen($pdo) !== null);
support_freigeben($pdo, 24, 'Chefin', 'Einsatzplan laedt nicht');
pruef('KRITISCH: die Freigabe erledigt die offene Bitte', support_bitte_offen($pdo) === null);
pruef('und sie ist als erledigt vermerkt, nicht als zurueckgezogen',
    (int)$pdo->query('SELECT COUNT(*) FROM support_bitte
                       WHERE erledigt_am IS NOT NULL AND zurueckgezogen_am IS NULL')
             ->fetchColumn() === 1);
pruef('jetzt gibt es eine gueltige Freigabe', support_freigabe_gueltig($pdo) !== null);

// ── 5. Ohne Tabelle kein Absturz ─────────────────────────────────────
// Eine Anlage, deren Einrichtung noch nicht gelaufen ist, hat die Tabelle
// nicht. Das ist "nicht eingerichtet" und darf nicht als Fehler enden.
$leer = new BittePdo('sqlite::memory:');
$leer->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
pruef('ohne Tabelle meldet die Bitte nichts, statt zu scheitern',
    support_bitte_da($leer) === false && support_bitte_offen($leer) === null
    && support_bitte_zuruecknehmen($leer) === 0);

echo count($bad) === 0 ? ($ok) . " bestanden\n" : "$ok bestanden\n";
foreach ($bad as $b2) { echo "x $b2\n"; }
exit($bad ? 1 : 0);
