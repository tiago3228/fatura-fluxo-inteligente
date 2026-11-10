DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
         FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'dog_photos'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dog_photos;
  END IF;
END;
$$;

ALTER TABLE public.dog_photos REPLICA IDENTITY FULL;
