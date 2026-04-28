# AWS S3 Setup (Scaffold)

This guide configures AWS S3 for Scaffold's S3-compatible media adapter.

## Why choose AWS S3

- Most mature object storage ecosystem
- Broadest tooling and IAM controls
- Strong enterprise/compliance support

## Prerequisites

- AWS account
- IAM permissions to create bucket, policy, CORS, and access keys

## 1) Create S3 bucket

In AWS console:

1. Open **S3** -> **Create bucket**.
2. Choose a globally unique bucket name (for example: `scaffold-media-prod`).
3. Choose region (for example: `us-east-1`).
4. Keep **Block Public Access** enabled (recommended).
5. Create bucket.

## 2) Create IAM user for Scaffold

In AWS console:

1. Open **IAM** -> **Users** -> **Create user**.
2. Name it (for example: `scaffold-media-s3-user`).
3. Enable **Access key - Programmatic access**.

Attach least-privilege permissions scoped to this bucket. Example policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ScaffoldMediaBucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::scaffold-media-prod",
        "arn:aws:s3:::scaffold-media-prod/*"
      ]
    }
  ]
}
```

Replace bucket name before applying.

Save:

- Access Key ID
- Secret Access Key

## 3) Configure bucket CORS

In the bucket's **Permissions** tab, set CORS like:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD", "PUT", "POST", "DELETE"],
    "AllowedOrigins": [
      "http://localhost:9000",
      "http://127.0.0.1:9000",
      "https://your-production-domain.example"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## 4) Enter settings in Scaffold

- Endpoint: `https://s3.<REGION>.amazonaws.com`
- Bucket: your S3 bucket name
- Access key: IAM Access Key ID
- Secret key: IAM Secret Access Key
- Region: your bucket region (for example `us-east-1`)
- Prefix: optional (for example `scaffold-media`)

## 5) Validate

1. Save settings in Scaffold.
2. Upload media in a long note.
3. Refresh app and confirm media loads.
4. Confirm objects in the bucket and prefix.

## Rotation checklist

1. Create a new access key for the IAM user.
2. Update Scaffold with new keypair.
3. Validate read/write/delete.
4. Deactivate then delete old key.

