import pytest

from clausewise.document_parser import DocumentError, parse_document, safe_filename

from conftest import docx_paragraphs, fixture_bytes, make_docx, make_pdf


def parse(data, name="doc.txt", max_pages=80, max_chars=400_000):
    return parse_document(data, name, max_pages, max_chars)


def test_txt_is_read_with_single_page_and_crlf_normalised():
    doc = parse(b"Clause 1.\r\nThe Tenant shall pay rent.\r\n")
    assert doc.file_type == "txt" and doc.page_count is None
    assert doc.text == "Clause 1.\nThe Tenant shall pay rent.\n"
    assert doc.pages[0].page is None and doc.extraction_status == "complete"


def test_txt_utf8_bom_and_cp1252_fallback():
    assert parse("\ufeffRent is \u20b918,000".encode("utf-8")).text == "Rent is \u20b918,000"
    assert "\u2019" in parse("Tenant\x92s duty".encode("latin-1")).text


def test_pdf_pages_have_stable_offsets():
    data = make_pdf(["Page one says the rent is due monthly.", "Page two covers termination with notice."])
    doc = parse(data, "a.pdf")
    assert doc.file_type == "pdf" and doc.page_count == 2
    text = doc.text
    for p in doc.pages:
        assert text[p.char_start : p.char_start + len(p.text)] == p.text
    pos = text.index("termination")
    assert doc.page_for_offset(pos) == 2
    assert doc.page_for_offset(text.index("rent")) == 1


def test_pdf_with_blank_page_is_partial():
    doc = parse(make_pdf(["Some readable clause text here.", ""]), "a.pdf")
    assert doc.unreadable_pages == [2] and doc.extraction_status == "partial"


@pytest.mark.parametrize(
    "data,name,code",
    [
        (b"", "x.txt", "empty_document"),
        (b"   \n\n  ", "x.txt", "empty_document"),
        (b"%PDF-1.7\n garbage garbage", "x.pdf", "corrupt_file"),
        (b"not a pdf at all", "x.pdf", "corrupt_file"),
        (b"PK\x03\x04\x00\x00binary", "x.docx", "corrupt_file"),
        (b"not a zip", "x.docx", "corrupt_file"),
        (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64, "x.docx", "encrypted_document"),
        (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64, "old.doc", "unsupported_type"),
        (b"PK\x03\x04\x00\x00binary", "x.xlsx", "unsupported_type"),
        (b"\x00\x01\x02binary", "x.txt", "unsupported_type"),
    ],
)
def test_bad_inputs_raise_readable_errors(data, name, code):
    with pytest.raises(DocumentError) as err:
        parse(data, name)
    assert err.value.code == code and err.value.message


def test_scanned_like_pdf_reports_no_text():
    with pytest.raises(DocumentError) as err:
        parse(make_pdf(["", ""]), "scan.pdf")
    assert err.value.code == "no_extractable_text"


def test_encrypted_pdf_is_rejected():
    with pytest.raises(DocumentError) as err:
        parse(make_pdf(["Secret clause text."], encrypt="pw"), "locked.pdf")
    assert err.value.code == "encrypted_pdf"


def test_page_limit_truncates_with_warning():
    doc = parse(make_pdf([f"Clause {i} text on this page." for i in range(1, 6)]), "long.pdf", max_pages=3)
    assert doc.page_count == 5 and len(doc.pages) == 3
    assert any(code == "pages_truncated" for code, _ in doc.warnings)


def test_fixture_txt_parses():
    doc = parse(fixture_bytes("rental_agreement.txt"), "rental_agreement.txt")
    assert "thirty (30) days" in doc.text


def test_safe_filename_strips_paths():
    assert safe_filename("../../etc/passwd") == "passwd"
    assert safe_filename("C:\\Users\\me\\lease.pdf") == "lease.pdf"
    assert safe_filename(None) == "document"


W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def test_docx_paragraphs_tables_and_tracked_changes():
    body = (
        docx_paragraphs("EMPLOYMENT AGREEMENT", "1. NOTICE", "Either party may end this agreement with 60 days' notice.")
        + "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Salary</w:t></w:r></w:p></w:tc>"
        "<w:tc><w:p><w:r><w:t>Rs. 40,000 per month</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
        "<w:p><w:r><w:t>Leave is </w:t></w:r><w:del><w:r><w:delText>10</w:delText></w:r></w:del>"
        "<w:ins><w:r><w:t>12</w:t></w:r></w:ins><w:r><w:tab/><w:t>days.</w:t></w:r></w:p>"
    )
    doc = parse(make_docx(body), "contract.docx")
    assert doc.file_type == "docx" and doc.page_count is None and doc.extraction_status == "complete"
    assert doc.text.splitlines() == [
        "EMPLOYMENT AGREEMENT", "1. NOTICE", "Either party may end this agreement with 60 days' notice.",
        "Salary | Rs. 40,000 per month", "Leave is 12\tdays.",
    ]


def test_docx_with_text_in_footnotes_warns_and_empty_docx_fails():
    footnotes = f'<w:footnotes {W}><w:footnote><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:footnote></w:footnotes>'
    doc = parse(make_docx(docx_paragraphs("Main text of the agreement."), {"word/footnotes.xml": footnotes}), "a.docx")
    assert [c for c, _ in doc.warnings] == ["docx_body_only"] and doc.extraction_status == "partial"
    with pytest.raises(DocumentError) as err:
        parse(make_docx("<w:p/>"), "blank.docx")
    assert err.value.code == "empty_document"


def test_docx_with_entity_declarations_is_refused():
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml", '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>')
    with pytest.raises(DocumentError) as err:
        parse(buf.getvalue(), "bomb.docx")
    assert err.value.code == "corrupt_file"
