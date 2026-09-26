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

// Tabellen- und Spaltenauskunft fuer SQLite. db.php definiert beide nur,
// wenn es sie noch nicht gibt (`function_exists`), und seine Fassung fragt
// information_schema -- die es in SQLite nicht gibt. Darum hier zuerst, und
// ehrlich statt pauschal: Ein Stub, der auf jeden Namen "ja" sagt, koennte
// eine fehlende Nachtragsspalte nicht bemerken.
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
$pruef('KRITISCH: die Subdomain steht im Schreibweg -- sonst laesst sich ein Demo-Platz '
     . 'im Betreiber-Bereich gar nicht zuteilen',
    in_array('subdomain', BE_MANDANT_FELDER, true));

// ── 7. Verbindungsaufloesung je Mandant ───────────────────────────────
//
// In dieser Umgebung ist der Deploy-Platzhalter __MANDANT_SECRETS__
// unersetzt -- der heutige Normalfall, solange es keine fremden Mandanten
// gibt. mandant_secret() muss das als "kein Secret" behandeln und nicht als
// Secret mit dem Namen des Platzhalters.
$pruef('KRITISCH: unersetzter Platzhalter liefert kein Secret',
    mandant_secret('DB_PASS_MANDANT_2') === null);
$pruef('leerer Name liefert kein Secret', mandant_secret('') === null);

// mandant_secrets_tafel_pruefen() ist die testbare Zerlegung (OP-526):
// mandant_secret() selbst reicht ihr nur den hartcodierten Platzhalter
// hinein, hier wird mit frei gewaehlten Werten geprueft.
$pruef('leere Eingabe ergibt keine Eintraege', mandant_secrets_tafel_pruefen('') === []);
$pruef('der unersetzte Platzhalter selbst ergibt keine Eintraege',
    mandant_secrets_tafel_pruefen('__MANDANT' . '_SECRETS__') === []);
// DER wichtige Fall: base64(JSON) wird tatsaechlich entschluesselt und
// gelesen -- nicht nur behauptet.
$echtesGeheimnis = base64_encode(json_encode(['demo1' => 'Ab1$cd&ef|gh']));
// Absichtlich mit "&" und "|" im Passwort -- genau den Zeichen, an denen
// ein rohes sed (ohne base64) zerbricht (siehe deploy-hostpoint.yml).
$pruef('KRITISCH: base64(JSON) wird entschluesselt, ein Passwort mit "&" und "|" bleibt unversehrt',
    mandant_secrets_tafel_pruefen($echtesGeheimnis) === ['demo1' => 'Ab1$cd&ef|gh']);
// Gegenprobe zur Base64-Entscheidung: Rohes JSON (kein base64) wird nicht
// als Zufallstreffer fehlinterpretiert, sondern ergibt sauber nichts.
$pruef('rohes JSON statt base64 ergibt keine Eintraege, keinen Absturz',
    mandant_secrets_tafel_pruefen('{"demo1":"pw"}') === []);
// Gueltiges base64, aber kein JSON dahinter -- auch das ergibt nichts,
// nicht einen Fehler.
$pruef('gueltiges base64 ohne JSON dahinter ergibt keine Eintraege',
    mandant_secrets_tafel_pruefen(base64_encode('einfach nur Text')) === []);

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

// ── 8. Die Grenze des Bootstraps ──────────────────────────────────────
//
// Das erste Betreiber-Konto kommt ueber die Verwaltung eines Betriebs --
// es kann sich nicht selbst anlegen. Bei getrennten Datenbanken hat aber
// JEDER Mandant eine eigene Verwaltung, und alle teilen sich dieselbe
// Betreiber-Datenbank. Ohne Grenze koennte die Verwaltung eines fremden
// Betriebs sich ein Konto ausstellen und haette Zugriff auf alle.
//
// Geprueft wird die reine Entscheidungsregel mit frei gewaehlten Werten --
// der Fall "mehrere Mandanten" liesse sich hier sonst gar nicht herstellen.
$pruef('kein Mandant eingetragen: Bootstrap offen', be_bootstrap_grenze(0) === true);
$pruef('genau ein Mandant: Bootstrap noch offen',   be_bootstrap_grenze(1) === true);
// Das ist die eigentliche Aussage.
$pruef('KRITISCH: ab dem zweiten Mandanten ist der Bootstrap zu',
    be_bootstrap_grenze(2) === false);
$pruef('KRITISCH: auch bei vielen Mandanten bleibt er zu',
    be_bootstrap_grenze(20) === false);

// ── Der Zaehlstand (ENT-539) ──────────────────────────────────────────
//
// Die Entscheidung, die hier geprueft wird: HOECHSTENS EINMAL je Mandant
// und Monat, und der ERSTE Eintrag gewinnt. Ohne diese Regel verschoebe
// sich der festgehaltene Stand mit jedem Seitenaufruf, und wovon eine
// Rechnung ausgeht, haenge davon ab, wann jemand zuletzt hingeschaut hat.
{
    $be = new PDO('sqlite::memory:', null, null,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $be->exec('CREATE TABLE mandant_zaehlstand (
        id INTEGER PRIMARY KEY AUTOINCREMENT, mandant_id INTEGER NOT NULL,
        monat TEXT NOT NULL, stichtag TEXT NOT NULL,
        ma_gesamt INTEGER NOT NULL, ma_aktiv INTEGER NOT NULL, ma_im_einsatz INTEGER NULL,
        erfasst_am TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (mandant_id, monat))');

    $erst  = ['gesamt' => 12, 'aktiv' => 9, 'im_einsatz' => 7];
    $spaet = ['gesamt' => 40, 'aktiv' => 38, 'im_einsatz' => 30];

    $a = zaehlstand_festhalten($be, 1, $erst, '2026-09', '2026-09-11');
    $pruef('der erste Aufruf haelt fest', $a !== null && $a['neu'] === true);

    $b = zaehlstand_festhalten($be, 1, $spaet, '2026-09', '2026-09-28');
    $pruef('ein zweiter Aufruf im selben Monat schreibt nicht', $b !== null && $b['neu'] === false);

    $zeilen = $be->query('SELECT * FROM mandant_zaehlstand WHERE mandant_id = 1')->fetchAll();
    $pruef('KRITISCH: es steht genau eine Zeile je Mandant und Monat', count($zeilen) === 1);
    // Das ist die eigentliche Aussage: NICHT der zuletzt gesehene Stand.
    $pruef('KRITISCH: der ERSTE Stand bleibt stehen, nicht der spaetere',
        (int)$zeilen[0]['ma_aktiv'] === 9 && (int)$zeilen[0]['ma_gesamt'] === 12);
    $pruef('der Stichtag des ersten Aufrufs bleibt stehen',
        $zeilen[0]['stichtag'] === '2026-09-11');

    // Ein anderer Monat ist ein anderer Stand.
    $c = zaehlstand_festhalten($be, 1, $spaet, '2026-10', '2026-10-01');
    $pruef('ein anderer Monat wird eigenstaendig festgehalten', $c !== null && $c['neu'] === true);
    $pruef('danach stehen zwei Monate da',
        (int)$be->query('SELECT COUNT(*) FROM mandant_zaehlstand WHERE mandant_id = 1')->fetchColumn() === 2);

    // Ein anderer Mandant im selben Monat ebenfalls.
    zaehlstand_festhalten($be, 2, $erst, '2026-09', '2026-09-11');
    $pruef('zwei Mandanten teilen sich keinen Stand',
        (int)$be->query('SELECT COUNT(*) FROM mandant_zaehlstand WHERE monat = \'2026-09\'')->fetchColumn() === 2);

    // Nicht erreichbar heisst NICHTS festhalten -- nicht "null Mitarbeitende".
    // Eine Null waere eine Erfindung, die wie eine Auskunft aussieht.
    $d = zaehlstand_festhalten($be, 3, null, '2026-09', '2026-09-11');
    $pruef('KRITISCH: ohne Zahlen wird nichts festgehalten', $d === null);
    $pruef('KRITISCH: und schon gar keine Null',
        (int)$be->query('SELECT COUNT(*) FROM mandant_zaehlstand WHERE mandant_id = 3')->fetchColumn() === 0);

    // "Nicht feststellbar" bei einer einzelnen Zahl bleibt NULL und wird
    // nicht zu 0 gerechnet.
    zaehlstand_festhalten($be, 4, ['gesamt' => 5, 'aktiv' => 5, 'im_einsatz' => null], '2026-09', '2026-09-11');
    $r = $be->query('SELECT ma_im_einsatz FROM mandant_zaehlstand WHERE mandant_id = 4')->fetch();
    $pruef('KRITISCH: eine nicht feststellbare Teilzahl bleibt unbekannt, nicht null',
        $r['ma_im_einsatz'] === null);
}

// ══════════════ NAMENSTEILE (ENT-615)
//
// Die Teilung laeuft EINMAL ueber den Bestand. Ein Fehler hier steht danach
// dauerhaft in der Liste, und niemand sieht ihm an, dass er aus einer
// Nachtragsspalte stammt -- darum ausgefuehrt und nicht nachgelesen.
$pruef('KRITISCH: das erste Wort ist der Vorname, der Rest der Nachname',
    be_name_teilen('Anna von Gunten') === ['vorname' => 'Anna', 'nachname' => 'von Gunten']);
$pruef('Zwei Wortteile werden normal geteilt',
    be_name_teilen('Peter Muster') === ['vorname' => 'Peter', 'nachname' => 'Muster']);
$pruef('KRITISCH: ein einzelnes Wort gilt als Nachname, nicht als Vorname',
    be_name_teilen('Muster') === ['vorname' => '', 'nachname' => 'Muster']);
$pruef('Mehrfache Leerzeichen erzeugen keine leeren Teile',
    be_name_teilen('  Anna   von   Gunten  ') === ['vorname' => 'Anna', 'nachname' => 'von Gunten']);
$pruef('Ein leerer Name ergibt zwei leere Teile, keine Erfindung',
    be_name_teilen('') === ['vorname' => '', 'nachname' => '']);
$pruef('KRITISCH: Teilen und wieder Zusammensetzen ergibt denselben Namen',
    be_name_bauen(...array_values(be_name_teilen('Anna von Gunten'))) === 'Anna von Gunten');
$pruef('Ohne Vorname entsteht kein fuehrendes Leerzeichen',
    be_name_bauen('', 'Muster') === 'Muster');

// ══════════════ NACHTRAG UEBER EINEN ECHTEN BESTAND
$nb = new PDO('sqlite::memory:', null, null,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$nb->exec("CREATE TABLE betreiber (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  anrede TEXT NOT NULL DEFAULT '', vorname TEXT NOT NULL DEFAULT '', nachname TEXT NOT NULL DEFAULT '')");
$nb->exec("INSERT INTO betreiber (name) VALUES ('Anna von Gunten'), ('Muster')");
$nb->exec("INSERT INTO betreiber (name, vorname, nachname) VALUES ('Peter Muster', 'Peter', 'Muster')");

$zahl = be_namen_nachtragen($nb);
$pruef('KRITISCH: der Nachtrag fasst nur Konten ohne Namensteile an', $zahl === 2);
$alle = $nb->query('SELECT name, vorname, nachname FROM betreiber ORDER BY id')->fetchAll();
$pruef('KRITISCH: der Bestand wird richtig geteilt',
    $alle[0]['vorname'] === 'Anna' && $alle[0]['nachname'] === 'von Gunten');
$pruef('Ein einzelnes Wort landet im Nachnamen',
    $alle[1]['vorname'] === '' && $alle[1]['nachname'] === 'Muster');
$pruef('KRITISCH: der Anzeigename wird dabei nicht veraendert',
    $alle[0]['name'] === 'Anna von Gunten');
$pruef('KRITISCH: ein zweiter Lauf aendert nichts mehr', be_namen_nachtragen($nb) === 0);

// ══════════════ VERTRAGSLAGE (ENT-617)
//
// Der naechste moegliche Kuendigungstermin wird GERECHNET und nie
// gespeichert. Das heisst: Diese Rechnung ist die einzige Quelle, und ein
// Fehler darin verschiebt einen Termin, an dem Geld haengt -- darum
// ausgefuehrt und nicht nachgelesen.
//
// Alle Faelle mit ausdruecklichem "heute" und Jahreszahlen weit weg vom
// heutigen Tag: Ein Fall, der beim Datumswechsel kippt, prueft nichts
// (test_datumsfest.mjs achtet darauf).
$v = ['vertrag_beginn' => '2040-01-31', 'mindestlaufzeit_monate' => 12,
      'kuendigungsfrist_monate' => 3, 'verlaengerung_monate' => 12];

$a = be_vertrag_lage($v, '2040-09-18');
$pruef('KRITISCH: waehrend der Mindestlaufzeit laeuft der Vertrag', $a['lage'] === 'laeuft');
$pruef('KRITISCH: das erste Ende ist Beginn plus Mindestlaufzeit',
    $a['ende'] === '2041-01-31');
$pruef('KRITISCH: die Kuendigung muss die Frist vorher da sein',
    $a['spaetestens'] === '2040-10-31');

// Einen Tag NACH dem Stichtag zaehlt das erste Ende nicht mehr.
$b = be_vertrag_lage($v, '2040-11-01');
$pruef('KRITISCH: ist der Stichtag vorbei, gilt das naechste Ende',
    $b['ende'] === '2042-01-31' && $b['spaetestens'] === '2041-10-31');
$pruef('Am Stichtag selbst geht es noch',
    be_vertrag_lage($v, '2040-10-31')['ende'] === '2041-01-31');

// ── Monatsklemmung: der 31. plus ein Monat ist nicht der 3. des
//    uebernaechsten. Bei einer Frist sind das zwei Tage in die falsche
//    Richtung -- genau die, auf die es ankommt.
$pruef('KRITISCH: 31. Januar minus ein Monat bleibt im Dezember',
    be_monate_dazu('2040-01-31', -1) === '2039-12-31');
$pruef('KRITISCH: 31. Maerz minus ein Monat ist der 29. Februar (Schaltjahr)',
    be_monate_dazu('2040-03-31', -1) === '2040-02-29');
$pruef('KRITISCH: 31. Maerz minus ein Monat ist der 28. Februar (kein Schaltjahr)',
    be_monate_dazu('2041-03-31', -1) === '2041-02-28');
$pruef('31. Mai plus ein Monat ist der 30. Juni, nicht der 1. Juli',
    be_monate_dazu('2040-05-31', 1) === '2040-06-30');
$pruef('Ein Monatsanfang bleibt ein Monatsanfang',
    be_monate_dazu('2040-01-01', 12) === '2041-01-01');

// ── Die fuenf Lagen, und keine sieht aus wie eine andere ──────────────
$pruef('KRITISCH: ohne Beginn ist die Lage unbekannt, nicht "sofort kuendbar"',
    be_vertrag_lage([], '2040-09-18')['lage'] === 'unbekannt');
$pruef('KRITISCH: unbekannt liefert auch keinen Termin, der wie einer aussieht',
    be_vertrag_lage([], '2040-09-18')['ende'] === null);
$pruef('Ohne Mindestlaufzeit ist der Vertrag unbefristet, nicht unbekannt',
    be_vertrag_lage(['vertrag_beginn' => '2040-01-01', 'kuendigungsfrist_monate' => 3],
        '2040-09-18')['lage'] === 'ohne_ende');

// Ohne Verlaengerung endet der Vertrag an seinem einzigen Ende.
$ohneV = ['vertrag_beginn' => '2040-01-01', 'mindestlaufzeit_monate' => 12,
          'kuendigungsfrist_monate' => 3, 'verlaengerung_monate' => 0];
$c = be_vertrag_lage($ohneV, '2040-11-01');
$pruef('KRITISCH: ohne Verlaengerung und nach dem Stichtag laeuft er aus',
    $c['lage'] === 'laeuft_aus' && $c['ende'] === '2041-01-01');
$pruef('KRITISCH: er gilt aber noch -- "laeuft aus" ist nicht "beendet"',
    $c['beendet'] === false);
$pruef('KRITISCH: erst nach dem Ende ist er beendet',
    be_vertrag_lage($ohneV, '2041-06-01')['beendet'] === true);
$pruef('Vor dem Stichtag ist er dagegen noch kuendbar',
    be_vertrag_lage($ohneV, '2040-06-01')['lage'] === 'laeuft');

// Eine Kuendigung schlaegt jede Rechnung: Steht das Datum, gilt es.
$gek = $v + ['gekuendigt_per' => '2041-01-31'];
$pruef('KRITISCH: ein gekuendigter Vertrag endet am eingetragenen Tag',
    be_vertrag_lage($gek, '2040-09-18')['lage'] === 'gekuendigt'
    && be_vertrag_lage($gek, '2040-09-18')['ende'] === '2041-01-31');
$pruef('Und ist danach beendet',
    be_vertrag_lage($gek, '2041-06-01')['beendet'] === true);
$pruef('Ein leeres Nulldatum gilt NICHT als Kuendigung',
    be_vertrag_lage($v + ['gekuendigt_per' => '0000-00-00'], '2040-09-18')['lage'] === 'laeuft');

// ── Das 90-Tage-Fenster der Uebersicht ────────────────────────────────
//
// Gemeint ist der Tag, an dem die Kuendigung spaetestens da sein muss --
// nicht das Vertragsende. Wer aufs Ende schaut, merkt die Frist, wenn sie
// vorbei ist.
$lage = be_vertrag_lage($v, '2040-09-18');   // spaetestens 2040-10-31
$pruef('KRITISCH: ein Stichtag in 43 Tagen faellt ins 90-Tage-Fenster',
    be_vertrag_faellig($lage, 90, '2040-09-18') === true);
$pruef('KRITISCH: und in 30 Tagen gemessen nicht',
    be_vertrag_faellig($lage, 30, '2040-09-18') === false);
$pruef('KRITISCH: ein unbekannter Vertrag faellt nie ins Fenster -- unbekannt ist nicht faellig',
    be_vertrag_faellig(be_vertrag_lage([], '2040-09-18'), 90, '2040-09-18') === false);
$pruef('Ein bereits vergangener Stichtag faellt nicht mehr hinein',
    be_vertrag_faellig($lage, 90, '2040-11-05') === false);

// Die Schleife endet auch bei Unsinn -- eine Verlaengerung von 0 Monaten
// wuerde sonst ewig auf der Stelle treten.
$pruef('KRITISCH: die Terminsuche endet auch bei einer Verlaengerung von 0',
    in_array(be_vertrag_lage(['vertrag_beginn' => '2000-01-01', 'mindestlaufzeit_monate' => 1,
        'kuendigungsfrist_monate' => 0, 'verlaengerung_monate' => 0], '2040-09-18')['lage'],
        ['laeuft_aus'], true));

// ══════════════ WIRD DIE ANLAGE BENUTZT (ENT-619)
//
// Vier Antworten, und drei davon wuerden sich ohne diese Pruefung frueher
// oder spaeter vermischen: "nicht feststellbar", "noch nie benutzt" und
// "seit langem still" sehen in einer Tabelle gleich leer aus, meinen aber
// voellig Verschiedenes -- ein Netzausfall gegen einen Kunden auf dem
// Absprung.
$pruef('KRITISCH: eine nicht erreichbare Anlage ist unbekannt, nicht still',
    mandant_stille(null) === null);
$pruef('KRITISCH: fehlen die Spalten, ist es ebenfalls unbekannt',
    mandant_stille(['gesamt' => 5, 'aktiv' => 5]) === null);
$pruef('KRITISCH: erreichbar, aber ohne jede Spur heisst "nie" -- keine erfundene Zahl',
    mandant_stille(['letzter_zugriff' => null, 'letzter_rapport' => null]) === 'nie');
$pruef('Ein Nulldatum zaehlt nicht als Spur',
    mandant_stille(['letzter_zugriff' => '0000-00-00 00:00:00', 'letzter_rapport' => null]) === 'nie');

$pruef('KRITISCH: gezaehlt wird ab dem JUENGEREN der beiden Signale',
    mandant_stille(['letzter_zugriff' => '2040-01-01 08:00:00',
                    'letzter_rapport' => '2040-01-05 12:00:00'], '2040-01-15') === 10);
$pruef('Auch wenn das juengere der Zugriff ist',
    mandant_stille(['letzter_zugriff' => '2040-01-12 08:00:00',
                    'letzter_rapport' => '2040-01-05 12:00:00'], '2040-01-15') === 3);
$pruef('Ein einzelnes Signal genuegt',
    mandant_stille(['letzter_rapport' => '2040-01-14 12:00:00'], '2040-01-15') === 1);
$pruef('Heute ist null Tage, nicht "nie"',
    mandant_stille(['letzter_zugriff' => '2040-01-15 07:00:00'], '2040-01-15') === 0);
$pruef('KRITISCH: ein Stempel aus der Zukunft ergibt keinen negativen Abstand',
    mandant_stille(['letzter_zugriff' => '2040-02-01 08:00:00'], '2040-01-15') === 0);

// Die Unterscheidung muss auch im TYP tragen: 'nie' und 0 sind beide
// "falsy"-nah, und eine Oberflaeche, die nur auf Wahrheitswerte schaut,
// wuerde sie vermischen.
$pruef('KRITISCH: "nie" und 0 Tage sind unterscheidbar, nicht beide leer',
    mandant_stille(['letzter_zugriff' => null]) === 'nie'
    && mandant_stille(['letzter_zugriff' => date('Y-m-d') . ' 07:00:00']) === 0
    && mandant_stille(['letzter_zugriff' => null]) !== mandant_stille(['letzter_zugriff' => date('Y-m-d') . ' 07:00:00']));

// ══ Warum eine Mandanten-Verbindung scheiterte (Befund 2026-09-19) ═══
//
// ANLASS: Beim Einrichten meldeten zwei Demo-Plaetze "Verbindung
// fehlgeschlagen" -- und damit war nicht zu erkennen, ob die Datenbank
// fehlt, das Passwort nicht stimmt oder der Server schweigt. Drei
// Ursachen, drei Handgriffe an drei Orten.
//
// DIE ZWEITE HAELFTE IST DIE WICHTIGERE: Der Treibertext traegt Host,
// Benutzer und oft den Datenbanknamen und darf NICHT durchgereicht
// werden. Geprueft wird beides -- dass die Ursache benannt wird, und dass
// dabei nichts aus der Anlage mitgeht.
$fall = fn (string $text): string => be_verbindungsfehler_text(new PDOException($text));

$pruef('KRITISCH: eine fehlende Datenbank wird als solche benannt',
    str_contains($fall('SQLSTATE[HY000] [1049] Unknown database'), 'gibt es nicht'));
$pruef('KRITISCH: abgewiesene Zugangsdaten werden als solche benannt',
    str_contains($fall('SQLSTATE[HY000] [1045] Access denied'), 'Zugangsdaten'));
$pruef('ein schweigender Server ist etwas Drittes',
    str_contains($fall('SQLSTATE[HY000] [2002] Connection refused'), 'antwortet nicht'));
// Vier Aussagen, vier Texte: Die drei oben duerfen nicht denselben Satz
// ergeben, sonst ist die Unterscheidung nur behauptet.
$pruef('KRITISCH: die drei Ursachen ergeben drei verschiedene Texte',
    count(array_unique([
        $fall('SQLSTATE[HY000] [1049] x'),
        $fall('SQLSTATE[HY000] [1045] x'),
        $fall('SQLSTATE[HY000] [2002] x'),
    ])) === 3);
// Ein unbekannter Code ist nicht dasselbe wie gar kein Code -- wer den
// naechsten Fall untersucht, braucht die Zahl.
$pruef('ein unbekannter Code wird mitgegeben, statt als "unbekannt" zu verschwinden',
    str_contains($fall('SQLSTATE[HY000] [9999] x'), '9999'));
$pruef('ganz ohne Code bleibt es beim schlichten Satz',
    $fall('irgendein Text') === 'Verbindung fehlgeschlagen');

// DER Punkt: Nichts aus dem Treibertext darf durchsickern.
$verraeterisch = 'SQLSTATE[HY000] [1045] Access denied for user '
    . "'db_benutzer'@'10.0.0.7' to database 'geheime_db' (using password: YES)";
$hinaus = $fall($verraeterisch);
$pruef('KRITISCH: weder Benutzer noch Host noch Datenbankname gehen nach aussen',
    !str_contains($hinaus, 'db_benutzer') && !str_contains($hinaus, '10.0.0.7')
    && !str_contains($hinaus, 'geheime_db'));
$pruef('KRITISCH: auch der englische Treibertext selbst geht nicht mit',
    !str_contains($hinaus, 'Access denied') && !str_contains($hinaus, 'SQLSTATE'));
// Auch der Ausnahmetext eines ganz anderen Fehlers darf nicht
// durchgereicht werden -- die Liste ist geschlossen, nicht ergaenzend.
$pruef('KRITISCH: ein beliebiger Ausnahmetext wird nicht weitergereicht',
    !str_contains($fall('Interner Pfad /home/user/geheim.php'), 'geheim.php'));
// Und derselbe Test auf dem RUECKFALLPFAD (Befund an der eigenen
// Gegenprobe): Die Zeile fuer den unbekannten Code ist die einzige, die
// etwas Berechnetes ausgibt statt eines festen Satzes -- ein Treibertext,
// der dort durchgereicht wuerde, entkaeme allen Pruefungen oben, weil die
// alle einen BEKANNTEN Code benutzen und gar nicht dorthin kommen.
$unbekannt = $fall("SQLSTATE[HY000] [9999] Access denied for user "
    . "'db_benutzer'@'10.0.0.7' to database 'geheime_db'");
$pruef('KRITISCH: auch beim unbekannten Code geht nichts aus der Anlage mit',
    str_contains($unbekannt, '9999')
    && !str_contains($unbekannt, 'db_benutzer') && !str_contains($unbekannt, '10.0.0.7')
    && !str_contains($unbekannt, 'geheime_db') && !str_contains($unbekannt, 'Access denied'));

// ── Unterschrift in der Kontenliste: "ob" ohne das Bild (2026-09-26) ──
// be_unterschrift_da() muss dieselben drei Aussagen treffen wie
// be_unterschrift_von(): null = Spalte fehlt, sonst gezeichnet ja/nein.
// Leerer Text und reine Leerzeichen gelten wie dort als "nicht gezeichnet".
$ud = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$ud->exec('CREATE TABLE betreiber (id INTEGER PRIMARY KEY)');
$pruef('KRITISCH: ohne Spalte heisst es "nicht eingerichtet" (null), nicht "nicht gezeichnet"',
    be_unterschrift_da($ud, 1) === null && be_unterschrift_von($ud, 1) === null);
$ud->exec('ALTER TABLE betreiber ADD COLUMN unterschrift TEXT');
$ud->exec("INSERT INTO betreiber (id, unterschrift) VALUES (1, 'data:image/png;base64,QUJD'), (2, NULL), (3, ''), (4, '   ')");
foreach ([1, 2, 3, 4] as $id) {
    $bild = be_unterschrift_von($ud, $id);
    $pruef("KRITISCH: Konto $id -- \"ob\" ohne Bild sagt dasselbe wie mit Bild",
        be_unterschrift_da($ud, $id) === ($bild !== ''));
}
$pruef('Konto 1 ist gezeichnet, Konto 2 bis 4 nicht',
    be_unterschrift_da($ud, 1) === true && be_unterschrift_da($ud, 2) === false
    && be_unterschrift_da($ud, 3) === false && be_unterschrift_da($ud, 4) === false);

echo count($bad) === 0
    ? "$ok bestanden, 0 nicht bestanden\n"
    : "$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "x $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
