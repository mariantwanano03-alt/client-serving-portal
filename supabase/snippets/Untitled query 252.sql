ALTER TABLE discovery_records 
ADD COLUMN audio_url TEXT,
ADD COLUMN transcript TEXT,
ADD COLUMN transcription_status TEXT DEFAULT 'pending';