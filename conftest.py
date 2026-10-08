"""Shared pytest setup.

Runs fully offline: a fake API key is set (the Anthropic client is mocked in
tests) and rate limiting is disabled so tests can call endpoints freely.
"""
import os

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-real")
os.environ["RATE_LIMIT_REQUESTS"] = "0"
