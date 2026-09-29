# CNAB Studio

Editor visual de arquivos de remessa CNAB (.rem). Importa um arquivo, identifica o layout e o tipo de operação, e mostra lado a lado um formulário organizado (arquivo, cedente, sacados, títulos) e o arquivo posicional resultante. Cada campo do formulário mostra onde vai parar no arquivo, e cada trecho do arquivo leva ao seu campo.

## Rodando

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # testes do núcleo (layouts, round-trip, detecção)
npm run build
```

## Layouts suportados

| Layout | Registros |
| --- | --- |
| CNAB 444 · FIDC | Header 0, Detalhe 1, Lastro 3, Trailer 9 |
| CNAB 444 · Cobrança bancária | Header 0, Título 1, E-mail/descontos 2, Split 3, Avalista 7, Trailer 9 |
| CNAB 240 · Cobrança | Header de arquivo/lote, Segmentos P, Q, R, S, trailers |

## Estrutura

```
src/
  cnab/                 núcleo, sem React
    layouts/            um arquivo por layout (posições, tipos, domínios)
    codec.ts            leitura/escrita posicional, alinhamento e preenchimento
    document.ts         parse, serialização, títulos, campos compartilhados, validação, classificação
    detect.ts           identificação do layout pelo conteúdo
    format.ts           datas, valores, CPF/CNPJ, DV do nosso número
  state/                histórico (desfazer/refazer), ligação formulário ↔ arquivo
  components/           interface
```

### Como um layout é descrito

Cada campo declara posição, tipo e onde aparece no editor:

```ts
money('valorFace', 'Valor de face (nominal)', 127, 139, { required: true }),
alfa('cedenteNome', 'Nome do cedente', 335, 380, { group: 'cedente', share: 'cedente.nome' }),
```

- `group` decide o card: `arquivo`, `cedente`, `sacado`, `titulo` ou `control` (só no inspetor).
- `share` liga o mesmo dado em registros diferentes: editar o cedente atualiza todas as linhas; editar um sacado atualiza as linhas do título (ou todos os títulos do sacado, pelo card Sacados).
- `fixed`, `blank` e `auto` marcam literais, brancos e campos calculados (sequenciais, contadores de lote).

Um teste garante que todo registro cobre as posições 1…N sem lacunas nem sobreposição.

## Atalhos

| Atalho | Ação |
| --- | --- |
| Ctrl+O | Importar arquivo |
| Ctrl+S | Baixar .rem |
| Ctrl+Z / Ctrl+Shift+Z | Desfazer / refazer |
| ↑ ↓ (no arquivo) | Navegar entre linhas |
| Duplo clique (no inspetor) | Editar o conteúdo bruto de um campo |

## Observações de interpretação

- **CNAB 444 cobrança, posições 335–394 (sacador/avalista):** decomposto como documento (335–349, `0+CNPJ` ou `CPF+0000+dígitos`), brancos (350–351) e nome (352–394).
- **CNAB 444 cobrança, CEP:** prefixo (327–331) e sufixo (332–334) são editados como um único campo de 8 dígitos. O mesmo vale para o registro 7 e para o segmento Q do 240.
- **CNAB 444 FIDC, tipo de lastro (53–54):** a documentação lista "N – Serviços Não Performado"; como o campo tem 2 posições, o código usado é `SN`.
- **Classificação da operação:** vem das ocorrências dos títulos. Um código fora da documentação com valor pago preenchido é tratado como liquidação.
