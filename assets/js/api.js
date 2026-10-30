// Couche d'accès aux données : tout passe par Supabase (RLS + RPC), aucune règle métier côté front.
import { supabase } from "./auth.js";

const BUCKET = "catalog-images";
const imgUrl = path => (path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null);
async function uploadImage(folder, file) {
  const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;   // nom unique : pas de cache périmé
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}
const dropImage = path => path && supabase.storage.from(BUCKET).remove([path]).catch(() => {});

export const perms = new Set();
export const can = (...p) => p.some(x => perms.has(x));

const num = v => (v == null ? null : Number(v));
const run = async p => { const { data, error } = await p; if (error) throw error; return data; };
const rpc = (fn, args) => run(supabase.rpc(fn, args));

// PostgREST plafonne à 1000 lignes par requête : on pagine.
async function fetchAll(make) {
  let out = [], from = 0;
  for (;;) {
    const rows = await run(make().range(from, from + 999));
    out = out.concat(rows);
    if (rows.length < 1000) return out;
    from += 1000;
  }
}

// Rôles posés par le bot Discord (profiles.roles) -> permissions (role_permissions)
export async function loadPermissions() {
  const { data: { user } } = await supabase.auth.getUser();
  perms.clear();
  if (!user) return { roles: [] };
  const [me, rp] = await Promise.all([
    run(supabase.from("profiles").select("roles,display_name").eq("id", user.id).maybeSingle()),
    run(supabase.from("role_permissions").select("role,permission")),
  ]);
  const roles = me?.roles ?? [];
  rp.filter(r => roles.includes(r.role)).forEach(r => perms.add(r.permission));
  return { roles, profile: me };
}

// Charge uniquement ce que les droits de l'utilisateur permettent (sinon RLS renverrait du vide / une erreur 42501)
export async function loadAll() {
  const when = (ok, f) => (ok ? f() : Promise.resolve([]));
  const [cats, parts, stock, costs, orders, lines, profs, imgs] = await Promise.all([
    when(can("stock.read"), () => run(supabase.from("categories").select("*").order("sort_order").order("name"))),
    when(can("partners.read"), () => run(supabase.from("partners").select("*").eq("archived", false).order("name"))),
    when(can("stock.read"), () => rpc("stock_overview")),
    when(can("costs.read"), () => run(supabase.from("item_costs").select("*"))),
    when(can("history.read"), () => fetchAll(() => supabase.from("orders").select("*").order("created_at"))),
    when(can("history.read"), () => fetchAll(() => supabase.from("order_lines").select("*").order("id"))),
    when(can("stock.read", "history.read"), () => run(supabase.from("profiles").select("id,display_name"))),
    when(can("stock.read"), () => run(supabase.from("items").select("id,image_path"))),
  ]);
  const imgOf = Object.fromEntries(imgs.map(i => [i.id, i.image_path]));

  const catName = Object.fromEntries(cats.map(c => [c.id, c.name]));
  const cost = Object.fromEntries(costs.map(c => [c.item_id, c]));
  const partnerName = Object.fromEntries(parts.map(p => [p.id, p.name]));
  const who = Object.fromEntries(profs.map(p => [p.id, p.display_name]));

  const items = stock.filter(s => !s.archived).map(s => ({
    id: s.item_id, name: s.item_name, category: catName[s.category_id] || "—",
    stock: s.stock_reel, stockPrevu: s.stock_prevu,
    buy: num(s.buy_price) ?? 0, sale: num(s.sale_price) ?? 0,
    glyph: s.item_name.slice(0, 2).toUpperCase(), image: imgUrl(imgOf[s.item_id]),
    taxDeductible: !!cost[s.item_id]?.tax_deductible, taxRate: num(cost[s.item_id]?.deduction_rate) ?? 0,
  }));

  const byOrder = {};
  lines.forEach(l => (byOrder[l.order_id] ||= []).push({
    itemId: l.item_id, quantity: l.quantity, unitPrice: num(l.unit_price), deductionRate: num(l.deduction_rate) ?? 0,
  }));
  // Pas de numéro de bon en base : on le dérive de l'ordre de création (les bons ne sont jamais supprimés)
  const seq = { achat: 0, vente: 0 };
  const mapped = orders.map(o => ({
    id: o.id, ref: `${o.type === "achat" ? "A" : "V"}-${String(++seq[o.type]).padStart(3, "0")}`,
    type: o.type, status: o.status, partnerId: o.partner_id, partner: partnerName[o.partner_id] || "",
    date: o.confirmed_at || o.created_at, confirmedAt: o.confirmed_at,
    createdBy: who[o.created_by] || "Inconnu", lines: byOrder[o.id] || [], version: o.version,
  }));

  return {
    items, categoryRows: cats, categories: cats.map(c => c.name), orders: mapped.reverse(),
    partners: parts.map(p => ({ id: p.id, name: p.name, supplier: p.is_supplier, client: p.is_client, note: p.note || "", image: imgUrl(p.image_path) })),
  };
}

// --- Écritures : les bons passent exclusivement par les RPC (aucune policy d'écriture sur orders / order_lines)
export const saveOrder = o => rpc("save_order", {
  p_order: { id: o.id, type: o.type, partner_id: o.partnerId || null, date: o.date || null },
  p_lines: o.lines.map(l => ({ id: crypto.randomUUID(), item_id: l.itemId, quantity: l.quantity, unit_price: l.unitPrice })),
});
export const confirmSale = (id, version, deliveredAt = null) =>
  rpc("confirm_sale", { p_id: id, p_expected_version: version, p_delivered_at: deliveredAt });
export const cancelOrder = (id, version, reason = null) =>
  rpc("cancel_order", { p_id: id, p_reason: reason, p_expected_version: version });

// --- Catalogue / partenaires (policies catalog.manage / partners.manage)
export const createCategory = name => run(supabase.from("categories").insert({ name }));
export async function createPartner(p, file) {
  const image_path = file ? await uploadImage("partners", file) : null;
  try {
    await run(supabase.from("partners").insert({
      name: p.name, is_supplier: p.supplier, is_client: p.client, note: p.note || null, image_path }));
  } catch (e) { dropImage(image_path); throw e; }
}
export async function createItem(i, categoryId, file) {
  if (!categoryId) throw new Error("Catégorie introuvable");
  const id = crypto.randomUUID();
  const image_path = file ? await uploadImage("items", file) : null;
  try {
    await run(supabase.from("items").insert({ id, category_id: categoryId, name: i.name, last_sale_price: i.sale, image_path }));
  } catch (e) { dropImage(image_path); throw e; }
  await run(supabase.from("item_costs").insert({
    item_id: id, last_buy_price: i.buy, tax_deductible: i.taxDeductible, deduction_rate: i.taxDeductible ? i.taxRate : null }));
}

// --- Impôts (RPC existantes, pas encore branchées sur l'UI)
export const taxOverview = (from, to = null) => rpc("tax_overview", { p_from: from, p_to: to });
export const closeTaxWeek = d => rpc("close_tax_week", { p_week_start: d });
export const payTaxWeek = d => rpc("pay_tax_week", { p_week_start: d });
export const reopenTaxWeek = d => rpc("reopen_tax_week", { p_week_start: d });
