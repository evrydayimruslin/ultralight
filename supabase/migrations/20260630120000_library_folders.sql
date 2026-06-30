-- Library folders: desktop-style, free-form folders for organizing the Agents on
-- the launch "Agents" page. Folders are PER-USER and scoped to a tab ('installed'
-- or 'owned'); an Agent belongs to at most one folder per tab (no row =
-- "Uncategorized"). User data — RLS by owner_user_id = auth.uid(); the launch
-- handlers read via the service role (RLS-bypassing) and MUST additionally filter
-- owner_user_id explicitly, so RLS here is defense-in-depth, not the only guard.

CREATE TABLE IF NOT EXISTS public.library_folders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_user_id uuid NOT NULL,
  -- Which tab this folder lives on. A folder never spans tabs.
  scope text NOT NULL,
  name text NOT NULL,
  position integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT library_folders_scope_check CHECK (scope IN ('installed', 'owned'))
);

ALTER TABLE public.library_folders OWNER TO postgres;

ALTER TABLE ONLY public.library_folders
  ADD CONSTRAINT library_folders_pkey PRIMARY KEY (id);

-- Lets membership rows reference (folder, owner, scope) so a member can't point
-- at a folder owned by someone else or living on the other tab.
ALTER TABLE ONLY public.library_folders
  ADD CONSTRAINT library_folders_id_owner_scope_key UNIQUE (id, owner_user_id, scope);

ALTER TABLE ONLY public.library_folders
  ADD CONSTRAINT library_folders_owner_fkey
  FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- One folder of a given (case-insensitive) name per user per tab.
CREATE UNIQUE INDEX IF NOT EXISTS library_folders_owner_scope_name_uniq
  ON public.library_folders (owner_user_id, scope, lower(name));

-- Listing: a user's folders for a tab, in display order.
CREATE INDEX IF NOT EXISTS idx_library_folders_owner_scope
  ON public.library_folders (owner_user_id, scope, position);

ALTER TABLE public.library_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "library_folders_own"
  ON public.library_folders
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

GRANT ALL ON TABLE public.library_folders TO anon;
GRANT ALL ON TABLE public.library_folders TO authenticated;
GRANT ALL ON TABLE public.library_folders TO service_role;


CREATE TABLE IF NOT EXISTS public.library_folder_members (
  owner_user_id uuid NOT NULL,
  scope text NOT NULL,
  app_id uuid NOT NULL,
  folder_id uuid NOT NULL,
  position integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT library_folder_members_scope_check CHECK (scope IN ('installed', 'owned'))
);

ALTER TABLE public.library_folder_members OWNER TO postgres;

-- At most one folder per (owner, tab, Agent). Moving = upsert; uncategorize =
-- delete the row.
ALTER TABLE ONLY public.library_folder_members
  ADD CONSTRAINT library_folder_members_pkey PRIMARY KEY (owner_user_id, scope, app_id);

ALTER TABLE ONLY public.library_folder_members
  ADD CONSTRAINT library_folder_members_owner_fkey
  FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.library_folder_members
  ADD CONSTRAINT library_folder_members_app_fkey
  FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;

-- Composite FK: the target folder must exist AND be owned by the same user AND
-- be on the same tab. Drops member rows when the folder is deleted.
ALTER TABLE ONLY public.library_folder_members
  ADD CONSTRAINT library_folder_members_folder_fkey
  FOREIGN KEY (folder_id, owner_user_id, scope)
  REFERENCES public.library_folders(id, owner_user_id, scope) ON DELETE CASCADE;

-- "Which Agents are in this folder" + the per-tab membership read.
CREATE INDEX IF NOT EXISTS idx_library_folder_members_folder
  ON public.library_folder_members (folder_id, position);
CREATE INDEX IF NOT EXISTS idx_library_folder_members_owner_scope
  ON public.library_folder_members (owner_user_id, scope);

ALTER TABLE public.library_folder_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "library_folder_members_own"
  ON public.library_folder_members
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

GRANT ALL ON TABLE public.library_folder_members TO anon;
GRANT ALL ON TABLE public.library_folder_members TO authenticated;
GRANT ALL ON TABLE public.library_folder_members TO service_role;
