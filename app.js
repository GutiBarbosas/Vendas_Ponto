/* ==========================================================================
   Dashboard de Registro e Venda — leitura direta de BASE.csv (mesma pasta)
   Sem frameworks, sem build tools. Para atualizar os dados, basta substituir
   o arquivo BASE.csv por uma nova exportação da planilha, mantendo as
   colunas: NOME,LOJA,DT,DIA,STATUS_RH,VENDA,GERENTE,SUPER
   ========================================================================== */

const DIA_LABELS = {
  SEG: 'Segunda-feira', TER: 'Terça-feira', QUA: 'Quarta-feira',
  QUI: 'Quinta-feira', SEX: 'Sexta-feira', SAB: 'Sábado', DOM: 'Domingo'
};

const state = {
  rows: [],
  filtered: [],
  filters: { DT: '', DIA: '', SUPER: '', GERENTE: '', LOJA: '', STATUS_RH: '', colab: '' },
  sort: { key: 'DT', dir: 'asc' }
};

/* ---------------- CSV parsing (minimal, handles quoted fields) ---------------- */

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length && r.some(v => v !== ''));
}

function csvToObjects(text) {
  const rows = parseCSV(text);
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = (r[i] ?? '').trim());
    return obj;
  });
}

/* ---------------- Formatting helpers ---------------- */

function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function diaLabel(code) {
  return DIA_LABELS[code] || code || '—';
}

function lojaLabel(loja) {
  if (loja === '' || loja == null) return '—';
  const n = String(loja);
  return `Loja ${n.padStart(2, '0')}`;
}

function statusLabel(status) {
  return (status || '—').replace(/_/g, ' ');
}

function formatMoney(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function statusBadgeClass(status) {
  const s = (status || '').toUpperCase();
  if (s.includes('SEM') && s.includes('REGISTRO')) return 'badge-noregistro';
  if (s.includes('REGISTRO')) return 'badge-registro';
  return 'badge-neutral';
}

/* ---------------- Populate filter dropdowns ---------------- */

function uniqueSorted(rows, key) {
  return [...new Set(rows.map(r => r[key]).filter(v => v !== '' && v != null))]
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }));
}

function populateSelect(el, values, formatter) {
  const current = el.value;
  const placeholder = el.querySelector('option[value=""]');
  el.innerHTML = '';
  if (placeholder) el.appendChild(placeholder);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = formatter ? formatter(v) : v;
    el.appendChild(opt);
  });
  if ([...el.options].some(o => o.value === current)) el.value = current;
}

function refreshFilterOptions() {
  populateSelect(document.getElementById('fData'), uniqueSorted(state.rows, 'DT'), formatDate);
  populateSelect(document.getElementById('fDia'), uniqueSorted(state.rows, 'DIA'), diaLabel);
  populateSelect(document.getElementById('fSuper'), uniqueSorted(state.rows, 'SUPER'));
  populateSelect(document.getElementById('fGerente'), uniqueSorted(state.rows, 'GERENTE'));
  populateSelect(document.getElementById('fLoja'), uniqueSorted(state.rows, 'LOJA'), lojaLabel);
  populateSelect(document.getElementById('fStatus'), uniqueSorted(state.rows, 'STATUS_RH'), statusLabel);
}

/* ---------------- Filtering / sorting ---------------- */

function applyFilters() {
  const f = state.filters;
  const term = f.colab.trim().toLocaleLowerCase('pt-BR');
  state.filtered = state.rows.filter(r => {
    if (f.DT && r.DT !== f.DT) return false;
    if (f.DIA && r.DIA !== f.DIA) return false;
    if (f.SUPER && r.SUPER !== f.SUPER) return false;
    if (f.GERENTE && r.GERENTE !== f.GERENTE) return false;
    if (f.LOJA && r.LOJA !== f.LOJA) return false;
    if (f.STATUS_RH && r.STATUS_RH !== f.STATUS_RH) return false;
    if (term && !r.NOME.toLocaleLowerCase('pt-BR').includes(term)) return false;
    return true;
  });
  applySort();
}

function applySort() {
  const { key, dir } = state.sort;
  const mult = dir === 'asc' ? 1 : -1;
  state.filtered.sort((a, b) => {
    let va = a[key], vb = b[key];
    if (key === 'VENDA') { va = Number(va); vb = Number(vb); }
    if (key === 'LOJA') { va = Number(va); vb = Number(vb); }
    if (va < vb) return -1 * mult;
    if (va > vb) return 1 * mult;
    return 0;
  });
  renderTable();
}

/* ---------------- Rendering ---------------- */

function renderTable() {
  const tbody = document.getElementById('tableBody');
  const empty = document.getElementById('emptyState');
  const rowCount = document.getElementById('rowCount');

  rowCount.textContent = `Exibindo ${state.filtered.length} de ${state.rows.length} registros`;

  if (!state.filtered.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const frag = document.createDocumentFragment();
  state.filtered.forEach(r => {
    const tr = document.createElement('tr');

    const vendaNum = Number(r.VENDA);
    const vendaClass = vendaNum < 0 ? 'negative' : (vendaNum > 0 ? 'positive' : '');

    tr.innerHTML = `
      <td class="col-data">${formatDate(r.DT)}</td>
      <td>${diaLabel(r.DIA)}</td>
      <td class="col-nome">${escapeHtml(r.NOME)}</td>
      <td>${lojaLabel(r.LOJA)}</td>
      <td>${escapeHtml(r.GERENTE)}</td>
      <td>${escapeHtml(r.SUPER)}</td>
      <td><span class="badge ${statusBadgeClass(r.STATUS_RH)}">${statusLabel(r.STATUS_RH)}</span></td>
      <td class="num"><span class="venda-value ${vendaClass}">${formatMoney(r.VENDA)}</span></td>
    `;
    frag.appendChild(tr);
  });
  tbody.innerHTML = '';
  tbody.appendChild(frag);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------------- Sort header clicks ---------------- */

function setupSortHeaders() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.key = key;
        state.sort.dir = 'asc';
      }
      document.querySelectorAll('th.sortable').forEach(h => {
        h.classList.remove('sort-active');
        h.querySelector('.sort-arrow')?.remove();
      });
      th.classList.add('sort-active');
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      arrow.textContent = state.sort.dir === 'asc' ? '▲' : '▼';
      th.appendChild(arrow);
      applySort();
    });
  });
}

/* ---------------- Filter wiring ---------------- */

function setupFilters() {
  const map = [
    ['fData', 'DT'], ['fDia', 'DIA'], ['fSuper', 'SUPER'],
    ['fGerente', 'GERENTE'], ['fLoja', 'LOJA'], ['fStatus', 'STATUS_RH']
  ];
  map.forEach(([id, key]) => {
    document.getElementById(id).addEventListener('change', e => {
      state.filters[key] = e.target.value;
      applyFilters();
    });
  });

  let debounceTimer;
  document.getElementById('fColab').addEventListener('input', e => {
    clearTimeout(debounceTimer);
    const val = e.target.value;
    debounceTimer = setTimeout(() => {
      state.filters.colab = val;
      applyFilters();
    }, 180);
  });

  document.getElementById('clearFilters').addEventListener('click', () => {
    state.filters = { DT: '', DIA: '', SUPER: '', GERENTE: '', LOJA: '', STATUS_RH: '', colab: '' };
    map.forEach(([id]) => document.getElementById(id).value = '');
    document.getElementById('fColab').value = '';
    applyFilters();
  });
}

/* ---------------- CSV export (of currently filtered rows) ---------------- */

function setupExport() {
  document.getElementById('exportCsv').addEventListener('click', () => {
    const headers = ['DATA', 'DIA', 'COLABORADOR', 'LOJA', 'GERENTE', 'SUPERVISOR', 'STATUS', 'VENDA'];
    const lines = [headers.join(';')];
    state.filtered.forEach(r => {
      lines.push([
        formatDate(r.DT), diaLabel(r.DIA), r.NOME, lojaLabel(r.LOJA),
        r.GERENTE, r.SUPER, statusLabel(r.STATUS_RH),
        String(r.VENDA).replace('.', ',')
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registro_venda_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

/* ---------------- Mobile sidebar ---------------- */

function setupSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const open = () => { sidebar.classList.add('open'); overlay.classList.add('show'); };
  const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };
  document.getElementById('menuToggle').addEventListener('click', open);
  overlay.addEventListener('click', close);
}

/* ---------------- Init ---------------- */

async function init() {
  setupFilters();
  setupSortHeaders();
  setupExport();
  setupSidebarToggle();

  const loadedText = document.getElementById('loadedText');
  const loadedChip = document.getElementById('loadedChip');

  try {
    const res = await fetch('BASE.csv', { cache: 'no-store' });
    if (!res.ok) throw new Error('Falha ao carregar BASE.csv');
    const text = await res.text();
    state.rows = csvToObjects(text);
    state.filtered = [...state.rows];

    refreshFilterOptions();
    applyFilters();

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    loadedText.textContent = `${state.rows.length} registros carregados às ${hh}:${mm}`;
  } catch (err) {
    console.error(err);
    loadedChip.classList.add('stale');
    loadedText.textContent = 'Erro ao carregar data/BASE.csv';
    document.getElementById('rowCount').textContent = 'Não foi possível carregar os dados.';
  }
}

document.addEventListener('DOMContentLoaded', init);
