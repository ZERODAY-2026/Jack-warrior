from conftest import fixture_bytes, make_client, make_pdf, upload

RENTAL = fixture_bytes("rental_agreement.txt")


def analyse(mode="good", data=RENTAL, name="rental_agreement.txt"):
    client, engine = make_client(mode)
    resp = upload(client, name, data)
    return client, engine, resp


def assert_passages_match_source(client, body):
    text = "".join(p["text"] for p in client.get(f"/api/documents/{body['document_id']}/text").json()["pages"])
    for f in body["findings"]:
        for p in f["source_passages"]:
            assert text[p["char_start"] : p["char_end"]] == p["text"]
            assert p["verified"] is True


def test_health_reports_model_limits_and_privacy():
    client, _ = make_client()
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["model"]["state"] == "ready"
    assert body["limits"]["accepted_extensions"] == [".pdf", ".txt"]
    assert body["privacy"]["bind_host"] == "127.0.0.1" and body["privacy"]["telemetry_enabled"] is False
    assert body["privacy"]["storage"] == "memory_only"


def test_health_degraded_when_model_missing_and_upload_refused():
    client, _ = make_client(state="not_installed")
    assert client.get("/api/health").json()["status"] == "degraded"
    resp = upload(client, "r.txt", RENTAL)
    assert resp.status_code == 503 and resp.json()["error"]["code"] == "model_not_ready"


def test_analysis_returns_verified_findings_with_source_offsets():
    client, engine, resp = analyse()
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["findings"] and body["document"]["file_type"] == "txt"
    assert all(f["evidence_status"] == "verified" for f in body["findings"])
    assert_passages_match_source(client, body)
    assert body["processing"]["model_calls"] == len(engine.calls) >= 2
    assert "not legal advice" in body["disclaimer"].lower()
    # Document text is sent to the model only inside the excerpt delimiters.
    system, user = engine.calls[0]
    assert "Vikram" not in system and '<document_excerpt id="c' in user


def test_glossary_terms_must_exist_in_document():
    body = analyse()[2].json()
    terms = [g["term"] for g in body["glossary"]]
    assert "security deposit" in terms and "indemnity" not in terms


def test_not_found_topics_use_safe_wording():
    body = analyse()[2].json()
    topics = {n["topic"]: n["note"] for n in body["not_found"]}
    assert "Governing law" in topics and "Liability or indemnity" in topics
    assert all(note.startswith("Not found in the reviewed text") for note in topics.values())
    assert "Termination or ending the agreement" not in topics


def test_fabricated_quotes_are_never_shown():
    client, _, resp = analyse("fabricate")
    body = resp.json()
    assert body["processing"]["quotes_rejected"] > 0
    for f in body["findings"]:
        if f["evidence_status"] == "none":
            assert f["source_passages"] == [] and f["classification"] == "not_established"
            assert f["limitations"]
    assert "waives all rights" not in resp.text


def test_wrong_numbers_in_explanation_are_withheld():
    body = analyse("wrong_number")[2].json()
    assert "90 days" not in str(body["findings"])
    assert any("did not match" in " ".join(f["limitations"]) for f in body["findings"])
    assert "99,999" not in body["summary"]["text"]


def test_legal_conclusions_are_screened():
    body = analyse("legal_conclusion")[2].json()
    text = str(body["findings"]).lower()
    assert "unenforceable" not in text and "should not sign" not in text


def test_prompt_injection_is_flagged_not_followed():
    client, engine, resp = analyse(data=fixture_bytes("injection_notice.txt"), name="svc.txt")
    body = resp.json()
    assert any(w["code"] == "instruction_like_text" for w in body["warnings"])
    inj = [f for f in body["findings"] if f["title"].startswith("Text that reads like instructions")]
    assert inj and "Ignore all previous instructions" in inj[0]["source_passages"][0]["text"]
    assert_passages_match_source(client, body)
    # The injected text reached the model only as fenced document data.
    _, user = engine.calls[0]
    assert user.index("Ignore all previous") > user.index("<document_excerpt")


def test_pdf_analysis_has_page_numbers():
    pdf = make_pdf(["1. RENT", "The Tenant shall pay rent of Rs. 10,000 every month.", ""][0:2] + ["6. TERMINATION\nEither party may terminate this agreement with thirty days notice."])
    client, _ = make_client()
    body = upload(client, "lease.pdf", pdf, "application/pdf").json()
    pages = {p["page"] for f in body["findings"] for p in f["source_passages"]}
    assert pages and None not in pages


def test_model_bad_output_and_timeout_errors():
    resp = analyse("bad_json")[2]
    assert resp.status_code == 500 and resp.json()["error"]["code"] == "analysis_failed"
    resp = analyse("timeout")[2]
    assert resp.status_code == 504 and resp.json()["error"]["code"] == "timeout"


def test_upload_validation_errors():
    client, _ = make_client(max_file_bytes=2000)
    resp = upload(client, "big.txt", b"a" * 5000)
    assert resp.status_code == 413 and resp.json()["error"]["code"] == "file_too_large"
    resp = upload(client, "x.docx", b"PK\x03\x04zip")
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "unsupported_type"
    resp = upload(client, "empty.txt", b"")
    assert resp.json()["error"]["code"] == "empty_document"
    resp = client.post("/api/documents")
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "invalid_request"


def test_errors_do_not_leak_content_or_paths():
    client, _ = make_client(mode="bad_json")
    resp = upload(client, "rental.txt", RENTAL)
    assert "Vikram" not in resp.text and "/home" not in resp.text and "Traceback" not in resp.text


def ask(client, doc_id, q):
    return client.post(f"/api/documents/{doc_id}/ask", json={"question": q}).json()


def test_ask_answered_with_verified_passage():
    client, _, resp = analyse()
    a = ask(client, resp.json()["document_id"], "What is the notice period to terminate?")
    assert a["answer_type"] == "answered" and a["source_passages"]
    assert "thirty (30) days" in " ".join(p["text"] for p in a["source_passages"])


def test_ask_document_silent():
    client, _, resp = analyse()
    a = ask(client, resp.json()["document_id"], "Are pets allowed?")
    assert a["answer_type"] == "not_in_document" and a["source_passages"] == []
    assert a["classification"] == "not_established"


def test_ask_enforceability_escalates():
    client, _, resp = analyse()
    a = ask(client, resp.json()["document_id"], "Is the late fee clause enforceable?")
    assert a["answer_type"] == "needs_professional"
    assert a["escalation"] and "lawyer" in a["escalation"].lower()
    assert a["jurisdiction_note"]
    assert "cannot assess" in a["answer"]


def test_ask_advice_escalates():
    client, _, resp = analyse()
    a = ask(client, resp.json()["document_id"], "Should I sign this rental agreement?")
    assert a["answer_type"] == "needs_professional" and a["escalation"]


def test_ask_fabricated_quote_withholds_answer():
    client, _, resp = analyse("fabricate")
    a = ask(client, resp.json()["document_id"], "What is the notice period to terminate?")
    assert a["answer_type"] == "not_in_document"
    assert "orally" not in str(a)
    assert a["limitations"]


def test_ask_validation_and_unknown_document():
    client, _, resp = analyse()
    doc_id = resp.json()["document_id"]
    r = client.post(f"/api/documents/{doc_id}/ask", json={"question": "  "})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_question"
    r = client.post(f"/api/documents/{doc_id}/ask", json={"question": "x" * 501})
    assert r.json()["error"]["code"] == "invalid_question"
    r = client.post("/api/documents/d_nope/ask", json={"question": "hi"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "document_not_found"


def test_delete_removes_everything():
    client, _, resp = analyse()
    doc_id = resp.json()["document_id"]
    ask(client, doc_id, "What is the rent?")
    r = client.delete(f"/api/documents/{doc_id}")
    assert r.status_code == 200 and r.json()["deleted"] is True
    assert client.get(f"/api/documents/{doc_id}/text").status_code == 404
    assert client.delete(f"/api/documents/{doc_id}").status_code == 404
    assert len(client.app.state.store) == 0


def test_long_document_is_partially_analysed_with_warning():
    clauses = "\n\n".join(f"{i}. CLAUSE {i}\nThe Tenant shall pay a charge of Rs. {i}00 within {i} days of notice." for i in range(1, 120))
    client, _ = make_client(analysis_char_budget=2000, window_chars=1000)
    body = upload(client, "long.txt", clauses.encode()).json()
    assert any(w["code"] == "long_document_partially_analysed" for w in body["warnings"])
    assert body["processing"]["chunks_analysed"] < body["processing"]["chunks_total"]
