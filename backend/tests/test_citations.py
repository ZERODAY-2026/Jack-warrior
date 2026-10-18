from clausewise import citations

SOURCE = (
    "6. TERMINATION\nEither party may terminate this agreement by giving thirty (30) days\u2019 written\n"
    "notice to the other party. The Landlord may termi-\nnate the agreement at any time without notice."
)


def test_exact_quote_located():
    q = "Either party may terminate this agreement"
    span = citations.locate(q, SOURCE)
    assert span and SOURCE[span.start : span.end] == q and span.method == "exact"


def test_whitespace_quote_and_case_differences_are_normalised():
    q = "giving THIRTY (30) days' written notice to the other party"
    span = citations.locate(q, SOURCE)
    assert span and span.method == "normalised"
    assert SOURCE[span.start : span.end].startswith("giving thirty (30) days\u2019 written\nnotice")


def test_hyphenated_line_break_is_joined():
    span = citations.locate("The Landlord may terminate the agreement at any time", SOURCE)
    assert span is not None
    assert SOURCE[span.start : span.end].startswith("The Landlord may termi-\nnate")


def test_ellipsis_quote_matches_longest_piece():
    span = citations.locate("Either party may terminate this agreement ... other party", SOURCE)
    assert span is not None


def test_fuzzy_match_only_inside_hint_and_high_threshold():
    q = "Either party may terminate this agreement by giving thirty (30) days written notise"
    assert citations.locate(q, SOURCE) is None  # no hint, no fuzzy
    span = citations.locate(q, SOURCE, (0, len(SOURCE)))
    assert span and span.method == "fuzzy"


def test_fabricated_and_trivial_quotes_rejected():
    hint = (0, len(SOURCE))
    assert citations.locate("The Tenant waives all rights to a refund of the deposit.", SOURCE, hint) is None
    assert citations.locate("notice", SOURCE, hint) is None  # too short to be evidence
    assert citations.locate("", SOURCE, hint) is None


def test_unsupported_numbers_detects_wrong_figures():
    passage = "giving thirty (30) days' written notice"
    assert citations.unsupported_numbers("You must give 30 days notice", [passage]) == set()
    assert citations.unsupported_numbers("You must give thirty days notice", [passage]) == set()
    assert citations.unsupported_numbers("You must give 90 days notice", [passage]) == {"90"}
    assert citations.unsupported_numbers("Rent is Rs. 18,000", ["rent of Rs. 18,000"]) == set()


def test_long_spans_are_trimmed():
    text = "word " * 400
    s, e = citations.trim_span(text, citations.Span(0, len(text), "exact"))
    assert e - s <= citations.MAX_PASSAGE_CHARS
