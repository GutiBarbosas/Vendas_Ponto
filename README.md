# Registro & Venda — Dashboard

Dashboard estático (HTML/CSS/JS puro, sem frameworks e sem backend) para visualizar,
filtrar e ordenar os dados da planilha BASE, pronto para publicar no GitHub Pages.

## Estrutura

```
index.html          → estrutura da página
css/style.css        → tema visual (escuro, corporativo)
js/app.js             → carregamento do CSV, filtros, ordenação, exportação
data/BASE.csv          → dados da planilha (fonte da verdade)
```

## Como atualizar os dados

1. Exporte a aba `BASE` da planilha para CSV mantendo exatamente estas colunas e
   nesta ordem: `NOME,LOJA,DT,DIA,STATUS_RH,VENDA,GERENTE,SUPER`.
2. A coluna `DT` deve estar no formato `AAAA-MM-DD` (ex: `2026-09-06`).
3. Substitua o arquivo `data/BASE.csv` por esse novo arquivo, mantendo o mesmo nome.
4. Não é necessário alterar HTML, CSS ou JS — o dashboard lê o CSV automaticamente
   ao carregar a página.

Nenhum dado é calculado, somado ou transformado — o dashboard apenas exibe, formata
para leitura (datas em dd/mm/aaaa, dia da semana por extenso, valores em R$) e permite
filtrar/ordenar exatamente os dados presentes na planilha.

## Publicar no GitHub Pages

1. Suba esta pasta (`index.html`, `css/`, `js/`, `data/`) para a raiz de um
   repositório GitHub (ou para a pasta `/docs`, se preferir).
2. Em *Settings → Pages*, selecione a branch e a pasta correspondente.
3. O link do GitHub Pages abrirá o dashboard automaticamente.

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
