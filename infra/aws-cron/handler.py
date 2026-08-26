"""Aciona o consumidor duravel do NOX OS a partir do EventBridge Scheduler."""

from __future__ import annotations

import os
import urllib.error
import urllib.request

import boto3


_ssm = boto3.client("ssm")
_cached_secret: str | None = None


def _cron_secret() -> str:
    global _cached_secret

    if _cached_secret is None:
        parameter_name = os.environ["CRON_SECRET_PARAMETER"]
        response = _ssm.get_parameter(Name=parameter_name, WithDecryption=True)
        _cached_secret = response["Parameter"]["Value"]

    return _cached_secret


def handler(_event: object, _context: object) -> dict[str, int]:
    url = os.environ["CRON_URL"]
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Authorization": f"Bearer {_cron_secret()}",
            "User-Agent": "nox-os-aws-scheduler/1.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=50) as response:
            status = response.status
            response.read(1024)
    except urllib.error.HTTPError as error:
        error.read(1024)
        raise RuntimeError(f"O consumidor respondeu HTTP {error.code}.") from None
    except urllib.error.URLError as error:
        raise RuntimeError("O consumidor nao respondeu ao agendador.") from error

    if not 200 <= status < 300:
        raise RuntimeError(f"O consumidor respondeu HTTP {status}.")

    return {"statusCode": status}
