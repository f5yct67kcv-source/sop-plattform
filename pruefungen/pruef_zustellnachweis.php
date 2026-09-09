<?php
declare(strict_types=1);
// Echte Ausfuehrung des Zustellnachweises (ENT-491) gegen eine wirkliche
// Datenbank (SQLite im Arbeitsspeicher), gleiches Muster wie
// pruef_wachbuch.php.
//
// Warum das hier laufen MUSS und nicht im Browser: Die Browser-Suiten
// taeuschen die Serverantwort vor. Sie sehen darum nie, ob je (Zugang,
// Rapport) WIRKLICH nur eine Zeile entsteht -- und genau daran haengt die
// Zusage, dass kein Bewegungsprofil entsteht.
$GLOBALS['tabellen'] = ['portal_abruf' => true];
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    return $GLOBALS['tabellen'][$t] ?? false;
}
function hat_spalte(PDO $pdo, string $t, string $s): bool { return true; }

// kundenportal.php zieht keine weiteren Dateien nach; die beiden Waechter
// oben sind alles, was es aus db.php braucht.
require __DIR__ . '/../backend/kundenportal.php';

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE portal_abruf (
  id INTEGER PRIMARY KEY, zugang_id INT NOT NULL,
  rundgang_id INT NULL, einsatz_id INT NULL,
  erstmals_am TEXT NOT NULL, zuletzt_am TEXT NOT NULL, anzahl INT NOT NULL DEFAULT 1,
  pdf_erstmals_am TEXT NULL, pdf_anzahl INT NOT NULL DEFAULT 0)');

$zeilen = static fn(PDO $p): int => (int)$p->query('SELECT COUNT(*) FROM portal_abruf')->fetchColumn();
$zeile  = static function (PDO $p, int $zugang, string $spalte, int $id): ?array {
    $s = $p->prepare("SELECT * FROM portal_abruf WHERE zugang_id = ? AND $spalte = ?");
    $s->execute([$zugang, $id]);
    return $s->fetch(PDO::FETCH_ASSOC) ?: null;
};

// ── Der erste Abruf legt an ────────────────────────────────────────────
kp_abruf_vermerken($pdo, 5, 'rundgang', 10);
$z = $zeile($pdo, 5, 'rundgang_id', 10);
pruef('Der erste Abruf legt einen Nachweis an', $z !== null);
pruef('Er zaehlt einen Abruf', (int)($z['anzahl'] ?? 0) === 1);
pruef('Erstmals und zuletzt sind beim ersten Mal gleich',
    ($z['erstmals_am'] ?? '') === ($z['zuletzt_am'] ?? 'x'));
// Nicht ueber "?? 'x'" pruefen: Der Null-Verschmelzer greift GENAU bei
// null, die Pruefung waere damit immer falsch. Erste Fassung hatte den
// Fehler und ist rot geworden.
pruef('Ohne PDF-Meldung bleibt die PDF-Spalte leer',
    $z['pdf_erstmals_am'] === null && (int)$z['pdf_anzahl'] === 0);

// ── DIE Kernzusage: kein Bewegungsprofil ──────────────────────────────
// Eine Zeile JE ABRUF liesse sich lesen wie ein Kalender: an welchem Abend
// hat der Kunde was angesehen. Genau das darf nicht entstehen.
$vorher = $z['erstmals_am'];
sleep(1);   // damit "zuletzt" sich ueberhaupt unterscheiden KANN
kp_abruf_vermerken($pdo, 5, 'rundgang', 10);
kp_abruf_vermerken($pdo, 5, 'rundgang', 10);
$z2 = $zeile($pdo, 5, 'rundgang_id', 10);
pruef('KRITISCH: drei Abrufe desselben Rapports ergeben EINE Zeile, kein Bewegungsprofil',
    $zeilen($pdo) === 1);
pruef('Der Zaehler steht danach auf drei', (int)$z2['anzahl'] === 3);
pruef('KRITISCH: der erste Zeitpunkt bleibt stehen -- er ist der Zustellnachweis',
    $z2['erstmals_am'] === $vorher);
pruef('Der letzte Zeitpunkt wandert mit', $z2['zuletzt_am'] > $vorher);

// ── Getrennte Zugaenge, getrennte Rapporte ────────────────────────────
kp_abruf_vermerken($pdo, 6, 'rundgang', 10);
pruef('Ein zweiter Zugang bekommt eine eigene Zeile', $zeilen($pdo) === 2);
kp_abruf_vermerken($pdo, 5, 'rundgang', 11);
pruef('Ein zweiter Rundgang bekommt eine eigene Zeile', $zeilen($pdo) === 3);
kp_abruf_vermerken($pdo, 5, 'einsatz', 10);
pruef('KRITISCH: Einsatz 10 und Rundgang 10 sind NICHT dieselbe Zeile', $zeilen($pdo) === 4);
$e = $zeile($pdo, 5, 'einsatz_id', 10);
pruef('Beim Einsatz steht die Rundgangspalte leer', $e !== null && $e['rundgang_id'] === null);
$r = $zeile($pdo, 5, 'rundgang_id', 10);
pruef('Beim Rundgang steht die Einsatzspalte leer', $r !== null && $r['einsatz_id'] === null);

// ── Was nicht vermerkt werden darf ────────────────────────────────────
$stand = $zeilen($pdo);
kp_abruf_vermerken($pdo, 5, 'unfug', 12);
kp_abruf_vermerken($pdo, 0, 'rundgang', 12);
kp_abruf_vermerken($pdo, 5, 'rundgang', 0);
kp_abruf_vermerken($pdo, 5, 'rundgang', -3);
pruef('KRITISCH: eine unbekannte Art legt nichts an', $zeilen($pdo) === $stand);

// ── Die PDF-Meldung ist SCHWAECHER und kann nichts anlegen ────────────
// Sie kommt aus dem Browser. Koennte sie eine Zeile anlegen, liesse sich
// ein Zustellnachweis fuer einen nie geholten Rapport erfinden -- und der
// Weg verriete nebenbei, welche Nummern es gibt.
$vorPdf = $zeilen($pdo);
$angelegt = kp_abruf_pdf_vermerken($pdo, 5, 'rundgang', 999);
pruef('KRITISCH: die PDF-Meldung legt fuer einen nie abgerufenen Rapport NICHTS an',
    $angelegt === false && $zeilen($pdo) === $vorPdf);
pruef('KRITISCH: die PDF-Meldung legt auch fuer einen fremden Zugang nichts an',
    kp_abruf_pdf_vermerken($pdo, 99, 'rundgang', 10) === false && $zeilen($pdo) === $vorPdf);

pruef('Nach einem Abruf greift die PDF-Meldung',
    kp_abruf_pdf_vermerken($pdo, 5, 'rundgang', 10) === true);
$p1 = $zeile($pdo, 5, 'rundgang_id', 10);
pruef('Sie setzt den PDF-Zeitpunkt', ($p1['pdf_erstmals_am'] ?? null) !== null);
pruef('Sie zaehlt eine PDF-Erstellung', (int)$p1['pdf_anzahl'] === 1);
pruef('Sie ruehrt den Abrufzaehler NICHT an -- das sind zwei Aussagen',
    (int)$p1['anzahl'] === (int)$z2['anzahl']);

$ersterPdf = $p1['pdf_erstmals_am'];
sleep(1);
kp_abruf_pdf_vermerken($pdo, 5, 'rundgang', 10);
$p2 = $zeile($pdo, 5, 'rundgang_id', 10);
pruef('KRITISCH: der erste PDF-Zeitpunkt bleibt stehen', $p2['pdf_erstmals_am'] === $ersterPdf);
pruef('Der PDF-Zaehler steigt', (int)$p2['pdf_anzahl'] === 2);
pruef('Auch die zweite PDF-Meldung legt keine Zeile an', $zeilen($pdo) === $vorPdf);

// ── Fehlt die Tabelle, faellt nichts um ───────────────────────────────
// Der Nachweis dient dem Kunden. Er darf ihm den Rapport nicht nehmen,
// nur weil die Anlage noch nicht eingerichtet ist.
$GLOBALS['tabellen']['portal_abruf'] = false;
$geworfen = false;
try {
    kp_abruf_vermerken($pdo, 5, 'rundgang', 10);
    kp_abruf_pdf_vermerken($pdo, 5, 'rundgang', 10);
} catch (Throwable $t) { $geworfen = true; }
pruef('KRITISCH: ohne die Tabelle wird nichts geworfen -- der Abruf laeuft weiter',
    $geworfen === false);
pruef('Und es wird auch nichts geschrieben', $zeilen($pdo) === $vorPdf);
$GLOBALS['tabellen']['portal_abruf'] = true;

// ── Ein Schreibfehler bleibt still ────────────────────────────────────
// Dieselbe Begruendung: lieber ein fehlender Vermerk als ein verweigerter
// Rapport. Nachgestellt, indem die Tabelle unter der Funktion wegfaellt.
$pdo->exec('DROP TABLE portal_abruf');
$still = true;
try {
    kp_abruf_vermerken($pdo, 5, 'rundgang', 10);
    kp_abruf_pdf_vermerken($pdo, 5, 'rundgang', 10);
} catch (Throwable $t) { $still = false; }
pruef('KRITISCH: ein Schreibfehler wird geschluckt und nicht nach oben gereicht', $still);

echo count($bad) === 0 ? "$ok Pruefungen bestanden\n" : '';
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
