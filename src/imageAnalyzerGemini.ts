import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function extractKmFromImage(imagePath: string): Promise<number> {
  const imageBuffer = fs.readFileSync(path.resolve(imagePath));
  const base64Image = imageBuffer.toString("base64");
  const ext = path.extname(imagePath).toLowerCase().replace(".", "");
  const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;

  const model = client.getGenerativeModel({ model: "gemini-3-flash-preview" });
  const result = await model.generateContent([
    { inlineData: { mimeType, data: base64Image } },
    "Esta é uma imagem de um app de corrida (Strava, Garmin, Nike Run, etc). Extraia SOMENTE o total de km percorridos no mês atual como número decimal (ex: 47.03). Responda apenas o número, sem texto adicional, sem unidade de medida.",
  ]);

  const text = result.response.text().trim().replace(",", ".");
  const km = parseFloat(text);
  if (isNaN(km)) throw new Error(`Não foi possível extrair km: "${text}"`);
  return km;
}
