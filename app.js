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

/* Ordem cronológica dos meses (a planilha traz abreviações em português,
   ex: JAN, FEV, MAR... que não podem ser ordenadas alfabeticamente). */
const MES_ORDER = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

function mesOrderIndex(m) {
  const idx = MES_ORDER.indexOf(String(m || '').trim().toUpperCase());
  return idx === -1 ? MES_ORDER.length : idx;
}

const COL = { NOME: 'NOME', ADMISSAO: 'ADMISSÃO', FUNCAO: 'FUNÇÃO', LOJA: 'LOJA', BANCO: 'BANCO', MES: 'MÊS', GERENTE: 'GERENTE', SUPER: 'SUPERVISOR' };

const stateM = {
  rows: [],
  supervisor: '',
  gerente: '',
  loja: '',
  colab: '',
  periodo: 'mensal',   // 'mensal' | 'trimestral' | 'semestral'
  mesPeriodo: ''       // '' = todos (comportamento anterior); ex.: 'JAN', 'T1', 'S2'
};

/* Definição dos períodos do filtro (opções do seletor "Mês/Período" e base dos
   cálculos de Trimestral/Semestral — ver resolveMensalPeriodo). */
const MES_FULL = {
  JAN: 'Janeiro', FEV: 'Fevereiro', MAR: 'Março', ABR: 'Abril',
  MAI: 'Maio', JUN: 'Junho', JUL: 'Julho', AGO: 'Agosto',
  SET: 'Setembro', OUT: 'Outubro', NOV: 'Novembro', DEZ: 'Dezembro'
};
const TRIMESTRES = [
  { key: 'T1', label: '1º Trimestre', meses: ['JAN', 'FEV', 'MAR'] },
  { key: 'T2', label: '2º Trimestre', meses: ['ABR', 'MAI', 'JUN'] },
  { key: 'T3', label: '3º Trimestre', meses: ['JUL', 'AGO', 'SET'] },
  { key: 'T4', label: '4º Trimestre', meses: ['OUT', 'NOV', 'DEZ'] }
];
const SEMESTRES = [
  { key: 'S1', label: '1º Semestre', meses: ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN'] },
  { key: 'S2', label: '2º Semestre', meses: ['JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'] }
];

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
  const sorted = [...rows].sort((a, b) => mesOrderIndex(a[COL.MES]) - mesOrderIndex(b[COL.MES]));
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

/* ---- Painel de resumo visual da loja (exibido apenas quando expandida) ---- */

function buildLojaMonthlySeries(rows) {
  const byMes = new Map();
  rows.forEach(r => {
    const mes = String(r[COL.MES] || '').trim().toUpperCase();
    if (mesOrderIndex(mes) === MES_ORDER.length) return; // mês não reconhecido, ignora
    const val = parseDecimalHours(r[COL.BANCO]);
    if (Number.isNaN(val)) return;
    if (!byMes.has(mes)) byMes.set(mes, { sum: 0, count: 0 });
    const acc = byMes.get(mes);
    acc.sum += val; // soma em horas decimais — o carry para HH:MM só acontece na formatação final
    acc.count += 1;
  });
  return [...byMes.entries()]
    .map(([mes, acc]) => ({ mes, avg: acc.sum / acc.count, sum: acc.sum, count: acc.count }))
    .sort((a, b) => mesOrderIndex(a.mes) - mesOrderIndex(b.mes));
}

/* Situação da loja + variação da média, com base na comparação mês atual x mês anterior. */
function buildLojaSituacao(atual, anterior) {
  if (!anterior) {
    return {
      emoji: '🟡', label: 'Estável', cls: 'estavel',
      varText: '—', varCls: ''
    };
  }
  const diff = atual.avg - anterior.avg;
  const diffMin = Math.round(diff * 60);
  const varText = decimalHoursToHHMM(diff);
  const varCls = diffMin > 0 ? 'positive' : (diffMin < 0 ? 'negative' : '');

  if (diffMin > 0) return { emoji: '🟢', label: 'Evolução positiva', cls: 'positiva', varText, varCls };
  if (diffMin < 0) return { emoji: '🔴', label: 'Evolução negativa', cls: 'negativa', varText, varCls };
  return { emoji: '🟡', label: 'Estável', cls: 'estavel', varText, varCls };
}

function buildLojaColabComparison(rows, atualMes, anteriorMes) {
  if (!anteriorMes) return null;
  const nomes = uniqueSorted(rows, COL.NOME);
  let up = 0, down = 0, flat = 0;
  nomes.forEach(nome => {
    const colabRows = rows.filter(r => r[COL.NOME] === nome);
    const rAtual = colabRows.find(r => String(r[COL.MES]).trim().toUpperCase() === atualMes);
    const rAnterior = colabRows.find(r => String(r[COL.MES]).trim().toUpperCase() === anteriorMes);
    if (!rAtual || !rAnterior) return; // sem os dois meses para comparar
    const vAtual = parseDecimalHours(rAtual[COL.BANCO]);
    const vAnterior = parseDecimalHours(rAnterior[COL.BANCO]);
    if (Number.isNaN(vAtual) || Number.isNaN(vAnterior)) return;
    const diffMin = Math.round((vAtual - vAnterior) * 60);
    if (diffMin > 0) up++;
    else if (diffMin < 0) down++;
    else flat++;
  });
  return { up, down, flat };
}

function buildLojaSparkline(series) {
  if (series.length < 2) {
    return `<p class="loja-resumo-chart-empty">Dados insuficientes para exibir a evolução mensal.</p>`;
  }
  const w = 480, h = 108, padX = 24, padY = 18;
  const values = series.map(s => s.avg);
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 0);
  if (min === max) { min -= 1; max += 1; }
  const spanX = w - 2 * padX;
  const spanY = h - 2 * padY;
  const xAt = i => padX + (i / (series.length - 1)) * spanX;
  const yAt = v => padY + spanY - ((v - min) / (max - min)) * spanY;

  const pts = series.map((s, i) => `${xAt(i).toFixed(1)},${yAt(s.avg).toFixed(1)}`).join(' ');

  const zeroLine = (min < 0 && max > 0)
    ? `<line x1="${padX}" y1="${yAt(0).toFixed(1)}" x2="${w - padX}" y2="${yAt(0).toFixed(1)}" class="spark-zero"/>`
    : '';

  const dots = series.map((s, i) => {
    const x = xAt(i), y = yAt(s.avg);
    const cls = s.avg > 0 ? 'positive' : (s.avg < 0 ? 'negative' : '');
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="spark-dot ${cls}"><title>${s.mes}: ${decimalHoursToHHMM(s.avg)}</title></circle>`;
  }).join('');

  const labels = series.map((s, i) =>
    `<text x="${xAt(i).toFixed(1)}" y="${h - 4}" class="spark-label" text-anchor="middle">${s.mes}</text>`
  ).join('');

  return `
    <svg viewBox="0 0 ${w} ${h}" class="loja-resumo-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Evolução mensal do banco de horas da loja">
      ${zeroLine}
      <polyline points="${pts}" class="spark-line" fill="none"/>
      ${dots}
      ${labels}
    </svg>`;
}

function buildLojaSummaryPanel(rows) {
  const periodo = resolveMensalPeriodo();
  if (periodo) return buildLojaSummaryPanelPeriodo(rows, periodo);
  const series = buildLojaMonthlySeries(rows);
  if (!series.length) {
    return `<div class="mensal-loja-resumo"><p class="loja-resumo-empty">Sem dados de banco de horas para exibir o resumo da loja.</p></div>`;
  }

  const atual = series[series.length - 1];
  const anterior = series.length > 1 ? series[series.length - 2] : null;
  const situacao = buildLojaSituacao(atual, anterior);
  const comparison = buildLojaColabComparison(rows, atual.mes, anterior ? anterior.mes : null);

  const mediaCls = atual.avg > 0 ? 'positive' : (atual.avg < 0 ? 'negative' : '');
  const saldoCls = atual.sum > 0 ? 'positive' : (atual.sum < 0 ? 'negative' : '');
  const totalColabs = uniqueSorted(rows, COL.NOME).length;

  const colabsLine = comparison
    ? `🟢 <span class="colab-count up">${comparison.up}</span> com aumento · 🔴 <span class="colab-count down">${comparison.down}</span> com redução · ⚪ <span class="colab-count flat">${comparison.flat}</span> sem alteração`
    : 'Sem mês anterior para comparar colaboradores.';

  return `
    <div class="mensal-loja-resumo">
      <div class="loja-resumo-chart-wrap">
        <span class="info-label">Evolução mensal · banco de horas</span>
        ${buildLojaSparkline(series)}
      </div>
      <div class="loja-resumo-kpis">
        <div class="info-field">
          <span class="info-label">Situação da loja</span>
          <span class="info-value situacao-value ${situacao.cls}">${situacao.emoji} ${situacao.label}</span>
        </div>
        <div class="info-field">
          <span class="info-label">Média atual · ${atual.mes}</span>
          <span class="info-value banco-value ${mediaCls}">${decimalHoursToHHMM(atual.avg)}</span>
        </div>
        <div class="info-field">
          <span class="info-label">Variação vs. mês anterior</span>
          <span class="info-value banco-value ${situacao.varCls}">${situacao.varText}</span>
        </div>
        <div class="info-field">
          <span class="info-label">Saldo total · ${atual.mes}</span>
          <span class="info-value banco-value ${saldoCls}">${decimalHoursToHHMM(atual.sum)}</span>
        </div>
        <div class="info-field">
          <span class="info-label">Colaboradores</span>
          <span class="info-value">${totalColabs}</span>
        </div>
      </div>
      <div class="loja-resumo-colabs-line">${colabsLine}</div>
    </div>`;
}

/* ==========================================================================
   Períodos reais (Mensal / Trimestral / Semestral) — banco de horas
   Regras:
   - BANCO é o saldo do mês: NUNCA se somam saldos mensais para formar trimestre/semestre.
     Variação = saldo final − saldo inicial (primeiro/último mês que REALMENTE têm registro).
   - Registros são agrupados por NOME + LOJA + MÊS e mantidos como LISTA. Mais de um registro
     no mesmo mês é CONFLITO: nenhum é escolhido, nenhum é somado, nenhum é "corrigido".
   - Sem período específico selecionado (Mês/Período = "Todos"), nada abaixo é usado.
   ========================================================================== */

function mesNorm(m) {
  return String(m || '').trim().toUpperCase();
}

/* Meses que existem hoje na base inteira (define o "período disponível"). */
function mesesNaBaseSet() {
  return new Set(stateM.rows.map(r => mesNorm(r[COL.MES])));
}

/* Retorna null (comportamento anterior) ou { modo, key, label, meses, mes }.
   Para trimestral/semestral, `meses` = somente os meses do período que existem na base. */
function resolveMensalPeriodo() {
  const sel = stateM.mesPeriodo;
  if (!sel) return null;
  if (stateM.periodo === 'mensal') {
    return MES_ORDER.includes(sel) ? { modo: 'mensal', key: sel, label: MES_FULL[sel] || sel, mes: sel } : null;
  }
  const defs = stateM.periodo === 'trimestral' ? TRIMESTRES : SEMESTRES;
  const def = defs.find(d => d.key === sel);
  if (!def) return null;
  const naBase = mesesNaBaseSet();
  const meses = def.meses.filter(m => naBase.has(m));
  return meses.length ? { modo: stateM.periodo, key: def.key, label: def.label, meses } : null;
}

/* Agrupa registros por MÊS mantendo TODOS em lista (nunca sobrescreve, nunca escolhe um). */
function groupRowsByMes(rows) {
  const g = new Map();
  rows.forEach(r => {
    const m = mesNorm(r[COL.MES]);
    if (!g.has(m)) g.set(m, []);
    g.get(m).push(r);
  });
  return g;
}

function formatBancoLista(recs) {
  return recs.map(r => decimalHoursToHHMM(r[COL.BANCO])).join(' / ');
}

function bancoListaCls(recs) {
  if (recs.length !== 1) return '';
  const n = parseDecimalHours(recs[0][COL.BANCO]);
  if (Number.isNaN(n)) return '';
  return n < 0 ? 'negative' : (n > 0 ? 'positive' : '');
}

function periodoBadge(texto, cls) {
  return `<span class="badge ${cls}">${texto}</span>`;
}

function periodoField(label, valueHtml) {
  return `
        <div class="info-field">
          <span class="info-label">${label}</span>
          ${valueHtml}
        </div>`;
}

/* Cálculo do colaborador (rows = registros do colaborador NESSA loja, todos os meses). */
function computeColabPeriodo(rows, periodo) {
  const porMes = groupRowsByMes(rows);

  if (periodo.modo === 'mensal') {
    const recs = porMes.get(periodo.mes) || [];
    return { modo: 'mensal', mes: periodo.mes, recs, conflito: recs.length > 1 };
  }

  const mesesComReg = periodo.meses.filter(m => (porMes.get(m) || []).length > 0);
  if (!mesesComReg.length) return { modo: periodo.modo, vazio: true, mesesComReg };

  const mesIni = mesesComReg[0];
  const mesFim = mesesComReg[mesesComReg.length - 1];
  const recIni = porMes.get(mesIni);
  const recFim = porMes.get(mesFim);
  const mesesDup = [];
  if (recIni.length > 1) mesesDup.push(mesIni);
  if (recFim.length > 1 && mesFim !== mesIni) mesesDup.push(mesFim);
  const conflito = mesesDup.length > 0;
  const parcial = mesesComReg.length < periodo.meses.length || mesesComReg.length < 2;

  let varInfo = { text: '—', cls: '' };
  if (!conflito && mesIni !== mesFim) varInfo = variacao(recFim[0][COL.BANCO], recIni[0][COL.BANCO]);

  return {
    modo: periodo.modo, mesIni, mesFim, recIni, recFim, mesesComReg, mesesDup,
    conflito, status: conflito ? 'Conflito' : (parcial ? 'Parcial' : 'Normal'), varInfo
  };
}

function buildColabNodePeriodo(nome, rows, periodo) {
  const first = rows[0];
  const funcao = first[COL.FUNCAO] || '—';
  const c = computeColabPeriodo(rows, periodo);
  let badges = '';
  let body = '';

  if (c.modo === 'mensal') {
    if (c.conflito) {
      badges = periodoBadge('Conflito', 'badge-noregistro') + ' ' + periodoBadge(`${c.mes} duplicado`, 'badge-noregistro');
    }
    body = `
      <div class="loja-resumo-kpis">
        ${periodoField(`Banco de horas · ${c.mes}`, `<span class="info-value banco-value wrap ${bancoListaCls(c.recs)}">${c.recs.length ? formatBancoLista(c.recs) : '—'}</span>`)}
        ${periodoField('Variação', `<span class="info-value banco-value">—</span>`)}
        ${periodoField('Situação', `<span class="info-value wrap">${c.conflito ? badges : '—'}</span>`)}
      </div>`;
  } else if (c.vazio) {
    badges = periodoBadge('Sem registros', 'badge-neutral');
    body = `
      <div class="loja-resumo-kpis">
        ${periodoField('Saldo inicial', `<span class="info-value banco-value">—</span>`)}
        ${periodoField('Saldo final', `<span class="info-value banco-value">—</span>`)}
        ${periodoField('Variação', `<span class="info-value banco-value">—</span>`)}
        ${periodoField('Status', `<span class="info-value wrap">${badges}</span>`)}
        ${periodoField('Meses', `<span class="info-value wrap">—</span>`)}
      </div>`;
  } else {
    const statusCls = c.status === 'Conflito' ? 'badge-noregistro' : (c.status === 'Parcial' ? 'badge-neutral' : 'badge-registro');
    badges = periodoBadge(c.status, statusCls);
    if (c.conflito) badges += ' ' + c.mesesDup.map(m => periodoBadge(`${m} duplicado`, 'badge-noregistro')).join(' ');
    body = `
      <div class="loja-resumo-kpis">
        ${periodoField(`Saldo inicial · ${c.mesIni}`, `<span class="info-value banco-value wrap ${bancoListaCls(c.recIni)}">${formatBancoLista(c.recIni)}</span>`)}
        ${periodoField(`Saldo final · ${c.mesFim}`, `<span class="info-value banco-value wrap ${bancoListaCls(c.recFim)}">${formatBancoLista(c.recFim)}</span>`)}
        ${periodoField('Variação', `<span class="info-value banco-value ${c.varInfo.cls}">${c.varInfo.text}</span>`)}
        ${periodoField('Status', `<span class="info-value wrap">${badges}</span>`)}
        ${periodoField('Meses', `<span class="info-value wrap">${c.mesesComReg.join(', ')}</span>`)}
      </div>`;
  }

  return `
    <details class="mensal-colab">
      <summary>
        <span class="mensal-colab-name">${nome}</span>
        <span class="mensal-colab-meta">${funcao}${c.modo === 'mensal' ? '' : ' · ' + periodo.label} <span class="chevron">▸</span></span>
      </summary>
      <div class="mensal-colab-table-wrap">${body}</div>
    </details>`;
}

/* Saldo da loja em UM mês = soma dos saldos dos colaboradores nesse mês.
   Se algum colaborador tiver mais de um registro no mês, o saldo é INDETERMINADO (nunca soma duplicados). */
function lojaSaldoMes(porMes, mes) {
  const recs = porMes.get(mes) || [];
  if (!recs.length) return { vazio: true };
  const contagem = new Map();
  recs.forEach(r => contagem.set(r[COL.NOME], (contagem.get(r[COL.NOME]) || 0) + 1));
  if ([...contagem.values()].some(n => n > 1)) return { indeterminado: true, mes };
  let sum = 0, count = 0;
  recs.forEach(r => {
    const v = parseDecimalHours(r[COL.BANCO]);
    if (Number.isNaN(v)) return;
    sum += v;
    count += 1;
  });
  return { sum, count, mes };
}

function lojaSaldoHtml(s) {
  if (s.vazio) return `<span class="info-value banco-value">—</span>`;
  if (s.indeterminado) return `<span class="info-value banco-value wrap">Indeterminado — ${s.mes} duplicado</span>`;
  const cls = s.sum > 0 ? 'positive' : (s.sum < 0 ? 'negative' : '');
  return `<span class="info-value banco-value ${cls}">${decimalHoursToHHMM(s.sum)}</span>`;
}

function buildLojaSummaryPanelPeriodo(rows, periodo) {
  const series = buildLojaMonthlySeries(rows); // gráfico existente: preservado como está
  if (!series.length) {
    return `<div class="mensal-loja-resumo"><p class="loja-resumo-empty">Sem dados de banco de horas para exibir o resumo da loja.</p></div>`;
  }
  const porMes = groupRowsByMes(rows);
  const totalColabs = uniqueSorted(rows, COL.NOME).length;
  const colabsField = periodoField('Colaboradores', `<span class="info-value">${totalColabs}</span>`);
  let kpis = '';

  if (periodo.modo === 'mensal') {
    const s = lojaSaldoMes(porMes, periodo.mes);
    let mediaHtml;
    if (s.vazio || (!s.indeterminado && !s.count)) mediaHtml = `<span class="info-value banco-value">—</span>`;
    else if (s.indeterminado) mediaHtml = lojaSaldoHtml(s);
    else {
      const avg = s.sum / s.count;
      mediaHtml = `<span class="info-value banco-value ${avg > 0 ? 'positive' : (avg < 0 ? 'negative' : '')}">${decimalHoursToHHMM(avg)}</span>`;
    }
    kpis = `
        ${periodoField('Situação da loja', `<span class="info-value">—</span>`)}
        ${periodoField(`Média atual · ${periodo.mes}`, mediaHtml)}
        ${periodoField('Variação', `<span class="info-value banco-value">—</span>`)}
        ${periodoField(`Saldo total · ${periodo.mes}`, lojaSaldoHtml(s))}
        ${colabsField}`;
  } else {
    const mesesComReg = periodo.meses.filter(m => (porMes.get(m) || []).length > 0);
    if (!mesesComReg.length) {
      kpis = `
        ${periodoField('Saldo inicial', `<span class="info-value banco-value">—</span>`)}
        ${periodoField('Saldo final', `<span class="info-value banco-value">—</span>`)}
        ${periodoField('Variação', `<span class="info-value banco-value">—</span>`)}
        ${colabsField}`;
    } else {
      const mesIni = mesesComReg[0];
      const mesFim = mesesComReg[mesesComReg.length - 1];
      const ini = lojaSaldoMes(porMes, mesIni);
      const fim = lojaSaldoMes(porMes, mesFim);
      let varHtml = `<span class="info-value banco-value">—</span>`;
      if (mesIni !== mesFim && !ini.indeterminado && !fim.indeterminado) {
        const diff = fim.sum - ini.sum;
        const diffMin = Math.round(diff * 60);
        varHtml = `<span class="info-value banco-value ${diffMin > 0 ? 'positive' : (diffMin < 0 ? 'negative' : '')}">${decimalHoursToHHMM(diff)}</span>`;
      }
      kpis = `
        ${periodoField(`Saldo inicial · ${mesIni}`, lojaSaldoHtml(ini))}
        ${periodoField(`Saldo final · ${mesFim}`, lojaSaldoHtml(fim))}
        ${periodoField('Variação', varHtml)}
        ${colabsField}`;
    }
  }

  return `
    <div class="mensal-loja-resumo">
      <div class="loja-resumo-chart-wrap">
        <span class="info-label">Evolução mensal · banco de horas</span>
        ${buildLojaSparkline(series)}
      </div>
      <div class="loja-resumo-kpis">${kpis}
      </div>
    </div>`;
}

function buildColabNode(nome, rows) {
  const periodo = resolveMensalPeriodo();
  if (periodo) return buildColabNodePeriodo(nome, rows, periodo);
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

function buildLojaNode(loja, rows, colabFilter) {
  const colabNames = uniqueSorted(rows, COL.NOME);
  const shownNames = colabFilter ? colabNames.filter(n => n === colabFilter) : colabNames;
  const colabNodes = shownNames.map(nome =>
    buildColabNode(nome, rows.filter(r => r[COL.NOME] === nome))
  ).join('');

  return `
    <details class="mensal-store">
      <summary>
        <span>${lojaLabel(loja)}</span>
        <span class="mensal-store-meta">${colabNames.length} colaborador(es) <span class="chevron">▸</span></span>
      </summary>
      ${buildLojaSummaryPanel(rows)}
      <div class="mensal-colab-list">${colabNodes}</div>
    </details>`;
}

function renderMensalTree() {
  const treePanel = document.getElementById('mTreePanel');
  const tree = document.getElementById('mTree');
  const emptyState = document.getElementById('mEmptyState');

  if (!stateM.supervisor && !stateM.gerente && !stateM.loja && !stateM.colab) {
    treePanel.hidden = true;
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Selecione um supervisor e/ou um gerente para ver as lojas e colaboradores.';
    tree.innerHTML = '';
    return;
  }

  const rows = stateM.rows.filter(r =>
    (!stateM.supervisor || r[COL.SUPER] === stateM.supervisor) &&
    (!stateM.gerente || r[COL.GERENTE] === stateM.gerente) &&
    (!stateM.loja || r[COL.LOJA] === stateM.loja) &&
    (!stateM.colab || r[COL.NOME] === stateM.colab)
  );
  if (!rows.length) {
    treePanel.hidden = true;
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Nenhum dado encontrado para os filtros selecionados.';
    tree.innerHTML = '';
    return;
  }

  const lojas = uniqueSorted(rows, COL.LOJA);
  // Linhas completas de cada loja (respeitando supervisor/gerente/loja, mas NÃO o filtro de colaborador),
  // para que o resumo e o gráfico da loja continuem calculados com todos os colaboradores dela.
  const rowsLojaBase = stateM.rows.filter(r =>
    (!stateM.supervisor || r[COL.SUPER] === stateM.supervisor) &&
    (!stateM.gerente || r[COL.GERENTE] === stateM.gerente)
  );
  tree.innerHTML = lojas.map(loja =>
    buildLojaNode(loja, rowsLojaBase.filter(r => r[COL.LOJA] === loja), stateM.colab)
  ).join('');

  // Com um colaborador selecionado, já abre a loja e o colaborador para facilitar a leitura
  if (stateM.colab) tree.querySelectorAll('details').forEach(d => { d.open = true; });

  const totalColab = uniqueSorted(rows, COL.NOME).length;
  document.getElementById('mTreeSummary').textContent =
    `${lojas.length} loja(s) · ${totalColab} colaborador(es)`;

  treePanel.hidden = false;
  emptyState.hidden = true;
}

/* ---- Filtros encadeados: Supervisor/Gerente → Loja → Colaborador ---- */

function mensalRowsFor(upTo) {
  // Linhas que satisfazem os filtros "acima" do nível pedido ('loja' ou 'colab')
  return stateM.rows.filter(r =>
    (!stateM.supervisor || r[COL.SUPER] === stateM.supervisor) &&
    (!stateM.gerente || r[COL.GERENTE] === stateM.gerente) &&
    (upTo !== 'colab' || !stateM.loja || r[COL.LOJA] === stateM.loja)
  );
}

function refreshMensalColabOptions() {
  const el = document.getElementById('mColab');
  populateSelect(el, uniqueSorted(mensalRowsFor('colab'), COL.NOME));
  stateM.colab = el.value; // volta para "Todos" se o colaborador não pertence mais ao recorte
}

function refreshMensalLojaOptions() {
  const el = document.getElementById('mLoja');
  populateSelect(el, uniqueSorted(mensalRowsFor('loja'), COL.LOJA), lojaLabel);
  stateM.loja = el.value; // volta para "Todas" se a loja não pertence mais ao recorte
  refreshMensalColabOptions();
}

/* ---- Período (Mensal / Trimestral / Semestral) → opções de "Mês/Período" ----
   A escolha fica em stateM e é consumida por resolveMensalPeriodo(). */
function refreshMensalPeriodOptions() {
  const el = document.getElementById('mMesPeriodo');
  const mesesNaBase = new Set(stateM.rows.map(r => String(r[COL.MES] || '').trim().toUpperCase()));
  let opts = [];
  if (stateM.periodo === 'trimestral' || stateM.periodo === 'semestral') {
    const defs = stateM.periodo === 'trimestral' ? TRIMESTRES : SEMESTRES;
    opts = defs
      .filter(p => p.meses.some(m => mesesNaBase.has(m)))
      .map(p => ({ value: p.key, label: `${p.label} (${p.meses[0]}–${p.meses[p.meses.length - 1]})` }));
  } else {
    opts = MES_ORDER
      .filter(m => mesesNaBase.has(m))
      .map(m => ({ value: m, label: MES_FULL[m] || m }));
  }
  const placeholder = el.querySelector('option[value=""]');
  el.innerHTML = '';
  el.appendChild(placeholder);
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    el.appendChild(opt);
  });
  stateM.mesPeriodo = '';
}

function setupMensalFilters() {
  document.getElementById('mSupervisor').addEventListener('change', e => {
    stateM.supervisor = e.target.value;
    refreshMensalLojaOptions();
    renderMensalTree();
  });
  document.getElementById('mGerente').addEventListener('change', e => {
    stateM.gerente = e.target.value;
    refreshMensalLojaOptions();
    renderMensalTree();
  });
  document.getElementById('mLoja').addEventListener('change', e => {
    stateM.loja = e.target.value;
    refreshMensalColabOptions();
    renderMensalTree();
  });
  document.getElementById('mColab').addEventListener('change', e => {
    stateM.colab = e.target.value;
    renderMensalTree();
  });
  document.getElementById('mPeriodo').addEventListener('change', e => {
    stateM.periodo = e.target.value;
    refreshMensalPeriodOptions();
    renderMensalTree();
  });
  document.getElementById('mMesPeriodo').addEventListener('change', e => {
    stateM.mesPeriodo = e.target.value;
    renderMensalTree();
  });
}

/* ---- Exportar PDF (Acompanhamento Mensal) ----
   Usa a impressão do navegador ("Salvar como PDF"): não exige bibliotecas externas.
   Regra: se nenhuma loja estiver expandida, exporta TODAS as lojas do filtro atual
   (relatório por supervisor/gerente). Se uma ou mais lojas já estiverem expandidas,
   exporta somente essas (relatório por loja). */
function setupMensalExport() {
  document.getElementById('exportMensalPdf').addEventListener('click', exportMensalPDF);
}

function exportMensalPDF() {
  const tree = document.getElementById('mTree');
  const allStores = [...tree.querySelectorAll(':scope > details.mensal-store')];
  if (!allStores.length) return;

  const openStores = allStores.filter(d => d.open);
  const storesToExport = openStores.length ? openStores : allStores;

  // Guarda o estado atual (aberto/fechado) de lojas e colaboradores para restaurar após a impressão
  const snapshot = allStores.map(d => ({
    el: d,
    open: d.open,
    colabs: [...d.querySelectorAll('details.mensal-colab')].map(c => ({ el: c, open: c.open }))
  }));

  // Expande as lojas/colaboradores que entrarão no PDF e esconde as demais
  allStores.forEach(d => {
    const include = storesToExport.includes(d);
    d.classList.toggle('print-hide', !include);
    if (include) {
      d.open = true;
      d.querySelectorAll('details.mensal-colab').forEach(c => { c.open = true; });
    }
  });

  updateMensalPrintHeader(storesToExport.length === allStores.length ? 'supervisor' : 'loja', storesToExport.length);

  const restore = () => {
    snapshot.forEach(({ el, open, colabs }) => {
      el.classList.remove('print-hide');
      el.open = open;
      colabs.forEach(({ el: c, open: co }) => { c.open = co; });
    });
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);

  window.print();
}

function updateMensalPrintHeader(modo, totalLojas) {
  const header = document.getElementById('mPrintHeader');
  const supervisorText = stateM.supervisor || 'Todos';
  const gerenteText = stateM.gerente || 'Todos';
  const agora = new Date();
  const dataStr = agora.toLocaleDateString('pt-BR');
  const horaStr = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const escopo = modo === 'loja'
    ? `${totalLojas} loja(s) selecionada(s)`
    : 'Todas as lojas do filtro';

  header.innerHTML = `
    <h1>Acompanhamento Mensal · Banco de Horas</h1>
    <p><strong>Supervisor:</strong> ${supervisorText} &nbsp;·&nbsp; <strong>Gerente:</strong> ${gerenteText} &nbsp;·&nbsp; ${escopo}</p>
    <p class="print-header-date">Gerado em ${dataStr} às ${horaStr}</p>
  `;
}

/* ==========================================================================
   Exportar Consolidado (#mensal) — XLSX
   - NÃO tem lógica própria de saldo/variação/status: usa resolveMensalPeriodo() e
     computeColabPeriodo() (a mesma da tela). Aqui só se monta a linha de exportação.
   - Nenhum registro duplicado é escolhido, somado ou corrigido: conflito = "Indeterminado".
   - Contador e arquivo vêm da MESMA lista (buildConsolidadoLinhas).
   ========================================================================== */

const CONSOLIDADO_HEADERS = [
  'Colaborador', 'Função', 'Loja', 'Supervisor', 'Gerente',
  'Saldo inicial', 'Saldo final', 'Variação', 'Status', 'Meses considerados', 'Observação'
];

/* Linhas da base respeitando os filtros de #mensal; todos os filtros de hierarquia são opcionais. */
function getMensalRowsFiltrados() {
  return stateM.rows.filter(r =>
    (!stateM.supervisor || r[COL.SUPER] === stateM.supervisor) &&
    (!stateM.gerente || r[COL.GERENTE] === stateM.gerente) &&
    (!stateM.loja || r[COL.LOJA] === stateM.loja) &&
    (!stateM.colab || r[COL.NOME] === stateM.colab)
  );
}

/* Valores distintos (na ordem em que aparecem) unidos por " / " — nunca escolhe só o primeiro. */
function valoresDistintos(rows, key) {
  const vistos = [];
  rows.forEach(r => {
    const v = String(r[key] == null ? '' : r[key]).trim();
    if (v && !vistos.includes(v)) vistos.push(v);
  });
  return vistos.length ? vistos.join(' / ') : '—';
}

function saldoIndeterminado(mes) {
  return `Indeterminado — ${mes} duplicado`;
}

/* Retorna { periodo, linhas } ; periodo = null quando não há mês/trimestre/semestre selecionado.
   Cada item de `linhas` = { cols: [11 textos], saldoFinalNum } */
function buildConsolidadoLinhas(criterio) {
  const periodo = resolveMensalPeriodo();
  if (!periodo) return { periodo: null, linhas: [] };

  // Agrupa por NOME + LOJA mantendo TODOS os registros em lista (sem sobrescrever).
  const grupos = new Map();
  getMensalRowsFiltrados().forEach(r => {
    const k = JSON.stringify([r[COL.NOME], r[COL.LOJA]]);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  });

  const linhas = [];
  grupos.forEach(rows => {
    const c = computeColabPeriodo(rows, periodo);
    let ini, fim, varTxt, status, meses, obs, finalRecs;

    if (c.modo === 'mensal') {
      if (!c.recs.length) return;               // sem registro no período: não exporta
      finalRecs = c.recs;
      ini = '—';
      fim = c.conflito ? saldoIndeterminado(c.mes) : formatBancoLista(c.recs);
      varTxt = '—';
      status = c.conflito ? 'Conflito' : '—';
      meses = c.mes;
      obs = c.conflito ? `${c.mes} duplicado` : '';
    } else {
      if (c.vazio) return;                      // sem registro no período: não exporta
      finalRecs = c.recFim;
      ini = c.recIni.length > 1 ? saldoIndeterminado(c.mesIni) : formatBancoLista(c.recIni);
      fim = c.recFim.length > 1 ? saldoIndeterminado(c.mesFim) : formatBancoLista(c.recFim);
      varTxt = c.varInfo.text;
      status = c.status;
      meses = c.mesesComReg.join(' / ');
      obs = c.conflito ? c.mesesDup.map(m => `${m} duplicado`).join(' / ') : '';
    }

    // Saldo final numérico só existe quando há exatamente 1 registro e ele é legível.
    const saldoFinalNum = finalRecs.length === 1 ? parseDecimalHours(finalRecs[0][COL.BANCO]) : NaN;
    if (criterio === 'positivo' && !(saldoFinalNum > 0)) return;
    if (criterio === 'negativo' && !(saldoFinalNum < 0)) return;

    linhas.push({
      cols: [
        valoresDistintos(rows, COL.NOME),
        valoresDistintos(rows, COL.FUNCAO),
        lojaLabel(rows[0][COL.LOJA]),
        valoresDistintos(rows, COL.SUPER),
        valoresDistintos(rows, COL.GERENTE),
        ini, fim, varTxt, status, meses, obs
      ],
      saldoFinalNum
    });
  });

  // Ordem apenas de apresentação (loja, depois colaborador); não decide nenhum valor.
  linhas.sort((x, y) =>
    x.cols[2].localeCompare(y.cols[2], 'pt-BR', { numeric: true }) ||
    x.cols[0].localeCompare(y.cols[0], 'pt-BR'));
  return { periodo, linhas };
}

function nomeArquivoConsolidado(periodo) {
  return `Banco_de_Horas_Consolidado_${periodo.key}.xlsx`;
}

/* ---- XLSX em JS puro: ZIP sem compressão + CRC32 próprio ---- */
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) { // files: [{ name, data: Uint8Array }]
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (v, n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; };
  const u32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; };
  const cat = arr => { const out = new Uint8Array(arr.reduce((s, x) => s + x.length, 0)); let o = 0; arr.forEach(x => { out.set(x, o); o += x.length; }); return out; };

  files.forEach(f => {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = cat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), name, f.data
    ]);
    central.push(cat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name
    ]));
    parts.push(local);
    offset += local.length;
  });
  const cd = cat(central);
  const end = cat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cd.length), u32(offset), u16(0)
  ]);
  return cat([...parts, cd, end]);
}

function xmlEscape(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colLetter(i) { return String.fromCharCode(65 + i); } // 11 colunas: A..K

/* matriz = [ [11 textos] (cabeçalho), [11 textos], ... ] → Uint8Array (.xlsx) */
function buildXlsx(matriz) {
  const enc = new TextEncoder();
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const rowsXml = matriz.map((linha, ri) =>
    `<row r="${ri + 1}">` + linha.map((v, ci) =>
      `<c r="${colLetter(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`
    ).join('') + '</row>'
  ).join('');
  const widths = [28, 22, 11, 22, 22, 26, 30, 12, 11, 22, 24];
  const colsXml = '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';

  const files = [
    { name: '[Content_Types].xml', text: head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', text: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: head + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Consolidado" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', text: head + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${colsXml}<sheetData>${rowsXml}</sheetData></worksheet>` }
  ].map(f => ({ name: f.name, data: enc.encode(f.text) }));
  return zipStore(files);
}

function consolidadoCriterio() {
  return document.getElementById('mConsCriterio').value;
}

/* Atualiza contador e botão. O contador = linhas.length da MESMA lista que será exportada. */
function refreshConsolidado() {
  const countEl = document.getElementById('mConsCount');
  const hintEl = document.getElementById('mConsHint');
  const btn = document.getElementById('mConsExport');
  const { periodo, linhas } = buildConsolidadoLinhas(consolidadoCriterio());

  if (!periodo) {
    countEl.textContent = 'Colaboradores encontrados: —';
    hintEl.textContent = 'Selecione um mês, trimestre ou semestre para exportar.';
    btn.disabled = true;
    return;
  }
  countEl.textContent = `Colaboradores encontrados: ${linhas.length}`;
  hintEl.textContent = linhas.length ? '' : 'Nenhum colaborador encontrado para os filtros e o critério selecionados.';
  btn.disabled = linhas.length === 0;
}

function exportConsolidado() {
  const { periodo, linhas } = buildConsolidadoLinhas(consolidadoCriterio());
  if (!periodo || !linhas.length) return;
  const bytes = buildXlsx([CONSOLIDADO_HEADERS, ...linhas.map(l => l.cols)]);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivoConsolidado(periodo);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* Ouvintes adicionais (registrados depois de setupMensalFilters, portanto rodam depois
   dos handlers existentes e já enxergam o stateM atualizado). Não altera os handlers existentes. */
function setupMensalConsolidado() {
  ['mSupervisor', 'mGerente', 'mLoja', 'mColab', 'mPeriodo', 'mMesPeriodo', 'mConsCriterio'].forEach(id => {
    document.getElementById(id).addEventListener('change', refreshConsolidado);
  });
  document.getElementById('mConsExport').addEventListener('click', exportConsolidado);
  refreshConsolidado();
}

async function initMensal() {
  setupMensalFilters();
  setupMensalExport();
  setupMensalConsolidado();
  try {
    const res = await fetch(sheetUrl(SHEET_URLS.GERAL), { cache: 'no-store' });
    if (!res.ok) throw new Error('Falha ao carregar planilha GERAL');
    const text = await res.text();
    stateM.rows = csvToObjects(text);

    populateSelect(document.getElementById('mSupervisor'), uniqueSorted(stateM.rows, COL.SUPER));
    populateSelect(document.getElementById('mGerente'), uniqueSorted(stateM.rows, COL.GERENTE));
    refreshMensalLojaOptions();
    refreshMensalPeriodOptions();
    renderMensalTree();
    refreshConsolidado();
    compOnData('geral', true);
  } catch (err) {
    console.error(err);
    compOnData('geral', false);
    document.getElementById('mTreePanel').hidden = true;
    document.getElementById('mEmptyState').hidden = false;
    document.getElementById('mEmptyState').querySelector('p').textContent = 'Erro ao carregar dados da planilha GERAL';
  }
}

/* ==========================================================================
   Comparativo Mensal — compara dois meses por colaborador (horas × vendas).
   NÃO cria base nova nem refaz cálculos: usa as MESMAS linhas já carregadas
   (state.rows = aba BASE → VENDA; stateM.rows = aba GERAL → BANCO) e reutiliza
   parseDecimalHours, decimalHoursToHHMM, formatMoney, lojaLabel, mesLabel,
   MES_ORDER, uniqueSorted e populateSelect.
   - Horas  = BANCO (saldo do mês). Seguindo a regra já adotada em #mensal, saldos
     NUNCA são somados: mais de um registro no mesmo mês é "Conflito" (fica de fora
     de totais e diferenças de horas).
   - Vendas = soma de VENDA de todos os dias do mês (consolidação por colaborador+loja).
   - Colaborador sem registro em um dos meses = 0 nesse mês.
   ========================================================================== */

const stateC = { mesAtual: '', mesAnt: '', supervisor: '', gerente: '', loja: '', colab: '', visao: 'todos', touched: false };
const compLoad = { base: 'pendente', geral: 'pendente' }; // 'pendente' | 'ok' | 'erro'
let compLast = null; // último resultado exibido (usado pela exportação)

/* Chamado quando cada fonte termina de carregar (sucesso ou erro). */
function compOnData(src, ok) {
  compLoad[src] = ok ? 'ok' : 'erro';
  compRefresh();
}

function compNormNome(s) { return String(s || '').trim().replace(/\s+/g, ' ').toUpperCase(); }
function compNormLoja(s) {
  const t = String(s == null ? '' : s).trim();
  const n = Number(t);
  return (t !== '' && !Number.isNaN(n)) ? String(n) : t;
}

/* MÊS da aba GERAL: normalmente abreviação sem ano (JAN…DEZ); aceita também AAAA-MM, MM/AAAA e MÊS/AAAA. */
function compParseMesGeral(raw) {
  const s = mesNorm(raw);
  if (!s) return null;
  const idx = MES_ORDER.indexOf(s);
  if (idx !== -1) return { mm: idx + 1, yyyy: null };
  let m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return (+m[2] >= 1 && +m[2] <= 12) ? { mm: +m[2], yyyy: +m[1] } : null;
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return (+m[1] >= 1 && +m[1] <= 12) ? { mm: +m[1], yyyy: +m[2] } : null;
  m = s.match(/^([A-Z]{3})[\/\-. ](\d{2}|\d{4})$/);
  if (m && MES_ORDER.includes(m[1])) return { mm: MES_ORDER.indexOf(m[1]) + 1, yyyy: m[2].length === 2 ? 2000 + +m[2] : +m[2] };
  return null;
}

/* Registros unificados das duas fontes já carregadas (sem alterar nenhuma delas). */
function compBuildRecords() {
  const recs = [];
  state.rows.forEach(r => {
    const key = String(r.DT || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) return;
    const v = Number(r.VENDA);
    recs.push({ tipo: 'V', nome: r.NOME, loja: compNormLoja(r.LOJA), sup: r.SUPER, ger: r.GERENTE, key, val: Number.isNaN(v) ? 0 : v });
  });
  stateM.rows.forEach(r => {
    const p = compParseMesGeral(r[COL.MES]);
    const h = parseDecimalHours(r[COL.BANCO]);
    if (!p || Number.isNaN(h)) return;
    recs.push({ tipo: 'H', nome: r[COL.NOME], loja: compNormLoja(r[COL.LOJA]), sup: r[COL.SUPER], ger: r[COL.GERENTE], mm: p.mm, yyyy: p.yyyy, val: h });
  });
  return recs;
}

function compRecInMonth(rec, key) {
  if (rec.tipo === 'V') return rec.key === key;
  return rec.mm === +key.slice(5, 7) && (rec.yyyy == null || rec.yyyy === +key.slice(0, 4));
}

/* Meses disponíveis ('AAAA-MM'), do mais recente para o mais antigo. */
function compMonthOptions(recs) {
  const keys = new Set();
  let anoRef = 0;
  recs.forEach(r => {
    if (r.tipo === 'V') { keys.add(r.key); anoRef = Math.max(anoRef, +r.key.slice(0, 4)); }
    else if (r.yyyy != null) { keys.add(`${r.yyyy}-${String(r.mm).padStart(2, '0')}`); anoRef = Math.max(anoRef, r.yyyy); }
  });
  if (!anoRef) anoRef = new Date().getFullYear();
  // Meses da aba GERAL sem ano: assumem o ano mais recente da base
  recs.forEach(r => { if (r.tipo === 'H' && r.yyyy == null) keys.add(`${anoRef}-${String(r.mm).padStart(2, '0')}`); });
  return [...keys].sort().reverse();
}

function compFilterRecs(recs, upTo) {
  return recs.filter(r =>
    (!stateC.supervisor || r.sup === stateC.supervisor) &&
    (!stateC.gerente || r.ger === stateC.gerente) &&
    (upTo === 'loja' || !stateC.loja || r.loja === stateC.loja) &&
    (upTo !== 'all' || !stateC.colab || compNormNome(r.nome) === compNormNome(stateC.colab))
  );
}

function compRefreshColab(recs) {
  const el = document.getElementById('cColab');
  populateSelect(el, uniqueSorted(compFilterRecs(recs, 'colab'), 'nome'));
  stateC.colab = el.value;
}

function compRefreshLoja(recs) {
  const el = document.getElementById('cLoja');
  populateSelect(el, uniqueSorted(compFilterRecs(recs, 'loja'), 'loja'), lojaLabel);
  stateC.loja = el.value;
  compRefreshColab(recs);
}

/* Consolida por colaborador+loja nos dois meses. */
function compBuildDados(recs) {
  const filtrados = compFilterRecs(recs, 'all');
  const map = new Map();
  filtrados.forEach(rec => {
    [['A', stateC.mesAtual], ['P', stateC.mesAnt]].forEach(([per, key]) => {
      if (!key || !compRecInMonth(rec, key)) return;
      const k = JSON.stringify([compNormNome(rec.nome), rec.loja]);
      if (!map.has(k)) map.set(k, { nome: rec.nome, loja: rec.loja, h: { A: [], P: [] }, v: { A: 0, P: 0 }, nv: { A: 0, P: 0 }, ger: new Set(), sup: new Set() });
      const e = map.get(k);
      if (rec.ger) e.ger.add(rec.ger);
      if (rec.sup) e.sup.add(rec.sup);
      if (rec.tipo === 'H') e.h[per].push(rec.val);
      else { e.v[per] += rec.val; e.nv[per] += 1; }
    });
  });

  const rows = [...map.values()].map(e => {
    const confA = e.h.A.length > 1, confP = e.h.P.length > 1;
    const hasHA = e.h.A.length > 0, hasHP = e.h.P.length > 0;
    const hasVA = e.nv.A > 0, hasVP = e.nv.P > 0;
    return {
      nome: e.nome, loja: e.loja, confA, confP, ger: [...e.ger], sup: [...e.sup],
      hasHA, hasHP, hasVA, hasVP,
      // Sem registro → NaN (nunca 0). Registro com valor 0 continua sendo 0.
      hA: (confA || !hasHA) ? NaN : e.h.A[0],
      hP: (confP || !hasHP) ? NaN : e.h.P[0],
      vA: hasVA ? Math.round(e.v.A * 100) / 100 : NaN,
      vP: hasVP ? Math.round(e.v.P * 100) / 100 : NaN
    };
  }).filter(r => (r.hasHA || r.hasVA) && (r.hasHP || r.hasVP)); // participa = registro no mês atual E no mês anterior
  rows.sort((x, y) =>
    String(x.loja).localeCompare(String(y.loja), 'pt-BR', { numeric: true }) ||
    String(x.nome).localeCompare(String(y.nome), 'pt-BR'));

  const sum = (arr, f) => arr.reduce((s, r) => s + f(r), 0);
  const totals = {
    hA: sum(rows.filter(compHorasOk), r => r.hA),
    hP: sum(rows.filter(compHorasOk), r => r.hP),
    vA: Math.round(sum(rows.filter(compVendasOk), r => r.vA) * 100) / 100,
    vP: Math.round(sum(rows.filter(compVendasOk), r => r.vP) * 100) / 100,
    conflitos: rows.filter(r => r.confA || r.confP).length,
    semHoras: rows.filter(r => !r.confA && !r.confP && !compHorasOk(r)).length,
    semVendas: rows.filter(r => !compVendasOk(r)).length
  };
  return { rows, totals, atual: stateC.mesAtual, ant: stateC.mesAnt };
}

/* Comparação de horas / vendas só existe com registro nos DOIS meses (e, em horas, sem Conflito). */
function compHorasOk(r) { return r.hasHA && r.hasHP && !r.confA && !r.confP; }
function compVendasOk(r) { return r.hasVA && r.hasVP; }

/* Variação % = ((atual − anterior) / anterior) × 100. Anterior = 0 (ou indefinido) → null ("—").
   O denominador usa o módulo do anterior para que, com saldo negativo, a seta continue
   indicando melhora/piora (para anterior positivo é exatamente a fórmula pedida). */
function compPct(cur, prev) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
function compPctText(p) {
  if (p == null) return '—';
  const r = Math.round(p * 10) / 10;
  const t = Math.abs(r).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (r > 0 ? '+' : (r < 0 ? '-' : '')) + t + '%';
}
function compSignCls(n, scale) {
  const r = Math.round(n * scale);
  return r > 0 ? 'positive' : (r < 0 ? 'negative' : '');
}
function compHorasCls(n) { return compSignCls(n, 60); }   // sinal por minuto (igual ao HH:MM exibido)
function compMoneyCls(n) { return compSignCls(n, 100); }  // sinal por centavo

/* ---- Renderização ---- */

function compCardHtml(label, valueHtml, sub) {
  return `
    <div class="comp-card">
      <span class="info-label">${label}</span>
      <span class="comp-card-value">${valueHtml}</span>
      <span class="comp-card-sub">${sub || '&nbsp;'}</span>
    </div>`;
}

function compRenderCards(d) {
  const t = d.totals;
  const ma = mesLabel(d.atual), mp = mesLabel(d.ant);
  const dh = t.hA - t.hP, dv = t.vA - t.vP;
  const ph = compPct(t.hA, t.hP), pv = compPct(t.vA, t.vP);
  document.getElementById('cCards').innerHTML =
    compCardHtml(`Total de horas · ${ma}`, `<span class="banco-value big ${compHorasCls(t.hA)}">${decimalHoursToHHMM(t.hA)}</span>`, 'mês atual') +
    compCardHtml(`Total de horas · ${mp}`, `<span class="banco-value big ${compHorasCls(t.hP)}">${decimalHoursToHHMM(t.hP)}</span>`, 'mês anterior') +
    compCardHtml('Variação das horas', `<span class="banco-value big ${compHorasCls(dh)}">${compPctText(ph)}</span>`, `${decimalHoursToHHMM(dh)} de diferença`) +
    compCardHtml(`Total de vendas · ${ma}`, `<span class="venda-value big">${formatMoney(t.vA)}</span>`, 'mês atual') +
    compCardHtml(`Total de vendas · ${mp}`, `<span class="venda-value big">${formatMoney(t.vP)}</span>`, 'mês anterior') +
    compCardHtml('Variação das vendas', `<span class="venda-value big ${compMoneyCls(dv)}">${compPctText(pv)}</span>`, `${formatMoney(dv)} de diferença`);

  const notice = document.getElementById('cNotice');
  const avisos = [];
  if (t.conflitos) avisos.push(`${t.conflitos} colaborador(es) com mais de um registro de banco de horas no mesmo mês (Conflito): esses saldos não são somados e o colaborador fica fora dos totais e diferenças de horas.`);
  if (t.semHoras) avisos.push(`${t.semHoras} colaborador(es) sem registro de horas em um dos meses ficam fora dos totais e diferenças de horas.`);
  if (t.semVendas) avisos.push(`${t.semVendas} colaborador(es) sem registro de vendas em um dos meses ficam fora dos totais e diferenças de vendas.`);
  notice.textContent = avisos.join(' ');
  notice.hidden = !avisos.length;
}

/* Gráfico de 2 barras (anterior → atual) em SVG puro, com linha de zero para saldos negativos. */
function compBarChart(valP, valA, fmt, labelP, labelA, aria) {
  const w = 360, h = 200, padTop = 28, padBottom = 44;
  const lo = Math.min(0, valP, valA), hi = Math.max(0, valP, valA);
  const span = (hi - lo) || 1;
  const plotH = h - padTop - padBottom;
  const y = v => padTop + ((hi - v) / span) * plotH;
  const zeroY = y(0);
  const bw = 96;
  const bars = [
    { v: valP, cx: w * 0.3, cls: 'comp-bar-p', label: labelP },
    { v: valA, cx: w * 0.7, cls: 'comp-bar-a', label: labelA }
  ].map(b => {
    const yv = y(b.v);
    const top = Math.min(yv, zeroY), height = Math.abs(yv - zeroY);
    const labY = b.v >= 0 ? yv - 7 : yv + 15;
    return `
      <rect x="${(b.cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw}" height="${height.toFixed(1)}" rx="4" class="${b.cls}"><title>${b.label}: ${fmt(b.v)}</title></rect>
      <text x="${b.cx.toFixed(1)}" y="${labY.toFixed(1)}" text-anchor="middle" class="comp-bar-value">${fmt(b.v)}</text>
      <text x="${b.cx.toFixed(1)}" y="${h - 10}" text-anchor="middle" class="comp-axis-label">${b.label}</text>`;
  }).join('');
  return `
    <svg viewBox="0 0 ${w} ${h}" class="comp-chart-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${aria}">
      <line x1="16" y1="${zeroY.toFixed(1)}" x2="${w - 16}" y2="${zeroY.toFixed(1)}" class="spark-zero"/>
      ${bars}
    </svg>`;
}

function compRenderCharts(d) {
  const t = d.totals, ma = mesLabel(d.atual), mp = mesLabel(d.ant);
  document.getElementById('cChartHoras').innerHTML =
    compBarChart(t.hP, t.hA, decimalHoursToHHMM, mp, ma, `Total de horas: ${mp} × ${ma}`);
  document.getElementById('cChartVendas').innerHTML =
    compBarChart(t.vP, t.vA, formatMoney, mp, ma, `Total de vendas: ${mp} × ${ma}`);
}

function compHorasCell(v, conf) {
  if (conf) return `<span class="badge badge-noregistro" title="Mais de um registro de banco de horas neste mês">Conflito</span>`;
  if (!Number.isFinite(v)) return `<span class="banco-value">—</span>`;
  return `<span class="banco-value ${compHorasCls(v)}">${decimalHoursToHHMM(v)}</span>`;
}

function compRenderTable(d) {
  const ma = mesLabel(d.atual), mp = mesLabel(d.ant);
  document.getElementById('cThHA').textContent = `Horas · ${ma}`;
  document.getElementById('cThHP').textContent = `Horas · ${mp}`;
  document.getElementById('cThVA').textContent = `Vendas · ${ma}`;
  document.getElementById('cThVP').textContent = `Vendas · ${mp}`;
  document.getElementById('cRowCount').textContent = `${d.vis.length} colaborador(es) · ${mp} × ${ma}` + (stateC.visao === 'todos' ? '' : ` · ${compVisaoLabel(stateC.visao)}`);

  const dash = `<span class="banco-value">—</span>`;
  document.getElementById('cTableBody').innerHTML = d.vis.map(r => {
    const okH = compHorasOk(r), okV = compVendasOk(r);
    const dh = okH ? r.hA - r.hP : null;
    const ph = okH ? compPct(r.hA, r.hP) : null;
    const dv = okV ? r.vA - r.vP : null;
    const pv = okV ? compPct(r.vA, r.vP) : null;
    const vCell = v => Number.isFinite(v) ? `<span class="venda-value">${formatMoney(v)}</span>` : `<span class="venda-value">—</span>`;
    return `
      <tr>
        <td class="col-nome">${escapeHtml(r.nome)}</td>
        <td>${lojaLabel(r.loja)}</td>
        <td class="num">${compHorasCell(r.hA, r.confA)}</td>
        <td class="num">${compHorasCell(r.hP, r.confP)}</td>
        <td class="num">${dh == null ? dash : `<span class="banco-value ${compHorasCls(dh)}">${decimalHoursToHHMM(dh)}</span>`}</td>
        <td class="num"><span class="banco-value ${dh == null || ph == null ? '' : compHorasCls(dh)}">${compPctText(ph)}</span></td>
        <td class="num">${vCell(r.vA)}</td>
        <td class="num">${vCell(r.vP)}</td>
        <td class="num">${dv == null ? vCell(NaN) : `<span class="venda-value ${compMoneyCls(dv)}">${formatMoney(dv)}</span>`}</td>
        <td class="num"><span class="venda-value ${pv == null ? '' : compMoneyCls(dv)}">${compPctText(pv)}</span></td>
      </tr>`;
  }).join('');
}

/* ---- Horas acumuladas em HH:MM (sem módulo de 24h) e visão Positivos/Negativos ---- */

/* 55,23333 → "55:14"; -40,96667 → "-40:58"; withPlus adiciona "+" nos positivos (usado nas diferenças). */
function compHHMM(n, withPlus) {
  const m = Math.round(Math.abs(n) * 60);
  if (m === 0) return '00:00';
  const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return (n < 0 ? '-' : (withPlus ? '+' : '')) + t;
}

/* Diferença de horas em minutos (mesma regra do HH:MM exibido); null quando há Conflito. */
function compDiffMin(r) {
  return compHorasOk(r) ? Math.round((r.hA - r.hP) * 60) : null;
}

/* 'positivos' → maior diferença primeiro; 'negativos' → mais negativos primeiro; 'todos' → ordem original. */
function compVisaoRows(rows, visao) {
  const byNome = (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  if (visao === 'positivos') {
    return rows.filter(r => compDiffMin(r) > 0).sort((a, b) => compDiffMin(b) - compDiffMin(a) || byNome(a, b));
  }
  if (visao === 'negativos') {
    return rows.filter(r => compDiffMin(r) < 0).sort((a, b) => compDiffMin(a) - compDiffMin(b) || byNome(a, b));
  }
  return rows;
}

function compVisaoLabel(visao) {
  return visao === 'positivos' ? 'Positivos' : (visao === 'negativos' ? 'Negativos' : 'Todos');
}

function compShowEmpty(text) {
  document.getElementById('cContent').hidden = true;
  document.getElementById('cEmptyState').hidden = false;
  document.getElementById('cEmptyText').textContent = text;
  compLast = null;
}

function compRender() {
  const recs = compBuildRecords();
  const d = compBuildDados(recs);
  document.getElementById('cHint').textContent =
    stateC.mesAtual === stateC.mesAnt ? 'Atenção: os dois meses selecionados são iguais.' : '';

  if (!d.rows.length) {
    compShowEmpty('Nenhum dado encontrado para os meses e filtros selecionados.');
    return;
  }
  d.vis = compVisaoRows(d.rows, stateC.visao);
  compLast = d;
  compRenderCards(d);
  compRenderCharts(d);
  compRenderTable(d);
  document.getElementById('cExport').disabled = document.getElementById('cPdf').disabled = !d.vis.length;
  document.getElementById('cEmptyState').hidden = true;
  document.getElementById('cContent').hidden = false;
}

/* Atualiza opções (meses e filtros) a partir dos dados já carregados e redesenha. */
function compRefresh() {
  if (compLoad.base === 'erro' || compLoad.geral === 'erro') {
    compShowEmpty('Não foi possível carregar todos os dados (BASE e GERAL); o comparativo está indisponível.');
    return;
  }
  if (compLoad.base === 'pendente' || compLoad.geral === 'pendente') {
    compShowEmpty('Carregando dados…');
    return;
  }

  const recs = compBuildRecords();
  const meses = compMonthOptions(recs);
  if (!meses.length) { compShowEmpty('Nenhum mês encontrado na base de dados.'); return; }

  const elA = document.getElementById('cMesAtual'), elP = document.getElementById('cMesAnterior');
  if (!stateC.touched) { elA.value = ''; elP.value = ''; }
  populateSelect(elA, meses, mesLabel);
  populateSelect(elP, meses, mesLabel);
  if (!stateC.touched || !meses.includes(elA.value)) {
    elA.value = meses[0];
    elP.value = meses[1] || meses[0];
  }
  stateC.mesAtual = elA.value;
  stateC.mesAnt = elP.value;

  populateSelect(document.getElementById('cSupervisor'), uniqueSorted(recs, 'sup'));
  populateSelect(document.getElementById('cGerente'), uniqueSorted(recs, 'ger'));
  stateC.supervisor = document.getElementById('cSupervisor').value;
  stateC.gerente = document.getElementById('cGerente').value;
  compRefreshLoja(recs);
  compRender();
}

/* ---- Exportação (CSV, mesmo padrão do "Exportar CSV" existente; não altera as exportações atuais) ---- */

function compExport() {
  const d = compLast;
  if (!d || !d.vis.length) return;
  const ma = mesLabel(d.atual), mp = mesLabel(d.ant);
  const dec = (n, dig) => n.toFixed(dig).replace('.', ',');
  const pct = p => p == null ? '—' : dec(p, 2);
  /* Horas como TEXTO (="HH:MM"): o Excel não converte em horário nativo nem estraga valores negativos / acima de 24h. */
  const horasTxt = n => `="${compHHMM(n, false)}"`;
  const difTxt = n => `="${compHHMM(n, true)}"`;
  const headers = [
    'COLABORADOR', 'LOJA',
    `HORAS ${ma}`, `HORAS ${mp}`, 'DIFERENÇA HORAS', 'VARIAÇÃO HORAS (%)',
    `VENDAS ${ma}`, `VENDAS ${mp}`, 'DIFERENÇA VENDAS', 'VARIAÇÃO VENDAS (%)'
  ];
  const lines = [headers.join(';')];
  d.vis.forEach(r => {
    const okH = compHorasOk(r), okV = compVendasOk(r);
    const hTxt = (v, c) => c ? 'Conflito' : (Number.isFinite(v) ? horasTxt(v) : '—');
    const vTxt = v => Number.isFinite(v) ? dec(v, 2) : '—';
    lines.push([
      r.nome, lojaLabel(r.loja),
      hTxt(r.hA, r.confA),
      hTxt(r.hP, r.confP),
      okH ? difTxt(r.hA - r.hP) : '—',
      okH ? pct(compPct(r.hA, r.hP)) : '—',
      vTxt(r.vA), vTxt(r.vP), okV ? dec(r.vA - r.vP, 2) : '—', okV ? pct(compPct(r.vA, r.vP)) : '—'
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `comparativo_mensal_${d.atual}_vs_${d.ant}${stateC.visao === 'todos' ? '' : '_' + stateC.visao}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---- Exportar PDF (impressão do navegador → "Salvar como PDF", mesmo método do Acompanhamento Mensal) ---- */

function compUnion(rows, key) {
  const out = [];
  rows.forEach(r => (r[key] || []).forEach(v => { if (!out.includes(v)) out.push(v); }));
  return out.length ? out.join(' / ') : '—';
}

function compPrintTable(rows, ma, mp) {
  const trs = rows.map(r => {
    const okH = compHorasOk(r);
    const dh = okH ? r.hA - r.hP : null;
    const ph = okH ? compPct(r.hA, r.hP) : null;
    const hCell = (v, c) => c ? '<span class="cp-conf">Conflito</span>' : (!Number.isFinite(v) ? '—' : `<span class="banco-value ${compHorasCls(v)}">${compHHMM(v, false)}</span>`);
    return `
      <tr>
        <td class="cp-nome">${escapeHtml(r.nome)}</td>
        <td>${lojaLabel(r.loja)}</td>
        <td>${escapeHtml(compUnion([r], 'ger'))}</td>
        <td>${escapeHtml(compUnion([r], 'sup'))}</td>
        <td class="num">${hCell(r.hA, r.confA)}</td>
        <td class="num">${hCell(r.hP, r.confP)}</td>
        <td class="num">${dh == null ? '—' : `<span class="banco-value ${compHorasCls(dh)}">${compHHMM(dh, true)}</span>`}</td>
        <td class="num"><span class="banco-value ${dh == null || ph == null ? '' : compHorasCls(dh)}">${compPctText(ph)}</span></td>
      </tr>`;
  }).join('');
  return `
    <table class="cp-table">
      <thead>
        <tr>
          <th>Colaborador</th><th>Loja</th><th>Gerente</th><th>Supervisor</th>
          <th class="num">Horas · ${ma}</th><th class="num">Horas · ${mp}</th>
          <th class="num">Diferença de horas</th><th class="num">Variação %</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>`;
}

function compBuildPrintHtml(d) {
  const ma = mesLabel(d.atual), mp = mesLabel(d.ant);
  const agora = new Date();
  const gerado = `${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  const meta = [
    ['Período comparado', `${ma} × ${mp}`],
    ['Supervisor', stateC.supervisor || 'Todos'],
    ['Gerente', stateC.gerente || 'Todos'],
    ['Loja', stateC.loja ? lojaLabel(stateC.loja) : 'Todas']
  ];
  if (stateC.colab) meta.push(['Colaborador', stateC.colab]);
  if (stateC.visao !== 'todos') meta.push(['Visualização', compVisaoLabel(stateC.visao)]);

  let body;
  if (stateC.supervisor) {
    // Um supervisor selecionado → uma seção por loja (Gerente e Supervisor identificados em cada uma)
    const lojas = [...new Set(d.vis.map(r => r.loja))]
      .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }));
    body = lojas.map(loja => {
      const rows = d.vis.filter(r => r.loja === loja);
      return `
        <section class="cp-section">
          <h2>${lojaLabel(loja).toUpperCase()}</h2>
          <p class="cp-section-meta"><strong>Gerente:</strong> ${escapeHtml(compUnion(rows, 'ger'))} &nbsp;·&nbsp; <strong>Supervisor:</strong> ${escapeHtml(compUnion(rows, 'sup'))}</p>
          ${compPrintTable(rows, ma, mp)}
        </section>`;
    }).join('');
  } else {
    body = `<section class="cp-section">${compPrintTable(d.vis, ma, mp)}</section>`;
  }

  return `
    <header class="cp-head">
      <span class="cp-brand">Registro &amp; Venda · Rede de Farmácias</span>
      <h1>COMPARATIVO MENSAL</h1>
      <p class="cp-sub">${ma} × ${mp}</p>
      <dl class="cp-meta">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>
      <p class="cp-date">Gerado em ${gerado}</p>
    </header>
    ${body}`;
}

function compExportPdf() {
  const d = compLast;
  if (!d || !d.vis.length) return;
  const doc = document.getElementById('cPrintDoc');
  doc.innerHTML = compBuildPrintHtml(d);
  document.body.classList.add('printing-comp');
  const tituloAnterior = document.title;
  document.title = `Comparativo Mensal ${mesLabel(d.atual)} x ${mesLabel(d.ant)}`.replace(/\//g, '-');
  const restore = () => {
    document.body.classList.remove('printing-comp');
    document.title = tituloAnterior;
    doc.innerHTML = '';
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}

function setupComparativo() {
  const onMes = () => {
    stateC.touched = true;
    stateC.mesAtual = document.getElementById('cMesAtual').value;
    stateC.mesAnt = document.getElementById('cMesAnterior').value;
    compRender();
  };
  document.getElementById('cMesAtual').addEventListener('change', onMes);
  document.getElementById('cMesAnterior').addEventListener('change', onMes);
  document.getElementById('cSupervisor').addEventListener('change', e => {
    stateC.supervisor = e.target.value;
    compRefreshLoja(compBuildRecords());
    compRender();
  });
  document.getElementById('cGerente').addEventListener('change', e => {
    stateC.gerente = e.target.value;
    compRefreshLoja(compBuildRecords());
    compRender();
  });
  document.getElementById('cLoja').addEventListener('change', e => {
    stateC.loja = e.target.value;
    compRefreshColab(compBuildRecords());
    compRender();
  });
  document.getElementById('cColab').addEventListener('change', e => {
    stateC.colab = e.target.value;
    compRender();
  });
  document.getElementById('cVisao').addEventListener('change', e => {
    stateC.visao = e.target.value;
    compRender();
  });
  document.getElementById('cExport').addEventListener('click', compExport);
  document.getElementById('cPdf').addEventListener('click', compExportPdf);
}

/* ---------------- Navegação entre abas ---------------- */

function showPage(page) {
  const isMensal = page === 'mensal';
  const isComp = page === 'comparativo';
  document.getElementById('pageRegistro').hidden = isMensal || isComp;
  document.getElementById('pageMensal').hidden = !isMensal;
  document.getElementById('pageComparativo').hidden = !isComp;
  document.getElementById('navRegistro').classList.toggle('active', !isMensal && !isComp);
  document.getElementById('navMensal').classList.toggle('active', isMensal);
  document.getElementById('navComparativo').classList.toggle('active', isComp);
  document.getElementById('pageTitle').textContent = isComp
    ? 'Comparativo Mensal por Colaborador'
    : (isMensal ? 'Acompanhamento Mensal por Colaborador' : 'Registro e Venda por Colaborador');
  document.getElementById('crumbActive').textContent = isComp
    ? 'Comparativo mensal'
    : (isMensal ? 'Acompanhamento mensal' : 'Acompanhamento diário');
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
  if (isComp) compRefresh();
}

function setupRouter() {
  const applyHash = () => showPage(window.location.hash === '#mensal' ? 'mensal' : (window.location.hash === '#comparativo' ? 'comparativo' : 'registro'));
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
  setupComparativo();
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
    compOnData('base', true);
  } catch (err) {
    console.error(err);
    compOnData('base', false);
    loadedChip.classList.add('stale');
    loadedText.textContent = 'Erro ao carregar dados da planilha BASE';
    document.getElementById('rowCount').textContent = 'Não foi possível carregar os dados.';
  }
}

document.addEventListener('DOMContentLoaded', init);
