let PRODUCTS = [];
let CART = JSON.parse(localStorage.getItem('cart') || '[]');
let activeTeam = 'All';
let activeCategory = 'all';
const selectedSizes = {}; // productId -> size
const customization = {}; // productId -> { name, number }
let appliedCoupon = null; // { code, discount, newTotal } or null

const CATEGORY_LABELS = {
  all: 'All Kits',
  'new-season': 'New Season',
  retro: 'Retro Jerseys',
  customized: 'Customized',
  sale: 'Clearance Sale'
};

function saveCart() {
  localStorage.setItem('cart', JSON.stringify(CART));
  appliedCoupon = null; // cart changed — require re-applying so discount stays accurate
  renderCart();
}

async function loadProducts() {
  const res = await fetch('/api/products');
  PRODUCTS = await res.json();
  renderCategoryTabs();
  renderFilters();
  renderGrid();
  renderCart();
}

function renderCategoryTabs() {
  const cats = ['all', ...new Set(PRODUCTS.map(p => p.category).filter(Boolean))];
  const el = document.getElementById('category-tabs');
  el.innerHTML = cats.map(c =>
    `<button data-cat="${c}" class="${c === activeCategory ? 'active' : ''}">${CATEGORY_LABELS[c] || c}</button>`
  ).join('');
  el.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      renderCategoryTabs();
      renderGrid();
    });
  });
}

function renderFilters() {
  const teams = ['All', ...new Set(PRODUCTS.map(p => p.team))];
  const el = document.getElementById('filters');
  el.innerHTML = teams.map(t =>
    `<button data-team="${t}" class="${t === activeTeam ? 'active' : ''}">${t}</button>`
  ).join('');
  el.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTeam = btn.dataset.team;
      renderFilters();
      renderGrid();
    });
  });
}

function renderGrid() {
  const grid = document.getElementById('grid');
  let list = activeTeam === 'All' ? PRODUCTS : PRODUCTS.filter(p => p.team === activeTeam);
  if (activeCategory !== 'all') list = list.filter(p => p.category === activeCategory);
  grid.innerHTML = list.map(p => cardHTML(p)).join('') || '<p class="empty-msg">No kits in this range yet.</p>';

  list.forEach(p => {
    const card = grid.querySelector(`[data-product="${p.id}"]`);
    card.querySelectorAll('.sizes button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        selectedSizes[p.id] = btn.dataset.size;
        card.querySelectorAll('.sizes button').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        updateAddButtonState(p, card);
      });
    });
    if (p.customizable) {
      const nameInput = card.querySelector('.custom-name');
      const numberInput = card.querySelector('.custom-number');
      const sync = () => {
        customization[p.id] = { name: nameInput.value.trim(), number: numberInput.value.trim() };
        updateAddButtonState(p, card);
      };
      nameInput.addEventListener('input', sync);
      numberInput.addEventListener('input', sync);
    }
    card.querySelector('.add-btn').addEventListener('click', () => addToCart(p));
  });
}

function updateAddButtonState(product, card) {
  const btn = card.querySelector('.add-btn');
  const hasSize = !!selectedSizes[product.id];
  if (!hasSize) {
    btn.disabled = true;
    btn.textContent = 'Select a size';
    return;
  }
  if (product.customizable) {
    const c = customization[product.id] || {};
    if (!c.name || !c.number) {
      btn.disabled = true;
      btn.textContent = 'Add name & number';
      return;
    }
  }
  btn.disabled = false;
  btn.textContent = 'Add to cart';
}

function cardHTML(p) {
  const sizesHTML = Object.entries(p.sizes).map(([size, stock]) =>
    `<button data-size="${size}" ${stock <= 0 ? 'disabled' : ''}>${size}</button>`
  ).join('');
  const customHTML = p.customizable ? `
      <div class="custom-fields">
        <input type="text" class="custom-name" placeholder="Name for jersey" maxlength="12">
        <input type="text" class="custom-number" placeholder="No." maxlength="2" inputmode="numeric">
      </div>` : '';
  return `
  <div class="card" data-product="${p.id}">
    <div class="img"><img src="${p.image}" alt="${p.team} ${p.name}" loading="lazy"></div>
    <div class="body">
      <div class="team">${p.team}</div>
      <h3>${p.name}</h3>
      <div class="sizes">${sizesHTML}</div>
      ${customHTML}
      <div class="price">₹${p.price.toFixed(2)}</div>
      <button class="add-btn" disabled>Select a size</button>
    </div>
  </div>`;
}

function addToCart(product) {
  const size = selectedSizes[product.id];
  if (!size) return;
  const custom = product.customizable ? customization[product.id] : null;
  if (product.customizable && (!custom || !custom.name || !custom.number)) return;

  const existing = CART.find(i =>
    i.productId === product.id &&
    i.size === size &&
    (i.customName || '') === (custom?.name || '') &&
    (i.customNumber || '') === (custom?.number || '')
  );
  if (existing) {
    existing.qty += 1;
  } else {
    CART.push({
      productId: product.id, size, qty: 1,
      name: product.name, team: product.team, price: product.price, image: product.image,
      customName: custom?.name || '', customNumber: custom?.number || ''
    });
  }
  saveCart();
  openCart();
}

function renderCart() {
  document.getElementById('cart-count').textContent = CART.reduce((s, i) => s + i.qty, 0);
  const el = document.getElementById('cart-items');
  el.innerHTML = CART.map((item, idx) => `
    <div class="cart-line">
      <img src="${item.image}" alt="">
      <div class="info">
        <div>${item.team} — ${item.name}</div>
        <div>Size ${item.size} · ₹${item.price.toFixed(2)}</div>
        ${item.customName ? `<div style="color:var(--gold)">${item.customName} · #${item.customNumber}</div>` : ''}
        <div class="qty-ctrl">
          <button data-idx="${idx}" data-action="dec">−</button>
          <span>${item.qty}</span>
          <button data-idx="${idx}" data-action="inc">+</button>
        </div>
      </div>
      <button class="remove" data-idx="${idx}">Remove</button>
    </div>
  `).join('') || '<p class="empty-msg">Your cart is empty.</p>';

  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (btn.dataset.action === 'inc') CART[idx].qty += 1;
      if (btn.dataset.action === 'dec') CART[idx].qty = Math.max(1, CART[idx].qty - 1);
      saveCart();
    });
  });
  el.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', () => {
      CART.splice(Number(btn.dataset.idx), 1);
      saveCart();
    });
  });

  const subtotal = CART.reduce((s, i) => s + i.price * i.qty, 0);
  const couponLine = document.getElementById('coupon-line');
  if (appliedCoupon) {
    couponLine.style.display = 'flex';
    document.getElementById('coupon-label').textContent = `Coupon ${appliedCoupon.code}`;
    document.getElementById('coupon-amount').textContent = `−₹${appliedCoupon.discount.toFixed(2)}`;
    document.getElementById('cart-total-amount').textContent = `₹${appliedCoupon.newTotal.toFixed(2)}`;
  } else {
    couponLine.style.display = 'none';
    document.getElementById('cart-total-amount').textContent = `₹${subtotal.toFixed(2)}`;
  }
}

function openCart() {
  document.getElementById('cart-drawer').classList.add('open');
  document.getElementById('overlay').classList.add('open');
}
function closeCart() {
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('checkout-form').classList.remove('open');
}

document.getElementById('cart-toggle').addEventListener('click', openCart);
document.getElementById('close-cart').addEventListener('click', closeCart);
document.getElementById('overlay').addEventListener('click', closeCart);

document.getElementById('coupon-apply').addEventListener('click', async () => {
  const errEl = document.getElementById('coupon-error');
  errEl.style.display = 'none';
  const code = document.getElementById('coupon-input').value.trim();
  if (!code) return;
  const subtotal = CART.reduce((s, i) => s + i.price * i.qty, 0);
  if (subtotal <= 0) return;

  try {
    const res = await fetch('/api/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, subtotal })
    });
    const data = await res.json();
    if (!res.ok) {
      appliedCoupon = null;
      errEl.textContent = data.error || 'Invalid coupon';
      errEl.style.display = 'block';
      renderCart();
      return;
    }
    appliedCoupon = { code: data.code, discount: data.discount, newTotal: data.newTotal };
    renderCart();
  } catch (err) {
    errEl.textContent = 'Network error. Please try again.';
    errEl.style.display = 'block';
  }
});

document.getElementById('checkout-btn').addEventListener('click', () => {
  if (CART.length === 0) return;
  document.getElementById('checkout-form').classList.add('open');
});

document.querySelectorAll('input[name="payment-method"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const payBtn = document.getElementById('pay-btn');
    payBtn.textContent = radio.value === 'cod' && radio.checked ? 'Place order (Cash on Delivery)' : 'Pay now';
  });
});

document.getElementById('checkout-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('checkout-error');
  errEl.style.display = 'none';

  const phone = document.getElementById('cf-phone').value.trim();
  const pincode = document.getElementById('cf-pincode').value.trim();
  const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;

  if (!/^[0-9]{10}$/.test(phone)) {
    errEl.textContent = 'Please enter a valid 10-digit phone number.';
    errEl.style.display = 'block';
    return;
  }
  if (!/^[0-9]{6}$/.test(pincode)) {
    errEl.textContent = 'Please enter a valid 6-digit PIN code.';
    errEl.style.display = 'block';
    return;
  }

  const customer = {
    name: document.getElementById('cf-name').value.trim(),
    email: document.getElementById('cf-email').value.trim(),
    phone,
    address1: document.getElementById('cf-address1').value.trim(),
    address2: document.getElementById('cf-address2').value.trim(),
    city: document.getElementById('cf-city').value.trim(),
    state: document.getElementById('cf-state').value.trim(),
    pincode
  };
  const items = CART.map(i => ({
    productId: i.productId, size: i.size, qty: i.qty,
    customName: i.customName || undefined, customNumber: i.customNumber || undefined
  }));

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, customer, paymentMethod, couponCode: appliedCoupon?.code })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Something went wrong.';
      errEl.style.display = 'block';
      return;
    }

    // Cash on Delivery: order is placed immediately, nothing to pay online now.
    if (data.cod) {
      localStorage.removeItem('cart');
      window.location.href = `/checkout-success.html?order=${data.orderId}&cod=1&email=${encodeURIComponent(customer.email)}`;
      return;
    }

    // No Razorpay keys configured yet: server already simulated the payment.
    if (!data.razorpayOrderId) {
      localStorage.removeItem('cart');
      window.location.href = `/checkout-success.html?order=${data.orderId}&simulated=1&email=${encodeURIComponent(customer.email)}`;
      return;
    }

    // Real Razorpay flow: open the hosted checkout popup. We never see or
    // touch the card details ourselves — Razorpay handles that entirely.
    const rzp = new Razorpay({
      key: data.keyId,
      amount: data.amount,
      currency: data.currency,
      name: 'Matchday Kits',
      description: 'Order payment',
      order_id: data.razorpayOrderId,
      prefill: {
        name: data.customer.name,
        email: data.customer.email
      },
      handler: async function (response) {
        const confirmRes = await fetch('/api/checkout/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: data.orderId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          })
        });
        if (confirmRes.ok) {
          localStorage.removeItem('cart');
          window.location.href = `/checkout-success.html?order=${data.orderId}&email=${encodeURIComponent(data.customer.email)}`;
        } else {
          window.location.href = `/checkout-cancel.html?order=${data.orderId}`;
        }
      },
      modal: {
        ondismiss: function () {
          fetch('/api/checkout/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: data.orderId })
          });
        }
      },
      theme: { color: '#E3A93E' }
    });
    rzp.open();
  } catch (err) {
    errEl.textContent = 'Network error. Please try again.';
    errEl.style.display = 'block';
  }
});

document.querySelectorAll('.footer-col a[data-cat]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    activeCategory = link.dataset.cat;
    renderCategoryTabs();
    renderGrid();
    document.getElementById('category-tabs').scrollIntoView({ behavior: 'smooth' });
  });
});

loadProducts();
