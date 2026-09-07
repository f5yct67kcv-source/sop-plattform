<?php
declare(strict_types=1);
// Was die Verwaltung ueber einen Termin erfaehrt (ENT-436), wirklich
// ausgefuehrt: mitteilung_list.php gegen eine SQLite-Datenbank.
//
// WORUM ES GEHT: Zwei Aussagen dieser Seite entstehen erst im Endpunkt und
// sind im Browser nicht nachpruefbar, weil die Pruefung dort die
// Serverantwort vortaeuscht:
//
//   1. Die ANTWORTZAHLEN je Termin (zugesagt/abgesagt).
//   2. Die NAMENSLISTE eines Termins zaehlt ALLE Empfaenger auf -- auch
//      die, die die App nie geoeffnet haben. Faellt das weg, bleibt die
//      eigentliche Frage unbeantwortet ("wen muss ich noch fragen?"), und
//      niemand sieht es: Die Liste sieht vollstaendig aus.
$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

class Antwort extends RuntimeException {
    public array $daten; public int $status;
    public function __construct(array $d, int $s) { $this->daten = $d; $this->status = $s; parent::__construct('fertig'); }
}
function json_response($data, int $status = 200): void { throw new Antwort((array)$data, $status); }
function require_session(): array { return ['id' => 1, 'name' => 'chefin']; }
function require_recht(array $user, string $recht): void {}
// push_abo gibt es hier nicht -- die Benachrichtigungen sind Gegenstand von
// pruef_push.php. Alle anderen Tabellen sind da.
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool { return $t !== 'push_abo'; }
// Die Revier-Spalte ist da oder nicht -- der zweite Fall macht den
// Empfaengerkreis unbekannt, und die Antwort muss das sagen.
$GLOBALS['spalteDa'] = true;
function hat_spalte(PDO $pdo, string $t, string $s): bool { return $GLOBALS['spalteDa']; }
// Kein Push in dieser Pruefung: Der Nachzuegler-Versand ist Gegenstand von
// pruef_push.php, nicht von hier.
function push_konfiguriert(): bool { return false; }
function push_grund(): string { return 'kein_schluessel'; }
function push_empfaenger(PDO $pdo, string $z): array { return []; }

require __DIR__ . '/../backend/mitteilungen.php';

$pdo = null;
function db(): PDO { global $pdo; return $pdo; }

function aufbauen(): void {
    global $pdo;
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec("CREATE TABLE mitteilungen (id INTEGER PRIMARY KEY, titel TEXT, text TEXT,
      zielgruppe TEXT, stufe TEXT, art TEXT DEFAULT 'info', beginn TEXT, ende TEXT, ort TEXT,
      sichtbar_ab TEXT, sichtbar_bis TEXT, verfasser_id INTEGER, verfasser_name TEXT,
      erstellt_am TEXT, archiviert_am TEXT, push_gesendet_am TEXT, push_bilanz TEXT)");
    $pdo->exec("CREATE TABLE mitteilung_gelesen (mitteilung_id INTEGER, mitarbeiter_id INTEGER,
      gelesen_am TEXT, bestaetigt_am TEXT, antwort TEXT DEFAULT 'offen', antwort_am TEXT,
      PRIMARY KEY (mitteilung_id, mitarbeiter_id))");
    $pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, vorname TEXT, nachname TEXT,
      name TEXT, aktiv INTEGER, revierdienst_berechtigt INTEGER)');
    // Vier aktive Konten, eines davon ausgeschieden -- es zaehlt nirgends mit.
    $pdo->exec("INSERT INTO mitarbeiter VALUES
      (1, 'Anna', 'Aaa', 'a.aaa', 1, 1), (2, 'Bea', 'Bbb', 'b.bbb', 1, 0),
      (3, 'Cem', 'Ccc', 'c.ccc', 1, 1), (4, 'Dan', 'Ddd', 'd.ddd', 0, 1)");
    $pdo->exec("INSERT INTO mitteilungen (id, titel, zielgruppe, stufe, art, beginn, ende, ort, erstellt_am) VALUES
      (1, 'Sitzung', 'alle', 'normal', 'termin', '2099-01-05 17:00:00', '2099-01-05 19:00:00', 'Aufenthaltsraum', '2021-01-01 08:00:00'),
      (2, 'Blosse Info', 'alle', 'normal', 'info', NULL, NULL, NULL, '2021-01-01 08:00:00'),
      (3, 'Revier-Sitzung', 'revier', 'normal', 'termin', '2099-01-06 17:00:00', NULL, NULL, '2021-01-01 08:00:00')");
    // Anna sagt zu, Bea sagt ab, Cem hat nur geoeffnet, niemand sonst.
    $pdo->exec("INSERT INTO mitteilung_gelesen VALUES
      (1, 1, '2021-01-02 08:00:00', NULL, 'zugesagt', '2021-01-02 08:01:00'),
      (1, 2, '2021-01-02 09:00:00', NULL, 'abgesagt', '2021-01-02 09:01:00'),
      (2, 1, '2021-01-02 08:00:00', NULL, 'offen', NULL)");
}

$quelle = file_get_contents(__DIR__ . '/../backend/api/mitteilung_list.php');
$quelle = preg_replace('/^<\?php\s*/', '', $quelle, 1);
$quelle = preg_replace('/^declare\(strict_types=1\);\s*$/m', '', $quelle);
$quelle = preg_replace('/^require(_once)? __DIR__ \. .*$/m', '', $quelle);

function ausfuehren(array $get = []): array {
    global $quelle;
    aufbauen();
    $_GET = $get;
    $_SERVER['REQUEST_METHOD'] = 'GET';
    try { eval($quelle); } catch (Antwort $a) { return $a->daten; }
    return ['status' => 'keine Antwort'];
}

// ══════════════ DIE LISTE
$liste = ausfuehren();
$finde = function (array $a, int $id) { foreach ($a['mitteilungen'] as $m) { if ((int)$m['id'] === $id) { return $m; } } return []; };
$t = $finde($liste, 1);
$i = $finde($liste, 2);
pruef('Der Termin ist als Termin gekennzeichnet', ($t['ist_termin'] ?? false) === true);
pruef('Eine blosse Mitteilung nicht', ($i['ist_termin'] ?? true) === false);
pruef('Beginn, Ende und Ort kommen mit',
    $t['beginn'] === '2099-01-05 17:00:00' && $t['ende'] === '2099-01-05 19:00:00'
    && $t['ort'] === 'Aufenthaltsraum');
pruef('KRITISCH: die Zusagen werden gezaehlt', (int)$t['zugesagt_anzahl'] === 1);
pruef('KRITISCH: die Absagen getrennt davon', (int)$t['abgesagt_anzahl'] === 1);
pruef('KRITISCH: wer nur geoeffnet hat, zaehlt bei KEINEM von beiden',
    (int)$t['gelesen_anzahl'] === 2 && (int)$t['zugesagt_anzahl'] + (int)$t['abgesagt_anzahl'] === 2);
pruef('Der Nenner zaehlt nur aktive Konten', (int)$t['empfaenger_anzahl'] === 3);
pruef('KRITISCH: an einer blossen Mitteilung stehen keine Antworten',
    (int)$i['zugesagt_anzahl'] === 0 && (int)$i['abgesagt_anzahl'] === 0);

// ══════════════ DIE NAMENSLISTE EINES TERMINS
$d = ausfuehren(['id' => '1']);
$namen = array_map(fn($z) => $z['vorname'], $d['leser']);
pruef('Der Detailzweig sagt, dass es ein Termin ist', ($d['ist_termin'] ?? false) === true);
pruef('KRITISCH: ALLE Empfaenger stehen darin, auch wer nie geoeffnet hat',
    count($d['leser']) === 3 && in_array('Cem', $namen, true));
pruef('KRITISCH: ein ausgeschiedenes Konto steht NICHT darin',
    !in_array('Dan', $namen, true));
$cem = null; foreach ($d['leser'] as $z) { if ($z['vorname'] === 'Cem') { $cem = $z; } }
pruef('KRITISCH: wer nie geoeffnet hat, hat keinen Lesezeitpunkt -- und keine erfundene Antwort',
    $cem !== null && $cem['gelesen_am'] === null
    && ($cem['antwort'] === null || $cem['antwort'] === 'offen'));
$anna = null; foreach ($d['leser'] as $z) { if ($z['vorname'] === 'Anna') { $anna = $z; } }
pruef('Die Zusage steht mit Zeitpunkt an der Person',
    $anna !== null && $anna['antwort'] === 'zugesagt' && $anna['antwort_am'] === '2021-01-02 08:01:00');
pruef('Die Liste gilt als vollzaehlig', ($d['vollzaehlig'] ?? false) === true);

// Bei einer blossen Mitteilung bleibt es bei den Lesern -- eine Liste
// aller Nichtleser waere eine Anwesenheitskontrolle, die niemand bestellt hat.
$d2 = ausfuehren(['id' => '2']);
pruef('KRITISCH: bei einer Mitteilung stehen nur die Leser da, nicht alle',
    count($d2['leser']) === 1 && ($d2['ist_termin'] ?? true) === false);

// Ohne die Revier-Spalte ist der Empfaengerkreis unbekannt -- die Antwort
// sagt es, statt Vollstaendigkeit vorzutaeuschen.
$GLOBALS['spalteDa'] = false;
$d3 = ausfuehren(['id' => '3']);
pruef('KRITISCH: steht der Empfaengerkreis nicht fest, wird die Liste als unvollzaehlig ausgewiesen',
    ($d3['vollzaehlig'] ?? true) === false);
$GLOBALS['spalteDa'] = true;

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
