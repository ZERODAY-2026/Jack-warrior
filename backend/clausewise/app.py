"""FastAPI application. All routes are under /api; see docs/api-contract.md."""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartParser

from . import __version__, doc_types, privacy
from .analysis import AnalysisError, Analyzer, DocContext
from .chunking import chunk_document
from .config import Settings
from .document_parser import DocumentError, parse_document, safe_filename, text_document
from .gemma_engine import Engine, create_engine
from .schemas import (
    AnalysisResponse,
    AskRequest,
    AskResponse,
    DeleteResponse,
    DocumentText,
    Health,
    Limits,
    ModelInfo,
    PageOut,
    PastedText,
    Reanalyse,
    DocumentTypeOption,
    PrivacyInfo,
)
from .store import REMOVED_ITEMS, DocumentRecord, DocumentStore

log = logging.getLogger("clausewise.api")


class APIError(Exception):
    def __init__(self, code: str, message: str, http_status: int):
        super().__init__(message)
        self.code, self.message, self.http_status = code, message, http_status


def _error(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": None}})


def create_app(settings: Settings | None = None, engine: Engine | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.validate()
    if settings.egress_guard:
        privacy.install_egress_guard()

    # Keep uploads in memory: Starlette spools multipart files larger than 1 MB to a
    # temporary file on disk by default. Raising the spool size above our upload limit
    # means uploaded documents are never written to disk.
    MultiPartParser.spool_max_size = settings.max_file_bytes + 1024 * 1024

    engine = engine or create_engine(settings)
    analyzer = Analyzer(engine, settings)
    store = DocumentStore(settings.document_ttl_s, settings.max_documents)
    model_lock = threading.Lock()  # one inference job at a time on a laptop GPU/CPU

    app = FastAPI(title="ClauseWise local backend", version=__version__, docs_url=None, redoc_url=None, openapi_url="/api/openapi.json")  # Swagger UI would load assets from a CDN
    app.state.settings, app.state.engine, app.state.store = settings, engine, store
    app.add_middleware(
        CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type"],
    )

    @app.exception_handler(APIError)
    async def _api_error(_: Request, exc: APIError) -> JSONResponse:
        return _error(exc.code, exc.message, exc.http_status)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return _error("invalid_request", "The request was not in the expected format.", 400)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return _error(code, "Not found." if exc.status_code == 404 else "Request not allowed.", exc.status_code)

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        # Exception messages can contain document text, so only the type is logged.
        log.error("unexpected error: %s", type(exc).__name__)
        return _error("analysis_failed", "Something went wrong while processing the request.", 500)

    if settings.warmup:
        threading.Thread(target=engine.warmup, name="model-warmup", daemon=True).start()

    def model_info() -> ModelInfo:
        st = engine.status()
        return ModelInfo(state=st.state, name=st.name, runtime=st.runtime, quantization=st.quantization,
                         parameter_size=st.parameter_size, detail=st.detail)

    def require_model() -> None:
        st = engine.status()
        if st.state != "ready":
            raise APIError("model_not_ready", st.detail or "The local model is still loading. Try again shortly.", 503)

    def get_record(document_id: str) -> DocumentRecord:
        rec = store.get(document_id)
        if rec is None:
            raise APIError("document_not_found", "That document is not loaded. It may have been deleted or expired.", 404)
        return rec

    @app.get("/api/health", response_model=Health)
    def health() -> Health:
        model = model_info()
        return Health(
            status="ok" if model.state == "ready" else "degraded",
            version=__version__,
            model=model,
            limits=Limits(max_file_bytes=settings.max_file_bytes, max_pages=settings.max_pages, accepted_extensions=[".pdf", ".docx", ".txt"], accepts_pasted_text=True,
                          max_question_chars=settings.max_question_chars, ocr_supported=False),
            privacy=PrivacyInfo(
                bind_host=settings.host, telemetry_enabled=False, outbound_network_required=False,
                egress_guard_active=privacy.egress_guard_active(),
                blocked_outbound_attempts=sum(privacy.blocked_attempts().values()),
                storage="memory_only",
            ),
        )

    @app.get("/api/metrics")
    def metrics() -> dict:
        """Timing and token counts only; never content."""
        return {"model": engine.metrics.as_dict(), "documents_loaded": len(store), "blocked_outbound_attempts": privacy.blocked_attempts()}

    @app.post("/api/documents", response_model=AnalysisResponse)
    def analyse_document(request: Request, file: UploadFile = File(...), document_type: str | None = Form(None)) -> AnalysisResponse:
        type_id = check_type(document_type)
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > settings.max_file_bytes + 64 * 1024:
            raise APIError("file_too_large", f"The file is larger than the {settings.max_file_bytes // (1024 * 1024)} MB limit.", 413)
        data = file.file.read(settings.max_file_bytes + 1)
        filename = file.filename
        file.file.close()
        if len(data) > settings.max_file_bytes:
            raise APIError("file_too_large", f"The file is larger than the {settings.max_file_bytes // (1024 * 1024)} MB limit.", 413)
        try:
            doc = parse_document(data, filename, settings.max_pages, settings.max_chars)
        except DocumentError as exc:
            raise APIError(exc.code, exc.message, exc.http_status) from None
        finally:
            del data
        return run_analysis(doc, type_id)

    @app.post("/api/documents/text", response_model=AnalysisResponse)
    def analyse_pasted_text(request: Request, body: PastedText) -> AnalysisResponse:
        """Same analysis as an upload, for text pasted into the page. Kept in memory only."""
        type_id = check_type(body.document_type)
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > settings.max_file_bytes + 64 * 1024:
            raise APIError("file_too_large", f"The text is larger than the {settings.max_file_bytes // (1024 * 1024)} MB limit.", 413)
        if len(body.text.encode("utf-8", "replace")) > settings.max_file_bytes:
            raise APIError("file_too_large", f"The text is larger than the {settings.max_file_bytes // (1024 * 1024)} MB limit.", 413)
        name = safe_filename(body.title) if body.title and body.title.strip() else "Pasted text"
        try:
            doc = text_document(body.text, name, settings.max_chars)
        except DocumentError as exc:
            raise APIError(exc.code, exc.message, exc.http_status) from None
        return run_analysis(doc, type_id)

    @app.get("/api/document-types", response_model=list[DocumentTypeOption])
    def document_types() -> list[DocumentTypeOption]:
        return [DocumentTypeOption(id=t.id, label=t.label) for t in doc_types.TYPES]

    @app.post("/api/documents/{document_id}/reanalyse", response_model=AnalysisResponse)
    def reanalyse(document_id: str, body: Reanalyse) -> AnalysisResponse:
        """Analyse an already-loaded document again, as the type the user chose."""
        rec = get_record(document_id)
        type_id = check_type(body.document_type)
        require_model()
        rec.ctx.set_type(type_id)
        with model_lock:
            try:
                rec.analysis = analyzer.analyse(rec.id, rec.ctx)
            except AnalysisError as exc:
                raise APIError(exc.code, exc.message, exc.http_status) from None
        return rec.analysis

    def check_type(type_id: str | None) -> str | None:
        if type_id is None or type_id.strip() in {"", "auto"}:
            return None
        if type_id.strip() not in doc_types.BY_ID:
            raise APIError("invalid_document_type", "Unknown document type. Choose one from the list, or Auto-detect.", 400)
        return type_id.strip()

    def run_analysis(doc, type_id: str | None) -> AnalysisResponse:  # type: ignore[no-untyped-def]
        require_model()
        ctx = DocContext(doc=doc, chunks=chunk_document(doc))
        ctx.set_type(type_id)
        record = DocumentRecord(id=store.new_id(), ctx=ctx)
        with model_lock:
            try:
                record.analysis = analyzer.analyse(record.id, ctx)
            except AnalysisError as exc:
                raise APIError(exc.code, exc.message, exc.http_status) from None
        store.put(record)
        return record.analysis

    @app.get("/api/documents/{document_id}/text", response_model=DocumentText)
    def document_text(document_id: str) -> DocumentText:
        rec = get_record(document_id)
        return DocumentText(document_id=rec.id, pages=[PageOut(page=p.page, char_start=p.char_start, text=p.text) for p in rec.ctx.doc.pages])

    @app.post("/api/documents/{document_id}/ask", response_model=AskResponse)
    def ask(document_id: str, body: AskRequest) -> AskResponse:
        rec = get_record(document_id)
        question = body.question.strip()
        if not question or len(question) > settings.max_question_chars:
            raise APIError("invalid_question", f"Ask a question between 1 and {settings.max_question_chars} characters.", 400)
        require_model()
        with model_lock:
            try:
                answer = analyzer.ask(rec.ctx, question)
            except AnalysisError as exc:
                raise APIError(exc.code, exc.message, exc.http_status) from None
        rec.qa_history.append(answer)
        return answer

    @app.delete("/api/documents/{document_id}", response_model=DeleteResponse)
    def delete_document(document_id: str) -> DeleteResponse:
        if not store.delete(document_id):
            raise APIError("document_not_found", "That document is not loaded. It may have been deleted or expired.", 404)
        return DeleteResponse(deleted=True, removed=REMOVED_ITEMS)

    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if dist.is_dir():
        from fastapi.staticfiles import StaticFiles

        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")

    return app
