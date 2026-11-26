#!/usr/bin/env python3
"""Offline guarded source-mechanism suite; never deployment or historical acceptance.

Run after the normal workspace build with Node 24+ and Python 3.9+ on PATH.
All evidence is fresh synthetic data in a new temporary directory. No historical
receipts, private databases, native OS process discovery, or service control.
"""
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(tempfile.mkdtemp(prefix='landi-guarded-contracts-')).resolve()
ENV = {'PATH': os.environ.get('PATH', os.defpath), 'LANG': 'C', 'PYTHONDONTWRITEBYTECODE': '1', 'TMPDIR': str(OUTPUT)}
RESULTS = []
NODE = shutil.which('node')

class GuardedContracts(unittest.TestCase):
    def run_entry(self, command, name):
        result = subprocess.run(command, cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=120)
        (OUTPUT/(name+'.log')).write_text(result.stdout+result.stderr)
        self.assertEqual(result.returncode, 0, name+' failed; see '+str(OUTPUT/(name+'.log'))+'\n'+result.stdout[-1500:]+result.stderr[-1500:])
        checks = None
        for line in result.stdout.splitlines():
            try:
                record = json.loads(line)
            except (ValueError, TypeError):
                continue
            if isinstance(record, dict) and record.get('status') == 'passed':
                checks = record.get('newChecks', record.get('checks'))
        if checks is None:
            match = re.search(r'(?:# tests |ℹ tests )(\d+)', result.stdout)
            if match:
                checks = int(match.group(1))
        RESULTS.append({'entry': name, 'status': 'passed', 'checks': checks, 'log': str(OUTPUT/(name+'.log'))})

for entry in sorted((ROOT/'scripts').glob('guarded-*.test.py')):
    def run(self, entry=entry):
        self.run_entry([sys.executable, str(entry)], entry.name)
    setattr(GuardedContracts, 'test_python_'+entry.name.replace('-', '_').replace('.', '_'), run)

NODE_ENTRIES = ['guarded-preflight.test.mjs', 'guarded-process-control.test.mjs', 'guarded-workbench.test.mjs', 'post-stop-admission.test.mjs', 'readonly-mechanism.test.mjs']
for name in NODE_ENTRIES:
    def run(self, name=name):
        self.assertIsNotNone(NODE, 'Node 24+ must be available on PATH')
        self.run_entry([NODE, '--test', 'scripts/'+name], name)
    setattr(GuardedContracts, 'test_node_'+name.replace('-', '_').replace('.', '_'), run)

if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(GuardedContracts))
    summary = {'status': 'passed' if result.wasSuccessful() else 'failed', 'evidenceMode': 'fixture_mechanism', 'productionExecutable': False, 'historicalSchemaAcceptance': 'not_verified', 'entriesRun': result.testsRun, 'checks': sum(r['checks'] for r in RESULTS if isinstance(r['checks'], int)), 'results': RESULTS}
    (OUTPUT/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
    print('Fresh guarded evidence: '+str(OUTPUT/'summary.json'))
    sys.exit(0 if result.wasSuccessful() else 1)
