<?php
// Betreiber-Ebene: Konten, Sitzungen, Mandantenstamm (ENT-518).
//
// WARUM DIESE DATEI GETRENNT VON db.php, rechte.php UND kundenportal.php STEHT
//
// Das Haus kennt bisher zwei Anmeldewege, und sie sind bewusst getrennt
// gebaut: die Verwaltung (`sessions` + `mitarbeiter`, `require_session()`)
// und das Kundenportal (`kunden_sessions` + `kundenzugang`,
// `require_kundensession()`). ENT-441 hat den Grund dafuer aufgeschrieben:
// Zwei Personenkreise, die einander nichts angehen, trennt man nicht mit
// einer Fallunterscheidung in einer Pruefstelle, sondern damit, dass es
// zwei Pruefstellen gibt.
//
// Der Betreiber ist der dritte, und der Grund ist derselbe -- nur schaerfer:
//
//   1. Ein Betreiber-Konto gehoert KEINEM Mandanten. Waere es eine Zeile in
//      `mitarbeiter`, gehoerte es der CUPI 24 -- und beim zweiten Kunden
//      waere der Betreiber seiner Software ein Mitarbeiter seines
//      Konkurrenten. Das ist kein Schoenheitsfehler, das ist ein
//      Datenschutzproblem mit Ansage.
//   2. Ein Mandanten-Admin darf Rollen vergeben (Bereich `rechte`, Stufe
//      Schreiben). Waere "Betreiber" eine Rolle im selben System, koennte
//      ein Kunde sie sich selbst zuteilen. Die hoechste Stufe der Anlage
//      darf nicht in der Rollenverwaltung liegen, die ein Mandant selbst
//      bedient.
//
// Ein Betreiber-Konto hat darum KEINE Rechte im Sinne von rechte.php. Es
// beruehrt weder `darf()` noch `rechte_aus_rollen()`. Umgekehrt findet
// `require_session()` ein Betreiber-Konto nicht, weil es nicht in
// `mitarbeiter` steht -- ein Betreiber-Token erreicht also keinen einzigen
// Verwaltungsendpunkt, und ein Mitarbeiter-Token keinen Betreiber-Endpunkt.
// Beide Male ist die Antwort 401. Genau dieselbe Bauart wie beim Portal.
//
// WAS DIESE DATEI NICHT TUT
//
// Sie oeffnet keinen Weg in die Daten eines Mandanten. Der Support-Zugriff
// ist als "nur auf Freigabe des Mandanten, befristet, protokolliert"
// vorgesehen (Konzeptstand im Projekt-Repository,
// 02-gate2-produkt-mvp/betreiber-adminbereich.md) und ist hier bewusst
// NOCH NICHT gebaut. Solange es ihn nicht gibt, kann er auch nicht
// versehentlich zu weit reichen.
declare(strict_types=1);

require_once __DIR__ . '/db.php';

// ── Verbindung zur Betreiber-Datenbank ────────────────────────────────
//
// Eigene Verbindung, eigene Platzhalter, derselbe Deploy-Mechanismus wie
// bei db(): In dieser Datei steht nie eine echte Zugangsangabe.
//
// WARUM UEBERHAUPT EINE ZWEITE VERBINDUNG, solange es nur einen Mandanten
// gibt: Weil die Trennung im Code entstehen muss, nicht in der
// Konfiguration. Zeigen die Platzhalter beim Deploy auf dieselbe Datenbank
// wie db() -- der heutige Zustand -- aendert das nichts an der Bauart:
// Betreiber-Tabellen werden ueber betreiber_db() angesprochen,
// Mandantendaten ueber db(), und keine Abfrage vermischt beides. Zieht die
// Betreiber-Ebene spaeter auf eine eigene Datenbank oder einen eigenen
// Server, ist das ein Deploy-Wert und keine Codeaenderung.
//
// Faellt der Platzhalter leer aus -- noch nicht ersetzt --, wird bewusst
// auf die Werte von db() zurueckgefallen statt eine Verbindung mit
// halbleeren Angaben zu versuchen. Ein Fehler waere hier sonst "Datenbank
// nicht erreichbar" und saehe wie ein Serverproblem aus, obwohl nur ein
// Secret fehlt.
function betreiber_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) { return $pdo; }

    $host = '__BETREIBER_DB_HOST__';
    $name = '__BETREIBER_DB_NAME__';
    $user = '__BETREIBER_DB_USER__';
    $pass = '__BETREIBER_DB_PASS__';

    // Unersetzt oder leer -> dieselbe Datenbank wie der Betrieb. Das ist
    // der heutige Normalfall und ausdruecklich kein Fehler.
    if ($name === '' || $name === '__BETREIBER' . '_DB_NAME__') {
        $pdo = db();
        return $pdo;
    }

    $dsn = "mysql:host={$host};dbname={$name};charset=utf8mb4";
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

// ── Fristen ───────────────────────────────────────────────────────────
//
// Schaerfer als jede bestehende Frist im Haus, und zwar bewusst. Die
// kuerzeste bisher gilt dem Bueroarbeitsplatz (30 Minuten Ruhe, ENT-293)
// und Verwaltungssitzungen absolut sieben Tage (ENT-075). Wer dieses Konto
// hat, hat nicht Zugriff auf einen Betrieb, sondern auf alle -- also gilt
// die Bueroruhe UND ein deutlich kuerzeres absolutes Alter.
const BE_SITZUNG_MAX_STUNDEN = 24;
const BE_SITZUNG_RUHE_MIN    = 30;

function be_sitzung_abgelaufen(int $geboren, int $gesehen, int $jetzt): bool
{
    if ($jetzt - $geboren > BE_SITZUNG_MAX_STUNDEN * 3600) { return true; }
    if ($jetzt - $gesehen > BE_SITZUNG_RUHE_MIN * 60)      { return true; }
    return false;
}

function be_tabellen_da(PDO $pdo): bool
{
    return hat_tabelle($pdo, 'betreiber') && hat_tabelle($pdo, 'betreiber_sessions');
}

// ── Die einzige Pruefstelle der Betreiber-Ebene ───────────────────────
//
// Jeder Betreiber-Endpunkt ruft diese Funktion und entscheidet nichts
// selbst -- dieselbe Regel wie darf() fuer die Verwaltung: Zwei Pruefstellen
// waeren zwei Wahrheiten.
//
// aktiv = 1 steht in der Abfrage und nicht in einer nachtraeglichen
// Pruefung: Ein gesperrtes Konto soll im selben Moment nichts mehr finden,
// in dem jemand es sperrt, ohne dass eine laufende Sitzung erst ablaufen
// muss (uebernommen vom Portal).
function require_betreiber(): array
{
    // Nur aus dem Kopfbereich (ENT-075) -- in der URL landet ein Token in
    // Server-Protokollen und im Browserverlauf.
    $token = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    if (!$token) {
        json_response(['status' => 'error', 'message' => 'kein Token'], 401);
    }
    // Verglichen wird der Abdruck, nie der Rohwert (ENT-501). In
    // betreiber_sessions.token steht ausschliesslich SHA-256.
    $abdruck = sitzung_abdruck((string)$token);
    $pdo = betreiber_db();

    if (!be_tabellen_da($pdo)) {
        // Kein stilles "nicht angemeldet": Nicht eingerichtet und
        // abgelaufen sind zwei verschiedene Aussagen und brauchen zwei
        // verschiedene Texte.
        json_response(['status' => 'error',
            'message' => 'Der Betreiber-Bereich ist noch nicht eingerichtet.'], 503);
    }

    $stmt = $pdo->prepare(
        'SELECT b.id, b.name, b.email, s.erstellt_am, s.letzte_nutzung
           FROM betreiber_sessions s
           JOIN betreiber b ON b.id = s.betreiber_id
          WHERE s.token = ? AND b.aktiv = 1'
    );
    $stmt->execute([$abdruck]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        json_response(['status' => 'error',
            'message' => 'Die Anmeldung gilt nicht mehr — bitte neu anmelden.'], 401);
    }

    $jetzt   = time();
    $geboren = strtotime((string)$row['erstellt_am'])   ?: $jetzt;
    $gesehen = strtotime((string)$row['letzte_nutzung']) ?: $geboren;
    if (be_sitzung_abgelaufen($geboren, $gesehen, $jetzt)) {
        $pdo->prepare('DELETE FROM betreiber_sessions WHERE token = ?')->execute([$abdruck]);
        json_response(['status' => 'error',
            'message' => 'Die Anmeldung ist abgelaufen — bitte neu anmelden.'], 401);
    }

    // Nutzung stempeln, aber nicht bei jedem Klick -- eine Seite laedt
    // mehrere Endpunkte auf einmal (gleiche Ueberlegung wie in db.php).
    if ($jetzt - $gesehen > 300) {
        $pdo->prepare('UPDATE betreiber_sessions SET letzte_nutzung = NOW() WHERE token = ?')
            ->execute([$abdruck]);
    }

    // Gelegentlich aufraeumen -- jede tote Sitzung ist ein Token, der
    // irgendwo noch liegt.
    if (random_int(1, 50) === 1) {
        $pdo->exec('DELETE FROM betreiber_sessions WHERE erstellt_am < DATE_SUB(NOW(), INTERVAL '
            . BE_SITZUNG_MAX_STUNDEN . ' HOUR)');
    }

    unset($row['erstellt_am'], $row['letzte_nutzung']);
    $row['id'] = (int)$row['id'];
    return $row;
}

// ── Mandantenstamm ────────────────────────────────────────────────────
//
// WARUM HIER KEIN DATENBANK-PASSWORT STEHT
//
// Die Tabelle `mandant` traegt Host, Datenbankname und Benutzer -- aber
// NICHT das Passwort. Das kommt wie jede andere Zugangsangabe aus dem
// Deploy (GitHub Secrets), nicht aus einer Tabelle. Der Grund ist derselbe
// wie bei ENT-501 fuer die eigene Adresse: Wer Lesezugriff auf die
// Betreiber-Datenbank bekaeme -- ein Backup, ein Datenbankwerkzeug, eine
// versehentlich offene Ansicht --, haette sonst in derselben Sekunde die
// Zugaenge zu JEDEM Mandanten. Der Preis ist ein Deploy-Schritt je neuem
// Mandanten; das ist bei dieser Groessenordnung kein Aufwand, der ins
// Gewicht faellt.
//
// `secret_name` haelt fest, WELCHES Secret gemeint ist -- damit steht der
// Bezug nachvollziehbar in den Daten, ohne dass der Wert selbst dort liegt.
const BE_STATUS = ['aktiv', 'gesperrt', 'gekuendigt'];

function be_mandant_status_gueltig(string $status): bool
{
    return in_array($status, BE_STATUS, true);
}

// Die GAV-Unterstellung ist bewusst dreiwertig und NICHT als Ja/Nein mit
// Vorgabewert gebaut: "noch nicht bestaetigt" ist etwas anderes als
// "nicht unterstellt", und ein Vorgabewert wuerde die Bestaetigung
// stillschweigend vorwegnehmen. Dieselbe Familie wie die Hausregel
// "unbekannt darf nie wie keine aussehen".
function be_gav_lage(?int $unterstellt, ?string $bestaetigtAm): string
{
    if ($bestaetigtAm === null || $bestaetigtAm === '') { return 'unbestaetigt'; }
    return $unterstellt === 1 ? 'unterstellt' : 'nicht_unterstellt';
}
