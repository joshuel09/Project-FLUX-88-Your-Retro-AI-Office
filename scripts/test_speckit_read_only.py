"""Verify analysis path resolution never changes per-checkout feature state."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class ReadOnlyFeatureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        project = Path(__file__).resolve().parents[1]
        shutil.copytree(project / '.specify', self.root / '.specify')
        self.state = self.root / '.specify/feature.json'
        self.state.unlink(missing_ok=True)
        self.feature = self.root / 'specs/999-review'
        self.feature.mkdir(parents=True)
        for name in ('spec.md', 'plan.md', 'tasks.md'):
            (self.feature / name).write_text('# Review fixture\n')

    def snapshot(self):
        return {str(p.relative_to(self.root)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in self.root.rglob('*') if p.is_file()}

    def resolve(self):
        before = self.snapshot()
        env = dict(os.environ, SPECIFY_INIT_DIR=str(self.root),
                   SPECIFY_FEATURE_DIRECTORY=str(self.feature))
        result = subprocess.run(
            ['bash', str(self.root / '.specify/scripts/bash/check-prerequisites.sh'),
             '--json', '--paths-only'], env=env, cwd=self.root,
            capture_output=True, text=True, check=True)
        self.assertEqual(before, self.snapshot())
        return json.loads(result.stdout)

    def test_explicit_feature_does_not_create_state(self):
        data = self.resolve()
        self.assertEqual(data['FEATURE_DIR'], str(self.feature))
        self.assertEqual(data['FEATURE_SPEC'], str(self.feature / 'spec.md'))
        self.assertFalse(self.state.exists())

    def test_explicit_feature_does_not_replace_existing_state(self):
        self.state.write_text(json.dumps({'feature_directory': 'specs/001-other'}))
        self.assertEqual(self.resolve()['FEATURE_DIR'], str(self.feature))

    def test_paths_only_requires_caller_to_check_missing_artifacts(self):
        (self.feature / 'tasks.md').unlink()
        data = self.resolve()
        self.assertFalse(Path(data['TASKS']).exists())


if __name__ == '__main__':
    unittest.main()
