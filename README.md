# Registro & Venda — Dashboard

Dashboard estático (HTML/CSS/JS puro, sem frameworks e sem backend) para visualizar,
filtrar e ordenar os dados da planilha BASE, pronto para publicar no GitHub Pages.
Os dados são lidos diretamente do Google Sheets publicado em CSV — não há
arquivos CSV locais no repositório.

## Estrutura (todos os arquivos na raiz, sem subpastas)

```
index.html   → estrutura da página
style.css     → tema visual (escuro, corporativo)
app.js         → busca dos CSVs publicados no Google Sheets, filtros, ordenação, exportação
```

Os arquivos ficam soltos, todos no mesmo nível, para evitar o problema comum de
subpastas se perderem no upload direto pelo site do GitHub ("Add file → Upload files").

## Como atualizar os dados

Os dados agora vêm direto do Google Sheets publicado (não há mais `BASE.csv`
nem `GERAL.csv` no repositório). Basta editar a planilha de origem — o
dashboard busca a versão publicada em CSV automaticamente a cada carregamento
da página, sem precisar tocar em HTML, CSS ou JS.

- Aba **BASE/VENDA** (tabela "Registro de Vendas"): mantenha exatamente estas
  colunas e nesta ordem: `NOME,LOJA,DT,DIA,STATUS_RH,VENDA,GERENTE,SUPER`.
  A coluna `DT` deve estar no formato `AAAA-MM-DD` (ex: `2026-09-06`).
- Aba **GERAL/COMPARATIVO** (aba "Acompanhamento Mensal"): mantenha
  exatamente estas colunas e nesta ordem:
  `NOME,ADMISSÃO,FUNÇÃO,LOJA,BANCO,MÊS`. A coluna `BANCO` deve permanecer no
  formato decimal de horas (ex: `1,933333` ou `-1,116667`); o dashboard
  converte automaticamente para `HH:MM` com o sinal (ex: `+01:56`, `-01:07`).

Importante: no Google Sheets, qualquer alteração na aba de origem precisa
estar publicada (*Arquivo → Compartilhar → Publicar na web*) para refletir no
dashboard — se a planilha só foi salva mas a publicação está desatualizada, o
dashboard continuará mostrando os dados antigos.

Nenhum dado é calculado, somado ou transformado — o dashboard apenas exibe, formata
para leitura (datas em dd/mm/aaaa, dia da semana por extenso, valores em R$) e permite
filtrar/ordenar exatamente os dados presentes na planilha.

## Publicar no GitHub Pages

1. Suba `index.html`, `style.css`, `app.js` e `README.md` direto na raiz do
   repositório (via "Add file → Upload files", selecionando os arquivos juntos).
2. Em *Settings → Pages*, selecione a branch `main` e a pasta `/ (root)`.
3. O link do GitHub Pages abrirá o dashboard automaticamente em 1-2 minutos.

## Filtros disponíveis

Data, Dia, Supervisor, Gerente, Loja, Status e busca por Colaborador — todos
atualizam a tabela instantaneamente e podem ser combinados. O botão "Limpar filtros"
reseta tudo. Clicar em qualquer cabeçalho da tabela ordena por aquela coluna.

## Observações sobre os dados

- `STATUS_RH = SEM_REGISTRO` é destacado com um selo vermelho na tabela — isso não
  significa venda zero; o valor de `VENDA` daquele colaborador/dia é mostrado normalmente,
  exatamente como está na planilha.
- A coluna `LOJA` é exibida como "Loja NN" apenas por formatação (o número em si não é alterado).
- O botão "Exportar CSV" exporta exatamente as linhas visíveis após os filtros aplicados,
  sem nenhum cálculo adicional.
