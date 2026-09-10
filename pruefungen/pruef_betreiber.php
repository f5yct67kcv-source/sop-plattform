<?php
// Die reinen Funktionen der Betreiber-Ebene (backend/betreiber.php, ENT-524)
// wirklich ausfuehren -- nicht ihren Quelltext lesen.
//
// Warum diese Datei: Drei Aussagen der Betreiber-Ebene sind Entscheidungen
// und keine Formulierungen, und genau die kann eine Textsuche nicht
// pruefen:
//
//   1. Die Sitzungsfristen sind SCHAERFER als jede bestehende Frist des
//      Hauses. Wer dieses Konto hat, hat jeden Mandanten.
//   2. "GAV-Unterstellung noch nicht bestaetigt" ist etwas anderes als
//      "nicht unterstellt". Ein Ja/Nein mit Vorgabewert wuerde die
//      Bestaetigung stillschweigend vorwegnehmen.
//   3. Der Mandantenstatus ist eine geschlossene Liste, kein freier Text.
//
// Gegenproben stehen jeweils direkt bei der Pruefung.
declare(strict_types=1);
require __DIR__ . '/../backend/betreiber.php';

$ok = 0; $bad = [];
$pruef = function (string $name, bool $bedingung) use (&$ok, &$bad) {
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
};

// ── 1. Sitzungsfristen ────────────────────────────────────────────────
$jetzt = 1_800_000_000;

$pruef('frische Sitzung gilt',
    be_sitzung_abgelaufen($jetzt - 60, $jetzt - 60, $jetzt) === false);

// Ruhe: 30 Minuten. 29 gilt, 31 nicht -- beide Seiten der Grenze, sonst
// bestuende die Pruefung auch bei einer Frist von einer Woche.
$pruef('29 Minuten ohne Nutzung gelten noch',
    be_sitzung_abgelaufen($jetzt - 3600, $jetzt - 29 * 60, $jetzt) === false);
$pruef('31 Minuten ohne Nutzung sind abgelaufen',
    be_sitzung_abgelaufen($jetzt - 3600, $jetzt - 31 * 60, $jetzt) === true);

// Absolutes Alter: 24 Stunden, unabhaengig davon, wie aktiv jemand ist.
// Der zweite Fall ist der wichtige -- eine dauernd genutzte Sitzung darf
// nicht ewig leben.
$pruef('23 Stunden alte, eben genutzte Sitzung gilt',
    be_sitzung_abgelaufen($jetzt - 23 * 3600, $jetzt - 10, $jetzt) === false);
$pruef('25 Stunden alte Sitzung ist abgelaufen, auch wenn eben genutzt',
    be_sitzung_abgelaufen($jetzt - 25 * 3600, $jetzt - 10, $jetzt) === true);

// Der eigentliche Punkt: schaerfer als das Haus. Die Verwaltung laeuft mit
// 7 Tagen absolut (SITZUNG_ADMIN_MAX_TAGE), das Portal mit 90 Tagen.
// Verglichen wird gegen die echten Konstanten aus db.php, nicht gegen
// abgeschriebene Zahlen -- zieht jemand dort die Frist herunter, faellt es
// hier auf.
$pruef('KRITISCH: Betreiber-Frist ist kuerzer als die der Verwaltung',
    BE_SITZUNG_MAX_STUNDEN < SITZUNG_ADMIN_MAX_TAGE * 24);
$pruef('KRITISCH: Betreiber-Ruhefrist ist hoechstens die Bueroruhe',
    BE_SITZUNG_RUHE_MIN <= SITZUNG_BUERO_RUHE_MIN);

// ── 2. GAV-Lage ist dreiwertig ────────────────────────────────────────
$pruef('ohne Bestaetigung: unbestaetigt, nicht "nicht unterstellt"',
    be_gav_lage(null, null) === 'unbestaetigt');
$pruef('leeres Datum zaehlt ebenfalls als unbestaetigt',
    be_gav_lage(0, '') === 'unbestaetigt');
// Die entscheidende Gegenprobe: Auch wenn schon ein Wert gesetzt ist,
// bleibt die Lage unbestaetigt, solange niemand bestaetigt hat. Wer das
// zu einem Ja/Nein zusammenzieht, faellt hier durch.
$pruef('KRITISCH: gesetzter Wert ohne Bestaetigung bleibt unbestaetigt',
    be_gav_lage(1, null) === 'unbestaetigt');
$pruef('bestaetigt und unterstellt',
    be_gav_lage(1, '2026-09-10 08:00:00') === 'unterstellt');
$pruef('bestaetigt und nicht unterstellt',
    be_gav_lage(0, '2026-09-10 08:00:00') === 'nicht_unterstellt');

// ── 3. Mandantenstatus ist eine geschlossene Liste ────────────────────
foreach (['aktiv', 'gesperrt', 'gekuendigt'] as $s) {
    $pruef("Status $s ist gueltig", be_mandant_status_gueltig($s) === true);
}
$pruef('KRITISCH: freier Text ist kein gueltiger Status',
    be_mandant_status_gueltig('irgendwas') === false);
$pruef('leerer Status ist ungueltig',
    be_mandant_status_gueltig('') === false);

// ── 4. Kanton wird normalisiert, nicht geraten ────────────────────────
$pruef('Kanton wird gross geschrieben', be_kanton_normal(' be ') === 'BE');
$pruef('leerer Kanton ist null, nicht ein leerer String', be_kanton_normal('  ') === null);
// Gegenprobe: Was nicht wie ein Kuerzel aussieht, wird nicht durchgereicht.
$pruef('KRITISCH: Unsinn wird nicht als Kanton uebernommen',
    be_kanton_normal('Bern') === null && be_kanton_normal('B') === null
    && be_kanton_normal('B3') === null);

// ── 5. Verbindungslage unterscheidet drei Faelle ──────────────────────
//
// Der wichtige ist der dritte: Halb ausgefuellte Angaben sind etwas anderes
// als "nutzt die Standardverbindung". Wer beide zusammenzieht, zeigt einen
// unerreichbaren Mandanten als eingerichtet an.
$leer = ['db_host' => '', 'db_name' => '', 'db_user' => ''];
$voll = ['db_host' => 'h', 'db_name' => 'n', 'db_user' => 'u'];
$halb = ['db_host' => 'h', 'db_name' => '',  'db_user' => ''];
$pruef('alles leer heisst Standardverbindung',
    be_verbindung_lage($leer) === 'standardverbindung');
$pruef('alles gefuellt heisst eigene Datenbank',
    be_verbindung_lage($voll) === 'eigene_datenbank');
$pruef('KRITISCH: halb ausgefuellt ist ein eigener Fall, nicht Standardverbindung',
    be_verbindung_lage($halb) === 'unvollstaendig');
$pruef('fehlende Schluessel zaehlen wie leer',
    be_verbindung_lage([]) === 'standardverbindung');

// ── 6. Der Schreibweg des Mandanten ist eine geschlossene Liste ───────
$pruef('KRITISCH: Status und GAV stehen nicht im Sammel-Schreibweg',
    !in_array('status', BE_MANDANT_FELDER, true)
    && !in_array('gav_unterstellt', BE_MANDANT_FELDER, true)
    && !in_array('gav_bestaetigt_am', BE_MANDANT_FELDER, true));
$pruef('KRITISCH: kein Passwortfeld im Schreibweg',
    count(array_filter(BE_MANDANT_FELDER,
        static fn($f) => str_contains($f, 'pass') || $f === 'secret')) === 0);

// ── 7. Verbindungsaufloesung je Mandant ───────────────────────────────
//
// In dieser Umgebung ist der Deploy-Platzhalter __MANDANT_SECRETS__
// unersetzt -- der heutige Normalfall, solange es keine fremden Mandanten
// gibt. mandant_secret() muss das als "kein Secret" behandeln und nicht als
// Secret mit dem Namen des Platzhalters.
$pruef('KRITISCH: unersetzter Platzhalter liefert kein Secret',
    mandant_secret('DB_PASS_MANDANT_2') === null);
$pruef('leerer Name liefert kein Secret', mandant_secret('') === null);

// Vier Lagen, vier Handlungen. Die dritte ist die wichtige: Angaben
// vollstaendig, aber das Deploy-Secret fehlt -- das ist etwas anderes als
// "unvollstaendig ausgefuellt" und etwas anderes als "bereit".
$standard = ['db_host' => '', 'db_name' => '', 'db_user' => '', 'secret_name' => ''];
$halb     = ['db_host' => 'h', 'db_name' => '', 'db_user' => '', 'secret_name' => ''];
$ganz     = ['db_host' => 'h', 'db_name' => 'n', 'db_user' => 'u', 'secret_name' => 'DB_PASS_X'];
$pruef('leere Angaben heissen Standardverbindung',
    mandant_verbindung_bereit($standard) === 'standardverbindung');
$pruef('halb ausgefuellt bleibt unvollstaendig',
    mandant_verbindung_bereit($halb) === 'unvollstaendig');
$pruef('KRITISCH: vollstaendige Angaben ohne Secret sind nicht bereit',
    mandant_verbindung_bereit($ganz) === 'secret_fehlt');

// mandant_db() wirft, statt eine Antwort zu schicken: Der Aufrufer
// entscheidet, wie ein nicht erreichbarer Mandant gemeldet wird.
$geworfen = false;
try { mandant_db($ganz); } catch (Throwable $e) { $geworfen = true; }
$pruef('KRITISCH: mandant_db wirft bei fehlendem Secret, statt zu verbinden', $geworfen);
// Die Standardverbindung ist der Bestandsmandant -- sie darf NICHT werfen.
// Geprueft wird ueber die Lage, ohne eine Datenbank zu brauchen.
$pruef('die Standardverbindung gilt als bereit',
    mandant_verbindung_bereit($standard) === 'standardverbindung');

// mandant_stand() meldet die Lage, ohne dass eine Verbindung noetig ist.
$st = mandant_stand($ganz);
$pruef('KRITISCH: nicht erreichbar wird als solches gemeldet',
    $st['erreichbar'] === false && $st['lage'] === 'secret_fehlt');
$pruef('ohne Verbindung wird keine Tabellenzahl behauptet',
    $st['tabellen'] === null);

echo count($bad) === 0
    ? "$ok bestanden, 0 nicht bestanden\n"
    : "$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "x $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
