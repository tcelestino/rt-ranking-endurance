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
      text: 'Esta é uma imagem de um app de corrida (Strava, Garmin, Nike Run, etc). Extraia SOMENTE o total de km percorridos como número decimal (ex: 47.03). Responda apenas o número, sem texto adicional, sem unidade de medida.',
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
