/* ==========================================================================
   Dashboard de Registro e Venda — leitura direta do Google Sheets publicado
   (CSV). Sem frameworks, sem build tools. Os dados são buscados nas URLs
   abaixo a cada carregamento da página; para atualizar, basta editar a
   planilha de origem — nenhuma alteração de código é necessária.
   Colunas esperadas (aba BASE/VENDA): NOME,LOJA,DT,DIA,STATUS_RH,VENDA,GERENTE,SUPER
   Colunas esperadas (aba GERAL/COMPARATIVO): NOME,ADMISSÃO,FUNÇÃO,LOJA,BANCO,MÊS,GERENTE,SUPERVISOR
   ========================================================================== */

const SHEET_URLS = {
  GERAL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSxpLcHLU6BqeDr874WX-uiPBOIVnT6RmIjVr4QrMNXkDYmBjIKpNS2YzKeSaCUffyJV-V9DogWwVQD/pub?gid=0&single=true&output=csv',
  BASE: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSxpLcHLU6BqeDr874WX-uiPBOIVnT6RmIjVr4QrMNXkDYmBjIKpNS2YzKeSaCUffyJV-V9DogWwVQD/pub?gid=2119380496&single=true&output=csv'
};

/* Adiciona um parâmetro de cache-busting para evitar que o navegador ou o
   Google Sheets sirvam uma versão antiga do CSV publicado. */
function sheetUrl(base) {
  return base + '&t=' + Date.now();
}

const DIA_LABELS = {
  SEG: 'Segunda-feira', TER: 'Terça-feira', QUA: 'Quarta-feira',
  QUI: 'Quinta-feira', SEX: 'Sexta-feira', SAB: 'Sábado', DOM: 'Domingo'
};

/* ---------------- Acompanhamento Mensal (aba GERAL) ---------------- */

const MES_LABELS = {
  '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
  '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
  '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
};

const COL = { NOME: 'NOME', ADMISSAO: 'ADMISSÃO', FUNCAO: 'FUNÇÃO', LOJA: 'LOJA', BANCO: 'BANCO', MES: 'MÊS', GERENTE: 'GERENTE', SUPER: 'SUPERVISOR' };

const stateM = {
  rows: [],
  supervisor: ''
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

function mesLabel(m) {
  if (!m) return '—';
  const match = String(m).match(/^(\d{4})-(\d{2})$/);
  if (match) return `${MES_LABELS[match[2]] || match[2]}/${match[1]}`;
  return String(m);
}

function parseDecimalHours(raw) {
  if (raw == null || raw === '') return NaN;
  let s = String(raw).trim();
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  return parseFloat(s);
}

function decimalHoursToHHMM(raw) {
  const n = parseDecimalHours(raw);
  if (Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '+';
  const totalMinutes = Math.round(Math.abs(n) * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${sign}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
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

/* ---------------- Acompanhamento Mensal: visão hierárquica ---------------- */
/* Supervisor → Lojas (expansível) → Colaboradores (expansível) → Evolução mensal */

function variacao(current, previous) {
  const nCur = parseDecimalHours(current);
  const nPrev = parseDecimalHours(previous);
  if (Number.isNaN(nCur) || Number.isNaN(nPrev)) return { text: '—', cls: '' };
  const diff = nCur - nPrev;
  if (diff === 0) return { text: decimalHoursToHHMM(0), cls: '' };
  return { text: decimalHoursToHHMM(diff), cls: diff > 0 ? 'positive' : 'negative' };
}

function buildColabEvolutionTable(rows) {
  const sorted = [...rows].sort((a, b) =>
    String(a[COL.MES]).localeCompare(String(b[COL.MES]), 'pt-BR', { numeric: true })
  );
  const trs = sorted.map((r, i) => {
    const n = parseDecimalHours(r[COL.BANCO]);
    const bancoCls = Number.isNaN(n) ? '' : (n < 0 ? 'negative' : (n > 0 ? 'positive' : ''));
    const varInfo = i === 0 ? { text: '—', cls: '' } : variacao(r[COL.BANCO], sorted[i - 1][COL.BANCO]);
    return `
      <tr>
        <td>${mesLabel(r[COL.MES])}</td>
        <td class="num"><span class="banco-value ${bancoCls}">${decimalHoursToHHMM(r[COL.BANCO])}</span></td>
        <td class="num"><span class="banco-value ${varInfo.cls}">${varInfo.text}</span></td>
      </tr>`;
  }).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Mês</th>
          <th class="num">Banco de horas</th>
          <th class="num">Variação</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>`;
}

function buildColabNode(nome, rows) {
  const first = rows[0];
  const funcao = first[COL.FUNCAO] || '—';
  return `
    <details class="mensal-colab">
      <summary>
        <span class="mensal-colab-name">${nome}</span>
        <span class="mensal-colab-meta">${funcao} · ${rows.length} mês(es) <span class="chevron">▸</span></span>
      </summary>
      <div class="mensal-colab-table-wrap">${buildColabEvolutionTable(rows)}</div>
    </details>`;
}

function buildLojaNode(loja, rows) {
  const colabNames = uniqueSorted(rows, COL.NOME);
  const colabNodes = colabNames.map(nome =>
    buildColabNode(nome, rows.filter(r => r[COL.NOME] === nome))
  ).join('');

  return `
    <details class="mensal-store">
      <summary>
        <span>${lojaLabel(loja)}</span>
        <span class="mensal-store-meta">${colabNames.length} colaborador(es) <span class="chevron">▸</span></span>
      </summary>
      <div class="mensal-colab-list">${colabNodes}</div>
    </details>`;
}

function renderMensalTree() {
  const treePanel = document.getElementById('mTreePanel');
  const tree = document.getElementById('mTree');
  const emptyState = document.getElementById('mEmptyState');

  if (!stateM.supervisor) {
    treePanel.hidden = true;
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Selecione um supervisor para ver as lojas e colaboradores.';
    tree.innerHTML = '';
    return;
  }

  const rows = stateM.rows.filter(r => r[COL.SUPER] === stateM.supervisor);
  if (!rows.length) {
    treePanel.hidden = true;
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Nenhum dado encontrado para este supervisor.';
    tree.innerHTML = '';
    return;
  }

  const lojas = uniqueSorted(rows, COL.LOJA);
  tree.innerHTML = lojas.map(loja => buildLojaNode(loja, rows.filter(r => r[COL.LOJA] === loja))).join('');

  const totalColab = uniqueSorted(rows, COL.NOME).length;
  document.getElementById('mTreeSummary').textContent =
    `${lojas.length} loja(s) · ${totalColab} colaborador(es)`;

  treePanel.hidden = false;
  emptyState.hidden = true;
}

function setupMensalFilters() {
  document.getElementById('mSupervisor').addEventListener('change', e => {
    stateM.supervisor = e.target.value;
    renderMensalTree();
  });
}

async function initMensal() {
  setupMensalFilters();
  try {
    const res = await fetch(sheetUrl(SHEET_URLS.GERAL), { cache: 'no-store' });
    if (!res.ok) throw new Error('Falha ao carregar planilha GERAL');
    const text = await res.text();
    stateM.rows = csvToObjects(text);

    populateSelect(document.getElementById('mSupervisor'), uniqueSorted(stateM.rows, COL.SUPER));
    renderMensalTree();
  } catch (err) {
    console.error(err);
    document.getElementById('mTreePanel').hidden = true;
    document.getElementById('mEmptyState').hidden = false;
    document.getElementById('mEmptyState').querySelector('p').textContent = 'Erro ao carregar dados da planilha GERAL';
  }
}

/* ---------------- Navegação entre abas ---------------- */

function showPage(page) {
  const isMensal = page === 'mensal';
  document.getElementById('pageRegistro').hidden = isMensal;
  document.getElementById('pageMensal').hidden = !isMensal;
  document.getElementById('navRegistro').classList.toggle('active', !isMensal);
  document.getElementById('navMensal').classList.toggle('active', isMensal);
  document.getElementById('pageTitle').textContent = isMensal
    ? 'Acompanhamento Mensal por Colaborador'
    : 'Registro e Venda por Colaborador';
  document.getElementById('crumbActive').textContent = isMensal
    ? 'Acompanhamento mensal'
    : 'Acompanhamento diário';
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

function setupRouter() {
  const applyHash = () => showPage(window.location.hash === '#mensal' ? 'mensal' : 'registro');
  window.addEventListener('hashchange', applyHash);
  applyHash();
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
  setupRouter();
  initMensal();

  const loadedText = document.getElementById('loadedText');
  const loadedChip = document.getElementById('loadedChip');

  try {
    const res = await fetch(sheetUrl(SHEET_URLS.BASE), { cache: 'no-store' });
    if (!res.ok) throw new Error('Falha ao carregar planilha BASE');
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
    loadedText.textContent = 'Erro ao carregar dados da planilha BASE';
    document.getElementById('rowCount').textContent = 'Não foi possível carregar os dados.';
  }
}

document.addEventListener('DOMContentLoaded', init);
