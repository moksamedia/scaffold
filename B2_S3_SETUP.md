# Backblaze B2 S3 Setup (Scaffold)

This guide configures Backblaze B2 (S3-compatible API) for Scaffold's media adapter.

## Why choose Backblaze B2

- Cost-effective storage pricing
- Simple pricing model
- S3-compatible endpoint support

## Prerequisites

- Backblaze account with B2 enabled
- Permissions to create buckets and application keys

## 1) Create a B2 bucket

In Backblaze dashboard:

1. Open **B2 Cloud Storage**.
2. Create a bucket (for example: `scaffold-media-prod`).
3. Keep it private unless you have a specific reason otherwise.

## 2) Create an application key

In Backblaze dashboard:

1. Open **App Keys**.
2. Create a key scoped to your bucket with read/write/delete permissions.
3. Save:
   - keyID (use as access key)
   - applicationKey (use as secret key)

## 3) Determine S3 endpoint and region

Backblaze provides an endpoint in this format:

`https://s3.<region>.backblazeb2.com`

Use the region shown for your bucket/account (for example `us-west-004`).

## 4) Configure CORS

Set bucket CORS to allow local and production origins. Example:

```json
[
  {
    "corsRuleName": "scaffold-media-cors",
    "allowedOrigins": [
      "http://localhost:9000",
      "http://127.0.0.1:9000",
      "https://your-production-domain.example"
    ],
    "allowedOperations": [
      "s3_get",
      "s3_head",
      "s3_put",
      "s3_post",
      "s3_delete"
    ],
    "allowedHeaders": ["*"],
    "exposeHeaders": ["ETag"],
    "maxAgeSeconds": 3600
  }
]
```

Apply in bucket CORS settings.

## 5) Enter settings in Scaffold

- Endpoint: `https://s3.<region>.backblazeb2.com`
- Bucket: your B2 bucket name
- Access key: B2 keyID
- Secret key: B2 applicationKey
- Region: your B2 S3 region (for example `us-west-004`)
- Prefix: optional (for example `scaffold-media`)

## 6) Validate

1. Save settings in Scaffold.
2. Upload and delete a test media file from a long note.
3. Refresh app and verify media resolution.
4. Confirm object operations in B2 bucket logs/view.

## Rotation checklist

1. Create a new application key.
2. Update Scaffold credentials.
3. Validate all operations.
4. Revoke old key.

