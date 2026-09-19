<?php
declare(strict_types=1);
// Die Mailgestaltung und die Signaturwerte kommen von woanders und
// werden darum hier selbst geladen, statt sie vom Aufrufer zu erwarten.
// Ein stiller Vertrag genau dieser Art hat am 2026-09-18 den
// oeffentlichen Demo-Zugang sieben Anlaeufe lang blockiert
// (demo_reset.php/system_rollen(), siehe test_ladepfad.mjs).
require_once __DIR__ . '/mail_vorlage.php';
require_once __DIR__ . '/mailer.php';
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
// SEIT ENT-601/ENT-613 ZUSAETZLICH: Die Zuteilung eines Platzes laeuft
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
// EIN TEXT FUER JEDEN FALL (ENT-624): Er passt auf die neue Anfrage, auf
// die bereits bekannte Adresse und auf den Honigtopf. Stuende hier, was
// wirklich geschah, liesse sich am Formular durchprobieren, welche
// Adressen einen Zugang haben.
const DEMO_ANFORDERN_DANKE = 'Vielen Dank. Wir haben Ihnen eine E-Mail geschickt — '
    . 'bitte folgen Sie den Anweisungen darin.';

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
const DEMO_ZUGANG_MAX_FIRMA    = 120;
const DEMO_ZUGANG_MAX_NAME     = 120;
const DEMO_ZUGANG_MAX_EMAIL    = 200;
const DEMO_ZUGANG_MAX_TELEFON  = 40;
const DEMO_ZUGANG_FALLE        = 'website';
// Telefon ist der Preis fuer den Sofort-Zugang (Entscheidung des
// Projektinhabers): Wer in einer Minute eine eigene Instanz bekommt, gibt
// dafuer eine erreichbare Nummer an. Wie eine solche Nummer aussieht,
// steht bei demo_zugang_telefon_gueltig() weiter unten.

function demo_zugang_ist_falle(array $in): bool
{
    return trim((string)($in[DEMO_ZUGANG_FALLE] ?? '')) !== '';
}

function demo_zugang_einzeilig(mixed $wert, int $max): string
{
    $s = preg_replace('/[\r\n\t]+/', ' ', (string)$wert) ?? '';
    return mb_substr(trim($s), 0, $max);
}

// Ziffern zaehlen allein reicht nicht: "123456789" hat neun Ziffern und ist
// trotzdem keine Nummer, unter der jemand erreichbar ist (Befund des
// Projektinhabers, 2026-09-18). Geprueft wird darum die Form der Nummer.
//
// ZUGELASSEN SIND DREI LAENDER -- Schweiz, Deutschland, Oesterreich
// (Entscheidung des Projektinhabers, 2026-09-18). Alles andere braucht
// eine eigene Entscheidung, keine stille Lockerung hier.
//
//   Schweiz       +41 / 0041 + neun Ziffern, die erste davon 2-9
//                 (0 und 1 sind Vorwahl- und Kurznummernraum, keine
//                 Anschlussbereiche), oder national mit fuehrender Null:
//                 079 123 45 67 -- genau zehn Ziffern.
//   Deutschland   +49 / 0049 + sechs bis dreizehn Ziffern, die erste
//                 nicht 0 (die nationale Verkehrsausscheidungsziffer
//                 faellt mit der Landesvorwahl weg). Laengen sind dort
//                 nicht einheitlich festgelegt.
//   Oesterreich   +43 / 0043 + vier bis dreizehn Ziffern, dieselbe Regel.
//                 Vier ist keine Schludrigkeit: Wien ist "1" plus sieben
//                 Ziffern, kleine Ortsnetze sind kuerzer.
//
// OHNE LANDESVORWAHL GILT DIE SCHWEIZ: Eine fuehrende Null ist in allen
// drei Laendern dieselbe Ziffer -- 079... koennte ueberall stehen. Die
// Betreiberin sitzt in der Schweiz, also wird die nationale Schreibweise
// als schweizerisch gelesen. Wer eine deutsche oder oesterreichische
// Nummer angibt, schreibt die Vorwahl dazu; die Meldung im Formular sagt
// das auch.
//
// Trennzeichen -- Leerschlag, Schraegstrich, Bindestrich, Punkt, Klammern
// -- sind dem Menschen ueberlassen und werden vorher entfernt.
function demo_zugang_telefon_gueltig(string $wert): bool
{
    $roh = (string)preg_replace('/[\s\/\-\.\(\)]+/u', '', $wert);
    $muster = [
        '/^(?:\+41|0041)[2-9]\d{8}$/',   // Schweiz, international
        '/^(?:\+49|0049)[1-9]\d{5,12}$/', // Deutschland
        '/^(?:\+43|0043)[1-9]\d{3,12}$/', // Oesterreich
        '/^0[2-9]\d{8}$/',               // Schweiz, national
    ];
    foreach ($muster as $m) {
        if (preg_match($m, $roh) === 1) {
            return true;
        }
    }
    return false;
}

// ── Ist die angegebene Adresse ueberhaupt zustellbar? ─────────────────
//
// DIESELBE ABSICHERUNG WIE BEIM KONTAKTFORMULAR (demo_anfrage.php,
// Anlass: der Projektinhaber hat am 2026-09-14 absichtlich "info@test.cha"
// eingegeben und die Anfrage ging durch) -- hier sogar wichtiger, weil eine
// Anfrage nicht nur eine E-Mail auslöst, sondern SOFORT einen von zehn
// knappen Demo-Plätzen verbraucht. Eine Adresse, die es nicht gibt, wuerde
// einen Platz binden, den niemand je abholt.
//
// true = zustellbar, false = diese Domain gibt es nicht,
// null = nicht pruefbar (Namensdienst gestoert oder abgeschaltet) -- und
// NULL WIRD DURCHGELASSEN, nicht abgewiesen: "unbekannt" ist etwas anderes
// als "keine" (Hausregel), und im Zweifel soll ein echter Interessent nicht
// an einer gestoerten DNS-Abfrage scheitern.
function demo_zugang_domain(string $email): string
{
    $pos = strrpos($email, '@');
    return $pos === false ? '' : substr($email, $pos + 1);
}

function demo_zugang_hat_mailserver(string $domain): bool
{
    return checkdnsrr($domain, 'MX') || checkdnsrr($domain, 'A') || checkdnsrr($domain, 'AAAA');
}

const DEMO_ZUGANG_KONTROLL_DOMAIN = 'guardops.ch';

function demo_zugang_adresse_zustellbar(string $email, ?callable $nachschlag = null): ?bool
{
    if ($nachschlag === null) {
        if (!function_exists('checkdnsrr')) { return null; }
        $nachschlag = 'demo_zugang_hat_mailserver';
    }
    $domain = demo_zugang_domain($email);
    if ($domain === '') { return false; }
    if ($nachschlag($domain)) { return true; }
    return $nachschlag(DEMO_ZUGANG_KONTROLL_DOMAIN) ? false : null;
}

// Laufzeit eines Demo-Zugangs. Als Konstante und nicht als Einstellung:
// Konfigurierbarkeit ist kein Qualitaetsmerkmal, solange niemand eine
// andere Laufzeit braucht (Optimierungsziel, CLAUDE.md Teil B).
const DEMO_ZUGANG_TAGE = 14;

// Die Plaetze des Vorrats. Zehn zum Start (ENT-613 -- ENT-600 nannte drei,
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

    $zeilen = mail_signatur_zeilen();
    $gruss  = $zeilen === [] ? ['pzu consulting gmbh'] : $zeilen;
    // Die Kennung nur setzen, wenn es das Bild wirklich gibt -- ein
    // cid-Verweis ins Leere zeigt im Mailprogramm ein zerbrochenes Bild.
    // Zwei Fassungen: die dunkle fuer den hellen Modus, die helle fuer den
    // Dunkelmodus (ENT-619). Fehlt eine, faellt nur sie weg.
    $logo     = mail_logo();
    $logoHell = mail_logo_hell();
    $kennung     = $logo === null ? '' : (string)$logo['cid'];
    $kennungHell = $logoHell === null ? '' : (string)$logoHell['cid'];
    $bilder = array_values(array_filter([$logo, $logoHell]));

    $text = "Guten Tag $person\n\n"
          . "vielen Dank für Ihr Interesse an GuardOpS, der Betriebssoftware für "
          . "Sicherheitsdienste. Mit den folgenden Zugangsdaten können Sie sich im "
          . "Demobereich anmelden:\n\n"
          . "Adresse:      $adresse\n"
          . "Anmeldename:  $login\n"
          . "Passwort:     $passwort\n\n"
          . "Ihr Demozugang ist bis am $ab aktiv. Danach wird er automatisch "
          . "zurückgesetzt und die erfassten Daten werden gelöscht.\n\n"
          . "Die Demo ist zum Ausprobieren da. Bitte erfassen Sie darin keine "
          . "echten Personendaten.\n\n"
          . "Bei Fragen oder Unklarheiten melden Sie sich jederzeit bei uns.\n\n"
          . "Mit freundlichen Grüssen\n" . implode("\n", $gruss);

    $inhalt = mail_absatz('Guten Tag ' . mail_e($person))
        . mail_absatz('vielen Dank für Ihr Interesse an GuardOpS, der Betriebssoftware für '
            . 'Sicherheitsdienste. Mit den folgenden Zugangsdaten können Sie sich für '
            . '<b>' . mail_e($firma) . '</b> im Demobereich anmelden:')
        . mail_block(
            mail_feld('Adresse', '<a href="' . mail_e($adresse) . '" style="color:'
                . MAIL_FARBE_BLAU . ';text-decoration:none;">' . mail_e($adresse) . '</a>')
            . mail_feld('Anmeldename', mail_e($login), true)
            . mail_feld('Passwort', mail_e($passwort), true))
        . mail_absatz('Ihr Demozugang ist bis am <b>' . mail_e($ab) . '</b> aktiv. Danach wird '
            . 'er automatisch zurückgesetzt und die erfassten Daten werden gelöscht.')
        . mail_absatz('Die Demo ist zum Ausprobieren da. Bitte erfassen Sie darin keine '
            . 'echten Personendaten.')
        . mail_absatz('Bei Fragen oder Unklarheiten melden Sie sich jederzeit bei uns.')
        . mail_signatur($zeilen, $kennung, $kennungHell);

    return ['betreff' => $betreff, 'text' => $text, 'html' => mail_rahmen($inhalt),
        'bilder' => $bilder];
}

// Die Mail, wenn sich eine BEKANNTE Adresse ein zweites Mal meldet
// (ENT-623). Kein neuer Zugang -- den gab es auch vorher nicht, das ist
// die Sperre aus ENT-601 --, aber bis hierher kam dieselbe Mail wie beim
// ersten Mal heraus. Sie sah aus wie ein zweiter Zugang, und der
// Projektinhaber hat genau das am 2026-09-19 beanstandet.
//
// SIE TRAEGT TROTZDEM EIN PASSWORT. Ein Interessent, der die erste Mail
// geloescht hat, haette sonst keinen Weg zurueck: "Zugangsdaten erneut
// senden" gibt es als Endpunkt, aber auf keiner Seite als Bedienelement.
// Ihn vierzehn Tage auszusperren waere teurer als die Mail.
//
// UND SIE SAGT, DASS DIE ALTEN ZUGANGSDATEN NICHT MEHR GELTEN.
// demo_zugang_neues_passwort() wirft die bestehenden Sitzungen weg; wer
// das nicht erfaehrt, haelt den Zugang fuer kaputt.
function demo_zugang_bekannt_mail(string $firma, string $person, string $adresse,
                                  string $login, string $passwort, string $laeuftAbAm): array
{
    $ab = date('d.m.Y', strtotime($laeuftAbAm));
    $betreff = 'Ihr Demo-Zugang besteht bereits';

    $zeilen = mail_signatur_zeilen();
    $gruss  = $zeilen === [] ? ['pzu consulting gmbh'] : $zeilen;
    $logo     = mail_logo();
    $logoHell = mail_logo_hell();
    $kennung     = $logo === null ? '' : (string)$logo['cid'];
    $kennungHell = $logoHell === null ? '' : (string)$logoHell['cid'];
    $bilder = array_values(array_filter([$logo, $logoHell]));

    $text = "Guten Tag $person\n\n"
          . "für Ihre E-Mail-Adresse besteht bereits ein Demo-Zugang zu GuardOpS. "
          . "Ein zweiter wird nicht angelegt — Ihr bisheriger läuft weiter, "
          . "bis am $ab.\n\n"
          . "Damit Sie sofort wieder hineinkommen, haben wir das Passwort neu "
          . "gesetzt:\n\n"
          . "Adresse:      $adresse\n"
          . "Anmeldename:  $login\n"
          . "Passwort:     $passwort\n\n"
          . "Das bisherige Passwort gilt damit nicht mehr, und offene Anmeldungen "
          . "wurden beendet. Was Sie im Demobereich bereits erfasst haben, bleibt "
          . "unverändert.\n\n"
          . "Bei Fragen oder Unklarheiten melden Sie sich jederzeit bei uns.\n\n"
          . "Mit freundlichen Grüssen\n" . implode("\n", $gruss);

    $inhalt = mail_absatz('Guten Tag ' . mail_e($person))
        . mail_absatz('für Ihre E-Mail-Adresse besteht bereits ein Demo-Zugang zu GuardOpS. '
            . 'Ein zweiter wird nicht angelegt — Ihr bisheriger läuft weiter, bis am '
            . '<b>' . mail_e($ab) . '</b>.')
        . mail_absatz('Damit Sie sofort wieder hineinkommen, haben wir das Passwort neu gesetzt:')
        . mail_block(
            mail_feld('Adresse', '<a href="' . mail_e($adresse) . '" style="color:'
                . MAIL_FARBE_BLAU . ';text-decoration:none;">' . mail_e($adresse) . '</a>')
            . mail_feld('Anmeldename', mail_e($login), true)
            . mail_feld('Passwort', mail_e($passwort), true))
        . mail_absatz('Das bisherige Passwort gilt damit nicht mehr, und offene Anmeldungen '
            . 'wurden beendet. Was Sie im Demobereich bereits erfasst haben, bleibt '
            . 'unverändert.')
        . mail_absatz('Bei Fragen oder Unklarheiten melden Sie sich jederzeit bei uns.')
        . mail_signatur($zeilen, $kennung, $kennungHell);

    return ['betreff' => $betreff, 'text' => $text, 'html' => mail_rahmen($inhalt),
        'bilder' => $bilder];
}

// ══ Meldungen an den Betreiber (ENT-622) ═══════════════════════════════
//
// Bis hierher lief die Selbstbedienung vollstaendig an uns vorbei: Der
// Interessent bekommt seinen Zugang, das Register bekommt eine Zeile, und
// wer nicht von sich aus in den Betreiber-Bereich sieht, erfaehrt nichts.
// Zwei Ereignisse sind meldenswert, und nur zwei:
//
//   1. EIN NEUER ZUGANG. Eine Verkaufschance, bei der jemand nachfassen
//      soll -- darum traegt das Register seit ENT-622 auch, OB jemand das
//      getan hat.
//   2. DER VORRAT IST LEER. Ein Interessent wurde abgewiesen, weil kein
//      Platz frei war. Das ist die teurere Meldung von beiden: Sie sagt,
//      dass gerade Interessenten verloren gehen, und sie verlangt eine
//      Handlung (Plaetze freigeben oder den Vorrat vergroessern).
//
// NICHT gemeldet wird die erneute Anforderung durch eine bekannte Adresse.
// Sie legt keinen Zugang an und stellt keine Frage -- eine Meldung ohne
// Handlungsbedarf senkt die Aufmerksamkeit fuer die beiden echten.

// Der Empfaenger, aus dem Deploy -- gleiche Regel wie basis_url() (ENT-501).
//
// ZWEITE UMSETZUNG DERSELBEN PRUEFUNG, mit Absicht: Dieselbe Pruefung steht
// als demo_empfaenger_pruefen() in demo_anfrage.php. Die beiden Dateien
// liegen in VERSCHIEDENEN Buendeln -- demo_anfrage.php auf guardops.ch,
// diese hier im Betreiber-Bereich --, und der gemeinsame Ort waere
// mailer.php, die db.php nachzieht. Genau das wuerde demo_anfrage.php die
// Eigenschaft nehmen, die ihr Kopfkommentar zusagt: ein Rechenkern ohne
// Datenbank. Damit die beiden Fassungen nicht auseinanderlaufen, gleicht
// pruef_demo_zugang.php sie Eingabe fuer Eingabe gegeneinander ab.
function demo_zugang_empfaenger_pruefen(string $wert): ?string
{
    $wert = trim($wert);
    if ($wert === '' || str_contains($wert, '__DEMO_EMPFAENGER')) { return null; }
    // Kein Steuerzeichen und kein Umbruch: Die Adresse steht in einer
    // Kopfzeile, ein eingeschmuggeltes "\r\n" waere dort eine zweite.
    if (preg_match('/[\x00-\x20\x7F]/', $wert)) { return null; }
    if (filter_var($wert, FILTER_VALIDATE_EMAIL) === false) { return null; }
    return $wert;
}

function demo_zugang_empfaenger(): ?string
{
    return demo_zugang_empfaenger_pruefen('__DEMO_EMPFAENGER__');
}

// Die Meldung ueber einen neuen Zugang. Reine Funktion, damit ihr Inhalt
// pruefbar ist, ohne etwas zu verschicken -- wie demo_zugang_mail().
//
// KEIN PASSWORT DARIN. Es steht schon in der Mail an den Interessenten;
// ein zweites Mal verschickt waere es ein zweites Postfach, aus dem es
// entwischen kann, ohne dass irgendjemand etwas davon haette. Wer als
// Betreiber in die Instanz muss, hat den Not-Aus und die Datenbank.
//
// KEINE SIGNATUR UND KEIN LOGO: Das ist Hauspost, keine Geschaeftsmail.
// Ein eingebettetes Bild in jeder dieser Meldungen waere Ballast.
function demo_melde_mail(string $firma, string $person, string $email,
                         string $telefon, string $platz, string $adresse,
                         string $laeuftAbAm): array
{
    $ab = date('d.m.Y', strtotime($laeuftAbAm));
    // Die Firma gehoert in den Betreff: Wer drei Meldungen im Postfach hat,
    // soll sie auseinanderhalten koennen, ohne sie zu oeffnen.
    $betreff = 'Neuer Demo-Zugang: ' . $firma;

    $text = "Ein Interessent hat sich selbst einen Demo-Zugang geholt.\n\n"
          . "Firma:     $firma\n"
          . "Person:    $person\n"
          . "E-Mail:    $email\n"
          . "Telefon:   " . ($telefon !== '' ? $telefon : 'keine Angabe') . "\n"
          . "Platz:     $platz ($adresse)\n"
          . "Läuft ab:  $ab\n\n"
          . "Der Zugang ist bereits eingerichtet und die Zugangsdaten sind "
          . "unterwegs. Offen ist das Nachfassen: Im Betreiber-Bereich unter "
          . "Mandanten steht der Zugang als offen, bis ihn dort jemand auf "
          . "nachgefasst setzt.\n";

    $inhalt = mail_absatz('Ein Interessent hat sich selbst einen Demo-Zugang geholt.')
        . mail_block(
            mail_feld('Firma', mail_e($firma))
            . mail_feld('Person', mail_e($person))
            . mail_feld('E-Mail', '<a href="mailto:' . mail_e($email) . '" style="color:'
                . MAIL_FARBE_BLAU . ';text-decoration:none;">' . mail_e($email) . '</a>')
            . mail_feld('Telefon', $telefon !== ''
                ? mail_e($telefon)
                : '<span style="color:' . MAIL_FARBE_LEISE . '">keine Angabe</span>')
            . mail_feld('Platz', mail_e($platz . ' (' . $adresse . ')'))
            . mail_feld('Läuft ab', mail_e($ab)))
        . mail_absatz('Der Zugang ist bereits eingerichtet und die Zugangsdaten sind '
            . 'unterwegs. Offen ist das Nachfassen: Im Betreiber-Bereich unter '
            . '<b>Mandanten</b> steht der Zugang als offen, bis ihn dort jemand auf '
            . 'nachgefasst setzt.');

    return ['betreff' => $betreff, 'text' => $text, 'html' => mail_rahmen($inhalt),
        'bilder' => []];
}

// Die Meldung, wenn sich eine bekannte Adresse ein zweites Mal meldet
// (ENT-623). ENT-622 hatte diesen Fall bewusst ausgenommen -- eine Meldung
// ohne Handlungsbedarf senke die Aufmerksamkeit fuer die anderen. Die
// Praxis hat dagegen gesprochen: Beim Testen liess sich nicht
// unterscheiden, ob die Meldungen ueberhaupt gehen oder ob es nichts zu
// melden gab. Dazu ist ein Interessent, der sich ein zweites Mal meldet,
// selbst ein Signal.
//
// EIGENER BETREFF, damit sie sich im Postfach von einer echten
// Neuanmeldung unterscheiden laesst, ohne sie zu oeffnen.
function demo_erneut_mail(string $firma, string $person, string $email,
                          string $telefon, string $platz, string $adresse,
                          string $laeuftAbAm): array
{
    $ab = date('d.m.Y', strtotime($laeuftAbAm));
    $betreff = 'Erneute Anfrage: ' . $firma;

    $text = "Eine bereits bekannte Adresse hat sich ein zweites Mal gemeldet.\n\n"
          . "Firma:     $firma\n"
          . "Person:    $person\n"
          . "E-Mail:    $email\n"
          . "Telefon:   " . ($telefon !== '' ? $telefon : 'keine Angabe') . "\n"
          . "Platz:     $platz ($adresse)\n"
          . "Läuft ab:  $ab\n\n"
          . "Es wurde KEIN neuer Zugang angelegt und kein weiterer Platz belegt. "
          . "Der bestehende Zugang hat ein neues Passwort bekommen, und der "
          . "Interessent weiss, dass sein Zugang schon besteht.\n\n"
          . "Wer sich ein zweites Mal meldet, hat entweder die erste Mail verloren "
          . "oder es sich anders überlegt. Beides ist ein Anlass, ihn anzurufen.\n";

    $inhalt = mail_absatz('Eine bereits bekannte Adresse hat sich ein zweites Mal gemeldet.')
        . mail_block(
            mail_feld('Firma', mail_e($firma))
            . mail_feld('Person', mail_e($person))
            . mail_feld('E-Mail', '<a href="mailto:' . mail_e($email) . '" style="color:'
                . MAIL_FARBE_BLAU . ';text-decoration:none;">' . mail_e($email) . '</a>')
            . mail_feld('Telefon', $telefon !== ''
                ? mail_e($telefon)
                : '<span style="color:' . MAIL_FARBE_LEISE . '">keine Angabe</span>')
            . mail_feld('Platz', mail_e($platz . ' (' . $adresse . ')'))
            . mail_feld('Läuft ab', mail_e($ab)))
        . mail_absatz('Es wurde <b>kein</b> neuer Zugang angelegt und kein weiterer Platz '
            . 'belegt. Der bestehende Zugang hat ein neues Passwort bekommen, und der '
            . 'Interessent weiss, dass sein Zugang schon besteht.')
        . mail_absatz('Wer sich ein zweites Mal meldet, hat entweder die erste Mail verloren '
            . 'oder es sich anders überlegt. Beides ist ein Anlass, ihn anzurufen.');

    return ['betreff' => $betreff, 'text' => $text, 'html' => mail_rahmen($inhalt),
        'bilder' => []];
}

// Die Warnung, wenn kein Platz mehr frei ist.
//
// Sie nennt die Zahl der Plaetze, nicht nur "voll": Wer sie liest, soll
// entscheiden koennen, ob er zwei Zugaenge von Hand beendet oder den Vorrat
// vergroessert -- dafuer muss er wissen, wie gross er ist.
function demo_vorrat_mail(int $plaetze): array
{
    $betreff = 'Demo-Vorrat erschöpft — ein Interessent wurde abgewiesen';

    $text = "Ein Interessent wollte einen Demo-Zugang und hat keinen bekommen: "
          . "Alle $plaetze Plätze sind belegt.\n\n"
          . "Er hat die Meldung gesehen, dass gerade alle Plätze belegt sind, "
          . "und wurde gebeten, es in Kürze erneut zu versuchen. Wer ihn "
          . "war, wissen wir nicht — abgewiesen wird vor dem Register.\n\n"
          . "Im Betreiber-Bereich unter Mandanten steht, welcher Platz wann "
          . "frei wird. Abgelaufene Zugänge lassen sich dort sofort "
          . "schliessen.\n\n"
          . "Diese Warnung kommt höchstens einmal pro Stunde, egal wie viele "
          . "Anfragen in dieser Zeit abgewiesen werden.\n";

    $inhalt = mail_absatz('<b>Ein Interessent wollte einen Demo-Zugang und hat keinen '
            . 'bekommen:</b> Alle ' . $plaetze . ' Plätze sind belegt.')
        . mail_absatz('Er hat die Meldung gesehen, dass gerade alle Plätze belegt sind, '
            . 'und wurde gebeten, es in Kürze erneut zu versuchen. Wer er war, wissen '
            . 'wir nicht — abgewiesen wird vor dem Register.')
        . mail_absatz('Im Betreiber-Bereich unter <b>Mandanten</b> steht, welcher Platz '
            . 'wann frei wird. Abgelaufene Zugänge lassen sich dort sofort schliessen.')
        . mail_absatz('<span style="color:' . MAIL_FARBE_LEISE . '">Diese Warnung kommt '
            . 'höchstens einmal pro Stunde, egal wie viele Anfragen in dieser Zeit '
            . 'abgewiesen werden.</span>');

    return ['betreff' => $betreff, 'text' => $text, 'html' => mail_rahmen($inhalt),
        'bilder' => []];
}

// ── Die Bremse fuer die Warnung ───────────────────────────────────────
//
// Ist der Vorrat leer, ist er es fuer JEDE Anfrage in dieser Zeit. Ohne
// Bremse waeren fuenfzig abgewiesene Interessenten fuenfzig gleichlautende
// Mails -- und das Postfach, das die Warnung lesen soll, waere genau dann
// unbrauchbar, wenn die Warnung zaehlt.
//
// SIE FAELLT AUF, NICHT ZU -- anders herum als demo_bremse.php, und aus dem
// umgekehrten Grund: Dort schuetzt die Bremse vor Missbrauch, ein
// unlesbarer Zaehler muss also sperren. Hier schuetzt sie nur vor
// Doppelpost. Kann der Vermerk nicht gelesen oder geschrieben werden, geht
// die Warnung raus. Eine Mail zu viel ist harmlos, eine verpasste Warnung
// kostet Interessenten.
const DEMO_WARNUNG_PAUSE_MIN = 60;

// Die Entscheidung, ohne Dateizugriff -- damit sie sich echt ausfuehren
// laesst. Gleiche Trennung wie bei demo_bremse_entscheiden().
function demo_warnung_faellig(?int $letzte, int $jetzt): bool
{
    if ($letzte === null) { return true; }
    // Ein Vermerk aus der Zukunft (verstellte Uhr, kopierte Datei) darf die
    // Warnung nicht auf Dauer stilllegen.
    if ($letzte > $jetzt) { return true; }
    return ($jetzt - $letzte) >= DEMO_WARNUNG_PAUSE_MIN * 60;
}

function demo_warnung_datei(): string
{
    return sys_get_temp_dir() . '/guardops-demo-vorrat-warnung.txt';
}

// Liest den Vermerk, entscheidet und traegt sich ein, wenn die Warnung
// faellig ist. Jeder Fehlschlag laesst sie durch -- siehe oben.
function demo_warnung_faellig_und_vermerken(?string $datei = null, ?int $jetzt = null): bool
{
    $datei ??= demo_warnung_datei();
    $jetzt ??= time();

    $letzte = null;
    if (is_file($datei)) {
        $roh = @file_get_contents($datei);
        if ($roh !== false && trim($roh) !== '' && ctype_digit(trim($roh))) {
            $letzte = (int)trim($roh);
        }
    }
    if (!demo_warnung_faellig($letzte, $jetzt)) { return false; }
    @file_put_contents($datei, (string)$jetzt, LOCK_EX);
    return true;
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
  -- Der Preis fuer den Sofort-Zugang (ENT-601/ENT-613, Entscheidung des
  -- Projektinhabers): Wer die Instanz in einer Minute bekommt, hinterlaesst
  -- eine erreichbare Nummer. Fuer den Vertrieb, nicht fuer den Zugang
  -- selbst -- eine leere Zeichenkette bei aelteren Zeilen ist kein Fehler.
  telefon VARCHAR(40) NOT NULL DEFAULT '',
  login VARCHAR(100) NOT NULL,
  status ENUM('aktiv','abgelaufen','beendet') NOT NULL DEFAULT 'aktiv',
  freigegeben_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  freigegeben_von VARCHAR(200) NOT NULL DEFAULT '',
  laeuft_ab_am DATETIME NOT NULL,
  beendet_am DATETIME NULL,
  -- Hat bei diesem Interessenten schon jemand nachgefasst (ENT-622)?
  -- NULL heisst „noch nicht“, nicht „nein“ -- der Unterschied traegt das
  -- Abzeichen am Reiter im Betreiber-Bereich. Ein Datum von null waere
  -- die Behauptung, es sei am 1.1.1970 erledigt worden.
  nachgefasst_am DATETIME NULL,
  nachgefasst_von VARCHAR(200) NOT NULL DEFAULT '',
  -- Ein Platz traegt hoechstens einen aktiven Zugang. Der Index ist nicht
  -- nur fuer die Geschwindigkeit da: Er ist die Spur, auf der die Suche
  -- nach dem freien Platz laeuft.
  KEY idx_demo_zugang_platz (platz, status),
  KEY idx_demo_zugang_ablauf (status, laeuft_ab_am),
  KEY idx_demo_zugang_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
}
