#!/usr/bin/env python3
"""Generate Claude skill copies from canonical .agents skills, or check for drift."""
import argparse
from pathlib import Path
import sys


def synchronize(root: Path, check: bool = False) -> list[str]:
    source = root / '.agents' / 'skills'
    target = root / '.claude' / 'skills'
    if not source.is_dir():
        raise ValueError(f'Missing canonical skills: {source}')
    files = {f.relative_to(source): f for f in source.rglob('*') if f.is_file()}
    if not any(path.name == 'SKILL.md' for path in files):
        raise ValueError('No canonical SKILL.md files found')
    # Reject symlinks so generated writes cannot escape the repository.
    for directory in (source, target):
        if directory.is_symlink() or any(parent.is_symlink() for parent in directory.parents if parent != root.parent):
            raise ValueError(f'Symlinked skill directory: {directory}')
        if directory.exists() and any(f.is_symlink() for f in directory.rglob('*')):
            raise ValueError(f'Symlink inside skill directory: {directory}')
    extras = sorted(str(f.relative_to(target)) for f in target.rglob('*')
                    if f.is_file() and f.relative_to(target) not in files)
    if extras:
        raise ValueError('Unexpected Claude files; review before removing: ' + ', '.join(extras))
    drift = []
    for relative, origin in sorted(files.items()):
        destination = target / relative
        content = origin.read_bytes()
        if not destination.is_file() or destination.read_bytes() != content:
            drift.append(str(relative))
            if not check:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content)
    return drift


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail on missing or changed copies; never write')
    options = parser.parse_args()
    try:
        drift = synchronize(Path(__file__).resolve().parents[1], options.check)
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    if options.check and drift:
        print('Skill drift: ' + ', '.join(drift), file=sys.stderr)
        return 1
    print(f'Skills {"checked" if options.check else "synchronized"}; {len(drift)} differing file(s).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
