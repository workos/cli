#!/usr/bin/env python3
"""Offline real-PTY smoke: python3 scripts/prompt-ownership-pty.py (macOS/Linux).

Runs only synthetic installer events, never the installer machine or services.
Uses stdlib PTYs, isolated HOME/config/temp paths, bounded waits and group cleanup.
"""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parent.parent
BUN = shutil.which("bun")
assert BUN, "Bun is required"


def run(mode, scenario, home):
    evidence = home / f"{mode}-{scenario}.jsonl"
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
    original_termios = termios.tcgetattr(slave)
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(home),
        "TMPDIR": str(home),
        "XDG_CONFIG_HOME": str(home),
        "TERM": "xterm-256color",
        "LANG": "en_US.UTF-8",
        "DO_NOT_TRACK": "1",
        "WORKOS_TELEMETRY_DISABLED": "1",
    }
    child = subprocess.Popen(
        [BUN, str(ROOT / "scripts/prompt-ownership-pty.fixture.ts"), mode, scenario, str(evidence)],
        cwd=ROOT, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True,
    )
    output = bytearray()
    deadline = time.monotonic() + 12

    def pump(seconds=0.02):
        if select.select([master], [], [], seconds)[0]:
            try:
                output.extend(os.read(master, 65536))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise

    def stages():
        if not evidence.exists():
            return []
        return [json.loads(line)["stage"] for line in evidence.read_text().splitlines()]

    def wait(check):
        while not check():
            assert time.monotonic() < deadline, f"timeout: {mode}/{scenario} {output[-3000:]!r}"
            assert child.poll() is None, f"early exit: {mode}/{scenario} {output[-3000:]!r}"
            pump()

    def hold(seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            pump()

    try:
        question = b"Continue anyway?" if scenario == "cancel" else b"Found fixture.env. Check for existing WorkOS credentials?"
        second_question = b"Scaffold a new Next.js app with AuthKit here?"
        wait(lambda: question in output)
        wait(lambda: "replaced" in stages())
        hold(0.1)  # Let Ink's batched frame finish, then hold input open for 3 ticks.
        if mode == "tui":
            assert b"\x1b[?1049h" in output, "missing alternate-screen entry"
            assert question in output[-6000:], "question missing from recent Ink frame"
            wait(lambda: output.endswith(b"\x1b[?2026l"))
        before = len(output)
        hold(0.24)
        if mode == "cli":
            assert len(output) == before, f"output while awaiting input: {output[before:]!r}"
        elif len(output) > before:
            # Ink may animate an active task while input is open. Every redraw
            # must be a complete synchronized frame retaining the question;
            # a plain facade spinner/erase outside those frames is forbidden.
            wait(lambda: output.endswith(b"\x1b[?2026l"))
            for frame in output[before:].split(b"\x1b[?2026l")[:-1]:
                assert frame.startswith(b"\x1b[?2026h"), f"unhosted output: {frame!r}"
                assert question in frame, f"question lost during redraw: {frame!r}"
        if scenario == "answers":
            os.write(master, b"n" if mode == "tui" else b"n\r")
            wait(lambda: second_question in output[before:])
            hold(0.1)
            os.write(master, b"y" if mode == "tui" else b"y\r")
        elif scenario == "cancel":
            os.write(master, b"\x03")
        wait(lambda: "stopped" in stages())
        hold(0.1)
        after_stop = len(output)
        wait(lambda: "clean" in stages())
        hold(0.05)
        # restore-cursor's process-exit hook may show the cursor once more;
        # there must be no text, erasure, animation or prompt after teardown.
        assert not output[after_stop:].replace(b"\x1b[?25h", b""), f"stale output after stop: {output[after_stop:]!r}"
        assert child.wait(timeout=2) == 0, output[-3000:]
        assert termios.tcgetattr(slave) == original_termios, "terminal attributes not restored"
        if mode == "tui":
            assert output.count(b"\x1b[?1049l") == 1, "alternate screen not restored exactly once"
            assert b"\x1b[?25h" in output, "cursor not restored"
        if scenario == "cancel":
            assert b"Create a feature branch?" not in output, "moot queued question opened"
        if scenario == "stop":
            assert second_question not in output, "queued question escaped teardown"
        print(f"PASS {mode}/{scenario}: real PTY 100x30; prompt ownership, input, cleanup verified")
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=2)
        os.close(master)
        os.close(slave)


with tempfile.TemporaryDirectory(prefix=".prompt-pty-", dir=ROOT) as directory:
    for adapter in ("cli", "tui"):
        for scenario in ("answers", "cancel", "stop"):
            run(adapter, scenario, Path(directory))
