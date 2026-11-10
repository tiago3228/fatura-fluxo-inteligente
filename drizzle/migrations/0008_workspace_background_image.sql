ALTER TABLE public.workspace_settings ADD COLUMN IF NOT EXISTS background_image text;
INSERT INTO public.workspace_settings (workspace_id) SELECT w.id FROM public.workspaces w ON CONFLICT DO NOTHING;