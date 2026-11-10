CREATE TABLE public.dog_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  path text NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.dog_photos TO authenticated;
GRANT ALL ON public.dog_photos TO service_role;
ALTER TABLE public.dog_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY dog_photos_member_all ON public.dog_photos FOR ALL TO authenticated
  USING (app.is_workspace_member(workspace_id)) WITH CHECK (app.is_workspace_member(workspace_id));
CREATE POLICY dog_photos_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'dog-photos' AND app.is_workspace_member(((storage.foldername(name))[1])::uuid));
CREATE POLICY dog_photos_obj_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'dog-photos' AND app.is_workspace_member(((storage.foldername(name))[1])::uuid));
CREATE POLICY dog_photos_obj_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'dog-photos' AND app.is_workspace_member(((storage.foldername(name))[1])::uuid));