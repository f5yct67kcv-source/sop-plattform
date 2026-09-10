<?php
declare(strict_types=1);
// Der Einrichtungslauf, WIRKLICH ausgefuehrt -- und die eine Zahl, an der
// der Update-Punkt in der Seitenleiste haengt: 'ausstehend'.
//
// ANLASS (Befund des Projektinhabers, 10.09.2026): Der Punkt neben
// "Einrichtung" blieb gelb, egal wie oft die Einrichtung lief. Ursache war
// der Hinweis auf die noch nicht erfassten Abzugssaetze (lohn_abzug). Er
// landete in $getan, das Dashboard liest 'ausstehend' = count($getan) --
// und die Einrichtung konnte diesen Punkt nie abarbeiten, weil sie fuer
// lohn_abzug BEWUSST keinen Startbestand anlegt (ENT-451). Ein Signal, das
// die Handlung, auf die es zeigt, nicht loeschen kann, ist kaputt.
//
// WARUM DIESE PRUEFUNG SO GEBAUT IST: Die Browser-Suiten (test_einrichtung.mjs)
// taeuschen die Serverantwort vor -- sie kaemen an dieser Einordnung nie
// vorbei, weil sie 'ausstehend' selbst setzen. Und eine Pruefung, die im
// Quelltext nach "$hinweise" sucht, bliebe gruen, sobald jemand die
// Formulierung aendert und die Sache verschwindet. Darum laeuft hier der
// ECHTE Endpunkt, mit den echten Rollen aus rechte.php und den echten
// Feldlisten aus mitarbeiter.php. Ausgetauscht ist nur die unterste
// Schicht: db() liefert eine PDO-Attrappe, json_response() wirft statt zu
// senden, require_session() gibt eine erfundene Person mit dem noetigen
// Recht zurueck. Alles darueber ist der Code, der auch produktiv laeuft.
//
// Die Attrappe beantwortet den Zustand "vollstaendig eingerichtet": jede
// Tabelle da, jede Spalte da, jeder Verweis da, nichts nachzutragen. In
// diesem Zustand MUSS 'ausstehend' null sein -- sonst leuchtet der Punkt
// bei einem Betrieb, an dem nichts mehr einzurichten ist.
//
// Drei Szenarien, jedes in einem EIGENEN Prozess: Der Endpunkt deklariert
// Funktionen auf oberster Ebene und laesst sich darum nur einmal je Lauf
// einbinden.
//
// GEGENPROBE: Wird der Hinweis in planung_einrichten.php wieder nach
// $getan geschrieben, wird "saetze_fehlen" rot. Wird 'ausstehend' fest auf
// 0 verdrahtet, wird "tabelle_fehlt" rot -- eine Zahl, die nie leuchtet,
// waere derselbe Fehler von der anderen Seite.

$wurzel = dirname(__DIR__);

// ── Kindlauf: ein Szenario, ein Prozess, eine JSON-Zeile ─────────────────
$szenario = '';
foreach ($argv as $a) {
    if (str_starts_with($a, '--szenario=')) { $szenario = substr($a, strlen('--szenario=')); }
}

/** Die Antwort des Endpunkts -- statt sie an den Browser zu senden. */
class PruefAntwort extends Exception
{
    public function __construct(public $rumpf, public int $status) { parent::__construct('Antwort'); }
}

/**
 * Was die Datenbank in diesem Szenario sagt.
 *
 * Bewusst NICHT nach dem vollen SQL geschluesselt, sondern nach der Frage,
 * die dahintersteht: "gibt es die Tabelle", "wie viele Zeilen hat X". Ein
 * Abgleich auf den vollen Wortlaut waere wieder eine abgeschriebene Kopie
 * des Quelltexts und ginge beim ersten umformulierten SELECT kaputt.
 */
function pruef_db_antwort(string $sql, array $par, string $art, array $lage)
{
    $eins = $art === 'spalte';

    // Schema-Fragen (hat_tabelle / hat_spalte / hat_fremdschluessel).
    if (str_contains($sql, 'information_schema.TABLES')) {
        return in_array((string)($par[0] ?? ''), $lage['tabellen_fehlen'], true) ? false : 1;
    }
    if (str_contains($sql, 'information_schema.COLUMNS')) {
        return in_array(($par[0] ?? '') . '.' . ($par[1] ?? ''), $lage['spalten_fehlen'], true) ? false : 1;
    }
    if (str_contains($sql, 'KEY_COLUMN_USAGE')) { return 1; }

    // Die Systemrollen stehen in rechte.php und sind hier deckungsgleich in
    // der Datenbank -- der Nachfuehrschritt (ENT-440) hat also nichts zu tun.
    // Waere das nachgebaut statt aus system_rollen() geholt, pruefte diese
    // Datei ihre eigene Kopie.
    if (str_contains($sql, 'FROM rollen WHERE system = 1')) {
        $zeilen = []; $id = 0;
        foreach (system_rollen() as $schluessel => $d) {
            $zeilen[] = ['id' => ++$id, 'schluessel' => $schluessel,
                         'titel' => $d['titel'], 'text' => $d['text']];
        }
        return $zeilen;
    }
    if (str_contains($sql, 'FROM rollen_rechte WHERE rolle_id')) {
        $zeilen = []; $id = 0;
        foreach (system_rollen() as $d) {
            if (++$id !== (int)($par[0] ?? 0)) { continue; }
            foreach ($d['stufen'] as $bereich => $stufe) {
                $zeilen[] = ['bereich' => $bereich, 'stufe' => $stufe];
            }
        }
        return $zeilen;
    }

    // Bestandszahlen.
    if (str_contains($sql, 'FROM lohn_abzug'))      { return $lage['abzugssaetze']; }
    if (str_contains($sql, 'FROM betrieb'))         { return 1; }
    if (str_contains($sql, 'FROM anstellungsorte')) { return 2; }

    // Alles Uebrige: nichts nachzutragen. Kein Fahrzeug ohne Aufkleber-
    // Schluessel, kein Kunde ohne Nummer, kein Nulldatum, keine Person ohne
    // Rolle, kein Einsatz ohne "abgeschlossen".
    return $eins ? 0 : [];
}

class PruefStmt extends PDOStatement
{
    private array $par = [];
    public function __construct(private string $sql, private array $lage) {}
    public function execute(?array $params = null): bool { $this->par = $params ?? []; return true; }
    public function fetchColumn(int $column = 0): mixed
    { return pruef_db_antwort($this->sql, $this->par, 'spalte', $this->lage); }
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $cursorOrientation = PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed
    { $z = pruef_db_antwort($this->sql, $this->par, 'alle', $this->lage); return $z[0] ?? false; }
    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array
    {
        $zeilen = pruef_db_antwort($this->sql, $this->par, 'alle', $this->lage);
        if (!is_array($zeilen)) { return []; }
        if ($mode === PDO::FETCH_COLUMN) { return array_map(fn ($z) => reset($z), $zeilen); }
        return $zeilen;
    }
    public function rowCount(): int { return 0; }
}

class PruefPdo extends PDO
{
    /** Jede schreibende Anweisung, die der Lauf abgesetzt hat. */
    public array $geschrieben = [];
    public function __construct(private array $lage) {}
    public function prepare(string $query, array $options = []): PDOStatement|false
    { return new PruefStmt($query, $this->lage); }
    public function query(string $query, ?int $fetchMode = null, mixed ...$args): PDOStatement|false
    { return new PruefStmt($query, $this->lage); }
    public function exec(string $statement): int|false { $this->geschrieben[] = $statement; return 0; }
    public function lastInsertId(?string $name = null): string|false { return '1'; }
}

$GLOBALS['pruef_pdo'] = null;
function pruef_pdo(): PDO { return $GLOBALS['pruef_pdo']; }

/** Legt eine Arbeitskopie von backend/ an, in der nur db() ausgetauscht ist. */
function pruef_sandkasten(string $wurzel): string
{
    $ziel = sys_get_temp_dir() . '/sop-einrichtung-' . getmypid();
    pruef_kopiere($wurzel . '/backend', $ziel . '/backend');

    $datei = $ziel . '/backend/db.php';
    $quelle = file_get_contents($datei);
    // Drei Austausche, jeder GENAU einmal. Passt einer nicht mehr, hat sich
    // db.php geaendert -- dann soll diese Pruefung laut abbrechen und nicht
    // still etwas anderes messen.
    $austausch = [
        'function db(): PDO {'
            => "function db(): PDO { return pruef_pdo(); }\nfunction db_ungenutzt(): PDO {",
        'function json_response($data, int $status = 200): void {'
            => "function json_response(\$data, int \$status = 200): void { throw new PruefAntwort(\$data, \$status); }\n"
             . "function json_response_ungenutzt(\$data, int \$status = 200): void {",
        'function require_session(): array {'
            => "function require_session(): array { return ['id' => 1, 'name' => 'pruefung', 'rechte' => ['betrieb_schreiben']]; }\n"
             . 'function require_session_ungenutzt(): array {',
    ];
    foreach ($austausch as $alt => $neu) {
        if (substr_count($quelle, $alt) !== 1) {
            fwrite(STDERR, "db.php: \"$alt\" nicht genau einmal gefunden\n");
            exit(2);
        }
        $quelle = str_replace($alt, $neu, $quelle);
    }
    file_put_contents($datei, $quelle);
    return $ziel;
}

function pruef_kopiere(string $von, string $nach): void
{
    @mkdir($nach, 0777, true);
    foreach (scandir($von) as $e) {
        if ($e === '.' || $e === '..') { continue; }
        is_dir("$von/$e") ? pruef_kopiere("$von/$e", "$nach/$e") : copy("$von/$e", "$nach/$e");
    }
}

function pruef_weg(string $pfad): void
{
    if (!is_dir($pfad)) { return; }
    foreach (scandir($pfad) as $e) {
        if ($e === '.' || $e === '..') { continue; }
        is_dir("$pfad/$e") ? pruef_weg("$pfad/$e") : unlink("$pfad/$e");
    }
    rmdir($pfad);
}

if ($szenario !== '') {
    $lagen = [
        // Vollstaendig eingerichtet, Abzugssaetze erfasst.
        'alles_da'      => ['tabellen_fehlen' => [], 'spalten_fehlen' => [], 'abzugssaetze' => 3],
        // Vollstaendig eingerichtet, aber die Saetze fehlen noch. GENAU der
        // Zustand, in dem der Punkt gelb klebte.
        'saetze_fehlen' => ['tabellen_fehlen' => [], 'spalten_fehlen' => [], 'abzugssaetze' => 0],
        // Wirklich etwas einzurichten. Hier MUSS der Punkt leuchten.
        'tabelle_fehlt' => ['tabellen_fehlen' => ['ma_funktion'], 'spalten_fehlen' => [], 'abzugssaetze' => 3],
    ];
    if (!isset($lagen[$szenario])) { fwrite(STDERR, "unbekanntes Szenario\n"); exit(2); }

    $ziel = pruef_sandkasten($wurzel);
    $GLOBALS['pruef_pdo'] = new PruefPdo($lagen[$szenario]);
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $rumpf = null; $abbruch = null;
    try {
        require $ziel . '/backend/api/planung_einrichten.php';
    } catch (PruefAntwort $a) {
        $rumpf = $a->rumpf;
    } catch (Throwable $e) {
        $abbruch = get_class($e) . ': ' . $e->getMessage();
    }
    pruef_weg($ziel);
    echo json_encode([
        'rumpf'       => $rumpf,
        'abbruch'     => $abbruch,
        // Ein Pruefaufruf (GET) darf NICHTS schreiben. Steht hier etwas,
        // hat der stille Hintergrund-Check die Datenbank angefasst.
        'geschrieben' => $GLOBALS['pruef_pdo']->geschrieben,
    ], JSON_UNESCAPED_UNICODE), "\n";
    exit(0);
}

// ── Elternlauf ───────────────────────────────────────────────────────────
$ok = 0; $bad = [];
function pruef(string $name, bool $c): void { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

/** @return array{rumpf: ?array, abbruch: ?string, geschrieben: array} */
function pruef_lauf(string $szenario): array
{
    $aus = [];
    exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__)
        . ' --szenario=' . escapeshellarg($szenario) . ' 2>/dev/null', $aus, $code);
    $d = json_decode((string)end($aus), true);
    return is_array($d) ? $d : ['rumpf' => null, 'abbruch' => 'kein lesbares Ergebnis (Code ' . $code . ')', 'geschrieben' => []];
}

// Ohne exec() liesse sich kein Szenario in einem eigenen Prozess starten.
// Dann ist die Aussage dieser Datei NICHT geprueft -- das gehoert gesagt und
// nicht als gruen ausgegeben.
if (!function_exists('exec')) {
    echo "0 Pruefungen bestanden\n1 FEHLGESCHLAGEN:\n"
       . " - exec() ist gesperrt; der Einrichtungslauf laesst sich nicht ausfuehren\n";
    exit(1);
}

$laeufe = [];
foreach (['alles_da', 'saetze_fehlen', 'tabelle_fehlt'] as $s) { $laeufe[$s] = pruef_lauf($s); }

foreach ($laeufe as $name => $l) {
    pruef("Der echte Einrichtungslauf antwortet im Szenario \"$name\" ueberhaupt",
        $l['abbruch'] === null && is_array($l['rumpf']));
    if ($l['abbruch'] !== null) { $bad[] = "  ($name: {$l['abbruch']})"; }
}

// ── Der Befund vom 10.09.2026 ────────────────────────────────────────────
$a = $laeufe['alles_da']['rumpf'] ?? [];
$s = $laeufe['saetze_fehlen']['rumpf'] ?? [];
$t = $laeufe['tabelle_fehlt']['rumpf'] ?? [];

pruef('Ist alles eingerichtet, steht nichts mehr aus',
    ($a['ausstehend'] ?? -1) === 0 && ($a['getan'] ?? null) === []);

pruef('KRITISCH: fehlende Abzugssaetze halten den Update-Punkt NICHT gelb '
    . '(sie sind von Hand zu erfassen, die Einrichtung kann sie nicht anlegen)',
    ($s['ausstehend'] ?? -1) === 0);

pruef('Verschwiegen wird der fehlende Satz trotzdem nicht -- er kommt als Hinweis mit',
    is_array($s['hinweise'] ?? null) && count($s['hinweise']) === 1
    && str_contains(implode(' ', $s['hinweise']), 'lohn_abzug'));

pruef('Ein Hinweis steht NICHT unter dem, was die Einrichtung getan hat',
    ($s['getan'] ?? null) === []);

pruef('Sind die Saetze erfasst, gibt es auch keinen Hinweis mehr',
    ($a['hinweise'] ?? null) === []);

// Die Gegenrichtung. Ohne sie waere "ausstehend ist 0" auch dann erfuellt,
// wenn die Zahl gar nichts mehr meldet.
pruef('KRITISCH: fehlt wirklich etwas, meldet der Lauf es als ausstehend',
    ($t['ausstehend'] ?? 0) === 1
    && str_contains(implode(' | ', $t['getan'] ?? []), 'ma_funktion'));

pruef('Die gemeldete Zahl ist die Laenge der Liste, nicht eine zweite Rechnung',
    ($t['ausstehend'] ?? -1) === count($t['getan'] ?? [])
    && ($s['ausstehend'] ?? -1) === count($s['getan'] ?? []));

pruef('Der Pruefmodus sagt in Worten dasselbe wie in der Zahl',
    ($s['message'] ?? '') === 'Alles ist eingerichtet.'
    && str_contains($t['message'] ?? '', 'stehen noch aus'));

// Der stille Hintergrund-Check laeuft bei jedem Laden des Dashboards. Wuerde
// er schreiben, richtete jeder Seitenaufruf die Datenbank mit ein.
foreach ($laeufe as $name => $l) {
    pruef("Der Pruefaufruf schreibt nichts (\"$name\")", ($l['geschrieben'] ?? []) === []);
}

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
