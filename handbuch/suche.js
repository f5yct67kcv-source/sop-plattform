// Suche über alle Kapitel und das Glossar hinweg. Braucht suchindex.js
// (window.HB_SUCHINDEX, von suchindex-bauen.mjs erzeugt) vor diesem Skript.
// Reines Vorkommen im Text, keine Rangfolge über Relevanz hinaus, wie sie
// bei rund hundert Einträgen auch nicht nötig ist.
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

  function suchen(text) {
    var q = text.trim().toLowerCase();
    if (q.length < 2) { return []; }
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
    return treffer.slice(0, 20).map(function (t) { return t.eintrag; });
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
