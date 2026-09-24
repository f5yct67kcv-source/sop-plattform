<?php
// Einen Vorratsplatz einem Kunden zuteilen (ENT-705).
//
// EIN SCHRITT: Kundendaten eintragen und aktivieren geschehen in einer
// einzigen Anweisung. Zwei Schritte liessen zwischen sich einen Vorratsplatz
// mit Kundennamen stehen -- oder einen aktiven Mandanten ohne Subdomain.
//
// DER SERVER SPERRT, nicht die Oberflaeche:
//   - Nur eine Zeile mit Status Vorrat laesst sich zuteilen. Ein laufender
//     Kunde wuerde hier sonst ueberschrieben.
//   - Nur eine uebergabefaehige Anlage -- dieselbe Pruefung wie die taegliche
//     (mandant_vorrat_platz_pruefen). Ein Kunde bekaeme sonst eine Anlage, in
//     der die Einladung scheitert.
//   - Name, Subdomain und Kanton muessen gesetzt sein.
//
// VERBINDET zur Anlage, um den Bauplan zu pruefen. Gelesen wird
// ausschliesslich information_schema (kern_schema_fehlend), keine
// Verwaltungstabelle; die Anlage gehoert in diesem Moment noch keinem Kunden.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../planung_einrichten_kern.php'; // kern_schema_fehlend()

$ich = require_betreiber_voll();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_response(['status' => 'error', 'message' => 'Nur POST.'], 405);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id    = (int)($daten['id'] ?? 0);

$s = $pdo->prepare('SELECT * FROM mandant WHERE id = ?');
$s->execute([$id]);
$m = $s->fetch(PDO::FETCH_ASSOC);
if (!$m) {
    json_response(['status' => 'error', 'message' => 'Diesen Platz gibt es nicht.'], 404);
}
if ((string)$m['status'] !== MANDANT_STATUS_VORRAT) {
    json_response(['status' => 'error',
        'message' => 'Diese Anlage liegt nicht im Vorrat — sie gehört schon einem Kunden.'], 409);
}

// ── Kundendaten ───────────────────────────────────────────────────────
$name      = trim((string)($daten['name'] ?? ''));
$subdomain = strtolower(trim((string)($daten['subdomain'] ?? '')));
$kanton    = be_kanton_normal((string)($daten['kanton'] ?? ''));

if ($name === '') {
    json_response(['status' => 'error', 'message' => 'Der Name des Kunden wird gebraucht.'], 400);
}
if ($subdomain === '') {
    json_response(['status' => 'error', 'message' => 'Die Subdomain wird gebraucht.'], 400);
}
if (!mandant_subdomain_gueltig($subdomain)) {
    json_response(['status' => 'error',
        'message' => 'Die Subdomain darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten, '
                   . 'ohne Bindestrich am Anfang oder Ende.'], 400);
}
if ($kanton === null) {
    json_response(['status' => 'error',
        'message' => 'Der Kanton wird als zweistelliges Kürzel gebraucht, zum Beispiel BE.'], 400);
}
$belegt = $pdo->prepare('SELECT id FROM mandant WHERE subdomain = ? AND id <> ?');
$belegt->execute([$subdomain, $id]);
if ($belegt->fetchColumn() !== false) {
    json_response(['status' => 'error',
        'message' => 'Diese Subdomain ist bereits einem anderen Mandanten zugeteilt.'], 400);
}

$werte = ['name' => $name, 'subdomain' => $subdomain, 'kanton' => $kanton]
       + be_mandant_vertrag_werte($pdo, $daten);
$vertragFehler = be_mandant_vertrag_fehler($werte);
if ($vertragFehler !== null) {
    json_response(['status' => 'error', 'message' => $vertragFehler], 400);
}

// ── Ist die Anlage uebergabefaehig? ───────────────────────────────────
//
// Dieselbe Pruefung wie die taegliche Meldung. Der Grund geht mit, damit
// niemand raten muss, wo er nachsehen soll.
$bauplan = static fn(array $zeile): array => kern_schema_fehlend(mandant_db($zeile));
$befund = mandant_vorrat_platz_pruefen($m, $bauplan);
if (!$befund['bereit']) {
    json_response(['status' => 'error',
        'message' => 'Diese Anlage ist nicht übergabefähig: ' . $befund['text'] . '.',
        'lage' => $befund['lage']], 409);
}

// ── Zuteilen, in einer Anweisung ──────────────────────────────────────
//
// "AND status = vorrat" im UPDATE selbst: Teilen zwei gleichzeitig denselben
// Platz zu, gewinnt einer, und der andere bekommt eine Antwort statt still
// den ersten zu ueberschreiben.
$vorher = [];
foreach (array_keys($werte) as $feld) { $vorher[$feld] = $m[$feld] ?? null; }
$satz = implode(', ', array_map(fn($f) => "$f = ?", array_keys($werte)));
$stmt = $pdo->prepare(
    'UPDATE mandant SET ' . $satz . ", status = 'aktiv', geaendert_am = NOW()
      WHERE id = ? AND status = ?"
);
$stmt->execute([...array_values($werte), $id, MANDANT_STATUS_VORRAT]);
if ($stmt->rowCount() === 0) {
    json_response(['status' => 'error',
        'message' => 'Dieser Platz wurde gerade anderweitig zugeteilt oder entfernt.'], 409);
}

be_log_vergleich($pdo, $ich, 'mandant', $id, $vorher, $werte);
be_log($pdo, $ich, 'mandant', $id, 'status', MANDANT_STATUS_VORRAT, 'aktiv');
// Wie beim Statuswechsel: Wer spaeter nachsieht, sucht den Moment der
// Uebergabe an einen Kunden, nicht einen Statuswechsel.
be_log($pdo, $ich, 'mandant', $id, 'aus dem Vorrat zugeteilt', (string)$m['name'], $name);

json_response(['status' => 'ok', 'id' => $id, 'name' => $name]);
