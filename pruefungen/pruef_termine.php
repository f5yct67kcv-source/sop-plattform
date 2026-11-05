<?php
declare(strict_types=1);
// Terminbuchung "Betrieb besprechen" (ENT-731): die Rechnung ohne Netz,
// echt ausgefuehrt. Aufgerufen von test_termine.mjs.
//
// Alle Daten relativ zu heute (test_datumsfest.mjs): Ein festes Datum nahe
// am heutigen Tag kippte beim Datumswechsel.
$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

require __DIR__ . '/../backend/termine_kalender.php';

$zone = new DateTimeZone(TERMIN_ZONE);
$heute = new DateTimeImmutable('today', $zone);
$von = termin_fruehestens($heute);
$bis = termin_spaetestens($heute);
$tag = $heute->modify('+3 days');                      // ein Tag sicher im Fenster
$d = $tag->format('Ymd');
$ical = fn(string $inhalt) => "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n$inhalt\r\nEND:VCALENDAR\r\n";

// ── Freigabefenster und Belegtes ──────────────────────────────────────
$frei = termin_ics_lesen($ical("BEGIN:VEVENT\r\nUID:f1\r\nSUMMARY:frei\r\nDTSTART;TZID=Europe/Zurich:{$d}T140000\r\nDTEND;TZID=Europe/Zurich:{$d}T170000\r\nEND:VEVENT"));
$zeiten = termin_freie_zeiten($frei, $von, $bis);
pruef('Ein Fenster "frei" 14-17 Uhr ergibt Plaetze im Abstand von 30 + 15 Minuten',
    ($zeiten[$tag->format('Y-m-d')] ?? []) === ['14:00', '14:45', '15:30', '16:15']);

$belegt = termin_ics_lesen($ical("BEGIN:VEVENT\r\nUID:b1\r\nSUMMARY:Zahnarzt\r\nDTSTART;TZID=Europe/Zurich:{$d}T143000\r\nDTEND;TZID=Europe/Zurich:{$d}T150000\r\nEND:VEVENT"));
$zeiten = termin_freie_zeiten(array_merge($frei, $belegt), $von, $bis);
pruef('KRITISCH: ein anderer Termin blockiert samt Puffer, die Zeiten danach bleiben frei',
    ($zeiten[$tag->format('Y-m-d')] ?? []) === ['15:30', '16:15']);

$nurBelegt = termin_freie_zeiten($belegt, $von, $bis);
pruef('KRITISCH: ohne Freigabe "frei" ist nichts buchbar -- auch nicht neben einem Termin', $nurBelegt === []);

$abgesagt = termin_ics_lesen($ical("BEGIN:VEVENT\r\nUID:b2\r\nSUMMARY:Sitzung\r\nSTATUS:CANCELLED\r\nDTSTART;TZID=Europe/Zurich:{$d}T140000\r\nDTEND;TZID=Europe/Zurich:{$d}T170000\r\nEND:VEVENT"));
pruef('Ein abgesagter Termin blockiert nicht',
    count(termin_freie_zeiten(array_merge($frei, $abgesagt), $von, $bis)[$tag->format('Y-m-d')] ?? []) === 4);

$heuteFrei = termin_ics_lesen($ical("BEGIN:VEVENT\r\nUID:f0\r\nSUMMARY:frei\r\nDTSTART;TZID=Europe/Zurich:" . $heute->format('Ymd') . "T140000\r\nDTEND;TZID=Europe/Zurich:" . $heute->format('Ymd') . "T170000\r\nEND:VEVENT"));
pruef('Heute ist nie buchbar (Vorlauf ein Tag)', termin_freie_zeiten($heuteFrei, $von, $bis) === []);

// Wiederkehrend, wie der Projektinhaber Dienstag und Donnerstag freigibt.
// Ohne expand vom Server muss termin_vorkommen() selbst aufloesen.
$start = $heute->modify('+1 day')->format('Ymd');
$woechentlich = termin_ics_lesen($ical("BEGIN:VEVENT\r\nUID:w1\r\nSUMMARY:frei\r\nRRULE:FREQ=WEEKLY;BYDAY=TU,TH\r\nDTSTART;TZID=Europe/Zurich:{$start}T140000\r\nDTEND;TZID=Europe/Zurich:{$start}T170000\r\nEND:VEVENT"));
$wz = termin_freie_zeiten($woechentlich, $von, $bis);
$wochentage = array_unique(array_map(fn($k) => (new DateTimeImmutable($k, $zone))->format('N'), array_keys($wz)));
sort($wochentage);
pruef('Eine woechentliche Freigabe Di/Do ergibt nur Dienstage und Donnerstage, ueber vier Wochen',
    array_values($wochentage) === ['2', '4'] && count($wz) >= 7 && count($wz) <= 9);

// ── Nachkontrolle gegen die zweite Seite ──────────────────────────────
$platz = new DateTimeImmutable($tag->format('Y-m-d') . ' 14:00', $zone);
$eigene = termin_ics_lesen($ical("BEGIN:VEVENT\r\nUID:guardops-aaaaaaaaaaaaaaaaaaaa\r\nSUMMARY:GuardOpS: X\r\nDTSTART;TZID=Europe/Zurich:{$d}T140000\r\nDTEND;TZID=Europe/Zurich:{$d}T143000\r\nEND:VEVENT"));
$fremde = termin_ics_lesen($ical("BEGIN:VEVENT\r\nUID:formateins-bbbbbbbbbbbbbbbbbbbb\r\nSUMMARY:Gespräch: Y\r\nDTSTART;TZID=Europe/Zurich:{$d}T140000\r\nDTEND;TZID=Europe/Zurich:{$d}T143000\r\nEND:VEVENT"));
pruef('Die eigene Buchung allein ist keine Ueberschneidung',
    !termin_ueberschneidung(array_merge($frei, $eigene), $platz->getTimestamp(), 'guardops-aaaaaaaaaaaaaaaaaaaa', $bis));
pruef('KRITISCH: eine gleichzeitige Buchung der anderen Seite wird erkannt',
    termin_ueberschneidung(array_merge($frei, $eigene, $fremde), $platz->getTimestamp(), 'guardops-aaaaaaaaaaaaaaaaaaaa', $bis));

// ── Eingaben ──────────────────────────────────────────────────────────
$gut = ['art' => 'video', 'datum' => $tag->format('Y-m-d'), 'zeit' => '14:00', 'firma' => 'Muster Sicherheitsdienst AG',
    'name' => 'A. Beispielperson', 'telefon' => '079 123 45 67', 'email' => 'a.beispiel@example.ch'];
$p = termin_eingabe_pruefen($gut);
pruef('Eine vollstaendige Buchung wird angenommen', $p['fehler'] === [] && $p['werte']['beginn'] instanceof DateTimeImmutable);
$leer = termin_eingabe_pruefen([]);
pruef('KRITISCH: ohne Art, Zeit, Betrieb, Name, Telefon und E-Mail wird abgewiesen -- jedes Feld benannt',
    isset($leer['fehler']['art'], $leer['fehler']['zeit'], $leer['fehler']['firma'], $leer['fehler']['name'], $leer['fehler']['telefon'], $leer['fehler']['email']));
pruef('Ein erfundenes Datum (31. Februar) gilt nicht als Zeit',
    isset(termin_eingabe_pruefen(['datum' => $tag->format('Y') . '-02-31', 'zeit' => '14:00'] + $gut)['fehler']['zeit']));
pruef('KRITISCH: ein Zeilenumbruch in der E-Mail-Adresse wird abgewiesen',
    isset(termin_eingabe_pruefen(['email' => "a@example.ch\r\nBcc: x@example.ch"] + $gut)['fehler']['email']));
pruef('Telefon: drei Schreibweisen derselben Nummer gehen durch, neun beliebige Ziffern nicht',
    termin_telefon_gueltig('079 123 45 67') && termin_telefon_gueltig('+41 79 123 45 67') && termin_telefon_gueltig('0041791234567')
    && !termin_telefon_gueltig('123456789') && !termin_telefon_gueltig('079 12'));

// ── Zugang, UID, Kalenderdatei ────────────────────────────────────────
pruef('KRITISCH: ohne Zugangsdatei ist die Buchung nicht eingerichtet', termin_zugang() === null);
pruef('Ein leerer Benutzer oder eine Adresse ohne TLS gilt nicht als Zugang',
    termin_zugang_pruefen('https://k.example/', '', 'x') === null && termin_zugang_pruefen('http://k.example/', 'a', 'x') === null
    && termin_zugang_pruefen('https://k.example', 'a', 'x')['url'] === 'https://k.example/');
pruef('Nur UIDs dieser Seite sind absagbar -- eine von formateins nicht',
    termin_uid_gueltig('guardops-0123456789abcdef0123') && !termin_uid_gueltig('formateins-0123456789abcdef0123')
    && !termin_uid_gueltig('guardops-../../x'));
$z = ['passwort' => 'geheim'];
pruef('Die Absage-Signatur haengt an UID und Zugang',
    termin_schluessel($z, 'guardops-0123456789abcdef0123') !== termin_schluessel($z, 'guardops-0123456789abcdef0124')
    && termin_schluessel($z, 'guardops-0123456789abcdef0123') !== termin_schluessel(['passwort' => 'anders'], 'guardops-0123456789abcdef0123'));
$ics = termin_ics('guardops-0123456789abcdef0123', $platz, str_repeat('Langer Titel mit Umlauten äöü ', 6), 'Zeile 1' . "\n" . 'Zeile 2; mit, Zeichen');
$zuLang = array_filter(explode("\r\n", $ics), fn($l) => strlen($l) > 75);
pruef('Der Kalendereintrag faltet lange Zeilen (RFC 5545) und schliesst sauber',
    $zuLang === [] && str_ends_with($ics, "END:VCALENDAR\r\n") && str_contains($ics, 'Zeile 2\; mit\, Zeichen'));
$zurueck = termin_ics_lesen($ics)[0] ?? [];
pruef('Was termin_ics() schreibt, liest termin_ics_lesen() wieder -- Zeit und Titel',
    ($zurueck['beginn'] ?? null) == $platz && str_starts_with($zurueck['titel'] ?? '', 'Langer Titel mit Umlauten äöü'));
pruef('Der Kalendertitel traegt die Marke vorn -- im gemeinsamen Kalender unterscheidbar',
    str_starts_with(termin_titel($p['werte']), 'GuardOpS:'));

echo json_encode(['ok' => $ok, 'bad' => $bad]);
