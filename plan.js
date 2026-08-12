// Seite OHNE Anmeldung: zeigt genau einen Ablauf, den der Worker über das
// Zufallstoken herausgibt. Nutzt zeitlogik.js mit — Sortierung, Jetzt-Marke und
// Betroffenheit sollen hier und in der App dasselbe Ergebnis liefern.
//
// ⚠️ Hier wird NICHTS geschrieben. Es gibt keinen Speicherweg, keine Knöpfe zum
// Ändern und keinen Sitzungstoken.

const LS_PLAN_MANNSCHAFT = "ablaufplan_plan_mannschaft";

let ablauf = null;
let token = "";

function escapeHtml(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function heuteIso() { return isoAusDatum(new Date()); }
function jetztMinuten() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

function lsLesen(k, standard) {
  try { const v = localStorage.getItem(k); return v === null ? standard : v; } catch (_) { return standard; }
}
function lsSchreiben(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

function zeigeFehler(titel, text) {
  document.getElementById("lade-karte").classList.add("hidden");
  document.getElementById("inhalt").classList.add("hidden");
  const karte = document.getElementById("fehler-karte");
  document.getElementById("fehler-titel").textContent = titel;
  document.getElementById("fehler-text").textContent = text;
  karte.classList.remove("hidden");
}

// ---------- Mannschaftsfilter ----------

// Nur Mannschaften anbieten, die in diesem Ablauf wirklich vorkommen.
function mannschaftenImAblauf() {
  const gesehen = new Map();
  sortierePunkte(ablauf.punkte).forEach((p) => (p.mannschaften || []).forEach((m) => {
    const k = normMannschaft(m);
    if (k && !gesehen.has(k)) gesehen.set(k, m);
  }));
  return Array.from(gesehen.values());
}

function gewaehlteMannschaft() {
  return document.getElementById("plan-mannschaft").value || "";
}

function sichtbarePunkte() {
  const alle = sortierePunkte(ablauf.punkte);
  const m = gewaehlteMannschaft();
  if (!m) return alle;
  return alle.filter((p) => punktBetrifft(p, [m]));
}

// ---------- Rendern ----------

function renderKopf() {
  const zeitraum = ablauf.startDatum === ablauf.endDatum
    ? datumText(ablauf.startDatum)
    : datumText(ablauf.startDatum) + " bis " + datumText(ablauf.endDatum);
  document.getElementById("kopf").innerHTML = `
    <h2>${escapeHtml(ablauf.titel || "Ablaufplan")}</h2>
    <p class="kopf-zeitraum">🗓 ${escapeHtml(zeitraum)}</p>
    ${ablauf.ort ? `<p class="kopf-ort">📍 ${escapeHtml(ablauf.ort)}</p>` : ""}
    ${ablauf.info ? `<p class="kopf-info">${escapeHtml(ablauf.info).replace(/\n/g, "<br>")}</p>` : ""}`;
}

function renderAuswahl() {
  const wahl = document.getElementById("plan-mannschaft");
  const namen = mannschaftenImAblauf();
  // Vorwahl: was im Link steht, sonst was das Gerät gemerkt hat. Beides nur,
  // wenn die Mannschaft in diesem Ablauf überhaupt vorkommt.
  const ausLink = new URLSearchParams(location.search).get("m") || "";
  const gemerkt = lsLesen(LS_PLAN_MANNSCHAFT, "");
  const treffer = (wunsch) => namen.find((n) => normMannschaft(n) === normMannschaft(wunsch)) || "";
  const vorwahl = treffer(ausLink) || treffer(gemerkt) || "";

  wahl.innerHTML = '<option value="">allen (ganzer Ablauf)</option>' +
    namen.map((n) => `<option value="${escapeHtml(n)}"${n === vorwahl ? " selected" : ""}>${escapeHtml(n)}</option>`).join("");
  wahl.classList.toggle("hidden", namen.length === 0);
}

function punktHtml(p, zustand) {
  const teams = (p.mannschaften || []).map((m) => `<span class="chip">${escapeHtml(m)}</span>`).join("");
  const wer = p.werFrei ? `<span class="chip chip-frei">${escapeHtml(p.werFrei)}</span>` : "";
  const titel = p.was || (p.mannschaften || []).join(" / ") || "Ohne Bezeichnung";
  return `<div class="punkt-zeile ${zustand.klassen}">
    <div class="pz-zeit">
      <span class="pz-start">${escapeHtml(p.startZeit || "—")}</span>
      ${p.endZeit ? `<span class="pz-bis">bis ${escapeHtml(p.endZeit)}</span>` : ""}
    </div>
    <div class="pz-karte">
      <div class="pz-kopf">
        <span class="pz-was">${escapeHtml(titel)}</span>
        ${zustand.laeuft ? '<span class="chip chip-jetzt">läuft</span>' : ""}
      </div>
      ${teams || wer ? `<div class="pz-wer">${teams}${wer}</div>` : ""}
      ${p.ort ? `<div class="pz-ort">📍 ${escapeHtml(p.ort)}</div>` : ""}
      ${p.notiz ? `<div class="pz-notiz">${escapeHtml(p.notiz).replace(/\n/g, "<br>")}</div>` : ""}
    </div>
  </div>`;
}

function renderZeitstrahl() {
  const punkte = sichtbarePunkte();
  const ziel = document.getElementById("zeitstrahl");
  const leer = document.getElementById("leer-hinweis");

  if (!punkte.length) {
    ziel.innerHTML = "";
    leer.textContent = gewaehlteMannschaft()
      ? "Für " + gewaehlteMannschaft() + " steht in diesem Ablauf nichts an."
      : "Für diesen Ablauf sind noch keine Punkte eingetragen.";
    leer.classList.remove("hidden");
    return;
  }
  leer.classList.add("hidden");

  const heute = heuteIso();
  const jetzt = jetztMinuten();
  const naechster = naechsterPunktIndex(punkte, heute, jetzt);
  const mehrtaegig = ablauf.startDatum !== ablauf.endDatum;

  let html = "";
  let letzterTag = null;
  let strichGesetzt = false;

  punkte.forEach((p, i) => {
    if (mehrtaegig && p.datum !== letzterTag) {
      html += `<h3 class="tag-ueberschrift">${escapeHtml(datumText(p.datum))}</h3>`;
      letzterTag = p.datum;
    }
    if (!strichGesetzt && i === naechster && p.datum === heute) {
      html += `<div class="jetzt-strich"><span>jetzt ${zeitAusMinuten(jetzt)}</span></div>`;
      strichGesetzt = true;
    }
    html += punktHtml(p, {
      klassen: i < naechster ? "ist-vorbei" : "",
      laeuft: punktLaeuft(p, heute, jetzt)
    });
  });
  if (!strichGesetzt && naechster >= punkte.length && punkte.some((p) => p.datum === heute)) {
    html += `<div class="jetzt-strich"><span>jetzt ${zeitAusMinuten(jetzt)}</span></div>`;
  }
  ziel.innerHTML = html;
}

function renderStand() {
  const d = new Date();
  document.getElementById("stand-zeile").textContent =
    "Zuletzt geladen um " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + " Uhr.";
}

function renderAlles() {
  renderKopf();
  renderZeitstrahl();
  renderStand();
}

// ---------- Drucken ----------

function drucken() {
  const punkte = sichtbarePunkte();
  const zeitraum = ablauf.startDatum === ablauf.endDatum
    ? datumText(ablauf.startDatum)
    : datumText(ablauf.startDatum) + " bis " + datumText(ablauf.endDatum);
  const mehrtaegig = ablauf.startDatum !== ablauf.endDatum;
  const m = gewaehlteMannschaft();

  let zeilen = "";
  let letzterTag = null;
  punkte.forEach((p) => {
    if (mehrtaegig && p.datum !== letzterTag) {
      zeilen += `<tr class="druck-tag"><td colspan="5">${escapeHtml(datumText(p.datum))}</td></tr>`;
      letzterTag = p.datum;
    }
    zeilen += `<tr>
      <td class="druck-zeit">${escapeHtml(p.startZeit || "")}${p.endZeit ? "–" + escapeHtml(p.endZeit) : ""}</td>
      <td>${escapeHtml((p.mannschaften || []).join(" / "))}${p.werFrei ? ((p.mannschaften || []).length ? ", " : "") + escapeHtml(p.werFrei) : ""}</td>
      <td>${escapeHtml(p.was || "")}</td>
      <td>${escapeHtml(p.ort || "")}</td>
      <td>${escapeHtml(p.notiz || "")}</td>
    </tr>`;
  });

  document.getElementById("print-content").innerHTML = `
    <h1>${escapeHtml(ablauf.titel || "Ablaufplan")}</h1>
    <p class="print-meta">${escapeHtml(zeitraum)}${ablauf.ort ? " · " + escapeHtml(ablauf.ort) : ""}${m ? " · nur " + escapeHtml(m) : ""}</p>
    ${ablauf.info ? `<p class="print-info">${escapeHtml(ablauf.info).replace(/\n/g, "<br>")}</p>` : ""}
    <table class="print-table">
      <thead><tr><th>Zeit</th><th>Wer</th><th>Was</th><th>Ort</th><th>Notiz</th></tr></thead>
      <tbody>${zeilen}</tbody>
    </table>`;

  document.body.classList.add("printing-report");
  window.print();
  setTimeout(() => document.body.classList.remove("printing-report"), 300);
}

// ---------- Laden ----------

// Ein Ablauf aus dem Worker ist Fremddaten: fehlende Felder dürfen die Seite
// nicht umwerfen.
function normalisiere(a) {
  const o = a && typeof a === "object" ? a : {};
  const punkte = Array.isArray(o.punkte) ? o.punkte : [];
  return {
    titel: String(o.titel || ""),
    startDatum: String(o.startDatum || ""),
    endDatum: String(o.endDatum || o.startDatum || ""),
    ort: String(o.ort || ""),
    info: String(o.info || ""),
    punkte: punkte.map((p) => ({
      id: String((p && p.id) || ""),
      datum: String((p && p.datum) || ""),
      startZeit: String((p && p.startZeit) || ""),
      endZeit: String((p && p.endZeit) || ""),
      was: String((p && p.was) || ""),
      mannschaften: Array.isArray(p && p.mannschaften) ? p.mannschaften.map(String) : [],
      werFrei: String((p && p.werFrei) || ""),
      ort: String((p && p.ort) || ""),
      notiz: String((p && p.notiz) || "")
    }))
  };
}

async function laden(ersterAufruf) {
  try {
    const roh = await ablaufOeffentlichLaden(token);
    ablauf = normalisiere(roh);
  } catch (e) {
    // ⚠️ Beim NACHLADEN nicht die schon sichtbare Seite wegwerfen: ein kurzer
    // Netzausfall am Sportplatz darf einem nicht den Plan unter den Fingern
    // wegnehmen. Nur der erste Aufruf zeigt einen Fehler.
    if (!ersterAufruf) { console.warn("Nachladen fehlgeschlagen", e); return; }
    if (e && e.name === "LinkUngueltigError") {
      zeigeFehler("Der Link funktioniert nicht", "Er ist unvollständig oder gehört zu keinem Ablauf mehr.");
    } else if (e && e.name === "LinkZurueckgezogenError") {
      zeigeFehler("Der Link wurde zurückgezogen", e.message);
    } else if (e && e.name === "ZuVieleVersucheError") {
      zeigeFehler("Zu viele Versuche", "Bitte in einer Stunde noch einmal probieren.");
    } else {
      zeigeFehler("Es hat nicht geklappt", e && e.message ? e.message : String(e));
    }
    return;
  }

  document.getElementById("lade-karte").classList.add("hidden");
  // ⚠️ Die Fehlerkarte muss beim Gelingen ausdrücklich weg. Ohne das stünde nach
  // einem misslungenen ersten Versuch für immer „Der Link funktioniert nicht"
  // über einem Plan, der längst wieder da ist.
  document.getElementById("fehler-karte").classList.add("hidden");
  document.getElementById("inhalt").classList.remove("hidden");
  if (ersterAufruf) {
    renderAuswahl();
    document.title = (ablauf.titel || "Ablaufplan") + " – 1. SC 1911 Heiligenstadt";
  }
  renderAlles();
}

function start() {
  token = new URLSearchParams(location.search).get("t") || "";

  document.getElementById("plan-mannschaft").addEventListener("change", (e) => {
    lsSchreiben(LS_PLAN_MANNSCHAFT, e.target.value);
    renderZeitstrahl();
  });
  document.getElementById("btn-plan-drucken").addEventListener("click", drucken);

  laden(true);

  // Selbst nachladen. Der Takt steht auch im Text auf der Seite — wer ihn hier
  // ändert, ändert ihn dort mit.
  setInterval(() => { if (ablauf) laden(false); }, 60000);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", start);
}
