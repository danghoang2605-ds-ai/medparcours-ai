"""Every user-facing Vietnamese string produced by the rule engine must have an
English translation (i18n/en.json) or a pattern (i18n/patterns.json).

This keeps English mode complete as the rule engine grows: adding a new
Vietnamese message without a translation fails CI.
"""
import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
FILES = ["main.py", "clinical_rules.py", "ecg_engine.py", *sorted(str(p.relative_to(ROOT)) for p in (ROOT / "cde").glob("*.py")
                                                 if not p.name.startswith("test_"))]
VI = re.compile(r"[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]", re.I)
EN = json.loads((ROOT / "i18n/en.json").read_text(encoding="utf-8"))
PATTERNS = [re.compile(p) for p, _ in json.loads((ROOT / "i18n/patterns.json").read_text(encoding="utf-8"))]


def _messages(path):
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
    skip = set()
    for node in ast.walk(tree):
        # docstrings, keyword lists/sets and dict keys are not user-facing messages
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and ast.get_docstring(node, clean=False):
            skip.add(id(node.body[0].value))
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            skip.update(id(e) for e in node.elts)
        if isinstance(node, ast.Dict):
            skip.update(id(k) for k in node.keys if k is not None)
        if isinstance(node, ast.Compare):  # `"x" in text` style checks
            skip.update(id(n) for n in [node.left, *node.comparators])
        if isinstance(node, ast.Call) and getattr(node.func, "attr", "") in {"replace", "startswith", "endswith", "find", "split"}:
            skip.update(id(a) for a in node.args)
        if isinstance(node, ast.JoinedStr):
            skip.update(id(v) for v in node.values)
    for node in ast.walk(tree):
        # `if __name__ == "__main__":` demo blocks are developer-only output
        if (isinstance(node, ast.If) and isinstance(node.test, ast.Compare)
                and getattr(node.test.left, "id", "") == "__name__"):
            for a in ast.walk(node):
                skip.add(id(a))
        # module-level prompt constants (REPORT_SYSTEM, ...) are model input, not UI text
        if isinstance(node, ast.Assign) and any(getattr(tg, "id", "").isupper() for tg in node.targets):
            for a in ast.walk(node.value):
                skip.add(id(a))
        if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "print":
            for a in ast.walk(node):
                skip.add(id(a))
    for node in ast.walk(tree):
        if id(node) in skip:
            continue
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and VI.search(node.value):
            yield node.value.strip(), node.lineno
        elif isinstance(node, ast.JoinedStr):
            sample = "".join(v.value if isinstance(v, ast.Constant) else "0" for v in node.values).strip()
            if VI.search(sample):
                yield sample, node.lineno


# main.py text that is sent TO the model (prompts) or logged, never shown to users.
INTERNAL_PREFIXES = (
    "[... hồ sơ quá dài", "Hồ sơ bệnh nhân:", "Đây là ảnh chụp/scan", "Các mốc chênh lệch chỉ số",
    "[Hồ sơ đọc từ ảnh", "NGÔN NGỮ:", "{}", "0\n\nQUY TẮC AN TOÀN", "assistant_type chỉ nhận",
)


def _covered(msg):
    if msg.startswith(INTERNAL_PREFIXES):
        return True
    return msg in EN or any(p.match(msg) for p in PATTERNS)


def test_rule_engine_messages_have_english_translations():
    missing = [f"{f}:{line}: {msg[:90]}" for f in FILES for msg, line in _messages(f) if not _covered(msg)]
    assert not missing, "Untranslated rule-engine messages:\n" + "\n".join(missing)
