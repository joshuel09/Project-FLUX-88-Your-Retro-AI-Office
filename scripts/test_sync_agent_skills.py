"""Behavior checks for skill generation, using disposable directories only."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('sync_skills', Path(__file__).with_name('sync-agent-skills.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SkillSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / '.agents/skills/example/SKILL.md'
        self.source.parent.mkdir(parents=True)
        self.source.write_text('---\nname: example\ndescription: Example\n---\n')
        self.target = self.root / '.claude/skills/example/SKILL.md'

    def test_check_is_read_only_and_generation_is_idempotent(self):
        self.assertEqual(module.synchronize(self.root, check=True), ['example/SKILL.md'])
        self.assertFalse(self.target.exists())
        module.synchronize(self.root)
        self.assertEqual(self.target.read_bytes(), self.source.read_bytes())
        self.assertEqual(module.synchronize(self.root), [])
        self.source.write_text('updated instructions')
        self.assertEqual(module.synchronize(self.root, check=True), ['example/SKILL.md'])
        self.assertNotEqual(self.target.read_bytes(), self.source.read_bytes())

    def test_unexpected_files_are_preserved(self):
        module.synchronize(self.root)
        extra = self.target.with_name('local.txt')
        extra.write_text('preserve')
        with self.assertRaises(ValueError):
            module.synchronize(self.root)
        self.assertEqual(extra.read_text(), 'preserve')

    def test_supporting_assets_are_copied(self):
        asset = self.source.parent / 'references/example.txt'
        asset.parent.mkdir()
        asset.write_text('reference')
        module.synchronize(self.root)
        self.assertEqual((self.target.parent / 'references/example.txt').read_text(), 'reference')

    def test_symlink_is_rejected_without_writing(self):
        self.target.parent.mkdir(parents=True)
        self.target.symlink_to(self.source)
        with self.assertRaises(ValueError):
            module.synchronize(self.root)
        self.assertTrue(self.target.is_symlink())


if __name__ == '__main__':
    unittest.main()
