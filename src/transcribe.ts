import OpenAI from "openai";
import fs from "fs";
import https from "https";
import path from "path";
import os from "os";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    }).on("error", (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

export async function transcribeVoice(fileUrl: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `voice_${Date.now()}.ogg`);

  try {
    await downloadFile(fileUrl, tmpPath);

    const response = await getClient().audio.transcriptions.create({
      model: "whisper-1",
      file: fs.createReadStream(tmpPath),
      response_format: "text",
    });

    return response as unknown as string;
  } finally {
    fs.unlink(tmpPath, () => {});
  }
}
