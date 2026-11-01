'use strict';

const sCurrency = (val) => {
  return intFmt.format(val) + ' s';
};
const intFmt = new Intl.NumberFormat('fr-FR');
const today = new Date();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => (Math.random() * 16 | 0).toString(16)));
const initials = name => name.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = value => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const state = { openingCash: 0, cash: 0, items: [], categories: [], categoryRows: [], partners: [], orders: [], movements: [], cashFlows: [], itemNames: {} };

// Total d'une ligne = arrondi supérieur de quantité × prix unitaire (calcul en centimes entiers, comme le serveur)
function ceilTotal(qty, price) {
  const q = Number(qty), c = Math.round(Number(price) * 100);
  return Number.isFinite(q) && Number.isFinite(c) ? Math.floor((q * c + 99) / 100) : 0;
}
// Prix unitaire (2 décimales) dont le total arrondi correspond au total saisi : total ÷ quantité, ajusté au centime
function unitFromTotal(total, qty) {
  const t = Number(total), q = Number(qty);
  if (!(q > 0) || !Number.isFinite(t) || t < 0) return null;
  let cents = Math.floor(t * 100 / q);
  for (let i = 0; i < 1000 && ceilTotal(q, cents / 100) < t; i++) cents++;
  return cents / 100;
}
function orderTotal(order) { return order.lines.reduce((sum, line) => sum + ceilTotal(line.quantity, line.unitPrice), 0); }
function itemFor(id) { return state.items.find(item => item.id === id); }
// Nom affichable d'un article, même archivé (un ancien bon peut y faire référence)
function itemLabel(id) {
  const live = itemFor(id);
  if (live) return live.name;
  const old = state.itemNames?.[id];
  return old ? `${old.name}${old.archived ? ' (archivé)' : ''}` : 'Article inconnu';
}
function rebuildMovements() {
  const fromOrders = state.orders.filter(o => o.status === 'confirme').map(o => ({
    id: o.id, ref: o.ref, label: `${o.type === 'achat' ? 'Achat' : 'Vente'} · ${o.partner}`,
    type: o.type, inflow: o.type === 'vente', amount: orderTotal(o), date: o.date
  }));
  // Flux hors impôts : comptent dans la trésorerie, jamais dans le calcul fiscal (calculé côté serveur sur les bons uniquement)
  const fromFlows = (state.cashFlows || []).map(f => ({
    id: f.id, ref: 'FLUX', label: f.note ? `${f.label} · ${f.note}` : f.label, shortLabel: f.label,
    type: 'flux', flow: true, inflow: f.direction === 'entree', amount: f.amount, date: `${f.date}T12:00:00`
  }));
  state.movements = [...fromOrders, ...fromFlows];
  state.cash = state.openingCash + state.movements.reduce((sum,m) => sum + (m.inflow ? m.amount : -m.amount), 0);
}

const pageLabels = { dashboard:'VUE GÉNÉRALE', stock:'INVENTAIRE', operations:'OPÉRATIONS', partners:'PARTENAIRES', history:'HISTORIQUE', finance:'TRÉSORERIE', tax:'IMPÔTS' };
function showPage(page) {
  if (!pageLabels[page]) return;
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
  document.querySelectorAll('[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.getElementById('crumbLabel').textContent = pageLabels[page];
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderAll();
  if (page === 'tax') refreshTax();
}
document.addEventListener('click', e => {
  const pageButton = e.target.closest('[data-page]');
  if (pageButton) { e.preventDefault(); showPage(pageButton.dataset.page); return; }
  const actionButton = e.target.closest('[data-action]');
  if (actionButton) {
    if (actionButton.dataset.action === 'edit-treasury') { openTreasuryForm(); return; }
    if (actionButton.dataset.action === 'new-flow') { openCashFlowForm(); return; }
    openAction(actionButton.dataset.action);
    return;
  }
  const stockMode = e.target.closest('[data-stock-value]');
  if (stockMode) { stockValueMode = stockMode.dataset.stockValue; renderDashboard(); return; }
  const chartTab = e.target.closest('.chart-tab');
  if (chartTab) {
    document.querySelectorAll('.chart-tab').forEach(t => t.classList.toggle('active', t === chartTab));
    currentChartRange = parseInt(chartTab.dataset.range);
    renderCashflowChart();
    return;
  }
});

function statusBadge(status) {
  const labels = { confirme:'Confirmé', prevision:'En prévision', annule:'Annulé', flux:'Hors impôts' };
  return `<span class="status ${status}"><span class="desktop-only">${labels[status]}</span><span class="mobile-only status-dot ${status}" title="${labels[status]}"></span></span>`;
}
function typeChip(type) {
  const label = { achat: 'ACHAT', vente: 'VENTE', flux: 'FLUX' }[type] || 'VENTE';
  const letter = { achat: 'A', vente: 'V', flux: 'F' }[type] || 'V';
  return `<span class="type-chip ${type} desktop-only">${label}</span><span class="mobile-type-indicator ${type}" title="${label}">${letter}</span>`;
}
function partnerName(name) {
  const escaped = escapeHtml(name || 'Partenaire non renseigné');
  const short = name ? (name.length > 8 ? name.substring(0, 7) + '…' : name) : '…';
  return `<span class="desktop-only">${escaped}</span><span class="mobile-only" title="${escaped}">${escapeHtml(short)}</span>`;
}
let stockValueMode = 'buy';                    // 'buy' (prix d'achat) ou 'sale' (prix de vente)
const homeFlows = () => document.getElementById('homeIncludeFlows')?.checked ?? true;
function renderDashboard() {
  const withFlows = homeFlows();
  const stockUnits = state.items.reduce((sum,x) => sum + x.stock, 0);
  // Sans droit sur les coûts, seule la valeur de vente a un sens (on ne modifie pas le choix mémorisé :
  // le premier affichage a lieu avant le chargement des permissions)
  const valueMode = api.can('costs.read') ? stockValueMode : 'sale';
  const stockValue = state.items.reduce((sum,x) => sum + x.stock * (valueMode === 'sale' ? x.sale : x.buy), 0);
  const pending = state.orders.filter(o => o.status === 'prevision').length;

  // Mouvements : 30 derniers jours roulants (aujourd'hui inclus), bons confirmés (+ flux si coché)
  const winStart = new Date(); winStart.setHours(0, 0, 0, 0); winStart.setDate(winStart.getDate() - 29);
  const winEnd = new Date(); winEnd.setHours(23, 59, 59, 999);
  const movementCount = state.movements.filter(m => (withFlows || !m.flow) && new Date(m.date) >= winStart && new Date(m.date) <= winEnd).length;

  document.getElementById('cashMetric').textContent = sCurrency(state.cash);
  document.getElementById('stockValueMetric').textContent = sCurrency(stockValue);
  document.getElementById('stockValueLabel').textContent = `VALEUR STOCK · ${valueMode === 'sale' ? 'VENTE' : 'ACHAT'}`;
  document.querySelectorAll('[data-stock-value]').forEach(b => {
    const on = b.dataset.stockValue === valueMode;
    b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    if (b.dataset.stockValue === 'buy') b.hidden = !api.can('costs.read');
  });
  document.getElementById('stockUnitsMetric').textContent = `${intFmt.format(stockUnits)} unités`;
  document.getElementById('pendingMetric').textContent = intFmt.format(pending);
  document.getElementById('movementMetric').textContent = intFmt.format(movementCount);
  document.getElementById('movementFoot').textContent = withFlows ? 'Achats, ventes & flux' : 'Achats & ventes';
  document.getElementById('navStockCount').textContent = String(state.items.length).padStart(2,'0');

  const recent = historyEntries().filter(e => withFlows || e.kind === 'order')
    .sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0,5);
  document.getElementById('recentRows').innerHTML = recent.map(e => e.kind === 'flow'
    ? `<tr><td><div class="reference-cell"><span class="item-symbol">⇄</span><span><span class="cell-title">FLUX</span><span class="cell-sub">${escapeHtml(e.flow.label)}</span></span></div></td><td><span class="cell-sub">—</span></td><td class="mobile-hide">${fmtDate(e.date)}</td><td class="desktop-only">${statusBadge('flux')}</td><td class="align-right"><strong class="${e.inflow ? 'positive' : 'negative'}">${e.inflow ? '+' : '−'} ${sCurrency(e.total)}</strong></td></tr>`
    : `<tr><td><div class="reference-cell"><span class="item-symbol">${e.type==='achat'?'↓':'↑'}</span><span><span class="cell-title">${escapeHtml(e.ref)}</span><span class="cell-sub">${e.order.lines.length} ligne(s)</span></span></div></td><td>${partnerName(e.partner)}</td><td class="mobile-hide">${fmtDate(e.date)}</td><td class="desktop-only">${statusBadge(e.status)}</td><td class="align-right"><strong>${sCurrency(e.total)}</strong></td></tr>`).join('');
  renderCashflowChart();
}
let currentChartRange = 7;
function renderCashflowChart() {
  const container = document.getElementById('cashflowChartContainer');
  if (!container) return;

  const days = [];
  for (let i = currentChartRange - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    days.push(d);
  }

  const withFlows = homeFlows();
  const movements = withFlows ? state.movements : state.movements.filter(m => !m.flow);
  const caption = document.getElementById('chartCaption');
  if (caption) caption.textContent = withFlows ? 'BONS CONFIRMÉS + FLUX HORS IMPÔTS' : 'BONS CONFIRMÉS UNIQUEMENT';

  const data = days.map(day => {
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    const dayMovements = movements.filter(m => {
      const mDate = new Date(m.date);
      return mDate >= day && mDate <= dayEnd;
    });
    return {
      label: day.toLocaleDateString('fr-FR', { weekday: 'short' }).toUpperCase().replace('.', ''),
      fullLabel: day.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
      in: dayMovements.filter(m => m.inflow).reduce((sum, m) => sum + m.amount, 0),
      out: dayMovements.filter(m => !m.inflow).reduce((sum, m) => sum + m.amount, 0)
    };
  });

  const maxVal = Math.max(...data.map(d => Math.max(d.in, d.out)), 1000);
  const roundedMax = Math.ceil(maxVal / 1000) * 1000;
  const yAxis = [roundedMax, roundedMax * 0.75, roundedMax * 0.5, roundedMax * 0.25, 0];

  const fmtK = val => val >= 1000 ? (val / 1000).toFixed(val % 1000 === 0 ? 0 : 1) + 'k' : val;

  container.innerHTML = `
    <div class="chart" aria-label="Graphique des mouvements sur ${currentChartRange} jours">
      <div class="chart-y">
        ${yAxis.map(y => `<span>${fmtK(y)}</span>`).join('')}
      </div>
      <div class="chart-main">
        <div class="chart-gridlines"><i></i><i></i><i></i><i></i><i></i></div>
        ${data.map(d => `
          <div class="bar-group" title="${d.fullLabel}: +${sCurrency(d.in)} / -${sCurrency(d.out)}">
            <div class="bars">
              <i class="bar out" style="height:${(d.out / roundedMax) * 100}%"></i>
              <i class="bar in" style="height:${(d.in / roundedMax) * 100}%"></i>
            </div>
            <small>${currentChartRange > 7 ? d.fullLabel.split(' ')[0] : d.label}</small>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}
function renderStock() {
  const query = (document.getElementById('stockSearch')?.value || '').trim().toLowerCase();
  const category = document.getElementById('categoryFilter')?.value || 'all';
  const filtered = state.items.filter(x => (x.name.toLowerCase().includes(query) || x.category.toLowerCase().includes(query)) && (category === 'all' || x.category === category));
  const stockUnits = state.items.reduce((sum,x) => sum+x.stock,0);
  const stockPrevu = state.items.reduce((sum,x) => sum+(x.stockPrevu ?? x.stock),0);

  const catFilter = document.getElementById('categoryFilter');
  if (catFilter) {
    const currentVal = catFilter.value;
    catFilter.innerHTML = `<option value="all">Toutes les catégories</option>${state.categories.map(c => `<option value="${escapeHtml(c)}"${c === currentVal ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}`;
  }

  document.getElementById('itemCount').textContent = String(state.items.length).padStart(2,'0');
  document.getElementById('categoryCount').textContent = String(state.categories.length).padStart(2,'0');
  document.getElementById('stockUnitsSummary').textContent = intFmt.format(stockUnits);
  document.getElementById('stockPrevuSummary').textContent = intFmt.format(stockPrevu);
  document.getElementById('stockResultCount').textContent = `${filtered.length} ARTICLE${filtered.length>1?'S':''}`;
  document.getElementById('stockRows').innerHTML = filtered.length ? filtered.map(x => `<tr><td><div class="item-cell"><span class="item-symbol">${x.image ? `<img src="${escapeHtml(x.image)}" alt="">` : escapeHtml(x.glyph)}</span><span><span class="cell-title">${escapeHtml(x.name)}</span><span class="cell-sub mobile-hide">Réf. ${escapeHtml(x.id.toUpperCase())}</span></span></div></td><td class="mobile-hide">${escapeHtml(x.category)}</td><td class="align-right"><strong class="${x.stock < 0 ? 'negative' : ''}">${intFmt.format(x.stock)}</strong> <span class="cell-sub mobile-hide">unités</span></td><td class="align-right" title="Stock restant si les ${intFmt.format(x.outgoing || 0)} unité(s) en vente prévue sont livrées"><strong class="${(x.stockPrevu ?? x.stock) < 0 ? 'negative' : ''}">${intFmt.format(x.stockPrevu ?? x.stock)}</strong>${x.outgoing ? ` <span class="cell-sub">−${intFmt.format(x.outgoing)} prévues</span>` : ''}</td><td class="align-right desktop-only">${sCurrency(x.buy)}</td><td class="align-right desktop-only">${sCurrency(x.sale)}</td><td><button class="row-action" data-item-action="${x.id}">Opérer</button></td></tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">Aucun article ne correspond à votre recherche.</div></td></tr>`;
}
function renderOperations() {
  const filter = document.getElementById('operationFilter')?.value || 'all';
  const rows = [...state.orders].filter(o => filter === 'all' || o.status === filter).sort((a,b)=>new Date(b.date)-new Date(a.date));
  document.getElementById('operationRows').innerHTML = rows.map(o => `<tr><td><span class="cell-title">${escapeHtml(o.ref)}</span></td><td>${typeChip(o.type)}</td><td>${partnerName(o.partner)}</td><td class="mobile-hide">${fmtDate(o.date)}</td><td class="mobile-show-compressed">${statusBadge(o.status)}</td><td class="align-right"><strong>${sCurrency(orderTotal(o))}</strong></td><td><button class="row-action" data-order="${o.id}">Détails</button></td></tr>`).join('') || `<tr><td colspan="7"><div class="empty-state">Aucune opération.</div></td></tr>`;
}
function renderPartners() {
  const query = (document.getElementById('partnerSearch')?.value || '').toLowerCase();
  const rows = state.partners.filter(p => p.name.toLowerCase().includes(query));
  document.getElementById('partnerCount').textContent = `${rows.length} PARTENAIRE${rows.length>1?'S':''}`;
  document.getElementById('partnerGrid').innerHTML = rows.map(p => `
    <article class="partner-card">
      <div class="partner-head">
        <span class="partner-avatar">${p.image ? `<img src="${escapeHtml(p.image)}" alt="">` : initials(p.name)}</span>
        <span><strong>${escapeHtml(p.name)}</strong><small>Partenaire commercial</small></span>
        <button class="partner-settings-btn" data-partner-action="${p.id}" title="Actions">⚙️</button>
      </div>
      <div class="partner-flags">${p.supplier?'<span class="partner-flag">FOURNISSEUR</span>':''}${p.client?'<span class="partner-flag">CLIENT</span>':''}</div>
      <div class="partner-note">${escapeHtml(p.note || 'Aucune note')}</div>
    </article>`).join('') || `<div class="empty-state">Aucun partenaire trouvé.</div>`;
}
// ---------------------------------------------------------------- Historique
const historyState = { sort: { key: 'date', dir: 'desc' }, expanded: new Set() };
const NO_PARTNER = '__none__';
const STATUS_LABELS = { confirme: 'Confirmé', prevision: 'En prévision', annule: 'Annulé' };
const TYPE_LABELS = { achat: 'Achat', vente: 'Vente', flux: 'Flux hors impôts' };
// Recherche insensible à la casse, aux accents et aux espaces insécables
const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s\u00a0\u202f]+/g, ' ').toLowerCase();
const dayKey = value => new Date(value).toLocaleDateString('sv-SE');     // AAAA-MM-JJ, heure locale

// Bons + flux hors impôts dans une même liste
function historyEntries() {
  const orders = state.orders.map(o => ({
    kind: 'order', id: o.id, ref: o.ref, type: o.type, status: o.status, partner: o.partner || '',
    createdBy: o.createdBy, date: o.date, total: orderTotal(o), order: o,
    extra: o.lines.map(l => itemLabel(l.itemId)).join(' '),
  }));
  const flows = (state.cashFlows || []).map(f => ({
    kind: 'flow', id: f.id, ref: 'FLUX', type: 'flux', status: 'confirme', partner: '',
    createdBy: f.createdBy, date: `${f.date}T12:00:00`, total: f.amount, inflow: f.direction === 'entree', flow: f,
    extra: `${f.label} ${f.note} ${f.direction === 'entree' ? 'entrée' : 'sortie'} hors impôts`,
  }));
  return [...orders, ...flows];
}
function historyHaystack(e) {
  return norm([
    e.ref, TYPE_LABELS[e.type], e.kind === 'order' ? STATUS_LABELS[e.status] : 'hors impôts',
    e.kind === 'order' ? (e.partner || 'Partenaire non renseigné') : '',
    e.createdBy, fmtDate(e.date), dayKey(e.date), e.total, sCurrency(e.total), e.extra,
  ].join(' '));
}
const historyVal = id => document.getElementById(id)?.value || '';
function filteredHistory(entries) {
  const tokens = norm(historyVal('historySearch')).split(' ').filter(Boolean);
  const type = historyVal('historyType') || 'all', status = historyVal('historyStatus') || 'all';
  const partner = historyVal('historyPartner') || 'all', creator = historyVal('historyCreator') || 'all';
  const from = historyVal('historyFrom'), to = historyVal('historyTo');
  return entries.filter(e => {
    if (type !== 'all' && e.type !== type) return false;
    if (status !== 'all' && e.status !== status) return false;
    if (partner !== 'all') {
      if (e.kind !== 'order') return false;
      if (partner === NO_PARTNER ? e.partner !== '' : e.partner !== partner) return false;
    }
    if (creator !== 'all' && e.createdBy !== creator) return false;
    const day = dayKey(e.date);
    if ((from && day < from) || (to && day > to)) return false;
    if (tokens.length) { const hay = historyHaystack(e); if (!tokens.every(t => hay.includes(t))) return false; }
    return true;
  });
}
const SORT_VALUE = {
  ref: e => e.ref, type: e => TYPE_LABELS[e.type], partner: e => e.partner, createdBy: e => e.createdBy,
  date: e => new Date(e.date).getTime(), status: e => e.kind === 'flow' ? 'zz' : STATUS_LABELS[e.status], total: e => e.total,
};
function sortHistory(rows) {
  const { key, dir } = historyState.sort, get = SORT_VALUE[key] || SORT_VALUE.date, m = dir === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    const x = get(a), y = get(b);
    const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true, sensitivity: 'base' });
    return c ? c * m : new Date(b.date) - new Date(a.date);
  });
}
function syncHistorySelect(id, firstLabel, options) {
  const el = document.getElementById(id); if (!el) return;
  const current = el.value || 'all';
  el.innerHTML = `<option value="all">${firstLabel}</option>` + options.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('');
  el.value = [...el.options].some(o => o.value === current) ? current : 'all';
}
function resetHistoryFilters(render = true) {
  ['historySearch', 'historyFrom', 'historyTo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['historyType', 'historyStatus', 'historyPartner', 'historyCreator'].forEach(id => { const el = document.getElementById(id); if (el) el.value = 'all'; });
  if (render) renderHistory();
}
function orderDetailHtml(o) {
  return `<div class="detail-content"><table class="detail-table"><thead><tr>
      <th style="width: 40%">ARTICLE</th><th class="align-right" style="width: 15%">QTÉ</th>
      <th class="align-right mobile-hide" style="width: 20%">PRIX UNIT.</th><th class="align-right" style="width: 25%">TOTAL</th>
    </tr></thead><tbody>${o.lines.map(l => `<tr>
      <td><div class="cell-title">${escapeHtml(itemLabel(l.itemId))}</div><div class="mobile-only cell-sub">${sCurrency(l.unitPrice)} / unité</div></td>
      <td class="align-right"><strong>${intFmt.format(l.quantity)}</strong></td>
      <td class="align-right mobile-hide">${sCurrency(l.unitPrice)}</td>
      <td class="align-right"><strong>${sCurrency(ceilTotal(l.quantity, l.unitPrice))}</strong></td>
    </tr>`).join('')}</tbody></table></div>`;
}
function flowDetailHtml(e) {
  const f = e.flow;
  return `<div class="detail-content"><div class="detail-list">
      <div class="detail-box"><small>LIBELLÉ</small><strong>${escapeHtml(f.label)}</strong></div>
      <div class="detail-box"><small>SENS</small><strong class="${e.inflow ? 'positive' : 'negative'}">${e.inflow ? 'Entrée' : 'Sortie'} d’argent</strong></div>
      <div class="detail-box"><small>DATE</small><strong>${fmtDate(e.date)}</strong></div>
      <div class="detail-box"><small>NOTE</small><strong>${escapeHtml(f.note || '—')}</strong></div>
    </div><p class="page-footnote">Mouvement de trésorerie uniquement : aucun effet sur le calcul des impôts.</p></div>`;
}
function historyRowHtml(e) {
  const open = historyState.expanded.has(e.id), isFlow = e.kind === 'flow';
  const total = isFlow
    ? `<strong class="${e.inflow ? 'positive' : 'negative'}">${e.inflow ? '+' : '−'} ${sCurrency(e.total)}</strong>`
    : `<strong>${sCurrency(e.total)}</strong>`;
  return `
    <tr class="history-row${open ? ' expanded' : ''}" data-id="${e.id}">
      <td><div style="display:flex;align-items:center;gap:8px"><button class="expand-btn" aria-expanded="${open}">${open ? '－' : '＋'}</button><span class="cell-title">${isFlow ? 'FLUX' : escapeHtml(e.ref)}</span></div></td>
      <td>${typeChip(e.type)}</td>
      <td>${isFlow ? '<span class="cell-sub">—</span>' : partnerName(e.partner)}</td>
      <td class="desktop-only">${escapeHtml(e.createdBy)}</td>
      <td class="mobile-small-date">${fmtDate(e.date)}</td>
      <td>${statusBadge(isFlow ? 'flux' : e.status)}</td>
      <td class="align-right">${total}</td>
    </tr>
    <tr class="detail-row" id="detail-${e.id}" style="display:${open ? 'table-row' : 'none'}">
      <td colspan="7">${isFlow ? flowDetailHtml(e) : orderDetailHtml(e.order)}</td>
    </tr>`;
}
function renderHistory() {
  const all = historyEntries();
  const orders = all.filter(e => e.kind === 'order');
  const partners = [...new Set(orders.map(e => e.partner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  syncHistorySelect('historyPartner', 'Tous les partenaires',
    [...(orders.some(e => !e.partner) ? [[NO_PARTNER, 'Partenaire non renseigné']] : []), ...partners.map(n => [n, n])]);
  syncHistorySelect('historyCreator', 'Tous les créateurs',
    [...new Set(all.map(e => e.createdBy).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')).map(n => [n, n]));

  const rows = sortHistory(filteredHistory(all));
  const filtering = historyVal('historySearch') || historyVal('historyFrom') || historyVal('historyTo')
    || ['historyType', 'historyStatus', 'historyPartner', 'historyCreator'].some(id => (historyVal(id) || 'all') !== 'all');
  const resetBtn = document.getElementById('historyReset'); if (resetBtn) resetBtn.hidden = !filtering;
  const count = document.getElementById('historyResultCount');
  if (count) count.textContent = filtering ? `${rows.length} / ${all.length} ENTRÉE${all.length > 1 ? 'S' : ''}` : `${all.length} ENTRÉE${all.length > 1 ? 'S' : ''}`;
  document.querySelectorAll('#page-history th[data-sort]').forEach(th =>
    th.setAttribute('aria-sort', th.dataset.sort === historyState.sort.key ? (historyState.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'));

  document.getElementById('historyRows').innerHTML = rows.length
    ? rows.map(historyRowHtml).join('')
    : `<tr><td colspan="7"><div class="empty-state">Aucune entrée ne correspond aux filtres.</div></td></tr>`;
  bindHistoryEvents();
}
function bindHistoryEvents() {
  document.querySelectorAll('.expand-btn').forEach(btn => {
    btn.onclick = () => {
      const row = btn.closest('.history-row'), id = row.dataset.id;
      const open = !historyState.expanded.has(id);
      if (open) historyState.expanded.add(id); else historyState.expanded.delete(id);   // l'état survit aux rafraîchissements
      document.getElementById(`detail-${id}`).style.display = open ? 'table-row' : 'none';
      btn.textContent = open ? '－' : '＋'; btn.setAttribute('aria-expanded', String(open));
      row.classList.toggle('expanded', open);
    };
  });
}
function renderFinance() {
  rebuildMovements();
  const incoming = state.movements.filter(m=>m.inflow).reduce((a,m)=>a+m.amount,0);
  const outgoing = state.movements.filter(m=>!m.inflow).reduce((a,m)=>a+m.amount,0);
  document.getElementById('financeCash').textContent = sCurrency(state.cash);
  document.getElementById('financeIn').textContent = sCurrency(incoming);
  document.getElementById('financeOut').textContent = sCurrency(outgoing);
  document.getElementById('financeRows').innerHTML = [...state.movements].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(m=>`<tr><td>${m.flow ? `<span class="type-chip flux">HORS IMPÔTS</span><div class="cell-sub mobile-only">${escapeHtml(m.shortLabel)}</div>` : `<span class="cell-title">${escapeHtml(m.ref)}</span>`}</td><td class="mobile-hide">${escapeHtml(m.label)}</td><td class="mobile-hide">${fmtDate(m.date)}</td><td class="align-right ${m.inflow?'positive':'negative'}"><strong>${m.inflow?'+':'−'} ${sCurrency(m.amount)}</strong></td><td class="align-right">${m.flow && api.can('treasury.manage') ? `<button type="button" class="row-action" data-flow-delete="${m.id}" title="Supprimer ce flux" aria-label="Supprimer ce flux">✕</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="5"><div class="empty-state">Aucun mouvement financier.</div></td></tr>`;

  const editBtn = document.getElementById('editTreasuryBtn');
  if (editBtn) editBtn.hidden = !api.can('treasury.manage');
  const flowBtn = document.getElementById('newFlowBtn');
  if (flowBtn) flowBtn.hidden = !api.can('treasury.manage');
  document.querySelectorAll('[data-flow-delete]').forEach(b => b.onclick = () => deleteFlow(b.dataset.flowDelete));
}
function renderTax() {}
function renderAll() { renderDashboard(); renderStock(); renderOperations(); renderPartners(); renderHistory(); renderFinance(); renderTax(); }

initTax({ openModal: (...a) => openModal(...a), closeModal: () => closeModal(), toast: (...a) => toast(...a),
          findOrder: (b, used) => findPurchaseOrder(b, used), openInHistory: id => goToHistory(id) });
const backdrop = document.getElementById('modalBackdrop');
const modalContent = document.getElementById('modalContent');
function openModal(title, eyebrow, content) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalEyebrow').textContent = eyebrow;
  modalContent.innerHTML = content;
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() { backdrop.hidden = true; document.body.style.overflow = ''; modalContent.innerHTML=''; }
document.getElementById('closeModal').addEventListener('click', closeModal);
backdrop.addEventListener('click', e => { if(e.target===backdrop) closeModal(); });
document.addEventListener('keydown', e => { if(e.key==='Escape' && !backdrop.hidden) closeModal(); });
function toast(message, error=false) {
  const el = document.createElement('div'); el.className = `toast${error?' error':''}`; el.textContent = message;
  document.getElementById('toastRegion').appendChild(el); setTimeout(()=>el.remove(),3200);
}
function openAction(action) {
  if(action==='new-buy') openOrderForm('achat');
  if(action==='new-sale') openOrderForm('vente');
  if(action==='new-partner') openPartnerForm();
  if(action==='new-item') openItemForm();
  if(action==='new-category') openCategoryForm();
}
function partnerOptions(type) {
  const candidates = state.partners.filter(p => type==='achat' ? p.supplier : p.client);
  return `<option value="">Partenaire non renseigné</option>${candidates.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}`;
}
function lineMarkup(type, itemId = null) {
  const priceField = type === 'achat' ? 'buy' : 'sale';
  const selected = state.items.find(x => x.id === itemId) || state.items[0];   // article demandé, sinon le premier
  const price = selected?.[priceField] ?? 0;
  return `<div class="order-line"><select class="line-item" aria-label="Article">${state.items.map(x=>`<option value="${x.id}"${x.id === selected?.id ? ' selected' : ''}>${escapeHtml(x.name)} · ${x.stock} en stock</option>`).join('')}</select>`
    + `<label class="line-cell"><small class="line-cap">QTÉ</small><input class="line-qty" type="number" min="1" step="1" value="1" aria-label="Quantité"></label>`
    + `<label class="line-cell"><small class="line-cap">PRIX UNIT.</small><input class="line-price" type="number" min="0" step="0.01" value="${price}" aria-label="Prix unitaire"></label>`
    + `<label class="line-cell"><small class="line-cap">TOTAL</small><input class="line-total" type="number" min="0" step="any" value="${ceilTotal(1, price)}" aria-label="Total de la ligne"></label>`
    + `<button type="button" class="remove-line" aria-label="Supprimer la ligne">×</button></div>`;
}
function openOrderForm(type, itemId = null) {
  if (!state.items.length) return toast('Ajoutez d’abord un article au catalogue.', true);
  const isBuy = type==='achat';
  openModal(isBuy?'Enregistrer un achat':'Créer une vente','NOUVEAU BON · '+(isBuy?'APPROVISIONNEMENT':'COMMERCE'), `
    <form id="orderForm">
      <input type="hidden" id="orderType" value="${type}">
      <div class="form-grid"><div class="field full"><label for="orderPartner">PARTENAIRE</label><select id="orderPartner">${partnerOptions(type)}</select></div><div class="field"><label for="orderDate">DATE DE L'OPÉRATION</label><input id="orderDate" type="date" value="${new Date().toLocaleDateString('sv-SE')}" max="${new Date().toLocaleDateString('sv-SE')}" ${type==='vente'?'disabled':'required'}></div><div class="field"><label>STATUT INITIAL</label><input value="${isBuy?'Confirmé immédiatement':'En prévision'}" disabled></div></div>
      <div class="line-builder"><div class="line-builder-head"><strong>Articles du bon</strong><span class="cell-sub">MONTANTS EN s · TOTAL OU PRIX UNITAIRE MODIFIABLES</span></div><div class="line-head" aria-hidden="true"><span>ARTICLE</span><span>QTÉ</span><span>PRIX UNIT.</span><span>TOTAL</span><span></span></div><div class="line-list" id="lineList">${lineMarkup(type, itemId)}</div><button type="button" class="add-line" id="addLine">＋ Ajouter une ligne</button></div>
      <div class="order-total"><span>TOTAL DU BON <small class="cell-sub"> · arrondi supérieur par ligne</small></span><strong id="orderTotalPreview">0,00 s</strong></div>
      <p class="page-footnote">${isBuy?'Le bon sera confirmé immédiatement, la trésorerie diminuée et les quantités ajoutées au stock.':'La vente sera enregistrée en prévision. Le stock et la trésorerie ne bougeront qu’à la confirmation.'}</p>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" id="cancelOrder">Annuler</button><button class="btn btn-primary" type="submit">${isBuy?'Confirmer l’achat':'Créer la prévision'}</button></div>
    </form>`);
  document.getElementById('addLine').addEventListener('click',()=>{ document.getElementById('lineList').insertAdjacentHTML('beforeend',lineMarkup(type)); bindLineEvents(); updateOrderTotal(); });
  document.getElementById('cancelOrder').addEventListener('click',closeModal);
  bindLineEvents(); updateOrderTotal();
  document.getElementById('orderForm').addEventListener('submit', e=>{e.preventDefault(); submitOrder(type);});
}
function bindLineEvents() {
  document.querySelectorAll('.order-line').forEach(row => {
    const qty = row.querySelector('.line-qty'), price = row.querySelector('.line-price'), total = row.querySelector('.line-total');
    const totalFromPrice = () => { total.value = ceilTotal(qty.value, price.value); };
    row.querySelector('.line-item').onchange = e => {
      const item = itemFor(e.target.value);
      price.value = item ? (document.getElementById('orderType').value === 'achat' ? item.buy : item.sale) : 0;
      totalFromPrice(); updateOrderTotal();
    };
    qty.oninput = () => { totalFromPrice(); updateOrderTotal(); };      // quantité modifiée : le prix unitaire est conservé
    price.oninput = () => { totalFromPrice(); updateOrderTotal(); };    // prix modifié : total = prix × quantité actuelle
    total.oninput = () => {                                              // total modifié : prix = total ÷ quantité actuelle
      const u = total.value === '' ? null : unitFromTotal(total.value, qty.value);
      if (u !== null) price.value = u;
      updateOrderTotal();
    };
    total.onchange = totalFromPrice;                                     // affiche le total réellement enregistré
    row.querySelector('.remove-line').onclick = () => {
      if (document.querySelectorAll('.order-line').length > 1) { row.remove(); updateOrderTotal(); }
      else toast('Un bon doit contenir au moins une ligne.', true);
    };
  });
}
function collectLines() {
  return [...document.querySelectorAll('.order-line')].map(row=>({itemId:row.querySelector('.line-item').value,quantity:Number(row.querySelector('.line-qty').value),unitPrice:Number(row.querySelector('.line-price').value)}));
}
function updateOrderTotal() {
  if(!document.getElementById('orderTotalPreview')) return;
  const lines=collectLines();
  const total=lines.reduce((sum,l)=>sum+ceilTotal(l.quantity,l.unitPrice),0);
  document.getElementById('orderTotalPreview').textContent=sCurrency(total);
}
function nextRef(type) {
  const prefix=type==='achat'?'A':'V';
  const max=state.orders.filter(o=>o.ref.startsWith(prefix+'-')).map(o=>Number(o.ref.split('-')[1])).reduce((a,b)=>Math.max(a,b),90);
  return `${prefix}-${String(max+1).padStart(3,'0')}`;
}
async function submitOrder(type) {
  const lines=collectLines();
  if(!lines.length || lines.some(l=>!l.itemId || !Number.isInteger(l.quantity) || l.quantity<=0 || !Number.isFinite(l.unitPrice) || l.unitPrice<0)) return toast('Vérifiez les articles, quantités et prix.',true);
  try {
    await api.saveOrder({ id:uid(), type, partnerId:document.getElementById('orderPartner').value, lines,
      date: type==='achat' ? document.getElementById('orderDate').value : null });
    await refresh(); closeModal();
    toast(type==='achat'?'Achat confirmé : stock mis à jour.':'Prévision de vente créée. Le stock reste inchangé.');
  } catch(e) { toast(e.message || 'Erreur serveur', true); }
}
function openItemForm(item = null) {
  const isEdit = !!item;
  openModal(isEdit ? 'Modifier l\'article' : 'Nouvel article','CATALOGUE PRODUITS',`
    <form id="itemForm">
      <div class="form-grid">
        <div class="field full"><label for="itemName">NOM DE L'ARTICLE</label><input id="itemName" placeholder="Ex. : Lingot d'Or" required value="${isEdit ? escapeHtml(item.name) : ''}"></div>
        <div class="field"><label for="itemCategory">CATÉGORIE</label><select id="itemCategory">${state.categories.map(c => `<option ${isEdit && item.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select></div>
        <div class="field"><label for="itemGlyph">SYMBOLE (2 LETTRES)</label><input id="itemGlyph" maxlength="2" placeholder="Ex. : AU" required value="${isEdit ? escapeHtml(item.glyph) : ''}"></div>
        <div class="field"><label for="itemBuy">PRIX D'ACHAT INITIAL</label><input id="itemBuy" type="number" step="0.01" value="${isEdit ? item.buy : 0}"></div>
        <div class="field"><label for="itemSale">PRIX DE VENTE INITIAL</label><input id="itemSale" type="number" step="0.01" value="${isEdit ? item.sale : 0}"></div>
        <div class="field full">
          <label>IMAGE DE L'ARTICLE</label>
          <div style="display:flex;gap:12px;align-items:center">
            <div class="img-field-preview" id="itemImgPreview">${isEdit && item.image ? `<img src="${escapeHtml(item.image)}">` : '<span>?</span>'}</div>
            <input id="itemImageFile" type="file" accept="image/*" style="font-size:11px;color:#6e767e">
          </div>
        </div>
        <div class="field full">
          <label>FISCALITÉ (ACHAT)</label>
          <div style="display:flex;gap:16px;align-items:center;margin-top:8px">
            <label style="color:#cbd2d2"><input id="itemTaxable" type="checkbox" ${isEdit && item.taxDeductible ? 'checked' : ''}> Déductible des impôts</label>
            <div id="taxRateWrap" style="display:${isEdit && item.taxDeductible ? 'flex' : 'none'};align-items:center;gap:8px">
              <span style="color:#6e767e">Taux :</span>
              <input id="itemTaxRate" type="number" step="0.1" min="0" max="100" value="${isEdit ? item.taxRate : 20}" style="width:70px"> <span style="color:#6e767e">%</span>
            </div>
          </div>
          ${isEdit ? `<p class="page-footnote">Si vous modifiez cette fiscalité, les achats de cet article déjà enregistrés cette semaine (lundi → dimanche) sont recalculés. Les semaines précédentes ne changent pas.</p>` : ''}
        </div>
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" id="cancelItem">Annuler</button><button class="btn btn-primary" type="submit">${isEdit ? 'Enregistrer les modifications' : 'Créer l\'article'}</button></div>
    </form>`);
  document.getElementById('cancelItem').onclick=closeModal;

  let imageData = isEdit ? item.image : null;
  let imageFile = null;
  document.getElementById('itemImageFile').onchange = e => {
    const file = e.target.files[0];
    if (file && file.size > 2 * 1024 * 1024) { e.target.value = ''; return toast('Image trop lourde (2 Mo maximum).', true); }
    imageFile = file || null;
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => {
        imageData = ev.target.result;
        document.getElementById('itemImgPreview').innerHTML = `<img src="${imageData}">`;
      };
      reader.readAsDataURL(file);
    }
  };

  const taxable = document.getElementById('itemTaxable');
  taxable.onchange = () => document.getElementById('taxRateWrap').style.display = taxable.checked ? 'flex' : 'none';
  document.getElementById('itemForm').onsubmit = async e => {
    e.preventDefault();
    const itemData = {
      name: document.getElementById('itemName').value.trim(),
      category: document.getElementById('itemCategory').value,
      glyph: document.getElementById('itemGlyph').value.toUpperCase(),
      buy: Number(document.getElementById('itemBuy').value),
      sale: Number(document.getElementById('itemSale').value),
      taxDeductible: taxable.checked,
      taxRate: taxable.checked ? Number(document.getElementById('itemTaxRate').value) : 0
    };
    try {
      const catId = state.categoryRows.find(c=>c.name===itemData.category)?.id;
      if (isEdit) {
        await api.updateItem(item.id, itemData, catId, imageFile);
        const taxChanged = item.taxDeductible !== itemData.taxDeductible
          || (itemData.taxDeductible && Number(item.taxRate) !== itemData.taxRate);
        if (taxChanged) {
          try {
            const n = Number(await api.applyItemTaxToCurrentWeek(item.id)) || 0;
            toast(n ? `Article mis à jour · ${n} ligne(s) d’achat de la semaine en cours recalculée(s).`
                    : 'Article mis à jour (aucun achat de cet article cette semaine).');
          } catch (taxErr) {
            toast(`Article mis à jour, mais les achats de la semaine en cours n’ont pas été recalculés : ${taxErr.message || 'erreur serveur'}`, true);
          }
        } else {
          toast('Article mis à jour.');
        }
      } else {
        await api.createItem(itemData, catId, imageFile);
        toast('Article ajouté au catalogue.');
      }
      await refresh();
      closeModal();
    } catch(err) { toast(err.message||'Erreur serveur',true); }
  };
}
function openPartnerForm(partner = null) {
  const isEdit = !!partner;
  openModal(isEdit ? 'Modifier le partenaire' : 'Ajouter un partenaire','RÉSEAU COMMERCIAL',`
    <form id="partnerForm">
      <div class="field full"><label for="partnerName">NOM DU PARTENAIRE</label><input id="partnerName" maxlength="100" placeholder="Ex. : Société Martin" required value="${isEdit ? escapeHtml(partner.name) : ''}"></div>
      <div class="field full">
        <label>IMAGE DU PARTENAIRE</label>
        <div style="display:flex;gap:12px;align-items:center">
          <div class="img-field-preview" id="partnerImgPreview">${isEdit && partner.image ? `<img src="${escapeHtml(partner.image)}">` : '<span>?</span>'}</div>
          <input id="partnerImageFile" type="file" accept="image/*" style="font-size:11px;color:#6e767e">
        </div>
      </div>
      <div class="field full"><label for="partnerNote">NOTE</label><input id="partnerNote" maxlength="180" placeholder="Contact, pseudo en jeu, remarque..." value="${isEdit ? escapeHtml(partner.note) : ''}"></div>
      <div class="field"><label>TYPE DE PARTENAIRE</label><div style="display:flex;gap:16px;flex-wrap:wrap;color:#cbd2d2;font-size:11px"><label><input id="partnerSupplier" type="checkbox" ${isEdit && partner.supplier ? 'checked' : ''}> Fournisseur</label><label><input id="partnerClient" type="checkbox" ${isEdit && partner.client ? 'checked' : ''}> Client</label></div></div>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" id="cancelPartner">Annuler</button><button class="btn btn-primary" type="submit">${isEdit ? 'Enregistrer les modifications' : 'Ajouter le partenaire'}</button></div>
    </form>`);
  document.getElementById('cancelPartner').onclick=closeModal;

  let imageData = isEdit ? partner.image : null;
  let imageFile = null;
  document.getElementById('partnerImageFile').onchange = e => {
    const file = e.target.files[0];
    if (file && file.size > 2 * 1024 * 1024) { e.target.value = ''; return toast('Image trop lourde (2 Mo maximum).', true); }
    imageFile = file || null;
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => {
        imageData = ev.target.result;
        document.getElementById('partnerImgPreview').innerHTML = `<img src="${imageData}">`;
      };
      reader.readAsDataURL(file);
    }
  };

  document.getElementById('partnerForm').onsubmit=async e=>{
    e.preventDefault();
    const name=document.getElementById('partnerName').value.trim();
    const supplier=document.getElementById('partnerSupplier').checked;
    const client=document.getElementById('partnerClient').checked;
    const note=document.getElementById('partnerNote').value.trim();
    if(!supplier&&!client)return toast('Choisissez fournisseur et/ou client.',true);
    if(!isEdit && state.partners.some(p=>p.name.toLowerCase()===name.toLowerCase()))return toast('Ce partenaire existe déjà.',true);
    try {
      if (isEdit) {
        await api.updatePartner(partner.id, {name, supplier, client, note}, imageFile);
        toast('Partenaire mis à jour.');
      } else {
        await api.createPartner({name,supplier,client,note}, imageFile);
        toast('Partenaire ajouté.');
      }
      await refresh();
      closeModal();
    }
    catch(err) { toast(err.message||'Erreur serveur',true); }
  };
}

function openCategoryForm() {
  const canManage = api.can('catalog.manage');
  const catList = state.categoryRows.length ? `
    <div class="line-builder" style="margin-top:20px">
      <div class="line-builder-head"><strong>Catégories existantes</strong></div>
      <div class="line-list" style="max-height:200px;overflow-y:auto">
        ${state.categoryRows.map(c => `
          <div class="order-line" style="justify-content:space-between;padding:8px">
            <span>${escapeHtml(c.name)}</span>
            ${canManage ? `<button type="button" class="remove-line delete-cat" data-id="${c.id}" aria-label="Supprimer">×</button>` : ''}
          </div>
        `).join('')}
      </div>
    </div>` : '';

  openModal('Gérer les catégories', 'CATALOGUE PRODUITS', `
    <form id="categoryForm">
      <div class="field full"><label for="catName">NOM DE LA NOUVELLE CATÉGORIE</label><input id="catName" placeholder="Ex. : Électronique" required></div>
      <p class="page-footnote">La catégorie sera immédiatement disponible pour les nouveaux articles.</p>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" id="cancelCat">Annuler</button><button class="btn btn-primary" type="submit">Créer la catégorie</button></div>
    </form>
    ${catList}
  `);
  document.getElementById('cancelCat').onclick = closeModal;
  document.getElementById('categoryForm').onsubmit = async e => {
    e.preventDefault();
    const name = document.getElementById('catName').value.trim();
    if (state.categories.some(c => c.toLowerCase() === name.toLowerCase())) return toast('Cette catégorie existe déjà.', true);
    try { await api.createCategory(name); await refresh(); closeModal(); toast('Catégorie ajoutée.'); }
    catch(err) { toast(err.message||'Erreur serveur',true); }
  };
  document.querySelectorAll('.delete-cat').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const cat = state.categoryRows.find(c => c.id == id);
      if (confirm(`Supprimer la catégorie "${cat.name}" ?\nAttention : cela peut échouer si des articles y sont rattachés.`)) {
        try { await api.deleteCategory(id); await refresh(); closeModal(); toast('Catégorie supprimée.'); }
        catch(e) { toast(e.message || 'Erreur : vérifiez si des articles utilisent cette catégorie', true); }
      }
    };
  });
}
function goToHistory(id) {
  closeModal();
  historyState.expanded.add(id);
  resetHistoryFilters(false);
  showPage('history');
  setTimeout(() => document.querySelector(`.history-row[data-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
}
// Retrouve le bon d'achat d'une ligne de « achats déductibles »
function findPurchaseOrder(b, used) {
  // Cas normal (script SQL 03 appliqué) : le serveur renvoie l'identifiant du bon
  if (b.order_id) {
    const o = state.orders.find(x => x.id === b.order_id);
    return o ? { id: o.id, ref: o.ref } : null;
  }
  // Repli (ancienne fonction SQL) : rapprochement par date, article, montant et taux
  const raw = String(b.op_date ?? ''), t = raw.length > 10 ? Date.parse(raw) : NaN, day = raw.slice(0, 10);
  const name = norm(b.item_name);
  for (const o of state.orders) {
    if (o.type !== 'achat' || o.status !== 'confirme') continue;
    if (Number.isFinite(t) ? Math.abs(Date.parse(o.date) - t) > 1000
                           : (dayKey(o.date) !== day && new Date(o.date).toISOString().slice(0, 10) !== day)) continue;
    const i = o.lines.findIndex((l, k) => !used.has(`${o.id}:${k}`)
      && norm(itemFor(l.itemId)?.name ?? state.itemNames?.[l.itemId]?.name) === name
      && ceilTotal(l.quantity, l.unitPrice) === Math.round(Number(b.ht))
      && Number(l.deductionRate) === Number(b.rate));
    if (i >= 0) { used.add(`${o.id}:${i}`); return { id: o.id, ref: o.ref }; }
  }
  return null;
}
function openOrderDetails(id) {
  const order=state.orders.find(o=>o.id===id); if(!order)return;
  const lines=order.lines.map(l=>{return `<tr><td>${escapeHtml(itemLabel(l.itemId))}</td><td>${l.quantity}</td><td>${sCurrency(l.unitPrice)}</td><td class="align-right">${sCurrency(Math.ceil(l.quantity*l.unitPrice))}</td></tr>`;}).join('');
  let buttons='';
  if(order.type==='vente'&&order.status==='prevision'&&api.can('vente.manage')) buttons=`<button class="btn btn-primary" id="confirmSale">Confirmer la livraison</button><button class="btn btn-secondary" id="cancelSale">Annuler le bon</button>`;
  openModal(`Bon ${order.ref}`,'DÉTAIL DE L’OPÉRATION',`<div class="detail-list"><div class="detail-box"><small>TYPE</small><strong>${order.type==='achat'?'Achat':'Vente'}</strong></div><div class="detail-box"><small>STATUT</small>${statusBadge(order.status)}</div><div class="detail-box"><small>PARTENAIRE</small><strong>${partnerName(order.partner)}</strong></div><div class="detail-box"><small>DATE</small><strong>${fmtDate(order.date)}</strong></div></div><div class="table-scroll"><table style="min-width:420px"><thead><tr><th>ARTICLE</th><th>QTÉ</th><th>PRIX UNIT.</th><th class="align-right">TOTAL</th></tr></thead><tbody>${lines}</tbody></table></div><div class="order-total"><span>TOTAL DU BON</span><strong>${sCurrency(orderTotal(order))}</strong></div><p class="page-footnote">Créé par ${escapeHtml(order.createdBy)} · Version ${order.version}</p><div class="modal-actions"><button class="btn btn-secondary" id="closeDetails">Fermer</button><button class="btn btn-secondary" id="openInHistory">Voir dans l’historique ↗</button>${buttons}</div>`);
  document.getElementById('closeDetails').onclick=closeModal;
  document.getElementById('openInHistory').onclick=()=>goToHistory(order.id);
  document.getElementById('confirmSale')?.addEventListener('click',()=>confirmSale(order.id));
  document.getElementById('cancelSale')?.addEventListener('click',()=>cancelSale(order.id));
}
async function confirmSale(id) {
  const o=state.orders.find(x=>x.id===id); if(!o||o.status!=='prevision') return;
  try { await api.confirmSale(id,o.version); await refresh(); closeModal(); toast('Vente confirmée : stock mis à jour.'); }
  catch(e) { toast(e.message||'Erreur serveur',true); }
}
async function cancelSale(id) {
  const o=state.orders.find(x=>x.id===id); if(!o||o.status!=='prevision') return;
  try { await api.cancelOrder(id,o.version); await refresh(); closeModal(); toast('Bon de vente annulé.'); }
  catch(e) { toast(e.message||'Erreur serveur',true); }
}

function openCashFlowForm() {
  const day = new Date().toLocaleDateString('sv-SE');
  const flowId = uid();                         // un seul id par ouverture : un double clic ne crée pas de doublon
  openModal('Flux hors impôts', 'TRÉSORERIE · NON COMPTABILISÉ', `
    <form id="flowForm">
      <div class="form-grid">
        <div class="field full"><label for="flowLabel">LIBELLÉ</label><input id="flowLabel" maxlength="120" required placeholder="Ex. : Apport, retrait, remboursement…"></div>
        <div class="field"><label for="flowDirection">SENS</label><select id="flowDirection"><option value="entree">Entrée d’argent</option><option value="sortie">Sortie d’argent</option></select></div>
        <div class="field"><label for="flowAmount">MONTANT (s)</label><input id="flowAmount" type="number" min="0.01" step="0.01" required></div>
        <div class="field"><label for="flowDate">DATE</label><input id="flowDate" type="date" value="${day}" max="${day}" required></div>
        <div class="field full"><label for="flowNote">NOTE (FACULTATIF)</label><input id="flowNote" maxlength="180"></div>
      </div>
      <p class="page-footnote">Ce flux modifie la trésorerie disponible, mais n’entre dans aucun calcul d’impôt : ni chiffre d’affaires, ni déduction.</p>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" id="cancelFlow">Annuler</button><button class="btn btn-primary" type="submit" id="saveFlow">Enregistrer le flux</button></div>
    </form>`);
  document.getElementById('cancelFlow').onclick = closeModal;
  document.getElementById('flowForm').onsubmit = async e => {
    e.preventDefault();
    const amount = Number(document.getElementById('flowAmount').value);
    const label = document.getElementById('flowLabel').value.trim();
    if (!label || !Number.isFinite(amount) || amount <= 0) return toast('Indiquez un libellé et un montant supérieur à 0.', true);
    const btn = document.getElementById('saveFlow'); btn.disabled = true;
    try {
      await api.addCashFlow({ id: flowId, direction: document.getElementById('flowDirection').value, amount, label,
        note: document.getElementById('flowNote').value.trim(), date: document.getElementById('flowDate').value });
      await refresh(); closeModal();
      toast('Flux enregistré : trésorerie mise à jour (hors impôts).');
    } catch (err) { btn.disabled = false; toast(err.message || 'Erreur serveur', true); }
  };
}
async function deleteFlow(id) {
  const f = state.cashFlows.find(x => x.id === id); if (!f) return;
  if (!confirm(`Supprimer le flux « ${f.label} » (${f.direction === 'entree' ? '+' : '−'} ${sCurrency(f.amount)}) ? La trésorerie sera recalculée.`)) return;
  try { await api.deleteCashFlow(id); await refresh(); toast('Flux supprimé.'); }
  catch (err) { toast(err.message || 'Erreur serveur', true); }
}
function openTreasuryForm() {
  openModal('Paramètres de trésorerie', 'FINANCES COMPAGNIE', `
    <form id="treasuryForm">
      <div class="field full">
        <label for="openingCash">SOLDE INITIAL (SEP)</label>
        <input id="openingCashInput" type="number" step="0.01" value="${state.openingCash}" required>
      </div>
      <p class="page-footnote">Le solde initial est la base de calcul de la trésorerie disponible. Les mouvements confirmés s'y ajoutent ou s'en déduisent.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="cancelTreasury">Annuler</button>
        <button class="btn btn-primary" type="submit">Enregistrer</button>
      </div>
    </form>
  `);
  document.getElementById('cancelTreasury').onclick = closeModal;
  document.getElementById('treasuryForm').onsubmit = async e => {
    e.preventDefault();
    const val = Number(document.getElementById('openingCashInput').value);
    try {
      await api.setOpeningCash(val);
      await refresh();
      closeModal();
      toast('Solde initial mis à jour.');
    } catch(err) {
      toast(err.message || 'Erreur serveur', true);
    }
  };
}

document.addEventListener('click',e=>{
  const itemBtn=e.target.closest('[data-item-action]');
  if(itemBtn){
    const item=itemFor(itemBtn.dataset.itemAction);
    if(!item)return;
    const canManage = api.can("catalog.manage");
    openModal(item.name,'ACTION SUR LE STOCK',`
      <div class="detail-box"><small>STOCK DISPONIBLE</small><strong>${intFmt.format(item.stock)} unités</strong></div>
      <div class="modal-actions-grid">
        <button class="btn btn-secondary" id="itemBuy">Enregistrer un achat</button>
        <button class="btn btn-primary" id="itemSell">Créer une vente</button>
        ${canManage ? `
          <button class="btn btn-ghost" id="itemEdit">Modifier l'article</button>
          <button class="btn btn-danger" id="itemDelete">Supprimer l'article</button>
        ` : ''}
      </div>`);
    document.getElementById('itemBuy').onclick=()=>openOrderForm('achat', item.id);
    document.getElementById('itemSell').onclick=()=>openOrderForm('vente', item.id);
    if (canManage) {
      document.getElementById('itemEdit').onclick=()=>openItemForm(item);
      document.getElementById('itemDelete').onclick=async ()=>{
        if(confirm(`Supprimer définitivement "${item.name}" ?`)) {
          try {
            const res = await api.deleteItem(item.id);
            await refresh();
            closeModal();
            toast(res === 'archived' ? 'Article archivé (utilisé dans l\'historique).' : 'Article supprimé.');
          }
          catch(e) { toast(e.message||'Erreur serveur', true); }
        }
      };
    }
    return;
  }
  const partnerBtn=e.target.closest('[data-partner-action]');
  if(partnerBtn){
    const p=state.partners.find(x=>x.id===partnerBtn.dataset.partnerAction);
    if(!p)return;
    const canManage = api.can("partners.manage");
    openModal(p.name,'ACTION PARTENAIRE',`
      <div class="modal-actions-grid">
        <button class="btn btn-secondary" id="partnerBuy">Enregistrer un achat</button>
        <button class="btn btn-primary" id="partnerSell">Créer une vente</button>
        ${canManage ? `
          <button class="btn btn-ghost" id="partnerEdit">Modifier le partenaire</button>
          <button class="btn btn-danger" id="partnerDelete">Supprimer le partenaire</button>
        ` : ''}
      </div>`);
    document.getElementById('partnerBuy').onclick=()=>{ closeModal(); openOrderForm('achat'); setTimeout(()=>document.getElementById('orderPartner').value=p.id,10); };
    document.getElementById('partnerSell').onclick=()=>{ closeModal(); openOrderForm('vente'); setTimeout(()=>document.getElementById('orderPartner').value=p.id,10); };
    if (canManage) {
      document.getElementById('partnerEdit').onclick=()=>openPartnerForm(p);
      document.getElementById('partnerDelete').onclick=async ()=>{
        if(confirm(`Supprimer/archiver le partenaire "${p.name}" ?`)) {
          try {
            const res = await api.deletePartner(p.id);
            await refresh();
            closeModal();
            toast(res === 'archived' ? 'Partenaire archivé (utilisé dans l\'historique).' : 'Partenaire supprimé.');
          }
          catch(e) { toast(e.message||'Erreur serveur', true); }
        }
      };
    }
    return;
  }
  const orderBtn=e.target.closest('[data-order]');if(orderBtn)openOrderDetails(orderBtn.dataset.order);
});
['stockSearch','categoryFilter'].forEach(id=>document.getElementById(id)?.addEventListener(id==='stockSearch'?'input':'change',renderStock));
document.getElementById('operationFilter')?.addEventListener('change',renderOperations);
['partnerSearch'].forEach(id=>document.getElementById(id)?.addEventListener('input',renderPartners));
['historySearch','historyFrom','historyTo'].forEach(id=>document.getElementById(id)?.addEventListener('input',renderHistory));
['historyType','historyStatus','historyPartner','historyCreator'].forEach(id=>document.getElementById(id)?.addEventListener('change',renderHistory));
document.getElementById('historyReset')?.addEventListener('click',()=>resetHistoryFilters());
document.querySelector('#page-history thead')?.addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]'); if (!th) return;
  const key = th.dataset.sort, cur = historyState.sort;
  historyState.sort = { key, dir: cur.key === key ? (cur.dir === 'asc' ? 'desc' : 'asc') : (key === 'date' || key === 'total' ? 'desc' : 'asc') };
  renderHistory();
});
document.getElementById('homeIncludeFlows')?.addEventListener('change',renderDashboard);
document.getElementById('helpBtn').addEventListener('click',()=>toast('Données synchronisées avec Supabase.'));
function updateDashboardDate() {
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const formatted = new Intl.DateTimeFormat('fr-FR', options).format(new Date()).toUpperCase();
  const eyebrow = document.querySelector('#page-dashboard .eyebrow');
  if (eyebrow) {
    eyebrow.innerHTML = `${formatted} <span class="eyebrow-line"></span> RAPPORT OPÉRATIONNEL`;
  }
}
updateDashboardDate();
renderAll();


import { signInWithDiscord, getCurrentSession, signOut, syncDiscordIdentity } from "./auth.js";
import * as api from "./api.js";
import { initTax, refreshTax } from "./tax.js";

async function refresh() {
  const d = await api.loadAll();
  Object.assign(state, d);
  rebuildMovements();
  renderAll();
}

const NEEDS = { stock:['stock.read'], operations:['achat.create','vente.manage'], partners:['partners.read'],
  history:['history.read'], finance:['history.read'], tax:['tax.read'] };
const ACTIONS = { 'new-buy':['achat.create'], 'new-sale':['vente.manage'], 'new-partner':['partners.manage'],
  'new-item':['catalog.manage'], 'new-category':['catalog.manage'] };
let pollTimer = null;

async function boot(session) {
  clearInterval(pollTimer);
  if (!session?.user) return renderAll();
  const { roles } = await api.loadPermissions();
  document.querySelectorAll('[data-page]').forEach(el => { const n = NEEDS[el.dataset.page]; if (n) el.hidden = !api.can(...n); });
  document.querySelectorAll('[data-action]').forEach(el => { const n = ACTIONS[el.dataset.action]; if (n) el.hidden = !api.can(...n); });
  document.getElementById('rolePending')?.remove();
  if (!roles.length) {   // le bot Discord n'a pas encore attribué de rôle : on réessaie toutes les 20 s
    document.getElementById('page-dashboard').insertAdjacentHTML('afterbegin',
      '<div id="rolePending" style="padding:14px 18px;margin-bottom:16px;border:1px solid currentColor;border-radius:12px">Compte connecté, en attente de l’attribution de vos rôles Discord. Cette page se mettra à jour automatiquement.</div>');
    pollTimer = setInterval(() => boot(session), 20000);
    return renderAll();
  }
  try { await refresh(); } catch (e) { toast(e.message || 'Chargement impossible', true); }
}

async function initAuth() {
  const session = await getCurrentSession();
  if (session?.user) {
    await syncDiscordIdentity();
  }
  await boot(session);
  const updateUI = (user) => {
    const loginBtnTop = document.getElementById("discord-login-top");
    const logoutTop = document.getElementById("logout-top");

    if (user) {
      const metadata = user.user_metadata || {};
      const name = metadata.full_name || metadata.name || metadata.custom_claims?.global_name || metadata.preferred_username || "Utilisateur";
      const avatarUrl = metadata.avatar_url;
      const avatarInitials = initials(name);

      // Update dashboard welcome message
      const subheading = document.querySelector('#page-dashboard .subheading');
      if (subheading && !subheading.dataset.manual) subheading.textContent = `Bienvenue sur votre espace de gestion, ${name.split(' ')[0]}.`;

      if (loginBtnTop) {
        loginBtnTop.classList.remove('is-guest');
        loginBtnTop.setAttribute('aria-label', `Connecté : ${name}`);
        loginBtnTop.title = `Connecté : ${name}`;
        loginBtnTop.innerHTML = avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="" style="width:100%;height:100%;border-radius:inherit;object-fit:cover">` : avatarInitials;
        loginBtnTop.onclick = null;
      }

      const doLogout = () => { if(confirm("Se déconnecter ?")) { signOut().then(() => window.location.reload()); } };
      if (logoutTop) { logoutTop.hidden = false; logoutTop.onclick = doLogout; }
    } else {
      if (loginBtnTop) {
        loginBtnTop.classList.add('is-guest');
        loginBtnTop.setAttribute('aria-label', 'Se connecter avec Discord');
        loginBtnTop.title = 'Se connecter avec Discord';
        loginBtnTop.textContent = 'Connexion';
        loginBtnTop.onclick = signInWithDiscord;
      }
      if (logoutTop) logoutTop.hidden = true;
    }
  };

  updateUI(session?.user);
}

initAuth();
