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
    bedarf INT, status TEXT, ist_status TEXT NOT NULL DEFAULT "offen", ist_von TEXT, ist_bis TEXT,
    ist_pause_min INT, ist_pause_bezahlt_ma INT, abgeglichen_von INT, abgeglichen_am TEXT)');
$pdo->exec('CREATE TABLE einsatz_zuteilung (einsatz_id INT, mitarbeiter_id INT, zusage TEXT,
    ist_status TEXT NOT NULL DEFAULT "offen", ist_von TEXT, ist_bis TEXT, ist_pause_min INT,
    ist_pause_bezahlt_ma INT, abgeglichen_von INT, abgeglichen_am TEXT)');

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
demo_einsaetze_erzeugen($pdo, $objekte, $mitarbeitende, 1);

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

// ── Stufe 2b: vergangene Schichten werden abgeglichen, heute/zukuenftige
// nicht ────────────────────────────────────────────────────────────────
// Der Lohnlauf zaehlt nur ist_status='anwesend' (siehe pruef_lohnlauf.php,
// Regression zu demselben Fehler). Ohne diese Weiche in
// demo_einsaetze_erzeugen() bliebe jede Demo-Schicht "offen", und
// demo_lohnlauf_erzeugen() haette nie einen Betrag zu zeigen.
$vergangeneOffen = (int)$pdo->query(
    "SELECT COUNT(*) FROM einsatz_zuteilung z JOIN einsaetze e ON e.id = z.einsatz_id
     WHERE e.datum < '" . demo_tag(0) . "' AND z.ist_status != 'anwesend'"
)->fetchColumn();
pruef('KRITISCH: JEDE vergangene Schicht ist als "anwesend" abgeglichen, keine bleibt "offen"',
    $vergangeneOffen === 0);

$vergangeneOhneZeit = (int)$pdo->query(
    "SELECT COUNT(*) FROM einsatz_zuteilung WHERE ist_status = 'anwesend'
       AND (ist_von IS NULL OR ist_bis IS NULL OR ist_pause_min IS NULL)"
)->fetchColumn();
pruef('KRITISCH: jede abgeglichene Schicht traegt Ist-Zeiten und eine Pause -- sonst sperrt lohnlauf_zeiten() sie als "zeiten_unvollstaendig"',
    $vergangeneOhneZeit === 0);

$heuteUndDanach = (int)$pdo->query(
    "SELECT COUNT(*) FROM einsatz_zuteilung z JOIN einsaetze e ON e.id = z.einsatz_id
     WHERE e.datum >= '" . demo_tag(0) . "' AND z.ist_status != 'offen'"
)->fetchColumn();
pruef('KRITISCH: KEINE Schicht von heute oder in der Zukunft ist abgeglichen -- eine Schicht kann nicht abgeglichen sein, bevor sie stattfand',
    $heuteUndDanach === 0);

// Beide Zustaende muessen tatsaechlich vorkommen -- eine Pruefung, die nur
// "alles gleich" pruefte, faende auch einen Fehler nicht, der ALLES auf
// 'anwesend' oder ALLES auf 'offen' setzt.
$anwesendZahl = (int)$pdo->query("SELECT COUNT(*) FROM einsatz_zuteilung WHERE ist_status = 'anwesend'")->fetchColumn();
$offenZahl    = (int)$pdo->query("SELECT COUNT(*) FROM einsatz_zuteilung WHERE ist_status = 'offen'")->fetchColumn();
pruef('KRITISCH: die Fixture erzeugt tatsaechlich BEIDE Zustaende (sonst waere obiges nur zufaellig gruen)',
    $anwesendZahl > 0 && $offenZahl > 0);

// Der unbesetzte Platz heute bleibt trotz der neuen Abgleich-Weiche offen
// -- eine Schicht von heute darf nie abgeglichen sein (siehe oben), das
// gilt auch fuer die dramaturgisch wichtigste.
$lueckeStatus = $pdo->query(
    "SELECT z.ist_status FROM einsatz_zuteilung z JOIN einsaetze e ON e.id = z.einsatz_id
     JOIN objekte o ON o.id = e.objekt_id
     WHERE o.name = '" . DEMO_UNTERBESETZTES_OBJEKT . "' AND e.datum = '" . demo_tag(0) . "'"
)->fetchAll(PDO::FETCH_COLUMN);
pruef('KRITISCH: der heutige unbesetzte Platz bleibt "offen" -- nicht faelschlich als abgeglichen markiert',
    $lueckeStatus !== [] && array_unique($lueckeStatus) === ['offen']);

// ── Stufe 2b: der Lohnlauf selbst, gegen eine EIGENE Datenbank ─────────
// Eigene Verbindung statt der obigen: demo_lohnlauf_erzeugen() braucht ein
// mitarbeiter-zentriertes Schema (lohn_ansatz, lohn_abzug, lohnlauf...),
// das mit der schlanken Objekt/Einsatz-Fixture oben nichts zu tun hat.
// Rechnet ueber lohnlauf_person()/lohnlauf_nbu()/lohnlauf_abzuege() aus
// backend/lohnlauf.php -- DIESELBEN Funktionen, die pruef_lohnlauf.php
// bereits gegen viele Einzelfaelle prueft. Getestet wird hier NICHT die
// GAV-Rechnung selbst noch einmal, sondern die VERDRAHTUNG: erzeugt
// demo_lohn_ansatz_erzeugen()/demo_lohn_abzug_erzeugen()/
// demo_einsaetze_erzeugen() zusammen genug Grundlage, dass
// demo_lohnlauf_erzeugen() tatsaechlich einen Betrag ausweist -- und
// bleibt er bei fehlender Grundlage ehrlich leer, statt eine Null zu
// erfinden.
{
    $pdo2 = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo2->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, vorname TEXT, nachname TEXT, name TEXT,
        personalnummer TEXT, anstellungskategorie TEXT, pensum_stunden INT, eintritt TEXT, austritt TEXT,
        geburtsdatum TEXT)');
    $pdo2->exec('CREATE TABLE lohn_ansatz (id INTEGER PRIMARY KEY, mitarbeiter_id INT, gueltig_ab TEXT,
        kategorie TEXT, ansatz_rappen INT, ferien_laufend INT, ml13_bp INT,
        zuschlag_fachausweis_art TEXT, zuschlag_fachausweis_rappen INT,
        zuschlag_hund_art TEXT, zuschlag_hund_rappen INT, zuschlag_waffe_art TEXT, zuschlag_waffe_rappen INT)');
    $pdo2->exec('CREATE TABLE lohn_abzug (id INTEGER PRIMARY KEY, schluessel TEXT, bezeichnung TEXT,
        gueltig_ab TEXT, gueltig_bis TEXT, satz_bp INT, fix_rappen INT, hoechstlohn_rappen INT, quelle TEXT)');
    $pdo2->exec('CREATE TABLE einsaetze (id INTEGER PRIMARY KEY, datum TEXT, sparte TEXT, kunde_name TEXT,
        objekt_id INT, status TEXT)');
    $pdo2->exec('CREATE TABLE einsatz_zuteilung (einsatz_id INT, mitarbeiter_id INT, ist_status TEXT,
        ist_von TEXT, ist_bis TEXT, ist_pause_min INT, ist_pause_bezahlt_ma INT)');
    $pdo2->exec('CREATE TABLE abwesenheiten (id INTEGER PRIMARY KEY, mitarbeiter_id INT, typ TEXT,
        von TEXT, bis TEXT, status TEXT)');
    $pdo2->exec('CREATE TABLE lohnlauf (id INTEGER PRIMARY KEY, periode_von TEXT, periode_bis TEXT,
        status TEXT, erstellt_am TEXT, erstellt_von INT, freigegeben_am TEXT, freigegeben_von INT,
        ausbezahlt_am TEXT, ausbezahlt_von INT, storniert_am TEXT, storniert_von INT, storno_grund TEXT,
        ersetzt_lauf_id INT, bemerkung TEXT)');
    $pdo2->exec('CREATE TABLE lohnlauf_person (id INTEGER PRIMARY KEY, lauf_id INT, mitarbeiter_id INT,
        kategorie TEXT, lohnform TEXT, roh_min INT, netto_min INT, bonus_min REAL, bewertet_min REAL,
        brutto_rappen INT, gesperrt_grund TEXT, gesperrt_zaehler TEXT, nicht_abgeglichen INT,
        warnung TEXT, netto_rappen INT, auszahlung_rappen INT, nbu_stand TEXT, nbu_herleitung TEXT)');
    $pdo2->exec('CREATE TABLE lohnlauf_zeile (id INTEGER PRIMARY KEY, lauf_id INT, mitarbeiter_id INT,
        schluessel TEXT, bezeichnung TEXT, sortierung INT, basis_rappen INT, satz_bp INT, menge REAL,
        betrag_rappen INT, gesperrt_grund TEXT, annahme INT, hinweis TEXT)');

    // Eine Person, Kategorie C, mit einer Achtstundenschicht an JEDEM Tag
    // des Vormonats bis auf einen (Tageszeit, kein Bonusfenster -- die
    // GAV-Rechnung selbst ist nicht Gegenstand dieser Pruefung) -- dieselbe
    // Dichte wie im echten Musterbetrieb (ein Objekt, eine feste Person,
    // taeglich), damit die woechentliche NBU-Unterstellung tatsaechlich
    // ueber der Schwelle liegt. Zwei bis drei Schichten waeren zu wenig:
    // lohnlauf_nbu() rechnet dann "keine Deckung", und eine Abzugszeile
    // ohne Betrag sperrt nach lohnlauf_abzuege() den Nettolohn ganz --
    // richtig fuer eine echte Aushilfe, aber nicht das, was diese Pruefung
    // zeigen soll. EIN Tag bleibt "offen" (wie in demo_einsaetze_erzeugen()
    // fuer eine noch nicht stattgefundene Schicht) und zaehlt darum nicht.
    $pdo2->exec("INSERT INTO mitarbeiter VALUES
        (1, 'Test', 'Person', 'test.person', '001', 'C', 2000, '2020-01-01', NULL, '1990-01-01')");
    demo_lohn_ansatz_erzeugen($pdo2, [['id' => 1]]);
    demo_lohn_abzug_erzeugen($pdo2);

    $vormonat = demo_vormonat_bereich();
    $einTag = function (int $id, string $datum, string $status) use ($pdo2): void {
        $pdo2->exec("INSERT INTO einsaetze (id, datum, sparte, kunde_name, status) VALUES ($id, '$datum', 'sicherheit', 'Test', 'geplant')");
        $von = $status === 'anwesend' ? "'08:00'" : 'NULL';
        $bis = $status === 'anwesend' ? "'16:00'" : 'NULL';
        $pause = $status === 'anwesend' ? 30 : 'NULL';
        $pdo2->exec("INSERT INTO einsatz_zuteilung VALUES ($id, 1, '$status', $von, $bis, $pause, 0)");
    };
    $von = new DateTimeImmutable($vormonat[0]);
    $bis = new DateTimeImmutable($vormonat[1]);
    $tag = $von; $id = 1;
    while ($tag <= $bis) {
        // Der erste Tag bleibt "offen" -- der einzige, der nicht zaehlt.
        $einTag($id, $tag->format('Y-m-d'), $tag == $von ? 'offen' : 'anwesend');
        $tag = $tag->modify('+1 day');
        $id++;
    }

    $laufId = demo_lohnlauf_erzeugen($pdo2, $vormonat[0], $vormonat[1], 1);
    pruef('KRITISCH: demo_lohnlauf_erzeugen() legt tatsaechlich einen Lauf an, wenn abgeglichene Zeit vorliegt',
        $laufId !== null && $laufId > 0);

    $lauf = $pdo2->query("SELECT * FROM lohnlauf WHERE id = $laufId")->fetch();
    pruef('KRITISCH: der Lauf ist bis "ausbezahlt" durchgestellt, nicht nur als Entwurf stehen geblieben',
        $lauf && $lauf['status'] === 'ausbezahlt' && $lauf['freigegeben_am'] && $lauf['ausbezahlt_am']);
    pruef('Der Lauf deckt genau den Vormonat ab, den demo_vormonat_bereich() liefert',
        $lauf && $lauf['periode_von'] === $vormonat[0] && $lauf['periode_bis'] === $vormonat[1]);

    $person = $pdo2->query("SELECT * FROM lohnlauf_person WHERE lauf_id = $laufId AND mitarbeiter_id = 1")->fetch();
    pruef('KRITISCH: die Person erscheint im Lauf mit einem echten Bruttolohn -- nicht gesperrt, nicht null',
        $person && $person['gesperrt_grund'] === null && (int)$person['brutto_rappen'] > 0);
    pruef('KRITISCH: die heutige, nicht abgeglichene Schicht zaehlt NICHT mit -- nur zwei Tage bewertete Zeit, nicht drei',
        $person && (int)$person['nicht_abgeglichen'] === 1);
    pruef('Auch Netto- und Auszahlungsbetrag sind echte Zahlen, nicht null -- die Abzugsseite hat genug Grundlage (demo_lohn_abzug_erzeugen())',
        $person && $person['netto_rappen'] !== null && $person['auszahlung_rappen'] !== null);

    $zeilen = $pdo2->query("SELECT COUNT(*) FROM lohnlauf_zeile WHERE lauf_id = $laufId AND mitarbeiter_id = 1")->fetchColumn();
    pruef('Die Lohnzeilen selbst sind gespeichert (Rohzeit/Nettozeit/Bonus bleiben einzeln nachvollziehbar, CLAUDE.md)',
        (int)$zeilen > 3);

    // GEGENPROBE: Ohne jede abgeglichene Schicht (leere Grundlage) darf
    // demo_lohnlauf_erzeugen() KEINEN Lauf anlegen -- eine Person ganz
    // ohne Zeit gehoert nicht hinein (lauf_vorschau()-Regel, siehe
    // demo_lohnlauf_erzeugen()-Kommentar). Der Monat VOR dem Vormonat --
    // relativ dazu berechnet, kein festes Datum (test_datumsfest.mjs) --
    // trifft garantiert keine der obigen drei Schichten, liegt aber
    // innerhalb der Geltung von lohn_ansatz/GAVZEIT_REGELWERK (sonst waere
    // die Person wegen 'kein_ansatz' gesperrt UND TROTZDEM im Lauf, was
    // etwas anderes prueft als "nichts zu sehen").
    $vorVormonat = (new DateTimeImmutable($vormonat[0]))->modify('-1 month');
    $leererLaufId = demo_lohnlauf_erzeugen($pdo2,
        $vorVormonat->format('Y-m-01'), $vorVormonat->format('Y-m-t'), 1);
    pruef('KRITISCH (Gegenprobe): ganz ohne abgeglichene Zeit im Zeitraum entsteht gar kein Lauf, statt einer leeren Behauptung',
        $leererLaufId === null);

    // lohn_ansatz-Werte muessen ueber dem GAV-Mindestlohn 2026 liegen
    // (Kategorie C, Kantonsgruppe "uebrige", hoechster Tabellenwert 2495
    // Rappen/Stunde) -- sonst zeigte die Demo die Mindestlohnwarnung, was
    // in einem Verkaufsgespraech wie ein Fehler aussaehe.
    $ansatz = (int)$pdo2->query('SELECT ansatz_rappen FROM lohn_ansatz WHERE mitarbeiter_id = 1')->fetchColumn();
    pruef('KRITISCH: der erzeugte Lohnansatz liegt ueber dem hoechsten GAV-Mindestlohn-Tabellenwert 2026 fuer Kategorie C (2495 Rappen/Stunde)',
        $ansatz > 2495);

    $abzugSchluessel = $pdo2->query('SELECT schluessel FROM lohn_abzug ORDER BY schluessel')->fetchAll(PDO::FETCH_COLUMN);
    pruef('KRITISCH: alle drei betriebsweiten Abzugssaetze (nbu/ktg/bvg) sind vorhanden -- ohne sie bleibt jeder Lohnlauf auf der Abzugsseite gesperrt',
        $abzugSchluessel === ['bvg', 'ktg', 'nbu']);
    $ohneQuelle = (int)$pdo2->query("SELECT COUNT(*) FROM lohn_abzug WHERE quelle IS NULL OR quelle = '' OR quelle NOT LIKE '%Demo%'")->fetchColumn();
    pruef('Jeder erfundene Abzugssatz ist als Demo-Richtwert erkennbar, nicht als echte Police getarnt',
        $ohneQuelle === 0);
}

echo "\n" . $ok . ' bestanden, ' . count($bad) . " nicht bestanden\n";
if ($bad) { foreach ($bad as $b) { echo '  x ' . $b . "\n"; } exit(1); }
echo "Alle Pruefungen bestanden.\n";
