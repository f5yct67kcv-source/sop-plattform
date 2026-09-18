<?php
// Die Trennung der beiden Belegwelten WIRKLICH ausfuehren (ENT-605).
//
// WARUM DIESE DATEI: Der Betreiber-Bereich und der Mandant benutzen seit
// ENT-605 denselben Rechenkern (backend/belege.php, kunden.php,
// produkte.php) mit einem Tabellenpraefix. Das ist genau die Sorte
// Aenderung, bei der eine Textsuche nichts wert ist: Der Quelltext sieht
// richtig aus, solange der Praefix irgendwo steht -- ob er an jeder
// einzelnen Abfrage ankommt, sagt nur ein Lauf.
//
// UND ES IST DER TEURE FALL. Solange die vier Betreiber-Secrets nicht
// gesetzt sind, zeigt betreiber_db() auf DIESELBE Datenbank wie db()
// (OP-518). Greift der Praefix nicht, landet eine Offerte der Betreiberin
// in der Offertenliste ihrer Mandantin -- und beide teilen sich die
// Nummernreihe. Diese Pruefung baut genau diesen Fall nach: EINE Datenbank,
// beide Tabellensaetze nebeneinander.
declare(strict_types=1);
require __DIR__ . '/../backend/belege.php';
require __DIR__ . '/../backend/kunden.php';
require __DIR__ . '/../backend/produkte.php';

$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// ── Eine Attrappe beider Tabellensaetze in EINER Datenbank ────────────
//
// SQLite statt MySQL, wie in den uebrigen pruef_*.php: Es geht um die
// Frage, WOHIN geschrieben wird, nicht um Spaltentypen. Zwei kleine
// Ergaenzungen, weil belege.php MySQL-Schreibweisen benutzt: REGEXP und
// SUBSTRING gibt es in SQLite nicht von sich aus.
$pdo = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$pdo->sqliteCreateFunction('regexp',
    fn($muster, $wert) => (int)(bool)preg_match('~' . $muster . '~', (string)$wert), 2);
$pdo->sqliteCreateFunction('substring',
    fn($wert, $von, $laenge = null) => $laenge === null
        ? substr((string)$wert, $von - 1) : substr((string)$wert, $von - 1, $laenge));

foreach (['', 'be_'] as $p) {
    $pdo->exec("CREATE TABLE {$p}belege (
        id INTEGER PRIMARY KEY AUTOINCREMENT, art TEXT, nummer TEXT, kunde_id INTEGER,
        person_id INTEGER, titel TEXT, referenz TEXT, datum TEXT, gueltig_bis TEXT,
        faellig_bis TEXT, status TEXT, bemerkung TEXT, ist_vorlage INTEGER DEFAULT 0,
        unterschriftsseite INTEGER DEFAULT 0, oeffentliche_notizen TEXT, bedingungen TEXT,
        fusszeile_text TEXT, rabatt_bp INTEGER DEFAULT 0, zwischensumme_rappen INTEGER DEFAULT 0,
        rabatt_rappen INTEGER DEFAULT 0, mwst_rappen INTEGER DEFAULT 0,
        rundung_rappen INTEGER DEFAULT 0, total_rappen INTEGER DEFAULT 0, aktiv INTEGER DEFAULT 1)");
    $pdo->exec("CREATE TABLE {$p}beleg_positionen (
        id INTEGER PRIMARY KEY AUTOINCREMENT, beleg_id INTEGER, sortierung INTEGER,
        produkt_id INTEGER, produkt_name TEXT, beschreibung TEXT, menge REAL,
        einheit TEXT, einzelpreis_rappen INTEGER, rabatt_bp INTEGER, mwst_satz_bp INTEGER)");
    $pdo->exec("CREATE TABLE {$p}kunden (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kundennummer TEXT, name TEXT, aktiv INTEGER DEFAULT 1)");
    $pdo->exec("CREATE TABLE {$p}kunden_person (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kunde_id INTEGER, anrede TEXT, vorname TEXT,
        nachname TEXT, sortierung INTEGER)");
    $pdo->exec("CREATE TABLE {$p}kunden_kontaktweg (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kunde_id INTEGER, person_id INTEGER,
        art TEXT, wert TEXT, sortierung INTEGER)");
    $pdo->exec("CREATE TABLE {$p}produkte (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nummer TEXT, name TEXT, aktiv INTEGER DEFAULT 1)");
}

$anlegen = function (string $praefix, string $nummer, array $positionen, string $art = 'offerte') use ($pdo): int {
    $pdo->prepare('INSERT INTO ' . $praefix . 'belege (art, nummer, datum, status) VALUES (?, ?, ?, ?)')
        ->execute([$art, $nummer, '2026-03-01', 'entwurf']);
    $id = (int)$pdo->lastInsertId();
    beleg_positionen_schreiben($pdo, $id, array_map('beleg_position_lesen', $positionen), $praefix);
    beleg_summen_schreiben($pdo, $id, 0, $praefix);
    return $id;
};
$zaehle = fn(string $tabelle) => (int)$pdo->query("SELECT COUNT(*) FROM $tabelle")->fetchColumn();

// ── 1. Der Praefix trennt wirklich ───────────────────────────────────
$beId = $anlegen('be_', 'OF-0001', [
    ['menge' => 2, 'einzelpreis_rappen' => 50000, 'mwst_satz_bp' => 810],
]);

check('KRITISCH: die Offerte der Betreiberin steht in be_belege', $zaehle('be_belege') === 1);
check('KRITISCH: sie steht NICHT in der Belegtabelle der Mandantin', $zaehle('belege') === 0);
check('KRITISCH: ihre Positionen stehen in be_beleg_positionen',
    $zaehle('be_beleg_positionen') === 1 && $zaehle('beleg_positionen') === 0);

// Gegenprobe, und sie ist der eigentliche Wert dieser Datei: OHNE Praefix
// landet dieselbe Zeile in der Mandantentabelle. Schlaegt sie nicht an,
// prueft der Block darueber nichts.
$manId = $anlegen('', 'OF-0001', [
    ['menge' => 1, 'einzelpreis_rappen' => 10000, 'mwst_satz_bp' => 810],
]);
check('Gegenprobe: ohne Praefix landet der Beleg in der Mandantentabelle',
    $zaehle('belege') === 1 && $zaehle('be_belege') === 1);

// ── 2. Gelesen wird ebenfalls getrennt ───────────────────────────────
$beBeleg  = beleg_lesen($pdo, $beId, 'be_');
$manBeleg = beleg_lesen($pdo, $manId);
check('KRITISCH: gelesen wird aus dem eigenen Satz, nicht aus dem anderen',
    $beBeleg !== null && $manBeleg !== null
    && (int)$beBeleg['total_rappen'] === 108100      // 1000.00 + 8.1 %, auf 5 Rappen
    && (int)$manBeleg['total_rappen'] === 10810);    // 100.00 + 8.1 %
// Eine Id, die es nur im anderen Satz gibt, darf nicht gefunden werden --
// sonst laese der eine Bereich die Belege des anderen.
$pdo->exec("INSERT INTO belege (art, nummer, datum, status) VALUES ('offerte', 'OF-0099', '2026-03-02', 'entwurf')");
$fremdeId = (int)$pdo->lastInsertId();
check('KRITISCH: ein Beleg der Mandantin ist ueber den Betreiber-Satz nicht lesbar',
    beleg_lesen($pdo, $fremdeId, 'be_') === null);

// ── 3. Die Nummernreihen zaehlen unabhaengig ─────────────────────────
//
// Das ist keine Feinheit: Beide fangen bei OF-0001 an. Griffe der Praefix
// nicht, stuende die erste Offerte der Betreiberin als OF-0094 da -- oder
// die Mandantin bekaeme eine Luecke.
check('KRITISCH: die Betreiberin zaehlt ihre Offerten selbst',
    beleg_naechste_nummer($pdo, 'offerte', 'be_') === 'OF-0002');
check('die Mandantin zaehlt weiter ihre eigenen',
    beleg_naechste_nummer($pdo, 'offerte') === 'OF-0100');

// ── 3b. Rechnungen zaehlen noch einmal fuer sich (ENT-608) ───────────
//
// Zwei Reihen je Tabellensatz, nicht eine: RE und OF duerfen einander
// nicht weiterzaehlen. Und die Reihe der Betreiberin faengt auch dann bei
// RE-0001 an, wenn die Mandantin schon bei RE-0207 steht -- solange
// betreiber_db() auf dieselbe Datenbank zeigt (OP-518), haengt genau
// daran, dass die erste eigene Rechnung nicht RE-0208 heisst.
check('KRITISCH: die erste Rechnung der Betreiberin heisst RE-0001',
    beleg_naechste_nummer($pdo, 'rechnung', 'be_') === 'RE-0001');
$pdo->prepare("INSERT INTO belege (art, nummer, datum, status) VALUES ('rechnung', ?, '2026-03-02', 'entwurf')")
    ->execute(['RE-0207']);
check('KRITISCH: die Rechnungen der Mandantin zaehlen die der Betreiberin nicht hoch',
    beleg_naechste_nummer($pdo, 'rechnung', 'be_') === 'RE-0001'
    && beleg_naechste_nummer($pdo, 'rechnung') === 'RE-0208');
$beRechnung = $anlegen('be_', 'RE-0001', [
    ['menge' => 3, 'einzelpreis_rappen' => 20000, 'mwst_satz_bp' => 810],
], 'rechnung');
// Zwei im eigenen Satz (OF-0001 und RE-0001), drei im fremden (OF-0001,
// OF-0099 und die RE-0207 von eben) -- gezaehlt statt geschaetzt.
check('KRITISCH: die Rechnung der Betreiberin steht in be_belege, nicht daneben',
    $zaehle('be_belege') === 2 && $zaehle('belege') === 3);
check('sie rechnet mit demselben Kern wie die Offerte',
    (int)beleg_lesen($pdo, $beRechnung, 'be_')['total_rappen'] === 64860);  // 600.00 + 8.1 %
check('und die naechste ist danach RE-0002',
    beleg_naechste_nummer($pdo, 'rechnung', 'be_') === 'RE-0002');
// Die Offertenreihe bleibt davon unberuehrt -- sonst zaehlte eine Rechnung
// die Offerten weiter.
check('KRITISCH: die Offertenreihe zaehlt davon nicht mit',
    beleg_naechste_nummer($pdo, 'offerte', 'be_') === 'OF-0002');

// ── 4. Adressen und Leistungen ebenso ────────────────────────────────
$pdo->prepare('INSERT INTO be_kunden (kundennummer, name) VALUES (?, ?)')->execute(['K0001', 'Betrieb A']);
$beKunde = (int)$pdo->lastInsertId();
kunden_kinder_speichern($pdo, $beKunde, [['art' => 'email', 'wert' => 'a@beispiel.invalid']],
    [['anrede' => 'Frau', 'vorname' => 'A', 'nachname' => 'Muster', 'kontaktwege' => []]], 'be_');
check('KRITISCH: Ansprechpersonen der Betreiberin stehen in be_kunden_person',
    $zaehle('be_kunden_person') === 1 && $zaehle('kunden_person') === 0);
check('KRITISCH: ihre Kontaktwege stehen in be_kunden_kontaktweg',
    $zaehle('be_kunden_kontaktweg') === 1 && $zaehle('kunden_kontaktweg') === 0);
$geladen = kunden_kinder_laden($pdo, 'be_');
check('und werden aus demselben Satz wieder gelesen',
    isset($geladen[$beKunde]) && count($geladen[$beKunde]['personen']) === 1);
check('der Mandantensatz sieht davon nichts', kunden_kinder_laden($pdo) === []);

check('KRITISCH: die Kundennummern zaehlen getrennt',
    naechste_kundennummer($pdo, 'be_') === 'K0002' && naechste_kundennummer($pdo) === 'K0001');

$pdo->prepare('INSERT INTO be_produkte (nummer, name) VALUES (?, ?)')->execute(['P0001', 'Nutzung']);
check('KRITISCH: die Leistungsnummern zaehlen getrennt',
    naechste_produktnummer($pdo, 'be_') === 'P0002' && naechste_produktnummer($pdo) === 'P0001');

// ── 5. Ein Tabellenname kann nur aus der geschlossenen Menge kommen ──
//
// Ein Tabellenname laesst sich nicht als Plathalter binden -- er landet als
// Text in der Abfrage. Die Wache dagegen ist die Liste der erlaubten
// Praefixe, und sie muss WERFEN, nicht stillschweigend etwas anderes tun.
$wirft = function (callable $f): bool {
    try { $f(); return false; } catch (InvalidArgumentException $e) { return true; }
};
check('KRITISCH: ein unbekannter Tabellensatz wird abgewiesen (Belege)',
    $wirft(fn() => beleg_tabelle('fremd_', 'belege')));
check('KRITISCH: ein unbekannter Tabellensatz wird abgewiesen (Adressen)',
    $wirft(fn() => kunden_tabelle('fremd_', 'kunden')));
check('KRITISCH: ein unbekannter Tabellensatz wird abgewiesen (Leistungen)',
    $wirft(fn() => produkt_tabelle('fremd_')));
// Ein eingeschleustes Anhaengsel ist ebenfalls kein gueltiger Satz.
check('KRITISCH: auch ein untergeschobener Zusatz wird abgewiesen',
    $wirft(fn() => beleg_tabelle("be_; DROP TABLE belege; --", 'belege')));
// Und die Kehrseite: Die beiden erlaubten Saetze gehen durch, sonst
// bestuende die Pruefung auch dann, wenn gar nichts mehr ginge.
check('die beiden erlaubten Saetze gehen durch',
    beleg_tabelle('', 'belege') === 'belege' && beleg_tabelle('be_', 'belege') === 'be_belege');

// ── 6. Gerechnet wird an EINER Stelle ────────────────────────────────
//
// Die Summen des Betreiber-Belegs muessen aus derselben Funktion kommen wie
// die des Mandanten-Belegs -- sonst waere die Trennung der Tabellen zu
// einer Trennung der Rechnung geworden, und genau das soll sie nicht sein.
$beide = beleg_summen([
    ['menge' => 70, 'einzelpreis_rappen' => 4200, 'mwst_satz_bp' => 810],
    ['menge' => 10, 'einzelpreis_rappen' => 1680, 'mwst_satz_bp' => 0],
], 700);
check('KRITISCH: der Leitfall OF-0093 rechnet unveraendert (eine Rechenstelle)',
    $beide['zwischensumme_rappen'] === 310800 && $beide['total_rappen'] === 311190);

echo $ok, " bestanden, ", count($bad), " nicht bestanden\n";
foreach ($bad as $b) { echo "x ", $b, "\n"; }
exit($bad ? 1 : 0);
