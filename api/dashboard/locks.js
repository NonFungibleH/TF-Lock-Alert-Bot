const { Pool } = require('pg');

module.exports = async (req, res) => {
  try {
    const pool = new Pool({ 
      connectionString: process.env.POSTGRES_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    // Query all locks with all available data
    const result = await pool.query(`
      SELECT 
        transaction_id,
        chain,
        source,
        type,
        token_symbol,
        token_address,
        detection_price,
        detection_mcap,
        detection_liquidity,
        lock_score,
        locked_percent,
        native_locked_usd,
        explorer_link,
        contract_address,
        event_name,
        created_at,
        enriched_at
      FROM lock_alerts
      ORDER BY created_at DESC
    `);
    
    await pool.end();
    
    // Convert to JSON for the frontend
    const locks = result.rows.map(lock => ({
      'Transaction ID': lock.transaction_id,
      'Time': new Date(lock.created_at).toLocaleString(),
      'Chain': lock.chain,
      'Source': lock.source,
      'Type': lock.type,
      'Token': lock.token_symbol || 'Unknown',
      'Token Address': lock.token_address,
      'Score': lock.lock_score || 0,
      'Price': lock.detection_price ? `$${lock.detection_price}` : 'N/A',
      'Market Cap': lock.detection_mcap ? `$${(lock.detection_mcap / 1000000).toFixed(2)}M` : 'N/A',
      'Liquidity': lock.detection_liquidity ? `$${(lock.detection_liquidity / 1000).toFixed(0)}K` : 'N/A',
      'Locked %': lock.locked_percent ? `${lock.locked_percent.toFixed(1)}%` : 'N/A',
      'Native Locked USD': lock.native_locked_usd ? `$${lock.native_locked_usd.toLocaleString()}` : 'N/A',
      'Explorer Link': lock.explorer_link,
      'Enriched': lock.enriched_at ? 'Yes' : 'No'
    }));
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Lock Alerts Database</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  
  <!-- AG Grid CSS -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/styles/ag-grid.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/styles/ag-theme-alpine.css">
  
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a1a;
      color: #fff;
      padding: 20px;
    }
    
    .header {
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 15px;
    }
    
    h1 {
      color: #00e5ff;
      font-size: 28px;
      font-weight: 900;
    }
    
    .stats {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    
    .stat {
      background: rgba(0, 229, 255, 0.1);
      border: 1px solid rgba(0, 229, 255, 0.3);
      border-radius: 8px;
      padding: 10px 20px;
    }
    
    .stat-label {
      font-size: 12px;
      color: rgba(0, 229, 255, 0.7);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: #00e5ff;
      margin-top: 5px;
    }
    
    .controls {
      display: flex;
      gap: 10px;
      margin-bottom: 15px;
      flex-wrap: wrap;
    }
    
    button {
      background: rgba(0, 229, 255, 0.2);
      border: 2px solid #00e5ff;
      color: #00e5ff;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
    }
    
    button:hover {
      background: rgba(0, 229, 255, 0.3);
      transform: translateY(-2px);
    }
    
    input[type="text"] {
      background: rgba(0, 229, 255, 0.05);
      border: 1px solid rgba(0, 229, 255, 0.3);
      color: #00e5ff;
      padding: 10px 15px;
      border-radius: 6px;
      font-size: 14px;
      min-width: 250px;
    }
    
    input[type="text"]:focus {
      outline: none;
      border-color: #00e5ff;
      background: rgba(0, 229, 255, 0.1);
    }
    
    #myGrid {
      height: calc(100vh - 220px);
      width: 100%;
      border-radius: 8px;
      overflow: hidden;
    }
    
    /* Custom AG Grid theme */
    .ag-theme-alpine {
      --ag-background-color: #1a1a2e;
      --ag-header-background-color: #0f0f1e;
      --ag-odd-row-background-color: #16162a;
      --ag-header-foreground-color: #00e5ff;
      --ag-foreground-color: #e0e0e0;
      --ag-border-color: rgba(0, 229, 255, 0.2);
      --ag-row-hover-color: rgba(0, 229, 255, 0.1);
      --ag-selected-row-background-color: rgba(0, 229, 255, 0.2);
    }
    
    .score-high {
      color: #00ff88;
      font-weight: 700;
    }
    
    .score-medium {
      color: #ffbb00;
      font-weight: 600;
    }
    
    .score-low {
      color: #ff4444;
      font-weight: 600;
    }
    
    @media (max-width: 768px) {
      .header {
        flex-direction: column;
        align-items: flex-start;
      }
      
      #myGrid {
        height: calc(100vh - 280px);
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>🔒 Lock Alerts Database</h1>
      <p style="color: rgba(0, 229, 255, 0.7); margin-top: 5px;">
        Real-time lock event tracking across chains
      </p>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="stat-label">Total Locks</div>
        <div class="stat-value" id="totalLocks">${locks.length}</div>
      </div>
      <div class="stat">
        <div class="stat-label">High Score (70+)</div>
        <div class="stat-value" id="highScore">${locks.filter(l => l.Score >= 70).length}</div>
      </div>
    </div>
  </div>
  
  <div class="controls">
    <input type="text" id="quickFilter" placeholder="🔍 Search across all columns...">
    <button onclick="exportToCSV()">📥 Export to CSV</button>
    <button onclick="exportToExcel()">📊 Export to Excel</button>
    <button onclick="clearFilters()">🔄 Clear Filters</button>
    <button onclick="refreshData()">♻️ Refresh Data</button>
  </div>
  
  <div id="myGrid" class="ag-theme-alpine"></div>

  <!-- AG Grid JavaScript -->
  <script src="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/dist/ag-grid-community.min.js"></script>
  
  <!-- SheetJS for Excel export -->
  <script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
  
  <script>
    // Lock data from server
    const locks = ${JSON.stringify(locks)};
    
    // Custom cell renderer for scores
    function scoreCellRenderer(params) {
      const score = params.value;
      if (!score || score === 0) return 'N/A';
      
      let className = 'score-low';
      if (score >= 70) className = 'score-high';
      else if (score >= 50) className = 'score-medium';
      
      return '<span class="' + className + '">' + score + '</span>';
    }
    
    // Custom cell renderer for links
    function linkCellRenderer(params) {
      if (!params.value) return 'N/A';
      return '<a href="' + params.value + '" target="_blank" style="color: #00e5ff;">View</a>';
    }
    
    // Grid options
    const gridOptions = {
      columnDefs: [
        { field: 'Time', sortable: true, filter: 'agDateColumnFilter', width: 180 },
        { field: 'Chain', sortable: true, filter: true, width: 120 },
        { field: 'Token', sortable: true, filter: true, width: 120 },
        { field: 'Score', sortable: true, filter: 'agNumberColumnFilter', width: 100, cellRenderer: scoreCellRenderer },
        { field: 'Price', sortable: true, filter: true, width: 120 },
        { field: 'Market Cap', sortable: true, filter: true, width: 130 },
        { field: 'Liquidity', sortable: true, filter: true, width: 130 },
        { field: 'Locked %', sortable: true, filter: true, width: 120 },
        { field: 'Native Locked USD', sortable: true, filter: true, width: 170 },
        { field: 'Source', sortable: true, filter: true, width: 140 },
        { field: 'Type', sortable: true, filter: true, width: 100 },
        { field: 'Token Address', sortable: true, filter: true, width: 180 },
        { field: 'Explorer Link', width: 120, cellRenderer: linkCellRenderer },
        { field: 'Transaction ID', sortable: true, filter: true, width: 200 },
        { field: 'Enriched', sortable: true, filter: true, width: 100 }
      ],
      rowData: locks,
      defaultColDef: {
        sortable: true,
        filter: true,
        resizable: true,
        floatingFilter: true
      },
      pagination: true,
      paginationPageSize: 50,
      paginationPageSizeSelector: [25, 50, 100, 200],
      animateRows: true,
      rowSelection: 'multiple',
      enableCellTextSelection: true,
      suppressColumnVirtualisation: true
    };
    
    // Create the grid
    const gridDiv = document.querySelector('#myGrid');
    const gridApi = agGrid.createGrid(gridDiv, gridOptions);
    
    // Quick filter
    document.getElementById('quickFilter').addEventListener('input', function(e) {
      gridApi.setGridOption('quickFilterText', e.target.value);
    });
    
    // Export to CSV
    function exportToCSV() {
      gridApi.exportDataAsCsv({
        fileName: 'lock-alerts-' + new Date().toISOString().split('T')[0] + '.csv'
      });
    }
    
    // Export to Excel using SheetJS
    function exportToExcel() {
      // Get all row data
      const rowData = [];
      gridApi.forEachNodeAfterFilterAndSort(node => {
        rowData.push(node.data);
      });
      
      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(rowData);
      
      // Create workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Lock Alerts');
      
      // Save file
      XLSX.writeFile(wb, 'lock-alerts-' + new Date().toISOString().split('T')[0] + '.xlsx');
    }
    
    // Clear all filters
    function clearFilters() {
      gridApi.setFilterModel(null);
      document.getElementById('quickFilter').value = '';
      gridApi.setGridOption('quickFilterText', '');
    }
    
    // Refresh data
    function refreshData() {
      window.location.reload();
    }
    
    console.log('Dashboard loaded with', locks.length, 'locks');
  </script>
</body>
</html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; padding: 40px; background: #0a0a1a; color: #fff;">
          <h1 style="color: #ff4444;">Dashboard Error</h1>
          <p style="color: #ff8888;">${err.message}</p>
          <pre style="background: #1a1a2e; padding: 20px; border-radius: 8px; color: #00e5ff;">${err.stack}</pre>
        </body>
      </html>
    `);
  }
};
