import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import { ACTIVITY_PROMPT, ActivityResult, parseActivityResponse } from './kmPrompt';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function extractActivityFromImage(imagePath: string): Promise<ActivityResult> {
  const imageBuffer = fs.readFileSync(path.resolve(imagePath));
  const base64Image = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const prompt = [
    { text: ACTIVITY_PROMPT },
    {
      inlineData: { mimeType, data: base64Image },
    },
  ];

  const response = await client.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: prompt,
  });

  if (!response.candidates || response.candidates.length === 0) {
    throw new Error('Nenhum resultado encontrado');
  }

  const parts = response.candidates[0].content?.parts ?? [];
  for (const part of parts) {
    if (part.text) return parseActivityResponse(part.text);
  }

  throw new Error('Nenhum resultado encontrado');
}
