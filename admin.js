async function checkSession() {
  const res = await fetch('/api/admin/session');
  const data = await res.json();
  if (data.isAdmin) showDashboard();
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const password = document.getElementById('login-password').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (res.ok) {
    showDashboard();
  } else {
    document.getElementById('login-error').style.display = 'block';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.reload();
});

function showDashboard() {
  document.getElementById('login-box').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  loadOrders();
  loadProducts();
  loadCoupons();
}

document.querySelectorAll('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['orders', 'inventory', 'coupons'].forEach(tab => {
      document.getElementById(`tab-${tab}`).style.display = btn.dataset.tab === tab ? 'block' : 'none';
    });
  });
});

async function loadOrders() {
  const res = await fetch('/api/admin/orders');
  const orders = await res.json();
  const body = document.getElementById('orders-body');
  body.innerHTML = orders.map(o => `
    <tr>
      <td>${o.id.slice(0, 8)}</td>
      <td>
        ${o.customer.name}<br>
        <span style="color:#8ea296;font-size:12px">${o.customer.email} · ${o.customer.phone || ''}</span><br>
        <span style="color:#8ea296;font-size:12px">${o.customer.address1 || ''}${o.customer.address2 ? ', ' + o.customer.address2 : ''}, ${o.customer.city || ''}, ${o.customer.state || ''} - ${o.customer.pincode || ''}</span>
      </td>
      <td>${o.items.map(i => `${i.qty}× ${i.size}${i.customName ? ` (${i.customName} #${i.customNumber})` : ''}`).join(', ')}</td>
      <td>₹${o.total.toFixed(2)}<br><span style="color:#8ea296;font-size:11px">${o.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Paid online'}</span></td>
      <td><span class="badge ${o.status}">${o.status === 'cod' ? 'COD — Collect on delivery' : o.status}</span></td>
      <td>${(o.status === 'paid' || o.status === 'cod') ? `<button class="small-btn" data-fulfill="${o.id}">Mark fulfilled</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="6" style="color:#8ea296">No orders yet.</td></tr>';

  body.querySelectorAll('[data-fulfill]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/admin/orders/${btn.dataset.fulfill}/fulfill`, { method: 'POST' });
      loadOrders();
    });
  });
}

async function loadProducts() {
  const res = await fetch('/api/products');
  const products = await res.json();
  const body = document.getElementById('products-body');
  body.innerHTML = products.map(p => `
    <tr data-id="${p.id}">
      <td>${p.team}</td>
      <td>${p.name}</td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#8ea296;">${p.category || 'new-season'}</td>
      <td>₹${p.price.toFixed(2)}</td>
      <td><input class="stock-input" data-size="S" value="${p.sizes.S ?? 0}"></td>
      <td><input class="stock-input" data-size="M" value="${p.sizes.M ?? 0}"></td>
      <td><input class="stock-input" data-size="L" value="${p.sizes.L ?? 0}"></td>
      <td><input class="stock-input" data-size="XL" value="${p.sizes.XL ?? 0}"></td>
      <td><button class="small-btn" data-save="${p.id}">Save</button></td>
    </tr>
  `).join('');

  body.querySelectorAll('[data-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = body.querySelector(`tr[data-id="${btn.dataset.save}"]`);
      const sizes = {};
      row.querySelectorAll('.stock-input').forEach(inp => sizes[inp.dataset.size] = Number(inp.value));
      await fetch(`/api/admin/products/${btn.dataset.save}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sizes })
      });
      btn.textContent = 'Saved ✓';
      setTimeout(() => btn.textContent = 'Save', 1200);
    });
  });
}

document.getElementById('show-new-product').addEventListener('click', () => {
  document.getElementById('new-product-form').classList.toggle('open');
});

document.getElementById('new-product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    team: document.getElementById('np-team').value,
    name: document.getElementById('np-name').value,
    category: document.getElementById('np-category').value,
    price: document.getElementById('np-price').value,
    image: document.getElementById('np-image').value,
    sizes: {
      S: Number(document.getElementById('np-s').value || 0),
      M: Number(document.getElementById('np-m').value || 0),
      L: Number(document.getElementById('np-l').value || 0),
      XL: Number(document.getElementById('np-xl').value || 0)
    }
  };
  await fetch('/api/admin/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  e.target.reset();
  e.target.classList.remove('open');
  loadProducts();
});

async function loadCoupons() {
  const res = await fetch('/api/admin/coupons');
  const coupons = await res.json();
  const body = document.getElementById('coupons-body');
  body.innerHTML = coupons.map(c => `
    <tr data-id="${c.id}">
      <td style="font-family:'IBM Plex Mono',monospace;">${c.code}</td>
      <td>${c.type === 'percent' ? c.value + '% off' : '₹' + c.value + ' off'}</td>
      <td>₹${c.minOrder || 0}</td>
      <td>${c.usedCount}${c.usageLimit ? ' / ' + c.usageLimit : ''}</td>
      <td><span class="badge ${c.active ? 'paid' : 'cancelled'}">${c.active ? 'active' : 'disabled'}</span></td>
      <td>
        <button class="small-btn" data-toggle="${c.id}" data-active="${c.active}">${c.active ? 'Disable' : 'Enable'}</button>
        <button class="small-btn" data-delete="${c.id}" style="background:var(--danger);">Delete</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" style="color:#8ea296">No coupons yet.</td></tr>';

  body.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const nowActive = btn.dataset.active !== 'true';
      await fetch(`/api/admin/coupons/${btn.dataset.toggle}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: nowActive })
      });
      loadCoupons();
    });
  });
  body.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/admin/coupons/${btn.dataset.delete}`, { method: 'DELETE' });
      loadCoupons();
    });
  });
}

document.getElementById('show-new-coupon').addEventListener('click', () => {
  document.getElementById('new-coupon-form').classList.toggle('open');
});

document.getElementById('new-coupon-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    code: document.getElementById('nc-code').value,
    type: document.getElementById('nc-type').value,
    value: document.getElementById('nc-value').value,
    minOrder: document.getElementById('nc-minorder').value,
    usageLimit: document.getElementById('nc-limit').value
  };
  const res = await fetch('/api/admin/coupons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const data = await res.json();
    alert(data.error || 'Could not create coupon');
    return;
  }
  e.target.reset();
  e.target.classList.remove('open');
  loadCoupons();
});

checkSession();
