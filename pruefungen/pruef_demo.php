<?php
// umgebung_ist_demo()/ist_demo() (backend/db.php) und der Demo-Mailmodus
// (backend/mailer.php, ENT-523) wirklich ausfuehren.
//
// Dieselbe Bauart wie pruef_staging.php: APP_ENV ist eine PHP-Konstante,
// die sich nach der Definition nicht mehr aendern laesst -- ein Test kaeme
// an ist_demo() selbst also nur an EINEM Zustand vorbei (hier immer
// "__APP_ENV__", der unersetzte Platzhalter, weil diese Suite nie ueber
// den Deploy-Workflow laeuft). Deshalb wird die eigentliche
// Entscheidungsregel als eigene, reine Funktion umgebung_ist_demo(string
// $wert) mit frei gewaehlten Werten geprueft.
//
// Der eigentliche Kern dieser Suite: Demo darf KEIN Staging sein. Eine
// Pruefung, die nur "ausserhalb der Produktion geht keine Mail an den
// eingegebenen Empfaenger" verlangt, wuerde grün bleiben, wenn smtp_ziel()
// fuer Demo versehentlich wieder auf STAGING_TESTMAIL zurueckfiele -- das
// waere technisch "kein Versand an den Empfaenger", aber eine Demo-Mail
// im falschen Postfach ist trotzdem der falsche Fehler. Darum wird hier
// geprueft, dass Demo eine EIGENE Testadresse bekommt und NICHT auf die
// Staging-Adresse zurueckfaellt, selbst wenn eine konfiguriert waere.
declare(strict_types=1);
require __DIR__ . '/../backend/mailer.php';

$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

check('KRITISCH: der exakte Wert "demo" gilt als Demo',
    umgebung_ist_demo('demo'));
check('KRITISCH: "production" gilt NICHT als Demo',
    !umgebung_ist_demo('production'));
check('KRITISCH: "staging" gilt NICHT als Demo',
    !umgebung_ist_demo('staging'));
check('KRITISCH: ein leerer Wert gilt NICHT als Demo (sichere Richtung)',
    !umgebung_ist_demo(''));
check('KRITISCH: der unersetzte Platzhalter selbst gilt NICHT als Demo',
    !umgebung_ist_demo('__APP_ENV__'));
check('KRITISCH: ein Tippfehler wie "Demo" gilt NICHT als Demo -- kein Gross-/Kleinschreibungs-Rueckfall',
    !umgebung_ist_demo('Demo'));

// ist_demo() selbst laeuft in dieser Suite immer mit dem unersetzten
// Platzhalter (kein Deploy-Workflow hier) -- muss also NICHT Demo ergeben.
check('KRITISCH: ist_demo() liest APP_ENV -- hier immer NICHT Demo',
    !ist_demo());

// smtp_ziel() mit istDemo=true, in dieser Umgebung mit der tatsaechlich
// vorliegenden (unersetzten) Platzhalter-Konstante: kein Versand.
[$zielDemo, $zielDemoName] = smtp_ziel('kunde@beispiel.ch', 'Kunde AG', false, true);
check('KRITISCH: ohne konfigurierte Demo-Testadresse liefert Demo KEINEN Empfaenger',
    $zielDemo === '' && $zielDemoName === '');

// platzhalter_offen() fuer DEMO_TESTMAIL direkt, mit frei gewaehlten
// Werten -- deckt auch den "bereits konfiguriert"-Fall ab, der ueber
// smtp_ziel() in dieser Suite nicht erreichbar ist (die Konstante
// __DEMO_TESTMAIL__ steht als Literal im Quelltext, nicht als Parameter --
// dieselbe Einschraenkung wie bei __STAGING_TESTMAIL__ in pruef_staging.php).
check('KRITISCH: ein leerer Wert gilt als offener DEMO_TESTMAIL-Platzhalter',
    platzhalter_offen('', '__DEMO_TESTMAIL'));
check('KRITISCH: der unersetzte DEMO_TESTMAIL-Platzhalter selbst gilt als offen',
    platzhalter_offen('__DEMO_TESTMAIL__', '__DEMO_TESTMAIL'));
check('KRITISCH: ein echter, konfigurierter DEMO_TESTMAIL-Wert gilt NICHT als offen',
    !platzhalter_offen('demo-postfach@beispiel.ch', '__DEMO_TESTMAIL'));

// DER Kernfall dieser Suite, als Quelltext-Kopplung geprueft (zur Laufzeit
// nicht erreichbar, siehe oben): smtp_ziel() darf im Demo-Zweig NICHT auf
// __STAGING_TESTMAIL__ zurueckfallen, und der Staging-Zweig darf NICHT
// __DEMO_TESTMAIL__ lesen. Geprueft wird die STRUKTUR (welche Konstante
// im jeweiligen Zweig steht), nicht nur, ob beide Woerter irgendwo in der
// Datei vorkommen -- eine Regression, die $istDemo ignoriert und immer
// __STAGING_TESTMAIL__ liest, waere sonst unsichtbar.
{
    // Bewusst einfache Textanker statt Klammer-Parsing (ein Regex kann
    // verschachtelte { } nicht zuverlaessig zaehlen): Der Demo-Zweig steht
    // im Quelltext IMMER vor dem Staging-Zweig (siehe smtp_ziel() in
    // mailer.php) -- die Position von "$istDemo" trennt "davor" (Kopf der
    // Funktion) von "Demo-Zweig bis zum Staging-Zweig" von "Staging-Zweig".
    $quelltext = file_get_contents(__DIR__ . '/../backend/mailer.php');
    $posFunktion = strpos($quelltext, 'function smtp_ziel(');
    $posIstDemo = $posFunktion === false ? false : strpos($quelltext, 'if ($istDemo)', $posFunktion);
    $posStagingZweig = $posIstDemo === false ? false : strpos($quelltext, "\$testAdresse = '__STAGING_TESTMAIL__'", $posIstDemo);
    $posNaechsteFunktion = $posStagingZweig === false ? false : strpos($quelltext, "\nfunction ", $posStagingZweig);

    if ($posFunktion === false || $posIstDemo === false || $posStagingZweig === false || $posNaechsteFunktion === false) {
        $bad[] = 'KRITISCH: Struktur von smtp_ziel() im Quelltext nicht wie erwartet gefunden -- Kopplungspruefung uebersprungen';
    } else {
        $demoZweig = substr($quelltext, $posIstDemo, $posStagingZweig - $posIstDemo);
        $stagingZweig = substr($quelltext, $posStagingZweig, $posNaechsteFunktion - $posStagingZweig);

        check('KRITISCH: der Demo-Zweig von smtp_ziel() liest __DEMO_TESTMAIL__',
            str_contains($demoZweig, '__DEMO_TESTMAIL__'));
        check('KRITISCH (Gegenprobe): der Demo-Zweig von smtp_ziel() liest NICHT __STAGING_TESTMAIL__',
            !str_contains($demoZweig, '__STAGING_TESTMAIL__'));
        check('KRITISCH (Gegenprobe): der Staging-Zweig von smtp_ziel() liest weiterhin __STAGING_TESTMAIL__, nicht __DEMO_TESTMAIL__',
            str_contains($stagingZweig, '__STAGING_TESTMAIL__') && !str_contains($stagingZweig, '__DEMO_TESTMAIL__'));
    }
}

// smtp_absender_name() -- Demo braucht ein EIGENES Praefix, kein
// "[STAGING]" fuer eine Demo-Mail.
check('KRITISCH: auf Produktion bleibt der konfigurierte Absendername unveraendert (istDemo irrelevant)',
    smtp_absender_name('Cupi 24 GmbH', true, true) === 'Cupi 24 GmbH');
check('KRITISCH: ausserhalb der Produktion traegt der Absender in der Demo das Praefix [DEMO], NICHT [STAGING]',
    smtp_absender_name('Cupi 24 GmbH', false, true) === '[DEMO] Cupi 24 GmbH');
check('KRITISCH (Gegenprobe): das Demo-Praefix unterscheidet sich vom Staging-Praefix bei sonst gleichen Argumenten',
    smtp_absender_name('Cupi 24 GmbH', false, true) !== smtp_absender_name('Cupi 24 GmbH', false, false));
check('KRITISCH: ein leerer Absendername bleibt in der Demo trotzdem als Demo erkennbar',
    smtp_absender_name('', false, true) === '[DEMO]');

echo "\n" . $ok . ' bestanden, ' . count($bad) . " nicht bestanden\n";
if ($bad) { foreach ($bad as $b) { echo '  x ' . $b . "\n"; } exit(1); }
echo "Alle Pruefungen bestanden.\n";
