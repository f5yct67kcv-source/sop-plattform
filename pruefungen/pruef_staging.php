<?php
// umgebung_ist_produktion()/ist_produktion() (backend/db.php) und der
// Staging-Mailmodus (backend/mailer.php, ENT-341) wirklich ausfuehren.
//
// APP_ENV ist seit der Verschaerfung auf Wunsch des Projektinhabers eine
// PHP-Konstante (explizit beim Deploy gesetzt, nicht mehr aus dem
// Hostnamen abgeleitet) und laesst sich nach der Definition nicht mehr
// aendern -- ein Test kaeme an ist_produktion() selbst also nur an EINEM
// Zustand vorbei (hier immer "__APP_ENV__", der unersetzte Platzhalter,
// weil diese Suite nie ueber den Deploy-Workflow laeuft). Deshalb wird die
// eigentliche Entscheidungsregel als eigene, reine Funktion
// umgebung_ist_produktion(string $wert) mit frei gewaehlten Werten
// geprueft -- das deckt auch den Fall "APP_ENV=production" ab, den die
// Konstante hier nie erreicht.
//
// Gegenprobe (CLAUDE.md: "den behobenen Fehler absichtlich wieder
// einbauen"): platzhalter_offen() wird ebenfalls mit einem frei gewaehlten,
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

check('KRITISCH: der exakte Wert "production" gilt als Produktion',
    umgebung_ist_produktion('production'));
check('KRITISCH: "staging" gilt NICHT als Produktion',
    !umgebung_ist_produktion('staging'));
check('KRITISCH: ein leerer Wert gilt NICHT als Produktion (sichere Richtung)',
    !umgebung_ist_produktion(''));
check('KRITISCH: der unersetzte Platzhalter selbst gilt NICHT als Produktion',
    !umgebung_ist_produktion('__APP_ENV__'));
check('KRITISCH: ein Tippfehler wie "Production" gilt NICHT als Produktion -- kein Gross-/Kleinschreibungs-Rueckfall',
    !umgebung_ist_produktion('Production'));

// ist_produktion() selbst laeuft in dieser Suite immer mit dem unersetzten
// Platzhalter (kein Deploy-Workflow hier) -- muss also NICHT Produktion
// ergeben. Das ist keine Umgehung der eigentlichen Pruefung oben, sondern
// die zusaetzliche Bestaetigung, dass ist_produktion() tatsaechlich
// APP_ENV liest und nicht etwas anderes.
check('KRITISCH: ist_produktion() liest APP_ENV -- hier immer NICHT Produktion',
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

// smtp_absender_name() -- Bedingung 4 der SMTP-Ausnahme (ENT-371): der
// Absender muss ausserhalb der Produktion als Staging erkennbar sein, egal
// was im Secret konfiguriert ist. Mit frei gewaehlten Namen geprueft, nicht
// nur mit dem einen Platzhalter-Zustand dieser Umgebung.
check('KRITISCH: auf Produktion bleibt der konfigurierte Absendername unveraendert',
    smtp_absender_name('Cupi 24 GmbH', true) === 'Cupi 24 GmbH');
check('KRITISCH (ENT-371 Bedingung 4): ausserhalb der Produktion traegt der Absender das Praefix [STAGING]',
    smtp_absender_name('Cupi 24 GmbH', false) === '[STAGING] Cupi 24 GmbH');
check('KRITISCH: ein leerer Absendername bleibt ausserhalb der Produktion trotzdem als Staging erkennbar',
    smtp_absender_name('', false) === '[STAGING]');

echo "\n" . $ok . ' bestanden, ' . count($bad) . " nicht bestanden\n";
if ($bad) { foreach ($bad as $b) { echo '  x ' . $b . "\n"; } exit(1); }
echo "Alle Pruefungen bestanden.\n";
