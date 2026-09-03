<?php
// ist_produktion() (backend/db.php) und der Staging-Mailmodus
// (backend/mailer.php, ENT-341) wirklich ausfuehren.
//
// Gegenprobe (CLAUDE.md: "den behobenen Fehler absichtlich wieder
// einbauen"): platzhalter_offen() wird hier auch mit einem frei gewaehlten,
// bereits "konfigurierten" Testwert geprueft -- nicht nur mit dem einen
// Platzhalter-Zustand, der in dieser Umgebung tatsaechlich erreichbar ist.
// Baut jemand den ENT-192-Fehler nach (Vergleichsziel MIT abschliessendem
// Doppel-Unterstrich), schlaegt die letzte Pruefung unten rot an.
declare(strict_types=1);
require __DIR__ . '/../backend/mailer.php';

$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

$_SERVER['HTTP_HOST'] = 'rapport.itufeden.myhostpoint.ch';
check('KRITISCH: die Produktionsdomain gilt als Produktion', ist_produktion());

$_SERVER['HTTP_HOST'] = 'rapport-test.itufeden.myhostpoint.ch';
check('KRITISCH: jede andere Domain gilt NICHT als Produktion', !ist_produktion());

unset($_SERVER['HTTP_HOST']);
check('KRITISCH: ein fehlender Host gilt ebenfalls NICHT als Produktion (sichere Richtung)',
    !ist_produktion());

// smtp_ziel() auf Produktion: unveraendert, unabhaengig vom Zustand der
// (in dieser Umgebung ohnehin unkonfigurierten) Testadresse.
check('KRITISCH: auf Produktion bleibt der eingegebene Empfaenger unveraendert',
    smtp_ziel('kunde@beispiel.ch', 'Kunde AG', true) === ['kunde@beispiel.ch', 'Kunde AG']);

// smtp_ziel() ausserhalb der Produktion, mit der in dieser Umgebung
// tatsaechlich vorliegenden (unersetzten) Platzhalter-Konstante: kein
// Versand an irgendjemanden.
[$ziel, $zielName] = smtp_ziel('kunde@beispiel.ch', 'Kunde AG', false);
check('KRITISCH: ohne konfigurierte Testadresse liefert Staging KEINEN Empfaenger',
    $ziel === '' && $zielName === '');

// platzhalter_offen() direkt, mit frei gewaehlten Werten -- deckt auch den
// "bereits konfiguriert"-Fall ab, der ueber die Konstante oben nicht
// erreichbar ist.
check('KRITISCH: ein leerer Wert gilt als offener Platzhalter',
    platzhalter_offen('', '__STAGING_TESTMAIL'));
check('KRITISCH: der unersetzte Platzhalter selbst gilt als offen',
    platzhalter_offen('__STAGING_TESTMAIL__', '__STAGING_TESTMAIL'));
check('KRITISCH (Gegenprobe ENT-192): ein echter, konfigurierter Wert gilt NICHT als offen',
    !platzhalter_offen('test-postfach@beispiel.ch', '__STAGING_TESTMAIL'));

echo "\n" . $ok . ' bestanden, ' . count($bad) . " nicht bestanden\n";
if ($bad) { foreach ($bad as $b) { echo '  x ' . $b . "\n"; } exit(1); }
echo "Alle Pruefungen bestanden.\n";
