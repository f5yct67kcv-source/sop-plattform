<?php
// Die Pruefung des Mandanten-Vorrats (ENT-686) wirklich AUSFUEHREN -- nicht
// ihren Quelltext lesen.
//
// Vier Aussagen sind Entscheidungen und keine Formulierungen:
//
//   1. UNBEKANNT IST NICHT BEREIT. Eine Vorratsanlage, die nicht antwortet,
//      zaehlt nicht als uebergabefaehig. Sonst schrumpft der Vorrat lautlos,
//      und es faellt erst auf, wenn ein Kunde wartet.
//   2. EIN LEERER VORRAT WIRD GEMELDET. Null eingetragene Anlagen sind der
//      schlimmste Fall, nicht "nichts zu tun".
//   3. DIE SCHWELLE IST "UNTER ZWEI". Bei zwei bereiten Anlagen bleibt es
//      still, bei einer wird gemeldet.
//   4. VON HAND KOMMT NIEMAND IN DEN VORRAT. "vorrat" ist kein Status, den
//      der Betreiber setzen darf -- sonst saehe ein laufender Mandant aus wie
//      eine freie Anlage, mit den Personaldaten eines Kunden darin.
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

$ok = 0; $bad = [];
$pruef = function (string $name, bool $bedingung) use (&$ok, &$bad) {
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
};

// ── 1. Jeder Befund hat seine eigene Aussage ──────────────────────────
$faelle = [
    'nicht_eingetragen'     => mandant_vorrat_befund('standardverbindung', null),
    'unvollstaendig'        => mandant_vorrat_befund('unvollstaendig', null),
    'secret_fehlt'          => mandant_vorrat_befund('secret_fehlt', null),
    'nicht_erreichbar'      => mandant_vorrat_befund('fehlgeschlagen', null),
    'schema_unvollstaendig' => mandant_vorrat_befund('bereit', ['Spalte mandant.x', 'Tabelle y']),
    'bereit'                => mandant_vorrat_befund('bereit', []),
];
$pruef('KRITISCH: nur eine vollstaendig gepruefte Anlage ist uebergabefaehig',
    $faelle['bereit']['bereit'] === true
    && count(array_filter($faelle, static fn($f) => $f['bereit'])) === 1);
// "Unbekannt darf nie wie keine aussehen" -- und auch nie wie "bereit".
$pruef('KRITISCH: eine nicht erreichbare Anlage zaehlt NICHT als bereit',
    $faelle['nicht_erreichbar']['bereit'] === false);
$pruef('KRITISCH: "bereit" ohne Bauplanpruefung (Luecken unbekannt) zaehlt NICHT als bereit',
    mandant_vorrat_befund('bereit', null)['bereit'] === false);
// Gegenprobe: Dieselbe Verbindung mit gepruftem, leerem Bauplan IST bereit --
// sonst waere die Pruefung darueber auch gruen, wenn nie etwas bereit waere.
$pruef('… waehrend dieselbe Verbindung mit geprueftem Bauplan bereit ist (GEGENPROBE)',
    mandant_vorrat_befund('bereit', [])['bereit'] === true);
// Die Lehre aus demo6/demo8: Tabellen da, Spalten nicht -- das ist NICHT bereit.
$pruef('KRITISCH: eine einzige fehlende Spalte macht die Anlage untauglich',
    mandant_vorrat_befund('bereit', ['Spalte mitarbeiter.personalnummer'])['bereit'] === false);
$texte = array_map(static fn($f) => $f['text'], [
    $faelle['nicht_eingetragen'], $faelle['secret_fehlt'],
    $faelle['nicht_erreichbar'], $faelle['schema_unvollstaendig'], $faelle['bereit']]);
$pruef('KRITISCH: fuenf verschiedene Lagen haben fuenf verschiedene Texte',
    count(array_unique($texte)) === 5);
$pruef('die Schema-Luecke nennt Zahl UND Beispiele',
    str_contains($faelle['schema_unvollstaendig']['text'], '2 fehlende')
    && str_contains($faelle['schema_unvollstaendig']['text'], 'mandant.x'));

// ── 2. Zusammenzaehlen und Schwelle ───────────────────────────────────
$p = static fn(bool $b): array => ['id' => 1, 'name' => 'x', 'lage' => $b ? 'bereit' : 'nicht_erreichbar',
                                    'bereit' => $b, 'text' => ''];
$z0 = mandant_vorrat_zusammenfassen([]);
$z1 = mandant_vorrat_zusammenfassen([$p(true), $p(false), $p(false)]);
$z2 = mandant_vorrat_zusammenfassen([$p(true), $p(true), $p(false)]);
$pruef('KRITISCH: ein LEERER Vorrat ist zu wenig, nicht "nichts zu tun"',
    $z0['zu_wenig'] === true && $z0['eingetragen'] === 0);
$pruef('KRITISCH: eine bereite Anlage ist zu wenig',
    $z1['zu_wenig'] === true && $z1['bereit'] === 1);
$pruef('KRITISCH: zwei bereite Anlagen sind genug (GEGENPROBE zur Schwelle)',
    $z2['zu_wenig'] === false && $z2['bereit'] === 2);
// Zwei Zahlen, nicht eine: eingetragen und bereit sind verschiedene Einheiten.
$pruef('eingetragen und bereit werden getrennt gezaehlt',
    $z1['eingetragen'] === 3 && $z1['bereit'] === 1);
// GEPRUEFT WIRD DIE ENTSCHEIDUNG, NICHT DIE ZAHL: gemeldet wird, BEVOR der
// Vorrat leer ist -- die Schwelle liegt ueber null und unter dem Soll.
$pruef('KRITISCH: die Meldeschwelle liegt ueber null und unter dem Soll',
    MANDANT_VORRAT_SCHWELLE > 0 && MANDANT_VORRAT_SCHWELLE <= MANDANT_VORRAT_SOLL);

// ── 3. Die Meldung ────────────────────────────────────────────────────
$pruef('KRITISCH: bei genug Vorrat gibt es keine Meldung',
    mandant_vorrat_meldung($z2) === null);
$m1 = mandant_vorrat_meldung($z1);
$pruef('KRITISCH: bei zu wenig Vorrat gibt es eine Meldung',
    $m1 !== null && $m1['betreff'] !== '' && $m1['text'] !== '');
// "Keine Zahl ohne Bezug": 1 von 3, nicht bloss 1.
$pruef('die Meldung nennt die Zahl MIT ihrem Bezug',
    $m1 !== null && str_contains($m1['text'], '1 von 3'));
$m0 = mandant_vorrat_meldung($z0);
// Nichts eingetragen ist etwas anderes als "alle drei klemmen".
$pruef('KRITISCH: ein leerer Vorrat sagt, dass NICHTS eingetragen ist',
    $m0 !== null && str_contains($m0['text'], 'keine Anlage')
    && !str_contains($m1['text'], 'keine Anlage'));
// Jede untaugliche Anlage steht mit ihrem Grund in der Meldung -- sonst weiss
// der Empfaenger nicht, welchen Handgriff er wo machen muss.
$mit = mandant_vorrat_zusammenfassen([
    ['id' => 1, 'name' => 'Vorrat A'] + mandant_vorrat_befund('secret_fehlt', null)]);
$mm = mandant_vorrat_meldung($mit);
$pruef('die Meldung nennt jede Anlage mit ihrem Grund',
    $mm !== null && str_contains($mm['text'], 'Vorrat A')
    && str_contains($mm['text'], 'MANDANT_SECRETS'));

// ── 4. Der Zeitgeber-Schluessel ───────────────────────────────────────
//
// Ein unersetzter Platzhalter heisst "nicht eingerichtet". Waere er ein
// gueltiger Schluessel, kaeme jeder hinein, der den Platzhaltertext kennt --
// und der steht oeffentlich im Repository.
$platzhalter = '__VORRAT_ZEITGEBER' . '_TOKEN__';
$pruef('KRITISCH: der unersetzte Platzhalter ist KEIN gueltiger Schluessel',
    mandant_vorrat_zeitgeber_lage($platzhalter, $platzhalter) === 'nicht_eingerichtet');
$pruef('ein leerer Schluessel ist nicht eingerichtet',
    mandant_vorrat_zeitgeber_lage('', 'egal') === 'nicht_eingerichtet');
$pruef('KRITISCH: ein falscher Schluessel wird als falsch erkannt',
    mandant_vorrat_zeitgeber_lage('geheim123', 'falsch') === 'falscher_schluessel');
$pruef('ohne Schluessel in der Adresse ist das etwas Eigenes',
    mandant_vorrat_zeitgeber_lage('geheim123', '') === 'kein_schluessel_in_der_adresse');
$pruef('der richtige Schluessel gilt (GEGENPROBE)',
    mandant_vorrat_zeitgeber_lage('geheim123', 'geheim123') === 'ok');

// ── 5. Von Hand kommt niemand in den Vorrat ───────────────────────────
$pruef('KRITISCH: "vorrat" ist kein Status, den der Betreiber von Hand setzen darf',
    be_mandant_status_gueltig(MANDANT_STATUS_VORRAT) === false);
$pruef('… waehrend die drei Vertragszustaende es sind (GEGENPROBE)',
    be_mandant_status_gueltig('aktiv') && be_mandant_status_gueltig('gesperrt')
    && be_mandant_status_gueltig('gekuendigt'));
$pruef('mandant_ist_vorrat erkennt genau den Vorrat',
    mandant_ist_vorrat(['status' => 'vorrat']) && !mandant_ist_vorrat(['status' => 'aktiv'])
    && !mandant_ist_vorrat([]));

// ── 6. Der ganze Lauf gegen einen Mandantenstamm ──────────────────────
$db = new PDO('sqlite::memory:', null, null,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$db->exec("CREATE TABLE mandant (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  subdomain TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'aktiv',
  db_host TEXT NOT NULL DEFAULT '', db_name TEXT NOT NULL DEFAULT '',
  db_user TEXT NOT NULL DEFAULT '', secret_name TEXT NOT NULL DEFAULT '')");
// KEINE ECHTEN NAMEN (CLAUDE.md) -- erfundene Anlagen.
$db->exec("INSERT INTO mandant (name, status) VALUES
  ('Vorrat A', 'vorrat'), ('Beispielwache AG', 'aktiv'), ('Vorrat B', 'vorrat'),
  ('Musterdienst GmbH', 'gekuendigt')");
// Die Abfrage, ueber die der Endpunkt seine Schleife fuehrt. Die
// Verbindung zu den Anlagen selbst steht im Endpunkt und laesst sich hier
// nicht ausfuehren; ihre Zusagen prueft test_mandant_vorrat.mjs.
$zeilen = mandant_vorrat_zeilen($db);
$pruef('KRITISCH: die Vorratspruefung nimmt genau die Vorratsanlagen, keinen Kunden',
    array_column($zeilen, 'name') === ['Vorrat A', 'Vorrat B']);
// Und aus diesen Zeilen, ohne Datenbankangaben: nicht eingetragen, nicht
// bereit -- durchgerechnet mit denselben Funktionen wie im Endpunkt.
$lage = mandant_vorrat_zusammenfassen(array_map(static fn(array $m): array =>
    ['id' => (int)$m['id'], 'name' => (string)$m['name']]
    + mandant_vorrat_befund(mandant_verbindung_bereit($m), null), $zeilen));
$pruef('Anlagen ohne Datenbankangaben sind "nicht eingetragen", nicht "bereit"',
    $lage['bereit'] === 0 && $lage['eingetragen'] === 2
    && array_unique(array_column($lage['plaetze'], 'lage')) === ['nicht_eingetragen']);
$pruef('und der Lauf meldet: zu wenig', $lage['zu_wenig'] === true);

// Ohne information_schema (hier: SQLite) weiss die Funktion es nicht -- und
// sagt "nicht da", statt zu brechen.
$pruef('ohne Auskunft der Datenbank gilt der Vorrat als nicht nachgetragen, statt zu brechen',
    mandant_vorrat_status_da($db) === false);

echo count($bad) === 0
    ? "$ok bestanden\n\nAlle Pruefungen bestanden.\n"
    : "$ok bestanden, " . count($bad) . " nicht bestanden\n\n  ✗ "
      . implode("\n  ✗ ", $bad) . "\n";
exit(count($bad) === 0 ? 0 : 1);
