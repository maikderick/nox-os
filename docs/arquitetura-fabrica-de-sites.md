# Arquitetura da fábrica de sites

## Objetivo da fase 1

Esta fase transforma o NOX OS em fonte de verdade para uma operação de sites. Ela não
integra Cursor, Lovable ou outro agente de código: entrega o domínio, as permissões e o
contrato que permitirão conectar provedores depois sem reescrever o fluxo principal.

## Fronteiras do domínio

- `Business` continua sendo o registro de prospecção e guarda endereço, telefone,
  coordenadas e redes sociais.
- `Client` referencia `Business` por `businessId` único. A conversão copia apenas nome e
  identidade operacional, então dados pessoais não se espalham para o novo domínio.
- `SiteProject` pertence a uma organização e a um cliente. Seu estado só muda pelas
  transições declaradas em `src/lib/site-factory/states.ts`.
- `SiteBriefVersion` é imutável. Editar um briefing cria uma nova linha e atualiza somente
  `currentBriefVersionId` no projeto.
- `GenerationRun` registra a execução de um provedor. `SiteRevision` registra o resultado
  imutável e o commit correspondente.
- `Deployment` sempre aponta para uma `SiteRevision`; publicação nunca aponta para um
  diretório mutável ou para a saída informal de um agente.
- `Domain`, `Asset` e `UsageLedger` pertencem à organização e podem ser ligados ao projeto.

## Autorização

O papel legado do usuário não autoriza o novo domínio. Toda operação resolve uma
`OrganizationMembership` ativa e verifica uma permissão concreta.

| Capacidade | OWNER | ADMIN | OPERADOR | LEITOR |
| --- | --- | --- | --- | --- |
| Ler clientes e projetos | sim | sim | sim | sim |
| Criar/editar cliente, projeto e briefing | sim | sim | sim | não |
| Executar geração e pedir publicação | sim | sim | sim | não |
| Aprovar briefing/publicação | sim | sim | não | não |
| Excluir, configurar e gerenciar membros | sim | sim* | não | não |

\* Um `ADMIN` não pode alterar outro `OWNER`, e a organização nunca pode ficar sem dono.

As páginas fazem a checagem no servidor. As rotas usam `withAuthorization`; os serviços
recebem um `Actor` já resolvido e ainda validam a permissão e o `organizationId` antes de
consultar ou alterar registros.

## Briefing factual

Cada fato tem `value`, `source` e `confirmedAt`. As fontes aceitas são `LEAD`, `OPERADOR`,
`CLIENTE` e `IMPORTACAO`. Textos livres passam pelas mesmas regras anti-invenção usadas
pelas demonstrações: telefone, preço, avaliação, depoimento, prêmio, horário, garantia,
superlativo e outras afirmações de risco não entram silenciosamente.

O hash SHA-256 de uma representação estável do briefing é gravado em `factsHash`. Ele não
substitui a validação Zod; serve para detectar adulteração ou divergência na entrada que
alimentou uma geração.

## Ciclo de vida

```text
RASCUNHO -> BRIEFING_PRONTO -> GERANDO -> PREVIA_PRONTA -> EM_REVISAO
                                                              |
                                                              v
                                                         APROVADO
                                                              |
                                                              v
                                                        PUBLICANDO -> PUBLICADO
```

`GERANDO` e `PUBLICANDO` têm retornos de sistema para sucesso ou `FALHOU`. Essas
transições não aparecem como ações humanas. Uma pessoa pode pedir geração ou publicação,
mas somente o orquestrador confirma a conclusão.

## Provedores de geração

`CodeGenerationProvider` recebe projeto, versão do briefing e conteúdo validado. O
registro atual contém apenas `manual`, que devolve um handoff pendente e não acessa rede,
variáveis secretas ou agentes externos. Um provedor futuro lê suas credenciais somente na
implementação server-side e grava no banco apenas identificadores e resultados não secretos.

## Compatibilidade de DemoLanding

- Registros existentes permanecem disponíveis para edição interna.
- Novos `POST /api/demo-landings` retornam `410`, salvo flag de compatibilidade explícita.
- Apenas `APPROVED` renderiza no endereço público ou redireciona para um site construído.
- Alterar conteúdo aprovado devolve a demonstração para `DRAFT`.
- Aprovar exige `publish:approve`.

## Banco e migração

As migrations são aditivas. A organização `nox-os` é criada sem alterar leads, e cada
usuário existente recebe uma associação: o administrador mais antigo vira `OWNER`, demais
administradores viram `ADMIN`, operadores viram `OPERADOR` e papéis desconhecidos viram
`LEITOR`. Contas inativas recebem associações inativas.

## Arquitetura-alvo e contrato do site

A direção definitiva da fábrica está em
[docs/superpowers/specs/2026-08-25-fabrica-de-sites-arquitetura-alvo.md](superpowers/specs/2026-08-25-fabrica-de-sites-arquitetura-alvo.md).
Em resumo: cada cliente terá repositório GitHub privado próprio, projeto Vercel isolado,
versões identificadas por commit imutável e publicação condicionada à aprovação humana de
uma revisão exata.

O contrato de conteúdo dos sites gerados é o `schemaVersion: 1` do pacote `@nox/site-kit`,
construído na Fase 2 nos repositórios irmãos `nox-site-kit` e `nox-site-template`. O NOX OS
**não** depende desse pacote: os dois precisam poder evoluir e ser publicados em ritmos
diferentes.

O que mantém os dois lados honestos é uma cópia versionada dos artefatos do kit em
`contracts/site-kit/`:

| Arquivo | Para que serve |
| --- | --- |
| `site-content.schema.json` | JSON Schema do snapshot publicável |
| `site-manifest.schema.json` | JSON Schema do manifesto de geração |
| `site-content.example.json` | Fixture completa canônica |
| `site-content.minimal.json` | Fixture mínima canônica |
| `fabrication-rules.json` | Regras anti-invenção, com os padrões literais |
| `hashes.json` | SHA-256 do JSON canônico de cada fixture |

`tests/unit/site-export-contract.test.ts` valida contra esses arquivos que:

- o snapshot produzido por `buildSiteContentSnapshot` é aceito pelo schema do kit;
- os dois lados serializam de forma canônica idêntica, e portanto calculam o mesmo
  `contentSha256` — que é exatamente o que a build do site confere antes de compilar;
- as regras anti-invenção têm os mesmos ids e reprovam os mesmos textos nos dois parsers.

Quando o contrato mudar, rode `npm run export:artifacts` no `nox-site-kit` e copie os
artefatos para `contracts/site-kit/`. Se a divergência não for intencional, o teste
reprova aqui, e não no site de um cliente.

### Limite conhecido do briefing

O `SiteBriefVersion` da Fase 1 guarda apenas o **nome** de cada serviço. Isso não descreve
uma página de serviço sem inventar resumo e corpo, então o exportador emite a página
somente quando o operador fornece essa cópia (`serviceDetails`). Antes da Fase 4, o schema
do briefing precisa ganhar `services[].summary` e `services[].body` confirmados.
