<?php
declare(strict_types=1);
// Eigener Mailserver des Betriebs (ENT-730), wirklich ausgefuehrt.
//
// Geprueft wird, was zaehlt: Das Passwort steht nie im Klartext im
// gespeicherten Stand und geht nie an den Browser, ein fremder Schluessel
// oder ein veraenderter Wert liefert kein Passwort, der Server spricht nur
// mit Adressen im offenen Internet, ein unbrauchbarer eigener Server bricht
// ab statt ueber GuardOpS auszuweichen, und eine abgelehnte Anmeldung kommt
// als verstaendliche Meldung zurueck -- gegen einen echten, kleinen
// SMTP-Gegenueber auf diesem Rechner.
//
// KEIN festes Datum (test_datumsfest.mjs).

require_once __DIR__ . '/../backend/db.php';
require_once __DIR__ . '/../backend/mailer.php';
require_once __DIR__ . '/../backend/mail_gestaltung.php';

$ok = 0;
$fehler = [];
$pruef = function (string $was, bool $bedingung) use (&$ok, &$fehler): void {
    if ($bedingung) { $ok++; } else { $fehler[] = $was; }
};
$wirft = function (callable $f): ?string {
    try { $f(); return null; } catch (Throwable $e) { return $e->getMessage(); }
};

// ── 1. Schluessel ────────────────────────────────────────────────────
$k = random_bytes(32);
$pruef('Ohne Wert aus dem Deploy gibt es keinen Schluessel', mail_v_schluessel() === null);
$pruef('Ein gueltiger Wert ergibt den Schluessel', mail_v_schluessel(base64_encode($k)) === $k);
$pruef('Ein zu kurzer Wert gilt nicht', mail_v_schluessel(base64_encode(random_bytes(16))) === null);
$pruef('Kein base64: gilt nicht', mail_v_schluessel('kein*base64') === null);

// ── 2. Verschluesselung ──────────────────────────────────────────────
$pw = 'Geheim-Passwort-123';
$v1 = mail_v_verschluesseln($pw, $k);
$v2 = mail_v_verschluesseln($pw, $k);
$pruef('KRITISCH: der gespeicherte Wert enthaelt das Passwort nicht', !str_contains($v1, $pw)
    && !str_contains(base64_decode(substr($v1, 3)), $pw));
$pruef('Zweimal verschluesselt sieht verschieden aus', $v1 !== $v2);
$pruef('Mit dem richtigen Schluessel kommt das Passwort zurueck', mail_v_entschluesseln($v1, $k) === $pw);
$pruef('KRITISCH: mit einem anderen Schluessel nicht', mail_v_entschluesseln($v1, random_bytes(32)) === null);
$roh = base64_decode(substr($v1, 3));
$roh[strlen($roh) - 1] = chr(ord($roh[strlen($roh) - 1]) ^ 1);
$pruef('KRITISCH: ein veraenderter Wert wird erkannt', mail_v_entschluesseln('v1:' . base64_encode($roh), $k) === null);
$pruef('Unsinn liefert kein Passwort', mail_v_entschluesseln('abc', $k) === null && mail_v_entschluesseln('v1:@@', $k) === null);

// ── 3. Pruefung der Eingabe ──────────────────────────────────────────
$gut = ['typ' => 'eigen', 'absender' => 'offerten@beispiel.ch', 'benutzer' => 'offerten@beispiel.ch',
        'server' => 'Mail.Beispiel.ch', 'port' => 587, 'verschluesselung' => 'starttls', 'passwort' => $pw];
[$s, $f] = mail_v_pruefen($gut);
$pruef('Gueltige Angaben: keine Fehler, Server klein geschrieben', $f === [] && $s['server'] === 'mail.beispiel.ch');
[$s, $f] = mail_v_pruefen(['typ' => 'guardops', 'server' => 'x']);
$pruef('GuardOpS braucht keine Angaben', $f === [] && $s === ['typ' => 'guardops']);
[, $f] = mail_v_pruefen(['absender' => 'kein-mail'] + $gut);
$pruef('Ungueltige Absenderadresse wird abgelehnt', count($f) === 1);
foreach (['10.0.0.1', 'localhost', 'mail beispiel.ch', ''] as $h) {
    [, $f] = mail_v_pruefen(['server' => $h] + $gut);
    $pruef("Server \"$h\" wird abgelehnt", count($f) === 1);
}
[, $f] = mail_v_pruefen(['port' => 22] + $gut);
$pruef('KRITISCH: ein Port ausserhalb der Mailports wird abgelehnt', count($f) === 1);
[, $f] = mail_v_pruefen(['passwort' => ''] + $gut);
$pruef('Ohne Passwort und ohne gespeichertes: abgelehnt', count($f) === 1);
[, $f] = mail_v_pruefen(['passwort' => ''] + $gut, ['passwort' => $v1]);
$pruef('Leeres Passwortfeld mit gespeichertem Passwort: gilt als unveraendert', $f === []);
[, $f] = mail_v_pruefen(['passwort' => "a\r\nQUIT"] + $gut);
$pruef('KRITISCH: ein Passwort mit Zeilenumbruch wird abgelehnt', count($f) === 1);
[$s] = mail_v_pruefen(['absender' => "a@b.ch\r\nBcc: x@y.ch"] + $gut);
$pruef('KRITISCH: Steuerzeichen kommen nicht in die Absenderadresse', !preg_match('/[\r\n]/', $s['absender']));

// ── 4. Was der Browser sieht ─────────────────────────────────────────
$stand = ['typ' => 'eigen', 'absender' => 'a@beispiel.ch', 'benutzer' => 'a', 'server' => 'mail.beispiel.ch',
          'port' => 465, 'verschluesselung' => 'ssl', 'passwort' => $v1];
$o = mail_v_oeffentlich($stand);
$pruef('KRITISCH: das Passwort geht nie an den Browser, auch nicht verschluesselt',
    !array_key_exists('passwort', $o) && !str_contains(json_encode($o), substr($v1, 3, 20)));
$pruef('Der Browser erfaehrt nur, dass eines hinterlegt ist', $o['passwort_hinterlegt'] === true);

// ── 5. Kein Ausweichen ───────────────────────────────────────────────
$pruef('GuardOpS gewaehlt: kein eigener Server', mail_v_server(['typ' => 'guardops'] + $stand, 'F', $k) === null);
$s = mail_v_server($stand, 'Muster AG', $k);
$pruef('Eigener Server: Passwort entschluesselt, Absender und Name gesetzt',
    $s['pass'] === $pw && $s['absender'] === 'a@beispiel.ch' && $s['name'] === 'Muster AG' && $s['eigen'] === true);
$s = mail_v_server($stand, 'F', null);
$pruef('Schluessel fehlt: Meldung statt Server', isset($s['fehler']) && str_contains($s['fehler'], 'Schlüssel'));
$s = mail_v_server($stand, 'F', random_bytes(32));
$pruef('Schluessel gewechselt: Meldung statt Server', isset($s['fehler']) && str_contains($s['fehler'], 'neu eingeben'));
$m = $wirft(fn() => smtp_senden('kundin@beispiel.ch', 'K', 'B', '<p>x</p>', 'x', [], [], '', $s));
$pruef('KRITISCH: ein unbrauchbarer eigener Server bricht den Versand ab, mit seiner Meldung',
    $m !== null && str_contains($m, 'neu eingeben'));

// ── 6. Nur das offene Internet ───────────────────────────────────────
foreach (['127.0.0.1', '10.1.2.3', '172.16.0.5', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1'] as $ip) {
    $pruef("KRITISCH: $ip gilt als intern", !mail_v_adresse_oeffentlich($ip));
}
$pruef('Eine oeffentliche Adresse gilt', mail_v_adresse_oeffentlich('8.8.8.8'));
$m = $wirft(fn() => mail_v_aufloesen('localhost'));
$pruef('KRITISCH: ein Name, der auf diesen Rechner zeigt, wird abgewiesen', $m !== null && str_contains($m, 'interne'));
$m = $wirft(fn() => smtp_verbinden(['eigen' => true, 'host' => 'localhost', 'port' => 587,
                                    'verschluesselung' => 'starttls', 'user' => 'a', 'pass' => 'b']));
$pruef('KRITISCH: auch beim Verbinden selbst, nicht nur beim Speichern', $m !== null && str_contains($m, 'interne'));

// ── 7. Abgelehnte Anmeldung, gegen ein echtes Gegenueber ─────────────
// Ein kleiner SMTP-Server auf diesem Rechner, der jede Anmeldung mit 535
// ablehnt. Ohne 'eigen' verbindet smtp_verbinden() direkt (so wie mit dem
// GuardOpS-Server) -- die Sperre fuer interne Adressen ist oben geprueft.
$srv = @stream_socket_server('tcp://127.0.0.1:0', $en, $es);
if ($srv === false) {
    $fehler[] = 'Kein lokaler Testserver moeglich: ' . $es;
} else {
    $port = (int)substr(strrchr(stream_socket_get_name($srv, false), ':'), 1);
    $kind = pcntl_fork_oder_null();
    if ($kind === 0) {
        $c = stream_socket_accept($srv, 5);
        if ($c) {
            fwrite($c, "220 test\r\n");
            while (($z = fgets($c)) !== false) {
                $z = trim($z);
                if (str_starts_with($z, 'EHLO')) { fwrite($c, "250-test\r\n250 AUTH LOGIN\r\n"); }
                elseif ($z === 'AUTH LOGIN') { fwrite($c, "334 VXNlcm5hbWU6\r\n"); }
                elseif ($z === base64_encode('falsch@beispiel.ch')) { fwrite($c, "334 UGFzc3dvcmQ6\r\n"); }
                elseif ($z === 'QUIT') { fwrite($c, "221 tschuess\r\n"); break; }
                else { fwrite($c, "535 5.7.8 Authentication failed\r\n"); }
            }
            fclose($c);
        }
        exit(0);
    }
    if ($kind === null) {
        $fehler[] = 'pcntl fehlt -- der Gegenueber-Test laeuft nicht';
    } else {
        fclose($srv);
        $m = $wirft(fn() => smtp_anmeldung_pruefen(['host' => '127.0.0.1', 'port' => $port, 'verschluesselung' => '',
                                                      'user' => 'falsch@beispiel.ch', 'pass' => 'falsch']));
        pcntl_waitpid($kind, $st);
        $pruef('Abgelehnte Anmeldung: verstaendliche Meldung samt Antwort des Servers',
            $m !== null && str_contains($m, 'Anmeldung abgelehnt') && str_contains($m, '535'));
        $pruef('KRITISCH: das Passwort steht nicht in der Meldung', $m !== null && !str_contains($m, 'falsch@beispiel.ch:falsch')
            && !str_contains($m, base64_encode('falsch')));
    }
}

function pcntl_fork_oder_null(): ?int
{
    return function_exists('pcntl_fork') ? pcntl_fork() : null;
}

echo "$ok bestanden\n";
foreach ($fehler as $f) { echo "  x $f\n"; }
exit($fehler ? 1 : 0);
