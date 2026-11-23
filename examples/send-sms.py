#!/usr/bin/env python3
"""
send-sms.py — minimal Python example for Jasmin's HTTP API.

Jasmin's /send endpoint takes query params and returns a one-line response:
  Success "abc-123-message-id"
  Error "Mandatory argument <content> is not found."

Usage:
    python examples/send-sms.py +233244123456 "Welcome to QuestionsDey!"
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlencode

import urllib.request
import urllib.error
from pathlib import Path

# Load .env if present
env_file = Path(__file__).resolve().parent.parent / ".env"
if env_file.is_file():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            val = val.split("#", 1)[0].strip().strip('"').strip("'")
            os.environ.setdefault(key.strip(), val)

JASMIN_HTTP_URL = os.getenv("JASMIN_HTTP_URL", "http://localhost:1401")
JASMIN_USER     = os.getenv("JASMIN_USER", "qrollix")
JASMIN_PASSWORD = os.getenv("JASMIN_PASSWORD", "change-me")
SENDER_ID       = os.getenv("SMPP_SOURCE_ADDR", "Qrollix")


@dataclass
class SmsResult:
    ok: bool
    message_id: Optional[str]
    error: Optional[str]
    raw: str


def send_sms(
    to: str,
    content: str,
    *,
    sender: Optional[str] = None,
    dlr: bool = False,
    dlr_url: Optional[str] = None,
) -> SmsResult:
    params = {
        "username": JASMIN_USER,
        "password": JASMIN_PASSWORD,
        "to":       to,
        "from":     sender or SENDER_ID,
        "content":  content,
    }
    if dlr:
        params.update({
            "dlr":        "yes",
            "dlr-url":    dlr_url or "",
            "dlr-level":  "2",
            "dlr-method": "POST",
        })

    url = f"{JASMIN_HTTP_URL}/send?{urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            text = resp.read().decode("utf-8").strip()
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8").strip()

    # Jasmin format: Success "msg-id"  |  Error "message"
    quoted: Optional[str] = None
    if '"' in text:
        quoted = text.split('"', 2)[1]
    ok = text.startswith("Success")
    return SmsResult(
        ok=ok,
        message_id=quoted if ok else None,
        error=None if ok else (quoted or text),
        raw=text,
    )


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: send-sms.py <recipient-e164> <message...>", file=sys.stderr)
        sys.exit(1)

    recipient = sys.argv[1]
    body      = " ".join(sys.argv[2:])

    result = send_sms(recipient, body)
    if result.ok:
        print(f"✓  sent — message id: {result.message_id}")
    else:
        print(f"✗  failed — {result.error}", file=sys.stderr)
        sys.exit(2)
