require('dotenv').config();

const https = require('https');
const {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
} = require('@aws-sdk/client-transcribe');
const { uploadVoice } = require('./s3');

const transcribe = new TranscribeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function transcribeVoice(vendorId, audioBuffer, timestamp) {
  const s3Key = `voice/${vendorId}/${timestamp}.ogg`;
  await uploadVoice(s3Key, audioBuffer);

  const jobName = `redi-${vendorId}-${timestamp}`;
  const mediaUri = `s3://${process.env.AWS_S3_BUCKET}/${s3Key}`;

  await transcribe.send(new StartTranscriptionJobCommand({
    TranscriptionJobName: jobName,
    LanguageCode: 'hi-IN',
    MediaFormat: 'ogg',
    Media: { MediaFileUri: mediaUri },
  }));

  const job = await pollUntilComplete(jobName);
  return fetchTranscriptText(job.Transcript.TranscriptFileUri);
}

async function pollUntilComplete(jobName) {
  while (true) {
    await sleep(2000);

    const { TranscriptionJob: job } = await transcribe.send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: jobName })
    );

    if (job.TranscriptionJobStatus === 'COMPLETED') return job;
    if (job.TranscriptionJobStatus === 'FAILED') {
      throw new Error(`Transcription job failed: ${job.FailureReason}`);
    }
  }
}

function fetchTranscriptText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed.results.transcripts[0].transcript);
        } catch {
          reject(new Error('Could not parse transcript JSON from AWS'));
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { transcribeVoice };
