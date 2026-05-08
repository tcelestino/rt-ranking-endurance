import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function extractKmFromImage(imagePath: string): Promise<number> {
  const imageBuffer = fs.readFileSync(path.resolve(imagePath));
  const base64Image = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const prompt = [
    {
      text: `This is a screenshot from a running activity app (Strava, Garmin Connect, Nike Run Club, Apple Fitness, Polar, Suunto, etc.) or a treadmill display/result screen.

Task: Extract ONLY the total distance of the running activity as a decimal number.

Rules:
- Find the main distance value (labeled "Distance", "Distância", or equivalent in any language)
- If the unit shown is miles (mi), convert to kilometers by multiplying by 1.60934
- Return ONLY the numeric value using a period as decimal separator (e.g., 47.03)
- No units, no text, no explanation — just the number
- If no clear distance value is found, return 0`,
    },
    {
      inlineData: { mimeType, data: base64Image },
    },
  ];

  const response = await client.models.generateContent({
    model: 'gemini-3.1-flash-image-preview',
    contents: prompt,
  });

  if (!response.candidates || response.candidates.length === 0) {
    throw new Error('Nenhum resultado encontrado');
  }

  const parts = response.candidates[0].content?.parts ?? [];
  for (const part of parts) {
    if (part.text) {
      const text = part.text.trim().replace(',', '.');
      const km = parseFloat(text);
      if (isNaN(km)) throw new Error(`Não foi possível extrair km: "${text}"`);
      return km;
    }
  }

  throw new Error('Nenhum resultado encontrado');
}
