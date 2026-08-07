import os

os.environ.setdefault("FEATHERLESS_API_KEY", "")

import pytest
from fastapi.testclient import TestClient

from main import app, limiter


@pytest.fixture(autouse=True)
def _disable_rate_limiting():
    previous = limiter.enabled
    limiter.enabled = False
    yield
    limiter.enabled = previous


@pytest.fixture
def client():
    return TestClient(app)
