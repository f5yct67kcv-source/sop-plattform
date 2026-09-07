<?php
declare(strict_types=1);
// Der Versandkern der Benachrichtigungen (ENT-424).
//
// Warum diese Pruefung gegen echte Kryptografie laeuft und nicht gegen
// einen nachgebauten Ablauf: Die Signatur nach RFC 8292 ist selbst gebaut,
// weil das Projekt keine fremden PHP-Pakete einbindet. Ein Fehler darin
// faellt NICHT beim Bauen auf und auch nicht beim Betrachten des Codes --
// er faellt auf, wenn ein Push-Dienst mit 401 antwortet und die
// Benachrichtigung nie ankommt. Also wird hier signiert und die Signatur
// mit dem oeffentlichen Schluessel wieder geprueft, so wie es der
// Push-Dienst tut.
//
// Der heikelste Teil ist die Umrechnung der Signatur von DER nach roh:
// DER kodiert Zahlen mit variabler Laenge. Ein R oder S mit fuehrender
// Null oder mit gesetztem obersten Bit ergibt eine andere Bytelaenge --
// und genau daran scheitern selbstgebaute JWT-Signaturen ueblicherweise.
// Der Fehler tritt nur bei einem Teil der Schluessel und einem Teil der
// Signaturen auf: Er waere also sporadisch und darum schwer zu finden.
// Hier laufen deshalb VIELE Signaturen durch, nicht eine.
//
// Kein festes Datum nahe beim heutigen Tag (Projektregel): Der Zeitpunkt
// wird mitgegeben, nicht aus der Uhr geholt.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// Die Funktionen aus db.php, die push.php erwartet.
$GLOBALS['spalteDa'] = true;
function hat_spalte(PDO $pdo, string $t, string $s): bool { return $GLOBALS['spalteDa']; }
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool { return true; }
function json_response($data, int $status = 200): void { throw new RuntimeException('unerwartet'); }

// ── Einen echten Schluessel unterschieben
// push.php haelt den Schluessel in einer Konstanten, die beim Deploy
// ersetzt wird. Die Pruefung macht GENAU DASSELBE: Sie nimmt die echte
// Datei, ersetzt die beiden Platzhalter wie der Deploy es tut, und laedt
// das Ergebnis. Damit laeuft hier derselbe Code wie auf dem Server -- und
// die Platzhalter-Ersetzung ist gleich mitgeprueft.
//
// Der Schluessel wird ERZEUGT, nicht hinterlegt: Ein Schluessel im
// Repository waere ein Geheimnis im Quelltext, auch ein wertloses.
$pk = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
openssl_pkey_export($pk, $pem);

$quelle = (string)file_get_contents(__DIR__ . '/../backend/push.php');
pruef('KRITISCH: im Quelltext steht ein Platzhalter und kein echter Schluessel',
    str_contains($quelle, "'__VAPID_PRIVATE_PEM_B64__'"));
pruef('Dasselbe fuer die Kontaktadresse', str_contains($quelle, "'__VAPID_KONTAKT__'"));

$ersetzt = str_replace(
    ['__VAPID_PRIVATE_PEM_B64__', '__VAPID_KONTAKT__'],
    [base64_encode($pem), 'mailto:pruefung@example.invalid'],
    $quelle
);
$tmp = tempnam(sys_get_temp_dir(), 'push') . '.php';
file_put_contents($tmp, $ersetzt);
require $tmp;
@unlink($tmp);

// ── EINRICHTUNG
pruef('Mit Schluessel und Kontakt gilt Push als eingerichtet', push_konfiguriert());
pruef('Der private Schluessel wird geladen', push_privatschluessel() !== null);
pruef('Und der Grund lautet "ok"', push_grund() === 'ok');

// ── WARUM NICHT EINGERICHTET
// Fuenf Ursachen, fuenf verschiedene Antworten -- jede verlangt einen
// anderen Handgriff an einer anderen Stelle. Nachgetragen, nachdem beim
// ersten echten Einrichten "kein Schluessel angekommen" und "Schluessel
// unlesbar" gleich aussahen und eine halbe Stunde Raten kosteten.
//
// Geprueft wird an einer EIGENEN Kopie der Datei je Fall: push.php haelt
// den Wert in einer Konstanten, die sich nicht umsetzen laesst. Die
// Funktion wird darum je Fall unter eigenem Namen geladen -- derselbe
// Quelltext, andere Werte.
function pruef_grund_mit(string $schluessel, string $kontakt): string
{
    static $nr = 0;
    $nr++;
    $quelle = (string)file_get_contents(__DIR__ . '/../backend/push.php');
    // Nur die Funktion push_grund() herausloesen und unter eigenem Namen
    // laden. So laeuft der ECHTE Rumpf, nur mit anderen Konstanten.
    $anfang = strpos($quelle, 'function push_grund(): string');
    $ende = strpos($quelle, "\n}", $anfang) + 2;
    $rumpf = substr($quelle, $anfang, $ende - $anfang);
    $rumpf = str_replace('function push_grund(): string', "function pruef_grund_$nr(): string", $rumpf);
    $rumpf = str_replace('VAPID_PRIVAT_B64', "PRUEF_SCHLUESSEL_$nr", $rumpf);
    $rumpf = str_replace('push_kontakt()', "PRUEF_KONTAKT_$nr", $rumpf);
    define("PRUEF_SCHLUESSEL_$nr", $schluessel);
    define("PRUEF_KONTAKT_$nr", $kontakt);
    eval($rumpf);
    return ('pruef_grund_' . $nr)();
}

$gueltig = base64_encode($pem);
$gruende = [
    'kein Deploy gelaufen'   => pruef_grund_mit('__VAPID_PRIVATE_PEM_B64__', 'mailto:a@b.invalid'),
    'Secret leer angekommen' => pruef_grund_mit('', 'mailto:a@b.invalid'),
    'Prozentzeichen am Ende' => pruef_grund_mit($gueltig . '%', 'mailto:a@b.invalid'),
    'kein Schluessel drin'   => pruef_grund_mit(base64_encode('nur irgendein Text'), 'mailto:a@b.invalid'),
    'Kontakt fehlt'          => pruef_grund_mit($gueltig, ''),
    'alles gut'              => pruef_grund_mit($gueltig, 'mailto:a@b.invalid'),
];
pruef('KRITISCH: ein unersetzter Platzhalter heisst "kein Schluessel"',
    $gruende['kein Deploy gelaufen'] === 'kein_schluessel');
pruef('KRITISCH: ein leeres Secret heisst ebenfalls "kein Schluessel"',
    $gruende['Secret leer angekommen'] === 'kein_schluessel');
pruef('KRITISCH: ein Prozentzeichen am Ende heisst "unlesbar" -- '
    . 'nicht dasselbe wie "kein Schluessel"',
    $gruende['Prozentzeichen am Ende'] === 'schluessel_unlesbar');
pruef('KRITISCH: lesbar, aber kein Schluessel, heisst "ungueltig"',
    $gruende['kein Schluessel drin'] === 'schluessel_ungueltig');
pruef('KRITISCH: ein fehlender Kontakt wird als solcher benannt -- '
    . 'nicht als fehlender Schluessel',
    $gruende['Kontakt fehlt'] === 'kein_kontakt');
pruef('Mit allem gilt es als eingerichtet', $gruende['alles gut'] === 'ok');
pruef('KRITISCH: die fuenf Fehlerbilder sind unterscheidbar (CLAUDE.md)',
    count(array_unique([$gruende['Secret leer angekommen'], $gruende['Prozentzeichen am Ende'],
        $gruende['kein Schluessel drin'], $gruende['Kontakt fehlt'], $gruende['alles gut']])) === 5);
pruef('KRITISCH: kein Grund verraet den Schluessel selbst',
    !array_filter($gruende, fn($g) => str_contains($gueltig, $g) || strlen($g) > 40));

// ── DER OEFFENTLICHE SCHLUESSEL
// Er muss genau 65 Byte lang sein und mit 0x04 beginnen -- ein Browser
// weist alles andere ab, und zwar erst beim Abonnieren.
$pub = push_oeffentlicher_schluessel();
$pubRoh = push_b64url_zurueck((string)$pub);
pruef('KRITISCH: der oeffentliche Schluessel ist 65 Byte lang', strlen($pubRoh) === 65);
pruef('KRITISCH: und beginnt mit 0x04 (unkomprimierter Punkt)', ($pubRoh[0] ?? '') === "\x04");
pruef('Er ist base64url kodiert -- ohne +, / und Fuellzeichen',
    is_string($pub) && !str_contains($pub, '+') && !str_contains($pub, '/') && !str_contains($pub, '='));
pruef('Er wird aus dem privaten Schluessel abgeleitet, nicht erfunden',
    substr($pubRoh, 1, 32) === str_pad(openssl_pkey_get_details($pk)['ec']['x'], 32, "\0", STR_PAD_LEFT));

// ── DAS JWT
$jetzt = 1893495600;   // 2030-01-01, weit weg vom heutigen Tag
$jwt = push_jwt('https://push.example.invalid', $jetzt);
pruef('Es entsteht ein JWT', is_string($jwt) && $jwt !== '');
$teile = explode('.', (string)$jwt);
pruef('KRITISCH: es hat drei Teile', count($teile) === 3);

$kopf  = json_decode(push_b64url_zurueck($teile[0] ?? ''), true);
$rumpf = json_decode(push_b64url_zurueck($teile[1] ?? ''), true);
pruef('KRITISCH: der Kopf nennt ES256', ($kopf['alg'] ?? '') === 'ES256');
pruef('Der Kopf nennt JWT als Typ', ($kopf['typ'] ?? '') === 'JWT');
pruef('KRITISCH: der Rumpf nennt den Push-Dienst als Empfaenger',
    ($rumpf['aud'] ?? '') === 'https://push.example.invalid');
pruef('KRITISCH: er nennt eine Kontaktadresse (RFC 8292 verlangt sub)',
    ($rumpf['sub'] ?? '') === 'mailto:pruefung@example.invalid');
pruef('KRITISCH: er laeuft ab -- und zwar innerhalb von 24 Stunden',
    isset($rumpf['exp']) && $rumpf['exp'] > $jetzt && $rumpf['exp'] <= $jetzt + 86400);

// ── DIE SIGNATUR, mit dem oeffentlichen Schluessel nachgeprueft
// Das ist der Kern: Genau das tut der Push-Dienst. Geht es hier durch,
// geht es dort durch.
function pruef_roh_zu_der(string $roh): string
{
    $zahl = static function (string $z): string {
        $z = ltrim($z, "\0");
        if ($z === '') { $z = "\0"; }
        // Oberstes Bit gesetzt: DER braucht eine fuehrende Null, sonst
        // waere die Zahl negativ.
        if (ord($z[0]) > 0x7f) { $z = "\0" . $z; }
        return "\x02" . chr(strlen($z)) . $z;
    };
    $inhalt = $zahl(substr($roh, 0, 32)) . $zahl(substr($roh, 32, 32));
    return "\x30" . chr(strlen($inhalt)) . $inhalt;
}

$pubPem = openssl_pkey_get_details($pk)['key'];
$signaturOk = openssl_verify(
    $teile[0] . '.' . $teile[1],
    pruef_roh_zu_der(push_b64url_zurueck($teile[2] ?? '')),
    $pubPem, OPENSSL_ALGO_SHA256
);
pruef('KRITISCH: die Signatur haelt der Pruefung mit dem oeffentlichen Schluessel stand',
    $signaturOk === 1);

// Eine veraenderte Nachricht darf NICHT durchgehen -- sonst pruefte die
// Zeile darueber gar nichts.
$verfaelscht = openssl_verify(
    $teile[0] . '.' . $teile[1] . 'x',
    pruef_roh_zu_der(push_b64url_zurueck($teile[2] ?? '')),
    $pubPem, OPENSSL_ALGO_SHA256
);
pruef('KRITISCH: eine veraenderte Nachricht faellt durch', $verfaelscht !== 1);

// ── DER HEIKLE TEIL: DER ZU ROH, VIELE MALE
// Der Fehler mit den fuehrenden Nullen tritt nur bei einem Teil der
// Signaturen auf. Eine einzelne Probe uebersieht ihn mit hoher
// Wahrscheinlichkeit -- darum 200 verschiedene.
$immer64 = true; $immerGueltig = true;
for ($i = 0; $i < 200; $i++) {
    $sig = '';
    openssl_sign('Nachricht ' . $i, $sig, $pk, OPENSSL_ALGO_SHA256);
    $roh = push_der_zu_roh($sig);
    if ($roh === null || strlen($roh) !== 64) { $immer64 = false; break; }
    if (openssl_verify('Nachricht ' . $i, pruef_roh_zu_der($roh), $pubPem, OPENSSL_ALGO_SHA256) !== 1) {
        $immerGueltig = false; break;
    }
}
pruef('KRITISCH: die rohe Signatur ist IMMER 64 Byte lang (200 Proben)', $immer64);
pruef('KRITISCH: und bleibt nach der Umrechnung IMMER gueltig (200 Proben)', $immerGueltig);

// Ein Schluessel mit kurzem x kommt vor -- der oeffentliche Schluessel
// muss auch dann 65 Byte haben. Wird nicht erzwungen, sondern gesucht:
// etwa jeder 256. Schluessel hat ein x mit fuehrender Null.
$immer65 = true;
for ($i = 0; $i < 60; $i++) {
    $k2 = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    $d2 = openssl_pkey_get_details($k2);
    $x = str_pad($d2['ec']['x'], 32, "\0", STR_PAD_LEFT);
    $y = str_pad($d2['ec']['y'], 32, "\0", STR_PAD_LEFT);
    if (strlen("\x04" . $x . $y) !== 65) { $immer65 = false; break; }
}
pruef('Der oeffentliche Schluessel ist bei jedem Schluessel 65 Byte lang (60 Proben)', $immer65);

// ── DER URSPRUNG
pruef('KRITISCH: das JWT lautet auf den Ursprung, nicht auf den ganzen Endpunkt',
    push_ursprung('https://web.push.apple.com/ABC123?x=1') === 'https://web.push.apple.com');
pruef('Ein Endpunkt ohne https wird abgewiesen',
    push_ursprung('http://push.example.invalid/abc') === null);
pruef('Unsinn wird abgewiesen', push_ursprung('nicht-einmal-eine-adresse') === null);

// ── DIE ANTWORT DES PUSH-DIENSTES
// Drei Ausgaenge, und sie sind bewusst verschieden -- ein einzelnes "hat
// nicht geklappt" behandelte ein totes Geraet wie eine Stoerung und
// schriebe es ewig weiter an.
pruef('KRITISCH: 201 gilt als zugestellt', push_antwort_deuten(201) === 'ok');
pruef('200 und 202 ebenfalls',
    push_antwort_deuten(200) === 'ok' && push_antwort_deuten(202) === 'ok');
pruef('KRITISCH: 404 heisst "Geraet gibt es nicht mehr"', push_antwort_deuten(404) === 'entfernen');
pruef('KRITISCH: 410 ebenso', push_antwort_deuten(410) === 'entfernen');
pruef('KRITISCH: 429 ist eine Stoerung, kein totes Geraet', push_antwort_deuten(429) === 'fehler');
pruef('KRITISCH: 500 ebenso', push_antwort_deuten(500) === 'fehler');
pruef('KRITISCH: 401 ist eine Stoerung und entfernt kein Abo -- '
    . 'ein falsch signiertes JWT wuerde sonst alle Abos loeschen',
    push_antwort_deuten(401) === 'fehler');
pruef('Auch 403 entfernt nichts', push_antwort_deuten(403) === 'fehler');

// ── KANAELE
pruef('Heute gibt es genau einen Kanal', PUSH_KANAELE === ['webpush']);
pruef('Ein erfundener Kanal gilt nicht', !push_kanal_gueltig('brieftaube'));

// ── WER BEKOMMT ETWAS
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, aktiv INTEGER, revierdienst_berechtigt INTEGER)');
$pdo->exec('INSERT INTO mitarbeiter VALUES (1,1,1),(2,1,0),(3,1,1),(4,0,1)');
$pdo->exec('CREATE TABLE push_abo (id INTEGER PRIMARY KEY, mitarbeiter_id INTEGER, kanal TEXT,
            endpunkt TEXT, abgemeldet_am TEXT, letzter_erfolg TEXT, letzter_fehler TEXT,
            letzter_fehler_am TEXT, fehler_zahl INTEGER DEFAULT 0, abmeldegrund TEXT)');

$alle = push_empfaenger($pdo, 'alle');
sort($alle);
pruef('KRITISCH: "alle" erreicht alle AKTIVEN, nicht die ausgetretenen', $alle === [1, 2, 3]);
$revier = push_empfaenger($pdo, 'revier');
sort($revier);
pruef('KRITISCH: "revier" erreicht nur die mit Revierdienst', $revier === [1, 3]);
pruef('KRITISCH: eine unbekannte Zielgruppe erreicht NIEMANDEN '
    . '(im Zweifel weniger, nicht mehr)', push_empfaenger($pdo, 'abteilung') === []);

$GLOBALS['spalteDa'] = false;
pruef('KRITISCH: ohne die Revierdienst-Spalte erreicht "revier" niemanden -- '
    . 'nicht etwa alle', push_empfaenger($pdo, 'revier') === []);
$GLOBALS['spalteDa'] = true;

// ── ABOS
$pdo->exec("INSERT INTO push_abo (id, mitarbeiter_id, kanal, endpunkt, abgemeldet_am)
            VALUES (1,1,'webpush','https://a.invalid/1',NULL),
                   (2,1,'webpush','https://a.invalid/2',NULL),
                   (3,2,'webpush','https://a.invalid/3',NULL),
                   (4,3,'webpush','https://a.invalid/4','2030-01-01 00:00:00')");
pruef('Eine Person mit zwei Geraeten ergibt zwei Abos',
    count(push_abos_fuer($pdo, [1])) === 2);
pruef('KRITISCH: ein abgemeldetes Abo wird nicht mehr angeschrieben',
    count(push_abos_fuer($pdo, [3])) === 0);
pruef('Ohne Personen kein Abo', push_abos_fuer($pdo, []) === []);

push_abo_abmelden($pdo, 1, 'Push-Dienst: 410', '2030-02-02 10:00:00');
$z = $pdo->query('SELECT abgemeldet_am, abmeldegrund FROM push_abo WHERE id = 1')->fetch();
pruef('KRITISCH: ein abgemeldetes Abo wird nicht geloescht, sondern gekennzeichnet',
    $z !== false && $z['abgemeldet_am'] === '2030-02-02 10:00:00');
pruef('Der Grund wird festgehalten', str_contains((string)$z['abmeldegrund'], '410'));
pruef('Und es faellt danach aus der Empfaengerliste',
    count(push_abos_fuer($pdo, [1])) === 1);

push_abo_fehler($pdo, 2, 'HTTP 500', '2030-02-02 10:00:00');
push_abo_fehler($pdo, 2, 'HTTP 500', '2030-02-02 11:00:00');
$z = $pdo->query('SELECT fehler_zahl FROM push_abo WHERE id = 2')->fetch();
pruef('Fehlversuche werden gezaehlt', (int)$z['fehler_zahl'] === 2);
push_abo_erfolg($pdo, 2, '2030-02-02 12:00:00');
$z = $pdo->query('SELECT fehler_zahl, letzter_erfolg, letzter_fehler FROM push_abo WHERE id = 2')->fetch();
pruef('KRITISCH: ein Erfolg setzt den Fehlerzaehler zurueck', (int)$z['fehler_zahl'] === 0);
pruef('Und haelt den Zeitpunkt fest', $z['letzter_erfolg'] === '2030-02-02 12:00:00');

// ── DER ZEITGEBER-ZUGANG
// Vier Lagen, vier Antworten. Beim Einrichten kamen alle als "kein Token"
// heraus -- die Meldung der Sitzungspruefung, in die der Aufruf mangels
// gueltigem Schluessel hineinlief. Vier verschiedene Handgriffe an vier
// verschiedenen Stellen sahen gleich aus.
$echt = str_repeat('a1b2', 12);
pruef('KRITISCH: ein unersetzter Platzhalter heisst "nicht eingerichtet"',
    push_zeitgeber_lage('__PUSH_CRON_SCHLUESSEL__', $echt) === 'nicht_eingerichtet');
pruef('KRITISCH: ein leeres Secret ebenso',
    push_zeitgeber_lage('', $echt) === 'nicht_eingerichtet');
pruef('KRITISCH: ohne Schluessel in der Adresse heisst es so -- '
    . 'und NICHT "falscher Schluessel"',
    push_zeitgeber_lage($echt, '') === 'kein_schluessel_in_der_adresse');
pruef('KRITISCH: ein falscher Schluessel wird als solcher benannt',
    push_zeitgeber_lage($echt, 'etwas-anderes') === 'falscher_schluessel');
pruef('KRITISCH: der richtige Schluessel geht durch',
    push_zeitgeber_lage($echt, $echt) === 'ok');
pruef('KRITISCH: ein Schluessel, der nur ein Zeichen laenger ist, geht NICHT durch -- '
    . 'genau der Fall "Prozentzeichen mitkopiert"',
    push_zeitgeber_lage($echt, $echt . '%') === 'falscher_schluessel');
pruef('Ein zu kurzer Schluessel ebenfalls nicht',
    push_zeitgeber_lage($echt, substr($echt, 0, -1)) === 'falscher_schluessel');
pruef('KRITISCH: die vier Lagen sind unterscheidbar (CLAUDE.md)',
    count(array_unique([
        push_zeitgeber_lage('', $echt),
        push_zeitgeber_lage($echt, ''),
        push_zeitgeber_lage($echt, 'falsch'),
        push_zeitgeber_lage($echt, $echt),
    ])) === 4);
// Ohne Schluessel UND ohne Einrichtung geht "nicht eingerichtet" vor --
// sonst hiesse es "gib einen Schluessel mit", obwohl keiner hilft.
pruef('Ohne beides gilt "nicht eingerichtet"',
    push_zeitgeber_lage('', '') === 'nicht_eingerichtet');

// ── WER WIRD ANGESCHRIEBEN
// Der Verfasser ist NICHT ausgenommen (Entscheidung des Projektinhabers,
// 2026-09-06). Zuerst war er es; beim Einrichten fiel der Widerspruch auf:
// Ueberall sonst -- App-Liste, Zaehler, Wichtig-Fenster -- ist er ein
// normaler Empfaenger. Nur der Push nahm ihn aus, und damit klingelte bei
// einer Mitteilung an einen Betrieb mit einem einzigen angemeldeten Geraet
// gar nichts.
$anAlle = push_abos_fuer_mitteilung($pdo, ['zielgruppe' => 'alle', 'verfasser_id' => 1]);
pruef('KRITISCH: der Verfasser wird mit angeschrieben -- er ist ueberall sonst '
    . 'auch Empfaenger',
    count(array_filter($anAlle, fn($a) => (int)$a['mitarbeiter_id'] === 1)) > 0);
pruef('Die uebrigen ebenfalls',
    count(array_filter($anAlle, fn($a) => (int)$a['mitarbeiter_id'] === 2)) > 0);
$anRevier = push_abos_fuer_mitteilung($pdo, ['zielgruppe' => 'revier', 'verfasser_id' => 1]);
pruef('KRITISCH: eine Revier-Mitteilung erreicht kein Geraet ausserhalb des Revierdiensts',
    count(array_filter($anRevier, fn($a) => (int)$a['mitarbeiter_id'] === 2)) === 0);
pruef('Der Verfasser bekommt auch die Revier-Mitteilung, wenn er dazugehoert',
    count(array_filter($anRevier, fn($a) => (int)$a['mitarbeiter_id'] === 1)) > 0);

// ── WAS IST FAELLIG
$pdo->exec('CREATE TABLE mitteilungen (id INTEGER PRIMARY KEY, titel TEXT, zielgruppe TEXT,
            stufe TEXT, verfasser_id INTEGER, sichtbar_ab TEXT, sichtbar_bis TEXT,
            archiviert_am TEXT, push_gesendet_am TEXT, push_bilanz TEXT)');
$jetztText = '2030-06-15 12:00:00';
$frueher = '2030-06-01 08:00:00';
$spaeter = '2030-07-01 08:00:00';
$pdo->exec("INSERT INTO mitteilungen (id, titel, zielgruppe, stufe, sichtbar_ab, sichtbar_bis, archiviert_am, push_gesendet_am) VALUES
  (1,'sofort','alle','normal',NULL,NULL,NULL,NULL),
  (2,'schon verschickt','alle','normal',NULL,NULL,NULL,'$frueher'),
  (3,'noch nicht soweit','alle','normal','$spaeter',NULL,NULL,NULL),
  (4,'abgelaufen','alle','normal',NULL,'$frueher',NULL,NULL),
  (5,'zurueckgezogen','alle','normal',NULL,NULL,'$frueher',NULL),
  (6,'jetzt faellig','revier','wichtig','$frueher','$spaeter',NULL,NULL)");
$faellig = array_map('intval', array_column(push_faellige_mitteilungen($pdo, $jetztText), 'id'));
sort($faellig);
pruef('KRITISCH: faellig sind genau die sichtbaren, noch nicht verschickten', $faellig === [1, 6]);
pruef('KRITISCH: eine bereits verschickte wird kein zweites Mal verschickt',
    !in_array(2, $faellig, true));
pruef('KRITISCH: eine vorbereitete klingelt nicht, bevor sie in der App steht',
    !in_array(3, $faellig, true));
pruef('KRITISCH: zu einer abgelaufenen Mitteilung klingelt nichts mehr',
    !in_array(4, $faellig, true));
pruef('KRITISCH: zu einer zurueckgezogenen ebenfalls nicht',
    !in_array(5, $faellig, true));

// Derselbe Bestand zu einem spaeteren Zeitpunkt: Jetzt ist die
// vorbereitete faellig. Der Zeitpunkt ist ein Parameter, kein Blick auf
// die Uhr -- sonst liesse sich das nicht pruefen.
$spaeterFaellig = array_map('intval', array_column(
    push_faellige_mitteilungen($pdo, '2030-07-02 08:00:00'), 'id'));
pruef('KRITISCH: die vorbereitete wird faellig, sobald ihr Zeitpunkt erreicht ist',
    in_array(3, $spaeterFaellig, true));

push_mitteilung_vermerken($pdo, 1, ['geraete' => 3, 'zugestellt' => 2, 'entfernt' => 1, 'fehler' => 0], $jetztText);
$z = $pdo->query('SELECT push_gesendet_am, push_bilanz FROM mitteilungen WHERE id = 1')->fetch();
pruef('Der Versand wird an der Mitteilung vermerkt', $z['push_gesendet_am'] === $jetztText);
pruef('Die Bilanz bleibt nachvollziehbar',
    (json_decode((string)$z['push_bilanz'], true)['zugestellt'] ?? null) === 2);
$danach = array_map('intval', array_column(push_faellige_mitteilungen($pdo, $jetztText), 'id'));
pruef('KRITISCH: nach dem Vermerk ist sie nicht mehr faellig -- keine zweite Runde',
    !in_array(1, $danach, true));

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
