# Fixtures de sandbox

Respostas com o **formato real** das APIs, com todo segredo redigido.

Elas existem para provar a parte que o modo `FALSO` não prova: que o NOX OS lê
corretamente o formato que o provedor realmente devolve — nomes de campo,
aninhamento, tipos. O estado continua simulado localmente; o que vem daqui é a
forma da resposta.

Regras:

- Nenhum token, chave privada, cabeçalho de autorização ou cookie.
- Identificadores de exemplo, nunca de uma conta real.
- `tests/unit/providers-sandbox.test.ts` reprova qualquer arquivo desta pasta que
  contenha algo com cara de segredo.
