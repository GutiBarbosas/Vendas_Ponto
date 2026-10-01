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

async function initMensal() {
  setupMensalFilters();
  setupMensalExport();
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
