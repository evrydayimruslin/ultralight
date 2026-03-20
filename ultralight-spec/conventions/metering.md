# Metering

## Free tier (per user per month)

| Resource | Allowance |
|----------|-----------|
| Reads | 50,000 |
| Writes | 10,000 |
| Storage | 50 MB |

## Beyond free tier (pay-as-you-go)

| Resource | Cost |
|----------|------|
| Reads | 0.01 Light / 1K reads |
| Writes | 0.05 Light / 1K writes |
| Storage | 0.36 Light / MB / hour |

## Rate limits by tier

| Tier | Reads/min | Writes/min |
|------|-----------|------------|
| Free | 100 | 20 |
| Pro | 500 | 100 |
| Scale | 2,000 | 500 |

## Error behavior

If a user has zero balance and exceeds the free tier, the platform returns a **402** error. The app should handle this gracefully.
