"""Write the file blocks of one prompt step to disk, byte for byte.

A prompt shows every file it writes as a "### Create `path`" or "### Replace `path` (whole file)" heading
followed by one fenced block holding the complete file. Typing those blocks out can change them: some
files hold escape sequences that a writing tool may decode into the characters they stand for. This
script copies the blocks from the prompt file itself, so what lands on disk is exactly what the prompt
holds. Run it from the repo root.

usage: python docs/superpowers/prompts/transparency-automation-3d/write_blocks.py <prompt file> <step number>
"""
import pathlib
import re
import sys

NL = chr(10)
HEADING = re.compile(r"^### (?:Create|Replace) `([^`]+)`")
STEP = re.compile(r"^## Step ([0-9]+):")


def step_blocks(lines: list[str], wanted: int):
    """Yields (path, content) for every file block under the heading of step `wanted`."""
    step = None
    i = 0
    while i < len(lines):
        found = STEP.match(lines[i])
        if found:
            step = int(found.group(1))
        match = HEADING.match(lines[i])
        if not match or step != wanted:
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
        yield match.group(1), NL.join(body) + NL
        i = k + 1


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 3 or not sys.argv[2].isdigit():
        sys.exit("usage: python docs/superpowers/prompts/transparency-automation-3d/write_blocks.py <prompt file> <step number>")
    prompt = pathlib.Path(sys.argv[1])
    lines = prompt.read_text(encoding="utf-8").split(NL)
    written = 0
    for path, content in step_blocks(lines, int(sys.argv[2])):
        target = pathlib.Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.encode("utf-8"))
        print(f"wrote {path}")
        written += 1
    if written == 0:
        sys.exit(f"no file blocks under step {sys.argv[2]} of {prompt}")


if __name__ == "__main__":
    main()
