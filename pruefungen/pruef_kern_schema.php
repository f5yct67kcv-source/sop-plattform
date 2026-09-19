<?php
declare(strict_types=1);
// kern_schema_fehlend() (backend/planung_einrichten_kern.php) wirklich
// ausfuehren -- gegen eine Anlage, die alles hat, und gegen eine, der
// genau eine Spalte fehlt.
//
// ANLASS: Demo-Platz 6 und 8, live am 2026-09-19. Beide hatten alle
// Tabellen, aber nicht alle Spalten. Jede Pruefung im System zaehlte
// Tabellen, also galten beide als eingerichtet. Ein Interessent waere
// darauf gelandet, der Platz waere geleert worden, und das Befuellen
// waere an der fehlenden Spalte gescheitert -- 503, Eingabe verloren,
// Platz kaputter als vorher.
//
// WARUM MIT PDO-STELLVERTRETERN: kern_schema_fehlend() fragt MySQLs
// information_schema ab, das es in SQLite nicht gibt, und ein MySQL-
// Server steht hier nicht zur Verfuegung. Ersetzt wird nur die Abfrage;
// die Funktion selbst laeuft unveraendert.
require __DIR__ . '/../backend/planung_einrichten_kern.php';

$ok = 0; $bad = [];
function pruef(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

class PruefSchemaStmt extends PDOStatement {
    public function __construct(private array $zeilen) {}
    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array {
        return $this->zeilen;
    }
}
class PruefSchemaPdo extends PDO {
    public static int $abfragen = 0;
    public function __construct(public array $zeilen) { parent::__construct('sqlite::memory:'); }
    public function query(string $query, ?int $fetchMode = null, mixed ...$args): PDOStatement|false {
        self::$abfragen++;
        // Die Funktion darf nur nach dem Bauplan fragen, nie nach Daten.
        if (!str_contains($query, 'information_schema')) {
            throw new RuntimeException('unerwartete Abfrage: ' . $query);
        }
        return new PruefSchemaStmt($this->zeilen);
    }
}

// ── Eine vollstaendige Anlage nachbauen ────────────────────────────────
// Jede Tabelle mit einer Platzhalterspalte (im CREATE steht immer
// mindestens eine), dazu alle 190 nachtraeglichen Spalten.
$vollstaendig = [];
foreach (array_keys(kern_tabellen()) as $t) { $vollstaendig[] = [$t, 'id']; }
foreach (kern_spalten() as [$t, $s, ]) { $vollstaendig[] = [$t, $s]; }

pruef('KRITISCH: eine vollstaendige Anlage meldet nichts als fehlend',
    kern_schema_fehlend(new PruefSchemaPdo($vollstaendig)) === []);

// Die Sollmenge darf nicht unbemerkt zusammenschrumpfen: Eine leere
// Liste wuerde jede Anlage fuer vollstaendig erklaeren.
pruef('der Sollstand ist nicht leer -- 60 Tabellen und 150 Spalten mindestens',
    count(kern_tabellen()) >= 60 && count(kern_spalten()) >= 150);

// ── DER LIVE-FALL: alle Tabellen, eine Spalte fehlt ────────────────────
[$fehlT, $fehlS, ] = kern_spalten()[0];
$ohneSpalte = array_values(array_filter($vollstaendig,
    fn($z) => !($z[0] === $fehlT && $z[1] === $fehlS)));
$befund = kern_schema_fehlend(new PruefSchemaPdo($ohneSpalte));
pruef('KRITISCH: eine fehlende Spalte faellt auf, obwohl alle Tabellen da sind',
    $befund === ['Spalte ' . $fehlT . '.' . $fehlS]);

// ── Fehlt die Tabelle, werden ihre Spalten nicht zusaetzlich genannt ───
// Sonst waere die Liste bei einer leeren Anlage hunderte Zeilen lang und
// der eine wichtige Satz -- "die Tabelle fehlt" -- ginge darin unter.
$ohneTabelle = array_values(array_filter($vollstaendig, fn($z) => $z[0] !== $fehlT));
$befundT = kern_schema_fehlend(new PruefSchemaPdo($ohneTabelle));
pruef('eine fehlende Tabelle wird genannt',
    in_array('Tabelle ' . $fehlT, $befundT, true));
pruef('ihre Spalten werden nicht zusaetzlich aufgezaehlt',
    !in_array('Spalte ' . $fehlT . '.' . $fehlS, $befundT, true));

// ── Eine leere Anlage: alle Tabellen fehlen ────────────────────────────
pruef('eine leere Anlage meldet jede Tabelle',
    count(kern_schema_fehlend(new PruefSchemaPdo([]))) === count(kern_tabellen()));

// ── Eine Abfrage, nicht hunderte ───────────────────────────────────────
// Das ist Teil der Aussage und nicht nur eine Nettigkeit: Der Weg ueber
// den Pruefmodus der Einrichtung braucht ueber 500 Abfragen je Anlage und
// kam darum fuer die Platzwahl nicht in Frage.
PruefSchemaPdo::$abfragen = 0;
kern_schema_fehlend(new PruefSchemaPdo($vollstaendig));
pruef('KRITISCH: eine einzige Abfrage je Anlage',
    PruefSchemaPdo::$abfragen === 1);

echo "\n" . $ok . ' bestanden, ' . count($bad) . " nicht bestanden\n";
if ($bad) { foreach ($bad as $b) { echo '  x ' . $b . "\n"; } exit(1); }
echo "Alle Pruefungen bestanden.\n";
