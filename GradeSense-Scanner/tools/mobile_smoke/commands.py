from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CommandResult:
    name: str
    command: str
    cwd: Path
    exit_code: int
    output: str

    @property
    def passed(self) -> bool:
        return self.exit_code == 0


def run_command(name: str, command: str, cwd: Path, timeout_seconds: int = 180) -> CommandResult:
    completed = subprocess.run(
        command,
        cwd=str(cwd),
        shell=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout_seconds,
    )
    return CommandResult(
        name=name,
        command=command,
        cwd=cwd,
        exit_code=completed.returncode,
        output=completed.stdout,
    )
