<?php
// Beleg der Betreiberin anlegen oder aendern, samt Positionen (ENT-605).
//
// EIN Endpunkt fuer beides. Alles laeuft in EINER Transaktion: Kopfdaten,
// Positionen und die daraus gerechneten Summen gehoeren zusammen -- ein
// Beleg mit neuen Positionen und alten Summen waere schlimmer als gar kein
// Beleg.
//
// DIE SUMMEN AUS DER EINGABE WERDEN IGNORIERT. Der Browser schickt sie mit,
// weil er sie fuer die Live-Anzeige ohnehin gerechnet hat -- gespeichert
// wird ausschliesslich, was beleg_summen_schreiben() aus den tatsaechlich
// abgelegten Positionen ermittelt. Was auf ein Kundendokument geht, rechnet
// der Server, und zwar mit derselben Funktion wie beim Mandanten.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'be_belege')) {
    json_response(['status' => 'error',
        'message' => 'Der Offertenteil ist noch nicht eingerichtet.'], 503);
}

$in  = json_decode(file_get_contents('php://input'), true) ?? [];
$id  = (int)($in['id'] ?? 0);
$art = (string)($in['art'] ?? 'offerte');
if (!beleg_art_gueltig($art)) {
    json_response(['status' => 'error', 'message' => 'Unbekannte Belegart'], 400);
}

$status = (string)($in['status'] ?? 'entwurf');
if (!beleg_status_gueltig($status)) {
    json_response(['status' => 'error', 'message' => 'Unbekannter Status'], 400);
}

$datum = (string)($in['datum'] ?? '');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum)) {
    json_response(['status' => 'error', 'message' => 'Ein Datum ist erforderlich.'], 400);
}
$gueltigBis = (string)($in['gueltig_bis'] ?? '');
$gueltigBis = preg_match('/^\d{4}-\d{2}-\d{2}$/', $gueltigBis) ? $gueltigBis : null;
// Ein Ablaufdatum VOR dem Offertendatum ist keine Frist, sondern ein
// Tippfehler -- und eine Offerte, die schon abgelaufen ist, bevor sie
// geschrieben wurde, stuende in jeder Liste falsch einsortiert.
if ($gueltigBis !== null && $gueltigBis < $datum) {
    json_response(['status' => 'error',
        'message' => '„Gültig bis" liegt vor dem Offertendatum.'], 400);
}
$faelligBis = (string)($in['faellig_bis'] ?? '');
$faelligBis = preg_match('/^\d{4}-\d{2}-\d{2}$/', $faelligBis) ? $faelligBis : null;
if ($faelligBis !== null && $faelligBis < $datum) {
    json_response(['status' => 'error',
        'message' => '„Fällig am" liegt vor dem Rechnungsdatum.'], 400);
}

// Der Empfaenger muss aus dem eigenen Adressbestand kommen. Geprueft wird
// das hier und nicht in der Oberflaeche: Eine kunde_id, die auf nichts
// zeigt, ergaebe eine Offerte ohne Empfaenger, und der Versand liefe ins
// Leere.
$kundeId = ($in['kunde_id'] ?? null) ? (int)$in['kunde_id'] : null;
if ($kundeId !== null) {
    $chk = $pdo->prepare('SELECT id FROM be_kunden WHERE id = ?');
    $chk->execute([$kundeId]);
    if (!$chk->fetch()) {
        json_response(['status' => 'error', 'message' => 'Empfänger nicht gefunden'], 400);
    }
}
$personId = ($in['person_id'] ?? null) ? (int)$in['person_id'] : null;
if ($personId !== null) {
    $chk = $pdo->prepare('SELECT id FROM be_kunden_person WHERE id = ? AND kunde_id = ?');
    $chk->execute([$personId, (int)$kundeId]);
    if (!$chk->fetch()) { $personId = null; }
}

$kopf = [
    'kunde_id'    => $kundeId,
    'person_id'   => $personId,
    'titel'       => mb_substr(trim((string)($in['titel'] ?? '')), 0, 200),
    'referenz'    => mb_substr(trim((string)($in['referenz'] ?? '')), 0, 100),
    'datum'       => $datum,
    'gueltig_bis' => $gueltigBis,
    'faellig_bis' => $faelligBis,
    'status'      => $status,
    'bemerkung'   => trim((string)($in['bemerkung'] ?? '')),
    'ist_vorlage' => !empty($in['ist_vorlage']) ? 1 : 0,
    'unterschriftsseite'   => !empty($in['unterschriftsseite']) ? 1 : 0,
    'oeffentliche_notizen' => trim((string)($in['oeffentliche_notizen'] ?? '')),
    'bedingungen'          => trim((string)($in['bedingungen'] ?? '')),
    'fusszeile_text'       => trim((string)($in['fusszeile_text'] ?? '')),
];
$rabattBp = max(0, min(10000, (int)round((float)($in['rabatt_bp'] ?? 0))));

// ── Laufzeit, nur beim Vertrag (ENT-637) ──────────────────────────────────
//
// Beim Aendern entscheidet die GESPEICHERTE Art, nicht die mitgeschickte:
// `art` steht nicht in $kopf und wird darum nie ueberschrieben. Kaeme die
// Angabe aus der Anfrage, liesse sich einem bestehenden Vertrag mit einem
// art=offerte seine Laufzeit leeren, ohne dass er aufhoerte, ein Vertrag zu
// sein.
if ($id > 0) {
    $a = $pdo->prepare('SELECT art FROM be_belege WHERE id = ?');
    $a->execute([$id]);
    $gespeichert = $a->fetchColumn();
    if ($gespeichert !== false) { $art = (string)$gespeichert; }
}

// Die Spalten kommen ueber be_spalten_anlegen() nach; zwischen Deploy und
// Einrichtungslauf gibt es sie nicht. Sie dann zu nennen, brauchte den
// ganzen Endpunkt zum Absturz -- auch fuer die Offerte, die mit ihnen
// nichts zu tun hat.
$laufzeitDa = hat_spalte($pdo, 'be_belege', 'vertrag_beginn');
if ($laufzeitDa) {
    $monateOderNull = static function ($wert): ?int {
        if ($wert === null || $wert === '' || $wert === false) { return null; }
        return max(0, min(600, (int)round((float)$wert)));
    };
    $datumOderNull = static function ($wert): ?string {
        $d = (string)($wert ?? '');
        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) ? $d : null;
    };
    // Eine Offerte traegt keine Laufzeit. Ausdruecklich auf null gesetzt und
    // nicht bloss weggelassen: Wird aus einem Vertrag durch Duplizieren eine
    // Offerte, muessen die Felder tatsaechlich leer werden.
    $kopf['vertrag_beginn']          = $art === 'vertrag' ? $datumOderNull($in['vertrag_beginn'] ?? null) : null;
    $kopf['mindestlaufzeit_monate']  = $art === 'vertrag' ? $monateOderNull($in['mindestlaufzeit_monate'] ?? null) : null;
    $kopf['kuendigungsfrist_monate'] = $art === 'vertrag' ? $monateOderNull($in['kuendigungsfrist_monate'] ?? null) : null;
    $kopf['verlaengerung_monate']    = $art === 'vertrag' ? $monateOderNull($in['verlaengerung_monate'] ?? null) : null;
}

// Leere Zeilen fallen weg. Eine Zeile gilt als leer, wenn sie weder Namen
// noch Beschreibung noch Preis traegt -- ein reiner Textblock (Preis 0, aber
// mit Text) muss bleiben, den gibt es auf jeder zweiten Offerte.
$positionen = [];
foreach ((array)($in['positionen'] ?? []) as $p) {
    $z = beleg_position_lesen((array)$p);
    // Nur ein Vertrag kennt wiederkehrende Positionen (ENT-637). Auf einer
    // Offerte waere „pro Monat" eine Zusage, die das Dokument nirgends
    // ausweist -- es hat keine Laufzeit, in der ein Monat wiederkehrte.
    if ($art !== 'vertrag') { $z['periode'] = 'einmalig'; }
    if ($z['produkt_name'] === '' && $z['beschreibung'] === '' && $z['einzelpreis_rappen'] === 0) {
        continue;
    }
    $positionen[] = $z;
}

$pdo->beginTransaction();
try {
    $vorher = [];
    if ($id > 0) {
        $chk = $pdo->prepare('SELECT ' . implode(', ', array_keys($kopf)) . ' FROM be_belege WHERE id = ?');
        $chk->execute([$id]);
        $vorher = $chk->fetch(PDO::FETCH_ASSOC) ?: [];
        if (!$vorher) {
            $pdo->rollBack();
            json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
        }
        $satz = implode(', ', array_map(fn($f) => "$f = ?", array_keys($kopf)));
        $pdo->prepare("UPDATE be_belege SET $satz WHERE id = ?")
            ->execute(array_merge(array_values($kopf), [$id]));
        $nummer = null;
    } else {
        // Die Nummer vergibt ausschliesslich der Server, fortlaufend und
        // danach unveraenderlich -- ein mitgeschicktes Feld wird bewusst
        // nicht gelesen.
        $nummer  = beleg_naechste_nummer($pdo, $art, 'be_');
        $spalten = array_merge(['art', 'nummer'], array_keys($kopf));
        $werte   = array_merge([$art, $nummer], array_values($kopf));
        $pdo->prepare(
            'INSERT INTO be_belege (' . implode(', ', $spalten) . ') VALUES (?'
            . str_repeat(', ?', count($spalten) - 1) . ')'
        )->execute($werte);
        $id = (int)$pdo->lastInsertId();
    }

    beleg_positionen_schreiben($pdo, $id, $positionen, 'be_');
    $summen = beleg_summen_schreiben($pdo, $id, $rabattBp, 'be_');
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

// Logbuch (ENT-614) NACH dem Commit -- ein Eintrag ueber eine Aenderung, die
// dann zurueckgerollt wird, waere schlimmer als keiner. Die Positionszeilen
// bleiben aussen vor: Sie werden bei jedem Speichern neu geschrieben, ein
// Zeilenvergleich ergaebe Rauschen statt Verlauf. Was zaehlt, sind Kopf und
// Summe -- und die Summe steht im Kopf.
if ($nummer === null) {
    be_log_vergleich($pdo, $ich, 'beleg', $id, $vorher, $kopf);
} else {
    be_log($pdo, $ich, 'beleg', $id, 'angelegt', null, $art . ' ' . $nummer);
}

$antwort = ['status' => 'ok', 'id' => $id, 'summen' => $summen];
if ($nummer !== null) { $antwort['nummer'] = $nummer; }
json_response($antwort);
