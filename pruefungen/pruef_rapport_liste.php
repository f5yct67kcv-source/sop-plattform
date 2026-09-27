<?php
declare(strict_types=1);
// Die Rapportliste ohne Unterschriftsbilder, wirklich ausgefuehrt:
// rapport_list.php gegen eine SQLite-Datenbank.
//
// WORUM ES GEHT: Die Liste laedt bei jedem Start des Cockpits, ohne
// Zeitraum. Ging das Unterschriftsbild mit (10-30 KB je Rapport), wurde
// jeder Start mit jedem Rapport langsamer. Das Bild kommt jetzt einzeln
// ueber ?id=. Drei Aussagen muessen dabei halten:
//
//   1. Die Liste traegt KEIN Bild, sagt aber, OB eine Unterschrift da ist
//      -- sonst stuende im Cockpit "keine erfasst" bei einem unterschriebenen
//      Rapport.
//   2. ?id= liefert das Bild.
//   3. ?id= haelt dieselbe Grenze wie die Liste: Wer nicht alle Rapporte
//      sieht, bekommt keinen fremden, auch nicht ueber die Nummer.
$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

class Antwort extends RuntimeException {
    public array $daten; public int $status;
    public function __construct(array $d, int $s) { $this->daten = $d; $this->status = $s; parent::__construct('fertig'); }
}
function json_response($data, int $status = 200): void { throw new Antwort((array)$data, $status); }
$GLOBALS['ich'] = ['id' => 1, 'name' => 'a.aaa'];
$GLOBALS['alle'] = false;
function require_session(): array { return $GLOBALS['ich']; }
function darf(array $user, string $recht): bool { return $recht === 'abgleich_lesen' && $GLOBALS['alle']; }

$pdo = null;
function db(): PDO { global $pdo; return $pdo; }

const BILD = 'data:image/png;base64,QUJDRA==';

function aufbauen(): void {
    global $pdo;
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT)');
    $pdo->exec("INSERT INTO mitarbeiter VALUES (1, 'a.aaa'), (2, 'b.bbb')");
    $pdo->exec('CREATE TABLE kunden (id INTEGER PRIMARY KEY, kundennummer TEXT, name TEXT, strasse TEXT,
      hausnummer TEXT, adresszusatz TEXT, plz TEXT, ort TEXT, re_name TEXT, re_zusatz TEXT,
      re_strasse TEXT, re_hausnummer TEXT, re_plz TEXT, re_ort TEXT)');
    $pdo->exec('CREATE TABLE einsaetze (id INTEGER PRIMARY KEY, kunde_id INTEGER)');
    $pdo->exec('CREATE TABLE rapporte (id INTEGER PRIMARY KEY, datum TEXT, mitarbeiter_id INTEGER,
      einsatz_id INTEGER, kunde TEXT, strasse TEXT, ort TEXT, auftrag_nr TEXT, einsatzart TEXT,
      von TEXT, bis TEXT, pause_min INTEGER, netto_h REAL, unterzeichner TEXT, unterschrift TEXT,
      bemerkung TEXT, erfasst_am TEXT)');
    // 1: eigener, unterschrieben. 2: eigener, ohne. 3: eigener, leerer Text
    // (zaehlt als ohne). 4: fremder, unterschrieben.
    $st = $pdo->prepare("INSERT INTO rapporte (id, datum, mitarbeiter_id, kunde, unterschrift)
      VALUES (?, '2021-03-01', ?, 'Kunde X', ?)");
    foreach ([[1, 1, BILD], [2, 1, null], [3, 1, ''], [4, 2, BILD]] as $z) { $st->execute($z); }
}

$quelle = file_get_contents(__DIR__ . '/../backend/api/rapport_list.php');
$quelle = preg_replace('/^<\?php\s*/', '', $quelle, 1);
$quelle = preg_replace('/^declare\(strict_types=1\);\s*$/m', '', $quelle);
$quelle = preg_replace('/^require(_once)? __DIR__ \. .*$/m', '', $quelle);

function ausfuehren(array $get = []): Antwort {
    global $quelle;
    aufbauen();
    $_GET = $get;
    $_SERVER['REQUEST_METHOD'] = 'GET';
    try { eval($quelle); } catch (Antwort $a) { return $a; }
    return new Antwort(['status' => 'keine Antwort'], 0);
}
function nachId(array $zeilen): array { $r = []; foreach ($zeilen as $z) { $r[(int)$z['id']] = $z; } return $r; }

foreach ([false => 'nur eigene', true => 'alle'] as $alle => $wer) {
    $GLOBALS['alle'] = (bool)$alle;
    $liste = ausfuehren()->daten;
    $r = nachId($liste['rapporte'] ?? []);
    pruef("[$wer] die Liste antwortet", ($liste['status'] ?? '') === 'ok' && isset($r[1], $r[2], $r[3]));
    $bilder = array_filter($r, fn($z) => array_key_exists('unterschrift', $z));
    pruef("KRITISCH [$wer]: kein Rapport der Liste traegt das Unterschriftsbild", count($bilder) === 0);
    pruef("KRITISCH [$wer]: die Liste sagt, dass Rapport 1 unterschrieben ist",
        (int)($r[1]['hat_unterschrift'] ?? 0) === 1);
    pruef("KRITISCH [$wer]: ohne Unterschrift (NULL und leer) steht 0, nicht 1",
        array_key_exists('hat_unterschrift', $r[2]) && (int)$r[2]['hat_unterschrift'] === 0
        && (int)$r[3]['hat_unterschrift'] === 0);

    $eins = ausfuehren(['id' => '1']);
    pruef("KRITISCH [$wer]: ?id= liefert das Bild des eigenen Rapports",
        $eins->status === 200 && ($eins->daten['rapport']['unterschrift'] ?? null) === BILD);
}

$GLOBALS['alle'] = false;
$fremd = ausfuehren(['id' => '4']);
pruef('KRITISCH: wer nur eigene sieht, bekommt einen fremden Rapport auch ueber ?id= nicht',
    $fremd->status === 404 && !isset($fremd->daten['rapport']));
$liste = nachId(ausfuehren()->daten['rapporte'] ?? []);
pruef('Die Liste mit nur eigenen enthaelt den fremden Rapport nicht', !isset($liste[4]));
pruef('KRITISCH: wer nur eigene sieht, bekommt keine Kundenstammdaten -- weder in der Liste noch ueber ?id=',
    !array_key_exists('k_name', $liste[1]) && !array_key_exists('re_ort', $liste[1])
    && !array_key_exists('k_name', ausfuehren(['id' => '1'])->daten['rapport']));
$GLOBALS['alle'] = true;
$liste = nachId(ausfuehren()->daten['rapporte'] ?? []);
pruef('Wer alle sieht, bekommt die Kundenstammdaten in Liste und ?id=',
    array_key_exists('k_name', $liste[1]) && array_key_exists('k_name', ausfuehren(['id' => '1'])->daten['rapport']));
$GLOBALS['alle'] = false;

$GLOBALS['alle'] = true;
$fremd = ausfuehren(['id' => '4']);
pruef('Wer alle sieht, bekommt auch das Bild eines fremden Rapports',
    $fremd->status === 200 && ($fremd->daten['rapport']['unterschrift'] ?? null) === BILD);
pruef('Ein nicht vorhandener Rapport antwortet 404', ausfuehren(['id' => '99'])->status === 404);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
