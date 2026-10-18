"""Shared test fixtures."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from clausewise import privacy
from clausewise.app import create_app
from clausewise.config import Settings

from scripted_engine import ScriptedEngine

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def _reset_guard():
    yield
    privacy.uninstall_egress_guard()
    privacy.reset_blocked_attempts()


def make_client(mode: str = "good", state: str = "ready", **overrides: Any) -> tuple[TestClient, ScriptedEngine]:
    engine = ScriptedEngine(mode, state)
    settings = Settings(warmup=False, egress_guard=False, **overrides)
    return TestClient(create_app(settings, engine)), engine


@pytest.fixture
def client() -> TestClient:
    return make_client()[0]


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def make_pdf(pages: list[str], encrypt: str | None = None) -> bytes:
    from pypdf import PdfReader, PdfWriter
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for page in pages:
        y = 800
        for line in page.split("\n"):
            c.drawString(50, y, line)
            y -= 16
        c.showPage()
    c.save()
    data = buf.getvalue()
    if encrypt is None:
        return data
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(data)))
    writer.encrypt(user_password=encrypt, owner_password=encrypt, algorithm="RC4-128")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def upload(client: TestClient, name: str, data: bytes, content_type: str = "text/plain"):
    return client.post("/api/documents", files={"file": (name, data, content_type)})
