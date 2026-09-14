<?php
declare(strict_types=1);

// KI-Sprachbefehl-Pilot (ENT-015). Nimmt bereits transkribierten Text
// entgegen (Sprach-zu-Text laeuft ueber die native Tastaturdiktierfunktion
// des Geraets, nicht hier) und zerlegt ihn per Anthropic-API in
// strukturierte Mitarbeiter-Felder. Schreibt nie selbst in die Datenbank --
// nur Extraktion, das Speichern bleibt beim Admin.

// ══════════════════════════════════════════ WARUM ES NICHT GING (ENT-530)
//
// Die Nummer: Dieser Vorgang trug zunaechst ENT-529. Eine parallel laufende
// Sitzung hatte dieselbe Nummer elf Minuten frueher vergeben (dort: die
// Betreiber-Tabellen am Einrichtungsknopf), also wurde dieser Eintrag nach
// der Regel in CLAUDE.md auf ENT-530 umgehaengt. Die Commit-Nachricht im
// Verlauf nennt noch ENT-529 -- sie steht auf main und wird nicht
// nachtraeglich umgeschrieben.
//
// Bis hierher gab jede Funktion dieser Datei bei JEDEM Fehlschlag dasselbe
// zurueck: null. Die vier Endpunkte machten daraus denselben einen Satz
// ("Erkennung nicht verfuegbar") -- gleichgueltig, ob gar kein Schluessel
// hinterlegt war, ob er abgelehnt wurde, ob das Guthaben aufgebraucht war
// oder ob der Anbieter gerade stoerte.
//
// Das ist genau der Fall, den CLAUDE.md als wichtigsten seiner Liste fuehrt:
// „Unbekannt" darf nie wie „keine" aussehen. Praktisch hiess es, dass sich
// nicht einmal mehr feststellen liess, OB ueberhaupt noch ein Schluessel
// hinterlegt ist -- weder am Bildschirm noch beim Nachsehen im Quelltext.
//
// Der Rueckgabewert bleibt null, jeder Aufrufer prueft weiterhin darauf. Der
// Grund steht daneben bereit und wird von den Endpunkten in einen eigenen
// Satz uebersetzt.

// Der Schluessel. EINE Stelle statt bisher drei -- der Deploy ersetzt den
// Platzhalter hier (.github/workflows/deploy-hostpoint.yml, Schritt
// „Platzhalter durch echte Werte ersetzen"). Ist das Secret
// ANTHROPIC_API_KEY nicht gesetzt, bricht der Deploy bewusst NICHT ab: Er
// setzt einen leeren Wert ein, und diese Datei erkennt das selbst.
function ki_schluessel(): string
{
    return '__ANTHROPIC_API_KEY__';
}

// Ist gar kein Schluessel hinterlegt? Eigene, reine Funktion, damit sich auch
// der Fall „ist hinterlegt" mit einem frei gewaehlten Testwert pruefen laesst
// -- nicht nur der eine Zustand, den diese Umgebung herstellt.
//
// Der Vergleichstext steht bewusst OHNE den abschliessenden doppelten
// Unterstrich da: Der Deploy-sed ersetzt in dieser Datei JEDES Vorkommen des
// vollstaendigen Platzhalters (also mit beiden Schlussstrichen) -- auch eines,
// das nur als Vergleich dienen soll, und auch eines in einem Kommentar. Dann
// verglichen sich echter Wert und Vergleichstext miteinander, und die Stelle
// loeste immer aus, egal was im Secret stand. Genau dieser Fehler ist in
// mailer.php schon passiert (ENT-192, dort platzhalter_offen()).
function ki_schluessel_fehlt(string $schluessel): bool
{
    return $schluessel === '' || str_contains($schluessel, '__ANTHROPIC_API_KEY');
}

// Grund des letzten Fehlschlags. Ohne Argument nur lesen.
function ki_fehlergrund(?string $neu = null): string
{
    static $grund = 'kein_ergebnis';
    if ($neu !== null) { $grund = $neu; }
    return $grund;
}

// Aus Netz- und HTTP-Ergebnis einen Grund machen. Reine Funktion mit
// uebergebenen Werten statt einer Auswertung mitten im Aufruf -- so laesst
// sich JEDER Fall pruefen, nicht nur der, den diese Umgebung gerade herstellt.
//
// $curlFehler ist curl_errno(): 0 heisst „Antwort erhalten", 28 heisst „Zeit
// abgelaufen" (CURLE_OPERATION_TIMEDOUT). Als Zahl und nicht als Konstante,
// damit die Pruefung auch ohne geladene curl-Erweiterung laeuft.
function ki_fehler_einordnen(int $curlFehler, int $httpCode, string $rumpf): string
{
    if ($curlFehler !== 0) {
        return $curlFehler === 28 ? 'zeit_abgelaufen' : 'nicht_erreichbar';
    }
    // Gar kein HTTP-Code heisst: Es kam keine Antwort. Ohne diese Zeile fiele
    // der Fall ans Ende durch und saehe aus wie eine zurueckgewiesene Anfrage
    // -- also wie ein Programmfehler statt wie ein Netzproblem.
    if ($httpCode === 0) { return 'nicht_erreichbar'; }
    if ($httpCode === 401 || $httpCode === 403) { return 'schluessel_abgelehnt'; }
    if ($httpCode === 429)                      { return 'zu_viele_anfragen'; }
    if ($httpCode >= 500)                       { return 'dienst_gestoert'; }
    // Ein aufgebrauchtes Guthaben meldet die Schnittstelle als 400 mit dem
    // Hinweis „credit balance is too low". Ohne diese Unterscheidung saehe der
    // haeufigste Betriebsfall aus wie ein Programmfehler, und man suchte im
    // Quelltext statt in der Abrechnung.
    if ($httpCode === 402) { return 'guthaben_leer'; }
    // 404 heisst bei dieser Schnittstelle NICHT "Endpunkt vertippt", sondern
    // "Modell gibt es nicht ODER dieser Zugang darf es nicht" -- die API
    // unterscheidet die beiden bewusst nicht, um Aussenstehenden nicht zu
    // verraten, welche Modelle existieren. Das ist keine Frage an den
    // Quelltext, sondern an den Zugang, und braucht darum einen eigenen Satz.
    if ($httpCode === 404) { return 'modell_nicht_verfuegbar'; }
    // 413 ist eine Groessenfrage und damit etwas, das der Bediener selbst
    // loesen kann -- als "Programmfehler" waere sie an ihm vorbeigemeldet.
    if ($httpCode === 413) { return 'anfrage_zu_gross'; }
    if ($httpCode === 400) {
        $r = strtolower($rumpf);
        if (str_contains($r, 'credit balance') || str_contains($r, 'billing')) {
            return 'guthaben_leer';
        }
        // Ein Schluessel, der fuer die ganze Organisation gilt statt fuer einen
        // Workspace, muss bei JEDER Anfrage zusaetzlich sagen, welcher
        // Workspace gemeint ist. Fehlt das, kommt ein 400 -- und der saehe
        // ohne diese Zeile aus wie ein Programmfehler im Rumpf. Genau das ist
        // am 11.09.2026 passiert und hat einen halben Vormittag gekostet: Der
        // Rumpf war in Ordnung, der Schluessel war es nicht.
        //
        // Erkannt am Namen des verlangten Kopfes, nicht am ganzen Satz -- der
        // Wortlaut der Meldung darf sich aendern, der Kopfname nicht.
        if (str_contains($r, 'anthropic-workspace-id') || str_contains($r, 'scoped to a workspace')) {
            return 'schluessel_ohne_workspace';
        }
        return 'anfrage_abgelehnt';
    }
    if ($httpCode !== 200) { return 'anfrage_abgelehnt'; }
    return 'kein_ergebnis';
}

// Die Einzelheit zum letzten Fehlschlag -- ein Satz der Schnittstelle selbst,
// kein Rumpf. Ohne Argument nur lesen.
//
// Wozu: Zwei der Gruende unten sagen "das gehoert gemeldet" bzw. "der Zugang
// darf dieses Modell nicht". Ohne die Begruendung der Gegenseite hat der
// Bediener nichts in der Hand, was er melden oder nachsehen koennte -- der
// Satz waere eine Aufforderung ohne Inhalt.
function ki_fehler_einzelheit(?string $neu = null): string
{
    static $text = '';
    if ($neu !== null) { $text = $neu; }
    return $text;
}

// Den erklaerenden Satz aus einer Fehlerantwort holen. Bewusst NUR das Feld
// error.message und nichts sonst: Es beschreibt die Zurueckweisung (etwa
// "model: ..." oder "max_tokens: ..."), nennt keine uebermittelten Werte und
// enthaelt den Schluessel nicht -- der geht im Kopf hinaus, nicht im Rumpf
// zurueck. Gekappt und von Steuerzeichen befreit, damit nichts die Anzeige
// zerlegt.
function ki_fehler_einzelheit_lesen(string $rumpf): string
{
    $data = json_decode($rumpf, true);
    $satz = is_array($data) ? (string)($data['error']['message'] ?? '') : '';
    $satz = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $satz) ?? '');
    return mb_substr($satz, 0, 200);
}

// Was der Bediener liest, und mit welchem Statuscode. Verschiedene
// Sachverhalte bekommen verschiedene Saetze -- nicht einer fuer alles. Der
// Schluessel selbst kommt in keinem dieser Texte vor, auch nicht in Teilen.
function ki_fehler_text(?string $grund = null): array
{
    $grund = $grund ?? ki_fehlergrund();
    $texte = [
        'nicht_eingerichtet' => [503,
            'Die KI-Erkennung ist nicht eingerichtet: Auf diesem Server ist kein Anthropic-Schlüssel hinterlegt.'],
        'schluessel_ohne_workspace' => [503,
            'Der hinterlegte Anthropic-Schlüssel gilt für die ganze Organisation und nicht für einen Workspace — dann verlangt die Schnittstelle bei jeder Anfrage zusätzlich die Angabe des Workspace. Abhilfe: in der Anthropic Console einen Schlüssel MIT Workspace anlegen und als Secret hinterlegen.'],
        'schluessel_abgelehnt' => [502,
            'Der hinterlegte Anthropic-Schlüssel wird nicht akzeptiert — abgelaufen, widerrufen oder falsch eingetragen.'],
        'guthaben_leer' => [502,
            'Das Anthropic-Guthaben ist aufgebraucht. Die Erkennung läuft erst wieder, wenn es aufgeladen ist.'],
        'zu_viele_anfragen' => [502,
            'Zu viele Anfragen in kurzer Zeit. In ein bis zwei Minuten nochmals versuchen.'],
        'dienst_gestoert' => [502,
            'Die Erkennung antwortet gerade nicht — eine Störung beim Anbieter. Später nochmals versuchen.'],
        'zeit_abgelaufen' => [504,
            'Die Erkennung hat zu lange gebraucht und wurde abgebrochen. Nochmals versuchen, bei einem Bild mit einem kleineren Ausschnitt.'],
        'nicht_erreichbar' => [502,
            'Der Server hat die Erkennung nicht erreicht. Das liegt am Server, nicht an Ihrem Gerät.'],
        'modell_nicht_verfuegbar' => [502,
            'Das angeforderte KI-Modell ist über diesen Zugang nicht erreichbar — entweder stimmt die Modellkennung nicht, oder der hinterlegte Schlüssel darf dieses Modell nicht verwenden.'],
        'anfrage_zu_gross' => [413,
            'Die Anfrage ist zu gross. Bei einem Bild einen kleineren Ausschnitt wählen oder es vorher verkleinern.'],
        'anfrage_abgelehnt' => [502,
            'Die Erkennung hat die Anfrage zurückgewiesen. Das ist ein Programmfehler und gehört gemeldet.'],
        'inhalt_abgelehnt' => [422,
            'Die Erkennung hat die Verarbeitung dieses Inhalts abgelehnt.'],
        'kein_ergebnis' => [422,
            'Die Erkennung hat kein verwertbares Ergebnis geliefert.'],
    ];
    [$code, $satz] = $texte[$grund] ?? [502, 'Die Erkennung ist fehlgeschlagen.'];
    // Nur bei den beiden Gruenden, die ohne die Begruendung der Gegenseite
    // nicht handhabbar sind. Bei allen uebrigen sagt der Satz schon alles,
    // und ein englischer Anhang waere nur Laerm.
    $einzelheit = ki_fehler_einzelheit();
    if ($einzelheit !== '' && in_array($grund, ['anfrage_abgelehnt', 'modell_nicht_verfuegbar'], true)) {
        $satz .= ' Die Schnittstelle sagt dazu: „' . $einzelheit . '"';
    }
    return ['grund' => $grund, 'code' => $code, 'message' => $satz];
}

// Den Fehlschlag an die Oberflaeche geben und den Ablauf beenden. Viermal
// derselbe Rumpf in den Endpunkten waeren vier Stellen, an denen ein
// kuenftiger fuenfter Endpunkt wieder beim einen Satz fuer alles landet.
// $eigenerText nur dort, wo ein Grund im jeweiligen Bereich wirklich etwas
// anderes bedeutet (siehe ki_kunden_recherche.php).
function ki_fehler_melden(?string $eigenerText = null): void
{
    $f = ki_fehler_text();
    json_response([
        'status'  => 'error',
        'message' => $eigenerText ?? $f['message'],
        'grund'   => $f['grund'],
    ], $f['code']);
}

// Den Rumpf bauen. Eigene Funktion, damit der Fehlerfall ohne Netz und ohne
// Schluessel pruefbar ist -- in ki_aufruf greift die Schluesselpruefung
// vorher, und der Fall waere dort nie erreichbar.
//
// Wozu ueberhaupt: json_encode scheitert stillschweigend an ungueltigem UTF-8
// und gibt dann false zurueck. In diese Anfrage gehen Kunden- und
// Mitarbeitendennamen aus der Datenbank ein. Ohne die Pruefung setzte curl
// das false in einen LEEREN Rumpf um, die Schnittstelle antwortete mit 400,
// und die Suche begaenne beim Bild statt bei einem Namen.
function ki_koerper(array $payload): ?string
{
    $koerper = json_encode($payload);
    if ($koerper === false) {
        ki_fehlergrund('anfrage_abgelehnt');
        ki_fehler_einzelheit('Die Anfrage liess sich nicht als JSON kodieren: ' . json_last_error_msg());
        error_log('KI-Aufruf: json_encode fehlgeschlagen -- ' . json_last_error_msg());
        return null;
    }
    return $koerper;
}

// Ein Aufruf an die Nachrichten-Schnittstelle. Alle Funktionen dieser Datei
// gehen hier durch: EINE Stelle, die den Schluessel setzt, EINE, die einen
// Fehlschlag einordnet.
function ki_aufruf(array $payload, int $timeout): ?array
{
    // Zuruecksetzen, bevor irgendetwas passiert: Sonst haengt die Begruendung
    // des VORIGEN Aufrufs an einem neuen Fehlschlag und erklaert das Falsche.
    ki_fehler_einzelheit('');

    $schluessel = ki_schluessel();
    if (ki_schluessel_fehlt($schluessel)) {
        ki_fehlergrund('nicht_eingerichtet');
        return null;
    }

    $koerper = ki_koerper($payload);
    if ($koerper === null) {
        return null;
    }

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'content-type: application/json',
            'x-api-key: ' . $schluessel,
            'anthropic-version: 2023-06-01',
        ],
        CURLOPT_POSTFIELDS => $koerper,
        CURLOPT_TIMEOUT => $timeout,
    ]);
    $antwort    = curl_exec($ch);
    $httpCode   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlFehler = curl_errno($ch);
    curl_close($ch);

    if ($antwort === false || $httpCode !== 200) {
        ki_fehlergrund(ki_fehler_einordnen($curlFehler, $httpCode, (string)$antwort));
        ki_fehler_einzelheit(ki_fehler_einzelheit_lesen((string)$antwort));
        // Der Rumpf der Fehlerantwort gehoert ins Serverprotokoll, nicht auf
        // den Bildschirm: Er hilft beim Nachsehen, und der Bediener kann
        // damit nichts anfangen. Der Schluessel steht nicht darin -- er geht
        // im Kopf hinaus, nicht im Rumpf zurueck.
        error_log('KI-Aufruf fehlgeschlagen (' . ki_fehlergrund() . ', HTTP ' . $httpCode
            . ', curl ' . $curlFehler . '): ' . substr((string)$antwort, 0, 500));
        return null;
    }

    $data = json_decode((string)$antwort, true);
    if (!is_array($data)) {
        ki_fehlergrund('kein_ergebnis');
        return null;
    }
    // Sicherheitsklassifikatoren koennen ablehnen -- das kommt als HTTP 200
    // zurueck, nicht als Fehler.
    if (($data['stop_reason'] ?? '') === 'refusal') {
        ki_fehlergrund('inhalt_abgelehnt');
        return null;
    }
    return $data;
}

// Die Eingabe des erwarteten Werkzeugs aus einer Antwort holen. Fehlt sie,
// hat das Modell geantwortet, aber nichts Brauchbares geliefert -- das ist
// etwas anderes als ein Fehlschlag des Aufrufs und bekommt seinen eigenen
// Grund.
function ki_werkzeug_eingabe(array $data, string $werkzeug): ?array
{
    foreach (($data['content'] ?? []) as $block) {
        if (($block['type'] ?? '') === 'tool_use' && ($block['name'] ?? '') === $werkzeug) {
            return $block['input'] ?? [];
        }
    }
    ki_fehlergrund('kein_ergebnis');
    return null;
}

function anthropic_tool_call(array $tool, string $userContent): ?array {
    $data = ki_aufruf([
        'model' => 'claude-haiku-4-5-20251001',
        'max_tokens' => 512,
        'tools' => [$tool],
        'tool_choice' => ['type' => 'tool', 'name' => $tool['name']],
        'messages' => [
            ['role' => 'user', 'content' => $userContent],
        ],
    ], 20);
    if ($data === null) {
        return null;
    }
    return ki_werkzeug_eingabe($data, $tool['name']);
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
        $data = ki_aufruf([
            'model' => 'claude-sonnet-5',
            'max_tokens' => 8000,
            'system' => $system,
            'tools' => [
                ['type' => 'web_search_20260209', 'name' => 'web_search', 'max_uses' => 6],
                $uebernehmen,
            ],
            'messages' => $messages,
        ], 120);
        if ($data === null) {
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

    // Vier Runden ohne Uebergabe: Der Aufruf lief, aber es kam nichts heraus.
    ki_fehlergrund('kein_ergebnis');
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

    // max_tokens deckt bei diesem Modell auch das Nachdenken ab: Sonnet 5
    // denkt standardmaessig adaptiv, und diese Token zaehlen mit. Mit den
    // frueheren 1024 konnte die Antwort mitten in der Feldliste abbrechen --
    // das Ergebnis waere dann nicht "Fehler", sondern eine STILL unvollstaendig
    // ausgefuellte Maske gewesen, und das faellt erst beim Speichern auf.
    $data = ki_aufruf([
        'model' => 'claude-sonnet-5',
        'max_tokens' => 4096,
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
    ], 45);
    if ($data === null) {
        return null;
    }
    return ki_werkzeug_eingabe($data, 'extract_einsatz_bild');
}
