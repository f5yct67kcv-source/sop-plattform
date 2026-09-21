<?php
declare(strict_types=1);
// demo_nutzung_archivieren() (backend/demo_instanz.php, ENT-653) WIRKLICH
// ausfuehren, gegen zwei echte In-Memory-SQLite-Datenbanken -- eine fuer
// den Demo-Platz (Rohdaten), eine fuer die Betreiberin (Archiv).
//
// hat_tabelle() (backend/db.php) fragt MySQLs information_schema ab, das
// SQLite nicht kennt (siehe pruef_hat_tabelle.php) -- der Stellvertreter
// unten beantwortet NUR diese eine Abfrage aus einer festen Tabellenliste
// und reicht jede andere Abfrage an die echte SQLite-Verbindung weiter.
// Die eigentlich geprueften Funktionen (hat_tabelle(), demo_nutzung_
// archivieren()) laufen unveraendert und echt.
require __DIR__ . '/../backend/db.php';
require __DIR__ . '/../backend/betreiber.php';

// Nur demo_nutzung_archivieren() selbst aus demo_instanz.php herausziehen,
// statt die ganze Datei einzubinden -- sie zieht sonst demo_reset.php,
// demo_zugang.php, demo_daten.php und planung_einrichten_kern.php mit,
// die diese Pruefung nicht braucht und die hier eigene Stellvertreter
// ueberschreiben wuerden.
$demoInstanzQuelle = file_get_contents(__DIR__ . '/../backend/demo_instanz.php');
if (!preg_match(
    '/function demo_nutzung_archivieren\(.*?\n\}\n/s', $demoInstanzQuelle, $treffer
)) {
    fwrite(STDERR, "demo_nutzung_archivieren() nicht gefunden -- Funktion umbenannt/verschoben?\n");
    exit(1);
}
eval($treffer[0]);

class PruefArchivStmt extends PDOStatement {
    private array $gebunden = [];
    public function __construct(private ?PDOStatement $echt, private array $tabellen = []) {}
    public function execute(?array $params = null): bool {
        $this->gebunden = $params ?? [];
        return $this->echt ? $this->echt->execute($params) : true;
    }
    public function fetchColumn(int $col = 0): mixed {
        if ($this->echt) { return $this->echt->fetchColumn($col); }
        return in_array($this->gebunden[0] ?? null, $this->tabellen, true);
    }
    public function fetchAll(int $mode = PDO::FETCH_BOTH, ...$a): array {
        return $this->echt ? $this->echt->fetchAll($mode, ...$a) : [];
    }
}
class PruefArchivPdo extends PDO {
    public PDO $echt;
    public array $tabellen;
    public function __construct(array $tabellen) {
        $this->echt = new PDO('sqlite::memory:');
        $this->echt->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->echt->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->tabellen = $tabellen;
    }
    public function prepare(string $query, array $options = []): PDOStatement|false {
        if (str_contains($query, 'information_schema.TABLES')) {
            return new PruefArchivStmt(null, $this->tabellen);
        }
        return new PruefArchivStmt($this->echt->prepare($query));
    }
    public function query(string $query, ?int $mode = null, ...$a): PDOStatement|false {
        return $this->echt->query($query, $mode, ...$a);
    }
    public function exec(string $statement): int|false { return $this->echt->exec($statement); }
}

$ok = 0; $bad = [];
function pruef(string $name, bool $bedingung): void { global $ok, $bad; if ($bedingung) { $ok++; } else { $bad[] = $name; } }

function neueInstanz(bool $mitTabelle = true): PruefArchivPdo {
    $pdo = new PruefArchivPdo($mitTabelle ? ['demo_nutzung'] : []);
    $pdo->echt->exec('CREATE TABLE demo_nutzung (id INTEGER PRIMARY KEY, reiter TEXT, dauer_s INTEGER)');
    return $pdo;
}
function neuerBetreiber(bool $mitTabelle = true): PruefArchivPdo {
    $pdo = new PruefArchivPdo($mitTabelle ? ['be_demo_nutzung_archiv'] : []);
    $pdo->echt->exec('CREATE TABLE be_demo_nutzung_archiv (id INTEGER PRIMARY KEY, reiter TEXT, dauer_s_summe INTEGER, aufrufe INTEGER)');
    return $pdo;
}

// ── KRITISCH: mehrere Meldungen desselben Reiters werden zusammengefasst,
// nicht als einzelne Zeilen uebernommen.
$instanz = neueInstanz();
$instanz->echt->exec("INSERT INTO demo_nutzung (reiter, dauer_s) VALUES ('kunden', 30)");
$instanz->echt->exec("INSERT INTO demo_nutzung (reiter, dauer_s) VALUES ('kunden', 12)");
$instanz->echt->exec("INSERT INTO demo_nutzung (reiter, dauer_s) VALUES ('uebersicht', 5)");
$betreiber = neuerBetreiber();
demo_nutzung_archivieren($instanz, $betreiber);
$zeilen = $betreiber->echt->query('SELECT * FROM be_demo_nutzung_archiv ORDER BY reiter')->fetchAll();
pruef('KRITISCH: genau zwei archivierte Zeilen (eine je Reiter)', count($zeilen) === 2);
pruef('KRITISCH: "kunden" ist zusammengefasst -- Summe 42, zwei Aufrufe',
    $zeilen && $zeilen[0]['reiter'] === 'kunden'
    && (int)$zeilen[0]['dauer_s_summe'] === 42 && (int)$zeilen[0]['aufrufe'] === 2);
pruef('KRITISCH: "uebersicht" steht daneben mit einem Aufruf',
    isset($zeilen[1]) && $zeilen[1]['reiter'] === 'uebersicht'
    && (int)$zeilen[1]['dauer_s_summe'] === 5 && (int)$zeilen[1]['aufrufe'] === 1);

// ── KRITISCH: keine Spalte im ECHTEN Archiv-Schema (be_tabellen(), backend/
// betreiber.php) verweist auf Platz, Firma oder Person -- gegen die
// tatsaechliche Definition geprueft, nicht gegen die eigene, vereinfachte
// SQLite-Nachbildung oben.
$echteDefinition = be_tabellen()['be_demo_nutzung_archiv'] ?? null;
pruef('KRITISCH: be_tabellen() enthaelt ueberhaupt be_demo_nutzung_archiv',
    is_string($echteDefinition));
pruef('KRITISCH: das echte CREATE-Statement traegt keine Instanz-/Platz-/Firmen-Spalte',
    is_string($echteDefinition)
    && !preg_match('/\b(platz|instanz|firma|mandant|subdomain)\b\s+[A-Z]/i', $echteDefinition));

// ── Fehlt eine der beiden Tabellen, wird nichts geschrieben -- kein Fehler.
$instanzOhne = neueInstanz(false);
$betreiberMit = neuerBetreiber();
demo_nutzung_archivieren($instanzOhne, $betreiberMit);
pruef('Fehlt demo_nutzung beim Platz, bleibt das Archiv leer statt abzustuerzen',
    (int)$betreiberMit->echt->query('SELECT COUNT(*) FROM be_demo_nutzung_archiv')->fetchColumn() === 0);

$instanzMit = neueInstanz();
$instanzMit->echt->exec("INSERT INTO demo_nutzung (reiter, dauer_s) VALUES ('kunden', 9)");
$betreiberOhne = neuerBetreiber(false);
demo_nutzung_archivieren($instanzMit, $betreiberOhne);
pruef('Fehlt die Archivtabelle beim Betreiber, wird nichts geschrieben -- kein Fehler',
    (int)$betreiberOhne->echt->query('SELECT COUNT(*) FROM be_demo_nutzung_archiv')->fetchColumn() === 0);

// ── Leere Rohdaten: keine Zeile, kein Fehler.
$instanzLeer = neueInstanz();
$betreiberFuerLeer = neuerBetreiber();
demo_nutzung_archivieren($instanzLeer, $betreiberFuerLeer);
pruef('Keine Rohdaten -- keine archivierte Zeile, kein Fehler',
    (int)$betreiberFuerLeer->echt->query('SELECT COUNT(*) FROM be_demo_nutzung_archiv')->fetchColumn() === 0);

echo "\n" . $ok . ' bestanden, ' . count($bad) . " nicht bestanden\n";
if ($bad) { foreach ($bad as $b) { echo '  x ' . $b . "\n"; } exit(1); }
echo "Alle Pruefungen bestanden.\n";
