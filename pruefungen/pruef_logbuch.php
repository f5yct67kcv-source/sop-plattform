<?php
declare(strict_types=1);
// Echte Ausfuehrung des Logbuchs (ENT-077), gegen eine wirkliche Datenbank.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

$GLOBALS['tabelleDa'] = true;
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool { return $GLOBALS['tabelleDa']; }

require __DIR__ . '/../backend/logbuch.php';

// ══════════════ SCHEINAENDERUNGEN -- der Grund fuer logbuch_normal()
// Ein Logbuch voller Eintraege, bei denen sich nichts geaendert hat, ist so
// unbrauchbar wie gar keines.
pruef('KRITISCH: 5 und 5.0 sind derselbe Wert',      logbuch_normal('5') === logbuch_normal('5.0'));
pruef('KRITISCH: 8.5 und 8.50 sind derselbe Wert',   logbuch_normal('8.5') === logbuch_normal('8.50'));
pruef('Leer und nicht gesetzt sind dasselbe',        logbuch_normal(null) === logbuch_normal(''));
pruef('Ein Nulldatum ist "nicht erfasst", nicht ein Datum',
    logbuch_normal('0000-00-00') === '' && logbuch_normal('0000-00-00 00:00:00') === '');
pruef('Datum mit und ohne Mitternachts-Uhrzeit ist dasselbe',
    logbuch_normal('2026-08-21 00:00:00') === logbuch_normal('2026-08-21'));
pruef('Leerzeichen am Rand sind keine Aenderung',    logbuch_normal(' Muster ') === logbuch_normal('Muster'));
pruef('Ja/Nein wird einheitlich',                    logbuch_normal(true) === '1' && logbuch_normal(false) === '0');
pruef('KRITISCH: eine echte Aenderung bleibt eine',  logbuch_normal('8.5') !== logbuch_normal('8.6'));
pruef('KRITISCH: 0 und leer sind NICHT dasselbe',    logbuch_normal('0') !== logbuch_normal(''));
pruef('Eine Zahl mit Uhrzeit-Aussehen bleibt Text',  logbuch_normal('08:30') === '08:30');

// ══════════════ LANGE TEXTE
$lang = str_repeat('a', 900);
pruef('Ein sehr langer Text wird gekuerzt',   mb_strlen((string)logbuch_kuerzen($lang)) === 500);
pruef('Die Kuerzung ist als solche erkennbar', str_ends_with((string)logbuch_kuerzen($lang), '...'));
pruef('Kurze Texte bleiben unveraendert',      logbuch_kuerzen('kurz') === 'kurz');
pruef('null bleibt null',                      logbuch_kuerzen(null) === null);

// ══════════════ GEGEN EINE ECHTE DATENBANK
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec("CREATE TABLE aenderungslog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zeitpunkt TEXT DEFAULT CURRENT_TIMESTAMP,
  akteur_id INT NOT NULL, akteur_name TEXT NOT NULL,
  bereich TEXT NOT NULL, objekt_id INT NOT NULL, feld TEXT NOT NULL,
  wert_alt TEXT NULL, wert_neu TEXT NULL, werte_verborgen INT NOT NULL DEFAULT 0)");

$chefin  = ['id' => 1, 'name' => 'chefin'];
$geheim  = ['ahv_nr', 'zemis_nr', 'strafregister_datum'];

$vorher  = ['vorname' => 'Anna', 'pensum_stunden' => '42', 'ahv_nr' => '756.1111.1111.11',
            'telefon' => '', 'eintritt' => '2020-01-01', 'bemerkung' => 'nichts'];
$nachher = ['vorname' => 'Anna', 'pensum_stunden' => '42.0', 'ahv_nr' => '756.2222.2222.22',
            'telefon' => '079 000 00 00', 'eintritt' => '2020-01-01', 'bemerkung' => 'neu'];

$zahl = logbuch_vergleichen($pdo, $chefin, 'mitarbeiter', 7, $vorher, $nachher, $geheim);
pruef('KRITISCH: nur die drei echten Aenderungen stehen im Buch', $zahl === 3);

$eintraege = logbuch_lesen($pdo, 'mitarbeiter', 7);
$nachFeld  = [];
foreach ($eintraege as $e) { $nachFeld[$e['feld']] = $e; }

pruef('Das unveraenderte Feld fehlt zu Recht',        !isset($nachFeld['vorname']));
pruef('KRITISCH: 42 auf 42.0 ist keine Aenderung',    !isset($nachFeld['pensum_stunden']));
pruef('Das geaenderte Telefon steht drin',            isset($nachFeld['telefon']));
pruef('Mit altem und neuem Wert',
    $nachFeld['telefon']['wert_alt'] === '' && $nachFeld['telefon']['wert_neu'] === '079 000 00 00');
pruef('Und mit dem Namen der Person, die es getan hat',
    $nachFeld['telefon']['akteur_name'] === 'chefin' && $nachFeld['telefon']['akteur_id'] === 1);
pruef('Mit Zeitstempel', !empty($nachFeld['telefon']['zeitpunkt']));

pruef('KRITISCH: die AHV-Aenderung wird festgehalten', isset($nachFeld['ahv_nr']));
pruef('KRITISCH: aber OHNE die Nummern selbst',
    $nachFeld['ahv_nr']['wert_alt'] === null && $nachFeld['ahv_nr']['wert_neu'] === null);
pruef('Und ist als verborgen gekennzeichnet, nicht als "war leer"',
    $nachFeld['ahv_nr']['werte_verborgen'] === true);
pruef('Bei den offenen Feldern ist nichts verborgen',
    $nachFeld['telefon']['werte_verborgen'] === false);

// Ein Feld, das im alten Stand gar nicht vorkommt, wird nicht erfunden
logbuch_vergleichen($pdo, $chefin, 'mitarbeiter', 7, ['a' => '1'], ['a' => '1', 'b' => 'neu'], []);
pruef('KRITISCH: ein Feld ohne Vorzustand erzeugt keinen Eintrag',
    count(logbuch_lesen($pdo, 'mitarbeiter', 7)) === 3);

// ══════════════ ABGRENZUNG UND SCHUTZ
pruef('KRITISCH: ein fremder Bereich wird nicht geschrieben',
    logbuch_schreiben($pdo, $chefin, 'kunden', 1, 'name', 'a', 'b') === false);
pruef('Und beim Lesen auch nicht geliefert', logbuch_lesen($pdo, 'kunden', 1) === []);

logbuch_vergleichen($pdo, ['id' => 2, 'name' => 'zweite'], 'mitarbeiter', 8,
    ['ort' => 'Olten'], ['ort' => 'Bern'], []);
pruef('KRITISCH: der Verlauf einer Person zeigt nicht den einer anderen',
    count(logbuch_lesen($pdo, 'mitarbeiter', 8)) === 1
    && count(logbuch_lesen($pdo, 'mitarbeiter', 7)) === 3);
pruef('Ohne Person kommt der ganze Bereich',  count(logbuch_lesen($pdo, 'mitarbeiter')) === 4);
pruef('Das Neueste steht oben',
    logbuch_lesen($pdo, 'mitarbeiter')[0]['objekt_id'] === 8);

$GLOBALS['tabelleDa'] = false;
pruef('KRITISCH: ohne Tabelle wird nicht geschrieben statt zu scheitern',
    logbuch_schreiben($pdo, $chefin, 'mitarbeiter', 7, 'x', 'a', 'b') === false);
pruef('Ohne Tabelle liefert das Lesen eine leere Liste, keinen Fehler',
    logbuch_lesen($pdo, 'mitarbeiter', 7) === []);
$GLOBALS['tabelleDa'] = true;

// ══════════════ DER BEREICH 'fahrzeug' (ENT-330)
// logbuch_schreiben() nimmt nur bekannte Bereiche an und meldet einen
// unbekannten NICHT als Fehler, sondern gibt still false zurueck. Faellt
// 'fahrzeug' aus der Liste, hoert das Fahrzeug-Protokoll also lautlos auf --
// genau die Art Ausfall, die niemand bemerkt. Darum hier ausgefuehrt und
// nicht im Quelltext nachgelesen.
pruef('KRITISCH: der Bereich "fahrzeug" wird angenommen',
    logbuch_schreiben($pdo, $chefin, 'fahrzeug', 42, 'tacho_km', '20000', '20450') === true);
pruef('KRITISCH: ein Kilometerstand steht mit altem UND neuem Wert im Verlauf',
    (function () use ($pdo) {
        $e = logbuch_lesen($pdo, 'fahrzeug', 42);
        return count($e) === 1 && $e[0]['feld'] === 'tacho_km'
            && $e[0]['wert_alt'] === '20000' && $e[0]['wert_neu'] === '20450';
    })());
pruef('Der Verlauf eines Fahrzeugs enthaelt keine fremden Bereiche',
    logbuch_lesen($pdo, 'fahrzeug', 7) === []);
pruef('KRITISCH: ein unbekannter Bereich wird weiterhin abgewiesen',
    logbuch_schreiben($pdo, $chefin, 'erfundenerbereich', 1, 'x', 'a', 'b') === false);

// Ein misslungener Eintrag darf das Speichern nicht verhindern
$pdo->exec('DROP TABLE aenderungslog');
$konnte = true;
try { logbuch_schreiben($pdo, $chefin, 'mitarbeiter', 7, 'x', 'a', 'b'); }
catch (Throwable $e) { $konnte = false; }
pruef('KRITISCH: ein Fehler im Logbuch reisst das Speichern nicht mit', $konnte);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
