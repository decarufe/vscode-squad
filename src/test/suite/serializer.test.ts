import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseTeamFile } from '../../team/parser';
import { serializeTeamFile } from '../../team/serializer';
import { Member, TeamState } from '../../team/teamState';

const REAL_TEAM_MD_PATH = path.resolve(__dirname, '..', '..', '..', '.squad', 'team.md');

/**
 * Fixture where every member row already has an explicit, non-default
 * charter/status/notes so a round trip should reproduce every field exactly
 * (no serializer-synthesized defaults kick in).
 */
const FULL_FIELDS_TEAM_MD = `# Full Fixture Team

> Round-trip fixture with explicit fields on every row.

## Members

| Name | Role | Charter | Status | Notes |
|------|------|---------|--------|-------|
| Squad | Coordinator | .squad/agents/squad/charter.md | ✅ Active | Routes work |
| Neo | Lead / Architect | .squad/agents/neo/charter.md | ✅ Active | Owns architecture |
| Trinity | Frontend Dev | .squad/agents/trinity/charter.md | ✅ Active | UI work |
| @copilot | Coding Agent | .squad/agents/copilot/charter.md | 🤖 Coding Agent | Auto-assigned |

## Project Context

- **Owner:** Jane Doe
- **Stack:** TypeScript
- **Description:** Round trip fixture
`;

function cloneState(state: TeamState): TeamState {
  return JSON.parse(JSON.stringify(state));
}

suite('serializer: serialize(parse(x)) round trip', () => {
  suite('full-fields fixture (no synthesized defaults)', () => {
    const original = parseTeamFile(FULL_FIELDS_TEAM_MD, 'test.md');
    const roundTripped = parseTeamFile(serializeTeamFile(original, FULL_FIELDS_TEAM_MD), 'test.md');

    test('preserves the title', () => {
      const markdown = serializeTeamFile(original, FULL_FIELDS_TEAM_MD);
      assert.ok(markdown.startsWith('# Full Fixture Team'));
    });

    test('preserves coordinator, members (with order), and coding agent', () => {
      assert.strictEqual(roundTripped.coordinator?.name, original.coordinator?.name);
      assert.deepStrictEqual(
        roundTripped.members.map((m) => m.name),
        original.members.map((m) => m.name),
      );
      assert.strictEqual(roundTripped.codingAgent?.name, original.codingAgent?.name);
    });

    test('preserves every member field exactly (name/role/charter/status/notes)', () => {
      const allOriginal = [original.coordinator, ...original.members, original.codingAgent].filter(
        (m): m is Member => m !== null,
      );
      const allRoundTripped = [roundTripped.coordinator, ...roundTripped.members, roundTripped.codingAgent].filter(
        (m): m is Member => m !== null,
      );
      assert.strictEqual(allRoundTripped.length, allOriginal.length);
      for (let i = 0; i < allOriginal.length; i++) {
        assert.strictEqual(allRoundTripped[i].name, allOriginal[i].name, `name[${i}]`);
        assert.strictEqual(allRoundTripped[i].role, allOriginal[i].role, `role[${i}]`);
        assert.strictEqual(allRoundTripped[i].charter, allOriginal[i].charter, `charter[${i}]`);
        assert.strictEqual(allRoundTripped[i].status, allOriginal[i].status, `status[${i}]`);
        assert.strictEqual(allRoundTripped[i].notes, allOriginal[i].notes, `notes[${i}]`);
      }
    });

    test('preserves Project Context (Owner/Stack/Description)', () => {
      assert.strictEqual(roundTripped.projectContext?.user, original.projectContext?.user);
      assert.strictEqual(roundTripped.projectContext?.techStack, original.projectContext?.techStack);
      assert.strictEqual(roundTripped.projectContext?.description, original.projectContext?.description);
    });
  });

  suite('real .squad/team.md fixture', () => {
    const originalContent = fs.readFileSync(REAL_TEAM_MD_PATH, 'utf-8');
    const original = parseTeamFile(originalContent, REAL_TEAM_MD_PATH);
    const serialized = serializeTeamFile(original, originalContent);
    const roundTripped = parseTeamFile(serialized, REAL_TEAM_MD_PATH);

    test('preserves the title line', () => {
      assert.ok(serialized.startsWith('# Team Roster'));
    });

    test('preserves coordinator/members order/coding agent across the flattened single table', () => {
      assert.strictEqual(roundTripped.coordinator?.name, 'Squad');
      assert.deepStrictEqual(
        roundTripped.members.map((m) => m.name),
        original.members.map((m) => m.name),
      );
      assert.strictEqual(roundTripped.codingAgent?.name, '@copilot');
    });

    test('preserves explicitly-set status/notes fields', () => {
      for (let i = 0; i < original.members.length; i++) {
        assert.strictEqual(roundTripped.members[i].status, original.members[i].status, original.members[i].name);
      }
      assert.strictEqual(roundTripped.coordinator?.notes, original.coordinator?.notes);
    });

    test('preserves Project Context across the round trip', () => {
      assert.strictEqual(roundTripped.projectContext?.user, original.projectContext?.user);
      assert.strictEqual(roundTripped.projectContext?.techStack, original.projectContext?.techStack);
      assert.strictEqual(roundTripped.projectContext?.description, original.projectContext?.description);
    });

    test('a second round trip is stable (idempotent) once charters are synthesized', () => {
      const serializedAgain = serializeTeamFile(roundTripped, serialized);
      const roundTrippedAgain = parseTeamFile(serializedAgain, REAL_TEAM_MD_PATH);
      assert.deepStrictEqual(
        roundTrippedAgain.members.map((m) => ({ ...m })),
        roundTripped.members.map((m) => ({ ...m })),
      );
      assert.strictEqual(roundTrippedAgain.coordinator?.charter, roundTripped.coordinator?.charter);
    });
  });

  suite('data-loss guards on add / edit / remove', () => {
    function baseState(): TeamState {
      return cloneState(parseTeamFile(FULL_FIELDS_TEAM_MD, 'test.md'));
    }

    test('adding a member preserves existing members and appends the new one', () => {
      const state = baseState();
      state.members.push({
        name: 'Tank',
        role: 'VS Code Extension Dev',
        status: '✅ Active',
        notes: 'New hire',
        section: 'members',
      });

      const roundTripped = parseTeamFile(serializeTeamFile(state, FULL_FIELDS_TEAM_MD), 'test.md');

      assert.deepStrictEqual(
        roundTripped.members.map((m) => m.name),
        ['Neo', 'Trinity', 'Tank'],
      );
      assert.strictEqual(roundTripped.coordinator?.name, 'Squad');
      assert.strictEqual(roundTripped.codingAgent?.name, '@copilot');
    });

    test('editing a member field preserves all other members and fields', () => {
      const state = baseState();
      const trinity = state.members.find((m) => m.name === 'Trinity');
      assert.ok(trinity);
      trinity!.role = 'Full-Stack Dev';
      trinity!.status = '📋 On Leave';

      const roundTripped = parseTeamFile(serializeTeamFile(state, FULL_FIELDS_TEAM_MD), 'test.md');
      const editedTrinity = roundTripped.members.find((m) => m.name === 'Trinity');

      assert.strictEqual(editedTrinity?.role, 'Full-Stack Dev');
      assert.strictEqual(editedTrinity?.status, '📋 On Leave');
      // Neo untouched
      const neo = roundTripped.members.find((m) => m.name === 'Neo');
      assert.strictEqual(neo?.role, 'Lead / Architect');
      assert.strictEqual(neo?.status, '✅ Active');
      // Coordinator/coding agent untouched
      assert.strictEqual(roundTripped.coordinator?.name, 'Squad');
      assert.strictEqual(roundTripped.codingAgent?.name, '@copilot');
    });

    test('removing a member drops only that member and preserves the rest in order', () => {
      const state = baseState();
      state.members = state.members.filter((m) => m.name !== 'Neo');

      const roundTripped = parseTeamFile(serializeTeamFile(state, FULL_FIELDS_TEAM_MD), 'test.md');

      assert.deepStrictEqual(
        roundTripped.members.map((m) => m.name),
        ['Trinity'],
      );
      assert.strictEqual(roundTripped.coordinator?.name, 'Squad');
      assert.strictEqual(roundTripped.codingAgent?.name, '@copilot');
    });

    test('preserves Project Context across add/edit/remove writes', () => {
      const state = baseState();
      state.members = state.members.filter((m) => m.name !== 'Neo');
      state.members.push({ name: 'Tank', role: 'Extension Dev', section: 'members' });

      const roundTripped = parseTeamFile(serializeTeamFile(state, FULL_FIELDS_TEAM_MD), 'test.md');

      assert.strictEqual(roundTripped.projectContext?.user, 'Jane Doe');
      assert.strictEqual(roundTripped.projectContext?.techStack, 'TypeScript');
      assert.strictEqual(roundTripped.projectContext?.description, 'Round trip fixture');
    });
  });
});
