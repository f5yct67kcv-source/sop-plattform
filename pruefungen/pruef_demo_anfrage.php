<?php
declare(strict_types=1);
// Demo-Anfrage von der Homepage (ENT-469): Der Rechenkern wird WIRKLICH
// ausgefuehrt (backend/demo_anfrage.php ist ohne Datenbank), der Endpunkt
// am Quelltext geprueft -- er benutzt die MySQL-eigene Bremse aus
// anmeldung.php, dieselbe Grenze wie bei pruef_passwort_reset.php.
$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

require __DIR__ . '/../backend/demo_anfrage.php';

// ══════════ RECHENKERN, ECHT AUSGEFUEHRT ═════════════════════════════
$gut = ['firma' => ' Muster Sicherheitsdienst AG ', 'name' => 'A. Beispielperson',
    'email' => 'a.beispiel@example.invalid', 'groesse' => '11 – 30', 'nachricht' => "Zeile 1\r\nZeile 2"];
$p = demo_anfrage_pruefen($gut);
pruef('Eine vollstaendige Anfrage wird angenommen', $p['fehler'] === []);
pruef('Randleerzeichen werden entfernt', $p['werte']['firma'] === 'Muster Sicherheitsdienst AG');
pruef('Die Nachricht behaelt ihre Umbrueche (nur im Rumpf, LF statt CRLF)',
    $p['werte']['nachricht'] === "Zeile 1\nZeile 2");

$leer = demo_anfrage_pruefen([]);
pruef('KRITISCH: ohne Firma, Name und E-Mail wird abgewiesen -- alle drei Felder benannt',
    isset($leer['fehler']['firma'], $leer['fehler']['name'], $leer['fehler']['email']));

$falscheMail = demo_anfrage_pruefen(array_merge($gut, ['email' => 'keine adresse']));
pruef('KRITISCH: eine ungueltige E-Mail-Adresse wird abgewiesen', isset($falscheMail['fehler']['email']));

// Header-Injection: ein Umbruch in einem Kopfzeilenfeld darf NIE bis zum
// Betreff durchkommen.
$injiziert = demo_anfrage_pruefen(array_merge($gut, ['firma' => "Firma\r\nBcc: fremd@example.invalid"]));
pruef('KRITISCH: Umbrueche in der Firma werden entfernt (keine zusaetzliche Kopfzeile)',
    $injiziert['fehler'] === [] && !str_contains($injiziert['werte']['firma'], "\n")
    && !str_contains(demo_anfrage_betreff($injiziert['werte']), "\n"));
$injiziertMail = demo_anfrage_pruefen(array_merge($gut, ['email' => "a@example.invalid\r\nCc: b@example.invalid"]));
pruef('KRITISCH: eine E-Mail-Adresse mit Umbruch gilt als ungueltig', isset($injiziertMail['fehler']['email']));

$lang = demo_anfrage_pruefen(array_merge($gut, ['firma' => str_repeat('ä', 500), 'nachricht' => str_repeat('x', 5000)]));
pruef('Ueberlange Felder werden gekuerzt, nicht abgewiesen (multibyte-sicher)',
    $lang['fehler'] === [] && mb_strlen($lang['werte']['firma']) === DEMO_MAX_FIRMA
    && mb_strlen($lang['werte']['nachricht']) === DEMO_MAX_NACHRICHT);

$fremdeGroesse = demo_anfrage_pruefen(array_merge($gut, ['groesse' => 'irgendwas']));
pruef('Eine unbekannte Betriebsgroesse wird zu "keine Angabe", nicht zum Fehler',
    $fremdeGroesse['fehler'] === [] && $fremdeGroesse['werte']['groesse'] === '');

pruef('KRITISCH: das Fallenfeld erkennt ein ausgefuelltes Feld -- und nur das',
    demo_ist_falle(['website' => 'http://spam.invalid']) && !demo_ist_falle(['website' => '  '])
    && !demo_ist_falle([]));

$text = demo_anfrage_text($p['werte'], '01.01.2000 12:00');
$html = demo_anfrage_html($p['werte'], '01.01.2000 12:00');
pruef('Der Reintext nennt Firma, Name, E-Mail und die Nachricht',
    str_contains($text, 'Muster Sicherheitsdienst AG') && str_contains($text, 'A. Beispielperson')
    && str_contains($text, 'a.beispiel@example.invalid') && str_contains($text, "Zeile 1\nZeile 2"));
$boese = demo_anfrage_pruefen(array_merge($gut, ['nachricht' => '<script>alert(1)</script>']));
$htmlBoese = demo_anfrage_html($boese['werte'], '01.01.2000 12:00');
pruef('KRITISCH: die HTML-Fassung maskiert Eingaben (kein rohes <script>)',
    !str_contains($htmlBoese, '<script>') && str_contains($htmlBoese, '&lt;script&gt;'));
// Dieselbe Lehre wie in beleg_versenden.php (ENT-206): jedes p/a/td traegt
// seine eigene Schrift, weil Outlook sie nicht vererbt.
$tags = [];
preg_match_all('/<(p|a|td)\s[^>]*>/', $html, $tags);
pruef('Jedes p/a/td-Element der HTML-Fassung traegt sein eigenes font-family',
    count($tags[0]) >= 6 && count(array_filter($tags[0], fn($t) => !str_contains($t, 'font-family'))) === 0);
pruef('Der Betreff nennt die Firma', demo_anfrage_betreff($p['werte']) === 'Demo-Anfrage von Muster Sicherheitsdienst AG');

// ══════════ ENDPUNKT, AM QUELLTEXT ═══════════════════════════════════
$q = file_get_contents(__DIR__ . '/../backend/api/demo_senden.php');
$q = preg_replace('/\/\/[^\n]*/', '', (string)$q);   // Kommentare zaehlen nicht
pruef('KRITISCH: der Endpunkt existiert', $q !== '');
pruef('Nur POST wird angenommen', (bool)preg_match("/REQUEST_METHOD'\] !== 'POST'/", $q));
pruef('KRITISCH: keine Sitzung -- der Endpunkt ist oeffentlich und verlangt bewusst keine',
    !str_contains($q, 'require_session(') && !str_contains($q, 'require_kundensession('));
pruef('KRITISCH: die Anmeldebremse wird mit dem EIGENEN Namensraum "demo:" benutzt',
    (bool)preg_match("/'demo:' \. \\\$adresse/", $q)
    && str_contains($q, 'anmeld_zaehlen(') && str_contains($q, 'anmeld_sperre(') && str_contains($q, 'anmeld_fehlversuch('));
pruef('KRITISCH: die Bremse greift VOR der Pruefung der Felder',
    strpos($q, 'anmeld_sperre(') < strpos($q, 'demo_anfrage_pruefen('));
pruef('KRITISCH: der Empfaenger kommt aus betrieb.email, nie aus der Anfrage',
    (bool)preg_match('/SELECT firma, email FROM betrieb WHERE id = 1/', $q)
    && !preg_match('/smtp_senden\(\s*\$in\b/', $q) && !preg_match('/\$in\[.empfaenger.\]/', $q));
pruef('KRITISCH: das Fallenfeld fuehrt zur selben Erfolgsantwort ohne Versand',
    (bool)preg_match('/demo_ist_falle\(\$in\)[\s\S]{0,120}DEMO_DANKE/', $q)
    && strpos($q, 'demo_ist_falle(') < strpos($q, 'smtp_senden('));
pruef('"Nicht eingerichtet" (503) und "fehlgeschlagen" (502) sind zwei verschiedene Antworten',
    substr_count($q, '503') === 2 && str_contains($q, '502'));
pruef('Der Versand wird nur versucht, wenn SMTP eingerichtet ist',
    strpos($q, 'smtp_konfiguriert()') < strpos($q, 'smtp_senden('));

// ══════════ AUSGABE ══════════════════════════════════════════════════
echo "\n$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "  ✗ $b\n"; }
exit($bad ? 1 : 0);
