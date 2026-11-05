<?php
declare(strict_types=1);
// Terminbuchung "Betrieb besprechen" fuer guardops.ch (ENT-731, ENT-733).
// Liest freie Fenster aus dem eigenen GuardOpS-Kalender in Hostpoint Cloud
// Office (CalDAV) und traegt Buchungen dort ein.
//
// EIN EIGENER KALENDER FUER GUARDOPS (ENT-733): Ihn nutzen der
// Projektinhaber und sein Partner, der Gespraeche ebenfalls uebernimmt. Er
// ist unabhaengig von formateins -- deren Termine sperren hier nichts. Die
// Logik selbst ist von formateins.ch/termine.php uebernommen und an die
// Regeln dieses Repositorys angepasst. Gesteuert wird nur im Kalender:
//   - Ein Termin mit dem Titel "frei" gibt ein Fenster zur Buchung frei.
//     Feste Zeiten als wiederkehrender Termin.
//   - Alles andere in diesem Kalender blockiert, auch ganztaegig, und die
//     gebuchten Gespraeche selbst.
// Buchbar ist nur, was ausdruecklich freigegeben ist.
//
// NACHKONTROLLE NACH DEM EINTRAGEN: Die Dateisperre in api/termine.php
// schuetzt nur gegen zwei gleichzeitige Buchungen ueber DIESE Seite. Wer im
// selben Augenblick von Hand einen Termin in den Kalender setzt -- der
// Partner, der Projektinhaber --, faellt nicht darunter. Darum liest
// api/termine.php nach dem Eintragen noch einmal und nimmt die eigene
// Buchung zurueck, wenn sich etwas ueberschneidet.
//
// DIESE DATEI HAT KEINE DATENBANK und keine Sitzung: Sie laeuft auf
// guardops.ch, neben api/termine.php. Der Zugang zum Kalender kommt aus dem
// Deploy, nie aus der Anfrage: Der Deploy schreibt aus den GitHub-Secrets
// GUARDOPS_KALENDER_* die Datei kalender_zugang.php daneben (gesperrt in
// htaccess-guardops). Im Repository gibt es sie nicht -- dann ist die
// Buchung aus und die Seite sagt "nicht eingerichtet".

const TERMIN_DAUER_MIN       = 30;   // Laenge eines Gespraechs
const TERMIN_PUFFER_MIN      = 15;   // Abstand zu allem anderen im Kalender
const TERMIN_VORLAUF_TAGE    = 1;    // 1 = fruehestens morgen
const TERMIN_REICHWEITE_TAGE = 28;   // so weit im Voraus buchbar
const TERMIN_ZONE            = 'Europe/Zurich';
const TERMIN_MINDESTDAUER_MS = 5000; // wer schneller ausfuellt, ist ein Skript
const TERMIN_ZWISCHENSPEICHER_S = 60;

// Fest, nicht aus dem Host-Kopf (ENT-501): sonst liesse sich der Absage-Link
// in der Bestaetigung auf eine fremde Seite umbiegen.
const TERMIN_SEITE = 'https://guardops.ch';
// Video ueber kMeet (Infomaniak, Genf): jede Buchung bekommt einen eigenen,
// nicht erratbaren Raum. Kein Konto, weder fuer uns noch fuer Gaeste.
const TERMIN_VIDEO_RAUM = 'https://kmeet.infomaniak.com/guardops-';
const TERMIN_ARTEN = ['telefon' => 'Telefon', 'video' => 'Video'];
const TERMIN_UID_PRAEFIX = 'guardops-';

// ── Zugang ─────────────────────────────────────────────────────────────

// null = nicht eingerichtet. Die Adresse muss https sein; einzig die
// Pruefung darf einen Kalender auf 127.0.0.1 ohne TLS ansprechen.
function termin_zugang_pruefen(string $url, string $benutzer, string $passwort): ?array
{
    foreach ([$url, $benutzer, $passwort] as $w) {
        if (trim($w) === '') { return null; }
    }
    if (!str_starts_with($url, 'https://') && !str_starts_with($url, 'http://127.0.0.1:')) { return null; }
    return ['url' => rtrim($url, '/') . '/', 'benutzer' => $benutzer, 'passwort' => $passwort];
}

function termin_zugang(): ?array
{
    $datei = __DIR__ . '/kalender_zugang.php';
    $z = is_file($datei) ? include $datei : null;
    if (!is_array($z)) { return null; }
    return termin_zugang_pruefen((string)($z['url'] ?? ''), (string)($z['benutzer'] ?? ''), (string)($z['passwort'] ?? ''));
}

// ── CalDAV ─────────────────────────────────────────────────────────────

function termin_dav(array $zugang, string $methode, string $adresse, string $koerper = '', array $koepfe = []): array
{
    $c = curl_init($adresse);
    $optionen = [
        CURLOPT_CUSTOMREQUEST  => $methode,
        CURLOPT_USERPWD        => $zugang['benutzer'] . ':' . $zugang['passwort'],
        CURLOPT_HTTPAUTH       => CURLAUTH_BASIC,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => $koepfe,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS | CURLPROTO_HTTP,
    ];
    if ($koerper !== '') { $optionen[CURLOPT_POSTFIELDS] = $koerper; }
    curl_setopt_array($c, $optionen);
    $antwort = curl_exec($c);
    $code = (int)curl_getinfo($c, CURLINFO_RESPONSE_CODE);
    curl_close($c);
    return [$code, is_string($antwort) ? $antwort : ''];
}

// Alle Termine im Zeitraum. null heisst: Kalender nicht erreichbar -- das ist
// etwas anderes als "nichts frei" und bekommt einen anderen Text.
function termine_holen(array $zugang, DateTimeImmutable $von, DateTimeImmutable $bis, bool $aufloesen = true): ?array
{
    $z = fn(DateTimeImmutable $d) => $d->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');
    $daten = $aufloesen
        ? '<C:calendar-data><C:expand start="' . $z($von) . '" end="' . $z($bis) . '"/></C:calendar-data>'
        : '<C:calendar-data/>';
    $abfrage = '<?xml version="1.0" encoding="utf-8"?>'
        . '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        . '<D:prop>' . $daten . '</D:prop>'
        . '<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">'
        . '<C:time-range start="' . $z($von) . '" end="' . $z($bis) . '"/>'
        . '</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>';
    [$code, $antwort] = termin_dav($zugang, 'REPORT', $zugang['url'], $abfrage,
        ['Depth: 1', 'Content-Type: application/xml; charset=utf-8']);
    if ($code !== 207) { return null; }

    $dom = new DOMDocument();
    if (!@$dom->loadXML($antwort, LIBXML_NONET)) { return null; }
    $termine = [];
    $gefunden = 0;
    foreach ($dom->getElementsByTagNameNS('urn:ietf:params:xml:ns:caldav', 'calendar-data') as $knoten) {
        if (trim($knoten->textContent) === '') { continue; }
        $gefunden++;
        foreach (termin_ics_lesen($knoten->textContent) as $t) { $termine[] = $t; }
    }
    // Manche Server loesen Wiederholungen nicht auf und lassen die Daten dann
    // ganz weg. Dann ohne expand nochmals; termin_vorkommen() loest selbst auf.
    if ($aufloesen && $gefunden === 0 && $dom->getElementsByTagNameNS('DAV:', 'response')->length > 0) {
        return termine_holen($zugang, $von, $bis, false);
    }
    return $termine;
}

// ── iCalendar lesen ────────────────────────────────────────────────────

function termin_ics_lesen(string $ics): array
{
    $ics = preg_replace("/\r?\n[ \t]/", '', $ics) ?? '';
    $termine = [];
    $aktuell = null;
    foreach (preg_split("/\r?\n/", $ics) as $zeile) {
        if ($zeile === 'BEGIN:VEVENT') { $aktuell = ['exdate' => []]; continue; }
        if ($zeile === 'END:VEVENT') { if ($aktuell) { $termine[] = $aktuell; } $aktuell = null; continue; }
        if ($aktuell === null || !str_contains($zeile, ':')) { continue; }
        [$kopf, $wert] = explode(':', $zeile, 2);
        $teile = explode(';', $kopf);
        $name = strtoupper((string)array_shift($teile));
        $param = [];
        foreach ($teile as $p) {
            if (str_contains($p, '=')) { [$k, $v] = explode('=', $p, 2); $param[strtoupper($k)] = trim($v, '"'); }
        }
        switch ($name) {
            case 'SUMMARY':  $aktuell['titel'] = termin_ics_text($wert); break;
            case 'UID':      $aktuell['uid'] = $wert; break;
            case 'STATUS':   $aktuell['status'] = strtoupper($wert); break;
            case 'RRULE':    $aktuell['rrule'] = $wert; break;
            case 'DURATION': $aktuell['dauer'] = $wert; break;
            case 'DTSTART':  $aktuell['beginn'] = termin_ics_zeit($wert, $param); $aktuell['ganztag'] = !str_contains($wert, 'T'); break;
            case 'DTEND':    $aktuell['ende'] = termin_ics_zeit($wert, $param); break;
            case 'RECURRENCE-ID': $aktuell['wiederholungVon'] = termin_ics_zeit($wert, $param); break;
            case 'EXDATE':
                foreach (explode(',', $wert) as $w) {
                    if ($d = termin_ics_zeit($w, $param)) { $aktuell['exdate'][] = $d->getTimestamp(); }
                }
                break;
        }
    }
    $termine = array_values(array_filter($termine, fn($t) => !empty($t['beginn'])));
    foreach ($termine as &$t) {
        if (empty($t['ende'])) {
            try {
                $t['ende'] = !empty($t['dauer'])
                    ? $t['beginn']->add(new DateInterval(ltrim($t['dauer'], '+')))
                    : $t['beginn']->modify($t['ganztag'] ? '+1 day' : '+0 minutes');
            } catch (Exception $e) { $t['ende'] = $t['beginn']; }
        }
    }
    unset($t);
    return $termine;
}

function termin_ics_text(string $wert): string
{
    return strtr($wert, ['\\n' => "\n", '\\N' => "\n", '\\,' => ',', '\\;' => ';', '\\\\' => '\\']);
}

function termin_ics_zeit(string $wert, array $param): ?DateTimeImmutable
{
    $wert = trim($wert);
    try {
        if (preg_match('/^\d{8}$/', $wert)) {
            return DateTimeImmutable::createFromFormat('!Ymd', $wert, new DateTimeZone(TERMIN_ZONE)) ?: null;
        }
        if (!preg_match('/^(\d{8}T\d{6})(Z?)$/', $wert, $m)) { return null; }
        $zone = $m[2] === 'Z' ? 'UTC' : ($param['TZID'] ?? TERMIN_ZONE);
        try { $tz = new DateTimeZone($zone); } catch (Exception $e) { $tz = new DateTimeZone(TERMIN_ZONE); }
        $d = DateTimeImmutable::createFromFormat('Ymd\THis', $m[1], $tz);
        return $d ? $d->setTimezone(new DateTimeZone(TERMIN_ZONE)) : null;
    } catch (Exception $e) {
        return null;
    }
}

// Falls der Server Wiederholungen nicht aufloest: taeglich und woechentlich
// (BYDAY, INTERVAL, UNTIL, COUNT, EXDATE). Mehr braucht ein Freigabekalender
// nicht; monatliche und jaehrliche Regeln zaehlen nur einmal.
function termin_vorkommen(array $t, DateTimeImmutable $bis): array
{
    $laenge = $t['ende']->getTimestamp() - $t['beginn']->getTimestamp();
    if (empty($t['rrule'])) { return [[$t['beginn'], $t['ende']]]; }

    $regel = [];
    foreach (explode(';', $t['rrule']) as $teil) {
        if (str_contains($teil, '=')) { [$k, $v] = explode('=', $teil, 2); $regel[strtoupper($k)] = $v; }
    }
    $art = $regel['FREQ'] ?? '';
    if (!in_array($art, ['DAILY', 'WEEKLY'], true)) { return [[$t['beginn'], $t['ende']]]; }

    $schritt  = max(1, (int)($regel['INTERVAL'] ?? 1));
    $anzahl   = isset($regel['COUNT']) ? (int)$regel['COUNT'] : PHP_INT_MAX;
    $bisRegel = isset($regel['UNTIL']) ? termin_ics_zeit($regel['UNTIL'], []) : null;
    $grenze   = $bisRegel && $bisRegel < $bis ? $bisRegel : $bis;
    $tage = ['MO' => 1, 'TU' => 2, 'WE' => 3, 'TH' => 4, 'FR' => 5, 'SA' => 6, 'SU' => 7];
    $wochentage = [];
    if ($art === 'WEEKLY') {
        foreach (explode(',', $regel['BYDAY'] ?? '') as $b) {
            if (isset($tage[substr($b, -2)])) { $wochentage[] = $tage[substr($b, -2)]; }
        }
        if (!$wochentage) { $wochentage = [(int)$t['beginn']->format('N')]; }
        sort($wochentage);
    }

    $liste = [];
    $gezaehlt = 0;
    $start = $t['beginn'];
    for ($runde = 0; $runde < 800 && $gezaehlt < $anzahl; $runde++) {
        if ($art === 'DAILY') {
            $kandidaten = [$start->modify('+' . ($runde * $schritt) . ' days')];
        } else {
            $montag = $start->modify('-' . ((int)$start->format('N') - 1) . ' days')
                ->modify('+' . ($runde * $schritt) . ' weeks');
            $kandidaten = array_map(fn($n) => $montag->modify('+' . ($n - 1) . ' days'), $wochentage);
        }
        foreach ($kandidaten as $k) {
            if ($k < $t['beginn']) { continue; }
            if ($k > $grenze || $gezaehlt >= $anzahl) { break 2; }
            $gezaehlt++;
            if (in_array($k->getTimestamp(), $t['exdate'], true)) { continue; }
            $liste[] = [$k, $k->modify('+' . $laenge . ' seconds')];
        }
    }
    return $liste;
}

// ── Freie Zeiten ───────────────────────────────────────────────────────

function termin_fruehestens(?DateTimeImmutable $heute = null): DateTimeImmutable
{
    return ($heute ?? new DateTimeImmutable('today', new DateTimeZone(TERMIN_ZONE)))
        ->modify('+' . TERMIN_VORLAUF_TAGE . ' days');
}

function termin_spaetestens(?DateTimeImmutable $heute = null): DateTimeImmutable
{
    return ($heute ?? new DateTimeImmutable('today', new DateTimeZone(TERMIN_ZONE)))
        ->modify('+' . (TERMIN_REICHWEITE_TAGE + 1) . ' days');
}

// Teilt die Termine in Freigabefenster und Belegtes. Ausnahmen einzelner
// Wiederholungen ersetzen das urspruengliche Vorkommen.
function termin_aufteilen(array $termine, DateTimeImmutable $bis): array
{
    $ersetzt = [];
    foreach ($termine as $t) {
        if (!empty($t['wiederholungVon'])) {
            $ersetzt[($t['uid'] ?? '') . '@' . $t['wiederholungVon']->getTimestamp()] = true;
        }
    }
    $fenster = [];
    $belegt = [];
    foreach ($termine as $t) {
        if (($t['status'] ?? '') === 'CANCELLED') { continue; }
        $frei = preg_match('/^\s*frei\b/iu', $t['titel'] ?? '') === 1;
        foreach (termin_vorkommen($t, $bis) as [$b, $e]) {
            if (empty($t['wiederholungVon']) && isset($ersetzt[($t['uid'] ?? '') . '@' . $b->getTimestamp()])) { continue; }
            if ($frei) { $fenster[] = [$b, $e]; }
            else { $belegt[] = [$b->getTimestamp(), $e->getTimestamp(), (string)($t['uid'] ?? '')]; }
        }
    }
    return [$fenster, $belegt];
}

// ['2026-11-10' => ['14:00', '14:45'], ...] -- reine Rechnung, ohne Netz,
// damit pruef_termine.php sie echt ausfuehren kann.
function termin_freie_zeiten(array $termine, DateTimeImmutable $von, DateTimeImmutable $bis): array
{
    [$fenster, $belegt] = termin_aufteilen($termine, $bis);
    $dauer = TERMIN_DAUER_MIN * 60;
    $puffer = TERMIN_PUFFER_MIN * 60;
    $zeiten = [];
    foreach ($fenster as [$b, $e]) {
        for ($s = $b->getTimestamp(); $s + $dauer <= $e->getTimestamp(); $s += $dauer + $puffer) {
            if ($s < $von->getTimestamp() || $s >= $bis->getTimestamp()) { continue; }
            foreach ($belegt as [$bb, $be]) {
                if ($bb < $s + $dauer + $puffer && $be > $s - $puffer) { continue 2; }
            }
            $zeiten[$s] = true;
        }
    }
    ksort($zeiten);
    $tage = [];
    foreach (array_keys($zeiten) as $s) {
        $d = (new DateTimeImmutable('@' . $s))->setTimezone(new DateTimeZone(TERMIN_ZONE));
        $tage[$d->format('Y-m-d')][] = $d->format('H:i');
    }
    return $tage;
}

// Ueberschneidet sich etwas anderes als die eigene Buchung mit diesem Platz?
// Die Pruefung NACH dem Eintragen -- siehe Kopf: die Luecke der Sperre.
function termin_ueberschneidung(array $termine, int $beginn, string $eigeneUid, DateTimeImmutable $bis): bool
{
    [, $belegt] = termin_aufteilen($termine, $bis);
    $ende = $beginn + TERMIN_DAUER_MIN * 60;
    $puffer = TERMIN_PUFFER_MIN * 60;
    foreach ($belegt as [$bb, $be, $uid]) {
        if ($uid === $eigeneUid) { continue; }
        if ($bb < $ende + $puffer && $be > $beginn - $puffer) { return true; }
    }
    return false;
}

// ── Eingaben ───────────────────────────────────────────────────────────

function termin_zeile($wert, int $max = 200): string
{
    $wert = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$wert) ?? '';
    return mb_substr(trim(preg_replace('/\s+/u', ' ', $wert) ?? ''), 0, $max);
}

// Schweizer Nummer (0 oder +41/0041 plus neun Ziffern) oder auslaendische
// mit Vorwahl -- dieselbe Regel wie im Browser (gespraech.html).
function termin_telefon_gueltig(string $t): bool
{
    if (!preg_match('~^[+0-9 ()/.\-]+$~', $t)) { return false; }
    $n = preg_replace('/^00/', '+', preg_replace('/[^\d+]/', '', $t) ?? '') ?? '';
    return preg_match('/^0[1-9]\d{8}$/', $n) === 1
        || preg_match('/^\+410?[1-9]\d{8}$/', $n) === 1
        || preg_match('/^\+(?!41)[1-9]\d{6,13}$/', $n) === 1;
}

// Gibt ['werte' => ..., 'fehler' => [feld => text]] zurueck.
function termin_eingabe_pruefen(array $in): array
{
    $w = [
        'art'     => termin_zeile($in['art'] ?? '', 20),
        'datum'   => termin_zeile($in['datum'] ?? '', 10),
        'zeit'    => termin_zeile($in['zeit'] ?? '', 5),
        'firma'   => termin_zeile($in['firma'] ?? '', 120),
        'name'    => termin_zeile($in['name'] ?? '', 120),
        'telefon' => termin_zeile($in['telefon'] ?? '', 40),
        'email'   => termin_zeile($in['email'] ?? '', 200),
    ];
    $f = [];
    if (!isset(TERMIN_ARTEN[$w['art']])) { $f['art'] = 'Bitte Telefon oder Video wählen.'; }
    if ($w['firma'] === '') { $f['firma'] = 'Bitte den Betrieb angeben.'; }
    if ($w['name'] === '') { $f['name'] = 'Bitte Ihren Namen angeben.'; }
    if (!termin_telefon_gueltig($w['telefon'])) { $f['telefon'] = 'Bitte eine gültige Telefonnummer angeben.'; }
    if (filter_var($w['email'], FILTER_VALIDATE_EMAIL) === false || preg_match('/[\x00-\x20\x7F]/', $w['email'])) {
        $f['email'] = 'Bitte eine gültige E-Mail-Adresse angeben.';
    }
    $beginn = DateTimeImmutable::createFromFormat('!Y-m-d H:i', $w['datum'] . ' ' . $w['zeit'], new DateTimeZone(TERMIN_ZONE));
    if (!$beginn || $beginn->format('Y-m-d H:i') !== $w['datum'] . ' ' . $w['zeit']) { $f['zeit'] = 'Bitte eine Zeit wählen.'; $beginn = null; }
    $w['beginn'] = $beginn;
    return ['werte' => $w, 'fehler' => $f];
}

// ── Ausgabe ────────────────────────────────────────────────────────────

const TERMIN_WOCHENTAGE = [1 => 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const TERMIN_MONATE = [1 => 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function termin_in_worten(DateTimeImmutable $d): string
{
    return TERMIN_WOCHENTAGE[(int)$d->format('N')] . ', ' . $d->format('j') . '. '
        . TERMIN_MONATE[(int)$d->format('n')] . ', ' . $d->format('H:i') . ' Uhr';
}

function termin_ics_escape(string $s): string
{
    return strtr($s, ['\\' => '\\\\', ';' => '\;', ',' => '\,', "\r\n" => '\n', "\n" => '\n']);
}

// Lange Zeilen falten, wie RFC 5545 es verlangt (75 Bytes).
function termin_ics_zeilen(array $zeilen): string
{
    $aus = '';
    foreach ($zeilen as $z) {
        $teil = '';
        foreach (mb_str_split($z) as $zeichen) {
            if (strlen($teil . $zeichen) > 74) { $aus .= $teil . "\r\n"; $teil = ' '; }
            $teil .= $zeichen;
        }
        $aus .= $teil . "\r\n";
    }
    return $aus;
}

function termin_ics(string $uid, DateTimeImmutable $beginn, string $titel, string $beschreibung,
                    string $methode = '', string $raum = ''): string
{
    $utc = fn(DateTimeImmutable $d) => $d->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');
    $zeilen = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GuardOpS//Termine//DE'];
    if ($methode !== '') { $zeilen[] = 'METHOD:' . $methode; }
    array_push($zeilen,
        'BEGIN:VEVENT',
        'UID:' . $uid,
        'DTSTAMP:' . $utc(new DateTimeImmutable()),
        'DTSTART:' . $utc($beginn),
        'DTEND:' . $utc($beginn->modify('+' . TERMIN_DAUER_MIN . ' minutes')),
        'SUMMARY:' . termin_ics_escape($titel),
        'DESCRIPTION:' . termin_ics_escape($beschreibung));
    if ($raum !== '') { array_push($zeilen, 'LOCATION:' . termin_ics_escape($raum), 'URL:' . $raum); }
    array_push($zeilen, 'END:VEVENT', 'END:VCALENDAR');
    return termin_ics_zeilen($zeilen);
}

// Der Absage-Link traegt eine Signatur ueber die UID: Wer die UID errät,
// kann ohne sie nichts absagen.
function termin_schluessel(array $zugang, string $uid): string
{
    return hash_hmac('sha256', $uid, $zugang['passwort'] . '|guardops-termine');
}

function termin_uid_gueltig(string $uid): bool
{
    return preg_match('/^' . preg_quote(TERMIN_UID_PRAEFIX, '/') . '[0-9a-f]{20}$/', $uid) === 1;
}

// Kalendertitel mit der Marke vorn: Wer den GuardOpS-Kalender neben anderen
// eingeblendet hat, sieht auf einen Blick, wofuer das Gespraech ist.
function termin_titel(array $w): string
{
    return 'GuardOpS: ' . $w['name'] . ', ' . $w['firma'] . ' (' . TERMIN_ARTEN[$w['art']] . ')';
}

function termin_mail_kunde(array $w, string $wann, string $absagen, string $raum): array
{
    $h = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    $wie = $w['art'] === 'telefon'
        ? 'Wir rufen Sie unter ' . $w['telefon'] . ' an.'
        : 'Per Video über kMeet, direkt im Browser, ohne Konto und ohne Installation.';
    $text = "Guten Tag\n\nIhr Gespräch ist gebucht.\n\n$wann\n$wie\n"
        . ($raum !== '' ? "Video-Raum: $raum\n" : '')
        . "\nDer Termin hängt als Kalendereintrag an dieser Mail. Passt es doch nicht?"
        . " Hier absagen und einfach neu buchen:\n$absagen\n\nFreundliche Grüsse\nGuardOpS\ninfo@guardops.ch · guardops.ch";
    $raumHtml = $raum === '' ? '' : '<p style="margin:14px 0 0"><a href="' . $h($raum)
        . '" style="display:inline-block;background:#3B67E8;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:4px">Zum Video-Raum</a></p>';
    $html = '<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ihr Gespräch ist gebucht</title></head>'
        . '<body style="margin:0;padding:0;background:#F7F8FA">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F8FA"><tr><td align="center" style="padding:32px 12px">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden">'
        . '<tr><td style="background:#0F1117;padding:24px 36px;font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;color:#F2F4F8">GuardOpS</td></tr>'
        . '<tr><td style="padding:36px 36px 8px;font-family:Helvetica,Arial,sans-serif">'
        . '<p style="margin:0 0 6px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:#2F5BD7">Betrieb besprechen</p>'
        . '<h1 style="margin:0;font-size:28px;line-height:1.2;color:#14161A">Ihr Gespräch ist gebucht.</h1></td></tr>'
        . '<tr><td style="padding:24px 36px 0;font-family:Helvetica,Arial,sans-serif">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F8FA;border-left:3px solid #3B67E8;border-radius:4px"><tr><td style="padding:20px 22px">'
        . '<p style="margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:#545B67">Ihr Termin</p>'
        . '<p style="margin:6px 0 0;font-size:22px;line-height:1.3;color:#14161A;font-weight:700">' . $h($wann) . '</p>'
        . '<p style="margin:8px 0 0;font-size:15px;line-height:1.5;color:#545B67">' . $h($wie) . '</p>' . $raumHtml
        . '</td></tr></table>'
        . '<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#545B67">Der Termin hängt als Kalendereintrag an dieser Mail. Passt es doch nicht? <a href="' . $h($absagen) . '" style="color:#2F5BD7">Hier absagen</a> und einfach neu buchen.</p>'
        . '</td></tr>'
        . '<tr><td style="padding:30px 36px 34px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#545B67">Freundliche Grüsse<br><b style="color:#14161A">GuardOpS</b><br><a href="mailto:info@guardops.ch" style="color:#2F5BD7">info@guardops.ch</a> · <a href="https://guardops.ch" style="color:#2F5BD7">guardops.ch</a></td></tr>'
        . '<tr><td style="background:#F7F8FA;padding:16px 36px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#8B919D">GuardOpS, eine Marke der pzu consulting gmbh · Hochgasse 7, 4632 Trimbach<br>Sie erhalten diese Mail, weil Sie auf guardops.ch ein Gespräch gebucht haben.</td></tr>'
        . '</table></td></tr></table></body></html>';
    return [$text, $html, $wie];
}

function termin_mail_intern(array $w, string $wann, string $raum, string $zusatz = ''): array
{
    $h = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    $zeilen = [
        'Wann' => $wann, 'Art' => TERMIN_ARTEN[$w['art']], 'Betrieb' => $w['firma'], 'Name' => $w['name'],
        'Telefon' => $w['telefon'], 'E-Mail' => $w['email'],
    ];
    if ($raum !== '') { $zeilen['Video-Raum'] = $raum; }
    $text = ($zusatz !== '' ? $zusatz . "\n\n" : '');
    $html = ($zusatz !== '' ? '<p><b>' . $h($zusatz) . '</b></p>' : '') . '<table cellpadding="4">';
    foreach ($zeilen as $k => $v) {
        $text .= "$k: $v\n";
        $html .= '<tr><td style="color:#545B67">' . $h($k) . '</td><td>' . $h($v) . '</td></tr>';
    }
    $text .= "\nGebucht über guardops.ch, steht im Kalender «Gespräche».";
    $html .= '</table><p style="color:#545B67">Gebucht über guardops.ch, steht im Kalender «Gespräche».</p>';
    return [$text, $html];
}

function termin_zwischenspeicher(): string
{
    return sys_get_temp_dir() . '/guardops-termine-frei.json';
}
