<?php
// Finanzen der Betreiberin (ENT-725): von Hand erfasste Ausgaben, ihre
// Vorlagen fuer wiederkehrende Kosten und der wiederkehrende Umsatz aus den
// Vertraegen.
//
// WARUM ES HIER EINE ERFASSUNG GIBT UND IM COCKPIT NICHT: Die Finanzen der
// Mandanten zeigen als Kosten nur, was die Plattform ohnehin kennt -- Lohn
// und Auslagenersatz (ENT-712, Punkt 10). Von der Betreiberin kennt die
// Plattform keine Kosten. Ein leerer Kostenblock saehe aus wie "keine
// Kosten", und das ist die Sorte Aussage, die hier nie entstehen darf
// ("unbekannt" ist nicht "keine").
//
// WAS DIESE DATEI NICHT IST: eine Buchhaltung. Keine Kreditoren, kein
// Offen-Status, kein Lieferantenstamm (ENT-725, Punkt 7). Eine Ausgabe gilt
// als bezahlt, sobald sie erfasst ist.
//
// ALLES IN RAPPEN, Prozentsaetze in Basispunkten -- wie belege.php.
// Massgeblich ist IMMER der CHF-Betrag von der Abrechnung. Bei Fremdwaehrung
// steht der Originalbetrag daneben; ein Kurs wird nur angezeigt, nie
// eingegeben oder gespeichert (ENT-725, Punkt 9).
declare(strict_types=1);

// ── MWST-Saetze (ENT-725, Punkt 8) ────────────────────────────────────
//
// Feste Auswahl, je mit "gueltig ab". Kein freies Feld: Ein Satz ist
// gesetzlich bestimmt und keine Einstellung (CLAUDE.md, "Konfigurierbarkeit
// ist kein Qualitaetsmerkmal"). Der Satz wird an der Buchung GESPEICHERT --
// eine spaetere Satzaenderung kommt hier als neue Zeile dazu und veraendert
// keine alte Buchung.
//
// 0 % gilt immer: ausländische Abos ohne Schweizer MWST, Gebuehren.
const BE_AUS_MWST_SAETZE = [
    ['bp' => 810, 'ab' => '2024-01-01', 'titel' => '8.1 %'],
    ['bp' => 260, 'ab' => '2024-01-01', 'titel' => '2.6 %'],
    ['bp' => 380, 'ab' => '2024-01-01', 'titel' => '3.8 %'],
    ['bp' => 0,   'ab' => '1900-01-01', 'titel' => '0 %'],
];

const BE_AUS_INTERVALLE = ['monatlich', 'jaehrlich'];

// Die Startliste der Kategorien (ENT-725, Punkt 11), so vom Projektinhaber
// gewaehlt. Ohne Auffangkategorie -- passt nichts, wird eine neue angelegt.
const BE_AUS_KATEGORIEN_START = ['Hosting & Server', 'Software & Abos', 'Marketing & Vertrieb'];

// Die Datei an einer Ausgabe (ENT-725, Punkt 7): eine, PDF oder Bild.
const BE_AUS_DATEI_TYPEN = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const BE_AUS_DATEI_MAX = 5 * 1024 * 1024;

// Waehrungen: drei Buchstaben nach ISO 4217. Keine Liste -- welche
// Waehrung ein Abo verrechnet, entscheidet der Anbieter, nicht wir.
function be_aus_waehrung_gueltig(string $w): bool
{
    return (bool)preg_match('/^[A-Z]{3}$/', $w);
}

// Ist dieser Satz am Buchungsdatum zulaessig?
function be_aus_mwst_gueltig(int $bp, string $datum): bool
{
    foreach (BE_AUS_MWST_SAETZE as $s) {
        if ($s['bp'] === $bp && $datum >= $s['ab']) { return true; }
    }
    return false;
}

// Netto aus brutto und Satz, auf den Rappen gerundet. Kaufmaennisch, wie
// beleg_summen(): Die MWST ist im Betrag enthalten, nicht obendrauf.
function be_aus_netto(int $bruttoRappen, int $bp): int
{
    if ($bp <= 0) { return $bruttoRappen; }
    return (int)round($bruttoRappen * 10000 / (10000 + $bp));
}

function be_aus_monat_gueltig(string $m): bool
{
    return (bool)preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $m);
}

function be_aus_datum_gueltig(string $d): bool
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $t)) { return false; }
    return checkdate((int)$t[2], (int)$t[3], (int)$t[1]);
}

// 'YYYY-MM' plus n Monate.
function be_aus_monat_plus(string $m, int $n): string
{
    $j = (int)substr($m, 0, 4);
    $mo = (int)substr($m, 5, 2) - 1 + $n;
    $j += intdiv($mo - ($mo < 0 ? 11 : 0), 12);
    $mo = (($mo % 12) + 12) % 12;
    return sprintf('%04d-%02d', $j, $mo + 1);
}

// Der Buchungstag einer Vorlage im Monat: derselbe Tag wie ihr Beginn,
// am Monatsende abgeschnitten (ein Beginn am 31. bucht im Februar am 28.).
function be_aus_tag_im_monat(string $monat, int $tag): string
{
    $letzter = (int)date('t', strtotime($monat . '-01'));
    return $monat . '-' . sprintf('%02d', min(max(1, $tag), $letzter));
}

// Die Monate, in denen eine Vorlage bis einschliesslich $bisMonat faellig
// ist. Monatlich: jeder Monat ab Beginn. Jaehrlich: der Monat des Beginns,
// jedes Jahr. Ein Ende (gueltig_bis) schliesst den Monat des Endes ein.
function be_aus_vorlage_perioden(array $v, string $bisMonat): array
{
    $ab = substr((string)($v['gueltig_ab'] ?? ''), 0, 10);
    if (!be_aus_datum_gueltig($ab)) { return []; }
    $bis = substr((string)($v['gueltig_bis'] ?? ''), 0, 10);
    $ende = be_aus_datum_gueltig($bis) ? min(substr($bis, 0, 7), $bisMonat) : $bisMonat;
    $schritt = ($v['intervall'] ?? '') === 'jaehrlich' ? 12 : 1;
    $raus = [];
    // Obergrenze als Zusicherung, dass die Schleife endet -- 100 Jahre.
    for ($m = substr($ab, 0, 7), $i = 0; $m <= $ende && $i < 1200; $m = be_aus_monat_plus($m, $schritt), $i++) {
        $raus[] = $m;
    }
    return $raus;
}

// ── Tabellen ──────────────────────────────────────────────────────────
//
// Stehen hier und nicht in be_tabellen() direkt, damit sie zusammen mit
// ihrer Begruendung lesbar bleiben. be_tabellen() nimmt sie auf -- eine
// Definition, nicht zwei.
function be_aus_tabellen(): array
{
    return [

// Kategorien (ENT-725, Punkt 11). Archivieren statt loeschen: Alte
// Buchungen verweisen auf sie, und ein Verweis ins Leere waere schlimmer
// als ein ausgeblendeter Eintrag.
'be_ausgabe_kategorie' => "CREATE TABLE IF NOT EXISTS be_ausgabe_kategorie (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  sortierung INT NOT NULL DEFAULT 0,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_be_ausgabe_kategorie_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Vorlagen fuer wiederkehrende Kosten (ENT-725, Punkt 10). Eine Vorlage
// bucht nichts selbst -- be_aus_vorlagen_buchen() legt je faelligem Monat
// eine gewoehnliche Ausgabe an. Was danach an der Vorlage geaendert wird,
// trifft nur noch Monate ab `wirksam_ab`, und dort nur Buchungen, die
// niemand von Hand angefasst hat.
//
// Fremdwaehrung: `betrag_fremd_rappen` in Hundertsteln der Waehrung,
// `betrag_rappen` ist dann nur die Schaetzung fuer den ersten Monat und
// darf leer sein. Bei CHF ist `betrag_rappen` der Betrag jeder Buchung.
'be_ausgabe_vorlage' => "CREATE TABLE IF NOT EXISTS be_ausgabe_vorlage (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kategorie_id INT UNSIGNED NOT NULL,
  text VARCHAR(200) NOT NULL,
  lieferant VARCHAR(200) NOT NULL DEFAULT '',
  intervall ENUM('monatlich','jaehrlich') NOT NULL DEFAULT 'monatlich',
  waehrung CHAR(3) NOT NULL DEFAULT 'CHF',
  betrag_rappen INT NULL,
  betrag_fremd_rappen INT NULL,
  mwst_satz_bp INT NOT NULL DEFAULT 0,
  gueltig_ab DATE NOT NULL,
  gueltig_bis DATE NULL,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geaendert_am DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Die Ausgabe selbst (ENT-725, Punkt 7). `betrag_rappen` ist der CHF-Betrag
// INKL. MWST laut Abrechnung. NULL heisst "CHF-Betrag fehlt" -- das gibt es
// nur bei Fremdwaehrung aus einer Vorlage, und es ist ausdruecklich nicht 0.
//
// `mwst_satz_bp` steht an der Zeile, nicht als Verweis: Eine spaetere
// Satzaenderung darf eine alte Buchung nicht veraendern.
//
// `vorlage_id` + `periode` sind eindeutig: Ein Monat bekommt aus derselben
// Vorlage genau eine Buchung, auch wenn zwei Aufrufe gleichzeitig buchen.
// Von Hand erfasste Ausgaben tragen keine Vorlage (NULL), und NULL zaehlt
// in einem UNIQUE-Schluessel nicht als gleich.
//
// `von_hand` = 1, sobald jemand eine aus der Vorlage gebuchte Zeile
// aendert. Eine solche Zeile laesst eine spaetere Vorlagenaenderung in Ruhe.
'be_ausgabe' => "CREATE TABLE IF NOT EXISTS be_ausgabe (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  datum DATE NOT NULL,
  periode CHAR(7) NOT NULL,
  kategorie_id INT UNSIGNED NOT NULL,
  text VARCHAR(200) NOT NULL,
  lieferant VARCHAR(200) NOT NULL DEFAULT '',
  waehrung CHAR(3) NOT NULL DEFAULT 'CHF',
  betrag_rappen INT NULL,
  betrag_fremd_rappen INT NULL,
  mwst_satz_bp INT NOT NULL DEFAULT 0,
  vorlage_id INT UNSIGNED NULL,
  von_hand TINYINT(1) NOT NULL DEFAULT 1,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geaendert_am DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_be_ausgabe_vorlage_periode (vorlage_id, periode),
  KEY idx_be_ausgabe_periode (periode),
  KEY idx_be_ausgabe_kategorie (kategorie_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Die angehaengte Datei, eine je Ausgabe (ENT-725, Punkt 7). Eigene
// Tabelle, damit die Liste der Ausgaben nicht bei jedem Laden Megabytes
// mitschleppt. In der Datenbank und nicht im Dateisystem: Der
// Betreiber-Bereich hat kein Verzeichnis fuer hochgeladene Dateien (wie
// beim Logo im Briefkopf), und so liegt der Beleg im selben Backup wie die
// Buchung.
'be_ausgabe_datei' => "CREATE TABLE IF NOT EXISTS be_ausgabe_datei (
  ausgabe_id INT UNSIGNED NOT NULL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  typ VARCHAR(60) NOT NULL,
  groesse INT UNSIGNED NOT NULL,
  inhalt MEDIUMBLOB NOT NULL,
  hochgeladen_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ];
}

// Die Startkategorien, einmalig: nur wenn die Tabelle noch leer ist. Wer
// eine davon spaeter archiviert, bekommt sie beim naechsten Einrichtungslauf
// NICHT zurueck.
//
// OHNE GEDAECHTNIS gefragt (drittes Argument): Der Einrichtungslauf legt die
// Tabelle in derselben Anfrage erst an. hat_tabelle() haette sich sonst das
// "fehlt" von vorher gemerkt, und die Startliste entstuende erst beim
// zweiten Lauf (gefunden am 2026-10-16 gegen MariaDB).
function be_aus_kategorien_nachtragen(PDO $pdo): int
{
    if (!hat_tabelle($pdo, 'be_ausgabe_kategorie', true)) { return 0; }
    if ((int)$pdo->query('SELECT COUNT(*) FROM be_ausgabe_kategorie')->fetchColumn() > 0) { return 0; }
    $s = $pdo->prepare('INSERT INTO be_ausgabe_kategorie (name, sortierung, aktiv) VALUES (?, ?, 1)');
    foreach (BE_AUS_KATEGORIEN_START as $i => $name) { $s->execute([$name, $i]); }
    return count(BE_AUS_KATEGORIEN_START);
}

function be_aus_eingerichtet(PDO $pdo): bool
{
    foreach (array_keys(be_aus_tabellen()) as $t) {
        if (!hat_tabelle($pdo, $t)) { return false; }
    }
    return true;
}

// ── Vorlagen buchen ───────────────────────────────────────────────────
//
// Legt fuer jede aktive Vorlage die faelligen Monate bis $heute an, die noch
// keine Buchung haben. Gefahrlos mehrfach aufrufbar: Der eindeutige
// Schluessel (vorlage_id, periode) haelt Doppel ab, und ein Monat, dessen
// Buchung jemand archiviert hat, kommt NICHT zurueck -- archiviert heisst
// "zaehlt nicht", nicht "fehlt".
//
// Bei Fremdwaehrung bleibt der CHF-Betrag leer ("CHF-Betrag fehlt"), bis
// jemand den Betrag von der Kreditkartenabrechnung eintraegt. Die
// Schaetzung bis dahin rechnet be_aus_schaetzen() beim Lesen -- sie wird
// nie gespeichert, sonst saehe sie spaeter aus wie ein echter Betrag.
function be_aus_vorlagen_buchen(PDO $pdo, string $heute): int
{
    if (!be_aus_eingerichtet($pdo)) { return 0; }
    $bisMonat = substr($heute, 0, 7);
    $vorlagen = $pdo->query('SELECT * FROM be_ausgabe_vorlage WHERE aktiv = 1')->fetchAll(PDO::FETCH_ASSOC);
    $da = $pdo->prepare('SELECT 1 FROM be_ausgabe WHERE vorlage_id = ? AND periode = ?');
    $neu = $pdo->prepare(
        'INSERT INTO be_ausgabe (datum, periode, kategorie_id, text, lieferant, waehrung,
                                 betrag_rappen, betrag_fremd_rappen, mwst_satz_bp, vorlage_id, von_hand, aktiv)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)'
    );
    $zahl = 0;
    foreach ($vorlagen as $v) {
        $tag = (int)substr((string)$v['gueltig_ab'], 8, 2);
        $chf = (string)$v['waehrung'] === 'CHF';
        foreach (be_aus_vorlage_perioden($v, $bisMonat) as $m) {
            $da->execute([(int)$v['id'], $m]);
            if ($da->fetchColumn()) { continue; }
            $datum = be_aus_tag_im_monat($m, $tag);
            // Ein Buchungstag in der Zukunft (Beginn am 20., heute der 5.)
            // wird noch nicht gebucht -- die Kosten sind noch nicht angefallen.
            if ($datum > $heute) { continue; }
            try {
                $neu->execute([$datum, $m, (int)$v['kategorie_id'], (string)$v['text'],
                               (string)$v['lieferant'], (string)$v['waehrung'],
                               $chf && $v['betrag_rappen'] !== null ? (int)$v['betrag_rappen'] : null,
                               $chf ? null : ($v['betrag_fremd_rappen'] === null ? null : (int)$v['betrag_fremd_rappen']),
                               (int)$v['mwst_satz_bp'], (int)$v['id']]);
                $zahl++;
            } catch (PDOException $e) {
                // Ein zweiter Aufruf war schneller (eindeutiger Schluessel).
                // Das ist kein Fehler, die Buchung steht.
            }
        }
    }
    return $zahl;
}

// Eine geaenderte Vorlage auf ihre unberuehrten Buchungen ab $wirksamAb
// uebertragen (ENT-725, Punkt 10). Fruehere Monate bleiben, wie sie sind,
// und eine von Hand angefasste Zeile ebenso. Gibt die Ids der geaenderten
// Buchungen zurueck, damit der Aufrufer sie ins Logbuch schreiben kann.
function be_aus_vorlage_uebertragen(PDO $pdo, array $v, string $wirksamAb): array
{
    $chf = (string)$v['waehrung'] === 'CHF';
    $s = $pdo->prepare('SELECT id FROM be_ausgabe WHERE vorlage_id = ? AND periode >= ? AND von_hand = 0');
    $s->execute([(int)$v['id'], $wirksamAb]);
    $ids = array_map('intval', $s->fetchAll(PDO::FETCH_COLUMN));
    if (!$ids) { return []; }
    $u = $pdo->prepare(
        'UPDATE be_ausgabe SET kategorie_id = ?, text = ?, lieferant = ?, waehrung = ?,
                betrag_rappen = ?, betrag_fremd_rappen = ?, mwst_satz_bp = ? WHERE id = ?'
    );
    foreach ($ids as $id) {
        $u->execute([(int)$v['kategorie_id'], (string)$v['text'], (string)$v['lieferant'],
                     (string)$v['waehrung'],
                     $chf && $v['betrag_rappen'] !== null ? (int)$v['betrag_rappen'] : null,
                     $chf ? null : ($v['betrag_fremd_rappen'] === null ? null : (int)$v['betrag_fremd_rappen']),
                     (int)$v['mwst_satz_bp'], $id]);
    }
    return $ids;
}

// ── Schaetzung fuer "CHF-Betrag fehlt" (ENT-725, Punkt 10) ────────────
//
// Fehlt der CHF-Betrag, gilt als Schaetzung der Kurs der letzten Buchung
// DERSELBEN Vorlage mit bekanntem CHF-Betrag, angewandt auf den
// Originalbetrag dieses Monats. Gibt es keine solche Buchung, traegt die
// Vorlage vielleicht eine eigene Schaetzung (betrag_rappen bei
// Fremdwaehrung). Sonst bleibt es unbekannt -- und zaehlt nirgends als 0.
//
// $zeilen: alle Buchungen (aktive und archivierte), je mit id, periode,
// vorlage_id, waehrung, betrag_rappen, betrag_fremd_rappen.
// $vorlagen: id => Vorlagenzeile.
// Rueckgabe: dieselben Zeilen, je mit 'schaetzung_rappen' (int|null).
function be_aus_schaetzen(array $zeilen, array $vorlagen = []): array
{
    $nachVorlage = [];
    foreach ($zeilen as $z) {
        if ($z['vorlage_id'] !== null && $z['betrag_rappen'] !== null
            && (int)($z['betrag_fremd_rappen'] ?? 0) > 0) {
            $nachVorlage[(int)$z['vorlage_id']][] = $z;
        }
    }
    foreach ($nachVorlage as &$liste) {
        usort($liste, fn($a, $b) => strcmp((string)$a['periode'], (string)$b['periode']));
    }
    unset($liste);

    foreach ($zeilen as $i => $z) {
        $zeilen[$i]['schaetzung_rappen'] = null;
        if ($z['betrag_rappen'] !== null || $z['vorlage_id'] === null) { continue; }
        $fremd = (int)($z['betrag_fremd_rappen'] ?? 0);
        $vorher = null;
        foreach ($nachVorlage[(int)$z['vorlage_id']] ?? [] as $k) {
            if ((string)$k['periode'] < (string)$z['periode']) { $vorher = $k; }
        }
        if ($vorher !== null && $fremd > 0) {
            $zeilen[$i]['schaetzung_rappen'] =
                (int)round($fremd * (int)$vorher['betrag_rappen'] / (int)$vorher['betrag_fremd_rappen']);
            continue;
        }
        $v = $vorlagen[(int)$z['vorlage_id']] ?? null;
        if ($v !== null && $v['betrag_rappen'] !== null) {
            $zeilen[$i]['schaetzung_rappen'] = (int)$v['betrag_rappen'];
        }
    }
    return $zeilen;
}

// ── Ausgaben je Monat (ENT-725, Punkt 4) ──────────────────────────────
//
// Netto, nach Kategorie. Drei Angaben getrennt, weil es drei verschiedene
// Aussagen sind:
//   netto_rappen       bekannte plus geschaetzte Betraege
//   geschaetzt_rappen  der Anteil davon, der geschaetzt ist
//   fehlt              Buchungen ohne Betrag und ohne Schaetzung -- sie
//                      zaehlen in keiner Summe und werden genannt
// Ein Monat ohne Buchung fehlt in der Liste. Der Aufrufer zeigt ihn als
// "keine Ausgaben erfasst", nicht als "keine Kosten".
function be_aus_monate(array $zeilen, string $von, string $bis): array
{
    $raus = [];
    foreach ($zeilen as $z) {
        if (!(int)$z['aktiv']) { continue; }
        $m = (string)$z['periode'];
        if ($m < $von || $m > $bis) { continue; }
        $bp = (int)$z['mwst_satz_bp'];
        $brutto = $z['betrag_rappen'] !== null ? (int)$z['betrag_rappen'] : ($z['schaetzung_rappen'] ?? null);
        $raus[$m] ??= ['netto_rappen' => 0, 'geschaetzt_rappen' => 0, 'fehlt' => 0,
                       'buchungen' => 0, 'kategorien' => []];
        $raus[$m]['buchungen']++;
        if ($brutto === null) { $raus[$m]['fehlt']++; continue; }
        $netto = be_aus_netto((int)$brutto, $bp);
        $raus[$m]['netto_rappen'] += $netto;
        if ($z['betrag_rappen'] === null) { $raus[$m]['geschaetzt_rappen'] += $netto; }
        $k = (string)(int)$z['kategorie_id'];
        $raus[$m]['kategorien'][$k] = ($raus[$m]['kategorien'][$k] ?? 0) + $netto;
    }
    ksort($raus);
    return $raus;
}

// Alle Buchungen samt Schaetzung. Archivierte kommen mit, weil eine
// archivierte Buchung mit bekanntem Kurs trotzdem die Schaetzung des
// Folgemonats tragen darf -- der Kurs war echt, nur die Zeile zaehlt nicht.
function be_aus_zeilen(PDO $pdo): array
{
    $zeilen = $pdo->query(
        'SELECT a.id, a.datum, a.periode, a.kategorie_id, a.text, a.lieferant, a.waehrung,
                a.betrag_rappen, a.betrag_fremd_rappen, a.mwst_satz_bp, a.vorlage_id,
                a.von_hand, a.aktiv, a.erstellt_am, a.geaendert_am,
                k.name AS kategorie_name,
                CASE WHEN d.ausgabe_id IS NULL THEN 0 ELSE 1 END AS hat_datei,
                d.name AS datei_name
           FROM be_ausgabe a
           LEFT JOIN be_ausgabe_kategorie k ON k.id = a.kategorie_id
           LEFT JOIN be_ausgabe_datei d ON d.ausgabe_id = a.id
          ORDER BY a.datum DESC, a.id DESC'
    )->fetchAll(PDO::FETCH_ASSOC);
    foreach ($zeilen as &$z) {
        foreach (['betrag_rappen', 'betrag_fremd_rappen', 'vorlage_id'] as $f) {
            $z[$f] = $z[$f] === null ? null : (int)$z[$f];
        }
        foreach (['id', 'kategorie_id', 'mwst_satz_bp', 'von_hand', 'aktiv', 'hat_datei'] as $f) {
            $z[$f] = (int)$z[$f];
        }
    }
    unset($z);
    $vorlagen = [];
    foreach ($pdo->query('SELECT id, betrag_rappen FROM be_ausgabe_vorlage')->fetchAll(PDO::FETCH_ASSOC) as $v) {
        $vorlagen[(int)$v['id']] = ['betrag_rappen' => $v['betrag_rappen'] === null ? null : (int)$v['betrag_rappen']];
    }
    return be_aus_schaetzen($zeilen, $vorlagen);
}

// ── Wiederkehrender Umsatz (ENT-725, Punkt 5) ─────────────────────────
//
// Je Mandant der zuletzt angenommene Vertrag. Monatsbetrag plus Jahresbetrag
// durch 12, EXKL. MWST -- gerechnet aus den Positionen, nicht aus den
// Summenspalten: total_monat_rappen ist inkl. MWST und gerundet.
//
// Es zaehlt, wer heute laeuft: Status aktiv oder gekuendigt, und eine
// Kuendigung erst ab ihrem Datum. Ein gesperrter Mandant zaehlt nicht --
// ENT-725 sagt "aktive Mandanten".
//
// $positionenLesen: function(int $belegId): array -- in der Praxis
// beleg_positionen_lesen(..., 'be_'), in der Pruefung eine Attrappe.
// $perioden: function(array $positionen, int $rabattBp): array --
// beleg_summen_perioden().
function be_aus_mrr(array $vertraege, array $mandanten, string $heute,
                    callable $positionenLesen, callable $perioden): array
{
    // Der juengste angenommene Vertrag je Mandant. Ein nachverhandelter
    // Vertrag ersetzt den alten; beide zu zaehlen verdoppelte den Umsatz.
    $jeMandant = [];
    $ohneMandant = 0;
    foreach ($vertraege as $v) {
        if ((string)($v['status'] ?? '') !== 'bestaetigt' || !(int)($v['aktiv'] ?? 1)
            || (int)($v['ist_vorlage'] ?? 0)) { continue; }
        $mid = (int)($v['mandant_id'] ?? 0);
        if ($mid <= 0) { $ohneMandant++; continue; }
        $schluessel = (string)($v['entscheidung_am'] ?? '') . '|' . (string)($v['datum'] ?? '') . '|' . sprintf('%010d', (int)$v['id']);
        if (!isset($jeMandant[$mid]) || $schluessel > $jeMandant[$mid]['_s']) {
            $jeMandant[$mid] = $v + ['_s' => $schluessel];
        }
    }

    $rappen = 0; $zaehlt = 0; $ruht = 0; $zeilen = [];
    foreach ($jeMandant as $mid => $v) {
        $m = $mandanten[$mid] ?? null;
        $status = (string)($m['status'] ?? '');
        $gek = substr((string)($m['gekuendigt_per'] ?? ''), 0, 10);
        $beendet = $gek !== '' && $gek !== '0000-00-00' && $gek < $heute;
        if ($m === null || !in_array($status, ['aktiv', 'gekuendigt'], true) || $beendet) {
            $ruht++;
            continue;
        }
        $p = $perioden($positionenLesen((int)$v['id']), (int)($v['rabatt_bp'] ?? 0));
        $netto = static fn(?array $s) => $s === null ? 0
            : (int)$s['zwischensumme_rappen'] - (int)$s['rabatt_rappen'];
        $monat = $netto($p['monatlich'] ?? null);
        $jahr  = $netto($p['jaehrlich'] ?? null);
        $beitrag = $monat + (int)round($jahr / 12);
        $rappen += $beitrag;
        $zaehlt++;
        $zeilen[] = ['mandant_id' => $mid, 'mandant' => (string)($m['name'] ?? ''),
                     'beleg_id' => (int)$v['id'], 'nummer' => (string)($v['nummer'] ?? ''),
                     'monat_rappen' => $monat, 'jahr_rappen' => $jahr, 'beitrag_rappen' => $beitrag,
                     'gekuendigt_per' => ($gek === '' || $gek === '0000-00-00') ? null : $gek];
    }
    usort($zeilen, fn($a, $b) => $b['beitrag_rappen'] <=> $a['beitrag_rappen']);
    return ['rappen' => $rappen, 'vertraege' => $zaehlt, 'ruhend' => $ruht,
            'ohne_mandant' => $ohneMandant, 'zeilen' => $zeilen];
}

// ── Eingaben pruefen ──────────────────────────────────────────────────
//
// Reine Funktionen, damit pruef_betreiber_finanzen.php sie ohne Server
// ausfuehren kann. Rueckgabe: ['felder' => [...]] oder ['fehler' => Text].
// Die Sperren stehen hier im Server; was die Oberflaeche vorher prueft,
// erspart nur den Umweg (CLAUDE.md).

// Ein Betrag in Rappen aus der Eingabe: null fuer leer, sonst eine ganze
// Zahl. Ein Text oder ein Bruchteil eines Rappens ist kein Betrag.
function be_aus_rappen($wert): ?int
{
    if ($wert === null || $wert === '') { return null; }
    if (is_int($wert)) { return $wert; }
    if (is_float($wert) && floor($wert) === $wert) { return (int)$wert; }
    if (is_string($wert) && preg_match('/^-?\d+$/', $wert)) { return (int)$wert; }
    return -1; // ungueltig, faellt unten an "groesser als null" durch
}

// Gemeinsamer Teil von Ausgabe und Vorlage: Kategorie, Text, Lieferant,
// Waehrung, Betraege, Satz. $stichtag ist das Datum, an dem der Satz gelten
// muss (Buchungsdatum oder Beginn der Vorlage).
function be_aus_betrag_pruefen(array $in, array $kategorien, string $stichtag, bool $vorlage): array
{
    $kat = (int)($in['kategorie_id'] ?? 0);
    if (!isset($kategorien[$kat])) {
        return ['fehler' => 'Bitte eine Kategorie wählen.'];
    }
    $text = trim((string)($in['text'] ?? ''));
    if ($text === '') { return ['fehler' => 'Bitte beschreiben, wofür die Ausgabe ist.']; }
    $waehrung = strtoupper(trim((string)($in['waehrung'] ?? 'CHF')));
    if (!be_aus_waehrung_gueltig($waehrung)) {
        return ['fehler' => 'Die Währung braucht drei Buchstaben, etwa CHF, EUR oder USD.'];
    }
    $chf   = be_aus_rappen($in['betrag_rappen'] ?? null);
    $fremd = be_aus_rappen($in['betrag_fremd_rappen'] ?? null);
    $max = 99999999;
    if ($waehrung === 'CHF') {
        if ($chf === null || $chf <= 0 || $chf > $max) {
            return ['fehler' => 'Bitte einen Betrag in CHF grösser als null erfassen.'];
        }
        $fremd = null;
    } else {
        if ($fremd === null || $fremd <= 0 || $fremd > $max) {
            return ['fehler' => 'Bitte den Betrag in ' . $waehrung . ' erfassen.'];
        }
        // Der CHF-Betrag darf fehlen: Er steht oft erst auf der naechsten
        // Kreditkartenabrechnung. Fehlt er, heisst es "CHF-Betrag fehlt".
        if ($chf !== null && ($chf <= 0 || $chf > $max)) {
            return ['fehler' => $vorlage
                ? 'Die Schätzung in CHF muss grösser als null sein oder leer bleiben.'
                : 'Der CHF-Betrag muss grösser als null sein oder leer bleiben.'];
        }
    }
    $bp = (int)($in['mwst_satz_bp'] ?? -1);
    if (!be_aus_mwst_gueltig($bp, $stichtag)) {
        return ['fehler' => 'Dieser MWST-Satz gilt am ' . date('d.m.Y', strtotime($stichtag))
            . ' nicht. Erlaubt sind 8.1 %, 2.6 %, 3.8 % und 0 %.'];
    }
    return ['felder' => [
        'kategorie_id'        => $kat,
        'text'                => mb_substr($text, 0, 200),
        'lieferant'           => mb_substr(trim((string)($in['lieferant'] ?? '')), 0, 200),
        'waehrung'            => $waehrung,
        'betrag_rappen'       => $chf,
        'betrag_fremd_rappen' => $fremd,
        'mwst_satz_bp'        => $bp,
    ]];
}

// $kategorien: id => ['aktiv' => 0|1]. Eine archivierte Kategorie nimmt
// keine NEUE Buchung an; eine bestehende Buchung darf sie behalten.
function be_aus_ausgabe_pruefen(array $in, array $kategorien, ?int $bisherigeKategorie = null): array
{
    $datum = trim((string)($in['datum'] ?? ''));
    if (!be_aus_datum_gueltig($datum)) { return ['fehler' => 'Bitte ein gültiges Datum erfassen.']; }
    $erlaubt = array_filter($kategorien, fn($k, $id) => (int)$k['aktiv'] === 1 || $id === $bisherigeKategorie,
                            ARRAY_FILTER_USE_BOTH);
    $r = be_aus_betrag_pruefen($in, $erlaubt, $datum, false);
    if (isset($r['fehler'])) { return $r; }
    return ['felder' => ['datum' => $datum, 'periode' => substr($datum, 0, 7)] + $r['felder']];
}

function be_aus_vorlage_pruefen(array $in, array $kategorien, ?int $bisherigeKategorie = null): array
{
    $ab = trim((string)($in['gueltig_ab'] ?? ''));
    if (!be_aus_datum_gueltig($ab)) { return ['fehler' => 'Bitte angeben, ab wann die Kosten anfallen.']; }
    $bis = trim((string)($in['gueltig_bis'] ?? ''));
    if ($bis !== '' && !be_aus_datum_gueltig($bis)) { return ['fehler' => 'Das Enddatum ist ungültig.']; }
    if ($bis !== '' && $bis < $ab) { return ['fehler' => 'Das Enddatum liegt vor dem Beginn.']; }
    $intervall = (string)($in['intervall'] ?? '');
    if (!in_array($intervall, BE_AUS_INTERVALLE, true)) {
        return ['fehler' => 'Bitte monatlich oder jährlich wählen.'];
    }
    $erlaubt = array_filter($kategorien, fn($k, $id) => (int)$k['aktiv'] === 1 || $id === $bisherigeKategorie,
                            ARRAY_FILTER_USE_BOTH);
    $r = be_aus_betrag_pruefen($in, $erlaubt, $ab, true);
    if (isset($r['fehler'])) { return $r; }
    return ['felder' => $r['felder'] + ['intervall' => $intervall, 'gueltig_ab' => $ab,
                                        'gueltig_bis' => $bis === '' ? null : $bis]];
}

// Fuers Logbuch: Betraege als Franken, Saetze als Prozent. Ein Verlauf mit
// "betrag_rappen 12990 -> 13490" beantwortet die Frage nicht, fuer die er
// da ist.
function be_aus_logwert(string $feld, $wert): ?string
{
    if ($wert === null) { return null; }
    if ($feld === 'betrag_rappen' || $feld === 'betrag_fremd_rappen') {
        return number_format((int)$wert / 100, 2, '.', "'");
    }
    if ($feld === 'mwst_satz_bp') {
        return rtrim(rtrim(number_format((int)$wert / 100, 2, '.', ''), '0'), '.') . ' %';
    }
    return (string)$wert;
}

function be_aus_logwerte(array $z): array
{
    $raus = [];
    foreach ($z as $f => $w) { $raus[$f] = be_aus_logwert((string)$f, $w); }
    return $raus;
}

// id => ['aktiv' => ..., 'name' => ...]
function be_aus_kategorien(PDO $pdo): array
{
    $raus = [];
    foreach ($pdo->query('SELECT id, name, sortierung, aktiv FROM be_ausgabe_kategorie ORDER BY sortierung, name')
                 ->fetchAll(PDO::FETCH_ASSOC) as $k) {
        $raus[(int)$k['id']] = ['id' => (int)$k['id'], 'name' => (string)$k['name'],
                                'sortierung' => (int)$k['sortierung'], 'aktiv' => (int)$k['aktiv']];
    }
    return $raus;
}

// Der Dateityp am Inhalt erkannt (die ersten Bytes), nicht an der Angabe
// des Browsers. null: kein erlaubter Typ.
function be_aus_datei_typ(string $roh): ?string
{
    if (strncmp($roh, '%PDF-', 5) === 0) { return 'application/pdf'; }
    if (strncmp($roh, "\x89PNG\r\n\x1a\n", 8) === 0) { return 'image/png'; }
    if (strncmp($roh, "\xFF\xD8\xFF", 3) === 0) { return 'image/jpeg'; }
    if (strncmp($roh, 'RIFF', 4) === 0 && substr($roh, 8, 4) === 'WEBP') { return 'image/webp'; }
    return null;
}
