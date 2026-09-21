<?php
declare(strict_types=1);
// kern_verweise_fehlend() (backend/planung_einrichten_kern.php) wirklich
// ausfuehren -- gleiches Muster wie pruef_kern_schema.php, nur fuer
// Verweise statt Tabellen/Spalten.
//
// ANLASS: Das Update-Kriterium im Dashboard (ENT-033) zaehlte bis hierher
// jeden offenen Punkt aus planung_einrichten_ausfuehren() zusammen,
// darunter laufende Datenpflege (fehlende Rolle, "abgeschlossen"-Nachtrag
// usw.), die im Alltag jederzeit neu entsteht, ganz ohne Deploy -- der
// Update-Knopf wurde darum auch DIREKT NACH einer erfolgreichen
// Einrichtung wieder gelb, sobald neue Datenpflege anfiel. Das engere
// Kriterium zaehlt nur echtes Schema: Tabellen, Spalten (kern_schema_
// fehlend(), siehe pruef_kern_schema.php) und Verweise -- hier geprueft.
require __DIR__ . '/../backend/planung_einrichten_kern.php';

$ok = 0; $bad = [];
function pruef(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// Stellvertreter fuer hat_spalte()/hat_fremdschluessel(): beide fragen
// information_schema per prepare()/execute()/fetchColumn() ab, mit
// Tabelle und Spalte als Platzhalter. Die beiden Abfragen unterscheiden
// sich am KEY_COLUMN_USAGE-Text.
class PruefVerweisStmt extends PDOStatement {
    private array $gebunden = [];
    public function __construct(private bool $istFremdschluessel, private array $spalten, private array $fremdschluessel) {}
    public function execute(?array $params = null): bool {
        $this->gebunden = $params ?? [];
        return true;
    }
    public function fetchColumn(int $column = 0): mixed {
        $paar = [$this->gebunden[0], $this->gebunden[1]];
        $vorhanden = $this->istFremdschluessel
            ? in_array($paar, $this->fremdschluessel, true)
            : in_array($paar, $this->spalten, true);
        return $vorhanden ? 1 : false;
    }
}
class PruefVerweisPdo extends PDO {
    public function __construct(private array $spalten, private array $fremdschluessel = []) { parent::__construct('sqlite::memory:'); }
    public function prepare(string $query, array $options = []): PDOStatement|false {
        if (!str_contains($query, 'information_schema')) {
            throw new RuntimeException('unerwartete Abfrage: ' . $query);
        }
        return new PruefVerweisStmt(str_contains($query, 'KEY_COLUMN_USAGE'), $this->spalten, $this->fremdschluessel);
    }
}

pruef('der Sollstand ist nicht leer', count(kern_verweise()) >= 3);

// ── Eine vollstaendige Anlage: jede Spalte und jeder Verweis steht schon ──
$alleSpalten = [];
$alleVerweise = [];
foreach (kern_verweise() as [$tabelle, $spalte, ]) {
    $alleSpalten[] = [$tabelle, $spalte];
    $alleVerweise[] = [$tabelle, $spalte];
}
pruef('KRITISCH: eine vollstaendige Anlage meldet keinen fehlenden Verweis',
    kern_verweise_fehlend(new PruefVerweisPdo($alleSpalten, $alleVerweise)) === []);

// ── Fehlt die Spalte selbst komplett, ist das KEIN fehlender Verweis --
// das faellt schon bei kern_schema_fehlend() auf; hier zaehlte es sonst
// doppelt. ──
[$fehlT, $fehlS, ] = kern_verweise()[0];
$ohneSpalte = array_values(array_filter($alleSpalten, fn($z) => !($z[0] === $fehlT && $z[1] === $fehlS)));
pruef('KRITISCH: eine fehlende Spalte zaehlt hier nicht zusaetzlich als fehlender Verweis',
    kern_verweise_fehlend(new PruefVerweisPdo($ohneSpalte, $alleVerweise)) === []);

// ── DER LIVE-FALL: die Spalte steht, ihr Fremdschluessel fehlt noch ──
$ohneFremdschluessel = array_values(array_filter($alleVerweise, fn($z) => !($z[0] === $fehlT && $z[1] === $fehlS)));
$befund = kern_verweise_fehlend(new PruefVerweisPdo($alleSpalten, $ohneFremdschluessel));
pruef('KRITISCH: eine Spalte ohne ihren Fremdschluessel gilt als fehlender Verweis',
    $befund === ["$fehlT.$fehlS"]);

// ── Eine leere Anlage: keine der Spalten existiert -- dann greift schon
// "die Spalte fehlt", nicht "der Verweis fehlt" (siehe oben), der Befund
// bleibt darum leer statt bei jedem Eintrag falsch anzuschlagen. ──
pruef('eine leere Anlage haengt sich nicht an fehlenden Spalten auf',
    kern_verweise_fehlend(new PruefVerweisPdo([], [])) === []);

echo "\n" . $ok . ' bestanden, ' . count($bad) . " nicht bestanden\n";
if ($bad) { foreach ($bad as $b) { echo '  x ' . $b . "\n"; } exit(1); }
echo "Alle Pruefungen bestanden.\n";
