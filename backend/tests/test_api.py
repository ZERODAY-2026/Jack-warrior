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
    system, user = engine.calls[0]
    assert "Vikram" not in system and '<document_excerpt id="c' in user


def test_glossary_terms_must_exist_in_document():
    body = analyse()[2].json()
    terms = [g["term"] for g in body["glossary"]]
    assert "security deposit" in terms and "indemnity" not in terms


def test_not_found_topics_use_safe_wording():
    body = analyse()[2].json()
    topics = {n["topic"]: n["note"] for n in body["not_found"]}
    # Topics come from the detected type (rental), not one fixed list for every document.
    assert "Lock-in period" in topics and "Subletting or use restrictions" in topics
    assert "Liability or indemnity" not in topics and "Security deposit" not in topics
    assert all(note.startswith("Not found in the reviewed text") for note in topics.values())
    assert "rental or lease agreement often addresses this, but not always" in topics["Lock-in period"]
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
    assert f["next_step"] == "Which deductions can be made from the deposit?"
    # The wording rule for the same sentence does not add a second, duplicate concern.
    assert not any(x["title"] == "Left to one party's judgement" for x in body["findings"])
    assert_passages_match_source(client, body)


def test_wording_rules_flag_what_the_model_missed():
    body = analyse()[2].json()
    by_title = {f["title"]: f for f in body["findings"]}
    termination = by_title["Action allowed without notice"]
    assert "without notice" in termination["source_passages"][0]["text"]
    late = by_title["Daily charge with no stated limit"]
    assert late["source_passages"][0]["text"].startswith("If rent is not received")
    assert "Rs. 500 for each day" in late["source_passages"][0]["text"]
    assert by_title["Terms left to be agreed later"]["category"] == "ambiguity"
    for f in (termination, late):
        assert f["classification"] == "concern" and "fixed wording check" in f["limitations"][0]
    # A plain clause is not turned into a concern.
    assert not any("enter the premises" in p["text"] for f in body["findings"] if f["classification"] == "concern" for p in f["source_passages"])


def test_fabricated_concern_quote_is_dropped_and_rule_backs_it_up():
    body = analyse("fabricate")[2].json()
    assert "keep the whole deposit" not in str(body)
    rule = [f for f in body["findings"] if f["title"] == "Left to one party's judgement"]
    assert rule and "considers reasonable" in rule[0]["source_passages"][0]["text"]


def test_glossary_matches_whole_words_and_skips_headings():
    body = analyse()[2].json()
    rent = next(g for g in body["glossary"] if g["term"] == "Rent")
    text = rent["source_passages"][0]["text"]
    assert "RENTAL" not in text and "monthly rent" in text


def test_document_type_falls_back_to_title_line():
    from clausewise.analysis import guess_document_type

    assert guess_document_type(RENTAL.decode()) == "residential rental agreement"
    assert guess_document_type("This deed of employment is made between the Employer and the Employee.") == "employment document"
    assert guess_document_type("Shopping list: milk, bread.") is None


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
    "name,type_id,expect_missing,expect_present",
    [
        ("rental_agreement.txt", "rental", "Lock-in period", "Security deposit"),
        ("employment_contract.txt", "employment", "Leave and working hours", "Probation"),
        ("legal_notice.txt", "legal_notice", None, "What is demanded"),
        ("service_agreement.txt", "service", "Dispute resolution", "Service levels"),
        ("nda.txt", "nda", "Remedies for breach", "Exclusions"),
    ],
)
def test_each_document_type_gets_its_own_analysis(name, type_id, expect_missing, expect_present):
    client, engine, body = _analyse_fixture(name)
    assert body["document_type"]["id"] == type_id and body["document_type"]["source"] == "detected"
    assert body["document_type"]["confidence"] == "high"
    missing = {n["topic"] for n in body["not_found"]}
    if expect_missing:
        assert expect_missing in missing
    assert expect_present not in missing
    # The prompt names the type and its focus points; findings are grounded.
    _, user = engine.calls[0]
    label = body["document_type"]["label"]
    assert f"Document type: {label}." in user and "only where the excerpts actually contain them" in user
    assert body["findings"] and all(f["evidence_status"] == "verified" for f in body["findings"])
    assert_passages_match_source(client, body)


def test_document_type_can_be_chosen_and_changed():
    client, engine, body = _analyse_fixture("service_agreement.txt", document_type="freelance")
    assert body["document_type"]["id"] == "freelance" and body["document_type"]["source"] == "user"
    assert body["document_type"]["detected_id"] == "service"
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


def test_service_agreement_wording_concerns():
    _, _, body = _analyse_fixture("service_agreement.txt")
    titles = {f["title"] for f in body["findings"]}
    assert "Renews automatically" in titles and "Action allowed without notice" in titles


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
