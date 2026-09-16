/* ═══ TRANSACTIONS PAGE ═══ */
const TransactionsPage = {
    currentPage: 1,
    totalPages: 1,

    async render() {
        app.setContent(`
      <div class="page">
        <div class="page-header">
          <h1 class="page-title">📜 Transaction History</h1>
          <p class="page-subtitle">Immutable ledger of all your financial activity</p>
        </div>

        <div class="card">
          <div id="tx-content">
            <div class="loader-container" style="min-height:200px">
              <div class="loader-spinner"></div>
            </div>
          </div>
        </div>
      </div>
    `);

        await this.loadTransactions(1);
    },

    async loadTransactions(page) {
        this.currentPage = page;
        try {
            const data = await app.api(`/api/transactions?page=${page}&limit=15`);
            const container = document.getElementById('tx-content');

            if (!data.transactions || data.transactions.length === 0) {
                container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📭</div>
            <div class="empty-state-title">No transactions yet</div>
            <div class="empty-state-desc">Your transaction history will appear here</div>
          </div>
        `;
                return;
            }

            this.totalPages = data.pagination.totalPages;

            container.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Direction</th>
              <th>Counterparty</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Date</th>
              <th>TX Hash</th>
            </tr>
          </thead>
          <tbody>
            ${data.transactions.map(tx => `
              <tr>
                <td>
                  <span style="font-size:1.1rem">${tx.direction === 'sent' ? '↗️' : '↙️'}</span>
                  ${tx.direction === 'sent' ? 'Sent' : 'Received'}
                </td>
                <td style="font-weight:500; color:var(--text-primary)">${app.escapeHtml(tx.counterparty || 'System')}</td>
                <td>
                  <span class="tx-amount ${tx.direction}" style="font-size:0.9rem">
                    ${tx.direction === 'sent' ? '-' : '+'}₹${app.formatCurrency(tx.amount)}
                  </span>
                </td>
                <td><span class="tx-status ${tx.status}">${tx.status}</span></td>
                <td style="font-size:0.8rem">${app.formatDate(tx.timestamp)}</td>
                <td style="font-family:var(--font-mono); font-size:0.7rem; color:var(--text-muted)">${tx.txHash?.substring(0, 12)}...</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        ${this.totalPages > 1 ? `
          <div class="pagination">
            <button class="btn btn-ghost btn-sm" ${this.currentPage <= 1 ? 'disabled' : ''} 
              onclick="TransactionsPage.loadTransactions(${this.currentPage - 1})">← Prev</button>
            <span class="pagination-info">Page ${this.currentPage} of ${this.totalPages}</span>
            <button class="btn btn-ghost btn-sm" ${this.currentPage >= this.totalPages ? 'disabled' : ''} 
              onclick="TransactionsPage.loadTransactions(${this.currentPage + 1})">Next →</button>
          </div>
        ` : ''}
      `;
        } catch (err) {
            app.toast('Failed to load transactions', 'error');
        }
    }
};
