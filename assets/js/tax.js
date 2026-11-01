// Page Impôts : une ligne par semaine (lundi -> dimanche, Europe/Paris). Tout le calcul est fait par Supabase.
import { supabase } from "./auth.js";
import { can } from "./api.js";

let ui = { openModal: () => {}, closeModal: () => {}, toast: () => {} };
let span = 12, weeks = [], rates = [];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => (n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`);
const run = async p => { const { data, error } = await p; if (error) throw error; return data; };
const rpc = (fn, args) => run(supabase.rpc(fn, args));
const fail = e => ui.toast(e?.message || "Erreur serveur", true);

// --- dates (chaînes AAAA-MM-JJ, calculs en UTC pour éviter les décalages d'heure d'été)
const parisToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = iso => addDays(iso, -((new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7));
const dm = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const dmy = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC" });
const range = wk => `${dm(wk)} → ${dm(addDays(wk, 6))}`;

const STATUS = { en_cours: ["En cours", "prevision"], ouvert: ["À clôturer", "annule"], cloture: ["À payer", "prevision"], paye: ["Payée", "confirme"] };
const badge = s => { const [l, c] = STATUS[s] || [s, ""]; return `<span class="status ${c}"><span class="desktop-only">${l}</span><span class="mobile-only status-dot ${c}" title="${l}"></span></span>`; };

export function initTax(hooks) { ui = hooks; }

export async function refreshTax() {
  const root = $("taxRoot"); if (!root) return;
  if (!can("tax.read")) { root.innerHTML = `<article class="panel"><p>Vous n’avez pas accès aux impôts.</p></article>`; return; }
  try {
    const cur = mondayOf(parisToday());
    [weeks, rates] = await Promise.all([
      rpc("tax_overview", { p_from: addDays(cur, -7 * (span - 1)), p_to: null }),
      run(supabase.from("tax_rates").select("effective_from,rate").order("effective_from", { ascending: false })),
    ]);
    draw(cur);
  } catch (e) { fail(e); }
}

function draw(cur) {
  const rate = rates.find(r => r.effective_from <= cur)?.rate;
  const now = weeks.find(w => w.week_start === cur);
  const toPay = weeks.filter(w => w.status === "cloture").reduce((a, w) => a + Number(w.tax_due), 0);
  const toClose = weeks.filter(w => w.status === "ouvert").length;
  const card = (label, icon, value, foot) => `<article class="metric-card"><div class="metric-top"><span class="metric-label">${label}</span><span class="metric-icon">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-foot"><span>${foot}</span></div></article>`;

  $("taxRoot").innerHTML = `
    <div class="metric-grid">
      ${card("SEMAINE EN COURS", "⚖", money(now?.tax_due), `IMPÔT ESTIMÉ · ${range(cur)}`)}
      ${card("CLÔTURÉ, À PAYER", "▤", money(toPay), "TOTAL DES SEMAINES CLÔTURÉES")}
      ${card("À CLÔTURER", "◷", String(toClose), "SEMAINES TERMINÉES NON CLÔTURÉES")}
      ${card("TAUX EN VIGUEUR", "%", rate == null ? "Non défini" : `${rate} %`, can("tax.manage") ? `<button class="row-action" id="taxRatesBtn" type="button">GÉRER LES TAUX</button>` : "SUR LA BASE IMPOSABLE")}
    </div>
    <article class="panel table-panel"><div class="panel-heading"><div><div class="eyebrow">SEMAINE PAR SEMAINE</div><h2>Impôts hebdomadaires</h2></div></div>
      <div class="table-scroll"><table><thead><tr><th>SEMAINE</th><th class="align-right mobile-hide">CA</th><th class="align-right mobile-hide">LOYER + CITOY.</th><th class="align-right mobile-hide">DÉD. ACHATS</th><th class="align-right desktop-only">BASE IMPOSABLE</th><th class="align-right desktop-only">TAUX</th><th class="align-right">IMPÔT</th><th>STATUT</th><th></th></tr></thead>
      <tbody>${weeks.map(w => `<tr data-week="${w.week_start}"><td><span class="cell-title">${range(w.week_start)}</span></td><td class="align-right mobile-hide">${money(w.ca)}</td><td class="align-right mobile-hide">${money(Number(w.loyers) + Number(w.citoyennete))}</td><td class="align-right mobile-hide">${money(w.deduction_achats)}</td><td class="align-right desktop-only">${money(w.base_imposable)}</td><td class="align-right desktop-only">${w.tax_rate == null ? "—" : w.tax_rate + " %"}</td><td class="align-right"><b>${money(w.tax_due)}</b></td><td>${badge(w.status)}</td><td><button class="row-action" type="button" data-open="${w.week_start}">DÉTAIL</button></td></tr>`).join("")}</tbody></table></div>
      <div style="padding:14px 18px"><button class="btn btn-secondary" type="button" id="taxMore">Afficher 12 semaines de plus</button></div>
    </article>`;

  document.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openWeek(b.dataset.open));
  $("taxMore").onclick = () => { span += 12; refreshTax(); };
  if ($("taxRatesBtn")) $("taxRatesBtn").onclick = openRates;
}

async function openWeek(wk) {
  const w = weeks.find(x => x.week_start === wk); if (!w) return;
  const frozen = w.status === "cloture" || w.status === "paye";
  let buys, exp;
  try {
    [buys, exp] = await Promise.all([
      rpc("tax_week_purchases", { p_week_start: wk }),
      frozen
        ? run(supabase.from("tax_weeks").select("expenses_detail").eq("week_start", wk).single()).then(r => r.expenses_detail)
        : run(supabase.from("tax_expenses").select("*").lte("start_date", wk).or(`end_date.is.null,end_date.gte.${wk}`)),
    ]);
  } catch (e) { return fail(e); }

  const own = t => exp.find(e => e.type === t && e.start_date === wk && e.end_date === wk);
  const recurring = exp.filter(e => !(e.start_date === wk && e.end_date === wk));
  const canEdit = !frozen && can("tax.manage");
  const usedLines = new Set();   // une ligne de bon ne sert qu'une fois au rattachement achat → bon
  const buyRows = buys.map(b => ({ b, order: ui.findOrder ? ui.findOrder(b, usedLines) : null }));
  const row = (l, v, strong) => `<tr><td>${l}</td><td class="align-right">${strong ? `<b>${v}</b>` : v}</td></tr>`;
  const missing = ["loyer", "citoyennete"].filter(t => !exp.some(e => e.type === t));

  const form = canEdit ? `<form id="taxExpForm" style="margin-top:18px"><div class="eyebrow">SAISIE DE LA SEMAINE</div>
      <div class="exp-grid">
        <div class="field"><label for="expLoyer">LOYER · UNIT.</label><input id="expLoyer" type="number" min="0" step="0.01" value="${own("loyer")?.amount ?? ""}" placeholder="0"></div>
        <div class="field"><label for="expLoyerQty">QTÉ</label><input id="expLoyerQty" type="number" min="1" step="1" value="${own("loyer")?.quantity ?? 1}"></div>
        <div class="field"><label for="expLoyerTotal">LOYER · TOTAL</label><input id="expLoyerTotal" type="number" min="0" step="any" placeholder="0"></div>
        <div class="field"><label for="expCit">CITOYENNETÉ · UNIT.</label><input id="expCit" type="number" min="0" step="0.01" value="${own("citoyennete")?.amount ?? ""}" placeholder="0"></div>
        <div class="field"><label for="expCitQty">QTÉ</label><input id="expCitQty" type="number" min="1" step="1" value="${own("citoyennete")?.quantity ?? 1}"></div>
        <div class="field"><label for="expCitTotal">CITOYENNETÉ · TOTAL</label><input id="expCitTotal" type="number" min="0" step="any" placeholder="0"></div>
      </div>
      ${recurring.length ? `<p class="subheading">Lignes récurrentes déjà actives cette semaine : ${recurring.map(e => `${esc(e.label)} ${money(e.amount * e.quantity)}`).join(", ")}.</p>` : ""}
      <div class="modal-actions"><button class="btn btn-primary" type="submit">Enregistrer la saisie</button></div></form>` : "";

  const actions = [];
  if (w.status === "ouvert" && can("tax.close")) actions.push(`<button class="btn btn-primary" id="taxClose" type="button">Clôturer la semaine</button>`);
  if (w.status === "cloture" && can("tax.close")) actions.push(`<button class="btn btn-primary" id="taxPay" type="button">Marquer comme payée</button>`);
  if (w.status === "cloture" && can("tax.manage")) actions.push(`<button class="btn btn-secondary" id="taxReopen" type="button">Rouvrir</button>`);

  const info = w.status === "en_cours" ? "Semaine en cours : chiffres provisoires, elle pourra être clôturée dès lundi."
    : w.status === "ouvert" ? (missing.length ? "Loyer et/ou citoyenneté non saisis : la clôture sera refusée tant qu’ils manquent (saisissez 0 si aucun)." : "Semaine terminée : vérifiez les chiffres puis clôturez.")
    : w.status === "cloture" ? `Clôturée le ${dmy(w.closed_at.slice(0, 10))}. Les chiffres sont figés, plus aucun bon ne peut être créé ni modifié sur cette semaine.`
    : `Payée le ${dmy(w.paid_at.slice(0, 10))}.`;

  ui.openModal(`Semaine du ${range(w.week_start)}`, `DÉTAIL FISCAL · ÉCHÉANCE LUNDI ${dm(w.due_date)}`, `
    <p class="subheading">${info}</p>
    ${w.tax_rate == null ? `<p class="subheading"><b>Aucun taux défini pour cette semaine.</b></p>` : ""}
    <div class="table-scroll"><table><tbody>
      ${row("Chiffre d’affaires (ventes livrées)", money(w.ca))}
      ${row("− Loyers", money(w.loyers))}${row("− Citoyenneté", money(w.citoyennete))}${row("− Déduction sur achats", money(w.deduction_achats))}
      ${row("= Base brute", money(w.base_brute), true)}
      ${row(`Base imposable${Number(w.base_brute) < 0 ? " (base négative ramenée à 0)" : ""}`, money(w.base_imposable))}
      ${row("Taux", w.tax_rate == null ? "—" : `${w.tax_rate} %`)}
      ${row("Impôt à payer (arrondi au supérieur)", money(w.tax_due), true)}
    </tbody></table></div>
    ${form}
    <div class="eyebrow" style="margin-top:18px">ACHATS DÉDUCTIBLES</div>
    <div class="table-scroll"><table><thead><tr><th>DATE</th><th>BON</th><th>ARTICLE</th><th class="align-right">MONTANT</th><th class="align-right">TAUX</th><th class="align-right">DÉDUCTION</th></tr></thead>
      <tbody>${buyRows.length ? buyRows.map(({ b, order }) => `<tr><td><span class="desktop-only">${dmy(b.op_date.slice(0, 10))}</span><span class="mobile-only">${dm(b.op_date.slice(0, 10))}</span></td><td>${order ? `<button type="button" class="link-btn" data-open-order="${esc(order.id)}" title="Voir ce bon dans l’historique">${esc(order.ref)}</button>` : `<span class="cell-sub">—</span>`}</td><td>${esc(b.item_name)}</td><td class="align-right">${money(b.ht)}</td><td class="align-right">${b.rate} %</td><td class="align-right">${money(b.deduction)}</td></tr>`).join("") : `<tr><td colspan="6">Aucun achat déductible cette semaine.</td></tr>`}</tbody></table></div>
    ${actions.length ? `<div class="modal-actions">${actions.join("")}</div>` : ""}`);

  document.querySelectorAll("[data-open-order]").forEach(b => b.onclick = () => ui.openInHistory?.(b.dataset.openOrder));
  // Total modifiable : total ÷ quantité → montant unitaire ; montant × quantité → total (calcul en centimes entiers)
  const cents = v => Math.round(Number(v) * 100);
  const wireTotal = (aId, qId, tId) => {
    const A = $(aId), Q = $(qId), T = $(tId); if (!A || !Q || !T) return;
    const qty = () => Math.max(1, parseInt(Q.value, 10) || 1);
    const totalFromAmount = () => { T.value = A.value === "" ? "" : (cents(A.value) * qty() / 100).toFixed(2); };
    A.oninput = totalFromAmount;
    Q.oninput = totalFromAmount;
    T.oninput = () => { A.value = T.value === "" ? "" : (Math.round(cents(T.value) / qty()) / 100).toFixed(2); };
    T.onchange = totalFromAmount;       // affiche le total réellement enregistré (arrondi au centime)
    totalFromAmount();
  };
  wireTotal("expLoyer", "expLoyerQty", "expLoyerTotal");
  wireTotal("expCit", "expCitQty", "expCitTotal");

  const done = async (fn, msg) => { try { await fn(); ui.closeModal(); ui.toast(msg); await refreshTax(); } catch (e) { fail(e); } };
  if ($("taxExpForm")) $("taxExpForm").onsubmit = e => {
    e.preventDefault();
    const lines = [];
    [["loyer", "expLoyer", "expLoyerQty", "Loyer"], ["citoyennete", "expCit", "expCitQty", "Citoyenneté"]].forEach(([type, a, q, label]) => {
      if ($(a).value !== "") lines.push({ type, label, amount: Number($(a).value), quantity: Math.max(1, parseInt($(q).value, 10) || 1) });
    });
    done(() => rpc("set_week_expenses", { p_week_start: wk, p_lines: lines }), "Saisie enregistrée.");
  };
  if ($("taxClose")) $("taxClose").onclick = () => confirm(`Clôturer la semaine ${range(wk)} ? Les chiffres seront figés (impôt : ${money(w.tax_due)}).`)
    && done(() => rpc("close_tax_week", { p_week_start: wk }), "Semaine clôturée.");
  if ($("taxPay")) $("taxPay").onclick = () => done(() => rpc("pay_tax_week", { p_week_start: wk }), "Impôt marqué comme payé.");
  if ($("taxReopen")) $("taxReopen").onclick = () => confirm("Rouvrir cette semaine ? Le calcul sera refait avec les valeurs actuelles.")
    && done(() => rpc("reopen_tax_week", { p_week_start: wk }), "Semaine rouverte.");
}

function openRates() {
  ui.openModal("Taux d’imposition", "PARAMÈTRES FISCAUX", `
    <p class="subheading">Un taux s’applique à partir d’un lundi, jusqu’au prochain changement. Les semaines déjà clôturées ne changent pas.</p>
    <div class="table-scroll"><table><thead><tr><th>À PARTIR DU LUNDI</th><th class="align-right">TAUX</th></tr></thead>
      <tbody>${rates.length ? rates.map(r => `<tr><td>${dmy(r.effective_from)}</td><td class="align-right">${r.rate} %</td></tr>`).join("") : `<tr><td colspan="2">Aucun taux défini.</td></tr>`}</tbody></table></div>
    <form id="taxRateForm" style="margin-top:18px"><div class="form-grid">
      <div class="field"><label for="rateFrom">APPLICABLE À PARTIR DU (LUNDI)</label><input id="rateFrom" type="date" value="${mondayOf(parisToday())}" required></div>
      <div class="field"><label for="rateValue">TAUX (%)</label><input id="rateValue" type="number" min="0" max="100" step="0.01" required></div>
    </div><div class="modal-actions"><button class="btn btn-primary" type="submit">Enregistrer le taux</button></div></form>`);
  $("taxRateForm").onsubmit = async e => {
    e.preventDefault();
    const from = $("rateFrom").value;
    if (mondayOf(from) !== from) return ui.toast("La date d’effet doit être un lundi.", true);
    try { await rpc("set_tax_rate", { p_effective_from: from, p_rate: Number($("rateValue").value) }); ui.closeModal(); ui.toast("Taux enregistré."); await refreshTax(); }
    catch (err) { fail(err); }
  };
}
