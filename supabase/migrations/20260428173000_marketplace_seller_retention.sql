-- Keep sold apps in the seller's library and mark them as endorsed after acquisition.
-- app_sales is the receipt of record for both accepted bids and instant acquisitions,
-- so this trigger keeps the behavior atomic across all sale paths.

CREATE OR REPLACE FUNCTION public.retain_sold_app_for_seller()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
BEGIN
  INSERT INTO public.user_app_library (user_id, app_id, source)
  VALUES (NEW.seller_id, NEW.app_id, 'sold')
  ON CONFLICT (user_id, app_id) DO UPDATE
  SET source = 'sold';

  INSERT INTO public.app_likes (app_id, user_id, positive, updated_at)
  VALUES (NEW.app_id, NEW.seller_id, true, now())
  ON CONFLICT (app_id, user_id) DO UPDATE
  SET positive = true,
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS retain_sold_app_for_seller ON public.app_sales;

CREATE TRIGGER retain_sold_app_for_seller
AFTER INSERT ON public.app_sales
FOR EACH ROW
EXECUTE FUNCTION public.retain_sold_app_for_seller();

INSERT INTO public.user_app_library (user_id, app_id, source)
SELECT DISTINCT ON (seller_id, app_id) seller_id, app_id, 'sold'
FROM public.app_sales
ORDER BY seller_id, app_id, created_at DESC
ON CONFLICT (user_id, app_id) DO UPDATE
SET source = 'sold';

INSERT INTO public.app_likes (app_id, user_id, positive, updated_at)
SELECT DISTINCT ON (app_id, seller_id) app_id, seller_id, true, now()
FROM public.app_sales
ORDER BY app_id, seller_id, created_at DESC
ON CONFLICT (app_id, user_id) DO UPDATE
SET positive = true,
    updated_at = now();

COMMENT ON FUNCTION public.retain_sold_app_for_seller() IS
  'After an app acquisition, keeps the sold app in the seller library and records a positive seller endorsement.';
