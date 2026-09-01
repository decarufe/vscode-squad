import * as assert from 'assert';
import { deriveMemberEmoji } from '../../core/squadRegistry';
import type { Member } from '../../team/teamState';

function makeMember(overrides: Partial<Member>): Member {
  return {
    name: 'Neo',
    role: 'Architect',
    section: 'members',
    ...overrides,
  };
}

suite('squadRegistry — deriveMemberEmoji', () => {
  test('Scribe renders 📋 via name fallback even without a status emoji', () => {
    const member = makeMember({ name: 'Scribe', status: 'Active' });
    assert.strictEqual(deriveMemberEmoji(member), '📋');
  });

  test('Ralph renders 🔄 via name fallback even without a status emoji', () => {
    const member = makeMember({ name: 'Ralph', status: 'Active' });
    assert.strictEqual(deriveMemberEmoji(member), '🔄');
  });

  test('Scribe with explicit "📋 Silent" status renders 📋', () => {
    const member = makeMember({ name: 'Scribe', status: '📋 Silent' });
    assert.strictEqual(deriveMemberEmoji(member), '📋');
  });

  test('Ralph with explicit "🔄 Monitor" status renders 🔄', () => {
    const member = makeMember({ name: 'Ralph', status: '🔄 Monitor' });
    assert.strictEqual(deriveMemberEmoji(member), '🔄');
  });

  test('ordinary active members render 👤, not the generic ✅ status glyph', () => {
    for (const name of ['Neo', 'Trinity', 'Morpheus', 'Switch', 'Tank']) {
      const member = makeMember({ name, status: '✅ Active' });
      assert.strictEqual(deriveMemberEmoji(member), '👤', `${name} should render 👤`);
    }
  });

  test('a member with a genuinely distinct status emoji still honors it', () => {
    const member = makeMember({ name: 'Oracle', status: '🔮 Foreseeing' });
    assert.strictEqual(deriveMemberEmoji(member), '🔮');
  });

  test('member with no status at all falls back to 👤', () => {
    const member = makeMember({ name: 'Dozer', status: undefined });
    assert.strictEqual(deriveMemberEmoji(member), '👤');
  });
});
