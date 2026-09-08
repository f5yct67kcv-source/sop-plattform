<?php
declare(strict_types=1);
// mein_profil_speichern.php WIRKLICH ausfuehren (ENT-460), gegen eine
// SQLite-Datenbank im Arbeitsspeicher -- gleiches Muster wie
// pruef_produkt_speichern.php und pruef_mitarbeiter_personalnummer.php.
//
// WARUM AUSGEFUEHRT UND NICHT NACHGELESEN: Dieser Endpunkt schreibt in die
// Personalakte und verlangt dafuer kein Recht, sondern nur eine Sitzung.
// Ob er wirklich nur am EIGENEN Datensatz schreibt, ob wirklich nur die
// weisse Liste durchkommt und ob bei einer neuen privaten E-Mail wirklich
// nichts gespeichert wird, solange das Passwort fehlt -- das sind Aussagen
// ueber eine Datenbank nach dem Aufruf, nicht ueber den Wortlaut einer
// Zeile. Eine Quelltextsuche bliebe gruen, wenn jemand die Bedingung
// umdreht und die Formulierung stehen laesst.
//
// Aufruf:  php pruef_mein_profil_speichern.php <lage>  < koerper.json
// Gibt die tatsaechliche Antwort aus, angereichert um den Zustand der
// Datenbank NACH dem Aufruf.

$lage = $argv[1] ?? 'normal';

$pdo = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$pdo->exec('CREATE TABLE mitarbeiter (
    id INTEGER PRIMARY KEY, name TEXT, password_hash TEXT,
    personalnummer TEXT, geburtsdatum TEXT, ahv_nr TEXT, zivilstand TEXT,
    strasse TEXT, hausnummer TEXT, adresszusatz TEXT, plz TEXT, ort TEXT, land TEXT,
    telefon TEXT, telefon_geschaeft TEXT, mobil TEXT, mobil_geschaeft TEXT,
    email TEXT, email_privat TEXT, notfallkontakt TEXT,
    ist_admin INTEGER DEFAULT 0, aktiv INTEGER DEFAULT 1,
    revierdienst_berechtigt INTEGER DEFAULT 0, erstellt_am TEXT)');
$pdo->exec('CREATE TABLE aenderungslog (id INTEGER PRIMARY KEY, zeitpunkt TEXT,
    akteur_id INT, akteur_name TEXT, bereich TEXT, objekt_id INT, feld TEXT,
    wert_alt TEXT, wert_neu TEXT, werte_verborgen INT)');

// Kein festes Datum nahe beim heutigen Tag (test_datumsfest) -- die
// Anlegedaten liegen bewusst weit zurueck und werden nie verglichen.
const PW_ECHT = 'richtig-langes-testpasswort';
// Fest eingetragen statt bei jedem Lauf erzeugt: password_hash() waehlt ein
// zufaelliges Salz, zwei Laeufe unterscheiden sich also zwangslaeufig. Damit
// liesse sich nicht mehr pruefen, ob am fremden Datensatz WIRKLICH nichts
// angeruehrt wurde -- der Vergleich zweier Laeufe scheiterte immer am Hash.
// Erfundenes Testpasswort, kein Zugang zu irgendetwas.
$hash = '$2y$04$kv7/UP97CyQLhIGsM8/tw.wzWMXAq48lAMBVGpL4Iat/ymujXJJJS';
// 'land' ist seit ENT-466 Pflicht und darum hier gesetzt -- ein
// unvollstaendiges Testkonto liesse jede gewoehnliche Speicherung
// scheitern und verdeckte damit, was eigentlich geprueft werden soll.
$einf = $pdo->prepare('INSERT INTO mitarbeiter (id, name, password_hash, personalnummer,
    geburtsdatum, ahv_nr, zivilstand, strasse, hausnummer, plz, ort, land, telefon, mobil,
    email, email_privat, notfallkontakt, ist_admin, aktiv, erstellt_am)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)');
// Erfundene Angaben, keine echten Personen (CLAUDE.md, Vertraulichkeit).
$einf->execute([1, 'muster.person', $hash, '1001', '1980-02-03', '756.0000.0000.00',
    'ledig', 'Musterweg', '1', '9999', 'Musterstadt', 'Musterland',
    '000 000 00 01', '000 000 00 02',
    'muster.person@beispiel.invalid', 'privat@beispiel.invalid', 'Muster Notfall',
    0, '2025-01-01 00:00:00']);
$einf->execute([2, 'zweite.person', $hash, '1002', '1975-04-05', '756.1111.1111.11',
    'ledig', 'Andersweg', '9', '1111', 'Andersstadt', 'Anderland',
    '000 000 00 03', '000 000 00 04',
    'zweite.person@beispiel.invalid', 'zweite@beispiel.invalid', 'Anderer Notfall',
    0, '2025-01-01 00:00:00']);

function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    $r = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name=" . $pdo->quote($t));
    return (bool)$r->fetch();
}
function db(): PDO { global $pdo; return $pdo; }

// Wer angemeldet ist, entscheidet die Sitzung -- hier fest Person 1. Genau
// das ist der Punkt: Der Endpunkt darf ausser dieser Person niemanden
// erreichen, egal was im Anfragerumpf steht.
function require_session(): array { return ['id' => 1, 'name' => 'muster.person']; }
function require_recht(array $user, string $recht): void {}

// Die Antwort wird um den Zustand der Datenbank NACH dem Aufruf ergaenzt --
// sonst liesse sich von aussen nicht pruefen, was wirklich geschrieben wurde.
function json_response($data, int $status = 200): void {
    global $pdo;
    $lies = function (int $id) use ($pdo) {
        $s = $pdo->prepare('SELECT * FROM mitarbeiter WHERE id = ?');
        $s->execute([$id]); return $s->fetch();
    };
    $data['pruefung'] = [
        'http'    => $status,
        'ich'     => $lies(1),
        'andere'  => $lies(2),
        'logbuch' => $pdo->query('SELECT akteur_id, akteur_name, bereich, objekt_id,
                                         feld, wert_alt, wert_neu, werte_verborgen
                                  FROM aenderungslog ORDER BY id')->fetchAll(),
    ];
    http_response_code($status);
    echo json_encode($data);
    exit;
}

// mitarbeiter.php mit einer einzigen Ersetzung laden: SQLite kennt
// "SHOW COLUMNS" nicht (MySQL-eigen), pragma_table_info gibt dieselbe
// Auskunft. Der Spaltenname "Field" bleibt, damit die geprueft Zeile
// unveraendert laeuft. Reine Testvorrichtung, wie php://stdin anderswo.
$maQuelle = file_get_contents(__DIR__ . '/../backend/mitarbeiter.php');
$maQuelle = preg_replace('/^<\?php\s*/', '', $maQuelle, 1);
$maQuelle = preg_replace('/^declare\(strict_types=1\);\s*$/m', '', $maQuelle);
// In eval'tem Quelltext zeigt __DIR__ auf das Verzeichnis der aufrufenden
// Datei -- also auf pruefungen/ statt auf backend/. Die require-Zeilen in
// mitarbeiter.php (kunden.php und weitere) liefen damit ins Leere. Der
// Pfad wird darum fest eingesetzt, bevor der Quelltext ausgefuehrt wird.
$maQuelle = str_replace('__DIR__', var_export(realpath(__DIR__ . '/../backend'), true), $maQuelle);
// Ersetzt wird die ganze Zeichenkette SAMT ihrer Anfuehrungszeichen: Der
// Ersatz enthaelt selbst einfache Anfuehrungszeichen und braucht darum
// doppelte aussen -- ein Austausch nur des Inhalts zerbraeche die Zeile.
$maQuelle = str_replace("'SHOW COLUMNS FROM mitarbeiter'",
    '"SELECT name AS Field FROM pragma_table_info(\'mitarbeiter\')"', $maQuelle);
eval($maQuelle);

require_once __DIR__ . '/../backend/logbuch.php';   // wird ueber planung.php schon geladen

$quelle = file_get_contents(__DIR__ . '/../backend/api/mein_profil_speichern.php');
$quelle = preg_replace('/^<\?php\s*/', '', $quelle, 1);
$quelle = preg_replace('/^declare\(strict_types=1\);\s*$/m', '', $quelle);
$quelle = preg_replace('/^require(_once)? __DIR__ \. .*$/m', '', $quelle);
// php://input bleibt im CLI leer -- php://stdin ist das Gegenstueck.
$quelle = str_replace('php://input', 'php://stdin', $quelle);

$_SERVER['REQUEST_METHOD'] = ($lage === 'get') ? 'GET' : 'POST';
eval($quelle);
