# Fotos ilustrativas licenciadas nas landings demonstrativas

Data: 2026-08-22
Status: aprovado

## Problema

A demonstração gerada pelo NOX OS não tem fotografia. Sem imagem, a página lê como
protótipo, não como site entregue — o que enfraquece a conversa comercial.

A ideia original era puxar imagens de resultados de busca. Isso foi descartado: seria
republicar obra de terceiro sem licença numa página que se apresenta como sendo de outra
empresa, com risco jurídico para a NOX OS e para o usuário, além de depender de hotlink
que quebra. Também contraria três regras já vigentes do módulo: não inventar imagens ou
URLs, exigir HTTPS em foto oficial e identificar imagem ilustrativa de forma explícita.

## Solução

Buscar fotografia em banco com licença aberta e API oficial (Pexels), pela categoria do
lead, sempre rotulada como **imagem ilustrativa** e nunca apresentada como foto do
estabelecimento. Mais um hero com foto de fundo.

Fora de escopo nesta entrega: Open Graph para preview no WhatsApp, tipografia editorial,
restyle do aviso de demonstração.

## Arquitetura

### `src/lib/stock-photos.ts` (novo)

Cliente server-side do Pexels.

- Configuração por ambiente: `PEXELS_API_KEY`, `PEXELS_TIMEOUT_MS`. Sem chave, o recurso
  fica desligado e todo o resto continua funcionando — mesmo padrão da integração Claude.
- `searchStockPhotos({ query, perPage, page })` faz `GET https://api.pexels.com/v1/search`
  com `Authorization: <chave>`, `orientation=landscape`, timeout por `AbortController` e
  erros tipados (`not_configured`, `timeout`, `rate_limited`, `upstream`,
  `invalid_response`). A mensagem do erro upstream nunca é repassada ao cliente.
- A resposta é validada por schema Zod. **A URL de cada foto só é aceita se o host for
  `images.pexels.com`** — a resposta de terceiro é tratada como dado hostil, igual à do
  Claude.
- `stockPhotoQueryForCategory(category)` traduz a categoria do lead para um termo de busca
  em inglês, reaproveitando os mesmos grupos de categoria já usados pelo gerador
  (`padaria → bakery interior`, `barbearia → barbershop`, `oficina → auto repair shop`,
  com fallback genérico `local small business storefront`).
- Cache em memória com TTL curto por termo, para não desperdiçar o limite de 200
  requisições por hora da conta gratuita. É melhor-esforço: em serverless cada instância
  tem o seu.

### Schema — `src/lib/demo-landing-schema.ts`

Hoje toda imagem recebe na página o rótulo fixo "Imagem fornecida". É preciso distinguir
foto oficial (colada pelo usuário) de foto ilustrativa (banco).

Campos novos, todos com `default`, de modo que demonstrações já gravadas continuem
válidas e sejam lidas como `official` — o comportamento atual. **Sem migration.**

- `galleryImages[].kind`: `"official" | "stock"`, default `"official"`
- `galleryImages[].credit`: texto anulável, default `null`
- `galleryImages[].creditUrl`: URL HTTPS opcional, default `""`
- `heroImageKind`, `heroImageCredit`, `heroImageCreditUrl`: equivalentes para o hero

### `src/lib/demo-landing-photos.ts` (novo)

- `applyStockPhotos(content, photos)` — função pura. Só preenche hero e galeria que
  estejam vazios; **nunca sobrescreve foto já cadastrada pelo usuário.**
- `fetchDemoStockPhotos(category)` — envelopa a busca e **nunca lança**: falha de rede,
  ausência de chave ou resposta inválida devolvem `{ hero: null, gallery: [] }`.

### Gerador gratuito

`generateDemoLandingContent` permanece pura e síncrona, sem rede — é o fallback e é
testada assim. A busca de fotos entra como etapa separada em `regenerateDemoLanding`:
gera o conteúdo, tenta buscar 1 hero + 3 fotos de galeria, aplica o que veio. **A geração
nunca falha por causa de imagem.**

### `GET /api/stock-photos` (novo)

Autenticada. Aceita `q` (termo) e `page`. Devolve 12 resultados. `per_page` fixo e `page`
limitada, mais um limite por usuário em memória, para conter uso abusivo. Sem chave
configurada, responde 503 com mensagem clara.

### Editor — `src/components/leads/stock-photo-picker.tsx` (novo)

O painel de demonstração já é grande; o seletor sai em componente próprio. Abre uma grade
de 12 resultados com o termo pré-preenchido pela categoria do lead. Clicar adiciona à
galeria ou define como imagem principal, gravando `kind: "stock"` e o crédito.

### Página pública

- Hero ganha a foto como fundo, com sobreposição escura, preservando o contraste já
  calculado por `readableAccentColor`.
- Rótulo por foto: "Imagem ilustrativa" para `stock`, "Imagem fornecida" para `official`.
- Crédito ao fotógrafo e link para o Pexels no rodapé, atendendo à licença.

## Regras preservadas

- O Claude continua sem poder tocar em imagem: os campos novos entram na lista protegida
  e o merge assistido os reaplica a partir do conteúdo salvo.
- Aviso de demonstração, `noindex`, validade configurável, endereço aleatório e snapshot
  protegido: inalterados.
- Foto de banco jamais é descrita como foto do estabelecimento.

## Testes

- Tradução categoria → termo de busca, incluindo o fallback.
- Allowlist de host: URL fora de `images.pexels.com` é descartada.
- Sem chave, com API fora do ar e com resposta malformada, a geração produz a mesma
  demonstração de hoje.
- `applyStockPhotos` não sobrescreve foto do usuário.
- Conteúdo gravado antes desta mudança continua sendo lido como `official`.
- O merge do Claude não altera nenhum campo de imagem.
- A página rotula cada tipo de foto corretamente.

## Configuração necessária

`PEXELS_API_KEY` nas variáveis de ambiente da Vercel, de conta gratuita em
`pexels.com/api`. A chave nunca aparece no código, no navegador, no banco ou nos logs.
