<?php
declare(strict_types=1);
// hat_tabelle()/hat_spalte() (backend/db.php) wirklich mit ZWEI
// verschiedenen Datenbankverbindungen in derselben Anfrage aufrufen.
//
// ANLASS: Live gefunden am 2026-09-18. Eine einzige Anfrage prueft oft
// mehrere Datenbanken hintereinander -- betreiber_mandant_stand.php etwa
// ruft mandant_stand() fuer JEDEN Mandanten auf, und jeder Mandant kann
// eine eigene Datenbankverbindung haben (betreiber.php, ENT-519). Das
// Gedaechtnis von hat_tabelle() war bis dahin nur nach Tabellenname
// geschluesselt, nicht nach Verbindung: Sobald die ERSTE gepruefte
// Datenbank eine Tabelle hatte, "hatte" sie danach jede andere Datenbank
// in derselben Anfrage auch -- ganz unabhaengig davon, ob dort ueberhaupt
// eine Einrichtung gelaufen war. Die Mandanten-Liste im Betreiber-Bereich
// zeigte darum "5 von 5 Tabellen" fuer fuenf Demo-Plaetze, deren
// Datenbanken tatsaechlich komplett leer waren -- eine echte Anfrage
// (demo_anfordern.php) scheiterte prompt mit "noch nicht vollstaendig
// eingerichtet", waehrend die Oberflaeche "erreichbar" behauptete.
//
// WARUM MIT PDO-STELLVERTRETERN STATT ECHTEM MYSQL: hat_tabelle() fragt
// absichtlich MySQLs information_schema ab, das es in SQLite (dem
// Testwerkzeug dieses Projekts) nicht gibt, und ein echter MySQL-Server
// steht hier nicht zur Verfuegung. Die Stellvertreter unten ersetzen nur
// die Abfrage selbst -- hat_tabelle()/hat_spalte() aus db.php laufen
// UNVERAENDERT und echt, nur gegen kontrollierte Antworten je Verbindung.
require __DIR__ . '/../backend/db.php';

$ok = 0; $bad = [];
function pruef(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// Zaehlt Aufrufe je Verbindung mit, damit sich auch die andere Haelfte der
// Aussage pruefen laesst: das Gedaechtnis muss innerhalb EINER Verbindung
// weiter wirken (sonst waere jede Abfrage einzeln richtig, aber langsam).
class PruefHatTabelleStmt extends PDOStatement {
    private array $gebunden = [];
    public function __construct(private string $verbindung) {}
    public function execute(?array $params = null): bool { $this->gebunden = $params ?? []; return true; }
    public function fetchColumn(int $col = 0): mixed {
        PruefHatTabellePdo::$aufrufe[] = $this->verbindung . ':' . implode('|', $this->gebunden);
        return PruefHatTabellePdo::$antworten[$this->verbindung . ':' . implode('|', $this->gebunden)] ?? false;
    }
}
class PruefHatTabellePdo extends PDO {
    public static array $antworten = [];
    public static array $aufrufe = [];
    public function __construct(public string $kennung) { parent::__construct('sqlite::memory:'); }
    public function prepare(string $query, array $options = []): PDOStatement|false {
        return new PruefHatTabelleStmt($this->kennung);
    }
}

// ── hat_tabelle(): zwei Verbindungen, gleicher Tabellenname ─────────────
$a = new PruefHatTabellePdo('a');
$b = new PruefHatTabellePdo('b');
PruefHatTabellePdo::$antworten = ['a:mitarbeiter' => true, 'b:mitarbeiter' => false];

pruef('KRITISCH: Verbindung A meldet ihre eigene, tatsaechlich vorhandene Tabelle',
    hat_tabelle($a, 'mitarbeiter') === true);
pruef('KRITISCH: Verbindung B uebernimmt NICHT das Ergebnis von A -- ihre Datenbank ist leer',
    hat_tabelle($b, 'mitarbeiter') === false);
// Gegenprobe der Gegenprobe: ruft man B zuerst auf, muss A weiterhin ihr
// EIGENES, richtiges Ergebnis behalten -- die Reihenfolge darf keine Rolle
// spielen.
$c = new PruefHatTabellePdo('c');
$d = new PruefHatTabellePdo('d');
PruefHatTabellePdo::$antworten['c:objekte'] = false;
PruefHatTabellePdo::$antworten['d:objekte'] = true;
pruef('die Reihenfolge macht keinen Unterschied: zuerst die leere Datenbank ...',
    hat_tabelle($c, 'objekte') === false);
pruef('... dann die volle -- beide bleiben bei ihrem eigenen Stand',
    hat_tabelle($d, 'objekte') === true);

// ── Das Gedaechtnis bleibt INNERHALB einer Verbindung wirksam ───────────
$vorher = count(PruefHatTabellePdo::$aufrufe);
hat_tabelle($a, 'mitarbeiter');
pruef('innerhalb derselben Verbindung wird ein zweites Mal NICHT erneut abgefragt',
    count(PruefHatTabellePdo::$aufrufe) === $vorher);
hat_tabelle($a, 'mitarbeiter', true);
pruef('mit ohneGedaechtnis wird trotzdem erneut abgefragt',
    count(PruefHatTabellePdo::$aufrufe) === $vorher + 1);

// ── hat_spalte(): dieselbe Aussage, zwei Bindungen statt einer ──────────
$e = new PruefHatTabellePdo('e');
$f = new PruefHatTabellePdo('f');
PruefHatTabellePdo::$antworten['e:mandant|subdomain'] = true;
PruefHatTabellePdo::$antworten['f:mandant|subdomain'] = false;
pruef('KRITISCH: hat_spalte() hat denselben Fehler nicht -- Verbindung E hat die Spalte',
    hat_spalte($e, 'mandant', 'subdomain') === true);
pruef('KRITISCH: Verbindung F bleibt bei ihrem eigenen (fehlenden) Stand',
    hat_spalte($f, 'mandant', 'subdomain') === false);

echo "\n" . $ok . ' bestanden, ' . count($bad) . " nicht bestanden\n";
if ($bad) { foreach ($bad as $b) { echo '  x ' . $b . "\n"; } exit(1); }
echo "Alle Pruefungen bestanden.\n";
