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
// Rechenkern der Demo-Zugaenge (ENT-600) -- liefert die Tabellendefinition
// fuer be_tabellen() und die Ablauflogik fuer die Endpunkte.
require_once __DIR__ . '/demo_zugang.php';
require_once __DIR__ . '/logbuch.php';

// ── Logbuch der Betreiber-Ebene (ENT-614) ────────────────────────────
//
// Zwei Zeilen Umweg, und sie haben einen Grund: Das Praefix 'be_' steht so
// an EINER Stelle. Vergisst ein Endpunkt es, schreibt er nicht etwa nichts,
// sondern in die Tabelle der MANDANTIN -- der Fehler waere unsichtbar, bis
// jemand dort einen Eintrag findet, der ihn nichts angeht. Genau diese Sorte
// Regel ist hier schon mehrfach an etwas Neuem gescheitert, das sie nicht
// geerbt hat (CLAUDE.md).
//
// $ich ist das Ergebnis von require_betreiber_voll() -- id und name des
// Kontos, das handelt.
function be_log(PDO $pdo, array $ich, string $bereich, int $objektId,
                string $feld, ?string $alt, ?string $neu, bool $ohneWerte = false): bool
{
    return logbuch_schreiben($pdo, $ich, $bereich, $objektId, $feld, $alt, $neu, $ohneWerte, 'be_');
}

// Schreibt je Unterschied zwischen zwei Datensaetzen eine Zeile.
function be_log_vergleich(PDO $pdo, array $ich, string $bereich, int $objektId,
                          array $vorher, array $nachher, array $ohneWerte = []): int
{
    return logbuch_vergleichen($pdo, $ich, $bereich, $objektId, $vorher, $nachher, $ohneWerte, 'be_');
}

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
const BE_MANDANT_FELDER = ['name', 'subdomain', 'kanton', 'db_host', 'db_name', 'db_user', 'secret_name'];

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
// ── Vertragslage eines Mandanten (ENT-617) ──────────────────────────
//
// GERECHNET, NIE GESPEICHERT. Der naechste moegliche Kuendigungstermin ist
// eine Folge aus Beginn, Mindestlaufzeit, Verlaengerung und Frist. Ein
// gespeicherter Wert stuende ab dem Tag falsch da, an dem der Termin
// verstreicht -- und niemand wuesste, wann er zuletzt gerechnet wurde.
//
// MONATSARITHMETIK MIT KLEMMUNG: Der 31. Januar plus einen Monat ist der
// 28. Februar, nicht der 3. Maerz. PHPs eigenes "+1 month" laeuft ueber, und
// bei einer Kuendigungsfrist waeren das zwei bis drei Tage in die falsche
// Richtung -- genau die, auf die es ankommt.
function be_monate_dazu(string $datum, int $monate): string
{
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', substr($datum, 0, 10));
    if (!$d) { return $datum; }
    $tag = (int)$d->format('j');
    $erster = $d->modify('first day of this month')->modify('+' . $monate . ' months');
    $letzterImZiel = (int)$erster->format('t');
    return $erster->setDate((int)$erster->format('Y'), (int)$erster->format('n'),
                            min($tag, $letzterImZiel))->format('Y-m-d');
}

// FUENF LAGEN, FUENF AUSSAGEN -- und keine davon darf wie eine andere
// aussehen (Hausregel):
//
//   unbekannt   Es ist nichts eingetragen. NICHT "unbefristet" und nicht
//               "sofort kuendbar" -- wir wissen es schlicht nicht.
//   gekuendigt  Ein Enddatum steht fest. Ob es in der Zukunft oder in der
//               Vergangenheit liegt, sagt `beendet`.
//   laeuft      Es gibt einen naechsten Termin: `ende` ist der Tag, auf den
//               gekuendigt wuerde, `spaetestens` der Tag, an dem die
//               Kuendigung dafuer da sein muss.
//   ohne_ende   Beginn und Frist stehen, aber keine Mindestlaufzeit -- ein
//               unbefristeter Vertrag. Kuendbar ist er jederzeit, wirksam
//               nach Ablauf der Frist.
//   laeuft_aus  Keine Verlaengerung vereinbart, und die Frist fuer das
//               einzige Ende ist verstrichen. Der Vertrag laeuft noch, aber
//               er endet an `ende`, und daran ist nichts mehr zu tun.
//               NICHT "ausgelaufen" -- solange `ende` in der Zukunft liegt,
//               ist er in Kraft, und `beendet` sagt, ob das noch gilt.
function be_vertrag_lage(array $m, ?string $heute = null): array
{
    $heute  = $heute ?: date('Y-m-d');
    $beginn = substr((string)($m['vertrag_beginn'] ?? ''), 0, 10);
    $leer   = ['', '0000-00-00'];

    $gek = substr((string)($m['gekuendigt_per'] ?? ''), 0, 10);
    if (!in_array($gek, $leer, true)) {
        return ['lage' => 'gekuendigt', 'ende' => $gek, 'spaetestens' => null,
                'beendet' => $gek < $heute];
    }
    if (in_array($beginn, $leer, true)) {
        return ['lage' => 'unbekannt', 'ende' => null, 'spaetestens' => null, 'beendet' => false];
    }

    // Eine fehlende Frist ist nicht dasselbe wie eine Frist von null. Sie
    // wird als 0 GERECHNET, aber die Lage sagt es weiter unten nicht als
    // Tatsache -- die Oberflaeche zeigt das fehlende Feld an.
    $frist  = max(0, (int)($m['kuendigungsfrist_monate'] ?? 0));
    $mindest = (int)($m['mindestlaufzeit_monate'] ?? 0);
    $verlaengerung = (int)($m['verlaengerung_monate'] ?? 0);

    if ($mindest <= 0) {
        return ['lage' => 'ohne_ende', 'ende' => null,
                'spaetestens' => null, 'beendet' => false];
    }

    // Das erste Ende, danach Schritt um Schritt die Verlaengerungen. Die
    // Obergrenze ist kein Schoenheitsfehler, sondern die Zusicherung, dass
    // diese Schleife endet -- auch bei einer Verlaengerung von 0, die sonst
    // ewig auf der Stelle traete.
    $ende = be_monate_dazu($beginn, $mindest);
    $schritte = 0;
    while (be_monate_dazu($ende, -$frist) < $heute) {
        if ($verlaengerung <= 0 || ++$schritte > 600) {
            return ['lage' => 'laeuft_aus', 'ende' => $ende,
                    'spaetestens' => be_monate_dazu($ende, -$frist), 'beendet' => $ende < $heute];
        }
        $ende = be_monate_dazu($ende, $verlaengerung);
    }

    return ['lage' => 'laeuft', 'ende' => $ende,
            'spaetestens' => be_monate_dazu($ende, -$frist), 'beendet' => false];
}

// Steht dieser Vertrag in den naechsten $tage Tagen an? Gemeint ist der Tag,
// an dem die Kuendigung spaetestens da sein muss -- nicht das Vertragsende.
// Wer auf das Ende schaut, merkt die Frist, wenn sie vorbei ist.
function be_vertrag_faellig(array $lage, int $tage, ?string $heute = null): bool
{
    $heute = $heute ?: date('Y-m-d');
    $stichtag = $lage['lage'] === 'gekuendigt' ? ($lage['ende'] ?? null) : ($lage['spaetestens'] ?? null);
    if (!$stichtag) { return false; }
    $grenze = date('Y-m-d', strtotime($heute . ' +' . $tage . ' days'));
    return $stichtag >= $heute && $stichtag <= $grenze;
}

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
// Ein eigener Platzhalter je Mandant ("__DB_PASS_MANDANT" + "_2__" und so
// fort) skaliert nicht: Der Deploy müsste für jeden neuen Kunden geändert
// werden.
// Stattdessen EIN Platzhalter, der ein JSON-Objekt trägt --
// {"DB_PASS_MANDANT_2":"...", ...}. Ein neuer Mandant heisst dann: einen
// Eintrag im Secret ergänzen, kein Codeeingriff.
//
// Der Unterschied zur Tabelle bleibt bestehen und ist der Punkt: Diese
// Angaben liegen auf dem SERVER, nicht in der Datenbank. Ein
// Datenbank-Backup, ein Datenbankwerkzeug oder eine versehentlich offene
// Ansicht enthält sie nicht.
// Reine, testbare Zerlegung -- mandant_secret() darunter reicht nur den
// hartcodierten Platzhalter hinein. Dieselbe Aufteilung wie
// basis_url()/basis_url_pruefen() (db.php) und
// demo_empfaenger()/demo_empfaenger_pruefen() (demo_anfrage.php): Was hier
// steht, laesst sich mit frei gewaehlten Werten ausfuehren, ohne den
// Deploy-Platzhalter selbst ersetzen zu muessen.
//
// BASE64, NICHT ROHES JSON (OP-526): Der Deploy ersetzt Platzhalter per
// sed, und sed behandelt "&" in der Ersetzung als Rueckverweis auf den
// gefundenen Text und den gewaehlten Trenner "|" als Befehlsende -- ein
// Passwort, das eines von beiden enthaelt, zerschoesse entweder den
// sed-Aufruf oder den Wert selbst, unbemerkt. Base64 kennt beide Zeichen
// nicht (Alphabet A-Z a-z 0-9 + / =), genau aus diesem Grund traegt
// VAPID_PRIVATE_PEM_B64 (push.php) schon base64 statt der rohen PEM-Datei.
// Das GitHub-Secret MANDANT_SECRETS traegt darum base64(JSON), nicht JSON
// selbst -- siehe deploy-hostpoint.yml.
function mandant_secrets_tafel_pruefen(string $roh): array
{
    // Unersetzt oder leer: Es gibt noch keine fremden Mandanten. Das
    // ist der heutige Normalfall und kein Fehler.
    if ($roh === '' || $roh === '__MANDANT' . '_SECRETS__') { return []; }
    $json = base64_decode($roh, true);
    if ($json === false) { return []; }
    $d = json_decode($json, true);
    return is_array($d) ? $d : [];
}

function mandant_secret(string $name): ?string
{
    static $tafel = null;
    if ($tafel === null) {
        $tafel = mandant_secrets_tafel_pruefen('__MANDANT_SECRETS__');
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


// ── Wie gross ist ein Mandant? (ENT-539) ──────────────────────────────
//
// WARUM MEHRERE ZAHLEN UND NICHT EINE: Der Projektinhaber erwägt eine
// Staffelung nach Betriebsgrösse ("bis 10 dieser Preis, ab 11 dieser").
// Was dabei als "ein Mitarbeiter" zählt, ist NICHT entschieden -- und für
// einen Sicherheitsbetrieb ist der Unterschied echtes Geld: Wer viele
// Aushilfen auf der Liste führt, hat mehr Konten als arbeitende Leute.
//
// Darum werden die ROHZAHLEN festgehalten, nicht das Ergebnis einer
// Definition. Aus ihnen lässt sich jede spätere Auslegung rechnen; aus
// einer einzigen Zahl liesse sich keine andere mehr herleiten. Dasselbe
// Prinzip wie bei der GAV-Zeit (CLAUDE.md): nie nur den fertigen Wert.
//
// LESEN, NICHT SCHREIBEN: Diese Funktion zählt und rührt die Daten des
// Mandanten nicht an. Sie zählt auch keine Namen -- nur Zeilen.
function mandant_groesse(array $m): ?array
{
    try {
        $pdo = mandant_db($m);
        if (!hat_tabelle($pdo, 'mitarbeiter')) { return null; }

        $gesamt = (int)$pdo->query('SELECT COUNT(*) FROM mitarbeiter')->fetchColumn();
        $aktiv  = (int)$pdo->query('SELECT COUNT(*) FROM mitarbeiter WHERE aktiv = 1')->fetchColumn();

        // Wer im laufenden Monat tatsächlich eingeteilt war. Die dritte
        // Zahl, weil "auf der Liste" und "im Einsatz" bei Aushilfen weit
        // auseinanderliegen. Fehlt die Tabelle, bleibt sie NULL -- unbekannt
        // ist etwas anderes als null (Hausregel).
        $imEinsatz = null;
        if (hat_tabelle($pdo, 'einsatz_zuteilung') && hat_tabelle($pdo, 'einsaetze')) {
            $s = $pdo->prepare(
                'SELECT COUNT(DISTINCT z.mitarbeiter_id)
                   FROM einsatz_zuteilung z
                   JOIN einsaetze e ON e.id = z.einsatz_id
                  WHERE e.datum >= ? AND e.datum <= ?'
            );
            $s->execute([date('Y-m-01'), date('Y-m-t')]);
            $imEinsatz = (int)$s->fetchColumn();
        }
        // ── Wird die Anlage ueberhaupt benutzt (ENT-619) ──────────────
        //
        // ZWEI SIGNALE, weil sie auseinanderliegen koennen und genau das die
        // Aussage ist: Wer sich noch anmeldet, aber nichts mehr erfasst, ist
        // auf dem Absprung.
        //
        // ZUSAMMENGEFASST UEBER ALLE PERSONEN, nie je Person. Die Grenze
        // dieser Ebene ist seit ENT-519 dieselbe: Die Betreiberin sieht
        // ZAHLEN ueber einen Mandanten, nie dessen Inhalte und nie, wer dort
        // wann gearbeitet hat. Ein MAX() ueber die ganze Belegschaft sagt
        // "die Anlage lebt", ohne jemanden einzeln zu beobachten.
        //
        // Fehlt eine Spalte oder eine Tabelle, bleibt der Wert NULL --
        // "nicht feststellbar" ist etwas anderes als "seit nie benutzt"
        // (Hausregel), und die Oberflaeche haelt die beiden auseinander.
        $letzterZugriff = null;
        if (hat_spalte($pdo, 'mitarbeiter', 'letzter_zugriff')) {
            $letzterZugriff = $pdo->query('SELECT MAX(letzter_zugriff) FROM mitarbeiter')->fetchColumn();
            $letzterZugriff = $letzterZugriff ?: null;
        }
        $letzterRapport = null;
        if (hat_tabelle($pdo, 'rapporte')) {
            $letzterRapport = $pdo->query('SELECT MAX(erfasst_am) FROM rapporte')->fetchColumn();
            $letzterRapport = $letzterRapport ?: null;
        }

        return ['gesamt' => $gesamt, 'aktiv' => $aktiv, 'im_einsatz' => $imEinsatz,
                'letzter_zugriff' => $letzterZugriff, 'letzter_rapport' => $letzterRapport];
    } catch (Throwable $e) {
        // Wie bei mandant_stand(): Der Treibertext kann Host und Benutzer
        // tragen und geht nicht nach aussen.
        return null;
    }
}

// Wie lange ist es her, dass in dieser Anlage etwas geschah (ENT-619)?
//
// Gibt die Zahl der Tage seit dem juengeren der beiden Signale zurueck, oder
// null, wenn KEINES feststellbar ist. Die Unterscheidung traegt die ganze
// Aussage: null heisst "wir wissen es nicht" -- etwa weil die Anlage gerade
// nicht erreichbar ist oder die Spalte fehlt --, und das darf nie wie "seit
// Ewigkeiten still" aussehen.
//
// Eine Anlage, die erreichbar ist, aber weder Zugriff noch Rapport kennt,
// ist ein dritter Fall: frisch eingerichtet und noch nie benutzt. Er kommt
// als 'nie' zurueck, nicht als eine erfundene Zahl.
function mandant_stille(?array $zahlen, ?string $heute = null)
{
    if ($zahlen === null) { return null; }
    $hatSpalten = array_key_exists('letzter_zugriff', $zahlen)
               || array_key_exists('letzter_rapport', $zahlen);
    if (!$hatSpalten) { return null; }

    $stempel = array_values(array_filter([
        $zahlen['letzter_zugriff'] ?? null,
        $zahlen['letzter_rapport'] ?? null,
    ], static fn($w) => $w !== null && $w !== '' && substr((string)$w, 0, 10) !== '0000-00-00'));

    if (!$stempel) { return 'nie'; }

    $juengster = max(array_map(static fn($w) => substr((string)$w, 0, 10), $stempel));
    $heute = $heute ?: date('Y-m-d');
    $tage = (int)floor((strtotime($heute) - strtotime($juengster)) / 86400);
    // Ein Stempel aus der Zukunft (falsch gestellte Uhr) ist kein negativer
    // Abstand, sondern "heute".
    return max(0, $tage);
}

// Den Stand eines Monats festhalten -- höchstens einmal je Mandant und
// Monat.
//
// WARUM ÜBERHAUPT FESTHALTEN: Eine Staffelung nach Betriebsgrösse braucht
// die Grösse ZUM ABRECHNUNGSZEITPUNKT. Wie viele Konten ein Betrieb im
// September hatte, lässt sich im Dezember nicht mehr feststellen --
// eintritt/austritt stehen zwar in `mitarbeiter`, aber nur für Zeilen, die
// es noch gibt, und nur wenn die Daten gepflegt sind. Eine gelöschte
// Person ist rückwirkend unsichtbar. Das ist der Grund, warum hier schon
// gezählt wird, bevor überhaupt entschieden ist, ob nach Grösse
// abgerechnet wird: Nachholen geht nicht, Wegwerfen schon.
//
// ERSTER EINTRAG GEWINNT: Ein zweiter Aufruf im selben Monat ändert nichts.
// Sonst verschöbe sich der festgehaltene Stand mit jedem Seitenaufruf, und
// der Wert hinge davon ab, wann jemand zuletzt hingeschaut hat.
// Die ZAHLEN kommen von aussen und werden hier nicht geholt. Das ist keine
// Umstaendlichkeit: mandant_groesse() baut eine Verbindung zu einer fremden
// Datenbank auf und laesst sich darum nicht ohne Server pruefen. Getrennt
// ist die Aufbewahrungsregel -- "hoechstens einmal je Monat, der erste
// gewinnt" -- gegen eine Attrappe pruefbar, und genau sie ist die
// Entscheidung. Dasselbe Vorgehen wie bei be_bootstrap_grenze() (ENT-528).
//
// Rueckgabe: null heisst "nichts festzuhalten" (keine Zahlen), sonst sagt
// 'neu', ob dieser Aufruf geschrieben hat.
function zaehlstand_festhalten(PDO $be, int $mandantId, ?array $zahlen,
                               ?string $monat = null, ?string $stichtag = null): ?array
{
    if ($zahlen === null) { return null; }
    $monat    = $monat    ?: date('Y-m');
    $stichtag = $stichtag ?: date('Y-m-d');

    $s = $be->prepare('SELECT id FROM mandant_zaehlstand WHERE mandant_id = ? AND monat = ?');
    $s->execute([$mandantId, $monat]);
    if ($s->fetchColumn()) { return ['neu' => false, 'monat' => $monat]; }

    $be->prepare(
        'INSERT INTO mandant_zaehlstand
             (mandant_id, monat, stichtag, ma_gesamt, ma_aktiv, ma_im_einsatz)
         VALUES (?, ?, ?, ?, ?, ?)'
    )->execute([$mandantId, $monat, $stichtag,
                (int)$zahlen['gesamt'], (int)$zahlen['aktiv'],
                $zahlen['im_einsatz'] === null ? null : (int)$zahlen['im_einsatz']]);

    return ['neu' => true, 'monat' => $monat] + $zahlen;
}

// ── Die Tabellen der Betreiber-Ebene ──────────────────────────────────
//
// Sie stehen HIER und nicht im Einrichtungsendpunkt, weil sie seit ENT-529
// von ZWEI Stellen angelegt werden: vom Einrichtungsknopf des Cockpits
// (api/planung_einrichten.php, solange der Bootstrap offen ist) und vom
// eigenen Endpunkt api/betreiber_einrichten.php. Zwei Kopien derselben
// Definition liefen irgendwann auseinander, und man saehe es erst, wenn
// eine Anlage anders aufgebaut waere als die andere.
function be_tabellen(): array
{
    return [

// Konten der Betreiber-Ebene. Getrennt von `mitarbeiter`, weil ein
// Betreiber-Konto keinem Mandanten gehoert -- Begruendung ausfuehrlich in
// backend/betreiber.php.
'betreiber' => "CREATE TABLE IF NOT EXISTS betreiber (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  anrede VARCHAR(20) NOT NULL DEFAULT '',
  vorname VARCHAR(100) NOT NULL DEFAULT '',
  nachname VARCHAR(100) NOT NULL DEFAULT '',
  email VARCHAR(200) NOT NULL,
  passwort_hash VARCHAR(255) NOT NULL,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  angelegt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  letzte_anmeldung DATETIME NULL,
  UNIQUE KEY uq_betreiber_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// In token steht ausschliesslich der SHA-256-Abdruck, nie der Rohwert
// (ENT-501). CHAR(64) ist genau die Laenge eines solchen Abdrucks in
// Hexdarstellung -- ein laengeres Feld liesse Raum fuer etwas anderes.
'betreiber_sessions' => "CREATE TABLE IF NOT EXISTS betreiber_sessions (
  token CHAR(64) NOT NULL PRIMARY KEY,
  betreiber_id INT UNSIGNED NOT NULL,
  erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  letzte_nutzung DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_betreiber_sessions_konto (betreiber_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Der Mandantenstamm -- die Sicht des BETREIBERS auf einen Betrieb.
//
// Nicht zu verwechseln mit der Tabelle `betrieb`, die es schon gibt: Die
// steht in der Datenbank des jeweiligen Mandanten und traegt dessen eigene
// Firmendaten (Briefkopf, Domizil, Logo). Hier stehen Vertrag, Status und
// die Frage, wo die Daten dieses Mandanten liegen.
//
// KEIN PASSWORTFELD. Host, Name und Benutzer stehen hier, das Passwort
// kommt aus dem Deploy -- Begruendung in backend/betreiber.php.
// `secret_name` haelt nur fest, WELCHES Secret gemeint ist.
//
// Sind db_host/db_name leer, gilt die Standardverbindung aus db.php. Das
// ist der Bestandsmandant, dessen Daten schon da waren, bevor es einen
// Mandantenstamm gab -- kein Sonderfall, sondern die dokumentierte
// Bedeutung von "leer".
// Der Zaehlstand je Mandant und Monat (ENT-539).
//
// EINE ZEILE JE MONAT, nicht je Tag: Abgerechnet wird monatlich, und ein
// Tagesstand waere dreissigmal so viel Zeile fuer dieselbe Auskunft.
//
// DREI ROHZAHLEN statt einer fertigen "Groesse": Was als Mitarbeiter
// zaehlt, ist nicht entschieden (OP-536). Aus Rohzahlen laesst sich jede
// Auslegung rechnen, aus einer Zahl keine andere mehr herleiten.
//
// ma_im_einsatz ist NULLable und heisst dann "nicht feststellbar" -- die
// Tabellen dafuer fehlten. Nicht null. Unbekannt darf nie wie keine
// aussehen (CLAUDE.md).
//
// KEIN Fremdschluessel auf mandant: Der Zaehlstand ist eine
// Abrechnungsgrundlage und muss den Mandanten ueberleben. Wer kuendigt,
// verschwindet aus dem Stamm -- seine Rechnungen bleiben.
'mandant_zaehlstand' => "CREATE TABLE IF NOT EXISTS mandant_zaehlstand (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  mandant_id INT UNSIGNED NOT NULL,
  monat CHAR(7) NOT NULL,
  stichtag DATE NOT NULL,
  ma_gesamt INT UNSIGNED NOT NULL,
  ma_aktiv INT UNSIGNED NOT NULL,
  ma_im_einsatz INT UNSIGNED NULL,
  erfasst_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_zaehlstand (mandant_id, monat),
  KEY idx_zaehlstand_monat (monat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

'mandant' => "CREATE TABLE IF NOT EXISTS mandant (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  -- Eigene Ausliefer-Adresse dieses Mandanten unter guardops.ch (ENT-589),
  -- z. B. 'cupi24' fuer cupi24.guardops.ch. Fuer einen regulaeren Mandanten
  -- bleibt sie informativ -- die eigene Adresse eines Deploy-Buendels kommt
  -- weiterhin ausschliesslich aus dem Buendel selbst, nie aus einer Anfrage
  -- oder einer Tabellenzeile (ENT-501, basis_url()). Seit ENT-600 hat sie
  -- fuer Demo-Plaetze aber eine zweite, aktive Rolle: demo_instanz.php und
  -- demo_anfordern.php lesen sie zur Laufzeit, um zu einem freien Platz
  -- (z. B. 'demo1') die zugehoerige Mandantenzeile und damit deren
  -- Datenbankangaben zu finden. Leer, solange ein Mandant noch unter der
  -- geteilten Testadresse laeuft.
  subdomain VARCHAR(100) NOT NULL DEFAULT '',
  status ENUM('aktiv','gesperrt','gekuendigt') NOT NULL DEFAULT 'aktiv',
  kanton CHAR(2) NULL,
  vertrag_beginn DATE NULL,
  mindestlaufzeit_monate INT NULL,
  kuendigungsfrist_monate INT NULL,
  verlaengerung_monate INT NULL,
  gekuendigt_per DATE NULL,
  gav_unterstellt TINYINT(1) NULL,
  gav_bestaetigt_am DATETIME NULL,
  gav_bestaetigt_von VARCHAR(200) NULL,
  db_host VARCHAR(200) NOT NULL DEFAULT '',
  db_name VARCHAR(200) NOT NULL DEFAULT '',
  db_user VARCHAR(200) NOT NULL DEFAULT '',
  secret_name VARCHAR(100) NOT NULL DEFAULT '',
  angelegt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geaendert_am DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Zweiter Faktor je Betreiber-Konto (OP-517). Getrennt von `zwei_faktor`,
// weil jene Tabelle an `mitarbeiter` haengt und ein Betreiber-Konto keine
// Zeile darin ist -- das Verfahren (TOTP) ist dasselbe, nur die Speicherung
// getrennt.
//
// `bestaetigt_am` ist der eigentliche Schalter: Ein eingerichtetes, aber nie
// gegengeprueftes Geheimnis zaehlt nicht, sonst sperrte sich aus, wer den
// QR-Code abgebrochen hat, bevor seine App ihn gelesen hatte.
//
// `notfallcodes` haelt ausschliesslich HASHES, nie die Codes selbst -- ein
// Notfallcode ist ein Passwortersatz und wird wie eines verwahrt.
'betreiber_zwei_faktor' => "CREATE TABLE IF NOT EXISTS betreiber_zwei_faktor (
  betreiber_id INT UNSIGNED NOT NULL PRIMARY KEY,
  geheim VARCHAR(64) NOT NULL,
  bestaetigt_am DATETIME NULL,
  letztes_fenster BIGINT NULL,
  notfallcodes TEXT NULL,
  angelegt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// ── Supportvorgaenge (ENT-538) ────────────────────────────────────────
//
// WARUM HIER UND NICHT BEIM MANDANTEN, wo die Support-Freigabe liegt: Die
// Freigabe muss beim Mandanten liegen, sonst koennte der Betreiber sie sich
// selbst ausstellen. Beim Vorgang gibt es nichts auszustellen, dafuer etwas
// zu verlieren -- der Betreiber braucht EINE Arbeitsliste ueber alle
// Mandanten, und eine nicht erreichbare Mandantendatenbank wuerde sonst
// lautlos aus ihr herausfallen. Ausfuehrlich in backend/supportvorgang.php.
//
// `erinnert_am` ist nicht nur ein Vermerk, sondern die Sperre gegen
// doppelten Versand: Gesetzt wird es mit "WHERE erinnert_am IS NULL",
// womit auch bei mehreren gleichzeitig laufenden Zeitgebern genau einer
// zum Zug kommt.
'support_vorgang' => "CREATE TABLE IF NOT EXISTS support_vorgang (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  mandant_id INT UNSIGNED NOT NULL,
  betreff VARCHAR(200) NOT NULL,
  art ENUM('stoerung','frage','wunsch') NOT NULL DEFAULT 'frage',
  status ENUM('neu','in_arbeit','wartet_auf_kunde','erledigt') NOT NULL DEFAULT 'neu',
  melder_name VARCHAR(200) NOT NULL DEFAULT '',
  melder_rolle VARCHAR(200) NOT NULL DEFAULT '',
  bildschirm VARCHAR(200) NOT NULL DEFAULT '',
  umgebung VARCHAR(200) NOT NULL DEFAULT '',
  eroeffnet_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geaendert_am DATETIME NULL,
  erledigt_am DATETIME NULL,
  erinnert_am DATETIME NULL,
  KEY idx_support_vorgang_mandant (mandant_id),
  KEY idx_support_vorgang_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Der Verlauf. Die erste Zeile ist die Schilderung des Kunden -- kein
// zweites Textfeld am Vorgang, sonst gaebe es zwei Orte fuer dieselbe
// Sache und die Frage, welcher gilt.
//
// `seite` statt einer Personen-Id: Ein Betreiber-Konto und ein
// Mitarbeiterkonto stehen in verschiedenen Tabellen verschiedener Ebenen,
// eine gemeinsame Fremdschluesselspalte gaebe es dafuer nicht. Wer
// geschrieben hat, steht als Name daneben.
// Register der Demo-Zugaenge (ENT-600). Die Definition steht in
// backend/demo_zugang.php beim uebrigen Rechenkern der Demo-Zugaenge und
// wird hier nur eingehaengt -- zwei Kopien derselben Definition liefen
// irgendwann auseinander, und man saehe es erst, wenn eine Anlage anders
// aufgebaut waere als die andere (derselbe Grund wie im Kopf dieser
// Funktion).
//
// SIE LIEGT IN DER BETREIBER-DATENBANK und nicht in der Demo-Instanz: Der
// naechtliche Reset (ENT-523) leert generisch JEDE Tabelle der verbundenen
// Datenbank. Ein Register in der Demo waere am naechsten Morgen weg.
'demo_zugang' => demo_zugang_tabelle(),

'support_nachricht' => "CREATE TABLE IF NOT EXISTS support_nachricht (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vorgang_id INT UNSIGNED NOT NULL,
  seite ENUM('kunde','betreiber') NOT NULL,
  autor VARCHAR(200) NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_support_nachricht_vorgang (vorgang_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// ══════════════════════════════════════════════════════════════════════════
// Offerten der Betreiberin (ENT-605)
// ══════════════════════════════════════════════════════════════════════════
//
// Die Betreiberin schreibt Offerten an Betriebe, die noch KEINE Mandanten
// sind -- das ist der ganze Zweck. Darum sechs eigene Tabellen und nicht die
// des Mandanten:
//
//   be_kunden            Empfaenger: kuenftige Mandanten mit Adresse
//   be_kunden_person     Ansprechpersonen dazu
//   be_kunden_kontaktweg Kommunikationswege, am Empfaenger oder an der Person
//   be_produkte          Leistungen als Vorschlagswerte (Preise: OP-536)
//   be_belege            Offerten und spaeter Rechnungen
//   be_beleg_positionen  deren Positionszeilen
//   be_briefkopf         Absender der Betreiberin auf dem Dokument
//
// WARUM NICHT DIESELBEN TABELLEN WIE IM COCKPIT: Solange die vier
// Betreiber-Secrets nicht gesetzt sind, zeigt betreiber_db() auf dieselbe
// Datenbank wie db() (Kopf dieser Datei, OP-518). Gleiche Namen hiessen
// heute: Die Offerten der Betreiberin stuenden in der Offertenliste der
// Mandantin, beide teilten sich die Nummernreihe ab OF-0001, und die
// Interessenten der Betreiberin stuenden in deren Kundenliste. Zieht die
// Betreiber-Ebene spaeter auf eine eigene Datenbank, bleiben die Namen
// trotzdem richtig -- ein Praefix stoert dort niemanden.
//
// Die Felder sind absichtlich dieselben wie beim Mandanten, denn der
// Rechenkern ist derselbe: belege.php, kunden.php und produkte.php bekommen
// seit ENT-605 einen Tabellenpraefix und werden NICHT kopiert. Eine zweite
// Kopie der Geldrechnung waere die Stelle, an der die beiden Seiten
// auseinanderlaufen.

'be_kunden' => "CREATE TABLE IF NOT EXISTS be_kunden (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kundennummer VARCHAR(20) NOT NULL DEFAULT '',
  -- 'privat' gibt es hier praktisch nicht: Empfaenger sind Betriebe. Das
  -- Feld bleibt trotzdem, weil kunden.php dieselbe Eingabelogik fuer beide
  -- Seiten fuehrt und eine fehlende Spalte sie am Praefix zerbrechen liesse.
  art ENUM('unternehmen','privat') NOT NULL DEFAULT 'unternehmen',
  anrede VARCHAR(50) NOT NULL DEFAULT '',
  vorname VARCHAR(100) NOT NULL DEFAULT '',
  nachname VARCHAR(100) NOT NULL DEFAULT '',
  name VARCHAR(200) NOT NULL,
  zusatzfeld VARCHAR(200) NOT NULL DEFAULT '',
  strasse VARCHAR(200) NOT NULL DEFAULT '',
  hausnummer VARCHAR(20) NOT NULL DEFAULT '',
  adresszusatz VARCHAR(200) NOT NULL DEFAULT '',
  plz VARCHAR(20) NOT NULL DEFAULT '',
  ort VARCHAR(120) NOT NULL DEFAULT '',
  uid VARCHAR(40) NOT NULL DEFAULT '',
  mwst_nr VARCHAR(40) NOT NULL DEFAULT '',
  telefon VARCHAR(60) NOT NULL DEFAULT '',
  email VARCHAR(200) NOT NULL DEFAULT '',
  kontaktperson VARCHAR(200) NOT NULL DEFAULT '',
  notiz TEXT NULL,
  re_name VARCHAR(200) NOT NULL DEFAULT '',
  re_zusatz VARCHAR(200) NOT NULL DEFAULT '',
  re_strasse VARCHAR(200) NOT NULL DEFAULT '',
  re_hausnummer VARCHAR(20) NOT NULL DEFAULT '',
  re_plz VARCHAR(20) NOT NULL DEFAULT '',
  re_ort VARCHAR(120) NOT NULL DEFAULT '',
  -- Wird aus dem Interessenten ein Mandant, zeigt diese Spalte auf seine
  -- Zeile im Stamm. NULL heisst 'noch keiner' und ist der Normalfall --
  -- genau dafuer gibt es diese Tabelle. KEIN Fremdschluessel: Wer kuendigt,
  -- verschwindet aus dem Stamm, seine Offerten und Rechnungen bleiben
  -- (gleiche Ueberlegung wie bei mandant_zaehlstand, ENT-539).
  mandant_id INT UNSIGNED NULL,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  angelegt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_be_kunden_name (name),
  KEY idx_be_kunden_mandant (mandant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

'be_kunden_person' => "CREATE TABLE IF NOT EXISTS be_kunden_person (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kunde_id INT UNSIGNED NOT NULL,
  anrede VARCHAR(50) NULL,
  vorname VARCHAR(100) NULL,
  nachname VARCHAR(100) NULL,
  sortierung INT NOT NULL DEFAULT 0,
  KEY idx_be_kunden_person_kunde (kunde_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// person_id NULL heisst: Der Weg gehoert dem Betrieb, nicht einer Person.
// Das ist eine eigene Aussage und kein fehlender Wert.
'be_kunden_kontaktweg' => "CREATE TABLE IF NOT EXISTS be_kunden_kontaktweg (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kunde_id INT UNSIGNED NOT NULL,
  person_id INT UNSIGNED NULL,
  art ENUM('email','telefon','mobil','webseite','fax') NOT NULL,
  wert VARCHAR(200) NOT NULL,
  sortierung INT NOT NULL DEFAULT 0,
  KEY idx_be_kunden_weg_kunde (kunde_id),
  KEY idx_be_kunden_weg_person (person_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Vorschlagswerte fuer Positionszeilen. Die Tabelle steht heute leer da,
// und das ist richtig so: Welche Grundgebuehr und welche Staffelung gilt,
// ist nicht entschieden (ENT-539 Punkt 7, OP-536). Eine Offerte braucht sie
// nicht -- ihre Positionen tragen Text, Menge und Preis selbst.
'be_produkte' => "CREATE TABLE IF NOT EXISTS be_produkte (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nummer VARCHAR(20) NOT NULL DEFAULT '',
  name VARCHAR(200) NOT NULL,
  beschreibung TEXT NULL,
  einzelpreis_rappen INT NOT NULL DEFAULT 0,
  einheit VARCHAR(20) NOT NULL DEFAULT 'Std.',
  mwst_satz_bp INT NOT NULL DEFAULT 810,
  sortierung INT NOT NULL DEFAULT 0,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_be_produkte_sort (sortierung, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Spaltenaufbau wie `belege` beim Mandanten, damit belege.php beide Saetze
// mit derselben Abfrage bedient. ALLES IN RAPPEN, Prozentsaetze in
// Basispunkten -- siehe Kopf von belege.php.
//
// versand_token bleibt ROH und ist bewusst kein Abdruck (ENT-501 nimmt ihn
// ausdruecklich aus): Er ist kein Sitzungsausweis, sondern der Link selbst.
// Ein Abdruck liesse sich nicht mehr verschicken.
'be_belege' => "CREATE TABLE IF NOT EXISTS be_belege (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  art ENUM('offerte','rechnung') NOT NULL DEFAULT 'offerte',
  nummer VARCHAR(20) NOT NULL,
  kunde_id INT UNSIGNED NULL,
  person_id INT UNSIGNED NULL,
  titel VARCHAR(200) NOT NULL DEFAULT '',
  referenz VARCHAR(100) NOT NULL DEFAULT '',
  datum DATE NOT NULL,
  gueltig_bis DATE NULL,
  faellig_bis DATE NULL,
  status ENUM('entwurf','versendet','angeschaut','bestaetigt','abgelehnt')
         NOT NULL DEFAULT 'entwurf',
  bemerkung TEXT NULL,
  oeffentliche_notizen TEXT NULL,
  bedingungen TEXT NULL,
  fusszeile_text TEXT NULL,
  unterschriftsseite TINYINT(1) NOT NULL DEFAULT 0,
  ist_vorlage TINYINT(1) NOT NULL DEFAULT 0,
  rabatt_bp INT NOT NULL DEFAULT 0,
  zwischensumme_rappen INT NOT NULL DEFAULT 0,
  rabatt_rappen INT NOT NULL DEFAULT 0,
  mwst_rappen INT NOT NULL DEFAULT 0,
  rundung_rappen INT NOT NULL DEFAULT 0,
  total_rappen INT NOT NULL DEFAULT 0,
  bezahlt TINYINT(1) NOT NULL DEFAULT 0,
  bezahlt_am DATE NULL,
  versand_token CHAR(64) NULL,
  entscheidung_am DATETIME NULL,
  entscheidung_ip VARCHAR(64) NULL,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geaendert_am DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_be_belege_token (versand_token),
  KEY idx_be_belege_art (art, datum),
  KEY idx_be_belege_kunde (kunde_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// produkt_id ist nur ein Rueckverweis. Name, Preis, Einheit und Satz stehen
// als KOPIE in der Zeile: Stand beim Erfassen, nicht heutiger Stand des
// Produkts (Schnappschuss-Regel, siehe belege.php). Eine Preisaenderung
// darf eine verschickte Offerte nie rueckwirkend veraendern.
'be_beleg_positionen' => "CREATE TABLE IF NOT EXISTS be_beleg_positionen (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  beleg_id INT UNSIGNED NOT NULL,
  sortierung INT NOT NULL DEFAULT 0,
  produkt_id INT UNSIGNED NULL,
  produkt_name VARCHAR(200) NOT NULL DEFAULT '',
  beschreibung TEXT NULL,
  menge DECIMAL(12,2) NOT NULL DEFAULT 1.00,
  einheit VARCHAR(20) NOT NULL DEFAULT 'Std.',
  einzelpreis_rappen INT NOT NULL DEFAULT 0,
  rabatt_bp INT NOT NULL DEFAULT 0,
  mwst_satz_bp INT NOT NULL DEFAULT 0,
  KEY idx_be_beleg_pos_beleg (beleg_id, sortierung)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Der Absender auf dem Dokument und im Versandtext. Beim Mandanten kommt er
// aus `betrieb` in dessen eigener Datenbank -- diese Tabelle gibt es auf der
// Betreiber-Ebene nicht, und sie darf es auch nicht: Der Briefkopf der
// Betreiberin gehoert nicht in die Datenbank einer Mandantin.
//
// GENAU EINE ZEILE, id = 1. Kein Firmenname im Quelltext (Hausregel
// Vertraulichkeit) -- was hier steht, traegt die Betreiberin selbst ein.
// Solange sie leer ist, verweigert der Versand mit klarer Begruendung,
// statt eine Offerte ohne Absender zu verschicken.
// Logbuch der Betreiber-Ebene (ENT-614).
//
// Gleicher Bau wie `aenderungslog` auf der Mandantenseite -- und trotzdem
// eine eigene Tabelle: Solange die vier Betreiber-Secrets nicht gesetzt sind,
// steht sie in DERSELBEN Datenbank wie die Personalakten der Mandantin
// (OP-518). Ein gemeinsames Logbuch haette zwei Leserkreise und zwei
// Loeschfristen in einem Topf.
//
// KEIN Fremdschluessel auf betreiber: Ein Verlauf muss den Datensatz
// ueberleben, ueber den er berichtet -- darum steht der Name des Akteurs
// als Text daneben und nicht nur seine ID.
'be_aenderungslog' => "CREATE TABLE IF NOT EXISTS be_aenderungslog (
  id INT AUTO_INCREMENT PRIMARY KEY,
  zeitpunkt DATETIME DEFAULT CURRENT_TIMESTAMP,
  akteur_id INT NOT NULL,
  akteur_name VARCHAR(100) NOT NULL,
  bereich VARCHAR(30) NOT NULL,
  objekt_id INT NOT NULL,
  feld VARCHAR(60) NOT NULL,
  wert_alt TEXT NULL,
  wert_neu TEXT NULL,
  werte_verborgen TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_be_objekt (bereich, objekt_id, zeitpunkt),
  KEY idx_be_zeit (zeitpunkt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

'be_briefkopf' => "CREATE TABLE IF NOT EXISTS be_briefkopf (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  firma VARCHAR(200) NOT NULL DEFAULT '',
  -- Vier Zeilen Anschrift als EIN Textfeld, wie die Fusszeile beim
  -- Mandanten: Auf dem Blatt steht sie ohnehin als Block, und getrennte
  -- Felder waeren vier Orte, an denen dieselbe Adresse veralten kann.
  absender TEXT NULL,
  uid VARCHAR(40) NOT NULL DEFAULT '',
  mwst_nr VARCHAR(40) NOT NULL DEFAULT '',
  iban VARCHAR(40) NOT NULL DEFAULT '',
  qr_iban VARCHAR(40) NOT NULL DEFAULT '',
  qr_strasse VARCHAR(200) NOT NULL DEFAULT '',
  qr_hausnummer VARCHAR(20) NOT NULL DEFAULT '',
  qr_plz VARCHAR(20) NOT NULL DEFAULT '',
  qr_ort VARCHAR(100) NOT NULL DEFAULT '',
  email VARCHAR(200) NOT NULL DEFAULT '',
  telefon VARCHAR(60) NOT NULL DEFAULT '',
  webseite VARCHAR(200) NOT NULL DEFAULT '',
  -- Das Logo liegt als data:-URL in der Zeile, wie beim Mandanten: Der
  -- Betreiber-Bereich hat kein Verzeichnis fuer hochgeladene Dateien, und
  -- ein Bild, das nur auf einem Blatt erscheint, braucht keines.
  logo MEDIUMTEXT NULL,
  geaendert_am DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ];
}

// Legt an, was fehlt. Loescht nichts, leert nichts -- gefahrlos mehrfach
// aufrufbar. Gibt zurueck, was getan wurde und was fehlschlug.
function be_tabellen_anlegen(PDO $pdo, bool $nurPruefen = false): array
{
    $getan = []; $offen = []; $fehler = [];
    foreach (be_tabellen() as $name => $sql) {
        if (hat_tabelle($pdo, $name)) { continue; }
        if ($nurPruefen) { $offen[] = 'Tabelle ' . $name; continue; }
        try {
            $pdo->exec($sql);
            $getan[] = 'Tabelle ' . $name . ' angelegt';
        } catch (Throwable $e) {
            $fehler[] = 'Tabelle ' . $name . ' — ' . $e->getMessage();
        }
    }
    return ['getan' => $getan, 'offen' => $offen, 'fehler' => $fehler];
}

// Spalten, die eine bestehende Betreiber-Tabelle nachtraeglich braucht --
// CREATE TABLE IF NOT EXISTS in be_tabellen_anlegen() legt sie nur bei einer
// FRISCHEN Anlage gleich mit an, eine schon vorhandene Tabelle bleibt davon
// unberuehrt. Dieselbe "eine Definition, nicht zwei"-Ueberlegung wie bei
// be_tabellen(): sie steht hier, weil sowohl api/planung_einrichten.php
// (solange der Bootstrap offen ist) als auch api/betreiber_schema_pruefen.php
// sie ausfuehren koennen muessen.
function be_spalten(): array
{
    return [
        // Eigene Ausliefer-Adresse je Mandant (ENT-589, Spaltenkommentar bei
        // der CREATE-TABLE-Definition oben). Traegt sie fuer eine Anlage
        // nach, deren `mandant`-Tabelle schon vor ENT-589 entstanden ist --
        // eine frische Anlage bekommt sie ueber be_tabellen() bereits mit.
        ['mandant', 'subdomain', "ALTER TABLE mandant ADD COLUMN subdomain VARCHAR(100) NOT NULL DEFAULT '' AFTER name"],
        // Namensteile am Betreiber-Konto (ENT-615). `name` bleibt als
        // Anzeigename stehen und wird aus Vor- und Nachname zusammengesetzt --
        // Anmeldung, Support und Logbuch sprechen weiter ueber dieses eine
        // Feld. Gefuellt werden die Teile nicht hier, sondern in
        // be_namen_nachtragen() hinter der Schleife -- erst dann stehen beide
        // Spalten, und die Reihenfolge der drei Eintraege spielt keine Rolle.
        ['betreiber', 'anrede',   "ALTER TABLE betreiber ADD COLUMN anrede VARCHAR(20) NOT NULL DEFAULT '' AFTER name"],
        ['betreiber', 'nachname', "ALTER TABLE betreiber ADD COLUMN nachname VARCHAR(100) NOT NULL DEFAULT '' AFTER anrede"],
        ['betreiber', 'vorname',  "ALTER TABLE betreiber ADD COLUMN vorname VARCHAR(100) NOT NULL DEFAULT '' AFTER anrede"],
        // Zahlungsteil der Rechnung (ENT-616). Die Adresse des
        // Zahlungsempfaengers steht hier ein zweites Mal, obwohl `absender`
        // schon einen Adressblock traegt: Der ist ein Freitext fuer den
        // Briefkopf, mit Zeilenumbruechen und beliebigem Aufbau. Der
        // Zahlteil braucht Strasse, PLZ und Ort EINZELN, in eigenen Feldern
        // mit eigenen Laengengrenzen -- die Bank weist einen Code zurueck,
        // dessen Adressblock nicht passt. Dieselbe Trennung wie in der
        // Tabelle `betrieb` auf der Mandantenseite.
        ['be_briefkopf', 'qr_iban',       "ALTER TABLE be_briefkopf ADD COLUMN qr_iban VARCHAR(40) NOT NULL DEFAULT '' AFTER iban"],
        ['be_briefkopf', 'qr_strasse',    "ALTER TABLE be_briefkopf ADD COLUMN qr_strasse VARCHAR(200) NOT NULL DEFAULT '' AFTER qr_iban"],
        ['be_briefkopf', 'qr_hausnummer', "ALTER TABLE be_briefkopf ADD COLUMN qr_hausnummer VARCHAR(20) NOT NULL DEFAULT '' AFTER qr_strasse"],
        ['be_briefkopf', 'qr_plz',        "ALTER TABLE be_briefkopf ADD COLUMN qr_plz VARCHAR(20) NOT NULL DEFAULT '' AFTER qr_hausnummer"],
        ['be_briefkopf', 'qr_ort',        "ALTER TABLE be_briefkopf ADD COLUMN qr_ort VARCHAR(100) NOT NULL DEFAULT '' AFTER qr_plz"],
        // Vertragsangaben am Mandanten (ENT-617). ALLE fuenf sind NULL-bar,
        // und das ist eine Aussage: Ein Vertrag, zu dem nichts eingetragen
        // ist, hat keine Laufzeit von null Monaten -- er ist unbekannt. Eine
        // 0 als Vorgabewert wuerde "sofort kuendbar" behaupten.
        ['mandant', 'vertrag_beginn',          "ALTER TABLE mandant ADD COLUMN vertrag_beginn DATE NULL AFTER kanton"],
        ['mandant', 'mindestlaufzeit_monate',  "ALTER TABLE mandant ADD COLUMN mindestlaufzeit_monate INT NULL AFTER vertrag_beginn"],
        ['mandant', 'kuendigungsfrist_monate', "ALTER TABLE mandant ADD COLUMN kuendigungsfrist_monate INT NULL AFTER mindestlaufzeit_monate"],
        ['mandant', 'verlaengerung_monate',    "ALTER TABLE mandant ADD COLUMN verlaengerung_monate INT NULL AFTER kuendigungsfrist_monate"],
        ['mandant', 'gekuendigt_per',          "ALTER TABLE mandant ADD COLUMN gekuendigt_per DATE NULL AFTER verlaengerung_monate"],
    ];
}

// Teilt einen Anzeigenamen in Vor- und Nachname.
//
// Erstes Wort ist der Vorname, alles Weitere der Nachname -- und nicht
// umgekehrt: Bei "Anna von Gunten" ist "von Gunten" der Nachname. Die
// Umkehrung (letztes Wort = Nachname) zerschneidet genau die
// zusammengesetzten Namen, die es hier haeufig gibt.
//
// Bleibt nur ein Wort uebrig, gilt es als Nachname. Das ist die Annahme, die
// sich leichter korrigieren laesst: Ein fehlender Vorname faellt in der Liste
// auf, ein falsch zugeordneter nicht.
function be_name_teilen(string $name): array
{
    $teile = preg_split('/\s+/u', trim($name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    if (count($teile) === 0) { return ['vorname' => '', 'nachname' => '']; }
    if (count($teile) === 1) { return ['vorname' => '', 'nachname' => $teile[0]]; }
    return ['vorname' => array_shift($teile), 'nachname' => implode(' ', $teile)];
}

// Setzt den Anzeigenamen aus den Teilen zusammen. Eine Stelle, damit `name`
// nicht an drei Endpunkten leicht verschieden entsteht.
function be_name_bauen(string $vorname, string $nachname): string
{
    return trim(trim($vorname) . ' ' . trim($nachname));
}

// Fuellt Vor- und Nachname bestehender Konten einmalig aus `name`.
//
// Laeuft aus be_spalten_anlegen() heraus, nicht als eigener Aufruf an drei
// Einrichtungsstellen: Eine Nachtragsspalte, die an einer davon vergessen
// wird, laesst genau die Anlage ohne Namen zurueck, die den Nachtrag am
// noetigsten hat. Idempotent -- wer schon geteilte Namen hat, wird nicht
// angefasst.
function be_namen_nachtragen(PDO $pdo): int
{
    if (!hat_tabelle($pdo, 'betreiber')
        || !hat_spalte($pdo, 'betreiber', 'vorname')
        || !hat_spalte($pdo, 'betreiber', 'nachname')) {
        return 0;
    }
    try {
        $offen = $pdo->query(
            "SELECT id, name FROM betreiber WHERE vorname = '' AND nachname = ''"
        )->fetchAll(PDO::FETCH_ASSOC);
        $s = $pdo->prepare('UPDATE betreiber SET vorname = ?, nachname = ? WHERE id = ?');
        $zahl = 0;
        foreach ($offen as $k) {
            $t = be_name_teilen((string)$k['name']);
            if ($t['vorname'] === '' && $t['nachname'] === '') { continue; }
            $s->execute([$t['vorname'], $t['nachname'], (int)$k['id']]);
            $zahl++;
        }
        return $zahl;
    } catch (Throwable $e) {
        return 0;
    }
}

function be_spalten_anlegen(PDO $pdo, bool $nurPruefen = false): array
{
    $getan = []; $offen = []; $fehler = [];
    foreach (be_spalten() as [$tabelle, $spalte, $sql]) {
        if (!hat_tabelle($pdo, $tabelle) || hat_spalte($pdo, $tabelle, $spalte)) { continue; }
        if ($nurPruefen) { $offen[] = 'Spalte ' . $tabelle . '.' . $spalte; continue; }
        try {
            $pdo->exec($sql);
            $getan[] = 'Spalte ' . $tabelle . '.' . $spalte . ' ergaenzt';
        } catch (Throwable $e) {
            $fehler[] = 'Spalte ' . $tabelle . '.' . $spalte . ' — ' . $e->getMessage();
        }
    }
    // Direkt hinter den Spalten, im selben Durchlauf: Ein Konto, dessen
    // Namensteile leer bleiben, waere in der neuen Liste namenlos.
    if (!$nurPruefen) {
        $zahl = be_namen_nachtragen($pdo);
        if ($zahl > 0) { $getan[] = 'Namensteile fuer ' . $zahl . ' Betreiber-Konten nachgetragen'; }
    }
    return ['getan' => $getan, 'offen' => $offen, 'fehler' => $fehler];
}

// Traegt den aufrufenden Betrieb als Mandant 1 ein -- einmalig, und nur
// wenn der Stamm noch leer ist. Der Name kommt aus der Tabelle `betrieb`
// der MANDANTEN-Datenbank und nicht aus dem Quelltext (Hausregel
// Vertraulichkeit: im Code steht kein echter Firmenname).
//
// Die Subdomain dagegen ist bewusst ein festes Literal, kein aus der
// Datenbank hergeleiteter Wert: CUPI 24 ist der Bestandsmandant und liefert
// seit ENT-589 unter cupi24.guardops.ch aus -- das ist eine getroffene
// Entscheidung, keine Konfiguration (Hausregel: Konfigurierbarkeit ist kein
// Qualitaetsmerkmal).
function be_bestandsmandant_eintragen(PDO $stamm, PDO $betrieb): ?string
{
    if (!hat_tabelle($stamm, 'mandant')) { return null; }
    if ((int)$stamm->query('SELECT COUNT(*) FROM mandant')->fetchColumn() !== 0) {
        // Die Zeile besteht schon -- aus der Zeit vor ENT-589, als es die
        // Spalte noch nicht gab, oder aus einem frueheren Lauf dieser
        // Funktion. Nachtragen, aber nur, wenn es GENAU einen Mandanten
        // gibt: Sobald ein zweiter dazukommt, waere nicht mehr eindeutig,
        // welche Zeile der Bestandsmandant ist, und ein Erraten waere genau
        // die Art Annahme, die hier nichts verloren hat. Wiederholbar und
        // ungefaehrlich: geschrieben wird nur dort, wo noch nichts steht.
        if (hat_spalte($stamm, 'mandant', 'subdomain')
            && (int)$stamm->query('SELECT COUNT(*) FROM mandant')->fetchColumn() === 1) {
            $mid = (int)$stamm->query(
                "SELECT id FROM mandant WHERE subdomain IS NULL OR subdomain = '' LIMIT 1"
            )->fetchColumn();
            if ($mid > 0) {
                $stamm->prepare('UPDATE mandant SET subdomain = ? WHERE id = ?')
                    ->execute(['cupi24', $mid]);
            }
        }
        return null;
    }

    $name = '';
    try {
        $name = (string)($betrieb->query('SELECT firma FROM betrieb WHERE id = 1')->fetchColumn() ?: '');
    } catch (Throwable $e) {
        // Kein Briefkopf, kein Problem -- Platzhalter unten.
    }
    if (trim($name) === '') { $name = 'Bestandsbetrieb (Name nachtragen)'; }

    $stamm->prepare(
        'INSERT INTO mandant (name, subdomain, status, db_host, db_name, db_user, secret_name)
         VALUES (?, \'cupi24\', \'aktiv\', \'\', \'\', \'\', \'\')'
    )->execute([$name]);
    return $name;
}
