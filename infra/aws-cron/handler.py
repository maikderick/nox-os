"""Aciona o consumidor duravel do NOX OS a partir do EventBridge Scheduler.

Tres decisoes que valem estar escritas.

**Nao e fire-and-forget.** A funcao espera a resposta. Voltar antes dela nao
prova que o consumidor recebeu a requisicao, e muito menos que terminou — e uma
Lambda que sempre "da certo" e uma Lambda que nao esta medindo nada. O preco e
esperar, e os limites abaixo existem para que esperar seja coerente em vez de
acidental.

**O destino e conferido antes do segredo.** `CRON_URL` vem do ambiente, e
ambiente e uma coisa que alguem edita. Se ele apontasse para outro host, o
`Authorization: Bearer` iria junto. Entao a URL passa por uma allowlist fechada
— esquema, host e caminho — e so depois o parametro e lido do SSM.

**O cache do segredo vence.** Um cache sem prazo faz a rotacao nunca chegar: o
valor antigo continua sendo enviado ate a Lambda ser reciclada, o que pode
demorar horas. Aqui ele expira, e o relogio e injetavel para o teste medir isso
sem esperar.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

LIMITS = json.loads((Path(__file__).with_name("limits.json")).read_text(encoding="utf-8"))

HTTP_TIMEOUT_SECONDS: int = LIMITS["httpTimeoutSeconds"]
SECRET_CACHE_TTL_SECONDS: int = LIMITS["secretCacheTtlSeconds"]
ALLOWED_SCHEME: str = LIMITS["allowedScheme"]
ALLOWED_HOST: str = LIMITS["allowedHost"]
ALLOWED_PATH: str = LIMITS["allowedPath"]


class DestinoRecusado(RuntimeError):
    """A URL configurada nao e o consumidor desta instalacao."""


class ConsumidorNaoRespondeu(RuntimeError):
    """Nao houve resposta dentro do prazo, ou a conexao falhou."""


# (valor, instante de vencimento em relogio monotonico)
_cached_secret: tuple[str, float] | None = None


def _reset_cache() -> None:
    """So para teste. Producao nunca chama."""
    global _cached_secret
    _cached_secret = None


def assert_destino_permitido(url: str) -> None:
    """Recusa qualquer destino que nao seja exatamente o consumidor conhecido.

    Conferido ANTES de o segredo ser resolvido: uma URL adulterada nao deve nem
    causar a leitura do parametro, quanto mais o envio do cabecalho.
    """
    partes = urlsplit(url)

    if partes.scheme != ALLOWED_SCHEME:
        raise DestinoRecusado("O destino do agendador precisa ser https.")
    if partes.hostname != ALLOWED_HOST:
        raise DestinoRecusado("O destino do agendador nao esta na lista permitida.")
    if partes.path != ALLOWED_PATH:
        raise DestinoRecusado("O caminho do agendador nao esta na lista permitida.")
    # Usuario, senha, porta, query e fragmento nao fazem parte do destino
    # conhecido. Aceitar qualquer um deles seria aceitar um destino diferente
    # que so se parece com o certo.
    if partes.username or partes.password or partes.port or partes.query or partes.fragment:
        raise DestinoRecusado("O destino do agendador nao aceita partes extras na URL.")


def _cron_secret(agora: Callable[[], float] = time.monotonic) -> str:
    global _cached_secret

    if _cached_secret is not None and agora() < _cached_secret[1]:
        return _cached_secret[0]

    # Importado aqui, e nao no topo, para que o modulo seja testavel sem a SDK
    # e para nao pagar o import quando o valor ja esta em cache.
    import boto3  # noqa: PLC0415

    parameter_name = os.environ["CRON_SECRET_PARAMETER"]
    response = boto3.client("ssm").get_parameter(Name=parameter_name, WithDecryption=True)
    valor = response["Parameter"]["Value"]

    _cached_secret = (valor, agora() + SECRET_CACHE_TTL_SECONDS)
    return valor


def handler(
    _event: object = None,
    _context: object = None,
    *,
    agora: Callable[[], float] = time.monotonic,
) -> dict[str, int]:
    url = os.environ["CRON_URL"]
    assert_destino_permitido(url)

    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Authorization": f"Bearer {_cron_secret(agora)}",
            "User-Agent": "nox-os-aws-scheduler/2.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            status = response.status
            response.read(1024)
    except urllib.error.HTTPError as error:
        # O corpo e drenado e descartado. Ele pode conter o que o consumidor
        # respondeu, e nada disso precisa entrar num log da Lambda.
        error.read(1024)
        raise RuntimeError(f"O consumidor respondeu HTTP {error.code}.") from None
    except urllib.error.URLError:
        # `from None` de proposito: a excecao original carrega a URL, e a URL
        # nao tem por que aparecer numa mensagem de erro que vai para o log.
        raise ConsumidorNaoRespondeu(
            "O consumidor nao respondeu ao agendador dentro do prazo."
        ) from None

    if not 200 <= status < 300:
        raise RuntimeError(f"O consumidor respondeu HTTP {status}.")

    return {"statusCode": status}
