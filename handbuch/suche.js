// Suche über alle Kapitel und das Glossar hinweg. Braucht suchindex.js
// (window.HB_SUCHINDEX, von suchindex-bauen.mjs erzeugt) vor diesem Skript.
//
// Zwei Stufen (Entscheid des Projektinhabers, ENT-573-Nachtrag: lokale
// Ähnlichkeitssuche statt eines Chat-Fensters mit externer KI — keine
// laufenden Kosten pro Anfrage, keine eingetippte Frage verlässt den
// Browser):
//   1. Wortgleicher Treffer irgendwo in Titel/Text/Kapitel, wie bisher.
//      Findet die Eingabe hier etwas, bleibt es dabei — unverändertes
//      Verhalten für jede Suche, die heute schon funktioniert.
//   2. Nur wenn Stufe 1 NICHTS findet: Abgleich über Wortstamm (Endungen,
//      Umlaute), ein von Hand zusammengestelltes Wörterbuch für Begriffe,
//      die im Cockpit anders heissen als im Alltag ("2FA" vs.
//      "Zwei-Faktor"), und Toleranz für einzelne Tippfehler. Das ist die
//      "KI-gestützte" Ähnlichkeit: von mir beim Schreiben zusammengestellt,
//      nicht zur Laufzeit von einem Dienst berechnet.
(function () {
  var eingabe = document.getElementById('hbSucheEingabe');
  var box = document.getElementById('hbSucheErgebnisse');
  var index = window.HB_SUCHINDEX || [];
  if (!eingabe || !box) { return; }

  var aktuelleTreffer = [];
  var hervorgehoben = -1;

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Stufe 1: unverändert gegenüber der ersten Fassung ──────────────────
  function suchenWortgleich(q) {
    var treffer = [];
    for (var i = 0; i < index.length; i++) {
      var e = index[i];
      if (!e.anker && e.ebene === 1 && !e.titel.toLowerCase().includes(q) && !e.kapitel.toLowerCase().includes(q)) {
        // Kapitel-Kopfeintrag ohne eigenen Anker: nur bei Treffer im Titel selbst zeigen.
        continue;
      }
      var imTitel = e.titel.toLowerCase().includes(q);
      var imText = e.text && e.text.toLowerCase().includes(q);
      var imKapitel = e.kapitel.toLowerCase().includes(q);
      if (imTitel || imText || imKapitel) {
        treffer.push({ eintrag: e, rang: imTitel ? 0 : (imText ? 1 : 2) });
      }
    }
    treffer.sort(function (a, b) { return a.rang - b.rang; });
    return treffer.map(function (t) { return t.eintrag; });
  }

  // ── Stufe 2: Wortstamm, Wörterbuch, Tippfehler ─────────────────────────

  // Buchstabengleichheit unabhängig von Umlauten und den häufigsten
  // deutschen Endungen — "Einsätze" soll "einsatz" finden, ohne dass jede
  // Beugung im Index oder im Wörterbuch einzeln vorkommen muss. Eine
  // Mindestlänge bleibt jeweils stehen, damit aus "Lohn" nicht "Loh" wird.
  function normalisieren(wort) {
    var w = wort.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
    if (w.length > 8) { w = w.replace(/(ungen|heiten|keiten)$/, ''); }
    if (w.length > 5) { w = w.replace(/(ern|en|em|er|es)$/, ''); }
    if (w.length > 4) { w = w.replace(/[ens]$/, ''); }
    return w;
  }

  function woerter(text) {
    return (text || '').toLowerCase().split(/[^a-zäöüß0-9-]+/).filter(Boolean);
  }

  // Begriffe, die im Cockpit oder im Alltag anders heissen als im
  // Handbuch-Text — von Hand aus den tatsächlich geschriebenen Kapiteln
  // zusammengestellt, keine automatische Übersetzung. Schlüssel in
  // natürlicher Schreibweise (lesbar, mit Umlauten); der Abgleich läuft
  // unten über dieselbe Normalisierung wie beim restlichen Text.
  var SYNONYME_ROH = {
    'login': ['anmelden'], 'einloggen': ['anmelden'], 'eingeloggt': ['anmelden'],
    'logout': ['abmelden'], 'ausloggen': ['abmelden'],
    '2fa': ['zwei-faktor'], 'mfa': ['zwei-faktor'], 'totp': ['zwei-faktor'],
    'authenticator': ['zwei-faktor'], 'notfallcode': ['zwei-faktor'], 'notfallcodes': ['zwei-faktor'],
    'kündigen': ['entfernen', 'deaktivieren'], 'kündigung': ['entfernen', 'deaktivieren'],
    'entlassen': ['entfernen', 'deaktivieren'], 'entlassung': ['entfernen', 'deaktivieren'],
    'rauswerfen': ['entfernen'], 'rauswurf': ['entfernen'],
    'gehalt': ['lohn'], 'salär': ['lohn'], 'verdienst': ['lohn'], 'lohnzettel': ['lohn'],
    'urlaub': ['ferien'],
    'schicht': ['einsatz'], 'schichten': ['einsätze'], 'dienst': ['einsatz'],
    'kontrollgang': ['rundgang'], 'kontrollgänge': ['rundgang'], 'patrouille': ['rundgang'], 'streife': ['rundgang'],
    'handy': ['erfassung', 'app'], 'smartphone': ['erfassung', 'app'], 'mobiltelefon': ['erfassung', 'app'],
    'spesen': ['auslagen'], 'kilometergeld': ['auslagen'], 'fahrkosten': ['auslagen'], 'fahrtkosten': ['auslagen'],
    'fakturieren': ['rechnung'], 'faktura': ['rechnung'],
    'liegenschaft': ['objekt'], 'gebäude': ['objekt'],
    'setup': ['einrichtung'], 'konfiguration': ['einrichtung'], 'konfigurieren': ['einrichtung'],
    'chef': ['administrator'], 'geschäftsführer': ['administrator'], 'vorgesetzter': ['administrator'],
    'stundenlohn': ['lohnansatz'], 'stundensatz': ['lohnansatz'],
    'sozialversicherungsnummer': ['ahv'],
    'zeiterfassung': ['abgleich'], 'arbeitszeit': ['abgleich'],
    'passwort vergessen': ['zurücksetzen'], 'pw vergessen': ['zurücksetzen'],
  };
  var SYNONYME = {};
  Object.keys(SYNONYME_ROH).forEach(function (k) {
    SYNONYME[normalisieren(k)] = SYNONYME_ROH[k].map(normalisieren);
  });

  // Ein einzelner Buchstabenfehler — ersetzt, vertauscht, fehlt oder zu
  // viel — nur ab einer gewissen Wortlänge sinnvoll, sonst träfe jedes
  // kurze Wort auf jedes andere kurze Wort. Vertauschte Nachbarbuchstaben
  // ("abgliech" für "abgleich") zählen dabei als EIN Fehler, nicht als
  // zwei — das ist die häufigste Tippfehler-Art beim schnellen Tippen.
  function tippfehlerAehnlich(a, b) {
    if (a === b) { return true; }
    if (a.length === b.length) {
      var i = 0;
      while (i < a.length && a[i] === b[i]) { i++; }
      if (i + 1 < a.length && a[i] === b[i + 1] && a[i + 1] === b[i]
          && a.slice(i + 2) === b.slice(i + 2)) {
        return true; // Vertauschung
      }
      return a.slice(i + 1) === b.slice(i + 1); // eine Ersetzung an Stelle i
    }
    if (Math.abs(a.length - b.length) === 1) {
      var kurz = a.length < b.length ? a : b, lang = a.length < b.length ? b : a;
      var ik = 0, il = 0, fehler = 0;
      while (ik < kurz.length && il < lang.length) {
        if (kurz[ik] === lang[il]) { ik++; il++; continue; }
        fehler++;
        if (fehler > 1) { return false; }
        il++;
      }
      return true;
    }
    return false;
  }

  // Bester Treffergrad eines normalisierten Suchworts gegen eine
  // normalisierte Wortliste (Titel, Text oder Kapitelname eines Eintrags).
  function trefferGrad(qNorm, wortlisteNorm) {
    var praefix = false;
    for (var i = 0; i < wortlisteNorm.length; i++) {
      var w = wortlisteNorm[i];
      if (w === qNorm) { return 3; }
      if (qNorm.length >= 4 && w.indexOf(qNorm) === 0) { praefix = true; }
    }
    if (praefix) { return 2; }
    if (qNorm.length >= 5) {
      for (var j = 0; j < wortlisteNorm.length; j++) {
        if (wortlisteNorm[j].length >= 5 && tippfehlerAehnlich(qNorm, wortlisteNorm[j])) { return 1; }
      }
    }
    return 0;
  }

  // Normalisierte Wortlisten je Eintrag einmalig vorbereiten, nicht bei
  // jedem Tastendruck neu aus dem Text schneiden.
  var vorbereitet = index.map(function (e) {
    return {
      eintrag: e,
      titelWoerter: woerter(e.titel).map(normalisieren),
      textWoerter: woerter(e.text).map(normalisieren),
      kapitelWoerter: woerter(e.kapitel).map(normalisieren),
    };
  });

  function suchenAehnlich(qRoh) {
    var qTokens = woerter(qRoh);
    if (!qTokens.length) { return []; }

    // Jedes eingegebene Wort UND seine Wörterbuch-Erweiterungen zählen mit
    // — die Erweiterung schwächer gewichtet, damit ein direkter Treffer bei
    // gleicher Grad-Stufe immer vorgeht.
    var gesuchte = [];
    qTokens.forEach(function (t) {
      var n = normalisieren(t);
      gesuchte.push({ wort: n, gewicht: 1 });
      var erweiterung = SYNONYME[n];
      if (erweiterung) { erweiterung.forEach(function (s) { gesuchte.push({ wort: s, gewicht: 0.6 }); }); }
    });

    var treffer = [];
    vorbereitet.forEach(function (v) {
      var e = v.eintrag;
      var punkteTitel = 0, punkteText = 0, punkteKapitel = 0;
      gesuchte.forEach(function (g) {
        punkteTitel = Math.max(punkteTitel, trefferGrad(g.wort, v.titelWoerter) * g.gewicht);
        punkteText = Math.max(punkteText, trefferGrad(g.wort, v.textWoerter) * g.gewicht);
        punkteKapitel = Math.max(punkteKapitel, trefferGrad(g.wort, v.kapitelWoerter) * g.gewicht);
      });
      var summe = punkteTitel * 3 + punkteText * 2 + punkteKapitel;
      if (!e.anker && e.ebene === 1 && punkteTitel === 0) {
        // Kapitel-Kopfeintrag: wie in Stufe 1 nur bei echtem Titeltreffer zeigen.
        summe = 0;
      }
      if (summe > 0) { treffer.push({ eintrag: e, summe: summe }); }
    });
    treffer.sort(function (a, b) { return b.summe - a.summe; });
    return treffer.map(function (t) { return t.eintrag; });
  }

  function suchen(text) {
    var q = text.trim().toLowerCase();
    if (q.length < 2) { return []; }
    var treffer = suchenWortgleich(q);
    if (!treffer.length) { treffer = suchenAehnlich(text.trim()); }
    return treffer.slice(0, 20);
  }

  function ziel(e) {
    return e.datei + (e.anker ? '#' + e.anker : '');
  }

  function zeichnen(treffer, q) {
    aktuelleTreffer = treffer;
    hervorgehoben = -1;
    if (!treffer.length) {
      box.innerHTML = '<div class="hb-suche-leer">Kein Treffer für „' + esc(q) + '".</div>';
      box.hidden = false;
      return;
    }
    box.innerHTML = treffer.map(function (e, i) {
      var typ = e.ebene === 1 ? 'Kapitel' : e.kapitel;
      return '<a class="hb-suche-treffer" href="' + esc(ziel(e)) + '" data-i="' + i + '">'
        + '<span class="hb-suche-kapitel">' + esc(typ) + '</span>'
        + '<span class="hb-suche-titel">' + esc(e.titel) + '</span>'
        + (e.text ? '<span class="hb-suche-text">' + esc(e.text) + '</span>' : '')
        + '</a>';
    }).join('');
    box.hidden = false;
  }

  function schliessen() {
    box.hidden = true;
    box.innerHTML = '';
    hervorgehoben = -1;
  }

  eingabe.addEventListener('input', function () {
    var treffer = suchen(eingabe.value);
    if (!eingabe.value.trim()) { schliessen(); return; }
    zeichnen(treffer, eingabe.value.trim());
  });

  eingabe.addEventListener('keydown', function (ev) {
    var links = box.querySelectorAll('.hb-suche-treffer');
    if (ev.key === 'Escape') {
      schliessen();
      eingabe.blur();
    } else if (ev.key === 'ArrowDown' && links.length) {
      ev.preventDefault();
      hervorgehoben = Math.min(hervorgehoben + 1, links.length - 1);
      links.forEach(function (l, i) { l.classList.toggle('aktiv', i === hervorgehoben); });
      links[hervorgehoben].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'ArrowUp' && links.length) {
      ev.preventDefault();
      hervorgehoben = Math.max(hervorgehoben - 1, 0);
      links.forEach(function (l, i) { l.classList.toggle('aktiv', i === hervorgehoben); });
      links[hervorgehoben].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      var ziel = hervorgehoben >= 0 ? links[hervorgehoben] : links[0];
      if (ziel) { window.location.href = ziel.getAttribute('href'); }
    }
  });

  eingabe.addEventListener('focus', function () {
    if (eingabe.value.trim() && aktuelleTreffer.length) { box.hidden = false; }
  });

  document.addEventListener('click', function (ev) {
    if (!ev.target.closest('.hb-suche')) { schliessen(); }
  });
})();
