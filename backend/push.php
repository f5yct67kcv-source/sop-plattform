<?php
// Push-Benachrichtigungen (ENT-424).
//
// Vom Projektinhaber bestellt als Fortsetzung von ENT-421: Die Mitteilungen
// erreichten niemanden, der die App nicht von sich aus oeffnet (OP-421).
//
// FUENF FESTLEGUNGEN, die den Aufbau erklaeren:
//
//  1. WEB PUSH JETZT, NATIVER PUSH SPAETER. Die offiziellen Apps warten auf
//     die Store-Freigabe; bis dahin ist Web Push der einzige Weg, der ohne
//     Apple-/Google-Freigabe funktioniert. Der Projektinhaber hat "jetzt
//     bauen, Aufruf an die Belegschaft spaeter" entschieden. Darum traegt
//     jedes Abo eine Spalte `kanal`: heute ausschliesslich 'webpush',
//     spaeter kommen 'apns'/'fcm' daneben. Nur der Transportweg unten
//     (push_zustellen) wechselt dann -- Tabelle, Empfaengerwahl, Protokoll
//     und Oberflaeche bleiben.
//
//  2. KEINE NUTZLAST. Auf dem Sperrbildschirm steht "Neue Mitteilung",
//     nicht der Titel. Vom Projektinhaber so entschieden: So laeuft KEIN
//     Mitteilungsinhalt ueber die Server von Apple und Google. Technisch
//     ist das ausserdem der schlankere Weg -- ohne Nutzlast entfaellt die
//     Verschluesselung nach RFC 8291 vollstaendig, es bleibt die Signatur
//     nach RFC 8292 (VAPID). PREIS DAVON, und er ist bewusst bezahlt: Auf
//     dem Sperrbildschirm laesst sich "wichtig" nicht von "normal"
//     unterscheiden. Wer das aendern will, braucht die Nutzlast und damit
//     die Verschluesselung.
//
//  3. EIN GEHEIMNIS, NICHT ZWEI. Der oeffentliche VAPID-Schluessel wird aus
//     dem privaten ABGELEITET (push_oeffentlicher_schluessel), nicht
//     getrennt hinterlegt. Zwei Werte, die zusammenpassen muessen, laufen
//     irgendwann auseinander -- und ein oeffentlicher Schluessel, der nicht
//     zum privaten passt, faellt erst auf, wenn eine Benachrichtigung nicht
//     ankommt.
//
//  4. EIN ABGELAUFENES ABO WIRD ENTFERNT, KEIN ZWEITES MAL VERSUCHT. Die
//     Push-Dienste antworten mit 404 oder 410, wenn ein Geraet die App
//     entfernt hat. Bliebe das Abo stehen, waechst die Liste mit toten
//     Eintraegen, und die Zahl "an 12 Geraete verschickt" waere eine
//     Behauptung.
//
//  5. VERSCHICKT WIRD, WAS SICHTBAR IST. Eine Mitteilung mit "sichtbar ab"
//     in der Zukunft loest beim Speichern NICHTS aus -- sonst klingelte das
//     Telefon zu einer Meldung, die in der App noch gar nicht steht. Der
//     Nachzuegler-Versand steht in api/push_versand.php.
declare(strict_types=1);

// ── Das Geheimnis ─────────────────────────────────────────────────────
// Beim Deploy ersetzt, derselbe Mechanismus wie __DB_HOST__ und __SMTP_*__.
// Bleibt es ungesetzt, meldet push_konfiguriert() "nicht eingerichtet" --
// es wird nichts verschickt und nichts behauptet.
//
// Wert: base64 der PEM-Datei des privaten P-256-Schluessels, EINZEILIG
// (die Ersetzung im Deploy ist ein sed-Aufruf und vertraegt keine
// Zeilenumbrueche). Erzeugen laesst er sich mit:
//     openssl ecparam -genkey -name prime256v1 -noout -out vapid.pem
//     base64 -w0 vapid.pem
const VAPID_PRIVAT_B64 = '__VAPID_PRIVATE_PEM_B64__';

// Wer ist der Absender? RFC 8292 verlangt im JWT ein "sub" -- eine
// mailto:- oder https:-Adresse, unter der ein Push-Dienst den Betreiber
// erreicht, wenn etwas schiefgeht.
const VAPID_KONTAKT = '__VAPID_KONTAKT__';

// Die Kanaele. EINE Liste -- Speichern und Versand befragen sie.
// 'apns' und 'fcm' stehen noch nicht drin: Ein Kanal, den niemand
// zustellen kann, waere ein Versprechen ohne Deckung. Sie kommen dazu,
// wenn der native Weg gebaut wird.
const PUSH_KANAELE = ['webpush'];

function push_kanal_gueltig(string $wert): bool
{
    return in_array($wert, PUSH_KANAELE, true);
}

// ── Kodierung ─────────────────────────────────────────────────────────
// base64url ohne Fuellzeichen (RFC 7515). Wird an vier Stellen gebraucht:
// JWT-Kopf, JWT-Rumpf, Signatur und oeffentlicher Schluessel.
function push_b64url(string $roh): string
{
    return rtrim(strtr(base64_encode($roh), '+/', '-_'), '=');
}

function push_b64url_zurueck(string $text): string
{
    $rest = strlen($text) % 4;
    if ($rest) { $text .= str_repeat('=', 4 - $rest); }
    return (string)base64_decode(strtr($text, '-_', '+/'));
}

// ── Der Schluessel ────────────────────────────────────────────────────
/**
 * Der private Schluessel, oder null wenn nicht eingerichtet.
 *
 * Statisch gemerkt: Beim Versand an 30 Geraete wird er 30-mal gebraucht,
 * und das Einlesen kostet jedes Mal.
 */
function push_privatschluessel()
{
    static $schluessel = false;
    if ($schluessel !== false) { return $schluessel; }
    $schluessel = null;
    // Der unersetzte Platzhalter ist KEIN Schluessel. Ohne diese Pruefung
    // liefe base64_decode darauf und openssl bekaeme Unsinn -- die Meldung
    // hiesse dann "Schluessel ungueltig" statt "nicht eingerichtet", und
    // das sind zwei verschiedene Sachverhalte.
    if (VAPID_PRIVAT_B64 === '' || str_starts_with(VAPID_PRIVAT_B64, '__VAPID')) { return null; }
    $pem = base64_decode(VAPID_PRIVAT_B64, true);
    if ($pem === false || $pem === '') { return null; }
    $k = openssl_pkey_get_private($pem);
    if ($k === false) { return null; }
    $d = openssl_pkey_get_details($k);
    // Nur P-256. Ein Schluessel auf einer anderen Kurve wuerde hier
    // klaglos geladen und erst beim Push-Dienst abgewiesen.
    if (!isset($d['ec']['curve_name']) || $d['ec']['curve_name'] !== 'prime256v1') { return null; }
    $schluessel = $k;
    return $schluessel;
}

function push_kontakt(): string
{
    $k = VAPID_KONTAKT;
    if ($k === '' || str_starts_with($k, '__VAPID')) { return ''; }
    return $k;
}

/**
 * WARUM ist Push nicht eingerichtet? Fuenf verschiedene Antworten.
 *
 * Nachgetragen, nachdem beim ersten Einrichten genau das gefehlt hat: Die
 * Oberflaeche sagte "auf dem Server fehlt der Push-Schluessel" -- und liess
 * offen, ob gar keiner ankam (Secret-Name oder Environment falsch) oder ob
 * der Wert unlesbar war (ein Zeichen zu viel beim Kopieren). Das sind
 * zwei verschiedene Handgriffe an zwei verschiedenen Stellen, und Raten
 * kostete eine halbe Stunde. Hausregel: "unbekannt" darf nie wie "keine"
 * aussehen -- hier sahen zwei Ursachen gleich aus.
 *
 * Die Rueckgabe nennt NIE den Schluessel selbst oder Teile davon. Sie sagt
 * nur, welcher Handgriff fehlt.
 */
function push_grund(): string
{
    $wert = VAPID_PRIVAT_B64;
    if ($wert === '' || str_starts_with($wert, '__VAPID')) {
        // Der Platzhalter steht noch da (kein Deploy gelaufen) oder das
        // Secret kam leer an (Name oder Environment stimmt nicht).
        return 'kein_schluessel';
    }
    $pem = base64_decode($wert, true);
    if ($pem === false || $pem === '') {
        // base64_decode im strengen Modus weist jedes Zeichen ausserhalb
        // des Alphabets ab -- etwa das "%", das die Mac-Shell ans Ende
        // einer Zeile ohne Zeilenumbruch setzt und das beim Markieren mit
        // der Maus mitkommt.
        return 'schluessel_unlesbar';
    }
    $k = openssl_pkey_get_private($pem);
    if ($k === false) { return 'schluessel_ungueltig'; }
    $d = openssl_pkey_get_details($k);
    if (!isset($d['ec']['curve_name']) || $d['ec']['curve_name'] !== 'prime256v1') {
        return 'falsche_kurve';
    }
    if (push_kontakt() === '') { return 'kein_kontakt'; }
    return 'ok';
}

/**
 * Ist Push ueberhaupt eingerichtet?
 *
 * Beides noetig: Schluessel UND Kontaktadresse. Ohne Kontakt weisen
 * mehrere Push-Dienste das JWT ab -- ein halb eingerichteter Push
 * scheitert dann erst beim ersten echten Versand.
 *
 * EINE Wahrheit: Diese Funktion leitet sich aus push_grund() ab, statt die
 * Bedingungen ein zweites Mal aufzuschreiben. Zwei Listen von Bedingungen
 * fuer dieselbe Frage laufen irgendwann auseinander.
 */
function push_konfiguriert(): bool
{
    return push_grund() === 'ok';
}

/**
 * Der oeffentliche Schluessel als base64url, wie ihn der Browser fuer
 * `applicationServerKey` braucht: unkomprimierter Punkt, 65 Byte,
 * 0x04 || X || Y.
 *
 * ABGELEITET, nicht hinterlegt (siehe Festlegung 3 oben). x und y kommen
 * links mit Nullen aufgefuellt -- openssl liefert sie ohne fuehrende
 * Nullbytes, und ein 31 Byte langes X ergaebe einen Schluessel, den kein
 * Browser annimmt. Das passiert etwa in einem von 256 Faellen und waere
 * sonst ein Fehler, der sich nur bei bestimmten Schluesseln zeigt.
 */
function push_oeffentlicher_schluessel(): ?string
{
    $k = push_privatschluessel();
    if ($k === null) { return null; }
    $d = openssl_pkey_get_details($k);
    if (!isset($d['ec']['x'], $d['ec']['y'])) { return null; }
    $x = str_pad($d['ec']['x'], 32, "\0", STR_PAD_LEFT);
    $y = str_pad($d['ec']['y'], 32, "\0", STR_PAD_LEFT);
    return push_b64url("\x04" . $x . $y);
}

// ── Die Signatur ──────────────────────────────────────────────────────
/**
 * openssl signiert im DER-Format (Sequenz aus zwei ganzen Zahlen), JWS
 * verlangt 64 rohe Bytes (R || S, je 32). Die Umrechnung ist der Ort, an
 * dem selbstgebaute JWT-Signaturen ueblicherweise scheitern: DER kodiert
 * Zahlen mit variabler Laenge und schiebt ein fuehrendes Nullbyte davor,
 * wenn das oberste Bit gesetzt ist.
 */
function push_der_zu_roh(string $der): ?string
{
    $p = 0;
    if (($der[$p++] ?? '') !== "\x30") { return null; }     // SEQUENCE
    $len = ord($der[$p++] ?? "\0");
    if ($len > 0x80) { $p += $len - 0x80; }                  // lange Form
    $zahl = static function (string $der, int &$p): ?string {
        if (($der[$p++] ?? '') !== "\x02") { return null; }   // INTEGER
        $l = ord($der[$p++] ?? "\0");
        $wert = substr($der, $p, $l);
        $p += $l;
        $wert = ltrim($wert, "\0");                          // fuehrende Null weg
        if (strlen($wert) > 32) { return null; }
        return str_pad($wert, 32, "\0", STR_PAD_LEFT);       // links auffuellen
    };
    $r = $zahl($der, $p);
    $s = $zahl($der, $p);
    if ($r === null || $s === null) { return null; }
    return $r . $s;
}

/**
 * Das JWT nach RFC 8292 fuer genau EINEN Push-Dienst.
 *
 * $aud ist der Ursprung des Endpunkts (Schema + Host), nicht der ganze
 * Endpunkt: Ein JWT, das auf die vollstaendige Adresse lautet, wird
 * abgewiesen -- und die Adresse enthaelt die Geraetekennung, die damit in
 * einem Kopfzeilenfeld landen wuerde.
 *
 * Laufzeit 12 Stunden. Laenger als 24 lehnen die Dienste ab; kuerzer
 * brauchte es nicht, das JWT wird ohnehin je Versand neu gebildet.
 */
function push_jwt(string $aud, ?int $jetzt = null): ?string
{
    $k = push_privatschluessel();
    if ($k === null || push_kontakt() === '') { return null; }
    $jetzt = $jetzt ?? time();
    $kopf  = push_b64url((string)json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $rumpf = push_b64url((string)json_encode([
        'aud' => $aud,
        'exp' => $jetzt + 12 * 3600,
        'sub' => push_kontakt(),
    ]));
    $sig = '';
    if (!openssl_sign($kopf . '.' . $rumpf, $sig, $k, OPENSSL_ALGO_SHA256)) { return null; }
    $roh = push_der_zu_roh($sig);
    if ($roh === null) { return null; }
    return $kopf . '.' . $rumpf . '.' . push_b64url($roh);
}

/**
 * Der Ursprung eines Endpunkts -- "https://web.push.apple.com/xyz…" wird
 * zu "https://web.push.apple.com".
 */
function push_ursprung(string $endpunkt): ?string
{
    $t = parse_url($endpunkt);
    if (!isset($t['scheme'], $t['host']) || $t['scheme'] !== 'https') { return null; }
    return $t['scheme'] . '://' . $t['host'];
}

// ── Der Versand ───────────────────────────────────────────────────────
/**
 * Was mit einem Abo nach der Antwort des Push-Dienstes geschehen soll.
 *
 * Drei Ausgaenge, und sie sind bewusst verschieden -- ein einzelnes
 * "hat nicht geklappt" wuerde ein totes Abo wie eine Stoerung behandeln
 * und ewig weiter anschreiben:
 *   'ok'        zugestellt (201, seltener 200/202)
 *   'entfernen' das Geraet gibt es nicht mehr (404/410)
 *   'fehler'    Stoerung, spaeter erneut versuchen (429, 5xx, kein Netz)
 */
function push_antwort_deuten(int $code): string
{
    if ($code >= 200 && $code < 300) { return 'ok'; }
    if ($code === 404 || $code === 410) { return 'entfernen'; }
    return 'fehler';
}

/**
 * Eine Benachrichtigung an ein Abo zustellen.
 *
 * Ohne Nutzlast (Festlegung 2): leerer Rumpf, kein Content-Encoding.
 * "Urgency: high" nur fuer wichtige Mitteilungen -- niedrige Dringlichkeit
 * darf ein Push-Dienst zurueckhalten, bis das Geraet ohnehin wach ist.
 *
 * Der Netzzugriff steckt in einer eigenen, ersetzbaren Funktion, damit
 * die Pruefung alles davor und danach ohne Netz durchspielen kann.
 */
function push_zustellen(array $abo, bool $wichtig): array
{
    $ursprung = push_ursprung((string)($abo['endpunkt'] ?? ''));
    if ($ursprung === null) {
        return ['code' => 0, 'ausgang' => 'entfernen', 'meldung' => 'Endpunkt ist keine https-Adresse'];
    }
    $jwt = push_jwt($ursprung);
    $pub = push_oeffentlicher_schluessel();
    if ($jwt === null || $pub === null) {
        return ['code' => 0, 'ausgang' => 'fehler', 'meldung' => 'Push ist nicht eingerichtet'];
    }

    $ch = curl_init($abo['endpunkt']);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => '',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => [
            'Authorization: vapid t=' . $jwt . ', k=' . $pub,
            'TTL: 86400',
            'Urgency: ' . ($wichtig ? 'high' : 'normal'),
            'Content-Length: 0',
        ],
    ]);
    $antwort = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $netzfehler = curl_error($ch);
    curl_close($ch);

    if ($antwort === false && $code === 0) {
        return ['code' => 0, 'ausgang' => 'fehler', 'meldung' => $netzfehler ?: 'keine Verbindung'];
    }
    return ['code' => $code, 'ausgang' => push_antwort_deuten($code),
            'meldung' => $code >= 300 ? trim((string)$antwort) : ''];
}

// ── Die Abos ──────────────────────────────────────────────────────────
/**
 * Die aktiven Abos der genannten Personen.
 *
 * Eine Person kann mehrere haben -- Telefon und Tablet sind zwei Geraete
 * und bekommen beide eine Benachrichtigung.
 */
function push_abos_fuer(PDO $pdo, array $mitarbeiterIds): array
{
    if (!$mitarbeiterIds) { return []; }
    $marken = implode(',', array_fill(0, count($mitarbeiterIds), '?'));
    $st = $pdo->prepare(
        "SELECT id, mitarbeiter_id, kanal, endpunkt
           FROM push_abo
          WHERE abgemeldet_am IS NULL AND mitarbeiter_id IN ($marken)"
    );
    $st->execute(array_values($mitarbeiterIds));
    return $st->fetchAll();
}

function push_abo_erfolg(PDO $pdo, int $id, string $jetzt): void
{
    $pdo->prepare('UPDATE push_abo SET letzter_erfolg = ?, fehler_zahl = 0, letzter_fehler = NULL
                    WHERE id = ?')->execute([$jetzt, $id]);
}

function push_abo_fehler(PDO $pdo, int $id, string $meldung, string $jetzt): void
{
    $pdo->prepare('UPDATE push_abo SET fehler_zahl = fehler_zahl + 1, letzter_fehler = ?,
                          letzter_fehler_am = ? WHERE id = ?')
        ->execute([mb_substr($meldung, 0, 200), $jetzt, $id]);
}

/**
 * Ein Abo abmelden -- beim Abschalten durch die Person selbst ODER wenn
 * der Push-Dienst 404/410 meldet.
 *
 * ABGEMELDET, NICHT GELOESCHT: Dieselbe Haltung wie beim Archivieren einer
 * Mitteilung (ENT-421). Wer nachvollziehen will, warum jemand keine
 * Benachrichtigung bekommen hat, braucht den Eintrag noch.
 */
function push_abo_abmelden(PDO $pdo, int $id, string $grund, string $jetzt): void
{
    $pdo->prepare('UPDATE push_abo SET abgemeldet_am = ?, abmeldegrund = ? WHERE id = ?')
        ->execute([$jetzt, mb_substr($grund, 0, 100), $id]);
}

// ── Wer bekommt eine Benachrichtigung? ────────────────────────────────
/**
 * Die Personen, die diese Mitteilung sehen duerfen -- dieselbe Regel wie
 * in mitteilungen.php, nur andersherum gefragt.
 *
 * BEWUSST NICHT die Sichtbarkeitsbedingung nachgebaut: Zielgruppe 'alle'
 * heisst alle aktiven Konten, 'revier' heisst die mit
 * revierdienst_berechtigt. Das Zeitfenster prueft der Aufrufer, denn es
 * entscheidet ob ueberhaupt verschickt wird, nicht an wen.
 *
 * Ohne die Spalte revierdienst_berechtigt (Einrichtung noch nicht
 * gelaufen) wird an NIEMANDEN verschickt statt an alle -- im Zweifel
 * weniger, nicht mehr. Sonst bekaeme die ganze Belegschaft eine
 * Benachrichtigung zu einer Mitteilung, die nur den Revierdienst angeht.
 */
function push_empfaenger(PDO $pdo, string $zielgruppe): array
{
    if ($zielgruppe === 'revier') {
        if (!hat_spalte($pdo, 'mitarbeiter', 'revierdienst_berechtigt')) { return []; }
        $st = $pdo->query('SELECT id FROM mitarbeiter WHERE aktiv = 1 AND revierdienst_berechtigt = 1');
    } elseif ($zielgruppe === 'alle') {
        $st = $pdo->query('SELECT id FROM mitarbeiter WHERE aktiv = 1');
    } else {
        // Unbekannte Zielgruppe: niemand. Gleiche Haltung wie
        // mitteilung_sichtbar_fuer() -- ein Tippfehler in der Datenbank
        // darf keine Benachrichtigung an alle ausloesen.
        return [];
    }
    return array_map('intval', array_column($st->fetchAll(), 'id'));
}

/**
 * Eine Mitteilung an alle passenden Geraete verschicken.
 *
 * Gibt eine Bilanz zurueck: verschickt / entfernt / gescheitert. Sie wird
 * an der Mitteilung gespeichert, damit die Verwaltung sieht, was
 * tatsaechlich hinausging -- "an 12 Geraete verschickt" darf keine
 * Behauptung sein.
 *
 * DER VERFASSER BEKOMMT SIE AUCH -- seit dem ersten Einsatz geaendert.
 * Zuerst war er ausgenommen ("wer veroeffentlicht, weiss Bescheid"). Beim
 * Einrichten fiel auf, dass das ein Widerspruch war: Ueberall sonst ist er
 * ein normaler Empfaenger. Seine eigene Mitteilung steht in seiner
 * App-Liste, zaehlt bei ihm als ungelesen ("0 von 2 gelesen" zaehlt ihn
 * mit), und bei "wichtig" legt sich das Bestaetigungsfenster auch ueber
 * seinen Bildschirm. Nur der Push nahm ihn aus. Entweder Empfaenger oder
 * nicht -- vom Projektinhaber so entschieden.
 *
 * Nebenwirkung, die dazugehoert: Nach dem Klick auf "Veroeffentlichen"
 * meldet sich das eigene Telefon einmal.
 */
function push_fuer_mitteilung(PDO $pdo, array $m, string $jetzt): array
{
    $bilanz = ['geraete' => 0, 'zugestellt' => 0, 'entfernt' => 0, 'fehler' => 0];
    if (!push_konfiguriert() || !hat_tabelle($pdo, 'push_abo')) { return $bilanz; }

    $abos = push_abos_fuer_mitteilung($pdo, $m);
    $wichtig = (string)($m['stufe'] ?? 'normal') === 'wichtig';

    foreach ($abos as $abo) {
        $bilanz['geraete']++;
        $e = push_zustellen($abo, $wichtig);
        if ($e['ausgang'] === 'ok') {
            $bilanz['zugestellt']++;
            push_abo_erfolg($pdo, (int)$abo['id'], $jetzt);
        } elseif ($e['ausgang'] === 'entfernen') {
            $bilanz['entfernt']++;
            push_abo_abmelden($pdo, (int)$abo['id'], 'Push-Dienst: ' . $e['code'], $jetzt);
        } else {
            $bilanz['fehler']++;
            push_abo_fehler($pdo, (int)$abo['id'], $e['meldung'] ?: ('HTTP ' . $e['code']), $jetzt);
        }
    }
    return $bilanz;
}

/**
 * Welche Geraete diese Mitteilung anschreibt.
 *
 * Eigene Funktion und nicht in push_fuer_mitteilung() eingebaut, damit sich
 * die Frage "wer bekommt sie?" ohne Netz pruefen laesst -- der Versand
 * selbst braucht einen echten Push-Dienst, die Auswahl nicht.
 *
 * Der Verfasser ist NICHT ausgenommen, siehe push_fuer_mitteilung().
 */
function push_abos_fuer_mitteilung(PDO $pdo, array $m): array
{
    return push_abos_fuer($pdo, push_empfaenger($pdo, (string)($m['zielgruppe'] ?? '')));
}

/**
 * Vermerkt an der Mitteilung, dass (und mit welchem Ergebnis) verschickt
 * wurde. push_gesendet_am ist zugleich die Sperre gegen ein zweites Mal --
 * ohne sie schickte jeder Nachzuegler-Lauf dieselbe Meldung erneut.
 */
function push_mitteilung_vermerken(PDO $pdo, int $mitteilungId, array $bilanz, string $jetzt): void
{
    $pdo->prepare('UPDATE mitteilungen SET push_gesendet_am = ?, push_bilanz = ? WHERE id = ?')
        ->execute([$jetzt, (string)json_encode($bilanz), $mitteilungId]);
}

/**
 * Alle Mitteilungen, die jetzt sichtbar geworden sind und noch keine
 * Benachrichtigung ausgeloest haben.
 *
 * Deckt zwei Faelle mit derselben Abfrage: die eben gespeicherte Mitteilung
 * (sichtbar_ab leer) und die vorbereitete, deren Zeitpunkt inzwischen
 * erreicht ist. Abgelaufene und zurueckgezogene bleiben aussen vor -- eine
 * Benachrichtigung zu etwas, das in der App nicht mehr steht, waere die
 * schlechteste aller Meldungen.
 */
function push_faellige_mitteilungen(PDO $pdo, string $jetzt): array
{
    $st = $pdo->prepare(
        'SELECT id, titel, zielgruppe, stufe, verfasser_id
           FROM mitteilungen
          WHERE push_gesendet_am IS NULL
            AND archiviert_am IS NULL
            AND (sichtbar_ab IS NULL OR sichtbar_ab <= ?)
            AND (sichtbar_bis IS NULL OR sichtbar_bis >= ?)
          ORDER BY id'
    );
    $st->execute([$jetzt, $jetzt]);
    return $st->fetchAll();
}
