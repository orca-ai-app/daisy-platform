-- 052: trainer photo + "about your trainer" bio.
--
-- Chris/Jenni (27 Aug): the finder's class view shows the trainer's photo and
-- a short bio under the booking form. Photo is uploaded from the portal
-- Profile page (bucket franchisee-photos, public read); the widget falls back
-- to the Daisy logo when there is no photo. Bios are seeded from the "About
-- your trainer" sections of the existing daisyfirstaid.com trainer pages and
-- editable on Profile.
ALTER TABLE da_franchisees ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE da_franchisees ADD COLUMN IF NOT EXISTS about_trainer text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('franchisee-photos', 'franchisee-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Each franchisee uploads under their own auth uid prefix; everyone can read
-- (the bucket is public — these photos are on the public website anyway).
DROP POLICY IF EXISTS "franchisee photo upload" ON storage.objects;
CREATE POLICY "franchisee photo upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'franchisee-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "franchisee photo update" ON storage.objects;
CREATE POLICY "franchisee photo update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'franchisee-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "franchisee photo delete" ON storage.objects;
CREATE POLICY "franchisee photo delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'franchisee-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
