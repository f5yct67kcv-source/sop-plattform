<?php
// Fachlogik rund um Kunden: Kundennummer (ENT-040), Adress- und
// Namensaufbereitung sowie Ansprechpersonen und Kommunikationswege (ENT-044).
declare(strict_types=1);

// Zulaessige Kundenarten. Bei 'privat' traegt der Datensatz Anrede, Vor- und
// Nachnamen, bei 'unternehmen' den Firmennamen.
const KUNDE_ARTEN = ['unternehmen', 'privat'];

// Zulaessige Arten eines Kommunikationswegs. Bewusst eine feste Liste statt
// Freitext: sonst stehen "Mobil", "mobile" und "Natel" nebeneinander und
// nichts laesst sich mehr auswerten.
const KONTAKT_ARTEN = ['email', 'telefon', 'mobil', 'webseite', 'fax'];

// Naechste freie Kundennummer, Format K0001 aufwaerts. Wird aus dem
// bestehenden Hoechststand abgeleitet statt aus einem eigenen Zaehler --
// so bleibt die Vergabe luecken- und kollisionsfrei, auch wenn zwischendurch
// Kunden geloescht wurden oder die Nummer aus einem Nachtrag stammt.
function naechste_kundennummer(PDO $pdo): string
{
    $s = $pdo->query(
        "SELECT kundennummer FROM kunden WHERE kundennummer REGEXP '^K[0-9]{4}$'
         ORDER BY CAST(SUBSTRING(kundennummer, 2) AS UNSIGNED) DESC LIMIT 1"
    );
    $letzte = $s->fetchColumn();
    $n = $letzte ? ((int)substr((string)$letzte, 1)) + 1 : 1;
    return 'K' . str_pad((string)$n, 4, '0', STR_PAD_LEFT);
}

// Trennt "4632 Trimbach" in ["4632", "Trimbach"]. Nur bei eindeutigem Muster
// (vier Ziffern, Leerzeichen, Rest) -- sonst bleibt alles im Ort stehen.
// Wird an drei Stellen gebraucht: beim Nachtragen der Altdaten, beim Speichern
// aus dem Admin-Bereich der Erfassung (der weiterhin ein einziges Ort-Feld
// kennt) und bei der KI-Recherche, falls sie PLZ und Ort zusammen liefert.
function plz_ort_trennen(string $wert): array
{
    $wert = trim($wert);
    if (preg_match('/^(\d{4})\s+(.+)$/u', $wert, $t)) {
        return [$t[1], trim($t[2])];
    }
    return ['', $wert];
}

// Der Name, unter dem ein Kunde ueberall sonst auftaucht (Rapporte, Einsaetze,
// Objekte verweisen per Text, nicht per Id -- siehe ENT-013/ENT-040). Bei
// einer Privatperson wird er aus Vor- und Nachnamen gebildet, damit es genau
// ein Anzeigefeld gibt statt zweier konkurrierender.
function kunde_anzeigename(string $art, string $name, string $vorname, string $nachname): string
{
    if ($art !== 'privat') {
        return trim($name);
    }
    $zusammen = trim(trim($vorname) . ' ' . trim($nachname));
    return $zusammen !== '' ? $zusammen : trim($name);
}

// Bereinigt die vom Dashboard geschickten Kommunikationszeilen: unbekannte
// Arten und leere Werte fallen weg. Leere Zeilen sind normal -- die Maske
// zeigt von sich aus welche an, damit man nicht erst "hinzufuegen" klicken
// muss.
function kontaktwege_bereinigen(array $roh): array
{
    $sauber = [];
    foreach ($roh as $z) {
        if (!is_array($z)) { continue; }
        $art = strtolower(trim((string)($z['art'] ?? '')));
        $wert = trim((string)($z['wert'] ?? ''));
        if ($wert === '' || !in_array($art, KONTAKT_ARTEN, true)) { continue; }
        $sauber[] = ['art' => $art, 'wert' => mb_substr($wert, 0, 255)];
    }
    return $sauber;
}

// Dasselbe fuer die Ansprechpersonen. Eine Person ohne jede Angabe -- weder
// Name noch Kontaktweg -- wird verworfen statt als Leerzeile gespeichert.
function personen_bereinigen(array $roh): array
{
    $sauber = [];
    foreach ($roh as $p) {
        if (!is_array($p)) { continue; }
        $person = [
            'anrede'   => mb_substr(trim((string)($p['anrede'] ?? '')), 0, 20),
            'vorname'  => mb_substr(trim((string)($p['vorname'] ?? '')), 0, 100),
            'nachname' => mb_substr(trim((string)($p['nachname'] ?? '')), 0, 100),
            'kontaktwege' => kontaktwege_bereinigen((array)($p['kontaktwege'] ?? [])),
        ];
        $leer = $person['vorname'] === '' && $person['nachname'] === '' && !$person['kontaktwege'];
        if ($leer) { continue; }
        $sauber[] = $person;
    }
    return $sauber;
}

// Ersetzt Ansprechpersonen und Kommunikationswege eines Kunden vollstaendig --
// gleiches Vorgehen wie bei der Einsatz-Zuteilung (ENT-020): das Formular
// schickt den gewuenschten Endzustand, nicht einzelne Aenderungsbefehle.
// Die Kontaktwege der Personen haengen per Fremdschluessel an der Person und
// verschwinden mit ihr.
function kunden_kinder_speichern(PDO $pdo, int $kundeId, array $kontaktwege, array $personen): void
{
    $pdo->prepare('DELETE FROM kunden_kontaktweg WHERE kunde_id = ?')->execute([$kundeId]);
    $pdo->prepare('DELETE FROM kunden_person WHERE kunde_id = ?')->execute([$kundeId]);

    $wegEin = $pdo->prepare(
        'INSERT INTO kunden_kontaktweg (kunde_id, person_id, art, wert, sortierung) VALUES (?, ?, ?, ?, ?)'
    );
    foreach ($kontaktwege as $i => $w) {
        $wegEin->execute([$kundeId, null, $w['art'], $w['wert'], $i]);
    }

    $personEin = $pdo->prepare(
        'INSERT INTO kunden_person (kunde_id, anrede, vorname, nachname, sortierung) VALUES (?, ?, ?, ?, ?)'
    );
    foreach ($personen as $i => $p) {
        $personEin->execute([$kundeId, $p['anrede'] ?: null, $p['vorname'] ?: null, $p['nachname'] ?: null, $i]);
        $personId = (int)$pdo->lastInsertId();
        foreach ($p['kontaktwege'] as $j => $w) {
            $wegEin->execute([$kundeId, $personId, $w['art'], $w['wert'], $j]);
        }
    }
}

// Laedt Personen und Kommunikationswege fuer alle Kunden in zwei Abfragen,
// nach Kunden-Id gebuendelt. Bewusst kein eigener Endpunkt je Kunde: die
// Kundenliste wird ohnehin am Stueck geladen (siehe OP-31 zur Datenmenge).
function kunden_kinder_laden(PDO $pdo): array
{
    $nach = [];
    $personenNach = [];
    foreach ($pdo->query('SELECT id, kunde_id, anrede, vorname, nachname FROM kunden_person ORDER BY kunde_id, sortierung, id') as $p) {
        $kid = (int)$p['kunde_id'];
        $nach[$kid]['personen'][] = [
            'id' => (int)$p['id'], 'anrede' => $p['anrede'], 'vorname' => $p['vorname'],
            'nachname' => $p['nachname'], 'kontaktwege' => [],
        ];
        $personenNach[(int)$p['id']] = [$kid, count($nach[$kid]['personen']) - 1];
    }
    foreach ($pdo->query('SELECT kunde_id, person_id, art, wert FROM kunden_kontaktweg ORDER BY kunde_id, sortierung, id') as $w) {
        $kid = (int)$w['kunde_id'];
        $eintrag = ['art' => $w['art'], 'wert' => $w['wert']];
        if ($w['person_id'] === null) {
            $nach[$kid]['kontaktwege'][] = $eintrag;
            continue;
        }
        $pos = $personenNach[(int)$w['person_id']] ?? null;
        if ($pos !== null) {
            $nach[$pos[0]]['personen'][$pos[1]]['kontaktwege'][] = $eintrag;
        }
    }
    return $nach;
}

// Aus den Kommunikationszeilen die drei Einzelspalten ableiten, die es seit
// jeher gibt. Bewusste Doppelfuehrung: Kundenliste, Suche, CSV-Export, die
// Rapport-Erfassung und der Admin-Bereich der Erfassung lesen weiterhin
// kunden.telefon/.email/.kontaktperson. Die Zeilen sind die vollstaendige
// Wahrheit, die drei Spalten die jeweils erste Angabe daraus.
function kunden_primaerwerte(array $kontaktwege, array $personen): array
{
    $erster = function (array $arten) use ($kontaktwege): string {
        foreach ($arten as $art) {
            foreach ($kontaktwege as $w) {
                if ($w['art'] === $art) { return $w['wert']; }
            }
        }
        return '';
    };
    $kontaktperson = '';
    if ($personen) {
        $p = $personen[0];
        $kontaktperson = trim($p['vorname'] . ' ' . $p['nachname']);
    }
    return [
        'telefon' => $erster(['telefon', 'mobil']),
        'email' => $erster(['email']),
        'kontaktperson' => $kontaktperson,
    ];
}

// Baut aus einer Anfrage die Spaltenwerte eines Kunden.
//
// Bewusst teiltolerant: Was nicht mitgeschickt wird, bleibt auf dem
// bisherigen Wert stehen. Das ist kein Schoenheitsfehler, sondern noetig --
// der Admin-Bereich der Erfassung (index.html) kennt weiterhin nur Name,
// Strasse, Ort, Telefon und E-Mail und wuerde die neuen Felder sonst bei
// jedem Speichern leeren.
//
// Ebenso beim Ort: Kommt keine getrennte PLZ mit, wird sie aus dem Ort
// herausgeloest. Damit schreibt auch ein alter Aufrufer, der "4632 Trimbach"
// in einem Feld schickt, sauber getrennte Werte.
//
// Rueckgabe: ['spalten' => [...], 'kinder' => ['kontaktwege'=>..., 'personen'=>...] | null]
// kinder ist null, wenn die Anfrage keine geschickt hat -- dann bleiben die
// bestehenden unangetastet.
function kunden_eingabe_lesen(array $input, array $bestand = []): array
{
    $alt = function (string $feld, string $vorgabe = '') use ($bestand): string {
        return trim((string)($bestand[$feld] ?? $vorgabe));
    };
    $neu = function (string $feld, string $vorgabe) use ($input): ?string {
        return array_key_exists($feld, $input) ? trim((string)$input[$feld]) : null;
    };
    $wert = function (string $feld) use ($neu, $alt): string {
        $n = $neu($feld, '');
        return $n !== null ? $n : $alt($feld);
    };

    $art = $wert('art');
    if (!in_array($art, KUNDE_ARTEN, true)) {
        $art = in_array($alt('art'), KUNDE_ARTEN, true) ? $alt('art') : 'unternehmen';
    }

    // PLZ und Ort. Schickt der Aufrufer beide getrennt, gilt seine Aufteilung.
    // Schickt er nur den Ort, wird getrennt. Schickt er gar nichts, bleibt es.
    $plz = $wert('plz');
    $ort = $wert('ort');
    if (!array_key_exists('plz', $input) && array_key_exists('ort', $input)) {
        [$gPlz, $gOrt] = plz_ort_trennen($ort);
        if ($gPlz !== '') { $plz = $gPlz; $ort = $gOrt; }
    }

    $spalten = [
        'art' => $art,
        'anrede' => $art === 'privat' ? $wert('anrede') : '',
        'vorname' => $art === 'privat' ? $wert('vorname') : '',
        'nachname' => $art === 'privat' ? $wert('nachname') : '',
        'name' => kunde_anzeigename($art, $wert('name'), $wert('vorname'), $wert('nachname')),
        'zusatzfeld' => $wert('zusatzfeld'),
        'strasse' => $wert('strasse'),
        'hausnummer' => $wert('hausnummer'),
        'adresszusatz' => $wert('adresszusatz'),
        'plz' => $plz,
        'ort' => $ort,
        'uid' => $wert('uid'),
        'mwst_nr' => $wert('mwst_nr'),
        'telefon' => $wert('telefon'),
        'email' => $wert('email'),
        'kontaktperson' => $wert('kontaktperson'),
        'notiz' => $wert('notiz'),
        // Abweichende Rechnungsadresse (ENT-155). Bewusst OHNE Schalter
        // "abweichend ja/nein": Ein Schalter kann auf "ja" stehen, waehrend
        // die Felder leer sind -- dann stuende auf dem Beleg eine leere
        // Adresse. Gefuellt heisst abweichend, leer heisst gleich wie oben.
        're_name' => $wert('re_name'),
        're_zusatz' => $wert('re_zusatz'),
        're_strasse' => $wert('re_strasse'),
        're_hausnummer' => $wert('re_hausnummer'),
        're_plz' => $wert('re_plz'),
        're_ort' => $wert('re_ort'),
    ];

    $kinder = null;
    if (array_key_exists('kontaktwege', $input) || array_key_exists('personen', $input)) {
        $kinder = [
            'kontaktwege' => kontaktwege_bereinigen((array)($input['kontaktwege'] ?? [])),
            'personen' => personen_bereinigen((array)($input['personen'] ?? [])),
        ];
        // Die drei Einzelspalten leiten sich dann aus den Zeilen ab und nicht
        // mehr aus eigenen Eingabefeldern -- die gibt es im neuen Dialog nicht.
        $spalten = array_merge($spalten, kunden_primaerwerte($kinder['kontaktwege'], $kinder['personen']));
    }

    return ['spalten' => $spalten, 'kinder' => $kinder];
}
