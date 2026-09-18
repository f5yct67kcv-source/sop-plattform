<?php
// Legt ein Konto der Betreiber-Ebene an (ENT-524).
//
// WER DARF DAS -- zwei Faelle, und der Unterschied ist der Einstieg:
//
//   1. Es gibt noch KEIN Betreiber-Konto. Dann richtet die Verwaltung
//      dieses Betriebs das erste ein (require_verwaltung), genau wie beim
//      Einrichtungsendpunkt. Ein Endpunkt, der sich selbst freischaltet,
//      solange eine Tabelle leer ist, waere so lange offen, bis ihn jemand
//      findet.
//   2. Es gibt bereits eines. Dann kommt an diese Ebene nur noch heran,
//      wer selbst dazugehoert (require_betreiber). Das ist derselbe
//      Gedanke wie require_augenhoehe() aus ENT-501: An ein Konto, das
//      alles darf, kommt nur, wer das selbst darf. Ein Cockpit-Admin --
//      auch der eines fremden Mandanten -- darf sich ab hier kein
//      Betreiber-Konto mehr ausstellen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../logbuch.php';

$pdo = betreiber_db();
if (!be_tabellen_da($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Der Betreiber-Bereich ist noch nicht eingerichtet.'], 503);
}

$vorhanden = (int)$pdo->query('SELECT COUNT(*) FROM betreiber')->fetchColumn();
if ($vorhanden === 0) {
    // NIE IN DER DEMO (ENT-587). Die Demo-Umgebung teilt ein einziges,
    // veroeffentlichtes Anmeldekonto mit Verwaltungsrechten -- genau die
    // Voraussetzung fuer den Bootstrap. Ohne diese Wache koennte jede
    // Person mit dem Demo-Zugang sich hier ein Betreiber-Konto ausstellen,
    // und weil der naechtliche Reset der Demo-Musterdaten (ENT-523 Stufe 4)
    // noch nicht gebaut ist, bliebe der Bootstrap fuer alle folgenden
    // Demo-Besuche dauerhaft geschlossen -- ein geteilter Anmeldezugang
    // haette den Zustand der gesamten Demo veraendert. Das gilt unabhaengig
    // davon, ob betreiber_db() gerade auf die Demo-Datenbank oder auf eine
    // eigene faellt (ENT-519): Diese Wache soll nicht davon abhaengen,
    // welche Datenbank gerade dahinter steht.
    if (ist_demo()) {
        json_response(['status' => 'error',
            'message' => 'Der Betreiber-Bereich lässt sich aus der Demo-Umgebung nicht einrichten.'], 403);
    }
    // Bootstrap -- aber nur, solange höchstens ein Mandant eingetragen ist.
    // Sonst könnte die Verwaltung eines fremden Betriebs sich hier ein
    // Konto ausstellen und käme damit an jeden Mandanten. Begründung
    // ausführlich bei be_bootstrap_offen() in backend/betreiber.php.
    if (!be_bootstrap_offen($pdo)) {
        json_response(['status' => 'error',
            'message' => 'Der Betreiber-Bereich ist bereits in Betrieb. Ein weiteres Konto '
                       . 'kann nur anlegen, wer selbst eines hat.'], 403);
    }
    $user = require_session();
    require_verwaltung($user);
    $ich = null;
} else {
    $ich = require_betreiber_voll();
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$email = mb_strtolower(trim((string)($daten['email'] ?? '')));
$pass  = (string)($daten['passwort'] ?? '');

// ZWEI EINSTIEGE, EIN ERGEBNIS (ENT-613): Der Betreiber-Bereich schickt seit
// ENT-613 Anrede, Vorname und Nachname einzeln. Der Bootstrap aus dem Cockpit
// kennt nur ein Namensfeld und soll dafuer nicht umgebaut werden -- er richtet
// das allererste Konto ein, an einer Stelle, die selten laeuft und nie
// scheitern darf. Kommen die Teile nicht, werden sie aus `name` geteilt.
$anrede   = trim((string)($daten['anrede'] ?? ''));
$vorname  = trim((string)($daten['vorname']  ?? ''));
$nachname = trim((string)($daten['nachname'] ?? ''));
if ($vorname === '' && $nachname === '') {
    $t = be_name_teilen((string)($daten['name'] ?? ''));
    $vorname  = $t['vorname'];
    $nachname = $t['nachname'];
}
$name = be_name_bauen($vorname, $nachname);

if ($name === '' || $email === '') {
    json_response(['status' => 'error', 'message' => 'Name und E-Mail werden gebraucht.'], 400);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response(['status' => 'error', 'message' => 'Diese E-Mail-Adresse ist nicht gültig.'], 400);
}

// istAdmin = true, also PASSWORT_MIN_ADMIN -- die Verwaltungsschwelle.
// Wer dieses Konto hat, hat jeden Mandanten; es ist das maechtigste der
// ganzen Anlage und faellt darum nie unter diese Schwelle.
//
// KEINE ZAHL AN DIESER STELLE: Hier stand "16 Zeichen", und die Zahl war
// falsch, sobald ENT-533 sie auf 12 setzte -- ein Kommentar, der eine
// Konstante abschreibt, wird beim naechsten Bemessen zur Falschaussage.
// Die Zahl steht in backend/anmeldung.php, und nur dort.
//
// Die 12 tragen hier besser als auf der Mandantenseite: ENT-533 hat sie
// ausdruecklich unter dem Vorbehalt einer Zwei-Faktor-Pflicht gewaehlt,
// die dort noch offen ist (OP-534). Auf dieser Ebene besteht sie seit
// ENT-521 und wird im Server durchgesetzt (require_betreiber_voll()).
$fehler = passwort_pruefen($pass, $email, true);
if ($fehler !== null) {
    json_response(['status' => 'error', 'message' => $fehler], 400);
}

try {
    $stmt = $pdo->prepare(
        'INSERT INTO betreiber (name, anrede, vorname, nachname, email, passwort_hash)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([$name, $anrede, $vorname, $nachname, $email,
                    password_hash($pass, PASSWORD_BCRYPT, ['cost' => PASSWORT_KOSTEN])]);
} catch (Throwable $e) {
    // Doppelte Adresse ist der einzige erwartbare Fall und bekommt eine
    // eigene Aussage -- "geht nicht" waere hier nicht hilfreich.
    $schon = str_contains($e->getMessage(), 'uq_betreiber_email');
    json_response(['status' => 'error',
        'message' => $schon
            ? 'Für diese E-Mail-Adresse gibt es bereits ein Konto.'
            : 'Das Konto konnte nicht angelegt werden.'], 400);
}

$neueId = (int)$pdo->lastInsertId();

// Logbuch (ENT-614): Wer wann welches Konto angelegt hat. Der Bootstrap
// schreibt nichts -- dort gibt es noch keinen Betreiber als Akteur, und ein
// Eintrag mit akteur_id 0 waere eine Zeile, die nichts beantwortet.
if ($ich !== null) {
    be_log($pdo, $ich, 'konto', $neueId, 'angelegt', null, $name);
}

json_response(['status' => 'ok', 'id' => $neueId]);
