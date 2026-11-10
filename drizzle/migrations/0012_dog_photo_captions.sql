ALTER TABLE public.dog_photos
  ADD COLUMN IF NOT EXISTS caption text NOT NULL DEFAULT '';

GRANT UPDATE ON public.dog_photos TO authenticated;
