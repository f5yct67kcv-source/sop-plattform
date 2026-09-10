<?php
declare(strict_types=1);
// Bremse gegen Passwort-Raten (ENT-075).
//
// Bis hierher durfte jemand unbegrenzt oft und beliebig schnell raten.
// Zusammen mit einer Mindestlaenge von sechs Zeichen war das die
// gefaehrlichste Kombination der Sicherheitspruefung.
//
// ZWEI GRENZEN, weil ein Angreifer sonst einfach ausweicht:
//   - je Login-Name: wer EIN Konto knacken will, wird gebremst.
//   - je Absender-Adresse: wer viele Namen durchprobiert, auch.
//
// DIE BREMSE DARF NICHT SELBST ZUR WAFFE WERDEN. Wer einen Login-Namen
// kennt, koennte ihn sonst dauerhaft aussperren. Darum: zeitlich begrenzt,
// nie dauerhaft, und die Sperre laeuft von selbst ab.
//
// Und sie darf nicht verraten, ob es den Namen gibt: Die Meldung ist
// dieselbe wie bei falschem Passwort, nur um den Hinweis auf die Wartezeit
// ergaenzt -- und die gibt es fuer einen erfundenen Namen genauso.

const ANMELD_FENSTER_MIN  = 15;   // Zeitraum, in dem Fehlversuche zaehlen
const ANMELD_MAX_NAME     = 5;    // Fehlversuche je Login-Name im Fenster
const ANMELD_MAX_ADRESSE  = 20;   // Fehlversuche je Absender-Adresse im Fenster
const ANMELD_SPERRE_MIN   = 15;   // wie lange danach gesperrt wird

// Absender-Adresse. Hostpoint liefert sie in REMOTE_ADDR; die weitergegebenen
// Kopfzeilen (X-Forwarded-For) werden BEWUSST nicht benutzt -- die kann ein
// Angreifer frei setzen und damit die Bremse je Adresse umgehen.
function anmeld_adresse(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? 'unbekannt'), 0, 45);
}

// Fehlt die Tabelle, gibt es keine Bremse -- und das ist der gefaehrlichste
// Zustand dieser Datei (ENT-501).
//
// ANLASS: Die Sicherheitspruefung vom 2026-09-09. Ohne die Tabelle liefert
// anmeld_zaehlen() [0, 0], anmeld_fehlversuch() tut nichts, und
// anmeld_sperre(0, 0) ist 0 -- also FREI. Der Schutz gegen Passwort-Raten
// ist dann vollstaendig aus, und an der Oberflaeche ist davon nichts zu
// sehen. Die Tabelle steht nicht in schema.sql (das ist mit ENT-501
// nachgeholt), sondern entstand bis dahin erst beim Einrichtungslauf: Eine
// frische Datenbank, eine wiederhergestellte Sicherung oder eine neue
// Staging-Instanz lief also ungebremst.
//
// Das verstoesst gegen zwei Hausregeln auf einmal -- fail-safe (das
// Versehen faellt hier auf die UNSICHERE Seite) und "«unbekannt» darf nie
// wie «keine» aussehen": "Tabelle fehlt" sah exakt aus wie "keine
// Fehlversuche".
//
// Warum trotzdem nicht abgewiesen wird: Eine Anmeldung zu verweigern, weil
// eine Hilfstabelle fehlt, sperrte den ganzen Betrieb aus seinem eigenen
// Werkzeug aus -- und zwar in genau dem Moment, in dem jemand eine
// Sicherung zurueckgespielt hat und dringend hineinmuss. Der Ausfall wird
// darum LAUT, aber er haelt niemanden auf. Sichtbar wird er im
// Serverprotokoll; einmal je Prozess, damit ein Anmeldesturm es nicht
// zuschuettet.
function hat_tabelle_anmeldung(PDO $pdo): bool
{
    static $da = null;
    if ($da === null) {
        $da = (bool)$pdo->query("SHOW TABLES LIKE 'anmeldeversuche'")->fetchColumn();
        if (!$da) {
            error_log('SICHERHEIT: Tabelle "anmeldeversuche" fehlt — die Bremse gegen '
                . 'Passwort-Raten ist AUSSER BETRIEB. Im Cockpit unten links '
                . '„Einrichtung" ausfuehren.');
        }
    }
    return $da;
}

// Die Entscheidung als eigene Funktion, damit sie sich OHNE Datenbank
// ausfuehren laesst -- die Browser-Pruefungen kaemen hier nie vorbei.
// Gibt die Sperrdauer in Minuten zurueck, 0 = frei.
function anmeld_sperre(int $fehlerName, int $fehlerAdresse): int
{
    if ($fehlerName >= ANMELD_MAX_NAME || $fehlerAdresse >= ANMELD_MAX_ADRESSE) {
        return ANMELD_SPERRE_MIN;
    }
    return 0;
}

// Wie viele Fehlversuche liegen im Fenster? Gibt [jeName, jeAdresse] zurueck.
function anmeld_zaehlen(PDO $pdo, string $name, string $adresse): array
{
    if (!hat_tabelle_anmeldung($pdo)) { return [0, 0]; }
    $s = $pdo->prepare(
        'SELECT
            SUM(login_name = ?) AS je_name,
            SUM(adresse = ?)    AS je_adresse
         FROM anmeldeversuche
         WHERE zeitpunkt > DATE_SUB(NOW(), INTERVAL ' . ANMELD_FENSTER_MIN . ' MINUTE)'
    );
    $s->execute([$name, $adresse]);
    $r = $s->fetch();
    return [(int)($r['je_name'] ?? 0), (int)($r['je_adresse'] ?? 0)];
}

function anmeld_fehlversuch(PDO $pdo, string $name, string $adresse): void
{
    if (!hat_tabelle_anmeldung($pdo)) { return; }
    $pdo->prepare('INSERT INTO anmeldeversuche (login_name, adresse) VALUES (?, ?)')
        ->execute([substr($name, 0, 100), $adresse]);
    // Gelegentlich aufraeumen: Die Tabelle ist ein Kurzzeitgedaechtnis und
    // soll keine Sammlung werden, wer wann von wo aus etwas versucht hat.
    if (random_int(1, 20) === 1) {
        $pdo->exec('DELETE FROM anmeldeversuche
                    WHERE zeitpunkt < DATE_SUB(NOW(), INTERVAL 1 DAY)');
    }
}

// ── Passwortregeln (ENT-075) ──────────────────────────────────────────
//
// Bis hierher genuegten sechs Zeichen. Sechs Zeichen sind in Minuten
// durchprobiert -- zusammen mit der fehlenden Bremse war das die
// gefaehrlichste Kombination der Sicherheitspruefung.
//
// LAENGE VOR ZEICHENSALAT. Kein Zwang zu Sonderzeichen und Grossbuchstaben:
// Das erzeugt "Passwort1!" und Zettel am Bildschirm. Ein langes, merkbares
// Passwort ist schwerer zu raten als ein kurzes mit Sonderzeichen -- so
// steht es auch in den Empfehlungen des Bundes.
//
// DIE REGEL GILT BEIM SETZEN, NICHT BEIM ANMELDEN. Wer ein aelteres,
// kuerzeres Passwort hat, kommt weiterhin rein; er wird nur beim naechsten
// Wechsel auf die neue Laenge verpflichtet. Sonst waeren mit dem Deploy
// schlagartig alle Konten ausgesperrt.
// ── Neu bemessen: 10 und 12 (ENT-519, 2026-09-10) ─────────────────────
//
// Die Vorgeschichte in zwei Saetzen: ENT-289 senkte beide Laengen am
// 2026-09-01 fuer die Erprobung auf 6, ENT-502 drehte sie am 2026-09-10
// auf 12 und 16 zurueck. ENT-519 setzt sie am selben Tag auf 10 und 12 --
// nicht als Rueckzug, sondern nach einer Rechnung, die vorher so nicht
// gemacht worden war.
//
// WAS DIE RECHNUNG ERGAB. Bei bcrypt mit diesen Kosten (siehe
// PASSWORT_KOSTEN) schafft ein ernsthafter Rechner rund 10'000 Versuche
// je Sekunde. Zehn Kleinbuchstaben sind damit rund 450 Jahre, zwoelf rund
// 300'000. Beide Zahlen liegen jenseits jeder Relevanz -- gegen blosses
// Durchprobieren entscheidet die Laenge hier nichts mehr. Sie entscheidet
// nur noch gegen WORTLISTEN, und dort zaehlt nicht die Zeichenzahl,
// sondern ob das Passwort aus einem bekannten Wort besteht. Genau das
// pruefen die Regeln in passwort_pruefen() weiter unten -- direkt, statt
// ueber die Laenge als Hilfsgroesse.
//
// Dazu die Bremse oben in dieser Datei: fuenf Fehlversuche je Name in 15
// Minuten. Wer von aussen raet, kommt gar nicht erst in die
// Groessenordnung, in der eine Laenge etwas entscheidet.
//
// WARUM DIE VERWALTUNG TROTZDEM MEHR BRAUCHT: Ein Verwaltungszugang
// oeffnet die ganze Personalakte -- AHV-Nummern, Aufenthaltsstatus,
// Registerdaten. Ein Mitarbeitenden-Zugang oeffnet die eigenen Schichten
// und die Kundenliste mit Adressen (kunden_list.php). Beides ist
// schuetzenswert, aber nicht gleich viel.
//
// DIE 12 STEHEN AUF EINEM VERSPRECHEN, DAS NOCH NICHT EINGELOEST IST.
// Vorgeschlagen waren 12 fuer die Verwaltung ZUSAMMEN MIT einer Pflicht
// zur Zwei-Faktor-Anmeldung; ohne sie waeren es 14 gewesen. Die Pflicht
// braucht zuerst zwei Dinge, die es nicht gibt: eine Uebersicht, wer sie
// eingeschaltet hat, und einen Ruecksetzweg fuer ein verlorenes Geraet
// (OP-520). Bis dahin gelten hier 12 OHNE Pflicht. Das ist bei einer
// Handvoll Konten vertretbar und steht ausdruecklich als Zwischenzustand
// hier, damit es niemand fuer den fertigen Tausch haelt.
//
// KEINE ZEICHENVORSCHRIFT, auch nicht als Ausgleich fuer die kuerzere
// Laenge -- die Begruendung steht bei passwort_pruefen() unten.
//
// DIE REGEL GILT BEIM SETZEN, NICHT BEIM ANMELDEN (siehe oben). Ein
// Senken sperrt niemanden aus, ein Erhoehen wirkt erst beim naechsten
// Wechsel. Fuer die BESTEHENDEN, in der Erprobung gesetzten Passwoerter
// aendert auch das hier nichts: OP-283 zweiter Teil bleibt offen, jedes
// Konto muss einmal von Hand neu gesetzt werden.
//
// Die Marke PASSWORT_ERPROBUNG bleibt ERSATZLOS WEG (so schon ENT-502).
// pruef_passwort.php verlangt ohne sie eine Untergrenze und wird rot,
// sobald jemand die Laengen darunter senkt -- der Weg zurueck steht
// offen, aber nur sichtbar.

const PASSWORT_MIN = 10;

// Fuer Verwaltungszugaenge mehr -- Begruendung und Vorbehalt oben.
const PASSWORT_MIN_ADMIN = 12;

// Wie aufwendig das Verschluesseln des Passworts ist. Jede Stufe verdoppelt
// den Aufwand -- fuer das Anmelden ein paar Hundertstelsekunden, fuer
// jemanden mit einer gestohlenen Datenbank die doppelte Rechenzeit pro
// Versuch.
//
// GEMESSEN, nicht angenommen: Neuere PHP-Fassungen setzen von sich aus
// schon 12; aeltere setzen 10. Der Wert steht hier AUSDRUECKLICH, damit er
// nicht davon abhaengt, welche PHP-Fassung auf dem Server laeuft -- sonst
// waere derselbe Code je nach Hoster verschieden gut verwahrt.
// Gemessene Dauer bei 12: rund 0,2 Sekunden je Anmeldung.
const PASSWORT_KOSTEN = 12;

// ── Blindpruefung gegen die Uhr (ENT-501) ─────────────────────────────
//
// ANLASS: Die Sicherheitspruefung vom 2026-09-09. login.php und
// portal_anmelden.php geben bei unbekanntem Namen dieselbe MELDUNG aus wie
// bei falschem Passwort -- das ist ausdrueckliche Absicht und steht in
// beiden Dateien als Begruendung. Die ANTWORTZEIT verriet es trotzdem:
//
//     if (!$user || !password_verify($password, $user['password_hash']))
//
// PHP bricht bei || ab. Gibt es das Konto nicht, wird password_verify()
// gar nicht erst gerufen und die Antwort kommt sofort; gibt es das Konto,
// dauert sie rund 0,2 Sekunden. Der Unterschied ist ueber das Netz gut
// messbar (CWE-208).
//
// Bei den Mitarbeitenden ist der Gewinn fuer einen Angreifer klein -- die
// Login-Namen folgen ohnehin dem Muster vorname.nachname. Beim
// KUNDENPORTAL wiegt es mehr: Dort verraet die Zeit, welche
// E-Mail-Adressen Kunden des Betriebs sind, und das ist eine Aussage ueber
// die Kundenliste, die von aussen sonst niemand bekommt.
//
// Der Hash unten ist ein fester, absichtlich unerreichbarer bcrypt-Wert mit
// denselben Kosten wie die echten -- er gehoert zu keinem Konto und zu
// keinem Passwort (erzeugt aus 32 Byte Zufall, der danach weggeworfen
// wurde). Er ist KEIN Geheimnis: Sein einziger Zweck ist, gleich lange zu
// rechnen wie eine echte Pruefung.
const PASSWORT_BLIND_HASH = '$2y$12$N7O0FDJdFPart9JX55ONQOcU1x7xL6dANH3OlQtldLC9jvPDy9rHy';

// Rechnet so lange wie eine echte Passwortpruefung und verwirft das
// Ergebnis. Aufzurufen genau dort, wo es KEIN Konto zu pruefen gibt.
function passwort_blindpruefung(string $eingabe): void
{
    password_verify($eingabe, PASSWORT_BLIND_HASH);
}

// Tastaturreihen und Folgen. Wer zwoelf Zeichen braucht, nimmt sonst gern
// die naechstliegende Reihe -- "qwertzuiop" ist lang und trotzdem in
// Sekunden geraten.
const PASSWORT_REIHEN = [
    'qwertzuiopue',      // Schweizer Tastatur, obere Reihe
    'asdfghjkloeae',     // mittlere Reihe
    'yxcvbnm',           // untere Reihe
    'qwertyuiop',        // englische Belegung
    'abcdefghijklmnopqrstuvwxyz',
    '01234567890',
];
const PASSWORT_FOLGE_MAX = 4;   // ab fuenf Zeichen aus einer Reihe wird abgewiesen

// Was offensichtlich zu schwach ist, auch wenn es lang genug waere.
// Kurze Liste mit Absicht: Sie soll die naheliegenden Faelle fangen, nicht
// eine Passwortpruefung ersetzen.
const PASSWORT_VERBOTEN = [
    'passwort', 'password', 'geheim', '123456', 'qwertz', 'qwerty',
    'cupi24', 'sicherheit', 'admin', 'willkommen', 'schweiz',
];

// Steckt eine Tastaturreihe oder eine Buchstaben-/Zahlenfolge darin?
// Vorwaerts wie rueckwaerts -- "poiuztrewq" ist dasselbe Muster.
function passwort_folge(string $klein): bool
{
    $laenge = mb_strlen($klein);
    for ($i = 0; $i + PASSWORT_FOLGE_MAX < $laenge; $i++) {
        $stueck = mb_substr($klein, $i, PASSWORT_FOLGE_MAX + 1);
        foreach (PASSWORT_REIHEN as $reihe) {
            if (str_contains($reihe, $stueck) || str_contains($reihe, strrev($stueck))) {
                return true;
            }
        }
    }
    return false;
}

// Ist das Passwort nur ein kurzer Block, der sich wiederholt?
// "123412341234" ist zwoelf Zeichen lang und vier Zeichen wert.
function passwort_wiederholung(string $klein): bool
{
    $laenge = mb_strlen($klein);
    for ($block = 1; $block <= intdiv($laenge, 2); $block++) {
        if ($laenge % $block !== 0) { continue; }
        if (str_repeat(mb_substr($klein, 0, $block), intdiv($laenge, $block)) === $klein) {
            return true;
        }
    }
    return false;
}

// Prueft ein NEUES Passwort. Gibt null zurueck, wenn es taugt, sonst den
// Grund im Klartext -- der Grund geht an die Oberflaeche und muss ohne
// Nachschlagen verstaendlich sein.
//
// BEWUSST KEINE ZEICHENVORSCHRIFT (kein Zwang zu Grossbuchstabe und Zahl),
// und mit ENT-519 auch dann nicht, als die Laengen sanken -- der Vorschlag
// lag ausdruecklich auf dem Tisch ("statt 16 Zeichen: zwei Grossbuchstaben,
// eine Zahl und mindestens 10").
//
// EHRLICH GERECHNET SPRICHT DIE ARITHMETIK SOGAR DAFUER: Zehn Zeichen aus
// 62 moeglichen sind rund 59 Bit, zehn Kleinbuchstaben rund 47. Auf dem
// Papier ist die Vorschrift also der Gewinner. (Der frueher hier stehende
// Vergleich "zwoelf Kleinbuchstaben gegen acht gemischte" stimmte zwar,
// beantwortete aber eine andere Frage -- 12 gegen 8, nicht 10 gegen 10.)
//
// SIE VERLIERT TROTZDEM, aus zwei Gruenden:
//   1. Eine VERLANGTE Vorschrift kennt der Angreifer auch. Sie verkleinert
//      seinen Kandidatensatz, statt ihn zu vergroessern -- alles, was der
//      Vorschrift nicht genuegt, muss er gar nicht erst probieren.
//   2. Menschen erfuellen sie fast immer gleich: Grossbuchstabe vorne,
//      Zahl oder Jahr hinten. Genau diese Umformungen sind der Inhalt der
//      Standard-Regelsaetze der Knackwerkzeuge. Der rechnerische Zugewinn
//      ist damit im Angriff nicht vorhanden.
// Deshalb raten NIST SP 800-63B ("SHALL NOT") und das BSI seit 2020
// ausdruecklich davon ab.
//
// WAS STATTDESSEN WIRKT, steht unten in dieser Funktion: kein Login-Name,
// keine Sperrliste, mindestens fuenf verschiedene Zeichen, kein
// wiederholter Block, keine Tastaturreihe. Das sind dieselben Schwaechen,
// gegen die eine Zeichenvorschrift ein Ersatz waere -- hier aber direkt
// benannt statt ueber eine Hilfsgroesse erraten.
function passwort_pruefen(string $passwort, string $loginName = '', bool $istAdmin = false): ?string
{
    $min = $istAdmin ? PASSWORT_MIN_ADMIN : PASSWORT_MIN;
    if (mb_strlen($passwort) < $min) {
        return 'Passwort mindestens ' . $min . ' Zeichen'
             . ($istAdmin ? ' für Verwaltungszugänge' : '') . '. '
             . 'Lieber eine merkbare Wortfolge als ein kurzes mit Sonderzeichen.';
    }
    $klein = mb_strtolower($passwort);
    // Der eigene Login-Name im Passwort ist das Erste, was jemand probiert.
    if ($loginName !== '' && mb_strlen($loginName) >= 3
        && str_contains($klein, mb_strtolower($loginName))) {
        return 'Das Passwort darf den Login-Namen nicht enthalten.';
    }
    foreach (PASSWORT_VERBOTEN as $wort) {
        if (str_contains($klein, $wort)) {
            return 'Das Passwort enthält ein zu naheliegendes Wort ("' . $wort . '").';
        }
    }
    // Ein einziges wiederholtes Zeichen ist lang, aber nicht schwer.
    if (count(array_unique(mb_str_split($klein))) < 5) {
        return 'Das Passwort besteht aus zu wenigen verschiedenen Zeichen.';
    }
    if (passwort_wiederholung($klein)) {
        return 'Das Passwort ist nur eine Wiederholung derselben Zeichenfolge.';
    }
    if (passwort_folge($klein)) {
        return 'Das Passwort enthält eine Tastaturreihe oder eine fortlaufende Folge '
             . '(z. B. „qwertz" oder „12345").';
    }
    return null;
}

// Nach erfolgreicher Anmeldung: die Fehlversuche dieses Namens loeschen.
// Sonst schleppt jemand, der sich einmal vertippt hat, das noch Minuten mit.
function anmeld_zuruecksetzen(PDO $pdo, string $name): void
{
    if (!hat_tabelle_anmeldung($pdo)) { return; }
    $pdo->prepare('DELETE FROM anmeldeversuche WHERE login_name = ?')->execute([$name]);
}
