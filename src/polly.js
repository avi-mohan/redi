require('dotenv').config();

const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

const polly = new PollyClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function synthesize(text) {
  const response = await polly.send(new SynthesizeSpeechCommand({
    Text: text,
    VoiceId: 'Aditi',
    LanguageCode: 'hi-IN',
    Engine: 'standard',
    OutputFormat: 'mp3',
  }));

  const chunks = [];
  for await (const chunk of response.AudioStream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = { synthesize };
