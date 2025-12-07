import 'dotenv/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export async function uploadToR2(fileBuffer, keyName, mimeType) {
  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: keyName,
        Body: fileBuffer,
        ContentType: mimeType,
      })
    );
    const publicUrl = `${process.env.R2_PUBLIC_DOMAIN}/${keyName}`;
    return publicUrl;
  } catch (error) {
    console.error('Ошибка при загрузке в R2:', error);
    throw new Error('Ошибка при загрузке файла');
  }
}
