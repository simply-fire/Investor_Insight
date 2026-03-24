# Supabase Setup Checklist (Module 2)

Use this checklist to create your Supabase project and apply the database schema.

## 1) Create a New Supabase Project

1. Go to https://supabase.com/dashboard and sign in.
2. Click `New project`.
3. Choose your organization.
4. Set these values:
   - `Project name`: `stock-intel` (or `stock-intel-dev` if you want a clear dev name)
   - `Database Password`: create and save a strong password
   - `Region`: choose the region closest to your users.
5. Region recommendation:
   - If your primary users are in India: pick `South Asia (Mumbai)`.
   - Otherwise: pick the geographically closest region to your target users.
6. Click `Create new project` and wait until provisioning completes.

## 2) Run the Migration SQL in Dashboard

1. In your Supabase project, open the left sidebar.
2. Go to `SQL Editor`.
3. Click `New query`.
4. Open local file `supabase/migrations/001_initial_schema.sql`.
5. Copy all SQL from that file and paste it into the SQL editor.
6. Click `Run`.
7. Verify success: no SQL errors and all statements executed.

## 3) Enable Realtime for `analysis_cache`

1. In Supabase dashboard, open `Database` -> `Replication`.
2. Find table `analysis_cache` in the list.
3. Toggle Realtime/replication `ON` for `analysis_cache`.
4. Confirm it appears under the publication `supabase_realtime`.

Note: the migration already includes:
`ALTER PUBLICATION supabase_realtime ADD TABLE analysis_cache;`
If the table is already in the publication, Supabase may show it as already enabled.

## 4) Get Project Keys and URL for `.env.local`

1. Go to `Project Settings` -> `API`.
2. Copy these values:
   - `Project URL` -> set as `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key -> set as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key -> set as `SUPABASE_SERVICE_ROLE_KEY`
3. Paste them into `.env.local` at project root.
4. Keep `service_role` secret and never expose it in frontend code.

## 5) Optional CLI Link (after project exists)

After creating the project, you can link local CLI to remote project:

1. Get your project reference from `Project Settings` -> `General`.
2. Run:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
```

3. Then you can use:

```bash
npx supabase db push
```

for future migrations.
