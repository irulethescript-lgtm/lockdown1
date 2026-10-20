(() => {
  const browser = document.querySelector('.item-browser');
  if (!browser) return;
  const list = document.getElementById('item-list');
  const rows = [...list.querySelectorAll('.item-row')];
  const search = document.getElementById('item-search');
  const sort = document.getElementById('item-sort');
  const feedback = document.getElementById('item-feedback');
  const categoryButtons = [...browser.querySelectorAll('[data-category]')].filter(node => node.tagName === 'BUTTON');
  let category = 'all';
  let busy = false;
  let sellingRow = null;

  function filter() {
    const query = search.value.trim().toLocaleLowerCase();
    const comparators = {
      name: (a, b) => a.dataset.name.localeCompare(b.dataset.name),
      'price-up': (a, b) => Number(a.dataset.price) - Number(b.dataset.price),
      'price-down': (a, b) => Number(b.dataset.price) - Number(a.dataset.price),
      quantity: (a, b) => Number(b.dataset.quantity) - Number(a.dataset.quantity),
    };
    let visible = 0;
    rows.sort(comparators[sort.value] || comparators.name).forEach(row => {
      row.hidden = !(category === 'all' || row.dataset.category === category) ||
        !(row.dataset.name + ' ' + row.dataset.description).toLocaleLowerCase().includes(query);
      if (!row.hidden) visible++;
      list.appendChild(row);
    });
    document.getElementById('item-result-count').textContent = visible + ' item types found';
    document.getElementById('item-empty').hidden = visible !== 0;
  }
  categoryButtons.forEach(button => button.addEventListener('click', () => {
    category = button.dataset.category;
    categoryButtons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    filter();
  }));
  search.addEventListener('input', filter);
  sort.addEventListener('change', filter);
  // Preserve category links from the previous shop and equipment pages.
  const tab = new URLSearchParams(location.search).get('tab');
  const initial = { primary: 'primary', secondary: 'secondary', weapons: 'melee', armor: 'armor', gear: 'gear', items: 'all', drugs: 'drugs' }[tab];
  if (initial) categoryButtons.find(b => b.dataset.category === initial)?.click();
  filter();

  const minutes = seconds => Math.ceil(seconds / 60) + 'm';
  function recovery() {
    const now = Math.floor(Date.now() / 1000);
    document.querySelectorAll('[data-cooldown]').forEach(node => {
      const remaining = Number(node.dataset.cooldown) - now;
      node.textContent = remaining > 0 ? minutes(remaining) : 'Ready';
    });
    rows.forEach(row => {
      const button = row.querySelector('[data-action="use"]');
      if (!button) return;
      const remaining = Number(button.dataset.ready) - now;
      button.disabled = busy || remaining > 0;
      button.textContent = remaining > 0 ? 'Wait ' + minutes(remaining) : (button.dataset.useLabel||'Use');
      const label = row.querySelector('.item-recovery');
      if (remaining > 0 && label) label.textContent = 'Ready in ' + minutes(remaining);
      else if (label && label.dataset.original) label.textContent = label.dataset.original;
    });
  }
  document.querySelectorAll('.item-recovery').forEach(node => node.dataset.original = node.textContent);
  recovery();
  setInterval(recovery, 1000);

  function message(text, error = false) {
    feedback.hidden = false;
    feedback.textContent = text;
    feedback.classList.toggle('error', error);
  }
  const notice=sessionStorage.getItem('lockdown-item-notice');
  if(notice){sessionStorage.removeItem('lockdown-item-notice');message(notice);}
  async function mutate(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.redirected && new URL(response.url).pathname === '/login') throw new Error('Your session expired. Sign in again.');
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Request failed. Please refresh and try again.');
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || 'Request failed. Please try again.');
    if (result.user && typeof updateStats === 'function') updateStats(result.user);
    return result;
  }
  function setBusy(value) {
    busy = value;
    list.querySelectorAll('button').forEach(button => button.disabled = value || button.dataset.soldOut === 'true');
    document.querySelectorAll('#item-sell-form button').forEach(button => button.disabled = value);
    recovery();
  }
  const dialog = document.getElementById('item-sell-dialog');
  const form = document.getElementById('item-sell-form');
  const sellQuantity = document.getElementById('item-sell-quantity');
  const sellPrice = document.getElementById('item-sell-price');
  const sellFeedback = document.getElementById('item-sell-feedback');
  document.getElementById('item-sell-cancel')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('cancel', event => { if (busy) event.preventDefault(); });

  list.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button || busy || button.disabled) return;
    const row = button.closest('.item-row');
    const { key, type, name } = row.dataset;
    const action = button.dataset.action;
    if (action === 'list') {
      sellingRow = row;
      document.getElementById('item-sell-name').textContent = name;
      sellQuantity.max = Math.min(1000000, Number(row.dataset.quantity));
      sellQuantity.value = 1;
      sellPrice.value = '';
      sellFeedback.textContent = '';
      dialog.showModal();
      sellQuantity.focus();
      return;
    }
    const body = { item_key: key, item_type: type };
    let path;
    if (action === 'buy') {
      const input = row.querySelector('input[type="number"]');
      if (!input.reportValidity()) return;
      body.quantity = Number(input.value);
      path = '/marketplace/buy';
    } else if (action === 'use') {
      path = '/inventory/use';
      if(row.dataset.useKind==='target'){
        const input=row.querySelector('.item-target');
        if(!input.value||!input.reportValidity()){message('Enter a target player ID.',true);return;}
        body.target_id=Number(input.value);
      }
      if(row.dataset.useKind==='piggy'){
        body.action=button.dataset.operation;
        if(body.action==='deposit'){
          const input=row.querySelector('.item-deposit');
          if(!input.value||!input.reportValidity()){message('Enter a deposit amount.',true);return;}
          body.amount=Number(input.value);
        }
      }
    }
    else if (action === 'equip' || action === 'unequip') {
      path = '/equipment/equip';
      Object.assign(body, { slot: type, key, action });
    } else return;
    setBusy(true);
    try {
      const result = await mutate(path, body);
      message(result.msg || 'Saved.');
      if(action==='buy' && Number.isInteger(result.stock)) {
        row.querySelector('.market-stock b').textContent=result.stock;
        row.querySelector('input[type="number"]').max=Math.min(100,result.stock);
        button.dataset.soldOut=String(result.stock===0);
        if(result.stock===0)button.textContent='Sold out';
      }
      if (action !== 'buy') {
        sessionStorage.setItem('lockdown-item-notice',result.msg||'Saved.');
        location.reload();
        return;
      }
    } catch (error) { message(error.message, true); }
    setBusy(false);
  });

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !sellingRow || !form.reportValidity()) return;
    const quantity = Number(sellQuantity.value), price = Number(sellPrice.value);
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(price)) {
      sellFeedback.textContent = 'Enter a whole quantity and total price.';
      return;
    }
    setBusy(true);
    try {
      await mutate('/inventory/list', { item_key: sellingRow.dataset.key, item_type: sellingRow.dataset.type, quantity, price });
      location.reload();
    } catch (error) {
      sellFeedback.textContent = error.message;
      setBusy(false);
    }
  });
})();

const refresh=document.getElementById('market-refresh');
if(refresh)setInterval(()=>{if(!document.hidden && Date.now()/1000>=Number(refresh.dataset.refresh))location.reload();},15000);
