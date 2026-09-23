<?php
// Der Verlauf am Beleg (ENT-697) -- beleg_verlauf() wirklich AUSFUEHREN.
//
// Warum diese Datei: Der Verlauf setzt vier Quellen zusammen (Logbuch,
// Fassungen, Unterschriftszeilen, Faden). Die Zusagen stecken im
// Zusammensetzen, nicht in einer einzelnen Quelle:
//
//   1. NICHTS DOPPELT: Ein Versand mit neuer Fassung ist EINE Zeile, nicht
//      drei (Logbuch "fassung", Logbuch "versendet", Fassungszeile).
//   2. NICHTS VERSCHLUCKT: Eine Fassung ohne Logbuch-Eintrag (vor der
//      Erfassung versendet) steht trotzdem da.
//   3. FELDAENDERUNGEN GRUPPIERT (Punkt 5): ein Speichern, eine Zeile.
//   4. DER EMPFAENGER mit seinem Namen und als solcher gekennzeichnet; nur
//      Annahme und Ablehnung gefaerbt (Punkt 6).
//   5. UNBEKANNT IST NICHT KEINE: fehlt das Logbuch oder ist der Beleg
//      aelter als die Erfassung, sagt der Verlauf das.
//   6. KEIN "GEOEFFNET" (Punkt 4).
//
// Gegenproben stehen jeweils direkt bei der Pruefung.
declare(strict_types=1);

$pdo = new PDO('sqlite::memory:', null, null,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->sqliteCreateFunction('NOW', static fn(): string => date('Y-m-d H:i:s'));
function db(): PDO { return $GLOBALS['pdo']; }
$GLOBALS['logDa'] = true;
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    if (str_ends_with($t, 'aenderungslog') && !$GLOBALS['logDa']) { return false; }
    $s = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?");
    $s->execute([$t]);
    return (bool)$s->fetchColumn();
}

require __DIR__ . '/../backend/belege.php';
require __DIR__ . '/../backend/logbuch.php';

$ok = 0; $bad = [];
$pruef = function (string $name, bool $bedingung) use (&$ok, &$bad) {
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
};

foreach (['', 'be_'] as $p) {
    $pdo->exec("CREATE TABLE {$p}belege (id INTEGER PRIMARY KEY, art TEXT, nummer TEXT, kunde_id INTEGER,
      person_id INTEGER, titel TEXT DEFAULT '', referenz TEXT DEFAULT '', datum TEXT, gueltig_bis TEXT,
      faellig_bis TEXT, status TEXT, rabatt_bp INTEGER DEFAULT 0, zwischensumme_rappen INTEGER DEFAULT 0,
      rabatt_rappen INTEGER DEFAULT 0, mwst_rappen INTEGER DEFAULT 0, rundung_rappen INTEGER DEFAULT 0, total_rappen INTEGER DEFAULT 0,
      entscheidung_am TEXT, entscheidung_ip TEXT)");
    $pdo->exec("CREATE TABLE {$p}beleg_positionen (id INTEGER PRIMARY KEY, beleg_id INTEGER, sortierung INTEGER,
      produkt_id INTEGER, produkt_name TEXT, beschreibung TEXT, menge REAL, einheit TEXT,
      einzelpreis_rappen INTEGER, rabatt_bp INTEGER DEFAULT 0, mwst_satz_bp INTEGER DEFAULT 810)");
    $pdo->exec("CREATE TABLE {$p}beleg_fassung (id INTEGER PRIMARY KEY AUTOINCREMENT, beleg_id INTEGER, nummer INTEGER,
      abbild TEXT, pruefsumme TEXT, anlass TEXT, versendet_am TEXT, versendet_von TEXT DEFAULT '',
      freigegeben INTEGER DEFAULT 0, versendet_von_id INTEGER)");
    $pdo->exec("CREATE TABLE {$p}beleg_unterschrift (id INTEGER PRIMARY KEY AUTOINCREMENT, beleg_id INTEGER, fassung INTEGER,
      art TEXT, name TEXT DEFAULT '', funktion TEXT DEFAULT '', firma TEXT DEFAULT '', email TEXT DEFAULT '',
      zeichnungsberechtigt INTEGER DEFAULT 0, zeichnung TEXT, grund TEXT, empfaenger_email TEXT DEFAULT '',
      code_abdruck TEXT DEFAULT '', code_gesendet_am TEXT, code_versuche INTEGER DEFAULT 0, bestaetigt_am TEXT,
      ip TEXT DEFAULT '', browser TEXT DEFAULT '', erstellt_am TEXT)");
    $pdo->exec("CREATE TABLE {$p}aenderungslog (id INTEGER PRIMARY KEY AUTOINCREMENT,
      zeitpunkt TEXT DEFAULT CURRENT_TIMESTAMP, akteur_id INT NOT NULL, akteur_name TEXT NOT NULL,
      bereich TEXT NOT NULL, objekt_id INT NOT NULL, feld TEXT NOT NULL,
      wert_alt TEXT NULL, wert_neu TEXT NULL, werte_verborgen INT NOT NULL DEFAULT 0)");
}

// Logbuchzeile mit festem Zeitpunkt (weit weg vom heutigen Tag).
function log_zeile(string $p, int $beleg, string $zeit, int $akteur, string $name, string $feld,
                   ?string $alt, ?string $neu, int $verborgen = 0): void {
    $GLOBALS['pdo']->prepare("INSERT INTO {$p}aenderungslog (zeitpunkt, akteur_id, akteur_name, bereich, objekt_id,
        feld, wert_alt, wert_neu, werte_verborgen) VALUES (?, ?, ?, 'beleg', ?, ?, ?, ?, ?)")
        ->execute([$zeit, $akteur, $name, $beleg, $feld, $alt, $neu, $verborgen]);
}
function fassung_zeile(string $p, int $beleg, int $nr, string $zeit, string $von, string $anlass = 'versand'): void {
    $GLOBALS['pdo']->prepare("INSERT INTO {$p}beleg_fassung (beleg_id, nummer, abbild, pruefsumme, anlass, versendet_am, versendet_von)
        VALUES (?, ?, '{}', '', ?, ?, ?)")->execute([$beleg, $nr, $anlass, $zeit, $von]);
}
function texte(array $v): array { return array_map(fn($e) => $e['was'], $v['eintraege']); }
function finde(array $v, string $teil): ?array {
    foreach ($v['eintraege'] as $e) { if (str_contains($e['was'], $teil)) { return $e; } }
    return null;
}

// ── Betreiber-Beleg 1: der ganze Lebenslauf ───────────────────────────
$pdo->exec("INSERT INTO be_belege (id, art, nummer, status, entscheidung_am)
            VALUES (1, 'offerte', 'OF-2001', 'bestaetigt', '2031-05-04 10:05:00')");
log_zeile('be_', 1, '2031-05-01 09:00:00', 7, 'A. Muster', 'angelegt', null, 'offerte OF-2001');
// Ein Speichern mit drei Feldern -> eine Zeile.
log_zeile('be_', 1, '2031-05-01 09:30:00', 7, 'A. Muster', 'titel', 'Alt', 'Neu');
log_zeile('be_', 1, '2031-05-01 09:30:00', 7, 'A. Muster', 'gueltig_bis', '2031-05-30', '2031-06-15');
log_zeile('be_', 1, '2031-05-01 09:30:00', 7, 'A. Muster', 'kunde_id', '3', '4');
// Ein Speichern mit einem kurzen Feld -> ausgeschrieben.
log_zeile('be_', 1, '2031-05-01 11:00:00', 7, 'A. Muster', 'referenz', '', 'R-17');
// Ein langer Text -> zum Aufklappen.
log_zeile('be_', 1, '2031-05-01 11:30:00', 8, 'B. Beispiel', 'bedingungen', '', str_repeat('Zahlbar innert 30 Tagen. ', 4));
// Positionen und Total.
log_zeile('be_', 1, '2031-05-01 12:00:00', 8, 'B. Beispiel', 'positionen', null, null, 1);
log_zeile('be_', 1, '2031-05-01 12:00:00', 8, 'B. Beispiel', 'summe', 'CHF 650.00', 'CHF 700.00');
// Versand Fassung 1: Fassung + Logbuch "fassung" + Logbuch "versendet".
fassung_zeile('be_', 1, 1, '2031-05-02 08:00:03', 'A. Muster');
log_zeile('be_', 1, '2031-05-02 08:00:03', 7, 'A. Muster', 'fassung', null, 'Fassung 1');
log_zeile('be_', 1, '2031-05-02 08:00:04', 7, 'A. Muster', 'versendet', null, 'einkauf@muster.invalid');
// Erinnerung ohne neue Fassung.
log_zeile('be_', 1, '2031-05-03 08:00:00', 7, 'A. Muster', 'versendet', null, 'einkauf@muster.invalid');
// Status von Hand.
log_zeile('be_', 1, '2031-05-03 09:00:00', 8, 'B. Beispiel', 'status', 'versendet', 'angeschaut');
// Fassung 2.
fassung_zeile('be_', 1, 2, '2031-05-03 15:00:00', 'B. Beispiel');
log_zeile('be_', 1, '2031-05-03 15:00:00', 8, 'B. Beispiel', 'fassung', null, 'Fassung 2');
log_zeile('be_', 1, '2031-05-03 15:00:01', 8, 'B. Beispiel', 'versendet', null, 'einkauf@muster.invalid');
// Der Empfaenger: erste Anforderung verfaellt (2 falsche Codes), zweite an
// eine abweichende Adresse, dann bestaetigt.
$pdo->exec("INSERT INTO be_beleg_unterschrift (beleg_id, fassung, art, name, email, empfaenger_email,
    code_gesendet_am, code_versuche, erstellt_am) VALUES
    (1, 2, 'annahme', 'P. Kunde', 'einkauf@muster.invalid', 'einkauf@muster.invalid', '2031-05-04 09:50:00', 2, '2031-05-04 09:50:00')");
$pdo->exec("INSERT INTO be_beleg_unterschrift (beleg_id, fassung, art, name, funktion, firma, email, zeichnungsberechtigt,
    empfaenger_email, code_gesendet_am, code_versuche, bestaetigt_am, erstellt_am) VALUES
    (1, 2, 'annahme', 'P. Kunde', 'Leiter Einkauf', 'Muster Handel AG', 'chef@muster.invalid', 1,
     'einkauf@muster.invalid', '2031-05-04 10:00:00', 0, '2031-05-04 10:05:00', '2031-05-04 10:00:00')");
$faden = [
    ['seite' => 'kunde', 'autor' => 'P. Kunde', 'text' => "Bitte die Stunden\n auf 12 erhöhen.", 'erstellt_am' => '2031-05-02 17:00:00'],
    ['seite' => 'betreiber', 'autor' => 'B. Beispiel', 'text' => 'Erledigt, neue Fassung folgt.', 'erstellt_am' => '2031-05-03 14:00:00'],
];
log_zeile('be_', 1, '2031-05-03 14:00:00', 8, 'B. Beispiel', 'nachricht', null, 'beantwortet');

$v = beleg_verlauf($pdo, $pdo->query('SELECT * FROM be_belege WHERE id = 1')->fetch(), 'be_', $faden);
$t = texte($v);
// Fuer test_beleg_verlauf.mjs: die echte Ausgabe als Testdaten der
// Oberflaeche, statt einer von Hand gebauten, die auseinanderlaufen kann.
if (($argv[1] ?? '') === 'json') {
    $pdo->exec("INSERT INTO belege (id, art, nummer, status, entscheidung_am) VALUES (9, 'offerte', 'OF-9', 'bestaetigt', '2031-04-02 12:00:00')");
    fassung_zeile('', 9, 1, '2031-04-01 12:00:00', 'C. Muster');
    log_zeile('', 98, '2031-07-01 08:00:00', 1, 'C. Muster', 'angelegt', null, 'offerte OF-3009');
    echo json_encode(['voll' => $v,
        'alt' => beleg_verlauf($pdo, $pdo->query('SELECT * FROM belege WHERE id = 9')->fetch(), '')],
        JSON_UNESCAPED_UNICODE);
    exit(0);
}

// 1. Nichts doppelt
$pruef('KRITISCH: ein Versand mit neuer Fassung ist EINE Zeile, mit Adresse',
    count(array_filter($t, fn($x) => str_starts_with($x, 'Fassung 1'))) === 1
    && in_array('Fassung 1 versendet an einkauf@muster.invalid', $t, true));
$pruef('KRITISCH: der Logbuch-Eintrag "fassung" steht nicht zusaetzlich da',
    !in_array('Fassung 1', $t, true) && !in_array('Fassung 2', $t, true));
$pruef('eine Erinnerung ohne neue Fassung heisst so, mit der gueltigen Fassung',
    in_array('Erneut versendet (Fassung 1) an einkauf@muster.invalid', $t, true));
$pruef('KRITISCH: die Antwort im Faden steht einmal, mit Wortlaut, nicht zusaetzlich als Logbuchzeile',
    count(array_filter($t, fn($x) => str_contains($x, 'Antwort an den Empfänger'))) === 1
    && finde($v, 'Antwort an den Empfänger: «Erledigt') !== null);

// 3. Gruppiert
$g = finde($v, '3 Felder geändert');
$pruef('KRITISCH: drei Felder aus einem Speichern ergeben eine Zeile mit drei Details',
    $g !== null && count($g['details']) === 3 && $g['wer'] === 'A. Muster');
$kd = $g ? array_values(array_filter($g['details'], fn($d) => $d['feld'] === 'Empfänger'))[0] ?? null : null;
$pruef('ein Verweis zeigt keine nackte Nummer', $kd !== null && $kd['verborgen'] && $kd['alt'] === null);
$gb = $g ? array_values(array_filter($g['details'], fn($d) => $d['feld'] === 'Gültig bis'))[0] ?? null : null;
$pruef('ein Feld traegt seinen Namen aus dem Formular, mit alt und neu',
    $gb !== null && $gb['alt'] === '2031-05-30' && $gb['neu'] === '2031-06-15');
$pruef('eine einzelne kurze Aenderung steht ausgeschrieben da, ohne Aufklappen',
    ($e = finde($v, 'Referenz: – → R-17')) !== null && $e['details'] === []);
$lang = finde($v, 'Bedingungen geändert');
$pruef('ein langer Text bleibt zum Aufklappen', $lang !== null && count($lang['details']) === 1);
$pos = finde($v, '2 Felder geändert');
$pruef('Positionen und Total aus einem Speichern: eine Zeile, Positionen ohne Werte',
    $pos !== null && $pos['details'][0]['feld'] === 'Positionen' && $pos['details'][0]['verborgen']
    && $pos['details'][1]['alt'] === 'CHF 650.00' && $pos['details'][1]['neu'] === 'CHF 700.00');
$pruef('ein Statuswechsel heisst wie im Formular', in_array('Status: Versendet → Angeschaut', $t, true));

// 4. Empfaenger
$an = finde($v, 'Angenommen (Fassung 2)');
$pruef('KRITISCH: die Annahme steht mit Namen, als Empfaenger, gruen',
    $an !== null && $an['wer'] === 'P. Kunde' && $an['wer_art'] === 'empfaenger' && $an['ton'] === 'pos');
$pruef('die Annahme nennt Funktion, Firma und Zeichnungsberechtigung',
    $an !== null && str_contains($an['was'], 'als Leiter Einkauf, Muster Handel AG')
    && str_contains($an['was'], 'zeichnungsberechtigt'));
$abw = finde($v, 'Code angefordert an chef@muster.invalid');
$pruef('KRITISCH: eine abweichende Codeadresse steht ausdruecklich da',
    $abw !== null && str_contains($abw['was'], 'weicht von der Empfängeradresse einkauf@muster.invalid ab'));
$erst = finde($v, 'Code angefordert an einkauf@muster.invalid');
$pruef('GEGENPROBE: die gleiche Adresse gilt nicht als abweichend',
    $erst !== null && !str_contains($erst['was'], 'weicht'));
$pruef('falsche Codes einer nicht bestaetigten Anforderung werden gezaehlt',
    $erst !== null && str_contains($erst['was'], '2× falscher Code') && !str_contains($erst['was'], 'gesperrt'));
$pruef('nur Annahme und Ablehnung sind gefaerbt',
    count(array_filter($v['eintraege'], fn($e) => $e['ton'] !== '')) === 1);
$pruef('der Aenderungswunsch steht beim Empfaenger, Leerraum zusammengezogen',
    ($w = finde($v, 'Änderungswunsch: «Bitte die Stunden auf 12 erhöhen.»')) !== null && $w['wer_art'] === 'empfaenger');
$pruef('KRITISCH: die Klick-Entscheidung von frueher erscheint NICHT zusaetzlich, wenn eine Unterschrift da ist',
    finde($v, 'per Klick') === null);

// Reihenfolge
$zeiten = array_map(fn($e) => strtotime($e['zeit']), $v['eintraege']);
$sortiert = $zeiten; rsort($sortiert);
$pruef('KRITISCH: neueste zuoberst', $zeiten === $sortiert && $v['eintraege'][0]['was'] === $an['was']);
$pruef('Angelegt steht zuunterst', end($t) === 'Angelegt');

// 5./6.
$pruef('KRITISCH: der Beleg ist nicht aelter als die Erfassung (angelegt steht da)',
    $v['log_da'] === true && $v['vor_log'] === false);
$pruef('KRITISCH: kein "geoeffnet" im Verlauf', !preg_match('/geöffnet|aufgerufen|angesehen/u', implode(' ', $t)));

// ── Betreiber-Beleg 2: Ablehnung; ein Doppel; eine Fassung bei Annahme
$pdo->exec("INSERT INTO be_belege (id, art, nummer, status, entscheidung_am) VALUES (2, 'offerte', 'OF-2002', 'abgelehnt', '2031-06-01 10:00:00')");
log_zeile('be_', 2, '2031-05-20 09:00:00', 7, 'A. Muster', 'angelegt', null, 'OF-2002 · Doppel von OF-2001');
fassung_zeile('be_', 2, 1, '2031-06-01 09:59:59', '', 'annahme');
$pdo->exec("INSERT INTO be_beleg_unterschrift (beleg_id, fassung, art, name, grund, empfaenger_email, bestaetigt_am, erstellt_am)
    VALUES (2, 1, 'ablehnung', 'P. Kunde', 'Zu teuer.', 'einkauf@muster.invalid', '2031-06-01 10:00:00', '2031-06-01 10:00:00')");
$v2 = beleg_verlauf($pdo, $pdo->query('SELECT * FROM be_belege WHERE id = 2')->fetch(), 'be_', []);
$ab = finde($v2, 'Abgelehnt (Fassung 1)');
$pruef('KRITISCH: die Ablehnung steht rot, mit Namen und Grund',
    $ab !== null && $ab['ton'] === 'neg' && $ab['wer'] === 'P. Kunde' && str_contains($ab['was'], '«Zu teuer.»'));
$pruef('ein Doppel sagt, woher es kommt', in_array('Angelegt als Doppel von OF-2001', texte($v2), true));
$fa = finde($v2, 'festgehalten');
$pruef('eine bei der Entscheidung festgehaltene Fassung ist ein automatischer Eintrag', $fa !== null && $fa['wer_art'] === 'auto');

// ── Cockpit-Beleg 3: vor der Erfassung versendet und per Klick angenommen
$pdo->exec("INSERT INTO belege (id, art, nummer, status, entscheidung_am) VALUES (3, 'offerte', 'OF-3001', 'bestaetigt', '2031-04-02 12:00:00')");
fassung_zeile('', 3, 1, '2031-04-01 12:00:00', 'C. Muster');
log_zeile('', 99, '2031-07-01 08:00:00', 1, 'C. Muster', 'angelegt', null, 'offerte OF-3009');
$v3 = beleg_verlauf($pdo, $pdo->query('SELECT * FROM belege WHERE id = 3')->fetch(), '');
$pruef('KRITISCH: eine Fassung ohne Logbuch-Eintrag steht trotzdem da, mit Absender',
    ($f = finde($v3, 'Fassung 1 versendet')) !== null && $f['wer'] === 'C. Muster');
$kl = finde($v3, 'per Klick');
$pruef('KRITISCH: die Klick-Annahme von vor ENT-688 erscheint, gruen, ohne erfundenen Namen',
    $kl !== null && $kl['ton'] === 'pos' && $kl['wer'] === '' && $kl['wer_art'] === 'empfaenger');
$pruef('KRITISCH: der Beleg ist aelter als die Erfassung -- das wird gesagt, mit Datum',
    $v3['vor_log'] === true && $v3['log_seit'] === '2031-07-01 08:00:00');
$pruef('GEGENPROBE: die Satze trennen sich -- Betreiber-Eintraege tauchen im Cockpit nicht auf',
    finde($v3, 'Muster Handel') === null && count($v3['eintraege']) === 2);

$GLOBALS['logDa'] = false;
$v4 = beleg_verlauf($pdo, $pdo->query('SELECT * FROM belege WHERE id = 3')->fetch(), '');
$pruef('KRITISCH: ohne Logbuch heisst es "nicht eingerichtet", nicht "nichts passiert"',
    $v4['log_da'] === false && $v4['log_seit'] === null && count($v4['eintraege']) === 2);
$GLOBALS['logDa'] = true;

// ── Positionen: der Abdruck
$pdo->exec("INSERT INTO be_belege (id, art, nummer, status, rabatt_bp, total_rappen) VALUES (5, 'offerte', 'OF-5', 'entwurf', 0, 0)");
$pos = [['produkt_id' => null, 'produkt_name' => 'Bewachung', 'beschreibung' => '', 'menge' => 10, 'einheit' => 'Std.',
         'einzelpreis_rappen' => 6500, 'rabatt_bp' => 0, 'mwst_satz_bp' => 810]];
beleg_positionen_schreiben($pdo, 5, $pos, 'be_');
beleg_summen_schreiben($pdo, 5, 0, 'be_');
$a0 = beleg_positionen_abdruck($pdo, 5, 'be_');
beleg_positionen_schreiben($pdo, 5, $pos, 'be_');
beleg_summen_schreiben($pdo, 5, 0, 'be_');
$a1 = beleg_positionen_abdruck($pdo, 5, 'be_');
$pruef('GEGENPROBE: dieselben Positionen neu geschrieben ergeben denselben Abdruck', $a0 === $a1);
$ich = ['id' => 7, 'name' => 'A. Muster'];
beleg_positionen_loggen($pdo, $ich, 5, $a0, $a1, 'be_');
$zahl = fn() => (int)$pdo->query("SELECT COUNT(*) FROM be_aenderungslog WHERE objekt_id = 5")->fetchColumn();
$pruef('GEGENPROBE: unveraendert -> keine Zeile', $zahl() === 0);
$pos2 = $pos; $pos2[0]['beschreibung'] = 'Nachtdienst';
beleg_positionen_schreiben($pdo, 5, $pos2, 'be_');
beleg_summen_schreiben($pdo, 5, 0, 'be_');
beleg_positionen_loggen($pdo, $ich, 5, $a1, $a2 = beleg_positionen_abdruck($pdo, 5, 'be_'), 'be_');
$pruef('KRITISCH: nur Text geaendert -> "Positionen", aber kein Total',
    $zahl() === 1 && $pdo->query("SELECT feld FROM be_aenderungslog WHERE objekt_id = 5")->fetchColumn() === 'positionen');
$pos3 = $pos2; $pos3[0]['einzelpreis_rappen'] = 7000;
beleg_positionen_schreiben($pdo, 5, $pos3, 'be_');
beleg_summen_schreiben($pdo, 5, 0, 'be_');
beleg_positionen_loggen($pdo, $ich, 5, $a2, $a3 = beleg_positionen_abdruck($pdo, 5, 'be_'), 'be_');
$tot = $pdo->query("SELECT wert_alt, wert_neu FROM be_aenderungslog WHERE objekt_id = 5 AND feld = 'summe'")->fetch();
$pruef('KRITISCH: ein neuer Preis -> Positionen UND Total mit alt und neu',
    $zahl() === 3 && $tot && str_starts_with($tot['wert_alt'], 'CHF ') && $tot['wert_alt'] !== $tot['wert_neu']);
beleg_summen_schreiben($pdo, 5, 1000, 'be_');
$a4 = beleg_positionen_abdruck($pdo, 5, 'be_');
$pruef('ein Gesamtrabatt aendert den Abdruck', $a4 !== $a3);
$pruef('ein neuer Beleg (ohne Vorher) schreibt nichts',
    (function () use ($pdo, $ich, $zahl, $a4) { $n = $zahl(); beleg_positionen_loggen($pdo, $ich, 5, '', $a4, 'be_'); return $zahl() === $n; })());

echo "$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "  ✗ $b\n"; }
exit($bad ? 1 : 0);
