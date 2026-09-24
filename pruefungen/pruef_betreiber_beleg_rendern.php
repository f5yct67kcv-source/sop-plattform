<?php
// Rendert betreiber_beleg_oeffentlich.php WIRKLICH, gegen eine In-Memory-
// SQLite-Datenbank -- gleiche Bauart wie pruef_beleg_oeffentlich_rendern.php
// fuer die Cockpit-Seite (ENT-688).
//
// Bis hierher lief die Betreiberseite in keiner Pruefung: Alle Suiten lasen
// nur ihren Quelltext. Seit ENT-688 holt sie Kopf, Positionen, Summen und
// Anschrift aus dem Abbild einer Fassung -- ein Tippfehler an einem der
// Schluessel waere erst beim Empfaenger aufgefallen.
//
// Aufruf: php pruef_betreiber_beleg_rendern.php <variante>
//   ohne_fassung   versendet vor ENT-688: die Seite zeigt den Beleg wie bisher
//   fassung        Fassung 2 versendet, danach im Entwurf geaendert
//   verfaelscht    Fassung 2, deren Abbild nachtraeglich veraendert wurde
//   signatur       Unterschrift eingerichtet, noch offen: Dialog statt Klick
//   angenommen     mit Code angenommen: Protokoll und gefuellte Linien
//   abgelehnt      mit Name und Grund abgelehnt
//
// Gibt das fertige HTML auf stdout aus.
declare(strict_types=1);

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->sqliteCreateFunction('NOW', static fn(): string => date('Y-m-d H:i:s'));

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

$pdo->exec("CREATE TABLE be_briefkopf (id INTEGER PRIMARY KEY, firma TEXT, absender TEXT, uid TEXT DEFAULT '',
  mwst_nr TEXT DEFAULT '', iban TEXT DEFAULT '', qr_iban TEXT DEFAULT '', qr_strasse TEXT DEFAULT '',
  qr_hausnummer TEXT DEFAULT '', qr_plz TEXT DEFAULT '', qr_ort TEXT DEFAULT '', email TEXT DEFAULT '',
  telefon TEXT DEFAULT '', webseite TEXT DEFAULT '', logo TEXT)");
$pdo->exec("CREATE TABLE be_belege (id INTEGER PRIMARY KEY, versand_token TEXT, art TEXT, nummer TEXT,
  kunde_id INTEGER, person_id INTEGER, titel TEXT, referenz TEXT, datum TEXT, gueltig_bis TEXT,
  faellig_bis TEXT, rabatt_bp INTEGER, status TEXT, bezahlt INTEGER, bezahlt_am TEXT, entscheidung_am TEXT,
  oeffentliche_notizen TEXT, bedingungen TEXT, fusszeile_text TEXT, unterschriftsseite INTEGER)");
$pdo->exec("CREATE TABLE be_kunden (id INTEGER PRIMARY KEY, name TEXT, zusatzfeld TEXT, strasse TEXT,
  hausnummer TEXT, adresszusatz TEXT, plz TEXT, ort TEXT, email TEXT DEFAULT '')");
$pdo->exec("CREATE TABLE be_kunden_person (id INTEGER PRIMARY KEY, anrede TEXT, vorname TEXT, nachname TEXT)");
$pdo->exec("CREATE TABLE be_beleg_positionen (id INTEGER PRIMARY KEY, beleg_id INTEGER, sortierung INTEGER,
  produkt_id INTEGER, produkt_name TEXT, beschreibung TEXT, menge REAL, einheit TEXT,
  einzelpreis_rappen INTEGER, rabatt_bp INTEGER, mwst_satz_bp INTEGER)");

// Nur erfundene Angaben (Vertraulichkeitsregel in CLAUDE.md).
$pdo->exec("INSERT INTO be_briefkopf (id, firma, absender, email) VALUES
  (1, 'Beispiel Software GmbH', 'Beispielgasse 1\n9999 Musterhausen', 'post@beispiel.invalid')");
// Die Empfaengeradresse: ueber sie geht die Offerte ohne Code (ENT-708).
$pdo->exec("INSERT INTO be_kunden VALUES (1, 'Muster Sicherheit AG', NULL, 'Musterweg', '12', NULL, '3000', 'Musterstadt', 'einkauf@muster.invalid')");
$pdo->exec("INSERT INTO be_kunden_person VALUES (1, 'Frau', 'Erika', 'Beispiel')");
$pdo->exec("INSERT INTO be_belege VALUES (1, 'tok456', 'offerte', 'OF-0815', 1, 1, 'Lizenz 12 Monate', '',
  '2031-03-01', '2031-04-01', NULL, 0, 'versendet', 0, NULL, NULL, NULL, 'Zahlbar in 30 Tagen', NULL, 1)");
$pdo->exec("INSERT INTO be_beleg_positionen VALUES (1, 1, 0, NULL, 'Lizenz', 'zwölf Monate', 1, 'Stk.', 250000, 0, 810)");

require __DIR__ . '/../backend/betreiber.php';
require __DIR__ . '/../backend/belege.php';
require __DIR__ . '/../backend/qrrechnung.php';

$variante = $argv[1] ?? 'fassung';
if ($variante !== 'ohne_fassung') {
    $pdo->exec("CREATE TABLE be_beleg_fassung (id INTEGER PRIMARY KEY AUTOINCREMENT, beleg_id INTEGER,
      nummer INTEGER, abbild TEXT, pruefsumme TEXT, anlass TEXT DEFAULT 'versand',
      versendet_am TEXT, versendet_von TEXT DEFAULT '')");
    $abs = be_beleg_absender($pdo);
    beleg_fassung_anlegen($pdo, 1, beleg_abbild_lesen($pdo, 1, 'be_', $abs), 'versand', 'Pruefung', 'be_');
    // Nachgebessert: 2'200.00 statt 2'500.00, als Fassung 2 versendet.
    $pdo->exec("UPDATE be_beleg_positionen SET einzelpreis_rappen = 220000 WHERE beleg_id = 1");
    beleg_fassung_anlegen($pdo, 1, beleg_abbild_lesen($pdo, 1, 'be_', $abs), 'versand', 'Pruefung', 'be_');
    // Danach im Entwurf weiter geaendert, NICHT versendet -- dazu eine neue
    // Anschrift. Beides darf der Link nicht zeigen.
    $pdo->exec("UPDATE be_beleg_positionen SET einzelpreis_rappen = 111100 WHERE beleg_id = 1");
    $pdo->exec("UPDATE be_kunden SET strasse = 'Umzugsweg' WHERE id = 1");
    if ($variante === 'verfaelscht') {
        $pdo->exec("UPDATE be_beleg_fassung SET abbild = REPLACE(abbild, '220000', '120000') WHERE nummer = 2");
    }
}
if (in_array($variante, ['signatur', 'angenommen', 'abgelehnt'], true)) {
    $pdo->exec("CREATE TABLE be_beleg_unterschrift (id INTEGER PRIMARY KEY AUTOINCREMENT, beleg_id INTEGER,
      fassung INTEGER, art TEXT, name TEXT DEFAULT '', funktion TEXT DEFAULT '', firma TEXT DEFAULT '',
      email TEXT DEFAULT '', zeichnungsberechtigt INTEGER DEFAULT 0, zeichnung TEXT, grund TEXT,
      empfaenger_email TEXT DEFAULT '', code_abdruck TEXT DEFAULT '', code_gesendet_am TEXT,
      code_versuche INTEGER DEFAULT 0, bestaetigt_am TEXT, ip TEXT DEFAULT '', browser TEXT DEFAULT '',
      erstellt_am TEXT, pdf BLOB, pdf_pruefsumme TEXT DEFAULT '')");
}
if ($variante === 'angenommen') {
    $u = beleg_unterschrift_anlegen($pdo, 'be_', 1, 2, ['name' => 'Erika Beispiel', 'funktion' => 'Geschäftsführerin',
        'firma' => 'Muster Sicherheit AG', 'email' => 'leitung@muster.invalid', 'zeichnung' => ''],
        'post@muster.invalid', '192.0.2.10', 'Pruefbrowser/1.0');
    $pdo->exec("UPDATE be_beleg_unterschrift SET bestaetigt_am = NOW() WHERE id = " . (int)$u['id']);
    // Ein gespeichertes PDF (Schritt 3) -- der Inhalt spielt fuer die Seite
    // keine Rolle, nur dass eines da ist.
    $pdo->exec("UPDATE be_beleg_unterschrift SET pdf = '%PDF-1.3 Pruefung', pdf_pruefsumme = '"
        . hash('sha256', '%PDF-1.3 Pruefung') . "' WHERE id = " . (int)$u['id']);
    $pdo->exec("UPDATE be_belege SET status = 'bestaetigt', entscheidung_am = NOW() WHERE id = 1");
}
if ($variante === 'abgelehnt') {
    beleg_ablehnung_anlegen($pdo, 'be_', 1, 2, 'Rolf Muster', 'zu teuer', 'post@muster.invalid', '192.0.2.10', 'x');
    $pdo->exec("UPDATE be_belege SET status = 'abgelehnt', entscheidung_am = NOW() WHERE id = 1");
}

$quelle = file_get_contents(__DIR__ . '/../backend/api/betreiber_beleg_oeffentlich.php');
$quelle = preg_replace('/^<\?php\s*/', '', $quelle, 1);
$quelle = preg_replace('/^declare\(strict_types=1\);\s*$/m', '', $quelle);
$quelle = preg_replace('/^require(_once)? __DIR__ \. .*$/m', '', $quelle);
// betreiber.php bringt db.php mit, und dessen db() verbindet zu MySQL. Die
// Seite bekommt darum ihre Verbindung direkt -- sonst ist alles der echte
// Code.
$quelle = str_replace('betreiber_db()', '$GLOBALS[\'pdo\']', $quelle);

$_GET['token'] = 'tok456';
eval($quelle);
