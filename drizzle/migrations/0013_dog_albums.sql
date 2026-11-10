CREATE TABLE IF NOT EXISTS public.dog_albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dog_albums_workspace_name_unique UNIQUE (workspace_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dog_albums TO authenticated;
GRANT ALL ON public.dog_albums TO service_role;
ALTER TABLE public.dog_albums ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dog_albums_member_all ON public.dog_albums;
CREATE POLICY dog_albums_member_all ON public.dog_albums FOR ALL TO authenticated
  USING (app.is_workspace_member(workspace_id))
  WITH CHECK (app.is_workspace_member(workspace_id));

ALTER TABLE public.dog_photos
  ADD COLUMN IF NOT EXISTS album_id uuid REFERENCES public.dog_albums(id);

INSERT INTO public.dog_albums (workspace_id, name)
SELECT DISTINCT workspace_id, 'Sem pasta'
FROM public.dog_photos
ON CONFLICT (workspace_id, name) DO NOTHING;

UPDATE public.dog_photos AS photo
SET album_id = album.id
FROM public.dog_albums AS album
WHERE photo.album_id IS NULL
  AND album.workspace_id = photo.workspace_id
  AND album.name = 'Sem pasta';

ALTER TABLE public.dog_photos
  ALTER COLUMN album_id SET NOT NULL;
ALTER TABLE public.dog_albums REPLICA IDENTITY FULL;

CREATE INDEX IF NOT EXISTS dog_photos_workspace_album_created_idx
  ON public.dog_photos (workspace_id, album_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
         FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'dog_albums'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dog_albums;
  END IF;
END;
$$;
