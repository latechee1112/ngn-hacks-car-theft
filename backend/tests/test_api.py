def _profile(**overrides):
    base = {
        "profileId": "p1",
        "maxVisibleBlocks": 6,
        "spacingMultiplier": 1.2,
        "textScale": 1.0,
        "contrastMode": "standard",
        "reduceMotion": False,
        "progressiveReveal": False,
        "simplificationStrength": 0.7,
        "source": "manual",
    }
    base.update(overrides)
    return base


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_calibration_profile_endpoint_returns_valid_shape(client):
    resp = client.post("/v1/calibration/profile", json={"trials": []})
    assert resp.status_code == 200
    body = resp.json()
    assert "profile" in body
    assert "explanation" in body
    assert body["profile"]["source"] == "calibration"


def test_analyze_page_falls_back_without_llm_key(client):
    payload = {
        "profile": _profile(),
        "blocks": [
            {"id": "b1", "tag": "article", "elementType": "article", "textPreview": "content"},
            {"id": "b2", "tag": "input", "elementType": "input", "textPreview": "Password"},
        ],
    }
    resp = client.post("/v1/analyze-page", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["actions"]) == 2
    b2_action = next(a for a in body["actions"] if a["blockId"] == "b2")
    assert b2_action["action"] == "keep"
    assert "fallback" in " ".join(body["warnings"]).lower()


def test_analyze_page_rejects_oversized_block_count(client):
    blocks = [
        {"id": f"b{i}", "tag": "div", "elementType": "paragraph", "textPreview": "x"}
        for i in range(151)
    ]
    resp = client.post("/v1/analyze-page", json={"profile": _profile(), "blocks": blocks})
    assert resp.status_code == 413


def test_analyze_page_rejects_malformed_block(client):
    resp = client.post(
        "/v1/analyze-page",
        json={"profile": _profile(), "blocks": [{"unexpectedField": True}]},
    )
    assert resp.status_code == 422


def test_analyze_page_never_collapses_safety_critical_at_max_strength(client):
    payload = {
        "profile": _profile(simplificationStrength=1.0),
        "blocks": [
            {
                "id": "b1",
                "tag": "div",
                "elementType": "paragraph",
                "textPreview": "Your payment failed, please try again",
            },
            {"id": "b2", "tag": "div", "elementType": "ad", "textPreview": "Buy now"},
        ],
    }
    resp = client.post("/v1/analyze-page", json=payload)
    assert resp.status_code == 200
    actions = {a["blockId"]: a["action"] for a in resp.json()["actions"]}
    assert actions["b1"] != "collapse"
    assert actions["b2"] == "collapse"


def test_analyze_page_accepts_full_extraction_result_shape(client):
    payload = {
        "url": "https://example.com/signup",
        "extractedAt": 1735689600000,
        "hasSensitiveForms": True,
        "profile": _profile(),
        "task": "Fill out the signup form",
        "blocks": [
            {
                "id": "b1",
                "tag": "form",
                "role": "form",
                "textPreview": "",
                "elementType": "form",
                "position": {"x": 10, "y": 20, "width": 300, "height": 400},
                "isInteractive": False,
                "isFixed": False,
                "hasAnimation": False,
                "linkCount": 0,
            },
        ],
    }
    resp = client.post("/v1/analyze-page", json=payload)
    assert resp.status_code == 200
