<?php
declare(strict_types=1);

// KI-Sprachbefehl-Pilot (ENT-015). Nimmt bereits transkribierten Text
// entgegen (Sprach-zu-Text laeuft ueber die native Tastaturdiktierfunktion
// des Geraets, nicht hier) und zerlegt ihn per Anthropic-API in
// strukturierte Mitarbeiter-Felder. Schreibt nie selbst in die Datenbank --
// nur Extraktion, das Speichern bleibt beim Admin.

function anthropic_tool_call(array $tool, string $userContent): ?array {
    $apiKey = '__ANTHROPIC_API_KEY__';
    if ($apiKey === '' || str_contains($apiKey, '__ANTHROPIC_API_KEY')) {
        return null; // nicht konfiguriert
    }

    $payload = [
        'model' => 'claude-haiku-4-5-20251001',
        'max_tokens' => 512,
        'tools' => [$tool],
        'tool_choice' => ['type' => 'tool', 'name' => $tool['name']],
        'messages' => [
            ['role' => 'user', 'content' => $userContent],
        ],
    ];

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'content-type: application/json',
            'x-api-key: ' . $apiKey,
            'anthropic-version: 2023-06-01',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_TIMEOUT => 20,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response === false || $httpCode !== 200) {
        return null;
    }

    $data = json_decode($response, true);
    foreach (($data['content'] ?? []) as $block) {
        if (($block['type'] ?? '') === 'tool_use' && ($block['name'] ?? '') === $tool['name']) {
            return $block['input'] ?? [];
        }
    }
    return null;
}

// Kunden-Recherche (ENT-019). Anders als die Funktionen oben: hier darf das
// Modell zuerst im Internet suchen und uebergibt erst danach die Felder.
// Deshalb kein erzwungenes tool_choice (das wuerde die Suche blockieren) und
// eine Schleife statt eines Einzelaufrufs.
//
// Gesucht wird der statutarische Sitz aus dem Handelsregister -- das ist die
// Rechnungsadresse. Der Arbeitsort eines Einsatzes ist etwas anderes und wird
// hier bewusst nicht ermittelt.
function anthropic_recherche_kunde(string $text): ?array
{
    $apiKey = '__ANTHROPIC_API_KEY__';
    if ($apiKey === '' || str_contains($apiKey, '__ANTHROPIC_API_KEY')) {
        return null;
    }

    // Seit ENT-044 fuehrt der Kundenstamm PLZ, Ort und Hausnummer getrennt und
    // kennt UID und Webseite. Genau diese Angaben stehen im Handelsregister --
    // die Recherche liefert sie darum gleich mit, statt dass sie hinterher von
    // Hand nachgetragen werden (KI-Effizienz nach ENT-012).
    $felder = ['name', 'strasse', 'hausnummer', 'plz', 'ort', 'telefon', 'email', 'webseite', 'uid'];

    $uebernehmen = [
        'name' => 'kunde_uebernehmen',
        'description' => 'Uebergibt die ermittelten Kundendaten an die Eingabemaske. Genau einmal aufrufen, am Ende.',
        'input_schema' => [
            'type' => 'object',
            'properties' => [
                'name'     => ['type' => 'string', 'description' => 'Offizieller Firmenname inkl. Rechtsform, z.B. "Beispiel AG"'],
                'strasse'  => ['type' => 'string', 'description' => 'Nur der Strassenname des Firmensitzes, OHNE Hausnummer und ohne Ort'],
                'hausnummer' => ['type' => 'string', 'description' => 'Nur die Hausnummer, z.B. "4" oder "12a"'],
                'plz'      => ['type' => 'string', 'description' => 'Nur die vierstellige Postleitzahl, z.B. "4600"'],
                'ort'      => ['type' => 'string', 'description' => 'Nur der Ortsname ohne Postleitzahl, z.B. "Musterdorf"'],
                'telefon'  => ['type' => 'string', 'description' => 'Allgemeine Telefonnummer der Firma'],
                'email'    => ['type' => 'string', 'description' => 'Allgemeine E-Mail-Adresse der Firma'],
                'webseite' => ['type' => 'string', 'description' => 'Adresse der Firmenwebseite, z.B. "https://www.beispiel.ch"'],
                'uid'      => ['type' => 'string', 'description' => 'Schweizer Unternehmens-Identifikationsnummer in der Form CHE-123.456.789. Nur uebernehmen, wenn sie belegt im Handelsregister steht.'],
                'recherchiert' => [
                    'type' => 'array',
                    'items' => ['type' => 'string', 'enum' => $felder],
                    'description' => 'Feldnamen, deren Wert aus dem Internet stammt und nicht vom Benutzer genannt wurde.',
                ],
                'quellen' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                    'description' => 'Die URLs, auf die sich die recherchierten Werte stuetzen. Hoechstens drei.',
                ],
            ],
            'required' => ['name'],
        ],
    ];

    $system =
        "Du ermittelst Stammdaten Schweizer Firmen fuer eine Kundendatei. Die Adresse ist immer der "
        . "statutarische Sitz aus dem Handelsregister (Zefix) -- das ist die Rechnungsadresse.\n\n"
        . "Regeln:\n"
        . "- Erfinde nichts. Ein Feld, das du nicht belegen kannst, laesst du weg. Eine Luecke ist "
        . "richtig, eine plausible Erfindung ist ein Schaden.\n"
        . "- Suche zuerst im Internet, rufe danach kunde_uebernehmen genau einmal auf.\n"
        . "- Uebernimm Angaben, die der Benutzer bereits genannt hat, unveraendert und fuehre sie "
        . "NICHT in 'recherchiert'.\n"
        . "- Findest du mehrere Firmen mit aehnlichem Namen, nimm die, die zum genannten Ort passt. "
        . "Passt keine eindeutig, uebergib nur den Namen und lass den Rest leer.";

    $messages = [['role' => 'user', 'content' => $text]];

    // Hoechstens vier Runden: die Suche laeuft serverseitig, aber lange Laeufe
    // brechen mit stop_reason "pause_turn" ab und muessen erneut angestossen
    // werden.
    for ($runde = 0; $runde < 4; $runde++) {
        $payload = [
            'model' => 'claude-sonnet-5',
            'max_tokens' => 8000,
            'system' => $system,
            'tools' => [
                ['type' => 'web_search_20260209', 'name' => 'web_search', 'max_uses' => 6],
                $uebernehmen,
            ],
            'messages' => $messages,
        ];

        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'content-type: application/json',
                'x-api-key: ' . $apiKey,
                'anthropic-version: 2023-06-01',
            ],
            CURLOPT_POSTFIELDS => json_encode($payload),
            CURLOPT_TIMEOUT => 120,
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response === false || $httpCode !== 200) {
            return null;
        }

        $data = json_decode($response, true);

        // Sicherheitsklassifikatoren koennen ablehnen -- das kommt als HTTP 200
        // zurueck, nicht als Fehler.
        if (($data['stop_reason'] ?? '') === 'refusal') {
            return null;
        }

        foreach (($data['content'] ?? []) as $block) {
            if (($block['type'] ?? '') === 'tool_use' && ($block['name'] ?? '') === 'kunde_uebernehmen') {
                return $block['input'] ?? [];
            }
        }

        // Lange Suchlaeufe pausieren -- unveraendert erneut anstossen.
        if (($data['stop_reason'] ?? '') === 'pause_turn') {
            $messages[] = ['role' => 'assistant', 'content' => $data['content'] ?? []];
            continue;
        }

        break;
    }

    return null;
}

// Zerlegt einen Planungsbefehl der Art "setze die Schliessrunde jeden Tag auf
// den August" (ENT-026). Objekt und Zeitraum kommen aus dem Bildschirm, der
// Satz muss sie nicht nennen -- was gesagt wird, hat aber Vorrang.
function anthropic_extract_masterplan(string $text, array $vorlagen, string $heute, string $monat): ?array
{
    $tool = [
        'name' => 'extract_masterplan',
        'description' => 'Ordnet einem Planungsbefehl Schichtvorlagen und einen Bedarf je Wochentag zu.',
        'input_schema' => [
            'type' => 'object',
            'properties' => [
                'von' => ['type' => 'string', 'description' => 'Beginn des Zeitraums, Format JJJJ-MM-TT. Nur wenn genannt.'],
                'bis' => ['type' => 'string', 'description' => 'Ende des Zeitraums, Format JJJJ-MM-TT. Nur wenn genannt.'],
                'vorlagen' => [
                    'type' => 'array',
                    'description' => 'Die angesprochenen Schichtvorlagen mit dem Bedarf je Wochentag. '
                        . 'Nur Vorlagen aus der Liste. Wird keine bestimmte genannt (z.B. "alle Schichten"), '
                        . 'alle aufnehmen.',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'id' => ['type' => 'integer', 'description' => 'ID aus der Liste der Vorlagen.'],
                            'bedarf_mo' => ['type' => 'integer'],
                            'bedarf_di' => ['type' => 'integer'],
                            'bedarf_mi' => ['type' => 'integer'],
                            'bedarf_do' => ['type' => 'integer'],
                            'bedarf_fr' => ['type' => 'integer'],
                            'bedarf_sa' => ['type' => 'integer'],
                            'bedarf_so' => ['type' => 'integer'],
                            'bedarf_feiertag' => ['type' => 'integer'],
                        ],
                        'required' => ['id'],
                    ],
                ],
            ],
            'required' => ['vorlagen'],
        ],
    ];

    $liste = $vorlagen
        ? implode("\n", array_map(
            fn($v) => "- id {$v['id']}: " . trim(($v['kuerzel'] ? $v['kuerzel'] . ' · ' : '') . $v['name'])
                . ' (' . substr((string)$v['von'], 0, 5) . '–' . substr((string)$v['bis'], 0, 5) . ')',
            $vorlagen))
        : '(keine Vorlagen vorhanden)';

    $userContent =
        "Heutiges Datum: {$heute}. Auf dem Bildschirm steht gerade der Monat {$monat}.\n\n"
        . "Schichtvorlagen dieses Objekts:\n{$liste}\n\n"
        . "Regeln:\n"
        . "- Nur IDs aus der Liste verwenden. Erfinde keine.\n"
        . "- \"jeden Tag\" heisst Bedarf 1 an allen sieben Wochentagen und am Feiertag.\n"
        . "- \"unter der Woche\" heisst Mo bis Fr, Sa und So bleiben 0.\n"
        . "- \"am Wochenende\" heisst Sa und So, Mo bis Fr bleiben 0.\n"
        . "- Wird eine Anzahl genannt (\"mit zwei Leuten\"), gilt sie fuer die genannten Tage.\n"
        . "- Wird kein Zeitraum genannt, von und bis weglassen.\n"
        . "- Ein Wochentag ohne Angabe bekommt 0.\n\n"
        . "Befehl:\n{$text}";

    return anthropic_tool_call($tool, $userContent);
}

// Zerlegt "setze Vito vom 1. bis 15. August auf die Schliessrunde" (ENT-026).
function anthropic_extract_zuteilung(string $text, array $vorlagen, array $mitarbeiter, string $heute, string $monat): ?array
{
    $tool = [
        'name' => 'extract_zuteilung',
        'description' => 'Ordnet einem Befehl Personen, eine Schichtvorlage und einen Zeitraum zu.',
        'input_schema' => [
            'type' => 'object',
            'properties' => [
                'masterschicht_id' => [
                    'type' => 'integer',
                    'description' => 'ID der gemeinten Schichtvorlage aus der Liste. Eine Tageszeit wie '
                        . '"Vormittag" oder "Nachtschicht" ueber die Uhrzeiten zuordnen.',
                ],
                'mitarbeiter_login_namen' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                    'description' => 'Login-Namen der genannten Personen, exakt wie in der Liste.',
                ],
                'von' => ['type' => 'string', 'description' => 'Beginn, Format JJJJ-MM-TT. Nur wenn genannt.'],
                'bis' => ['type' => 'string', 'description' => 'Ende, Format JJJJ-MM-TT. Nur wenn genannt.'],
            ],
            'required' => ['masterschicht_id', 'mitarbeiter_login_namen'],
        ],
    ];

    $liste = $vorlagen
        ? implode("\n", array_map(
            fn($v) => "- id {$v['id']}: " . trim(($v['kuerzel'] ? $v['kuerzel'] . ' · ' : '') . $v['name'])
                . ' (' . substr((string)$v['von'], 0, 5) . '–' . substr((string)$v['bis'], 0, 5) . ')',
            $vorlagen))
        : '(keine Vorlagen vorhanden)';
    $maText = $mitarbeiter
        ? implode("\n", array_map(
            fn($m) => "- {$m['name']}: " . trim(($m['vorname'] ?? '') . ' ' . ($m['nachname'] ?? '')),
            $mitarbeiter))
        : '(keine Mitarbeitenden erfasst)';

    $userContent =
        "Heutiges Datum: {$heute}. Auf dem Bildschirm steht gerade der Monat {$monat}.\n\n"
        . "Schichtvorlagen dieses Objekts:\n{$liste}\n\n"
        . "Bekannte Mitarbeitende (Login-Name: Vorname Nachname):\n{$maText}\n\n"
        . "Regeln:\n"
        . "- Nur IDs und Login-Namen aus den Listen. Erfinde nichts.\n"
        . "- Ein Datum ohne Monat gehoert in den Monat auf dem Bildschirm.\n"
        . "- Wird kein Zeitraum genannt, von und bis weglassen.\n\n"
        . "Befehl:\n{$text}";

    return anthropic_tool_call($tool, $userContent);
}

// Ordnet ein Diktat einem Bereich zu und extrahiert im selben Zug dessen
// Felder (ENT-032) -- ein Aufruf statt zwei, damit der Router nicht spuerbar
// langsamer ist als die frueheren Einzel-Diktate. Deckt die Neuanlage aller
// drei Bereiche ab, und seit ENT-042 zusaetzlich die AENDERUNG eines
// bestehenden Mitarbeitenden -- fuer Kunde/Einsatz gibt es das bewusst
// weiterhin nicht (dafuer gab es auch vorher keinen eigenen Diktat-Weg, das
// Risiko eines falsch getroffenen Datensatzes bei einer Aenderung waere ohne
// jede Erfahrung damit unnoetig).
function anthropic_route_diktat(string $text, array $kunden, array $mitarbeiter, string $heute): ?array
{
    $tool = [
        'name' => 'route_diktat',
        'description' => 'Ordnet einen diktierten oder getippten Text einem Bereich zu und extrahiert dessen Felder.',
        'input_schema' => [
            'type' => 'object',
            'properties' => [
                'bereich' => [
                    'type' => 'string',
                    'enum' => ['mitarbeiter', 'kunde', 'einsatz'],
                    'description' => 'mitarbeiter: eine neue oder zu aendernde Person des Personals. kunde: eine neue '
                        . 'Firma fuer die Kundendatei. einsatz: ein geplanter Auftrag oder Termin mit Datum und Zeit.',
                ],
                'aktion' => [
                    'type' => 'string',
                    'enum' => ['neu', 'aendern'],
                    'description' => 'neu: eine neue Person/Firma/ein neuer Einsatz (Standardfall). aendern: nur '
                        . 'moeglich, wenn bereich = mitarbeiter -- der Text beschreibt eine Aenderung an einer '
                        . 'bereits bekannten Person aus der Liste (z.B. "Aendere die Adresse von ...", "... hat '
                        . 'eine neue Telefonnummer"). Ist unklar, ob Neuanlage oder Aenderung gemeint ist, oder '
                        . 'passt keine bekannte Person eindeutig, waehle neu.',
                ],
                'mitarbeiter' => [
                    'type' => 'object',
                    'description' => 'Nur ausfuellen, wenn bereich = mitarbeiter und aktion = neu.',
                    'properties' => [
                        // Keine personalnummer: sie wird seit ENT-387 automatisch
                        // vergeben und liesse sich aus einem Diktat ohnehin nicht
                        // uebernehmen -- die Angabe wuerde nur eine Erwartung wecken,
                        // die das Anlegen dann stillschweigend verwirft.
                        'vorname' => ['type' => 'string'], 'nachname' => ['type' => 'string'],
                        'anrede' => ['type' => 'string', 'enum' => ['Herr', 'Frau', 'Divers']],
                        'geburtsdatum' => ['type' => 'string', 'description' => 'Format JJJJ-MM-TT'],
                        'strasse' => ['type' => 'string'], 'ort' => ['type' => 'string'],
                        'telefon' => ['type' => 'string'], 'mobil' => ['type' => 'string'],
                        'email' => ['type' => 'string'],
                    ],
                ],
                'mitarbeiter_aenderung' => [
                    'type' => 'object',
                    'description' => 'Nur ausfuellen, wenn bereich = mitarbeiter und aktion = aendern.',
                    'properties' => [
                        'mitarbeiter_login_name' => [
                            'type' => 'string',
                            'description' => 'Login-Name der gemeinten Person, exakt wie in der Liste angegeben, '
                                . 'auch wenn der Text einen Tippfehler oder eine Umschreibung enthaelt.',
                        ],
                        'aenderungen' => [
                            'type' => 'object',
                            'description' => 'Nur die tatsaechlich im Text genannten Felder eintragen, alle anderen weglassen.',
                            'properties' => [
                                // Keine personalnummer hier: sie laesst sich seit
                                // ENT-387 nicht mehr aendern (weder beim Anlegen
                                // noch beim Bearbeiten).
                                'anrede' => ['type' => 'string', 'enum' => ['Herr', 'Frau', 'Divers']],
                                'vorname' => ['type' => 'string'], 'nachname' => ['type' => 'string'],
                                'geburtsdatum' => ['type' => 'string', 'description' => 'Format JJJJ-MM-TT'],
                                'strasse' => ['type' => 'string'], 'ort' => ['type' => 'string'],
                                'telefon' => ['type' => 'string'], 'mobil' => ['type' => 'string'],
                                'email' => ['type' => 'string'],
                            ],
                        ],
                    ],
                ],
                'kunde' => [
                    'type' => 'object',
                    'description' => 'Nur ausfuellen, wenn bereich = kunde.',
                    // PLZ und Ort getrennt seit ENT-044 -- der Kundenstamm
                    // fuehrt sie in zwei Feldern, und Zusammensetzen ist
                    // einfacher als spaeteres Auseinandernehmen.
                    'properties' => [
                        'name' => ['type' => 'string'], 'strasse' => ['type' => 'string'],
                        'hausnummer' => ['type' => 'string'],
                        'plz' => ['type' => 'string', 'description' => 'Nur die vierstellige Postleitzahl.'],
                        'ort' => ['type' => 'string', 'description' => 'Nur der Ortsname, ohne Postleitzahl.'],
                        'telefon' => ['type' => 'string'], 'email' => ['type' => 'string'],
                    ],
                ],
                'einsatz' => [
                    'type' => 'object',
                    'description' => 'Nur ausfuellen, wenn bereich = einsatz.',
                    'properties' => [
                        'kunde_name' => ['type' => 'string', 'description' => 'Steht er in der Kundenliste, exakt so schreiben wie dort.'],
                        'titel' => ['type' => 'string'], 'strasse' => ['type' => 'string'],
                        'ort' => ['type' => 'string', 'description' => 'PLZ und Ort des Arbeitsortes.'],
                        'datum' => ['type' => 'string', 'description' => 'Format JJJJ-MM-TT'],
                        'von' => ['type' => 'string', 'description' => 'Format HH:MM'],
                        'bis' => ['type' => 'string', 'description' => 'Format HH:MM'],
                        'bedarf' => ['type' => 'integer'],
                        'einsatzart' => ['type' => 'string'],
                        'mitarbeiter_login_namen' => ['type' => 'array', 'items' => ['type' => 'string']],
                        'bemerkung' => ['type' => 'string'],
                    ],
                ],
            ],
            'required' => ['bereich'],
        ],
    ];

    $kundenText = $kunden ? implode("\n", array_map(fn($k) => '- ' . $k, $kunden)) : '(keine Kunden erfasst)';
    $maText = $mitarbeiter
        ? implode("\n", array_map(fn($m) => "- {$m['name']}: " . trim(($m['vorname'] ?? '') . ' ' . ($m['nachname'] ?? '')), $mitarbeiter))
        : '(keine Mitarbeitenden erfasst)';

    $userContent =
        "Heutiges Datum: {$heute}.\n\n"
        . "Bekannte Kunden:\n{$kundenText}\n\n"
        . "Bekannte Mitarbeitende (Login-Name: Vorname Nachname):\n{$maText}\n\n"
        . "Erkenne, ob der Text eine neue Person, eine neue Firma oder einen geplanten Einsatz beschreibt, "
        . "und fuelle nur das passende der drei Felder. Beschreibt der Text stattdessen eine AENDERUNG an "
        . "einer bereits bekannten Person aus der Liste, setze bereich auf mitarbeiter, aktion auf aendern "
        . "und fuelle mitarbeiter_aenderung statt mitarbeiter. Erfinde nichts -- ein Feld, das im Text nicht "
        . "vorkommt, laesst du weg.\n\n"
        . "Text:\n{$text}";

    return anthropic_tool_call($tool, $userContent);
}

// Liest einen Einsatz aus einem Bild (Screenshot einer E-Mail, eines Auftrags-
// zettels o.ae.) heraus (ENT-032). Fuer Bilder wird das staerkere Modell
// verwendet -- Text in einem Foto zuverlaessig zu lesen ist schwerer als
// einen bereits sauberen Satz zu zerlegen.
function anthropic_extract_einsatz_bild(string $bildBase64, string $mimeType, array $kunden, array $mitarbeiter, string $heute): ?array
{
    $apiKey = '__ANTHROPIC_API_KEY__';
    if ($apiKey === '' || str_contains($apiKey, '__ANTHROPIC_API_KEY')) {
        return null;
    }

    $tool = [
        'name' => 'extract_einsatz_bild',
        'description' => 'Extrahiert einen geplanten Einsatz aus einem Bild.',
        'input_schema' => [
            'type' => 'object',
            'properties' => [
                'kunde_name' => ['type' => 'string', 'description' => 'Steht er in der Kundenliste, exakt so schreiben wie dort.'],
                'titel' => ['type' => 'string'],
                'strasse' => ['type' => 'string', 'description' => 'Strasse des ARBEITSORTES, nicht der Firmensitz.'],
                'ort' => ['type' => 'string', 'description' => 'PLZ und Ort des ARBEITSORTES.'],
                'datum' => ['type' => 'string', 'description' => 'Format JJJJ-MM-TT'],
                'von' => ['type' => 'string', 'description' => 'Format HH:MM'],
                'bis' => ['type' => 'string', 'description' => 'Format HH:MM'],
                'bedarf' => ['type' => 'integer'],
                'einsatzart' => ['type' => 'string'],
                'mitarbeiter_login_namen' => ['type' => 'array', 'items' => ['type' => 'string']],
                'bemerkung' => ['type' => 'string', 'description' => 'Zusatzangaben, die in kein anderes Feld passen.'],
                'unsicher' => [
                    'type' => 'boolean',
                    'description' => 'true, wenn das Bild keinen erkennbaren Auftrag zeigt oder wesentliche Angaben fehlen.',
                ],
            ],
        ],
    ];

    $kundenText = $kunden ? implode("\n", array_map(fn($k) => '- ' . $k, $kunden)) : '(keine Kunden erfasst)';
    $maText = $mitarbeiter
        ? implode("\n", array_map(fn($m) => "- {$m['name']}: " . trim(($m['vorname'] ?? '') . ' ' . ($m['nachname'] ?? '')), $mitarbeiter))
        : '(keine Mitarbeitenden erfasst)';
    $system =
        "Heutiges Datum: {$heute}. Relative Angaben (\"morgen\", \"naechsten Montag\") darauf beziehen.\n\n"
        . "Bekannte Kunden:\n{$kundenText}\n\nBekannte Mitarbeitende (Login-Name: Vorname Nachname):\n{$maText}\n\n"
        . "Das Bild zeigt vermutlich eine E-Mail, eine Nachricht oder einen Auftragszettel eines Kunden. "
        . "Lies daraus einen geplanten Einsatz heraus. Erfinde nichts -- ein Feld, das nicht eindeutig "
        . "aus dem Bild hervorgeht, laesst du weg. Ist kein Auftrag erkennbar, setze unsicher auf true "
        . "und fuelle so viel wie moeglich trotzdem aus.";

    $payload = [
        'model' => 'claude-sonnet-5',
        'max_tokens' => 1024,
        'system' => $system,
        'tools' => [$tool],
        'tool_choice' => ['type' => 'tool', 'name' => 'extract_einsatz_bild'],
        'messages' => [[
            'role' => 'user',
            'content' => [
                ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $mimeType, 'data' => $bildBase64]],
                ['type' => 'text', 'text' => 'Lies den Auftrag aus diesem Bild.'],
            ],
        ]],
    ];

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'content-type: application/json',
            'x-api-key: ' . $apiKey,
            'anthropic-version: 2023-06-01',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_TIMEOUT => 45,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response === false || $httpCode !== 200) {
        return null;
    }
    $data = json_decode($response, true);
    if (($data['stop_reason'] ?? '') === 'refusal') {
        return null;
    }
    foreach (($data['content'] ?? []) as $block) {
        if (($block['type'] ?? '') === 'tool_use' && ($block['name'] ?? '') === 'extract_einsatz_bild') {
            return $block['input'] ?? [];
        }
    }
    return null;
}
