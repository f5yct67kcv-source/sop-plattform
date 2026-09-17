<?php
declare(strict_types=1);
// Demo-Zugaenge je Interessent (ENT-600).
//
// Reiner Rechenkern ohne Datenbank und ohne Netz -- dieselbe Trennung wie
// bei demo_anfrage.php, rundgang.php und planung.php: Was hier steht,
// laesst sich echt ausfuehren (pruefungen/pruef_demo_zugang.php), die
// Endpunkte verdrahten nur noch.
//
// WAS HIER ENTSCHIEDEN IST UND WARUM (ENT-600):
//
//  1. EIN ZUGANG JE INTERESSENT, NIE EIN GETEILTES KONTO. Bis hierher
//     teilten sich alle Demo-Besucher ein einziges, weitergegebenes Konto
//     mit Verwaltungsrechten (siehe ENT-587). Wer eine Einsatzplanung
//     ernsthaft prueft, legt eigene Objekte, eigene Kunden und eigene Leute
//     an -- echte Namen, echte Adressen, womoeglich echte Loehne. In einer
//     geteilten Instanz steht das vor dem naechsten Interessenten.
//
//  2. EIN PLATZ IST EINE EIGENE INSTANZ. Die Trennung laeuft ueber die
//     Datenbank, nicht ueber eine Spalte in jeder Tabelle: Eine Trennung
//     ueber eine Spalte muesste in JEDEM Lesepfad mitgedacht werden, und
//     genau diese Sorte Regel ist hier schon mehrfach an etwas Neuem
//     gescheitert, das sie nicht geerbt hat (CLAUDE.md).
//
//  3. VIERZEHN TAGE, ABLAUF VON SELBST. Kein manuelles Beenden. Ein
//     Schritt, den ein Mensch tun muss, wird irgendwann nicht getan -- und
//     der Zugang, der dann offen bleibt, ist genau der, der nicht auffaellt.
//
//  4. KEIN PASSWORT IN DIESEM REGISTER. Der Hash liegt im Konto der
//     Demo-Instanz, nicht hier. Dieses Register weiss, WER einen Zugang hat
//     und WIE LANGE -- nicht, womit er sich anmeldet.
//
//  5. "ABGELAUFEN" IST NICHT "FALSCH". Wer sich nach dem Ablauf anmeldet,
//     liest, dass sein Zugang abgelaufen ist, und nicht, dass sein Passwort
//     nicht stimmt. Das sind zwei verschiedene Aussagen und brauchen zwei
//     Texte (CLAUDE.md). Fuer den Betreiber ist der erste Fall ein Anruf
//     wert, der zweite nicht.

// Laufzeit eines Demo-Zugangs. Als Konstante und nicht als Einstellung:
// Konfigurierbarkeit ist kein Qualitaetsmerkmal, solange niemand eine
// andere Laufzeit braucht (Optimierungsziel, CLAUDE.md Teil B).
const DEMO_ZUGANG_TAGE = 14;

// Die Plaetze des Vorrats. Drei zum Start (ENT-600, Punkt 3). Die Namen
// entsprechen der Subdomain unter guardops.ch und damit der `subdomain`-
// Spalte der `mandant`-Zeile, ueber die der Betreiber-Bereich die
// Datenbank des Platzes findet.
//
// FESTE LISTE UND KEINE ZAEHLSCHLEIFE ("demo" . $i): Ein vierter Platz
// entsteht nicht dadurch, dass jemand eine Zahl hochsetzt -- er braucht
// eine Datenbank, ein Deploy-Buendel und ein Geheimnis. Eine Liste, die
// man erweitern MUSS, zwingt zu dem Blick auf das, was sonst noch fehlt.
const DEMO_PLAETZE = ['demo1', 'demo2', 'demo3'];

// Zustaende eines Zugangs. Geschlossene Liste, kein freier Text -- wie der
// Mandantenstatus in betreiber.php.
//
//   aktiv       -- laeuft, Frist noch nicht um
//   abgelaufen  -- Frist um, Instanz geleert, Platz wieder frei
//   beendet     -- vom Betreiber vorzeitig beendet
const DEMO_ZUGANG_STATUS = ['aktiv', 'abgelaufen', 'beendet'];

function demo_zugang_status_gueltig(string $status): bool
{
    return in_array($status, DEMO_ZUGANG_STATUS, true);
}

// Ablaufzeitpunkt aus dem Startzeitpunkt. Gerechnet ueber DateTimeImmutable
// und nicht ueber "+ 14 * 86400": Zwischen Start und Ablauf liegt in der
// Schweiz zweimal im Jahr eine Zeitumstellung, und 14 Tage sind dann nicht
// 14 * 86400 Sekunden. Wer am 25. Oktober um 09:00 freigibt, dessen Zugang
// laeuft am 8. November um 09:00 ab -- nicht um 08:00.
function demo_zugang_ablauf(string $start, int $tage = DEMO_ZUGANG_TAGE): string
{
    $d = new DateTimeImmutable($start);
    return $d->modify('+' . $tage . ' days')->format('Y-m-d H:i:s');
}

// Ist ein Zugang zu diesem Zeitpunkt abgelaufen? Der Zeitpunkt wird
// hereingereicht und nicht hier geholt: Eine Funktion, die selbst "jetzt"
// bestimmt, laesst sich nicht an beiden Seiten der Grenze pruefen.
//
// Die Grenze selbst gehoert dem Interessenten: Genau auf der Sekunde gilt
// der Zugang noch. Wer eine Frist setzt, soll sie ganz bekommen.
function demo_zugang_abgelaufen(string $laeuftAbAm, string $jetzt): bool
{
    return strtotime($jetzt) > strtotime($laeuftAbAm);
}

// Verbleibende volle Tage, fuer die Anzeige im Betreiber-Bereich.
// Aufgerundet wird bewusst NICHT: "noch 1 Tag" bei 3 Stunden Restlaufzeit
// verspricht mehr, als da ist. Bei weniger als einem Tag kommt 0 heraus,
// und die Anzeige sagt dann "laeuft heute ab" statt einer Zahl.
function demo_zugang_resttage(string $laeuftAbAm, string $jetzt): int
{
    $rest = strtotime($laeuftAbAm) - strtotime($jetzt);
    if ($rest <= 0) { return 0; }
    return intdiv($rest, 86400);
}

// Welcher Platz ist frei? Der erste des Vorrats, auf dem gerade kein
// aktiver Zugang liegt.
//
// $belegt sind die Plaetze der aktiven Zugaenge. Kein Platz frei heisst
// null, NICHT den ersten Platz als Notbehelf -- sonst laege ein zweiter
// Interessent auf der Instanz des ersten, und das ist genau der Fehler,
// den ENT-600 verhindert. Wer null bekommt, muss dem Betreiber sagen, dass
// der Vorrat erschoepft ist.
function demo_platz_waehlen(array $belegt, array $plaetze = DEMO_PLAETZE): ?string
{
    foreach ($plaetze as $platz) {
        if (!in_array($platz, $belegt, true)) { return $platz; }
    }
    return null;
}

// Anmeldename aus dem Firmennamen. Kleinbuchstaben, keine Umlaute, kein
// Sonderzeichen -- ein Anmeldename wird abgetippt, auch aus einer
// ausgedruckten E-Mail.
//
// Bei Gleichstand wird angehaengt statt abgewiesen: Zwei Interessenten
// derselben Firma sind der Normalfall (jemand schickt den Kollegen), kein
// Fehler. Die Zahl zaehlt hoch, bis ein freier Name gefunden ist.
function demo_login_bilden(string $firma, array $vergeben = []): string
{
    $roh = strtr(mb_strtolower(trim($firma)), [
        'ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'à' => 'a', 'é' => 'e',
        'è' => 'e', 'ê' => 'e', 'ç' => 'c', 'ß' => 'ss',
    ]);
    $rumpf = preg_replace('/[^a-z0-9]+/', '', $roh) ?? '';
    // Leer oder nur Sonderzeichen: ein neutraler Rumpf statt eines leeren
    // Namens. "demo" allein waere kein brauchbarer Anmeldename.
    if ($rumpf === '') { $rumpf = 'gast'; }
    $rumpf = mb_substr($rumpf, 0, 16);

    $name = $rumpf;
    $n = 1;
    while (in_array($name, $vergeben, true)) {
        $n++;
        $name = $rumpf . $n;
    }
    return $name;
}

// Was der Anmeldebildschirm sagt. Vier Lagen, vier Texte -- zusammengezogen
// schickte man einen Interessenten mit abgelaufenem Zugang auf die Suche
// nach einem Tippfehler, den es nicht gibt.
function demo_zugang_meldung(string $lage): string
{
    return match ($lage) {
        'aktiv'      => '',
        'abgelaufen' => 'Dieser Demo-Zugang ist abgelaufen. '
                      . 'Über "Probleme bei der Anmeldung?" können Sie einen neuen anfragen.',
        'beendet'    => 'Dieser Demo-Zugang wurde beendet. '
                      . 'Über "Probleme bei der Anmeldung?" können Sie einen neuen anfragen.',
        default      => 'Name oder Passwort stimmt nicht.',
    };
}

// Die Tabelle des Registers. Sie liegt in der BETREIBER-Datenbank, nicht in
// der Demo-Instanz: Der naechtliche Reset (ENT-523) leert generisch JEDE
// Tabelle der verbundenen Datenbank -- ein Register in der Demo waere am
// naechsten Morgen weg. Genau darum steht hier auch kein Passwort-Hash: Er
// gehoert ins Konto der Instanz, das beim Freigeben neu entsteht und beim
// Ablaufen mit ihr verschwindet.
function demo_zugang_tabelle(): string
{
    return "CREATE TABLE IF NOT EXISTS demo_zugang (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  platz VARCHAR(50) NOT NULL,
  firma VARCHAR(200) NOT NULL,
  person VARCHAR(200) NOT NULL,
  email VARCHAR(200) NOT NULL,
  login VARCHAR(100) NOT NULL,
  status ENUM('aktiv','abgelaufen','beendet') NOT NULL DEFAULT 'aktiv',
  freigegeben_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  freigegeben_von VARCHAR(200) NOT NULL DEFAULT '',
  laeuft_ab_am DATETIME NOT NULL,
  beendet_am DATETIME NULL,
  -- Ein Platz traegt hoechstens einen aktiven Zugang. Der Index ist nicht
  -- nur fuer die Geschwindigkeit da: Er ist die Spur, auf der die Suche
  -- nach dem freien Platz laeuft.
  KEY idx_demo_zugang_platz (platz, status),
  KEY idx_demo_zugang_ablauf (status, laeuft_ab_am),
  KEY idx_demo_zugang_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
}
