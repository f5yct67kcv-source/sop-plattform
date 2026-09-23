<?php
// Die Fassungen eines Belegs (ENT-688) wirklich AUSFUEHREN -- nicht ihren
// Quelltext lesen.
//
// Warum diese Datei: An den Fassungen haengt, ob eine Annahme etwas beweist.
// Fuenf Aussagen davon sind Entscheidungen, und jede verschwaende lautlos,
// wenn sie nur als Wort im Code geprueft wuerde:
//
//   1. DASSELBE DOKUMENT ERGIBT DIESELBE PRUEFSUMME -- egal, ob MySQL die
//      Menge als "1.00" liefert oder SQLite als 1, und egal, ob ein leeres
//      Datum als NULL, '' oder 0000-00-00 ankommt. Sonst stuende jede
//      versendete Offerte nach dem naechsten Lesen als "geaendert" da.
//   2. OHNE AENDERUNG KEINE NEUE FASSUNG. Ein zweiter Versand ist eine
//      Erinnerung.
//   3. DIE SUMMEN STEHEN GERECHNET IM ABBILD und aendern sich nicht mit dem
//      Entwurf daneben.
//   4. EINE VERAENDERTE FASSUNG FAELLT AUF (Pruefsumme).
//   5. NUR DIE ANNAHME AM LINK SPERRT -- nicht ein Status von Hand, nicht
//      eine Ablehnung.
//
// Gegenproben stehen jeweils direkt bei der Pruefung.
declare(strict_types=1);

function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    $s = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?");
    $s->execute([$t]);
    return (bool)$s->fetchColumn();
}
function hat_spalte(PDO $pdo, string $tabelle, string $spalte): bool {
    if (!hat_tabelle($pdo, $tabelle)) { return false; }
    foreach ($pdo->query('PRAGMA table_info(' . $tabelle . ')')->fetchAll() as $z) {
        if (($z['name'] ?? '') === $spalte) { return true; }
    }
    return false;
}

require __DIR__ . '/../backend/betreiber.php';
require __DIR__ . '/../backend/belege.php';

$ok = 0; $bad = [];
$pruef = function (string $name, bool $bedingung) use (&$ok, &$bad) {
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
};

$db = new PDO('sqlite::memory:', null, null,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$db->sqliteCreateFunction('NOW', static fn(): string => date('Y-m-d H:i:s'));

$db->exec("CREATE TABLE be_belege (id INTEGER PRIMARY KEY AUTOINCREMENT, art TEXT, nummer TEXT,
  kunde_id INTEGER, person_id INTEGER, titel TEXT DEFAULT '', referenz TEXT DEFAULT '',
  datum TEXT, gueltig_bis TEXT, faellig_bis TEXT, status TEXT DEFAULT 'entwurf',
  bemerkung TEXT, rabatt_bp INTEGER DEFAULT 0, oeffentliche_notizen TEXT, bedingungen TEXT,
  fusszeile_text TEXT, unterschriftsseite INTEGER DEFAULT 0, versand_token TEXT,
  entscheidung_am TEXT, entscheidung_ip TEXT)");
$db->exec("CREATE TABLE be_beleg_positionen (id INTEGER PRIMARY KEY AUTOINCREMENT,
  beleg_id INTEGER, sortierung INTEGER DEFAULT 0, produkt_id INTEGER, produkt_name TEXT,
  beschreibung TEXT, menge REAL, einheit TEXT, einzelpreis_rappen INTEGER,
  rabatt_bp INTEGER DEFAULT 0, mwst_satz_bp INTEGER DEFAULT 810)");
$db->exec("CREATE TABLE be_kunden (id INTEGER PRIMARY KEY, name TEXT, zusatzfeld TEXT,
  strasse TEXT, hausnummer TEXT, adresszusatz TEXT, plz TEXT, ort TEXT)");
$db->exec("CREATE TABLE be_kunden_person (id INTEGER PRIMARY KEY, anrede TEXT, vorname TEXT, nachname TEXT)");

$db->exec("INSERT INTO be_kunden VALUES (1, 'Muster Sicherheit AG', '', 'Beispielweg', '4', '', '8000', 'Zürich')");
$db->exec("INSERT INTO be_kunden_person VALUES (1, 'Frau', 'Erika', 'Beispiel')");
$db->exec("INSERT INTO be_belege (art, nummer, kunde_id, person_id, titel, datum, gueltig_bis, status)
           VALUES ('offerte', 'OF-0815', 1, 1, 'Lizenz', '2031-03-01', NULL, 'entwurf')");
$db->exec("INSERT INTO be_beleg_positionen (beleg_id, produkt_name, beschreibung, menge, einheit, einzelpreis_rappen)
           VALUES (1, 'Lizenz', 'zwölf Monate', 1, 'Stk.', 250000)");

$absender = ['firma' => 'Beispiel GmbH', 'absender' => "Beispielgasse 1\n9999 Musterhausen", 'logo' => ''];

// ── 1. Eine Form, eine Pruefsumme ─────────────────────────────────────
$posMysql = [['produkt_name' => 'Lizenz', 'beschreibung' => 'x', 'menge' => '1.00', 'einheit' => 'Stk.',
              'einzelpreis_rappen' => '250000', 'rabatt_bp' => '0', 'mwst_satz_bp' => '810']];
$posSqlite = [['produkt_name' => 'Lizenz', 'beschreibung' => 'x', 'menge' => 1, 'einheit' => 'Stk.',
               'einzelpreis_rappen' => 250000, 'rabatt_bp' => 0, 'mwst_satz_bp' => 810]];
$kopfA = ['art' => 'offerte', 'nummer' => 'OF-1', 'datum' => '2031-03-01', 'gueltig_bis' => '0000-00-00',
          'rabatt_bp' => '0', 'unterschriftsseite' => '0'];
$kopfB = ['art' => 'offerte', 'nummer' => 'OF-1', 'datum' => '2031-03-01 00:00:00', 'gueltig_bis' => null,
          'rabatt_bp' => 0, 'unterschriftsseite' => 0];
$a = beleg_abbild($kopfA, $posMysql, null, null, $absender);
$b = beleg_abbild($kopfB, $posSqlite, null, null, $absender);
$pruef('KRITISCH: dasselbe Dokument aus MySQL und aus SQLite ergibt dieselbe Pruefsumme',
    beleg_pruefsumme(beleg_abbild_json($a)) === beleg_pruefsumme(beleg_abbild_json($b)));
// GEGENPROBE: Eine andere Menge ergibt eine andere Pruefsumme.
$posAnders = $posSqlite; $posAnders[0]['menge'] = 2;
$pruef('KRITISCH: GEGENPROBE — eine andere Menge ergibt eine andere Pruefsumme',
    beleg_pruefsumme(beleg_abbild_json(beleg_abbild($kopfB, $posAnders, null, null, $absender)))
    !== beleg_pruefsumme(beleg_abbild_json($b)));

$pruef('KRITISCH: die Summen stehen gerechnet im Abbild',
    (int)$a['summen']['total_rappen'] === beleg_summen($posSqlite)['total_rappen']
    && (int)$a['summen']['total_rappen'] > 0);

// Interne Felder gehoeren nicht ins Abbild -- sie stehen nicht auf dem Blatt,
// und ihre Aenderung darf keine Fassung ausloesen.
$mitIntern = $kopfB + ['bemerkung' => 'intern', 'status' => 'versendet', 'versand_token' => 'abc'];
$pruef('KRITISCH: interne Bemerkung, Status und Token stehen nicht im Abbild',
    beleg_pruefsumme(beleg_abbild_json(beleg_abbild($mitIntern, $posSqlite, null, null, $absender)))
    === beleg_pruefsumme(beleg_abbild_json($b)));

// Die Inhaltspruefsumme sieht nur Kopf und Positionen.
$andererAbsender = beleg_abbild($kopfB, $posSqlite, null, null, ['firma' => 'Andere GmbH']);
$pruef('KRITISCH: ein neuer Briefkopf aendert den Inhalt nicht …',
    beleg_inhalt_pruefsumme($andererAbsender) === beleg_inhalt_pruefsumme($b));
$pruef('… aber sehr wohl das ganze Abbild, das versendet wird',
    beleg_pruefsumme(beleg_abbild_json($andererAbsender)) !== beleg_pruefsumme(beleg_abbild_json($b)));

// ── 2. Ohne Tabelle bricht nichts ─────────────────────────────────────
$pruef('KRITISCH: ohne Tabelle gibt es keine Fassungen, statt eines Fehlers',
    beleg_fassung_tabelle_da($db, 'be_') === false
    && beleg_fassungen($db, 1, 'be_') === []
    && beleg_letzte_fassung($db, 1, 'be_') === null);

$db->exec("CREATE TABLE be_beleg_fassung (id INTEGER PRIMARY KEY AUTOINCREMENT, beleg_id INTEGER,
  nummer INTEGER, abbild TEXT, pruefsumme TEXT, anlass TEXT DEFAULT 'versand',
  versendet_am TEXT, versendet_von TEXT DEFAULT '', UNIQUE (beleg_id, nummer))");
$pruef('… und mit Tabelle meldet dieselbe Auskunft, dass es sie gibt',
    beleg_fassung_tabelle_da($db, 'be_') === true);

// ── 3. Anlegen, Erinnern, Nachbessern ─────────────────────────────────
$abbild1 = beleg_abbild_lesen($db, 1, 'be_', $absender);
$pruef('KRITISCH: das Abbild traegt die Anschrift, wie sie heute im Adressbestand steht',
    ($abbild1['kunde']['name'] ?? '') === 'Muster Sicherheit AG'
    && ($abbild1['person']['nachname'] ?? '') === 'Beispiel');

$f1 = beleg_fassung_anlegen($db, 1, $abbild1, 'versand', 'A. Muster', 'be_');
$pruef('KRITISCH: der erste Versand legt Fassung 1 an', $f1 === ['nummer' => 1, 'neu' => true]);

$f1b = beleg_fassung_anlegen($db, 1, beleg_abbild_lesen($db, 1, 'be_', $absender), 'versand', 'A. Muster', 'be_');
$pruef('KRITISCH: ein zweiter Versand ohne Aenderung ist eine Erinnerung, keine Fassung',
    $f1b === ['nummer' => 1, 'neu' => false] && count(beleg_fassungen($db, 1, 'be_')) === 1);

$stand = beleg_fassung_stand($db, beleg_lesen($db, 1, 'be_'), 'be_', $absender);
$pruef('KRITISCH: direkt nach dem Versand ist nichts geaendert',
    $stand['fassung_geaendert'] === false && count($stand['fassungen']) === 1);

// Der Entwurf aendert sich: neuer Preis.
$db->exec("UPDATE be_beleg_positionen SET einzelpreis_rappen = 200000 WHERE beleg_id = 1");
$stand = beleg_fassung_stand($db, beleg_lesen($db, 1, 'be_'), 'be_', $absender);
$pruef('KRITISCH: nach einer Aenderung zeigt das Formular "geaendert, noch nicht versendet"',
    $stand['fassung_geaendert'] === true);

$letzte = beleg_letzte_fassung($db, 1, 'be_');
$pruef('KRITISCH: der Link zeigt weiter den versendeten Preis, nicht den Entwurf',
    (int)$letzte['abbild']['summen']['total_rappen'] === (int)$abbild1['summen']['total_rappen']
    && (int)$letzte['abbild']['beleg']['positionen'][0]['einzelpreis_rappen'] === 250000);

// Ein neuer Briefkopf allein ist keine Aenderung im Formular.
$db->exec("UPDATE be_beleg_positionen SET einzelpreis_rappen = 250000 WHERE beleg_id = 1");
$stand = beleg_fassung_stand($db, beleg_lesen($db, 1, 'be_'), 'be_', ['firma' => 'Neue Firma GmbH']);
$pruef('KRITISCH: ein neuer Briefkopf stellt nicht jeden versendeten Beleg auf "geaendert"',
    $stand['fassung_geaendert'] === false);

$db->exec("UPDATE be_beleg_positionen SET einzelpreis_rappen = 200000 WHERE beleg_id = 1");
$naechste = beleg_fassung_naechste($db, 1, beleg_abbild_lesen($db, 1, 'be_', $absender), 'be_');
$pruef('KRITISCH: vor dem Versand weiss die Mail, dass es Fassung 2 wird',
    $naechste === ['nummer' => 2, 'neu' => true]);
$f2 = beleg_fassung_anlegen($db, 1, beleg_abbild_lesen($db, 1, 'be_', $absender), 'versand', 'A. Muster', 'be_');
$pruef('KRITISCH: die Nachbesserung legt Fassung 2 an, und Fassung 1 bleibt stehen',
    $f2 === ['nummer' => 2, 'neu' => true] && count(beleg_fassungen($db, 1, 'be_')) === 2
    && (int)beleg_letzte_fassung($db, 1, 'be_')['abbild']['beleg']['positionen'][0]['einzelpreis_rappen'] === 200000);

// Fassungen gehoeren ihrem Beleg.
$pruef('KRITISCH: die Fassungen gehoeren ihrem Beleg und sonst niemandem',
    beleg_fassungen($db, 2, 'be_') === [] && beleg_letzte_fassung($db, 2, 'be_') === null);

// ── 4. Eine veraenderte Fassung faellt auf ────────────────────────────
$pruef('KRITISCH: eine unberuehrte Fassung gilt als echt', beleg_letzte_fassung($db, 1, 'be_')['echt'] === true);
$db->exec("UPDATE be_beleg_fassung SET abbild = REPLACE(abbild, '200000', '100000') WHERE nummer = 2");
$pruef('KRITISCH: eine nachtraeglich veraenderte Fassung gilt nicht mehr als echt',
    beleg_letzte_fassung($db, 1, 'be_')['echt'] === false);

// ── 5. Was sperrt ─────────────────────────────────────────────────────
$pruef('KRITISCH: die Annahme am Link sperrt',
    beleg_gesperrt(['status' => 'bestaetigt', 'entscheidung_am' => '2031-03-02 10:00:00']) === true);
$pruef('KRITISCH: ein Status "bestaetigt" von Hand sperrt nicht — da gibt es kein angenommenes Abbild',
    beleg_gesperrt(['status' => 'bestaetigt', 'entscheidung_am' => null]) === false);
$pruef('KRITISCH: eine Ablehnung sperrt nicht — nachbessern bleibt moeglich',
    beleg_gesperrt(['status' => 'abgelehnt', 'entscheidung_am' => '2031-03-02 10:00:00']) === false);

// ── 6. Die Mail sagt "angepasst", nicht "neu" ─────────────────────────
$mail1 = beleg_mail(['art' => 'offerte', 'nummer' => 'OF-0815', 'datum' => '2031-03-01'],
    'Beispiel GmbH', 'https://beispiel.invalid/x', '', []);
$mail2 = beleg_mail(['art' => 'offerte', 'nummer' => 'OF-0815', 'datum' => '2031-03-01'],
    'Beispiel GmbH', 'https://beispiel.invalid/x', '', [], 2);
$pruef('KRITISCH: die erste Fassung kommt als neue Offerte',
    str_starts_with($mail1['betreff'], 'Neue Offerte') && str_contains($mail1['text'], 'eine neue Offerte'));
$pruef('KRITISCH: ab der zweiten heisst sie angepasst — im Betreff, im Text und im HTML',
    str_starts_with($mail2['betreff'], 'Angepasste Offerte OF-0815')
    && str_contains($mail2['text'], 'angepasst') && !str_contains($mail2['text'], 'eine neue Offerte')
    && str_contains($mail2['html'], 'angepasst') && !str_contains($mail2['html'], 'eine neue Offerte'));

// ── 7. Kein Schreibweg an eine bestehende Fassung ─────────────────────
// Gesucht wird im ganzen Backend. Das Anlegen ist ein INSERT; alles andere
// an diesen Tabellen waere ein Leck in der Beweiskraft.
$treffer = [];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(__DIR__ . '/../backend'));
foreach ($it as $datei) {
    if (!$datei->isFile() || substr($datei->getFilename(), -4) !== '.php') { continue; }
    $code = (string)file_get_contents($datei->getPathname());
    if (preg_match('/(UPDATE|DELETE\s+FROM|REPLACE\s+INTO|TRUNCATE(\s+TABLE)?)\s+[`\'"{]*(be_)?beleg_fassung\b/i', $code)) {
        $treffer[] = $datei->getFilename();
    }
    // Der Tabellenname kann auch ueber beleg_tabelle(..., 'beleg_fassung')
    // zusammengesetzt sein.
    if (preg_match('/(UPDATE|DELETE\s+FROM|REPLACE\s+INTO|TRUNCATE)[^;]{0,80}beleg_tabelle\([^)]*\'beleg_fassung\'/i', $code)) {
        $treffer[] = $datei->getFilename();
    }
}
$pruef('KRITISCH: im Backend aendert oder loescht nichts eine Fassung (' . implode(', ', $treffer) . ')',
    $treffer === []);

echo count($bad) === 0
    ? "$ok bestanden, 0 nicht bestanden\n"
    : "$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "x $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
