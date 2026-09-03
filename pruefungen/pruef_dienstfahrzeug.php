<?php
declare(strict_types=1);
// Echte Ausfuehrung der Fahrzeug-/Fahrerregeln (ENT-328) gegen eine wirkliche
// Datenbank (SQLite im Arbeitsspeicher) -- gleiches Muster wie
// pruef_rechte.php und pruef_einsatz_abgeschlossen.php.
//
// WARUM HIER UND NICHT IN EINER BROWSER-SUITE: Die Playwright-Suiten taeuschen
// die Serverantwort vor. Eine Regel, die entscheidet, ob jemand
// Fahrkostenersatz bekommt, darf nicht nur nachgebaut, sondern muss
// ausgefuehrt werden.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// Die beiden Funktionen, die planung.php aus db.php erwartet. hat_tabelle()
// fragt sonst information_schema ab -- das gibt es in SQLite nicht.
$GLOBALS['tabelleDa'] = true;
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool { return $GLOBALS['tabelleDa']; }
$GLOBALS['abgewiesen'] = null;
function json_response($data, int $status = 200): void {
    $GLOBALS['abgewiesen'] = ['status' => $status, 'daten' => $data];
    throw new RuntimeException('abgewiesen');
}

require __DIR__ . '/../backend/planung.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE fahrzeuge (id INTEGER PRIMARY KEY, kennzeichen TEXT, status TEXT)');
$pdo->exec('CREATE TABLE einsatz_zuteilung (einsatz_id INT, mitarbeiter_id INT,
            verkehrsmittel TEXT, oev_rappen INT)');
// Erfundene Kontrollschilder mit hoher Nummer -- kein echtes Fahrzeug.
$pdo->exec("INSERT INTO fahrzeuge VALUES (1, 'SO 999001', 'aktiv')");
$pdo->exec("INSERT INTO fahrzeuge VALUES (2, 'SO 999002', 'ausser_betrieb')");
$pdo->exec("INSERT INTO fahrzeuge VALUES (3, 'SO 999003', 'verkauft')");

// Ruft die Pruefung und faengt die Abweisung ein.
function versuch(PDO $pdo, ?int $fz, ?int $fa, array $zuteilung, ?int $bisher = null): array {
    $GLOBALS['abgewiesen'] = null;
    try {
        $r = einsatz_fahrzeug_pruefen($pdo, $fz, $fa, $zuteilung, $bisher);
        return ['ok' => true, 'wert' => $r];
    } catch (RuntimeException $e) {
        return ['ok' => false, 'abgewiesen' => $GLOBALS['abgewiesen']];
    }
}

// ── Fahrer ohne Fahrzeug ist keine Angabe ─────────────────────────────────
$r = versuch($pdo, null, 7, [7]);
pruef('KRITISCH: ein Fahrer ohne Dienstfahrzeug wird abgewiesen, nicht still verworfen',
    $r['ok'] === false && $r['abgewiesen']['status'] === 422);

// ── Gar nichts gesetzt: beides null, kein Fehler ──────────────────────────
$r = versuch($pdo, null, null, [7]);
pruef('Ohne Fahrzeug und ohne Fahrer wird nichts beanstandet',
    $r['ok'] === true && $r['wert']['fahrzeug_id'] === null && $r['wert']['fahrer_id'] === null);

// ── Ein Fahrzeug, das es nicht gibt ───────────────────────────────────────
$r = versuch($pdo, 99, null, [7]);
pruef('KRITISCH: ein Fahrzeug, das es nicht gibt, wird abgewiesen', $r['ok'] === false);

// ── Zustand des Fahrzeugs ─────────────────────────────────────────────────
$r = versuch($pdo, 2, null, [7]);
pruef('KRITISCH: ein Fahrzeug ausser Betrieb laesst sich nicht NEU einteilen',
    $r['ok'] === false && str_contains((string)$r['abgewiesen']['daten']['message'], 'ausser Betrieb'));

$r = versuch($pdo, 3, null, [7]);
pruef('KRITISCH: ein verkauftes Fahrzeug laesst sich nicht einteilen',
    $r['ok'] === false && str_contains((string)$r['abgewiesen']['daten']['message'], 'verkauft'));

// Dasselbe Fahrzeug war schon eingeteilt: Es bleibt stehen. Was gefahren
// wurde, ist eine Tatsache -- ein Speichern der Bemerkung darf sie nicht
// wegraeumen.
$r = versuch($pdo, 2, null, [7], 2);
pruef('KRITISCH: ein bereits eingeteiltes Fahrzeug bleibt, auch wenn es inzwischen ausser Betrieb steht',
    $r['ok'] === true && $r['wert']['fahrzeug_id'] === 2);

// ── Der Fahrer muss zugeteilt sein ────────────────────────────────────────
$r = versuch($pdo, 1, 8, [7]);
pruef('KRITISCH: ein Fahrer, der dem Einsatz nicht zugeteilt ist, wird abgewiesen',
    $r['ok'] === false && str_contains((string)$r['abgewiesen']['daten']['message'], 'zugeteilt'));

$r = versuch($pdo, 1, 7, [7, 8]);
pruef('Fahrzeug und zugeteilter Fahrer werden angenommen',
    $r['ok'] === true && $r['wert']['fahrzeug_id'] === 1 && $r['wert']['fahrer_id'] === 7);

// ── Die Geld-Folge: das Verkehrsmittel des Fahrers ────────────────────────
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (100, 7, NULL, NULL)");
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (100, 8, 'Privatfahrzeug', NULL)");
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (100, 9, 'Oeffentlicher Verkehr', 480)");

$vm = function (PDO $pdo, int $ma) {
    $s = $pdo->prepare('SELECT verkehrsmittel, oev_rappen FROM einsatz_zuteilung
                        WHERE einsatz_id = 100 AND mitarbeiter_id = ?');
    $s->execute([$ma]);
    return $s->fetch();
};

einsatz_fahrer_verkehrsmittel_setzen($pdo, 100, 7, null);
pruef('KRITISCH: der Fahrer bekommt Geschaeftsfahrzeug -- sonst rechnet der Abgleich Fahrkosten fuer das eigene Auto',
    $vm($pdo, 7)['verkehrsmittel'] === 'Geschaeftsfahrzeug');
pruef('KRITISCH: die uebrigen Eingeteilten bleiben unberuehrt -- dass sie mitfahren, waere eine Annahme',
    $vm($pdo, 8)['verkehrsmittel'] === 'Privatfahrzeug'
    && $vm($pdo, 9)['verkehrsmittel'] === 'Oeffentlicher Verkehr'
    && (int)$vm($pdo, 9)['oev_rappen'] === 480);

// Fahrerwechsel: Der bisherige faellt auf die Vorgabe seines Stammblatts
// zurueck (NULL), nicht auf ein stehengebliebenes 'Geschaeftsfahrzeug'.
einsatz_fahrer_verkehrsmittel_setzen($pdo, 100, 8, 7);
pruef('KRITISCH: beim Fahrerwechsel wird der bisherige Fahrer wieder freigegeben',
    $vm($pdo, 7)['verkehrsmittel'] === null);
pruef('Der neue Fahrer bekommt Geschaeftsfahrzeug',
    $vm($pdo, 8)['verkehrsmittel'] === 'Geschaeftsfahrzeug');

// Ein Billettpreis darf am Fahrer nicht als Karteileiche stehenbleiben.
$pdo->exec("UPDATE einsatz_zuteilung SET verkehrsmittel = 'Oeffentlicher Verkehr', oev_rappen = 950
            WHERE einsatz_id = 100 AND mitarbeiter_id = 9");
einsatz_fahrer_verkehrsmittel_setzen($pdo, 100, 9, 8);
pruef('KRITISCH: beim Fahrer wird ein Billettpreis geloescht, statt falsch stehenzubleiben',
    $vm($pdo, 9)['verkehrsmittel'] === 'Geschaeftsfahrzeug' && $vm($pdo, 9)['oev_rappen'] === null);

// Fahrzeugzuteilung geloest: niemand faehrt mehr.
einsatz_fahrer_verkehrsmittel_setzen($pdo, 100, null, 9);
pruef('KRITISCH: ohne Fahrer bleibt kein Geschaeftsfahrzeug stehen',
    $vm($pdo, 9)['verkehrsmittel'] === null);

// Von Hand gesetzte Werte gehoeren dem Planer: Steht beim bisherigen Fahrer
// inzwischen etwas anderes, wird es NICHT ueberschrieben.
$pdo->exec("UPDATE einsatz_zuteilung SET verkehrsmittel = 'Mitfahrer'
            WHERE einsatz_id = 100 AND mitarbeiter_id = 8");
einsatz_fahrer_verkehrsmittel_setzen($pdo, 100, 7, 8);
pruef('KRITISCH: eine von Hand gesetzte Angabe des bisherigen Fahrers bleibt stehen',
    $vm($pdo, 8)['verkehrsmittel'] === 'Mitfahrer');

echo $ok . " Pruefungen bestanden\n";
if ($bad) { foreach ($bad as $b) { echo "  X $b\n"; } exit(1); }
echo "Keine Beanstandung.\n";
