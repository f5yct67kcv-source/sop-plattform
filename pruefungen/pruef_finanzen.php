<?php
declare(strict_types=1);
// Echte Ausfuehrung der Finanz-Kostenseite gegen eine wirkliche Datenbank
// (SQLite im Arbeitsspeicher) -- ENT-712.
//
// Geprueft wird die AUSSAGE, nicht der Wortlaut:
//  - nur freigegebene und ausbezahlte Laeufe zaehlen, Entwurf und Storno nie
//  - ein Monat ohne zaehlenden Lauf fehlt, statt mit 0 dazustehen
//  - gesperrter Auslagenersatz wird gezaehlt, nicht als 0 mitsummiert
//  - offene Schichten nur bis heute, abgesagte nie
//  - ohne Recht KEIN Betrag, sondern {zugriff:false}

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }
function json_response($data, int $status = 200): void {}

require_once __DIR__ . '/../backend/lohnlauf.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE lohnlauf (id INTEGER PRIMARY KEY, periode_von TEXT, periode_bis TEXT, status TEXT,
            freigegeben_am TEXT, ausbezahlt_am TEXT)');
$pdo->exec('CREATE TABLE lohnlauf_person (id INTEGER PRIMARY KEY, lauf_id INT, mitarbeiter_id INT, brutto_rappen INT)');
$pdo->exec('CREATE TABLE einsaetze (id INTEGER PRIMARY KEY, datum TEXT, status TEXT)');
$pdo->exec('CREATE TABLE einsatz_zuteilung (einsatz_id INT, mitarbeiter_id INT, ist_status TEXT)');
$pdo->exec('CREATE TABLE einsatz_auslagen (einsatz_id INT, mitarbeiter_id INT, fahrzeitersatz_rappen INT,
            fahrkostenersatz_rappen INT, gesperrt_grund TEXT)');
$pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT, vorname TEXT, nachname TEXT)');

// Daten weit weg von heute (test_datumsfest.mjs): Januar bis Mai 2025.
$laeufe = [
    [1, '2025-01-01', '2025-01-31', 'ausbezahlt',  [100000, 50000]],
    [2, '2025-02-01', '2025-02-28', 'freigegeben', [80000]],
    [3, '2025-03-01', '2025-03-31', 'entwurf',     [99999]],   // zaehlt nicht
    [4, '2025-04-01', '2025-04-30', 'storniert',   [77777]],   // zaehlt nicht
    [5, '2025-04-01', '2025-04-30', 'ausbezahlt',  [60000]],   // der Ersatz
    [6, '2025-01-01', '2025-01-31', 'ausbezahlt',  [5000]],    // Nachtrag Januar
];
$pid = 1;
foreach ($laeufe as [$id, $von, $bis, $status, $betraege]) {
    $pdo->prepare('INSERT INTO lohnlauf VALUES (?,?,?,?,NULL,NULL)')->execute([$id, $von, $bis, $status]);
    foreach ($betraege as $b) {
        $pdo->prepare('INSERT INTO lohnlauf_person VALUES (?,?,?,?)')->execute([$pid++, $id, 1, $b]);
    }
}

$m = fin_lohn_monate($pdo, '2025-01-01', '2025-05-31');
pruef('Januar: zwei ausbezahlte Laeufe zusammengezaehlt (Nachtrag)', ($m['2025-01']['brutto_rappen'] ?? null) === 155000);
pruef('Januar: zwei Laeufe gezaehlt', ($m['2025-01']['laeufe'] ?? null) === 2);
pruef('Februar: freigegeben zaehlt', ($m['2025-02']['brutto_rappen'] ?? null) === 80000);
pruef('Maerz: nur ein Entwurf -> Monat FEHLT, steht nicht mit 0 da', !array_key_exists('2025-03', $m));
pruef('April: Storno zaehlt nicht, nur der Ersatzlauf', ($m['2025-04']['brutto_rappen'] ?? null) === 60000);
pruef('Mai: ohne Lauf fehlt der Monat', !array_key_exists('2025-05', $m));

$letzte = fin_letzte_laeufe($pdo, 3);
pruef('Letzte Laeufe: genau drei', count($letzte) === 3);
pruef('Letzte Laeufe: kein stornierter dabei', !in_array('storniert', array_column($letzte, 'status'), true));
pruef('Letzte Laeufe: neueste Periode zuerst', ($letzte[0]['periode_von'] ?? '') === '2025-04-01');

// Auslagen
$pdo->exec("INSERT INTO mitarbeiter VALUES (1,'','Beispiel','Person'),(2,'','Muster','Person')");
$pdo->exec("INSERT INTO einsaetze VALUES (10,'2025-01-05','geplant'),(11,'2025-01-20','geplant'),
            (12,'2025-02-03','geplant'),(13,'2025-02-10','abgesagt'),(14,'2025-02-11','geplant')");
$pdo->exec("INSERT INTO einsatz_auslagen VALUES (10,1,1200,800,NULL),(11,1,500,0,NULL),
            (11,2,NULL,NULL,'verkehrsmittel_unbekannt'),(12,2,300,200,NULL)");
$a = fin_auslagen_monate($pdo, '2025-01-01', '2025-02-28');
pruef('Auslagen Januar: nur Zeilen mit Betrag summiert', ($a['2025-01']['rappen'] ?? null) === 2500);
pruef('Auslagen Januar: gesperrte Zeile gezaehlt, nicht summiert', ($a['2025-01']['gesperrt'] ?? null) === 1);
pruef('Auslagen Februar', ($a['2025-02']['rappen'] ?? null) === 500);

$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (10,1,'anwesend'),(12,2,'offen'),(13,1,'offen'),(14,1,NULL)");
$o = fin_offene_schichten($pdo, '2025-01-01', '2025-02-28', '2025-12-31');
pruef('Offene Schichten: abgesagte zaehlt nicht, NULL zaehlt als offen', ($o['2025-02'] ?? null) === 2);
pruef('Offene Schichten: abgeglichene zaehlt nicht', !array_key_exists('2025-01', $o));
$o2 = fin_offene_schichten($pdo, '2025-01-01', '2025-02-28', '2025-02-05');
pruef('Offene Schichten: nur bis heute', ($o2['2025-02'] ?? null) === 1);

$p = fin_auslagen_personen($pdo, '2025-01', '2025-02');
$p1 = array_values(array_filter($p, fn($x) => $x['mitarbeiter_id'] === 1))[0] ?? null;
$p1m = $p1 ? (array)$p1['monate'] : [];
pruef('Person 1 Januar: Fahrzeit 1700', ($p1m['2025-01']['fahrzeit_rappen'] ?? null) === 1700);
pruef('Person 1 Januar: Fahrkosten 800', ($p1m['2025-01']['fahrkosten_rappen'] ?? null) === 800);
$p2 = array_values(array_filter($p, fn($x) => $x['mitarbeiter_id'] === 2))[0] ?? null;
$p2m = $p2 ? (array)$p2['monate'] : [];
pruef('Person 2 Januar: gesperrt gezaehlt, Betrag 0 nur weil nichts gerechnet', ($p2m['2025-01']['gesperrt'] ?? null) === 1
      && ($p2m['2025-01']['schichten'] ?? null) === 0);

// Rechte: jeder Block an seinem Recht
$tab = ['lohnlauf' => true, 'einsatz_auslagen' => true];
$nurRechnungen = ['rechte' => ['offerten_lesen']];
$k = fin_kosten($pdo, $nurRechnungen, '2025-01', '2025-05', $tab, '2025-12-31');
pruef('Ohne lohn_lesen: kein Lohnbetrag, zugriff=false', $k['lohn'] === ['zugriff' => false]);
pruef('Ohne auslagen_lesen: kein Auslagenbetrag, zugriff=false', $k['auslagen'] === ['zugriff' => false]);

$nurLohn = ['rechte' => ['lohn_lesen']];
$k = fin_kosten($pdo, $nurLohn, '2025-01', '2025-05', $tab, '2025-12-31');
pruef('Mit lohn_lesen: Lohn da', ($k['lohn']['zugriff'] ?? false) === true
      && (((array)$k['lohn']['monate'])['2025-01']['brutto_rappen'] ?? null) === 155000);
pruef('Mit lohn_lesen, ohne auslagen_lesen: Auslagen gesperrt', $k['auslagen'] === ['zugriff' => false]);

$k = fin_kosten($pdo, ['rechte' => ['lohn_lesen', 'auslagen_lesen']], '2025-01', '2025-05',
                ['lohnlauf' => false, 'einsatz_auslagen' => false], '2025-12-31');
pruef('Ohne Tabellen: "nicht eingerichtet" statt 0', ($k['lohn']['eingerichtet'] ?? null) === false
      && !isset($k['lohn']['monate']) && ($k['auslagen']['eingerichtet'] ?? null) === false);

pruef('Monatsformat: gueltig', fin_monat_gueltig('2025-01'));
pruef('Monatsformat: Monat 13 abgewiesen', !fin_monat_gueltig('2025-13'));
pruef('Monatsformat: Einschleusung abgewiesen', !fin_monat_gueltig("2025-01' OR 1=1"));
pruef('Bereich: Februar endet am 28.', fin_bereich('2025-01', '2025-02') === ['2025-01-01', '2025-02-28']);

echo "pruef_finanzen: {$ok} gruen\n";
foreach ($bad as $b) { echo "- {$b}\n"; }
exit($bad ? 1 : 0);
