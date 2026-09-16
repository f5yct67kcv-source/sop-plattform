<?php require __DIR__ . '/_guard.php'; ?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Übersicht – Handbuch Cockpit</title>
<link rel="stylesheet" href="handbuch.css">
</head>
<body>
<div class="hb-shell">
  <aside class="hb-side" id="hbSide">
    <div class="hb-brand">
      <a href="index.php" style="text-decoration:none">
        <span class="titel">Handbuch</span>
        <span class="unter">Cockpit von GuardOpS</span>
      </a>
      <button class="hb-menu-btn" id="hbMenuBtn" aria-label="Menü" aria-expanded="false">☰</button>
    </div>
    <div class="hb-suche">
      <input type="search" id="hbSucheEingabe" placeholder="Suchen…" aria-label="Handbuch durchsuchen" autocomplete="off">
      <div class="hb-suche-ergebnisse" id="hbSucheErgebnisse" hidden></div>
    </div>
    <div class="hb-nav-wrap">
      <div class="hb-gruppe">Einstieg</div>
      <ul class="hb-nav">
        <li><a href="index.php" class="aktiv">Übersicht</a></li>
        <li><a href="erste-schritte.php">Erste Schritte</a></li>
      </ul>
      <div class="hb-gruppe">Erfassung (App)</div>
      <ul class="hb-nav">
        <li><a href="erfassung.php">Erfassung</a></li>
      </ul>
      <div class="hb-gruppe">Cockpit</div>
      <ul class="hb-nav">
        <li><a href="hb-planung.php">Planung</a></li>
        <li><a href="hb-kunden.php">Kunden</a></li>
        <li><a href="personal.php">Personal</a></li>
        <li><a href="hb-lohn.php">Lohn</a></li>
        <li><a href="abgleich.php">Abgleich</a></li>
        <li><a href="betrieb.php">Betrieb</a></li>
      </ul>
      <div class="hb-gruppe">Weitere Oberflächen</div>
      <ul class="hb-nav">
        <li><a href="hb-kundenportal.php">Kundenportal</a></li>
      </ul>
      <div class="hb-gruppe">Nachschlagen</div>
      <ul class="hb-nav">
        <li><a href="glossar.php">Glossar</a></li>
      </ul>
    </div>
    <div class="hb-side-fuss">
      Aus dem Quelltext zusammengestellt — Einzelheiten unten auf dieser Seite.
    </div>
  </aside>

  <div class="hb-main">
    <div class="hb-content">

      <p class="hb-kicker">Handbuch</p>
      <h1>Cockpit von GuardOpS — Bedienungsanleitung</h1>
      <p class="hb-lead">Eine Bedienungsanleitung für das Werkzeug, mit dem ein
      Mandant Einsätze plant, Personal und Kunden verwaltet, Ist-Zeiten
      abgleicht und der eigenen Kundschaft Einblick gibt. Für Mitarbeitende und
      Admins — geordnet nach den Oberflächen und Bereichen, wie sie im Werkzeug
      selbst heissen. Recherchiert am Beispiel von CUPI&nbsp;24, dem ersten
      Mandanten der Plattform (ENT-568) — die Abläufe gelten unverändert für
      jeden weiteren Mandanten.</p>

      <div class="hb-kasten hb-achtung">
        <p class="hb-kasten-titel">Woher dieser Inhalt stammt — bitte vor dem Verteilen lesen</p>
        <p>Dieses Handbuch ist am 11.09.2026 durch Lesen des Quelltexts
        (<code>dashboard.html</code>, <code>app.html</code>, <code>index.html</code>,
        <code>portal.html</code> und der zugehörigen Backend-Dateien) entstanden —
        <b>nicht</b> durch Ausprobieren am laufenden, angemeldeten Cockpit. Für
        Bedienschritte ist das eine solide Grundlage; die Projektregel „gemessen,
        nicht nachgelesen" gilt aber für die tatsächliche Bildschirmdarstellung
        weiterhin uneingeschränkt. Vor der Verteilung an die Belegschaft lohnt sich
        ein Abgleich mit dem echten Bildschirm, insbesondere für Bereiche mit
        vielen Formularfeldern. Generierter Inhalt gilt bis dahin als ungeprüft —
        genau wie generierter Code.</p>
      </div>

      <div class="hb-kasten hb-hinweis">
        <p class="hb-kasten-titel">Wie dieser Zugang funktioniert</p>
        <p>Diese Seiten sind über den öffentlichen Server erreichbar, aber
        nicht öffentlich: Jede Seite verlangt ein kurzlebiges Zugangs-Ticket
        (4&nbsp;Stunden gültig, als HttpOnly-Cookie), das ausschliesslich der
        Knopf „Handbuch" im Cockpit ausstellt — erreichbar für jeden
        angemeldeten Cockpit-Zugang, unabhängig von Rolle oder Bereich
        (Entscheid des Projektinhabers: keine vertraulichen Inhalte hier).
        Ohne gültiges Ticket zeigt jede Seite nur einen Hinweis, nie den
        Inhalt. Nur am Desktop verlinkt, nicht in der mobilen App.</p>
      </div>

      <h2>Wer arbeitet wo</h2>
      <p>Ausführlich in <a href="erste-schritte.php">Erste Schritte</a>. Kurzform:
      die <b>App</b> (Erfassung) für alle Mitarbeitenden, das <b>Cockpit</b> für
      Personen mit Verwaltungsrecht, das <b>Kundenportal</b> für die Kundschaft.
      Zwei weitere Oberflächen — die öffentliche Homepage und der
      Betreiber-Bereich — gehören nicht zur täglichen Arbeit eines Mandanten und
      sind bewusst nicht Teil dieses Handbuchs (siehe <code>README.md</code>).</p>

      <h2>Kapitel</h2>
      <div class="hb-karten">
        <a class="hb-karte" href="erste-schritte.php">
          <p class="titel">Erste Schritte <span class="hb-status erste-fassung">Erste Fassung</span></p>
          <p class="text">Anmelden, Zwei-Faktor-Anmeldung, Rollen und Rechte im Überblick.</p>
        </a>
        <a class="hb-karte" href="erfassung.php">
          <p class="titel">Erfassung <span class="hb-status erste-fassung">Erste Fassung</span></p>
          <p class="text">Die mobile App: Einsätze, Rapport, Rundgänge, Fahrzeugübernahme, Mitteilungen.</p>
        </a>
        <a class="hb-karte" href="hb-planung.php">
          <p class="titel">Planung <span class="hb-status erste-fassung">Erste Fassung</span></p>
          <p class="text">Einsätze, Objektplanung, Masterschichten, Tagesplan, Feiertage, Zuteilung.</p>
        </a>
        <a class="hb-karte" href="hb-kunden.php">
          <p class="titel">Kunden <span class="hb-status erste-fassung">Erste Fassung</span></p>
          <p class="text">Kundenstamm, Import, KI-Recherche, Objekte, Rapporte, Offerten &amp; Rechnungen.</p>
        </a>
        <a class="hb-karte" href="personal.php">
          <p class="titel">Personal <span class="hb-status erste-fassung">Erste Fassung</span></p>
          <p class="text">Mitarbeitende, Personaldossier, vertrauliche Angaben, Verlauf, Dienstpläne.</p>
        </a>
        <a class="hb-karte" href="hb-lohn.php">
          <p class="titel">Lohn <span class="hb-status erste-fassung">Erste Fassung</span></p>
          <p class="text">Lohnansatz, Lohnarten, Sätze und Regelwerk, Lohnläufe — Rohzeit, Nettozeit, Zeitbonus und Bewertet sauber getrennt.</p>
        </a>
        <a class="hb-karte" href="abgleich.php">
          <p class="titel">Abgleich <span class="hb-status erste-fassung">Erste Fassung</span></p>
          <p class="text">Ist-Zeiten, Pensen und Ruhezeit — und wo Rapporte tatsächlich stehen.</p>
        </a>
        <a class="hb-karte" href="betrieb.php">
          <p class="titel">Betrieb <span class="hb-status erste-fassung">Erste Fassung</span></p>
          <p class="text">Hauptdomizil, Briefkopf, Rollen &amp; Berechtigungen, Fahrzeuge, Support.</p>
        </a>
        <a class="hb-karte" href="hb-kundenportal.php">
          <p class="titel">Kundenportal <span class="hb-status erste-fassung">Erste Fassung</span></p>
          <p class="text">Was Kundinnen und Kunden sehen — und wie ein Zugang entsteht.</p>
        </a>
        <a class="hb-karte" href="glossar.php">
          <p class="titel">Glossar</p>
          <p class="text">Über 40 Begriffe, wie sie im Cockpit tatsächlich verwendet werden.</p>
        </a>
      </div>

      <h2>Was (noch) fehlt</h2>
      <p>Bewusst nicht in dieser ersten Fassung:</p>
      <ul>
        <li><b>Homepage</b> und <b>Betreiber-Bereich</b> — siehe oben, ausserhalb
        des täglichen Betriebs eines Mandanten.</li>
        <li><b>Skizzenmodus</b> und andere Entwicklungswerkzeuge — für Admins
        interessant, aber Werkzeug fürs Bauen, nicht fürs Benutzen.</li>
        <li>Screenshots — dieses Handbuch ist bisher reiner Text. Bilder vom
        echten Bildschirm wären der nächste sinnvolle Ausbauschritt, gerade weil
        Punkt „Woher dieser Inhalt stammt" oben eine Bildschirmprüfung ohnehin
        nahelegt.</li>
      </ul>

      <p class="hb-fussnote">Struktur und erste Kapitel angelegt am 11.09.2026.
      Ergänzungen folgen demselben Aufbau: ein Kapitel pro Oberfläche/Bereich,
      Begriffe im gemeinsamen Glossar, Quellenangabe am Kapitelende.</p>

    </div>
  </div>
</div>
<script src="suchindex.js"></script>
<script src="suche.js"></script>
<script src="handbuch.js"></script>
</body>
</html>
