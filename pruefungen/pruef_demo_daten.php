<?php
declare(strict_types=1);
// Musterbetrieb-Erzeugung (backend/demo_daten.php, ENT-523) wirklich
// ausfuehren -- SQLite im Arbeitsspeicher, gleiches Muster wie
// pruef_dienstfahrzeug.php/pruef_einsatz_abgeschlossen.php.
//
// WARUM HIER UND NICHT NUR NACHGELESEN: Der eigentliche Fehler, den diese
// Suite fangen soll, ist beim Bauen selbst passiert und wurde NICHT durch
// Lesen gefunden, sondern durch einen echten Testlauf gegen eine lokale
// Datenbank: Ein gemeinsamer Rotations-Zeiger je EINSATZART (statt je
// OBJEKT) teilte dieselbe Person an zwei Objekten mit überlappenden
// Nachtschichten gleichzeitig ein. Eine Prüfung, die nur "es gibt einen
// Zeiger" oder "die Funktion existiert" verlangt hätte, wäre daran
// vorbeigelaufen -- verlangt wird die AUSSAGE selbst: keine Person an
// zwei Objekten am selben Tag.

$ok = 0; $bad = [];
function pruef(string $name, bool $c): void { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// backend/demo_daten.php erwartet, dass db.php und rechte.php bereits
// geladen sind (siehe Kopfkommentar dort) -- hat_tabelle()/json_response()
// werden hier als Stubs bereitgestellt (gleiche Bauart wie in
// pruef_dienstfahrzeug.php: hat_tabelle() fraegt sonst information_schema
// ab, das es in SQLite nicht gibt). mitarbeiter.php/planung.php/
// gavzeit.php/anmeldung.php bindet demo_daten.php SELBST ein (require_once)
// -- kein eigener Stub dafuer noetig, und einer wuerde mit der echten
// Definition kollidieren (PHP erlaubt keine doppelte Funktion).
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool { return true; }
function json_response($data, int $status = 200): void {
    throw new RuntimeException('json_response aufgerufen: ' . json_encode($data));
}

require __DIR__ . '/../backend/demo_daten.php';

$pdo = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$pdo->exec('CREATE TABLE kunden (id INTEGER PRIMARY KEY, name TEXT)');
$pdo->exec('CREATE TABLE objekte (id INTEGER PRIMARY KEY, kunde_id INT, name TEXT, einsatzart TEXT)');
$pdo->exec('CREATE TABLE einsaetze (id INTEGER PRIMARY KEY, kunde_id INT, kunde_name TEXT, objekt_id INT,
    titel TEXT, strasse TEXT, ort TEXT, einsatzart TEXT, sparte TEXT, datum TEXT, von TEXT, bis TEXT,
    bedarf INT, status TEXT)');
$pdo->exec('CREATE TABLE einsatz_zuteilung (einsatz_id INT, mitarbeiter_id INT, zusage TEXT)');

// ── Datenkonsistenz der reinen Listen (kein DB-Zugriff) ─────────────────
{
    $ma = demo_mitarbeiterliste();
    pruef('KRITISCH: genau 18 Mitarbeitende (ENT-523, Entscheid des Projektinhabers)', count($ma) === 18);

    $namen = array_map(fn($m) => $m[0] . ' ' . $m[1], $ma);
    pruef('KRITISCH: keine zwei Mitarbeitenden mit demselben Vor-/Nachnamen (Login-Kollision waere die Folge)',
        count($namen) === count(array_unique($namen)));

    $gueltigeRollen = ['mitarbeitend', 'planung', 'personal', 'administrator', 'verwaltung', 'waechter'];
    $unbekannt = [];
    foreach ($ma as [, , , , $rollen]) {
        foreach ($rollen as $r) { if (!in_array($r, $gueltigeRollen, true)) { $unbekannt[] = $r; } }
    }
    pruef('KRITISCH: jede zugewiesene Rolle ist eine der sechs Systemrollen aus rechte.php',
        $unbekannt === []);

    pruef('KRITISCH: mindestens eine Person traegt die Rolle "verwaltung" -- sonst kann sich niemand fuer die Fuehrungsstation "Planung/Zuteilen" mit vollen Rechten anmelden',
        array_reduce($ma, fn($c, $m) => $c || in_array('verwaltung', $m[4], true), false));

    $ob = demo_objektliste();
    pruef('KRITISCH: genau 12 Objekte (ENT-523, Entscheid des Projektinhabers)', count($ob) === 12);

    $kundenAnzahl = count(demo_kundenliste());
    $ungueltigerIndex = array_filter($ob, fn($o) => $o[0] < 0 || $o[0] >= $kundenAnzahl);
    pruef('KRITISCH: jeder Kunde-Index in der Objektliste zeigt auf einen tatsaechlich vorhandenen Kunden',
        $ungueltigerIndex === []);

    foreach (['Baustellenbewachung', 'Revierdienst', 'Verkehrsdienst', 'Empfang'] as $art) {
        $m = demo_schichtmuster($art);
        pruef("KRITISCH: Schichtmuster fuer '$art' hat eine Endzeit nach der Startzeit oder eine Nachtschicht ueber Mitternacht",
            $m['von'] !== $m['bis']);
    }

    pruef('KRITISCH: das fuer die Luecke vorgesehene Objekt (DEMO_UNTERBESETZTES_OBJEKT) existiert tatsaechlich in der Objektliste',
        in_array(DEMO_UNTERBESETZTES_OBJEKT, array_column($ob, 1), true));
    pruef('KRITISCH: das Event-Objekt (DEMO_EVENT_OBJEKT) existiert tatsaechlich in der Objektliste',
        in_array(DEMO_EVENT_OBJEKT, array_column($ob, 1), true));
}

// ── demo_tag(): relative Datumsberechnung, niemals fest ────────────────
{
    $heute = (new DateTimeImmutable('today'))->format('Y-m-d');
    pruef('KRITISCH: demo_tag(0) liefert das heutige Datum, kein festes', demo_tag(0) === $heute);
    $morgen = (new DateTimeImmutable('today'))->modify('+1 day')->format('Y-m-d');
    pruef('KRITISCH: demo_tag(1) liefert morgen', demo_tag(1) === $morgen);
}

// ── DER KERNFALL: echte Zuteilung gegen SQLite ausfuehren ──────────────
// Erfundene Mitarbeitende in der gleichen Form wie
// demo_mitarbeitende_erzeugen() sie zurueckgibt -- absichtlich MEHR
// Revierdienst-Personen als noetig (10 statt der echten 8), damit diese
// Suite nicht an einer knappen Personaldecke haengt, sondern ausschliesslich
// die Zuteilungslogik selbst prueft.
function pruef_demo_fixture_mitarbeitende(): array
{
    $ma = [];
    foreach (['Anna', 'Beat', 'Cyrill', 'Deborah', 'Emil', 'Fiona', 'Gian', 'Hana', 'Ines', 'Jon'] as $i => $vorname) {
        $ma[] = ['id' => $i + 1, 'vorname' => $vorname, 'nachname' => 'Revier' . ($i + 1),
            'funktion' => 'Wächter/in', 'abteilung' => 'Revierdienst', 'rollen' => ['mitarbeitend', 'waechter']];
    }
    foreach (['Kim', 'Luca', 'Mia', 'Noah', 'Olga', 'Pit'] as $i => $vorname) {
        $ma[] = ['id' => 100 + $i, 'vorname' => $vorname, 'nachname' => 'Verkehr' . $i,
            'funktion' => 'Wächter/in', 'abteilung' => 'Verkehrsdienst', 'rollen' => ['mitarbeitend', 'waechter']];
    }
    return $ma;
}

function pruef_demo_fixture_objekte(PDO $pdo): array
{
    $pdo->exec("INSERT INTO kunden (id, name) VALUES (1, 'Test-Kunde AG')");
    $objekte = [];
    $liste = [
        // Baustellenbewachung UND Revierdienst absichtlich BEIDE dabei:
        // Der tatsaechlich gefundene Fehler war eine Kollision ZWISCHEN
        // diesen beiden Einsatzarten (getrennte Zaehler auf demselben
        // Personen-Pool, beide bei Index 0 startend) -- ein Fixture ohne
        // Baustellenbewachung wuerde genau diesen Fehler nicht fangen
        // koennen (siehe Gegenprobe-Protokoll unten).
        ['Baustelle X', 'Baustellenbewachung'], ['Baustelle Y', 'Baustellenbewachung'],
        ['Nacht-Objekt A', 'Revierdienst'], ['Nacht-Objekt B', 'Revierdienst'],
        ['Nacht-Objekt C', 'Revierdienst'], [DEMO_UNTERBESETZTES_OBJEKT, 'Revierdienst'],
        ['Tag-Objekt A', 'Verkehrsdienst'], [DEMO_EVENT_OBJEKT, 'Verkehrsdienst'],
    ];
    $ein = $pdo->prepare('INSERT INTO objekte (kunde_id, name, einsatzart) VALUES (1, ?, ?)');
    foreach ($liste as [$name, $art]) {
        $ein->execute([$name, $art]);
        $objekte[] = ['id' => (int)$pdo->lastInsertId(), 'kunde_id' => 1, 'name' => $name,
            'einsatzart' => $art, 'strasse' => 'Teststrasse 1', 'ort' => 'Testort'];
    }
    return $objekte;
}

$mitarbeitende = pruef_demo_fixture_mitarbeitende();
$objekte = pruef_demo_fixture_objekte($pdo);
demo_einsaetze_erzeugen($pdo, $objekte, $mitarbeitende);

// Die eigentliche Aussage, mit echter SQL-Abfrage geprueft: keine Person
// hat an einem Tag mehr als einen Einsatz -- das ist die Aussage, die der
// gefundene Fehler verletzt hat (dieselbe Person an zwei Objekten in
// derselben Nacht).
$doppelt = $pdo->query(
    'SELECT COUNT(*) FROM (
       SELECT z.mitarbeiter_id, e.datum FROM einsatz_zuteilung z JOIN einsaetze e ON e.id = z.einsatz_id
       GROUP BY z.mitarbeiter_id, e.datum HAVING COUNT(*) > 1
     )'
)->fetchColumn();
pruef('KRITISCH (Gegenprobe des gefundenen Fehlers): keine Person ist an einem Tag mehr als einem Einsatz zugeteilt',
    (int)$doppelt === 0);

// Der unbesetzte Platz selbst: "1 von 2", nicht "0 von 1" -- CLAUDE.md
// verbietet ausdruecklich, dass eine Teilzahl wie eine Gesamtzahl aussieht.
$luecke = $pdo->query(
    "SELECT e.bedarf, COUNT(z.mitarbeiter_id) AS zugeteilt FROM einsaetze e
     LEFT JOIN einsatz_zuteilung z ON z.einsatz_id = e.id
     JOIN objekte o ON o.id = e.objekt_id
     WHERE o.name = '" . DEMO_UNTERBESETZTES_OBJEKT . "' AND e.datum = '" . demo_tag(0) . "'
     GROUP BY e.id"
)->fetch();
pruef('KRITISCH: der bewusst unbesetzte Platz zeigt bedarf=2, zugeteilt=1 -- nicht bedarf=1, zugeteilt=0',
    $luecke && (int)$luecke['bedarf'] === 2 && (int)$luecke['zugeteilt'] === 1);

// Gegenrichtung: An JEDEM ANDEREN Tag desselben Objekts ist der Platz
// voll besetzt -- die Luecke betrifft nur den heutigen Tag, nicht die
// ganze Planung dieses Objekts.
$andereTage = $pdo->query(
    "SELECT COUNT(*) FROM einsaetze e
     LEFT JOIN einsatz_zuteilung z ON z.einsatz_id = e.id
     JOIN objekte o ON o.id = e.objekt_id
     WHERE o.name = '" . DEMO_UNTERBESETZTES_OBJEKT . "' AND e.datum != '" . demo_tag(0) . "'
     GROUP BY e.id HAVING COUNT(z.mitarbeiter_id) < e.bedarf"
)->fetchAll();
pruef('KRITISCH (Gegenprobe): an keinem ANDEREN Tag desselben Objekts bleibt ein Platz unbesetzt -- nur heute',
    $andereTage === []);

// Kein Objekt ausserhalb des vorgesehenen bleibt irgendwann unbesetzt.
$sonstUnbesetzt = $pdo->query(
    "SELECT o.name FROM einsaetze e
     LEFT JOIN einsatz_zuteilung z ON z.einsatz_id = e.id
     JOIN objekte o ON o.id = e.objekt_id
     WHERE o.name != '" . DEMO_UNTERBESETZTES_OBJEKT . "'
     GROUP BY e.id HAVING COUNT(z.mitarbeiter_id) < e.bedarf"
)->fetchAll();
pruef('KRITISCH: kein anderes Objekt als das vorgesehene bleibt jemals unbesetzt',
    $sonstUnbesetzt === []);

echo "\n" . $ok . ' bestanden, ' . count($bad) . " nicht bestanden\n";
if ($bad) { foreach ($bad as $b) { echo '  x ' . $b . "\n"; } exit(1); }
echo "Alle Pruefungen bestanden.\n";
