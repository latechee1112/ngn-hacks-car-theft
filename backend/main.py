import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from config import get_settings
from models.analysis import AnalyzePageRequest, AnalyzePageResponse
from models.calibration import CalibrationProfileResponse, CalibrationRequest
from services import security
from services.analysis_service import analyze
from services.profile_rules import generate_profile

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("focusfit.main")

settings = get_settings()

app = FastAPI(
    title="FocusFit API",
    description=(
        "Analyzes webpage blocks and returns visual-simplification instructions. "
        "This is an accessibility aid, not a diagnostic or medical tool."
    ),
    version="1.0.0",
)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_max_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > settings.max_request_bytes:
        return JSONResponse(
            status_code=413,
            content={"detail": f"Request body too large: max {settings.max_request_bytes} bytes"},
        )
    return await call_next(request)


@app.middleware("http")
async def tag_request_id(request: Request, call_next):
    """Assigns a request ID for log correlation. Never logs request bodies -
    page content and calibration data must not appear in logs."""
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    start = time.perf_counter()

    response = await call_next(request)

    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request_id=%s method=%s path=%s status=%s duration_ms=%.1f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/v1/calibration/profile", response_model=CalibrationProfileResponse)
@limiter.limit(settings.rate_limit_calibration)
def calibration_profile(request: Request, payload: CalibrationRequest):
    result = generate_profile(payload)
    return CalibrationProfileResponse(profile=result.profile, explanation=result.explanation)


@app.post("/v1/analyze-page", response_model=AnalyzePageResponse)
@limiter.limit(settings.rate_limit_analyze)
def analyze_page(request: Request, payload: AnalyzePageRequest):
    security.enforce_block_count(payload.blocks, settings)
    blocks = security.sanitize_blocks(payload.blocks, settings)

    analysis_id, summary, actions, layout, warnings = analyze(
        blocks, payload.profile, payload.task, settings, request_id=request.state.request_id
    )

    return AnalyzePageResponse(
        analysisId=analysis_id,
        summary=summary,
        actions=actions,
        layout=layout,
        warnings=warnings,
    )
