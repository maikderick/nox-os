"""Testes do agendador. Nenhum toca a rede, e nenhum cria recurso na AWS.

`urllib.request.urlopen` e o cliente SSM sao substituidos; o que se exercita e a
decisao do handler, que e a unica parte que nos pertence.

Rodar: `python -m unittest discover -s infra/aws-cron -p "test_*.py"`
"""

from __future__ import annotations

import json
import sys
import types
import traceback
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))

import handler as h  # noqa: E402

LIMITS = json.loads((Path(__file__).with_name("limits.json")).read_text(encoding="utf-8"))
URL_OK = f"https://{LIMITS['allowedHost']}{LIMITS['allowedPath']}"
SEGREDO = "segredo-do-agendador-nao-deve-vazar"


class RespostaFalsa:
    def __init__(self, status: int = 200) -> None:
        self.status = status

    def __enter__(self) -> "RespostaFalsa":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self, _n: int = 0) -> bytes:
        return b'{"claimed":0}'


def ssm_falso(valores: list[str]) -> types.ModuleType:
    """Um modulo `boto3` que devolve valores em sequencia, sem rede."""
    chamadas: list[str] = []

    class Cliente:
        def get_parameter(self, Name: str, WithDecryption: bool) -> dict:  # noqa: N803
            chamadas.append(Name)
            valor = valores[min(len(chamadas) - 1, len(valores) - 1)]
            return {"Parameter": {"Value": valor}}

    modulo = types.ModuleType("boto3")
    modulo.client = lambda _servico: Cliente()  # type: ignore[attr-defined]
    modulo.chamadas = chamadas  # type: ignore[attr-defined]
    return modulo


class Base(unittest.TestCase):
    def setUp(self) -> None:
        h._reset_cache()
        self.boto3 = ssm_falso([SEGREDO])
        patcher = mock.patch.dict(sys.modules, {"boto3": self.boto3})
        patcher.start()
        self.addCleanup(patcher.stop)

        env = mock.patch.dict(
            "os.environ",
            {"CRON_URL": URL_OK, "CRON_SECRET_PARAMETER": "/nox-os/production/cron-secret"},
        )
        env.start()
        self.addCleanup(env.stop)
        self.addCleanup(h._reset_cache)


class TestLimites(Base):
    def test_os_prazos_sao_coerentes_e_com_margem(self) -> None:
        # Cada um precisa ser maior que o anterior, e por um motivo:
        # o consumidor para antes de a plataforma o matar; o cliente HTTP nao
        # desiste antes de a plataforma desistir; e a Lambda sobrevive ao
        # cliente HTTP com folga para ler o SSM e responder.
        self.assertLess(LIMITS["consumerBudgetSeconds"], LIMITS["functionMaxDurationSeconds"])
        self.assertLess(LIMITS["functionMaxDurationSeconds"], LIMITS["httpTimeoutSeconds"])
        self.assertLess(LIMITS["httpTimeoutSeconds"], LIMITS["lambdaTimeoutSeconds"])
        self.assertGreaterEqual(
            LIMITS["lambdaTimeoutSeconds"] - LIMITS["httpTimeoutSeconds"], 15
        )

    def test_o_handler_usa_o_prazo_declarado(self) -> None:
        self.assertEqual(h.HTTP_TIMEOUT_SECONDS, LIMITS["httpTimeoutSeconds"])

    def test_a_concorrencia_cobre_a_sobreposicao_que_a_agenda_produz(self) -> None:
        # Um disparo por minuto e invocacoes que podem durar o timeout inteiro:
        # a sobreposicao maxima e o teto dividido pelo intervalo.
        sobreposicao = -(-LIMITS["lambdaTimeoutSeconds"] // 60)
        self.assertGreaterEqual(LIMITS["reservedConcurrency"], sobreposicao)

    def test_o_scheduler_nao_repete(self) -> None:
        # A fila ja tem retentativa com backoff e lease. Repetir aqui so
        # acrescentaria um consumidor a mais — seguro, inutil — e esconderia uma
        # queda real atras de ruido de retry.
        self.assertEqual(LIMITS["scheduleRetryAttempts"], 0)


class TestDestino(Base):
    def test_aceita_o_destino_conhecido(self) -> None:
        h.assert_destino_permitido(URL_OK)

    def test_recusa_destinos_fora_da_allowlist(self) -> None:
        proibidos = [
            "http://" + LIMITS["allowedHost"] + LIMITS["allowedPath"],
            "https://exemplo-atacante.test" + LIMITS["allowedPath"],
            f"https://{LIMITS['allowedHost']}/api/outra-coisa",
            f"https://{LIMITS['allowedHost']}{LIMITS['allowedPath']}?x=1",
            f"https://{LIMITS['allowedHost']}{LIMITS['allowedPath']}#frag",
            f"https://usuario:senha@{LIMITS['allowedHost']}{LIMITS['allowedPath']}",
            f"https://{LIMITS['allowedHost']}:8443{LIMITS['allowedPath']}",
            f"https://{LIMITS['allowedHost']}.atacante.test{LIMITS['allowedPath']}",
            "file:///etc/passwd",
            "",
        ]
        for url in proibidos:
            with self.subTest(url=url):
                with self.assertRaises(h.DestinoRecusado):
                    h.assert_destino_permitido(url)

    def test_destino_recusado_nao_le_o_segredo(self) -> None:
        # A ordem e o ponto: URL adulterada nao deve nem causar a leitura do
        # parametro, quanto mais o envio do cabecalho.
        with mock.patch.dict("os.environ", {"CRON_URL": "https://atacante.test/api/jobs/run"}):
            with self.assertRaises(h.DestinoRecusado):
                h.handler()
        self.assertEqual(self.boto3.chamadas, [])


class TestRequisicao(Base):
    def test_faz_get_com_o_cabecalho_e_o_prazo(self) -> None:
        with mock.patch("urllib.request.urlopen", return_value=RespostaFalsa()) as aberto:
            resultado = h.handler()

        self.assertEqual(resultado, {"statusCode": 200})
        requisicao, = aberto.call_args.args
        self.assertEqual(requisicao.get_method(), "GET")
        self.assertEqual(requisicao.get_full_url(), URL_OK)
        self.assertEqual(requisicao.get_header("Authorization"), f"Bearer {SEGREDO}")
        self.assertEqual(aberto.call_args.kwargs["timeout"], LIMITS["httpTimeoutSeconds"])

    def test_recusa_uma_resposta_fora_da_faixa_de_sucesso(self) -> None:
        with mock.patch("urllib.request.urlopen", return_value=RespostaFalsa(status=302)):
            with self.assertRaises(RuntimeError):
                h.handler()


class TestFalhas(Base):
    def test_http_error_vira_erro_sem_corpo_nem_segredo(self) -> None:
        erro = urllib.error.HTTPError(URL_OK, 500, "erro", {}, None)
        erro.read = lambda _n=0: b"corpo do consumidor com detalhe interno"  # type: ignore[method-assign]

        with mock.patch("urllib.request.urlopen", side_effect=erro):
            with self.assertRaises(RuntimeError) as capturado:
                h.handler()

        mensagem = str(capturado.exception)
        self.assertIn("500", mensagem)
        self.assertNotIn("corpo do consumidor", mensagem)
        self.assertNotIn(SEGREDO, mensagem)

    def test_timeout_vira_erro_proprio_sem_url_nem_segredo(self) -> None:
        with mock.patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.URLError(TimeoutError("timed out")),
        ):
            with self.assertRaises(h.ConsumidorNaoRespondeu) as capturado:
                h.handler()

        mensagem = str(capturado.exception)
        self.assertNotIn(SEGREDO, mensagem)
        self.assertNotIn(LIMITS["allowedHost"], mensagem)

    def test_url_error_de_conexao_tambem(self) -> None:
        with mock.patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.URLError(ConnectionRefusedError()),
        ):
            with self.assertRaises(h.ConsumidorNaoRespondeu):
                h.handler()

    def test_o_que_chega_ao_log_nao_carrega_segredo_nem_url(self) -> None:
        # O sink real e o traceback formatado, que e o que a Lambda registra.
        # `from None` marca `__suppress_context__`, entao a original nao aparece
        # ali — ainda que continue pendurada em `__context__` na memoria.
        with mock.patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.URLError(TimeoutError(f"timed out para {URL_OK}")),
        ):
            try:
                h.handler()
            except h.ConsumidorNaoRespondeu as erro:
                self.assertIsNone(erro.__cause__)
                self.assertTrue(erro.__suppress_context__)
                registrado = "".join(
                    traceback.format_exception(type(erro), erro, erro.__traceback__)
                )
                self.assertNotIn(SEGREDO, registrado)
                self.assertNotIn(URL_OK, registrado)
                self.assertNotIn("timed out para", registrado)


class TestSegredo(Base):
    def test_reusa_o_valor_enquanto_o_cache_vale(self) -> None:
        relogio = [1000.0]
        with mock.patch("urllib.request.urlopen", return_value=RespostaFalsa()):
            h.handler(agora=lambda: relogio[0])
            relogio[0] += LIMITS["secretCacheTtlSeconds"] - 1
            h.handler(agora=lambda: relogio[0])

        self.assertEqual(len(self.boto3.chamadas), 1)

    def test_le_de_novo_quando_o_cache_vence(self) -> None:
        # Um cache sem prazo faz a rotacao nunca chegar: o valor antigo continua
        # sendo enviado ate a Lambda ser reciclada, o que pode demorar horas.
        modulo = ssm_falso([SEGREDO, "segredo-rotacionado"])
        with mock.patch.dict(sys.modules, {"boto3": modulo}):
            relogio = [1000.0]
            with mock.patch("urllib.request.urlopen", return_value=RespostaFalsa()) as aberto:
                h.handler(agora=lambda: relogio[0])
                relogio[0] += LIMITS["secretCacheTtlSeconds"] + 1
                h.handler(agora=lambda: relogio[0])

            self.assertEqual(len(modulo.chamadas), 2)  # type: ignore[attr-defined]
            ultima, = aberto.call_args.args
            self.assertEqual(ultima.get_header("Authorization"), "Bearer segredo-rotacionado")

    def test_le_o_parametro_que_o_ambiente_nomeia(self) -> None:
        with mock.patch("urllib.request.urlopen", return_value=RespostaFalsa()):
            h.handler()
        self.assertEqual(self.boto3.chamadas, ["/nox-os/production/cron-secret"])


if __name__ == "__main__":
    unittest.main()
