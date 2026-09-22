import { createClient } from '@supabase/supabase-js';

/**
 * Supabase-backed store. Activated when SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY (or anon key) are set in the environment.
 * Requires supabase/schema.sql to have been run in the project.
 * Implements the same interface as the demo store.
 */
export async function createSupabaseStore() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();
  if (!url || !key) throw new Error('SUPABASE_URL / key not configured');

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const run = async (query, label) => {
    const { data, error, count } = await query;
    if (error) throw new Error(`${label}: ${error.message}`);
    return count ?? data;
  };

  const toUser = (r) =>
    r && {
      id: r.id,
      username: r.username,
      passwordHash: r.password_hash,
      displayName: r.display_name,
      avatarColor: r.avatar_color,
      role: r.role,
      banned: r.banned,
      createdAt: r.created_at,
    };

  const toMessage = (r) =>
    r && {
      id: String(r.id),
      userId: String(r.user_id),
      username: r.username,
      displayName: r.display_name,
      avatarColor: r.avatar_color,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
    };

  return {
    mode: 'supabase',

    async ping() {
      await run(sb.from('profiles').select('id', { count: 'exact', head: true }), 'ping');
    },

    async countUsers() {
      const count = await run(
        sb.from('profiles').select('id', { count: 'exact', head: true }),
        'countUsers'
      );
      return count ?? 0;
    },

    async getUserByUsername(username) {
      const row = await run(
        sb.from('profiles').select('*').eq('username', username).maybeSingle(),
        'getUserByUsername'
      );
      return toUser(row);
    },

    async getUserById(id) {
      const row = await run(
        sb.from('profiles').select('*').eq('id', id).maybeSingle(),
        'getUserById'
      );
      return toUser(row);
    },

    async createUser({ username, passwordHash, displayName, avatarColor, role }) {
      const row = await run(
        sb
          .from('profiles')
          .insert({
            username,
            password_hash: passwordHash,
            display_name: displayName || username,
            avatar_color: avatarColor,
            role: role || 'member',
          })
          .select()
          .single(),
        'createUser'
      );
      return toUser(row);
    },

    async listUsers() {
      const rows = await run(
        sb.from('profiles').select('*').order('created_at', { ascending: true }),
        'listUsers'
      );
      return (rows || []).map(toUser);
    },

    async setBanned(id, banned) {
      const row = await run(
        sb.from('profiles').update({ banned: !!banned }).eq('id', id).select().maybeSingle(),
        'setBanned'
      );
      return toUser(row);
    },

    async addMessage({ userId, username, displayName, avatarColor, role, content }) {
      const row = await run(
        sb
          .from('messages')
          .insert({
            user_id: userId,
            username,
            display_name: displayName || username,
            avatar_color: avatarColor,
            role,
            content,
          })
          .select()
          .single(),
        'addMessage'
      );
      return toMessage(row);
    },

    async getMessage(id) {
      const row = await run(
        sb.from('messages').select('*').eq('id', id).maybeSingle(),
        'getMessage'
      );
      return toMessage(row);
    },

    async listMessages(limit = 80) {
      const rows = await run(
        sb
          .from('messages')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit),
        'listMessages'
      );
      return (rows || []).reverse().map(toMessage);
    },

    async deleteMessage(id) {
      const row = await run(
        sb.from('messages').delete().eq('id', id).select().maybeSingle(),
        'deleteMessage'
      );
      return !!row;
    },

    async clearMessages() {
      await run(sb.from('messages').delete().gte('id', 0), 'clearMessages');
    },
  };
}
