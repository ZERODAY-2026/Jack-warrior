from conftest import fixture_bytes, make_client, make_docx, make_pdf, upload

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
    assert body["limits"]["accepted_extensions"] == [".pdf", ".docx", ".txt"] and body["limits"]["accepts_pasted_text"] is True
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
    system, user = next(c for c in engine.calls if '<document_excerpt id="c' in c[1])
    assert "Vikram" not in system and "Vikram" in user


def test_glossary_terms_must_exist_in_document():
    body = analyse()[2].json()
    terms = [g["term"] for g in body["glossary"]]
    assert "security deposit" in terms and "indemnity" not in terms


def test_missing_points_are_proposed_and_checked_by_the_model():
    client, engine = make_client()
    engine.missing = [
        {"topic": "Pets", "why_it_matters": "The flat is let to a family but nothing says whether pets are allowed.",
         "suggested_action": "Ask the Landlord whether pets are allowed.", "search_terms": ["pets", "animals"]},
        {"topic": "security deposit", "why_it_matters": "Money is held.", "suggested_action": None, "search_terms": ["deposit"]},
    ]
    body = upload(client, "rental.txt", RENTAL).json()
    # Proposals come from the model; the model's own check against related passages decides which stay.
    assert [n["topic"] for n in body["not_found"]] == ["Pets"]
    missing = [f for f in body["findings"] if f["title"].startswith("Not addressed:")]
    assert [f["title"] for f in missing] == ["Not addressed: Pets"]
    f = missing[0]
    assert f["evidence_status"] == "none" and f["classification"] == "not_established" and f["source_passages"] == []
    assert f["next_step"] == "Ask the Landlord whether pets are allowed." and "does not appear to address" in f["explanation"]
    check = next(u for _, u in engine.calls if "Decide whether the document addresses" in u)
    assert "1. Pets (related excerpts" in check and "<document_excerpt" in check
    assert body["findings"][-1]["title"] == "Not addressed: Pets"  # missing points come after the cited ones


def test_no_missing_points_when_the_model_proposes_none():
    body = analyse()[2].json()
    assert body["not_found"] == [] and not any(f["title"].startswith("Not addressed") for f in body["findings"])


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
    resp = upload(client, "x.xlsx", b"PK\x03\x04zip")
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


def test_model_concerns_are_shown_as_concerns():
    client, _, resp = analyse()
    body = resp.json()
    deposit = [f for f in body["findings"] if f["title"] == "Deposit deductions not defined"]
    assert len(deposit) == 1
    f = deposit[0]
    assert f["category"] == "ambiguity" and f["classification"] == "concern" and f["evidence_status"] == "verified"
    assert "considers reasonable" in f["source_passages"][0]["text"]
    assert f["next_step"] == "Ask the Landlord to list which deductions can be made from the deposit."
    assert f["impact"] == "Part of the deposit could be kept without a clear basis."
    assert_passages_match_source(client, body)


def test_every_finding_comes_from_the_model_or_the_security_check():
    body = analyse()[2].json()
    for f in body["findings"]:
        assert "priority" not in f and "priority_reason" not in f
        assert f["title"].startswith("Clause in") or f["title"] == "Deposit deductions not defined", f["title"]


def test_fabricated_concern_quote_is_dropped():
    body = analyse("fabricate")[2].json()
    assert "keep the whole deposit" not in str(body)
    deposit = [f for f in body["findings"] if f["title"] == "Deposit deductions not defined"]
    assert deposit and deposit[0]["evidence_status"] == "none" and deposit[0]["classification"] == "not_established"


def test_glossary_matches_whole_words_and_skips_headings():
    body = analyse()[2].json()
    rent = next(g for g in body["glossary"] if g["term"] == "Rent")
    text = rent["source_passages"][0]["text"]
    assert "RENTAL" not in text and "monthly rent" in text


def test_unusable_type_answer_falls_back_to_general_with_warning():
    client, engine = make_client()
    engine.type_answer = "spaceship"
    body = upload(client, "rental.txt", RENTAL).json()
    assert body["document_type"]["id"] == "general" and body["document_type"]["method"] == "fallback"
    assert any(w["code"] == "type_not_detected" for w in body["warnings"]) and body["findings"]


def test_glossary_term_only_in_a_heading_cites_the_text_under_it():
    body = analyse()[2].json()
    entry = next(g for g in body["glossary"] if g["term"] == "Maintenance")
    assert entry["source_passages"][0]["text"].startswith("The Tenant shall keep the premises in good condition")


def test_duplicate_concern_titles_are_distinguished():
    body = analyse()[2].json()
    titles = [f["title"] for f in body["findings"]]
    assert len(titles) == len(set(t.lower() for t in titles))


def test_docx_upload_is_analysed_with_source_offsets():
    from conftest import docx_paragraphs

    text = RENTAL.decode().splitlines()
    client, _, resp = analyse(data=make_docx(docx_paragraphs(*text)), name="rental.docx")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["document"]["file_type"] == "docx" and body["findings"]
    assert_passages_match_source(client, body)


def test_pasted_text_is_analysed_like_a_file():
    client, _ = make_client()
    resp = client.post("/api/documents/text", json={"text": RENTAL.decode(), "title": "My lease"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["document"]["filename"] == "My lease" and body["document"]["file_type"] == "txt"
    assert body["findings"] and all(f["evidence_status"] == "verified" for f in body["findings"])
    assert_passages_match_source(client, body)
    assert client.post(f"/api/documents/{body['document_id']}/ask", json={"question": "What is the notice period?"}).status_code == 200
    assert client.post("/api/documents/text", json={"text": RENTAL.decode()}).json()["document"]["filename"] == "Pasted text"


def test_pasted_text_errors():
    client, _ = make_client(max_file_bytes=2000)
    for payload, status, code in [
        ({"text": "   \n "}, 400, "empty_document"),
        ({"title": "no text"}, 400, "invalid_request"),
        ({"text": "a" * 5000}, 413, "file_too_large"),
    ]:
        resp = client.post("/api/documents/text", json=payload)
        assert resp.status_code == status and resp.json()["error"]["code"] == code


def _analyse_fixture(name, **form):
    client, engine = make_client()
    data = fixture_bytes(name)
    resp = client.post("/api/documents", files={"file": (name, data, "text/plain")}, data=form)
    assert resp.status_code == 200, resp.text
    return client, engine, resp.json()


import pytest  # noqa: E402


@pytest.mark.parametrize(
    "name,type_id",
    [("rental_agreement.txt", "rental"), ("employment_contract.txt", "employment"), ("legal_notice.txt", "legal_notice"),
     ("service_agreement.txt", "service"), ("nda.txt", "nda"), ("marital_settlement.txt", "family")],
)
def test_model_detects_the_type_and_it_goes_into_the_prompts(name, type_id):
    client, engine, body = _analyse_fixture(name)
    t = body["document_type"]
    assert t["id"] == type_id and t["source"] == "detected" and t["method"] == "model" and t["confidence"] == "high"
    classify = engine.calls[0][1]
    assert "Choose type_id from this list" in classify and '<document_excerpt id="start">' in classify
    _, user = engine.calls[1]
    assert f"Document type: {t['label']}." in user and "Report each underlying issue once" in user
    assert body["findings"] and all(f["evidence_status"] == "verified" for f in body["findings"] if not f["title"].startswith("Not addressed"))
    assert_passages_match_source(client, body)


def test_document_type_can_be_chosen_and_changed():
    client, engine, body = _analyse_fixture("service_agreement.txt", document_type="freelance")
    assert body["document_type"]["id"] == "freelance" and body["document_type"]["source"] == "user"
    assert body["document_type"]["detected_id"] is None  # the user's choice is used without a detection call
    assert not any("Choose type_id" in u for _, u in engine.calls)
    resp = client.post(f"/api/documents/{body['document_id']}/reanalyse", json={"document_type": "auto"})
    assert resp.status_code == 200 and resp.json()["document_type"]["id"] == "service"
    assert resp.json()["document_id"] == body["document_id"]
    assert "Freelance" not in engine.calls[-1][1] and "Document type: Service agreement." in engine.calls[-1][1]
    bad = client.post(f"/api/documents/{body['document_id']}/reanalyse", json={"document_type": "spaceship"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "invalid_document_type"
    pasted = client.post("/api/documents/text", json={"text": fixture_bytes("nda.txt").decode(), "document_type": "employment"})
    assert pasted.json()["document_type"]["id"] == "employment"
    types = client.get("/api/document-types").json()
    assert {"id": "legal_notice", "label": "Legal notice or demand notice"} in types and types[-1]["id"] == "general"


def test_unknown_text_falls_back_to_general():
    client, _ = make_client()
    body = client.post("/api/documents/text", json={"text": "Minutes of the meeting. The members agreed to meet again in 30 days. Each member shall pay a fee."}).json()
    assert body["document_type"]["id"] == "general" and body["document_type"]["confidence"] == "low"


@pytest.mark.parametrize(
    "name,present_q,present_word,absent_q",
    [
        ("employment_contract.txt", "What is my notice period?", "sixty (60) days", "Does it mention health insurance?"),
        ("legal_notice.txt", "How many days do I have to pay?", "fifteen (15) days", "Is there an arbitration clause?"),
        ("service_agreement.txt", "What is the monthly fee?", "Rs. 12,000", "Does it mention a refund policy?"),
        ("rental_agreement.txt", "When is rent due?", "5th day", "Are pets allowed?"),
    ],
)
def test_questions_use_the_right_document(name, present_q, present_word, absent_q):
    client, engine, body = _analyse_fixture(name)
    doc = body["document_id"]
    ans = client.post(f"/api/documents/{doc}/ask", json={"question": present_q}).json()
    # Retrieval put the clause that answers the question in front of the model, from this document only.
    _, prompt = engine.calls[-1]
    excerpts = prompt.split("Question:", 1)[1]
    assert present_word in excerpts and f"Document type: {body['document_type']['label']}." in prompt
    text = "".join(p["text"] for p in client.get(f"/api/documents/{doc}/text").json()["pages"])
    assert ans["answer_type"] == "answered" and ans["source_passages"]
    assert all(text[p["char_start"] : p["char_end"]] == p["text"] for p in ans["source_passages"])
    absent = client.post(f"/api/documents/{doc}/ask", json={"question": absent_q}).json()
    assert absent["answer_type"] == "not_in_document" and absent["source_passages"] == []
    assert "could not find a passage" in absent["answer"]


def test_impact_is_shown_and_checked_against_the_passage():
    body = analyse()[2].json()
    assert any(f["impact"] == "This sets what you must do under this clause." for f in body["findings"])
    wrong = analyse("wrong_number")[2].json()
    assert "99,999" not in str(wrong["findings"])


def test_questions_stay_on_their_own_document():
    client, engine = make_client()
    a = upload(client, "employment_contract.txt", fixture_bytes("employment_contract.txt")).json()
    upload(client, "rental_agreement.txt", RENTAL)
    client.post(f"/api/documents/{a['document_id']}/ask", json={"question": "What is the notice period?"})
    _, prompt = engine.calls[-1]
    assert "Priya Sharma" in prompt or "sixty (60) days" in prompt
    assert "Vikram" not in prompt and "Landlord" not in prompt


def test_divorce_settlement_missing_child_support_is_raised():
    client, engine, body = _analyse_fixture("marital_settlement.txt")
    assert body["document_type"]["id"] == "family"
    missing = [f for f in body["findings"] if f["title"].startswith("Not addressed:")]
    assert [f["title"] for f in missing] == ["Not addressed: Child support"]
    assert missing[0]["next_step"].startswith("Ask for the amount") and "names a child" in missing[0]["explanation"]
    assert [n["topic"] for n in body["not_found"]] == ["Child support"]


def test_upload_and_paste_use_the_same_pipeline():
    client, engine = make_client()
    a = upload(client, "rental.txt", RENTAL).json()
    calls_upload = [u.split("\n", 1)[0] for _, u in engine.calls]
    engine.calls.clear()
    b = client.post("/api/documents/text", json={"text": RENTAL.decode()}).json()
    assert [u.split("\n", 1)[0] for _, u in engine.calls] == calls_upload
    strip = lambda body: [(f["title"], [p["text"] for p in f["source_passages"]]) for f in body["findings"]]
    assert strip(a) == strip(b)
