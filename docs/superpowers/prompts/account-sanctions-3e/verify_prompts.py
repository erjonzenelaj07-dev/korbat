"""Prove the account-sanctions-3e prompts reproduce the repository byte for byte.

Every "### Create `path`" or "### Replace `path` (whole file)" heading in a prompt is followed by one
fenced block holding the complete file. Prompts are applied in order, so for each path the last
prompt that writes it must match the file on disk. Run from the korbat repo root after Task 8.
Exit code 1 on any mismatch.

Usage: python docs/superpowers/prompts/account-sanctions-3e/verify_prompts.py [--root <repo>] [--prompts <dir>]
"""
import pathlib
import re
import sys

HEADING = re.compile(r"^### (?:Create|Replace) `([^`]+)`")


def option(name: str, default: pathlib.Path) -> pathlib.Path:
    args = sys.argv[1:]
    return pathlib.Path(args[args.index(name) + 1]) if name in args else default


def blocks(prompt: pathlib.Path):
    """Yields (path, content) for every file block in one prompt."""
    lines = prompt.read_text(encoding="utf-8").split("\n")
    i = 0
    while i < len(lines):
        match = HEADING.match(lines[i])
        if not match:
            i += 1
            continue
        j = i + 1
        while not lines[j].startswith("```"):
            j += 1
        fence = re.match(r"^`+", lines[j]).group(0)
        k = j + 1
        body = []
        while lines[k] != fence:
            body.append(lines[k])
            k += 1
        yield match.group(1), "\n".join(body) + "\n"
        i = k + 1


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    root = option("--root", pathlib.Path("."))
    prompts = option("--prompts", pathlib.Path(__file__).parent)
    last: dict[str, tuple[str, str]] = {}
    for prompt in sorted(prompts.glob("[0-9][0-9]-*.md")):
        for path, content in blocks(prompt):
            last[path] = (prompt.name, content)

    bad = []
    for path, (prompt, content) in sorted(last.items()):
        target = root / path
        if not target.exists():
            bad.append(f"{path}  <-  {prompt} (missing on disk)")
            continue
        disk = target.read_text(encoding="utf-8")
        if disk != content and disk + "\n" != content:
            bad.append(f"{path}  <-  {prompt}")

    print(f"compared {len(last)} files against their last prompt")
    if bad:
        print("MISMATCHES:")
        print("\n".join("  " + line for line in bad))
        sys.exit(1)
    print("prompts reproduce the repository exactly")


if __name__ == "__main__":
    main()
