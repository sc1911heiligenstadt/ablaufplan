// Ablaufplan — Zustand, Rechte, Speichern, Zeitstrahl.
//
// Die reine Rechnerei (Zeiten, Sortierung, Textübernahme, Verschieben) steht in
// zeitlogik.js und ist dort ohne Oberfläche prüfbar. Hier steht alles, was das
// Fenster anfasst.

// ---------- Zustand ----------

let appData = { meta: {}, ablaeufe: [] };
let currentUser = null;
let mannschaftsNamen = [];      // aus den Trainerprofilen
let offenerAblaufId = null;
let punktModalId = null;        // null = neuer Punkt
let verschiebeAbId = null;
let speichertGerade = false;

const LS_NUR_MEINE = "ablaufplan_nur_meine";
const LS_MEINE_MANNSCHAFT = "ablaufplan_meine_mannschaft";

function lsLesen(schluessel, standard) {
  try { const v = localStorage.getItem(schluessel); return v === null ? standard : v; } catch (_) { return standard; }
}
function lsSchreiben(schluessel, wert) {
  try { localStorage.setItem(schluessel, wert); } catch (_) {}
}

// ---------- Helfer ----------

function escapeHtml(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function neueId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// 32 Byte Zufall als 64 Hex-Zeichen. ⚠️ Die Form muss zur Prüfung im Worker
// passen (/^[0-9a-f]{64}$/) — wer hier etwas ändert, muss dort mitziehen.
function neuesLinkToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function heuteIso() { return isoAusDatum(new Date()); }
function jetztMinuten() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

function canEdit() { return !!currentUser && (currentUser.isAdmin || !!currentUser.canEdit); }

function bytesText(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " kB";
  return (n / (1024 * 1024)).toFixed(1).replace(".", ",") + " MB";
}

function setStatus(text, art) {
  const el = document.getElementById("save-status");
  if (!el) return;
  el.textContent = text || "";
  el.className = "header-status" + (art ? " is-" + art : "");
}

// ---------- Daten normalisieren ----------

function normalisierePunkt(roh) {
  const p = roh && typeof roh === "object" ? roh : {};
  return {
    id: p.id || neueId(),
    datum: typeof p.datum === "string" ? p.datum : "",
    startZeit: typeof p.startZeit === "string" ? p.startZeit : "",
    endZeit: typeof p.endZeit === "string" ? p.endZeit : "",
    was: typeof p.was === "string" ? p.was : "",
    mannschaften: Array.isArray(p.mannschaften) ? p.mannschaften.map(String).filter(Boolean) : [],
    werFrei: typeof p.werFrei === "string" ? p.werFrei : "",
    ort: typeof p.ort === "string" ? p.ort : "",
    notiz: typeof p.notiz === "string" ? p.notiz : ""
  };
}

function normalisiereAblauf(roh) {
  const a = roh && typeof roh === "object" ? roh : {};
  const ablauf = {
    id: a.id || neueId(),
    titel: typeof a.titel === "string" ? a.titel : "",
    startDatum: typeof a.startDatum === "string" ? a.startDatum : "",
    endDatum: typeof a.endDatum === "string" ? a.endDatum : "",
    ort: typeof a.ort === "string" ? a.ort : "",
    info: typeof a.info === "string" ? a.info : "",
    erstelltVon: typeof a.erstelltVon === "string" ? a.erstelltVon : "",
    erstelltAm: typeof a.erstelltAm === "string" ? a.erstelltAm : "",
    geaendertAm: typeof a.geaendertAm === "string" ? a.geaendertAm : "",
    linkToken: typeof a.linkToken === "string" ? a.linkToken : "",
    linkWiderrufen: !!a.linkWiderrufen,
    anhaenge: Array.isArray(a.anhaenge) ? a.anhaenge.filter((x) => x && x.id).map((x) => ({
      id: String(x.id), name: String(x.name || "Datei"),
      mime: String(x.mime || "application/octet-stream"), size: Number(x.size) || 0
    })) : [],
    punkte: Array.isArray(a.punkte) ? a.punkte.map(normalisierePunkt) : []
  };
  if (!ablauf.endDatum) ablauf.endDatum = ablauf.startDatum;
  return synchronisiereZeitraum(ablauf);
}

function normalisiereDaten(roh) {
  const d = roh && typeof roh === "object" ? roh : {};
  return {
    meta: d.meta && typeof d.meta === "object" ? d.meta : {},
    ablaeufe: Array.isArray(d.ablaeufe) ? d.ablaeufe.map(normalisiereAblauf) : []
  };
}

function ablaufById(id) { return appData.ablaeufe.find((a) => a.id === id) || null; }
function offenerAblauf() { return offenerAblaufId ? ablaufById(offenerAblaufId) : null; }

// ---------- Speichern ----------
//
// Bewusst KEIN debouncedes Autosave: in dieser App entsteht jede Änderung durch
// einen ausdrücklichen Klick (Formular speichern, verschieben, löschen). Damit
// gibt es weder einen offenen Timer beim Verlassen der Seite noch einen halben
// Stand. Der In-Flight-Guard bleibt trotzdem, sonst könnten zwei schnelle Klicks
// mit demselben alten ETag losfahren.
async function speichern(meldung) {
  if (speichertGerade) return false;
  speichertGerade = true;
  setStatus("Speichern…", "pending");
  try {
    appData.meta.stand = new Date().toISOString();
    await gatewaySave(appData);
    setStatus(meldung || "Gespeichert", "ok");
    return true;
  } catch (e) {
    if (e instanceof NotLoggedInError) { zeigeAbmeldung(); return false; }
    if (e instanceof ConflictError) {
      setStatus("Konflikt", "error");
      alert("Ein anderes Gerät hat inzwischen gespeichert. Der aktuelle Stand wird neu geladen — bitte die Änderung danach noch einmal machen.");
      await neuLaden();
      return false;
    }
    setStatus("Fehler", "error");
    alert("Speichern fehlgeschlagen: " + (e && e.message ? e.message : e));
    return false;
  } finally {
    speichertGerade = false;
  }
}

async function neuLaden() {
  const roh = await gatewayLoad();
  appData = normalisiereDaten(roh);
  if (offenerAblaufId && !ablaufById(offenerAblaufId)) offenerAblaufId = null;
  renderAlles();
}

function zeigeAbmeldung() {
  document.getElementById("app-shell").style.display = "none";
  const cs = document.getElementById("connect-screen");
  cs.style.display = "";
  document.getElementById("connect-message").textContent =
    "Die Sitzung ist abgelaufen. Bitte über die Tools-Übersicht neu anmelden.";
}

// ---------- Meine Mannschaften ----------

// Die eigenen Mannschaften stehen im Profil (Trainerdaten). Wer dort nichts
// stehen hat — Geschäftsstelle, Führung, Eltern am Link —, wählt selbst eine aus;
// die Wahl merkt sich das Gerät.
function meineMannschaften() {
  const ausProfil = (currentUser && Array.isArray(currentUser.mannschaften)) ? currentUser.mannschaften.filter(Boolean) : [];
  if (ausProfil.length) return ausProfil;
  const gewaehlt = lsLesen(LS_MEINE_MANNSCHAFT, "");
  return gewaehlt ? [gewaehlt] : [];
}

function hatProfilMannschaften() {
  return !!(currentUser && Array.isArray(currentUser.mannschaften) && currentUser.mannschaften.filter(Boolean).length);
}

// Alle Mannschaftsnamen, die irgendwo vorkommen: aus den Trainerprofilen UND aus
// den bereits erfassten Punkten. Sonst fehlte in der Ankreuzliste genau die
// Mannschaft, die gerade per Textliste hereingekommen ist.
function alleMannschaftsNamen() {
  const gesehen = new Map(); // normalisiert -> Anzeigename
  mannschaftsNamen.forEach((n) => { const k = normMannschaft(n); if (k && !gesehen.has(k)) gesehen.set(k, n); });
  appData.ablaeufe.forEach((a) => a.punkte.forEach((p) => p.mannschaften.forEach((n) => {
    const k = normMannschaft(n);
    if (k && !gesehen.has(k)) gesehen.set(k, n);
  })));
  return Array.from(gesehen.values()).sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
}

function nurMeineAktiv() { return lsLesen(LS_NUR_MEINE, "0") === "1"; }

function sichtbarePunkte(ablauf) {
  const alle = sortierePunkte(ablauf.punkte);
  if (!nurMeineAktiv()) return alle;
  const meine = meineMannschaften();
  if (!meine.length) return alle;
  return alle.filter((p) => punktBetrifft(p, meine));
}

// ---------- Rendern: Kartenlisten ----------

function ablaufKarteHtml(a) {
  const zeitraum = a.startDatum === a.endDatum
    ? datumText(a.startDatum)
    : datumText(a.startDatum) + " bis " + datumText(a.endDatum);
  const meine = meineMannschaften();
  const betrifft = meine.length && a.punkte.some((p) => punktBetrifft(p, meine));
  const anzahl = a.punkte.length;
  return `<button class="ablauf-karte${betrifft ? " betrifft-mich" : ""}" data-ablauf="${escapeHtml(a.id)}">
    <span class="ak-titel">${escapeHtml(a.titel || "Ohne Titel")}${betrifft ? '<span class="chip chip-meine">betrifft dich</span>' : ""}</span>
    <span class="ak-zeit">${escapeHtml(zeitraum)}</span>
    ${a.ort ? `<span class="ak-ort">📍 ${escapeHtml(a.ort)}</span>` : ""}
    <span class="ak-meta">${anzahl} ${anzahl === 1 ? "Punkt" : "Punkte"}${a.linkToken && !a.linkWiderrufen ? " · 🔗 Link vergeben" : ""}</span>
  </button>`;
}

function renderListen() {
  const heute = heuteIso();
  const kommend = appData.ablaeufe.filter((a) => !istVergangen(a, heute))
    .sort((a, b) => (a.startDatum || "").localeCompare(b.startDatum || ""));
  const frueher = appData.ablaeufe.filter((a) => istVergangen(a, heute))
    .sort((a, b) => (b.endDatum || "").localeCompare(a.endDatum || ""));

  document.getElementById("ablauf-karten").innerHTML = kommend.map(ablaufKarteHtml).join("");
  document.getElementById("ablaeufe-empty").classList.toggle("hidden", kommend.length > 0);
  document.getElementById("frueher-karten").innerHTML = frueher.map(ablaufKarteHtml).join("");
  document.getElementById("frueher-empty").classList.toggle("hidden", frueher.length > 0);
}

// ---------- Rendern: ein Ablauf ----------

function renderDetailKopf(a) {
  const zeitraum = a.startDatum === a.endDatum
    ? datumText(a.startDatum)
    : datumText(a.startDatum) + " bis " + datumText(a.endDatum);
  document.getElementById("detail-kopf").innerHTML = `
    <div class="kopf-zeile">
      <h2>${escapeHtml(a.titel || "Ohne Titel")}</h2>
      <div class="btn-row editor-only${canEdit() ? "" : " hidden"}">
        <button class="btn small secondary" id="btn-ablauf-bearbeiten">Bearbeiten</button>
        <button class="btn small secondary" id="btn-ablauf-kopieren">Kopieren</button>
      </div>
    </div>
    <p class="kopf-zeitraum">🗓 ${escapeHtml(zeitraum)}</p>
    ${a.ort ? `<p class="kopf-ort">📍 ${escapeHtml(a.ort)}</p>` : ""}
    ${a.info ? `<p class="kopf-info">${escapeHtml(a.info).replace(/\n/g, "<br>")}</p>` : ""}
  `;
  const b1 = document.getElementById("btn-ablauf-bearbeiten");
  if (b1) b1.addEventListener("click", () => oeffneAblaufModal(a.id));
  const b2 = document.getElementById("btn-ablauf-kopieren");
  if (b2) b2.addEventListener("click", () => ablaufKopieren(a.id));
}

function punktKarteHtml(p, zustand) {
  const teams = p.mannschaften.map((m) => `<span class="chip">${escapeHtml(m)}</span>`).join("");
  const wer = p.werFrei ? `<span class="chip chip-frei">${escapeHtml(p.werFrei)}</span>` : "";
  const titel = p.was || p.mannschaften.join(" / ") || "Ohne Bezeichnung";
  const bis = p.endZeit ? `<span class="pz-bis">bis ${escapeHtml(p.endZeit)}</span>` : "";
  return `<div class="punkt-zeile ${zustand.klassen}" data-punkt="${escapeHtml(p.id)}">
    <div class="pz-zeit">
      <span class="pz-start">${escapeHtml(p.startZeit || "—")}</span>
      ${bis}
    </div>
    <div class="pz-karte">
      <div class="pz-kopf">
        <span class="pz-was">${escapeHtml(titel)}</span>
        ${zustand.laeuft ? '<span class="chip chip-jetzt">läuft</span>' : ""}
        ${zustand.meiner ? '<span class="chip chip-meine">du</span>' : ""}
      </div>
      ${teams || wer ? `<div class="pz-wer">${teams}${wer}</div>` : ""}
      ${p.ort ? `<div class="pz-ort">📍 ${escapeHtml(p.ort)}</div>` : ""}
      ${p.notiz ? `<div class="pz-notiz">${escapeHtml(p.notiz).replace(/\n/g, "<br>")}</div>` : ""}
      <div class="pz-aktionen editor-only${canEdit() ? "" : " hidden"}">
        <button class="linkartig" data-aktion="bearbeiten" data-punkt="${escapeHtml(p.id)}">bearbeiten</button>
        <button class="linkartig" data-aktion="verschieben" data-punkt="${escapeHtml(p.id)}">ab hier verschieben</button>
      </div>
    </div>
  </div>`;
}

function renderZeitstrahl() {
  const a = offenerAblauf();
  const ziel = document.getElementById("zeitstrahl");
  if (!a) { ziel.innerHTML = ""; return; }

  const punkte = sichtbarePunkte(a);
  document.getElementById("punkte-empty").classList.toggle("hidden", punkte.length > 0);
  if (!punkte.length) { ziel.innerHTML = ""; return; }

  const heute = heuteIso();
  const jetzt = jetztMinuten();
  const meine = meineMannschaften();
  const naechster = naechsterPunktIndex(punkte, heute, jetzt);

  // Nach Tagen gruppieren. Bei einem eintägigen Ablauf bleibt die Tagesüberschrift
  // weg — sie stünde sonst als einzelne Zeile über allem und sagte nichts Neues.
  const mehrtaegig = a.startDatum !== a.endDatum;
  let html = "";
  let letzterTag = null;
  let jetztStrichGesetzt = false;

  punkte.forEach((p, i) => {
    if (mehrtaegig && p.datum !== letzterTag) {
      html += `<h3 class="tag-ueberschrift">${escapeHtml(datumText(p.datum))}</h3>`;
      letzterTag = p.datum;
    }
    // Der Jetzt-Strich steht genau vor dem ersten Punkt, der noch kommt — aber
    // nur, wenn dieser Ablauf heute überhaupt läuft.
    if (!jetztStrichGesetzt && i === naechster && p.datum === heute) {
      html += `<div class="jetzt-strich"><span>jetzt ${zeitAusMinuten(jetzt)}</span></div>`;
      jetztStrichGesetzt = true;
    }
    html += punktKarteHtml(p, {
      klassen: [
        i < naechster ? "ist-vorbei" : "",
        punktBetrifft(p, meine) ? "ist-meiner" : ""
      ].filter(Boolean).join(" "),
      laeuft: punktLaeuft(p, heute, jetzt),
      meiner: meine.length > 0 && punktBetrifft(p, meine)
    });
  });

  // Läuft der Tag schon länger als der letzte Punkt, steht der Strich am Ende.
  if (!jetztStrichGesetzt && naechster >= punkte.length && punkte.some((p) => p.datum === heute)) {
    html += `<div class="jetzt-strich"><span>jetzt ${zeitAusMinuten(jetzt)}</span></div>`;
  }

  ziel.innerHTML = html;
}

function renderAnhaenge() {
  const a = offenerAblauf();
  const karte = document.getElementById("anhang-karte");
  if (!a) { karte.classList.add("hidden"); return; }
  // Ohne Anhänge und ohne Bearbeiten-Recht braucht die Karte niemand.
  const zeigen = a.anhaenge.length > 0 || canEdit();
  karte.classList.toggle("hidden", !zeigen);
  document.getElementById("anhang-liste").innerHTML = a.anhaenge.length
    ? a.anhaenge.map((d) => `<div class="anhang-zeile">
        <button class="linkartig" data-anhang="${escapeHtml(d.id)}">📎 ${escapeHtml(d.name)}</button>
        <span class="muted">${escapeHtml(bytesText(d.size))}</span>
        <button class="icon-btn editor-only${canEdit() ? "" : " hidden"}" data-anhang-weg="${escapeHtml(d.id)}" title="Entfernen">×</button>
      </div>`).join("")
    : '<p class="muted">Keine Anhänge.</p>';
}

function renderWerkzeuge() {
  const schalter = document.getElementById("nur-meine");
  schalter.checked = nurMeineAktiv();

  const wahl = document.getElementById("meine-mannschaft");
  // Steht im Profil eine Mannschaft, ist die Auswahl überflüssig — sonst würde
  // eine Handwahl still die Profilangabe überstimmen.
  if (hatProfilMannschaften()) {
    wahl.classList.add("hidden");
    document.getElementById("nur-meine-text").textContent =
      "nur meine (" + currentUser.mannschaften.filter(Boolean).join(", ") + ")";
  } else {
    wahl.classList.remove("hidden");
    document.getElementById("nur-meine-text").textContent = "nur";
    const gewaehlt = lsLesen(LS_MEINE_MANNSCHAFT, "");
    wahl.innerHTML = '<option value="">— Mannschaft wählen —</option>' +
      alleMannschaftsNamen().map((n) => `<option value="${escapeHtml(n)}"${n === gewaehlt ? " selected" : ""}>${escapeHtml(n)}</option>`).join("");
  }
}

function renderDetail() {
  const a = offenerAblauf();
  document.getElementById("ansicht-liste").classList.toggle("hidden", !!a);
  document.getElementById("ansicht-detail").classList.toggle("hidden", !a);
  if (!a) return;
  renderDetailKopf(a);
  renderWerkzeuge();
  renderAnhaenge();
  renderZeitstrahl();
}

function renderAlles() {
  renderListen();
  renderDetail();
}

// ---------- Ablauf-Formular ----------

function oeffneAblaufModal(id) {
  const a = id ? ablaufById(id) : null;
  document.getElementById("ablauf-modal-title").textContent = a ? "Ablauf bearbeiten" : "Neuer Ablauf";
  document.getElementById("af-titel").value = a ? a.titel : "";
  document.getElementById("af-start").value = a ? a.startDatum : heuteIso();
  document.getElementById("af-ende").value = a ? a.endDatum : "";
  document.getElementById("af-ort").value = a ? a.ort : "";
  document.getElementById("af-info").value = a ? a.info : "";
  document.getElementById("btn-ablauf-loeschen").classList.toggle("hidden", !a);
  document.getElementById("ablauf-modal").dataset.id = a ? a.id : "";
  document.getElementById("ablauf-modal").classList.remove("hidden");
}

async function ablaufSpeichern() {
  const modal = document.getElementById("ablauf-modal");
  const id = modal.dataset.id || "";
  const titel = document.getElementById("af-titel").value.trim();
  const start = document.getElementById("af-start").value;
  let ende = document.getElementById("af-ende").value;

  if (!titel) { alert("Bitte einen Titel eintragen."); return; }
  if (!start) { alert("Bitte ein Startdatum wählen."); return; }
  if (!ende) ende = start;
  if (ende < start) { alert("Das Ende liegt vor dem Anfang."); return; }

  const vorher = JSON.stringify(appData.ablaeufe);
  let ablauf = id ? ablaufById(id) : null;
  if (!ablauf) {
    ablauf = normalisiereAblauf({
      id: neueId(),
      erstelltVon: currentUser ? currentUser.username : "",
      erstelltAm: new Date().toISOString()
    });
    appData.ablaeufe.push(ablauf);
  }
  ablauf.titel = titel;
  ablauf.startDatum = start;
  ablauf.endDatum = ende;
  ablauf.ort = document.getElementById("af-ort").value.trim();
  ablauf.info = document.getElementById("af-info").value.trim();
  ablauf.geaendertAm = new Date().toISOString();
  synchronisiereZeitraum(ablauf);

  if (await speichern("Ablauf gespeichert")) {
    modal.classList.add("hidden");
    offenerAblaufId = ablauf.id;
    renderAlles();
  } else {
    appData.ablaeufe = JSON.parse(vorher).map(normalisiereAblauf);
  }
}

async function ablaufLoeschen() {
  const id = document.getElementById("ablauf-modal").dataset.id;
  const a = ablaufById(id);
  if (!a) return;
  if (!confirm(`„${a.titel}“ mit ${a.punkte.length} Punkten wirklich löschen? Ein vergebener Link funktioniert danach nicht mehr.`)) return;

  const dateien = a.anhaenge.slice();
  appData.ablaeufe = appData.ablaeufe.filter((x) => x.id !== id);
  if (await speichern("Ablauf gelöscht")) {
    // Erst nach erfolgreichem Speichern aufräumen — sonst wären die Dateien weg
    // und der Eintrag stünde noch da.
    for (const d of dateien) await gatewayDeleteFile(d.id);
    document.getElementById("ablauf-modal").classList.add("hidden");
    offenerAblaufId = null;
    renderAlles();
  } else {
    await neuLaden();
  }
}

async function ablaufKopieren(id) {
  const quelle = ablaufById(id);
  if (!quelle) return;
  const kopie = normalisiereAblauf(JSON.parse(JSON.stringify(quelle)));
  kopie.id = neueId();
  kopie.titel = quelle.titel + " (Kopie)";
  kopie.erstelltVon = currentUser ? currentUser.username : "";
  kopie.erstelltAm = new Date().toISOString();
  kopie.geaendertAm = "";
  // ⚠️ Weder Link noch Anhänge werden mitkopiert: ein Token darf nie zwei
  // Abläufe aufsperren, und eine Anhang-Id zeigt auf genau eine Datei — beide
  // Einträge zeigten sonst auf dieselbe, und das Löschen des einen risse dem
  // anderen die Datei weg.
  kopie.linkToken = "";
  kopie.linkWiderrufen = false;
  kopie.anhaenge = [];
  kopie.punkte = kopie.punkte.map((p) => Object.assign({}, p, { id: neueId() }));
  appData.ablaeufe.push(kopie);
  if (await speichern("Kopie angelegt")) {
    offenerAblaufId = kopie.id;
    renderAlles();
    oeffneAblaufModal(kopie.id);
  } else {
    await neuLaden();
  }
}

// ---------- Punkt-Formular ----------

function renderMannschaftsAuswahl(gewaehlt) {
  const namen = alleMannschaftsNamen();
  const ziel = document.getElementById("pf-mannschaften");
  const gewaehltNorm = (gewaehlt || []).map(normMannschaft);
  ziel.innerHTML = namen.map((n) => `<label class="checkbox-row">
    <input type="checkbox" value="${escapeHtml(n)}"${gewaehltNorm.indexOf(normMannschaft(n)) >= 0 ? " checked" : ""} />
    <span>${escapeHtml(n)}</span>
  </label>`).join("");
  document.getElementById("pf-mannschaften-leer").classList.toggle("hidden", namen.length > 0);
}

function oeffnePunktModal(id) {
  const a = offenerAblauf();
  if (!a) return;
  const p = id ? a.punkte.find((x) => x.id === id) : null;
  punktModalId = p ? p.id : null;
  document.getElementById("punkt-modal-title").textContent = p ? "Punkt bearbeiten" : "Neuer Punkt";
  document.getElementById("pf-datum").value = p ? p.datum : (a.startDatum || heuteIso());
  document.getElementById("pf-datum").min = a.startDatum || "";
  document.getElementById("pf-start").value = p ? p.startZeit : "";
  document.getElementById("pf-ende").value = p ? p.endZeit : "";
  document.getElementById("pf-was").value = p ? p.was : "";
  document.getElementById("pf-werfrei").value = p ? p.werFrei : "";
  document.getElementById("pf-ort").value = p ? p.ort : "";
  document.getElementById("pf-notiz").value = p ? p.notiz : "";
  renderMannschaftsAuswahl(p ? p.mannschaften : []);
  document.getElementById("btn-punkt-loeschen").classList.toggle("hidden", !p);
  document.getElementById("punkt-modal").classList.remove("hidden");
}

async function punktSpeichern() {
  const a = offenerAblauf();
  if (!a) return;
  const datum = document.getElementById("pf-datum").value;
  const start = document.getElementById("pf-start").value;
  const ende = document.getElementById("pf-ende").value;
  if (!datum) { alert("Bitte einen Tag wählen."); return; }
  if (!start) { alert("Bitte eine Uhrzeit eintragen."); return; }
  if (ende && minutenAusZeit(ende) !== null && minutenAusZeit(start) !== null
      && minutenAusZeit(ende) < minutenAusZeit(start)) {
    if (!confirm("Die Endzeit liegt vor der Startzeit. Trotzdem speichern?")) return;
  }

  const mannschaften = Array.from(document.querySelectorAll("#pf-mannschaften input:checked")).map((i) => i.value);
  const felder = {
    datum, startZeit: start, endZeit: ende,
    was: document.getElementById("pf-was").value.trim(),
    mannschaften,
    werFrei: document.getElementById("pf-werfrei").value.trim(),
    ort: document.getElementById("pf-ort").value.trim(),
    notiz: document.getElementById("pf-notiz").value.trim()
  };

  const vorher = JSON.stringify(a.punkte);
  if (punktModalId) {
    const p = a.punkte.find((x) => x.id === punktModalId);
    if (p) Object.assign(p, felder);
  } else {
    a.punkte.push(normalisierePunkt(Object.assign({ id: neueId() }, felder)));
  }
  a.geaendertAm = new Date().toISOString();
  synchronisiereZeitraum(a);

  if (await speichern("Punkt gespeichert")) {
    document.getElementById("punkt-modal").classList.add("hidden");
    renderAlles();
  } else {
    a.punkte = JSON.parse(vorher);
  }
}

async function punktLoeschen() {
  const a = offenerAblauf();
  if (!a || !punktModalId) return;
  const p = a.punkte.find((x) => x.id === punktModalId);
  if (!p) return;
  if (!confirm("Diesen Punkt löschen?")) return;
  const vorher = JSON.stringify(a.punkte);
  a.punkte = a.punkte.filter((x) => x.id !== punktModalId);
  a.geaendertAm = new Date().toISOString();
  if (await speichern("Punkt gelöscht")) {
    document.getElementById("punkt-modal").classList.add("hidden");
    renderAlles();
  } else {
    a.punkte = JSON.parse(vorher);
  }
}

// ---------- Liste einfügen ----------

function oeffneTextModal() {
  const a = offenerAblauf();
  if (!a) return;
  document.getElementById("tf-datum").value = a.startDatum || heuteIso();
  document.getElementById("tf-text").value = "";
  document.getElementById("tf-vorschau").innerHTML = "";
  document.getElementById("text-modal").classList.remove("hidden");
}

function textVorschau() {
  const text = document.getElementById("tf-text").value;
  const datum = document.getElementById("tf-datum").value || heuteIso();
  const ziel = document.getElementById("tf-vorschau");
  if (!text.trim()) { ziel.innerHTML = ""; return null; }

  let n = 0;
  const r = parseAblaufText(text, datum, alleMannschaftsNamen(), () => "vorschau-" + (++n));
  const zeilen = r.punkte.map((p) => `<div class="vorschau-zeile">
      <span class="vz-zeit">${escapeHtml(p.startZeit)}${p.endZeit ? "–" + escapeHtml(p.endZeit) : ""}</span>
      <span class="vz-team">${p.mannschaften.length ? escapeHtml(p.mannschaften.join(" / ")) : "—"}</span>
      <span class="vz-was">${escapeHtml(p.was || "")}</span>
      <span class="vz-tag">${escapeHtml(datumKurz(p.datum))}</span>
    </div>`).join("");
  const warn = r.warnungen.length
    ? `<div class="vorschau-warnung"><strong>${r.warnungen.length} ${r.warnungen.length === 1 ? "Zeile wird" : "Zeilen werden"} nicht übernommen</strong> (keine Uhrzeit erkannt):<br>${
        r.warnungen.map((w) => "Zeile " + w.zeile + ": " + escapeHtml(w.text)).join("<br>")}</div>`
    : "";
  ziel.innerHTML = `<h3 class="vorschau-titel">Vorschau: ${r.punkte.length} ${r.punkte.length === 1 ? "Punkt" : "Punkte"}</h3>${zeilen}${warn}`;
  return r;
}

async function textUebernehmen() {
  const a = offenerAblauf();
  if (!a) return;
  const r = textVorschau();
  if (!r || !r.punkte.length) { alert("Es wurde keine Zeile mit Uhrzeit erkannt."); return; }

  const vorher = JSON.stringify(a.punkte);
  r.punkte.forEach((p) => a.punkte.push(normalisierePunkt(Object.assign({}, p, { id: neueId() }))));
  a.geaendertAm = new Date().toISOString();
  synchronisiereZeitraum(a);

  if (await speichern(r.punkte.length + " Punkte übernommen")) {
    document.getElementById("text-modal").classList.add("hidden");
    renderAlles();
  } else {
    a.punkte = JSON.parse(vorher);
  }
}

// ---------- Verschieben ----------

function oeffneVerschiebeModal(punktId) {
  const a = offenerAblauf();
  if (!a) return;
  const p = a.punkte.find((x) => x.id === punktId);
  if (!p) return;
  verschiebeAbId = punktId;

  const sortiert = sortierePunkte(a.punkte);
  const ab = sortiert.findIndex((x) => x.id === punktId);
  const anzahl = sortiert.length - ab;
  document.getElementById("verschiebe-context").innerHTML =
    `Ab <strong>${escapeHtml(p.startZeit || "—")} ${escapeHtml(p.was || p.mannschaften.join(" / "))}</strong> ` +
    `wandern <strong>${anzahl} ${anzahl === 1 ? "Punkt" : "Punkte"}</strong> mit. Alles davor bleibt stehen.`;

  document.getElementById("verschiebe-schritte").innerHTML = VERSCHIEBE_SCHRITTE
    .map((m) => `<button class="btn small secondary" data-schritt="${m}">${m > 0 ? "+" : ""}${m} Min</button>`).join("");
  document.getElementById("vf-minuten").value = 15;
  verschiebeVorschau();
  document.getElementById("verschiebe-modal").classList.remove("hidden");
}

function verschiebeVorschau() {
  const a = offenerAblauf();
  const ziel = document.getElementById("verschiebe-vorschau");
  if (!a || !verschiebeAbId) { ziel.innerHTML = ""; return; }
  const minuten = Number(document.getElementById("vf-minuten").value) || 0;
  if (!minuten) { ziel.innerHTML = '<p class="muted">Null Minuten ändert nichts.</p>'; return; }

  const alt = sortierePunkte(a.punkte);
  const neu = sortierePunkte(verschiebeAb(a.punkte, verschiebeAbId, minuten));
  const altNachId = new Map(alt.map((p) => [p.id, p]));
  const zeilen = neu.filter((p) => {
    const v = altNachId.get(p.id);
    return v && (v.startZeit !== p.startZeit || v.datum !== p.datum);
  }).map((p) => {
    const v = altNachId.get(p.id);
    const tagWechsel = v.datum !== p.datum ? ` <span class="vz-tag">${escapeHtml(datumKurz(p.datum))}</span>` : "";
    return `<div class="vorschau-zeile">
      <span class="vz-zeit">${escapeHtml(v.startZeit)} → <strong>${escapeHtml(p.startZeit)}</strong>${tagWechsel}</span>
      <span class="vz-was">${escapeHtml(p.was || p.mannschaften.join(" / "))}</span>
    </div>`;
  }).join("");
  ziel.innerHTML = zeilen
    ? `<h3 class="vorschau-titel">Das ändert sich</h3>${zeilen}`
    : '<p class="muted">Nichts zu verschieben.</p>';
}

async function verschiebenAusfuehren() {
  const a = offenerAblauf();
  if (!a || !verschiebeAbId) return;
  const minuten = Number(document.getElementById("vf-minuten").value) || 0;
  if (!minuten) { alert("Bitte eine Zahl ungleich null eintragen."); return; }

  const vorher = JSON.stringify(a.punkte);
  a.punkte = verschiebeAb(a.punkte, verschiebeAbId, minuten);
  a.geaendertAm = new Date().toISOString();
  synchronisiereZeitraum(a);

  if (await speichern("Um " + minuten + " Minuten verschoben")) {
    document.getElementById("verschiebe-modal").classList.add("hidden");
    renderAlles();
  } else {
    a.punkte = JSON.parse(vorher);
  }
}

// ---------- Link ohne Anmeldung ----------

function linkUrl(a, mannschaft) {
  if (!a.linkToken) return "";
  let url = LINK_BASIS + "?t=" + encodeURIComponent(a.linkToken);
  if (mannschaft) url += "&m=" + encodeURIComponent(mannschaft);
  return url;
}

function renderLinkModal() {
  const a = offenerAblauf();
  if (!a) return;
  const aktiv = !!a.linkToken && !a.linkWiderrufen;
  const wahl = document.getElementById("lf-mannschaft");
  const bisher = wahl.value;
  // Nur Mannschaften anbieten, die in diesem Ablauf auch wirklich vorkommen —
  // ein Link auf eine Mannschaft ohne Punkte zeigte eine leere Seite.
  const imAblauf = [];
  const gesehen = new Set();
  sortierePunkte(a.punkte).forEach((p) => p.mannschaften.forEach((m) => {
    const k = normMannschaft(m);
    if (k && !gesehen.has(k)) { gesehen.add(k); imAblauf.push(m); }
  }));
  wahl.innerHTML = '<option value="">Ganzer Ablauf</option>' +
    imAblauf.map((m) => `<option value="${escapeHtml(m)}"${m === bisher ? " selected" : ""}>nur ${escapeHtml(m)}</option>`).join("");

  document.getElementById("lf-url").value = aktiv ? linkUrl(a, wahl.value) : "";
  document.getElementById("lf-status").textContent = aktiv
    ? "Der Link ist aktiv."
    : (a.linkToken ? "Der Link wurde zurückgezogen und funktioniert nicht mehr." : "Es gibt noch keinen Link.");
  document.getElementById("btn-link-kopieren").disabled = !aktiv;
  document.getElementById("btn-link-oeffnen").disabled = !aktiv;
  document.getElementById("btn-link-widerrufen").classList.toggle("hidden", !aktiv);
  document.getElementById("btn-link-neu").classList.toggle("hidden", aktiv);
}

async function oeffneLinkModal() {
  const a = offenerAblauf();
  if (!a) return;
  document.getElementById("link-modal").classList.remove("hidden");
  if (!a.linkToken) {
    a.linkToken = neuesLinkToken();
    a.linkWiderrufen = false;
    if (!await speichern("Link erzeugt")) { a.linkToken = ""; await neuLaden(); }
  }
  renderLinkModal();
}

async function linkWiderrufen() {
  const a = offenerAblauf();
  if (!a || !a.linkToken) return;
  if (!confirm("Den Link zurückziehen? Wer ihn schon bekommen hat, sieht danach nichts mehr.")) return;
  a.linkWiderrufen = true;
  if (await speichern("Link zurückgezogen")) renderLinkModal(); else await neuLaden();
}

async function linkNeu() {
  const a = offenerAblauf();
  if (!a) return;
  // Bewusst ein FRISCHES Token statt nur linkWiderrufen zurückzusetzen: sonst
  // würde der alte, bereits verteilte Link wieder aufgehen, obwohl er
  // zurückgezogen war.
  a.linkToken = neuesLinkToken();
  a.linkWiderrufen = false;
  if (await speichern("Neuer Link erzeugt")) renderLinkModal(); else await neuLaden();
}

async function linkKopieren() {
  const url = document.getElementById("lf-url").value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    document.getElementById("lf-status").textContent = "Link kopiert.";
  } catch (_) {
    // Ohne Zwischenablage-Recht (älteres iOS, unsicherer Kontext) bleibt das
    // Markieren — deshalb ist das Feld sichtbar und nicht versteckt.
    document.getElementById("lf-url").select();
    document.getElementById("lf-status").textContent = "Bitte von Hand kopieren (Feld ist markiert).";
  }
}

// ---------- Anhänge ----------

async function anhaengeHochladen(dateien) {
  const a = offenerAblauf();
  if (!a || !dateien.length) return;
  for (const datei of dateien) {
    if (datei.size > MAX_DATEI_BYTES) {
      alert(`„${datei.name}“ ist ${bytesText(datei.size)} groß. Erlaubt sind ${bytesText(MAX_DATEI_BYTES)}.`);
      continue;
    }
    setStatus("Lädt hoch…", "pending");
    try {
      const meta = await gatewayPutFile(datei);
      a.anhaenge.push(meta);
    } catch (e) {
      setStatus("Fehler", "error");
      alert("Hochladen fehlgeschlagen: " + (e && e.message ? e.message : e));
      return;
    }
  }
  a.geaendertAm = new Date().toISOString();
  if (await speichern("Anhang gespeichert")) renderAnhaenge(); else await neuLaden();
}

async function anhangOeffnen(id) {
  const a = offenerAblauf();
  const meta = a && a.anhaenge.find((d) => d.id === id);
  if (!meta) return;
  // ⚠️ Das Fenster wird SYNCHRON im Klick geöffnet, vor dem await — sonst hält
  // der Popup-Blocker es auf.
  const fenster = window.open("", "_blank");
  try {
    const blob = await gatewayFetchFileBlob(id, meta.mime);
    const url = URL.createObjectURL(blob);
    if (fenster) fenster.location.href = url; else window.location.href = url;
  } catch (e) {
    if (fenster) fenster.close();
    alert("Datei nicht abrufbar: " + (e && e.message ? e.message : e));
  }
}

async function anhangEntfernen(id) {
  const a = offenerAblauf();
  if (!a) return;
  const meta = a.anhaenge.find((d) => d.id === id);
  if (!meta || !confirm(`„${meta.name}“ entfernen?`)) return;
  const vorher = a.anhaenge.slice();
  a.anhaenge = a.anhaenge.filter((d) => d.id !== id);
  if (await speichern("Anhang entfernt")) {
    await gatewayDeleteFile(id);
    renderAnhaenge();
  } else {
    a.anhaenge = vorher;
  }
}

// ---------- Drucken ----------
//
// Gedruckt wird genau das, was auf dem Bildschirm steht — also auch die
// Einschränkung "nur meine", wenn sie aktiv ist. Alles andere wäre eine
// Überraschung am Drucker.
function drucken() {
  const a = offenerAblauf();
  if (!a) return;
  const punkte = sichtbarePunkte(a);
  const zeitraum = a.startDatum === a.endDatum
    ? datumText(a.startDatum)
    : datumText(a.startDatum) + " bis " + datumText(a.endDatum);
  const mehrtaegig = a.startDatum !== a.endDatum;

  let zeilen = "";
  let letzterTag = null;
  punkte.forEach((p) => {
    if (mehrtaegig && p.datum !== letzterTag) {
      zeilen += `<tr class="druck-tag"><td colspan="5">${escapeHtml(datumText(p.datum))}</td></tr>`;
      letzterTag = p.datum;
    }
    zeilen += `<tr>
      <td class="druck-zeit">${escapeHtml(p.startZeit || "")}${p.endZeit ? "–" + escapeHtml(p.endZeit) : ""}</td>
      <td>${escapeHtml(p.mannschaften.join(" / "))}${p.werFrei ? (p.mannschaften.length ? ", " : "") + escapeHtml(p.werFrei) : ""}</td>
      <td>${escapeHtml(p.was || "")}</td>
      <td>${escapeHtml(p.ort || "")}</td>
      <td>${escapeHtml(p.notiz || "")}</td>
    </tr>`;
  });

  const gefiltert = nurMeineAktiv() && punkte.length !== a.punkte.length;
  document.getElementById("print-content").innerHTML = `
    <h1>${escapeHtml(a.titel || "Ablaufplan")}</h1>
    <p class="print-meta">${escapeHtml(zeitraum)}${a.ort ? " · " + escapeHtml(a.ort) : ""}${
      gefiltert ? " · nur " + escapeHtml(meineMannschaften().join(", ")) : ""}</p>
    ${a.info ? `<p class="print-info">${escapeHtml(a.info).replace(/\n/g, "<br>")}</p>` : ""}
    <table class="print-table">
      <thead><tr><th>Zeit</th><th>Wer</th><th>Was</th><th>Ort</th><th>Notiz</th></tr></thead>
      <tbody>${zeilen}</tbody>
    </table>`;

  document.body.classList.add("printing-report");
  window.print();
  // Nach dem Druckdialog wieder aufräumen. setTimeout, weil Safari window.print()
  // nicht in jedem Fall blockierend abarbeitet.
  setTimeout(() => document.body.classList.remove("printing-report"), 300);
}

// ---------- Info-Tab ----------

function renderInfo() {
  document.getElementById("version-badge").textContent = "v" + APP_VERSION;
  const anzahl = appData.ablaeufe.length;
  const punkte = appData.ablaeufe.reduce((s, a) => s + a.punkte.length, 0);
  document.getElementById("meta-view").innerHTML = `
    <div class="form-field"><label>Abläufe</label><span>${anzahl}</span></div>
    <div class="form-field"><label>Punkte insgesamt</label><span>${punkte}</span></div>
    <div class="form-field"><label>Letzte Änderung</label><span>${
      appData.meta.stand ? escapeHtml(new Date(appData.meta.stand).toLocaleString("de-DE")) : "—"}</span></div>`;
  document.getElementById("info-user").textContent = currentUser
    ? "Angemeldet als " + (currentUser.vorname ? currentUser.vorname + " " + (currentUser.nachname || "") : currentUser.username)
      + (canEdit() ? " · darf bearbeiten" : " · darf sehen")
    : "";
  document.getElementById("changelog-list").innerHTML = APP_CHANGELOG.map((e) => `
    <div class="changelog-entry">
      <span class="cv">Version ${escapeHtml(e.version)}</span>
      ${e.groups.map((g) => `<div class="changelog-group">
        <span class="cg-title">${escapeHtml(g.title)}</span>
        <ul class="cg-items">${g.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
      </div>`).join("")}
    </div>`).join("");
}

// ---------- Rechte in der Oberfläche ----------

function applyEditVisibility() {
  document.body.classList.toggle("can-edit", canEdit());
  document.querySelectorAll(".editor-only").forEach((el) => el.classList.toggle("hidden", !canEdit()));
}

// ---------- Tabs ----------

function switchTab(name) {
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-section").forEach((s) => s.classList.toggle("active", s.id === "tab-" + name));
  if (name === "info") renderInfo();
}

// ---------- Ereignisse ----------

// ⚠️ Einmalig. Ein zweiter init()-Aufruf (Standardweg beim Prüfen mit
// untergeschobenen Gateway-Funktionen) hängt sonst einen zweiten Lauscher an
// dieselben Knöpfe — jeder Klick löste die Aktion doppelt aus, und beim Prüfen
// sieht das wie ein Bug aus, der keiner ist. Bekannte Falle aus den Fotoaufträgen.
let lauscherAngebunden = false;

function setupListeners() {
  if (lauscherAngebunden) return;
  lauscherAngebunden = true;

  document.querySelectorAll("nav button").forEach((b) =>
    b.addEventListener("click", () => switchTab(b.dataset.tab)));

  // Kartenlisten (beide Tabs) — Delegation, weil die Karten neu gebaut werden.
  ["ablauf-karten", "frueher-karten"].forEach((id) => {
    document.getElementById(id).addEventListener("click", (e) => {
      const karte = e.target.closest("[data-ablauf]");
      if (!karte) return;
      offenerAblaufId = karte.dataset.ablauf;
      switchTab("ablaeufe");
      renderAlles();
      window.scrollTo(0, 0);
    });
  });

  document.getElementById("btn-zurueck-liste").addEventListener("click", () => {
    offenerAblaufId = null;
    renderAlles();
  });

  document.getElementById("btn-neuer-ablauf").addEventListener("click", () => oeffneAblaufModal(null));

  // Zeitstrahl — Delegation.
  document.getElementById("zeitstrahl").addEventListener("click", (e) => {
    const knopf = e.target.closest("[data-aktion]");
    if (!knopf || !canEdit()) return;
    const id = knopf.dataset.punkt;
    if (knopf.dataset.aktion === "bearbeiten") oeffnePunktModal(id);
    if (knopf.dataset.aktion === "verschieben") oeffneVerschiebeModal(id);
  });

  document.getElementById("btn-neuer-punkt").addEventListener("click", () => oeffnePunktModal(null));
  document.getElementById("btn-text-einfuegen").addEventListener("click", oeffneTextModal);
  document.getElementById("btn-drucken").addEventListener("click", drucken);
  document.getElementById("btn-link").addEventListener("click", oeffneLinkModal);

  // Filter
  document.getElementById("nur-meine").addEventListener("change", (e) => {
    lsSchreiben(LS_NUR_MEINE, e.target.checked ? "1" : "0");
    renderZeitstrahl();
    renderListen();
  });
  document.getElementById("meine-mannschaft").addEventListener("change", (e) => {
    lsSchreiben(LS_MEINE_MANNSCHAFT, e.target.value);
    renderZeitstrahl();
    renderListen();
  });

  // Anhänge
  document.getElementById("btn-anhang-waehlen").addEventListener("click", () =>
    document.getElementById("anhang-input").click());
  document.getElementById("anhang-input").addEventListener("change", async (e) => {
    const dateien = Array.from(e.target.files || []);
    e.target.value = ""; // damit dieselbe Datei erneut gewählt werden kann
    await anhaengeHochladen(dateien);
  });
  document.getElementById("anhang-liste").addEventListener("click", (e) => {
    const auf = e.target.closest("[data-anhang]");
    if (auf) { anhangOeffnen(auf.dataset.anhang); return; }
    const weg = e.target.closest("[data-anhang-weg]");
    if (weg && canEdit()) anhangEntfernen(weg.dataset.anhangWeg);
  });

  // Ablauf-Formular
  document.getElementById("btn-ablauf-speichern").addEventListener("click", ablaufSpeichern);
  document.getElementById("btn-ablauf-loeschen").addEventListener("click", ablaufLoeschen);
  ["btn-ablauf-abbrechen", "ablauf-modal-close"].forEach((id) =>
    document.getElementById(id).addEventListener("click", () =>
      document.getElementById("ablauf-modal").classList.add("hidden")));

  // Punkt-Formular
  document.getElementById("btn-punkt-speichern").addEventListener("click", punktSpeichern);
  document.getElementById("btn-punkt-loeschen").addEventListener("click", punktLoeschen);
  ["btn-punkt-abbrechen", "punkt-modal-close"].forEach((id) =>
    document.getElementById(id).addEventListener("click", () =>
      document.getElementById("punkt-modal").classList.add("hidden")));

  // Liste einfügen
  document.getElementById("tf-text").addEventListener("input", textVorschau);
  document.getElementById("tf-datum").addEventListener("change", textVorschau);
  document.getElementById("btn-text-uebernehmen").addEventListener("click", textUebernehmen);
  ["btn-text-abbrechen", "text-modal-close"].forEach((id) =>
    document.getElementById(id).addEventListener("click", () =>
      document.getElementById("text-modal").classList.add("hidden")));

  // Verschieben
  document.getElementById("verschiebe-schritte").addEventListener("click", (e) => {
    const b = e.target.closest("[data-schritt]");
    if (!b) return;
    document.getElementById("vf-minuten").value = b.dataset.schritt;
    verschiebeVorschau();
  });
  document.getElementById("vf-minuten").addEventListener("input", verschiebeVorschau);
  document.getElementById("btn-verschiebe-ok").addEventListener("click", verschiebenAusfuehren);
  ["btn-verschiebe-abbrechen", "verschiebe-modal-close"].forEach((id) =>
    document.getElementById(id).addEventListener("click", () =>
      document.getElementById("verschiebe-modal").classList.add("hidden")));

  // Link
  document.getElementById("lf-mannschaft").addEventListener("change", renderLinkModal);
  document.getElementById("btn-link-kopieren").addEventListener("click", linkKopieren);
  document.getElementById("btn-link-oeffnen").addEventListener("click", () => {
    const url = document.getElementById("lf-url").value;
    if (url) window.open(url, "_blank");
  });
  document.getElementById("btn-link-widerrufen").addEventListener("click", linkWiderrufen);
  document.getElementById("btn-link-neu").addEventListener("click", linkNeu);
  ["btn-link-schliessen", "link-modal-close"].forEach((id) =>
    document.getElementById(id).addEventListener("click", () =>
      document.getElementById("link-modal").classList.add("hidden")));

  // Der Jetzt-Strich wandert von allein weiter, solange die Seite offen ist.
  setInterval(() => { if (offenerAblauf()) renderZeitstrahl(); }, AUTO_REFRESH_MS);
}

// ---------- Start ----------

async function init() {
  setupListeners();
  try {
    const roh = await gatewayLoad();
    appData = normalisiereDaten(roh);
    currentUser = await fetchMe();
  } catch (e) {
    if (e instanceof NotLoggedInError) {
      document.getElementById("cloud-error").textContent = "";
      return; // Connect-Screen bleibt stehen
    }
    document.getElementById("cloud-error").textContent = e && e.message ? e.message : String(e);
    return;
  }

  document.getElementById("connect-screen").style.display = "none";
  document.getElementById("app-shell").style.display = "";
  document.getElementById("header-user").textContent = currentUser.vorname
    ? currentUser.vorname + " " + (currentUser.nachname || "")
    : currentUser.username;

  applyEditVisibility();
  renderAlles();
  renderInfo();

  // Die Mannschaftsliste kommt nach — die App ist ohne sie schon bedienbar,
  // und ein zweiter Roundtrip soll den ersten Aufbau nicht aufhalten.
  mannschaftsNamen = await fetchMannschaftsNamen();
  renderAlles();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}
