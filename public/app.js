/* =====================================================
   CocinaMágica — app.js
   ===================================================== */

/* ═══════════════════════════════════
   MEJORA 2 — TOAST NOTIFICATIONS
═══════════════════════════════════ */
const TOAST_ICONS = { success:'fa-circle-check', error:'fa-circle-xmark', warning:'fa-triangle-exclamation', info:'fa-circle-info' };
function showToast(msg, type = 'success', duration = 3200) {
    const container = document.getElementById('toastContainer'); if (!container) return;
    const el = document.createElement('div');
    el.className = `toast-notif toast-${type}`;
    el.innerHTML = `<i class="fa-solid ${TOAST_ICONS[type]||TOAST_ICONS.info} toast-icon"></i><span>${msg}</span><span class="toast-close" onclick="this.parentElement.remove()">✕</span>`;
    el.onclick = () => { el.classList.add('removing'); setTimeout(() => el.remove(), 280); };
    container.appendChild(el);
    setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 280); }, duration);
}

/* ═══════════════════════════════════
   ESTADO GLOBAL
═══════════════════════════════════ */
/* ─── ESTADO GLOBAL ─── */
let ingredientsDB = {}, recipesDB = [], pantry = {}, pantryExpiry = {};
let recipeRatings = {}, recipeNotes = {}, recipePhotos = {}, cookHistory = [];
let familyMembers = [], savedMenus = [], weeklyBudgets = {};
let currentViewMode = 'cards', currentWeeklyMenu = [], cart = [];
let dayTypes = { Lunes:'comida', Martes:'comida', Miércoles:'comida', Jueves:'comida', Viernes:'comida', Sábado:'all', Domingo:'all' };
let currentWeekBudget = 0;

/* ─── PAGINACIÓN ─── */
let recipePage = 1, recipePageSize = 10;
let pantryPage = 1, pantryPageSize = 10;
let ingCatalogPage = 1, ingCatalogPageSize = 10;
let _ingCatalogSearch = '';

const eventsDB = [
    { name:'Año Nuevo', date:'31 Dic', recipes:[5,13,8,14] },
    { name:'Semana Santa', date:'Abril', recipes:[4,8,14,18] },
    { name:'Día de la Madre', date:'Mayo', recipes:[2,12,13,23,22] },
    { name:'Día del Completo', date:'24 Mayo', recipes:[9] },
    { name:'We Tripantu', date:'21-24 Jun', recipes:[1,11] },
    { name:'Invierno Chileno', date:'Julio', recipes:[3,5,6,11,17] },
    { name:'Fiestas Patrias', date:'18 Sept', recipes:[7,11,12,13,16] },
    { name:'Navidad', date:'25 Dic', recipes:[15,21,22] }
];

const CATEGORY_LABELS = { verduras:'🥦 Verduras', frutas:'🍎 Frutas', carnes:'🥩 Carnes', pescados:'🐟 Pescados', lacteos:'🥛 Lácteos', abarrotes:'🥫 Abarrotes', panaderia:'🍞 Panadería', bebestibles:'🍷 Bebestibles', otros:'📦 Otros' };
const CATEGORY_ORDER = ['carnes','pescados','verduras','frutas','lacteos','panaderia','abarrotes','bebestibles','otros'];
const SEASON_LABELS = { verano:'☀️ Verano', invierno:'❄️ Invierno', otono:'🍂 Otoño', primavera:'🌸 Primavera', all:'🍽️ Todo el año' };

/* ─── TEMPORADA ACTUAL (hemisferio sur - Chile) ─── */
function currentSeason() {
    const m = new Date().getMonth() + 1;
    if (m >= 12 || m <= 2) return 'verano';
    if (m >= 3 && m <= 5) return 'otono';
    if (m >= 6 && m <= 8) return 'invierno';
    return 'primavera';
}

/* ─── CONVERSIONES Y CÁLCULOS ─── */
function convertToBaseUnit(ingId, qty, inputUnit) {
    const ing = ingredientsDB[ingId]; if (!ing) return qty;
    if (inputUnit === ing.baseUnit) return qty;
    if (inputUnit === 'kilos' && ing.baseUnit === 'g') return qty * 1000;
    if (inputUnit === 'litros' && ing.baseUnit === 'ml') return qty * 1000;
    if (inputUnit === 'gramos' && ing.baseUnit === 'g') return qty;
    if (ing.conversion && ing.conversion[inputUnit]) return qty * ing.conversion[inputUnit];
    return qty;
}

function getMultiplier(recipe, reqPortions) { return reqPortions / (recipe.basePortions || 1); }

function canCookRecipe(recipe, reqPortions = 1) {
    let missing = []; const mult = getMultiplier(recipe, reqPortions);
    recipe.ingredients.forEach(req => {
        const reqBase = convertToBaseUnit(req.id, req.qty * mult, req.unit);
        const have = pantry[req.id] || 0;
        if (have < reqBase) missing.push({ id: req.id, faltan: reqBase - have, unit: ingredientsDB[req.id]?.baseUnit || req.unit });
    });
    return missing;
}

function getRecipeCost(recipe, reqPortions = 1) {
    const mult = getMultiplier(recipe, reqPortions);
    return recipe.ingredients.reduce((acc, req) => {
        const ing = ingredientsDB[req.id]; if (!ing) return acc;
        return acc + convertToBaseUnit(req.id, req.qty * mult, req.unit) * ing.pricePerBase;
    }, 0);
}

function getRecipeNutrition(recipe, reqPortions = 1) {
    let t = { cals:0, p:0, c:0, f:0 }; const mult = getMultiplier(recipe, reqPortions);
    recipe.ingredients.forEach(req => {
        const ing = ingredientsDB[req.id]; if (!ing?.nutrition) return;
        const reqBase = convertToBaseUnit(req.id, req.qty * mult, req.unit);
        const m = (ing.baseUnit === 'g' || ing.baseUnit === 'ml') ? reqBase / 100 : reqBase;
        t.cals += ing.nutrition.cals * m; t.p += ing.nutrition.p * m;
        t.c += ing.nutrition.c * m; t.f += ing.nutrition.f * m;
    });
    return { cals: Math.round(t.cals), p: Math.round(t.p), c: Math.round(t.c), f: Math.round(t.f) };
}

function getCategoryImg(type, id = 0) {
    if (typeof getCategoryImgRich === 'function') return getCategoryImgRich(type, id);
    return 'https://images.unsplash.com/photo-1495195134817-a165d42e27e8?auto=format&fit=crop&w=600&q=80';
}

function getRecipeImg(r) {
    return recipePhotos[r.id] ? `/api/recipes/${r.id}/photo-data` : getCategoryImg(r.type);
}

function daysUntilExpiry(dateStr) {
    if (!dateStr) return null;
    const diff = Math.floor((new Date(dateStr) - new Date()) / 86400000);
    return diff;
}

function expiryClass(dateStr) {
    const d = daysUntilExpiry(dateStr);
    if (d === null) return '';
    if (d < 0) return 'expiry-expired';
    if (d <= 3) return 'expiry-soon';
    return 'expiry-ok';
}

function expiryLabel(dateStr) {
    const d = daysUntilExpiry(dateStr);
    if (d === null) return '';
    if (d < 0) return `Venció hace ${Math.abs(d)} día${Math.abs(d)!==1?'s':''}`;
    if (d === 0) return 'Vence HOY';
    if (d === 1) return 'Vence mañana';
    if (d <= 3) return `Vence en ${d} días`;
    return new Date(dateStr).toLocaleDateString('es-CL');
}

function cookedInLastDays(recipeId, days = 14) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    return cookHistory.some(h => h.recipe_id === recipeId && new Date(h.cooked_at) >= cutoff);
}

function getActiveFamilyAllergens() {
    const allergens = new Set();
    familyMembers.filter(m => m.is_active).forEach(m => (m.allergies || []).forEach(a => allergens.add(a)));
    return allergens;
}

function recipeHasAllergen(recipe) {
    const allergens = getActiveFamilyAllergens();
    if (allergens.size === 0) return false;
    return recipe.ingredients.some(req => allergens.has(req.id));
}

/* ─── FORMATOS ─── */
function formatQty(ing, qty) {
    if (!ing) return qty.toFixed(1);
    if ((ing.baseUnit === 'g' || ing.baseUnit === 'ml') && ing.conversion?.unidades) {
        const u = (qty / ing.conversion.unidades).toFixed(1);
        return `${u} unids. <small class="text-muted">(${qty.toFixed(0)}${ing.baseUnit})</small>`;
    }
    if (ing.baseUnit === 'g' && qty >= 1000) return `${(qty/1000).toFixed(2)} kg`;
    if (ing.baseUnit === 'ml' && qty >= 1000) return `${(qty/1000).toFixed(2)} L`;
    return `${qty.toFixed(1)} ${ing.baseUnit}`;
}

function formatMissing(ing, faltan) {
    if (!ing) return faltan.toFixed(1);
    if ((ing.baseUnit === 'g' || ing.baseUnit === 'ml') && ing.conversion?.unidades) {
        const u = (faltan / ing.conversion.unidades).toFixed(1);
        return `${u} unids (${faltan.toFixed(0)}${ing.baseUnit})`;
    }
    if (ing.baseUnit === 'g' && faltan >= 1000) return `${(faltan/1000).toFixed(2)} kg`;
    if (ing.baseUnit === 'ml' && faltan >= 1000) return `${(faltan/1000).toFixed(2)} L`;
    return `${faltan.toFixed(1)} ${ing.baseUnit}`;
}

function starsHTML(recipeId, interactive = false) {
    const r = recipeRatings[recipeId];
    const rating = r?.rating || 0;
    let html = `<div class="star-group d-inline-flex gap-1" ${interactive ? `data-recipe="${recipeId}"` : ''}>`;
    for (let i = 1; i <= 5; i++) {
        html += `<span class="star ${i <= rating ? 'filled' : ''}"
            ${interactive ? `onclick="setRating(${recipeId},${i})" title="Calificar con ${i} estrella${i>1?'s':''}"` : ''}
            style="font-size:1.3rem; cursor:${interactive?'pointer':'default'};">★</span>`;
    }
    html += '</div>';
    return html;
}

function weekStart() {
    const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1);
    return d.toISOString().split('T')[0];
}

/* ─── PAGINADOR ─── */
function buildPaginatorHTML(total, page, pageSize, pageFn, sizeFn) {
    const totalPages = pageSize === 0 ? 1 : Math.ceil(total / pageSize);
    const clampedPage = Math.max(1, Math.min(page, totalPages));
    const start = pageSize === 0 ? 1 : (clampedPage - 1) * pageSize + 1;
    const end = pageSize === 0 ? total : Math.min(clampedPage * pageSize, total);
    const info = total > 0 ? `${start}–${end} de ${total}` : '0 resultados';

    const szBtns = [10, 50, 0].map(s =>
        `<button class="btn btn-sm ${pageSize === s ? 'btn-primary' : 'btn-outline-secondary'}" onclick="${sizeFn}(${s})">${s === 0 ? 'Todas' : s}</button>`
    ).join('');

    const navBtns = totalPages > 1 ? `
        <button class="btn btn-sm btn-outline-secondary" onclick="${pageFn}(${clampedPage - 1})" ${clampedPage <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
        <span class="btn btn-sm btn-outline-secondary disabled pe-none">${clampedPage} / ${totalPages}</span>
        <button class="btn btn-sm btn-outline-secondary" onclick="${pageFn}(${clampedPage + 1})" ${clampedPage >= totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>
    ` : '';

    return `<div class="d-flex align-items-center justify-content-between flex-wrap gap-2 py-1">
        <small class="text-muted">${info}</small>
        <div class="d-flex gap-2 align-items-center flex-wrap">
            <div class="btn-group btn-group-sm">${szBtns}</div>
            ${navBtns ? `<div class="btn-group btn-group-sm">${navBtns}</div>` : ''}
        </div>
    </div>`;
}

function setPaginatorHTML(ids, html) {
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = html; });
}

/* ─── INIT SELECTS ─── */
function initSelects() {
    const sorted = Object.keys(ingredientsDB).sort((a,b) => ingredientsDB[a].name.localeCompare(ingredientsDB[b].name));
    const html = sorted.map(k => `<option value="${k}">${ingredientsDB[k].name}</option>`).join('');
    document.getElementById('ingSelect').innerHTML = html;
    document.querySelectorAll('.newRecIngSel').forEach(s => { const v = s.value; s.innerHTML = html; if (ingredientsDB[v]) s.value = v; });
}

/* ─── UPDATE UI ─── */
function updateUI() {
    renderPantry(); renderRecipes(); renderEvents(); renderIngCatalog();
    if (currentWeeklyMenu.length > 0) renderWeeklyMenu();
    renderFamilyTab(); renderHistoryTab();
    const active = familyMembers.filter(m => m.is_active);
    document.getElementById('familyBadge').textContent = active.length || '';
    document.getElementById('familyBadge').style.display = active.length ? 'inline' : 'none';
    document.getElementById('dashIngCount').innerText = Object.keys(pantry).length;
    let totalC = 0, readyC = 0;
    for (const [id, qty] of Object.entries(pantry)) { const ing = ingredientsDB[id]; if (ing) totalC += qty * ing.pricePerBase; }
    document.getElementById('dashTotalValue').innerText = '$' + Math.round(totalC).toLocaleString('es-CL');
    recipesDB.forEach(r => { if (canCookRecipe(r, r.basePortions).length === 0) readyC++; });
    document.getElementById('dashReadyCount').innerText = readyC;
    checkExpiryAlerts();
    checkTodayReminder();
    updateDailyNutritionWidget();
}

/* ─── DESPENSA ─── */
function checkExpiryAlerts() {
    const expiring = Object.entries(pantryExpiry)
        .filter(([id, d]) => { const days = daysUntilExpiry(d); return days !== null && days <= 3; })
        .map(([id, d]) => ({ id, date: d, days: daysUntilExpiry(d), name: ingredientsDB[id]?.name || id }));

    const bar = document.getElementById('expiryAlertBar');
    if (expiring.length === 0) { bar.classList.add('d-none'); return; }
    bar.classList.remove('d-none');
    bar.innerHTML = `<div class="d-flex align-items-center gap-2 flex-wrap">
        <i class="fa-solid fa-triangle-exclamation text-warning fs-5"></i>
        <strong>Próximos a vencer:</strong>
        ${expiring.map(e => `<span class="badge ${e.days < 0 ? 'bg-danger' : 'bg-warning text-dark'}">${e.name} — ${expiryLabel(e.date)}</span>`).join('')}
    </div>`;
}

function renderPantry(searchTerm = '') {
    const tbody = document.getElementById('pantryTableBody'); tbody.innerHTML = '';
    const q = searchTerm.toLowerCase().trim();

    const allEntries = Object.entries(pantry).filter(([id]) => {
        const ing = ingredientsDB[id]; if (!ing) return false;
        return !q || ing.name.toLowerCase().includes(q);
    }).sort(([a], [b]) => (ingredientsDB[a]?.name || '').localeCompare(ingredientsDB[b]?.name || ''));

    let grandTotal = 0;
    allEntries.forEach(([id, qty]) => { grandTotal += qty * (ingredientsDB[id]?.pricePerBase || 0); });

    const total = allEntries.length;
    const ps = pantryPageSize;
    const pg = Math.max(1, Math.min(pantryPage, ps === 0 ? 1 : Math.ceil(total / ps)));
    pantryPage = pg;
    const start = ps === 0 ? 0 : (pg - 1) * ps;
    const end = ps === 0 ? total : start + ps;
    const pageEntries = allEntries.slice(start, end);

    pageEntries.forEach(([id, qty]) => {
        const ing = ingredientsDB[id]; if (!ing) return;
        const cost = qty * ing.pricePerBase;
        const expDate = pantryExpiry[id];
        const expCls = expiryClass(expDate);
        const expLbl = expDate ? `<small class="${expCls} d-block">${expiryLabel(expDate)}</small>` : '';
        tbody.innerHTML += `<tr>
            <td class="fw-bold">${ing.name}${expLbl}</td>
            <td><span class="badge bg-secondary border fs-6">${formatQty(ing, qty)}</span></td>
            <td>$${Math.round(cost)}</td>
            <td class="text-end text-nowrap">
                <button class="btn btn-sm btn-outline-primary py-1 px-2 rounded-circle me-1" onclick="editPantryItem('${id}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-sm btn-outline-danger py-1 px-2 rounded-circle" onclick="deleteFromPantry('${id}')" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    });

    document.getElementById('totalCostBadge').innerText = `Total: $${Math.round(grandTotal).toLocaleString('es-CL')}`;
    const pagEl = document.getElementById('pantryPaginator');
    if (pagEl) pagEl.innerHTML = total > 0 ? buildPaginatorHTML(total, pg, ps, 'setPantryPage', 'setPantryPageSize') : '';
}

function setPantryPage(p) { pantryPage = p; renderPantry(document.getElementById('pantrySearch')?.value || ''); }
function setPantryPageSize(s) { pantryPageSize = s; pantryPage = 1; renderPantry(document.getElementById('pantrySearch')?.value || ''); }
function filterPantryTable(q) { pantryPage = 1; renderPantry(q); }

/* ─── CATÁLOGO DE INGREDIENTES ─── */
function formatIngPrice(ing) {
    if (!ing || ing.pricePerBase == null) return '—';
    const p = ing.pricePerBase;
    if (ing.baseUnit === 'unidades') return `$${Math.round(p).toLocaleString('es-CL')}/ud.`;
    if (ing.baseUnit === 'ml') return `$${Math.round(p * 1000).toLocaleString('es-CL')}/L`;
    return `$${Math.round(p * 1000).toLocaleString('es-CL')}/kg`;
}

function renderIngCatalog(searchTerm) {
    if (searchTerm !== undefined) _ingCatalogSearch = searchTerm;
    const tbody = document.getElementById('ingCatalogBody'); if (!tbody) return;
    const q = (_ingCatalogSearch || '').toLowerCase().trim();

    const allIngs = Object.entries(ingredientsDB)
        .filter(([, ing]) => !q || ing.name.toLowerCase().includes(q))
        .sort(([, a], [, b]) => a.name.localeCompare(b.name));

    const total = allIngs.length;
    const ps = ingCatalogPageSize;
    const totalPages = ps === 0 ? 1 : Math.ceil(total / ps);
    const pg = Math.max(1, Math.min(ingCatalogPage, totalPages));
    ingCatalogPage = pg;
    const start = ps === 0 ? 0 : (pg - 1) * ps;
    const end = ps === 0 ? total : start + ps;
    const pageIngs = allIngs.slice(start, end);

    tbody.innerHTML = pageIngs.map(([id, ing]) => {
        const catLabel = CATEGORY_LABELS[ing.category] || ing.category || '—';
        const inPantry = pantry[id] > 0;
        const rowCls = inPantry ? 'table-success' : '';
        return `<tr class="${rowCls}">
            <td class="fw-semibold small">${ing.name}${inPantry ? ' <i class="fa-solid fa-check-circle text-success" style="font-size:.7rem"></i>' : ''}</td>
            <td><span class="badge bg-light text-dark border" style="font-size:.65rem">${catLabel}</span></td>
            <td class="text-muted" style="font-size:.75rem">${ing.baseUnit}</td>
            <td class="fw-semibold" style="font-size:.8rem;color:var(--success)">${formatIngPrice(ing)}</td>
            <td style="font-size:.75rem">${ing.nutrition?.cals ?? '—'} kcal</td>
            <td class="text-end">
                <button class="btn btn-outline-success rounded-pill px-2 py-0" style="font-size:.72rem" onclick="quickAddToPantry('${id}')">
                    <i class="fa-solid fa-plus"></i> Agregar
                </button>
            </td>
        </tr>`;
    }).join('');

    const pagEl = document.getElementById('ingCatalogPaginator');
    if (pagEl) pagEl.innerHTML = total > 0 ? buildPaginatorHTML(total, pg, ps, 'setIngCatalogPage', 'setIngCatalogPageSize') : '';
}

/* Precios promedio mercado chileno 2025-2026 (CLP por unidad base: por g, por ml o por unidad) */
const MARKET_PRICES_CLP = {
    /* CARNES (CLP/g) */
    pollo:3.2,pollo_pechuga:4.2,pollo_muslo:3.5,pavo:5.5,pechuga_pavo:6.0,
    muslo_pavo:5.0,carne_vacuno:8.5,carne_molida:6.0,filete_vacuno:18.0,
    lomo_liso:12.0,lomo_vetado:15.0,asado_tira:8.0,costilla_cerdo:5.5,
    carne_cerdo:6.5,pulpa_cerdo:7.0,cordero:11.0,pierna_cordero:10.5,
    longaniza:5.5,vienesa:5.0,jamón:7.5,tocino:6.0,salchichón:6.5,
    osobuco:6.5,plateada:9.0,churrasco:11.0,pato:11.0,
    abastero:9.5,aguja_vacuno:7.5,asado_paleta:9.5,asado_tapa:9.0,
    bistec_vacuno:12.0,cazuela_vacuno:8.5,cerdo_molido:6.5,chuleta_cerdo:7.0,
    chuleta_vacuno:9.5,cogote_vacuno:8.0,colita_cuadril:10.0,corazon_vacuno:5.5,
    entraña:14.0,higado_pollo:4.5,higado_vacuno:5.5,huachalomo:8.5,
    hueso_vacuno:2.5,mechada_vacuno:8.5,mollejas:9.0,nalga_vacuno:9.5,
    osobuco_cerdo:7.0,palanca:10.0,panceta:7.0,patitas_cerdo:4.0,
    pernil_cerdo:6.0,posta_negra:9.0,posta_rosada:9.5,punta_paleta:8.5,
    rabo_vacuno:5.5,riñon_vacuno:4.5,salchicha_vacuno:7.5,ternera:13.0,
    vacuno_estofado:8.0,cecinas:8.5,carne_conejo:10.0,
    /* PESCADOS Y MARISCOS (CLP/g) */
    salmon:13.0,trucha:10.0,congrio:10.0,reineta:6.0,lenguado:9.0,
    albacora:10.0,corvina:9.5,merluza:7.0,jurel_tarro:3.5,atun_tarro:6.5,
    camarones:14.0,jaiba:8.0,centolla:30.0,machas:10.0,ostiones:22.0,
    locos:25.0,pulpo:12.0,mariscos_surtidos:12.0,cochayuyo:4.0,
    anchoveta:3.5,bacalao_seco:14.0,calamares:8.0,cangrejo:18.0,
    cojinoba:8.0,erizo_mar:25.0,gambas:18.0,jurel_fresco:4.5,langostinos:14.0,
    lapas:9.0,lisa:4.5,mejillones:6.0,navajas:14.0,ostra:25.0,
    pejegallo:6.0,pejerrey:5.5,piure:7.0,robalo:9.0,salmon_ahumado:18.0,
    sardina_fresca:4.5,sardinas_aceite:6.0,sierra:7.0,tilapia:7.5,
    vieiras:20.0,choro:4.5,calamar_tubo:9.0,camarón_pelado:12.0,langosta:30.0,
    atun_agua:6.5,atun_aceite:7.0,salmon_congelado:12.0,macha_fresca:9.0,
    navajuela:10.0,cochayuyo_seco:9.0,filete_rebozado:8.0,calamar_anillos:10.0,
    albacora_lata:9.0,jibia:5.5,peces_caldo:2.5,
    /* LÁCTEOS (CLP/g o CLP/ml) */
    leche:0.95,leche_coco:3.5,leche_condensada:8.0,leche_evaporada:5.5,
    mantequilla:11.0,queso_fresco:9.0,queso_mantecoso:10.0,queso_parmesano:20.0,
    crema_leche:7.0,crema_acida:6.0,crema_queso:10.0,ricotta:7.5,yogurt:1.8,
    buttermilk:1.0,cheddar:16.0,crema_chantilly:5.5,gouda:14.0,kefir:2.5,
    leche_almendra:3.0,leche_avena:2.5,leche_descremada:0.75,leche_entera_larga:0.95,
    leche_polvo:20.0,leche_soya:2.0,mantequilla_sin_sal:11.0,mozzarella:14.0,
    queso_azul:20.0,queso_brie:22.0,queso_cabra:25.0,queso_chanco:12.0,
    queso_cottage:9.0,queso_crema_light:10.0,queso_de_campo:11.0,queso_edam:13.0,
    queso_gruyere:25.0,queso_laminado:11.0,queso_rallado:13.0,queso_tilsit:12.0,
    yogurt_griego:4.5,yogurt_light:3.5,yogurt_natural:3.5,
    /* VERDURAS (CLP/g) */
    tomate:1.8,cebolla:0.9,papa:1.0,zanahoria:0.9,lechuga:1.5,palta:4.0,
    brocoli:2.5,espinaca:1.8,champiñon:4.5,zapallo:0.9,zapallo_italiano:1.5,
    pepino:1.2,pimenton:2.5,pimenton_verde:2.0,ajo:4.5,apio:1.5,
    betarraga:1.2,choclo:1.8,col_bruselas:1.8,coliflor:1.5,berenjena:1.5,
    esparragos:5.0,poroto_verde:1.8,repollo:0.9,rucula:5.5,cebolla_morada:1.2,
    cebolla_verde:1.2,puerro:2.5,camote:2.2,arvejas:1.8,garbanzos:3.0,
    lentejas:2.5,lenteja_roja:3.0,porotos:2.2,poroto_negro:2.5,poroto_granado:2.8,
    quinoa:6.0,mote:2.0,alcachofa:3.5,callampas:6.0,maiz_choclo:1.8,
    acelga:1.0,acelga_blanca:1.0,alcachofas_conserva:9.0,arveja_seca:2.0,
    berros:1.8,bok_choy:1.5,brocoli_romanesco:3.0,brote_alfalfa:4.5,
    brote_soya:3.0,cardo:2.0,cebollino:3.5,chaucha:1.5,choclo_lata:4.0,
    col_rizada:2.5,colinabo:1.5,daikon:1.2,endivia:3.0,escarola:2.5,
    flor_calabaza:6.0,garbanzo_cocido:4.0,habas:1.8,hinojo:2.5,
    jengibre_fresco:4.5,kale:4.0,lechugas_mix:4.5,lenteja_verde:2.5,
    maiz_morado:3.5,nabo:1.0,pak_choi:1.8,palmito_lata:9.5,papa_camote_morado:2.0,
    papa_nativa:1.8,perejil_crespo:3.0,pimenton_amarillo:3.0,pimenton_morrón:3.5,
    porotos_alubia:2.5,porotos_canario:3.0,porotos_pinto:2.5,poroto_lata:4.5,
    rabano:1.2,repollo_morado:1.2,seta_portobello:4.5,seta_shiitake:12.0,
    soja_verde:3.5,tomate_cherry:4.0,tomate_deshidratado:14.0,tomate_lata:3.5,
    tomate_pera:2.5,verdolaga:2.5,yuca:1.8,champiñones_lata:6.0,
    garbanzos_lata:5.0,lentejas_lata:5.0,maiz_dulce_lata:4.0,esparragos_lata:10.0,
    cebada_perla:2.0,arvejas_lata:4.0,seta_ostra:9.0,puerro_baby:4.0,
    micro_vegetales:22.0,cogollo_lechuga:4.0,rúcula_baby:6.0,
    alcachofa_conserva2:8.0,chayote:1.5,remolacha_amarilla:3.0,brote_girasol:7.0,
    lenteja_beluga:4.0,jicama:3.0,edamame_congelado:4.5,
    /* FRUTAS (CLP/g) */
    manzana:2.2,naranja:1.8,platano:1.8,limon:2.2,pera:2.8,frutillas:4.0,
    uvas:3.5,piña:2.5,kiwi:4.0,sandia:0.9,melon:1.8,durazno:2.5,
    frambuesa:6.0,arandanos:7.0,membrillo:2.0,lucuma:5.0,datil:12.0,
    huesillo:3.0,guinda:5.0,pomelo:2.0,chirimoya:4.0,
    arándano_rojo:9.0,babaco:3.5,caqui:3.5,cerezas:7.0,ciruela:3.0,
    ciruela_seca:8.0,coco_fresco:4.0,damasco:3.0,feijoa:3.5,frambuesa_negra:5.5,
    fruta_confitada:7.0,granada:4.0,grosellas:8.0,guayaba:3.0,higo:5.0,
    kiwi_amarillo:5.0,lichee:6.0,lima:2.5,limon_pica:3.0,mango:3.5,
    maracuya:4.5,melon_calameño:2.2,mora:4.5,murta:9.0,nectarina:3.0,
    papaya:3.0,pera_packham:2.5,pera_williams:2.5,platano_verde:1.8,
    pomelo_rosado:2.5,tamarindo:6.0,tuna:2.0,uva_blanca:3.0,uva_moscatel:3.5,
    uva_negra:3.0,uva_pasa_rubia:6.0,zarzamora:4.5,manzana_fuji:2.5,
    manzana_granny:2.5,manzana_royal:3.0,durazno_conserva:5.5,
    frutilla_congelada:4.0,guinda_acida:5.5,limon_eureka:2.0,arandano_seco:14.0,
    coco_agua:1.5,jugo_naranja_lata:1.8,aceituna_negra:6.0,aceituna_verde:6.0,
    /* ABARROTES (CLP/g o CLP/ml) */
    arroz:1.5,arroz_integral:1.8,harina:0.9,harina_integral:1.2,azucar:1.1,
    azucar_flor:1.3,aceite:2.5,aceite_canola:2.5,aceite_oliva:6.5,
    sal:0.6,vinagre:2.5,salsa_soya:5.0,salsa_tomate:3.5,pure_tomate:4.0,
    ketchup:4.5,mayonesa:4.5,mostaza:3.0,manjar:6.0,miel:9.0,mermelada:5.5,
    vainilla:15.0,levadura:12.0,polvo_hornear:8.0,bicarbonato:3.5,
    maicena:3.0,semola:2.5,caldo_cubo:14.0,fideos:1.8,fideos_espirales:1.8,
    fideos_tallarines:1.8,pasta_lasana:2.0,avena:1.5,nuez:12.0,pasas:6.0,
    coco_rallado:8.0,chocolate:12.0,cacao:12.0,pan_rallado:4.0,
    masa_hojaldre:6.0,tortilla_trigo:3.0,aceitunas:5.5,salsa_inglesa:6.0,
    curry_polvo:13.0,chancaca:5.0,almendra:14.0,
    aceite_girasol:2.2,aceite_maravilla:2.0,aceite_palta:9.0,aceite_sesamo:12.0,
    arroz_arborio:4.0,arroz_basmati:3.0,arroz_grano_largo:1.8,arroz_parboil:2.0,
    avena_fina:1.4,avena_gruesa:1.5,bulgur:2.5,chia:9.0,fideos_arroz:3.0,
    fideos_cabello:1.8,fideos_penne:1.8,fideos_rigatoni:1.8,fideos_spaghetti:1.8,
    fideos_farfalle:2.0,fideos_lasagna:2.0,linaza:5.0,milho:2.0,noodles_ramen:3.5,
    orzo:2.2,polenta:2.0,quinoa_negra:6.0,quinoa_roja:6.0,salvado_avena:3.5,
    salvado_trigo:3.0,sesamo:7.0,tapioca:3.5,trigo_sarraceno:5.0,miso:8.0,
    amaranto:6.0,espelta:4.0,harina_arroz:3.0,harina_garbanzo:3.5,
    harina_sin_gluten:6.0,harina_maiz_nixtamal:3.0,harina_almendra:18.0,
    lenteja_pardina:2.5,poroto_pinto:2.5,frijol_canario:3.0,chuño:5.0,
    porotos_negros_lata:5.0,porotos_blancos_lata:5.0,avena_instantanea:1.8,
    granola:4.5,muesli:4.0,cereal_corn_flakes:4.5,cereal_bran:5.0,
    cereal_arroz_inflado:5.5,tortilla_maiz:3.5,wonton_masa:6.0,pasta_lasana_verde:2.5,
    aceite_trufa:35.0,aliño_completo:9.0,chimichurri:10.0,harissa:12.0,
    hummus:7.0,mostaza_dijon:7.0,mostaza_americana:4.5,pesto_albahaca:14.0,
    salsa_barbacoa:6.0,salsa_cesar:9.0,salsa_cocktail_mar:6.0,salsa_ostras:8.0,
    salsa_picante:7.0,salsa_ranch:9.0,tahini:10.0,vinagre_arroz:4.0,
    vinagre_manzana:3.0,vinagre_vino_tinto:3.5,wasabi_pasta:14.0,
    tamarindo_pasta:9.0,mostaza_grano:6.0,alioli:9.0,salsa_soya_reducida:6.0,
    salsa_teriyaki:7.0,salsa_hoisin:8.0,crema_avellana:9.0,mermelada_frutilla:6.0,
    mermelada_naranja:6.0,mermelada_durazno:6.0,mermelada_berries:7.0,
    jarabe_arce:14.0,pure_tomate2:3.5,extracto_tomate:7.0,pure_palta:9.0,
    leche_condensada_sin:7.0,gelatina_sin_sabor:35.0,levadura_seca:18.0,
    bicarbonato_sodio:3.5,crema_tartaro:22.0,colorante_rojo:18.0,colorante_amarillo:18.0,
    esencia_vainilla:12.0,extracto_vainilla_puro:22.0,almendra_tostada:17.0,
    nuez_pecana:20.0,pistachos:22.0,macadamia:25.0,nuez_brasil:18.0,mani:4.5,
    mani_tostado:5.5,mantequilla_mani:9.0,mantequilla_almendra:17.0,
    pepita_zapallo:9.0,nuez_pino:28.0,almendras:14.0,
    azucar_morena:1.8,azucar_glass:1.8,panela:3.5,stevia:45.0,glucosa_liquida:6.0,
    cacao_polvo:12.0,chocolate_amargo:14.0,chocolate_blanco:12.0,
    chocolate_chips:12.0,chocolate_fondant:17.0,merengue_polvo:14.0,
    gelatina_sabor:9.0,pudin_mix:7.0,mezcla_torta:6.0,mezcla_muffin:6.5,
    fondant_pasta:9.0,mazapan:12.0,jengibre_cristalizado:14.0,
    fruta_confitada_mix:8.0,chantilly_polvo:7.0,cafe_soluble:22.0,cafe_molido:18.0,
    te_negro:18.0,te_verde:20.0,te_herbal:18.0,manzanilla:18.0,
    hierba_luisa:14.0,yerba_mate:9.0,galleta_maria:6.0,galleta_wafer:6.0,
    crackers:6.5,barra_cereal:7.0,chips_papas:9.0,popcorn:3.5,maicena_azul:3.0,
    arruruz:6.0,proteina_soya:5.0,proteina_whey:28.0,leche_malteada:8.0,
    extracto_malta:6.0,caldo_pescado_cubo:18.0,caldo_verdura_cubo:14.0,
    sopa_sobre:7.0,maizena_lista:3.5,salsa_soya_dulce:7.0,merken_seco:20.0,
    aji_cacho_cabra:18.0,pimienta_negra_molida:22.0,sal_gruesa:0.6,sal_ahumada:9.0,
    aceituna_negra:6.0,aceituna_verde:6.0,alfajor:700,
    pan_hamburguesa:200,hot_dog_pan:200,
    /* ESPECIAS (CLP/g) */
    aji_color:12.0,oregano:12.0,comino:14.0,canela:20.0,pimienta:22.0,
    laurel:16.0,merkén:20.0,jengibre:5.0,cilantro:2.5,albahaca:3.0,
    perejil:2.5,eneldo:20.0,romero:13.0,tomillo:13.0,menta:3.0,curry_polvo:14.0,
    anís_estrellado:22.0,azafran:220.0,cardamomo:28.0,cayena:20.0,
    clavo_especia:22.0,comino_semilla:14.0,coriandro_molido:14.0,curcuma:17.0,
    eneldo_seco:20.0,estragón:22.0,fenogreco:12.0,galangal:22.0,
    hinojo_semilla:14.0,laurel_seco:17.0,lemongrass:9.0,mejorana_seca:20.0,
    mostaza_semilla:9.0,nuez_moscada_molida:28.0,oregano_seco:12.0,
    paprika_ahumada:17.0,paprika_dulce:14.0,perejil_seco:17.0,pimienta_blanca:22.0,
    pimienta_roja:22.0,romero_seco:14.0,sumac:20.0,tomillo_seco:14.0,
    zaatar:17.0,ajo_en_polvo:14.0,cebolla_polvo:14.0,aji_seco:16.0,
    canela_rama:20.0,albahaca_seca:17.0,cilantro_seco:14.0,pimienta_mixta:22.0,
    flor_sal:17.0,sal_de_mar:2.5,curry_amarillo:14.0,curry_rojo:14.0,lemon_pepper:16.0,
    /* PANADERÍA */
    pan_marraqueta:3.5,pan_integral:4.0,pan_molde:3.5,hallulla:3.0,
    pan_completo:4.0,marraqueta_integral:4.0,masa_hojaldre:6.5,
    baguette:4.0,brioche:6.0,ciabatta:4.5,croissant:6.0,factura:5.0,
    hallulla_integral:4.0,marraqueta:3.0,pan_de_campo:3.5,
    pan_frances:4.0,pan_lactal:4.0,pan_miga:4.5,pan_negro:4.5,pan_pita:4.0,
    pan_sin_gluten:8.0,pretzel:6.0,sopaipilla_lista:4.5,tostadas_pan:6.0,
    masa_pizza_lista:4.5,pan_artesanal:6.0,pan_chapata:4.0,
    /* BEBESTIBLES (CLP/ml) */
    agua_mineral:0.6,jugo_naranja:1.2,cafe:18.0,te:17.0,cerveza:1.5,
    vino_tinto:5.5,vino_blanco:5.0,pisco:9.0,ron:8.0,vodka:8.0,aguardiente:7.0,
    agua_gasificada:0.5,agua_saborizada:1.0,agua_tonica:1.0,bebida_energetica:3.5,
    bebida_cola:0.8,bebida_naranja:0.8,bebida_zero:0.8,cafe_capuchino_inst:20.0,
    cafe_frio:3.0,cerveza_artesanal:3.0,cerveza_sin_alcohol:1.5,chicha_uva:2.5,
    chicha_manzana:2.0,cola_de_mono:6.0,espumante:6.0,gin:9.0,
    jugo_durazno:1.2,jugo_limon_listo:2.5,jugo_maracuya:1.5,jugo_manzana:1.2,
    jugo_pera:1.2,jugo_pina:1.2,jugo_tomate_listo:1.5,jugo_uva:1.8,
    kombucha:3.5,limonada_lista:1.8,pisco_sour_mix:5.0,refresco_limon:1.0,
    ron_añejo:10.0,sake:8.0,sidra:3.5,tequila:12.0,vino_rose:4.5,
    vino_espumante:7.0,whisky:14.0,zumo_frutas_mix:1.8,nescafe_cappuccino:2.5,
    bebida_isotonica:1.8,coco_agua:1.8,
};

async function updateMarketPrices() {
    const btn = document.getElementById('updatePricesBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Actualizando…'; }
    try {
        const entries = Object.entries(MARKET_PRICES_CLP).filter(([id]) => ingredientsDB[id]);
        let updated = 0;
        for (const [id, price] of entries) {
            const res = await fetch(`/api/ingredients/${id}/price`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ price_per_base: price })
            });
            if (res.ok) {
                ingredientsDB[id].pricePerBase = price;
                updated++;
            }
        }
        renderIngCatalog();
        renderRecipes();
        renderPantry(document.getElementById('pantrySearch')?.value || '');
        showToast(`✓ ${updated} ingredientes actualizados con precios de mercado 2025`, 'success', 4000);
    } catch (e) {
        showToast('Error al actualizar precios: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Actualizar Precios'; }
    }
}

function setIngCatalogPage(p) { ingCatalogPage = p; renderIngCatalog(); }
function setIngCatalogPageSize(s) { ingCatalogPageSize = s; ingCatalogPage = 1; renderIngCatalog(); }
function filterIngCatalog(q) { ingCatalogPage = 1; renderIngCatalog(q); }

function quickAddToPantry(ingId) {
    const ing = ingredientsDB[ingId]; if (!ing) return;

    // Build unit options based on ingredient type
    const unitOpts = ing.baseUnit === 'ml'
        ? ['ml','litros']
        : ing.baseUnit === 'unidades'
        ? ['unidades']
        : ['gramos','kilos'];

    document.getElementById('qaModalTitle').textContent = `Agregar: ${ing.name}`;
    document.getElementById('qaIngId').value = ingId;
    const unitSel = document.getElementById('qaUnit');
    unitSel.innerHTML = unitOpts.map(u => `<option value="${u}">${u}</option>`).join('');
    document.getElementById('qaQty').value = '';
    document.getElementById('qaExpiry').value = '';

    const modal = new bootstrap.Modal(document.getElementById('quickAddModal'));
    modal.show();
    setTimeout(() => document.getElementById('qaQty').focus(), 400);
}

async function confirmQuickAdd() {
    const ingId = document.getElementById('qaIngId').value;
    const qty = parseFloat(document.getElementById('qaQty').value);
    const unit = document.getElementById('qaUnit').value;
    const expiry = document.getElementById('qaExpiry').value || null;
    if (!ingId || isNaN(qty) || qty <= 0) { showToast('Indica una cantidad válida', 'warning'); return; }
    await addIngredientToPantry(ingId, qty, unit, expiry);
    bootstrap.Modal.getInstance(document.getElementById('quickAddModal'))?.hide();
    updateUI();
    showToast(`${ingredientsDB[ingId]?.name} agregado a la despensa`, 'success');
}

async function addIngredientToPantry(ingId, qty, unit, expiryDate) {
    const baseQty = convertToBaseUnit(ingId, parseFloat(qty), unit);
    await fetch('/api/pantry', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ingredientId: ingId, quantity: baseQty, expiry_date: expiryDate || null }) });
    pantry[ingId] = (pantry[ingId] || 0) + baseQty;
    if (expiryDate) pantryExpiry[ingId] = expiryDate;
}

async function editPantryItem(id) {
    const ing = ingredientsDB[id]; if (!ing) return;
    let factor = 1, unitLabel = ing.baseUnit;
    if (ing.conversion?.unidades) { factor = ing.conversion.unidades; unitLabel = 'unidades'; }
    else if (ing.baseUnit === 'g' && pantry[id] >= 1000) { factor = 1000; unitLabel = 'kilos'; }
    else if (ing.baseUnit === 'ml' && pantry[id] >= 1000) { factor = 1000; unitLabel = 'litros'; }
    const cur = +(pantry[id] / factor).toFixed(2);
    const newVal = prompt(`Modificar cantidad de ${ing.name} (en ${unitLabel}):`, cur);
    if (newVal !== null && newVal.trim() !== '' && !isNaN(newVal) && parseFloat(newVal) >= 0) {
        const newBase = parseFloat(newVal) * factor;
        await fetch(`/api/pantry/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ quantity: newBase }) });
        pantry[id] = newBase; updateUI();
    }
}

async function deleteFromPantry(id) {
    await fetch(`/api/pantry/${id}`, { method:'DELETE' });
    delete pantry[id]; delete pantryExpiry[id]; updateUI();
}

document.getElementById('addIngredientForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    await addIngredientToPantry(
        document.getElementById('ingSelect').value,
        document.getElementById('ingQty').value,
        document.getElementById('ingUnit').value,
        document.getElementById('ingExpiry').value || null
    );
    updateUI(); this.reset();
});

/* ─── RECETAS ─── */
function renderRecipes() {
    renderRecipesFiltered(null);
}

function renderRecipesFiltered(extraFilter) {
    const gR = document.getElementById('recipesReadyGrid'), gM = document.getElementById('recipesMissingGrid');
    gR.innerHTML = ''; gM.innerHTML = '';
    const filters = {
        t: document.getElementById('filterType').value,
        d: document.getElementById('filterDiet').value,
        c: document.getElementById('filterCalories').value,
        p: parseInt(document.getElementById('filterPersons').value) || 1,
        time: document.getElementById('filterTime').value,
        season: document.getElementById('filterSeason').value,
        q: (document.getElementById('filterSearch')?.value || '').toLowerCase().trim()
    };

    const _baseAllergens = getActiveFamilyAllergens();
    const _sessionAllergens = (typeof getSessionAllergens === 'function') ? getSessionAllergens() : [];
    const allergens = new Set([..._baseAllergens, ..._sessionAllergens]);

    const allFiltered = recipesDB.filter(r => {
        const nut = getRecipeNutrition(r, filters.p);
        if (filters.t !== 'all' && r.type !== filters.t) return false;
        if (filters.d !== 'all' && !r.diets.includes(filters.d)) return false;
        if (filters.c === 'low' && nut.cals >= 400) return false;
        if (filters.c === 'med' && (nut.cals < 400 || nut.cals > 800)) return false;
        if (filters.c === 'high' && nut.cals <= 800) return false;
        if (filters.time !== 'all') {
            const t = parseInt(filters.time);
            if (filters.time === '90') { if (r.cookTime < 90) return false; }
            else { if (r.cookTime > t) return false; }
        }
        if (filters.season !== 'all' && r.season !== 'all' && r.season !== filters.season) return false;
        if (filters.q && !r.name.toLowerCase().includes(filters.q)) return false;
        if (extraFilter && !extraFilter(r)) return false;
        return true;
    });

    const total = allFiltered.length;
    const ps = recipePageSize;
    const totalPages = ps === 0 ? 1 : Math.ceil(total / ps);
    const pg = Math.max(1, Math.min(recipePage, totalPages));
    recipePage = pg;
    const start = ps === 0 ? 0 : (pg - 1) * ps;
    const end = ps === 0 ? total : start + ps;
    const pageSlice = allFiltered.slice(start, end);

    const totalReady = allFiltered.filter(r => canCookRecipe(r, filters.p).length === 0).length;
    const totalMissing = total - totalReady;

    let _readyIdx = 0, _missIdx = 0;
    pageSlice.forEach(r => {
        const missing = canCookRecipe(r, filters.p);
        const isMissing = missing.length > 0;
        const animDelay = `animation-delay:${Math.min((isMissing ? _missIdx++ : _readyIdx++) * 50, 300)}ms`;
        const cost = getRecipeCost(r, filters.p);
        const nut = getRecipeNutrition(r, filters.p);
        const ratingData = recipeRatings[r.id];
        const hasNote = !!recipeNotes[r.id];
        const hasPhoto = !!recipePhotos[r.id];
        const hasAllergen = allergens.size > 0 && r.ingredients.some(req => allergens.has(req.id));
        const wasCooked = cookedInLastDays(r.id, 14);
        const dietColors = { vegetariano:'#16a34a', vegano:'#15803d', 'sin gluten':'#0891b2', saludable:'#7c3aed', diabetico:'#b45309' };
        const badges = r.diets.map(d => `<span class="badge me-1" style="background:${dietColors[d]||'#6b7280'};font-size:.65rem">${d.toUpperCase()}</span>`).join('');
        const typeChip = `<span class="type-chip chip-${r.type}">${r.type}</span>`;
        const imgUrl = getRecipePhotoUrl(r.name, r.type, r.id);
        const statusBadge = isMissing
            ? `<span class="badge w-100 py-2 text-dark" style="background:var(--warning)"><i class="fa-solid fa-triangle-exclamation"></i> Faltan ${missing.length} item${missing.length!==1?'s':''}</span>`
            : `<span class="badge w-100 py-2" style="background:var(--success)"><i class="fa-solid fa-check-double"></i> Tienes Todo</span>`;
        const grayClass = isMissing ? 'grayscale-item' : '';
        const inCart = cart.some(c => c.recipeId === r.id);
        const ratingBadge = ratingData ? renderStarsSmall(ratingData.rating) : '';
        const noteBadge = hasNote ? `<i class="fa-solid fa-note-sticky text-warning" title="Tienes notas"></i>` : '';
        const photoBadge = hasPhoto ? `<i class="fa-solid fa-camera" style="color:var(--secondary)" title="Foto propia"></i>` : '';
        const cookedBadge = wasCooked ? `<span class="badge bg-light text-muted border" style="font-size:.62rem"><i class="fa-solid fa-rotate-left"></i> Reciente</span>` : '';
        const allergenWarning = hasAllergen ? `<span class="badge bg-danger" title="Contiene alérgeno familiar"><i class="fa-solid fa-triangle-exclamation"></i></span>` : '';
        const seasonBadge = r.season !== 'all' ? `<span class="season-badge" style="background:var(--secondary-light);color:var(--secondary)">${SEASON_LABELS[r.season] || r.season}</span>` : '';
        const timeBadge = `<span class="time-badge"><i class="fa-solid fa-clock"></i> ${r.cookTime}m</span>`;
        const typeStripe = `<div class="recipe-type-stripe stripe-${r.type}"></div>`;

        const selBtn = `<div class="recipe-select-wrap" onclick="event.stopPropagation();toggleCart(${r.id},${filters.p})"><div class="recipe-select-btn ${inCart?'checked':''}" data-recipe-id="${r.id}"><i class="fa-solid fa-check"></i></div></div>`;
        let html = '';
        if (currentViewMode === 'cards') {
            html = `<div class="col-6 col-md-3 mb-4 anim-card" style="position:relative;${animDelay}">
                ${selBtn}
                <div class="card recipe-card ${grayClass} ${inCart?'recipe-selected':''}" data-recipe-id="${r.id}" onclick='openModal(${JSON.stringify(r)}, ${filters.p}, ${JSON.stringify(missing)})'>
                    ${typeStripe}
                    ${allergenWarning ? `<div class="position-absolute p-2 z-1" style="top:4px;left:0">${allergenWarning}</div>` : ''}
                    <img src="${imgUrl}" class="recipe-img">
                    <div class="card-body pb-1">
                        <div class="d-flex justify-content-between align-items-start mb-1">
                            <h6 class="fw-bold mb-0" style="font-size:.85rem;line-height:1.3;max-width:82%">${r.name}</h6>
                        </div>
                        <div class="d-flex align-items-center gap-1 mb-2 flex-wrap">
                            ${typeChip}
                            ${ratingBadge}${noteBadge}${photoBadge}${cookedBadge}
                        </div>
                        <div class="mb-1">${badges}</div>
                        <div class="d-flex gap-1 flex-wrap mb-1">${timeBadge}${seasonBadge}</div>
                        <div class="d-flex justify-content-between small fw-bold border-top pt-2 mt-2" style="color:var(--text-muted)">
                            <span><i class="fa-solid fa-fire" style="color:#ef4444"></i> ${nut.cals} kcal</span>
                            <span><i class="fa-solid fa-coins" style="color:#f59e0b"></i> $${Math.round(cost)}</span>
                        </div>
                    </div>
                    <div class="card-footer bg-transparent border-0 pt-0 px-3 pb-3">${statusBadge}</div>
                </div>
            </div>`;
        } else {
            const selBtnList = `<div class="recipe-select-wrap recipe-select-wrap-list" onclick="event.stopPropagation();toggleCart(${r.id},${filters.p})"><div class="recipe-select-btn ${inCart?'checked':''}" data-recipe-id="${r.id}"><i class="fa-solid fa-check"></i></div></div>`;
            html = `<div class="col-12 anim-card" style="position:relative;${animDelay}">
                ${selBtnList}
                <div class="card recipe-list-item ${grayClass} ${inCart?'recipe-selected':''}" data-recipe-id="${r.id}" onclick='openModal(${JSON.stringify(r)},${filters.p},${JSON.stringify(missing)})'>
                    <div class="recipe-type-stripe vertical stripe-${r.type}"></div>
                    <img src="${imgUrl}" class="recipe-list-img">
                    <div class="recipe-list-body">
                        <div class="d-flex justify-content-between align-items-start pe-5">
                            <div>
                                <h5 class="fw-bold mb-1" style="font-size:.98rem">${r.name} ${allergenWarning}</h5>
                                <div class="d-flex align-items-center gap-1 flex-wrap mb-1">${typeChip}${badges}${timeBadge}${seasonBadge}${ratingBadge}${noteBadge}${photoBadge}</div>
                            </div>
                            <div style="min-width:150px">${statusBadge}</div>
                        </div>
                        <p class="small mb-2 text-truncate" style="color:var(--text-muted);max-width:80%">${r.instructions?.substring(0,120)||''}…</p>
                        <div class="d-flex gap-4 small fw-bold" style="color:var(--text-muted)">
                            <span><i class="fa-solid fa-coins" style="color:#f59e0b"></i> $${Math.round(cost)}</span>
                            <span><i class="fa-solid fa-fire" style="color:#ef4444"></i> ${nut.cals} kcal</span>
                            <span style="color:var(--success)">P:${nut.p}g</span>
                            <span style="color:var(--secondary)">C:${nut.c}g</span>
                            <span style="color:var(--danger)">G:${nut.f}g</span>
                        </div>
                    </div>
                </div>
            </div>`;
        }
        if (!isMissing) gR.innerHTML += html; else gM.innerHTML += html;
    });

    const elCR = document.getElementById('countReady'), elCM = document.getElementById('countMissing');
    if (elCR) elCR.textContent = `${totalReady} receta${totalReady!==1?'s':''}`;
    if (elCM) elCM.textContent = `${totalMissing} receta${totalMissing!==1?'s':''}`;

    if (!gR.innerHTML) gR.innerHTML = `<div class="col-12"><div class="empty-state"><div class="empty-state-icon">🍽️</div><h6>No hay platos listos con estos filtros.</h6><p class="small">Intenta cambiar los filtros o agregar más ingredientes a tu despensa.</p></div></div>`;
    if (!gM.innerHTML) gM.innerHTML = `<div class="col-12"><div class="empty-state"><div class="empty-state-icon">🎉</div><h6>¡Tienes todos los ingredientes!</h6><p class="small">No faltan ingredientes para ninguna receta filtrada.</p></div></div>`;

    const paginatorHTML = total > 0 ? buildPaginatorHTML(total, pg, ps, 'setRecipePage', 'setRecipePageSize') : '';
    setPaginatorHTML(['recipesPaginator', 'recipesPaginatorBottom'], paginatorHTML);
}

function setRecipePage(p) { recipePage = p; renderRecipesFiltered(null); }
function setRecipePageSize(s) { recipePageSize = s; recipePage = 1; renderRecipesFiltered(null); }

['filterType','filterDiet','filterCalories','filterPersons','filterTime','filterSeason'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { recipePage = 1; renderRecipesFiltered(null); updateFilterBadge(); });
});
document.getElementById('filterSearch')?.addEventListener('input', () => { recipePage = 1; renderRecipesFiltered(null); updateFilterBadge(); });

/* ─── EVENTOS ─── */
function renderEvents() {
    const grid = document.getElementById('eventsGrid'); grid.innerHTML = '';
    eventsDB.forEach(ev => {
        let rHtml = '';
        ev.recipes.forEach(rid => {
            const r = recipesDB.find(x => x.id === rid);
            if (r) {
                const missing = canCookRecipe(r, 4);
                const status = missing.length === 0
                    ? '<span class="text-success small fw-bold"><i class="fa-solid fa-check"></i></span>'
                    : '<span class="text-danger small fw-bold"><i class="fa-solid fa-xmark"></i></span>';
                rHtml += `<li class="mb-2 d-flex justify-content-between align-items-center"><a href="#" class="text-decoration-none fw-medium" style="color:var(--text)" onclick='openModal(${JSON.stringify(r)},4,${JSON.stringify(missing)});return false'>${r.name}</a>${status}</li>`;
            }
        });
        if (currentViewMode === 'cards') {
            grid.innerHTML += `<div class="col-md-4 mb-4"><div class="card shadow-sm h-100 border-0"><div class="card-header border-0 py-3 text-center" style="background:var(--warning)"><h5 class="fw-bold text-dark mb-0"><i class="fa-solid fa-calendar-star text-danger"></i> ${ev.name}</h5><small>${ev.date}</small></div><div class="card-body bg-light"><ul class="list-unstyled mb-0">${rHtml}</ul></div></div></div>`;
        } else {
            grid.innerHTML += `<div class="col-12 mb-3"><div class="card shadow-sm border-0 d-flex flex-md-row"><div class="d-flex flex-column justify-content-center align-items-center p-4 text-center" style="background:var(--warning);min-width:220px"><h5 class="fw-bold text-dark mb-0">${ev.name}</h5><small>${ev.date}</small></div><div class="card-body bg-light"><ul class="list-unstyled mb-0">${rHtml}</ul></div></div></div>`;
        }
    });
}

/* ─── MENÚ SEMANAL ─── */
document.getElementById('generateMenuBtn').addEventListener('click', generateMenu);

function pickFromPool(pool) {
    const notRecent = pool.filter(r => !cookedInLastDays(r.id, 14));
    const src = notRecent.length > 0 ? notRecent : pool;
    return src[Math.floor(Math.random() * src.length)];
}

function generateMenu() {
    const days = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
    if (recipesDB.length === 0) { document.getElementById('weeklyMenuGrid').innerHTML = `<div class="col-12"><div class="alert alert-warning">No hay recetas cargadas.</div></div>`; return; }
    const allTypes = [...new Set(recipesDB.map(r => r.type))];

    currentWeeklyMenu = days.map(day => {
        const dayType = dayTypes[day] || 'all';
        const typesToShow = dayType === 'all' ? allTypes : [dayType];
        const entries = typesToShow.map(type => {
            const pool = recipesDB.filter(r => r.type === type);
            if (!pool.length) return null;
            return { type, recipe: pickFromPool(pool) };
        }).filter(Boolean);
        return { day, entries };
    });
    document.getElementById('menuActionBar')?.classList.remove('d-none');
    renderWeeklyMenu();
    renderWeeklyNutrition();
}

function regenerateDayMenu(day) {
    const idx = currentWeeklyMenu.findIndex(i => i.day === day);
    if (idx < 0) return;
    const allTypes = [...new Set(recipesDB.map(r => r.type))];
    const dayType = dayTypes[day] || 'all';
    const typesToShow = dayType === 'all' ? allTypes : [dayType];
    currentWeeklyMenu[idx].entries = typesToShow.map(type => {
        const pool = recipesDB.filter(r => r.type === type);
        if (!pool.length) return null;
        return { type, recipe: pickFromPool(pool) };
    }).filter(Boolean);
    renderWeeklyMenu();
    renderWeeklyNutrition();
}

const TYPE_COLORS = { comida:'#f97316', entrada:'#22c55e', once:'#a78bfa', postre:'#ec4899', trago:'#38bdf8' };
const WEEKDAYS_SET = new Set(['Lunes','Martes','Miércoles','Jueves','Viernes']);

function renderWeeklyMenu() {
    const p = parseInt(document.getElementById('menuPersons').value) || 1;
    const grid = document.getElementById('weeklyMenuGrid');
    if (!currentWeeklyMenu.length) {
        grid.innerHTML = `<div class="menu-empty-state"><div class="menu-empty-icon">📅</div><h5>Genera tu menú semanal</h5><p class="text-muted mb-0">Cada día mostrará una sugerencia por tipo de plato</p><button class="btn btn-primary rounded-pill px-5 mt-3 fw-bold" onclick="document.getElementById('generateMenuBtn').click()"><i class="fa-solid fa-wand-magic-sparkles me-2"></i>Generar Menú</button></div>`;
        return;
    }
    grid.innerHTML = '';
    const DAY_ABBR = { Lunes:'LUN', Martes:'MAR', Miércoles:'MIÉ', Jueves:'JUE', Viernes:'VIE', Sábado:'SÁB', Domingo:'DOM' };
    currentWeeklyMenu.forEach(item => {
        const entries = item.entries || [];
        const isWeekend = !WEEKDAYS_SET.has(item.day);
        const tiles = entries.map(({ type, recipe: r }) => {
            const missing = canCookRecipe(r, p);
            const img = getRecipePhotoUrl(r.name, r.type, r.id);
            const isMissing = missing.length > 0;
            const inCart = cart.some(c => c.recipeId === r.id);
            const color = TYPE_COLORS[type] || '#6b7280';
            const typeLabel = DAY_TYPE_LABEL[type] || type;
            return `<div class="menu-recipe-tile${inCart ? ' tile-in-cart' : ''}" onclick='openModal(${JSON.stringify(r)},${p},${JSON.stringify(missing)})'>
                <div class="tile-color-bar" style="background:${color}"></div>
                <img src="${img}" class="tile-img">
                <div class="tile-body">
                    <span class="tile-type-badge" style="color:${color}">${typeLabel}</span>
                    <div class="tile-name">${r.name}</div>
                    <div class="tile-footer">
                        <span class="tile-status" style="color:${isMissing?'#f59e0b':'#22c55e'}">
                            <i class="fa-solid ${isMissing?'fa-cart-shopping':'fa-check'}"></i>
                            ${isMissing ? missing.length + ' falt.' : 'Listo'}
                        </span>
                        <button class="tile-cart-btn${inCart?' active':''}" data-recipe-id="${r.id}"
                            onclick="event.stopPropagation();toggleCart(${r.id},${p})"
                            title="${inCart?'Quitar de lista':'Agregar a lista'}">
                            <i class="fa-solid fa-${inCart?'check':'plus'}"></i>
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');

        grid.innerHTML += `<div class="menu-day-row${isWeekend?' weekend':''}">
            <div class="day-label-col">
                <span class="day-abbr">${DAY_ABBR[item.day] || item.day.substring(0,3).toUpperCase()}</span>
                <span class="day-full">${item.day}</span>
                <button class="day-regen-btn" onclick="regenerateDayMenu('${item.day}')" title="Regenerar este día">
                    <i class="fa-solid fa-rotate-right"></i>
                </button>
            </div>
            <div class="day-tiles-scroll">${tiles}</div>
        </div>`;
    });
}

function renderWeeklyNutrition() {
    if (currentWeeklyMenu.length === 0) return;
    const p = parseInt(document.getElementById('menuPersons').value) || 1;
    let totals = { cals:0, pro:0, carb:0, fat:0, cost:0 };
    currentWeeklyMenu.forEach(item => {
        (item.entries || []).forEach(({ recipe }) => {
            const n = getRecipeNutrition(recipe, p);
            const c = getRecipeCost(recipe, p);
            totals.cals += n.cals; totals.pro += n.p; totals.carb += n.c; totals.fat += n.f; totals.cost += c;
        });
    });
    const avgCals = Math.round(totals.cals / 7);
    const recBudget = currentWeekBudget;
    const budgetPct = recBudget > 0 ? Math.min(100, Math.round((totals.cost / recBudget) * 100)) : 0;
    const budgetColor = budgetPct > 100 ? '#dc3545' : budgetPct > 80 ? '#ffc107' : '#198754';

    document.getElementById('weeklyNutritionBox').innerHTML = `
        <div class="card border-0 shadow-sm mt-4 p-4">
            <h5 class="fw-bold mb-3"><i class="fa-solid fa-chart-bar text-primary"></i> Balance Nutricional de la Semana</h5>
            <div class="row g-3">
                <div class="col-md-3"><div class="text-center"><div class="fw-bold fs-4 text-danger">${totals.cals.toLocaleString('es-CL')}</div><small class="text-muted">Kcal totales</small><div class="small">(${avgCals} kcal/día promedio)</div></div></div>
                <div class="col-md-3">
                    <div class="mb-2"><div class="d-flex justify-content-between"><small>Proteína</small><small class="fw-bold text-success">${totals.pro}g</small></div>
                    <div class="nut-bar"><div class="nut-fill bg-success" style="width:${Math.min(100,totals.pro/350*100)}%"></div></div></div>
                    <div class="mb-2"><div class="d-flex justify-content-between"><small>Carbohidratos</small><small class="fw-bold text-primary">${totals.carb}g</small></div>
                    <div class="nut-bar"><div class="nut-fill bg-primary" style="width:${Math.min(100,totals.carb/1400*100)}%"></div></div></div>
                    <div><div class="d-flex justify-content-between"><small>Grasas</small><small class="fw-bold text-danger">${totals.fat}g</small></div>
                    <div class="nut-bar"><div class="nut-fill bg-danger" style="width:${Math.min(100,totals.fat/490*100)}%"></div></div></div>
                </div>
                <div class="col-md-3"><div class="text-center"><div class="fw-bold fs-4">$${Math.round(totals.cost).toLocaleString('es-CL')}</div><small class="text-muted">Costo total estimado</small>
                    ${recBudget > 0 ? `<div class="mt-2"><div class="budget-bar"><div class="budget-fill" style="width:${budgetPct}%;background:${budgetColor}"></div></div>
                    <small style="color:${budgetColor}">${budgetPct}% del presupuesto ($${recBudget.toLocaleString('es-CL')})</small></div>` : ''}
                </div></div>
                <div class="col-md-3 d-flex flex-column gap-2">
                    <button class="btn btn-sm btn-outline-success rounded-pill" onclick="saveCurrentMenu()"><i class="fa-solid fa-floppy-disk"></i> Guardar Menú</button>
                    <button class="btn btn-sm btn-outline-secondary rounded-pill" onclick="document.getElementById('menuHistoryPanel').classList.toggle('d-none')"><i class="fa-solid fa-history"></i> Ver Historial</button>
                </div>
            </div>
        </div>`;
}

async function saveCurrentMenu() {
    if (currentWeeklyMenu.length === 0) return;
    const p = parseInt(document.getElementById('menuPersons').value) || 1;
    const label = `Semana del ${new Date().toLocaleDateString('es-CL')}`;
    const days = currentWeeklyMenu.map(item => ({ day_name: item.day, recipe_id: (item.entries?.[0]?.recipe?.id || item.recipe?.id), day_type: dayTypes[item.day] }));
    const result = await fetch('/api/menus/saved', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ label, week_start: weekStart(), persons: p, budget: currentWeekBudget, days }) }).then(r => r.json());
    savedMenus.unshift({ id: result.id, label, days, persons: p });
    renderMenuHistory();
    showToast('Menú guardado correctamente ✓');
}

function renderMenuHistory() {
    const list = document.getElementById('menuHistoryItems');
    if (!list) return;
    if (savedMenus.length === 0) { list.innerHTML = '<div class="text-muted text-center p-3">No hay menús guardados aún.</div>'; return; }
    list.innerHTML = savedMenus.slice(0, 8).map(m => `
        <div class="history-day-card card mb-2 border-0 shadow-sm p-3 d-flex flex-row align-items-center justify-content-between">
            <div>
                <div class="fw-bold">${m.label}</div>
                <small class="text-muted">${(m.days||[]).length} días — ${m.persons} personas</small>
            </div>
            <div class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-primary rounded-pill" onclick="loadSavedMenu(${m.id})">Cargar</button>
                <button class="btn btn-sm btn-outline-danger rounded-pill" onclick="deleteSavedMenu(${m.id})"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`).join('');
}

async function loadSavedMenu(menuId) {
    const menu = savedMenus.find(m => m.id === menuId);
    if (!menu) return;
    currentWeeklyMenu = (menu.days || []).map(d => {
        const recipe = recipesDB.find(r => r.id === d.recipe_id) || recipesDB[0];
        return { day: d.day_name, entries: recipe ? [{ type: recipe.type, recipe }] : [] };
    });
    renderWeeklyMenu();
    renderWeeklyNutrition();
}

async function deleteSavedMenu(menuId) {
    await fetch(`/api/menus/saved/${menuId}`, { method:'DELETE' });
    savedMenus = savedMenus.filter(m => m.id !== menuId);
    renderMenuHistory();
}

/* ─── TIPOS DE DÍA ─── */
const DAY_TYPE_OPTIONS = [
    { value:'all',    label:'✨ Todos' },
    { value:'comida', label:'🍽️ Comida' },
    { value:'entrada',label:'🥗 Entrada' },
    { value:'once',   label:'☕ Once' },
    { value:'postre', label:'🍰 Postre' },
    { value:'trago',  label:'🍹 Trago' },
];
const DAY_TYPE_LABEL = Object.fromEntries(DAY_TYPE_OPTIONS.map(o => [o.value, o.label]));

function renderDayTypes() {
    const el = document.getElementById('dayTypesConfig');
    el.innerHTML = Object.entries(dayTypes).map(([day, type]) => `
        <div class="col-6 col-md-3">
            <div class="day-type-item">
                <span class="day-type-day">${day}</span>
                <select class="form-select form-select-sm" onchange="dayTypes['${day}']=this.value;if(currentWeeklyMenu.length)generateMenu()">
                    ${DAY_TYPE_OPTIONS.map(o => `<option value="${o.value}" ${type===o.value?'selected':''}>${o.label}</option>`).join('')}
                </select>
            </div>
        </div>`).join('');
}

/* ─── CARRITO ─── */
let cartMissingForWapp = [], cartHaveList = [], cartRecipeNames = [], cartTotalBuyCost = 0;

function toggleCart(recipeId, portions) {
    const isInCart = cart.some(c => c.recipeId === recipeId);
    const newState = !isInCart;
    cart = cart.filter(c => c.recipeId !== recipeId);
    if (newState) cart.push({ recipeId, portions });
    document.querySelectorAll(`.recipe-select-btn[data-recipe-id="${recipeId}"]`)
        .forEach(btn => btn.classList.toggle('checked', newState));
    document.querySelectorAll(`.recipe-card[data-recipe-id="${recipeId}"], .recipe-list-item[data-recipe-id="${recipeId}"]`)
        .forEach(card => card.classList.toggle('recipe-selected', newState));
    updateCartUI();
}

function clearCart() {
    cart = [];
    document.querySelectorAll('.recipe-select-btn.checked').forEach(btn => btn.classList.remove('checked'));
    document.querySelectorAll('.recipe-card.recipe-selected, .recipe-list-item.recipe-selected').forEach(c => c.classList.remove('recipe-selected'));
    updateCartUI();
}

function updateCartUI() {
    const bar = document.getElementById('cartBar');
    const floatBtn = document.getElementById('cartFloatingBtn');
    const names = cart.map(item => recipesDB.find(x => x.id === item.recipeId)?.name).filter(Boolean);
    if (cart.length > 0) {
        bar.classList.remove('d-none');
        document.getElementById('cartCount').innerText = cart.length;
        const el = document.getElementById('cartRecipeNames');
        if (el) el.textContent = names.join(' · ');
        if (floatBtn) {
            floatBtn.classList.remove('d-none');
            document.getElementById('cartFloatingCount').textContent = cart.length;
            floatBtn.classList.remove('cart-pulse');
            void floatBtn.offsetWidth;
            floatBtn.classList.add('cart-pulse');
        }
    } else {
        bar.classList.add('d-none');
        floatBtn?.classList.add('d-none');
    }
}

function buildCartData() {
    let required = {};
    cartRecipeNames = [];
    cart.forEach(item => {
        const r = recipesDB.find(x => x.id === item.recipeId); if (!r) return;
        cartRecipeNames.push(r.name);
        const mult = getMultiplier(r, item.portions);
        r.ingredients.forEach(req => {
            const reqBase = convertToBaseUnit(req.id, req.qty * mult, req.unit);
            required[req.id] = (required[req.id] || 0) + reqBase;
        });
    });
    cartMissingForWapp = []; cartHaveList = []; cartTotalBuyCost = 0;
    for (const [ingId, reqQty] of Object.entries(required)) {
        const have = pantry[ingId] || 0;
        const ing = ingredientsDB[ingId];
        if (have < reqQty) {
            const faltan = reqQty - have;
            const cost = faltan * (ing?.pricePerBase || 0);
            cartMissingForWapp.push({ id: ingId, name: ing?.name || ingId, faltanStr: formatMissing(ing, faltan), category: ing?.category || 'otros', cost });
            cartTotalBuyCost += cost;
        } else {
            cartHaveList.push({ id: ingId, name: ing?.name || ingId, qtyStr: formatQty(ing, have) });
        }
    }
}

function buildWhatsappMessage() {
    let txt = `🛒 *Lista de Compras — CocinaMágica*\n`;
    txt += `_Recetas: ${cartRecipeNames.join(', ')}_\n\n`;
    if (cartMissingForWapp.length === 0) {
        txt += `✅ ¡Ya tienes todos los ingredientes!\nNo necesitas comprar nada. 🎉`;
        return txt;
    }
    const byCat = {};
    cartMissingForWapp.forEach(m => { const c = m.category||'otros'; if (!byCat[c]) byCat[c]=[]; byCat[c].push(m); });
    CATEGORY_ORDER.forEach(cat => {
        if (!byCat[cat]?.length) return;
        txt += `*${CATEGORY_LABELS[cat]||cat}*\n`;
        byCat[cat].forEach(m => txt += `  • ${m.name}: ${m.faltanStr}\n`);
        txt += '\n';
    });
    if (cartTotalBuyCost > 0) txt += `💰 *Costo estimado:* $${Math.round(cartTotalBuyCost).toLocaleString('es-CL')}`;
    return txt;
}

function shareCartWhatsapp() {
    if (cart.length === 0) return;
    buildCartData();
    window.open(`https://wa.me/?text=${encodeURIComponent(buildWhatsappMessage())}`, '_blank');
}

function showCartModal() {
    buildCartData();
    document.getElementById('cartModalCount').innerText = cart.length;
    document.getElementById('cartMissingCount').innerText = cartMissingForWapp.length;

    const pillsEl = document.getElementById('cartRecipePills');
    pillsEl.innerHTML = cartRecipeNames.map(n => `<span class="cart-recipe-pill"><i class="fa-solid fa-utensils me-1" style="font-size:.65rem"></i>${n}</span>`).join('');

    const listEl = document.getElementById('cartMissingList');
    const haveListEl = document.getElementById('cartHaveList');
    const msgGood = document.getElementById('cartAllGoodMsg');
    const missingContainer = document.getElementById('cartMissingListContainer');
    const haveContainer = document.getElementById('cartHaveContainer');
    const costSummary = document.getElementById('cartCostSummary');
    listEl.innerHTML = ''; haveListEl.innerHTML = '';

    if (cartMissingForWapp.length === 0) {
        missingContainer.classList.add('d-none');
        msgGood.classList.remove('d-none');
        costSummary.classList.add('d-none');
    } else {
        missingContainer.classList.remove('d-none');
        msgGood.classList.add('d-none');
        document.getElementById('cartBuyCountBadge').innerText = cartMissingForWapp.length;
        const byCategory = {};
        CATEGORY_ORDER.forEach(cat => { byCategory[cat] = []; });
        cartMissingForWapp.forEach(m => { const cat = m.category||'otros'; if (!byCategory[cat]) byCategory[cat]=[]; byCategory[cat].push(m); });
        CATEGORY_ORDER.forEach(cat => {
            if (!byCategory[cat]?.length) return;
            listEl.innerHTML += `<li class="list-group-item fw-bold py-1 small" style="background:var(--bg);color:var(--text)">${CATEGORY_LABELS[cat]||cat}</li>`;
            byCategory[cat].forEach(m => {
                listEl.innerHTML += `<li class="list-group-item d-flex justify-content-between align-items-center ps-4 py-2">
                    <span><i class="fa-solid fa-minus text-danger me-2" style="font-size:.7rem"></i>${m.name}</span>
                    <span class="badge rounded-pill" style="background:#dc2626">${m.faltanStr}</span>
                </li>`;
            });
        });
        if (cartTotalBuyCost > 0) {
            costSummary.classList.remove('d-none');
            document.getElementById('cartTotalCost').textContent = '$' + Math.round(cartTotalBuyCost).toLocaleString('es-CL');
        } else { costSummary.classList.add('d-none'); }
    }

    if (cartHaveList.length > 0) {
        haveContainer.classList.remove('d-none');
        haveListEl.innerHTML = cartHaveList.map(h => `
            <li class="list-group-item d-flex justify-content-between align-items-center py-1 cart-have-item">
                <span><i class="fa-solid fa-check text-success me-2" style="font-size:.7rem"></i>${h.name}</span>
                <small class="text-muted">${h.qtyStr}</small>
            </li>`).join('');
    } else { haveContainer.classList.add('d-none'); }

    new bootstrap.Modal(document.getElementById('cartModal')).show();
}

document.getElementById('btnCartWhatsapp').addEventListener('click', () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildWhatsappMessage())}`, '_blank');
});

/* ─── MODAL RECETA ─── */
let currentModalRecipe = null, currentModalPortions = 1, currentModalMissing = [];

function shareRecipeMissingList() {
    if (!currentModalRecipe) return;
    if (!currentModalMissing || currentModalMissing.length === 0) {
        showToast('¡Ya tienes todo! 🎉', 'success');
        return;
    }
    const lines = currentModalMissing.map(m => {
        const ing = ingredientsDB[m.id];
        return `${ing?.name || m.id}: ${formatMissing(ing, m.faltan)}`;
    });
    const txt = `🛒 *${currentModalRecipe.name} — Lista de compras*\n\n${lines.join('\n')}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
}

async function openModal(r, p, missing) {
    currentModalRecipe = r; currentModalPortions = p; currentModalMissing = missing;
    const nut = getRecipeNutrition(r, p);
    const cost = getRecipeCost(r, p);
    const allergens = getActiveFamilyAllergens();
    const hasAllergen = allergens.size > 0 && r.ingredients.some(req => allergens.has(req.id));

    // Header & básico
    document.getElementById('modalRecipeTitle').innerText = r.name;
    document.getElementById('modalPortionsCount').innerText = p;
    document.getElementById('modalCost').innerText = Math.round(cost).toLocaleString('es-CL');
    document.getElementById('modalInstructions').innerText = r.instructions;
    document.getElementById('modalDietTags').innerHTML = r.diets.map(d => `<span class="badge bg-success me-1 px-3 py-2 rounded-pill">${d.toUpperCase()}</span>`).join('');
    document.getElementById('modKcal').innerText = nut.cals;
    document.getElementById('modPro').innerText = nut.p + 'g';
    document.getElementById('modCarb').innerText = nut.c + 'g';
    document.getElementById('modFat').innerText = nut.f + 'g';
    document.getElementById('modalTimeBadge').innerText = `⏱ ${r.cookTime} min`;
    document.getElementById('modalSeasonBadge').innerText = SEASON_LABELS[r.season] || '';

    // Alerta alérgenos
    const allergenAlert = document.getElementById('modalAllergenAlert');
    if (hasAllergen) {
        const affected = familyMembers.filter(m => m.is_active && r.ingredients.some(req => (m.allergies||[]).includes(req.id)));
        allergenAlert.classList.remove('d-none');
        allergenAlert.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>Advertencia:</strong> Esta receta contiene alérgenos para: ${affected.map(m=>m.name).join(', ')}`;
    } else { allergenAlert.classList.add('d-none'); }

    // Ingredientes
    const ul = document.getElementById('modalIngredientsList'); ul.innerHTML = '';
    const mult = getMultiplier(r, p);
    r.ingredients.forEach(req => {
        const ing = ingredientsDB[req.id];
        const allergenMark = ing && allergens.has(req.id) ? ' <span class="badge bg-danger" style="font-size:.6rem">Alérgeno</span>' : '';
        ul.innerHTML += `<li class="mb-1"><span class="badge bg-secondary me-2" style="width:65px">${(req.qty*mult).toFixed(1)} ${req.unit}</span>${ing?.name || req.id}${allergenMark}</li>`;
    });

    // Ingredientes faltantes
    const mDiv = document.getElementById('missingIngredientsDiv');
    if (missing.length > 0) {
        mDiv.classList.remove('d-none');
        const mUl = document.getElementById('modalMissingList'); mUl.innerHTML = '';
        missing.forEach(m => {
            const ing = ingredientsDB[m.id];
            mUl.innerHTML += `<li class="badge bg-white text-dark border px-3 py-2"><span class="text-danger fw-bold">${formatMissing(ing, m.faltan)}</span> de ${ing?.name || m.id}</li>`;
        });
    } else mDiv.classList.add('d-none');

    // Escala inteligente
    const scaleDiv = document.getElementById('modalScaleTips');
    if (p >= 8) {
        scaleDiv.classList.remove('d-none');
        scaleDiv.innerHTML = `<i class="fa-solid fa-lightbulb text-warning"></i> <strong>Consejo para ${p} personas:</strong>
            ${p >= 12 ? 'Divide la preparación en dos ollas. ' : ''}
            El tiempo de cocción puede aumentar hasta un ${p >= 12 ? '50' : '30'}%.
            ${p >= 10 ? 'Necesitas ollas de al menos 8-10 litros.' : ''}`;
    } else { scaleDiv.classList.add('d-none'); }

    // Foto
    const photoImg = document.getElementById('modalImg');
    const deletePhotoBtn = document.getElementById('deletePhotoBtn');
    if (recipePhotos[r.id]) {
        const photoData = await fetch(`/api/recipes/${r.id}/photo`).then(res => res.json()).catch(() => null);
        photoImg.src = photoData?.photo_data || getRecipePhotoUrl(r.name, r.type, r.id);
        deletePhotoBtn.classList.remove('d-none');
    } else {
        photoImg.src = getRecipePhotoUrl(r.name, r.type, r.id);
        deletePhotoBtn.classList.add('d-none');
    }

    // Rating
    document.getElementById('modalRatingStars').innerHTML = starsHTML(r.id, true);
    const ratingComment = document.getElementById('modalRatingComment');
    ratingComment.value = recipeRatings[r.id]?.comment || '';
    const ratingDisplay = document.getElementById('modalRatingDisplay');
    if (recipeRatings[r.id]) {
        ratingDisplay.innerHTML = `<span class="text-muted small">Tu calificación: ${starsHTML(r.id)} ${recipeRatings[r.id].comment ? `— "${recipeRatings[r.id].comment}"` : ''}</span>`;
    } else { ratingDisplay.innerHTML = '<span class="text-muted small">Aún no has calificado esta receta.</span>'; }

    // Notas
    document.getElementById('modalNotes').value = recipeNotes[r.id] || '';

    // Ya cocinado
    const cookedBtn = document.getElementById('btnMarkCooked');
    cookedBtn.classList.toggle('btn-outline-success', !cookedInLastDays(r.id, 1));
    cookedBtn.classList.toggle('btn-success', cookedInLastDays(r.id, 1));
    cookedBtn.innerHTML = cookedInLastDays(r.id, 1)
        ? '<i class="fa-solid fa-check"></i> Cocinado hoy'
        : '<i class="fa-solid fa-fire-burner"></i> Marcar como cocinado';

    showModalTab('info');
    new bootstrap.Modal(document.getElementById('recipeModal')).show();
}

function showModalTab(tab) {
    ['info','notes','photo','video'].forEach(t => {
        document.getElementById(`modalTab-${t}`)?.classList.toggle('active', t === tab);
        document.getElementById(`modalSection-${t}`)?.classList.toggle('d-none', t !== tab);
    });
    if (tab === 'video') loadRecipeVideo();
}

/* ─── RATINGS ─── */
async function setRating(recipeId, rating) {
    document.querySelectorAll(`[data-recipe="${recipeId}"] .star`).forEach((s, i) => { s.classList.toggle('filled', i < rating); });
    const comment = document.getElementById('modalRatingComment')?.value || '';
    await fetch(`/api/recipes/${recipeId}/rating`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ rating, comment }) });
    recipeRatings[recipeId] = { rating, comment, rated_at: new Date() };
    document.getElementById('modalRatingDisplay').innerHTML = `<span class="text-muted small">✅ Guardado — ${rating} estrella${rating>1?'s':''}</span>`;
}

async function saveNote() {
    if (!currentModalRecipe) return;
    const note = document.getElementById('modalNotes').value;
    await fetch(`/api/recipes/${currentModalRecipe.id}/note`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ note }) });
    if (note.trim()) recipeNotes[currentModalRecipe.id] = note.trim();
    else delete recipeNotes[currentModalRecipe.id];
    document.getElementById('noteSaveStatus').textContent = '✅ Guardado';
    setTimeout(() => { document.getElementById('noteSaveStatus').textContent = ''; }, 2000);
}

/* ─── FOTO ─── */
document.getElementById('photoInput')?.addEventListener('change', async function(e) {
    const file = e.target.files[0]; if (!file || !currentModalRecipe) return;
    const reader = new FileReader();
    reader.onload = async function(ev) {
        const base64 = ev.target.result;
        await fetch(`/api/recipes/${currentModalRecipe.id}/photo`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ photo_data: base64 }) });
        recipePhotos[currentModalRecipe.id] = true;
        document.getElementById('modalImg').src = base64;
        document.getElementById('deletePhotoBtn').classList.remove('d-none');
        document.getElementById('photoPreview').src = base64;
        document.getElementById('photoPreview').classList.remove('d-none');
        document.getElementById('photoUploadHint').classList.add('d-none');
    };
    reader.readAsDataURL(file);
});

async function deleteOwnPhoto() {
    if (!currentModalRecipe) return;
    await fetch(`/api/recipes/${currentModalRecipe.id}/photo`, { method:'DELETE' });
    delete recipePhotos[currentModalRecipe.id];
    document.getElementById('modalImg').src = getRecipePhotoUrl(currentModalRecipe.name, currentModalRecipe.type, currentModalRecipe.id);
    document.getElementById('deletePhotoBtn').classList.add('d-none');
    document.getElementById('photoPreview').classList.add('d-none');
    document.getElementById('photoUploadHint').classList.remove('d-none');
}

/* ─── MARCAR COMO COCINADO ─── */
async function markAsCooked() {
    if (!currentModalRecipe) return;
    await fetch('/api/history', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ recipe_id: currentModalRecipe.id, portions: currentModalPortions, cooked_at: new Date().toISOString().split('T')[0] }) });
    cookHistory.unshift({ id: Date.now(), recipe_id: currentModalRecipe.id, portions: currentModalPortions, cooked_at: new Date().toISOString().split('T')[0] });
    const cookedBtn = document.getElementById('btnMarkCooked');
    cookedBtn.classList.remove('btn-outline-success'); cookedBtn.classList.add('btn-success');
    cookedBtn.innerHTML = '<i class="fa-solid fa-check"></i> Cocinado hoy';
    renderHistoryTab();
}

/* ─── FAMILIA ─── */
function renderFamilyTab() {
    const grid = document.getElementById('familyGrid');
    if (familyMembers.length === 0) {
        grid.innerHTML = `<div class="col-12 text-center p-5 text-muted"><i class="fa-solid fa-users fs-1 mb-3 opacity-25"></i><h5>Aún no has agregado integrantes</h5><p>Registra a cada miembro de la familia con sus preferencias y alergias.</p></div>`;
        return;
    }
    const colors = ['#ffb7b2','#a0c4ff','#b9fbc0','#fbf8cc','#ffcbf2','#c3f4fd'];
    grid.innerHTML = familyMembers.map((m, i) => `
        <div class="col-md-4 mb-4">
            <div class="card family-card shadow-sm border-0 ${m.is_active ? '' : 'opacity-50'}">
                <div class="card-body p-4">
                    <div class="d-flex align-items-center gap-3 mb-3">
                        <div class="family-avatar" style="background:${colors[i%colors.length]}">${m.name.charAt(0).toUpperCase()}</div>
                        <div>
                            <h5 class="mb-0 fw-bold">${m.name}</h5>
                            <small class="text-muted">${m.is_active ? '✅ Activo' : '⏸ Inactivo (no afecta filtros)'}</small>
                        </div>
                    </div>
                    ${(m.diets||[]).length > 0 ? `<div class="mb-2">${m.diets.map(d => `<span class="diet-chip">${d}</span>`).join('')}</div>` : ''}
                    ${(m.allergies||[]).length > 0 ? `<div class="mb-2"><small class="fw-bold text-danger">Alergias:</small><br>${m.allergies.map(a => `<span class="allergen-chip">${ingredientsDB[a]?.name || a}</span>`).join('')}</div>` : ''}
                    ${(m.dislikes||[]).length > 0 ? `<div class="mb-2"><small class="fw-bold text-muted">No le gusta:</small><br>${m.dislikes.map(a => `<span class="badge bg-light text-dark border me-1">${ingredientsDB[a]?.name || a}</span>`).join('')}</div>` : ''}
                    <div class="d-flex gap-2 mt-3">
                        <button class="btn btn-sm btn-outline-secondary rounded-pill flex-fill" onclick="toggleFamilyActive(${m.id})">
                            ${m.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                        <button class="btn btn-sm btn-outline-primary rounded-pill" onclick="openEditFamily(${m.id})"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn btn-sm btn-outline-danger rounded-pill" onclick="deleteFamilyMember(${m.id})"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            </div>
        </div>`).join('');
}

async function toggleFamilyActive(id) {
    const m = familyMembers.find(x => x.id === id); if (!m) return;
    m.is_active = !m.is_active;
    await fetch(`/api/family/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(m) });
    updateUI();
}

async function deleteFamilyMember(id) {
    if (!confirm('¿Eliminar este integrante?')) return;
    await fetch(`/api/family/${id}`, { method:'DELETE' });
    familyMembers = familyMembers.filter(m => m.id !== id);
    updateUI();
}

function openEditFamily(id) {
    const m = familyMembers.find(x => x.id === id);
    if (!m) return;
    document.getElementById('familyName').value = m.name;
    document.querySelectorAll('#familyDietsCheckboxes input[type="checkbox"]').forEach(cb => {
        cb.checked = (m.diets||[]).includes(cb.value);
    });
    document.getElementById('familyAllergiesSelect').value = '';
    // Marcar alergias actuales
    Array.from(document.getElementById('familyAllergiesSelect').options).forEach(o => {
        o.selected = (m.allergies||[]).includes(o.value);
    });
    document.getElementById('familyMemberId').value = id;
    new bootstrap.Modal(document.getElementById('familyModal')).show();
}

document.getElementById('familyForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const id = document.getElementById('familyMemberId').value;
    const name = document.getElementById('familyName').value.trim();
    const diets = Array.from(document.querySelectorAll('#familyDietsCheckboxes input[type="checkbox"]:checked')).map(cb => cb.value);
    const allergies = Array.from(document.getElementById('familyAllergiesSelect').selectedOptions).map(o => o.value);
    if (id) {
        const m = familyMembers.find(x => x.id == id);
        if (m) { m.name = name; m.diets = diets; m.allergies = allergies; }
        await fetch(`/api/family/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, diets, allergies, is_active: m?.is_active !== false }) });
    } else {
        const result = await fetch('/api/family', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, diets, allergies }) }).then(r => r.json());
        familyMembers.push(result);
    }
    bootstrap.Modal.getInstance(document.getElementById('familyModal'))?.hide();
    this.reset();
    document.getElementById('familyMemberId').value = '';
    document.querySelectorAll('#familyDietsCheckboxes input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateUI();
});

/* ─── HISTORIAL ─── */
function renderHistoryTab() {
    const el = document.getElementById('historyList');
    if (cookHistory.length === 0) {
        el.innerHTML = `<div class="text-center p-5 text-muted"><i class="fa-solid fa-clock-rotate-left fs-1 mb-3 opacity-25"></i><h5>Aún no has registrado ningún plato cocinado</h5></div>`;
        return;
    }
    el.innerHTML = cookHistory.slice(0, 30).map(h => {
        const r = recipesDB.find(x => x.id === h.recipe_id);
        const date = new Date(h.cooked_at);
        const dateStr = date.toLocaleDateString('es-CL', { weekday:'short', day:'numeric', month:'short' });
        const diary = cookDiary[h.recipe_id];
        const diaryPhoto = diary?.photo ? `<img src="${diary.photo}" class="rounded-2 mt-2 w-100" style="max-height:120px;object-fit:cover">` : '';
        const diaryNote = diary?.note ? `<div class="text-muted small mt-1 fst-italic">"${diary.note}"</div>` : '';
        const diaryRating = diary?.rating > 0 ? `<span class="text-warning small">${'★'.repeat(diary.rating)}${'☆'.repeat(5 - diary.rating)}</span>` : '';
        return `<div class="history-day-card card border-0 shadow-sm mb-2 p-3">
            <div class="d-flex align-items-center gap-3">
                <img src="${r ? getRecipePhotoUrl(r.name, r.type, r.id) : ''}" style="width:60px;height:60px;object-fit:cover;border-radius:10px">
                <div class="flex-fill">
                    <div class="fw-bold">${r?.name || 'Receta eliminada'}</div>
                    <small class="text-muted">${dateStr} · ${h.portions} personas</small>
                    ${diaryRating}
                </div>
                ${r ? starsHTML(r.id) : ''}
                ${r ? `<button class="btn btn-sm btn-outline-secondary rounded-pill text-nowrap" onclick="openCookDiary(${r.id}, '${r.name.replace(/'/g, "\\'")}')">
                    📷 ${diary ? 'Editar' : 'Agregar'} recuerdo
                </button>` : ''}
            </div>
            ${diaryPhoto || diaryNote ? `<div class="mt-2">${diaryPhoto}${diaryNote}</div>` : ''}
        </div>`;
    }).join('');
}

/* ─── PLANIFICADOR DE EVENTOS ─── */
let eventPlan = { entrada: null, principal: null, postre: null, trago: null };

function renderEventPlanner() {
    const courses = [
        { key:'entrada', label:'Entrada', types:['entrada'], icon:'🥗' },
        { key:'principal', label:'Plato Principal', types:['comida'], icon:'🍲' },
        { key:'postre', label:'Postre', types:['postre'], icon:'🍮' },
        { key:'trago', label:'Trago', types:['trago'], icon:'🍹' }
    ];
    const p = parseInt(document.getElementById('eventPersons').value) || 4;
    courses.forEach(course => {
        const el = document.getElementById(`event-${course.key}`);
        if (!el) return;
        const sel = eventPlan[course.key];
        if (sel) {
            const cost = getRecipeCost(sel, p);
            el.classList.add('filled');
            el.innerHTML = `<div class="fw-bold">${sel.name}</div><small class="text-success">$${Math.round(cost).toLocaleString('es-CL')}</small><br>
                <button class="btn btn-sm btn-outline-danger mt-2 rounded-pill" onclick="eventPlan['${course.key}']=null;renderEventPlanner()">Quitar</button>`;
        } else {
            el.classList.remove('filled');
            el.innerHTML = `<div class="fs-2">${course.icon}</div><div class="fw-bold text-muted">${course.label}</div><small class="text-muted">Click para elegir</small>`;
            el.onclick = () => openEventCourseSelector(course.key, course.types);
        }
    });
    updateEventTotal();
}

function openEventCourseSelector(courseKey, types) {
    const p = parseInt(document.getElementById('eventPersons').value) || 4;
    const options = recipesDB.filter(r => types.includes(r.type));
    const listEl = document.getElementById('eventCourseList');
    listEl.innerHTML = options.map(r => {
        const cost = getRecipeCost(r, p);
        const can = canCookRecipe(r, p).length === 0;
        return `<div class="d-flex align-items-center gap-3 p-2 border rounded mb-2 cursor-pointer" onclick="selectEventCourse('${courseKey}',${r.id})" style="cursor:pointer">
            <img src="${getRecipePhotoUrl(r.name, r.type, r.id)}" style="width:50px;height:50px;object-fit:cover;border-radius:8px">
            <div class="flex-fill">
                <div class="fw-bold">${r.name}</div>
                <small class="text-muted">$${Math.round(cost).toLocaleString('es-CL')} · ${r.cookTime} min</small>
            </div>
            <span class="badge ${can?'bg-success':'bg-warning text-dark'}">${can?'Tienes todo':'Compras'}</span>
        </div>`;
    }).join('');
    document.getElementById('eventCourseModalTitle').textContent = 'Elegir ' + courseKey;
    new bootstrap.Modal(document.getElementById('eventCourseModal')).show();
    window._currentCourseKey = courseKey;
}

function selectEventCourse(courseKey, recipeId) {
    eventPlan[courseKey] = recipesDB.find(r => r.id === recipeId);
    bootstrap.Modal.getInstance(document.getElementById('eventCourseModal'))?.hide();
    renderEventPlanner();
}

function updateEventTotal() {
    const p = parseInt(document.getElementById('eventPersons').value) || 4;
    let total = 0;
    Object.values(eventPlan).forEach(r => { if (r) total += getRecipeCost(r, p); });
    document.getElementById('eventTotalCost').textContent = total > 0 ? `$${Math.round(total).toLocaleString('es-CL')}` : '$0';
    updateEventSplit();
}

function showEventShoppingList() {
    const p = parseInt(document.getElementById('eventPersons').value) || 4;
    const recipes = Object.values(eventPlan).filter(Boolean);
    if (recipes.length === 0) { showToast('Elige al menos un plato para el evento.', 'warning'); return; }
    let required = {};
    recipes.forEach(r => {
        const mult = getMultiplier(r, p);
        r.ingredients.forEach(req => {
            const base = convertToBaseUnit(req.id, req.qty * mult, req.unit);
            required[req.id] = (required[req.id] || 0) + base;
        });
    });
    let txt = `🎉 *Lista para el Evento — ${p} personas*\n\n`;
    const byCat = {};
    for (const [ingId, qty] of Object.entries(required)) {
        const ing = ingredientsDB[ingId]; if (!ing) continue;
        const cat = ing.category || 'otros';
        if (!byCat[cat]) byCat[cat] = [];
        byCat[cat].push(`${ing.name}: ${formatMissing(ing, qty)}`);
    }
    CATEGORY_ORDER.forEach(cat => {
        if (!byCat[cat]) return;
        txt += `*${CATEGORY_LABELS[cat]}*\n`;
        byCat[cat].forEach(l => txt += `  • ${l}\n`);
        txt += '\n';
    });
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
}

/* ─── MODO VISITAS URGENTES ─── */
function openEmergencyModal() {
    const p = parseInt(prompt('¿Cuántas personas son?', '4')); if (!p || p < 1) return;
    const entrada = recipesDB.filter(r => r.type === 'entrada' && canCookRecipe(r, p).length === 0);
    const principal = recipesDB.filter(r => r.type === 'comida' && canCookRecipe(r, p).length === 0);
    const postre = recipesDB.filter(r => r.type === 'postre' && canCookRecipe(r, p).length === 0);
    const trago = recipesDB.filter(r => r.type === 'trago' && canCookRecipe(r, p).length === 0);
    const pick = arr => arr.sort(() => Math.random()-.5)[0];
    const e = pick(entrada), pr = pick(principal), po = pick(postre), t = pick(trago);
    let html = `<h5 class="fw-bold mb-3 text-success">✅ Puedes preparar para ${p} personas:</h5>`;
    const showCourse = (label, icon, r) => r ? `<div class="d-flex align-items-center gap-3 mb-3 p-2 bg-light rounded-3">
        <img src="${getRecipePhotoUrl(r.name, r.type, r.id)}" style="width:60px;height:60px;object-fit:cover;border-radius:8px">
        <div><div class="text-muted small fw-bold">${icon} ${label}</div><div class="fw-bold">${r.name}</div><small><i class="fa-solid fa-clock"></i> ${r.cookTime} min</small></div>
    </div>` : `<div class="text-muted mb-2 p-2 border rounded">${icon} ${label}: <em>No hay disponible con tu despensa</em></div>`;
    html += showCourse('Entrada', '🥗', e) + showCourse('Principal', '🍲', pr) + showCourse('Postre', '🍮', po) + showCourse('Trago', '🍹', t);
    if (!e && !pr && !po) html = `<div class="text-center p-4"><i class="fa-solid fa-box-open fs-1 text-muted mb-3"></i><h5>Tu despensa no alcanza para ${p} personas.</h5><p>Revisa qué tienes o ajusta la cantidad.</p></div>`;
    document.getElementById('emergencyResult').innerHTML = html;
    new bootstrap.Modal(document.getElementById('emergencyModal')).show();
}

/* ─── RECORDATORIO DIARIO ─── */
async function saveReminder() {
    const time = document.getElementById('reminderTime').value;
    const active = document.getElementById('reminderActive').checked;
    await fetch('/api/reminder', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ reminder_time: time || null, is_active: active }) });
    localStorage.setItem('reminderTime', time);
    localStorage.setItem('reminderActive', active);
    if (active && time && 'Notification' in window) { Notification.requestPermission(); }
    bootstrap.Modal.getInstance(document.getElementById('settingsModal'))?.hide();
    showToast('Recordatorio guardado ✓');
    checkTodayReminder();
}

function checkTodayReminder() {
    const active = localStorage.getItem('reminderActive') === 'true';
    if (!active) return;
    const dot = document.getElementById('reminderDot');
    if (dot) dot.style.display = currentWeeklyMenu.length > 0 ? 'inline-block' : 'none';
    const time = localStorage.getItem('reminderTime');
    if (!time) return;
    const now = new Date();
    const [hh, mm] = time.split(':').map(Number);
    if (now.getHours() === hh && now.getMinutes() === mm) {
        const today = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][now.getDay()];
        const todayPlan = currentWeeklyMenu.find(i => i.day === today);
        if (todayPlan && 'Notification' in window && Notification.permission === 'granted') {
            const firstEntry = todayPlan.entries?.[0];
            const recipeName = firstEntry?.recipe?.name || todayPlan.recipe?.name || '?';
            new Notification('🍳 CocinaMágica', { body: `Hoy toca: ${recipeName}`, icon: '/favicon.ico' });
        }
    }
}
setInterval(checkTodayReminder, 60000);

/* ─── MENÚ SEMANAL — PRESUPUESTO ─── */
document.getElementById('weekBudgetInput')?.addEventListener('change', async function() {
    currentWeekBudget = parseInt(this.value) || 0;
    const ws = weekStart();
    if (currentWeekBudget > 0) {
        await fetch('/api/budget', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ week_start: ws, amount: currentWeekBudget }) });
        weeklyBudgets[ws] = currentWeekBudget;
    }
    renderWeeklyNutrition();
});

/* ─── NUEVA RECETA ─── */
let rowC = 0;
function addIngRow() {
    const div = document.createElement('div'); div.className = 'row mb-2 align-items-end g-2'; div.id = `newRI_${rowC}`;
    const opts = Object.keys(ingredientsDB).sort((a,b) => ingredientsDB[a].name.localeCompare(ingredientsDB[b].name)).map(k => `<option value="${k}">${ingredientsDB[k].name}</option>`).join('');
    div.innerHTML = `<div class="col-md-5"><select class="form-select newRecIngSel" required>${opts}</select></div>
        <div class="col-md-3"><input type="number" step="0.1" class="form-control newRecIngQty" placeholder="Cant." required></div>
        <div class="col-md-3"><select class="form-select newRecIngUnit"><option value="unidades">Unids</option><option value="gramos">g</option><option value="ml">ml</option></select></div>
        <div class="col-md-1"><button type="button" class="btn btn-outline-danger w-100" onclick="this.closest('.row').remove()"><i class="fa-solid fa-xmark"></i></button></div>`;
    document.getElementById('newRecIngredientsDiv').appendChild(div); rowC++;
}
document.getElementById('addIngRowBtn')?.addEventListener('click', addIngRow);
document.getElementById('newRecBasePortions')?.addEventListener('input', function() { document.getElementById('lblBaseP').innerText = this.value || 1; });

document.getElementById('createRecipeForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const ings = [];
    document.querySelectorAll('#newRecIngredientsDiv .row').forEach(row => {
        ings.push({ id: row.querySelector('.newRecIngSel').value, qty: parseFloat(row.querySelector('.newRecIngQty').value), unit: row.querySelector('.newRecIngUnit').value });
    });
    const rec = {
        name: document.getElementById('newRecName').value,
        type: document.getElementById('newRecType').value,
        basePortions: parseInt(document.getElementById('newRecBasePortions').value) || 1,
        diets: Array.from(document.getElementById('newRecDiets').selectedOptions).map(o => o.value),
        instructions: document.getElementById('newRecInst').value,
        cookTime: parseInt(document.getElementById('newRecCookTime').value) || 30,
        season: document.getElementById('newRecSeason').value,
        ingredients: ings
    };
    const result = await fetch('/api/recipes', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(rec) }).then(r => r.json());
    recipesDB.push({ ...rec, id: result.id });
    showToast('¡Receta guardada con éxito! 🍳'); this.reset();
    document.getElementById('newRecIngredientsDiv').innerHTML = ''; addIngRow(); updateUI();
    bootstrap.Modal.getInstance(document.getElementById('addRecipeModal'))?.hide();
});

/* ─── NUEVO INGREDIENTE ─── */
document.getElementById('newIngredientForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const name = document.getElementById('newIngName').value.trim();
    const unit = document.getElementById('newIngBaseUnit').value;
    const price = parseFloat(document.getElementById('newIngPrice').value);
    const category = document.getElementById('newIngCategory').value;
    const id = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '_');
    if (ingredientsDB[id]) { showToast('Este ingrediente ya existe.', 'warning'); return; }
    const newIng = {
        id, name, baseUnit: unit,
        pricePerBase: (unit==='g'||unit==='ml') ? price/1000 : price,
        conversion: (unit==='g'||unit==='ml') ? {[(unit==='g'?'kilos':'litros')]:1000} : {},
        nutrition: { cals: parseFloat(document.getElementById('newIngCal').value)||0, p: parseFloat(document.getElementById('newIngP').value)||0, c: parseFloat(document.getElementById('newIngC').value)||0, f: parseFloat(document.getElementById('newIngF').value)||0 },
        category
    };
    const res = await fetch('/api/ingredients', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(newIng) });
    if (res.status === 409) { showToast('Este ingrediente ya existe.', 'warning'); return; }
    ingredientsDB[id] = { name: newIng.name, baseUnit: newIng.baseUnit, pricePerBase: newIng.pricePerBase, conversion: newIng.conversion, nutrition: newIng.nutrition, category };
    initSelects(); bootstrap.Modal.getInstance(document.getElementById('newIngredientModal'))?.hide();
    this.reset(); updateUI();
});

/* ─── VISTA Y TEMA ─── */
document.querySelectorAll('.view-toggle').forEach(radio => {
    radio.addEventListener('change', e => { currentViewMode = e.target.value; updateUI(); });
});
document.getElementById('themeToggle').addEventListener('click', function() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? '' : 'dark');
    this.innerHTML = dark ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun text-warning"></i>';
    localStorage.setItem('appTheme', dark ? 'light' : 'dark');
});

/* ═══════════════════════════════════
   IMÁGENES POR NOMBRE DE RECETA
═══════════════════════════════════ */
const P = 'https://images.unsplash.com/photo-';
const Q = '?auto=format&fit=crop&w=600&q=80';
const RECIPE_KEYWORD_PHOTOS = [
    // Sopas / caldos / cremas — stew look
    ['cazuela',            '1547592180-85f173990554'],
    ['sopa ',              '1547592180-85f173990554'],
    ['chupe',              '1547592180-85f173990554'],
    ['caldillo',           '1547592180-85f173990554'],
    ['caldo ',             '1547592180-85f173990554'],
    ['osobuco',            '1547592180-85f173990554'],
    ['plateada',           '1547592180-85f173990554'],
    ['crema de',           '1476224203421-9ac39bcb3327'],
    ['pure',               '1476224203421-9ac39bcb3327'],
    // Carnes rojas
    ['asado',              '1544025162-d76694265947'],
    ['costillar',          '1544025162-d76694265947'],
    ['lomo',               '1455619452474-d2be8b1e70cd'],
    ['bistec',             '1455619452474-d2be8b1e70cd'],
    ['churrasco',          '1455619452474-d2be8b1e70cd'],
    ['filete',             '1455619452474-d2be8b1e70cd'],
    ['cerdo',              '1544025162-d76694265947'],
    ['pulpa de cerdo',     '1544025162-d76694265947'],
    // Pollo
    ['pollo',              '1567620905732-2d1ec7ab7445'],
    // Pescados y mariscos
    ['salmon',             '1466637574441-749b8f19452f'],
    ['reineta',            '1466637574441-749b8f19452f'],
    ['congrio',            '1466637574441-749b8f19452f'],
    ['corvina',            '1466637574441-749b8f19452f'],
    ['ceviche',            '1473093295043-cdd812d0e601'],
    ['camaron',            '1466637574441-749b8f19452f'],
    ['macha',              '1466637574441-749b8f19452f'],
    ['ostra',              '1466637574441-749b8f19452f'],
    ['ostione',            '1466637574441-749b8f19452f'],
    ['loco ',              '1466637574441-749b8f19452f'],
    ['cochayuyo',          '1466637574441-749b8f19452f'],
    ['atun',               '1466637574441-749b8f19452f'],
    // Pastas
    ['tallarin',           '1414235077428-338989a2e8c0'],
    ['fideo',              '1414235077428-338989a2e8c0'],
    ['pasta ',             '1414235077428-338989a2e8c0'],
    ['espagueti',          '1414235077428-338989a2e8c0'],
    // Arroz
    ['arroz con leche',    '1551024601-bec78aea704b'],
    ['arroz',              '1476224203421-9ac39bcb3327'],
    // Legumbres
    ['poroto',             '1585937421612-70a008356fbe'],
    ['lenteja',            '1585937421612-70a008356fbe'],
    ['garbanzo',           '1585937421612-70a008356fbe'],
    // Maíz / choclo
    ['pastel de choclo',   '1476224203421-9ac39bcb3327'],
    ['humita',             '1476224203421-9ac39bcb3327'],
    ['choclo',             '1476224203421-9ac39bcb3327'],
    ['polenta',            '1476224203421-9ac39bcb3327'],
    // Ensaladas
    ['ensalada',           '1512621776951-a57141f2eefd'],
    ['betarraga',          '1540189549336-e6e99c3679fe'],
    ['palta',              '1546069901-ba9599a7e63c'],
    // Pan / masas / empanadas
    ['empanada',           '1509440159596-0249088772ff'],
    ['sopaipilla',         '1509440159596-0249088772ff'],
    ['hallulla',           '1509440159596-0249088772ff'],
    ['marraqueta',         '1509440159596-0249088772ff'],
    ['pan ',               '1509440159596-0249088772ff'],
    ['pancito',            '1509440159596-0249088772ff'],
    ['dobladita',          '1509440159596-0249088772ff'],
    ['pancutras',          '1509440159596-0249088772ff'],
    // Once — tortas
    ['kuchen',             '1578985545062-69928b1d9587'],
    ['torta ',             '1578985545062-69928b1d9587'],
    ['queque',             '1517433670267-08bbd4be890f'],
    ['muffin',             '1558961363-fa8fdf82db35'],
    ['galleta',            '1558961363-fa8fdf82db35'],
    ['bizcocho',           '1517433670267-08bbd4be890f'],
    // Postres
    ['leche asada',        '1551024601-bec78aea704b'],
    ['flan',               '1551024601-bec78aea704b'],
    ['manjar',             '1551024601-bec78aea704b'],
    ['mousse',             '1488477181946-6428a0291777'],
    ['helado',             '1567171466295-4afa63d45416'],
    ['mote con',           '1488477181946-6428a0291777'],
    ['fruta',              '1488477181946-6428a0291777'],
    ['gelatina',           '1464349153735-7db50ed83c84'],
    ['suspiro',            '1551024601-bec78aea704b'],
    // Tragos
    ['pisco sour',         '1514362545857-3bc16c4c7d1b'],
    ['pisco',              '1514362545857-3bc16c4c7d1b'],
    ['chicha',             '1513558161293-cdaf765ed2fd'],
    ['borgona',            '1541614101331-1a5a3a194e92'],
    ['mojito',             '1556679343-c7306c1976bc'],
    ['clericot',           '1513558161293-cdaf765ed2fd'],
    ['terremoto',          '1514362545857-3bc16c4c7d1b'],
    ['cola de mono',       '1556679343-c7306c1976bc'],
    ['michelada',          '1556679343-c7306c1976bc'],
    ['cerveza',            '1556679343-c7306c1976bc'],
    ['vino ',              '1541614101331-1a5a3a194e92'],
    ['cafe ',              '1495474472287-4d71bcdd2085'],
    ['café ',              '1495474472287-4d71bcdd2085'],
    ['te con',             '1495474472287-4d71bcdd2085'],
    ['mate',               '1495474472287-4d71bcdd2085'],
    ['jugo',               '1529543544282-ea669407fca3'],
    ['limonada',           '1529543544282-ea669407fca3'],
    ['api',                '1495474472287-4d71bcdd2085'],
    ['ponche',             '1513558161293-cdaf765ed2fd'],
];

function getRecipePhotoUrl(name, type, id) {
    const n = (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const [kw, photoId] of RECIPE_KEYWORD_PHOTOS) {
        if (n.includes(kw)) return P + photoId + Q;
    }
    return getCategoryImgRich(type, id);
}

/* ═══════════════════════════════════
   MEJORA 1 — RICH IMAGE POOL (fallback)
═══════════════════════════════════ */
const TYPE_IMG_POOL = {
    entrada: [
        'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1529543544282-ea669407fca3?auto=format&fit=crop&w=600&q=80',
    ],
    comida: [
        'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1498654896293-37aacf113fd9?auto=format&fit=crop&w=600&q=80',
    ],
    plato: [
        'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1466637574441-749b8f19452f?auto=format&fit=crop&w=600&q=80',
    ],
    once: [
        'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1517433670267-08bbd4be890f?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=600&q=80',
    ],
    postre: [
        'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1464349153735-7db50ed83c84?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1567171466295-4afa63d45416?auto=format&fit=crop&w=600&q=80',
    ],
    trago: [
        'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1541614101331-1a5a3a194e92?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=600&q=80',
    ],
};
function getCategoryImgRich(type, id) {
    const pool = TYPE_IMG_POOL[type] || TYPE_IMG_POOL.comida;
    return pool[id % pool.length];
}

/* ═══════════════════════════════════
   MEJORA 3 — SEASON CHIP
═══════════════════════════════════ */
let seasonFilterActive = false;
function initSeasonChip() {
    const season = currentSeason();
    const labels = { verano:'☀️ Verano', otono:'🍂 Otoño', invierno:'❄️ Invierno', primavera:'🌸 Primavera' };
    const chip = document.getElementById('seasonChipBtn');
    const label = document.getElementById('seasonChipLabel');
    if (chip && label) { label.textContent = labels[season] || '🍽️'; }
}
function toggleSeasonFilter() {
    seasonFilterActive = !seasonFilterActive;
    const season = currentSeason();
    const chip = document.getElementById('seasonChipBtn');
    const sel = document.getElementById('filterSeason');
    if (seasonFilterActive) {
        if (sel) sel.value = season;
        chip?.classList.add('season-active');
        showToast(`Mostrando recetas de ${season}`, 'info', 2000);
    } else {
        if (sel) sel.value = 'all';
        chip?.classList.remove('season-active');
    }
    renderRecipesFiltered(null);
}

/* ═══════════════════════════════════
   MEJORA 4 — DAILY NUTRITION WIDGET
═══════════════════════════════════ */
function updateDailyNutritionWidget() {
    const today = new Date().toISOString().split('T')[0];
    const todayHistory = cookHistory.filter(h => h.cooked_at && h.cooked_at.startsWith(today));
    let totals = { cals: 0, p: 0, c: 0, f: 0 };
    todayHistory.forEach(h => {
        const r = recipesDB.find(x => x.id === h.recipe_id);
        if (!r) return;
        const nut = getRecipeNutrition(r, h.portions || r.basePortions || 1);
        totals.cals += nut.cals; totals.p += nut.p; totals.c += nut.c; totals.f += nut.f;
    });
    const s = appSettings || {};
    const goals = { cals: s.cals||2000, p: s.pro||50, c: s.carbs||250, f: s.fat||65 };
    const clamp = (v, max) => Math.min(100, Math.round(v / max * 100));
    const el = (id) => document.getElementById(id);
    if (!el('dNutCalsBar')) return;
    el('dNutCalsBar').style.width = clamp(totals.cals, goals.cals) + '%';
    el('dNutCalsVal').textContent = `${Math.round(totals.cals)} / ${goals.cals} kcal`;
    el('dNutProBar').style.width = clamp(totals.p, goals.p) + '%';
    el('dNutProVal').textContent = `${Math.round(totals.p)} / ${goals.p} g`;
    el('dNutCarbBar').style.width = clamp(totals.c, goals.c) + '%';
    el('dNutCarbVal').textContent = `${Math.round(totals.c)} / ${goals.c} g`;
    el('dNutFatBar').style.width = clamp(totals.f, goals.f) + '%';
    el('dNutFatVal').textContent = `${Math.round(totals.f)} / ${goals.f} g`;
}

/* ═══════════════════════════════════
   MEJORA 5 — RANDOM RECIPE
═══════════════════════════════════ */
function pickRandomRecipe() {
    const btn = document.getElementById('randomRecipeBtn');
    btn?.classList.add('spinning');
    setTimeout(() => {
        btn?.classList.remove('spinning');
        const filters = { p: parseInt(document.getElementById('filterPersons')?.value) || 1 };
        const ready = recipesDB.filter(r => canCookRecipe(r, filters.p).length === 0);
        if (ready.length === 0) { showToast('No hay recetas listas con tu despensa actual.', 'warning'); return; }
        const pick = ready[Math.floor(Math.random() * ready.length)];
        document.querySelectorAll('.recipe-random-highlight').forEach(el => el.classList.remove('recipe-random-highlight'));
        const tab = document.querySelector('[data-bs-target="#recipes"]');
        if (tab && !tab.classList.contains('active')) tab.click();
        setTimeout(() => {
            const card = document.querySelector(`[data-recipe-id="${pick.id}"]`);
            if (card) {
                card.classList.add('recipe-random-highlight');
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => card.classList.remove('recipe-random-highlight'), 3500);
            }
            showToast(`¡Cocina hoy: ${pick.name}! 🎲`, 'info', 4000);
        }, 300);
    }, 400);
}

/* ═══════════════════════════════════
   MEJORA 6 — SMALL STARS IN CARDS
═══════════════════════════════════ */
function renderStarsSmall(rating) {
    if (!rating) return '';
    let html = '<span class="stars-sm">';
    for (let i = 1; i <= 5; i++) {
        if (rating >= i) html += '<i class="fa-solid fa-star s s-full"></i>';
        else if (rating > i - 1) html += '<i class="fa-solid fa-star-half-stroke s s-half"></i>';
        else html += '<i class="fa-regular fa-star s s-empty"></i>';
    }
    html += '</span>';
    return html;
}

/* ═══════════════════════════════════
   MEJORA 7 — HERO BACKGROUND
═══════════════════════════════════ */
function initHeroBg() {
    const saved = localStorage.getItem('heroBgImg');
    if (saved) applyHeroBg(saved);
    document.getElementById('heroBgInput')?.addEventListener('change', function() {
        const file = this.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = e => { localStorage.setItem('heroBgImg', e.target.result); applyHeroBg(e.target.result); };
        reader.readAsDataURL(file);
    });
}
function applyHeroBg(dataUrl) {
    const overlay = document.getElementById('heroBgOverlay');
    if (!overlay) return;
    overlay.style.backgroundImage = `url('${dataUrl}')`;
    overlay.classList.add('visible');
}

/* ═══════════════════════════════════
   MEJORA 9 — MOBILE FILTER SYNC
═══════════════════════════════════ */
function syncMobileFilters() {
    const pairs = [
        ['filterSearch','filterSearchMobile'],
        ['filterType','filterTypeMobile'],
        ['filterDiet','filterDietMobile'],
        ['filterCalories','filterCaloriesMobile'],
        ['filterTime','filterTimeMobile'],
        ['filterSeason','filterSeasonMobile'],
    ];
    pairs.forEach(([desk, mob]) => {
        const d = document.getElementById(desk), m = document.getElementById(mob);
        if (!d || !m) return;
        m.addEventListener('input', () => { d.value = m.value; renderRecipesFiltered(null); updateFilterBadge(); });
        m.addEventListener('change', () => { d.value = m.value; renderRecipesFiltered(null); updateFilterBadge(); });
    });
}
function updateFilterBadge() {
    const defaults = { filterType:'all', filterDiet:'all', filterCalories:'all', filterTime:'all', filterSeason:'all', filterSearch:'' };
    let count = 0;
    for (const [id, def] of Object.entries(defaults)) {
        const val = document.getElementById(id)?.value || '';
        if (val !== def) count++;
    }
    const badge = document.getElementById('filterActiveBadge');
    if (badge) { badge.textContent = count; badge.classList.toggle('visible', count > 0); }
}
function clearMobileFilters() {
    ['filterType','filterDiet','filterCalories','filterTime','filterSeason'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = 'all';
        const mob = document.getElementById(id + 'Mobile'); if (mob) mob.value = 'all';
    });
    ['filterSearch','filterSearchMobile'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderRecipesFiltered(null); updateFilterBadge();
    showToast('Filtros limpiados', 'info', 2000);
}

/* ═══════════════════════════════════
   MEJORA 10 — COLOR THEMES
═══════════════════════════════════ */
function applyColorTheme(color, el) {
    document.documentElement.setAttribute('data-color', color === 'warm' ? '' : color);
    localStorage.setItem('appColorTheme', color);
    document.querySelectorAll('.theme-swatch-wrap').forEach(s => s.classList.remove('active'));
    el?.classList.add('active');
}
function initColorTheme() {
    const saved = localStorage.getItem('appColorTheme') || 'warm';
    document.documentElement.setAttribute('data-color', saved === 'warm' ? '' : saved);
    document.querySelector(`.theme-swatch-wrap[data-color="${saved}"]`)?.classList.add('active');
    document.querySelectorAll('.theme-swatch-wrap').forEach(sw => {
        if (sw.dataset.color !== saved) sw.classList.remove('active');
    });
}
function initAppTheme() {
    const saved = localStorage.getItem('appTheme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        const btn = document.getElementById('themeToggle');
        if (btn) btn.innerHTML = '<i class="fa-solid fa-sun text-warning"></i>';
    }
}

/* ═══════════════════════════════════
   SETTINGS PANEL COMPREHENSIVE
═══════════════════════════════════ */
let appSettings = {};
const SETTINGS_DEFAULTS = {
    cals: 2000, pro: 50, carbs: 250, fat: 65,
    defaultPersons: 2, houseName: 'Mi Cocina',
    expiryDays: 3, allergenAlert: true,
    showRecent: true, grayscale: true,
    fontSize: 'normal', animations: true,
    defaultDiet: 'all'
};

function loadSettings() {
    try { appSettings = { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem('appSettings') || '{}') }; }
    catch { appSettings = { ...SETTINGS_DEFAULTS }; }
}

function saveAllSettings() {
    appSettings.cals    = parseInt(document.getElementById('goalCals')?.value) || 2000;
    appSettings.pro     = parseInt(document.getElementById('goalPro')?.value) || 50;
    appSettings.carbs   = parseInt(document.getElementById('goalCarbs')?.value) || 250;
    appSettings.fat     = parseInt(document.getElementById('goalFat')?.value) || 65;
    appSettings.defaultPersons = parseInt(document.getElementById('settingDefaultPersons')?.value) || 2;
    appSettings.houseName = document.getElementById('settingHouseName')?.value || 'Mi Cocina';
    appSettings.expiryDays = parseInt(document.getElementById('settingExpiryDays')?.value) || 3;
    appSettings.allergenAlert = document.getElementById('settingAllergenAlert')?.checked ?? true;
    appSettings.showRecent = document.getElementById('settingShowRecent')?.checked ?? true;
    appSettings.grayscale = document.getElementById('settingGrayscale')?.checked ?? true;
    appSettings.defaultDiet = document.getElementById('settingDefaultDiet')?.value || 'all';
    appSettings.animations = document.getElementById('settingAnimations')?.checked ?? true;
    localStorage.setItem('appSettings', JSON.stringify(appSettings));
    applySettings();
    saveReminder();
    showToast('Configuración guardada ✓', 'success');
}

function applySettings() {
    const s = appSettings;
    // Font size
    document.documentElement.setAttribute('data-fontsize', s.fontSize || 'normal');
    // Animations
    document.documentElement.setAttribute('data-animations', s.animations ? '1' : '0');
    // Default persons
    const pEl = document.getElementById('filterPersons'); if (pEl && !pEl._touched) pEl.value = s.defaultPersons;
    // Default diet
    const dEl = document.getElementById('filterDiet'); if (dEl && !dEl._touched) dEl.value = s.defaultDiet;
    // Daily nut goals update
    updateDailyNutritionWidget();
}

function populateSettingsUI() {
    loadSettings();
    const s = appSettings;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
    set('goalCals', s.cals); set('goalPro', s.pro); set('goalCarbs', s.carbs); set('goalFat', s.fat);
    set('settingDefaultPersons', s.defaultPersons);
    set('settingHouseName', s.houseName);
    set('settingExpiryDays', s.expiryDays);
    set('settingDefaultDiet', s.defaultDiet);
    setChk('settingAllergenAlert', s.allergenAlert);
    setChk('settingShowRecent', s.showRecent);
    setChk('settingGrayscale', s.grayscale);
    setChk('settingAnimations', s.animations);
    setChk('settingsDarkMode', document.documentElement.getAttribute('data-theme') === 'dark');
    // Font size buttons
    document.querySelectorAll('.font-size-btn').forEach(b => b.classList.toggle('active', b.dataset.size === (s.fontSize || 'normal')));
}

function showSettingsTab(tab, btn) {
    document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('stab-' + tab)?.classList.add('active');
    btn?.classList.add('active');
    if (tab === 'apariencia') populateSettingsUI();
}

function applyFontSize(size, btn) {
    appSettings.fontSize = size;
    document.documentElement.setAttribute('data-fontsize', size);
    localStorage.setItem('appSettings', JSON.stringify(appSettings));
    document.querySelectorAll('.font-size-btn').forEach(b => b.classList.remove('active'));
    btn?.classList.add('active');
}

function toggleDarkModeFromSettings(checkbox) {
    const dark = checkbox.checked;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : '');
    localStorage.setItem('appTheme', dark ? 'dark' : 'light');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.innerHTML = dark ? '<i class="fa-solid fa-sun text-warning"></i>' : '<i class="fa-solid fa-moon"></i>';
}

function toggleAnimations(checkbox) {
    appSettings.animations = checkbox.checked;
    document.documentElement.setAttribute('data-animations', checkbox.checked ? '1' : '0');
    localStorage.setItem('appSettings', JSON.stringify(appSettings));
}

function exportPantry() {
    const data = { exported: new Date().toISOString(), pantry: {} };
    for (const [id, qty] of Object.entries(pantry)) {
        data.pantry[id] = { name: ingredientsDB[id]?.name || id, quantity: qty, unit: ingredientsDB[id]?.baseUnit || 'g', expiry: pantryExpiry[id] || null };
    }
    downloadJSON(data, 'despensa.json');
}

function exportHistory() {
    const data = { exported: new Date().toISOString(), history: cookHistory.map(h => ({ recipe: recipesDB.find(r => r.id === h.recipe_id)?.name || h.recipe_id, date: h.cooked_at, persons: h.portions })) };
    downloadJSON(data, 'historial.json');
}

function downloadJSON(obj, filename) {
    const a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(obj, null, 2));
    a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast(`${filename} descargado ✓`);
}

async function confirmClearHistory() {
    if (!confirm('¿Seguro que quieres borrar todo el historial de cocina? Esta acción no se puede deshacer.')) return;
    await fetch('/api/history', { method: 'DELETE' }).catch(() => {});
    cookHistory = [];
    updateDailyNutritionWidget();
    showToast('Historial limpiado', 'info');
}

async function confirmClearPantry() {
    if (!confirm('¿Seguro que quieres vaciar toda tu despensa?')) return;
    for (const id of Object.keys(pantry)) { await fetch(`/api/pantry/${id}`, { method: 'DELETE' }).catch(() => {}); }
    pantry = {}; pantryExpiry = {};
    updateUI();
    showToast('Despensa vaciada', 'info');
}

/* ─── INICIALIZACIÓN ─── */
async function init() {
    try {
        const [ings, recs, pantryData, ratings, notes, photos, history, family, menus, budgets, reminder] = await Promise.all([
            fetch('/api/ingredients').then(r => r.json()),
            fetch('/api/recipes').then(r => r.json()),
            fetch('/api/pantry').then(r => r.json()),
            fetch('/api/ratings').then(r => r.json()),
            fetch('/api/notes').then(r => r.json()),
            fetch('/api/photos').then(r => r.json()),
            fetch('/api/history').then(r => r.json()),
            fetch('/api/family').then(r => r.json()),
            fetch('/api/menus/saved').then(r => r.json()),
            fetch('/api/budget').then(r => r.json()),
            fetch('/api/reminder').then(r => r.json())
        ]);

        ingredientsDB = ings;
        recipesDB = recs;
        pantry = {};
        pantryExpiry = {};
        Object.entries(pantryData).forEach(([id, data]) => {
            pantry[id] = data.quantity;
            if (data.expiry_date) pantryExpiry[id] = data.expiry_date;
        });
        recipeRatings = ratings;
        recipeNotes = notes;
        recipePhotos = photos;
        cookHistory = history;
        familyMembers = family;
        savedMenus = menus;
        weeklyBudgets = budgets;

        // Presupuesto semana actual
        const ws = weekStart();
        currentWeekBudget = weeklyBudgets[ws] || 0;
        if (document.getElementById('weekBudgetInput')) document.getElementById('weekBudgetInput').value = currentWeekBudget || '';

        // Recordatorio
        if (reminder?.is_active && reminder?.reminder_time) {
            localStorage.setItem('reminderTime', reminder.reminder_time);
            localStorage.setItem('reminderActive', 'true');
            document.getElementById('reminderTime')?.setAttribute('value', reminder.reminder_time);
            document.getElementById('reminderActive')?.setAttribute('checked', 'true');
        }

        // Temporada actual en filtro
        const seasonFilter = document.getElementById('filterSeason');
        if (seasonFilter) {
            const season = currentSeason();
            Array.from(seasonFilter.options).forEach(o => { if (o.value === season) o.text += ' ← Ahora'; });
        }

        // Poblar select de alergias en formulario familia
        const allergySelect = document.getElementById('familyAllergiesSelect');
        if (allergySelect) {
            const sortedIngs = Object.keys(ingredientsDB).sort((a,b) => ingredientsDB[a].name.localeCompare(ingredientsDB[b].name));
            allergySelect.innerHTML = sortedIngs.map(k => `<option value="${k}">${ingredientsDB[k].name}</option>`).join('');
        }

        loadSettings();
        applySettings();
        initColorTheme();
        initAppTheme();
        renderDayTypes();
        renderMenuHistory();
        initSelects();
        addIngRow();
        updateUI();
        updateDailyNutritionWidget();
        initSeasonChip();
        initHeroBg();
        syncMobileFilters();
        initExpiryBanner();

        document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el));
        document.getElementById('loadingScreen').style.display = 'none';
        initSmartExpiryNotifications();
    } catch (err) {
        document.getElementById('loadingScreen').innerHTML = `<div class="text-danger text-center p-4"><i class="fa-solid fa-circle-xmark fs-1 mb-3"></i><h5>Error al cargar</h5><p>${err.message}</p><button class="btn btn-primary" onclick="init()">Reintentar</button></div>`;
    }
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 1: LISTA DE COMPRAS — PRINT + MENÚ SEMANAL
═══════════════════════════════════════════════════════════════ */
function buildCartMissing() {
    const needs = {};
    cart.forEach(item => {
        const r = recipesDB.find(r => r.id === item.recipeId);
        if (!r) return;
        const mult = getMultiplier(r, item.portions);
        (r.ingredients || []).forEach(req => {
            const ingData = ingredientsDB[req.id];
            if (!ingData) return;
            const reqBase = convertToBaseUnit(req.id, req.qty * mult, req.unit);
            const have = pantry[req.id] || 0;
            if (have < reqBase) {
                const needed = reqBase - have;
                if (!needs[req.id]) needs[req.id] = { name: ingData.name, totalQty: 0, unit: ingData.baseUnit, estimatedCost: 0, category: ingData.category || 'otros' };
                needs[req.id].totalQty = +(needs[req.id].totalQty + needed).toFixed(2);
                needs[req.id].estimatedCost += needed * (ingData.pricePerBase || 0);
            }
        });
    });
    return Object.values(needs);
}

function printShoppingList() {
    let el = document.getElementById('printableShoppingList');
    if (!el) { el = document.createElement('div'); el.id = 'printableShoppingList'; document.body.appendChild(el); }
    const missing = buildCartMissing();
    const grouped = {};
    missing.forEach(item => { const cat = item.category; if (!grouped[cat]) grouped[cat] = []; grouped[cat].push(item); });
    const catEmoji = { verduras:'🥦', frutas:'🍎', carnes:'🥩', pescados:'🐟', lacteos:'🥛', abarrotes:'🥫', panaderia:'🍞', bebestibles:'🍷', otros:'📦' };
    const catOrder = CATEGORY_ORDER;
    const sortedCats = catOrder.filter(c => grouped[c]).concat(Object.keys(grouped).filter(c => !catOrder.includes(c)));
    const totalCost = missing.reduce((s, i) => s + (i.estimatedCost || 0), 0);
    el.innerHTML = `<h2>🛒 Lista de Compras — CocinaMágica</h2>
      <p>Fecha: ${new Date().toLocaleDateString('es-CL')} · ${cartRecipes.length} receta(s)</p>
      ${sortedCats.map(cat => `<div class="print-category">${catEmoji[cat]||'📦'} ${cat.charAt(0).toUpperCase()+cat.slice(1)}</div>
        <ul>${grouped[cat].map(i => `<li>☐ ${i.name} — ${i.totalQty} ${i.unit}${i.estimatedCost ? ` ($${Math.round(i.estimatedCost).toLocaleString('es-CL')})` : ''}</li>`).join('')}</ul>`).join('')}
      <div class="print-total">Total estimado: $${Math.round(totalCost).toLocaleString('es-CL')}</div>`;
    window.print();
}

function addWeeklyMenuToCart() {
    if (!currentWeeklyMenu?.length) { showToast('Primero genera un menú semanal en el tab Menú', 'warning'); return; }
    const p = parseInt(document.getElementById('menuPersons')?.value) || 1;
    let added = 0;
    currentWeeklyMenu.forEach(item => {
        (item.entries || []).forEach(({ recipe }) => {
            if (!cart.some(c => c.recipeId === recipe.id)) { cart.push({ recipeId: recipe.id, portions: p }); added++; }
        });
    });
    if (added > 0) { updateCartUI(); showToast(`${added} receta(s) del menú agregadas a la lista`, 'success'); }
    else showToast('Las recetas del menú ya están en la lista', 'info');
}

function selectAllMenuItems() { addWeeklyMenuToCart(); }

function shareMenuWhatsapp() {
    if (!currentWeeklyMenu?.length) { showToast('Genera un menú semanal primero', 'warning'); return; }
    addWeeklyMenuToCart();
    buildCartData();
    const menuLines = currentWeeklyMenu.map(item => {
        const lines = (item.entries || []).map(({ type, recipe }) => `  ${DAY_TYPE_LABEL[type] || type}: ${recipe.name}`).join('\n');
        return `📅 *${item.day}*\n${lines}`;
    }).join('\n');
    const missingItems = cartMissingForWapp || [];
    let shoppingLines = '';
    if (missingItems.length > 0) {
        const byCategory = {};
        CATEGORY_ORDER.forEach(cat => { byCategory[cat] = []; });
        missingItems.forEach(m => { const cat = m.category || 'otros'; if (!byCategory[cat]) byCategory[cat] = []; byCategory[cat].push(m); });
        CATEGORY_ORDER.forEach(cat => {
            if (!byCategory[cat]?.length) return;
            shoppingLines += `\n${CATEGORY_LABELS[cat] || cat}\n`;
            byCategory[cat].forEach(m => { shoppingLines += `  • ${m.name}: ${m.faltanStr}\n`; });
        });
    }
    const msg = `🍳 *Menú Semanal CocinaMágica*\n\n${menuLines}${shoppingLines ? '\n\n🛒 *Lista de Compras:*\n' + shoppingLines : '\n\n✅ ¡Todo está en despensa!'}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 2: NOTIFICACIONES INTELIGENTES DE VENCIMIENTO
═══════════════════════════════════════════════════════════════ */
function initSmartExpiryNotifications() {
    const days = parseInt(appSettings?.expiryDays || 3);
    const today = new Date();
    const expiring = Object.entries(pantryExpiry).filter(([id, dateStr]) => {
        const exp = new Date(dateStr + 'T12:00:00');
        const diff = Math.ceil((exp - today) / (1000*60*60*24));
        return diff >= 0 && diff <= days;
    }).map(([id, dateStr]) => {
        const exp = new Date(dateStr + 'T12:00:00');
        const diff = Math.ceil((exp - today) / (1000*60*60*24));
        return { id, name: ingredientsDB[id]?.name || id, diff };
    });

    if (expiring.length === 0) return;

    const expiringIds = new Set(expiring.map(e => e.id));
    const suggestedRecipes = recipesDB
        .filter(r => canCookRecipe(r, 1).length === 0)
        .filter(r => r.ingredients.some(req => expiringIds.has(req.id)))
        .slice(0, 3);

    const alertBar = document.getElementById('expiryAlertBar');
    if (!alertBar) return;
    const names = expiring.slice(0, 3).map(e => `<strong>${e.name}</strong> (${e.diff === 0 ? 'hoy' : e.diff === 1 ? 'mañana' : `en ${e.diff} días`})`).join(', ');
    const recipeSuggestions = suggestedRecipes.length > 0
        ? `<div class="mt-1 small">Puedes cocinar: ${suggestedRecipes.map(r => `<button class="btn btn-sm btn-light rounded-pill px-2 py-0 ms-1" onclick='openModal(${JSON.stringify(r)}, 1, [])'>${r.name}</button>`).join('')}</div>`
        : '';
    alertBar.className = 'expiry-alert-bar';
    alertBar.innerHTML = `<i class="fa-solid fa-triangle-exclamation me-2"></i> Vencen pronto: ${names} ${recipeSuggestions} <button class="btn-close btn-close-white btn-sm ms-auto align-self-start" onclick="this.parentElement.classList.add('d-none')"></button>`;

    if ('Notification' in window && Notification.permission === 'granted' && expiring.length > 0) {
        const title = `CocinaMágica — ${expiring.length} ingrediente${expiring.length > 1 ? 's' : ''} por vencer`;
        const body = suggestedRecipes.length > 0
            ? `${expiring[0].name} vence ${expiring[0].diff === 0 ? 'hoy' : 'mañana'}. Puedes cocinar: ${suggestedRecipes[0].name}`
            : `${expiring.map(e => e.name).join(', ')} ${expiring.length === 1 ? 'vence' : 'vencen'} pronto.`;
        new Notification(title, { body, icon: '/favicon.ico' });
    } else if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 4: MODO FIN DE MES
═══════════════════════════════════════════════════════════════ */
function openFinDeMesModal() {
    let modal = bootstrap.Modal.getInstance(document.getElementById('finDeMesModal'));
    if (!modal) modal = new bootstrap.Modal(document.getElementById('finDeMesModal'));
    modal.show();
    renderFinDeMes();
}

function renderFinDeMes() {
    const el = document.getElementById('finDeMesContent');
    if (!el) return;

    const cookableNow = recipesDB
        .filter(r => canCookRecipe(r, 1).length === 0)
        .map(r => ({ r, cost: getRecipeCost(r, 1) }))
        .sort((a, b) => a.cost - b.cost)
        .slice(0, 6);

    const almostCookable = recipesDB
        .filter(r => {
            const missing = canCookRecipe(r, 1);
            return missing.length > 0 && missing.length <= 3;
        })
        .map(r => {
            const missing = canCookRecipe(r, 1);
            const extraCost = missing.reduce((s, m) => {
                const ing = ingredientsDB[m.id];
                return s + (m.qty * (ing?.pricePerBase || 0));
            }, 0);
            return { r, missing, extraCost, totalCost: getRecipeCost(r, 1) };
        })
        .filter(x => x.extraCost < 5000)
        .sort((a, b) => a.extraCost - b.extraCost)
        .slice(0, 4);

    const pantryValue = Object.entries(pantry).reduce((s, [id, qty]) => {
        return s + qty * (ingredientsDB[id]?.pricePerBase || 0);
    }, 0);

    el.innerHTML = `
        <div class="row g-3 mb-4">
            <div class="col-4 text-center">
                <div class="fs-4 fw-bold text-success">${cookableNow.length}</div>
                <small class="text-muted">Platos listos</small>
            </div>
            <div class="col-4 text-center">
                <div class="fs-4 fw-bold text-primary">$${Math.round(pantryValue).toLocaleString('es-CL')}</div>
                <small class="text-muted">Valor en despensa</small>
            </div>
            <div class="col-4 text-center">
                <div class="fs-4 fw-bold text-warning">${almostCookable.length}</div>
                <small class="text-muted">Casi listos</small>
            </div>
        </div>

        <h6 class="fw-bold mb-3"><i class="fa-solid fa-check-circle text-success me-1"></i> Cocina ahora — sin gastar nada</h6>
        <div class="row g-2 mb-4">
            ${cookableNow.map(({ r, cost }) => `
                <div class="col-6 col-md-4">
                    <div class="card p-2 h-100 border-success border-opacity-25 cursor-pointer" onclick="bootstrap.Modal.getInstance(document.getElementById('finDeMesModal')).hide(); setTimeout(()=>openModal(${JSON.stringify(r)},1,[]),300)">
                        <img src="${getRecipePhotoUrl(r.name, r.type, r.id)}" class="rounded-2 mb-2" style="height:70px;object-fit:cover;width:100%">
                        <div class="fw-semibold small">${r.name}</div>
                        <div class="text-success small fw-bold mt-auto pt-1">$${Math.round(cost).toLocaleString('es-CL')}</div>
                    </div>
                </div>`).join('') || '<div class="col-12 text-muted small py-2">No hay recetas cocinables con lo que tienes ahora.</div>'}
        </div>

        ${almostCookable.length > 0 ? `
        <h6 class="fw-bold mb-3"><i class="fa-solid fa-cart-shopping text-warning me-1"></i> Con poco gasto extra</h6>
        <div class="row g-2">
            ${almostCookable.map(({ r, missing, extraCost }) => `
                <div class="col-6 col-md-3">
                    <div class="card p-2 h-100">
                        <img src="${getRecipePhotoUrl(r.name, r.type, r.id)}" class="rounded-2 mb-2" style="height:60px;object-fit:cover;width:100%">
                        <div class="fw-semibold small">${r.name}</div>
                        <div class="text-warning small mt-1">+$${Math.round(extraCost).toLocaleString('es-CL')} extra</div>
                        <div class="text-muted" style="font-size:.65rem">${missing.map(m => ingredientsDB[m.id]?.name || m.id).join(', ')}</div>
                    </div>
                </div>`).join('')}
        </div>` : ''}`;
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 5: LINK COMPARTIDO FAMILIAR
═══════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   FEATURE 8: HISTORIAL CON FOTOS (DIARIO DE COCINA)
═══════════════════════════════════════════════════════════════ */
let cookDiaryCurrentRecipeId = null;
let cookDiaryCurrentStar = 0;
let cookDiary = JSON.parse(localStorage.getItem('cookDiary') || '{}');

function openCookDiary(recipeId, recipeName) {
    cookDiaryCurrentRecipeId = recipeId;
    cookDiaryCurrentStar = cookDiary[recipeId]?.rating || 0;
    document.getElementById('cookDiaryRecipeName').textContent = recipeName || 'Mi Cocinada';
    document.getElementById('cookDiaryNote').value = cookDiary[recipeId]?.note || '';
    const preview = document.getElementById('cookDiaryPhotoPreview');
    preview.innerHTML = cookDiary[recipeId]?.photo
        ? `<img src="${cookDiary[recipeId].photo}" class="rounded-3 w-100" style="max-height:150px;object-fit:cover">`
        : '';
    document.getElementById('cookDiaryPhotoInput').value = '';
    updateDiaryStars(cookDiaryCurrentStar);
    let modal = bootstrap.Modal.getInstance(document.getElementById('cookDiaryModal'));
    if (!modal) modal = new bootstrap.Modal(document.getElementById('cookDiaryModal'));
    modal.show();
}

function setDiaryStar(n) {
    cookDiaryCurrentStar = n;
    updateDiaryStars(n);
}

function updateDiaryStars(n) {
    document.querySelectorAll('.diary-star').forEach((el, i) => {
        el.textContent = i < n ? '★' : '☆';
        el.style.color = i < n ? '#f59e0b' : 'var(--text-muted)';
    });
}

function saveCookDiary() {
    const note = document.getElementById('cookDiaryNote').value.trim();
    const fileInput = document.getElementById('cookDiaryPhotoInput');
    const file = fileInput.files[0];

    const save = (photoBase64) => {
        cookDiary[cookDiaryCurrentRecipeId] = {
            note,
            rating: cookDiaryCurrentStar,
            photo: photoBase64 || cookDiary[cookDiaryCurrentRecipeId]?.photo || null,
            date: new Date().toISOString()
        };
        localStorage.setItem('cookDiary', JSON.stringify(cookDiary));
        if (cookDiaryCurrentStar > 0) {
            recipeRatings[cookDiaryCurrentRecipeId] = { rating: cookDiaryCurrentStar };
            localStorage.setItem('recipeRatings', JSON.stringify(recipeRatings));
        }
        bootstrap.Modal.getInstance(document.getElementById('cookDiaryModal')).hide();
        showToast('Recuerdo guardado ✓', 'success');
        renderHistoryTab();
    };

    if (file) {
        const reader = new FileReader();
        reader.onload = e => save(e.target.result);
        reader.readAsDataURL(file);
    } else {
        save(null);
    }
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 9: RULETA SORPRÉNDEME
═══════════════════════════════════════════════════════════════ */
let rouletteSelectedRecipe = null;
let rouletteTypeFilter = 'all';

function setRouletteType(type, el) {
    rouletteTypeFilter = type;
    document.querySelectorAll('.roulette-type-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    if (!document.getElementById('rouletteResult')?.classList.contains('d-none')) {
        spinRoulette();
    }
}

function openRouletteModal() {
    rouletteSelectedRecipe = null;
    rouletteTypeFilter = 'all';
    document.querySelectorAll('.roulette-type-btn').forEach((b, i) => { b.classList.toggle('active', i === 0); });
    document.getElementById('rouletteResult').classList.add('d-none');
    document.getElementById('rouletteCards').innerHTML = '';
    document.getElementById('rouletteSpinner').style.display = 'flex';
    const emojiEl = document.querySelector('.roulette-emoji');
    if (emojiEl) emojiEl.textContent = '🍳';
    let modal = bootstrap.Modal.getInstance(document.getElementById('rouletteModal'));
    if (!modal) modal = new bootstrap.Modal(document.getElementById('rouletteModal'));
    modal.show();
    setTimeout(spinRoulette, 300);
}

function spinRoulette() {
    const spinner = document.getElementById('rouletteSpinner');
    const result = document.getElementById('rouletteResult');
    spinner.style.display = 'flex';
    result.classList.add('d-none');

    const emojis = ['🍳','🥘','🍲','🥗','🍜','🍛','🥩','🐟','🥞','🫕'];
    let count = 0;
    const emojiEl = document.querySelector('.roulette-emoji');
    const interval = setInterval(() => {
        if (emojiEl) emojiEl.textContent = emojis[count % emojis.length];
        count++;
        if (count >= 12) {
            clearInterval(interval);
            showRouletteResult();
        }
    }, 100);
}

function showRouletteResult() {
    const allTypes = [...new Set(recipesDB.map(r => r.type))];
    const typeFilter = rouletteTypeFilter === 'all' ? null : rouletteTypeFilter;
    const typesToShow = typeFilter ? [typeFilter] : allTypes;

    const cards = typesToShow.map(type => {
        const pool = recipesDB.filter(r => r.type === type);
        if (!pool.length) return '';
        const cookable = pool.filter(r => canCookRecipe(r, 1).length === 0 && !cookedInLastDays(r.id, 7));
        const recent = pool.filter(r => !cookedInLastDays(r.id, 3));
        const src = cookable.length ? cookable : (recent.length ? recent : pool);
        const recipe = src[Math.floor(Math.random() * src.length)];
        const missing = canCookRecipe(recipe, 1);
        const cost = getRecipeCost(recipe, 1);
        const nut = getRecipeNutrition(recipe, 1);
        const img = getRecipePhotoUrl(recipe.name, recipe.type, recipe.id);
        const typeLabel = DAY_TYPE_LABEL[type] || type;
        const readyBadge = missing.length === 0
            ? '<span class="badge bg-success ms-1"><i class="fa-solid fa-check"></i> Listo</span>'
            : `<span class="badge bg-warning text-dark ms-1">Faltan ${missing.length}</span>`;
        const color = TYPE_COLORS[type] || '#6b7280';
        return `<div class="roulette-recipe-row" data-recipe-id="${recipe.id}" style="cursor:pointer">
            <div class="rrr-color-bar" style="background:${color}"></div>
            <img src="${img}" class="rrr-img">
            <div class="rrr-info">
                <div class="d-flex align-items-center gap-2 mb-1">
                    <span class="badge rounded-pill" style="background:${color};font-size:.65rem">${typeLabel}</span>
                    ${readyBadge}
                </div>
                <div class="fw-semibold small">${recipe.name}</div>
                <div class="d-flex gap-3 text-muted mt-1" style="font-size:.7rem">
                    <span><i class="fa-solid fa-clock"></i> ${recipe.cookTime}m</span>
                    <span><i class="fa-solid fa-fire"></i> ${nut.cals}kcal</span>
                    <span><i class="fa-solid fa-coins"></i> $${Math.round(cost).toLocaleString('es-CL')}</span>
                </div>
            </div>
            <div class="rrr-arrow"><i class="fa-solid fa-chevron-right text-muted"></i></div>
        </div>`;
    }).join('');

    document.getElementById('rouletteSpinner').style.display = 'none';
    const cardsEl = document.getElementById('rouletteCards');
    cardsEl.innerHTML = cards || '<div class="text-muted text-center py-3">No hay recetas disponibles.</div>';
    document.getElementById('rouletteResult').classList.remove('d-none');
    rouletteSelectedRecipe = null;

    cardsEl.querySelectorAll('.roulette-recipe-row[data-recipe-id]').forEach(row => {
        row.addEventListener('click', () => openRouletteRecipe(Number(row.dataset.recipeId)));
    });
}

function openRouletteRecipe(recipeId) {
    const recipe = recipesDB.find(r => r.id === recipeId);
    if (!recipe) return;
    const missing = canCookRecipe(recipe, 1);
    const modal = bootstrap.Modal.getInstance(document.getElementById('rouletteModal'));
    if (modal) modal.hide();
    setTimeout(() => openModal(recipe, 1, missing), 350);
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 10: PLAN NUTRICIONAL AUTOMÁTICO
═══════════════════════════════════════════════════════════════ */
let nutritionPlanGoal = 'maintain';
let nutritionPlanResult = [];

function openNutritionPlanModal() {
    let modal = bootstrap.Modal.getInstance(document.getElementById('nutritionPlanModal'));
    if (!modal) modal = new bootstrap.Modal(document.getElementById('nutritionPlanModal'));
    modal.show();
}

function selectNutritionGoal(goal, el) {
    nutritionPlanGoal = goal;
    document.querySelectorAll('.nutrition-goal-card').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
}

function generateNutritionPlan() {
    const persons = parseInt(document.getElementById('nutPlanPersons')?.value) || 1;
    const targets = { lose: { cals: 1500, protein: 100 }, maintain: { cals: 2000, protein: 75 }, gain: { cals: 2500, protein: 140 } };
    const target = targets[nutritionPlanGoal];
    const el = document.getElementById('nutritionPlanResult');

    const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    nutritionPlanResult = [];
    const usedIds = new Set();

    for (const day of DAYS) {
        let best = null, bestScore = Infinity;
        for (const r of recipesDB) {
            if (usedIds.has(r.id)) continue;
            const nut = getRecipeNutrition(r, persons);
            const calDiff = Math.abs(nut.cals - target.cals);
            const proteinScore = nutritionPlanGoal === 'gain' ? Math.abs(nut.p - target.protein) * 2 : 0;
            const score = calDiff + proteinScore;
            if (score < bestScore) { bestScore = score; best = r; }
        }
        if (!best && nutritionPlanResult.length > 0) {
            best = recipesDB[nutritionPlanResult.length % recipesDB.length];
        }
        if (best) {
            nutritionPlanResult.push({ day, recipe: best });
            usedIds.add(best.id);
        }
    }

    const totals = nutritionPlanResult.reduce((acc, item) => {
        const n = getRecipeNutrition(item.recipe, persons);
        const c = getRecipeCost(item.recipe, persons);
        acc.cals += n.cals; acc.p += n.p; acc.c += n.c; acc.f += n.f; acc.cost += c;
        return acc;
    }, { cals: 0, p: 0, c: 0, f: 0, cost: 0 });

    const goalColors = { lose: '#dc2626', maintain: '#2563eb', gain: '#16a34a' };
    const color = goalColors[nutritionPlanGoal];

    el.innerHTML = `
        <div class="row g-2 mb-4 text-center">
            <div class="col-3"><div class="fw-bold" style="color:${color}">${Math.round(totals.cals / 7)}</div><small class="text-muted">kcal/día prom.</small></div>
            <div class="col-3"><div class="fw-bold text-success">${Math.round(totals.p / 7)}g</div><small class="text-muted">prot/día</small></div>
            <div class="col-3"><div class="fw-bold text-primary">${Math.round(totals.c / 7)}g</div><small class="text-muted">carb/día</small></div>
            <div class="col-3"><div class="fw-bold text-warning">$${Math.round(totals.cost / 7).toLocaleString('es-CL')}</div><small class="text-muted">costo/día</small></div>
        </div>
        ${nutritionPlanResult.map(({ day, recipe }) => {
            const nut = getRecipeNutrition(recipe, persons);
            const cost = getRecipeCost(recipe, persons);
            const missing = canCookRecipe(recipe, persons);
            return `<div class="d-flex align-items-center gap-3 py-2 border-bottom">
                <span class="badge rounded-pill fw-bold" style="background:${color};min-width:72px">${day}</span>
                <div class="flex-grow-1">
                    <div class="fw-semibold small">${recipe.name}</div>
                    <div class="text-muted d-flex gap-2" style="font-size:.7rem">
                        <span><i class="fa-solid fa-fire"></i> ${nut.cals} kcal</span>
                        <span><i class="fa-solid fa-drumstick-bite"></i> ${nut.p}g</span>
                        <span><i class="fa-solid fa-coins"></i> $${Math.round(cost).toLocaleString('es-CL')}</span>
                        ${missing.length === 0 ? '<span class="text-success"><i class="fa-solid fa-check"></i> listo</span>' : `<span class="text-warning">faltan ${missing.length}</span>`}
                    </div>
                </div>
            </div>`;
        }).join('')}`;

    document.getElementById('nutritionPlanFooter').classList.remove('d-none');
}

function applyNutritionPlan() {
    if (nutritionPlanResult.length === 0) return;
    currentWeeklyMenu = nutritionPlanResult.map(item => ({ day: item.day, entries: [{ type: item.recipe.type || 'comida', recipe: item.recipe }] }));
    bootstrap.Modal.getInstance(document.getElementById('nutritionPlanModal')).hide();
    document.querySelector('[data-bs-target="#menu"]')?.click();
    renderWeeklyMenu();
    renderWeeklyNutrition();
    showToast('Plan nutricional aplicado al menú semanal ✓', 'success');
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 3: DASHBOARD PRESUPUESTO MENSUAL
═══════════════════════════════════════════════════════════════ */
function getWeekStartFromDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    return d.toISOString().split('T')[0];
}

function renderBudgetChart() {
    const el = document.getElementById('budgetChartContent');
    if (!el) return;
    const budget = currentWeekBudget;
    const weeklySpending = {};
    cookHistory.forEach(h => {
        const r = recipesDB.find(r => r.id === h.recipe_id);
        if (!r) return;
        const cost = getRecipeCost(r, h.portions || r.basePortions || 4);
        const ws = getWeekStartFromDate(h.cooked_at || new Date().toISOString().split('T')[0]);
        weeklySpending[ws] = (weeklySpending[ws] || 0) + cost;
    });
    const weeks = [];
    const d = new Date(); d.setDate(d.getDate() - 49);
    for (let i = 0; i < 8; i++) {
        const ws = weekStart(d);
        weeks.push({ ws, label: `${d.getDate()}/${d.getMonth()+1}`, spent: weeklySpending[ws]||0, bud: weeklyBudgets[ws]||budget||0 });
        d.setDate(d.getDate() + 7);
    }
    const maxVal = Math.max(...weeks.map(w => Math.max(w.spent, w.bud)), 1);
    const byCategory = {};
    cookHistory.forEach(h => {
        const r = recipesDB.find(r => r.id === h.recipe_id);
        if (!r) return;
        const mult = getMultiplier(r, h.portions || r.basePortions || 4);
        (r.ingredients||[]).forEach(req => {
            const ingData = ingredientsDB[req.id];
            if (!ingData) return;
            const cat = ingData.category||'otros';
            const baseQty = convertToBaseUnit(req.id, req.qty * mult, req.unit);
            byCategory[cat] = (byCategory[cat]||0) + baseQty * (ingData.pricePerBase||0);
        });
    });
    const catEmoji = { verduras:'🥦', frutas:'🍎', carnes:'🥩', pescados:'🐟', lacteos:'🥛', abarrotes:'🥫', panaderia:'🍞', bebestibles:'🍷', otros:'📦' };
    const catHtml = Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([cat, cost]) =>
        `<span class="budget-category-chip">${catEmoji[cat]||'📦'} ${cat} <strong>$${Math.round(cost).toLocaleString('es-CL')}</strong></span>`).join('');
    el.innerHTML = `<div class="budget-dashboard">
      <div class="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <div class="fw-semibold small">Últimas 8 semanas</div>
        ${budget ? `<span class="badge bg-primary">Presupuesto: $${budget.toLocaleString('es-CL')}/sem</span>` : `<small class="text-muted">Define un presupuesto en el campo arriba para ver comparaciones</small>`}
      </div>
      ${weeks.map(w => {
        const pct = w.bud > 0 ? (w.spent/w.bud)*100 : 0;
        const cls = w.spent > w.bud && w.bud > 0 ? 'over' : pct > 80 ? 'warning' : '';
        const barW = maxVal > 0 ? (w.spent/maxVal*100).toFixed(1) : 0;
        return `<div class="budget-week-bar">
          <span class="budget-week-label">${w.label}</span>
          <div class="budget-bar-track"><div class="budget-bar-fill ${cls}" style="width:${barW}%"></div></div>
          <span class="budget-bar-amount ${w.spent > w.bud && w.bud > 0 ? 'text-danger' : ''}">$${Math.round(w.spent).toLocaleString('es-CL')}</span>
        </div>`;
      }).join('')}
      ${catHtml ? `<div class="mt-3"><div class="fw-semibold small mb-2 text-muted">Gasto histórico por categoría:</div><div class="d-flex flex-wrap gap-2">${catHtml}</div></div>` : ''}
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 4: ANTI-DESPERDICIO — INGREDIENTES POR VENCER
═══════════════════════════════════════════════════════════════ */
function getExpiringIngredients() {
    const days = appSettings.expiryDays || 3;
    const today = new Date(); today.setHours(0,0,0,0);
    const expiring = [];
    Object.entries(pantryExpiry).forEach(([id, dateStr]) => {
        if (!pantry[id]) return;
        const exp = new Date(dateStr + 'T12:00:00');
        const diff = Math.ceil((exp - today) / 86400000);
        if (diff <= days) expiring.push({ id: parseInt(id), name: ingredientsDB[id]?.name || id, daysLeft: diff });
    });
    return expiring;
}

function initExpiryBanner() {
    const count = getExpiringIngredients().length;
    const badge = document.getElementById('expiryCountBadge');
    if (badge) { badge.textContent = count; badge.classList.toggle('d-none', count === 0); }
}

function toggleExpiryRecipes() {
    const banner = document.getElementById('expiryRecipesBanner');
    if (banner.classList.contains('d-none')) { renderExpiryRecipes(); banner.classList.remove('d-none'); }
    else banner.classList.add('d-none');
}

function renderExpiryRecipes() {
    const expiring = getExpiringIngredients();
    const chipsEl = document.getElementById('expiryExpiredChips');
    if (chipsEl) chipsEl.innerHTML = expiring.map(e => {
        const urgent = e.daysLeft <= 1;
        const label = e.daysLeft < 0 ? 'VENCIDO' : e.daysLeft === 0 ? 'hoy' : `${e.daysLeft}d`;
        return `<span class="expiry-chip ${urgent?'urgent':''}"><i class="fa-solid fa-hourglass-half"></i> ${e.name} <strong>${label}</strong></span>`;
    }).join('');
    const expiringIds = new Set(expiring.map(e => e.id));
    const suggestions = recipesDB.filter(r => (r.ingredients||[]).some(req => expiringIds.has(req.id))).slice(0, 8);
    const grid = document.getElementById('expiryRecipesGrid');
    if (grid) {
        if (suggestions.length === 0 && expiring.length === 0) {
            grid.innerHTML = '<div class="col-12"><div class="text-success fw-semibold"><i class="fa-solid fa-check-circle me-2"></i>¡Ningún ingrediente por vencer! Tu despensa está fresca.</div></div>';
        } else if (suggestions.length === 0) {
            grid.innerHTML = '<div class="col-12 text-muted small">No hay recetas que usen estos ingredientes. ¡Úsalos en tu próxima comida!</div>';
        } else {
            grid.innerHTML = suggestions.map(r => {
                const missing = canCookRecipe(r, 1);
                return `<div class="col-6 col-md-3"><div class="card border-0 shadow-sm rounded-3 overflow-hidden h-100" style="cursor:pointer" onclick='openModal(${JSON.stringify(r)},1,${JSON.stringify(missing)})'>
                  <img src="${getRecipePhotoUrl(r.name, r.type, r.id)}" style="height:75px;width:100%;object-fit:cover" onerror="this.style.display='none'">
                  <div class="p-2"><div class="fw-semibold" style="font-size:.78rem;line-height:1.2">${r.name}</div>
                  <span class="type-chip chip-${r.type}" style="font-size:.65rem">${r.type}</span></div></div></div>`;
            }).join('');
        }
    }
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 5: SESIÓN MULTI-USUARIO
═══════════════════════════════════════════════════════════════ */
let activeSessionMembers = new Set(JSON.parse(localStorage.getItem('sessionMembers') || '[]'));

function toggleSessionPanel() {
    const panel = document.getElementById('sessionPanel');
    if (panel.classList.contains('d-none')) { renderSessionSelector(); panel.classList.remove('d-none'); }
    else panel.classList.add('d-none');
}

function renderSessionSelector() {
    const el = document.getElementById('sessionMemberChips');
    if (!el) return;
    if (familyMembers.length === 0) {
        el.innerHTML = '<span class="text-muted small">Agrega integrantes en la tab Familia primero.</span>';
        return;
    }
    el.innerHTML = familyMembers.map(m =>
        `<div class="session-member-chip ${activeSessionMembers.has(m.id)?'active':''}" onclick="toggleSessionMember(${m.id})">
          <i class="fa-solid fa-user" style="font-size:.7rem"></i> ${m.name}
        </div>`).join('');
    updateSessionDietInfo();
}

function toggleSessionMember(id) {
    if (activeSessionMembers.has(id)) activeSessionMembers.delete(id);
    else activeSessionMembers.add(id);
    localStorage.setItem('sessionMembers', JSON.stringify([...activeSessionMembers]));
    renderSessionSelector();
    renderRecipesFiltered();
}

function clearSession() {
    activeSessionMembers.clear();
    localStorage.setItem('sessionMembers', '[]');
    renderSessionSelector();
    renderRecipesFiltered();
}

function updateSessionDietInfo() {
    const infoEl = document.getElementById('sessionDietInfo');
    if (!infoEl || activeSessionMembers.size === 0) { infoEl?.classList.add('d-none'); return; }
    const activeM = familyMembers.filter(m => activeSessionMembers.has(m.id));
    const allDiets = [...new Set(activeM.flatMap(m => m.diets||[]))];
    const allAllergies = [...new Set(activeM.flatMap(m => (m.allergies||[]).map(a=>parseInt(a))))];
    const parts = [];
    if (allDiets.length) parts.push(`Dietas: ${allDiets.join(', ')}`);
    if (allAllergies.length) parts.push(`Sin: ${allAllergies.map(id=>ingredientsDB[id]?.name||id).join(', ')}`);
    if (parts.length) { infoEl.textContent = parts.join(' · '); infoEl.classList.remove('d-none'); }
    else infoEl.classList.add('d-none');
}

function getSessionAllergens() {
    if (activeSessionMembers.size === 0) return [];
    return [...new Set(familyMembers.filter(m => activeSessionMembers.has(m.id)).flatMap(m => (m.allergies||[]).map(a=>parseInt(a))))];
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 7: EVENTO — SPLIT DE COSTO + IMPRESIÓN
═══════════════════════════════════════════════════════════════ */
function updateEventSplit() {
    const persons = parseInt(document.getElementById('eventPersons')?.value) || 1;
    const totalText = (document.getElementById('eventTotalCost')?.textContent||'').replace(/[^0-9]/g,'');
    const total = parseInt(totalText) || 0;
    const perPerson = persons > 0 ? Math.round(total / persons) : 0;
    const el = document.getElementById('eventCostPerPerson');
    if (el) el.textContent = `$${perPerson.toLocaleString('es-CL')}`;
}

function printEventMenu() {
    const persons = document.getElementById('eventPersons')?.value || 1;
    const total = document.getElementById('eventTotalCost')?.textContent || '$0';
    const perPerson = document.getElementById('eventCostPerPerson')?.textContent || '$0';
    const courses = [
        { key:'entrada', label:'Entrada', emoji:'🥗' },
        { key:'principal', label:'Plato Principal', emoji:'🍲' },
        { key:'postre', label:'Postre', emoji:'🍮' },
        { key:'trago', label:'Bebida', emoji:'🍹' }
    ];
    const menuRows = courses.map(c => {
        const r = eventPlan[c.key];
        return r ? `<tr><td>${c.emoji} ${c.label}</td><td><strong>${r.name}</strong></td><td>${r.cook_time} min</td></tr>` : '';
    }).join('');
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Menú Evento</title>
    <style>body{font-family:Georgia,serif;max-width:600px;margin:2rem auto;padding:1.5rem;color:#1a1a1a}h1{font-size:2rem;margin-bottom:.25rem}
    .sub{color:#666;font-size:.9rem;margin-bottom:1.5rem}table{width:100%;border-collapse:collapse;margin:1rem 0}
    th{background:#f5f5f5;padding:.6rem 1rem;text-align:left;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em}
    td{padding:.6rem 1rem;border-bottom:1px solid #e5e5e5}
    .totals{margin-top:1.5rem;padding:1rem;background:#f9f9f9;border-radius:8px;display:flex;justify-content:space-between}
    .totals span{font-size:1.1rem}@media print{body{margin:0;padding:1rem}}</style></head>
    <body><h1>🍽️ Menú del Evento</h1>
    <p class="sub">${persons} personas · ${new Date().toLocaleDateString('es-CL')}</p>
    <table><thead><tr><th>Tiempo</th><th>Plato</th><th>Cocción</th></tr></thead><tbody>${menuRows}</tbody></table>
    <div class="totals"><span>Total estimado: <strong>${total}</strong></span><span>Por persona: <strong>${perPerson}</strong></span></div>
    <script>window.print();<\/script></body></html>`);
    win.document.close();
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 8: VIDEO + MODO COCINA MANOS LIBRES
═══════════════════════════════════════════════════════════════ */
let recipeVideos = JSON.parse(localStorage.getItem('recipeVideos') || '{}');
let cookingModeSteps = [], cookingModeIndex = 0, cookingModeVoiceEnabled = false;

function getYouTubeEmbedUrl(url) {
    const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return m ? `https://www.youtube.com/embed/${m[1]}?rel=0` : null;
}

function saveRecipeVideo() {
    if (!currentModalRecipe) return;
    const url = document.getElementById('modalVideoUrl').value.trim();
    if (url) recipeVideos[currentModalRecipe.id] = url;
    else delete recipeVideos[currentModalRecipe.id];
    localStorage.setItem('recipeVideos', JSON.stringify(recipeVideos));
    loadRecipeVideo();
    showToast(url ? 'Video guardado' : 'Video eliminado', url ? 'success' : 'info');
}

function loadRecipeVideo() {
    if (!currentModalRecipe) return;
    const url = recipeVideos[currentModalRecipe.id] || '';
    const urlInput = document.getElementById('modalVideoUrl');
    if (urlInput) urlInput.value = url;
    const embedEl = document.getElementById('videoEmbed');
    const embedContainer = document.getElementById('videoEmbedContainer');
    const placeholder = document.getElementById('noVideoPlaceholder');
    if (url) {
        const embedUrl = getYouTubeEmbedUrl(url);
        if (embedUrl && embedEl) {
            embedEl.src = embedUrl;
            embedContainer?.classList.remove('d-none');
            placeholder?.classList.add('d-none');
        } else {
            embedContainer?.classList.add('d-none');
            placeholder?.classList.remove('d-none');
        }
    } else {
        if (embedEl) embedEl.src = '';
        embedContainer?.classList.add('d-none');
        placeholder?.classList.remove('d-none');
    }
}

function openCookingMode() {
    if (!currentModalRecipe) return;
    const inst = currentModalRecipe.instructions || '';
    const lines = inst.split(/\n+/).map(l => l.trim()).filter(l => l.length > 5);
    cookingModeSteps = lines.length > 0 ? lines : ['No hay instrucciones detalladas para esta receta.'];
    cookingModeIndex = 0;
    cookingModeVoiceEnabled = false;
    document.getElementById('cmRecipeName').textContent = currentModalRecipe.name;
    document.getElementById('cmVoiceBtn').classList.remove('btn-warning');
    document.getElementById('cmVoiceBtn').classList.add('btn-outline-light');
    updateCookingModeUI();
    document.getElementById('cookingModeOverlay').classList.remove('d-none');
    document.body.style.overflow = 'hidden';
    bootstrap.Modal.getInstance(document.getElementById('recipeModal'))?.hide();
}

function closeCookingMode() {
    window.speechSynthesis?.cancel();
    cookingModeVoiceEnabled = false;
    document.getElementById('cookingModeOverlay').classList.add('d-none');
    document.body.style.overflow = '';
}

function cookingModeStep(dir) {
    const n = cookingModeSteps.length;
    cookingModeIndex = Math.max(0, Math.min(n - 1, cookingModeIndex + dir));
    updateCookingModeUI();
    if (cookingModeVoiceEnabled) speakCurrentStep();
}

function updateCookingModeUI() {
    const n = cookingModeSteps.length;
    document.getElementById('cmStepCounter').textContent = `Paso ${cookingModeIndex + 1} / ${n}`;
    document.getElementById('cmStepText').textContent = cookingModeSteps[cookingModeIndex];
    document.getElementById('cmPrevBtn').disabled = cookingModeIndex === 0;
    document.getElementById('cmNextBtn').disabled = cookingModeIndex === n - 1;
    document.getElementById('cmProgressBar').style.width = `${((cookingModeIndex + 1) / n) * 100}%`;
}

function toggleCookingVoice() {
    cookingModeVoiceEnabled = !cookingModeVoiceEnabled;
    const btn = document.getElementById('cmVoiceBtn');
    btn.classList.toggle('btn-outline-light', !cookingModeVoiceEnabled);
    btn.classList.toggle('btn-warning', cookingModeVoiceEnabled);
    if (cookingModeVoiceEnabled) speakCurrentStep();
    else window.speechSynthesis?.cancel();
}

function speakCurrentStep() {
    if (!window.speechSynthesis) { showToast('Navegador no soporta síntesis de voz', 'warning'); return; }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(cookingModeSteps[cookingModeIndex]);
    utt.lang = 'es-ES'; utt.rate = 0.88; utt.pitch = 1.05;
    window.speechSynthesis.speak(utt);
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 9: COMUNIDAD
═══════════════════════════════════════════════════════════════ */
let communityTabActive = 'top';

function renderCommunityTab() {
    switchCommunityTab(communityTabActive, document.querySelector('#communityTabs .nav-link.active'));
}

function switchCommunityTab(tab, btn) {
    communityTabActive = tab;
    document.querySelectorAll('#communityTabs .nav-link').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    else {
        const btns = document.querySelectorAll('#communityTabs .nav-link');
        const map = { top: 0, recent: 1, share: 2 };
        if (btns[map[tab]]) btns[map[tab]].classList.add('active');
    }
    const content = document.getElementById('communityContent');
    if (!content) return;

    if (tab === 'top') {
        const sorted = recipesDB.filter(r => recipeRatings[r.id]).sort((a,b) => (recipeRatings[b.id]?.rating||0) - (recipeRatings[a.id]?.rating||0)).slice(0, 20);
        if (sorted.length === 0) {
            content.innerHTML = `<div class="text-center py-5 text-muted"><i class="fa-solid fa-star fs-1 mb-3 d-block opacity-25"></i><h5>Aún no hay recetas valoradas</h5><p>Cocina y califica recetas para que aparezcan aquí.</p></div>`;
            return;
        }
        content.innerHTML = `<div class="row g-3">${sorted.map((r, i) => {
            const stars = recipeRatings[r.id]?.rating || 0;
            const missing = canCookRecipe(r, 1);
            return `<div class="col-6 col-md-3">
              <div class="community-recipe-card" onclick='openModal(${JSON.stringify(r)},1,${JSON.stringify(missing)})'>
                <img class="recipe-img" src="${getRecipePhotoUrl(r.name, r.type, r.id)}" alt="${r.name}" onerror="this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80'">
                <div class="card-body">
                  <div class="d-flex align-items-start gap-2 mb-1">
                    <span class="community-rank">#${i+1}</span>
                    <div class="flex-grow-1 overflow-hidden">
                      <div class="fw-semibold text-truncate" style="font-size:.82rem">${r.name}</div>
                      <div class="community-stars">${'★'.repeat(stars)}${'☆'.repeat(5-stars)}</div>
                    </div>
                  </div>
                  <div class="d-flex align-items-center mt-1 gap-1">
                    <span class="type-chip chip-${r.type}" style="font-size:.65rem">${r.type}</span>
                    <button class="btn btn-xs btn-outline-secondary ms-auto rounded-pill" onclick="event.stopPropagation();shareRecipeAsJSON(${r.id})" title="Compartir receta"><i class="fa-solid fa-share-nodes"></i></button>
                  </div>
                </div>
              </div></div>`;}).join('')}</div>`;
    } else if (tab === 'recent') {
        const recentIds = [...new Set(cookHistory.map(h => h.recipe_id))].slice(0, 20);
        const recent = recentIds.map(id => recipesDB.find(r => r.id === id)).filter(Boolean);
        if (recent.length === 0) {
            content.innerHTML = `<div class="text-center py-5 text-muted"><i class="fa-solid fa-clock-rotate-left fs-1 mb-3 d-block opacity-25"></i><h5>Sin historial aún</h5><p>Cocina recetas para que aparezcan aquí.</p></div>`;
            return;
        }
        content.innerHTML = `<div class="row g-3">${recent.map(r => {
            const missing = canCookRecipe(r, 1);
            const lastCooked = cookHistory.find(h => h.recipe_id === r.id);
            const dateStr = lastCooked ? new Date(lastCooked.cooked_at).toLocaleDateString('es-CL') : '';
            return `<div class="col-6 col-md-3">
              <div class="community-recipe-card" onclick='openModal(${JSON.stringify(r)},1,${JSON.stringify(missing)})'>
                <img class="recipe-img" src="${getRecipePhotoUrl(r.name, r.type, r.id)}" alt="${r.name}" onerror="this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80'">
                <div class="card-body">
                  <div class="fw-semibold text-truncate mb-1" style="font-size:.82rem">${r.name}</div>
                  <div class="d-flex gap-1 flex-wrap align-items-center">
                    <span class="type-chip chip-${r.type}" style="font-size:.65rem">${r.type}</span>
                    ${dateStr ? `<small class="text-muted ms-auto" style="font-size:.68rem">${dateStr}</small>` : ''}
                  </div>
                </div>
              </div></div>`;}).join('')}</div>`;
    } else if (tab === 'share') {
        content.innerHTML = `<div class="share-box">
          <h6 class="fw-bold mb-3"><i class="fa-solid fa-share-nodes text-success me-2"></i>Compartir una receta</h6>
          <p class="text-muted small mb-3">Genera un código JSON para compartir cualquier receta con otros usuarios de CocinaMágica.</p>
          <div class="mb-3">
            <label class="form-label fw-semibold">Elige la receta</label>
            <select class="form-select" id="shareRecipeSelect" onchange="updateShareJSON()">
              <option value="">— selecciona —</option>
              ${[...recipesDB].sort((a,b)=>a.name.localeCompare(b.name)).map(r=>`<option value="${r.id}">${r.name}</option>`).join('')}
            </select>
          </div>
          <div id="shareJSONArea" class="d-none">
            <label class="form-label fw-semibold">Código para compartir:</label>
            <textarea class="form-control share-json-area" id="shareJSONOutput" readonly rows="12"></textarea>
            <button class="btn btn-success rounded-pill mt-2 px-4" onclick="copyShareJSON()"><i class="fa-solid fa-copy me-1"></i>Copiar al portapapeles</button>
          </div>
        </div>`;
    }
}

function updateShareJSON() {
    const id = parseInt(document.getElementById('shareRecipeSelect').value);
    if (!id) { document.getElementById('shareJSONArea').classList.add('d-none'); return; }
    const r = recipesDB.find(r => r.id === id);
    if (!r) return;
    const obj = {
        _source: 'CocinaMagica', name: r.name, type: r.type, diets: r.diets,
        cook_time: r.cookTime, base_portions: r.basePortions, season: r.season,
        instructions: r.instructions,
        ingredients: (r.ingredients||[]).map(req => ({
            name: ingredientsDB[req.id]?.name || String(req.id),
            quantity: req.qty, unit: req.unit
        }))
    };
    document.getElementById('shareJSONOutput').value = JSON.stringify(obj, null, 2);
    document.getElementById('shareJSONArea').classList.remove('d-none');
}

function copyShareJSON() {
    const text = document.getElementById('shareJSONOutput').value;
    navigator.clipboard.writeText(text).then(() => showToast('¡Copiado! Compártelo con quien quieras.', 'success', 4000)).catch(() => {
        document.getElementById('shareJSONOutput').select(); document.execCommand('copy'); showToast('Copiado');
    });
}

function shareRecipeAsJSON(recipeId) {
    const r = recipesDB.find(r => r.id === recipeId);
    if (!r) return;
    const obj = { _source: 'CocinaMagica', name: r.name, type: r.type, diets: r.diets, cook_time: r.cookTime, base_portions: r.basePortions, season: r.season, instructions: r.instructions, ingredients: (r.ingredients||[]).map(req => ({ name: ingredientsDB[req.id]?.name||String(req.id), quantity: req.qty, unit: req.unit })) };
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2)).then(() => showToast(`"${r.name}" copiada. ¡Compártela!`, 'success', 4000)).catch(() => showToast('No se pudo copiar', 'error'));
}

function openImportRecipeModal() {
    document.getElementById('importRecipeJSON').value = '';
    new bootstrap.Modal(document.getElementById('importRecipeModal')).show();
}

async function importRecipeFromJSON() {
    const text = document.getElementById('importRecipeJSON').value.trim();
    if (!text) { showToast('Pega el código JSON primero', 'warning'); return; }
    let data;
    try { data = JSON.parse(text); } catch { showToast('El código no es JSON válido', 'error'); return; }
    if (!data.name || !data.type || !data.instructions) { showToast('Falta nombre, tipo o instrucciones', 'error'); return; }
    try {
        const ingRows = [];
        for (const ing of (data.ingredients||[])) {
            const match = Object.entries(ingredientsDB).find(([,v]) => v.name.toLowerCase() === ing.name.toLowerCase());
            if (match) ingRows.push({ id: parseInt(match[0]), qty: ing.quantity, unit: ing.unit });
        }
        const resp = await fetch('/api/recipes', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: data.name, type: data.type, diets: data.diets||[], cookTime: data.cook_time||30, basePortions: data.base_portions||4, season: data.season||'all', instructions: data.instructions, ingredients: ingRows }) });
        const newR = await resp.json();
        if (newR.id) {
            const fullR = await fetch('/api/recipes').then(r=>r.json());
            const imported = fullR.find(r => r.id === newR.id);
            if (imported) recipesDB.push(imported);
            bootstrap.Modal.getInstance(document.getElementById('importRecipeModal')).hide();
            showToast(`"${data.name}" importada correctamente`, 'success');
            renderRecipesFiltered();
        } else showToast(newR.error || 'Error al importar', 'error');
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

window.onload = init;
