<?php
// Datenbank-Verbindung. Platzhalter werden beim Deploy durch GitHub Actions
// aus GitHub Secrets ersetzt -- diese Datei enthaelt nie echte Zugangsdaten.
declare(strict_types=1);

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $host = '__DB_HOST__';
        $name = '__DB_NAME__';
        $user = '__DB_USER__';
        $pass = '__DB_PASS__';
        $dsn = "mysql:host={$host};dbname={$name};charset=utf8mb4";
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    }
    return $pdo;
}

function json_response($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data);
    exit;
}

// ── Sitzungsdauer (ENT-075) ───────────────────────────────────────────
// Bis hierher lief eine Sitzung NIE ab: Ein einmal abgegriffener Token galt
// fuer immer. Jetzt gelten zwei Grenzen gleichzeitig -- ein absolutes Alter
// und eine Untaetigkeitsfrist.
//
// Die Fristen sind fuer Admins kuerzer, weil eine Admin-Sitzung die ganze
// Personalakte oeffnet: AHV-Nummer, Aufenthaltsstatus, Registerauszuege.
// Ein Mitarbeitender sieht nur seine eigenen Schichten und meldet sich auf
// dem Handy im Einsatz an -- da waere eine 12-Stunden-Frist eine Zumutung
// ohne Sicherheitsgewinn.
//
// Beide Werte stehen bewusst hier als Konstanten: Sie treffen den Alltag,
// und wenn sie sich als unpraktisch erweisen, ist es eine Zeile.
const SITZUNG_MAX_TAGE       = 30;   // ohne Rechte: absolut
const SITZUNG_RUHE_TAGE      = 14;   // ohne Rechte: ohne Nutzung
const SITZUNG_ADMIN_MAX_TAGE = 7;    // mit Rechten: absolut
const SITZUNG_FELD_RUHE_STD  = 12;   // Rechte nur im Feld: ohne Nutzung
const SITZUNG_BUERO_RUHE_MIN = 30;   // Bueroarbeitsplatz: ohne Nutzung (ENT-293)

// Welche Rechte uebt man IM FELD aus und nicht an einem Bildschirm, vor dem
// jemand anderes stehen kann? Eine Sitzung, deren Rechte vollstaendig in
// dieser Liste liegen, behaelt die lange Untaetigkeitsfrist.
//
// Bewusst als Ausnahmeliste und nicht umgekehrt: Ein kuenftig neu
// erfundenes Recht faellt damit von selbst unter die KURZE Frist. Wer eine
// Ausnahme will, muss sie hinschreiben -- so faellt das Versehen auf die
// sichere Seite.
//
// Wozu die Unterscheidung ueberhaupt: Bis ENT-293 galt "hat irgendein
// Recht" als Mass. Ein Waechter im Revierdienst hat Rechte und wuerde mit
// 30 Minuten nachts um drei mitten im Rundgang vor der Anmeldemaske
// stehen -- eine Sicherheitsregel, die den Betrieb kaputtmacht, wird
// umgangen und schuetzt danach gar nichts mehr.
const SITZUNG_RECHTE_IM_FELD = ['rundgang_verwalten', 'rundgang_einsehen', 'alarmempfaenger'];

// Gilt fuer diese Rechte die kurze Bueroschutzfrist?
// Ohne Rechte: nein (App-Nutzung, lange Frist). Nur Feldrechte: nein.
// Alles andere: ja -- diese Sitzung oeffnet fremde Personendaten.
function sitzung_buero(array $rechte): bool
{
    return array_diff($rechte, SITZUNG_RECHTE_IM_FELD) !== [];
}

// Die Ablaufregel als eigene Funktion, damit sie sich OHNE Datenbank
// pruefen laesst. Die Browser-Suiten taeuschen die Serverantwort vor und
// kaemen an dieser Stelle nie vorbei -- und eine Regel, die niemand
// ausfuehrt, ist eine Behauptung.
// Alle Zeiten als Unix-Sekunden. Gibt zurueck, ob die Sitzung tot ist.
function sitzung_abgelaufen(array $rechte, int $geboren, int $gesehen, int $jetzt): bool
{
    $hatRechte = $rechte !== [];
    $maxAlt  = ($hatRechte ? SITZUNG_ADMIN_MAX_TAGE : SITZUNG_MAX_TAGE) * 86400;
    $maxRuhe = sitzung_buero($rechte) ? SITZUNG_BUERO_RUHE_MIN * 60
             : ($hatRechte ? SITZUNG_FELD_RUHE_STD * 3600 : SITZUNG_RUHE_TAGE * 86400);
    return ($jetzt - $geboren) > $maxAlt || ($jetzt - $gesehen) > $maxRuhe;
}

function require_session(): array {
    // NUR aus dem Kopfbereich (ENT-075). In der URL landet ein Token in
    // Server-Protokollen, im Browserverlauf und in der Adresszeile, die
    // jemand ueber die Schulter mitliest oder weiterschickt.
    $token = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    if (!$token) {
        json_response(['status' => 'error', 'message' => 'kein Token'], 401);
    }
    $pdo = db();
    $hatStempel = hat_spalte($pdo, 'sessions', 'letzte_nutzung');
    $stmt = $pdo->prepare(
        'SELECT m.id, m.name, m.ist_admin, s.erstellt_am'
        . ($hatStempel ? ', s.letzte_nutzung' : '') . '
         FROM sessions s
         JOIN mitarbeiter m ON m.id = s.mitarbeiter_id
         WHERE s.token = ? AND m.aktiv = 1'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    if (!$row) {
        json_response(['status' => 'error', 'message' => 'ungueltige oder abgelaufene Sitzung'], 401);
    }

    // Rollen dazuholen (ENT-077). Ab hier ist die Rollentabelle die
    // Wahrheit: ist_admin wird daraus abgeleitet, nicht umgekehrt gelesen.
    // Ohne die Tabelle -- Einrichtung noch nicht gelaufen -- faellt
    // rechte_rollen() auf den alten Stand zurueck, damit niemand ueber
    // Nacht ausgesperrt wird.
    require_once __DIR__ . '/rechte.php';
    $row['rollen']    = rechte_rollen($pdo, (int)$row['id'], (bool)$row['ist_admin']);
    $row['ist_admin'] = in_array(ROLLE_VERWALTUNG, $row['rollen'], true);
    $row['rechte']    = rechte_aus_rollen($row['rollen']);

    // Die kurzen Sitzungsfristen aus ENT-075 galten bisher nur fuer Admins.
    // Sie gehoeren aber an den Grund, aus dem sie kurz sind: Zugang zu
    // fremden Personendaten. Eine Planerin sieht die halbe Personalakte --
    // fuer sie gilt dieselbe Frist wie fuer die Verwaltung. Wer nur die
    // eigenen Schichten sieht, behaelt die lange Frist, sonst waere die
    // App im Einsatz eine Zumutung ohne Sicherheitsgewinn.
    // Seit ENT-293 entscheiden die Rechte selbst, welche Frist gilt --
    // siehe sitzung_buero() oben.
    $jetzt   = time();
    $geboren = strtotime((string)($row['erstellt_am'] ?? '')) ?: $jetzt;
    // Ohne Stempelspalte (Einrichtung noch nicht gelaufen) zaehlt nur das
    // absolute Alter -- lieber eine Grenze als gar keine.
    $gesehen = $hatStempel
        ? (strtotime((string)($row['letzte_nutzung'] ?? '')) ?: $geboren)
        : $jetzt;

    if (sitzung_abgelaufen($row['rechte'], $geboren, $gesehen, $jetzt)) {
        // Die abgelaufene Sitzung wird gleich entfernt, nicht nur abgelehnt.
        $pdo->prepare('DELETE FROM sessions WHERE token = ?')->execute([$token]);
        json_response(['status' => 'error',
            'message' => 'Die Sitzung ist abgelaufen — bitte neu anmelden.'], 401);
    }

    // Nutzung stempeln, aber nicht bei jedem Klick schreiben: Ein Dashboard
    // laedt ein Dutzend Endpunkte auf einmal, das waere ein Dutzend
    // Schreibvorgaenge fuer dieselbe Minute.
    if ($hatStempel && $jetzt - $gesehen > 300) {
        $pdo->prepare('UPDATE sessions SET letzte_nutzung = NOW() WHERE token = ?')->execute([$token]);
    }

    // Gelegentlich aufraeumen. Ohne das waechst die Tabelle mit toten
    // Sitzungen, und jede davon ist ein Token, der irgendwo noch liegt.
    if (random_int(1, 50) === 1) {
        $pdo->exec('DELETE FROM sessions WHERE erstellt_am < DATE_SUB(NOW(), INTERVAL '
            . SITZUNG_MAX_TAGE . ' DAY)');
    }

    unset($row['erstellt_am'], $row['letzte_nutzung']);
    return $row;
}

// Bildet einen unbehandelten Fehler auf eine fuer den Browser sichere
// Meldung ab. Eigene, benannte Funktion statt eine anonyme Funktion direkt
// in set_exception_handler() -- nur so laesst sich die Zuordnung fuer sich
// pruefen (siehe pruefungen/pruef_db_fehler.php), ohne einen echten
// Datenbankfehler herbeifuehren zu muessen.
function db_fehlermeldung(Throwable $e): string {
    if (!($e instanceof PDOException)) {
        return 'Unerwarteter Serverfehler';
    }
    switch ((string)$e->getCode()) {
        // Beide Meldungen nennen den Weg, den es HEUTE gibt. Bis hierher
        // verwiesen sie auf schema_planung.sql in phpMyAdmin -- seit
        // ENT-033 traegt die Einrichtung fehlende Tabellen und Spalten
        // selbst nach, und der alte Text schickte zu einer Datei, die
        // niemand mehr von Hand ausfuehrt. Eine Fehlermeldung, die den
        // falschen Ausweg nennt, kostet mehr Zeit als gar keine.
        case '42S02':   // Tabelle fehlt
            return 'Eine benoetigte Tabelle fehlt in der Datenbank. '
                . 'Im Dashboard unten links „Einrichtung" oeffnen und '
                . '„Pruefen und einrichten" ausfuehren.';
        case '42S22':   // Spalte fehlt
            return 'Eine benoetigte Spalte fehlt in der Datenbank. '
                . 'Das passiert nach einer Neuerung, deren Einrichtung noch nicht gelaufen ist: '
                . 'im Dashboard unten links „Einrichtung" oeffnen und '
                . '„Pruefen und einrichten" ausfuehren.';
        case '23000':   // Fremdschluessel oder Eindeutigkeit verletzt
            return 'Der Datensatz verletzt eine Regel der Datenbank '
                . '(Verweis auf einen fehlenden Eintrag oder doppelter Wert).';
        default:
            // Der SQLSTATE-Code allein (z. B. "HY000", "22001") verraet
            // weder Tabellen- noch Spaltennamen -- er laesst sich aber bei
            // einem sonst nicht eingeordneten Fehler nachschlagen, statt im
            // Dunkeln zu suchen (ENT-216 -- ausgeloest durch einen echten
            // Fehlschlag beim Produktanlegen, der bis dahin nur "Datenbank-
            // fehler" ohne jede weitere Spur zeigte). Der native Treiber-
            // code dahinter (errorInfo[1], z. B. 1364 "Field doesn't have a
            // default value") grenzt es weiter ein, ohne Klartext preiszugeben.
            $treiber = $e->errorInfo[1] ?? null;
            return 'Datenbankfehler (' . $e->getCode() . ($treiber !== null ? '/' . $treiber : '') . ')';
    }
}

// Ein unbehandelter Fehler darf nie als HTML-Seite herauskommen: die
// Oberflaeche erwartet JSON und zeigt sonst nur "fehlgeschlagen" ohne Grund.
// Haeufigster Fall im Alltag ist eine noch nicht ausgefuehrte Schemadatei --
// darauf wird ausdruecklich hingewiesen, statt den Fehler zu verschlucken.
set_exception_handler(function (Throwable $e): void {
    // Bewusst ohne technische Einzelheiten: die Meldung geht an den Browser.
    json_response(['status' => 'error', 'message' => db_fehlermeldung($e)], 500);
});

// Ein schwerer Fehler laeuft NICHT durch den Handler oben: Zeitueberschreitung
// und erschoepfter Speicher beenden PHP sofort. Dann kommt beim Browser ein
// leerer oder halber Rumpf an, der sich nicht als JSON lesen laesst -- die
// Oberflaeche zeigt darauf nur ihren eigenen Ersatztext ohne Grund. Genau so
// stand am 22.08.2026 "Einrichtung fehlgeschlagen." im Dialog, ohne dass
// irgendwo zu sehen war, woran es lag.
//
// Diese Absicherung macht daraus wenigstens eine lesbare Antwort. Sie
// erfindet nichts: Was PHP als letzten Fehler gemeldet hat, wird benannt.
register_shutdown_function(function (): void {
    $letzter = error_get_last();
    $schwer = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
    if (!$letzter || !in_array($letzter['type'], $schwer, true)) { return; }
    // Wurde schon etwas gesendet, laesst sich nichts mehr geradebiegen --
    // ein zweiter Rumpf waere schlimmer als der halbe.
    if (headers_sent()) { return; }
    $art = $letzter['type'] === E_ERROR && stripos($letzter['message'], 'maximum execution time') !== false
        ? 'Der Vorgang hat zu lange gedauert und wurde abgebrochen.'
        : 'Der Vorgang ist unerwartet abgebrochen.';
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'status'  => 'error',
        'message' => $art . ' (' . basename((string)$letzter['file']) . ', Zeile ' . $letzter['line'] . ')',
    ], JSON_UNESCAPED_UNICODE);
});

// Gibt es diese Spalte? Steht hier und nicht mehr nur im Einrichtungsskript
// (gefunden beim Ausbau des Mitarbeiterstamms): pensen.php ruft die Funktion
// auf, bindet das Einrichtungsskript aber nicht ein -- und lief damit auf
// "Call to undefined function". Die Pensen-Seite war produktiv kaputt, ohne
// dass eine Pruefung es gemerkt haette, weil alle Suiten die Schnittstelle
// nachbilden statt PHP auszufuehren.
//
// "function_exists" davor, weil planung_einrichten.php die Funktion bisher
// selbst mitbrachte und in fremden Reihenfolgen eingebunden werden kann.
// Gibt es die Tabelle? Gleiche Ueberlegung wie bei hat_spalte() darunter:
// Solange die Einrichtung nicht gelaufen ist, fehlen neue Tabellen, und ein
// Endpunkt soll dann eine leere Antwort geben statt eines Fehlers.
//
// Das Ergebnis wird gemerkt, weil seit dem Rollenmodell jede Anfrage danach
// fragt. Das Einrichtungsskript legt Tabellen waehrend seines eigenen Laufs
// an und fragt danach erneut -- es muss das Gedaechtnis darum umgehen
// koennen, sonst hielte es eine gerade angelegte Tabelle fuer fehlend.
if (!function_exists('hat_tabelle')) {
    function hat_tabelle(PDO $pdo, string $tabelle, bool $ohneGedaechtnis = false): bool {
        static $bekannt = [];
        if ($ohneGedaechtnis || !array_key_exists($tabelle, $bekannt)) {
            $s = $pdo->prepare(
                'SELECT 1 FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
            );
            $s->execute([$tabelle]);
            $bekannt[$tabelle] = (bool)$s->fetchColumn();
        }
        return $bekannt[$tabelle];
    }
}

if (!function_exists('hat_spalte')) {
    // Das Ergebnis wird gemerkt: Seit ENT-075 fragt jede einzelne Anfrage
    // beim Pruefen der Sitzung danach, und information_schema ist keine
    // Abfrage, die man ein Dutzend Mal pro Seitenaufruf stellen will.
    function hat_spalte(PDO $pdo, string $tabelle, string $spalte): bool {
        static $bekannt = [];
        $schluessel = $tabelle . '.' . $spalte;
        if (!array_key_exists($schluessel, $bekannt)) {
            $s = $pdo->prepare(
                'SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
            );
            $s->execute([$tabelle, $spalte]);
            $bekannt[$schluessel] = (bool)$s->fetchColumn();
        }
        return $bekannt[$schluessel];
    }
}
