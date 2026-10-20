(() => {
  const message = document.getElementById('bankMsg');
  document.querySelectorAll('.bank-action').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button');
      if (button.disabled || !form.reportValidity()) return;
      button.disabled = true;
      message.textContent = '';
      try {
        const response = await fetch('/bank/' + form.dataset.operation, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({amount:form.elements.amount.value})
        });
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(result.error || 'Bank request failed.');
        updateStats(result.user);
        document.getElementById('bank-cash').textContent = '$' + formatCash(result.user.cash);
        document.getElementById('bank-balance').textContent = '$' + formatCash(result.user.bank || 0);
        message.className = 'success-msg';
        message.textContent = result.msg;
        form.reset();
      } catch (error) {
        message.className = 'error-msg';
        message.textContent = error.message || 'Unable to reach the bank. Please try again.';
      } finally { button.disabled = false; }
    });
  });
})();
