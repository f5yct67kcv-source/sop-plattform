<?php
// Finanzen der Betreiberin (ENT-725) WIRKLICH ausfuehren -- gegen SQLite.
//
// Geprueft werden die Aussagen, nicht der Wortlaut:
//   1. Netto aus brutto, nur mit den erlaubten Saetzen ab ihrem Datum.
//   2. Eine Vorlage bucht jeden faelligen Monat genau einmal, nichts in
//      der Zukunft, und ein archivierter Monat kommt nicht zurueck.
//   3. "CHF-Betrag fehlt" ist nie 0: Mit Vormonat geschaetzt (und als
//      geschaetzt ausgewiesen), ohne Grundlage gezaehlt als "fehlt".
//   4. Eine Vorlagenaenderung trifft nur unberuehrte Monate ab "gilt ab".
//   5. Der wiederkehrende Umsatz ist exkl. MWST, zaehlt je Mandant nur den
//      juengsten angenommenen Vertrag und nur laufende Mandanten.
//   6. Die Eingabepruefung sperrt im Server, was die Oberflaeche verhindert.
//
// Gegenproben: in test_betreiber_finanzen.mjs beschrieben und beim Bau
// ausgefuehrt.
declare(strict_types=1);

// Mit Gedaechtnis wie das Original in db.php: Ohne $frisch gilt die erste
// Antwort fuer die ganze Anfrage. Genau daran ist die Startliste der
// Kategorien beim ersten Einrichtungslauf einmal gescheitert.
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    static $gedaechtnis = [];
    $schluessel = spl_object_hash($pdo) . '|' . $t;
    if (!$frisch && array_key_exists($schluessel, $gedaechtnis)) { return $gedaechtnis[$schluessel]; }
    $s = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?");
    $s->execute([$t]);
    return $gedaechtnis[$schluessel] = (bool)$s->fetchColumn();
}

require __DIR__ . '/../backend/betreiber_finanzen.php';

$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// ── 1. Netto und Saetze ──────────────────────────────────────────────
check('8.1 %: 108.10 brutto sind 100.00 netto', be_aus_netto(10810, 810) === 10000);
check('0 %: netto ist brutto', be_aus_netto(4999, 0) === 4999);
check('2.6 %: kaufmaennisch gerundet', be_aus_netto(1000, 260) === 975);
check('8.1 % gilt ab 2024-01-01', be_aus_mwst_gueltig(810, '2024-01-01'));
check('8.1 % gilt nicht vor 2024', !be_aus_mwst_gueltig(810, '2023-12-31'));
check('0 % gilt immer', be_aus_mwst_gueltig(0, '2001-05-01'));
check('KRITISCH: ein freier Satz (7.7 %) wird abgelehnt', !be_aus_mwst_gueltig(770, '2025-05-01'));

// ── Monate ────────────────────────────────────────────────────────────
check('Monat plus 1 ueber den Jahreswechsel', be_aus_monat_plus('2024-12', 1) === '2025-01');
check('Monat minus 1 ueber den Jahreswechsel', be_aus_monat_plus('2025-01', -1) === '2024-12');
check('Monat minus 13', be_aus_monat_plus('2025-01', -13) === '2023-12');
check('Beginn am 31. bucht im Februar am 28.', be_aus_tag_im_monat('2025-02', 31) === '2025-02-28');
$mon = be_aus_vorlage_perioden(['gueltig_ab' => '2024-11-15', 'intervall' => 'monatlich'], '2025-02');
check('Monatlich: jeder Monat ab Beginn', $mon === ['2024-11', '2024-12', '2025-01', '2025-02']);
$jahr = be_aus_vorlage_perioden(['gueltig_ab' => '2022-03-01', 'intervall' => 'jaehrlich'], '2025-02');
check('Jaehrlich: der Monat des Beginns, jedes Jahr', $jahr === ['2022-03', '2023-03', '2024-03']);
$ende = be_aus_vorlage_perioden(['gueltig_ab' => '2024-01-01', 'gueltig_bis' => '2024-03-10',
                                 'intervall' => 'monatlich'], '2025-02');
check('Ein Ende schliesst den Monat des Endes ein und nichts danach', $ende === ['2024-01', '2024-02', '2024-03']);

// ── Tabellen in SQLite ───────────────────────────────────────────────
// Eigene, schlanke Fassung: Es geht um die Frage, WAS gebucht wird, nicht
// um MySQL-Spaltentypen. Der eindeutige Schluessel (vorlage_id, periode)
// gehoert dazu -- auf ihm ruht die Zusage "genau einmal".
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
// Wie im Einrichtungslauf: erst nachgesehen (fehlt), dann angelegt.
check('Vor dem Anlegen fehlt die Tabelle', !hat_tabelle($pdo, 'be_ausgabe_kategorie'));
$pdo->exec('CREATE TABLE be_ausgabe_kategorie (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE,
            sortierung INTEGER DEFAULT 0, aktiv INTEGER DEFAULT 1, erstellt_am TEXT)');
$pdo->exec('CREATE TABLE be_ausgabe_vorlage (id INTEGER PRIMARY KEY AUTOINCREMENT, kategorie_id INTEGER,
            text TEXT, lieferant TEXT DEFAULT \'\', intervall TEXT, waehrung TEXT DEFAULT \'CHF\',
            betrag_rappen INTEGER NULL, betrag_fremd_rappen INTEGER NULL, mwst_satz_bp INTEGER DEFAULT 0,
            gueltig_ab TEXT, gueltig_bis TEXT NULL, aktiv INTEGER DEFAULT 1, erstellt_am TEXT, geaendert_am TEXT)');
$pdo->exec('CREATE TABLE be_ausgabe (id INTEGER PRIMARY KEY AUTOINCREMENT, datum TEXT, periode TEXT,
            kategorie_id INTEGER, text TEXT, lieferant TEXT DEFAULT \'\', waehrung TEXT DEFAULT \'CHF\',
            betrag_rappen INTEGER NULL, betrag_fremd_rappen INTEGER NULL, mwst_satz_bp INTEGER DEFAULT 0,
            vorlage_id INTEGER NULL, von_hand INTEGER DEFAULT 1, aktiv INTEGER DEFAULT 1,
            erstellt_am TEXT, geaendert_am TEXT, UNIQUE (vorlage_id, periode))');
$pdo->exec('CREATE TABLE be_ausgabe_datei (ausgabe_id INTEGER PRIMARY KEY, name TEXT, typ TEXT,
            groesse INTEGER, inhalt BLOB, hochgeladen_am TEXT)');

check('Die Tabellenliste kennt alle vier Tabellen', array_keys(be_aus_tabellen())
    === ['be_ausgabe_kategorie', 'be_ausgabe_vorlage', 'be_ausgabe', 'be_ausgabe_datei']);

// Startkategorien: einmal, nur in eine leere Tabelle.
check('KRITISCH: Startkategorien entstehen im selben Lauf, der die Tabelle anlegt', be_aus_kategorien_nachtragen($pdo) === 3);
check('eingerichtet erkennt die vier Tabellen', be_aus_eingerichtet($pdo));
$pdo->exec("UPDATE be_ausgabe_kategorie SET aktiv = 0 WHERE name = 'Marketing & Vertrieb'");
check('KRITISCH: ein zweiter Lauf legt keine archivierte Startkategorie zurueck',
    be_aus_kategorien_nachtragen($pdo) === 0
    && (int)$pdo->query('SELECT COUNT(*) FROM be_ausgabe_kategorie')->fetchColumn() === 3);
$kat = be_aus_kategorien($pdo);
$hosting = (int)array_values(array_filter($kat, fn($k) => $k['name'] === 'Hosting & Server'))[0]['id'];
$software = (int)array_values(array_filter($kat, fn($k) => $k['name'] === 'Software & Abos'))[0]['id'];
$marketing = (int)array_values(array_filter($kat, fn($k) => $k['name'] === 'Marketing & Vertrieb'))[0]['id'];

// ── 2. Vorlagen buchen ───────────────────────────────────────────────
$neuV = $pdo->prepare('INSERT INTO be_ausgabe_vorlage (kategorie_id, text, intervall, waehrung, betrag_rappen,
                       betrag_fremd_rappen, mwst_satz_bp, gueltig_ab, gueltig_bis, aktiv) VALUES (?,?,?,?,?,?,?,?,?,1)');
// CHF, monatlich ab dem 20. -- am Stichtag (15.) ist der laufende Monat
// noch nicht angefallen.
$neuV->execute([$hosting, 'Server', 'monatlich', 'CHF', 5405, null, 810, '2024-11-20', null]);
$vServer = (int)$pdo->lastInsertId();
// USD, monatlich ab dem 1., mit Schaetzung an der Vorlage.
$neuV->execute([$software, 'KI-Abo', 'monatlich', 'USD', 1800, 2000, 0, '2025-01-01', null]);
$vKi = (int)$pdo->lastInsertId();
// USD ohne jede Schaetzung.
$neuV->execute([$software, 'Werkzeug', 'monatlich', 'USD', null, 1000, 0, '2025-02-01', null]);
$vWz = (int)$pdo->lastInsertId();

$stichtag = '2025-03-15';
$n1 = be_aus_vorlagen_buchen($pdo, $stichtag);
// Server: Nov, Dez, Jan, Feb (Maerz erst am 20.) = 4; KI: Jan, Feb, Mrz = 3; Werkzeug: Feb, Mrz = 2.
check('Vorlagen buchen alle faelligen Monate (4 + 3 + 2)', $n1 === 9);
check('KRITISCH: ein zweiter Lauf bucht nichts doppelt', be_aus_vorlagen_buchen($pdo, $stichtag) === 0);
$serverMonate = $pdo->query("SELECT periode FROM be_ausgabe WHERE vorlage_id = $vServer ORDER BY periode")
                    ->fetchAll(PDO::FETCH_COLUMN);
check('KRITISCH: ein Buchungstag in der Zukunft wird noch nicht gebucht',
    !in_array('2025-03', $serverMonate, true) && count($serverMonate) === 4);
check('Eine Vorlagenbuchung traegt von_hand = 0',
    (int)$pdo->query("SELECT MAX(von_hand) FROM be_ausgabe WHERE vorlage_id IS NOT NULL")->fetchColumn() === 0);
check('Fremdwaehrung: der CHF-Betrag bleibt leer statt geschaetzt gespeichert',
    (int)$pdo->query("SELECT COUNT(*) FROM be_ausgabe WHERE vorlage_id = $vKi AND betrag_rappen IS NOT NULL")
        ->fetchColumn() === 0);

$pdo->exec("UPDATE be_ausgabe SET aktiv = 0 WHERE vorlage_id = $vServer AND periode = '2024-12'");
be_aus_vorlagen_buchen($pdo, $stichtag);
check('KRITISCH: ein archivierter Vorlagenmonat kommt nicht zurueck',
    (int)$pdo->query("SELECT COUNT(*) FROM be_ausgabe WHERE vorlage_id = $vServer AND periode = '2024-12'")
        ->fetchColumn() === 1);

// ── 3. Schaetzung: nie 0 ─────────────────────────────────────────────
// Januar KI-Abo: echter Betrag von der Abrechnung, Kurs 0.90.
$pdo->exec("UPDATE be_ausgabe SET betrag_rappen = 1800, von_hand = 1 WHERE vorlage_id = $vKi AND periode = '2025-01'");
// Februar: Originalbetrag hoeher (USD 25.00).
$pdo->exec("UPDATE be_ausgabe SET betrag_fremd_rappen = 2500 WHERE vorlage_id = $vKi AND periode = '2025-02'");
$zeilen = be_aus_zeilen($pdo);
$finde = fn($vid, $m) => array_values(array_filter($zeilen, fn($z) => $z['vorlage_id'] === $vid && $z['periode'] === $m))[0];
check('Schaetzung mit dem Kurs der letzten bekannten Buchung (USD 25 x 0.90)',
    $finde($vKi, '2025-02')['schaetzung_rappen'] === 2250);
check('Eine Zeile mit echtem Betrag traegt keine Schaetzung', $finde($vKi, '2025-01')['schaetzung_rappen'] === null);
check('Ohne Vormonat und ohne Schaetzung an der Vorlage bleibt der Betrag unbekannt',
    $finde($vWz, '2025-02')['schaetzung_rappen'] === null);
$monate = be_aus_monate($zeilen, '2025-01', '2025-03');
check('KRITISCH: ein Betrag ohne jede Grundlage zaehlt als "fehlt", nicht als 0',
    $monate['2025-02']['fehlt'] === 1 && $monate['2025-03']['fehlt'] === 1);
check('Geschaetztes ist als geschaetzt ausgewiesen (Februar KI 22.50)',
    $monate['2025-02']['geschaetzt_rappen'] === 2250);
// Februar netto: Server 54.05 brutto 8.1 % = 50.00 + KI geschaetzt 22.50.
check('Netto je Monat: bekannt plus geschaetzt', $monate['2025-02']['netto_rappen'] === 5000 + 2250);
check('Nach Kategorie aufgeteilt', ($monate['2025-02']['kategorien'][(string)$hosting] ?? null) === 5000
    && ($monate['2025-02']['kategorien'][(string)$software] ?? null) === 2250);
check('KRITISCH: archivierte Ausgaben zaehlen nirgends', !isset($monate['2024-12'])
    && !isset(be_aus_monate($zeilen, '2024-12', '2024-12')['2024-12']));
// Ein Monat ganz ohne Buchung fehlt -- der Aufrufer sagt "nichts erfasst".
check('Ein Monat ohne Buchung erscheint nicht als 0', !isset(be_aus_monate($zeilen, '2023-01', '2023-12')['2023-06']));
// Erst Vorlage-Schaetzung: Maerz KI hat Vormonate mit Kurs -> Kurs gewinnt.
check('Der Kurs aus einer echten Buchung geht vor der Schaetzung der Vorlage',
    $finde($vKi, '2025-03')['schaetzung_rappen'] === 1800);
// KI-Monat ohne Vormonat mit Betrag: nur die Vorlage.
$pdo->exec("UPDATE be_ausgabe SET betrag_rappen = NULL WHERE vorlage_id = $vKi AND periode = '2025-01'");
$z2 = be_aus_zeilen($pdo);
$jan = array_values(array_filter($z2, fn($z) => $z['vorlage_id'] === $vKi && $z['periode'] === '2025-01'))[0];
check('Ohne Vormonat mit Betrag schaetzt die Vorlage', $jan['schaetzung_rappen'] === 1800);
$pdo->exec("UPDATE be_ausgabe SET betrag_rappen = 1800 WHERE vorlage_id = $vKi AND periode = '2025-01'");

// ── 4. Vorlagenaenderung ab "gilt ab" ────────────────────────────────
$neuerStand = ['id' => $vServer, 'kategorie_id' => $hosting, 'text' => 'Server gross', 'lieferant' => '',
               'waehrung' => 'CHF', 'betrag_rappen' => 10810, 'betrag_fremd_rappen' => null, 'mwst_satz_bp' => 810];
// Januar von Hand angefasst -- muss bleiben.
$pdo->exec("UPDATE be_ausgabe SET von_hand = 1, betrag_rappen = 6000 WHERE vorlage_id = $vServer AND periode = '2025-01'");
$ids = be_aus_vorlage_uebertragen($pdo, $neuerStand, '2025-01');
$nachher = $pdo->query("SELECT periode, betrag_rappen, text FROM be_ausgabe WHERE vorlage_id = $vServer ORDER BY periode")
               ->fetchAll(PDO::FETCH_ASSOC);
$jeM = array_column($nachher, null, 'periode');
check('KRITISCH: Monate vor "gilt ab" bleiben unveraendert', (int)$jeM['2024-11']['betrag_rappen'] === 5405);
check('KRITISCH: eine von Hand angefasste Buchung bleibt auch ab "gilt ab"', (int)$jeM['2025-01']['betrag_rappen'] === 6000);
check('Unberuehrte Monate ab "gilt ab" tragen den neuen Stand', (int)$jeM['2025-02']['betrag_rappen'] === 10810
    && $jeM['2025-02']['text'] === 'Server gross');
check('Genau die geaenderten Buchungen werden gemeldet', count($ids) === 1);

// ── 5. Wiederkehrender Umsatz ────────────────────────────────────────
// Positionen je Beleg als Attrappe, Perioden mit derselben Struktur wie
// beleg_summen_perioden(): zwischensumme und rabatt in Rappen.
$POS = [
    1 => ['monatlich' => [10000, 0], 'jaehrlich' => [24000, 0]], // aelterer Vertrag M1
    2 => ['monatlich' => [20000, 2000]],                          // juengerer Vertrag M1, 10 % Rabatt
    3 => ['monatlich' => [5000, 0]],                              // M2 gesperrt
    4 => ['monatlich' => [7000, 0]],                              // M3 gekuendigt, Ende vorbei
    5 => ['monatlich' => [9000, 0]],                              // M4 gekuendigt, Ende kommt noch
    6 => ['monatlich' => [3000, 0]],                              // ohne Mandant
    7 => ['monatlich' => [99900, 0]],                             // M5, nur Entwurf
];
$lesen = fn(int $id) => [$id];
$perioden = function (array $pos, int $rabatt) use ($POS) {
    $raus = [];
    foreach ($POS[$pos[0]] as $p => [$zw, $rb]) {
        $raus[$p] = ['zwischensumme_rappen' => $zw, 'rabatt_rappen' => $rb,
                     'mwst_rappen' => (int)round(($zw - $rb) * 0.081), 'total_rappen' => 0];
    }
    return $raus;
};
$vt = [
    ['id' => 1, 'status' => 'bestaetigt', 'mandant_id' => 1, 'entscheidung_am' => '2024-01-10 10:00:00', 'datum' => '2024-01-05'],
    ['id' => 2, 'status' => 'bestaetigt', 'mandant_id' => 1, 'entscheidung_am' => '2024-06-10 10:00:00', 'datum' => '2024-06-01'],
    ['id' => 3, 'status' => 'bestaetigt', 'mandant_id' => 2, 'entscheidung_am' => '2024-02-01 10:00:00', 'datum' => '2024-02-01'],
    ['id' => 4, 'status' => 'bestaetigt', 'mandant_id' => 3, 'entscheidung_am' => '2024-02-01 10:00:00', 'datum' => '2024-02-01'],
    ['id' => 5, 'status' => 'bestaetigt', 'mandant_id' => 4, 'entscheidung_am' => '2024-02-01 10:00:00', 'datum' => '2024-02-01'],
    ['id' => 6, 'status' => 'bestaetigt', 'mandant_id' => null, 'entscheidung_am' => '2024-02-01 10:00:00', 'datum' => '2024-02-01'],
    ['id' => 7, 'status' => 'entwurf',    'mandant_id' => 5, 'entscheidung_am' => null, 'datum' => '2024-02-01'],
];
$md = [
    1 => ['name' => 'Betrieb A', 'status' => 'aktiv'],
    2 => ['name' => 'Betrieb B', 'status' => 'gesperrt'],
    3 => ['name' => 'Betrieb C', 'status' => 'gekuendigt', 'gekuendigt_per' => '2025-01-31'],
    4 => ['name' => 'Betrieb D', 'status' => 'gekuendigt', 'gekuendigt_per' => '2025-06-30'],
    5 => ['name' => 'Betrieb E', 'status' => 'aktiv'],
];
$mrr = be_aus_mrr($vt, $md, '2025-03-15', $lesen, $perioden);
// A: juengster Vertrag 200.00 - 20.00 = 180.00 (nicht 100 + 240/12 aus dem alten); D: 90.00.
check('KRITISCH: wiederkehrender Umsatz exkl. MWST, je Mandant nur der juengste Vertrag', $mrr['rappen'] === 18000 + 9000);
check('Gesperrter und beendeter Mandant zaehlen nicht, ein Entwurf auch nicht', $mrr['vertraege'] === 2 && $mrr['ruhend'] === 2);
check('Ein Vertrag ohne Mandant wird genannt, nicht gezaehlt', $mrr['ohne_mandant'] === 1);
$mrrJahr = be_aus_mrr([['id' => 1, 'status' => 'bestaetigt', 'mandant_id' => 1, 'entscheidung_am' => 'x', 'datum' => 'x']],
                      $md, '2025-03-15', $lesen, $perioden);
check('Jahresbetrag durch 12 (100.00 + 240.00 / 12 = 120.00)', $mrrJahr['rappen'] === 12000);

// ── 6. Eingabepruefung ───────────────────────────────────────────────
$kat = be_aus_kategorien($pdo);
$basis = ['datum' => '2025-02-10', 'kategorie_id' => $hosting, 'text' => 'Domain',
          'waehrung' => 'CHF', 'betrag_rappen' => 2000, 'mwst_satz_bp' => 810];
check('Eine gueltige CHF-Ausgabe geht durch', isset(be_aus_ausgabe_pruefen($basis, $kat)['felder']));
check('Die Periode folgt dem Datum', be_aus_ausgabe_pruefen($basis, $kat)['felder']['periode'] === '2025-02');
check('KRITISCH: CHF ohne Betrag wird abgelehnt', isset(be_aus_ausgabe_pruefen(['betrag_rappen' => null] + $basis, $kat)['fehler']));
check('Ein Betrag von null wird abgelehnt', isset(be_aus_ausgabe_pruefen(['betrag_rappen' => 0] + $basis, $kat)['fehler']));
check('Ein Bruchteil eines Rappens wird abgelehnt', isset(be_aus_ausgabe_pruefen(['betrag_rappen' => '12.5'] + $basis, $kat)['fehler']));
$usd = ['waehrung' => 'usd', 'betrag_rappen' => null, 'betrag_fremd_rappen' => 1500, 'mwst_satz_bp' => 0] + $basis;
$r = be_aus_ausgabe_pruefen($usd, $kat);
check('Fremdwaehrung ohne CHF-Betrag ist erlaubt ("CHF-Betrag fehlt")', isset($r['felder']) && $r['felder']['betrag_rappen'] === null);
check('Die Waehrung wird gross geschrieben', ($r['felder']['waehrung'] ?? '') === 'USD');
check('Fremdwaehrung ohne Originalbetrag wird abgelehnt',
    isset(be_aus_ausgabe_pruefen(['betrag_fremd_rappen' => null] + $usd, $kat)['fehler']));
check('CHF: ein mitgeschickter Fremdbetrag wird verworfen',
    be_aus_ausgabe_pruefen(['betrag_fremd_rappen' => 999] + $basis, $kat)['felder']['betrag_fremd_rappen'] === null);
check('KRITISCH: ein Satz, der am Datum nicht gilt, wird abgelehnt',
    isset(be_aus_ausgabe_pruefen(['datum' => '2023-06-01'] + $basis, $kat)['fehler']));
check('KRITISCH: eine archivierte Kategorie nimmt keine neue Ausgabe an',
    isset(be_aus_ausgabe_pruefen(['kategorie_id' => $marketing] + $basis, $kat)['fehler']));
check('Eine bestehende Ausgabe darf ihre archivierte Kategorie behalten',
    isset(be_aus_ausgabe_pruefen(['kategorie_id' => $marketing] + $basis, $kat, $marketing)['felder']));
check('Ohne Text keine Ausgabe', isset(be_aus_ausgabe_pruefen(['text' => '  '] + $basis, $kat)['fehler']));
check('Ein ungueltiges Datum wird abgelehnt', isset(be_aus_ausgabe_pruefen(['datum' => '2025-02-30'] + $basis, $kat)['fehler']));
$vb = ['gueltig_ab' => '2025-01-01', 'intervall' => 'monatlich'] + $basis;
check('Eine gueltige Vorlage geht durch', isset(be_aus_vorlage_pruefen($vb, $kat)['felder']));
check('Vorlage: Ende vor Beginn wird abgelehnt', isset(be_aus_vorlage_pruefen(['gueltig_bis' => '2024-12-31'] + $vb, $kat)['fehler']));
check('Vorlage: unbekanntes Intervall wird abgelehnt', isset(be_aus_vorlage_pruefen(['intervall' => 'woechentlich'] + $vb, $kat)['fehler']));

// Dateityp am Inhalt.
check('PDF am Inhalt erkannt', be_aus_datei_typ("%PDF-1.7\n...") === 'application/pdf');
check('PNG am Inhalt erkannt', be_aus_datei_typ("\x89PNG\r\n\x1a\n....") === 'image/png');
check('KRITISCH: ein Text, der sich PDF nennt, ist keiner', be_aus_datei_typ('<html>kein pdf</html>') === null);

// Logbuch: lesbare Werte.
check('Logbuch zeigt Franken statt Rappen', be_aus_logwert('betrag_rappen', 123450) === "1'234.50");
check('Logbuch zeigt Prozent statt Basispunkten', be_aus_logwert('mwst_satz_bp', 810) === '8.1 %');

echo $ok . ' bestanden, ' . count($bad) . ' nicht bestanden' . PHP_EOL;
foreach ($bad as $b) { echo '  - ' . $b . PHP_EOL; }
exit($bad ? 1 : 0);
