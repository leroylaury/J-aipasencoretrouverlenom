'use strict';

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const intFmt = new Intl.NumberFormat('fr-FR');
const today = new Date('2026-10-30T13:00:00');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxx-xxxx-4xxx-yxxx-xxxxxxxx'.replace(/[xy]/g, c => (Math.random() * 16 | 0).toString(16)));
const initials = name => name.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = value => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const state = {
  openingCash: 110900,
  cash: 125400,
  items: [
    { id: 'it-steel', name: 'Acier', category: 'Métaux', stock: 75, buy: 180, sale: 250, glyph: 'AC', image: null, taxDeductible: true, taxRate: 20 },
    { id: 'it-alum', name: 'Aluminium', category: 'Métaux', stock: 64, buy: 145, sale: 210, glyph: 'AL', image: null, taxDeductible: true, taxRate: 20 },
    { id: 'it-copper', name: 'Cuivre', category: 'Métaux', stock: 38, buy: 220, sale: 310, glyph: 'CU', image: null, taxDeductible: false, taxRate: 0 },
    { id: 'it-cement', name: 'Ciment', category: 'Matériaux', stock: 45, buy: 60, sale: 95, glyph: 'CI', image: null, taxDeductible: true, taxRate: 5.5 },
    { id: 'it-wood', name: 'Bois traité', category: 'Matériaux', stock: 26, buy: 90, sale: 140, glyph: 'BT', image: null, taxDeductible: false, taxRate: 0 }
  ],
  partners: [
    { id: 'p-nord', name: 'Nord Métaux', supplier: true, client: false, note: 'Fournisseur principal · Secteur nord', image: null },
    { id: 'p-industries', name: 'Industries Martin', supplier: true, client: true, note: 'Compte professionnel', image: null },
    { id: 'p-btp', name: 'BTP Services', supplier: false, client: true, note: 'Client régulier', image: null },
    { id: 'p-energie', name: 'Énergie & Co', supplier: true, client: false, note: 'Approvisionnement énergie', image: null }
  ],
  orders: [],
  movements: []
};

function seedData() {
  const samples = [
    { ref:'A-102', type:'vente', status:'confirme', partner:'BTP Services', date:'2026-10-30T10:42:00', createdBy:'Jean Dupont', lines:[['Aluminium',10,250]] },
    { ref:'A-101', type:'achat', status:'confirme', partner:'Nord Métaux', date:'2026-10-30T09:15:00', createdBy:'Jean Dupont', lines:[['Acier',20,260]] },
    { ref:'V-098', type:'vente', status:'prevision', partner:'Industries Martin', date:'2026-10-29T16:30:00', createdBy:'Marie Laurent', lines:[['Cuivre',8,310]] },
    { ref:'A-097', type:'achat', status:'confirme', partner:'Énergie & Co', date:'2026-10-28T14:20:00', createdBy:'Jean Dupont', lines:[['Ciment',20,60]] },
    { ref:'V-096', type:'vente', status:'confirme', partner:'Industries Martin', date:'2026-10-27T11:05:00', createdBy:'Marie Laurent', lines:[['Acier',30,250]] },
    { ref:'A-095', type:'achat', status:'confirme', partner:'Nord Métaux', date:'2026-10-24T08:50:00', createdBy:'Jean Dupont', lines:[['Aluminium',20,145]] },
    { ref:'V-094', type:'vente', status:'prevision', partner:'BTP Services', date:'2026-10-23T15:40:00', createdBy:'Marie Laurent', lines:[['Bois traité',12,140]] },
    { ref:'A-093', type:'achat', status:'confirme', partner:'Industries Martin', date:'2026-10-21T10:15:00', createdBy:'Jean Dupont', lines:[['Cuivre',20,220]] },
    { ref:'V-092', type:'vente', status:'confirme', partner:'BTP Services', date:'2026-10-20T12:10:00', createdBy:'Jean Dupont', lines:[['Ciment',15,95]] }
  ];
  state.orders = samples.map((s, i) => ({
    id: uid(), ref: s.ref, type: s.type, status: s.status, partner: s.partner, date: s.date, createdBy: s.createdBy,
    lines: s.lines.map(([name, quantity, unitPrice]) => {
      const item = state.items.find(x => x.name === name);
      return { itemId: item.id, quantity, unitPrice, deductionRate: s.type === 'achat' && item.taxDeductible ? item.taxRate : 0 };
    }),
    version: 1
  }));
  const buyTotals = state.orders.filter(o => o.type === 'achat' && o.status === 'confirme').reduce((a,o) => a + orderTotal(o), 0);
  const saleTotals = state.orders.filter(o => o.type === 'vente' && o.status === 'confirme').reduce((a,o) => a + orderTotal(o), 0);
  // Historical demo figures are preserved as an opening balance plus confirmed demo operations.
  state.openingCash = 110900 + (buyTotals - 18200) - (saleTotals - 32700);
  rebuildMovements();
}
function orderTotal(order) { return order.lines.reduce((sum, line) => sum + Math.ceil(line.quantity * line.unitPrice), 0); }
function itemFor(id) { return state.items.find(item => item.id === id); }
function rebuildMovements() {
  state.movements = state.orders.filter(o => o.status === 'confirme').map(o => ({
    id: o.id, ref: o.ref, label: `${o.type === 'achat' ? 'Achat' : 'Vente'} · ${o.partner}`,
    type: o.type, amount: orderTotal(o), date: o.date
  }));
  state.cash = state.openingCash + state.movements.reduce((sum,m) => sum + (m.type === 'vente' ? m.amount : -m.amount), 0);
}
seedData();

const pageLabels = { dashboard:'VUE GÉNÉRALE', stock:'INVENTAIRE', operations:'OPÉRATIONS', partners:'PARTENAIRES', history:'HISTORIQUE', finance:'TRÉSORERIE', tax:'IMPÔTS' };
function showPage(page) {
  if (!pageLabels[page]) return;
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
  document.querySelectorAll('[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.getElementById('crumbLabel').textContent = pageLabels[page];
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderAll();
}
document.addEventListener('click', e => {
  const pageButton = e.target.closest('[data-page]');
  if (pageButton) { e.preventDefault(); showPage(pageButton.dataset.page); return; }
  const actionButton = e.target.closest('[data-action]');
  if (actionButton) { openAction(actionButton.dataset.action); }
});

function statusBadge(status) {
  const labels = { confirme:'Confirmé', prevision:'En prévision', annule:'Annulé' };
  return `<span class="status ${status}">${labels[status]}</span>`;
}
function typeChip(type) { return `<span class="type-chip ${type}">${type === 'achat' ? 'ACHAT' : 'VENTE'}</span>`; }
function partnerName(name) { return escapeHtml(name || 'Partenaire non renseigné'); }
function renderDashboard() {
  const stockUnits = state.items.reduce((sum,x) => sum + x.stock, 0);
  const stockValue = state.items.reduce((sum,x) => sum + x.stock * x.buy, 0);
  const pending = state.orders.filter(o => o.status === 'prevision').length;
  document.getElementById('cashMetric').textContent = eur.format(state.cash);
  document.getElementById('stockValueMetric').textContent = eur.format(stockValue);
  document.getElementById('stockUnitsMetric').textContent = `${intFmt.format(stockUnits)} unités`;
  document.getElementById('pendingMetric').textContent = intFmt.format(pending);
  document.getElementById('movementMetric').textContent = intFmt.format(state.orders.length);
  document.getElementById('navStockCount').textContent = String(state.items.length).padStart(2,'0');
  document.getElementById('recentRows').innerHTML = [...state.orders].sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,5).map(order => `<tr><td><div class="reference-cell"><span class="item-symbol">${order.type==='achat'?'↓':'↑'}</span><span><span class="cell-title">${escapeHtml(order.ref)}</span><span class="cell-sub">${order.lines.length} ligne(s)</span></span></div></td><td>${partnerName(order.partner)}</td><td>${fmtDate(order.date)}</td><td>${statusBadge(order.status)}</td><td class="align-right">${eur.format(orderTotal(order))}</td></tr>`).join('');
}
function renderStock() {
  const query = (document.getElementById('stockSearch')?.value || '').trim().toLowerCase();
  const category = document.getElementById('categoryFilter')?.value || 'all';
  const filtered = state.items.filter(x => (x.name.toLowerCase().includes(query) || x.category.toLowerCase().includes(query)) && (category === 'all' || x.category === category));
  const stockUnits = state.items.reduce((sum,x) => sum+x.stock,0);
  document.getElementById('itemCount').textContent = String(state.items.length).padStart(2,'0');
  document.getElementById('stockUnitsSummary').textContent = intFmt.format(stockUnits);
  document.getElementById('stockResultCount').textContent = `${filtered.length} ARTICLE${filtered.length>1?'S':''}`;
  document.getElementById('stockRows').innerHTML = filtered.length ? filtered.map(x => `<tr><td><div class="item-cell"><span class="item-symbol">${x.image ? `<img src="${escapeHtml(x.image)}" alt="">` : escapeHtml(x.glyph)}</span><span><span class="cell-title">${escapeHtml(x.name)}</span><span class="cell-sub">Réf. ${escapeHtml(x.id.toUpperCase())}</span></span></div></td><td>${escapeHtml(x.category)}</td><td><strong>${intFmt.format(x.stock)}</strong> <span class="cell-sub">unités</span></td><td>${eur.format(x.buy)}</td><td>${eur.format(x.sale)}</td><td><button class="row-action" data-item-action="${x.id}">Opérer</button></td></tr>`).join('') : `<tr><td colspan="6"><div class="empty-state">Aucun article ne correspond à votre recherche.</div></td></tr>`;
}
function renderOperations() {
  const filter = document.getElementById('operationFilter')?.value || 'all';
  const rows = [...state.orders].filter(o => filter === 'all' || o.status === filter).sort((a,b)=>new Date(b.date)-new Date(a.date));
  document.getElementById('operationRows').innerHTML = rows.map(o => `<tr><td><span class="cell-title">${escapeHtml(o.ref)}</span></td><td>${typeChip(o.type)}</td><td>${partnerName(o.partner)}</td><td>${fmtDate(o.date)}</td><td>${statusBadge(o.status)}</td><td class="align-right">${eur.format(orderTotal(o))}</td><td><button class="row-action" data-order="${o.id}">Détails</button></td></tr>`).join('') || `<tr><td colspan="7"><div class="empty-state">Aucune opération.</div></td></tr>`;
}
function renderPartners() {
  const query = (document.getElementById('partnerSearch')?.value || '').toLowerCase();
  const rows = state.partners.filter(p => p.name.toLowerCase().includes(query));
  document.getElementById('partnerCount').textContent = `${rows.length} PARTENAIRE${rows.length>1?'S':''}`;
  document.getElementById('partnerGrid').innerHTML = rows.map(p => `<article class="partner-card"><div class="partner-head"><span class="partner-avatar">${p.image ? `<img src="${escapeHtml(p.image)}" alt="">` : initials(p.name)}</span><span><strong>${escapeHtml(p.name)}</strong><small>Partenaire commercial</small></span></div><div class="partner-flags">${p.supplier?'<span class="partner-flag">FOURNISSEUR</span>':''}${p.client?'<span class="partner-flag">CLIENT</span>':''}</div><div class="partner-note">${escapeHtml(p.note || 'Aucune note')}</div></article>`).join('') || `<div class="empty-state">Aucun partenaire trouvé.</div>`;
}
function renderHistory() {
  const query = (document.getElementById('historySearch')?.value || '').toLowerCase();
  const type = document.getElementById('historyType')?.value || 'all';
  const status = document.getElementById('historyStatus')?.value || 'all';
  const rows = [...state.orders].filter(o => (type==='all'||o.type===type) && (status==='all'||o.status===status) && (`${o.ref} ${o.partner} ${o.lines.map(l=>itemFor(l.itemId)?.name).join(' ')}`.toLowerCase().includes(query))).sort((a,b)=>new Date(b.date)-new Date(a.date));
  document.getElementById('historyRows').innerHTML = rows.map(o => `<tr><td><span class="cell-title">${escapeHtml(o.ref)}</span></td><td>${typeChip(o.type)}</td><td>${partnerName(o.partner)}</td><td>${escapeHtml(o.createdBy)}</td><td>${fmtDate(o.date)}</td><td>${statusBadge(o.status)}</td><td class="align-right">${eur.format(orderTotal(o))}</td></tr>`).join('') || `<tr><td colspan="7"><div class="empty-state">Aucune opération ne correspond aux filtres.</div></td></tr>`;
}
function renderFinance() {
  rebuildMovements();
  const incoming = state.movements.filter(m=>m.type==='vente').reduce((a,m)=>a+m.amount,0);
  const outgoing = state.movements.filter(m=>m.type==='achat').reduce((a,m)=>a+m.amount,0);
  document.getElementById('financeCash').textContent = eur.format(state.cash);
  document.getElementById('financeIn').textContent = eur.format(incoming);
  document.getElementById('financeOut').textContent = eur.format(outgoing);
  document.getElementById('financeRows').innerHTML = [...state.movements].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(m=>`<tr><td><span class="cell-title">${escapeHtml(m.ref)}</span></td><td>${escapeHtml(m.label)}</td><td>${fmtDate(m.date)}</td><td class="align-right ${m.type==='vente'?'positive':'negative'}">${m.type==='vente'?'+':'−'} ${eur.format(m.amount)}</td></tr>`).join('') || `<tr><td colspan="4"><div class="empty-state">Aucun mouvement financier.</div></td></tr>`;
}
function renderTax() {
  const taxLines = [];
  state.orders.filter(o => o.type === 'achat' && o.status === 'confirme').forEach(o => {
    o.lines.forEach(l => {
      if (l.deductionRate > 0) {
        taxLines.push({ date: o.date, item: itemFor(l.itemId)?.name || 'Article', amount: l.quantity * l.unitPrice, rate: l.deductionRate });
      }
    });
  });
  const totalAchat = state.orders.filter(o => o.type === 'achat' && o.status === 'confirme').reduce((a,o) => a + orderTotal(o), 0);
  const totalDeduction = taxLines.reduce((a,l) => a + (l.amount * l.rate / 100), 0);
  document.getElementById('taxTotalAchat').textContent = eur.format(totalAchat);
  document.getElementById('taxTotalDeduction').textContent = eur.format(totalDeduction);
  document.getElementById('taxNet').textContent = eur.format(totalAchat - totalDeduction);
  document.getElementById('taxRows').innerHTML = taxLines.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(l => `<tr><td>${fmtDate(l.date)}</td><td><span class="cell-title">${escapeHtml(l.item)}</span></td><td>${eur.format(l.amount)}</td><td><span class="tax-rate">${l.rate}%</span></td><td class="align-right positive">− ${eur.format(l.amount * l.rate / 100)}</td></tr>`).join('') || `<tr><td colspan="5"><div class="empty-state">Aucune déduction fiscale enregistrée.</div></td></tr>`;
}
function renderAll() { renderDashboard(); renderStock(); renderOperations(); renderPartners(); renderHistory(); renderFinance(); renderTax(); }

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
}
function partnerOptions(type) {
  const candidates = state.partners.filter(p => type==='achat' ? p.supplier : p.client);
  return `<option value="">Partenaire non renseigné</option>${candidates.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}`;
}
function lineMarkup(type) {
  const priceField = type === 'achat' ? 'buy' : 'sale';
  return `<div class="order-line"><select class="line-item" aria-label="Article">${state.items.map(x=>`<option value="${x.id}">${escapeHtml(x.name)} · ${x.stock} en stock</option>`).join('')}</select><input class="line-qty" type="number" min="1" step="1" value="1" aria-label="Quantité"><input class="line-price" type="number" min="0" step="0.01" value="${state.items[0]?.[priceField] ?? 0}" aria-label="Prix unitaire"><button type="button" class="remove-line" aria-label="Supprimer la ligne">×</button></div>`;
}
function openOrderForm(type) {
  if (!state.items.length) return toast('Ajoutez d’abord un article au catalogue.', true);
  const isBuy = type==='achat';
  openModal(isBuy?'Enregistrer un achat':'Créer une vente','NOUVEAU BON · '+(isBuy?'APPROVISIONNEMENT':'COMMERCE'), `
    <form id="orderForm">
      <input type="hidden" id="orderType" value="${type}">
      <div class="form-grid"><div class="field full"><label for="orderPartner">PARTENAIRE</label><select id="orderPartner">${partnerOptions(type)}</select></div><div class="field"><label for="orderDate">DATE DE L'OPÉRATION</label><input id="orderDate" type="date" value="2026-10-30" required></div><div class="field"><label>STATUT INITIAL</label><input value="${isBuy?'Confirmé immédiatement':'En prévision'}" disabled></div></div>
      <div class="line-builder"><div class="line-builder-head"><strong>Articles du bon</strong><span class="cell-sub">PRIX UNITAIRES EN €</span></div><div class="line-list" id="lineList">${lineMarkup(type)}</div><button type="button" class="add-line" id="addLine">＋ Ajouter une ligne</button></div>
      <div class="order-total"><span>TOTAL DU BON <small class="cell-sub"> · arrondi supérieur par ligne</small></span><strong id="orderTotalPreview">0,00 €</strong></div>
      <p class="page-footnote">${isBuy?'Le bon sera confirmé immédiatement, la trésorerie diminuée et les quantités ajoutées au stock.':'La vente sera enregistrée en prévision. Le stock et la trésorerie ne bougeront qu’à la confirmation.'}</p>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" id="cancelOrder">Annuler</button><button class="btn btn-primary" type="submit">${isBuy?'Confirmer l’achat':'Créer la prévision'}</button></div>
    </form>`);
  document.getElementById('addLine').addEventListener('click',()=>{ document.getElementById('lineList').insertAdjacentHTML('beforeend',lineMarkup(type)); bindLineEvents(); updateOrderTotal(); });
  document.getElementById('cancelOrder').addEventListener('click',closeModal);
  bindLineEvents(); updateOrderTotal();
  document.getElementById('orderForm').addEventListener('submit', e=>{e.preventDefault(); submitOrder(type);});
}
function bindLineEvents() {
  document.querySelectorAll('.line-item').forEach(el=>{el.onchange=()=>{const item=itemFor(el.value);const price=el.closest('.order-line').querySelector('.line-price');price.value= item ? (document.getElementById('orderType').value==='achat'?item.buy:item.sale) : 0;updateOrderTotal();};});
  document.querySelectorAll('.line-qty,.line-price').forEach(el=>el.oninput=updateOrderTotal);
  document.querySelectorAll('.remove-line').forEach(el=>el.onclick=()=>{ if(document.querySelectorAll('.order-line').length>1){el.closest('.order-line').remove();updateOrderTotal();} else toast('Un bon doit contenir au moins une ligne.',true); });
}
function collectLines() {
  return [...document.querySelectorAll('.order-line')].map(row=>({itemId:row.querySelector('.line-item').value,quantity:Number(row.querySelector('.line-qty').value),unitPrice:Number(row.querySelector('.line-price').value)}));
}
function updateOrderTotal() {
  if(!document.getElementById('orderTotalPreview')) return;
  const lines=collectLines();
  const total=lines.reduce((sum,l)=>sum+(Number.isFinite(l.quantity)&&Number.isFinite(l.unitPrice)?Math.ceil(l.quantity*l.unitPrice):0),0);
  document.getElementById('orderTotalPreview').textContent=eur.format(total);
}
function nextRef(type) {
  const prefix=type==='achat'?'A':'V';
  const max=state.orders.filter(o=>o.ref.startsWith(prefix+'-')).map(o=>Number(o.ref.split('-')[1])).reduce((a,b)=>Math.max(a,b),90);
  return `${prefix}-${String(max+1).padStart(3,'0')}`;
}
function submitOrder(type) {
  const lines=collectLines();
  if(!lines.length || lines.some(l=>!l.itemId || !Number.isInteger(l.quantity) || l.quantity<=0 || !Number.isFinite(l.unitPrice) || l.unitPrice<0)) return toast('Vérifiez les articles, quantités et prix.',true);
  const enrichedLines = lines.map(l => {
    const item = itemFor(l.itemId);
    return { ...l, deductionRate: type === 'achat' && item.taxDeductible ? item.taxRate : 0 };
  });
  const order={id:uid(),ref:nextRef(type),type,status:type==='achat'?'confirme':'prevision',partner:state.partners.find(p=>p.id===document.getElementById('orderPartner').value)?.name || '',date:new Date(document.getElementById('orderDate').value+'T12:00:00').toISOString(),createdBy:'Jean Dupont',lines:enrichedLines,version:1};
  if(type==='achat') {
    const cost=orderTotal(order);
    if(cost>state.cash) return toast('Trésorerie insuffisante pour cet achat.',true);
    lines.forEach(l=>{const item=itemFor(l.itemId);item.stock+=l.quantity;item.buy=l.unitPrice;});
  }
  state.orders.unshift(order); rebuildMovements(); closeModal(); renderAll();
  toast(type==='achat'?'Achat confirmé : stock et trésorerie mis à jour.':'Prévision de vente créée. Le stock reste inchangé.');
}
function openItemForm() {
  openModal('Nouvel article','CATALOGUE PRODUITS',`
    <form id="itemForm">
      <div class="form-grid">
        <div class="field full"><label for="itemName">NOM DE L'ARTICLE</label><input id="itemName" placeholder="Ex. : Lingot d'Or" required></div>
        <div class="field"><label for="itemCategory">CATÉGORIE</label><select id="itemCategory"><option>Métaux</option><option>Matériaux</option><option>Énergie</option><option>Divers</option></select></div>
        <div class="field"><label for="itemGlyph">SYMBOLE (2 LETTRES)</label><input id="itemGlyph" maxlength="2" placeholder="Ex. : AU" required></div>
        <div class="field"><label for="itemBuy">PRIX D'ACHAT INITIAL</label><input id="itemBuy" type="number" step="0.01" value="0"></div>
        <div class="field"><label for="itemSale">PRIX DE VENTE INITIAL</label><input id="itemSale" type="number" step="0.01" value="0"></div>
        <div class="field full"><label for="itemImage">URL DE L'IMAGE (OPTIONNEL)</label><input id="itemImage" type="url" placeholder="https://..."></div>
        <div class="field full">
          <label>FISCALITÉ (ACHAT)</label>
          <div style="display:flex;gap:16px;align-items:center;margin-top:8px">
            <label style="color:#cbd2d2"><input id="itemTaxable" type="checkbox"> Déductible des impôts</label>
            <div id="taxRateWrap" style="display:none;align-items:center;gap:8px">
              <span style="color:#6e767e">Taux :</span>
              <input id="itemTaxRate" type="number" step="0.1" value="20" style="width:70px"> <span style="color:#6e767e">%</span>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" id="cancelItem">Annuler</button><button class="btn btn-primary" type="submit">Créer l'article</button></div>
    </form>`);
  document.getElementById('cancelItem').onclick=closeModal;
  const taxable = document.getElementById('itemTaxable');
  taxable.onchange = () => document.getElementById('taxRateWrap').style.display = taxable.checked ? 'flex' : 'none';
  document.getElementById('itemForm').onsubmit = e => {
    e.preventDefault();
    const newItem = {
      id: 'it-' + uid().slice(0,8),
      name: document.getElementById('itemName').value.trim(),
      category: document.getElementById('itemCategory').value,
      glyph: document.getElementById('itemGlyph').value.toUpperCase(),
      stock: 0,
      buy: Number(document.getElementById('itemBuy').value),
      sale: Number(document.getElementById('itemSale').value),
      image: document.getElementById('itemImage').value.trim() || null,
      taxDeductible: taxable.checked,
      taxRate: taxable.checked ? Number(document.getElementById('itemTaxRate').value) : 0
    };
    state.items.push(newItem);
    closeModal(); renderAll(); toast('Article ajouté au catalogue.');
  };
}
function openPartnerForm() {
  openModal('Ajouter un partenaire','RÉSEAU COMMERCIAL',`<form id="partnerForm"><div class="field full"><label for="partnerName">NOM DU PARTENAIRE</label><input id="partnerName" maxlength="100" placeholder="Ex. : Société Martin" required></div><div class="field full"><label for="partnerImage">URL DE L'IMAGE (OPTIONNEL)</label><input id="partnerImage" type="url" placeholder="https://..."></div><div class="field full"><label for="partnerNote">NOTE</label><input id="partnerNote" maxlength="180" placeholder="Contact, pseudo en jeu, remarque..."></div><div class="field"><label>TYPE DE PARTENAIRE</label><div style="display:flex;gap:16px;flex-wrap:wrap;color:#cbd2d2;font-size:11px"><label><input id="partnerSupplier" type="checkbox"> Fournisseur</label><label><input id="partnerClient" type="checkbox"> Client</label></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" id="cancelPartner">Annuler</button><button class="btn btn-primary" type="submit">Ajouter le partenaire</button></div></form>`);
  document.getElementById('cancelPartner').onclick=closeModal;
  document.getElementById('partnerForm').onsubmit=e=>{e.preventDefault();const name=document.getElementById('partnerName').value.trim();const supplier=document.getElementById('partnerSupplier').checked;const client=document.getElementById('partnerClient').checked;if(!supplier&&!client)return toast('Choisissez fournisseur et/ou client.',true);if(state.partners.some(p=>p.name.toLowerCase()===name.toLowerCase()))return toast('Ce partenaire existe déjà.',true);state.partners.push({id:uid(),name,supplier,client,note:document.getElementById('partnerNote').value.trim(),image:document.getElementById('partnerImage').value.trim()||null});closeModal();renderAll();toast('Partenaire ajouté au catalogue de démonstration.');};
}
function openOrderDetails(id) {
  const order=state.orders.find(o=>o.id===id); if(!order)return;
  const lines=order.lines.map(l=>{const item=itemFor(l.itemId);return `<tr><td>${escapeHtml(item?.name||'Article')}</td><td>${l.quantity}</td><td>${eur.format(l.unitPrice)}</td><td class="align-right">${eur.format(Math.ceil(l.quantity*l.unitPrice))}</td></tr>`;}).join('');
  let buttons='';
  if(order.type==='vente'&&order.status==='prevision') buttons=`<button class="btn btn-primary" id="confirmSale">Confirmer la livraison</button><button class="btn btn-secondary" id="cancelSale">Annuler le bon</button>`;
  openModal(`Bon ${order.ref}`,'DÉTAIL DE L’OPÉRATION',`<div class="detail-list"><div class="detail-box"><small>TYPE</small><strong>${order.type==='achat'?'Achat':'Vente'}</strong></div><div class="detail-box"><small>STATUT</small>${statusBadge(order.status)}</div><div class="detail-box"><small>PARTENAIRE</small><strong>${partnerName(order.partner)}</strong></div><div class="detail-box"><small>DATE</small><strong>${fmtDate(order.date)}</strong></div></div><div class="table-scroll"><table style="min-width:420px"><thead><tr><th>ARTICLE</th><th>QTÉ</th><th>PRIX UNIT.</th><th class="align-right">TOTAL</th></tr></thead><tbody>${lines}</tbody></table></div><div class="order-total"><span>TOTAL DU BON</span><strong>${eur.format(orderTotal(order))}</strong></div><p class="page-footnote">Créé par ${escapeHtml(order.createdBy)} · Version ${order.version}</p><div class="modal-actions"><button class="btn btn-secondary" id="closeDetails">Fermer</button>${buttons}</div>`);
  document.getElementById('closeDetails').onclick=closeModal;
  document.getElementById('confirmSale')?.addEventListener('click',()=>confirmSale(order.id));
  document.getElementById('cancelSale')?.addEventListener('click',()=>cancelSale(order.id));
}
function confirmSale(id) {
  const order=state.orders.find(o=>o.id===id);if(!order||order.status!=='prevision')return;
  const needed={};order.lines.forEach(l=>needed[l.itemId]=(needed[l.itemId]||0)+l.quantity);
  const shortage=Object.entries(needed).find(([itemId,qty])=>!itemFor(itemId)||itemFor(itemId).stock<qty);
  if(shortage){const item=itemFor(shortage[0]);return toast(`Stock insuffisant pour ${item?.name||'un article'} : ${item?.stock??0} disponible(s).`,true);}
  Object.entries(needed).forEach(([itemId,qty])=>itemFor(itemId).stock-=qty);
  order.status='confirme';order.version++;order.confirmedAt=new Date().toISOString();
  rebuildMovements();closeModal();renderAll();toast('Vente confirmée : stock et trésorerie mis à jour.');
}
function cancelSale(id) {
  const order=state.orders.find(o=>o.id===id);if(!order||order.status!=='prevision')return;
  order.status='annule';order.version++;closeModal();renderAll();toast('Bon de vente annulé.');
}

document.addEventListener('click',e=>{
  const itemBtn=e.target.closest('[data-item-action]');if(itemBtn){const item=itemFor(itemBtn.dataset.itemAction);if(!item)return;openModal(item.name,'ACTION SUR LE STOCK',`<div class="detail-box"><small>STOCK DISPONIBLE</small><strong>${intFmt.format(item.stock)} unités</strong></div><div class="modal-actions"><button class="btn btn-secondary" id="itemBuy">Enregistrer un achat</button><button class="btn btn-primary" id="itemSell">Créer une vente</button></div>`);document.getElementById('itemBuy').onclick=()=>openOrderForm('achat');document.getElementById('itemSell').onclick=()=>openOrderForm('vente');return;}
  const orderBtn=e.target.closest('[data-order]');if(orderBtn)openOrderDetails(orderBtn.dataset.order);
});
['stockSearch','categoryFilter'].forEach(id=>document.getElementById(id)?.addEventListener(id==='stockSearch'?'input':'change',renderStock));
document.getElementById('operationFilter')?.addEventListener('change',renderOperations);
['partnerSearch'].forEach(id=>document.getElementById(id)?.addEventListener('input',renderPartners));
['historySearch','historyType','historyStatus'].forEach(id=>document.getElementById(id)?.addEventListener(id==='historySearch'?'input':'change',renderHistory));
document.getElementById('helpBtn').addEventListener('click',()=>toast('Prototype visuel : les données sont fictives et stockées uniquement en mémoire pendant la session.'));
renderAll();
