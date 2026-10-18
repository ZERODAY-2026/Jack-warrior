from clausewise.chunking import chunk_document
from clausewise.document_parser import parse_document
from clausewise.retrieval import BM25Index

from conftest import fixture_bytes, make_pdf


def rental():
    return parse_document(fixture_bytes("rental_agreement.txt"), "rental.txt", 80, 400_000)


def test_chunks_are_exact_source_spans_with_sections():
    doc = rental()
    chunks = chunk_document(doc)
    assert chunks
    for c in chunks:
        assert doc.text[c.char_start : c.char_end] == c.text
    ids = [c.id for c in chunks]
    assert len(ids) == len(set(ids))
    term = next(c for c in chunks if "thirty (30)" in c.text)
    assert term.section and "TERMINATION" in term.section


def test_long_paragraph_is_split():
    text = ("The Tenant shall comply with every rule. " * 120).encode()
    doc = parse_document(text, "long.txt", 80, 400_000)
    chunks = chunk_document(doc)
    assert len(chunks) > 1 and all(len(c.text) <= 1500 for c in chunks)
    for c in chunks:
        assert doc.text[c.char_start : c.char_end] == c.text


def test_pdf_chunks_carry_pages():
    doc = parse_document(make_pdf(["1. RENT\nRent is due monthly.", "2. TERMINATION\nEither party may end it."]), "a.pdf", 80, 400_000)
    chunks = chunk_document(doc)
    assert {c.page for c in chunks} == {1, 2}


def test_retrieval_uses_synonyms():
    idx = BM25Index(chunk_document(rental()))
    top = idx.search("How can I end the lease early?", k=2)
    assert top and "terminate" in top[0].chunk.text
    top = idx.search("Is there a fine if I pay late?", k=2)
    assert any("late fee" in r.chunk.text for r in top)


def test_retrieval_returns_nothing_for_unrelated_question():
    idx = BM25Index(chunk_document(rental()))
    assert idx.search("Are pets allowed?") == []
    assert idx.search("Does the agreement say anything about pets?") == []
