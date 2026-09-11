<?php
// Betreiber-Ebene: Konten, Sitzungen, Mandantenstamm (ENT-524).
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

// ── Aussperrschutz ────────────────────────────────────────────────────
//
// Dieselbe Falle wie OP-505 in der Verwaltung: Dort liess sich der letzte
// Verwalter deaktivieren, und danach konnte niemand mehr Rollen vergeben --
// der Weg zurueck war phpMyAdmin. Auf der Betreiber-Ebene waere es
// schlimmer, weil es hier keine zweite Ebene darueber gibt, die einen
// wieder hereinliesse.
//
// Gezaehlt werden AKTIVE Konten ausser dem genannten. Wer wissen will, ob
// er sich selbst deaktivieren darf, fragt mit der eigenen Id -- kommt 0
// zurueck, ist er der letzte.
function be_konten_zahl(PDO $pdo, int $ausser = 0): int
{
    if (!be_tabellen_da($pdo)) { return 0; }
    $s = $pdo->prepare('SELECT COUNT(*) FROM betreiber WHERE aktiv = 1 AND id <> ?');
    $s->execute([$ausser]);
    return (int)$s->fetchColumn();
}

// ── Mandant: was von aussen geschrieben werden darf ───────────────────
//
// Eine geschlossene Liste statt "alles, was ankommt". Ohne sie traegt der
// naechste, der ein Feld ergaenzt, es versehentlich in den Schreibweg --
// und dazu gehoeren hier Felder, die NIEMAND ueber die Oberflaeche setzen
// soll (angelegt_am) oder die eine eigene Bestaetigung brauchen
// (gav_bestaetigt_am/-von, siehe be_gav_bestaetigen()).
const BE_MANDANT_FELDER = ['name', 'kanton', 'db_host', 'db_name', 'db_user', 'secret_name'];

// Der Kanton steuert den Feiertagskalender. Zwei Buchstaben, gross --
// mehr wird hier nicht geprueft: Eine Liste der 26 Kantone waere eine
// zweite Wahrheit neben dem Feiertagskalender, und ein Tippfehler faellt
// dort auf, wo er wirkt.
function be_kanton_normal(string $roh): ?string
{
    $k = strtoupper(trim($roh));
    if ($k === '') { return null; }
    return preg_match('/^[A-Z]{2}$/', $k) === 1 ? $k : null;
}

// Die GAV-Unterstellung wird BESTAETIGT, nicht gesetzt.
//
// Warum das ein eigener Weg ist und nicht ein Feld unter anderen: Die
// Antwort auf diese Frage entscheidet, gegen welches Regelwerk der Betrieb
// spaeter rechnet. Sie gehoert festgehalten mit dem Zeitpunkt und der
// Person, die sie gegeben hat -- so wie das Auslegungsregister jede
// Annahme mit Herkunft fuehrt. Ein stilles Umschalten in einer
// Sammel-Speicherung waere hier der Fehler.
//
// KEINE eigenstaendige Auslegung: Das System stellt die Frage und haelt die
// Antwort fest. Es leitet die Unterstellung NICHT selbst her -- weder aus
// dem Kanton noch aus der Betriebsgroesse noch aus der Branche. Wo der
// Wortlaut des GAV nicht eindeutig ist, gehoert ein Eintrag ins
// Auslegungsregister, nicht eine Annahme in dieses Feld.
function be_gav_bestaetigen(PDO $pdo, int $mandantId, bool $unterstellt, string $wer): bool
{
    $s = $pdo->prepare(
        'UPDATE mandant
            SET gav_unterstellt = ?, gav_bestaetigt_am = NOW(), gav_bestaetigt_von = ?,
                geaendert_am = NOW()
          WHERE id = ?'
    );
    $s->execute([$unterstellt ? 1 : 0, mb_substr($wer, 0, 200), $mandantId]);
    return $s->rowCount() > 0;
}

// Ein Mandant, dessen Verbindungsangaben unvollstaendig sind, ist nicht
// erreichbar -- und das ist etwas anderes als "gesperrt" oder "leer".
// Die Oberflaeche muss die drei Faelle auseinanderhalten koennen
// (Hausregel: unbekannt darf nie wie keine aussehen), darum sagt der
// Server es, statt es die Oberflaeche raten zu lassen.
//
// Alle drei Felder leer = Bestandsmandant auf der Standardverbindung, das
// ist vollstaendig. Teilweise gefuellt = jemand hat angefangen und nicht
// zu Ende gebracht.
function be_verbindung_lage(array $m): string
{
    $teile = [trim((string)($m['db_host'] ?? '')),
              trim((string)($m['db_name'] ?? '')),
              trim((string)($m['db_user'] ?? ''))];
    $gefuellt = array_filter($teile, static fn($t) => $t !== '');
    if (count($gefuellt) === 0) { return 'standardverbindung'; }
    if (count($gefuellt) === 3) { return 'eigene_datenbank'; }
    return 'unvollstaendig';
}

// ── Zwei-Faktor für Betreiber-Konten (OP-517) ─────────────────────────
//
// WARUM HIER UND NICHT IN zweifaktor.php: Das Verfahren ist dasselbe --
// TOTP nach RFC 6238, und die reinen Funktionen dort (zf_code, zf_pruefen,
// zf_geheimnis_erzeugen, zf_notfallcode) werden hier unveraendert benutzt
// statt nachgebaut. Getrennt ist nur die SPEICHERUNG: `zwei_faktor` haengt
// an `mitarbeiter`, und ein Betreiber-Konto ist keine Zeile darin. Die
// Trennung der Ebenen waere sonst genau an der Stelle durchbrochen, an der
// sie am meisten zaehlt.
//
// WARUM ZWINGEND, anders als in der Verwaltung (dort Entscheid des
// Projektinhabers, freiwillig): Am Verwaltungszugang haengt die
// Personalakte EINES Betriebs. An diesem Konto haengt jeder Betrieb --
// und es gibt keine Ebene darueber, die einen Missbrauch bemerken oder
// rueckgaengig machen koennte.
require_once __DIR__ . '/zweifaktor.php';

function be_zf_tabelle_da(PDO $pdo): bool
{
    return hat_tabelle($pdo, 'betreiber_zwei_faktor');
}

// Bestaetigt heisst: Das Geheimnis ist eingerichtet UND einmal mit einem
// gueltigen Code gegengeprueft worden. Ein eingerichtetes, nie bestaetigtes
// Geheimnis zaehlt NICHT -- sonst sperrte sich aus, wer den QR-Code
// abgebrochen hat, bevor seine App ihn gelesen hatte.
function be_zf_ist_an(PDO $pdo, int $betreiberId): bool
{
    if (!be_zf_tabelle_da($pdo)) { return false; }
    $s = $pdo->prepare('SELECT bestaetigt_am FROM betreiber_zwei_faktor WHERE betreiber_id = ?');
    $s->execute([$betreiberId]);
    $r = $s->fetch(PDO::FETCH_ASSOC);
    return $r !== false && $r['bestaetigt_am'] !== null;
}

function be_zf_geheim(PDO $pdo, int $betreiberId): ?string
{
    if (!be_zf_tabelle_da($pdo)) { return null; }
    $s = $pdo->prepare('SELECT geheim FROM betreiber_zwei_faktor WHERE betreiber_id = ?');
    $s->execute([$betreiberId]);
    $g = $s->fetchColumn();
    return $g === false ? null : (string)$g;
}

// ── Die zweite Wache: angemeldet UND zweiter Faktor bestaetigt ─────────
//
// Zwei Wachen statt einer Fallunterscheidung, aus demselben Grund wie die
// Trennung der Anmeldewege selbst: require_betreiber() sagt "wer bist du",
// require_betreiber_voll() sagt zusaetzlich "und bist du vollstaendig
// abgesichert". Nur die Endpunkte, die den zweiten Faktor EINRICHTEN,
// duerfen mit der ersten auskommen -- alles andere verlangt die zweite.
//
// Damit ist die Pflicht im Server durchgesetzt und nicht in der
// Oberflaeche: Eine Sperre, die man am Browser vorbei umgehen kann, ist
// keine (CLAUDE.md).
const BE_ZF_EINRICHTUNG = 'zwei_faktor_einrichten';

function require_betreiber_voll(): array
{
    $ich = require_betreiber();
    $pdo = betreiber_db();

    if (be_zf_ist_an($pdo, (int)$ich['id'])) {
        // Der Faktor ist eingerichtet -- geprueft wurde er bei der
        // Anmeldung. Die Sitzung entsteht erst danach.
        $ich['zwei_faktor'] = true;
        return $ich;
    }

    // Kein bestaetigter zweiter Faktor: Die Sitzung reicht nur bis zur
    // Einrichtung. Eigener Statuscode und eigener Hinweis -- "noch nicht
    // eingerichtet" ist etwas anderes als "keine Berechtigung", und die
    // Oberflaeche muss die beiden auseinanderhalten koennen.
    json_response([
        'status'  => 'error',
        'grund'   => BE_ZF_EINRICHTUNG,
        'message' => 'Für dieses Konto ist die Zwei-Faktor-Anmeldung noch nicht eingerichtet. '
                   . 'Sie ist im Betreiber-Bereich zwingend — bitte zuerst einrichten.',
    ], 403);
}

// Einen Code einloesen: erst der Zeitcode, dann die Notfallcodes -- der
// Normalfall zuerst.
//
// Der Wiederverwendungsschutz (letztes_fenster) ist der wichtige Teil und
// aus zf_code_einloesen() uebernommen: Ohne ihn bliebe ein einmal
// mitgelesener Code die vollen dreissig Sekunden plus Toleranz gueltig, und
// genau das ist das Fenster, in dem ein abgefangener Code benutzt wird.
function be_zf_code_einloesen(PDO $pdo, int $betreiberId, string $eingabe, int $jetzt): bool
{
    if (!be_zf_tabelle_da($pdo)) { return false; }
    $s = $pdo->prepare('SELECT geheim, letztes_fenster, notfallcodes
                          FROM betreiber_zwei_faktor WHERE betreiber_id = ?');
    $s->execute([$betreiberId]);
    $st = $s->fetch(PDO::FETCH_ASSOC);
    if (!$st) { return false; }

    $fenster = zf_pruefen((string)$st['geheim'], $eingabe, $jetzt);
    if ($fenster !== null) {
        if ($st['letztes_fenster'] !== null && (int)$st['letztes_fenster'] >= $fenster) {
            return false;                 // dieser Code war schon dran
        }
        $pdo->prepare('UPDATE betreiber_zwei_faktor SET letztes_fenster = ? WHERE betreiber_id = ?')
            ->execute([$fenster, $betreiberId]);
        return true;
    }

    return be_zf_notfallcode_einloesen($pdo, $betreiberId, $eingabe);
}

// Notfallcodes liegen als Hashes. Ein eingeloester Code wird aus der Liste
// entfernt und nicht als "benutzt" markiert -- er ist danach wertlos, und
// was wertlos ist, muss nicht aufbewahrt werden.
function be_zf_notfallcode_einloesen(PDO $pdo, int $betreiberId, string $eingabe): bool
{
    $code = zf_code_normalisieren($eingabe);
    if (preg_match('/^[a-z2-9]{4}-[a-z2-9]{4}$/', $code) !== 1) { return false; }

    $s = $pdo->prepare('SELECT notfallcodes FROM betreiber_zwei_faktor WHERE betreiber_id = ?');
    $s->execute([$betreiberId]);
    $roh = $s->fetchColumn();
    if ($roh === false || $roh === null || $roh === '') { return false; }

    $hashes = json_decode((string)$roh, true);
    if (!is_array($hashes)) { return false; }

    foreach ($hashes as $i => $hash) {
        if (password_verify($code, (string)$hash)) {
            unset($hashes[$i]);
            $pdo->prepare('UPDATE betreiber_zwei_faktor SET notfallcodes = ? WHERE betreiber_id = ?')
                ->execute([json_encode(array_values($hashes)), $betreiberId]);
            return true;
        }
    }
    return false;
}

function be_zf_notfallcodes_offen(PDO $pdo, int $betreiberId): int
{
    if (!be_zf_tabelle_da($pdo)) { return 0; }
    $s = $pdo->prepare('SELECT notfallcodes FROM betreiber_zwei_faktor WHERE betreiber_id = ?');
    $s->execute([$betreiberId]);
    $roh = $s->fetchColumn();
    if ($roh === false || $roh === null || $roh === '') { return 0; }
    $h = json_decode((string)$roh, true);
    return is_array($h) ? count($h) : 0;
}

// ── Der Bootstrap und seine Grenze ────────────────────────────────────
//
// Das erste Betreiber-Konto muss von irgendwoher kommen -- es kann sich
// nicht selbst anlegen. Der Einstieg läuft darum über die Verwaltung eines
// Betriebs (require_verwaltung), und genau dort liegt eine Falle, die beim
// Aufschreiben der Einrichtungsreihenfolge aufgefallen ist:
//
// Bei getrennten Datenbanken je Mandant hat JEDER Betrieb eine eigene
// Verwaltung, aber alle teilen sich dieselbe Betreiber-Datenbank. Ohne
// zusätzliche Grenze könnte die Verwaltung eines zweiten, fremden Betriebs
// sich ein Betreiber-Konto anlegen, solange noch keines existiert -- und
// hätte damit Zugriff auf jeden Mandanten.
//
// Die Grenze: Der Bootstrap läuft nur, solange der Mandantenstamm HÖCHSTENS
// EINEN Eintrag hat. Das ist logisch dicht, ohne eine zusätzliche Regel zu
// erfinden: Damit ein zweiter Mandant überhaupt eingetragen werden kann,
// muss vorher jemand am Betreiber-Bereich angemeldet gewesen sein -- also
// existiert dann zwangsläufig schon ein Konto, und der Bootstrap wird nicht
// mehr gebraucht.
// Die Entscheidungsregel steht als EIGENE, reine Funktion daneben --
// dasselbe Muster wie umgebung_ist_produktion() in db.php und aus demselben
// Grund: So laesst sie sich mit frei gewaehlten Werten pruefen, auch mit
// dem Fall "mehrere Mandanten", den eine Pruefumgebung ohne Datenbank gar
// nicht herstellen kann. Eine Regel, die nur im Zusammenspiel mit einer
// Datenbank prueffbar ist, wird in der Praxis nicht geprueft.
function be_bootstrap_grenze(int $mandanten): bool
{
    return $mandanten <= 1;
}

function be_bootstrap_offen(PDO $pdo): bool
{
    if (!hat_tabelle($pdo, 'mandant')) { return true; }
    return be_bootstrap_grenze((int)$pdo->query('SELECT COUNT(*) FROM mandant')->fetchColumn());
}

// ── Verbindung zu einem Mandanten ─────────────────────────────────────
//
// WOHER DAS PASSWORT KOMMT, und warum nicht aus der Tabelle:
//
// Der Mandantenstamm trägt Host, Datenbankname, Benutzer und den NAMEN des
// Secrets -- nie den Wert (ENT-519). Der Wert kommt wie jede andere
// Zugangsangabe aus dem Deploy.
//
// Ein eigener Platzhalter je Mandant (__DB_PASS_MANDANT_2__ und so fort)
// skaliert nicht: Der Deploy müsste für jeden neuen Kunden geändert werden.
// Stattdessen EIN Platzhalter, der ein JSON-Objekt trägt --
// {"DB_PASS_MANDANT_2":"...", ...}. Ein neuer Mandant heisst dann: einen
// Eintrag im Secret ergänzen, kein Codeeingriff.
//
// Der Unterschied zur Tabelle bleibt bestehen und ist der Punkt: Diese
// Angaben liegen auf dem SERVER, nicht in der Datenbank. Ein
// Datenbank-Backup, ein Datenbankwerkzeug oder eine versehentlich offene
// Ansicht enthält sie nicht.
function mandant_secret(string $name): ?string
{
    static $tafel = null;
    if ($tafel === null) {
        $roh = '__MANDANT_SECRETS__';
        // Unersetzt oder leer: Es gibt noch keine fremden Mandanten. Das
        // ist der heutige Normalfall und kein Fehler.
        if ($roh === '' || $roh === '__MANDANT' . '_SECRETS__') {
            $tafel = [];
        } else {
            $d = json_decode($roh, true);
            $tafel = is_array($d) ? $d : [];
        }
    }
    if ($name === '' || !array_key_exists($name, $tafel)) { return null; }
    return (string)$tafel[$name];
}

// Die Lage einer Mandantenverbindung, bevor sie versucht wird.
//
// Vier Antworten statt "geht/geht nicht", weil sie zu vier verschiedenen
// Handlungen führen -- und weil "nicht eingerichtet" nie wie "kaputt"
// aussehen darf (Hausregel):
//
//   standardverbindung -- der Bestandsmandant, nichts zu tun
//   unvollstaendig     -- jemand hat angefangen und nicht zu Ende gebracht
//   secret_fehlt       -- die Angaben stehen, aber das Deploy-Secret nicht
//   bereit             -- kann verbunden werden
function mandant_verbindung_bereit(array $m): string
{
    $lage = be_verbindung_lage($m);
    if ($lage !== 'eigene_datenbank') { return $lage; }
    if (mandant_secret((string)($m['secret_name'] ?? '')) === null) { return 'secret_fehlt'; }
    return 'bereit';
}

// Verbindung zur Datenbank EINES Mandanten.
//
// AUSDRÜCKLICH KEIN SUPPORT-ZUGRIFF. Diese Funktion stellt eine Verbindung
// her; sie öffnet keinen Weg in die Betriebsdaten. Der Support-Zugriff ist
// als "nur auf Freigabe des Mandanten, befristet, protokolliert"
// vorgesehen und bewusst noch nicht gebaut. Wer diese Funktion für
// Betriebsdaten benutzt, umgeht eine Entscheidung, die noch aussteht --
// die Prüfung in test_betreiber.mjs wacht darüber, welche Endpunkte sie
// überhaupt aufrufen dürfen.
//
// Wirft statt json_response(), damit der Aufrufer entscheidet, wie ein
// nicht erreichbarer Mandant gemeldet wird. Ein Verbindungsfehler ist hier
// ein erwartbarer Zustand, kein Absturz.
function mandant_db(array $m): PDO
{
    $lage = mandant_verbindung_bereit($m);
    if ($lage === 'standardverbindung') { return db(); }
    if ($lage !== 'bereit') {
        throw new RuntimeException('Verbindung nicht möglich: ' . $lage);
    }
    $dsn = 'mysql:host=' . (string)$m['db_host']
         . ';dbname=' . (string)$m['db_name'] . ';charset=utf8mb4';
    return new PDO($dsn, (string)$m['db_user'], (string)mandant_secret((string)$m['secret_name']), [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT            => 5,
    ]);
}

// Ist die Anlage eines Mandanten eingerichtet? Zählt Tabellen, liest KEINE
// Daten -- das ist die Grenze zwischen "erreichbar und eingerichtet" und
// dem Support-Zugriff, den es noch nicht gibt.
//
// Schema-Drift ist das Hauptrisiko der getrennten Datenhaltung (ENT-519):
// Läuft ein Update bei neunzehn Mandanten durch und beim zwanzigsten
// nicht, arbeitet dieser mit neuem Code auf altem Schema. Der
// Einrichtungsknopf meldet sich heute im Cockpit DES MANDANTEN; der
// Betreiber braucht dieselbe Meldung über alle hinweg.
const MANDANT_KERNTABELLEN = ['mitarbeiter', 'kunden', 'objekte', 'einsaetze', 'rapporte'];

function mandant_stand(array $m): array
{
    $lage = mandant_verbindung_bereit($m);
    if ($lage !== 'bereit' && $lage !== 'standardverbindung') {
        return ['erreichbar' => false, 'lage' => $lage, 'tabellen' => null, 'fehlend' => null];
    }
    try {
        $pdo = mandant_db($m);
        $fehlend = [];
        foreach (MANDANT_KERNTABELLEN as $t) {
            if (!hat_tabelle($pdo, $t)) { $fehlend[] = $t; }
        }
        return [
            'erreichbar' => true,
            'lage'       => $lage,
            'tabellen'   => count(MANDANT_KERNTABELLEN) - count($fehlend),
            'fehlend'    => $fehlend,
        ];
    } catch (Throwable $e) {
        // Der Fehlertext des Treibers kann Host und Benutzer enthalten und
        // geht darum nicht nach aussen -- gemeldet wird die Lage.
        return ['erreichbar' => false, 'lage' => 'nicht_erreichbar',
                'tabellen' => null, 'fehlend' => null];
    }
}
