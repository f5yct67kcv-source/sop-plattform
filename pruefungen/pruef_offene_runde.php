<?php
declare(strict_types=1);
// rundgang_offener() in backend/rundgang.php (ENT-624/625) gegen eine
// wirkliche Datenbank -- SQLite im Arbeitsspeicher, gleiches Muster wie
// pruef_rundgang.php.
//
// WORUM ES GEHT: Eine Person hat hoechstens EINE offene Runde. Diese
// Funktion ist die einzige Stelle, die beantwortet, welche das ist --
// die Rueckfrage beim App-Start (ENT-624) und beide Startwege (ENT-625)
// fragen sie. Sie muss darum zwei Dinge sicher koennen:
//
//  1. Ueber ALLE Einsaetze hinweg suchen. Genau daran hing der Fehler, den
//     ENT-625 behebt: Die alte Sperre sah nur denselben Einsatz an, und
//     eine Nachtschicht von gestern (20:00-06:00) ueberschneidet sich
//     zeitlich mit nichts, was heute Nachmittag beginnt.
//  2. Nur die EIGENEN Runden. Die mitarbeiter_id kommt aus der Sitzung;
//     kaeme hier eine fremde Runde heraus, blockierte sie einen fremden
//     Start und gaebe nebenbei preis, wo jemand anders unterwegs ist.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

require __DIR__ . '/../backend/rundgang.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE rundgang (id INTEGER PRIMARY KEY, einsatz_id INT, mitarbeiter_id INT,
            objekt_id INT, rundgang_vorlage_id INT, status TEXT, vorbereitet_am TEXT,
            rohzeit_start TEXT, pausiert_seit TEXT, pause_minuten INT DEFAULT 0)');
$pdo->exec('CREATE TABLE einsaetze (id INTEGER PRIMARY KEY, datum TEXT)');
$pdo->exec('CREATE TABLE objekte (id INTEGER PRIMARY KEY, name TEXT, kunde_name TEXT)');
$pdo->exec('CREATE TABLE rundgang_vorlage (id INTEGER PRIMARY KEY, name TEXT)');
$pdo->exec('CREATE TABLE kontrollpunkt (id INTEGER PRIMARY KEY, objekt_id INT, aktiv INT)');
$pdo->exec('CREATE TABLE rundgang_vorlage_punkt (vorlage_id INT, kontrollpunkt_id INT)');
$pdo->exec('CREATE TABLE rundgang_scan (id INTEGER PRIMARY KEY, rundgang_id INT,
            kontrollpunkt_id INT, status TEXT)');

$pdo->exec("INSERT INTO einsaetze (id, datum) VALUES (700, '2026-09-01'), (701, '2026-09-02')");
$pdo->exec("INSERT INTO objekte (id, name, kunde_name) VALUES
            (7, 'Musterobjekt Nord', 'Musterliegenschaften AG'),
            (8, 'Musterobjekt Sued', 'Musterliegenschaften AG')");
$pdo->exec("INSERT INTO rundgang_vorlage (id, name) VALUES (30, 'Patrouille Nord')");
$pdo->exec('INSERT INTO kontrollpunkt (id, objekt_id, aktiv) VALUES
            (1, 7, 1), (2, 7, 1), (3, 7, 1), (4, 8, 1)');
$pdo->exec('INSERT INTO rundgang_vorlage_punkt (vorlage_id, kontrollpunkt_id) VALUES (30, 1), (30, 2)');

// ══════════════ NICHTS OFFEN
$a = rundgang_offener($pdo, 1);
pruef('Ohne Runde kommt null heraus -- und "weitere" ist 0, nicht leer',
    $a['rundgang'] === null && $a['weitere'] === 0);

// ══════════════ EINE OFFENE RUNDE, EIGENER EINSATZ
$pdo->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, rundgang_vorlage_id,
            status, vorbereitet_am, pausiert_seit, pause_minuten)
            VALUES (900, 700, 1, 7, 30, 'pausiert', '2026-09-01 21:14:00', '2026-09-01 23:02:00', 12)");
$pdo->exec("INSERT INTO rundgang_scan (rundgang_id, kontrollpunkt_id, status)
            VALUES (900, 1, 'bestaetigt')");
$a = rundgang_offener($pdo, 1);
pruef('KRITISCH: die offene Runde wird gefunden', $a['rundgang'] !== null && $a['rundgang']['id'] === 900);
pruef('Sie bringt den Einsatz mit -- ohne ihn fuehrt kein Weg hinein',
    $a['rundgang']['einsatz_id'] === 700);
pruef('Sie bringt das DATUM des Einsatzes mit -- sonst laesst sich eine alte Schicht nicht nachladen',
    $a['rundgang']['einsatz_datum'] === '2026-09-01');
pruef('Sie nennt das Objekt, nicht nur eine Nummer',
    $a['rundgang']['objekt_name'] === 'Musterobjekt Nord');
pruef('Sie nennt die gewaehlte Kontrollrunde', $a['rundgang']['vorlage_name'] === 'Patrouille Nord');
pruef('Und deren Kennung -- daran erkennt der Startweg das zweite Antippen derselben Kachel',
    $a['rundgang']['vorlage_id'] === 30);
pruef('KRITISCH: der Fortschritt zaehlt nur die Punkte DIESER Kontrollrunde, nicht alle des Objekts',
    $a['rundgang']['punkte_anzahl'] === 2 && $a['rundgang']['erledigt_anzahl'] === 1);
pruef('Der Zustand kommt mit -- pausiert ist etwas anderes als laufend',
    $a['rundgang']['status'] === 'pausiert' && $a['rundgang']['pausiert_seit'] === '2026-09-01 23:02:00');

// ══════════════ EINE FREMDE RUNDE IST KEINE EIGENE
$pdo->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, rundgang_vorlage_id,
            status, vorbereitet_am) VALUES (901, 701, 2, 8, NULL, 'laeuft', '2026-09-02 10:00:00')");
$a = rundgang_offener($pdo, 1);
pruef('KRITISCH: die Runde einer ANDEREN Person taucht hier nicht auf',
    $a['rundgang']['id'] === 900 && $a['weitere'] === 0);
$b = rundgang_offener($pdo, 2);
pruef('Und umgekehrt: die andere Person sieht ihre eigene', $b['rundgang']['id'] === 901);
pruef('KRITISCH: ohne Kontrollrunde bleibt vorlage_name null -- die App sagt dann "alle Punkte des Objekts"',
    $b['rundgang']['vorlage_name'] === null && $b['rundgang']['vorlage_id'] === null);
pruef('Ohne Kontrollrunde zaehlen alle aktiven Punkte des Objekts',
    $b['rundgang']['punkte_anzahl'] === 1);

// ══════════════ EIN ZWEITER EINSATZ -- GENAU DER FALL AUS ENT-625
// Die alte Sperre sah nur denselben Einsatz an. Eine vergessene Runde von
// gestern und eine neue von heute standen nebeneinander.
$pdo->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, rundgang_vorlage_id,
            status, vorbereitet_am) VALUES (902, 701, 1, 8, NULL, 'laeuft', '2026-09-02 14:00:00')");
$a = rundgang_offener($pdo, 1);
pruef('KRITISCH: eine offene Runde auf einem ANDEREN Einsatz wird gefunden -- darum ging es bei ENT-625',
    $a['rundgang']['id'] === 902 && $a['rundgang']['einsatz_id'] === 701);
pruef('Die neuere kommt zuerst, die aeltere wird mitgezaehlt statt verschwiegen',
    $a['weitere'] === 1);

// ══════════════ ABGESCHLOSSEN UND ABGEBROCHEN SIND NICHT OFFEN
$pdo->exec("UPDATE rundgang SET status = 'abgebrochen' WHERE id = 902");
$pdo->exec("UPDATE rundgang SET status = 'abgeschlossen' WHERE id = 900");
$a = rundgang_offener($pdo, 1);
pruef('KRITISCH: eine abgebrochene und eine abgeschlossene Runde sind keine offenen',
    $a['rundgang'] === null && $a['weitere'] === 0);

// ══════════════ "VORBEREITET" IST OFFEN
// Der haeufigste Fehlgriff ueberhaupt: falsche Runde angetippt, noch kein
// einziger Punkt erfasst. Genau die muss die Rueckfrage anbieten.
$pdo->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, rundgang_vorlage_id,
            status, vorbereitet_am) VALUES (903, 700, 1, 7, 30, 'vorbereitet', '2026-09-01 20:00:00')");
$a = rundgang_offener($pdo, 1);
pruef('KRITISCH: eine erst vorbereitete Runde zaehlt als offen -- sonst bliebe der Fehlgriff stehen',
    $a['rundgang'] !== null && $a['rundgang']['id'] === 903);
pruef('Sie steht bei 0 von 2 -- und das ist eine Aussage, keine Luecke',
    $a['rundgang']['erledigt_anzahl'] === 0 && $a['rundgang']['punkte_anzahl'] === 2);

echo "\n$ok bestanden, " . count($bad) . " nicht bestanden\n\n";
foreach ($bad as $b) { echo "  ✗ $b\n"; }
exit($bad ? 1 : 0);
