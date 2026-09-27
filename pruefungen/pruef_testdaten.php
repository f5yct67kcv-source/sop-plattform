<?php
declare(strict_types=1);
// Testdaten der Testseite (ENT-714) WIRKLICH erzeugen -- gegen eine SQLite-
// Datenbank mit dem ECHTEN Schema: Alle Tabellen und nachgetragenen Spalten
// kommen aus kern_tabellen()/kern_spalten(), nicht aus einer hier
// nachgebauten Liste. Eine Spalte, die der Erzeuger nennt und die es auf dem
// Server nicht gibt, faellt hier auf.
//
// Geprueft wird die AUSSAGE:
//  - Leeren laesst Konten mit Cockpit-Zugang stehen und nur diese.
//  - 15 Monate Geschichte, Rechnungen aus den abgeglichenen Stunden.
//  - Lohn und Auslagenersatz kommen aus den echten Rechenwegen.
//  - Die Sonderfaelle sind da (Entwurf, ohne Frist, bezahlt ohne Datum,
//    Storno mit Ersatz, Vormonat freigegeben, gesperrter Auslagenersatz,
//    unabgeglichene Schichten).
//  - Die Umgebungsweiche laesst NUR "staging" durch.

$ok = 0; $bad = [];
function pruef(string $name, bool $c): void { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    return (bool)$pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=" . $pdo->quote($t))->fetchColumn();
}
function hat_spalte(PDO $pdo, string $tabelle, string $spalte): bool {
    foreach ($pdo->query("PRAGMA table_info($tabelle)")->fetchAll(PDO::FETCH_ASSOC) as $z) {
        if ($z['name'] === $spalte) { return true; }
    }
    return false;
}

// db.php kommt ueber planung_einrichten_kern.php mit -- und damit das
// ECHTE umgebung_ist_staging(). hat_tabelle()/hat_spalte() sind dort nur
// definiert, wenn es sie noch nicht gibt; die SQLite-Fassungen oben gehen vor.
require_once __DIR__ . '/../backend/planung_einrichten_kern.php';
require_once __DIR__ . '/../backend/rechte.php';
require_once __DIR__ . '/../backend/api/testdaten.php';
require_once __DIR__ . '/../backend/planung_einrichten_kern.php';

// ── Das echte Schema nach SQLite ─────────────────────────────────────
// Typen fallen weg (SQLite ist ohnehin locker), Voreinstellungen bleiben --
// ist_status 'offen', aktiv 1, bezahlt 0 tragen Bedeutung.
function sqlite_spalte(string $zeile): ?string {
    if (!preg_match('/^`?([a-z_][a-z0-9_]*)`?\s+(.*)$/i', trim($zeile), $t)) { return null; }
    $name = $t[1]; $rest = $t[2];
    if (preg_match('/AUTO_INCREMENT/i', $rest)) { return "$name INTEGER PRIMARY KEY AUTOINCREMENT"; }
    // Den Typ als SQLite-Affinitaet behalten: Ohne sie vergleicht SQLite eine
    // gebundene "2" nicht mit der gespeicherten 2 -- MySQL tut das.
    $typ = preg_match('/^(TINYINT|SMALLINT|MEDIUMINT|BIGINT|INT)\b/i', $rest) ? ' INTEGER'
         : (preg_match('/^(DECIMAL|FLOAT|DOUBLE)\b/i', $rest) ? ' NUMERIC' : ' TEXT');
    $def = '';
    if (preg_match("/DEFAULT\s+('(?:[^']*)'|-?\d+(?:\.\d+)?)/i", $rest, $d)) { $def = ' DEFAULT ' . $d[1]; }
    elseif (preg_match('/DEFAULT\s+CURRENT_TIMESTAMP/i', $rest)) { $def = ' DEFAULT CURRENT_TIMESTAMP'; }
    return $name . $typ . $def;
}
function sqlite_schema(PDO $pdo): void {
    foreach (kern_tabellen() as $tabelle => $sql) {
        // Nur die EINE Tabellendefinition: von der ersten Klammer bis zu
        // ") ENGINE" -- ein Kommentar kann das Wort CREATE ein zweites Mal tragen.
        $auf = strpos($sql, '(');
        $zu = stripos($sql, ') ENGINE', $auf);
        if ($zu === false) { $zu = strrpos($sql, ')'); }
        $spalten = [];
        foreach (explode("\n", substr($sql, $auf + 1, $zu - $auf - 1)) as $z) {
            $z = preg_replace('/--.*$/', '', $z);
            $z = rtrim(trim($z), ',');
            if ($z === '' || preg_match('/^(PRIMARY|UNIQUE|KEY|INDEX|FOREIGN|CONSTRAINT|FULLTEXT)\b/i', $z)) { continue; }
            $s = sqlite_spalte($z);
            if ($s) { $spalten[] = $s; }
        }
        if ($spalten) { $pdo->exec("CREATE TABLE IF NOT EXISTS $tabelle (" . implode(', ', $spalten) . ')'); }
    }
    foreach (kern_spalten() as $e) {
        [$tabelle, $spalte, $alter] = $e;
        if (!hat_tabelle($pdo, $tabelle) || hat_spalte($pdo, $tabelle, $spalte)) { continue; }
        if (!preg_match('/ADD COLUMN\s+`?' . preg_quote($spalte, '/') . '`?\s+(.*?)(?:,\s*ADD\s|$)/is', $alter, $m)) { continue; }
        $s = sqlite_spalte($spalte . ' ' . preg_replace('/\bAFTER\s+\w+/i', '', $m[1]));
        if ($s && !str_contains($s, 'PRIMARY')) { $pdo->exec("ALTER TABLE $tabelle ADD COLUMN $s"); }
    }
}

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
// REGEXP fuer beleg_naechste_nummer().
$pdo->sqliteCreateFunction('REGEXP', fn($m, $w) => preg_match('/' . $m . '/', (string)$w) ? 1 : 0, 2);
sqlite_schema($pdo);
foreach (['mitarbeiter', 'mitarbeiter_rollen', 'rollen', 'einsaetze', 'einsatz_zuteilung', 'einsatz_auslagen',
          'belege', 'beleg_positionen', 'lohnlauf', 'lohnlauf_person', 'lohn_ansatz', 'produkte'] as $t) {
    pruef("Schema: Tabelle $t ist da", hat_tabelle($pdo, $t));
}
// Die Systemrollen wie nach der Einrichtung -- ueber dieselbe Funktion wie der Demo-Reset.
require_once __DIR__ . '/../backend/demo_reset.php';
demo_reset_systemrollen_saeen($pdo);

// Bestand vor dem Leeren: zwei Cockpit-Konten, eine Person ohne Cockpit,
// ein Kunde, ein Beleg -- und eine Tabelle, die ein spaeteres Feature
// anlegen koennte.
// Seit ENT-684 traegt jedes Konto eine Personalnummer -- auch die, die
// stehen bleiben. Sie duerfen nicht in die Planung rutschen.
$pdo->exec("INSERT INTO mitarbeiter (id, name, password_hash, ist_admin, personalnummer, vorname, nachname) VALUES
            (1, 'staging-admin', 'x', 1, '001', 'Staging', 'Admin'), (2, 'qa-admin', 'x', 0, '002', 'QA', 'Admin'),
            (3, 'alt.person', 'x', 0, '003', 'Alt', 'Person')");
$pdo->exec("INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (1, 'administrator'), (2, 'verwaltung'), (3, 'mitarbeitend')");
$pdo->exec("INSERT INTO kunden (name) VALUES ('Alter Kunde')");
$pdo->exec("INSERT INTO sessions (token, mitarbeiter_id) VALUES ('abdruck1', 1)");
$pdo->exec('CREATE TABLE kuenftiges_feature (id INTEGER PRIMARY KEY, wert TEXT)');
$pdo->exec("INSERT INTO kuenftiges_feature (wert) VALUES ('alt')");
$pdo->exec("INSERT INTO lohnart (schluessel, bezeichnung) VALUES ('grundlohn', 'Grundlohn')");

// ── Umgebungsweiche ──────────────────────────────────────────────────
pruef('KRITISCH: "staging" ist Staging', umgebung_ist_staging('staging'));
pruef('KRITISCH: "production" ist NICHT Staging', !umgebung_ist_staging('production'));
pruef('KRITISCH: "demo" ist NICHT Staging', !umgebung_ist_staging('demo'));
pruef('KRITISCH: ein unersetzter Platzhalter ist NICHT Staging', !umgebung_ist_staging('__APP_ENV__'));
pruef('KRITISCH: "Staging" (Grossschreibung) ist NICHT Staging -- fail-safe', !umgebung_ist_staging('Staging'));
pruef('KRITISCH: leer ist NICHT Staging', !umgebung_ist_staging(''));

// ── Leeren ───────────────────────────────────────────────────────────
$l = td_leeren($pdo);
$ids = $pdo->query('SELECT id FROM mitarbeiter ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
pruef('KRITISCH: beide Cockpit-Konten bleiben', array_map('intval', $ids) === [1, 2]);
pruef('KRITISCH: die Person ohne Cockpit ist weg', !in_array(3, array_map('intval', $ids), true));
pruef('Ihre Rollenzeile ist mit weg', (int)$pdo->query('SELECT COUNT(*) FROM mitarbeiter_rollen WHERE mitarbeiter_id = 3')->fetchColumn() === 0);
pruef('KRITISCH: die Sitzung der Verwaltung bleibt (niemand fliegt raus)', (int)$pdo->query('SELECT COUNT(*) FROM sessions')->fetchColumn() === 1);
pruef('Kunden sind geleert', (int)$pdo->query('SELECT COUNT(*) FROM kunden')->fetchColumn() === 0);
pruef('KRITISCH: auch eine Tabelle, die kein Code hier kennt, wird geleert',
    (int)$pdo->query('SELECT COUNT(*) FROM kuenftiges_feature')->fetchColumn() === 0);
pruef('Der Lohnartenkatalog bleibt', (int)$pdo->query('SELECT COUNT(*) FROM lohnart')->fetchColumn() === 1);
pruef('Die Systemrollen bleiben', (int)$pdo->query('SELECT COUNT(*) FROM rollen')->fetchColumn() > 0);

// Gegenprobe: ohne Cockpit-Konto bricht das Leeren ab, bevor es etwas tut.
$leer = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
sqlite_schema($leer);
$leer->exec("INSERT INTO mitarbeiter (id, name, password_hash, ist_admin) VALUES (5, 'nur.person', 'x', 0)");
$leer->exec("INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (5, 'mitarbeitend')");
$leer->exec("INSERT INTO kunden (name) VALUES ('Bleibt')");
$abbruch = false;
try { td_leeren($leer); } catch (TestdatenFehler $e) { $abbruch = true; }
pruef('KRITISCH: ohne Konto mit Cockpit-Zugang bricht das Leeren ab', $abbruch);
pruef('KRITISCH: ... und hat dann nichts geleert', (int)$leer->query('SELECT COUNT(*) FROM kunden')->fetchColumn() === 1);

// ── Befuellen ────────────────────────────────────────────────────────
// "Heute" aus dem Regelwerk abgeleitet, nicht fest geschrieben
// (test_datumsfest.mjs): elf Tage vor dem Ende des juengsten GAV-
// Regelwerks. So liegen die letzten Monate sicher in einem Regelwerk --
// und die aeltesten davor, wo der Lohnlauf richtigerweise nichts rechnet.
$regelEnde = max(array_column(GAVZEIT_REGELWERK, 'bis'));
$regelAnfang = min(array_column(array_filter(GAVZEIT_REGELWERK, fn($r) => $r['bis'] === $regelEnde), 'ab'));
$H = (new DateTimeImmutable($regelEnde))->modify('-11 days');
$HEUTE = $H->format('Y-m-d');
$M = fn(int $v) => $H->modify('first day of this month')->modify(($v >= 0 ? '+' : '') . $v . ' months')->format('Y-m');
$T = fn(int $v) => $H->modify(($v >= 0 ? '+' : '') . $v . ' days')->format('Y-m-d');
$pdo->beginTransaction();
$st = td_stammdaten($pdo);
$pdo->commit();
pruef('30 Mitarbeitende', $st['mitarbeitende'] === 30);
pruef('12 Kunden', $st['kunden'] === 12);
pruef('18 Objekte', $st['objekte'] === 18);
$namen = array_map(fn($m) => $m[0] . ' ' . $m[1], td_mitarbeiterliste());
pruef('Keine zwei Personen mit demselben Namen', count($namen) === count(array_unique($namen)));

$monate = td_monate($HEUTE);
pruef('KRITISCH: 15 Monate Geschichte bis zum laufenden', count($monate) === 15 && end($monate) === $M(0) && $monate[0] === $M(-14));
foreach ($monate as $m) { $pdo->beginTransaction(); td_monat($pdo, $m, $HEUTE); $pdo->commit(); }
$pdo->beginTransaction(); $ab = td_abschluss($pdo, $HEUTE); $pdo->commit();

$n = fn(string $sql, array $p = []) => (function () use ($pdo, $sql, $p) { $s = $pdo->prepare($sql); $s->execute($p); return $s->fetchColumn(); })();

pruef('KRITISCH: die stehengebliebenen Konten sind nirgends eingeteilt',
    (int)$n('SELECT COUNT(*) FROM einsatz_zuteilung WHERE mitarbeiter_id IN (1, 2)') === 0);
pruef('KRITISCH: und in keinem Lohnlauf', (int)$n('SELECT COUNT(*) FROM lohnlauf_person WHERE mitarbeiter_id IN (1, 2)') === 0);
pruef('Die Zusammenfassung zaehlt nur die erfundenen Personen', td_zusammenfassung($pdo)['mitarbeitende'] === 30);
// Niemand an zwei Orten gleichzeitig.
$doppelt = (int)$n('SELECT COUNT(*) FROM (SELECT z.mitarbeiter_id, e.datum FROM einsatz_zuteilung z JOIN einsaetze e ON e.id = z.einsatz_id
                    GROUP BY z.mitarbeiter_id, e.datum HAVING COUNT(*) > 1)');
pruef('KRITISCH: niemand ist am selben Tag zweimal eingeteilt', $doppelt === 0);

// Abgleich: bis drei Tage vor heute, danach offen.
pruef('Vergangene Schichten sind abgeglichen', (int)$n("SELECT COUNT(*) FROM einsaetze WHERE datum <= ? AND ist_status = 'anwesend'", [$T(-3)]) > 5000);
pruef('KRITISCH: die letzten Tage bleiben offen (Hinweis "nicht abgeglichen")',
    (int)$n("SELECT COUNT(*) FROM einsaetze WHERE datum BETWEEN ? AND ? AND ist_status = 'offen'", [$T(-2), $T(-1)]) > 0);
pruef('KRITISCH: keine Zukunft ist abgeglichen', (int)$n("SELECT COUNT(*) FROM einsaetze WHERE datum >= ? AND ist_status <> 'offen'", [$HEUTE]) === 0);
pruef('Planung reicht drei Wochen nach vorne', (string)$n('SELECT MAX(datum) FROM einsaetze') >= $T(20));

// Stundenlast bleibt unter dem Zeitzuschlag (210 h), sonst waere jeder Lauf voller Zuschlaege.
$maxMin = (int)$n("SELECT MAX(s) FROM (SELECT z.mitarbeiter_id, substr(e.datum,1,7) AS m, COUNT(*) * 540 AS s
                   FROM einsatz_zuteilung z JOIN einsaetze e ON e.id = z.einsatz_id GROUP BY z.mitarbeiter_id, m)");
pruef('Keine Person ueber rund 210 Stunden im Monat', $maxMin <= 210 * 60);

// Auslagenersatz ueber auslagen_zeile(): jede Zone kommt vor, und die Person
// ohne Verkehrsmittel ist gesperrt statt 0.
$zonen = $pdo->query('SELECT DISTINCT zone_schluessel FROM einsatz_auslagen WHERE zone_schluessel IS NOT NULL')->fetchAll(PDO::FETCH_COLUMN);
sort($zonen);
pruef('KRITISCH: Auslagenersatz in allen vier Zonen', $zonen === ['anstellungsgebiet', 'pauschalzone1', 'pauschalzone2', 'regiezone']);
pruef('KRITISCH: gesperrter Auslagenersatz vorhanden (Verkehrsmittel unbekannt) -- ohne Betrag',
    (int)$n("SELECT COUNT(*) FROM einsatz_auslagen WHERE gesperrt_grund = 'verkehrsmittel_unbekannt' AND fahrkostenersatz_rappen IS NULL") > 0);
$refTag = $M(-3) . '-03';
$ref = auslagen_zeile('sicherheit', $refTag, 22.0, 'Privatfahrzeug', null, false);
pruef('Referenz liegt im Regelwerk (sonst prueft der Vergleich nichts)', $ref['fahrzeitersatz_rappen'] > 0);
pruef('KRITISCH: Betrag = auslagen_zeile() (kein eigener Rechenweg)',
    (int)$n("SELECT COUNT(*) FROM einsatz_auslagen a JOIN einsaetze e ON e.id = a.einsatz_id
             WHERE e.datum = ? AND a.weg_km = 22 AND a.verkehrsmittel = 'Privatfahrzeug'
               AND a.fahrzeitersatz_rappen = ? AND a.fahrkostenersatz_rappen = ?",
            [$refTag, $ref['fahrzeitersatz_rappen'], $ref['fahrkostenersatz_rappen']]) > 0);

// Rechnungen
$re = (int)$n("SELECT COUNT(*) FROM belege WHERE art = 'rechnung'");
pruef('Viele Rechnungen (Monat x Kunde + Anlaesse)', $re > 150);
pruef('KRITISCH: jede Rechnung traegt Summen aus beleg_summen_schreiben()',
    (int)$n("SELECT COUNT(*) FROM belege WHERE art = 'rechnung' AND (total_rappen <= 0 OR mwst_rappen <= 0)") === 0);
// Eine Monatsrechnung = abgeglichene Stunden x Satz: Maerz 2025, Objekt Datacenter.
$minDc = (int)$n("SELECT SUM((CASE WHEN ist_bis < ist_von THEN 1440 ELSE 0 END) + (CAST(substr(ist_bis,1,2) AS INT)*60 + CAST(substr(ist_bis,4,2) AS INT))
                  - (CAST(substr(ist_von,1,2) AS INT)*60 + CAST(substr(ist_von,4,2) AS INT)) - ist_pause_min)
                  FROM einsaetze e JOIN objekte o ON o.id = e.objekt_id WHERE o.name = 'Datacenter Jurafuss' AND e.datum LIKE ?", [$M(-3) . '-%']);
$mengeDc = (float)$n("SELECT p.menge FROM beleg_positionen p JOIN belege b ON b.id = p.beleg_id
                      WHERE p.beschreibung = ?", ['Datacenter Jurafuss, ' . td_monat_text($M(-3))]);
pruef('KRITISCH: die Monatsrechnung verrechnet genau die abgeglichenen Stunden', $minDc > 0 && abs($mengeDc - round($minDc / 60, 2)) < 0.001);
pruef('Kein Monat ist zweimal verrechnet',
    (int)$n("SELECT COUNT(*) FROM (SELECT beschreibung FROM beleg_positionen GROUP BY beschreibung, beleg_id HAVING COUNT(*) > 1)") === 0);
pruef('KRITISCH: der laufende Monat ist noch nicht verrechnet (Monatsrechnung)',
    (int)$n("SELECT COUNT(*) FROM beleg_positionen WHERE beschreibung LIKE ?", ['%' . td_monat_text($M(0))]) === 0);
pruef('Offene Rechnungen gibt es (nicht alles bezahlt)', (int)$n("SELECT COUNT(*) FROM belege WHERE art='rechnung' AND aktiv=1 AND bezahlt=0 AND status<>'entwurf'") > 3);
pruef('Ueberfaellig ueber 60 Tage gibt es', (int)$n("SELECT COUNT(*) FROM belege WHERE art='rechnung' AND aktiv=1 AND bezahlt=0 AND faellig_bis < ?", [$T(-60)]) > 0);
pruef('KRITISCH: kein Zahldatum liegt in der Zukunft', (int)$n("SELECT COUNT(*) FROM belege WHERE bezahlt_am > ?", [$HEUTE]) === 0);
pruef('Sonderfall: zwei Entwuerfe', (int)$n("SELECT COUNT(*) FROM belege WHERE art='rechnung' AND status='entwurf'") === 2);
pruef('Sonderfall: offen ohne Faelligkeit', (int)$n("SELECT COUNT(*) FROM belege WHERE art='rechnung' AND faellig_bis IS NULL AND bezahlt=0") === 1);
pruef('Sonderfall: bezahlt ohne Zahldatum', (int)$n("SELECT COUNT(*) FROM belege WHERE art='rechnung' AND bezahlt=1 AND bezahlt_am IS NULL") === 1);
pruef('Sonderfall: eine archivierte', (int)$n("SELECT COUNT(*) FROM belege WHERE art='rechnung' AND aktiv=0") === 1);
pruef('Offerten in allen Stati', (int)$n("SELECT COUNT(DISTINCT status) FROM belege WHERE art='offerte'") >= 5);
pruef('Rechnungsnummern sind eindeutig', (int)$n("SELECT COUNT(*) FROM (SELECT nummer FROM belege WHERE art='rechnung' GROUP BY nummer HAVING COUNT(*)>1)") === 0);

// Lohnlaeufe ueber den echten Lohnlauf
$mitLaufVorab = count(array_filter($monate, fn($m) => $m . '-01' >= $regelAnfang && $m < $M(0)));
pruef('KRITISCH: ein Lauf je abgeschlossenem Monat im Regelwerk plus der stornierte', (int)$n('SELECT COUNT(*) FROM lohnlauf') === $mitLaufVorab + 1);
pruef('KRITISCH: kein Lauf fuer den laufenden Monat', (int)$n("SELECT COUNT(*) FROM lohnlauf WHERE periode_von >= ?", [$M(0) . '-01']) === 0);
pruef('KRITISCH: der Vormonat ist freigegeben, nicht ausbezahlt',
    (string)$n("SELECT status FROM lohnlauf WHERE periode_von = ?", [$M(-1) . '-01']) === 'freigegeben');
pruef('KRITISCH: Storno mit Ersatz im dritten Monat zurueck',
    (int)$n("SELECT COUNT(*) FROM lohnlauf WHERE periode_von = ? AND status = 'storniert'", [$M(-3) . '-01']) === 1
    && (int)$n("SELECT COUNT(*) FROM lohnlauf WHERE periode_von = ? AND status = 'ausbezahlt' AND ersetzt_lauf_id IS NOT NULL", [$M(-3) . '-01']) === 1);
pruef('Bruttolohn ist gerechnet', (int)$n("SELECT SUM(p.brutto_rappen) FROM lohnlauf_person p JOIN lohnlauf l ON l.id = p.lauf_id WHERE l.periode_von = ?", [$M(-4) . '-01']) > 0);
// Monate vor dem Regelwerk bekommen KEINEN Lauf (sonst stuende dort ein
// Lauf voller gesperrter Personen mit Bruttolohn 0).
$ohneRegel = array_values(array_filter($monate, fn($m) => $m . '-01' < $regelAnfang));
pruef('Es gibt Monate vor dem Regelwerk (sonst prueft das Folgende nichts)', count($ohneRegel) > 0);
pruef('KRITISCH: fuer Monate vor dem Regelwerk entsteht kein Lohnlauf',
    (int)$n('SELECT COUNT(*) FROM lohnlauf WHERE periode_von < ?', [$regelAnfang]) === 0);
pruef('KRITISCH: kein Lauf traegt eine gesperrte Person wegen fehlendem Regelwerk',
    (int)$n("SELECT COUNT(*) FROM lohnlauf_person WHERE gesperrt_grund = 'kein_regelwerk'") === 0);
$mitLauf = count(array_filter($monate, fn($m) => $m . '-01' >= $regelAnfang && $m < $M(0)));

// Die Finanz-Kostenseite liest das alles richtig.
$k = fin_kosten($pdo, ['rechte' => ['lohn_lesen', 'auslagen_lesen']], $M(-14), $M(0),
                ['lohnlauf' => true, 'einsatz_auslagen' => true], $HEUTE);
$lm = (array)$k['lohn']['monate'];
pruef('Finanzen: jeder abgeschlossene Monat im Regelwerk hat Lohn, der laufende nicht', count($lm) === $mitLauf && !isset($lm[$M(0)]));
pruef('Finanzen: offene Schichten im laufenden Monat gemeldet', (((array)$k['auslagen']['offene_schichten'])[$M(0)] ?? 0) > 0);

$z = td_zusammenfassung($pdo);
pruef('Zusammenfassung zaehlt', $z['kunden'] === 12 && $z['lohnlaeufe'] === $mitLauf + 1 && $z['rechnungen'] === $re);

echo "pruef_testdaten: {$ok} gruen\n";
foreach ($bad as $b) { echo "- {$b}\n"; }
exit($bad ? 1 : 0);
