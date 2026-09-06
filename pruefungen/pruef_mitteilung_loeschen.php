<?php
declare(strict_types=1);
// Die Loeschsperre WIRKLICH ausgefuehrt (ENT-433), gegen eine
// SQLite-Datenbank im Arbeitsspeicher.
//
// WORUM ES GEHT: Im Cockpit steht "Endgültig löschen" nur an einer
// Mitteilung im Archiv. Das ist Bequemlichkeit, keine Sperre -- ueber die
// Anfrage laesst sich jede id schicken. Waere die Pruefung nur im Browser,
// liesse sich eine laufende Mitteilung samt Lesestand loeschen, ohne dass
// irgendetwas rot wird. "Sperren gehoeren in den Server" (CLAUDE.md).
//
// Der Endpunkt wird NICHT abgeschrieben, sondern aus seiner Datei gelesen
// und ausgefuehrt -- eine abgeschriebene Kopie bliebe gruen, wenn im
// Endpunkt die Bedingung verschwindet.
$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// json_response beendet im Betrieb die Anfrage. Hier wirft es stattdessen
// -- so laeuft ein Fall nach dem anderen im selben Prozess, statt fuer
// jeden Fall php neu zu starten.
class Antwort extends RuntimeException {
    public array $daten; public int $status;
    public function __construct(array $d, int $s) { $this->daten = $d; $this->status = $s; parent::__construct('fertig'); }
}
function json_response($data, int $status = 200): void { throw new Antwort((array)$data, $status); }
function require_session(): array { return ['id' => 7, 'name' => 'test', 'ist_admin' => true]; }
// Die Rechtepruefung ist hier nicht Gegenstand (dafuer test_php.mjs, das
// jeden Endpunkt darauf absucht) -- hier zaehlt allein die Sperre selbst.
function require_recht(array $user, string $recht): void {}
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool { return true; }
function hat_spalte(PDO $pdo, string $t, string $s): bool { return true; }

require __DIR__ . '/../backend/mitteilungen.php';

$pdo = null;
function db(): PDO { global $pdo; return $pdo; }

// Kein festes Datum nahe beim heutigen Tag (Projektregel): Der Endpunkt
// holt sich sein "jetzt" selbst aus der Uhr -- anders als die reinen
// Funktionen, denen es mitgegeben wird. Die Grenzen der Testdaten liegen
// darum weit auf beiden Seiten (2021 und 2099); an keinem Datumswechsel
// kippt hier etwas.
function aufbauen(): void {
    global $pdo;
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('CREATE TABLE mitteilungen (id INTEGER PRIMARY KEY, titel TEXT, text TEXT,
      zielgruppe TEXT, stufe TEXT, sichtbar_ab TEXT, sichtbar_bis TEXT, verfasser_id INTEGER,
      verfasser_name TEXT, erstellt_am TEXT, archiviert_am TEXT, push_gesendet_am TEXT, push_bilanz TEXT)');
    $pdo->exec('CREATE TABLE mitteilung_gelesen (mitteilung_id INTEGER, mitarbeiter_id INTEGER,
      gelesen_am TEXT, bestaetigt_am TEXT, PRIMARY KEY (mitteilung_id, mitarbeiter_id))');
    $pdo->exec("INSERT INTO mitteilungen (id, titel, zielgruppe, stufe, sichtbar_ab, sichtbar_bis, archiviert_am, erstellt_am) VALUES
      (1, 'Laeuft gerade',   'alle', 'normal', NULL,                  NULL,                  NULL,                  '2021-01-01 08:00:00'),
      (2, 'Kommt erst noch', 'alle', 'normal', '2099-01-01 08:00:00', NULL,                  NULL,                  '2021-01-01 08:00:00'),
      (3, 'Abgelaufen',      'alle', 'normal', NULL,                  '2021-02-01 08:00:00', NULL,                  '2021-01-01 08:00:00'),
      (4, 'Zurueckgezogen',  'alle', 'normal', NULL,                  NULL,                  '2021-03-01 08:00:00', '2021-01-01 08:00:00')");
    $pdo->exec("INSERT INTO mitteilung_gelesen VALUES
      (1, 10, '2021-01-02 08:00:00', NULL), (1, 11, '2021-01-02 09:00:00', NULL),
      (3, 10, '2021-01-03 08:00:00', NULL), (3, 12, '2021-01-03 09:00:00', NULL),
      (4, 10, '2021-01-04 08:00:00', NULL)");
}

// Den Endpunkt aus seiner Datei holen und ausfuehren.
$quelle = file_get_contents(__DIR__ . '/../backend/api/mitteilung_loeschen.php');
$quelle = preg_replace('/^<\?php\s*/', '', $quelle, 1);
$quelle = preg_replace('/^declare\(strict_types=1\);\s*$/m', '', $quelle);
$quelle = preg_replace('/^require(_once)? __DIR__ \. .*$/m', '', $quelle);
// php://input liefert im CLI nichts. Der Rumpf kommt darum aus einer
// Variablen -- reine Testvorrichtung, die geprueften Zeilen bleiben, wie
// sie sind.
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
$daNoch = function (int $id): bool {
    global $pdo;
    $s = $pdo->prepare('SELECT 1 FROM mitteilungen WHERE id = ?'); $s->execute([$id]);
    return (bool)$s->fetchColumn();
};
$leserZahl = function (int $id): int {
    global $pdo;
    $s = $pdo->prepare('SELECT COUNT(*) FROM mitteilung_gelesen WHERE mitteilung_id = ?'); $s->execute([$id]);
    return (int)$s->fetchColumn();
};

// ══════════════ WAS IN DER APP STEHT, WIRD NICHT GELOESCHT
$a = ausfuehren(['id' => 1]);
pruef('KRITISCH: eine laufende Mitteilung wird nicht geloescht',
    $a['daten']['status'] === 'error' && $daNoch(1));
pruef('KRITISCH: und ihr Lesestand bleibt vollstaendig', $leserZahl(1) === 2);
pruef('Die Abweisung nennt den noetigen Handgriff, nicht nur den Mangel',
    stripos($a['daten']['message'] ?? '', 'zurückziehen') !== false);
pruef('Sie antwortet mit 400, nicht mit 200', $a['status'] === 400);

$b = ausfuehren(['id' => 2]);
pruef('KRITISCH: eine GEPLANTE wird nicht geloescht -- sie war noch gar nicht draussen',
    $b['daten']['status'] === 'error' && $daNoch(2));

// ══════════════ WAS IM ARCHIV STEHT, WIRD GELOESCHT
$c = ausfuehren(['id' => 3]);
pruef('KRITISCH: eine abgelaufene Mitteilung wird geloescht',
    ($c['daten']['status'] ?? '') === 'ok' && !$daNoch(3));
pruef('KRITISCH: ihr Lesestand geht mit -- keine Zeilen zu einer Mitteilung, die es nicht mehr gibt',
    $leserZahl(3) === 0);
pruef('KRITISCH: der Lesestand ANDERER Mitteilungen bleibt unberuehrt',
    $leserZahl(1) === 2 && $leserZahl(4) === 1);
pruef('Die anderen Mitteilungen bleiben stehen', $daNoch(1) && $daNoch(2) && $daNoch(4));
pruef('Die Antwort sagt, wie viele Lesestand-Zeilen mitgegangen sind',
    ($c['daten']['lesestand_entfernt'] ?? -1) === 2);

$d = ausfuehren(['id' => 4]);
pruef('KRITISCH: eine zurueckgezogene Mitteilung wird geloescht',
    ($d['daten']['status'] ?? '') === 'ok' && !$daNoch(4));

// ══════════════ DIE DREI NICHT-FAELLE, DREI VERSCHIEDENE ANTWORTEN
$e = ausfuehren(['id' => 999]);
$f = ausfuehren([]);
pruef('Eine unbekannte id antwortet mit 404', $e['status'] === 404);
pruef('Eine fehlende id antwortet mit 400', $f['status'] === 400);
pruef('KRITISCH: "gibt es nicht", "darf nicht" und "id fehlt" sagen drei verschiedene Saetze',
    count(array_unique([$a['daten']['message'], $e['daten']['message'], $f['daten']['message']])) === 3);
$g = ausfuehren(['id' => 4], 'GET');
pruef('KRITISCH: per GET laesst sich nichts loeschen', $g['status'] === 405 && $daNoch(4));

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
