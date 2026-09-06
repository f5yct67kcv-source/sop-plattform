<?php
declare(strict_types=1);
// Zu- und Absagen auf Termine, WIRKLICH ausgefuehrt (ENT-436), gegen eine
// SQLite-Datenbank im Arbeitsspeicher.
//
// WORUM ES GEHT: In der App stehen die beiden Knoepfe nur an einem Termin,
// den diese Person sieht. Das ist Bequemlichkeit, keine Sperre -- ueber die
// Anfrage laesst sich jede Nummer und jeder Wert schicken. Drei Dinge
// muessen darum im Server stehen und werden hier geprueft:
//
//   1. Geantwortet wird nur auf einen SICHTBAREN Termin. Sonst liesse sich
//      ueber geratene Nummern herausfinden, welche Termine es gibt -- und
//      in der Verwaltung stuende eine Zusage von jemandem, der gar nicht
//      eingeladen war.
//   2. Die Person kommt aus der SITZUNG. Eine mitgeschickte fremde id darf
//      nichts bewirken, sonst sagt einer fuer den anderen ab.
//   3. "offen" ist keine Antwort. Waere es eine, liesse sich eine bereits
//      abgegebene Zusage still zuruecknehmen.
$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

class Antwort extends RuntimeException {
    public array $daten; public int $status;
    public function __construct(array $d, int $s) { $this->daten = $d; $this->status = $s; parent::__construct('fertig'); }
}
function json_response($data, int $status = 200): void { throw new Antwort((array)$data, $status); }
// Die angemeldete Person. IHRE id ist die einzige, die zaehlt.
const ICH = 7;
function require_session(): array { return ['id' => ICH, 'name' => 'testkonto']; }
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool { return true; }
function hat_spalte(PDO $pdo, string $t, string $s): bool { return true; }
// Revierdienst-Zugang: im Betrieb aus der Personalakte (ENT-284), hier
// umschaltbar -- damit sich beide Faelle pruefen lassen.
$GLOBALS['revier'] = false;
function revierdienst_zugang(PDO $pdo, int $id): bool { return (bool)$GLOBALS['revier']; }

require __DIR__ . '/../backend/mitteilungen.php';

$pdo = null;
function db(): PDO { global $pdo; return $pdo; }

// Kein festes Datum nahe beim heutigen Tag (Projektregel): Der Endpunkt
// holt sein "jetzt" aus der Uhr, darum liegen die Grenzen weit auf beiden
// Seiten (2021 und 2099).
function aufbauen(): void {
    global $pdo;
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec("CREATE TABLE mitteilungen (id INTEGER PRIMARY KEY, titel TEXT, text TEXT,
      zielgruppe TEXT, stufe TEXT, art TEXT DEFAULT 'info', beginn TEXT, ende TEXT, ort TEXT,
      sichtbar_ab TEXT, sichtbar_bis TEXT, verfasser_id INTEGER, verfasser_name TEXT,
      erstellt_am TEXT, archiviert_am TEXT)");
    $pdo->exec("CREATE TABLE mitteilung_gelesen (mitteilung_id INTEGER, mitarbeiter_id INTEGER,
      gelesen_am TEXT, bestaetigt_am TEXT, antwort TEXT DEFAULT 'offen', antwort_am TEXT,
      PRIMARY KEY (mitteilung_id, mitarbeiter_id))");
    $pdo->exec("INSERT INTO mitteilungen (id, titel, zielgruppe, stufe, art, beginn, sichtbar_ab, sichtbar_bis, archiviert_am, erstellt_am) VALUES
      (1, 'Sitzung fuer alle', 'alle',   'normal', 'termin', '2099-01-05 17:00:00', NULL,                  NULL,                  NULL,                  '2021-01-01 08:00:00'),
      (2, 'Blosse Mitteilung', 'alle',   'normal', 'info',   NULL,                  NULL,                  NULL,                  NULL,                  '2021-01-01 08:00:00'),
      (3, 'Revier-Sitzung',    'revier', 'normal', 'termin', '2099-01-06 17:00:00', NULL,                  NULL,                  NULL,                  '2021-01-01 08:00:00'),
      (4, 'Zurueckgezogen',    'alle',   'normal', 'termin', '2099-01-07 17:00:00', NULL,                  NULL,                  '2021-02-01 08:00:00', '2021-01-01 08:00:00'),
      (5, 'Erst spaeter',      'alle',   'normal', 'termin', '2099-01-08 17:00:00', '2099-06-01 08:00:00', NULL,                  NULL,                  '2021-01-01 08:00:00'),
      (6, 'Schon vorbei',      'alle',   'normal', 'termin', '2021-01-09 17:00:00', NULL,                  '2021-01-09 18:00:00', NULL,                  '2021-01-01 08:00:00')");
}

$quelle = file_get_contents(__DIR__ . '/../backend/api/mitteilung_antwort.php');
$quelle = preg_replace('/^<\?php\s*/', '', $quelle, 1);
$quelle = preg_replace('/^declare\(strict_types=1\);\s*$/m', '', $quelle);
$quelle = preg_replace('/^require(_once)? __DIR__ \. .*$/m', '', $quelle);
$quelle = str_replace("file_get_contents('php://input')", '$GLOBALS["KOERPER"]', $quelle);
pruef('Der Endpunkt liest den Rumpf ueberhaupt (Testvorrichtung greift)',
    strpos($quelle, '$GLOBALS["KOERPER"]') !== false);

function ausfuehren(array $koerper, string $methode = 'POST'): array {
    global $quelle;
    aufbauen();
    $GLOBALS['KOERPER'] = json_encode($koerper);
    $_SERVER['REQUEST_METHOD'] = $methode;
    try { eval($quelle); } catch (Antwort $a) { return ['daten' => $a->daten, 'status' => $a->status]; }
    return ['daten' => ['status' => 'keine Antwort'], 'status' => 0];
}
$zeilen = function (): array {
    global $pdo;
    return $pdo->query('SELECT * FROM mitteilung_gelesen')->fetchAll();
};

// ══════════════ DER NORMALFALL
$a = ausfuehren(['id' => 1, 'antwort' => 'zugesagt']);
$z = $zeilen();
pruef('Eine Zusage wird angenommen', ($a['daten']['status'] ?? '') === 'ok');
pruef('KRITISCH: sie steht bei der angemeldeten Person und beim richtigen Termin',
    count($z) === 1 && (int)$z[0]['mitarbeiter_id'] === ICH && (int)$z[0]['mitteilung_id'] === 1
    && $z[0]['antwort'] === 'zugesagt');
pruef('Eine Absage wird ebenso angenommen',
    (ausfuehren(['id' => 1, 'antwort' => 'abgesagt'])['daten']['status'] ?? '') === 'ok');

// ══════════════ DIE PERSON KOMMT AUS DER SITZUNG
$b = ausfuehren(['id' => 1, 'antwort' => 'zugesagt', 'mitarbeiter_id' => 99]);
$z = $zeilen();
pruef('KRITISCH: eine mitgeschickte fremde Person wird nicht beachtet -- '
    . 'sonst sagt einer fuer den anderen ab',
    count($z) === 1 && (int)$z[0]['mitarbeiter_id'] === ICH);

// ══════════════ WAS ABGEWIESEN WIRD
$c = ausfuehren(['id' => 1, 'antwort' => 'offen']);
pruef('KRITISCH: "offen" wird abgewiesen -- eine abgegebene Antwort laesst sich '
    . 'nicht still zuruecknehmen',
    $c['status'] === 400 && $zeilen() === []);
$d = ausfuehren(['id' => 1, 'antwort' => 'vielleicht']);
pruef('Eine erfundene Antwort wird abgewiesen', $d['status'] === 400 && $zeilen() === []);
$e = ausfuehren(['id' => 1]);
pruef('Ohne Antwort wird nichts vermerkt', $e['status'] === 400 && $zeilen() === []);

$f = ausfuehren(['id' => 2, 'antwort' => 'zugesagt']);
pruef('KRITISCH: auf eine blosse Mitteilung laesst sich nicht zusagen',
    $f['status'] === 400 && $zeilen() === []);
pruef('Und die Abweisung sagt auch, warum',
    stripos($f['daten']['message'] ?? '', 'termin') !== false);

$GLOBALS['revier'] = false;
$g = ausfuehren(['id' => 3, 'antwort' => 'zugesagt']);
pruef('KRITISCH: ohne Revierdienst laesst sich auf einen Revier-Termin nicht antworten',
    $g['status'] === 404 && $zeilen() === []);
$GLOBALS['revier'] = true;
$h = ausfuehren(['id' => 3, 'antwort' => 'zugesagt']);
pruef('Mit Revierdienst schon', ($h['daten']['status'] ?? '') === 'ok');
$GLOBALS['revier'] = false;

$i = ausfuehren(['id' => 4, 'antwort' => 'zugesagt']);
pruef('KRITISCH: auf einen zurueckgezogenen Termin laesst sich nicht mehr antworten',
    $i['status'] === 404 && $zeilen() === []);
$j = ausfuehren(['id' => 5, 'antwort' => 'zugesagt']);
pruef('KRITISCH: auf einen noch nicht sichtbaren Termin auch nicht -- '
    . 'sonst liesse sich Vorbereitetes erraten',
    $j['status'] === 404 && $zeilen() === []);
$k = ausfuehren(['id' => 6, 'antwort' => 'zugesagt']);
pruef('KRITISCH: auf einen vergangenen Termin laesst sich nicht mehr antworten',
    $k['status'] === 404 && $zeilen() === []);
$l = ausfuehren(['id' => 999, 'antwort' => 'zugesagt']);
pruef('Eine unbekannte Nummer antwortet mit 404', $l['status'] === 404);
pruef('KRITISCH: "gibt es nicht" und "ist kein Termin" sagen nicht dasselbe',
    ($l['daten']['message'] ?? '') !== ($f['daten']['message'] ?? ''));

$m = ausfuehren(['id' => 1, 'antwort' => 'zugesagt'], 'GET');
pruef('KRITISCH: per GET laesst sich nichts vermerken',
    $m['status'] === 405 && $zeilen() === []);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
