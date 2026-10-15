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
// Aufruf:  php pruef_meine_einstellungen.php <methode> <lage>  < koerper.json
//   methode: GET | POST
//   lage:    leer        -- Spalte da, fuer niemanden etwas gespeichert
//            vorbelegt   -- Spalte da, beide Konten haben schon Werte
//            ohne_spalte -- die Einrichtung ist noch nicht gelaufen

$methode = $argv[1] ?? 'GET';
$lage    = $argv[2] ?? 'leer';

$pdo = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT'
    . ($lage === 'ohne_spalte' ? '' : ', einstellungen TEXT NULL') . ')');
// Erfundene Konten, keine echten Personen (CLAUDE.md, Vertraulichkeit).
$pdo->exec("INSERT INTO mitarbeiter (id, name) VALUES (1, 'muster.person'), (2, 'zweite.person')");
if ($lage === 'vorbelegt') {
    $pdo->exec("UPDATE mitarbeiter SET einstellungen = '{\"thema\":\"dunkel\",\"glas\":\"aus\"}' WHERE id = 1");
    $pdo->exec("UPDATE mitarbeiter SET einstellungen = '{\"thema\":\"hell\",\"glas\":\"an\"}' WHERE id = 2");
}

function db(): PDO { global $pdo; return $pdo; }
function hat_spalte(PDO $pdo, string $tabelle, string $spalte): bool {
    $s = $pdo->query('SELECT name FROM pragma_table_info(' . $pdo->quote($tabelle) . ')');
    return in_array($spalte, array_column($s->fetchAll(), 'name'), true);
}
// Angemeldet ist fest Person 1. Der Endpunkt darf ausser ihr niemanden
// erreichen, egal was im Anfragerumpf steht.
function require_session(): array { return ['id' => 1, 'name' => 'muster.person']; }

function json_response($data, int $status = 200): void {
    global $pdo, $lage;
    $roh = function (int $id) use ($pdo, $lage) {
        if ($lage === 'ohne_spalte') { return 'keine Spalte'; }
        $s = $pdo->prepare('SELECT einstellungen FROM mitarbeiter WHERE id = ?');
        $s->execute([$id]);
        return $s->fetchColumn();
    };
    $data['pruefung'] = ['http' => $status, 'ich' => $roh(1), 'andere' => $roh(2)];
    echo json_encode($data);
    exit;
}

$quelle = file_get_contents(__DIR__ . '/../backend/api/meine_einstellungen.php');
$quelle = preg_replace('/^<\?php\s*/', '', $quelle, 1);
$quelle = preg_replace('/^declare\(strict_types=1\);\s*$/m', '', $quelle);
$quelle = preg_replace('/^require(_once)? __DIR__ \. .*$/m', '', $quelle);
$quelle = str_replace('php://input', 'php://stdin', $quelle);

$_SERVER['REQUEST_METHOD'] = $methode;
eval($quelle);
