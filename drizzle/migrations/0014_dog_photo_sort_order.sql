ALTER TABLE public.dog_photos
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

WITH ordered_photos AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY album_id ORDER BY created_at DESC, id ASC) - 1 AS position
  FROM public.dog_photos
)
UPDATE public.dog_photos AS photo
SET sort_order = ordered_photos.position::integer
FROM ordered_photos
WHERE photo.id = ordered_photos.id
  AND photo.sort_order = 0;

CREATE INDEX IF NOT EXISTS dog_photos_album_sort_order_idx
  ON public.dog_photos (workspace_id, album_id, sort_order, created_at DESC);

CREATE OR REPLACE FUNCTION public.reorder_dog_album_photos(
  p_workspace_id uuid,
  p_album_id uuid,
  p_photo_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, app
AS $$
DECLARE
  expected_count integer;
  requested_count integer;
  updated_count integer;
BEGIN
  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'Not authorized for this workspace' USING ERRCODE = '42501';
  END IF;

  requested_count := COALESCE(cardinality(p_photo_ids), 0);
  SELECT COUNT(*)::integer
    INTO expected_count
    FROM public.dog_photos
   WHERE workspace_id = p_workspace_id
     AND album_id = p_album_id;

  IF expected_count <> requested_count THEN
    RAISE EXCEPTION 'The reorder request must include every photo in the folder';
  END IF;

  IF requested_count <> (
    SELECT COUNT(DISTINCT photo_id)::integer
      FROM unnest(COALESCE(p_photo_ids, ARRAY[]::uuid[])) AS requested(photo_id)
  ) THEN
    RAISE EXCEPTION 'The reorder request contains duplicate photo ids';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(COALESCE(p_photo_ids, ARRAY[]::uuid[])) AS requested(photo_id)
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.dog_photos AS photo
        WHERE photo.id = requested.photo_id
          AND photo.workspace_id = p_workspace_id
          AND photo.album_id = p_album_id
     )
  ) THEN
    RAISE EXCEPTION 'Every photo must belong to the requested folder';
  END IF;

  UPDATE public.dog_photos AS photo
     SET sort_order = requested.ord::integer - 1
    FROM unnest(COALESCE(p_photo_ids, ARRAY[]::uuid[])) WITH ORDINALITY AS requested(photo_id, ord)
   WHERE photo.id = requested.photo_id
     AND photo.workspace_id = p_workspace_id
     AND photo.album_id = p_album_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> expected_count THEN
    RAISE EXCEPTION 'Could not reorder every photo in the folder';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_dog_album_photos(uuid, uuid, uuid[]) TO authenticated;
