
'use strict';

// ============================================================
// 01. CONFIGURACIÓN Y UTILIDADES
// ============================================================

// Obtener elementos HTML por su ID
const $ = (id) => document.getElementById(id);

// Convertir céntimos a soles
const money = (cents) => `S/ ${(cents / 100).toFixed(2)}`;

// Evitar que se interprete HTML ingresado por el usuario
const escapeHtml = (value) =>
    String(value ?? '').replace(
        /[&<>"']/g,
        c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c])
    );

// Formatear fecha
const localISO = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const today = localISO(new Date());

const maxDate = localISO(
    new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        new Date().getDate() + 120
    )
);

const prettierDate = (s) => {
    const parts = String(s).split('-').map(Number);

    if (parts.length !== 3) {
        return s;
    }

    return new Date(
        parts[0],
        parts[1] - 1,
        parts[2]
    ).toLocaleDateString('es-PE', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
};


// ============================================================
// 02. VARIABLES PRINCIPALES DEL SISTEMA
// ============================================================

let products = [];
let cart = [];
let selectedDate = today;
let lastOrder = null;
let toastTimeout;

// Recuperar carrito guardado
try {
    cart = JSON.parse(
        localStorage.getItem('panandino_cart')
    ) || [];

    if (!Array.isArray(cart)) {
        cart = [];
    }

} catch {
    cart = [];
}


// ============================================================
// 03. GUARDAR CARRITO Y MOSTRAR MENSAJES
// ============================================================

function saveCart() {
    localStorage.setItem(
        'panandino_cart',
        JSON.stringify(cart)
    );

    updateCartUI();
}

function toast(msg, error = false) {
    const e = $('toast');

    e.textContent = msg;
    e.classList.toggle('error', error);
    e.classList.add('show');

    clearTimeout(toastTimeout);

    toastTimeout = setTimeout(() => {
        e.classList.remove('show');
    }, 3300);
}


// ============================================================
// 04. CONEXIÓN CON LA API REST
// ============================================================

// Función para comunicarse con el servidor Python

async function api(path, options = {}) {
    let res;

    try {
        res = await fetch(path, {
            headers: {
                'Content-Type': 'application/json'
            },
            ...options
        });

    } catch {
        throw new Error(
            'No se pudo conectar al servidor. Comprueba que app.py esté encendido.'
        );
    }

    let data;

    try {
        data = await res.json();

    } catch {
        throw new Error(
            'El servidor envió una respuesta inválida.'
        );
    }

    if (!res.ok) {
        throw new Error(
            data.error || 'Ocurrió un error.'
        );
    }

    return data;
}


// ============================================================
// 05. NAVEGACIÓN Y FECHAS
// ============================================================

function navigate(view) {

    document.querySelectorAll('.screen').forEach(el => {
        el.classList.toggle(
            'active',
            el.id === `screen-${view}`
        );
    });

    document.querySelectorAll('[data-nav]').forEach(el => {
        el.classList.toggle(
            'active',
            el.dataset.nav === view
        );
    });

    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });

    if (view === 'admin') {
        checkAdmin();
    }
}

function updateDateInputs() {

    for (const id of ['dateCatalog', 'checkoutDate']) {
        $(id).min = today;
        $(id).max = maxDate;
        $(id).value = selectedDate;
    }
}


// ============================================================
// 06. CATÁLOGO DE TORTAS
// ============================================================

// Obtener las tortas desde la base de datos por API

async function fetchProducts() {

    try {
        const d = await api(
            `/api/productos?fecha=${encodeURIComponent(selectedDate)}`
        );

        products = d.productos;

        renderProducts();
        updateCartUI();

    } catch (e) {

        $('productGrid').innerHTML = `
            <div class="empty">
                ${escapeHtml(e.message)}
            </div>
        `;

        toast(e.message, true);
    }
}


// Mostrar productos en tarjetas

function renderProducts() {

    $('productGrid').innerHTML = products.map(p => `

        <article class="product-card">

            <div class="product-art ${escapeHtml(p.estilo)}">

                <div class="product-tag">
                    ✧ ${escapeHtml(p.etiqueta)}
                </div>

                <span class="art-emoji">
                    ${escapeHtml(p.emoji)}
                </span>

                <span class="mini-cake">🎂</span>

            </div>

            <div class="product-inner">

                <h3>${escapeHtml(p.nombre)}</h3>

                <p class="product-description">
                    ${escapeHtml(p.descripcion)}
                </p>

                <div class="product-info">

                    <small>
                        ◷ ${escapeHtml(p.tamano)}
                    </small>

                    <span class="product-stock ${
                        p.disponibles === 0
                            ? 'out'
                            : p.disponibles <= 2
                                ? 'low'
                                : ''
                    }">

                        ${
                            p.disponibles === 0
                                ? 'Agotado'
                                : `${p.disponibles} disp. para este día`
                        }

                    </span>

                </div>

                <div class="product-bottom">

                    <span class="price">
                        <small>S/</small>
                        ${(p.precio_centimos / 100).toFixed(2)}
                    </span>

                    <button
                        class="add-product"
                        data-add="${p.id}"
                        ${p.disponibles === 0 ? 'disabled' : ''}
                    >
                        <span>＋</span> Agregar
                    </button>

                </div>

            </div>

        </article>

    `).join('');
}


// ============================================================
// 07. AGREGAR TORTAS AL CARRITO
// ============================================================

function addToCart(id) {

    const p = products.find(p => p.id === id);

    if (!p) {
        return;
    }

    const existing = cart.find(i => i.id === id);

    const qty = existing?.cantidad || 0;

    // Validar disponibilidad
    if (qty >= p.disponibles) {

        toast(
            'No hay más unidades disponibles para la fecha seleccionada.',
            true
        );

        return;
    }

    // Incrementar cantidad o agregar producto
    if (existing) {
        existing.cantidad++;
    } else {
        cart.push({
            id,
            cantidad: 1
        });
    }

    saveCart();

    toast(`${p.nombre} añadida al carrito ♡`);
}


// Modificar cantidad de productos

function modifyCart(id, delta) {

    const p = products.find(p => p.id === id);

    const item = cart.find(i => i.id === id);

    if (!item) {
        return;
    }

    if (
        delta > 0 &&
        (!p || item.cantidad >= p.disponibles)
    ) {

        toast(
            'No quedan más unidades para esta fecha.',
            true
        );

        return;
    }

    item.cantidad += delta;

    if (item.cantidad <= 0) {
        cart = cart.filter(i => i.id !== id);
    }

    saveCart();
}


// ============================================================
// 08. CALCULAR TOTAL Y ACTUALIZAR CARRITO
// ============================================================

function totalCart() {

    return cart.reduce((sum, i) => {

        const producto = products.find(
            p => p.id === i.id
        );

        return sum + i.cantidad *
            (producto?.precio_centimos || 0);

    }, 0);
}


function updateCartUI() {

    cart = cart.filter(i =>
        products.length === 0 ||
        products.some(p => p.id === i.id)
    );

    const count = cart.reduce(
        (s, i) => s + i.cantidad,
        0
    );

    $('cartCount').textContent = count;
    $('cartTotal').textContent = money(totalCart());

    $('toCheckout').disabled =
        !cart.length || !products.length;

    // Carrito vacío
    if (!cart.length) {

        $('cartBody').innerHTML = `
            <div class="cart-empty">

                <span class="cart-emoji">🧁</span>

                <h3>Tu carrito está esperando</h3>

                <p>
                    Elige alguna de nuestras tortas artesanales
                    y prepárate para algo delicioso.
                </p>

                <button
                    class="btn btn-dark"
                    data-close-drawer
                >
                    Ver las tortas →
                </button>

            </div>
        `;

        return;
    }

    // Carrito con productos
    $('cartBody').innerHTML = `

        <p style="font-size:11px;color:#998475">

            Entrega prevista:

            <strong>
                ${escapeHtml(prettierDate(selectedDate))}
            </strong>

        </p>

    ` + cart.map(i => {

        const p = products.find(p => p.id === i.id);

        if (!p) {
            return '';
        }

        return `

            <div class="cart-item">

                <div class="cart-item-art">
                    ${escapeHtml(p.emoji)}
                </div>

                <div>

                    <h3>${escapeHtml(p.nombre)}</h3>

                    <small>${escapeHtml(p.tamano)}</small>

                    <div class="qty-tools">

                        <button
                            data-qty="${p.id}"
                            data-delta="-1"
                            aria-label="Quitar una unidad"
                        >−</button>

                        <b>${i.cantidad}</b>

                        <button
                            data-qty="${p.id}"
                            data-delta="1"
                            aria-label="Añadir una unidad"
                        >+</button>

                    </div>

                    <button
                        class="remove-item"
                        data-remove="${p.id}"
                    >
                        Eliminar
                    </button>

                </div>

                <div class="cart-item-price">
                    ${money(p.precio_centimos * i.cantidad)}
                </div>

            </div>

        `;

    }).join('');
}


// Abrir o cerrar carrito

function drawer(show) {

    $('cartDrawer').hidden = !show;
    $('overlay').hidden = !show;

    document.body.style.overflow =
        show ? 'hidden' : '';

    if (show) {
        updateCartUI();
    }
}


// Mostrar formulario de compra

function checkout(show) {

    $('checkoutOverlay').hidden = !show;

    document.body.style.overflow =
        show ? 'hidden' : '';

    if (show) {

        $('checkoutFormArea').hidden = false;
        $('checkoutSuccess').hidden = true;

        $('checkoutDate').value = selectedDate;

        $('checkoutTotal').textContent =
            money(totalCart());

        $('checkoutSummary').innerHTML = cart.map(i => {

            const p = products.find(
                p => p.id === i.id
            );

            return p ? `

                <div class="summary-row">

                    <span>
                        ${i.cantidad}× ${escapeHtml(p.nombre)}
                    </span>

                    <b>
                        ${money(i.cantidad * p.precio_centimos)}
                    </b>

                </div>

            ` : '';

        }).join('') + `

            <div
                class="summary-row"
                style="border-top:1px solid #efd1bd;margin-top:6px;padding-top:9px"
            >

                <strong>Entrega</strong>

                <strong>
                    ${escapeHtml(prettierDate(selectedDate))}
                </strong>

            </div>
        `;
    }
}


// ============================================================
// 09. CONSULTAR EL ESTADO DE UN PEDIDO
// ============================================================

function renderStatus(o) {

    const steps = [
        'Registrado',
        'En preparación',
        'Entregado'
    ];

    const idx = steps.indexOf(o.estado);

    return `

        <div class="status-card">

            <h3>Pedido ${escapeHtml(o.codigo)}</h3>

            <div class="meta">

                <strong>${escapeHtml(o.cliente)}</strong>

                · Entrega:
                ${escapeHtml(prettierDate(o.fecha_entrega))}

            </div>

            <div class="status-progress">

                ${steps.map((step, i) => `

                    <div class="status-step ${
                        i <= idx ? 'done' : ''
                    }">

                        <b>
                            ${i <= idx ? '✓' : i + 1}
                        </b>

                        ${step}

                    </div>

                `).join('')}

            </div>

            <div class="order-lines">

                ${o.items.map(i => `

                    <div class="order-line">

                        <span>
                            ${i.cantidad}× ${escapeHtml(i.producto)}
                        </span>

                        <strong>
                            ${money(i.subtotal_centimos)}
                        </strong>

                    </div>

                `).join('')}

                <div
                    class="order-line"
                    style="border-top:1px solid #eddcd1;margin-top:7px;padding-top:10px"
                >

                    <strong>Total</strong>

                    <strong>
                        ${money(o.total_centimos)}
                    </strong>

                </div>

            </div>

        </div>
    `;
}


// ============================================================
// 10. PANEL DE ADMINISTRACIÓN
// ============================================================

// Mostrar pedidos registrados

function renderAdmin(orders) {

    $('statTotal').textContent =
        orders.length;

    $('statPreparacion').textContent =
        orders.filter(
            o => o.estado === 'En preparación'
        ).length;

    $('statEntregados').textContent =
        orders.filter(
            o => o.estado === 'Entregado'
        ).length;

    if (!orders.length) {

        $('adminOrders').innerHTML = `
            <div class="empty">
                Aún no hay pedidos. Realiza uno desde
                el catálogo para probar el funcionamiento.
            </div>
        `;

        return;
    }

    $('adminOrders').innerHTML = orders.map(o => `

        <article class="admin-order">

            <div>

                <h3>${escapeHtml(o.codigo)}</h3>

                <p>
                    <strong>${escapeHtml(o.cliente)}</strong>
                    <br>
                    ${escapeHtml(o.telefono)}
                    <br>
                    ${escapeHtml(o.correo)}
                    <br>
                    📅 ${escapeHtml(prettierDate(o.fecha_entrega))}
                </p>

            </div>

            <div>

                <ul>
                    ${o.items.map(i => `
                        <li>
                            ${i.cantidad}× ${escapeHtml(i.producto)}
                        </li>
                    `).join('')}
                </ul>

                <span class="order-total">
                    Total: ${money(o.total_centimos)}
                </span>

            </div>

            <div>

                <label
                    class="state-label"
                    for="state-${escapeHtml(o.codigo)}"
                >
                    ESTADO DEL PEDIDO
                </label>

                <select
                    id="state-${escapeHtml(o.codigo)}"
                    data-order-state="${escapeHtml(o.codigo)}"
                    data-current="${escapeHtml(o.estado)}"
                >

                    ${
                        [
                            'Registrado',
                            'En preparación',
                            'Entregado'
                        ].map((state, idx) => `

                            <option
                                value="${state}"
                                ${
                                    state === o.estado
                                        ? 'selected'
                                        : ''
                                }
                                ${
                                    idx < [
                                        'Registrado',
                                        'En preparación',
                                        'Entregado'
                                    ].indexOf(o.estado)
                                        ? 'disabled'
                                        : ''
                                }
                            >
                                ${state}
                            </option>

                        `).join('')
                    }

                </select>

            </div>

        </article>

    `).join('');
}


// Verificar sesión de administración

async function checkAdmin() {

    try {

        const d = await api(
            '/api/admin/session'
        );

        $('adminLogin').hidden =
            d.autenticado;

        $('adminDashboard').hidden =
            !d.autenticado;

        if (d.autenticado) {
            await loadAdmin();
        }

    } catch (e) {
        toast(e.message, true);
    }
}


// Cargar pedidos para la administradora

async function loadAdmin() {

    try {

        const d = await api(
            '/api/admin/pedidos'
        );

        renderAdmin(d.pedidos);

    } catch (e) {

        toast(e.message, true);

        if (e.message.includes('sesión')) {
            checkAdmin();
        }
    }
}


// ============================================================
// 11. EVENTOS Y FUNCIONAMIENTO DE LA PÁGINA
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

    $('year').textContent =
        new Date().getFullYear();

    updateDateInputs();
    fetchProducts();
    updateCartUI();


    // --------------------------------------------------------
    // NAVEGACIÓN Y BOTONES DE PRODUCTOS
    // --------------------------------------------------------

    document.addEventListener('click', e => {

        const nav = e.target.closest('[data-nav]');

        if (nav) {
            navigate(nav.dataset.nav);
        }

        const add = e.target.closest('[data-add]');

        if (add) {
            addToCart(Number(add.dataset.add));
        }

        const qty = e.target.closest('[data-qty]');

        if (qty) {
            modifyCart(
                Number(qty.dataset.qty),
                Number(qty.dataset.delta)
            );
        }

        const rem = e.target.closest('[data-remove]');

        if (rem) {

            cart = cart.filter(
                i => i.id !== Number(rem.dataset.remove)
            );

            saveCart();
        }

        if (e.target.closest('[data-close-drawer]')) {
            drawer(false);
        }
    });


    // --------------------------------------------------------
    // NAVEGACIÓN DEL CATÁLOGO
    // --------------------------------------------------------

    $('goCatalog').addEventListener('click', () => {

        $('catalog-section').scrollIntoView({
            behavior: 'smooth'
        });

    });

    $('bannerCart').addEventListener(
        'click',
        () => drawer(true)
    );

    $('openCart').addEventListener(
        'click',
        () => drawer(true)
    );

    $('closeCart').addEventListener(
        'click',
        () => drawer(false)
    );

    $('overlay').addEventListener(
        'click',
        () => drawer(false)
    );


    // --------------------------------------------------------
    // SELECCIONAR FECHA DE ENTREGA
    // --------------------------------------------------------

    $('dateCatalog').addEventListener(
        'change',
        async (e) => {

            if (!e.target.value) {
                return;
            }

            selectedDate = e.target.value;

            $('checkoutDate').value =
                selectedDate;

            cart = [];

            saveCart();

            await fetchProducts();

            toast(
                'Fecha actualizada. El carrito se reinició para evitar mezclar fechas.'
            );
        }
    );


    // --------------------------------------------------------
    // ABRIR FORMULARIO DE PEDIDO
    // --------------------------------------------------------

    $('toCheckout').addEventListener('click', () => {

        if (cart.length === 0) {
            return;
        }

        drawer(false);
        checkout(true);

    });

    $('closeCheckout').addEventListener(
        'click',
        () => checkout(false)
    );

    $('checkoutOverlay').addEventListener('click', e => {

        if (e.target === $('checkoutOverlay')) {
            checkout(false);
        }

    });


    // --------------------------------------------------------
    // CAMBIAR FECHA DESDE EL FORMULARIO
    // --------------------------------------------------------

    $('checkoutDate').addEventListener(
        'change',
        async (e) => {

            if (!e.target.value) {
                return;
            }

            const newDate = e.target.value;

            if (newDate === selectedDate) {
                return;
            }

            selectedDate = newDate;

            $('dateCatalog').value =
                selectedDate;

            await fetchProducts();

            checkout(true);

            toast(
                'La fecha cambió. Comprueba la disponibilidad antes de confirmar.'
            );
        }
    );


    // ========================================================
    // 12. REGISTRAR PEDIDO DEL CLIENTE
    // POST /api/pedidos
    // ========================================================

    $('checkoutForm').addEventListener(
        'submit',
        async (e) => {

            e.preventDefault();

            if (!cart.length) {

                toast(
                    'Agrega una torta al carrito.',
                    true
                );

                return;
            }

            const btn = $('submitOrder');

            btn.disabled = true;
            btn.textContent = 'Guardando tu pedido…';

            const email =
                $('customerEmail').value.trim();

            try {

                // Enviar información del pedido al servidor
                const d = await api('/api/pedidos', {

                    method: 'POST',

                    body: JSON.stringify({

                        nombre: $('customerName').value,

                        correo: email,

                        telefono: $('customerPhone').value,

                        fecha_entrega: $('checkoutDate').value,

                        items: cart

                    })

                });

                lastOrder = {
                    ...d,
                    email
                };

                $('confirmedCode').textContent =
                    d.codigo;

                $('confirmedDetails').textContent =
                    `Entrega: ${prettierDate(d.fecha_entrega)} · Total: ${money(d.total_centimos)}`;

                $('checkoutFormArea').hidden = true;

                $('checkoutSuccess').hidden = false;

                // Vaciar carrito tras confirmar el pedido
                cart = [];

                saveCart();

                await fetchProducts();

                toast(
                    '¡Pedido registrado correctamente!'
                );

            } catch (err) {

                toast(err.message, true);

            } finally {

                btn.disabled = false;

                btn.innerHTML =
                    'Confirmar pedido · <span id="checkoutTotal">' +
                    money(totalCart()) +
                    '</span>';
            }
        }
    );


    // --------------------------------------------------------
    // COPIAR CÓDIGO DEL PEDIDO
    // --------------------------------------------------------

    $('copyCode').addEventListener('click', async () => {

        if (!lastOrder) {
            return;
        }

        try {

            await navigator.clipboard.writeText(
                lastOrder.codigo
            );

            toast('Código copiado.');

        } catch {

            toast(`Código: ${lastOrder.codigo}`);

        }
    });


    // --------------------------------------------------------
    // IR A SEGUIMIENTO DEL PEDIDO
    // --------------------------------------------------------

    $('goTrack').addEventListener('click', () => {

        checkout(false);

        navigate('pedidos');

        if (lastOrder) {

            $('trackingCode').value =
                lastOrder.codigo;

            $('trackingEmail').value =
                lastOrder.email;

            $('trackingForm').requestSubmit();
        }
    });


    // ========================================================
    // 13. CONSULTAR ESTADO DE PEDIDOS
    // GET /api/pedidos/CODIGO
    // ========================================================

    $('trackingForm').addEventListener(
        'submit',
        async (e) => {

            e.preventDefault();

            $('trackingResult').innerHTML = `
                <p style="font-size:12px;color:#9b806c">
                    Buscando tu pedido…
                </p>
            `;

            try {

                const code = $('trackingCode')
                    .value.trim().toUpperCase();

                const email = $('trackingEmail')
                    .value.trim();

                const d = await api(
                    `/api/pedidos/${encodeURIComponent(code)}?correo=${encodeURIComponent(email)}`
                );

                $('trackingResult').innerHTML =
                    renderStatus(d.pedido);

            } catch (err) {

                $('trackingResult').innerHTML = `
                    <div class="empty">
                        ${escapeHtml(err.message)}
                    </div>
                `;
            }
        }
    );


    // ========================================================
    // 14. INICIO DE SESIÓN DE ADMINISTRADORA
    // ========================================================

    $('adminLoginForm').addEventListener(
        'submit',
        async (e) => {

            e.preventDefault();

            try {

                await api('/api/admin/login', {

                    method: 'POST',

                    body: JSON.stringify({
                        pin: $('adminPin').value
                    })

                });

                $('adminPin').value = '';

                toast('Acceso concedido.');

                await checkAdmin();

            } catch (err) {

                toast(err.message, true);

            }
        }
    );


    // Actualizar pedidos
    $('refreshAdmin').addEventListener(
        'click',
        loadAdmin
    );


    // Cerrar sesión
    $('logoutAdmin').addEventListener(
        'click',
        async () => {

            try {

                await api('/api/admin/logout', {
                    method: 'POST'
                });

                await checkAdmin();

                toast('Sesión cerrada.');

            } catch (err) {

                toast(err.message, true);

            }
        }
    );


    // ========================================================
    // 15. CAMBIAR ESTADO DE LOS PEDIDOS
    // PATCH /api/admin/pedidos/CODIGO
    // ========================================================

    $('adminOrders').addEventListener(
        'change',
        async (e) => {

            const select = e.target.closest(
                '[data-order-state]'
            );

            if (!select) {
                return;
            }

            try {

                const d = await api(
                    `/api/admin/pedidos/${encodeURIComponent(select.dataset.orderState)}`,
                    {

                        method: 'PATCH',

                        body: JSON.stringify({
                            estado: select.value
                        })

                    }
                );

                toast(
                    `Pedido ${d.codigo}: ${d.estado}`
                );

                await loadAdmin();

            } catch (err) {

                select.value =
                    select.dataset.current;

                toast(err.message, true);

            }
        }
    );

});
