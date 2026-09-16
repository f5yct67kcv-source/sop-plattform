<?php
declare(strict_types=1);
// Naechtlicher Demo-Reset (backend/demo_reset.php, ENT-523 Punkt 3) wirklich
// ausfuehren -- SQLite im Arbeitsspeicher, gleiches Muster wie
// pruef_demo_daten.php. demo_reset_alle_tabellen_leeren() bleibt hier
// bewusst ungeprueft: Es ruft information_schema auf, das es in SQLite
// nicht gibt, und ist so kurz, dass sich die Aussage beim Lesen allein
// traegt (siehe Kopfkommentar in backend/demo_reset.php). Geprueft werden
// die beiden Stellen mit echter Logik: die Zeitgeber-Pruefung und das
// Saeen der Systemrollen.
require __DIR__ . '/../backend/rechte.php';   // system_rollen()
require __DIR__ . '/../backend/demo_reset.php';

$ok = 0; $bad = [];
function pruef(string $name, bool $c): void { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// ── demo_reset_zeitgeber_lage() ─────────────────────────────────────
// Dieselben sieben Faelle wie push_zeitgeber_lage() in pruef_push.php --
// gleiches Grundmuster, eigene Kopie, gleiche Sorgfaltspflicht.
{
    $echt = str_repeat('c3d4', 12);
    pruef('KRITISCH: ein unersetzter Platzhalter heisst "nicht eingerichtet"',
        demo_reset_zeitgeber_lage('__DEMO_RESET_TOKEN__', $echt) === 'nicht_eingerichtet');
    pruef('KRITISCH: ein leeres Secret ebenso',
        demo_reset_zeitgeber_lage('', $echt) === 'nicht_eingerichtet');
    pruef('KRITISCH: ohne Schluessel in der Adresse heisst es so -- '
        . 'und NICHT "falscher Schluessel"',
        demo_reset_zeitgeber_lage($echt, '') === 'kein_schluessel_in_der_adresse');
    pruef('KRITISCH: ein falscher Schluessel wird als solcher benannt',
        demo_reset_zeitgeber_lage($echt, 'etwas-anderes') === 'falscher_schluessel');
    pruef('KRITISCH: der richtige Schluessel geht durch',
        demo_reset_zeitgeber_lage($echt, $echt) === 'ok');
    pruef('KRITISCH: ein Schluessel, der nur ein Zeichen laenger ist, geht NICHT durch -- '
        . 'genau der Fall "Prozentzeichen mitkopiert"',
        demo_reset_zeitgeber_lage($echt, $echt . '%') === 'falscher_schluessel');
    pruef('Ein zu kurzer Schluessel ebenfalls nicht',
        demo_reset_zeitgeber_lage($echt, substr($echt, 0, -1)) === 'falscher_schluessel');
    pruef('KRITISCH: die vier Lagen sind unterscheidbar (CLAUDE.md)',
        count(array_unique([
            demo_reset_zeitgeber_lage('', $echt),
            demo_reset_zeitgeber_lage($echt, ''),
            demo_reset_zeitgeber_lage($echt, 'falsch'),
            demo_reset_zeitgeber_lage($echt, $echt),
        ])) === 4);
}

// ── demo_reset_systemrollen_saeen() ─────────────────────────────────
// GEGENPROBE-PROTOKOLL: Eine Fassung, die z. B. rollen_rechte vergisst
// oder die falsche Spalte befuellt, soll hier erkennbar rot werden -- darum
// wird nicht nur "es gibt Zeilen" geprueft, sondern die tatsaechliche
// Aussage: JEDE Systemrolle aus rechte.php steht danach mit GENAU ihren
// eigenen Rechten in der Datenbank, keine mehr, keine weniger, und eine
// Rolle ganz ohne Rechte (Personal/'mitarbeitend') bekommt auch keine
// erfundene Zeile.
{
    $pdo = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('CREATE TABLE rollen (id INTEGER PRIMARY KEY, schluessel TEXT, titel TEXT, text TEXT, system INT)');
    $pdo->exec('CREATE TABLE rollen_rechte (rolle_id INT, bereich TEXT, stufe TEXT)');

    demo_reset_systemrollen_saeen($pdo);

    $soll = system_rollen();
    $ist = $pdo->query('SELECT * FROM rollen')->fetchAll();
    pruef('KRITISCH: genau eine Zeile je Systemrolle aus rechte.php, keine mehr, keine weniger',
        count($ist) === count($soll));

    $alleSystem = array_reduce($ist, fn($c, $r) => $c && (int)$r['system'] === 1, true);
    pruef('KRITISCH: jede gesaete Rolle ist als Systemrolle markiert (system = 1)', $alleSystem);

    $fehler = [];
    foreach ($soll as $schluessel => $rolle) {
        $zeile = null;
        foreach ($ist as $r) { if ($r['schluessel'] === (string)$schluessel) { $zeile = $r; break; } }
        if (!$zeile) { $fehler[] = "fehlt: $schluessel"; continue; }
        if ($zeile['titel'] !== $rolle['titel'] || $zeile['text'] !== $rolle['text']) {
            $fehler[] = "Titel/Text falsch: $schluessel";
        }
        $rechteIst = [];
        foreach ($pdo->query('SELECT bereich, stufe FROM rollen_rechte WHERE rolle_id = ' . (int)$zeile['id'])->fetchAll() as $z) {
            $rechteIst[(string)$z['bereich']] = (string)$z['stufe'];
        }
        ksort($rechteIst); $rechteSoll = $rolle['stufen']; ksort($rechteSoll);
        if ($rechteIst !== $rechteSoll) { $fehler[] = "Rechte falsch: $schluessel"; }
    }
    pruef('KRITISCH (Gegenprobe): jede Systemrolle traegt exakt ihre eigenen Rechte aus rechte.php -- '
        . 'Details: ' . ($fehler ? implode('; ', $fehler) : 'keine'), $fehler === []);

    // Die eine Rolle ganz ohne Rechte (Personal/'mitarbeitend', siehe
    // rechte.php) darf keine erfundene rollen_rechte-Zeile bekommen.
    $ohneRechte = array_filter($soll, fn($r) => $r['stufen'] === []);
    foreach ($ohneRechte as $schluessel => $rolle) {
        $zeile = null;
        foreach ($ist as $r) { if ($r['schluessel'] === (string)$schluessel) { $zeile = $r; break; } }
        $anzahl = $zeile ? (int)$pdo->query('SELECT COUNT(*) FROM rollen_rechte WHERE rolle_id = ' . (int)$zeile['id'])->fetchColumn() : -1;
        pruef("KRITISCH: Rolle '$schluessel' hat keine Rechte in rechte.php und bekommt auch keine erfundene Zeile",
            $anzahl === 0);
    }
}

echo "\n" . $ok . ' bestanden, ' . count($bad) . " nicht bestanden\n";
if ($bad) { foreach ($bad as $b) { echo '  x ' . $b . "\n"; } exit(1); }
echo "Alle Pruefungen bestanden.\n";
