<?php
declare(strict_types=1);
// Quelltext-Pruefung fuer die Passwort-Ruecksetzung per E-Mail-Link
// (ENT-373). Beide Endpunkte benutzen MySQL-eigene Syntax (DATE_ADD/
// INTERVAL, NOW()), die sich gegen den SQLite-Stub aus pruef_rundgang.php
// nicht ausfuehren laesst -- dieselbe Grenze wie bei db.php, anmeldung.php,
// zweifaktor.php, planung.php::doppelbelegungen() und
// einsatz_position.php::zuteilen (siehe dortige Vermerke). Geprueft wird
// darum am Quelltext, nicht an einer echten Ausfuehrung.
$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

$anfordern = file_get_contents(__DIR__ . '/../backend/api/passwort_vergessen.php');
$zuruecksetzen = file_get_contents(__DIR__ . '/../backend/api/passwort_zuruecksetzen.php');
$einrichten = file_get_contents(__DIR__ . '/../backend/api/planung_einrichten.php');

// ══════════ TABELLE IST REGISTRIERT ═════════════════════════════════
pruef('KRITISCH: passwort_reset ist im Einrichtungs-Mechanismus registriert',
    (bool)preg_match("/'passwort_reset' => \"CREATE TABLE passwort_reset/", $einrichten));
pruef('Die Tabelle traegt einen Fremdschluessel mit Kaskadenloeschung auf mitarbeiter',
    (bool)preg_match('/passwort_reset[\s\S]{0,600}FOREIGN KEY \(mitarbeiter_id\) REFERENCES mitarbeiter\(id\) ON DELETE CASCADE/', $einrichten));
pruef('token_hash ist SHA-256 (CHAR(64)), nicht bcrypt (VARCHAR(255))',
    (bool)preg_match('/passwort_reset[\s\S]{0,600}token_hash CHAR\(64\) NOT NULL/', $einrichten));

// ══════════ passwort_vergessen.php ═══════════════════════════════════
pruef('KRITISCH: die Datei existiert', $anfordern !== false && $anfordern !== '');
pruef('Nur POST wird angenommen',
    (bool)preg_match("/REQUEST_METHOD'\] !== 'POST'/", $anfordern));

// Die Bremse aus ENT-075 wird wiederverwendet, unter einem eigenen
// Namensraum -- eine Ruecksetz-Anfrage darf die normale Login-Sperre
// desselben Kontos nicht mitbenutzen (und umgekehrt).
pruef('KRITISCH: die Anmeldebremse wird mit einem EIGENEN Namensraum wiederverwendet ("reset:")',
    (bool)preg_match("/'reset:' \. \\\$name/", $anfordern));
pruef('Alle drei Bremsfunktionen aus anmeldung.php werden benutzt',
    str_contains($anfordern, 'anmeld_zaehlen(') && str_contains($anfordern, 'anmeld_sperre(')
    && str_contains($anfordern, 'anmeld_fehlversuch('));

// KRITISCH: die Antwort darf sich zwischen den Faellen nicht unterscheiden.
// Das laesst sich strukturell pruefen: Die Helferfunktion, die die
// eigentliche Arbeit macht, darf selbst NIE antworten -- sie darf nur
// fruehzeitig zurueckkehren. Antwortet sie irgendwo doch, gibt es (mindestens)
// zwei verschiedene Erfolgsantworten, je nachdem, welcher Zweig griff.
if (preg_match('/function versuch_link_zu_verschicken\([\s\S]*$/', $anfordern, $fn)) {
    $koerper = $fn[0];
    pruef('KRITISCH: die Versand-Funktion antwortet selbst NIE -- kein json_response darin',
        !str_contains($koerper, 'json_response'));
} else {
    pruef('KRITISCH: die Versand-Funktion versuch_link_zu_verschicken() existiert', false);
}
pruef('KRITISCH: es gibt genau EINE Erfolgsantwort im ganzen Aufruf-Pfad',
    substr_count($anfordern, "'status' => 'ok'") === 1);

// Admin-/Personal-Konten bekommen nie einen Token -- die Pruefung muss VOR
// dem INSERT stehen, sonst waere sie wirkungslos.
// Eng an den WORTLAUT der Wache gebunden, nicht an "irgendein return in der
// Naehe" -- eine erste Fassung dieser Pruefung fand stattdessen ein
// unbeteiligtes return weiter unten (die Leer-Email-Pruefung) und blieb
// gruen, als die Admin-Wache komplett entfernt wurde. Gefunden per
// Gegenprobe.
$wache = "if (\$istVerwaltung) { return; }";
$posWache = strpos($anfordern, $wache);
$posInsert = strpos($anfordern, 'INSERT INTO passwort_reset');
pruef('KRITISCH: die Admin-Ausnahme steht VOR dem Anlegen des Tokens',
    $posWache !== false && $posInsert !== false && $posWache < $posInsert);
pruef('KRITISCH: darf_verwaltung() wird tatsaechlich benutzt (nicht nur ist_admin direkt)',
    str_contains($anfordern, 'darf_verwaltung('));

pruef('Der Token ist 256 Bit Zufall (random_bytes(32)), gehasht per SHA-256',
    str_contains($anfordern, 'random_bytes(32)') && str_contains($anfordern, "hash('sha256', \$tokenRoh)"));
pruef('KRITISCH: ein frueherer, noch offener Token derselben Person wird VOR dem neuen entwertet',
    (bool)preg_match('/UPDATE passwort_reset SET benutzt_am = NOW\(\) WHERE mitarbeiter_id = \? AND benutzt_am IS NULL[\s\S]*?INSERT INTO passwort_reset/', $anfordern));
pruef('Der Link traegt den ROHEN Token, nicht den Hash',
    str_contains($anfordern, "urlencode(\$tokenRoh)") && !str_contains($anfordern, 'urlencode($tokenHash)'));
pruef('KRITISCH: ein Versandfehler wird verschluckt, nicht an den Aufrufer durchgereicht',
    (bool)preg_match('/catch \(Throwable \$e\) \{\s*\/\//', $anfordern));

// ══════════ passwort_zuruecksetzen.php ═══════════════════════════════
pruef('KRITISCH: die Datei existiert', $zuruecksetzen !== false && $zuruecksetzen !== '');
pruef('Nur POST wird angenommen',
    (bool)preg_match("/REQUEST_METHOD'\] !== 'POST'/", $zuruecksetzen));

// Ein einziger, unspezifischer Fehlertext fuer JEDEN ungueltigen Zustand.
pruef('KRITISCH: es gibt genau EINEN Text fuer "ungueltiger Link" (keine zweite, abweichende Formulierung)',
    substr_count($zuruecksetzen, 'Der Link ist ungültig oder abgelaufen') === 1);
pruef('KRITISCH: dieser eine Fehlerpfad wird an mindestens drei Stellen ausgeloest (fehlende Tabelle, ungueltiger Token, Admin-Konto)',
    substr_count($zuruecksetzen, '$ungueltig();') >= 3);

pruef('KRITISCH: ein bereits benutzter Token wird abgelehnt (benutzt_am geprueft)',
    str_contains($zuruecksetzen, "\$row['benutzt_am'] !== null"));
pruef('KRITISCH: ein abgelaufener Token wird abgelehnt (laeuft_ab geprueft)',
    (bool)preg_match('/strtotime\(\(string\)\$row\[.laeuft_ab.\]\) < time\(\)/', $zuruecksetzen));
pruef('KRITISCH: der Token-Hash wird per SHA-256 gebildet, identisch zum Anfordern-Endpunkt',
    str_contains($zuruecksetzen, "hash('sha256', \$token)"));

pruef('KRITISCH: eine zweite, defensive Admin-Pruefung sichert gegen kuenftige Aenderungen ab',
    str_contains($zuruecksetzen, 'darf_verwaltung('));
pruef('Die Passwortregel wird mit istAdmin=false geprueft -- dieser Weg ist nie fuer Admin-Konten gedacht',
    str_contains($zuruecksetzen, "passwort_pruefen(\$neu, (string)\$row['name'], false)"));

pruef('KRITISCH: ALLE Sitzungen der Person werden geloescht, nicht nur fremde (anders als mein_passwort.php)',
    (bool)preg_match("/DELETE FROM sessions WHERE mitarbeiter_id = \?'\)\s*->execute\(\[\\\$mitarbeiterId\]\);/", $zuruecksetzen)
    && !preg_match('/DELETE FROM sessions WHERE mitarbeiter_id = \? AND token/', $zuruecksetzen));
pruef('Andere, noch offene Reset-Anfragen derselben Person verfallen mit',
    (bool)preg_match('/UPDATE passwort_reset SET benutzt_am = NOW\(\) WHERE mitarbeiter_id = \? AND benutzt_am IS NULL/', $zuruecksetzen));
pruef('Eine bestehende Anmeldesperre faellt nach erfolgreichem Reset weg',
    str_contains($zuruecksetzen, 'anmeld_zuruecksetzen('));

// ══════════ AUSGABE ═══════════════════════════════════════════════════
echo "\n$ok bestanden, " . count($bad) . " nicht bestanden\n";
if ($bad) {
    echo "\n✗ " . count($bad) . " FEHLGESCHLAGEN:\n";
    foreach ($bad as $b) { echo "  ✗ $b\n"; }
    exit(1);
}
echo "\nAlle Pruefungen bestanden.\n";
