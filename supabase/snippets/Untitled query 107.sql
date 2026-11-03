-- 1. Allow authenticated users to upload files into the discovery-media bucket
create policy "Allow authenticated uploads to discovery-media"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'discovery-media' );

-- 2. Allow authenticated users to read/view the files they uploaded
create policy "Allow authenticated read access to discovery-media"
on storage.objects for select
to authenticated
using ( bucket_id = 'discovery-media' );