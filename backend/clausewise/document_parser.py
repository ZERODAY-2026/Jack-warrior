"""Local PDF/DOCX/TXT extraction with stable page offsets.

Files are parsed from bytes in memory; nothing is written to disk. The
concatenation of ``pages[i].text`` is the document's canonical text: every
citation offset in the API indexes into it.
"""

from __future__ import annotations

import io
import logging
import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from pypdf import PdfReader
from pypdf.errors import DependencyError, FileNotDecryptedError, PdfReadError

log = logging.getLogger("clausewise.parser")

logging.getLogger("pypdf").setLevel(logging.ERROR)  # pypdf warnings can quote page content


class DocumentError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


@dataclass
class PageText:
    page: int | None  # 1-based; None for TXT
    char_start: int
    text: str


@dataclass
class ExtractedDocument:
    filename: str
    file_type: str  # "pdf" | "docx" | "txt"
    size_bytes: int
    page_count: int | None
    pages: list[PageText]
    unreadable_pages: list[int] = field(default_factory=list)
    warnings: list[tuple[str, str]] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "".join(p.text for p in self.pages)

    @property
    def extraction_status(self) -> str:
        return "partial" if self.unreadable_pages or self.warnings else "complete"

    def page_for_offset(self, offset: int) -> int | None:
        page = None
        for p in self.pages:
            if p.char_start <= offset:
                page = p.page
            else:
                break
        return page


_SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]+")


def safe_filename(name: str | None) -> str:
    """Display-only name: strip any directory parts and unusual characters."""
    base = (name or "document").replace("\\", "/").split("/")[-1]
    base = _SAFE_NAME.sub("_", base).strip() or "document"
    return base[:120]


_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # old .doc, or a password-protected .docx


def detect_type(data: bytes, filename: str) -> str:
    lower = filename.lower()
    if data[:1024].lstrip().startswith(b"%PDF-"):
        return "pdf"
    if lower.endswith(".pdf"):
        raise DocumentError("corrupt_file", "The file is named .pdf but is not a valid PDF.")
    if lower.endswith(".docx"):
        if data.startswith(_OLE_MAGIC):
            raise DocumentError("encrypted_document", "The Word file is password-protected. Remove the password and try again.")
        if not data.startswith(b"PK"):
            raise DocumentError("corrupt_file", "The file is named .docx but is not a valid Word document.")
        return "docx"
    if lower.endswith(".doc") or data.startswith(_OLE_MAGIC):
        raise DocumentError("unsupported_type", "Old Word .doc files are not supported. Save it as .docx or PDF and try again.")
    if lower.endswith(".txt") or lower.endswith(".text") or "." not in lower:
        if b"\x00" in data[:8192] and data[:2] not in (b"\xff\xfe", b"\xfe\xff"):
            raise DocumentError("unsupported_type", "The file does not look like plain text. Upload a PDF, Word (.docx) or TXT file.")
        return "txt"
    raise DocumentError("unsupported_type", "Only PDF, Word (.docx) and TXT files are supported.")


def _decode_text(data: bytes) -> str:
    encodings = ("utf-16",) if data[:2] in (b"\xff\xfe", b"\xfe\xff") else ("utf-8-sig",)
    for enc in encodings:
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    try:
        return data.decode("cp1252")
    except UnicodeDecodeError as exc:
        raise DocumentError("unsupported_type", "The text file's encoding could not be read. Save it as UTF-8 and try again.") from exc


def _normalise(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    return text


def parse_txt(data: bytes, filename: str, max_chars: int) -> ExtractedDocument:
    text = _normalise(_decode_text(data))
    if not text.strip():
        raise DocumentError("empty_document", "The file is empty or contains no readable text.")
    warnings: list[tuple[str, str]] = []
    if len(text) > max_chars:
        text = text[:max_chars]
        warnings.append(("text_truncated", f"Only the first {max_chars:,} characters were read."))
    return ExtractedDocument(
        filename=filename,
        file_type="txt",
        size_bytes=len(data),
        page_count=None,
        pages=[PageText(page=None, char_start=0, text=text)],
        warnings=warnings,
    )


def _truncate(text: str, max_chars: int, warnings: list[tuple[str, str]]) -> str:
    if len(text) > max_chars:
        warnings.append(("text_truncated", f"Only the first {max_chars:,} characters were read."))
        return text[:max_chars]
    return text


def text_document(text: str, filename: str, max_chars: int, file_type: str = "txt", size_bytes: int | None = None) -> ExtractedDocument:
    text = _normalise(text)
    if not text.strip():
        raise DocumentError("empty_document", "The document is empty or contains no readable text.")
    warnings: list[tuple[str, str]] = []
    text = _truncate(text, max_chars, warnings)
    return ExtractedDocument(
        filename=filename,
        file_type=file_type,
        size_bytes=len(text.encode("utf-8")) if size_bytes is None else size_bytes,
        page_count=None,
        pages=[PageText(page=None, char_start=0, text=text)],
        warnings=warnings,
    )


_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_DOCX_XML_LIMIT = 64 * 1024 * 1024  # uncompressed size of word/document.xml; guards against zip bombs


def _docx_paragraph(p: ET.Element) -> str:
    parts: list[str] = []
    for el in p.iter():
        if el.tag == _W + "t":
            parts.append(el.text or "")
        elif el.tag == _W + "tab":
            parts.append("\t")
        elif el.tag in (_W + "br", _W + "cr"):
            parts.append("\n")
    return "".join(parts)


def _docx_blocks(body: ET.Element) -> list[str]:
    """Paragraphs and table rows in document order. Deleted tracked changes (w:delText) are skipped."""
    out: list[str] = []
    for child in body:
        if child.tag == _W + "p":
            out.append(_docx_paragraph(child))
        elif child.tag == _W + "tbl":
            for row in child.iter(_W + "tr"):
                cells = [" ".join(_docx_paragraph(p) for p in tc.iter(_W + "p")).strip() for tc in row.iter(_W + "tc")]
                out.append(" | ".join(c for c in cells if c))
        elif child.tag == _W + "sdt":  # content controls wrap ordinary paragraphs and tables
            content = child.find(_W + "sdtContent")
            if content is not None:
                out.extend(_docx_blocks(content))
    return out


def parse_docx(data: bytes, filename: str, max_chars: int) -> ExtractedDocument:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            info = zf.getinfo("word/document.xml")
            if info.file_size > _DOCX_XML_LIMIT:
                raise DocumentError("file_too_large", "The Word document is too large to read.", 413)
            xml = zf.read(info)
            extras = [
                n for n in zf.namelist()
                if re.fullmatch(r"word/(?:header\d*|footer\d*|footnotes|endnotes|comments)\.xml", n)
                and zf.getinfo(n).file_size < _DOCX_XML_LIMIT and b"<w:t" in zf.read(n)
            ]
    except DocumentError:
        raise
    except (zipfile.BadZipFile, KeyError, OSError, RuntimeError, NotImplementedError) as exc:
        raise DocumentError("corrupt_file", "The Word document could not be read. It may be damaged.") from exc
    if b"<!DOCTYPE" in xml[:4096] or b"<!ENTITY" in xml[:65536]:
        raise DocumentError("corrupt_file", "The Word document contains unsupported XML.")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise DocumentError("corrupt_file", "The Word document could not be read. It may be damaged.") from exc
    body = root.find(_W + "body")
    blocks = _docx_blocks(body) if body is not None else []
    text = "\n".join(b.rstrip() for b in blocks)
    text = re.sub(r"\n{3,}", "\n\n", text).strip("\n")
    if not text.strip():
        raise DocumentError("empty_document", "No text was found in the Word document.")
    doc = text_document(text, filename, max_chars, file_type="docx", size_bytes=len(data))
    if extras:
        doc.warnings.append(("docx_body_only", "Only the main text of the Word document was read. Its headers, footers, footnotes or comments were not analysed."))
    return doc


def parse_pdf(data: bytes, filename: str, max_pages: int, max_chars: int) -> ExtractedDocument:
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
    except (PdfReadError, ValueError, OSError, KeyError, TypeError) as exc:
        raise DocumentError("corrupt_file", "The PDF could not be read. It may be damaged.") from exc

    if reader.is_encrypted:
        try:
            ok = reader.decrypt("")
        except (DependencyError, NotImplementedError, PdfReadError) as exc:
            raise DocumentError("encrypted_pdf", "The PDF is encrypted and cannot be opened.") from exc
        if not ok:
            raise DocumentError("encrypted_pdf", "The PDF is password-protected. Remove the password and try again.")

    try:
        total_pages = len(reader.pages)
    except (PdfReadError, FileNotDecryptedError, ValueError, KeyError, TypeError) as exc:
        raise DocumentError("corrupt_file", "The PDF's page structure could not be read.") from exc
    if total_pages == 0:
        raise DocumentError("empty_document", "The PDF has no pages.")

    warnings: list[tuple[str, str]] = []
    pages_to_read = min(total_pages, max_pages)
    if total_pages > max_pages:
        warnings.append(("pages_truncated", f"Only the first {max_pages} of {total_pages} pages were read."))

    raw_pages: list[tuple[int, str]] = []
    unreadable: list[int] = []
    for i in range(pages_to_read):
        try:
            text = reader.pages[i].extract_text() or ""
        except Exception:  # noqa: BLE001 - pypdf raises many types on malformed pages
            text = ""
        text = _normalise(text).strip("\n")
        if not text.strip():
            unreadable.append(i + 1)
        raw_pages.append((i + 1, text))

    if len(unreadable) == len(raw_pages):
        raise DocumentError(
            "no_extractable_text",
            "No text could be extracted. The PDF may be a scan; OCR is not supported in this version.",
        )

    pages: list[PageText] = []
    offset = 0
    for idx, (number, text) in enumerate(raw_pages):
        chunk = text + ("\n\n" if idx < len(raw_pages) - 1 else "")
        if offset + len(chunk) > max_chars:
            chunk = chunk[: max(0, max_chars - offset)]
            warnings.append(("text_truncated", f"Only the first {max_chars:,} characters were read."))
            pages.append(PageText(page=number, char_start=offset, text=chunk))
            break
        pages.append(PageText(page=number, char_start=offset, text=chunk))
        offset += len(chunk)

    return ExtractedDocument(
        filename=filename,
        file_type="pdf",
        size_bytes=len(data),
        page_count=total_pages,
        pages=pages,
        unreadable_pages=unreadable,
        warnings=warnings,
    )


def parse_document(data: bytes, filename: str | None, max_pages: int, max_chars: int) -> ExtractedDocument:
    name = safe_filename(filename)
    if not data:
        raise DocumentError("empty_document", "The file is empty.")
    kind = detect_type(data, name)
    if kind == "pdf":
        doc = parse_pdf(data, name, max_pages, max_chars)
    elif kind == "docx":
        doc = parse_docx(data, name, max_chars)
    else:
        doc = parse_txt(data, name, max_chars)
    log.info("parsed %s: %d bytes, %s pages, %d chars", kind, len(data), doc.page_count, len(doc.text))
    return doc
