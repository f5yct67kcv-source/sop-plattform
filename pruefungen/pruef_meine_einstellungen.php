<?php
declare(strict_types=1);
// meine_einstellungen.php WIRKLICH ausfuehren, gegen eine SQLite-Datenbank
// im Arbeitsspeicher -- gleiches Muster wie pruef_mein_profil_speichern.php.
//
// WARUM AUSGEFUEHRT: Der Endpunkt verlangt kein Recht, nur eine Sitzung.
// Ob er wirklich nur am EIGENEN Konto schreibt, ob wirklich nur die weisse
// Liste durchkommt und ob "nichts gespeichert" von "Spalte fehlt"
// unterscheidbar bleibt, sind Aussagen ueber die Datenbank nach dem Aufruf.
//
// Aufruf:  php pruef_meine_einstellungen.php <methode> <lage> [ziel]  < koerper.json
//   ziel:    cockpit (Vorgabe) -- meine_einstellungen.php, Tabelle mitarbeiter
//            betreiber         -- betreiber_einstellungen.php, Tabelle betreiber
//   methode: GET | POST
//   lage:    leer        -- Spalte da, fuer niemanden etwas gespeichert
//            vorbelegt   -- Spalte da, beide Konten haben schon Werte
//            ohne_spalte -- die Einrichtung ist noch nicht gelaufen

$methode = $argv[1] ?? 'GET';
$lage    = $argv[2] ?? 'leer';
$ziel    = $argv[3] ?? 'cockpit';
$tabelle = $ziel === 'betreiber' ? 'betreiber' : 'mitarbeiter';

$pdo = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$pdo->exec("CREATE TABLE $tabelle (id INTEGER PRIMARY KEY, name TEXT"
    . ($lage === 'ohne_spalte' ? '' : ', einstellungen TEXT NULL') . ')');
// Erfundene Konten, keine echten Personen (CLAUDE.md, Vertraulichkeit).
$pdo->exec("INSERT INTO $tabelle (id, name) VALUES (1, 'muster.person'), (2, 'zweite.person')");
if ($lage === 'vorbelegt') {
    $pdo->exec("UPDATE $tabelle SET einstellungen = '{\"thema\":\"dunkel\",\"glas\":\"aus\"}' WHERE id = 1");
    $pdo->exec("UPDATE $tabelle SET einstellungen = '{\"thema\":\"hell\",\"glas\":\"an\"}' WHERE id = 2");
}

function db(): PDO { global $pdo; return $pdo; }
function hat_spalte(PDO $pdo, string $tabelle, string $spalte): bool {
    $s = $pdo->query('SELECT name FROM pragma_table_info(' . $pdo->quote($tabelle) . ')');
    return in_array($spalte, array_column($s->fetchAll(), 'name'), true);
}
// Angemeldet ist fest Person 1. Der Endpunkt darf ausser ihr niemanden
// erreichen, egal was im Anfragerumpf steht.
function require_session(): array { return ['id' => 1, 'name' => 'muster.person']; }
function require_betreiber_voll(): array { return ['id' => 1, 'name' => 'muster.person']; }
function betreiber_db(): PDO { global $pdo; return $pdo; }

function json_response($data, int $status = 200): void {
    global $pdo, $lage, $tabelle;
    $roh = function (int $id) use ($pdo, $lage, $tabelle) {
        if ($lage === 'ohne_spalte') { return 'keine Spalte'; }
        $s = $pdo->prepare("SELECT einstellungen FROM $tabelle WHERE id = ?");
        $s->execute([$id]);
        return $s->fetchColumn();
    };
    $data['pruefung'] = ['http' => $status, 'ich' => $roh(1), 'andere' => $roh(2)];
    echo json_encode($data);
    exit;
}

$quelle = file_get_contents(__DIR__ . '/../backend/api/'
    . ($ziel === 'betreiber' ? 'betreiber_einstellungen.php' : 'meine_einstellungen.php'));
$quelle = preg_replace('/^<\?php\s*/', '', $quelle, 1);
$quelle = preg_replace('/^declare\(strict_types=1\);\s*$/m', '', $quelle);
$quelle = preg_replace('/^require(_once)? __DIR__ \. .*$/m', '', $quelle);
$quelle = str_replace('php://input', 'php://stdin', $quelle);

$_SERVER['REQUEST_METHOD'] = $methode;
eval($quelle);
