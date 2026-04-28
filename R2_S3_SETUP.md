# Cloudflare R2 S3 Setup (Scaffold)

This guide configures Cloudflare R2 for Scaffold's S3-compatible media adapter.

## Why choose R2

- Strong default choice for browser-uploaded media
- S3-compatible API
- Typically favorable egress economics vs many alternatives

## Prerequisites

- Cloudflare account with R2 enabled
- Access to the Cloudflare dashboard for your account
- A bucket name you want to use for Scaffold media

## 1) Create an R2 bucket

In Cloudflare dashboard:

1. Go to **R2 Object Storage**.
2. Click **Create bucket**.
3. Pick a globally unique bucket name (for example: `scaffold-media-prod`).
4. Leave default settings unless you have specific requirements.

## 2) Create API credentials (S3-compatible)

In Cloudflare dashboard:

1. Go to **R2 Object Storage** -> **Manage R2 API tokens**.
2. Create a token with read/write access to your bucket.
3. Save:
   - Access Key ID
   - Secret Access Key
   - Account ID

## 3) Build endpoint URL

For R2 S3-compatible API, the endpoint format is:

`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

## 4) Configure CORS on the bucket

Allow your app origins (local dev and production domain). Example CORS policy:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:9000",
      "http://127.0.0.1:9000",
      "https://your-production-domain.example"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT", "POST", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Apply this in the R2 bucket CORS settings UI.

## 5) Enter settings in Scaffold

- Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- Bucket: your R2 bucket name
- Access key: R2 Access Key ID
- Secret key: R2 Secret Access Key
- Region: `auto` (recommended for R2-compatible clients)
- Prefix: optional (for example `scaffold-media`)

## 6) Validate

1. Save settings in Scaffold.
2. Upload an image in a long note.
3. Reload app and verify media still resolves.
4. Confirm object appears in R2 bucket.

## Rotation checklist

1. Create a new R2 token/keypair.
2. Update Scaffold credentials.
3. Validate upload/read/delete flows.
4. Revoke old token.

