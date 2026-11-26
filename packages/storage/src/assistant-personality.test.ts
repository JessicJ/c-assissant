import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SqliteWorkspaceStore } from './index.js';

test('personality survives restart and older profile clients preserve the selected personality', () => {
  const directory = mkdtempSync(join(tmpdir(), 'landi-personality-'));
  const path = join(directory, 'workspace.sqlite');
  try {
    const store = new SqliteWorkspaceStore(path);
    assert.equal(store.getWorkspace().profile.assistantPersonality, 'local_insider');
    const profile = store.getWorkspace().profile;
    store.updateProfile({ ...profile, assistantPersonality: 'travel_buddy', gender: 'woman', preferredLanguage: 'Chinese' });
    const { assistantPersonality: _personality, ...legacy } = store.getWorkspace().profile;
    store.updateProfile({ ...legacy, displayName: 'Alex' });
    assert.equal(store.getWorkspace().profile.assistantPersonality, 'travel_buddy');
    assert.equal(store.getWorkspace().profile.preferredLanguage, 'English');
    assert.throws(() => store.updateProfile({ ...profile, assistantPersonality: 'invalid' as never }), /supported assistant personality/);
    assert.equal(store.getWorkspace().profile.assistantPersonality, 'travel_buddy');
    store.close();
    const reopened = new SqliteWorkspaceStore(path);
    assert.equal(reopened.getWorkspace().profile.assistantPersonality, 'travel_buddy');
    assert.equal(reopened.getWorkspace().profile.gender, 'woman');
    reopened.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('schema 21 profile upgrades to Local Insider without replacing the existing plan', () => {
  const directory = mkdtempSync(join(tmpdir(), 'landi-personality-migration-'));
  const path = join(directory, 'workspace.sqlite');
  try {
    const original = new SqliteWorkspaceStore(path);
    const plan = original.getWorkspace().activePlan;
    original.updateProfile({ ...original.getWorkspace().profile, displayName: 'Existing traveler' });
    original.close();
    const legacy = new DatabaseSync(path);
    legacy.exec("ALTER TABLE profiles DROP COLUMN assistant_personality; DELETE FROM schema_migrations WHERE version >= 22; UPDATE profiles SET preferred_language = 'French';");
    legacy.close();
    const upgraded = new SqliteWorkspaceStore(path);
    assert.equal(upgraded.getWorkspace().profile.assistantPersonality, 'local_insider');
    assert.equal(upgraded.getWorkspace().profile.displayName, 'Existing traveler');
    assert.equal(upgraded.getWorkspace().profile.preferredLanguage, 'English');
    assert.deepEqual(upgraded.getWorkspace().activePlan, plan);
    assert.equal(upgraded.getDatabaseMaintenanceStatus().schemaVersion, 32);
    upgraded.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
