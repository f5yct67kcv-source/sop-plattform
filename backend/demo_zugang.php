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
//
// SEIT ENT-601/ENT-603 ZUSAETZLICH: Die Zuteilung eines Platzes laeuft
// automatisch ueber api/demo_anfordern.php, nicht mehr ueber einen
// Betreiber von Hand -- Interessenten, die ueber Werbung kommen, sollen
// nicht auf einen freien Menschen warten. Der Vorrat selbst und die
// Trennung ueber eigene Datenbanken (Punkte 1 und 2 oben) bleiben
// unveraendert; nur WER zuteilt und WIE die Zugangsdaten zugestellt
// werden, hat sich geaendert. Der Betreiber-Bereich behaelt eine
// Uebersicht mit Not-Aus (einen laufenden Zugang vorzeitig beenden),
// vergibt aber keinen mehr selbst.
const DEMO_FREIGEGEBEN_AUTOMATISCH = 'automatisch (Selbstbedienung, ENT-601)';

// Dieselbe Antwort fuer JEDEN erfolgreichen Fall von api/demo_anfordern.php
// -- Honigtopf, neuer Zugang, bestehender Zugang mit neuem Passwort. Wer
// bereits einen aktiven Zugang hat, soll das nicht am Antworttext ablesen
// koennen (dieselbe Regel wie bei passwort_vergessen.php). "Kein Platz
// frei" bleibt bewusst eine EIGENE, ehrliche Meldung (409) -- eine
// Kapazitaetsgrenze ist keine sicherheitsrelevante Tatsache, die man
// verschleiern muesste, und ein Interessent soll nicht auf eine Zusage
// warten, die nicht kommt.
const DEMO_ANFORDERN_DANKE = 'Vielen Dank. Sie erhalten in Kürze eine E-Mail mit Ihren Zugangsdaten.';

// ── Kleine Formhelfer fuer api/demo_anfordern.php und
// api/demo_erneut_senden.php ─────────────────────────────────────────
//
// EIGENE, KLEINE FASSUNG STATT demo_anfrage.php EINZUBINDEN: Jene Datei
// traegt einen Platzhalter fuer den Empfaenger des Kontaktformulars der
// Homepage (siehe dort) -- im Betreiber-Buendel gaebe es dafuer nie einen
// Wert, und ein dauerhaft unersetzter Platzhalter in einer mitgelieferten
// Datei ist genau der Zustand, den test_deploy.mjs abweist. Die paar
// Zeilen hier zu verdoppeln ist kleiner als eine Ausnahme dafuer zu
// pflegen. (Der Platzhaltername steht bewusst NICHT woertlich in diesem
// Kommentar -- sonst faende ihn derselbe Scanner genau hier.)
const DEMO_ZUGANG_MAX_FIRMA  = 120;
const DEMO_ZUGANG_MAX_NAME   = 120;
const DEMO_ZUGANG_MAX_EMAIL  = 200;
const DEMO_ZUGANG_FALLE      = 'website';

function demo_zugang_ist_falle(array $in): bool
{
    return trim((string)($in[DEMO_ZUGANG_FALLE] ?? '')) !== '';
}

function demo_zugang_einzeilig(mixed $wert, int $max): string
{
    $s = preg_replace('/[\r\n\t]+/', ' ', (string)$wert) ?? '';
    return mb_substr(trim($s), 0, $max);
}

// Laufzeit eines Demo-Zugangs. Als Konstante und nicht als Einstellung:
// Konfigurierbarkeit ist kein Qualitaetsmerkmal, solange niemand eine
// andere Laufzeit braucht (Optimierungsziel, CLAUDE.md Teil B).
const DEMO_ZUGANG_TAGE = 14;

// Die Plaetze des Vorrats. Zehn zum Start (ENT-603 -- ENT-600 nannte drei,
// bevor sich zeigte, dass eine zehnfach groessere Datenbank-Kapazitaet bei
// Hostpoint zwei Franken im Monat kostet). Die Namen entsprechen der
// Subdomain unter guardops.ch und damit der `subdomain`-Spalte der
// `mandant`-Zeile, ueber die der Betreiber-Bereich die Datenbank des
// Platzes findet.
//
// FESTE LISTE UND KEINE ZAEHLSCHLEIFE ("demo" . $i): Ein elfter Platz
// entsteht nicht dadurch, dass jemand eine Zahl hochsetzt -- er braucht
// eine Datenbank, ein Deploy-Buendel und ein Geheimnis. Eine Liste, die
// man erweitern MUSS, zwingt zu dem Blick auf das, was sonst noch fehlt.
const DEMO_PLAETZE = [
    'demo1', 'demo2', 'demo3', 'demo4', 'demo5',
    'demo6', 'demo7', 'demo8', 'demo9', 'demo10',
];

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

// Die Lage des Zeitgeber-Schluessels fuer den Ablauf (ENT-600).
//
// EIGENE FUNKTION UND EIGENER PLATZHALTERNAME, obwohl demo_reset.php eine
// fast gleiche hat: Jene prueft "__DEMO_RESET"-Platzhalter und gilt nur in
// der Demo-Umgebung. Der Ablauf laeuft dagegen auf Produktion, wo der
// Betreiber-Bereich mit dem Register steht. Ein gemeinsamer Schluessel
// oeffnete je nach Umgebung etwas anderes.
//
// KEIN FREMDER PLATZHALTERNAME IM KLARTEXT in dieser Datei: Sie geht in
// drei Buendel mit, und der Bau weist jeden Platzhalter ab, der dort nicht
// ersetzt wird (derselbe Fall wie bei demo_reset.php und mailer.php).
// Darum wird der erwartete Wert hereingereicht, nicht hier gebildet.
//
// hash_equals und kein "===": Ein Vergleich, der beim ersten falschen
// Zeichen abbricht, verraet ueber die Zeit, wie weit man richtig lag.
function demo_ablauf_zeitgeber_lage(string $erwartet, string $mitgegeben): string
{
    if ($erwartet === '' || str_starts_with($erwartet, '__DEMO_ABLAUF')) {
        return 'nicht_eingerichtet';
    }
    if ($mitgegeben === '') { return 'kein_schluessel_in_der_adresse'; }
    return hash_equals($erwartet, $mitgegeben) ? 'ok' : 'falscher_schluessel';
}

// Adresse eines Platzes. Aus der festen Basis und dem Platznamen gebaut,
// nie aus $_SERVER['HTTP_HOST'] (ENT-501): Der Betreiber-Bereich verschickt
// hier einen Link auf eine FREMDE Instanz, und der Kopf der eingehenden
// Anfrage gehoert dem Aufrufer, nicht uns. Ein untergeschobener Host
// stuende sonst in der Mail an den Interessenten.
const DEMO_ADRESSE_BASIS = 'guardops.ch';

function demo_platz_adresse(string $platz): ?string
{
    if (!in_array($platz, DEMO_PLAETZE, true)) { return null; }
    return 'https://' . $platz . '.' . DEMO_ADRESSE_BASIS;
}

// Ein Passwort, das jemand aus einer E-Mail abtippt.
//
// OHNE VERWECHSELBARE ZEICHEN: 0 und O, 1 und l und I sehen in vielen
// Schriften gleich aus. Wer sie drin laesst, baut sich Support-Anrufe --
// und der Anrufer haelt dann sich selbst fuer den Fehler.
// Der Vorrat ist damit 54 Zeichen gross; bei 12 Stellen sind das rund
// 69 Bit, deutlich mehr als jedes Passwort, das sich ein Mensch ausdenkt.
//
// random_int und nicht rand(): Das hier ist ein Zugangsschluessel, kein
// Wuerfelwurf. random_int zieht aus der Zufallsquelle des Systems.
const DEMO_PASSWORT_ZEICHEN = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function demo_passwort_erzeugen(int $laenge = 12): string
{
    $vorrat = DEMO_PASSWORT_ZEICHEN;
    $max = strlen($vorrat) - 1;
    $aus = '';
    for ($i = 0; $i < $laenge; $i++) { $aus .= $vorrat[random_int(0, $max)]; }
    return $aus;
}

// Die Mail an den Interessenten. Als reine Funktion, damit ihr Inhalt
// pruefbar ist, ohne etwas zu verschicken.
//
// DREI SACHEN MUESSEN DRINSTEHEN, und jede aus einem eigenen Grund:
//   - Adresse, Anmeldename und Passwort: ohne sie ist die Mail nutzlos.
//   - Das Ablaufdatum: Wer nicht weiss, dass die Zeit laeuft, meldet sich
//     am 15. Tag und haelt den Zugang fuer kaputt.
//   - Der Hinweis auf echte Personendaten: Die Instanz wird beim Ablauf
//     restlos geleert, und bis dahin liegt hier fremdes Personal in einer
//     fremden Datenbank (ENT-600).
function demo_zugang_mail(string $firma, string $person, string $adresse,
                          string $login, string $passwort, string $laeuftAbAm): array
{
    $ab = date('d.m.Y', strtotime($laeuftAbAm));
    $betreff = 'Ihr Demo-Zugang zu GuardOpS';

    $text = "Guten Tag $person\n\n"
          . "Ihr Demo-Zugang für $firma steht bereit.\n\n"
          . "Adresse:      $adresse\n"
          . "Anmeldename:  $login\n"
          . "Passwort:     $passwort\n\n"
          . "Der Zugang läuft am $ab ab. Danach wird er gesperrt und alles, "
          . "was Sie erfasst haben, vollständig gelöscht.\n\n"
          . "Bitte erfassen Sie keine echten Personendaten — die Demo ist zum "
          . "Ausprobieren da, nicht für den Betrieb.\n\n"
          . "Freundliche Grüsse\npzu consulting gmbh";

    $e = static fn (string $w): string => htmlspecialchars($w, ENT_QUOTES, 'UTF-8');
    $html = '<p>Guten Tag ' . $e($person) . '</p>'
          . '<p>Ihr Demo-Zugang für <b>' . $e($firma) . '</b> steht bereit.</p>'
          . '<table cellpadding="4"><tr><td>Adresse</td><td><a href="' . $e($adresse) . '">'
          . $e($adresse) . '</a></td></tr>'
          . '<tr><td>Anmeldename</td><td><b>' . $e($login) . '</b></td></tr>'
          . '<tr><td>Passwort</td><td><b>' . $e($passwort) . '</b></td></tr></table>'
          . '<p>Der Zugang läuft am <b>' . $e($ab) . '</b> ab. Danach wird er gesperrt und '
          . 'alles, was Sie erfasst haben, vollständig gelöscht.</p>'
          . '<p>Bitte erfassen Sie keine echten Personendaten — die Demo ist zum '
          . 'Ausprobieren da, nicht für den Betrieb.</p>'
          . '<p>Freundliche Grüsse<br>pzu consulting gmbh</p>';

    return ['betreff' => $betreff, 'text' => $text, 'html' => $html];
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
