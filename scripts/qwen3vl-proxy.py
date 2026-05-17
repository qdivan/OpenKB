import json
import os
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


PORT = int(os.getenv("PORT", "8761"))
DASHSCOPE_API_KEY = (
    os.getenv("DASHSCOPE_API_KEY")
    or os.getenv("DASH_SCOPE_API_KEY")
    or os.getenv("OPENKB_EMBEDDING_API_KEY")
    or os.getenv("OPENKB_RERANK_API_KEY")
)
EMBEDDING_ENDPOINT = os.getenv(
    "DASHSCOPE_EMBEDDING_ENDPOINT",
    "https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding",
)
RERANK_ENDPOINT = os.getenv(
    "DASHSCOPE_RERANK_ENDPOINT",
    "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank",
)
EMBEDDING_MODEL = os.getenv("DASHSCOPE_EMBEDDING_MODEL", "qwen3-vl-embedding")
RERANK_MODEL = os.getenv("DASHSCOPE_RERANK_MODEL", "qwen3-vl-rerank")
EMBEDDING_DIM = int(os.getenv("DASHSCOPE_EMBEDDING_DIM", "768"))
EMPTY_TEXT_PLACEHOLDER = " "
DASHSCOPE_MAX_RETRIES = int(os.getenv("DASHSCOPE_MAX_RETRIES", "4"))
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


def send_json(handler: BaseHTTPRequestHandler, status: int, body: dict):
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def read_json(handler: BaseHTTPRequestHandler):
    length = int(handler.headers.get("content-length", "0") or "0")
    if length <= 0:
        return {}
    data = handler.rfile.read(length)
    return json.loads(data.decode("utf-8"))


def post_dashscope(url: str, body: dict):
    if not DASHSCOPE_API_KEY:
        return 500, {"error": {"message": "DASHSCOPE_API_KEY is not configured."}}
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    last_status = 502
    last_payload = {"error": {"message": "DashScope request failed."}}
    for attempt in range(1, max(1, DASHSCOPE_MAX_RETRIES) + 1):
        request = urllib.request.Request(
            url,
            data=payload,
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {DASHSCOPE_API_KEY}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            last_status = error.code
            try:
                last_payload = json.loads(raw)
            except json.JSONDecodeError:
                last_payload = {"error": {"message": raw}}
            if error.code not in RETRYABLE_STATUS_CODES:
                return last_status, last_payload
        except urllib.error.URLError as error:
            last_status = 502
            last_payload = {"error": {"message": str(error)}}
        if attempt < max(1, DASHSCOPE_MAX_RETRIES):
            delay = min(2 ** (attempt - 1), 8)
            print(
                f"DashScope transient failure status={last_status}; retry {attempt + 1}/{DASHSCOPE_MAX_RETRIES} in {delay}s",
                flush=True,
            )
            time.sleep(delay)
    return last_status, last_payload


def normalize_embedding_inputs(value):
    if isinstance(value, list):
        return [normalize_embedding_item(item) for item in value]
    return [normalize_embedding_item(value)]


def normalize_embedding_item(value):
    if isinstance(value, str):
        return {"text": normalize_text(value)}
    if isinstance(value, dict):
        if isinstance(value.get("image"), str) and value["image"]:
            return {"image": value["image"]}
        if isinstance(value.get("text"), str):
            return {"text": normalize_text(value["text"])}
        content = value.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict):
                    if isinstance(part.get("image"), str):
                        return {"image": part["image"]}
                    if isinstance(part.get("image_url"), dict):
                        url = part["image_url"].get("url")
                        if isinstance(url, str):
                            return {"image": url}
                    if part.get("type") == "text" and isinstance(part.get("text"), str):
                        return {"text": normalize_text(part["text"])}
        return {"text": json.dumps(value, ensure_ascii=False)}
    return {"text": normalize_text(str(value))}


def normalize_rerank_query(value):
    if isinstance(value, dict):
        if isinstance(value.get("image"), str):
            return {"image": value["image"]}
        if isinstance(value.get("text"), str):
            return {"text": normalize_text(value["text"])}
    return {"text": normalize_text(str(value))}


def normalize_rerank_document(value):
    if isinstance(value, dict):
        if isinstance(value.get("image"), str):
            return {"image": value["image"]}
        if isinstance(value.get("video"), str):
            return {"video": value["video"]}
        if isinstance(value.get("text"), str):
            return {"text": normalize_text(value["text"])}
        return {"text": json.dumps(value, ensure_ascii=False)}
    return {"text": normalize_text(str(value))}


def normalize_text(value: str):
    # DashScope rejects empty text inputs. Dify may emit an empty segment for some
    # Markdown edge cases, so keep the row count stable with a harmless placeholder.
    return value if value.strip() else EMPTY_TEXT_PLACEHOLDER


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stdout.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stdout.flush()

    def do_GET(self):
        if self.path in {"/health", "/v1/health"}:
            send_json(
                self,
                200,
                {
                    "ok": True,
                    "embedding_model": EMBEDDING_MODEL,
                    "embedding_dim": EMBEDDING_DIM,
                    "rerank_model": RERANK_MODEL,
                },
            )
            return
        if self.path == "/v1/models":
            send_json(
                self,
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": EMBEDDING_MODEL,
                            "object": "model",
                            "owned_by": "dashscope",
                            "capabilities": {
                                "dimensions": EMBEDDING_DIM,
                                "input_modalities": ["text", "image"],
                                "supports_batch": True,
                            },
                        },
                        {
                            "id": RERANK_MODEL,
                            "object": "model",
                            "owned_by": "dashscope",
                            "capabilities": {
                                "input_modalities": ["text", "image"],
                                "supports_batch": True,
                            },
                        },
                    ],
                },
            )
            return
        send_json(self, 404, {"error": {"message": f"Route not found: GET {self.path}"}})

    def do_POST(self):
        if self.path == "/v1/embeddings":
            body = read_json(self)
            contents = normalize_embedding_inputs(body.get("input", ""))
            print(
                f"embeddings model={body.get('model') or EMBEDDING_MODEL} count={len(contents)}",
                flush=True,
            )
            status, payload = post_dashscope(
                EMBEDDING_ENDPOINT,
                {
                    "model": EMBEDDING_MODEL,
                    "input": {"contents": contents},
                    "parameters": {"dimension": EMBEDDING_DIM},
                },
            )
            if status != 200:
                send_json(self, status, payload)
                return
            rows = payload.get("output", {}).get("embeddings")
            if not isinstance(rows, list):
                send_json(
                    self,
                    502,
                    {"error": {"message": "DashScope output.embeddings is missing."}},
                )
                return
            send_json(
                self,
                200,
                {
                    "object": "list",
                    "model": body.get("model") or EMBEDDING_MODEL,
                    "data": [
                        {
                            "object": "embedding",
                            "index": row.get("index", index),
                            "embedding": row.get("embedding"),
                        }
                        for index, row in enumerate(rows)
                    ],
                    "usage": {
                        "prompt_tokens": payload.get("usage", {}).get("input_tokens", 0),
                        "total_tokens": payload.get("usage", {}).get(
                            "total_tokens",
                            payload.get("usage", {}).get("input_tokens", 0),
                        ),
                    },
                },
            )
            return
        if self.path in {"/v1/rerank", "/rerank"}:
            body = read_json(self)
            docs = [normalize_rerank_document(doc) for doc in body.get("documents", [])]
            query = normalize_rerank_query(body.get("query", ""))
            top_n = body.get("top_n") if isinstance(body.get("top_n"), int) else len(docs)
            print(
                f"rerank model={body.get('model') or RERANK_MODEL} docs={len(docs)} top_n={top_n}",
                flush=True,
            )
            status, payload = post_dashscope(
                RERANK_ENDPOINT,
                {
                    "model": RERANK_MODEL,
                    "input": {"query": query, "documents": docs},
                    "parameters": {"return_documents": False, "top_n": top_n},
                },
            )
            if status != 200:
                send_json(self, status, payload)
                return
            rows = payload.get("output", {}).get("results")
            if not isinstance(rows, list):
                send_json(
                    self,
                    502,
                    {"error": {"message": "DashScope output.results is missing."}},
                )
                return
            send_json(
                self,
                200,
                {
                    "model": body.get("model") or RERANK_MODEL,
                    "results": [
                        {
                            "index": row.get("index"),
                            "relevance_score": row.get("relevance_score", row.get("score")),
                        }
                        for row in rows
                    ],
                },
            )
            return
        send_json(self, 404, {"error": {"message": f"Route not found: POST {self.path}"}})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"qwen3-vl DashScope compatibility proxy listening on {PORT}", flush=True)
    server.serve_forever()
