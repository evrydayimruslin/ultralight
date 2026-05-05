-- PR21: include D1 storage in the combined account storage soft cap.
-- The API shape remains source/data/combined for compatibility; combined now
-- includes user-attributed D1 storage bytes.

CREATE OR REPLACE FUNCTION "public"."check_data_storage_quota"(
  "p_user_id" "uuid",
  "p_additional_bytes" bigint
) RETURNS TABLE(
  "allowed" boolean,
  "source_used_bytes" bigint,
  "data_used_bytes" bigint,
  "combined_used_bytes" bigint,
  "limit_bytes" bigint,
  "remaining_bytes" bigint,
  "has_hosting_balance" boolean
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public, extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    TRUE AS allowed,
    COALESCE(u.storage_used_bytes, 0) AS source_used_bytes,
    COALESCE(u.data_storage_used_bytes, 0) AS data_used_bytes,
    (
      COALESCE(u.storage_used_bytes, 0)
      + COALESCE(u.data_storage_used_bytes, 0)
      + COALESCE(u.d1_storage_bytes, 0)
    ) AS combined_used_bytes,
    COALESCE(u.storage_limit_bytes, 104857600) AS limit_bytes,
    GREATEST(
      0::BIGINT,
      COALESCE(u.storage_limit_bytes, 104857600)
      - COALESCE(u.storage_used_bytes, 0)
      - COALESCE(u.data_storage_used_bytes, 0)
      - COALESCE(u.d1_storage_bytes, 0)
    ) AS remaining_bytes,
    (COALESCE(u.balance_light, 0) > 0) AS has_hosting_balance
  FROM public.users u
  WHERE u.id = p_user_id;
END;
$$;
