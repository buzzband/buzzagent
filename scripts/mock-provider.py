#!/usr/bin/env python3
"""Minimal OpenAI-compatible mock provider.

Used to exercise the full agent loop (streaming, tool calls, file writes,
permissions) without a real API key. Serves just enough of the API for the
OpenCode core to drive a session:

  GET  /v1/models
  POST /v1/chat/completions   (streaming SSE and non-streaming)

Scripted behaviour, chosen by the last user message:
  - contains "write"  -> emits a write tool call, then a summary
  - contains "bash"   -> emits a shell tool call
  - otherwise         -> plain streamed text

Run: python3 scripts/mock-provider.py [port]
"""

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4700
DEBUG = bool(os.environ.get("MOCK_DEBUG"))

MODELS = ["mock-coder"]


def flatten(content) -> str:
    """Message content is either a string or a list of typed parts."""
    if isinstance(content, list):
        return " ".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return str(content or "")


def sse(payload: dict) -> bytes:
    return f"data: {json.dumps(payload)}\n\n".encode()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # keep the test output quiet
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            self._json(
                {
                    "object": "list",
                    "data": [
                        {"id": m, "object": "model", "owned_by": "mock"} for m in MODELS
                    ],
                }
            )
            return
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            req = json.loads(raw)
        except json.JSONDecodeError:
            self._json({"error": "bad json"}, 400)
            return

        messages = req.get("messages") or []
        if DEBUG:
            print(
                "roles=%s tools=%s"
                % (
                    [m.get("role") for m in messages],
                    len(req.get("tools") or []),
                ),
                file=sys.stderr,
                flush=True,
            )

        last_user = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                last_user = flatten(m.get("content"))
                break

        already_called = any(m.get("role") == "tool" for m in messages)
        lower = last_user.lower()

        if not already_called and "write" in lower:
            tool = {
                "name": "write",
                "arguments": json.dumps(
                    {"filePath": "mock-output.txt", "content": "written by mock\n"}
                ),
            }
        elif not already_called and "bash" in lower:
            tool = {"name": "bash", "arguments": json.dumps({"command": "echo hi"})}
        else:
            tool = None

        if req.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            # An SSE body has no known length. Under HTTP/1.1 that means we
            # must either use chunked encoding or announce a close; without
            # one of the two the client blocks forever waiting for the body
            # to end. `close_connection` makes the handler shut the socket
            # after the final frame.
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            self._stream(tool)
        else:
            self._complete(tool)

    def _stream(self, tool):
        base = {
            "id": "chatcmpl-mock",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": "mock-coder",
        }

        if tool:
            self.wfile.write(
                sse(
                    {
                        **base,
                        "choices": [
                            {
                                "index": 0,
                                "delta": {
                                    "tool_calls": [
                                        {
                                            "index": 0,
                                            "id": "call_mock_1",
                                            "type": "function",
                                            "function": tool,
                                        }
                                    ]
                                },
                                "finish_reason": None,
                            }
                        ],
                    }
                )
            )
            self.wfile.write(
                sse({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]})
            )
        else:
            for word in ["Mock ", "reply ", "from ", "the ", "stub ", "provider."]:
                self.wfile.write(
                    sse(
                        {
                            **base,
                            "choices": [
                                {"index": 0, "delta": {"content": word}, "finish_reason": None}
                            ],
                        }
                    )
                )
                self.wfile.flush()
            self.wfile.write(
                sse({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})
            )

        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def _complete(self, tool):
        message = {"role": "assistant", "content": None if tool else "Mock reply."}
        if tool:
            message["tool_calls"] = [
                {"id": "call_mock_1", "type": "function", "function": tool}
            ]
        self._json(
            {
                "id": "chatcmpl-mock",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": "mock-coder",
                "choices": [
                    {
                        "index": 0,
                        "message": message,
                        "finish_reason": "tool_calls" if tool else "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 42,
                    "completion_tokens": 8,
                    "total_tokens": 50,
                },
            }
        )


if __name__ == "__main__":
    print(f"mock provider on http://127.0.0.1:{PORT}/v1", flush=True)
    # Threaded: the core keeps connections alive, and a single-threaded
    # server would block the next request behind an idle keep-alive socket.
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
