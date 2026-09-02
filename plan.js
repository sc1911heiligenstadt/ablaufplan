// Seite OHNE Anmeldung: zeigt genau einen Ablauf, den der Worker über das
// Zufallstoken herausgibt. Nutzt zeitlogik.js mit — Sortierung, Jetzt-Marke und
// Betroffenheit sollen hier und in der App dasselbe Ergebnis liefern.
//
// ⚠️ Hier wird NICHTS geschrieben. Es gibt keinen Speicherweg, keine Knöpfe zum
// Ändern und keinen Sitzungstoken.

const LS_PLAN_MANNSCHAFT = "ablaufplan_plan_mannschaft";

let ablauf = null;
let token = "";
// Am Handy steht im Raster nur ein Tag; welcher, sagt dieser Merker.
let aktiverRasterTag = null;

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

// Zustand jedes sichtbaren Punktes — die EINE Quelle für Raster und Liste.
//
// ⚠️ Schlüssel ist der LAUFINDEX, nicht die id. Die Punkte kommen als Fremddaten
// aus dem Worker; eine fehlende id (Altbestand) würde sonst alle Einträge auf
// denselben Schlüssel legen.
function punktZustaende(punkte) {
  const heute = heuteIso();
  const jetzt = jetztMinuten();
  // naechsterPunktIndex nur noch für die Stelle des Jetzt-Strichs in der Liste;
  // ob ein Punkt gelaufen ist, entscheidet vergangenePunkte je Punkt.
  const naechster = naechsterPunktIndex(punkte, heute, jetzt);
  const vorbei = vergangenePunkte(punkte, heute, jetzt);
  const map = new Map();
  punkte.forEach((p, i) => {
    map.set(p, { nr: i, vorbei: vorbei.has(p), laeuft: punktLaeuft(p, heute, jetzt) });
  });
  return { map, heute, jetzt, naechster };
}

function punktHtml(p, zustand) {
  const teams = (p.mannschaften || []).map((m) => `<span class="chip">${escapeHtml(m)}</span>`).join("");
  const wer = p.werFrei ? `<span class="chip chip-frei">${escapeHtml(p.werFrei)}</span>` : "";
  const titel = p.was || (p.mannschaften || []).join(" / ") || "Ohne Bezeichnung";
  return `<div class="punkt-zeile ${zustand.vorbei ? "ist-vorbei" : ""}" data-punkt="${zustand.nr}">
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

// ---------- Kalenderraster ----------
//
// Dasselbe Bild wie in der App: je Tag eine Spalte auf einer gemeinsamen
// Zeitachse. Die Rechnerei steht in zeitlogik.js und wird von beiden Seiten
// benutzt — wer den Link bekommt, soll denselben Plan sehen wie der Trainer.

function rasterBlockHtml(block, achse, zustand) {
  const p = block.punkt;
  const g = blockGeometrie(block, achse);
  const titel = p.was || (p.mannschaften || []).join(" / ") || "Ohne Bezeichnung";
  const wer = (p.mannschaften || []).join(" / ") || p.werFrei || "";
  const klassen = ["ras-block"];
  if (g.flach) klassen.push("flach");
  if (zustand.vorbei) klassen.push("ist-vorbei");
  if (zustand.laeuft) klassen.push("laeuft");

  // In einen halbstündigen Block passt oft nur eine Zeile. Was abgeschnitten
  // wird, steht im Titel-Attribut und vollständig in der Liste darunter.
  const tooltip = [
    (p.startZeit || "") + (p.endZeit ? "–" + p.endZeit : ""),
    titel, wer, p.ort ? "📍 " + p.ort : ""
  ].filter(Boolean).join(" · ");

  return `<button type="button" class="${klassen.join(" ")}" data-block="${zustand.nr}"
    title="${escapeHtml(tooltip)}"
    style="top:${g.top}px;height:${g.hoehe}px;left:${g.links}%;width:calc(${g.breite}% - 4px)">
    <span class="ras-block-zeit">${escapeHtml(p.startZeit || "")}${p.endZeit ? "–" + escapeHtml(p.endZeit) : ""}</span>
    <span class="ras-block-was">${escapeHtml(titel)}</span>
    ${wer ? `<span class="ras-block-wer">${escapeHtml(wer)}</span>` : ""}
  </button>`;
}

function renderRaster(punkte, zustaende) {
  const ziel = document.getElementById("raster-bereich");
  const { mitZeit, ohneZeit } = teilePunkteNachZeit(punkte);
  const tage = rasterTage(mitZeit);

  if (!tage.length) { ziel.innerHTML = ""; return; }

  // ⚠️ Der gemerkte Tag kann durch den Mannschaftsfilter weggefallen sein.
  if (!aktiverRasterTag || tage.indexOf(aktiverRasterTag) < 0) aktiverRasterTag = tage[0];

  const achse = rasterAchse(mitZeit);
  const hoehe = rasterHoehe(achse);
  const nr = (p) => (zustaende.map.get(p) || {}).nr;

  const marken = rasterStunden(achse)
    .map((m) => `<div class="ras-zeitmarke" style="height:${RASTER_STUNDE_PX}px"><span>${zeitAusMinuten(m)}</span></div>`)
    .join("");

  const spalten = tage.map((tag) => {
    const bloecke = verteileSpuren(mitZeit.filter((p) => p.datum === tag));
    const top = jetztLinieTop(tag, achse, zustaende.heute, zustaende.jetzt);
    const jetztLinie = top === null ? ""
      : `<div class="ras-jetzt" style="top:${top}px"><span>${zeitAusMinuten(zustaende.jetzt)}</span></div>`;

    return `<div class="ras-tag${tag === aktiverRasterTag ? " aktiv" : ""}" data-tag="${escapeHtml(tag)}">
      <div class="ras-tagkopf${tag === zustaende.heute ? " ist-heute" : ""}">${escapeHtml(datumText(tag))}</div>
      <div class="ras-flaeche" style="height:${hoehe}px;background-size:100% ${RASTER_STUNDE_PX}px">
        ${jetztLinie}
        ${bloecke.map((b) => rasterBlockHtml(b, achse, zustaende.map.get(b.punkt) || {})).join("")}
      </div>
    </div>`;
  });

  const chips = tage.length < 2 ? "" :
    `<div class="ras-tagchips">${tage.map((tag) =>
      `<button type="button" class="ras-chip${tag === aktiverRasterTag ? " aktiv" : ""}" data-tagchip="${escapeHtml(tag)}">
        ${escapeHtml(datumKurz(tag))} <span class="ras-chip-zahl">${mitZeit.filter((p) => p.datum === tag).length}</span>
      </button>`).join("")}</div>`;

  const ohne = !ohneZeit.length ? "" :
    `<div class="ras-ohnezeit"><span class="ras-ohnezeit-label">Ohne feste Zeit:</span>${ohneZeit.map((p) =>
      `<button type="button" data-block="${nr(p)}">${escapeHtml(p.was || (p.mannschaften || []).join(" / ") || "Ohne Bezeichnung")}</button>`
    ).join("")}</div>`;

  ziel.innerHTML = `
    <div class="ras-kopfzeile">
      <h3>Zeitplan</h3>
      <span class="ras-legende">Antippen springt zum Punkt in der Liste.</span>
    </div>
    ${ohne}
    ${chips}
    <div class="ras-raster">
      <div class="ras-zeitspalte"><div class="ras-tagkopf ras-zeitkopf">.</div>${marken}</div>
      ${spalten.join("")}
    </div>`;
}

function renderZeitstrahl(punkte, zustaende) {
  const ziel = document.getElementById("zeitstrahl");
  const mehrtaegig = ablauf.startDatum !== ablauf.endDatum;

  let html = "";
  let letzterTag = null;
  let strichGesetzt = false;

  punkte.forEach((p, i) => {
    if (mehrtaegig && p.datum !== letzterTag) {
      html += `<h3 class="tag-ueberschrift">${escapeHtml(datumText(p.datum))}</h3>`;
      letzterTag = p.datum;
    }
    if (!strichGesetzt && i === zustaende.naechster && p.datum === zustaende.heute) {
      html += `<div class="jetzt-strich"><span>jetzt ${zeitAusMinuten(zustaende.jetzt)}</span></div>`;
      strichGesetzt = true;
    }
    html += punktHtml(p, zustaende.map.get(p) || {});
  });
  if (!strichGesetzt && zustaende.naechster >= punkte.length && punkte.some((p) => p.datum === zustaende.heute)) {
    html += `<div class="jetzt-strich"><span>jetzt ${zeitAusMinuten(zustaende.jetzt)}</span></div>`;
  }
  ziel.innerHTML = html;
}

// Raster und Liste zusammen — beide bekommen dieselben Punkte und denselben
// Zustand, damit sie nie unterschiedlich einfärben.
function renderPunkte() {
  const punkte = sichtbarePunkte();
  const raster = document.getElementById("raster-bereich");
  const ziel = document.getElementById("zeitstrahl");
  const leer = document.getElementById("leer-hinweis");

  if (!punkte.length) {
    raster.innerHTML = "";
    ziel.innerHTML = "";
    leer.textContent = gewaehlteMannschaft()
      ? "Für " + gewaehlteMannschaft() + " steht in diesem Ablauf nichts an."
      : "Für diesen Ablauf sind noch keine Punkte eingetragen.";
    leer.classList.remove("hidden");
    return;
  }
  leer.classList.add("hidden");

  const zustaende = punktZustaende(punkte);
  renderRaster(punkte, zustaende);
  renderZeitstrahl(punkte, zustaende);
}

// Klick auf einen Block: die Zeile in der Liste hervorheben und dorthin
// scrollen. Auf dieser Seite gibt es nichts zu ändern — der Sprung ist alles,
// was ein Block tut.
function springeZuPunkt(nr) {
  const zeile = document.querySelector('.punkt-zeile[data-punkt="' + nr + '"]');
  if (!zeile) return;
  document.querySelectorAll(".punkt-zeile.hervorgehoben").forEach((el) => el.classList.remove("hervorgehoben"));
  zeile.classList.add("hervorgehoben");
  zeile.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => zeile.classList.remove("hervorgehoben"), 2000);
}

function renderStand() {
  const d = new Date();
  document.getElementById("stand-zeile").textContent =
    "Zuletzt geladen um " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + " Uhr.";
}

function renderAlles() {
  renderKopf();
  renderPunkte();
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
    renderPunkte();
  });
  document.getElementById("btn-plan-drucken").addEventListener("click", drucken);

  // Raster: Tageswahl am Handy und Sprung von einem Block in die Liste.
  document.getElementById("raster-bereich").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-tagchip]");
    if (chip) { aktiverRasterTag = chip.dataset.tagchip; renderPunkte(); return; }
    const block = e.target.closest("[data-block]");
    if (block) springeZuPunkt(block.dataset.block);
  });

  laden(true);

  // Selbst nachladen. Der Takt steht auch im Text auf der Seite — wer ihn hier
  // ändert, ändert ihn dort mit.
  setInterval(() => { if (ablauf) laden(false); }, 60000);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", start);
}
