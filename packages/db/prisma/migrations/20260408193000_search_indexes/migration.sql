CREATE INDEX IF NOT EXISTS "Page_search_fts_idx"
ON "Page"
USING GIN (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce("bodyText", '')));

CREATE INDEX IF NOT EXISTS "Image_search_fts_idx"
ON "Image"
USING GIN (to_tsvector('english', coalesce("altText", '') || ' ' || coalesce(url, '')));

CREATE INDEX IF NOT EXISTS "Video_search_fts_idx"
ON "Video"
USING GIN (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(platform, '')));

CREATE INDEX IF NOT EXISTS "Gif_search_fts_idx"
ON "Gif"
USING GIN (to_tsvector('english', coalesce("altText", '') || ' ' || coalesce(url, '')));

CREATE INDEX IF NOT EXISTS "Page_safeFlag_crawledAt_idx" ON "Page"("safeFlag", "crawledAt");
CREATE INDEX IF NOT EXISTS "Image_safeFlag_crawledAt_idx" ON "Image"("safeFlag", "crawledAt");
CREATE INDEX IF NOT EXISTS "Video_safeFlag_crawledAt_idx" ON "Video"("safeFlag", "crawledAt");
CREATE INDEX IF NOT EXISTS "Gif_safeFlag_crawledAt_idx" ON "Gif"("safeFlag", "crawledAt");
