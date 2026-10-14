<?php
declare(strict_types=1);
// Lohnseite auf einer Seite (ENT-721, Schritt 2) -- echt ausgefuehrt.
//
//  1. Der Mutationsgrund ist Pflicht, sobald die Person einen frueheren
//     Ansatz hat. Der erste Ansatz (Eintritt) braucht keinen.
//  2. Der Nebenanstellungsort ist ein ANDERER Ort als der Standort, und es
//     gibt ihn nur zusammen mit einem Standort (Art. 18 Ziff. 2) --
//     auch dann, wenn nur eines der beiden Felder geschickt wird.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }
function json_response($data, int $status = 200): void {}

require_once __DIR__ . '/../backend/lohn.php';
require_once __DIR__ . '/../backend/mitarbeiter.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE lohn_ansatz (id INTEGER PRIMARY KEY, mitarbeiter_id INT, gueltig_ab TEXT)');

// Datumsfest: relativ zum heutigen Jahr, nicht fest.
$j = (int)date('Y');
$alt = ($j - 3) . '-03-01';
$neu = ($j - 1) . '-03-01';

pruef('Der erste Ansatz braucht keinen Mutationsgrund',
    lohn_mutationsgrund_fehler($pdo, 1, $alt, '') === null);
$pdo->exec("INSERT INTO lohn_ansatz (mitarbeiter_id, gueltig_ab) VALUES (1, '$alt')");
pruef('KRITISCH: ein späterer Ansatz ohne Grund wird abgewiesen',
    lohn_mutationsgrund_fehler($pdo, 1, $neu, '') !== null);
pruef('Mit Grund geht er durch',
    lohn_mutationsgrund_fehler($pdo, 1, $neu, 'Neues Dienstjahr') === null);
pruef('Die Korrektur des ersten Ansatzes braucht weiterhin keinen',
    lohn_mutationsgrund_fehler($pdo, 1, $alt, '') === null);
pruef('Ein Ansatz VOR dem bisher ersten ist der neue erste und braucht keinen',
    lohn_mutationsgrund_fehler($pdo, 1, ($j - 5) . '-01-01', '') === null);
pruef('Die Ansätze einer anderen Person zählen nicht mit',
    lohn_mutationsgrund_fehler($pdo, 2, $neu, '') === null);
pruef('Mehr als 200 Zeichen werden abgewiesen',
    lohn_mutationsgrund_fehler($pdo, 1, $neu, str_repeat('x', 201)) !== null);

// ── Nebenanstellungsort ──────────────────────────────────────────────────
$fehler = fn(array $in, array $bestand = []) => implode(' | ', ma_eingabe_lesen($in, $bestand)['fehler'] ?? []);
pruef('Standort und ein anderer Nebenanstellungsort gehen durch',
    !str_contains($fehler(['anstellungsort_id' => '1', 'nebenanstellungsort_id' => '2']), 'Nebenanstellungsort'));
pruef('KRITISCH: derselbe Ort als Neben- und Hauptanstellungsort wird abgewiesen',
    str_contains($fehler(['anstellungsort_id' => '1', 'nebenanstellungsort_id' => '1']), 'Nebenanstellungsort'));
pruef('KRITISCH: ein Nebenanstellungsort ohne Standort wird abgewiesen',
    str_contains($fehler(['anstellungsort_id' => '', 'nebenanstellungsort_id' => '2']), 'Nebenanstellungsort'));
pruef('Auch wenn nur der Nebenort kommt, zählt der gespeicherte Standort',
    str_contains($fehler(['nebenanstellungsort_id' => '1'], ['anstellungsort_id' => 1]), 'Nebenanstellungsort')
    && !str_contains($fehler(['nebenanstellungsort_id' => '2'], ['anstellungsort_id' => 1]), 'Nebenanstellungsort'));
pruef('Kein Nebenort ist kein Fehler',
    !str_contains($fehler(['anstellungsort_id' => '1', 'nebenanstellungsort_id' => '']), 'Nebenanstellungsort'));

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
